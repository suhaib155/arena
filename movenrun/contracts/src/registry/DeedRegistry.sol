// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @title DeedRegistry — one permanent, transferable deed per H3 cell.
///
/// @notice The smallest registry that can honestly exist on Base: a claimant
/// presents an oracle-signed authorization for one H3 cell, and receives one
/// ERC-721 deed for it. Nothing else.
///
/// # What this contract deliberately is not
///
/// It is derived from `ZoneNFTV2` (PR #45), whose EIP-712 authorization and
/// `tokenId == cellId` mapping are sound and are kept. Everything that made
/// that contract part of a game economy is left behind, because none of it is
/// needed to own a location and all of it is unfinished:
///
///   - **No MOVE.** V2 required `moveToken.burnFrom(msg.sender, mintCost)` to
///     mint. A deed here costs oracle authorization and gas. The registry has
///     no token address, no allowance requirement, and no balance check, so it
///     cannot be blocked by an unshipped token.
///   - **No dormancy or reclamation.** V2 could `markDormant` a cell after 180
///     days and `reclaimDormant` it after 210, burning the deed. That makes
///     property conditional on continuing to play. A deed here can be sold,
///     given away or forgotten; it cannot be taken because its holder stopped
///     running. There is no burn path of any kind.
///   - **No yield, loyalty, seasons, challenges or gear.** No accrual, no
///     multiplier tiers, no season pause role, no challenge lock, no
///     admin-settled transfer. The registry makes no claim about income,
///     because there is none.
///
/// # What the registry is responsible for
///
/// Uniqueness and authorized minting, enforced on-chain. It does not validate
/// H3 geometry — Solidity cannot, and pretending to would be worse than being
/// clear that it does not. Whether a cell is real, and whether the claimant
/// actually moved through it, is the oracle's judgement, attested by its
/// signature. What this contract guarantees is that a cell cannot be claimed
/// twice, that an authorization cannot be replayed, reused by someone else, or
/// used after it expires, and that no privileged role can mint, seize, or
/// destroy a deed.
contract DeedRegistry is ERC721Enumerable, AccessControl, EIP712 {
    using ECDSA for bytes32;

    /// @notice Signs deed claims. Deliberately NOT `DEFAULT_ADMIN_ROLE`: the
    /// key that authorizes claims is online and used routinely, and must not
    /// carry the power to change the registry's configuration if it leaks.
    bytes32 public constant ORACLE_SIGNER_ROLE = keccak256("ORACLE_SIGNER_ROLE");

    string public constant SIGNING_DOMAIN_NAME = "MovenRunDeedRegistry";
    string public constant SIGNING_DOMAIN_VERSION = "1";

    /// @notice The H3 resolution these deeds are issued at, matching the
    /// canonical `H3_RESOLUTION` in `shared/src/constants/h3.ts`. Recorded so
    /// an inspector can see what a cell id means; it is NOT validated here.
    uint8 public constant H3_RESOLUTION = 8;

    /// @dev `DeedClaim(uint64 cellId,address claimant,bytes32 claimId,uint256 deadline)`
    ///
    /// The claimant is inside the signed struct, so an authorization issued to
    /// one address cannot be presented by another — a signature seen in the
    /// mempool is worthless to anyone else. The chain id and this contract's
    /// address are bound by the EIP-712 domain separator, so an authorization
    /// for Sepolia cannot be replayed on mainnet or against a different
    /// deployment.
    bytes32 public constant DEED_CLAIM_TYPEHASH =
        keccak256("DeedClaim(uint64 cellId,address claimant,bytes32 claimId,uint256 deadline)");

    /// @notice Claim identifiers already spent. A claim id is single-use.
    ///
    /// @dev A one-shot id rather than V2's sequential per-minter nonce. A
    /// sequential nonce means the oracle must know a claimant's current counter
    /// at signing time, and any two authorizations issued to the same person
    /// invalidate each other — the first one redeemed bumps the counter and
    /// makes the second unusable. That is fine for a single mint and wrong for
    /// a pilot where several cells may be authorized before any is claimed.
    mapping(bytes32 => bool) public claimIdUsed;

    /// @notice When true, no new deed may be claimed.
    ///
    /// @dev Claims only. Transfers are NEVER pausable: an existing deed is its
    /// holder's property and the registry has no business freezing it. This
    /// exists so that a suspected oracle-key compromise can be stopped in one
    /// transaction, before the slower work of rotating the signer — the harm
    /// from a leaked signing key is unauthorized *minting*, and that is exactly
    /// and only what this stops.
    bool public claimsPaused;

    string private _baseTokenURI;

    event DeedClaimed(
        uint64 indexed cellId,
        uint256 indexed tokenId,
        address indexed claimant,
        bytes32 claimId
    );
    event BaseURIUpdated(string baseURI);
    event ClaimsPausedSet(bool paused);

    error ZeroAddress();
    error AdminCannotBeOracle();
    error ClaimsArePaused();
    error CellAlreadyClaimed(uint64 cellId);
    error ClaimIdAlreadyUsed(bytes32 claimId);
    error AuthorizationExpired(uint256 deadline);
    error NotOracleSignature();

    /// @param admin        Registry administrator. Intended to be a Safe
    ///                     multisig on mainnet. Holds `DEFAULT_ADMIN_ROLE` and
    ///                     can therefore grant and revoke the oracle role.
    /// @param oracleSigner The key that signs deed claims.
    /// @param baseURI_     Metadata base URI; may be empty at deploy time and
    ///                     set later.
    ///
    /// @dev The two roles are required to be different addresses. V2's
    /// constructor granted both admin roles to `msg.sender`, which on the
    /// existing Sepolia deployment left one EOA as administrator and operator
    /// of everything. Requiring distinct addresses here means that
    /// configuration cannot be reached by accident, and the deployer EOA holds
    /// nothing at all once deployment returns — it is never granted a role.
    constructor(address admin, address oracleSigner, string memory baseURI_)
        ERC721("MovenRun Deed", "DEED")
        EIP712(SIGNING_DOMAIN_NAME, SIGNING_DOMAIN_VERSION)
    {
        if (admin == address(0) || oracleSigner == address(0)) revert ZeroAddress();
        if (admin == oracleSigner) revert AdminCannotBeOracle();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ORACLE_SIGNER_ROLE, oracleSigner);

        _baseTokenURI = baseURI_;
    }

    // ── Claiming ────────────────────────────────────────────────────────────

    /// @notice Claim the deed for one H3 cell, using an oracle authorization.
    ///
    /// @dev State is written before `_safeMint`, which can call back into an
    /// ERC-721 receiver. By then the claim id is spent and the cell is owned,
    /// so a reentrant call re-presenting the same authorization fails the
    /// used-claim check, and one re-presenting a fresh authorization for the
    /// same cell fails the ownership check. No token transfer, external call,
    /// or balance change happens outside the mint itself.
    ///
    /// The claimant is `msg.sender` and is also inside the signed struct, so a
    /// third party cannot front-run an authorization into their own hands.
    function claim(
        uint64 cellId,
        bytes32 claimId,
        uint256 deadline,
        bytes calldata oracleSignature
    ) external {
        if (claimsPaused) revert ClaimsArePaused();
        if (block.timestamp > deadline) revert AuthorizationExpired(deadline);
        if (claimIdUsed[claimId]) revert ClaimIdAlreadyUsed(claimId);

        uint256 tokenId = uint256(cellId);
        // The uniqueness rule, enforced by the contract and by nothing else.
        if (_ownerOf(tokenId) != address(0)) revert CellAlreadyClaimed(cellId);

        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(DEED_CLAIM_TYPEHASH, cellId, msg.sender, claimId, deadline))
        );
        // `recover` reverts on a malformed signature rather than returning a
        // junk address, so a bad signature can never be compared against a role.
        address signer = digest.recover(oracleSignature);
        if (!hasRole(ORACLE_SIGNER_ROLE, signer)) revert NotOracleSignature();

        claimIdUsed[claimId] = true;
        _safeMint(msg.sender, tokenId);

        emit DeedClaimed(cellId, tokenId, msg.sender, claimId);
    }

    // ── Cell ⇄ token identity ───────────────────────────────────────────────

    /// @notice The token id for a cell. The mapping is the identity function:
    /// an H3 cell id is 64 bits and a token id is 256, so the widening is
    /// lossless, collision-free by construction, and needs no hashing.
    function tokenIdForCell(uint64 cellId) public pure returns (uint256) {
        return uint256(cellId);
    }

    /// @notice The cell a token id refers to. Reverts for any value outside
    /// the 64-bit range, which no token issued by this contract can be.
    function cellIdForToken(uint256 tokenId) public pure returns (uint64) {
        require(tokenId <= type(uint64).max, "DeedRegistry: token id out of cell range");
        return uint64(tokenId);
    }

    /// @notice Whether a cell already has a deed.
    function isCellClaimed(uint64 cellId) external view returns (bool) {
        return _ownerOf(uint256(cellId)) != address(0);
    }

    /// @notice The holder of a cell's deed, or the zero address if unclaimed.
    function deedHolder(uint64 cellId) external view returns (address) {
        return _ownerOf(uint256(cellId));
    }

    // ── Administration ──────────────────────────────────────────────────────

    /// @notice Update the metadata base URI.
    /// @dev The only routine admin power. It cannot move, mint or destroy a
    /// deed; at worst a bad value makes metadata unresolvable, which is
    /// recoverable by setting it again.
    function setBaseURI(string calldata baseURI_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _baseTokenURI = baseURI_;
        emit BaseURIUpdated(baseURI_);
    }

    /// @notice Stop or resume new claims. Does not affect existing deeds.
    function setClaimsPaused(bool paused) external onlyRole(DEFAULT_ADMIN_ROLE) {
        claimsPaused = paused;
        emit ClaimsPausedSet(paused);
    }

    // ── Metadata ────────────────────────────────────────────────────────────

    function baseURI() external view returns (string memory) {
        return _baseTokenURI;
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    /// @notice Exposed so an off-chain signer can cross-check the domain it is
    /// signing against, rather than assuming it derived the same one.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ── Required overrides ──────────────────────────────────────────────────

    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721Enumerable)
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value)
        internal
        override(ERC721Enumerable)
    {
        super._increaseBalance(account, value);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721Enumerable, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
