// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Zone NFTs representing ownership of H3 hex cells.
/// Includes loyalty multipliers, Right of First Refusal, pull-payment yield,
/// and dormancy / reclaim mechanics.
contract ZoneNFT is ERC721, AccessControl, ReentrancyGuard {
    bytes32 public constant MINTER_ROLE          = keccak256("MINTER_ROLE");
    bytes32 public constant YIELD_DEPOSITOR_ROLE = keccak256("YIELD_DEPOSITOR_ROLE");

    uint256 public constant DORMANCY_PERIOD = 90 days;
    uint256 public constant RECLAIM_WINDOW  = 30 days;

    // ── Zone data ──────────────────────────────────────────────────────────────

    struct ZoneData {
        uint64  hexId;
        uint256 mintTime;
        uint256 lastActivityTime;
        uint256 wins;
        uint256 losses;
        bool    isStronghold;
    }

    uint256 private _tokenIdCounter;
    IERC20  public  moveToken;

    mapping(uint64  => uint256) public hexToToken;       // hexId → tokenId
    mapping(uint256 => ZoneData) public zones;           // tokenId → data
    mapping(uint64  => uint256) public ownershipStart;   // hexId → when current owner received zone

    // ── Right of First Refusal ─────────────────────────────────────────────────
    mapping(uint64 => address)  public rightOfFirstRefusal;
    mapping(uint64 => uint256)  public rofrExpiry;

    // ── Pull-payment yield ─────────────────────────────────────────────────────
    mapping(address => uint256) public pendingYield;

    // ── Dormancy ───────────────────────────────────────────────────────────────
    mapping(uint64 => uint256) public dormancyStart;

    // ── Events ─────────────────────────────────────────────────────────────────
    event ZoneMinted(uint64 indexed hexId, address indexed owner, uint256 tokenId);
    event ZoneTransferred(uint64 indexed hexId, address indexed from, address indexed to);
    event ROFRSet(uint64 indexed hexId, address indexed previousOwner, uint256 expiry);
    event ROFRExercised(uint64 indexed hexId, address indexed buyer);
    event YieldDeposited(address indexed recipient, uint256 amount);
    event YieldClaimed(address indexed recipient, uint256 amount);
    event DormancyTriggered(uint64 indexed hexId);
    event ZoneReclaimed(uint64 indexed hexId, address indexed newOwner);

    constructor(address moveToken_) ERC721("ZoneNFT", "ZONE-NFT") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        moveToken = IERC20(moveToken_);
    }

    // ── Minting ────────────────────────────────────────────────────────────────

    function mintZone(uint64 hexId, address to) external onlyRole(MINTER_ROLE) returns (uint256 tokenId) {
        require(hexToToken[hexId] == 0, "ZoneNFT: exists");

        tokenId = ++_tokenIdCounter;
        zones[tokenId] = ZoneData({
            hexId:            hexId,
            mintTime:         block.timestamp,
            lastActivityTime: block.timestamp,
            wins:             0,
            losses:           0,
            isStronghold:     false
        });
        hexToToken[hexId]    = tokenId;
        ownershipStart[hexId] = block.timestamp;

        _mint(to, tokenId);
        emit ZoneMinted(hexId, to, tokenId);
    }

    // ── Loyalty multiplier ─────────────────────────────────────────────────────

    /// @notice Returns loyalty multiplier in basis-points (100 = 1.0x).
    function getLoyaltyMultiplier(uint64 hexId) public view returns (uint256) {
        uint256 start = ownershipStart[hexId];
        if (start == 0) return 100;
        uint256 holdDays = (block.timestamp - start) / 1 days;

        if (holdDays <= 30)  return 100;
        if (holdDays <= 90)  return 115;
        if (holdDays <= 180) return 130;
        if (holdDays <= 365) return 150;
        return 175;
    }

    // ── Right of First Refusal ─────────────────────────────────────────────────

    /// @notice Called by ZoneChallenge after a zone changes hands.
    function setROFR(uint64 hexId, address previousOwner) external onlyRole(MINTER_ROLE) {
        rightOfFirstRefusal[hexId] = previousOwner;
        rofrExpiry[hexId]          = block.timestamp + 14 days;
        emit ROFRSet(hexId, previousOwner, rofrExpiry[hexId]);
    }

    /// @notice Previous owner pays ETH to match the sale price and reclaim zone.
    function exerciseROFR(uint64 hexId) external payable nonReentrant {
        require(rightOfFirstRefusal[hexId] == msg.sender, "ZoneNFT: not ROFR holder");
        require(block.timestamp <= rofrExpiry[hexId],      "ZoneNFT: ROFR expired");

        uint256 tokenId      = hexToToken[hexId];
        address currentOwner = ownerOf(tokenId);

        // Pay current owner
        (bool ok,) = currentOwner.call{value: msg.value}("");
        require(ok, "ZoneNFT: payment failed");

        _transferZoneInternal(hexId, currentOwner, msg.sender);

        rightOfFirstRefusal[hexId] = address(0);
        rofrExpiry[hexId]          = 0;
        emit ROFRExercised(hexId, msg.sender);
    }

    // ── Pull-payment yield ─────────────────────────────────────────────────────

    function depositYield(address recipient, uint256 amount)
        external
        onlyRole(YIELD_DEPOSITOR_ROLE)
    {
        pendingYield[recipient] += amount;
        emit YieldDeposited(recipient, amount);
    }

    function claimYield() external nonReentrant {
        uint256 amount = pendingYield[msg.sender];
        require(amount > 0, "ZoneNFT: no yield");
        pendingYield[msg.sender] = 0;
        require(moveToken.transfer(msg.sender, amount), "ZoneNFT: transfer failed");
        emit YieldClaimed(msg.sender, amount);
    }

    // ── Dormancy / reclaim ─────────────────────────────────────────────────────

    function isDormant(uint64 hexId) public view returns (bool) {
        uint256 tokenId = hexToToken[hexId];
        if (tokenId == 0) return false;
        return block.timestamp > zones[tokenId].lastActivityTime + DORMANCY_PERIOD;
    }

    function triggerDormancy(uint64 hexId) external {
        require(isDormant(hexId),          "ZoneNFT: not dormant");
        require(dormancyStart[hexId] == 0, "ZoneNFT: already triggered");
        dormancyStart[hexId] = block.timestamp;
        emit DormancyTriggered(hexId);
    }

    function reclaimZone(uint64 hexId) external nonReentrant {
        require(dormancyStart[hexId] > 0,                                     "ZoneNFT: not triggered");
        require(block.timestamp > dormancyStart[hexId] + RECLAIM_WINDOW,      "ZoneNFT: reclaim window active");

        uint256 tokenId     = hexToToken[hexId];
        address prevOwner   = ownerOf(tokenId);
        dormancyStart[hexId] = 0;

        _transferZoneInternal(hexId, prevOwner, msg.sender);
        // Reset zone data for new owner
        zones[tokenId].wins         = 0;
        zones[tokenId].isStronghold = false;
        emit ZoneReclaimed(hexId, msg.sender);
    }

    // ── Zone state mutations (called by ZoneChallenge) ─────────────────────────

    function transferZone(uint64 hexId, address newOwner) external onlyRole(MINTER_ROLE) {
        uint256 tokenId  = hexToToken[hexId];
        address from     = ownerOf(tokenId);
        _transferZoneInternal(hexId, from, newOwner);
        emit ZoneTransferred(hexId, from, newOwner);
    }

    function updateActivity(uint64 hexId) external onlyRole(MINTER_ROLE) {
        zones[hexToToken[hexId]].lastActivityTime = block.timestamp;
    }

    function recordWin(uint64 hexId) external onlyRole(MINTER_ROLE) {
        ZoneData storage z = zones[hexToToken[hexId]];
        z.wins++;
        z.lastActivityTime = block.timestamp;
        if (z.wins >= 5) z.isStronghold = true;
    }

    function recordLoss(uint64 hexId) external onlyRole(MINTER_ROLE) {
        ZoneData storage z = zones[hexToToken[hexId]];
        z.losses++;
        z.lastActivityTime = block.timestamp;
        z.isStronghold     = false;
    }

    function isStronghold(uint64 hexId) external view returns (bool) {
        uint256 tokenId = hexToToken[hexId];
        return tokenId != 0 && zones[tokenId].isStronghold;
    }

    function getZone(uint256 tokenId) external view returns (ZoneData memory) {
        return zones[tokenId];
    }

    // ── Internals ──────────────────────────────────────────────────────────────

    function _transferZoneInternal(uint64 hexId, address from, address to) internal {
        uint256 tokenId = hexToToken[hexId];
        _transfer(from, to, tokenId);
        ownershipStart[hexId] = block.timestamp;
    }

    // ── Interface support ──────────────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
