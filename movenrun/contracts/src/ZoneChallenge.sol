// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./MoveToken.sol";
import "./ZoneNFT.sol";

contract ZoneChallenge is AccessControl {
    using ECDSA for bytes32;

    uint256 public constant CHALLENGE_DURATION = 14 days;
    uint256 public constant TIME_EXTENSION = 3 days;
    uint256 public constant DECLARATION_COST = 100 ether;   // $MOVE
    uint256 public constant STRONGHOLD_COST  = 300 ether;   // $MOVE
    uint256 public constant TIME_EXT_COST    = 500 ether;   // $MOVE
    uint256 public constant STRONGHOLD_DURATION = 24 hours;
    uint256 public constant MAX_STRONGHOLD_STACKS = 3;
    uint256 public constant COOLDOWN_DURATION = 30 days;

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
        uint8   strongholdStacks;      // max 3
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

    constructor(address _moveToken, address _zoneNFT, address _oracle, address admin) {
        moveToken = MoveToken(_moveToken);
        zoneNFT = ZoneNFT(_zoneNFT);
        trustedOracle = _oracle;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function declareChallenge(
        uint64 hexId,
        uint256 defenderBaseScore,
        bytes calldata oracleSig
    ) external {
        require(zoneNFT.zoneOwner(hexId) != address(0), "ZoneChallenge: zone not minted");
        require(!challenges[hexId].resolved || challenges[hexId].challenger == address(0),
            "ZoneChallenge: challenge already active");
        require(block.timestamp > cooldowns[msg.sender][hexId], "ZoneChallenge: cooldown active");

        // Oracle confirms the defender's 30-day base score
        bytes32 message = keccak256(abi.encodePacked(hexId, zoneNFT.zoneOwner(hexId), defenderBaseScore));
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(message);
        require(ECDSA.recover(ethHash, oracleSig) == trustedOracle, "ZoneChallenge: invalid sig");

        moveToken.burnFrom(msg.sender, DECLARATION_COST);

        address defender = zoneNFT.zoneOwner(hexId);
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
            timeExtensionUsed: false,
            resolved: false
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

    function resolveChallenge(uint64 hexId) external {
        Challenge storage c = challenges[hexId];
        require(!c.resolved, "ZoneChallenge: already resolved");
        require(block.timestamp >= c.challengeEnd, "ZoneChallenge: window not closed");

        c.resolved = true;

        uint256 loyaltyMult = zoneNFT.getLoyaltyMultiplier(hexId); // 100 = 1.0x
        uint256 adjustedDefender = c.defenderBaseScore + c.defenderScore;

        // Apply stronghold boost if still active
        if (block.timestamp < c.strongholdBoostExpiry && c.strongholdStacks > 0) {
            uint256 boostPct = 100 + (20 * c.strongholdStacks); // 120%, 140%, 160%
            adjustedDefender = (adjustedDefender * boostPct) / 100;
        }

        // Apply loyalty multiplier
        adjustedDefender = (adjustedDefender * loyaltyMult) / 100;

        if (c.challengerScore > adjustedDefender) {
            // Challenger wins: transfer NFT
            address defender = c.defender;
            address challenger = c.challenger;
            zoneNFT.safeTransferFrom(defender, challenger, uint256(hexId));
            emit ChallengeResolved(hexId, challenger, c.challengerScore, adjustedDefender);
        } else {
            // Defender wins: 30-day cooldown on challenger
            cooldowns[c.challenger][hexId] = block.timestamp + COOLDOWN_DURATION;
            emit DefenderWon(hexId, c.defender);
            emit ChallengeResolved(hexId, c.defender, c.challengerScore, adjustedDefender);
        }
    }

    function getChallenge(uint64 hexId) external view returns (Challenge memory) {
        return challenges[hexId];
    }
}
