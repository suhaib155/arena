// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IMovenRunDeed} from "./interfaces/IMovenRunDeed.sol";
import {MovenRunH3} from "./libraries/MovenRunH3.sol";

/// @title MovenRunDeed
/// @notice Permanent ERC-721 ownership of a single eligible solid H3 resolution-8 cell.
/// @dev The token id is the canonical H3 cell identifier itself, so one cell can only ever
///      carry one deed. There is no public mint, no burn path and no reward accrual inside
///      the token. The only involuntary movement is contest escrow and contest settlement,
///      both restricted to the contests contract, which deliberately does not depend on the
///      holder's ERC-721 approval so a defender cannot block a valid contest by withholding it.
///      The contract stores nothing about geography beyond the deed's own cell identifier
///      and the opaque city domain used for concentration limits.
contract MovenRunDeed is ERC721, AccessControl, IMovenRunDeed {
    using MovenRunH3 for uint64;

    /// @notice The only contract permitted to create initial deeds.
    address public claimsContract;
    /// @notice The only contract permitted to escrow and release deeds.
    address public contestsContract;
    /// @notice Address permitted to perform the one-time wiring, then discarded.
    address public bootstrapper;

    /// @notice Total deeds in existence. Deeds are never burned, so this only increases.
    uint256 public totalDeeds;

    mapping(uint256 tokenId => uint32 cityId) private _cityOf;
    mapping(uint32 cityId => uint256 count) private _cityDeedCount;

    string private _baseTokenURI;

    event ContractsConfigured(address indexed claimsContract, address indexed contestsContract);
    event DeedCreated(uint256 indexed tokenId, address indexed owner, uint32 indexed cityId);
    event DeedEscrowed(uint256 indexed tokenId, address indexed previousHolder);
    event DeedReleasedFromEscrow(uint256 indexed tokenId, address indexed newHolder);
    event BaseTokenURIUpdated(string baseTokenURI);

    error ZeroAddress();
    error NotBootstrapper();
    error ContractsAlreadyConfigured();
    error NotClaimsContract();
    error NotContestsContract();
    error DeedAlreadyExists(uint256 tokenId);
    error InvalidH3Cell(uint64 h3CellId);
    error InvalidCityId();
    error DeedNotEscrowed(uint256 tokenId);

    /// @param admin Delayed administrator, expected to be MovenRunTimelock.
    /// @param bootstrapper_ Address permitted to run the one-time wiring, then discarded.
    constructor(address admin, address bootstrapper_) ERC721("MovenRun Deed", "MRDEED") {
        if (admin == address(0) || bootstrapper_ == address(0)) revert ZeroAddress();
        bootstrapper = bootstrapper_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ---------------------------------------------------------------------
    // One-time wiring
    // ---------------------------------------------------------------------

    /// @notice Performs the single permitted wiring of the claims and contests contracts.
    function configureContracts(address claimsContract_, address contestsContract_) external {
        if (msg.sender != bootstrapper) revert NotBootstrapper();
        if (claimsContract != address(0) || contestsContract != address(0)) {
            revert ContractsAlreadyConfigured();
        }
        if (claimsContract_ == address(0) || contestsContract_ == address(0)) revert ZeroAddress();

        claimsContract = claimsContract_;
        contestsContract = contestsContract_;
        bootstrapper = address(0);

        emit ContractsConfigured(claimsContract_, contestsContract_);
    }

    // ---------------------------------------------------------------------
    // Deed creation
    // ---------------------------------------------------------------------

    /// @inheritdoc IMovenRunDeed
    /// @dev The structural H3 check is a fail-closed pre-filter. Whether the cell is solid
    ///      ground and whether the claimant earned it come from the signed eligibility
    ///      attestation verified by MovenRunDeedClaims.
    function mintDeed(address to, uint64 h3CellId, uint32 cityId)
        external
        returns (uint256 tokenId)
    {
        if (msg.sender != claimsContract) revert NotClaimsContract();
        if (cityId == 0) revert InvalidCityId();
        if (!MovenRunH3.isValidResolution8Cell(h3CellId)) revert InvalidH3Cell(h3CellId);

        tokenId = uint256(h3CellId);
        if (_ownerOf(tokenId) != address(0)) revert DeedAlreadyExists(tokenId);

        _cityOf[tokenId] = cityId;
        unchecked {
            _cityDeedCount[cityId] += 1;
            totalDeeds += 1;
        }

        emit DeedCreated(tokenId, to, cityId);

        _safeMint(to, tokenId);
    }

    // ---------------------------------------------------------------------
    // Contest escrow
    // ---------------------------------------------------------------------

    /// @inheritdoc IMovenRunDeed
    function escrowToContests(uint256 tokenId) external {
        address contests = contestsContract;
        if (msg.sender != contests) revert NotContestsContract();

        address holder = ownerOf(tokenId);
        _transfer(holder, contests, tokenId);

        emit DeedEscrowed(tokenId, holder);
    }

    /// @inheritdoc IMovenRunDeed
    function releaseFromContests(address to, uint256 tokenId) external {
        address contests = contestsContract;
        if (msg.sender != contests) revert NotContestsContract();
        if (to == address(0)) revert ZeroAddress();
        if (ownerOf(tokenId) != contests) revert DeedNotEscrowed(tokenId);

        _transfer(contests, to, tokenId);

        emit DeedReleasedFromEscrow(tokenId, to);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @inheritdoc IMovenRunDeed
    function cityOf(uint256 tokenId) external view returns (uint32) {
        return _cityOf[tokenId];
    }

    /// @inheritdoc IMovenRunDeed
    function cityDeedCount(uint32 cityId) external view returns (uint256) {
        return _cityDeedCount[cityId];
    }

    /// @inheritdoc IMovenRunDeed
    function deedExists(uint256 tokenId) external view returns (bool) {
        return _ownerOf(tokenId) != address(0);
    }

    /// @notice Canonical H3 resolution-8 cell identifier a deed represents.
    function h3CellIdOf(uint256 tokenId) external pure returns (uint64) {
        return uint64(tokenId);
    }

    /// @notice Whether a deed is currently held in contest escrow.
    function isEscrowed(uint256 tokenId) external view returns (bool) {
        address contests = contestsContract;
        return contests != address(0) && _ownerOf(tokenId) == contests;
    }

    // ---------------------------------------------------------------------
    // Metadata
    // ---------------------------------------------------------------------

    /// @notice Sets the metadata base URI. Delayed administration only.
    function setBaseTokenURI(string calldata newBaseTokenURI) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _baseTokenURI = newBaseTokenURI;
        emit BaseTokenURIUpdated(newBaseTokenURI);
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, AccessControl, IERC165)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
