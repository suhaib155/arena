// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./MoveToken.sol";
import "./interfaces/IGPSOracle.sol";

contract ZoneNFT is ERC721, AccessControl {
    using ECDSA for bytes32;

    bytes32 public constant ZONE_ADMIN_ROLE = keccak256("ZONE_ADMIN_ROLE");

    uint256 public constant BASE_MINT_COST   = 500 ether;
    uint256 public constant LOYALTY_TIER1    = 30 days;
    uint256 public constant LOYALTY_TIER2    = 90 days;
    uint256 public constant LOYALTY_TIER3    = 180 days;
    uint256 public constant LOYALTY_TIER4    = 365 days;
    uint256 public constant DORMANCY_PERIOD  = 180 days;
    uint256 public constant RECLAIM_PERIOD   = 210 days;

    MoveToken public moveToken;
    address   public gpsOracle;
    address   public challengeContract;
    address   public seasonController;

    mapping(uint64 => uint256) public ownershipStart;
    mapping(uint64 => uint256) public lastActivity;
    mapping(uint64 => uint256) public accumulatedYield;
    mapping(uint64 => bool)    public isDormant;
    mapping(bytes32 => bool)   public usedMintSigs;

    event ZoneMinted(uint64 indexed hexId, address indexed owner, uint256 mintCost);
    event ZoneYieldCredited(uint64 indexed hexId, address indexed owner, uint256 amount);
    event ZoneDormant(uint64 indexed hexId);
    event ZoneReclaimed(uint64 indexed hexId);
    event YieldWithdrawn(uint64 indexed hexId, address indexed owner, uint256 amount);

    constructor(address _moveToken, address _gpsOracle) ERC721("MovenRun Zone", "ZONE") {
        require(_moveToken != address(0) && _gpsOracle != address(0), "ZoneNFT: zero address"); // FIX-003
        moveToken = MoveToken(_moveToken);
        gpsOracle = _gpsOracle;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ZONE_ADMIN_ROLE, msg.sender);
    }

    function setChallengeContract(address _challengeContract) external onlyRole(DEFAULT_ADMIN_ROLE) {
        challengeContract = _challengeContract;
    }

    function setSeasonController(address _seasonController) external onlyRole(DEFAULT_ADMIN_ROLE) {
        seasonController = _seasonController;
    }

    function creditZoneYield(uint64 hexId, uint256 amount) external {
        require(msg.sender == address(moveToken), "ZoneNFT: only MoveToken");
        require(_ownerOf(uint256(hexId)) != address(0), "ZoneNFT: zone not minted");
        accumulatedYield[hexId] += amount;
        lastActivity[hexId] = block.timestamp;
        emit ZoneYieldCredited(hexId, _ownerOf(uint256(hexId)), amount);
    }

    function mintZone(
        uint64 hexId,
        uint256 mintCost,
        bytes calldata oracleSig
    ) external {
        require(_ownerOf(uint256(hexId)) == address(0), "ZoneNFT: already minted");
        require(!isDormant[hexId], "ZoneNFT: hex in reclaim state");

        address trustedSigner = IGPSOracle(gpsOracle).oracleOperator();
        bytes32 sigHash = keccak256(abi.encodePacked(block.chainid, hexId, msg.sender, mintCost)); // FIX-001
        require(!usedMintSigs[sigHash], "ZoneNFT: sig already used");
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(sigHash);
        require(ECDSA.recover(ethHash, oracleSig) == trustedSigner, "ZoneNFT: invalid oracle sig");
        usedMintSigs[sigHash] = true;

        moveToken.burnFrom(msg.sender, mintCost);

        _mint(msg.sender, uint256(hexId));
        ownershipStart[hexId] = block.timestamp;
        lastActivity[hexId] = block.timestamp;

        emit ZoneMinted(hexId, msg.sender, mintCost);
    }

    function getLoyaltyMultiplier(uint64 hexId) external view returns (uint256) {
        uint256 start = ownershipStart[hexId];
        if (start == 0) return 100;
        uint256 elapsed = block.timestamp - start;
        if (elapsed >= LOYALTY_TIER4) return 175;
        if (elapsed >= LOYALTY_TIER3) return 150;
        if (elapsed >= LOYALTY_TIER2) return 125;
        return 100;
    }

    function markDormant(uint64 hexId) external {
        require(_ownerOf(uint256(hexId)) != address(0), "ZoneNFT: not minted");
        require(block.timestamp - lastActivity[hexId] > DORMANCY_PERIOD, "ZoneNFT: not dormant yet");
        isDormant[hexId] = true;
        emit ZoneDormant(hexId);
    }

    function reclaimDormant(uint64 hexId) external {
        require(isDormant[hexId], "ZoneNFT: not dormant");
        require(block.timestamp - lastActivity[hexId] > RECLAIM_PERIOD, "ZoneNFT: reclaim period not elapsed");
        _burn(uint256(hexId));
        delete ownershipStart[hexId];
        delete isDormant[hexId];
        emit ZoneReclaimed(hexId);
    }

    function withdrawYield(uint64 hexId) external {
        require(ownerOf(uint256(hexId)) == msg.sender, "ZoneNFT: not owner");
        uint256 amount = accumulatedYield[hexId];
        require(amount > 0, "ZoneNFT: no yield");
        accumulatedYield[hexId] = 0;
        moveToken.transfer(msg.sender, amount);
        emit YieldWithdrawn(hexId, msg.sender, amount);
    }

    function zoneOwner(uint64 hexId) external view returns (address) {
        return _ownerOf(uint256(hexId));
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721, AccessControl) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
