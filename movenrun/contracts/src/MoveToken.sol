// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract MoveToken is ERC20Burnable, AccessControl {
    using ECDSA for bytes32;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant SEASON_ROLE = keccak256("SEASON_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    uint256 public constant MAX_SUPPLY = 1_000_000_000 ether;
    uint256 public constant HALVING_INTERVAL = 2_600_000;
    uint256 public constant ZONE_TAX_BPS = 200; // 2%
    uint256 public constant MIN_DEPOSIT = 50 ether; // 50 $MOVE security deposit

    address public trustedOracle;
    address public zoneNFT;
    address public daoTreasury;

    uint256 public baseRate = 10 ether; // 10 $MOVE per km
    uint256 public deployBlock;

    // Weekly tracking for auto-valve (reset by SeasonController)
    uint256 public weeklyMint;
    uint256 public weeklyBurn;

    // Per-address daily cap state
    struct DailyCap {
        uint256 minted;
        uint256 resetAt;
    }
    mapping(address => DailyCap) public dailyCaps;

    // Per-address gear multiplier (1e18 = 1.0x, 1.5e18 = 1.5x)
    mapping(address => uint256) public gearMultiplier;

    // Prevent route replay
    mapping(bytes32 => bool) public usedRoutes;

    // Stake-to-earn security deposits
    mapping(address => uint256) public securityDeposit;
    mapping(address => bool) public earnBanned;

    event MoveMinted(address indexed to, bytes32 indexed routeHash, uint256 distanceMeters, uint256 earned);
    event BaseRateUpdated(uint256 oldRate, uint256 newRate);
    event OracleUpdated(address oldOracle, address newOracle);
    event WeeklyStatsReset(uint256 weeklyMint, uint256 weeklyBurn);
    event StakeDeposited(address indexed user, uint256 amount);
    event StakeSlashed(address indexed cheater, string reason);

    constructor(address _trustedOracle, address admin) ERC20("MoveToken", "$MOVE") {
        trustedOracle = _trustedOracle;
        daoTreasury = admin;
        deployBlock = block.number;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GOVERNOR_ROLE, admin);
    }

    function setZoneNFT(address _zoneNFT) external onlyRole(DEFAULT_ADMIN_ROLE) {
        zoneNFT = _zoneNFT;
    }

    function setDaoTreasury(address _treasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        daoTreasury = _treasury;
    }

    function setGearMultiplier(address user, uint256 multiplier) external onlyRole(MINTER_ROLE) {
        // multiplier expressed as 1e18 = 1.0x baseline
        require(multiplier >= 1 ether && multiplier <= 3 ether, "MoveToken: multiplier out of range");
        gearMultiplier[user] = multiplier;
    }

    // ─── Stake-to-earn ──────────────────────────────────────────────────────────

    /// @notice Deposit 50 $MOVE as an anti-cheat security bond before earning
    function depositStake() external {
        require(securityDeposit[msg.sender] == 0, "MoveToken: already deposited");
        _transfer(msg.sender, address(this), MIN_DEPOSIT);
        securityDeposit[msg.sender] = MIN_DEPOSIT;
        emit StakeDeposited(msg.sender, MIN_DEPOSIT);
    }

    /// @notice Slash a cheater's deposit to the DAO treasury and ban them from earning
    /// @param cheater Address of the banned user
    /// @param reason Human-readable reason for the slash (logged to event)
    function slashStake(address cheater, string calldata reason) external onlyRole(ORACLE_ROLE) {
        uint256 amount = securityDeposit[cheater];
        require(amount > 0, "MoveToken: no deposit to slash");
        securityDeposit[cheater] = 0;
        earnBanned[cheater] = true;
        _transfer(address(this), daoTreasury, amount);
        emit StakeSlashed(cheater, reason);
    }

    /// @notice Admin bootstrap mint — used for initial distribution, liquidity, and treasury seeding.
    ///         Does NOT require a security deposit (used to onboard new users pre-staking).
    function adminMint(address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(totalSupply() + amount <= MAX_SUPPLY, "MoveToken: max supply exceeded");
        _mint(to, amount);
    }

    // ────────────────────────────────────────────────────────────────────────────

    function mintMOVE(
        address to,
        bytes32 routeHash,
        bytes calldata oracleSig,
        uint256 distanceMeters
    ) external {
        require(!usedRoutes[routeHash], "MoveToken: route already used");
        require(!earnBanned[to], "MoveToken: account banned");
        require(securityDeposit[to] >= MIN_DEPOSIT, "MoveToken: deposit required");

        // Verify oracle signature over (to, routeHash, distanceMeters)
        bytes32 message = keccak256(abi.encodePacked(to, routeHash, distanceMeters));
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(message);
        address recovered = ECDSA.recover(ethHash, oracleSig);
        require(recovered == trustedOracle, "MoveToken: invalid oracle sig");

        usedRoutes[routeHash] = true;

        uint256 effectiveRate = _currentRate();
        uint256 mult = gearMultiplier[to];
        if (mult == 0) mult = 1 ether;

        uint256 earned = (distanceMeters * effectiveRate * mult) / (1000 * 1 ether);

        // Enforce daily cap
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

        // Zone tax: 2% goes to zone owner if zone exists
        uint256 zoneTax = 0;
        if (zoneNFT != address(0)) {
            zoneTax = (earned * ZONE_TAX_BPS) / 10_000;
        }

        weeklyMint += earned;
        _mint(to, earned - zoneTax);
        if (zoneTax > 0) {
            _mint(zoneNFT, zoneTax); // ZoneNFT contract distributes to owner
        }

        emit MoveMinted(to, routeHash, distanceMeters, earned);
    }

    function burnMOVE(uint256 amount) external {
        weeklyBurn += amount;
        _burn(msg.sender, amount);
    }

    // Called by contracts that burn on behalf of users (challenge, zone mint)
    function burnFrom(address from, uint256 amount) public override {
        weeklyBurn += amount;
        super.burnFrom(from, amount);
    }

    function updateBaseRate(uint256 newRate) external onlyRole(GOVERNOR_ROLE) {
        emit BaseRateUpdated(baseRate, newRate);
        baseRate = newRate;
    }

    // Called weekly by SeasonController / Keeper
    function adjustEmissionRate() external onlyRole(SEASON_ROLE) {
        if (weeklyMint > 0) {
            uint256 ratioBps = (weeklyBurn * 10_000) / weeklyMint;
            // If burn/mint < 0.7 (7000 bps), reduce baseRate by 10%
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

    function updateOracle(address newOracle) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit OracleUpdated(trustedOracle, newOracle);
        trustedOracle = newOracle;
    }

    function _currentRate() internal view returns (uint256) {
        uint256 halvings = (block.number - deployBlock) / HALVING_INTERVAL;
        uint256 rate = baseRate;
        // Cap halvings to avoid underflow
        if (halvings > 20) halvings = 20;
        for (uint256 i = 0; i < halvings; i++) {
            rate = rate / 2;
        }
        return rate;
    }

    function _currentDailyCap() internal view returns (uint256) {
        uint256 halvings = (block.number - deployBlock) / HALVING_INTERVAL;
        uint256 cap = 200 ether;
        if (halvings > 20) halvings = 20;
        for (uint256 i = 0; i < halvings; i++) {
            cap = cap / 2;
        }
        return cap;
    }

    function currentRate() external view returns (uint256) {
        return _currentRate();
    }

    function currentDailyCap() external view returns (uint256) {
        return _currentDailyCap();
    }
}
