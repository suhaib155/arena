// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "./MoveTokenV2.sol";
import "./ZoneNFTV2.sol";
import "../interfaces/IGPSOracle.sol";

/// SeasonControllerV2 — 90-day seasons with directly enforced mint pausing
/// and a real Great Burn.
///
/// Season pause semantics (V2 rule): pausing minting pauses BOTH
/// route-based $MOVE minting (MoveTokenV2.mintMOVE) and Zone Deed minting
/// (ZoneNFTV2.mintZone). This contract holds SEASON_ROLE on both and flips
/// their mintingPaused flags directly — there is no reporting-only boolean.
///
/// Great Burn (V2): burnAmount = yield * GREAT_BURN_BPS / 10_000 is BURNED
/// from each top-zone owner via MoveTokenV2.burnFrom (requires the owner's
/// allowance to this contract). totalSupply decreases by the burned total;
/// the treasury never receives burn proceeds (V1 sent them to the treasury).
/// Zones whose owner lacks allowance/balance are skipped and reported in
/// GreatBurnSkipped — skipped amounts are never claimed as burned.
contract SeasonControllerV2 is AccessControl, EIP712 {
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");

    string public constant SIGNING_DOMAIN_NAME    = "MovenRun";
    string public constant SIGNING_DOMAIN_VERSION = "2";

    bytes32 public constant GREAT_BURN_TYPEHASH = keccak256(
        "GreatBurn(uint256 seasonNumber,uint64[] topHexIds,uint256[] yields,uint256 deadline)"
    );

    uint256 public constant SEASON_DURATION   = 90 days;
    uint256 public constant MINT_PAUSE_WINDOW = 14 days;
    uint256 public constant GREAT_BURN_BPS    = 1_000; // 10%
    uint256 public constant MAX_BURN_ZONES    = 100;

    MoveTokenV2 public moveToken;
    ZoneNFTV2   public zoneNFT;
    address     public zoneChallenge;
    address     public gpsOracle;
    /// DAO treasury address (operational reference only — the Great Burn
    /// destroys tokens and NEVER transfers anything to this address).
    address     public daoTreasury;

    uint256 public seasonNumber;
    uint256 public seasonStart;
    uint256 public seasonEnd;

    /// season → Great Burn already executed (one per season, no replay).
    mapping(uint256 => bool) public greatBurnExecuted;
    /// season → hexId → already processed within that season's Great Burn
    /// (deduplicates repeated hexes in the input deterministically).
    mapping(uint256 => mapping(uint64 => bool)) public greatBurnProcessed;

    event SeasonStarted(uint256 indexed seasonNumber, uint256 start, uint256 end);
    event SeasonEnded(uint256 indexed seasonNumber);
    event MintingPaused(uint256 indexed seasonNumber);
    event MintingUnpaused(uint256 indexed seasonNumber);
    event GreatBurn(uint256 indexed season, uint256 totalBurned);
    event GreatBurnSkipped(uint256 indexed season, uint256 skippedAmount, uint256 skippedZoneCount);

    constructor(address _moveToken, address _zoneNFT, address _zoneChallenge)
        EIP712(SIGNING_DOMAIN_NAME, SIGNING_DOMAIN_VERSION)
    {
        require(_moveToken != address(0) && _zoneNFT != address(0) && _zoneChallenge != address(0),
            "SeasonControllerV2: zero address");
        moveToken     = MoveTokenV2(_moveToken);
        zoneNFT       = ZoneNFTV2(_zoneNFT);
        zoneChallenge = _zoneChallenge;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(KEEPER_ROLE, msg.sender);
    }

    function setGpsOracle(address _gpsOracle) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_gpsOracle != address(0), "SeasonControllerV2: zero oracle");
        gpsOracle = _gpsOracle;
    }

    function setDaoTreasury(address _treasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_treasury != address(0), "SeasonControllerV2: zero treasury");
        daoTreasury = _treasury;
    }

    // ── Season lifecycle ────────────────────────────────────────────────────

    /// Starts a season and unpauses BOTH mint paths.
    function startSeason() external onlyRole(KEEPER_ROLE) {
        require(seasonStart == 0 || block.timestamp >= seasonEnd, "SeasonControllerV2: season active");
        seasonNumber++;
        seasonStart = block.timestamp;
        seasonEnd   = block.timestamp + SEASON_DURATION;
        moveToken.setMintingPaused(false);
        zoneNFT.setMintingPaused(false);
        emit SeasonStarted(seasonNumber, seasonStart, seasonEnd);
    }

    /// Pauses BOTH route-based $MOVE minting and Zone Deed minting.
    /// Allowed only inside the final MINT_PAUSE_WINDOW of the season.
    function pauseMinting() external onlyRole(KEEPER_ROLE) {
        require(seasonStart != 0, "SeasonControllerV2: no season");
        require(block.timestamp >= seasonEnd - MINT_PAUSE_WINDOW, "SeasonControllerV2: too early to pause");
        moveToken.setMintingPaused(true);
        zoneNFT.setMintingPaused(true);
        emit MintingPaused(seasonNumber);
    }

    function endSeason() external onlyRole(KEEPER_ROLE) {
        require(seasonStart != 0, "SeasonControllerV2: no season");
        require(block.timestamp >= seasonEnd, "SeasonControllerV2: season not over");
        emit SeasonEnded(seasonNumber);
    }

    function isMintingAllowed() external view returns (bool) {
        return !moveToken.mintingPaused();
    }

    // ── Great Burn ──────────────────────────────────────────────────────────

    /// Burns GREAT_BURN_BPS (10%) of each top zone's seasonal yield from the
    /// zone owner's balance. Requirements enforced here:
    /// - only after the season has ended,
    /// - exactly once per season (greatBurnExecuted),
    /// - EIP-712 signature binds seasonNumber, the exact hex/yield arrays,
    ///   and a deadline, over this contract's domain,
    /// - duplicate hexes in the input are skipped deterministically,
    /// - unminted zones and zero-yield entries are skipped,
    /// - owners without sufficient allowance/balance are skipped; the
    ///   skipped totals are emitted, never claimed as burned.
    function greatBurn(
        uint64[] calldata topHexIds,
        uint256[] calldata yields,
        uint256 deadline,
        bytes calldata oracleSig
    ) external onlyRole(KEEPER_ROLE) {
        require(seasonStart != 0, "SeasonControllerV2: no season");
        require(block.timestamp >= seasonEnd, "SeasonControllerV2: season not over");
        require(!greatBurnExecuted[seasonNumber], "SeasonControllerV2: already executed");
        require(topHexIds.length == yields.length, "SeasonControllerV2: length mismatch");
        require(topHexIds.length <= MAX_BURN_ZONES, "SeasonControllerV2: max zones exceeded");
        require(gpsOracle != address(0), "SeasonControllerV2: gpsOracle not set");
        require(block.timestamp <= deadline, "SeasonControllerV2: signature expired");

        _verifyGreatBurnSig(topHexIds, yields, deadline, oracleSig);

        greatBurnExecuted[seasonNumber] = true;

        uint256 totalBurned = 0;
        uint256 skippedAmount = 0;
        uint256 skippedZones = 0;

        for (uint256 i = 0; i < topHexIds.length; i++) {
            uint64  hexId = topHexIds[i];
            uint256 burnAmount = (yields[i] * GREAT_BURN_BPS) / 10_000;

            if (greatBurnProcessed[seasonNumber][hexId]) {
                skippedZones++;
                continue;
            }
            greatBurnProcessed[seasonNumber][hexId] = true;

            address owner = zoneNFT.zoneOwner(hexId);
            if (owner == address(0) || burnAmount == 0) {
                skippedZones++;
                continue;
            }

            // burnFrom reverts on insufficient allowance/balance — skip that
            // zone rather than reverting the whole burn, and report it.
            try moveToken.burnFrom(owner, burnAmount) {
                totalBurned += burnAmount;
            } catch {
                skippedAmount += burnAmount;
                skippedZones++;
            }
        }

        moveToken.adjustEmissionRate();

        emit GreatBurn(seasonNumber, totalBurned);
        if (skippedAmount > 0 || skippedZones > 0) {
            emit GreatBurnSkipped(seasonNumber, skippedAmount, skippedZones);
        }
    }

    function _verifyGreatBurnSig(
        uint64[] calldata topHexIds,
        uint256[] calldata yields,
        uint256 deadline,
        bytes calldata oracleSig
    ) internal view {
        bytes32 structHash = keccak256(abi.encode(
            GREAT_BURN_TYPEHASH,
            seasonNumber,
            keccak256(abi.encodePacked(topHexIds)),
            keccak256(abi.encodePacked(yields)),
            deadline
        ));
        bytes32 digest = _hashTypedDataV4(structHash);
        require(
            ECDSA.recover(digest, oracleSig) == IGPSOracle(gpsOracle).oracleOperator(),
            "SeasonControllerV2: invalid sig"
        );
    }

    function weeklyKeeperRun() external onlyRole(KEEPER_ROLE) {
        moveToken.adjustEmissionRate();
    }

    /// Exposed for off-chain signers/tests to cross-check domain separators.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
