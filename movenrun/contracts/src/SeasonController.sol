// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./MoveToken.sol";
import "./ZoneNFT.sol";
import "./interfaces/IGPSOracle.sol";

contract SeasonController is AccessControl {
    using ECDSA for bytes32;

    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");

    uint256 public constant SEASON_DURATION    = 90 days;
    uint256 public constant MINT_PAUSE_WINDOW  = 14 days;
    uint256 public constant GREAT_BURN_PCT     = 1_000; // 10% in bps

    MoveToken public moveToken;
    ZoneNFT   public zoneNFT;
    address   public zoneChallenge;
    address   public gpsOracle;
    address   public daoTreasury;

    uint256 public seasonNumber;
    uint256 public seasonStart;
    uint256 public seasonEnd;
    bool    public mintingPaused;

    event SeasonStarted(uint256 indexed seasonNumber, uint256 start, uint256 end);
    event SeasonEnded(uint256 indexed seasonNumber);
    event MintingPaused(uint256 indexed seasonNumber);
    event GreatBurn(uint256 indexed season, uint256 totalBurned);

    constructor(address _moveToken, address _zoneNFT, address _zoneChallenge) {
        require(_moveToken != address(0) && _zoneNFT != address(0) && _zoneChallenge != address(0), // FIX-003
            "SeasonController: zero address");
        moveToken     = MoveToken(_moveToken);
        zoneNFT       = ZoneNFT(_zoneNFT);
        zoneChallenge = _zoneChallenge;
        daoTreasury   = msg.sender;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(KEEPER_ROLE, msg.sender);
    }

    function setGpsOracle(address _gpsOracle) external onlyRole(DEFAULT_ADMIN_ROLE) {
        gpsOracle = _gpsOracle;
    }

    function setDaoTreasury(address _treasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        daoTreasury = _treasury;
    }

    function startSeason() external onlyRole(KEEPER_ROLE) {
        require(seasonStart == 0 || block.timestamp >= seasonEnd, "SeasonController: season active");
        seasonNumber++;
        seasonStart    = block.timestamp;
        seasonEnd      = block.timestamp + SEASON_DURATION;
        mintingPaused  = false;
        emit SeasonStarted(seasonNumber, seasonStart, seasonEnd);
    }

    function pauseMinting() external onlyRole(KEEPER_ROLE) {
        require(block.timestamp >= seasonEnd - MINT_PAUSE_WINDOW, "SeasonController: too early to pause");
        mintingPaused = true;
        emit MintingPaused(seasonNumber);
    }

    function endSeason() external onlyRole(KEEPER_ROLE) {
        require(block.timestamp >= seasonEnd, "SeasonController: season not over");
        emit SeasonEnded(seasonNumber);
    }

    function greatBurn(
        uint64[] calldata topHexIds,
        uint256[] calldata yields,
        bytes calldata oracleSig
    ) external onlyRole(KEEPER_ROLE) {
        require(topHexIds.length == yields.length, "SeasonController: length mismatch");
        require(topHexIds.length <= 100, "SeasonController: max 100 zones");
        require(gpsOracle != address(0), "SeasonController: gpsOracle not set");

        address trustedSigner = IGPSOracle(gpsOracle).oracleOperator();
        bytes32 payload  = keccak256(abi.encode(block.chainid, seasonNumber, topHexIds, yields)); // FIX-001
        bytes32 ethHash  = MessageHashUtils.toEthSignedMessageHash(payload);
        require(ECDSA.recover(ethHash, oracleSig) == trustedSigner, "SeasonController: invalid sig");

        uint256 totalBurned = 0;

        for (uint256 i = 0; i < topHexIds.length; i++) {
            uint64  hexId  = topHexIds[i];
            uint256 yield  = yields[i];
            address owner  = zoneNFT.zoneOwner(hexId);
            if (owner == address(0)) continue;

            uint256 burnAmount = (yield * GREAT_BURN_PCT) / 10_000;
            if (burnAmount == 0) continue;

            // FIX-005: skip zones where owner lacks approval or balance; don't revert whole burn
            try moveToken.transferFrom(owner, daoTreasury, burnAmount) {
                totalBurned += burnAmount;
            } catch {}
        }

        moveToken.adjustEmissionRate();
        emit GreatBurn(seasonNumber, totalBurned);
    }

    function weeklyKeeperRun() external onlyRole(KEEPER_ROLE) {
        moveToken.adjustEmissionRate();
    }

    function isMintingAllowed() external view returns (bool) {
        return !mintingPaused;
    }
}
