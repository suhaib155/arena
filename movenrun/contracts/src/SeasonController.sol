// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./MoveToken.sol";
import "./ZoneNFT.sol";

/// @title SeasonController — 90-day season lifecycle and Great Burn for MovenRun
/// @notice Manages season transitions, minting pauses, and the end-of-season Great Burn
///         where the top 100 zones by accumulated yield contribute 10% to the DAO treasury.
///         Integrates with Chainlink Keepers via KEEPER_ROLE for fully automated operation.
contract SeasonController is AccessControl {
    using ECDSA for bytes32;

    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");

    uint256 public constant SEASON_DURATION    = 90 days;
    uint256 public constant MINT_PAUSE_WINDOW  = 14 days;
    uint256 public constant GREAT_BURN_PCT     = 1_000; // 10% in bps

    MoveToken public moveToken;
    ZoneNFT   public zoneNFT;
    address   public trustedOracle;
    address   public daoTreasury;

    uint256 public seasonNumber;
    uint256 public seasonStart;
    uint256 public seasonEnd;
    bool    public mintingPaused;

    event SeasonStarted(uint256 indexed seasonNumber, uint256 start, uint256 end);
    event SeasonEnded(uint256 indexed seasonNumber);
    event MintingPaused(uint256 indexed seasonNumber);
    event GreatBurn(uint256 indexed season, uint256 totalBurned);

    constructor(
        address _moveToken,
        address _zoneNFT,
        address _oracle,
        address _treasury,
        address admin
    ) {
        moveToken = MoveToken(_moveToken);
        zoneNFT = ZoneNFT(_zoneNFT);
        trustedOracle = _oracle;
        daoTreasury = _treasury;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(KEEPER_ROLE, admin);
    }

    /// @notice Begin a new 90-day season. Callable only when no season is active.
    function startSeason() external onlyRole(KEEPER_ROLE) {
        require(seasonStart == 0 || block.timestamp >= seasonEnd, "SeasonController: season active");
        seasonNumber++;
        seasonStart = block.timestamp;
        seasonEnd = block.timestamp + SEASON_DURATION;
        mintingPaused = false;
        emit SeasonStarted(seasonNumber, seasonStart, seasonEnd);
    }

    /// @notice Pause new $MOVE minting during the final 14 days of a season.
    ///         This gives the protocol time to prepare for the Great Burn.
    function pauseMinting() external onlyRole(KEEPER_ROLE) {
        require(block.timestamp >= seasonEnd - MINT_PAUSE_WINDOW, "SeasonController: too early to pause");
        mintingPaused = true;
        emit MintingPaused(seasonNumber);
    }

    /// @notice Mark the current season as ended. Called by Keeper after seasonEnd.
    function endSeason() external onlyRole(KEEPER_ROLE) {
        require(block.timestamp >= seasonEnd, "SeasonController: season not over");
        emit SeasonEnded(seasonNumber);
    }

    /// @notice Execute the Great Burn for the top-100 zones of the season.
    ///         10% of each zone's accumulated yield is transferred to the DAO treasury.
    ///         The oracle signs the entire payload to prevent manipulation of the zone list.
    ///         Zone owners must have pre-approved this contract for the burn amount.
    ///         Zones whose owners have not approved are skipped (not DoS-able by a single owner).
    ///         The loop is capped at 100 entries to bound gas usage (~100 × ~30k gas = ~3M).
    /// @param topHexIds  Ordered list of up to 100 hex IDs (highest yield first)
    /// @param yields     Accumulated yield for each hex (parallel array)
    /// @param oracleSig  Oracle signature over keccak256(abi.encode(seasonNumber, topHexIds, yields))
    function greatBurn(
        uint64[] calldata topHexIds,
        uint256[] calldata yields,
        bytes calldata oracleSig
    ) external onlyRole(KEEPER_ROLE) {
        require(topHexIds.length == yields.length, "SeasonController: length mismatch");
        require(topHexIds.length <= 100, "SeasonController: max 100 zones");

        bytes32 payload = keccak256(abi.encode(seasonNumber, topHexIds, yields));
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(payload);
        require(ECDSA.recover(ethHash, oracleSig) == trustedOracle, "SeasonController: invalid sig");

        uint256 totalBurned = 0;

        for (uint256 i = 0; i < topHexIds.length; i++) {
            uint64 hexId = topHexIds[i];
            uint256 yield = yields[i];
            address owner = zoneNFT.zoneOwner(hexId);
            if (owner == address(0)) continue;

            uint256 burnAmount = (yield * GREAT_BURN_PCT) / 10_000;
            if (burnAmount == 0) continue;

            // Skip zones whose owners have not approved; one missing approval must not
            // block the entire season-end transaction (DoS resistance).
            try moveToken.transferFrom(owner, daoTreasury, burnAmount) {
                totalBurned += burnAmount;
            } catch {
                // Owner did not pre-approve; their allocation is skipped this season
            }
        }

        moveToken.adjustEmissionRate();

        emit GreatBurn(seasonNumber, totalBurned);
    }

    /// @notice Run the weekly emission-rate adjustment. Called by Keeper every 7 days.
    function weeklyKeeperRun() external onlyRole(KEEPER_ROLE) {
        moveToken.adjustEmissionRate();
    }

    /// @notice Returns whether new $MOVE minting is currently permitted.
    function isMintingAllowed() external view returns (bool) {
        return !mintingPaused;
    }
}
