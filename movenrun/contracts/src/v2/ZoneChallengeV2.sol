// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "./MoveTokenV2.sol";
import "./ZoneNFTV2.sol";
import "../interfaces/IGPSOracle.sol";

/// ZoneChallengeV2 — land-defence battles with an explicit challenge
/// lifecycle (None → Active → Resolved).
///
/// State model (replaces V1's ambiguous per-hex struct-existence logic):
/// - Every challenge gets a unique, monotonically increasing challengeId.
/// - challenges[challengeId] holds the instance; activeChallengeId[hexId]
///   points at the single active challenge for a hex (0 = none).
/// - The challengeId is cryptographically bound into both the declaration
///   and score EIP-712 signatures, so signatures for one challenge instance
///   can never be replayed against a later challenge on the same hex.
///
/// Invariants:
/// 1. A hex has at most one active challenge (activeChallengeId guard).
/// 2. An active challenge cannot be overwritten (declare reverts while one
///    is active).
/// 3. A resolved challenge can be followed by a later challenge when the
///    challenger cooldown permits.
/// 4./5. Resolution flips Active → Resolved exactly once and clears the
///    active pointer; a second resolution attempt reverts.
/// 6./7. All challenge state changes happen before external transfer calls
///    (checks-effects-interactions) and resolve is nonReentrant.
///
/// Settlement: a challenger win is settled through
/// ZoneNFTV2.resolveChallengeTransfer (CHALLENGE_ROLE) — it never depends on
/// voluntary NFT approval from the defender. The deed is challenge-locked
/// from declaration until resolution.
contract ZoneChallengeV2 is AccessControl, ReentrancyGuard, EIP712 {
    string public constant SIGNING_DOMAIN_NAME    = "MovenRun";
    string public constant SIGNING_DOMAIN_VERSION = "2";

    bytes32 public constant CHALLENGE_DECLARATION_TYPEHASH = keccak256(
        "ChallengeDeclaration(uint256 challengeId,uint64 hexId,address challenger,address defender,uint256 defenderBaseScore,uint256 deadline)"
    );
    bytes32 public constant SCORE_TYPEHASH = keccak256(
        "Score(uint256 challengeId,uint64 hexId,address submitter,uint256 score,uint256 nonce,uint256 deadline)"
    );

    uint256 public constant CHALLENGE_DURATION       = 14 days;
    uint256 public constant TIME_EXTENSION           = 3 days;
    uint256 public constant DECLARATION_COST         = 100 ether;
    uint256 public constant STRONGHOLD_COST          = 300 ether;
    uint256 public constant TIME_EXT_COST            = 500 ether;
    uint256 public constant STRONGHOLD_DURATION      = 24 hours;
    uint256 public constant MAX_STRONGHOLD_STACKS    = 3;
    uint256 public constant COOLDOWN_DURATION        = 30 days;
    uint256 public constant SCORE_SUBMISSION_CUTOFF  = 1 hours;

    MoveTokenV2 public moveToken;
    ZoneNFTV2   public zoneNFT;
    address     public gpsOracle;

    enum ChallengeState { None, Active, Resolved }

    struct Challenge {
        uint64  hexId;
        address challenger;
        address defender;
        uint256 challengeStart;
        uint256 challengeEnd;
        uint256 challengerScore;
        uint256 defenderScore;
        uint256 defenderBaseScore;
        uint256 strongholdBoostExpiry;
        uint8   strongholdStacks;
        bool    timeExtensionUsed;
        ChallengeState state;
    }

    /// Next challengeId to be assigned (starts at 1; 0 is the "none" sentinel).
    uint256 public nextChallengeId = 1;
    mapping(uint256 => Challenge) public challenges;
    /// hexId → id of the currently active challenge (0 = none).
    mapping(uint64 => uint256) public activeChallengeId;
    /// challenger → hexId → cooldown expiry after a failed challenge.
    mapping(address => mapping(uint64 => uint256)) public cooldowns;
    /// Per-participant score nonce, bound into every Score signature.
    mapping(address => uint256) public scoreNonces;

    event ChallengeOpened(uint256 indexed challengeId, uint64 indexed hexId, address indexed challenger, address defender, uint256 challengeEnd);
    event ScoreSubmitted(uint256 indexed challengeId, uint64 indexed hexId, address indexed submitter, uint256 score);
    event StrongholdBoostActivated(uint256 indexed challengeId, uint8 stacks, uint256 expiry);
    event TimeExtensionUsed(uint256 indexed challengeId, uint256 newChallengeEnd);
    event ChallengeResolved(uint256 indexed challengeId, uint64 indexed hexId, address indexed winner, uint256 challengerScore, uint256 defenderScore);
    event DefenderWon(uint256 indexed challengeId, uint64 indexed hexId, address indexed defender);

    constructor(address _zoneNFT, address _moveToken, address _gpsOracle)
        EIP712(SIGNING_DOMAIN_NAME, SIGNING_DOMAIN_VERSION)
    {
        require(_zoneNFT != address(0) && _moveToken != address(0) && _gpsOracle != address(0),
            "ZoneChallengeV2: zero address");
        zoneNFT   = ZoneNFTV2(_zoneNFT);
        moveToken = MoveTokenV2(_moveToken);
        gpsOracle = _gpsOracle;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // ── Declaration ─────────────────────────────────────────────────────────

    /// The oracle signs ChallengeDeclaration over the id this challenge WILL
    /// receive (read nextChallengeId off-chain before signing). Binding the
    /// id, challenger, and defender makes the signature single-use for a
    /// single challenge instance between two specific parties.
    function declareChallenge(
        uint64 hexId,
        uint256 defenderBaseScore,
        uint256 deadline,
        bytes calldata oracleSig
    ) external nonReentrant {
        address defender = zoneNFT.zoneOwner(hexId);
        require(defender != address(0), "ZoneChallengeV2: zone not minted");
        require(defender != msg.sender, "ZoneChallengeV2: cannot challenge own zone");
        require(activeChallengeId[hexId] == 0, "ZoneChallengeV2: challenge already active");
        require(block.timestamp > cooldowns[msg.sender][hexId], "ZoneChallengeV2: cooldown active");
        require(block.timestamp <= deadline, "ZoneChallengeV2: signature expired");

        uint256 challengeId = nextChallengeId;

        bytes32 structHash = keccak256(abi.encode(
            CHALLENGE_DECLARATION_TYPEHASH,
            challengeId,
            hexId,
            msg.sender,
            defender,
            defenderBaseScore,
            deadline
        ));
        bytes32 digest = _hashTypedDataV4(structHash);
        address trustedSigner = IGPSOracle(gpsOracle).oracleOperator();
        require(ECDSA.recover(digest, oracleSig) == trustedSigner, "ZoneChallengeV2: invalid sig");

        // Effects (all challenge state) before external calls.
        nextChallengeId = challengeId + 1;
        activeChallengeId[hexId] = challengeId;
        Challenge storage c = challenges[challengeId];
        c.hexId             = hexId;
        c.challenger        = msg.sender;
        c.defender          = defender;
        c.challengeStart    = block.timestamp;
        c.challengeEnd      = block.timestamp + CHALLENGE_DURATION;
        c.defenderBaseScore = defenderBaseScore;
        c.state             = ChallengeState.Active;

        // Interactions: burn the declaration cost, then lock the deed for
        // the duration of the challenge.
        moveToken.burnFrom(msg.sender, DECLARATION_COST);
        zoneNFT.setChallengeLock(hexId, true);

        emit ChallengeOpened(challengeId, hexId, msg.sender, defender, c.challengeEnd);
    }

    // ── Scores ──────────────────────────────────────────────────────────────

    function submitScore(
        uint256 challengeId,
        uint256 score,
        uint256 deadline,
        bytes calldata oracleSig
    ) external {
        Challenge storage c = challenges[challengeId];
        require(c.state == ChallengeState.Active, "ZoneChallengeV2: not active");
        require(block.timestamp < c.challengeEnd - SCORE_SUBMISSION_CUTOFF, "ZoneChallengeV2: window closed");
        require(msg.sender == c.challenger || msg.sender == c.defender, "ZoneChallengeV2: not participant");
        require(block.timestamp <= deadline, "ZoneChallengeV2: signature expired");

        uint256 nonce = scoreNonces[msg.sender];
        bytes32 structHash = keccak256(abi.encode(
            SCORE_TYPEHASH,
            challengeId,
            c.hexId,
            msg.sender,
            score,
            nonce,
            deadline
        ));
        bytes32 digest = _hashTypedDataV4(structHash);
        address trustedSigner = IGPSOracle(gpsOracle).oracleOperator();
        require(ECDSA.recover(digest, oracleSig) == trustedSigner, "ZoneChallengeV2: invalid sig");
        scoreNonces[msg.sender] = nonce + 1;

        if (msg.sender == c.challenger) {
            if (score > c.challengerScore) c.challengerScore = score;
        } else {
            if (score > c.defenderScore) c.defenderScore = score;
        }

        emit ScoreSubmitted(challengeId, c.hexId, msg.sender, score);
    }

    // ── Defender boosts ─────────────────────────────────────────────────────

    function activateStrongholdBoost(uint256 challengeId) external {
        Challenge storage c = challenges[challengeId];
        require(c.state == ChallengeState.Active, "ZoneChallengeV2: not active");
        require(block.timestamp < c.challengeEnd, "ZoneChallengeV2: window closed");
        require(msg.sender == c.defender, "ZoneChallengeV2: not defender");
        require(c.strongholdStacks < MAX_STRONGHOLD_STACKS, "ZoneChallengeV2: max stacks reached");

        c.strongholdStacks++;
        c.strongholdBoostExpiry = block.timestamp + STRONGHOLD_DURATION;
        moveToken.burnFrom(msg.sender, STRONGHOLD_COST);

        emit StrongholdBoostActivated(challengeId, c.strongholdStacks, c.strongholdBoostExpiry);
    }

    function requestTimeExtension(uint256 challengeId) external {
        Challenge storage c = challenges[challengeId];
        require(c.state == ChallengeState.Active, "ZoneChallengeV2: not active");
        require(block.timestamp < c.challengeEnd, "ZoneChallengeV2: window closed");
        require(msg.sender == c.defender, "ZoneChallengeV2: not defender");
        require(!c.timeExtensionUsed, "ZoneChallengeV2: extension already used");

        c.timeExtensionUsed = true;
        c.challengeEnd += TIME_EXTENSION;
        moveToken.burnFrom(msg.sender, TIME_EXT_COST);

        emit TimeExtensionUsed(challengeId, c.challengeEnd);
    }

    // ── Resolution ──────────────────────────────────────────────────────────

    /// Resolves an ended challenge exactly once. All state transitions
    /// (Resolved, cleared active pointer, cooldown) happen before the
    /// external settlement call into ZoneNFTV2.
    function resolveChallenge(uint256 challengeId) external nonReentrant {
        Challenge storage c = challenges[challengeId];
        require(c.state == ChallengeState.Active, "ZoneChallengeV2: not active");
        require(block.timestamp >= c.challengeEnd, "ZoneChallengeV2: window not closed");

        uint64 hexId = c.hexId;

        uint256 loyaltyMult      = zoneNFT.getLoyaltyMultiplier(hexId);
        uint256 adjustedDefender = c.defenderBaseScore + c.defenderScore;

        if (block.timestamp < c.strongholdBoostExpiry && c.strongholdStacks > 0) {
            uint256 boostPct = 100 + (20 * c.strongholdStacks);
            adjustedDefender = (adjustedDefender * boostPct) / 100;
        }

        adjustedDefender = (adjustedDefender * loyaltyMult) / 100;

        // Effects: flip state and clear the active pointer before any
        // external transfer call.
        c.state = ChallengeState.Resolved;
        activeChallengeId[hexId] = 0;

        if (c.challengerScore > adjustedDefender) {
            zoneNFT.resolveChallengeTransfer(hexId, c.defender, c.challenger);
            emit ChallengeResolved(challengeId, hexId, c.challenger, c.challengerScore, adjustedDefender);
        } else {
            cooldowns[c.challenger][hexId] = block.timestamp + COOLDOWN_DURATION;
            zoneNFT.setChallengeLock(hexId, false);
            emit DefenderWon(challengeId, hexId, c.defender);
            emit ChallengeResolved(challengeId, hexId, c.defender, c.challengerScore, adjustedDefender);
        }
    }

    // ── Views ───────────────────────────────────────────────────────────────

    function getChallenge(uint256 challengeId) external view returns (Challenge memory) {
        return challenges[challengeId];
    }

    function getActiveChallenge(uint64 hexId) external view returns (uint256 challengeId, Challenge memory challenge) {
        challengeId = activeChallengeId[hexId];
        challenge = challenges[challengeId];
    }

    /// Exposed for off-chain signers/tests to cross-check domain separators.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
