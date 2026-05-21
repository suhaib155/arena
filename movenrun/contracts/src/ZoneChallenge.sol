// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./MoveToken.sol";
import "./ZoneNFT.sol";

/// @title ZoneChallenge — 14-day territory battle system for MovenRun
/// @notice Challengers declare battles against zone owners. GPS-attested scores decide
///         the winner after 14 days. The declaration cost is escrowed at declare time and
///         returned to the challenger on a win or burned on a defender win.
contract ZoneChallenge is AccessControl, ReentrancyGuard {
    using ECDSA for bytes32;

    uint256 public constant CHALLENGE_DURATION    = 14 days;
    uint256 public constant TIME_EXTENSION        = 3 days;
    /// @dev Escrowed at declaration; returned to challenger on win, burned on loss.
    uint256 public constant DECLARATION_COST      = 100 ether;
    uint256 public constant STRONGHOLD_COST       = 300 ether;
    uint256 public constant TIME_EXT_COST         = 500 ether;
    uint256 public constant STRONGHOLD_DURATION   = 24 hours;
    uint256 public constant MAX_STRONGHOLD_STACKS = 3;
    uint256 public constant COOLDOWN_DURATION     = 30 days;

    MoveToken public moveToken;
    ZoneNFT   public zoneNFT;
    address   public trustedOracle;

    struct Challenge {
        address challenger;
        address defender;
        uint256 challengeStart;
        uint256 challengeEnd;
        uint256 challengerScore;
        uint256 defenderScore;
        uint256 defenderBaseScore;
        uint256 strongholdBoostExpiry;
        uint8   strongholdStacks;
        uint256 escrowedAmount;       // DECLARATION_COST held until resolution
        bool    timeExtensionUsed;
        bool    resolved;
    }

    // hexId → active challenge
    mapping(uint64 => Challenge) public challenges;

    // challenger → hexId → cooldown expiry
    mapping(address => mapping(uint64 => uint256)) public cooldowns;

    // prevent score sig replay
    mapping(bytes32 => bool) public usedScoreSigs;

    event ChallengeOpened(uint64 indexed hexId, address indexed challenger, address indexed defender, uint256 challengeEnd);
    event ScoreSubmitted(uint64 indexed hexId, address indexed submitter, uint256 score);
    event StrongholdBoostActivated(uint64 indexed hexId, uint8 stacks, uint256 expiry);
    event TimeExtensionUsed(uint64 indexed hexId, uint256 newChallengeEnd);
    event ChallengeResolved(uint64 indexed hexId, address indexed winner, uint256 challengerScore, uint256 defenderScore);
    event DefenderWon(uint64 indexed hexId, address indexed defender);
    event ChallengeCancelled(uint64 indexed hexId, string reason);

    constructor(address _moveToken, address _zoneNFT, address _oracle, address admin) {
        moveToken = MoveToken(_moveToken);
        zoneNFT = ZoneNFT(_zoneNFT);
        trustedOracle = _oracle;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Declare a challenge against the current zone owner.
    ///         The caller must have approved DECLARATION_COST $MOVE to this contract.
    ///         The cost is escrowed (not burned) until resolveChallenge is called;
    ///         this guarantees the funds are available regardless of the caller's
    ///         future token balance.
    /// @param hexId            H3 resolution-8 cell identifier
    /// @param defenderBaseScore Oracle-attested 30-day movement score of the current owner
    /// @param oracleSig        Oracle signature over (hexId, defenderAddress, defenderBaseScore)
    function declareChallenge(
        uint64 hexId,
        uint256 defenderBaseScore,
        bytes calldata oracleSig
    ) external {
        require(zoneNFT.zoneOwner(hexId) != address(0), "ZoneChallenge: zone not minted");

        // Challenge is active when a challenger is recorded AND it is not yet resolved.
        require(
            challenges[hexId].resolved || challenges[hexId].challenger == address(0),
            "ZoneChallenge: challenge already active"
        );

        require(block.timestamp > cooldowns[msg.sender][hexId], "ZoneChallenge: cooldown active");

        address defender = zoneNFT.zoneOwner(hexId);
        require(msg.sender != defender, "ZoneChallenge: cannot challenge own zone");

        // Oracle confirms the defender's 30-day base score
        bytes32 message = keccak256(abi.encodePacked(hexId, defender, defenderBaseScore));
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(message);
        require(ECDSA.recover(ethHash, oracleSig) == trustedOracle, "ZoneChallenge: invalid sig");

        // Escrow declaration cost — not burned until resolution
        moveToken.transferFrom(msg.sender, address(this), DECLARATION_COST);

        challenges[hexId] = Challenge({
            challenger: msg.sender,
            defender: defender,
            challengeStart: block.timestamp,
            challengeEnd: block.timestamp + CHALLENGE_DURATION,
            challengerScore: 0,
            defenderScore: 0,
            defenderBaseScore: defenderBaseScore,
            strongholdBoostExpiry: 0,
            strongholdStacks: 0,
            escrowedAmount: DECLARATION_COST,
            timeExtensionUsed: false,
            resolved: false
        });

        emit ChallengeOpened(hexId, msg.sender, defender, block.timestamp + CHALLENGE_DURATION);
    }

    /// @notice Submit a GPS-attested movement score during an active challenge window.
    ///         Only the challenger or defender may call this. Each oracle signature may
    ///         only be used once. Only the highest submitted score is kept per participant.
    /// @param hexId     H3 cell identifier
    /// @param score     Movement score for the period
    /// @param oracleSig Oracle signature over (hexId, submitter, score)
    function submitScore(
        uint64 hexId,
        uint256 score,
        bytes calldata oracleSig
    ) external {
        Challenge storage c = challenges[hexId];
        require(!c.resolved, "ZoneChallenge: resolved");
        require(block.timestamp < c.challengeEnd, "ZoneChallenge: window closed");
        require(msg.sender == c.challenger || msg.sender == c.defender, "ZoneChallenge: not participant");

        bytes32 sigHash = keccak256(abi.encodePacked(hexId, msg.sender, score));
        require(!usedScoreSigs[sigHash], "ZoneChallenge: sig reused");
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(sigHash);
        require(ECDSA.recover(ethHash, oracleSig) == trustedOracle, "ZoneChallenge: invalid sig");
        usedScoreSigs[sigHash] = true;

        if (msg.sender == c.challenger) {
            if (score > c.challengerScore) c.challengerScore = score;
        } else {
            if (score > c.defenderScore) c.defenderScore = score;
        }

        emit ScoreSubmitted(hexId, msg.sender, score);
    }

    /// @notice Defender activates a stronghold boost, increasing their effective score by
    ///         20% per stack for STRONGHOLD_DURATION. Maximum 3 stacks (up to +60%).
    ///         Costs STRONGHOLD_COST $MOVE (burned immediately).
    /// @param hexId H3 cell identifier
    function activateStrongholdBoost(uint64 hexId) external {
        Challenge storage c = challenges[hexId];
        require(!c.resolved, "ZoneChallenge: resolved");
        require(block.timestamp < c.challengeEnd, "ZoneChallenge: window closed");
        require(msg.sender == c.defender, "ZoneChallenge: not defender");
        require(c.strongholdStacks < MAX_STRONGHOLD_STACKS, "ZoneChallenge: max stacks reached");

        moveToken.burnFrom(msg.sender, STRONGHOLD_COST);
        c.strongholdStacks++;
        c.strongholdBoostExpiry = block.timestamp + STRONGHOLD_DURATION;

        emit StrongholdBoostActivated(hexId, c.strongholdStacks, c.strongholdBoostExpiry);
    }

    /// @notice Defender extends the challenge window by TIME_EXTENSION (3 days).
    ///         Can only be used once per challenge. Costs TIME_EXT_COST $MOVE (burned).
    /// @param hexId H3 cell identifier
    function requestTimeExtension(uint64 hexId) external {
        Challenge storage c = challenges[hexId];
        require(!c.resolved, "ZoneChallenge: resolved");
        require(block.timestamp < c.challengeEnd, "ZoneChallenge: window closed");
        require(msg.sender == c.defender, "ZoneChallenge: not defender");
        require(!c.timeExtensionUsed, "ZoneChallenge: extension already used");

        moveToken.burnFrom(msg.sender, TIME_EXT_COST);
        c.timeExtensionUsed = true;
        c.challengeEnd += TIME_EXTENSION;

        emit TimeExtensionUsed(hexId, c.challengeEnd);
    }

    /// @notice Resolve a challenge after the window closes.
    ///
    ///         Scoring: defenderScore = (defenderBaseScore + submitted score)
    ///                  × stronghold boost (if active) × loyalty multiplier.
    ///
    ///         Tiebreaker: defender wins on equal scores (challenger must strictly exceed).
    ///
    ///         NFT ownership check: if the zone NFT was transferred away from the original
    ///         defender during the battle (e.g. defender sold it), the challenge is cancelled
    ///         and the escrowed declaration cost is returned to the challenger.
    ///
    ///         Challenger wins: zone NFT transferred, escrowed $MOVE returned to challenger.
    ///         Defender wins:   escrowed $MOVE burned, 30-day cooldown imposed on challenger.
    ///
    /// @param hexId H3 cell identifier
    function resolveChallenge(uint64 hexId) external nonReentrant {
        Challenge storage c = challenges[hexId];
        require(c.challenger != address(0), "ZoneChallenge: no active challenge");
        require(!c.resolved, "ZoneChallenge: already resolved");
        require(block.timestamp >= c.challengeEnd, "ZoneChallenge: window not closed");

        // Mark resolved and capture escrow before any external calls (CEI pattern)
        c.resolved = true;
        uint256 escrow = c.escrowedAmount;
        c.escrowedAmount = 0;

        // If the NFT was transferred away from the original defender during the battle,
        // cancel and return the escrowed funds to the challenger.
        address currentOwner = zoneNFT.zoneOwner(hexId);
        if (currentOwner != c.defender) {
            if (escrow > 0) {
                moveToken.transfer(c.challenger, escrow);
            }
            emit ChallengeCancelled(hexId, "NFT transferred during battle");
            return;
        }

        uint256 loyaltyMult = zoneNFT.getLoyaltyMultiplier(hexId); // 100 = 1.0x
        uint256 adjustedDefender = c.defenderBaseScore + c.defenderScore;

        // Apply stronghold boost if still active
        if (block.timestamp < c.strongholdBoostExpiry && c.strongholdStacks > 0) {
            uint256 boostPct = 100 + (20 * c.strongholdStacks); // 120%, 140%, 160%
            adjustedDefender = (adjustedDefender * boostPct) / 100;
        }

        // Apply loyalty multiplier
        adjustedDefender = (adjustedDefender * loyaltyMult) / 100;

        // Challenger must strictly exceed the defender's adjusted score (tiebreaker: defender wins)
        if (c.challengerScore > adjustedDefender) {
            address defender = c.defender;
            address challenger = c.challenger;
            // Transfer NFT to challenger; defender must have approved this contract
            zoneNFT.safeTransferFrom(defender, challenger, uint256(hexId));
            // Return escrowed declaration cost to challenger as win incentive
            if (escrow > 0) {
                moveToken.transfer(challenger, escrow);
            }
            emit ChallengeResolved(hexId, challenger, c.challengerScore, adjustedDefender);
        } else {
            // Defender wins (including tiebreaker): burn escrowed cost, apply challenger cooldown
            if (escrow > 0) {
                moveToken.burnMOVE(escrow);
            }
            cooldowns[c.challenger][hexId] = block.timestamp + COOLDOWN_DURATION;
            emit DefenderWon(hexId, c.defender);
            emit ChallengeResolved(hexId, c.defender, c.challengerScore, adjustedDefender);
        }
    }

    /// @notice Returns the full Challenge struct for a given hex.
    /// @param hexId H3 cell identifier
    function getChallenge(uint64 hexId) external view returns (Challenge memory) {
        return challenges[hexId];
    }
}
