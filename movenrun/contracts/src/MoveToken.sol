// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title MoveToken — ERC-20 $MOVE token for MovenRun
/// @notice 1 billion max supply. Minting requires a Chainlink-oracle-signed GPS route proof.
///         Emission halves every HALVING_INTERVAL blocks. A 2% zone tax is routed to the
///         ZoneNFT contract when a minted route passes through a claimed zone.
contract MoveToken is ERC20, AccessControl {
    using ECDSA for bytes32;

    bytes32 public constant MINTER_ROLE   = keccak256("MINTER_ROLE");
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant SEASON_ROLE   = keccak256("SEASON_ROLE");

    uint256 public constant MAX_SUPPLY       = 1_000_000_000 ether;
    uint256 public constant HALVING_INTERVAL = 2_600_000;
    uint256 public constant ZONE_TAX_BPS     = 200; // 2%

    address public trustedOracle;
    address public zoneNFT;

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

    event MoveMinted(address indexed to, bytes32 indexed routeHash, uint256 distanceMeters, uint256 earned);
    event BaseRateUpdated(uint256 oldRate, uint256 newRate);
    event OracleUpdated(address oldOracle, address newOracle);
    event WeeklyStatsReset(uint256 weeklyMint, uint256 weeklyBurn);

    constructor(address _trustedOracle, address admin) ERC20("MoveToken", "$MOVE") {
        trustedOracle = _trustedOracle;
        deployBlock = block.number;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GOVERNOR_ROLE, admin);
    }

    /// @notice Set the ZoneNFT contract address for zone tax routing. Admin only.
    /// @param _zoneNFT Address of the deployed ZoneNFT contract
    function setZoneNFT(address _zoneNFT) external onlyRole(DEFAULT_ADMIN_ROLE) {
        zoneNFT = _zoneNFT;
    }

    /// @notice Set a user's gear multiplier (1e18 = 1.0×, max 3e18 = 3.0×).
    ///         Called by GearNFT when a user equips gear.
    /// @param user       Wallet address
    /// @param multiplier Multiplier expressed as 1e18 = 1.0×
    function setGearMultiplier(address user, uint256 multiplier) external onlyRole(MINTER_ROLE) {
        require(multiplier >= 1 ether && multiplier <= 3 ether, "MoveToken: multiplier out of range");
        gearMultiplier[user] = multiplier;
    }

    /// @notice Mint $MOVE for a completed GPS route. Requires a valid oracle signature.
    ///         Routes may only be submitted once (replay protection via routeHash).
    ///         Enforces per-address daily cap and global max supply.
    ///         2% of earned tokens are minted to the ZoneNFT contract as zone tax.
    /// @param to             Recipient wallet address
    /// @param routeHash      SHA-256 hash of the route payload (built by backend)
    /// @param oracleSig      Oracle signature over keccak256(to, routeHash, distanceMeters)
    /// @param distanceMeters Total route distance in metres
    function mintMOVE(
        address to,
        bytes32 routeHash,
        bytes calldata oracleSig,
        uint256 distanceMeters
    ) external {
        require(!usedRoutes[routeHash], "MoveToken: route already used");

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

    /// @notice Burn $MOVE from the caller's balance.
    /// @param amount Amount of $MOVE to burn
    function burnMOVE(uint256 amount) external {
        weeklyBurn += amount;
        _burn(msg.sender, amount);
    }

    /// @notice Burn $MOVE from `from`'s balance on behalf of the caller (requires allowance).
    ///         Used by ZoneNFT (mint), ZoneChallenge (stronghold/extension), etc.
    function burnFrom(address from, uint256 amount) public {
        _spendAllowance(from, msg.sender, amount);
        weeklyBurn += amount;
        _burn(from, amount);
    }

    /// @notice Update the base emission rate. Restricted to GOVERNOR_ROLE.
    /// @param newRate New base rate in $MOVE wei per km
    function updateBaseRate(uint256 newRate) external onlyRole(GOVERNOR_ROLE) {
        emit BaseRateUpdated(baseRate, newRate);
        baseRate = newRate;
    }

    /// @notice Adjust the emission rate downward by 10% if the weekly burn/mint ratio < 0.7.
    ///         Called weekly by SeasonController / Keeper (SEASON_ROLE).
    function adjustEmissionRate() external onlyRole(SEASON_ROLE) {
        if (weeklyMint > 0) {
            uint256 ratioBps = (weeklyBurn * 10_000) / weeklyMint;
            if (ratioBps < 7_000) {
                uint256 newRate = (baseRate * 9_000) / 10_000;
                emit BaseRateUpdated(baseRate, newRate);
                baseRate = newRate;
            }
        }
        emit WeeklyStatsReset(weeklyMint, weeklyBurn);
        weeklyMint = 0;
        weeklyBurn = 0;
    }

    /// @notice Reset weekly mint/burn counters without rate adjustment. SEASON_ROLE only.
    function resetWeeklyStats() external onlyRole(SEASON_ROLE) {
        emit WeeklyStatsReset(weeklyMint, weeklyBurn);
        weeklyMint = 0;
        weeklyBurn = 0;
    }

    /// @notice Update the trusted oracle address. Admin only.
    /// @param newOracle New oracle signer address
    function updateOracle(address newOracle) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit OracleUpdated(trustedOracle, newOracle);
        trustedOracle = newOracle;
    }

    /// @notice Returns the current effective mint rate in $MOVE wei per km, after halvings.
    function currentRate() external view returns (uint256) {
        return _currentRate();
    }

    /// @notice Returns the current per-address daily mint cap in $MOVE wei, after halvings.
    function currentDailyCap() external view returns (uint256) {
        return _currentDailyCap();
    }

    function _currentRate() internal view returns (uint256) {
        uint256 halvings = (block.number - deployBlock) / HALVING_INTERVAL;
        uint256 rate = baseRate;
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
}
