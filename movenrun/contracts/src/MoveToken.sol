// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract MoveToken is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE   = keccak256("MINTER_ROLE");
    bytes32 public constant ORACLE_ROLE   = keccak256("ORACLE_ROLE");
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant SEASON_ROLE   = keccak256("SEASON_ROLE");

    uint256 public constant MAX_SUPPLY       = 1_000_000_000 ether;
    uint256 public constant HALVING_INTERVAL = 2_600_000;
    uint256 public constant ZONE_TAX_BPS     = 200; // 2%

    address public zoneNFT;

    uint256 public baseRate = 10 ether; // 10 $MOVE per km
    uint256 public deployBlock;

    uint256 public weeklyMint;
    uint256 public weeklyBurn;

    struct DailyCap {
        uint256 minted;
        uint256 resetAt;
    }
    mapping(address => DailyCap) public dailyCaps;
    mapping(address => uint256)  public gearMultiplier;
    mapping(bytes32 => bool)     public usedRoutes;

    event MoveMinted(address indexed to, bytes32 indexed routeHash, uint256 distanceMeters, uint256 earned);
    event BaseRateUpdated(uint256 oldRate, uint256 newRate);
    event WeeklyStatsReset(uint256 weeklyMint, uint256 weeklyBurn);

    constructor(address initialAdmin) ERC20("MoveToken", "$MOVE") {
        deployBlock = block.number;
        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
        _grantRole(GOVERNOR_ROLE, initialAdmin);
    }

    function setZoneNFT(address _zoneNFT) external onlyRole(DEFAULT_ADMIN_ROLE) {
        zoneNFT = _zoneNFT;
    }

    function setGearMultiplier(address user, uint256 multiplier) external onlyRole(MINTER_ROLE) {
        require(multiplier >= 1 ether && multiplier <= 3 ether, "MoveToken: multiplier out of range");
        gearMultiplier[user] = multiplier;
    }

    // Called exclusively by GPSOracle (holds ORACLE_ROLE). Sig verified there.
    function mintMOVE(
        address to,
        bytes32 routeHash,
        uint256 distanceMeters
    ) external onlyRole(ORACLE_ROLE) {
        require(!usedRoutes[routeHash], "MoveToken: route already used");

        usedRoutes[routeHash] = true;

        uint256 effectiveRate = _currentRate();
        uint256 mult = gearMultiplier[to];
        if (mult == 0) mult = 1 ether;

        uint256 earned = (distanceMeters * effectiveRate * mult) / (1000 * 1 ether);

        DailyCap storage cap = dailyCaps[to];
        if (block.timestamp >= cap.resetAt) {
            cap.minted = 0;
            cap.resetAt = block.timestamp + 1 days;
        }
        uint256 dailyCapAmount = _currentDailyCap();
        if (cap.minted + earned > dailyCapAmount) {
            earned = dailyCapAmount - cap.minted;
        }
        require(earned > 0, "MoveToken: daily cap reached");
        cap.minted += earned;

        require(totalSupply() + earned <= MAX_SUPPLY, "MoveToken: max supply exceeded");

        uint256 zoneTax = 0;
        if (zoneNFT != address(0)) {
            zoneTax = (earned * ZONE_TAX_BPS) / 10_000;
        }

        weeklyMint += earned;
        _mint(to, earned - zoneTax);
        if (zoneTax > 0) {
            _mint(zoneNFT, zoneTax);
        }

        emit MoveMinted(to, routeHash, distanceMeters, earned);
    }

    function burnMOVE(uint256 amount) external {
        weeklyBurn += amount;
        _burn(msg.sender, amount);
    }

    function burnFrom(address from, uint256 amount) public {
        _spendAllowance(from, msg.sender, amount);
        weeklyBurn += amount;
        _burn(from, amount);
    }

    function updateBaseRate(uint256 newRate) external onlyRole(GOVERNOR_ROLE) {
        emit BaseRateUpdated(baseRate, newRate);
        baseRate = newRate;
    }

    function adjustEmissionRate() external onlyRole(SEASON_ROLE) {
        if (weeklyMint > 0) {
            uint256 ratioBps = (weeklyBurn * 10_000) / weeklyMint;
            if (ratioBps < 7_000) {
                baseRate = (baseRate * 9_000) / 10_000;
                emit BaseRateUpdated(baseRate, baseRate);
            }
        }
        emit WeeklyStatsReset(weeklyMint, weeklyBurn);
        weeklyMint = 0;
        weeklyBurn = 0;
    }

    function resetWeeklyStats() external onlyRole(SEASON_ROLE) {
        emit WeeklyStatsReset(weeklyMint, weeklyBurn);
        weeklyMint = 0;
        weeklyBurn = 0;
    }

    function _currentRate() internal view returns (uint256) {
        uint256 halvings = (block.number - deployBlock) / HALVING_INTERVAL;
        if (halvings > 20) halvings = 20;
        uint256 rate = baseRate;
        for (uint256 i = 0; i < halvings; i++) rate = rate / 2;
        return rate;
    }

    function _currentDailyCap() internal view returns (uint256) {
        uint256 halvings = (block.number - deployBlock) / HALVING_INTERVAL;
        if (halvings > 20) halvings = 20;
        uint256 cap = 200 ether;
        for (uint256 i = 0; i < halvings; i++) cap = cap / 2;
        return cap;
    }

    function currentRate() external view returns (uint256) { return _currentRate(); }
    function currentDailyCap() external view returns (uint256) { return _currentDailyCap(); }
}
