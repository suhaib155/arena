// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./MoveToken.sol";
import "./ZoneNFT.sol";
import "./interfaces/IGPSOracle.sol";

contract ZoneChallenge is AccessControl, ReentrancyGuard {
    using ECDSA for bytes32;

    uint256 public constant CHALLENGE_DURATION       = 14 days;
    uint256 public constant TIME_EXTENSION           = 3 days;
    uint256 public constant DECLARATION_COST         = 100 ether;
    uint256 public constant STRONGHOLD_COST          = 300 ether;
    uint256 public constant TIME_EXT_COST            = 500 ether;
    uint256 public constant STRONGHOLD_DURATION      = 24 hours;
    uint256 public constant MAX_STRONGHOLD_STACKS    = 3;
    uint256 public constant COOLDOWN_DURATION        = 30 days;
    uint256 public constant SCORE_SUBMISSION_CUTOFF  = 1 hours; // FIX-011

    MoveToken public moveToken;
    ZoneNFT   public zoneNFT;
    address   public gpsOracle;
    address   public seasonController;

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
        bool    timeExtensionUsed;
        bool    resolved;
    }

    mapping(uint64 => Challenge)                      public challenges;
    mapping(address => mapping(uint64 => uint256))    public cooldowns;
    mapping(bytes32 => bool)                          public usedScoreSigs;

    event ChallengeOpened(uint64 indexed hexId, address indexed challenger, address indexed defender, uint256 challengeEnd);
    event ScoreSubmitted(uint64 indexed hexId, address indexed submitter, uint256 score);
    event StrongholdBoostActivated(uint64 indexed hexId, uint8 stacks, uint256 expiry);
    event TimeExtensionUsed(uint64 indexed hexId, uint256 newChallengeEnd);
    event ChallengeResolved(uint64 indexed hexId, address indexed winner, uint256 challengerScore, uint256 defenderScore);
    event DefenderWon(uint64 indexed hexId, address indexed defender);

    constructor(address _zoneNFT, address _moveToken, address _gpsOracle) {
        require(_zoneNFT != address(0) && _moveToken != address(0) && _gpsOracle != address(0), // FIX-003
            "ZoneChallenge: zero address");
        zoneNFT    = ZoneNFT(_zoneNFT);
        moveToken  = MoveToken(_moveToken);
        gpsOracle  = _gpsOracle;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function setSeasonController(address _seasonController) external onlyRole(DEFAULT_ADMIN_ROLE) {
        seasonController = _seasonController;
    }

    function declareChallenge(
        uint64 hexId,
        uint256 defenderBaseScore,
        bytes calldata oracleSig
    ) external {
        require(zoneNFT.zoneOwner(hexId) != address(0), "ZoneChallenge: zone not minted");
        require(
            !challenges[hexId].resolved || challenges[hexId].challenger == address(0),
            "ZoneChallenge: challenge already active"
        );
        require(block.timestamp > cooldowns[msg.sender][hexId], "ZoneChallenge: cooldown active");

        address trustedSigner = IGPSOracle(gpsOracle).oracleOperator();
        bytes32 message = keccak256(abi.encodePacked(block.chainid, hexId, zoneNFT.zoneOwner(hexId), defenderBaseScore)); // FIX-001
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(message);
        require(ECDSA.recover(ethHash, oracleSig) == trustedSigner, "ZoneChallenge: invalid sig");

        moveToken.burnFrom(msg.sender, DECLARATION_COST);

        address defender = zoneNFT.zoneOwner(hexId);
        challenges[hexId] = Challenge({
            challenger:           msg.sender,
            defender:             defender,
            challengeStart:       block.timestamp,
            challengeEnd:         block.timestamp + CHALLENGE_DURATION,
            challengerScore:      0,
            defenderScore:        0,
            defenderBaseScore:    defenderBaseScore,
            strongholdBoostExpiry: 0,
            strongholdStacks:     0,
            timeExtensionUsed:    false,
            resolved:             false
        });

        emit ChallengeOpened(hexId, msg.sender, defender, block.timestamp + CHALLENGE_DURATION);
    }

    function submitScore(
        uint64 hexId,
        uint256 score,
        bytes calldata oracleSig
    ) external {
        Challenge storage c = challenges[hexId];
        require(!c.resolved, "ZoneChallenge: resolved");
        require(block.timestamp < c.challengeEnd - SCORE_SUBMISSION_CUTOFF, "ZoneChallenge: window closed"); // FIX-011
        require(msg.sender == c.challenger || msg.sender == c.defender, "ZoneChallenge: not participant");

        address trustedSigner = IGPSOracle(gpsOracle).oracleOperator();
        bytes32 sigHash = keccak256(abi.encodePacked(block.chainid, hexId, msg.sender, score)); // FIX-001
        require(!usedScoreSigs[sigHash], "ZoneChallenge: sig reused");
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(sigHash);
        require(ECDSA.recover(ethHash, oracleSig) == trustedSigner, "ZoneChallenge: invalid sig");
        usedScoreSigs[sigHash] = true;

        if (msg.sender == c.challenger) {
            if (score > c.challengerScore) c.challengerScore = score;
        } else {
            if (score > c.defenderScore) c.defenderScore = score;
        }

        emit ScoreSubmitted(hexId, msg.sender, score);
    }

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

    function resolveChallenge(uint64 hexId) external nonReentrant { // defense-in-depth
        Challenge storage c = challenges[hexId];
        require(!c.resolved, "ZoneChallenge: already resolved");
        require(block.timestamp >= c.challengeEnd, "ZoneChallenge: window not closed");

        c.resolved = true;

        uint256 loyaltyMult    = zoneNFT.getLoyaltyMultiplier(hexId);
        uint256 adjustedDefender = c.defenderBaseScore + c.defenderScore;

        if (block.timestamp < c.strongholdBoostExpiry && c.strongholdStacks > 0) {
            uint256 boostPct = 100 + (20 * c.strongholdStacks);
            adjustedDefender = (adjustedDefender * boostPct) / 100;
        }

        adjustedDefender = (adjustedDefender * loyaltyMult) / 100;

        if (c.challengerScore > adjustedDefender) {
            address defender   = c.defender;
            address challenger = c.challenger;
            zoneNFT.safeTransferFrom(defender, challenger, uint256(hexId));
            emit ChallengeResolved(hexId, challenger, c.challengerScore, adjustedDefender);
        } else {
            cooldowns[c.challenger][hexId] = block.timestamp + COOLDOWN_DURATION;
            emit DefenderWon(hexId, c.defender);
            emit ChallengeResolved(hexId, c.defender, c.challengerScore, adjustedDefender);
        }
    }

    function getChallenge(uint64 hexId) external view returns (Challenge memory) {
        return challenges[hexId];
    }
}
