// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IMovenRunToken} from "./interfaces/IMovenRunToken.sol";
import {IMovenRunDeed} from "./interfaces/IMovenRunDeed.sol";

/// @title MovenRunDeedClaims
/// @notice Converts already-earned eligible solid ground into a permanent deed.
/// @dev A deed cannot be bought from MovenRun. The only way to create one is to present a
///      chain-bound, single-use, expiring eligibility attestation signed by the MovenRun
///      eligibility signer, which asserts that the claimant already holds the underlying
///      solid ground under the authoritative MovenRun service. The three numeric thresholds
///      are adjustable hypotheses held behind delayed administration and are visible onchain.
///      City concentration caps are explicit per city and unset until configured, so no claim
///      can be made in a city MovenRun has not deliberately opened. The claim fee comes from
///      the signed quote, is bounded by a caller-supplied maximum, and is genuinely burned.
contract MovenRunDeedClaims is AccessControl, EIP712, ReentrancyGuard {
    /// @notice Role permitted to pause new deed claims and nothing else.
    bytes32 public constant GUARDIAN_ROLE = keccak256("MOVENRUN_GUARDIAN_ROLE");

    /// @notice EIP-712 type of a deed eligibility attestation.
    bytes32 public constant ELIGIBILITY_ATTESTATION_TYPEHASH =
        keccak256(
            "DeedEligibilityAttestation(address claimant,uint64 h3CellId,uint32 cityId,bool solidGround,uint32 tenureDays,uint32 distinctCrossers,uint32 trafficDays,bool relatedTrafficExcluded,uint256 claimFee,uint16 rulesVersion,uint256 nonce,uint64 expiry)"
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

    mapping(uint32 cityId => uint256 cap) private _cityCap;
    mapping(uint32 cityId => bool configured) private _cityCapConfigured;
    mapping(uint256 nonce => bool used) public attestationNonceUsed;

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
    event CityConcentrationCapConfigured(uint32 indexed cityId, uint256 cap);
    event RulesVersionUpdated(uint16 previousVersion, uint16 newVersion);
    event ClaimsPauseUpdated(bool paused, address indexed actor);

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
    error CityCapReached(uint32 cityId, uint256 cap);
    error ClaimFeeAboveMaximum(uint256 quotedFee, uint256 maxFee);

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
        rulesVersion = initialRulesVersion;

        minTenureDays = 21;
        minDistinctCrossers = 30;
        minTrafficDays = 10;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GUARDIAN_ROLE, guardian);

        emit EligibilityThresholdsUpdated(21, 30, 10);
    }

    // ---------------------------------------------------------------------
    // Claiming
    // ---------------------------------------------------------------------

    /// @notice Claims the initial deed for eligible solid ground the caller already holds.
    /// @param attestation MovenRun eligibility statement covering exactly this claimant and cell.
    /// @param signature Eligibility signer's signature over the attestation.
    /// @param maxFee Highest claim fee the caller is willing to have burned.
    function claim(
        EligibilityAttestation calldata attestation,
        bytes calldata signature,
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
        if (ECDSA.recover(hashAttestation(attestation), signature) != eligibilitySigner) {
            revert InvalidAttestationSignature();
        }

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

        if (!_cityCapConfigured[attestation.cityId]) {
            revert CityCapNotConfigured(attestation.cityId);
        }
        uint256 cap = _cityCap[attestation.cityId];
        if (deed.cityDeedCount(attestation.cityId) >= cap) {
            revert CityCapReached(attestation.cityId, cap);
        }

        if (attestation.claimFee > maxFee) {
            revert ClaimFeeAboveMaximum(attestation.claimFee, maxFee);
        }

        attestationNonceUsed[attestation.nonce] = true;

        if (attestation.claimFee > 0) {
            moveToken.burnFrom(msg.sender, attestation.claimFee);
        }

        tokenId = deed.mintDeed(msg.sender, attestation.h3CellId, attestation.cityId);

        emit DeedClaimed(
            tokenId,
            msg.sender,
            attestation.cityId,
            attestation.claimFee,
            attestation.rulesVersion
        );
    }

    /// @notice EIP-712 digest the eligibility signer authorizes.
    function hashAttestation(EligibilityAttestation calldata attestation)
        public
        view
        returns (bytes32)
    {
        return
            _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        ELIGIBILITY_ATTESTATION_TYPEHASH,
                        attestation.claimant,
                        attestation.h3CellId,
                        attestation.cityId,
                        attestation.solidGround,
                        attestation.tenureDays,
                        attestation.distinctCrossers,
                        attestation.trafficDays,
                        attestation.relatedTrafficExcluded,
                        attestation.claimFee,
                        attestation.rulesVersion,
                        attestation.nonce,
                        attestation.expiry
                    )
                )
            );
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Configured concentration cap for a city, and whether it has been configured.
    function cityConcentrationCap(uint32 cityId) external view returns (uint256 cap, bool configured) {
        return (_cityCap[cityId], _cityCapConfigured[cityId]);
    }

    /// @notice Whether claims are currently possible in a city.
    function cityClaimsOpen(uint32 cityId) external view returns (bool) {
        return
            !claimsPaused &&
            _cityCapConfigured[cityId] &&
            deed.cityDeedCount(cityId) < _cityCap[cityId];
    }

    // ---------------------------------------------------------------------
    // Administration
    // ---------------------------------------------------------------------

    /// @notice Configures the concentration cap for a city. Delayed administration only.
    /// @dev No default exists. Until a city is configured here, no deed can be claimed in it.
    function configureCityConcentrationCap(uint32 cityId, uint256 cap)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        _cityCap[cityId] = cap;
        _cityCapConfigured[cityId] = true;
        emit CityConcentrationCapConfigured(cityId, cap);
    }

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
        emit EligibilitySignerUpdated(eligibilitySigner, newSigner);
        eligibilitySigner = newSigner;
    }

    /// @notice Updates the rules version new attestations must declare.
    function setRulesVersion(uint16 newVersion) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit RulesVersionUpdated(rulesVersion, newVersion);
        rulesVersion = newVersion;
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
