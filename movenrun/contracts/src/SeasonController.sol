// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./MoveToken.sol";
import "./ZoneNFT.sol";

contract SeasonController is AccessControl {
    using ECDSA for bytes32;

    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");

    uint256 public constant SEASON_DURATION = 90 days;
    uint256 public constant MINT_PAUSE_WINDOW = 14 days;
    uint256 public constant GREAT_BURN_PCT = 1_000; // 10% in bps

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

    function startSeason() external onlyRole(KEEPER_ROLE) {
        require(seasonStart == 0 || block.timestamp >= seasonEnd, "SeasonController: season active");
        seasonNumber++;
        seasonStart = block.timestamp;
        seasonEnd = block.timestamp + SEASON_DURATION;
        mintingPaused = false;
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

    // Called at season end with top-100 zones and their accumulated yields
    // Oracle provides sorted list and signatures to avoid off-chain trust issues
    function greatBurn(
        uint64[] calldata topHexIds,
        uint256[] calldata yields,
        bytes calldata oracleSig
    ) external onlyRole(KEEPER_ROLE) {
        require(topHexIds.length == yields.length, "SeasonController: length mismatch");
        require(topHexIds.length <= 100, "SeasonController: max 100 zones");

        // Oracle signs the entire call payload
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

            // Transfer burnAmount from zone owner to treasury
            // Owner must have pre-approved SeasonController
            moveToken.transferFrom(owner, daoTreasury, burnAmount);
            totalBurned += burnAmount;
        }

        // Adjust emission rate for the new season
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
