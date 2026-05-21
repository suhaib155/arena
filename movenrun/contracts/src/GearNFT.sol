// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./MoveToken.sol";

/// @title GearNFT — ERC-1155 equipment system for MovenRun
/// @notice Players mint gear NFTs by burning $MOVE. Each gear slot (Shoes, Jacket, Watch,
///         Headband) provides a movement score multiplier. Equipping a new item for a slot
///         replaces the previous one. The combined multiplier across all slots is applied
///         to a user's $MOVE earnings by MoveToken.
contract GearNFT is ERC1155, AccessControl {
    bytes32 public constant GEAR_ADMIN_ROLE = keccak256("GEAR_ADMIN_ROLE");

    MoveToken public moveToken;

    enum GearSlot { Shoes, Jacket, Watch, Headband }

    struct GearStats {
        string name;
        GearSlot slot;
        uint256 multiplierBps; // basis points on top of 10000 base; e.g. 10500 = 1.05×
        uint256 mintCost;      // $MOVE cost to mint
        bool active;
    }

    // tokenId → gear stats
    mapping(uint256 => GearStats) public gearStats;

    // user → slot → equipped tokenId (0 = none)
    mapping(address => mapping(GearSlot => uint256)) public equippedGear;

    uint256 public nextGearId = 1;

    event GearMinted(address indexed to, uint256 indexed tokenId, uint256 amount);
    event GearEquipped(address indexed user, GearSlot slot, uint256 tokenId);
    event GearTypeAdded(uint256 indexed tokenId, string name, GearSlot slot, uint256 multiplierBps);

    constructor(address _moveToken, address admin) ERC1155("https://api.movenrun.io/gear/{id}.json") {
        moveToken = MoveToken(_moveToken);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GEAR_ADMIN_ROLE, admin);
    }

    /// @notice Register a new gear type. Restricted to GEAR_ADMIN_ROLE.
    /// @param name          Display name (e.g. "Sprint Shoes")
    /// @param slot          Equipment slot (Shoes, Jacket, Watch, Headband)
    /// @param multiplierBps Multiplier in basis points (10000 = 1.0×, 10500 = 1.05×)
    /// @param mintCost      $MOVE cost to mint one unit
    /// @return tokenId      The newly assigned ERC-1155 token ID
    function addGearType(
        string calldata name,
        GearSlot slot,
        uint256 multiplierBps,
        uint256 mintCost
    ) external onlyRole(GEAR_ADMIN_ROLE) returns (uint256 tokenId) {
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

    /// @notice Mint `amount` units of a gear type by burning $MOVE.
    ///         Caller must have approved this contract for `gearStats[tokenId].mintCost × amount`.
    /// @param tokenId Gear type token ID
    /// @param amount  Number of units to mint
    function mintGear(uint256 tokenId, uint256 amount) external {
        GearStats memory stats = gearStats[tokenId];
        require(stats.active, "GearNFT: gear type not active");
        uint256 totalCost = stats.mintCost * amount;
        moveToken.burnFrom(msg.sender, totalCost);
        _mint(msg.sender, tokenId, amount, "");
        emit GearMinted(msg.sender, tokenId, amount);
    }

    /// @notice Equip a gear item to its slot. Caller must own at least one unit.
    ///         Replaces any previously equipped item in the same slot.
    /// @param tokenId Gear type token ID to equip
    function equipGear(uint256 tokenId) external {
        require(balanceOf(msg.sender, tokenId) > 0, "GearNFT: not owned");
        GearSlot slot = gearStats[tokenId].slot;
        equippedGear[msg.sender][slot] = tokenId;
        emit GearEquipped(msg.sender, slot, tokenId);
    }

    /// @notice Compute the combined equipment multiplier for a user across all four slots.
    ///         Result is expressed in 1e18 units (1e18 = 1.0×, 1.5e18 = 1.5×).
    ///         The loop is bounded to exactly 4 iterations (one per GearSlot enum value).
    /// @param user Wallet address
    /// @return Combined multiplier in 1e18 scale
    function getUserMultiplier(address user) external view returns (uint256) {
        uint256 result = 1 ether;
        for (uint256 s = 0; s < 4; s++) {
            uint256 tokenId = equippedGear[user][GearSlot(s)];
            if (tokenId != 0) {
                result = (result * gearStats[tokenId].multiplierBps) / 10_000;
            }
        }
        return result;
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC1155, AccessControl) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
