// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Burnable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./MoveTokenV2.sol";
import "./interfaces/IGearMultiplier.sol";

/// GearNFTV2 — ERC-1155 gear with live-ownership multipliers.
///
/// Fixes V1 stale equipment:
/// - Only active gear types may be equipped, and inactive gear contributes
///   nothing even if it stays "equipped".
/// - A token contributes only while the user currently owns at least one
///   copy — transferring or burning the last copy immediately removes its
///   effect (getUserMultiplier checks live balances).
/// - Explicit unequip.
/// - Multiplier basis points are bounded per gear type
///   [10_000, 30_000] (1.0x–3.0x) and the final combined multiplier is
///   bounded to MAX_USER_MULTIPLIER (3e18 = 3.0x).
///
/// MoveTokenV2 reads getUserMultiplier(user) at mint time; the duplicated
/// per-user multiplier mapping that existed in V1 MoveToken is gone.
contract GearNFTV2 is ERC1155, ERC1155Burnable, AccessControl, IGearMultiplier {
    bytes32 public constant GEAR_ADMIN_ROLE = keccak256("GEAR_ADMIN_ROLE");

    uint256 public constant MIN_MULTIPLIER_BPS  = 10_000; // 1.0x
    uint256 public constant MAX_MULTIPLIER_BPS  = 30_000; // 3.0x per item
    /// Documented cap on the combined multiplier (1e18 scale): 3.0x.
    uint256 public constant MAX_USER_MULTIPLIER = 3 ether;

    MoveTokenV2 public moveToken;

    enum GearSlot { Shoes, Jacket, Watch, Headband }
    uint256 public constant SLOT_COUNT = 4;

    struct GearStats {
        string name;
        GearSlot slot;
        uint256 multiplierBps; // basis points on top of 10000 base; e.g. 10500 = 1.05x
        uint256 mintCost;      // $MOVE cost to mint
        bool active;
    }

    mapping(uint256 => GearStats) public gearStats;

    // user → slot → equipped tokenId (0 = none)
    mapping(address => mapping(GearSlot => uint256)) public equippedGear;

    uint256 public nextGearId = 1;

    event GearMinted(address indexed to, uint256 indexed tokenId, uint256 amount);
    event GearEquipped(address indexed user, GearSlot slot, uint256 tokenId);
    event GearUnequipped(address indexed user, GearSlot slot, uint256 tokenId);
    event GearTypeAdded(uint256 indexed tokenId, string name, GearSlot slot, uint256 multiplierBps);
    event GearActiveSet(uint256 indexed tokenId, bool active);

    constructor(address _moveToken) ERC1155("https://api.movenrun.io/gear/{id}.json") {
        require(_moveToken != address(0), "GearNFTV2: zero address");
        moveToken = MoveTokenV2(_moveToken);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(GEAR_ADMIN_ROLE, msg.sender);
    }

    function addGearType(
        string calldata name,
        GearSlot slot,
        uint256 multiplierBps,
        uint256 mintCost
    ) external onlyRole(GEAR_ADMIN_ROLE) returns (uint256 tokenId) {
        require(
            multiplierBps >= MIN_MULTIPLIER_BPS && multiplierBps <= MAX_MULTIPLIER_BPS,
            "GearNFTV2: multiplier out of bounds"
        );
        tokenId = nextGearId++;
        gearStats[tokenId] = GearStats({
            name: name,
            slot: slot,
            multiplierBps: multiplierBps,
            mintCost: mintCost,
            active: true
        });
        emit GearTypeAdded(tokenId, name, slot, multiplierBps);
    }

    function setGearActive(uint256 tokenId, bool active) external onlyRole(GEAR_ADMIN_ROLE) {
        require(tokenId > 0 && tokenId < nextGearId, "GearNFTV2: unknown gear");
        gearStats[tokenId].active = active;
        emit GearActiveSet(tokenId, active);
    }

    function mintGear(uint256 tokenId, uint256 amount) external {
        GearStats memory stats = gearStats[tokenId];
        require(stats.active, "GearNFTV2: gear type not active");
        require(amount > 0, "GearNFTV2: zero amount");
        uint256 totalCost = stats.mintCost * amount;
        moveToken.burnFrom(msg.sender, totalCost);
        _mint(msg.sender, tokenId, amount, "");
        emit GearMinted(msg.sender, tokenId, amount);
    }

    /// Only active gear owned by the caller may be equipped.
    function equipGear(uint256 tokenId) external {
        require(balanceOf(msg.sender, tokenId) > 0, "GearNFTV2: not owned");
        GearStats memory stats = gearStats[tokenId];
        require(stats.active, "GearNFTV2: gear type not active");
        equippedGear[msg.sender][stats.slot] = tokenId;
        emit GearEquipped(msg.sender, stats.slot, tokenId);
    }

    function unequipGear(GearSlot slot) external {
        uint256 tokenId = equippedGear[msg.sender][slot];
        require(tokenId != 0, "GearNFTV2: slot empty");
        equippedGear[msg.sender][slot] = 0;
        emit GearUnequipped(msg.sender, slot, tokenId);
    }

    /// Combined multiplier in 1e18 form. A slot contributes only when its
    /// equipped token is an active gear type AND the user still owns at
    /// least one copy right now. Result starts at 1e18, multiplies each
    /// valid slot's bps/10_000, and is capped at MAX_USER_MULTIPLIER.
    function getUserMultiplier(address user) external view returns (uint256) {
        uint256 result = 1 ether;
        for (uint256 s = 0; s < SLOT_COUNT; s++) {
            uint256 tokenId = equippedGear[user][GearSlot(s)];
            if (tokenId == 0) continue;
            GearStats storage stats = gearStats[tokenId];
            if (!stats.active) continue;
            if (balanceOf(user, tokenId) == 0) continue;
            result = (result * stats.multiplierBps) / 10_000;
        }
        if (result > MAX_USER_MULTIPLIER) result = MAX_USER_MULTIPLIER;
        return result;
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC1155, AccessControl) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
