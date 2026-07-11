// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/utils/Nonces.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IGearMultiplier.sol";

interface IZoneNFTYieldV2 {
    function creditZoneYield(uint64 hexId, uint256 amount) external;
}

/// MoveTokenV2 — $MOVE with snapshot voting (ERC20Votes, timestamp clock),
/// oracle-gated route minting, halving, 2% zone tax, and season-enforced
/// mint pausing. Gear multipliers are read live from GearNFTV2 at mint time;
/// there is no independently mutable per-user multiplier mapping (V1 defect).
contract MoveTokenV2 is ERC20, ERC20Permit, ERC20Votes, AccessControl {
    bytes32 public constant ORACLE_ROLE   = keccak256("ORACLE_ROLE");
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant SEASON_ROLE   = keccak256("SEASON_ROLE");

    uint256 public constant MAX_SUPPLY          = 1_000_000_000 ether;
    uint256 public constant HALVING_INTERVAL    = 2_600_000;
    uint256 public constant ZONE_TAX_BPS        = 200;        // 2%
    uint256 public constant MIN_BASE_RATE       = 0.01 ether;
    uint256 public constant MAX_DISTANCE_METERS = 100_000;    // 100 km per route
    // Gear multiplier bounds accepted from GearNFTV2 (1e18 = 1.0x).
    uint256 public constant MIN_GEAR_MULTIPLIER = 1 ether;
    uint256 public constant MAX_GEAR_MULTIPLIER = 3 ether;

    address public zoneNFT;
    IGearMultiplier public gearNFT;

    uint256 public baseRate = 10 ether;
    uint256 public deployBlock;

    bool public mintingPaused;

    uint256 public weeklyMint;
    uint256 public weeklyBurn;
    uint256 public weeklyMoverCount;

    struct DailyCap {
        uint256 minted;
        uint256 resetAt;
    }
    mapping(address => DailyCap) public dailyCaps;
    mapping(bytes32 => bool)     public usedRoutes;
    mapping(address => uint256)  public lastMintEpoch;

    event MoveMinted(address indexed to, bytes32 indexed routeHash, uint256 distanceMeters, uint256 earned);
    event BaseRateUpdated(uint256 oldRate, uint256 newRate);
    event WeeklyStatsReset(uint256 weeklyMint, uint256 weeklyBurn);
    event MintingPausedSet(bool paused);
    event ZoneNFTSet(address zoneNFT);
    event GearNFTSet(address gearNFT);

    constructor(address initialAdmin)
        ERC20("MoveToken", "$MOVE")
        ERC20Permit("MoveToken")
    {
        require(initialAdmin != address(0), "MoveTokenV2: zero admin");
        deployBlock = block.number;
        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
        _grantRole(GOVERNOR_ROLE, initialAdmin);
    }

    // ── Timestamp-based voting clock (ERC-6372) ─────────────────────────────

    function clock() public view override returns (uint48) {
        return uint48(block.timestamp);
    }

    // solhint-disable-next-line func-name-mixedcase
    function CLOCK_MODE() public pure override returns (string memory) {
        return "mode=timestamp";
    }

    // ── Wiring (admin) ──────────────────────────────────────────────────────

    function setZoneNFT(address _zoneNFT) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_zoneNFT != address(0), "MoveTokenV2: zero zoneNFT");
        zoneNFT = _zoneNFT;
        emit ZoneNFTSet(_zoneNFT);
    }

    function setGearNFT(address _gearNFT) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_gearNFT != address(0), "MoveTokenV2: zero gearNFT");
        gearNFT = IGearMultiplier(_gearNFT);
        emit GearNFTSet(_gearNFT);
    }

    // ── Season pause enforcement ────────────────────────────────────────────

    /// Direct enforcement of the season mint pause: while paused, mintMOVE
    /// reverts. Callable only by SEASON_ROLE (SeasonControllerV2).
    function setMintingPaused(bool paused) external onlyRole(SEASON_ROLE) {
        mintingPaused = paused;
        emit MintingPausedSet(paused);
    }

    // ── Route minting (via GPSOracleV2, which holds ORACLE_ROLE) ────────────

    // hexId = H3 zone the runner is in (0 if not in any zone).
    function mintMOVE(
        address to,
        bytes32 routeHash,
        uint256 distanceMeters,
        uint64  hexId
    ) external onlyRole(ORACLE_ROLE) {
        require(!mintingPaused, "MoveTokenV2: minting paused");
        require(!usedRoutes[routeHash], "MoveTokenV2: route already used");
        require(distanceMeters <= MAX_DISTANCE_METERS, "MoveTokenV2: distance too large");

        usedRoutes[routeHash] = true;

        uint256 effectiveRate = _currentRate();
        uint256 mult = _gearMultiplier(to);

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
        require(earned > 0, "MoveTokenV2: daily cap reached");
        cap.minted += earned;

        require(totalSupply() + earned <= MAX_SUPPLY, "MoveTokenV2: max supply exceeded");

        uint256 epoch = block.timestamp / 7 days;
        if (lastMintEpoch[to] < epoch) {
            lastMintEpoch[to] = epoch;
            weeklyMoverCount++;
        }

        // Zone tax credited via pull-payment; only when runner is in a minted zone.
        uint256 zoneTax = 0;
        if (hexId != 0 && zoneNFT != address(0)) {
            uint256 potentialTax = (earned * ZONE_TAX_BPS) / 10_000;
            if (potentialTax > 0) {
                try IZoneNFTYieldV2(zoneNFT).creditZoneYield(hexId, potentialTax) {
                    zoneTax = potentialTax;
                } catch {}
            }
        }

        weeklyMint += earned;
        _mint(to, earned - zoneTax);
        if (zoneTax > 0) {
            _mint(zoneNFT, zoneTax);
        }

        emit MoveMinted(to, routeHash, distanceMeters, earned);
    }

    /// Gear multiplier is read live from GearNFTV2 (single source of truth).
    /// The value is clamped to [1x, 3x] so a misbehaving gear contract can
    /// never zero out or inflate emissions.
    function _gearMultiplier(address user) internal view returns (uint256) {
        if (address(gearNFT) == address(0)) return 1 ether;
        try gearNFT.getUserMultiplier(user) returns (uint256 mult) {
            if (mult < MIN_GEAR_MULTIPLIER) return MIN_GEAR_MULTIPLIER;
            if (mult > MAX_GEAR_MULTIPLIER) return MAX_GEAR_MULTIPLIER;
            return mult;
        } catch {
            return 1 ether;
        }
    }

    // ── Burning ─────────────────────────────────────────────────────────────

    function burnMOVE(uint256 amount) external {
        weeklyBurn += amount;
        _burn(msg.sender, amount);
    }

    function burnFrom(address from, uint256 amount) public {
        _spendAllowance(from, msg.sender, amount);
        weeklyBurn += amount;
        _burn(from, amount);
    }

    // ── Emission control ────────────────────────────────────────────────────

    function updateBaseRate(uint256 newRate) external onlyRole(GOVERNOR_ROLE) {
        emit BaseRateUpdated(baseRate, newRate);
        baseRate = newRate;
    }

    function adjustEmissionRate() external onlyRole(SEASON_ROLE) {
        if (weeklyMint > 0) {
            uint256 ratioBps = (weeklyBurn * 10_000) / weeklyMint;
            if (ratioBps < 7_000) {
                uint256 oldRate = baseRate;
                baseRate = (baseRate * 9_000) / 10_000;
                if (baseRate < MIN_BASE_RATE) baseRate = MIN_BASE_RATE;
                emit BaseRateUpdated(oldRate, baseRate);
            }
        }
        emit WeeklyStatsReset(weeklyMint, weeklyBurn);
        weeklyMint = 0;
        weeklyBurn = 0;
        weeklyMoverCount = 0;
    }

    function resetWeeklyStats() external onlyRole(SEASON_ROLE) {
        emit WeeklyStatsReset(weeklyMint, weeklyBurn);
        weeklyMint = 0;
        weeklyBurn = 0;
        weeklyMoverCount = 0;
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

    // ── Required OZ multiple-inheritance overrides ──────────────────────────

    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Votes)
    {
        super._update(from, to, value);
    }

    function nonces(address owner)
        public
        view
        override(ERC20Permit, Nonces)
        returns (uint256)
    {
        return super.nonces(owner);
    }
}
