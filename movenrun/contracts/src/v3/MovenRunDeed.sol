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
///
///      Concentration is limited per holder per city, never across a city as a whole. The
///      configured cap is the most deeds any single holder may come to hold inside one city
///      domain; a holder standing at their own cap constrains nobody else, and the city stays
///      open to every other holder. Because a cap that only guarded claiming would be trivial
///      to walk around, every ownership change passes through `_update`, so claims, ordinary
///      transfers, marketplace purchases and contest outcomes are all held to the same limit.
///
///      Contest escrow is accounted separately. A deed under contest keeps counting against
///      its defender for the whole escrow and the contests contract is never counted as a
///      holder, so escrow neither frees capacity nor consumes it twice. A challenger's future
///      capacity is taken at declaration time as a reservation, which the settlement then
///      either consumes or releases, so a validly declared contest can never become
///      un-settleable because the challenger has since filled their own city capacity.
contract MovenRunDeed is ERC721, AccessControl, IMovenRunDeed {
    using MovenRunH3 for uint64;

    /// @notice The only contract permitted to create initial deeds.
    address public claimsContract;
    /// @notice The only contract permitted to escrow and settle deeds.
    address public contestsContract;
    /// @notice Address permitted to perform the one-time wiring, then discarded.
    address public bootstrapper;

    /// @notice Total deeds in existence. Deeds are never burned, so this only increases.
    uint256 public totalDeeds;

    mapping(uint256 tokenId => uint32 cityId) private _cityOf;
    mapping(uint32 cityId => uint256 count) private _cityDeedCount;

    /// @dev Deeds a holder currently counts against a city's per-holder cap. A deed in
    ///      contest escrow still counts against its defender here.
    mapping(address holder => mapping(uint32 cityId => uint256 count)) private _holderCityCount;
    /// @dev City capacity already promised to a holder by an open contest declaration.
    mapping(address holder => mapping(uint32 cityId => uint256 reserved)) private _holderCityReserved;

    mapping(uint32 cityId => uint256 cap) private _cityCap;
    mapping(uint32 cityId => bool configured) private _cityCapConfigured;

    string private _baseTokenURI;

    event ContractsConfigured(address indexed claimsContract, address indexed contestsContract);
    event DeedCreated(uint256 indexed tokenId, address indexed owner, uint32 indexed cityId);
    event DeedEscrowed(uint256 indexed tokenId, address indexed previousHolder);
    event DeedReleasedFromEscrow(uint256 indexed tokenId, address indexed newHolder);
    event CityConcentrationCapConfigured(uint32 indexed cityId, uint256 capPerHolder);
    event CitySlotReserved(address indexed holder, uint32 indexed cityId, uint256 reservedTotal);
    event CityReservationConsumed(address indexed holder, uint32 indexed cityId);
    event CityReservationReleased(address indexed holder, uint32 indexed cityId);
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
    error CityCapNotConfigured(uint32 cityId);
    error HolderCityCapReached(address holder, uint32 cityId, uint256 capPerHolder);
    error EscrowReservedForContests(uint256 tokenId);
    error WinnerNotAContestant(address winner);

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
    ///      attestation verified by MovenRunDeedClaims. The per-holder city cap is applied by
    ///      `_update` as the mint lands, so it holds for claiming exactly as it does for any
    ///      other way a deed can reach a holder.
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
    // Per-holder city concentration
    // ---------------------------------------------------------------------

    /// @notice Configures how many deeds one holder may hold inside a city domain.
    /// @dev Delayed administration only. There is no default: until a city is configured
    ///      here, no deed can be claimed in it and none can be transferred into it. The cap
    ///      bounds each holder individually and never the city's total deed supply.
    function configureCityConcentrationCap(uint32 cityId, uint256 capPerHolder)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (cityId == 0) revert InvalidCityId();
        _cityCap[cityId] = capPerHolder;
        _cityCapConfigured[cityId] = true;
        emit CityConcentrationCapConfigured(cityId, capPerHolder);
    }

    /// @inheritdoc IMovenRunDeed
    /// @dev Called when a contest is declared, before the deed is escrowed. Taking the
    ///      challenger's capacity up front is what makes a declared contest unconditionally
    ///      settleable: the winning branch never has to ask whether room is still available.
    function reserveCitySlot(address holder, uint32 cityId) external {
        if (msg.sender != contestsContract) revert NotContestsContract();
        if (holder == address(0)) revert ZeroAddress();

        uint256 cap = _requireConfiguredCap(cityId);
        uint256 reserved = _holderCityReserved[holder][cityId];
        if (_holderCityCount[holder][cityId] + reserved + 1 > cap) {
            revert HolderCityCapReached(holder, cityId, cap);
        }

        unchecked {
            reserved += 1;
        }
        _holderCityReserved[holder][cityId] = reserved;

        emit CitySlotReserved(holder, cityId, reserved);
    }

    // ---------------------------------------------------------------------
    // Contest escrow
    // ---------------------------------------------------------------------

    /// @inheritdoc IMovenRunDeed
    /// @dev The defender's city count is deliberately left untouched: the deed is still
    ///      theirs for concentration purposes until a contest takes it away, and the escrow
    ///      contract is never counted as a holder.
    function escrowToContests(uint256 tokenId) external {
        address contests = contestsContract;
        if (msg.sender != contests) revert NotContestsContract();

        address holder = ownerOf(tokenId);
        _transfer(holder, contests, tokenId);

        emit DeedEscrowed(tokenId, holder);
    }

    /// @inheritdoc IMovenRunDeed
    /// @dev Settlement reconciles concentration in one step and cannot fail on capacity.
    ///      The challenger's reservation is always given up here: consumed into a real
    ///      holding when they win, released untouched when they lose.
    function settleContestEscrow(
        uint256 tokenId,
        address defender,
        address challenger,
        address winner
    ) external {
        address contests = contestsContract;
        if (msg.sender != contests) revert NotContestsContract();
        if (_ownerOf(tokenId) != contests) revert DeedNotEscrowed(tokenId);
        if (winner != defender && winner != challenger) revert WinnerNotAContestant(winner);

        uint32 cityId = _cityOf[tokenId];

        uint256 reserved = _holderCityReserved[challenger][cityId];
        if (reserved > 0) {
            unchecked {
                _holderCityReserved[challenger][cityId] = reserved - 1;
            }
        }

        if (winner == challenger) {
            // The reservation taken at declaration is what the challenger now occupies, so
            // no capacity check is consulted and settlement cannot be blocked by one.
            _releaseHolderSlot(defender, cityId);
            unchecked {
                _holderCityCount[challenger][cityId] += 1;
            }
            emit CityReservationConsumed(challenger, cityId);
        } else {
            emit CityReservationReleased(challenger, cityId);
        }

        _transfer(contests, winner, tokenId);

        emit DeedReleasedFromEscrow(tokenId, winner);
    }

    // ---------------------------------------------------------------------
    // Ownership accounting
    // ---------------------------------------------------------------------

    /// @dev The single chokepoint every ownership change passes through, so the per-holder
    ///      city cap applies identically to a claim, an ordinary transfer and a marketplace
    ///      purchase. Escrow legs are excluded and reconciled by the contests path instead.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = super._update(to, tokenId, auth);
        address contests = contestsContract;

        if (contests != address(0)) {
            if (to == contests) {
                // Only a real contest may put a deed into escrow. A voluntary transfer into
                // the escrow contract would strand the deed and leave accounting adrift.
                if (msg.sender != contests) revert EscrowReservedForContests(tokenId);
                return from;
            }
            if (from == contests) {
                return from;
            }
        }

        uint32 cityId = _cityOf[tokenId];
        if (from != address(0)) _releaseHolderSlot(from, cityId);
        if (to != address(0)) _occupyHolderSlot(to, cityId);

        return from;
    }

    /// @dev Takes one of a holder's city slots, refusing to exceed their own cap. Capacity
    ///      already promised to the holder by an open contest declaration stays spoken for.
    function _occupyHolderSlot(address holder, uint32 cityId) private {
        uint256 cap = _requireConfiguredCap(cityId);
        uint256 held = _holderCityCount[holder][cityId];
        if (held + _holderCityReserved[holder][cityId] + 1 > cap) {
            revert HolderCityCapReached(holder, cityId, cap);
        }
        unchecked {
            _holderCityCount[holder][cityId] = held + 1;
        }
    }

    /// @dev Gives a city slot back. Saturating at zero, so no ownership change and no contest
    ///      settlement can ever revert on an accounting underflow.
    function _releaseHolderSlot(address holder, uint32 cityId) private {
        uint256 held = _holderCityCount[holder][cityId];
        if (held > 0) {
            unchecked {
                _holderCityCount[holder][cityId] = held - 1;
            }
        }
    }

    function _requireConfiguredCap(uint32 cityId) private view returns (uint256) {
        if (!_cityCapConfigured[cityId]) revert CityCapNotConfigured(cityId);
        return _cityCap[cityId];
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
    function cityConcentrationCap(uint32 cityId)
        external
        view
        returns (uint256 capPerHolder, bool configured)
    {
        return (_cityCap[cityId], _cityCapConfigured[cityId]);
    }

    /// @inheritdoc IMovenRunDeed
    function holderCityDeedCount(address holder, uint32 cityId) external view returns (uint256) {
        return _holderCityCount[holder][cityId];
    }

    /// @inheritdoc IMovenRunDeed
    function holderCityReservedCount(address holder, uint32 cityId)
        external
        view
        returns (uint256)
    {
        return _holderCityReserved[holder][cityId];
    }

    /// @inheritdoc IMovenRunDeed
    function holderCityCapacityRemaining(address holder, uint32 cityId)
        external
        view
        returns (uint256)
    {
        if (!_cityCapConfigured[cityId]) return 0;
        uint256 used = _holderCityCount[holder][cityId] + _holderCityReserved[holder][cityId];
        uint256 cap = _cityCap[cityId];
        return used >= cap ? 0 : cap - used;
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
