// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./MoveToken.sol";

/// @title ZoneNFT — ERC-721 territory ownership for MovenRun
/// @notice Each token represents a real-world H3 hex cell. Token ID equals the H3 uint64 cell ID.
///         Zone owners earn a 2% tax on all $MOVE minted by runners passing through their zone.
///         Zones become dormant after 180 days of inactivity and can be reclaimed after 210 days.
contract ZoneNFT is ERC721, AccessControl, ReentrancyGuard {
    using ECDSA for bytes32;

    bytes32 public constant ZONE_ADMIN_ROLE = keccak256("ZONE_ADMIN_ROLE");

    // Base mint cost before sqrt(weeklyMoverCount) scaling (in $MOVE wei)
    uint256 public constant BASE_MINT_COST = 500 ether;

    // Loyalty multiplier thresholds (in seconds)
    uint256 public constant LOYALTY_TIER1 = 30 days;   // 1.0x  → 100
    uint256 public constant LOYALTY_TIER2 = 90 days;   // 1.25x → 125
    uint256 public constant LOYALTY_TIER3 = 180 days;  // 1.5x  → 150
    uint256 public constant LOYALTY_TIER4 = 365 days;  // 1.75x → 175

    uint256 public constant DORMANCY_PERIOD = 180 days;
    uint256 public constant RECLAIM_PERIOD  = 210 days;

    MoveToken public moveToken;
    address public trustedOracle;
    address public challengeContract;

    // hexId → ownership start timestamp
    mapping(uint64 => uint256) public ownershipStart;

    // hexId → last movement activity timestamp
    mapping(uint64 => uint256) public lastActivity;

    // hexId → accumulated zone yield (2% tax from MoveToken)
    mapping(uint64 => uint256) public accumulatedYield;

    // hexId → dormant flag
    mapping(uint64 => bool) public isDormant;

    // Prevent sig replay for minting
    mapping(bytes32 => bool) public usedMintSigs;

    event ZoneMinted(uint64 indexed hexId, address indexed owner, uint256 mintCost);
    event ZoneYieldCredited(uint64 indexed hexId, address indexed owner, uint256 amount);
    event ZoneDormant(uint64 indexed hexId);
    event ZoneReclaimed(uint64 indexed hexId);
    event YieldWithdrawn(uint64 indexed hexId, address indexed owner, uint256 amount);

    constructor(address _moveToken, address _trustedOracle, address admin) ERC721("MovenRun Zone", "ZONE") {
        moveToken = MoveToken(_moveToken);
        trustedOracle = _trustedOracle;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ZONE_ADMIN_ROLE, admin);
    }

    /// @notice Set the ZoneChallenge contract address. Only callable by admin.
    /// @param _challengeContract Address of the deployed ZoneChallenge contract
    function setChallengeContract(address _challengeContract) external onlyRole(DEFAULT_ADMIN_ROLE) {
        challengeContract = _challengeContract;
    }

    /// @notice Credit 2% zone tax yield to a zone's accumulated balance.
    ///         Called exclusively by MoveToken when minting $MOVE for a run.
    /// @param hexId  H3 cell identifier
    /// @param amount $MOVE amount to credit
    function creditZoneYield(uint64 hexId, uint256 amount) external {
        require(msg.sender == address(moveToken), "ZoneNFT: only MoveToken");
        require(_ownerOf(uint256(hexId)) != address(0), "ZoneNFT: zone not minted");
        accumulatedYield[hexId] += amount;
        lastActivity[hexId] = block.timestamp;
        emit ZoneYieldCredited(hexId, _ownerOf(uint256(hexId)), amount);
    }

    /// @notice Mint a zone NFT. Only the oracle-attested top mover for the hex may mint.
    ///         The oracle signature binds (hexId, caller, mintCost) to prevent front-running
    ///         or impersonation. Each signature may only be used once.
    /// @param hexId     H3 cell identifier
    /// @param mintCost  $MOVE to burn, as computed by the backend (BASE_MINT_COST × √weeklyMovers)
    /// @param oracleSig Oracle signature over keccak256(hexId, msg.sender, mintCost)
    function mintZone(
        uint64 hexId,
        uint256 mintCost,
        bytes calldata oracleSig
    ) external {
        require(_ownerOf(uint256(hexId)) == address(0), "ZoneNFT: already minted");
        require(!isDormant[hexId], "ZoneNFT: hex in reclaim state");

        bytes32 sigHash = keccak256(abi.encodePacked(hexId, msg.sender, mintCost));
        require(!usedMintSigs[sigHash], "ZoneNFT: sig already used");
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(sigHash);
        address recovered = ECDSA.recover(ethHash, oracleSig);
        require(recovered == trustedOracle, "ZoneNFT: invalid oracle sig");
        usedMintSigs[sigHash] = true;

        moveToken.burnFrom(msg.sender, mintCost);

        _mint(msg.sender, uint256(hexId));
        ownershipStart[hexId] = block.timestamp;
        lastActivity[hexId] = block.timestamp;

        emit ZoneMinted(hexId, msg.sender, mintCost);
    }

    /// @notice Returns the loyalty multiplier for a zone owner (100 = 1.0×, 175 = 1.75×).
    ///         Used by ZoneChallenge to give long-holding owners a defensive advantage.
    /// @param hexId H3 cell identifier
    /// @return multiplier Scaled by 100 (i.e. 125 means 1.25×)
    function getLoyaltyMultiplier(uint64 hexId) external view returns (uint256) {
        uint256 start = ownershipStart[hexId];
        if (start == 0) return 100;
        uint256 elapsed = block.timestamp - start;
        if (elapsed >= LOYALTY_TIER4) return 175;
        if (elapsed >= LOYALTY_TIER3) return 150;
        if (elapsed >= LOYALTY_TIER2) return 125;
        return 100;
    }

    /// @notice Flag a zone as dormant once it has had no activity for DORMANCY_PERIOD.
    ///         Anyone may call this to trigger the dormancy warning for a neglected zone.
    /// @param hexId H3 cell identifier
    function markDormant(uint64 hexId) external {
        require(_ownerOf(uint256(hexId)) != address(0), "ZoneNFT: not minted");
        require(block.timestamp - lastActivity[hexId] > DORMANCY_PERIOD, "ZoneNFT: not dormant yet");
        isDormant[hexId] = true;
        emit ZoneDormant(hexId);
    }

    /// @notice Burn a dormant zone NFT and free the hex for re-minting.
    ///         Requires RECLAIM_PERIOD of inactivity. Unclaimed yield is forfeited.
    ///         Anyone may call this once the period has elapsed.
    /// @param hexId H3 cell identifier
    function reclaimDormant(uint64 hexId) external {
        require(isDormant[hexId], "ZoneNFT: not dormant");
        require(block.timestamp - lastActivity[hexId] > RECLAIM_PERIOD, "ZoneNFT: reclaim period not elapsed");

        _burn(uint256(hexId));
        delete ownershipStart[hexId];
        delete isDormant[hexId];
        // accumulatedYield intentionally not reset — owner forfeited unclaimed yield
        emit ZoneReclaimed(hexId);
    }

    /// @notice Withdraw accumulated zone yield ($MOVE) to the zone owner's wallet.
    ///         Protected against reentrancy (defense-in-depth; MoveToken is standard ERC-20).
    /// @param hexId H3 cell identifier
    function withdrawYield(uint64 hexId) external nonReentrant {
        require(ownerOf(uint256(hexId)) == msg.sender, "ZoneNFT: not owner");
        uint256 amount = accumulatedYield[hexId];
        require(amount > 0, "ZoneNFT: no yield");
        accumulatedYield[hexId] = 0;
        moveToken.transfer(msg.sender, amount);
        emit YieldWithdrawn(hexId, msg.sender, amount);
    }

    /// @notice Returns the current owner of a zone, or address(0) if unminted.
    /// @param hexId H3 cell identifier
    function zoneOwner(uint64 hexId) external view returns (address) {
        return _ownerOf(uint256(hexId));
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721, AccessControl) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
