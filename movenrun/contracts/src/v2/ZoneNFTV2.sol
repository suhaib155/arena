// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "./MoveTokenV2.sol";
import "../interfaces/IGPSOracle.sol";

/// ZoneNFTV2 — Zone Deed ERC-721.
///
/// V2 deed-instance rules (see docs/CONTRACT_V2_DESIGN.md):
/// - Accumulated yield follows the deed while it exists (transfer keeps it).
/// - Loyalty is deed-instance age (ownershipStart is set at mint and NOT
///   reset on transfer), not owner-specific age.
/// - Reclaim destroys the deed instance and resets ALL per-deed state, so a
///   reminted hex can never inherit previous yield, loyalty, activity,
///   dormancy, or challenge locks.
///
/// Challenge settlement: ZoneChallengeV2 (CHALLENGE_ROLE) locks a deed for
/// the duration of a challenge (owner transfers and approvals cannot move a
/// locked deed) and settles a challenger win through
/// resolveChallengeTransfer, which does not require any approval from the
/// defender, verifies the expected current owner, operates only on the
/// locked deed, transfers exactly that token, and clears the lock.
contract ZoneNFTV2 is ERC721, AccessControl, EIP712 {
    bytes32 public constant ZONE_ADMIN_ROLE = keccak256("ZONE_ADMIN_ROLE");
    bytes32 public constant CHALLENGE_ROLE  = keccak256("CHALLENGE_ROLE");
    bytes32 public constant SEASON_ROLE     = keccak256("SEASON_ROLE");

    string public constant SIGNING_DOMAIN_NAME    = "MovenRun";
    string public constant SIGNING_DOMAIN_VERSION = "2";

    bytes32 public constant ZONE_MINT_TYPEHASH = keccak256(
        "ZoneMint(uint64 hexId,address minter,uint256 mintCost,uint256 nonce,uint256 deadline)"
    );

    uint256 public constant BASE_MINT_COST   = 500 ether;
    uint256 public constant LOYALTY_TIER2    = 90 days;
    uint256 public constant LOYALTY_TIER3    = 180 days;
    uint256 public constant LOYALTY_TIER4    = 365 days;
    uint256 public constant DORMANCY_PERIOD  = 180 days;
    uint256 public constant RECLAIM_PERIOD   = 210 days;

    MoveTokenV2 public moveToken;
    address     public gpsOracle;

    mapping(uint64 => uint256) public ownershipStart;   // deed-instance age (loyalty)
    mapping(uint64 => uint256) public lastActivity;
    mapping(uint64 => uint256) public accumulatedYield;
    mapping(uint64 => bool)    public isDormant;
    mapping(uint64 => bool)    public challengeLocked;
    /// Per-minter nonce consumed by mintZone signatures.
    mapping(address => uint256) public mintNonces;

    bool public mintingPaused;

    event ZoneMinted(uint64 indexed hexId, address indexed owner, uint256 mintCost);
    event ZoneYieldCredited(uint64 indexed hexId, address indexed owner, uint256 amount);
    event ZoneDormant(uint64 indexed hexId);
    event ZoneReclaimed(uint64 indexed hexId);
    event YieldWithdrawn(uint64 indexed hexId, address indexed owner, uint256 amount);
    event ChallengeLockSet(uint64 indexed hexId, bool locked);
    event ChallengeTransferResolved(uint64 indexed hexId, address indexed from, address indexed to);
    event MintingPausedSet(bool paused);

    constructor(address _moveToken, address _gpsOracle)
        ERC721("MovenRun Zone V2", "ZONE2")
        EIP712(SIGNING_DOMAIN_NAME, SIGNING_DOMAIN_VERSION)
    {
        require(_moveToken != address(0) && _gpsOracle != address(0), "ZoneNFTV2: zero address");
        moveToken = MoveTokenV2(_moveToken);
        gpsOracle = _gpsOracle;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ZONE_ADMIN_ROLE, msg.sender);
    }

    // ── Season pause enforcement ────────────────────────────────────────────

    /// Direct enforcement: while paused, mintZone reverts.
    /// Callable only by SEASON_ROLE (SeasonControllerV2).
    function setMintingPaused(bool paused) external onlyRole(SEASON_ROLE) {
        mintingPaused = paused;
        emit MintingPausedSet(paused);
    }

    // ── Yield ───────────────────────────────────────────────────────────────

    function creditZoneYield(uint64 hexId, uint256 amount) external {
        require(msg.sender == address(moveToken), "ZoneNFTV2: only MoveToken");
        require(_ownerOf(uint256(hexId)) != address(0), "ZoneNFTV2: zone not minted");
        accumulatedYield[hexId] += amount;
        lastActivity[hexId] = block.timestamp;
        emit ZoneYieldCredited(hexId, _ownerOf(uint256(hexId)), amount);
    }

    // ── Minting (EIP-712 oracle signature) ──────────────────────────────────

    /// ZoneMint(hexId, minter, mintCost, nonce, deadline) signed by the
    /// oracle operator over this contract's EIP-712 domain. The nonce is the
    /// minter's current mintNonces value and is consumed on success, so a
    /// signature can never be replayed.
    function mintZone(
        uint64 hexId,
        uint256 mintCost,
        uint256 deadline,
        bytes calldata oracleSig
    ) external {
        require(!mintingPaused, "ZoneNFTV2: minting paused");
        require(_ownerOf(uint256(hexId)) == address(0), "ZoneNFTV2: already minted");
        require(!isDormant[hexId], "ZoneNFTV2: hex in reclaim state");
        require(block.timestamp <= deadline, "ZoneNFTV2: signature expired");

        uint256 nonce = mintNonces[msg.sender];
        bytes32 structHash = keccak256(abi.encode(
            ZONE_MINT_TYPEHASH,
            hexId,
            msg.sender,
            mintCost,
            nonce,
            deadline
        ));
        bytes32 digest = _hashTypedDataV4(structHash);
        address trustedSigner = IGPSOracle(gpsOracle).oracleOperator();
        require(ECDSA.recover(digest, oracleSig) == trustedSigner, "ZoneNFTV2: invalid oracle sig");

        // Effects before external interaction (burnFrom).
        mintNonces[msg.sender] = nonce + 1;
        ownershipStart[hexId] = block.timestamp;
        lastActivity[hexId] = block.timestamp;
        _mint(msg.sender, uint256(hexId));

        moveToken.burnFrom(msg.sender, mintCost);

        emit ZoneMinted(hexId, msg.sender, mintCost);
    }

    // ── Loyalty (deed-instance age) ─────────────────────────────────────────

    function getLoyaltyMultiplier(uint64 hexId) external view returns (uint256) {
        uint256 start = ownershipStart[hexId];
        if (start == 0) return 100;
        uint256 elapsed = block.timestamp - start;
        if (elapsed >= LOYALTY_TIER4) return 175;
        if (elapsed >= LOYALTY_TIER3) return 150;
        if (elapsed >= LOYALTY_TIER2) return 125;
        return 100;
    }

    // ── Dormancy / reclaim ──────────────────────────────────────────────────

    function markDormant(uint64 hexId) external {
        require(_ownerOf(uint256(hexId)) != address(0), "ZoneNFTV2: not minted");
        require(block.timestamp - lastActivity[hexId] > DORMANCY_PERIOD, "ZoneNFTV2: not dormant yet");
        isDormant[hexId] = true;
        emit ZoneDormant(hexId);
    }

    /// Destroys the deed instance and clears ALL per-deed state so nothing
    /// leaks into a future deed for the same hex (V1 leaked lastActivity and
    /// accumulatedYield). A challenge-locked deed cannot be reclaimed — the
    /// active challenge must settle first.
    function reclaimDormant(uint64 hexId) external {
        require(isDormant[hexId], "ZoneNFTV2: not dormant");
        require(!challengeLocked[hexId], "ZoneNFTV2: challenge active");
        require(block.timestamp - lastActivity[hexId] > RECLAIM_PERIOD, "ZoneNFTV2: reclaim period not elapsed");
        _burn(uint256(hexId));
        delete ownershipStart[hexId];
        delete lastActivity[hexId];
        delete accumulatedYield[hexId];
        delete isDormant[hexId];
        delete challengeLocked[hexId];
        emit ZoneReclaimed(hexId);
    }

    // ── Yield withdrawal ────────────────────────────────────────────────────

    function withdrawYield(uint64 hexId) external {
        require(ownerOf(uint256(hexId)) == msg.sender, "ZoneNFTV2: not owner");
        uint256 amount = accumulatedYield[hexId];
        require(amount > 0, "ZoneNFTV2: no yield");
        accumulatedYield[hexId] = 0;
        moveToken.transfer(msg.sender, amount);
        emit YieldWithdrawn(hexId, msg.sender, amount);
    }

    // ── Challenge lock + settlement (CHALLENGE_ROLE = ZoneChallengeV2) ──────

    /// Lock/unlock a deed for an active challenge. While locked, no transfer
    /// of the deed is possible (owner transfers, approvals, operators — all
    /// blocked in _update). Only the challenge contract may toggle this.
    function setChallengeLock(uint64 hexId, bool locked) external onlyRole(CHALLENGE_ROLE) {
        require(_ownerOf(uint256(hexId)) != address(0), "ZoneNFTV2: not minted");
        challengeLocked[hexId] = locked;
        emit ChallengeLockSet(hexId, locked);
    }

    /// Settle a challenger win. Narrowly authorized: only CHALLENGE_ROLE,
    /// only a challenge-locked deed, only if the current owner still equals
    /// the expected owner recorded at declaration, and transfers exactly the
    /// challenged token. No defender approval is involved, and the challenge
    /// contract cannot move any deed that it has not locked.
    function resolveChallengeTransfer(
        uint64 hexId,
        address expectedOwner,
        address winner
    ) external onlyRole(CHALLENGE_ROLE) {
        require(challengeLocked[hexId], "ZoneNFTV2: not challenge-locked");
        require(winner != address(0), "ZoneNFTV2: zero winner");
        address currentOwner = _ownerOf(uint256(hexId));
        require(currentOwner != address(0), "ZoneNFTV2: not minted");
        require(currentOwner == expectedOwner, "ZoneNFTV2: owner changed");

        // Clear the lock first so the internal _transfer passes the _update
        // lock check (checks-effects before the transfer itself).
        challengeLocked[hexId] = false;
        emit ChallengeLockSet(hexId, false);

        _transfer(currentOwner, winner, uint256(hexId));
        // The new deed holder starts a fresh activity window; accumulated
        // yield and loyalty (deed-instance age) follow the deed.
        lastActivity[hexId] = block.timestamp;

        emit ChallengeTransferResolved(hexId, currentOwner, winner);
    }

    /// Transfer hook: a challenge-locked deed cannot move by any path —
    /// owner transfer, approved address, or operator. Approvals may still be
    /// granted while locked but cannot be exercised. Mints/burns of a locked
    /// token are unreachable (mint requires unminted; reclaim requires
    /// unlocked), so blocking every _update on a locked token is safe.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        require(tokenId <= type(uint64).max, "ZoneNFTV2: tokenId out of hex range");
        require(!challengeLocked[uint64(tokenId)], "ZoneNFTV2: challenge-locked");
        return super._update(to, tokenId, auth);
    }

    function zoneOwner(uint64 hexId) external view returns (address) {
        return _ownerOf(uint256(hexId));
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721, AccessControl) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    /// Exposed for off-chain signers/tests to cross-check domain separators.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
