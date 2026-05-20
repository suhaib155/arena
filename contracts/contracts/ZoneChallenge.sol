// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./ZoneNFT.sol";
import "./SeasonController.sol";

/// @notice Battle engine for zone challenges.
/// Supports club rally, stronghold boost, time extension, and 30-day cooldowns.
contract ZoneChallenge is AccessControl, ReentrancyGuard {
    using ECDSA for bytes32;

    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    uint256 public constant CHALLENGE_DURATION   = 24 hours;
    uint256 public constant TIME_EXTENSION        = 6 hours;
    uint256 public constant STRONGHOLD_BOOST_BPS  = 12000; // 120% (1.2x)
    uint256 public constant CLOSE_THRESHOLD_BPS   = 1000;  // 10% closeness triggers extension
    uint256 public constant COOLDOWN_PERIOD        = 30 days;
    uint256 public constant MIN_STAKE              = 10e18; // 10 MOVE min stake

    enum ChallengeState { NONE, OPEN, RESOLVED, CANCELLED }

    struct Challenge {
        uint64  hexId;
        address challenger;
        address defender;
        uint256 challengerScore;
        uint256 defenderScore;
        uint256 openTime;
        uint256 closeTime;
        uint256 stakedAmount;
        ChallengeState state;
        bool    extended;
    }

    ZoneNFT          public zoneNFT;
    IERC20           public moveToken;
    SeasonController public seasonController;

    // hexId → Challenge
    mapping(uint64 => Challenge) public challenges;

    // Cooldown: challenger → hexId → timestamp after which they can rechallenge
    mapping(address => mapping(uint64 => uint256)) public challengeCooldown;

    // Contribution nonces per contributor to prevent replay
    mapping(address => uint256) public contributionNonces;

    // Reconquest tracking: hexId → original owner (before loss)
    mapping(uint64 => address)  public previousOwner;
    mapping(uint64 => uint256)  public ownerLostAt;

    // Events
    event ChallengeOpened(uint64 indexed hexId, address indexed challenger, address indexed defender, uint256 closeTime);
    event ScoreContributed(uint64 indexed hexId, address indexed side, address indexed contributor, uint256 score);
    event TimeExtended(uint64 indexed hexId, uint256 newCloseTime);
    event ChallengeResolved(uint64 indexed hexId, address indexed winner, bool challengerWon);

    constructor(
        address zoneNFT_,
        address moveToken_,
        address seasonController_,
        address oracle_
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ORACLE_ROLE, oracle_);

        zoneNFT          = ZoneNFT(zoneNFT_);
        moveToken         = IERC20(moveToken_);
        seasonController  = SeasonController(seasonController_);
    }

    // ── Open a challenge ───────────────────────────────────────────────────────

    function openChallenge(uint64 hexId, uint256 stakedAmount) external nonReentrant {
        require(stakedAmount >= MIN_STAKE, "ZoneChallenge: stake too low");
        require(
            challenges[hexId].state == ChallengeState.NONE ||
            challenges[hexId].state == ChallengeState.RESOLVED ||
            challenges[hexId].state == ChallengeState.CANCELLED,
            "ZoneChallenge: active"
        );
        require(
            block.timestamp >= challengeCooldown[msg.sender][hexId],
            "ZoneChallenge: cooldown"
        );

        uint256 tokenId = zoneNFT.hexToToken(hexId);
        require(tokenId != 0, "ZoneChallenge: zone not minted");
        address defender = zoneNFT.ownerOf(tokenId);
        require(defender != msg.sender, "ZoneChallenge: own zone");

        require(
            moveToken.transferFrom(msg.sender, address(this), stakedAmount),
            "ZoneChallenge: stake transfer"
        );

        // Set cooldown immediately so challenger can't spam open attempts
        challengeCooldown[msg.sender][hexId] = block.timestamp + COOLDOWN_PERIOD;

        uint256 closeTime = block.timestamp + CHALLENGE_DURATION;
        challenges[hexId] = Challenge({
            hexId:            hexId,
            challenger:       msg.sender,
            defender:         defender,
            challengerScore:  0,
            defenderScore:    0,
            openTime:         block.timestamp,
            closeTime:        closeTime,
            stakedAmount:     stakedAmount,
            state:            ChallengeState.OPEN,
            extended:         false
        });

        zoneNFT.updateActivity(hexId);
        emit ChallengeOpened(hexId, msg.sender, defender, closeTime);
    }

    // ── Club rally score contributions ─────────────────────────────────────────

    /// @notice Club members submit oracle-signed movement scores to either side.
    /// @param hexId    The contested zone.
    /// @param side     Address of the side being supported (challenger or defender).
    /// @param score    Verified movement score.
    /// @param sig      Oracle ECDSA signature over (hexId, side, msg.sender, score, nonce).
    function contributeToChallenge(
        uint64  hexId,
        address side,
        uint256 score,
        bytes calldata sig
    ) external nonReentrant {
        Challenge storage c = challenges[hexId];
        require(c.state == ChallengeState.OPEN,   "ZoneChallenge: not open");
        require(block.timestamp < c.closeTime,    "ZoneChallenge: closed");
        require(side == c.challenger || side == c.defender, "ZoneChallenge: invalid side");

        // Verify oracle signature
        uint256 nonce    = contributionNonces[msg.sender]++;
        bytes32 msgHash  = keccak256(abi.encodePacked(hexId, side, msg.sender, score, nonce));
        bytes32 ethHash  = MessageHashUtils.toEthSignedMessageHash(msgHash);
        address recovered = ECDSA.recover(ethHash, sig);
        require(hasRole(ORACLE_ROLE, recovered), "ZoneChallenge: bad oracle sig");

        if (side == c.challenger) {
            c.challengerScore += score;
        } else {
            c.defenderScore += score;
        }

        emit ScoreContributed(hexId, side, msg.sender, score);

        // Check whether a time extension is warranted (once only)
        _maybeExtend(hexId);
    }

    // ── Resolve ────────────────────────────────────────────────────────────────

    function resolveChallenge(uint64 hexId) external nonReentrant {
        Challenge storage c = challenges[hexId];
        require(c.state == ChallengeState.OPEN, "ZoneChallenge: not open");
        require(block.timestamp >= c.closeTime, "ZoneChallenge: not closed");

        c.state = ChallengeState.RESOLVED;

        // Apply stronghold boost to defender score
        uint256 effectiveDefender = c.defenderScore;
        if (zoneNFT.isStronghold(hexId)) {
            effectiveDefender = (c.defenderScore * STRONGHOLD_BOOST_BPS) / 10000;
        }

        bool challengerWon = c.challengerScore > effectiveDefender;
        address winner     = challengerWon ? c.challenger : c.defender;
        address loser      = challengerWon ? c.defender   : c.challenger;

        // Evaluate reconquest BEFORE updating previousOwner so the old value is intact.
        bool isReconquest = (
            challengerWon &&
            c.challenger == previousOwner[hexId] &&
            ownerLostAt[hexId] > 0 &&
            block.timestamp <= ownerLostAt[hexId] + 60 days
        );

        if (challengerWon) {
            // Transfer zone and set ROFR for evicted owner
            zoneNFT.transferZone(hexId, c.challenger);
            zoneNFT.setROFR(hexId, c.defender);
            zoneNFT.recordLoss(hexId);

            // Update reconquest tracking for the next potential reconquest
            previousOwner[hexId] = c.defender;
            ownerLostAt[hexId]   = block.timestamp;

            // Reward challenger with staked amount
            require(moveToken.transfer(c.challenger, c.stakedAmount), "ZoneChallenge: reward");
        } else {
            // Defender keeps zone; reward defender
            zoneNFT.recordWin(hexId);
            require(moveToken.transfer(c.defender, c.stakedAmount), "ZoneChallenge: reward");
        }
        try seasonController.onChallengeResolved(hexId, winner, loser, isReconquest) {} catch {}

        emit ChallengeResolved(hexId, winner, challengerWon);
    }

    // ── Internals ──────────────────────────────────────────────────────────────

    function _maybeExtend(uint64 hexId) internal {
        Challenge storage c = challenges[hexId];
        if (c.extended) return;
        if (block.timestamp < c.closeTime) return; // not at the edge yet

        uint256 total = c.challengerScore + c.defenderScore;
        if (total == 0) return;

        uint256 diff = c.challengerScore > c.defenderScore
            ? c.challengerScore - c.defenderScore
            : c.defenderScore - c.challengerScore;

        // extend if within CLOSE_THRESHOLD_BPS of the larger side
        uint256 larger = c.challengerScore > c.defenderScore
            ? c.challengerScore : c.defenderScore;

        if (larger > 0 && (diff * 10000) / larger <= CLOSE_THRESHOLD_BPS) {
            c.extended  = true;
            c.closeTime += TIME_EXTENSION;
            emit TimeExtended(hexId, c.closeTime);
        }
    }

    // ── Interface support ──────────────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
