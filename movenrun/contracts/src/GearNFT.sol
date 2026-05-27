// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./MoveToken.sol";

contract GearNFT is ERC1155, AccessControl {
    bytes32 public constant GEAR_ADMIN_ROLE = keccak256("GEAR_ADMIN_ROLE");

    MoveToken public moveToken;

    enum GearSlot { Shoes, Jacket, Watch, Headband }

    struct GearStats {
        string name;
        GearSlot slot;
        uint256 multiplierBps; // basis points on top of 10000 base; e.g. 10500 = 1.05x
        uint256 mintCost;      // $MOVE cost to mint
        bool active;
    }

    // tokenId → gear stats
    mapping(uint256 => GearStats) public gearStats;

    // user → slot → equipped tokenId (0 = none)
    mapping(address => mapping(GearSlot => uint256)) public equippedGear;

    // Track next gear type ID
    uint256 public nextGearId = 1;

    event GearMinted(address indexed to, uint256 indexed tokenId, uint256 amount);
    event GearEquipped(address indexed user, GearSlot slot, uint256 tokenId);
    event GearTypeAdded(uint256 indexed tokenId, string name, GearSlot slot, uint256 multiplierBps);

    constructor(address _moveToken) ERC1155("https://api.movenrun.io/gear/{id}.json") {
        moveToken = MoveToken(_moveToken);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(GEAR_ADMIN_ROLE, msg.sender);
    }

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

    function mintGear(uint256 tokenId, uint256 amount) external {
        GearStats memory stats = gearStats[tokenId];
        require(stats.active, "GearNFT: gear type not active");
        uint256 totalCost = stats.mintCost * amount;
        moveToken.burnFrom(msg.sender, totalCost);
        _mint(msg.sender, tokenId, amount, "");
        emit GearMinted(msg.sender, tokenId, amount);
    }

    function equipGear(uint256 tokenId) external {
        require(balanceOf(msg.sender, tokenId) > 0, "GearNFT: not owned");
        GearSlot slot = gearStats[tokenId].slot;
        equippedGear[msg.sender][slot] = tokenId;
        emit GearEquipped(msg.sender, slot, tokenId);
    }

    // Returns the combined multiplier in 1e18 form for a user (product of all equipped gear)
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
