// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {IMovenRunToken} from "./interfaces/IMovenRunToken.sol";
import {IMovenRunDeed} from "./interfaces/IMovenRunDeed.sol";

/// @title MovenRunDeedClaims
/// @notice Converts already-earned eligible solid ground into a permanent deed.
/// @dev A deed cannot be bought from MovenRun. The only way to create one is to present a
///      chain-bound, single-use, expiring eligibility attestation signed by the MovenRun
///      eligibility signer, which asserts that the claimant already holds the underlying
///      solid ground under the authoritative MovenRun service. The three numeric thresholds
///      are adjustable hypotheses held behind delayed administration and are visible onchain.
///      City concentration caps live on MovenRunDeed, are explicit per city and unset until
///      configured, so no claim can be made in a city MovenRun has not deliberately opened.
///      The cap bounds what a single holder may accumulate inside one city, so one claimant
///      reaching their own limit leaves the city open to everyone else. The claim fee comes
///      from the signed quote, is bounded by a caller-supplied maximum, and is genuinely burned.
///
///      G5 DRAFT PATCH (H3 / M1). Research copy, not deployed, not audited:
///      - threshold attestation: a claim needs `attestationThreshold` (never below 2) signatures
///        from distinct registered eligibility signers, passed in strictly ascending signer
///        order; the constructor registers one signer, so claims fail closed until the delayed
///        administrator registers a second;
///      - the city is derived from the cell: the contract computes the cell's resolution-5
///        parent and verifies (parent, cityId) against a committed Merkle root of city regions;
///      - the attestation names a risk-graph cluster id and an evidence commitment; at most
///        `maxDeedsPerCluster` claims per cluster per city are accepted, counted on chain;
///      - issuance caps: a city-wide deed cap, a per-city daily claim limit and a global claim
///        ceiling, all on top of the existing per-holder cap and the guardian pause.
///
///      G5 DRAFT PATCH (void lifecycle and signer roles, RESEARCH/PROPOSED, unaudited):
///      - every claim gets a claim record; MovenRunDeed reports each void through
///        onDeedVoided. A FAULT void keeps every counter spent. An ADMINISTRATIVE void
///        restores the cluster slot once per (city, cluster), after RECLAIM_COOLDOWN; the daily
///        counter, the lifetime ceiling, the attestation nonce and the burned fee stay spent.
///        The delayed administrator may reclassify a FAULT void as administrative once, within
///        APPEAL_WINDOW (capacity only; the deed is never reinstated).
///      - adding an eligibility signer (registration or rotation) needs a prior, expiring
///        approval from SIGNER_APPROVER_ROLE, a self-administered role the delayed
///        administrator cannot grant itself. Removing a signer needs no approval (fails closed).
contract MovenRunDeedClaims is AccessControl, EIP712, ReentrancyGuard {
    /// @notice Role permitted to pause new deed claims and nothing else.
    bytes32 public constant GUARDIAN_ROLE = keccak256("MOVENRUN_GUARDIAN_ROLE");

    /// @notice EIP-712 type of a deed eligibility attestation.
    bytes32 public constant ELIGIBILITY_ATTESTATION_TYPEHASH =
        keccak256(
            "DeedEligibilityAttestation(address claimant,uint64 h3CellId,uint32 cityId,bool solidGround,uint32 tenureDays,uint32 distinctCrossers,uint32 trafficDays,bool relatedTrafficExcluded,bytes32 clusterId,bytes32 evidenceHash,uint256 claimFee,uint16 rulesVersion,uint256 nonce,uint64 expiry)"
        );

    /// @notice Authoritative MovenRun statement that a claimant already holds eligible ground.
    struct EligibilityAttestation {
        address claimant;
        uint64 h3CellId;
        uint32 cityId;
        bool solidGround;
        uint32 tenureDays;
        uint32 distinctCrossers;
        uint32 trafficDays;
        bool relatedTrafficExcluded;
        bytes32 clusterId;
        bytes32 evidenceHash;
        uint256 claimFee;
        uint16 rulesVersion;
        uint256 nonce;
        uint64 expiry;
    }

    /// @notice The MovenRun MOVE token. Claim fees are burned through it.
    IMovenRunToken public immutable moveToken;
    /// @notice The deed collection this contract is the sole initial minter for.
    IMovenRunDeed public immutable deed;

    /// @notice Signer of eligibility attestations.
    address public eligibilitySigner;
    /// @notice Rules version new attestations must declare.
    uint16 public rulesVersion;
    /// @notice True while new deed claims are paused. Existing deed transfers are unaffected.
    bool public claimsPaused;

    /// @notice Consecutive days of tenure a claimant must already hold. Adjustable hypothesis.
    uint32 public minTenureDays;
    /// @notice Distinct verified crossers the ground must already have. Adjustable hypothesis.
    uint32 public minDistinctCrossers;
    /// @notice Distinct days carrying traffic. Adjustable hypothesis.
    uint32 public minTrafficDays;

    mapping(uint256 nonce => bool used) public attestationNonceUsed;

    /// @notice G5 patch: resolution of the parent cell that defines a city region.
    uint8 public constant CITY_REGION_RESOLUTION = 5;
    /// @notice G5 patch: lowest permitted attestation threshold.
    uint8 public constant MIN_ATTESTATION_THRESHOLD = 2;
    /// @notice G5 patch: registered eligibility signers.
    mapping(address signer => bool registered) public isEligibilitySigner;
    uint256 public eligibilitySignerCount;
    /// @notice G5 patch: distinct signatures a claim needs.
    uint8 public attestationThreshold;
    /// @notice G5 patch: Merkle root over (resolution-5 parent cell, cityId) leaves.
    bytes32 public cityRegionRoot;
    /// @notice G5 patch: claims accepted per risk-graph cluster per city.
    uint32 public maxDeedsPerCluster;
    mapping(uint32 cityId => mapping(bytes32 clusterId => uint32 count)) public clusterClaimCount;
    /// @notice G5 patch: deeds a city may hold in total. Zero means closed.
    mapping(uint32 cityId => uint32 cap) public cityWideCap;
    /// @notice G5 patch: claims accepted per city per UTC day.
    uint32 public maxClaimsPerCityPerDay;
    mapping(uint32 cityId => mapping(uint64 day => uint32 count)) public cityClaimsOnDay;
    /// @notice G5 patch: lifetime ceiling on claims through this contract.
    uint256 public maxTotalClaims;
    /// @notice Claims accepted so far. Monotonic: never decreases, also used as the claim id.
    uint256 public totalClaims;

    // ---- void lifecycle (RESEARCH/PROPOSED) ----
    uint8 public constant CLAIM_LIVE = 1;
    uint8 public constant CLAIM_VOIDED_FAULT = 2;
    uint8 public constant CLAIM_VOIDED_ADMIN_RESTORED = 3;
    uint8 public constant CLAIM_VOIDED_ADMIN_NOT_RESTORED = 4;
    /// @notice Wait after a restoring void before the cluster may claim in that city again.
    uint64 public constant RECLAIM_COOLDOWN = 7 days;
    /// @notice Period after a FAULT void during which it may be reclassified as administrative.
    uint64 public constant APPEAL_WINDOW = 30 days;

    struct ClaimRecord {
        address claimant;
        uint32 cityId;
        uint8 status;
        uint64 voidedAt;
        bytes32 clusterId;
        uint256 tokenId;
    }
    mapping(uint256 claimId => ClaimRecord) public claimRecord;
    /// @notice Live claim id behind a deed; cleared on void.
    mapping(uint256 tokenId => uint256 claimId) public claimIdOfToken;
    /// @notice Whether a (city, cluster) has already used its one capacity restoration.
    mapping(uint32 cityId => mapping(bytes32 clusterId => bool used)) public clusterRestorationUsed;
    /// @notice Earliest time a restored (city, cluster) may claim again.
    mapping(uint32 cityId => mapping(bytes32 clusterId => uint64 at)) public clusterReclaimAfter;

    // ---- signer roles (RESEARCH/PROPOSED) ----
    /// @notice Independent role that must approve every new eligibility signer.
    bytes32 public constant SIGNER_APPROVER_ROLE = keccak256("MOVENRUN_SIGNER_APPROVER_ROLE");
    /// @notice Lifetime of a signer approval.
    uint64 public constant SIGNER_APPROVAL_TTL = 7 days;
    mapping(address signer => uint64 expiresAt) public signerApprovalExpiry;

    event DeedClaimed(
        uint256 indexed tokenId,
        address indexed claimant,
        uint32 indexed cityId,
        uint256 burnedFee,
        uint16 rulesVersion
    );
    event EligibilitySignerUpdated(address indexed previousSigner, address indexed newSigner);
    event EligibilityThresholdsUpdated(
        uint32 minTenureDays,
        uint32 minDistinctCrossers,
        uint32 minTrafficDays
    );
    event RulesVersionUpdated(uint16 previousVersion, uint16 newVersion);
    event ClaimsPauseUpdated(bool paused, address indexed actor);
    event EligibilitySignerRegistered(address indexed signer, bool registered);
    event AttestationThresholdUpdated(uint8 threshold);
    event CityRegionRootUpdated(bytes32 root);
    event IssuanceLimitsUpdated(uint32 maxDeedsPerCluster, uint32 maxClaimsPerCityPerDay, uint256 maxTotalClaims);
    event CityWideCapUpdated(uint32 indexed cityId, uint32 cap);
    event ClaimEvidence(uint256 indexed tokenId, bytes32 indexed clusterId, bytes32 evidenceHash);
    event ClaimVoided(uint256 indexed claimId, uint256 indexed tokenId, address indexed holder, uint8 status);
    event ClusterCapacityRestored(uint256 indexed claimId, uint32 indexed cityId, bytes32 indexed clusterId, uint64 reclaimAfter);
    event FaultVoidReclassified(uint256 indexed claimId, uint8 status);
    event SignerAdditionApproved(address indexed signer, uint64 expiresAt, address approver);

    error ZeroAddress();
    error ClaimsArePaused();
    error AttestationExpired(uint64 expiry);
    error AttestationAlreadyUsed(uint256 nonce);
    error WrongClaimant(address expected, address actual);
    error UnexpectedRulesVersion(uint16 provided, uint16 expected);
    error InvalidAttestationSignature();
    error GroundNotSolid();
    error RelatedTrafficNotExcluded();
    error TenureTooShort(uint32 provided, uint32 required);
    error TooFewDistinctCrossers(uint32 provided, uint32 required);
    error TooFewTrafficDays(uint32 provided, uint32 required);
    error CityCapNotConfigured(uint32 cityId);
    error HolderCityCapReached(address claimant, uint32 cityId, uint256 capPerHolder);
    error ClaimFeeAboveMaximum(uint256 quotedFee, uint256 maxFee);
    error SingleSignerClaimsDisabled();
    error ThresholdNotMet(uint256 provided, uint256 required);
    error SignersNotAscendingOrUnknown(address signer);
    error ThresholdTooLow(uint8 threshold);
    error CityRegionsNotCommitted();
    error CellNotInCity(uint64 h3CellId, uint32 cityId);
    error MissingCluster();
    error ClusterCapReached(bytes32 clusterId, uint32 cityId);
    error CityWideCapReached(uint32 cityId, uint32 cap);
    error CityDailyClaimLimitReached(uint32 cityId);
    error TotalClaimCeilingReached(uint256 ceiling);
    error NotDeedContract();
    error ClusterReclaimCoolingDown(bytes32 clusterId, uint32 cityId, uint64 reclaimAfter);
    error NotAFaultVoid(uint256 claimId);
    error AppealWindowClosed(uint256 claimId, uint64 closedAt);
    error SignerAdditionNotApproved(address signer);

    /// @param admin Delayed administrator, expected to be MovenRunTimelock.
    /// @param guardian Emergency address permitted to pause new claims only.
    /// @param moveToken_ MovenRun MOVE token.
    /// @param deed_ MovenRun deed collection.
    /// @param eligibilitySigner_ Signer of eligibility attestations.
    /// @param initialRulesVersion Rules version new attestations must declare.
    constructor(
        address admin,
        address guardian,
        address moveToken_,
        address deed_,
        address eligibilitySigner_,
        uint16 initialRulesVersion
    ) EIP712("MovenRunDeedClaims", "3") {
        if (
            admin == address(0) ||
            guardian == address(0) ||
            moveToken_ == address(0) ||
            deed_ == address(0) ||
            eligibilitySigner_ == address(0)
        ) revert ZeroAddress();

        moveToken = IMovenRunToken(moveToken_);
        deed = IMovenRunDeed(deed_);
        eligibilitySigner = eligibilitySigner_;
        isEligibilitySigner[eligibilitySigner_] = true;
        eligibilitySignerCount = 1;
        attestationThreshold = MIN_ATTESTATION_THRESHOLD;
        maxDeedsPerCluster = 1;
        maxClaimsPerCityPerDay = 5;
        maxTotalClaims = 1_000;
        rulesVersion = initialRulesVersion;

        minTenureDays = 21;
        minDistinctCrossers = 30;
        minTrafficDays = 10;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GUARDIAN_ROLE, guardian);
        // G5 patch: the approver role administers itself, so DEFAULT_ADMIN cannot grant it.
        // The constructor signature is unchanged, so the guardian holds it initially; a real
        // deployment would hand it to a security council distinct from the timelock proposer.
        _setRoleAdmin(SIGNER_APPROVER_ROLE, SIGNER_APPROVER_ROLE);
        _grantRole(SIGNER_APPROVER_ROLE, guardian);

        emit EligibilityThresholdsUpdated(21, 30, 10);
    }

    // ---------------------------------------------------------------------
    // Claiming
    // ---------------------------------------------------------------------

    /// @notice G5 patch: single-signer claims are disabled; use claimWithThreshold.
    function claim(EligibilityAttestation calldata, bytes calldata, uint256) external pure returns (uint256) {
        revert SingleSignerClaimsDisabled();
    }

    /// @notice G5 patch: claims a deed under a threshold attestation and a city-region proof.
    /// @param signatures One signature per signer, ordered by ascending signer address.
    /// @param cityProof Merkle proof that the cell's resolution-5 parent belongs to the city.
    function claimWithThreshold(
        EligibilityAttestation calldata attestation,
        bytes[] calldata signatures,
        bytes32[] calldata cityProof,
        uint256 maxFee
    ) external nonReentrant returns (uint256 tokenId) {
        if (claimsPaused) revert ClaimsArePaused();
        if (block.timestamp > attestation.expiry) revert AttestationExpired(attestation.expiry);
        if (attestation.claimant != msg.sender) revert WrongClaimant(attestation.claimant, msg.sender);
        if (attestation.rulesVersion != rulesVersion) {
            revert UnexpectedRulesVersion(attestation.rulesVersion, rulesVersion);
        }
        if (attestationNonceUsed[attestation.nonce]) {
            revert AttestationAlreadyUsed(attestation.nonce);
        }
        _verifyThreshold(hashAttestation(attestation), signatures);

        if (!attestation.solidGround) revert GroundNotSolid();
        if (!attestation.relatedTrafficExcluded) revert RelatedTrafficNotExcluded();
        if (attestation.tenureDays < minTenureDays) {
            revert TenureTooShort(attestation.tenureDays, minTenureDays);
        }
        if (attestation.distinctCrossers < minDistinctCrossers) {
            revert TooFewDistinctCrossers(attestation.distinctCrossers, minDistinctCrossers);
        }
        if (attestation.trafficDays < minTrafficDays) {
            revert TooFewTrafficDays(attestation.trafficDays, minTrafficDays);
        }

        _verifyCity(attestation.h3CellId, attestation.cityId, cityProof);
        _applyIssuanceLimits(attestation.cityId, attestation.clusterId);

        (uint256 capPerHolder, bool cityConfigured) = deed.cityConcentrationCap(attestation.cityId);
        if (!cityConfigured) revert CityCapNotConfigured(attestation.cityId);
        if (deed.holderCityCapacityRemaining(msg.sender, attestation.cityId) == 0) {
            revert HolderCityCapReached(msg.sender, attestation.cityId, capPerHolder);
        }
        if (attestation.claimFee > maxFee) {
            revert ClaimFeeAboveMaximum(attestation.claimFee, maxFee);
        }

        attestationNonceUsed[attestation.nonce] = true;
        if (attestation.claimFee > 0) {
            moveToken.burnFrom(msg.sender, attestation.claimFee);
        }
        tokenId = deed.mintDeed(msg.sender, attestation.h3CellId, attestation.cityId);
        {
            uint256 claimId = totalClaims;
            claimRecord[claimId] = ClaimRecord({
                claimant: msg.sender,
                cityId: attestation.cityId,
                status: CLAIM_LIVE,
                voidedAt: 0,
                clusterId: attestation.clusterId,
                tokenId: tokenId
            });
            claimIdOfToken[tokenId] = claimId;
        }

        emit ClaimEvidence(tokenId, attestation.clusterId, attestation.evidenceHash);
        emit DeedClaimed(tokenId, msg.sender, attestation.cityId, attestation.claimFee, attestation.rulesVersion);
    }

    function _verifyThreshold(bytes32 digest, bytes[] calldata signatures) private view {
        uint256 required = attestationThreshold;
        if (signatures.length < required) revert ThresholdNotMet(signatures.length, required);
        address previous = address(0);
        for (uint256 i = 0; i < signatures.length; ++i) {
            address signer = ECDSA.recover(digest, signatures[i]);
            // Ascending order makes every signer count once; unknown signers are refused.
            if (signer <= previous || !isEligibilitySigner[signer]) revert SignersNotAscendingOrUnknown(signer);
            previous = signer;
        }
    }

    function _verifyCity(uint64 h3CellId, uint32 cityId, bytes32[] calldata proof) private view {
        bytes32 root = cityRegionRoot;
        if (root == bytes32(0)) revert CityRegionsNotCommitted();
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(parentCell(h3CellId), cityId))));
        if (!MerkleProof.verifyCalldata(proof, root, leaf)) revert CellNotInCity(h3CellId, cityId);
    }

    function _applyIssuanceLimits(uint32 cityId, bytes32 clusterId) private {
        if (clusterId == bytes32(0)) revert MissingCluster();
        {
            uint64 reclaimAfter = clusterReclaimAfter[cityId][clusterId];
            if (block.timestamp < reclaimAfter) revert ClusterReclaimCoolingDown(clusterId, cityId, reclaimAfter);
        }
        uint32 clusterCount = clusterClaimCount[cityId][clusterId];
        if (clusterCount >= maxDeedsPerCluster) revert ClusterCapReached(clusterId, cityId);
        uint32 cityCap = cityWideCap[cityId];
        if (deed.cityDeedCount(cityId) >= cityCap) revert CityWideCapReached(cityId, cityCap);
        uint64 day = uint64(block.timestamp / 1 days);
        uint32 today = cityClaimsOnDay[cityId][day];
        if (today >= maxClaimsPerCityPerDay) revert CityDailyClaimLimitReached(cityId);
        if (totalClaims >= maxTotalClaims) revert TotalClaimCeilingReached(maxTotalClaims);
        clusterClaimCount[cityId][clusterId] = clusterCount + 1;
        cityClaimsOnDay[cityId][day] = today + 1;
        totalClaims += 1;
    }

    // ---------------------------------------------------------------------
    // G5 patch: void lifecycle
    // ---------------------------------------------------------------------

    /// @notice Called by MovenRunDeed when a pending deed is voided.
    function onDeedVoided(uint256 tokenId, address holder, bool administrative) external {
        if (msg.sender != address(deed)) revert NotDeedContract();
        uint256 claimId = claimIdOfToken[tokenId];
        ClaimRecord storage r = claimRecord[claimId];
        if (claimId == 0 || r.status != CLAIM_LIVE || r.tokenId != tokenId) return;
        delete claimIdOfToken[tokenId];
        r.voidedAt = uint64(block.timestamp);
        r.status = administrative ? _restoreOnce(claimId, r) : CLAIM_VOIDED_FAULT;
        emit ClaimVoided(claimId, tokenId, holder, r.status);
    }

    /// @notice Reclassifies a FAULT void as administrative after a successful appeal.
    ///         Delayed administration only, once, within APPEAL_WINDOW. Restores claim
    ///         capacity under the same one-time rule; never reinstates the deed.
    function reclassifyFaultVoid(uint256 claimId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        ClaimRecord storage r = claimRecord[claimId];
        if (r.status != CLAIM_VOIDED_FAULT) revert NotAFaultVoid(claimId);
        uint64 closesAt = r.voidedAt + APPEAL_WINDOW;
        if (block.timestamp > closesAt) revert AppealWindowClosed(claimId, closesAt);
        r.status = _restoreOnce(claimId, r);
        emit FaultVoidReclassified(claimId, r.status);
    }

    function _restoreOnce(uint256 claimId, ClaimRecord storage r) private returns (uint8) {
        uint32 cityId = r.cityId;
        bytes32 clusterId = r.clusterId;
        if (clusterRestorationUsed[cityId][clusterId]) return CLAIM_VOIDED_ADMIN_NOT_RESTORED;
        clusterRestorationUsed[cityId][clusterId] = true;
        uint32 count = clusterClaimCount[cityId][clusterId];
        if (count > 0) clusterClaimCount[cityId][clusterId] = count - 1;
        uint64 reclaimAfter = uint64(block.timestamp) + RECLAIM_COOLDOWN;
        clusterReclaimAfter[cityId][clusterId] = reclaimAfter;
        emit ClusterCapacityRestored(claimId, cityId, clusterId, reclaimAfter);
        return CLAIM_VOIDED_ADMIN_RESTORED;
    }

    /// @notice Parent of an H3 cell at CITY_REGION_RESOLUTION (resolution field set, finer digits unused).
    function parentCell(uint64 h3CellId) public pure returns (uint64) {
        uint64 lowBits = 3 * (15 - uint64(CITY_REGION_RESOLUTION));
        uint64 lowMask = (uint64(1) << lowBits) - 1;
        uint64 cleared = h3CellId & ~(uint64(0xF) << 52) & ~lowMask;
        return cleared | (uint64(CITY_REGION_RESOLUTION) << 52) | lowMask;
    }

    /// @notice EIP-712 digest the eligibility signer authorizes.
    function hashAttestation(EligibilityAttestation calldata attestation)
        public
        view
        returns (bytes32)
    {
        return
            _hashTypedDataV4(
                // G5 patch: two static-word blocks, byte-identical to one abi.encode of every
                // field (all fields are static), split only to stay within the stack limit.
                keccak256(
                    bytes.concat(
                        abi.encode(
                            ELIGIBILITY_ATTESTATION_TYPEHASH,
                            attestation.claimant,
                            attestation.h3CellId,
                            attestation.cityId,
                            attestation.solidGround,
                            attestation.tenureDays,
                            attestation.distinctCrossers,
                            attestation.trafficDays
                        ),
                        abi.encode(
                            attestation.relatedTrafficExcluded,
                            attestation.clusterId,
                            attestation.evidenceHash,
                            attestation.claimFee,
                            attestation.rulesVersion,
                            attestation.nonce,
                            attestation.expiry
                        )
                    )
                )
            );
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Per-holder concentration cap for a city, and whether the city is configured.
    /// @dev Held on MovenRunDeed, which is where every ownership change is measured against it.
    function cityConcentrationCap(uint32 cityId)
        external
        view
        returns (uint256 capPerHolder, bool configured)
    {
        return deed.cityConcentrationCap(cityId);
    }

    /// @notice Whether `claimant` could currently claim another deed in a city.
    /// @dev A city is never closed as a whole: this answers for one holder at a time.
    function cityClaimsOpenFor(address claimant, uint32 cityId) external view returns (bool) {
        (, bool configured) = deed.cityConcentrationCap(cityId);
        return !claimsPaused && configured && deed.holderCityCapacityRemaining(claimant, cityId) > 0;
    }

    // ---------------------------------------------------------------------
    // Administration
    // ---------------------------------------------------------------------

    /// @notice Updates the three adjustable eligibility hypotheses. Delayed administration only.
    function setEligibilityThresholds(
        uint32 newMinTenureDays,
        uint32 newMinDistinctCrossers,
        uint32 newMinTrafficDays
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        minTenureDays = newMinTenureDays;
        minDistinctCrossers = newMinDistinctCrossers;
        minTrafficDays = newMinTrafficDays;
        emit EligibilityThresholdsUpdated(newMinTenureDays, newMinDistinctCrossers, newMinTrafficDays);
    }

    /// @notice Rotates the eligibility signer. Delayed administration only.
    function setEligibilitySigner(address newSigner) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newSigner == address(0)) revert ZeroAddress();
        if (!isEligibilitySigner[newSigner]) _consumeSignerApproval(newSigner);
        emit EligibilitySignerUpdated(eligibilitySigner, newSigner);
        // G5 patch: rotation keeps the signer registry consistent.
        if (isEligibilitySigner[eligibilitySigner]) {
            isEligibilitySigner[eligibilitySigner] = false;
            eligibilitySignerCount -= 1;
        }
        if (!isEligibilitySigner[newSigner]) {
            isEligibilitySigner[newSigner] = true;
            eligibilitySignerCount += 1;
        }
        eligibilitySigner = newSigner;
    }

    /// @notice Updates the rules version new attestations must declare.
    function setRulesVersion(uint16 newVersion) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit RulesVersionUpdated(rulesVersion, newVersion);
        rulesVersion = newVersion;
    }

    /// @notice G5 patch: registers or removes an eligibility signer. Delayed administration only.
    function setEligibilitySignerRegistered(address signer, bool registered) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (signer == address(0)) revert ZeroAddress();
        if (isEligibilitySigner[signer] == registered) return;
        if (registered) _consumeSignerApproval(signer);
        isEligibilitySigner[signer] = registered;
        if (registered) eligibilitySignerCount += 1;
        else eligibilitySignerCount -= 1;
        emit EligibilitySignerRegistered(signer, registered);
    }

    /// @notice G5 patch: approves one future signer addition. SIGNER_APPROVER_ROLE only.
    function approveEligibilitySignerAddition(address signer) external onlyRole(SIGNER_APPROVER_ROLE) {
        if (signer == address(0)) revert ZeroAddress();
        uint64 expiresAt = uint64(block.timestamp) + SIGNER_APPROVAL_TTL;
        signerApprovalExpiry[signer] = expiresAt;
        emit SignerAdditionApproved(signer, expiresAt, msg.sender);
    }

    /// @notice G5 patch: withdraws an unused signer approval. SIGNER_APPROVER_ROLE only.
    function revokeEligibilitySignerApproval(address signer) external onlyRole(SIGNER_APPROVER_ROLE) {
        delete signerApprovalExpiry[signer];
        emit SignerAdditionApproved(signer, 0, msg.sender);
    }

    function _consumeSignerApproval(address signer) private {
        if (block.timestamp > signerApprovalExpiry[signer]) revert SignerAdditionNotApproved(signer);
        delete signerApprovalExpiry[signer];
    }

    /// @notice G5 patch: sets the attestation threshold, never below two. Delayed administration only.
    function setAttestationThreshold(uint8 threshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (threshold < MIN_ATTESTATION_THRESHOLD) revert ThresholdTooLow(threshold);
        attestationThreshold = threshold;
        emit AttestationThresholdUpdated(threshold);
    }

    /// @notice G5 patch: commits the city-region Merkle root. Delayed administration only.
    function setCityRegionRoot(bytes32 root) external onlyRole(DEFAULT_ADMIN_ROLE) {
        cityRegionRoot = root;
        emit CityRegionRootUpdated(root);
    }

    /// @notice G5 patch: sets a city-wide deed cap. Delayed administration only.
    function setCityWideCap(uint32 cityId, uint32 cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        cityWideCap[cityId] = cap;
        emit CityWideCapUpdated(cityId, cap);
    }

    /// @notice G5 patch: sets cluster, daily and lifetime issuance limits. Delayed administration only.
    function setIssuanceLimits(uint32 perCluster, uint32 perCityPerDay, uint256 total)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        maxDeedsPerCluster = perCluster;
        maxClaimsPerCityPerDay = perCityPerDay;
        maxTotalClaims = total;
        emit IssuanceLimitsUpdated(perCluster, perCityPerDay, total);
    }

    /// @notice Pauses new deed claims. Existing deeds remain freely transferable.
    function pauseClaims() external onlyRole(GUARDIAN_ROLE) {
        claimsPaused = true;
        emit ClaimsPauseUpdated(true, msg.sender);
    }

    /// @notice Resumes deed claims. Delayed administration only.
    function unpauseClaims() external onlyRole(DEFAULT_ADMIN_ROLE) {
        claimsPaused = false;
        emit ClaimsPauseUpdated(false, msg.sender);
    }
}
