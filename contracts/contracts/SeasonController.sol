// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/// @notice Manages seasons, season-point leaderboards, and the soulbound
/// Reconquest achievement badge (non-transferable ERC-721).
contract SeasonController is ERC721, AccessControl {
    bytes32 public constant CONTROLLER_ROLE = keccak256("CONTROLLER_ROLE");

    // ── Season state ───────────────────────────────────────────────────────────

    struct Season {
        uint256 startTime;
        uint256 endTime;
        bool    active;
    }

    uint256 public currentSeason;
    mapping(uint256 => Season) public seasons;

    // player → season → points
    mapping(address => mapping(uint256 => uint256)) public seasonPoints;

    // ── Reconquest soulbound badge ─────────────────────────────────────────────

    uint256 private _badgeCounter;

    // badge tokenId → hexId where reconquest happened
    mapping(uint256 => uint64) public badgeHexId;

    // player → hexId → whether they hold a reconquest badge for that zone
    mapping(address => mapping(uint64 => bool)) public hasReconquest;

    // ── Events ─────────────────────────────────────────────────────────────────
    event SeasonStarted(uint256 indexed season, uint256 startTime);
    event SeasonEnded(uint256 indexed season, uint256 endTime);
    event PointsAwarded(address indexed player, uint256 indexed season, uint256 points);
    event ReconquestMinted(address indexed player, uint64 indexed hexId, uint256 tokenId);

    constructor() ERC721("ReconquestBadge", "RECONQUEST") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // ── Season management ──────────────────────────────────────────────────────

    function startSeason(uint256 seasonId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(!seasons[seasonId].active, "SC: already active");
        seasons[seasonId] = Season({
            startTime: block.timestamp,
            endTime:   0,
            active:    true
        });
        currentSeason = seasonId;
        emit SeasonStarted(seasonId, block.timestamp);
    }

    function endSeason(uint256 seasonId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(seasons[seasonId].active, "SC: not active");
        seasons[seasonId].active   = false;
        seasons[seasonId].endTime  = block.timestamp;
        emit SeasonEnded(seasonId, block.timestamp);
    }

    // ── Points ─────────────────────────────────────────────────────────────────

    function addPoints(address player, uint256 seasonId, uint256 points)
        external
        onlyRole(CONTROLLER_ROLE)
    {
        seasonPoints[player][seasonId] += points;
        emit PointsAwarded(player, seasonId, points);
    }

    // ── Called by ZoneChallenge after each resolved battle ────────────────────

    function onChallengeResolved(
        uint64  hexId,
        address winner,
        address loser,
        bool    isReconquest
    ) external onlyRole(CONTROLLER_ROLE) {
        uint256 season = currentSeason;

        // Award points for participation regardless of outcome
        seasonPoints[winner][season] += 10;
        seasonPoints[loser][season]  += 5;
        emit PointsAwarded(winner, season, 10);
        emit PointsAwarded(loser,  season, 5);

        // Award reconquest badge
        if (isReconquest && !hasReconquest[winner][hexId]) {
            _mintReconquest(winner, hexId);
        }
    }

    // ── Reconquest badge minting ───────────────────────────────────────────────

    function mintReconquest(address to, uint64 hexId) external onlyRole(CONTROLLER_ROLE) {
        require(!hasReconquest[to][hexId], "SC: already minted");
        _mintReconquest(to, hexId);
    }

    function _mintReconquest(address to, uint64 hexId) internal {
        uint256 tokenId   = ++_badgeCounter;
        badgeHexId[tokenId]      = hexId;
        hasReconquest[to][hexId] = true;
        _mint(to, tokenId);
        emit ReconquestMinted(to, hexId, tokenId);
    }

    // ── Soulbound: block all transfers ────────────────────────────────────────

    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        // Allow minting (from == 0) but not transfers or burns
        require(from == address(0), "SC: soulbound");
        return super._update(to, tokenId, auth);
    }

    // ── Interface support ──────────────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
