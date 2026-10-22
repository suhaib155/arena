// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IMovenRunToken} from "./interfaces/IMovenRunToken.sol";
import {IMovenRunRewards} from "./interfaces/IMovenRunRewards.sol";

/// @title MovenRunSettlement
/// @notice The sole issuance path for MovenRun movement rewards, and the onchain record of
///         each day's privacy-safe aggregate settlement.
/// @dev Every published settlement carries aggregate totals only. No route, GPS sample,
///      start point, end point or ordered cell sequence is accepted, stored or emitted by
///      this contract; per-account amounts live exclusively inside an offchain Merkle tree
///      whose root is the only per-account commitment published here.
///
///      Publication requires two independent EIP-712 authorizations over the identical
///      settlement hash: one from the settlement signer and one from the reconciliation
///      signer. Both are chain-bound and contract-bound through the EIP-712 domain, expire,
///      and are single-use through the authorization nonce. Anyone may relay a fully
///      authorized settlement.
contract MovenRunSettlement is AccessControl, EIP712 {
    /// @notice Role permitted to pause new settlement publication and nothing else.
    bytes32 public constant GUARDIAN_ROLE = keccak256("MOVENRUN_GUARDIAN_ROLE");

    /// @notice Lifetime ceiling on MOVE issued to player movement rewards.
    uint256 public constant PLAYER_MOVEMENT_ALLOCATION = 400_000_000 ether;
    /// @notice Reward budget of the first season.
    uint256 public constant SEASON_ONE_BUDGET = 9_000_000 ether;
    /// @notice Lower bound each later season's budget decays towards.
    uint256 public constant SEASON_BUDGET_FLOOR = 2_000_000 ether;
    /// @notice Each later season is ninety percent of the previous season's schedule value.
    uint256 public constant SEASON_DECAY_BPS = 9_000;
    /// @notice Season length in settlement days.
    uint32 public constant SEASON_LENGTH_DAYS = 90;
    /// @notice Fixed toll rate. Not governable and not raisable by any role or timelock.
    uint256 public constant TOLL_RATE_BPS = 200;
    /// @notice Ceiling on the automatic day-close charge, as a share of the day's gross reward.
    uint256 public constant MAX_AUTOMATIC_BURN_BPS = 6_000;
    /// @notice Basis-point denominator.
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice EIP-712 type of a daily settlement authorization.
    bytes32 public constant SETTLEMENT_AUTHORIZATION_TYPEHASH =
        keccak256(
            "SettlementAuthorization(uint16 rulesVersion,uint32 seasonId,uint32 dayId,bytes32 merkleRoot,uint256 grossIssuance,uint256 lockedClaims,uint256 liquidMovementClaims,uint256 tollCredits,uint256 automaticBurn,uint256 tollBase,uint64 participantCount,uint256 nonce,uint64 expiry)"
        );

    /// @notice Aggregate, privacy-safe description of one settlement day.
    struct SettlementAuthorization {
        uint16 rulesVersion;
        uint32 seasonId;
        uint32 dayId;
        bytes32 merkleRoot;
        uint256 grossIssuance;
        uint256 lockedClaims;
        uint256 liquidMovementClaims;
        uint256 tollCredits;
        uint256 automaticBurn;
        uint256 tollBase;
        uint64 participantCount;
        uint256 nonce;
        uint64 expiry;
    }

    /// @notice Immutable onchain record of a published settlement day.
    struct SettlementRecord {
        uint16 rulesVersion;
        uint32 seasonId;
        bytes32 merkleRoot;
        uint256 grossIssuance;
        uint256 lockedClaims;
        uint256 liquidMovementClaims;
        uint256 tollCredits;
        uint256 automaticBurn;
        uint256 tollBase;
        uint64 participantCount;
        uint64 publishedAt;
        bool published;
    }

    /// @notice The MovenRun MOVE token.
    IMovenRunToken public immutable moveToken;
    /// @notice The reward distribution contract funded by each settlement.
    IMovenRunRewards public immutable rewards;

    /// @notice Lifetime MOVE issued through the movement settlement path.
    uint256 public lifetimeMovementIssued;
    /// @notice Remaining capacity for newly created liquid movement rewards. Starts at zero.
    uint256 public liquidIssuanceAllowance;
    /// @notice Highest settlement day published so far.
    uint32 public lastSettledDay;
    /// @notice Highest season whose budget has been derived.
    uint32 public highestSeasonOpened;
    /// @notice Rules version that new authorizations must declare.
    uint16 public rulesVersion;
    /// @notice True while new settlement publication is paused. Never affects reward claims.
    bool public publicationPaused;

    /// @notice Authorized settlement signer.
    address public settlementSigner;
    /// @notice Independent reconciliation signer. Always distinct from the settlement signer.
    address public reconciliationSigner;

    /// @notice Budget actually available to a season, clamped by remaining lifetime allocation.
    mapping(uint32 seasonId => uint256 budget) public seasonBudget;
    /// @notice Unclamped schedule value for a season, used to derive the next season.
    mapping(uint32 seasonId => uint256 rawBudget) public seasonScheduleBudget;
    /// @notice MOVE issued inside a season.
    mapping(uint32 seasonId => uint256 issued) public seasonIssued;
    /// @notice Single-use authorization nonces.
    mapping(uint256 nonce => bool used) public authorizationNonceUsed;

    mapping(uint32 dayId => SettlementRecord record) private _settlements;

    event SettlementPublished(
        uint32 indexed dayId,
        uint32 indexed seasonId,
        uint16 rulesVersion,
        bytes32 merkleRoot,
        uint256 grossIssuance,
        uint256 lockedClaims,
        uint256 liquidMovementClaims,
        uint256 tollCredits,
        uint256 automaticBurn
    );
    event SeasonOpened(uint32 indexed seasonId, uint256 budget, uint256 remainingAllocation);
    event SettlementSignerUpdated(address indexed previousSigner, address indexed newSigner);
    event ReconciliationSignerUpdated(address indexed previousSigner, address indexed newSigner);
    event LiquidIssuanceAllowanceRaised(uint256 addedAmount, uint256 newAllowance);
    event LiquidIssuanceAllowanceReduced(uint256 removedAmount, uint256 newAllowance);
    event RulesVersionUpdated(uint16 previousVersion, uint16 newVersion);
    event PublicationPauseUpdated(bool paused, address indexed actor);

    error ZeroAddress();
    error SignerReuse();
    error PublicationIsPaused();
    error AuthorizationExpired(uint64 expiry);
    error AuthorizationAlreadyUsed(uint256 nonce);
    error UnexpectedRulesVersion(uint16 provided, uint16 expected);
    error DayNotAdvancing(uint32 provided, uint32 lastSettled);
    error DayAlreadySettled(uint32 dayId);
    error SeasonMismatch(uint32 provided, uint32 derived);
    error SeasonSequenceViolation(uint32 provided, uint32 highestOpened);
    error InvalidSettlementSignature();
    error InvalidReconciliationSignature();
    error SettlementAccountingMismatch(uint256 componentTotal, uint256 grossIssuance);
    error TollBaseExceedsGross(uint256 tollBase, uint256 grossIssuance);
    error TollCreditsExceedCap(uint256 tollCredits, uint256 maximum);
    error AutomaticBurnExceedsCap(uint256 automaticBurn, uint256 maximum);
    error DailyPoolExceeded(uint256 grossIssuance, uint256 dailyPool);
    error PlayerAllocationExceeded(uint256 requested, uint256 remaining);
    error LiquidIssuanceAllowanceExceeded(uint256 requested, uint256 available);

    /// @param admin Delayed administrator, expected to be MovenRunTimelock.
    /// @param guardian Emergency address permitted to pause new publication only.
    /// @param moveToken_ MovenRun MOVE token.
    /// @param rewards_ MovenRun rewards distribution contract.
    /// @param settlementSigner_ Authorized settlement signer.
    /// @param reconciliationSigner_ Independent reconciliation signer.
    /// @param initialRulesVersion Rules version new authorizations must declare.
    constructor(
        address admin,
        address guardian,
        address moveToken_,
        address rewards_,
        address settlementSigner_,
        address reconciliationSigner_,
        uint16 initialRulesVersion
    ) EIP712("MovenRunSettlement", "3") {
        if (
            admin == address(0) ||
            guardian == address(0) ||
            moveToken_ == address(0) ||
            rewards_ == address(0) ||
            settlementSigner_ == address(0) ||
            reconciliationSigner_ == address(0)
        ) revert ZeroAddress();
        if (settlementSigner_ == reconciliationSigner_) revert SignerReuse();

        moveToken = IMovenRunToken(moveToken_);
        rewards = IMovenRunRewards(rewards_);
        settlementSigner = settlementSigner_;
        reconciliationSigner = reconciliationSigner_;
        rulesVersion = initialRulesVersion;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GUARDIAN_ROLE, guardian);
    }

    // ---------------------------------------------------------------------
    // Publication
    // ---------------------------------------------------------------------

    /// @notice Publishes one dual-authorized daily settlement and funds the reward reserve.
    /// @dev Callable by anyone holding both signatures. The relayer gains nothing: every
    ///      economic parameter is fixed by the signed authorization.
    function publishSettlement(
        SettlementAuthorization calldata authorization,
        bytes calldata settlementSignature,
        bytes calldata reconciliationSignature
    ) external {
        if (publicationPaused) revert PublicationIsPaused();
        if (block.timestamp > authorization.expiry) revert AuthorizationExpired(authorization.expiry);
        if (authorization.rulesVersion != rulesVersion) {
            revert UnexpectedRulesVersion(authorization.rulesVersion, rulesVersion);
        }
        if (authorization.dayId == 0 || authorization.dayId <= lastSettledDay) {
            revert DayNotAdvancing(authorization.dayId, lastSettledDay);
        }
        if (_settlements[authorization.dayId].published) revert DayAlreadySettled(authorization.dayId);
        if (authorizationNonceUsed[authorization.nonce]) {
            revert AuthorizationAlreadyUsed(authorization.nonce);
        }

        uint32 derivedSeason = seasonOf(authorization.dayId);
        if (authorization.seasonId != derivedSeason) {
            revert SeasonMismatch(authorization.seasonId, derivedSeason);
        }

        bytes32 digest = hashSettlement(authorization);
        if (ECDSA.recover(digest, settlementSignature) != settlementSigner) {
            revert InvalidSettlementSignature();
        }
        if (ECDSA.recover(digest, reconciliationSignature) != reconciliationSigner) {
            revert InvalidReconciliationSignature();
        }

        _validateAccounting(authorization);

        authorizationNonceUsed[authorization.nonce] = true;
        _openSeason(derivedSeason);

        uint256 pool = _dailyPool(derivedSeason, authorization.dayId);
        if (authorization.grossIssuance > pool) {
            revert DailyPoolExceeded(authorization.grossIssuance, pool);
        }

        if (authorization.liquidMovementClaims > liquidIssuanceAllowance) {
            revert LiquidIssuanceAllowanceExceeded(
                authorization.liquidMovementClaims,
                liquidIssuanceAllowance
            );
        }

        uint256 remainingAllocation = PLAYER_MOVEMENT_ALLOCATION - lifetimeMovementIssued;
        if (authorization.grossIssuance > remainingAllocation) {
            revert PlayerAllocationExceeded(authorization.grossIssuance, remainingAllocation);
        }

        unchecked {
            liquidIssuanceAllowance -= authorization.liquidMovementClaims;
            lifetimeMovementIssued += authorization.grossIssuance;
            seasonIssued[derivedSeason] += authorization.grossIssuance;
        }
        lastSettledDay = authorization.dayId;

        _settlements[authorization.dayId] = SettlementRecord({
            rulesVersion: authorization.rulesVersion,
            seasonId: derivedSeason,
            merkleRoot: authorization.merkleRoot,
            grossIssuance: authorization.grossIssuance,
            lockedClaims: authorization.lockedClaims,
            liquidMovementClaims: authorization.liquidMovementClaims,
            tollCredits: authorization.tollCredits,
            automaticBurn: authorization.automaticBurn,
            tollBase: authorization.tollBase,
            participantCount: authorization.participantCount,
            publishedAt: uint64(block.timestamp),
            published: true
        });

        if (authorization.grossIssuance > 0) {
            moveToken.settlementIssue(authorization.grossIssuance, authorization.automaticBurn);
        }
        rewards.finalizeDay(
            authorization.dayId,
            authorization.merkleRoot,
            authorization.lockedClaims,
            authorization.liquidMovementClaims + authorization.tollCredits
        );

        _emitSettlementPublished(authorization.dayId);
    }

    /// @dev Emitted from the stored record so the publication path keeps a shallow stack.
    function _emitSettlementPublished(uint32 dayId) private {
        SettlementRecord storage record = _settlements[dayId];
        emit SettlementPublished(
            dayId,
            record.seasonId,
            record.rulesVersion,
            record.merkleRoot,
            record.grossIssuance,
            record.lockedClaims,
            record.liquidMovementClaims,
            record.tollCredits,
            record.automaticBurn
        );
    }

    /// @dev Enforces the settlement accounting identity and the two fixed economic ceilings.
    function _validateAccounting(SettlementAuthorization calldata authorization) private pure {
        uint256 componentTotal = authorization.lockedClaims +
            authorization.liquidMovementClaims +
            authorization.tollCredits +
            authorization.automaticBurn;
        if (componentTotal != authorization.grossIssuance) {
            revert SettlementAccountingMismatch(componentTotal, authorization.grossIssuance);
        }
        if (authorization.tollBase > authorization.grossIssuance) {
            revert TollBaseExceedsGross(authorization.tollBase, authorization.grossIssuance);
        }

        uint256 tollCeiling = (authorization.tollBase * TOLL_RATE_BPS) / BPS_DENOMINATOR;
        if (authorization.tollCredits > tollCeiling) {
            revert TollCreditsExceedCap(authorization.tollCredits, tollCeiling);
        }

        uint256 burnCeiling = (authorization.grossIssuance * MAX_AUTOMATIC_BURN_BPS) / BPS_DENOMINATOR;
        if (authorization.automaticBurn > burnCeiling) {
            revert AutomaticBurnExceedsCap(authorization.automaticBurn, burnCeiling);
        }
    }

    // ---------------------------------------------------------------------
    // Season schedule
    // ---------------------------------------------------------------------

    /// @dev Derives and caches a season budget. Seasons open strictly in order so the decay
    ///      chain cannot be skipped, and every budget is clamped by the remaining lifetime
    ///      player allocation so the schedule can never drift past it.
    function _openSeason(uint32 seasonId) private {
        uint32 opened = highestSeasonOpened;
        if (seasonId <= opened) return;
        if (seasonId != opened + 1) revert SeasonSequenceViolation(seasonId, opened);

        uint256 scheduleBudget;
        if (seasonId == 1) {
            scheduleBudget = SEASON_ONE_BUDGET;
        } else {
            scheduleBudget = (seasonScheduleBudget[seasonId - 1] * SEASON_DECAY_BPS) / BPS_DENOMINATOR;
            if (scheduleBudget < SEASON_BUDGET_FLOOR) {
                scheduleBudget = SEASON_BUDGET_FLOOR;
            }
        }

        uint256 remainingAllocation = PLAYER_MOVEMENT_ALLOCATION - lifetimeMovementIssued;
        uint256 budget = scheduleBudget > remainingAllocation ? remainingAllocation : scheduleBudget;

        seasonScheduleBudget[seasonId] = scheduleBudget;
        seasonBudget[seasonId] = budget;
        highestSeasonOpened = seasonId;

        emit SeasonOpened(seasonId, budget, remainingAllocation);
    }

    /// @dev Unspent budget stays inside the season and is spread over the days it has left.
    ///      Nothing carries across a season boundary.
    function _dailyPool(uint32 seasonId, uint32 dayId) private view returns (uint256) {
        uint256 remainingSeasonBudget = seasonBudget[seasonId] - seasonIssued[seasonId];
        uint256 daysRemaining = SEASON_LENGTH_DAYS - _dayIndexInSeason(dayId) + 1;
        return remainingSeasonBudget / daysRemaining;
    }

    function _dayIndexInSeason(uint32 dayId) private pure returns (uint32) {
        return ((dayId - 1) % SEASON_LENGTH_DAYS) + 1;
    }

    /// @notice Season a settlement day belongs to. Day numbering starts at one.
    function seasonOf(uint32 dayId) public pure returns (uint32) {
        return ((dayId - 1) / SEASON_LENGTH_DAYS) + 1;
    }

    /// @notice Position of a settlement day inside its season, from one to ninety.
    function dayIndexInSeason(uint32 dayId) external pure returns (uint32) {
        return _dayIndexInSeason(dayId);
    }

    /// @notice Reward budget still available to a day whose season has already been opened.
    function dailyPoolOf(uint32 dayId) external view returns (uint256) {
        return _dailyPool(seasonOf(dayId), dayId);
    }

    /// @notice Remaining lifetime allocation for player movement rewards.
    function remainingPlayerAllocation() external view returns (uint256) {
        return PLAYER_MOVEMENT_ALLOCATION - lifetimeMovementIssued;
    }

    // ---------------------------------------------------------------------
    // Authorization hashing
    // ---------------------------------------------------------------------

    /// @notice EIP-712 digest both signers must authorize.
    function hashSettlement(SettlementAuthorization calldata authorization)
        public
        view
        returns (bytes32)
    {
        return
            _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        SETTLEMENT_AUTHORIZATION_TYPEHASH,
                        authorization.rulesVersion,
                        authorization.seasonId,
                        authorization.dayId,
                        authorization.merkleRoot,
                        authorization.grossIssuance,
                        authorization.lockedClaims,
                        authorization.liquidMovementClaims,
                        authorization.tollCredits,
                        authorization.automaticBurn,
                        authorization.tollBase,
                        authorization.participantCount,
                        authorization.nonce,
                        authorization.expiry
                    )
                )
            );
    }

    /// @notice Published settlement record for a day.
    function settlementOf(uint32 dayId) external view returns (SettlementRecord memory) {
        return _settlements[dayId];
    }

    // ---------------------------------------------------------------------
    // Administration
    // ---------------------------------------------------------------------

    /// @notice Pauses new settlement publication. Reward claims are unaffected.
    function pausePublication() external onlyRole(GUARDIAN_ROLE) {
        publicationPaused = true;
        emit PublicationPauseUpdated(true, msg.sender);
    }

    /// @notice Resumes settlement publication. Delayed administration only.
    function unpausePublication() external onlyRole(DEFAULT_ADMIN_ROLE) {
        publicationPaused = false;
        emit PublicationPauseUpdated(false, msg.sender);
    }

    /// @notice Rotates the settlement signer. The two critical signers stay distinct.
    function setSettlementSigner(address newSigner) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newSigner == address(0)) revert ZeroAddress();
        if (newSigner == reconciliationSigner) revert SignerReuse();
        emit SettlementSignerUpdated(settlementSigner, newSigner);
        settlementSigner = newSigner;
    }

    /// @notice Rotates the reconciliation signer. The two critical signers stay distinct.
    function setReconciliationSigner(address newSigner) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newSigner == address(0)) revert ZeroAddress();
        if (newSigner == settlementSigner) revert SignerReuse();
        emit ReconciliationSignerUpdated(reconciliationSigner, newSigner);
        reconciliationSigner = newSigner;
    }

    /// @notice Raises the ceiling on newly created liquid movement rewards.
    /// @dev Delayed administration only. The allowance starts at zero, so no liquid movement
    ///      reward can be issued until MovenRun deliberately opens capacity for it.
    function raiseLiquidIssuanceAllowance(uint256 additionalAmount)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        liquidIssuanceAllowance += additionalAmount;
        emit LiquidIssuanceAllowanceRaised(additionalAmount, liquidIssuanceAllowance);
    }

    /// @notice Lowers the liquid issuance ceiling. Available to the guardian as a safety action.
    function reduceLiquidIssuanceAllowance(uint256 removedAmount) external {
        if (!hasRole(GUARDIAN_ROLE, msg.sender) && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert AccessControlUnauthorizedAccount(msg.sender, GUARDIAN_ROLE);
        }
        uint256 current = liquidIssuanceAllowance;
        uint256 reduction = removedAmount > current ? current : removedAmount;
        unchecked {
            liquidIssuanceAllowance = current - reduction;
        }
        emit LiquidIssuanceAllowanceReduced(reduction, liquidIssuanceAllowance);
    }

    /// @notice Updates the rules version new authorizations must declare.
    /// @dev Already published records keep the version they were settled under, so a rules
    ///      change can never retroactively reinterpret a finalized day.
    function setRulesVersion(uint16 newVersion) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit RulesVersionUpdated(rulesVersion, newVersion);
        rulesVersion = newVersion;
    }
}
