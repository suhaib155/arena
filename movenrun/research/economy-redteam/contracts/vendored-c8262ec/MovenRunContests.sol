// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IMovenRunToken} from "./interfaces/IMovenRunToken.sol";
import {IMovenRunDeed} from "./interfaces/IMovenRunDeed.sol";

/// @title MovenRunContests
/// @notice Escrowed, time-boxed contests for existing MovenRun deeds.
/// @dev A validly declared contest moves the deed into escrow immediately and without the
///      defender's ERC-721 approval, so a holder cannot block a contest by withholding it.
///      Once escrowed, the contest always reaches a settleable state: settlement is callable
///      by anybody after the scoring window and the loser can neither refuse nor delay it.
///      Declaration also takes one of the challenger's city slots as a reservation, and fails
///      outright if they have none left, so the win branch never has to ask for capacity that
///      might since have gone. A validly declared contest therefore cannot become
///      un-settleable because the challenger has filled their own city concentration cap in
///      the meantime; settlement consumes the reservation on a win and releases it on a loss.
///      Timings, cooldowns and the fortification ceiling are fixed constants. There are no
///      paid score boosts and no paid time extensions. Pausing blocks only new declarations.
contract MovenRunContests is AccessControl, EIP712, ReentrancyGuard {
    /// @notice Role permitted to pause new contest declarations and nothing else.
    bytes32 public constant GUARDIAN_ROLE = keccak256("MOVENRUN_GUARDIAN_ROLE");

    /// @notice Notice period between declaration and the start of scoring.
    uint64 public constant NOTICE_PERIOD = 72 hours;
    /// @notice Length of the scoring window.
    uint64 public constant SCORING_WINDOW = 7 days;
    /// @notice Number of scoring days inside the window.
    uint8 public constant SCORING_DAYS = 7;
    /// @notice Number of scoring days that count towards a side's total.
    uint8 public constant COUNTED_SCORING_DAYS = 3;
    /// @notice Cooldown a losing challenger serves before declaring again.
    uint64 public constant CHALLENGER_COOLDOWN = 30 days;
    /// @notice Peace period a deed enjoys after its holder survives a contest.
    uint64 public constant DEFENDER_PEACE_PERIOD = 14 days;
    /// @notice Lower bound of the configurable current-holder home advantage.
    uint16 public constant MIN_HOME_ADVANTAGE_BPS = 500;
    /// @notice Upper bound of the configurable current-holder home advantage.
    uint16 public constant MAX_HOME_ADVANTAGE_BPS = 1_000;
    /// @notice Ceiling on a defender's fortification contribution.
    uint16 public constant MAX_FORTIFICATION_BPS = 1_500;
    /// @notice Basis-point denominator.
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice EIP-712 type of a contest declaration authorization.
    bytes32 public constant DECLARATION_AUTHORIZATION_TYPEHASH =
        keccak256(
            "ContestDeclarationAuthorization(address challenger,uint256 tokenId,uint16 fortificationBps,uint256 entryFee,uint16 rulesVersion,uint256 nonce,uint64 expiry)"
        );

    /// @notice EIP-712 type of a contest-scoped daily score authorization.
    bytes32 public constant SCORE_AUTHORIZATION_TYPEHASH =
        keccak256(
            "ContestScoreAuthorization(uint256 contestId,address participant,uint8 scoringDay,uint256 score,uint16 rulesVersion,uint256 nonce,uint64 expiry)"
        );

    struct DeclarationAuthorization {
        address challenger;
        uint256 tokenId;
        uint16 fortificationBps;
        uint256 entryFee;
        uint16 rulesVersion;
        uint256 nonce;
        uint64 expiry;
    }

    struct ScoreAuthorization {
        uint256 contestId;
        address participant;
        uint8 scoringDay;
        uint256 score;
        uint16 rulesVersion;
        uint256 nonce;
        uint64 expiry;
    }

    struct Contest {
        uint256 tokenId;
        address challenger;
        address defender;
        uint64 declaredAt;
        uint64 scoringStart;
        uint64 scoringEnd;
        uint16 homeAdvantageBps;
        uint16 fortificationBps;
        bool settled;
        address winner;
    }

    /// @dev Running best three daily scores for one side of one contest.
    struct SideScore {
        uint128 best1;
        uint128 best2;
        uint128 best3;
        uint8 submittedDays;
    }

    /// @notice The MovenRun MOVE token. Declaration fees are burned through it.
    IMovenRunToken public immutable moveToken;
    /// @notice The deed collection contested through this contract.
    IMovenRunDeed public immutable deed;

    /// @notice Signer of contest declaration and daily score authorizations.
    address public contestSigner;
    /// @notice Rules version new authorizations must declare.
    uint16 public rulesVersion;
    /// @notice Current-holder home advantage, configurable only inside the fixed bounds.
    uint16 public homeAdvantageBps;
    /// @notice True while new contest declarations are paused. Active contests still settle.
    bool public declarationsPaused;

    /// @notice Identifier assigned to the most recent contest.
    uint256 public lastContestId;

    mapping(uint256 contestId => Contest contest) private _contests;
    mapping(uint256 contestId => mapping(address participant => SideScore score)) private _scores;

    /// @notice Identifier of the contest currently holding a deed, or zero.
    mapping(uint256 tokenId => uint256 contestId) public activeContestOf;
    /// @notice Time before which a losing challenger may not declare again.
    mapping(address challenger => uint64 until) public challengerCooldownUntil;
    /// @notice Time before which a surviving deed may not be contested again.
    mapping(uint256 tokenId => uint64 until) public deedPeaceUntil;
    /// @notice Single-use authorization nonces, shared across declarations and scores.
    mapping(uint256 nonce => bool used) public authorizationNonceUsed;

    event ContestDeclared(
        uint256 indexed contestId,
        uint256 indexed tokenId,
        address indexed challenger,
        address defender,
        uint64 scoringStart,
        uint64 scoringEnd,
        uint16 homeAdvantageBps,
        uint16 fortificationBps,
        uint256 burnedEntryFee
    );
    event ContestScoreSubmitted(
        uint256 indexed contestId,
        address indexed participant,
        uint8 scoringDay,
        uint256 score
    );
    event ContestSettled(
        uint256 indexed contestId,
        uint256 indexed tokenId,
        address indexed winner,
        uint256 challengerTotal,
        uint256 defenderTotal,
        address settledBy
    );
    event ContestCapacityReserved(uint256 indexed contestId, address indexed challenger, uint32 indexed cityId);
    event ContestSignerUpdated(address indexed previousSigner, address indexed newSigner);
    event HomeAdvantageUpdated(uint16 previousBps, uint16 newBps);
    event RulesVersionUpdated(uint16 previousVersion, uint16 newVersion);
    event DeclarationsPauseUpdated(bool paused, address indexed actor);

    error ZeroAddress();
    error DeclarationsArePaused();
    error AuthorizationExpired(uint64 expiry);
    error AuthorizationAlreadyUsed(uint256 nonce);
    error UnexpectedRulesVersion(uint16 provided, uint16 expected);
    error WrongChallenger(address expected, address actual);
    error InvalidDeclarationSignature();
    error InvalidScoreSignature();
    error ContestAlreadyActive(uint256 tokenId, uint256 contestId);
    error ChallengerIsHolder();
    error ChallengerInCooldown(uint64 until);
    error DeedInPeacePeriod(uint64 until);
    error FortificationAboveCeiling(uint16 provided, uint16 ceiling);
    error EntryFeeAboveMaximum(uint256 quotedFee, uint256 maxFee);
    error HomeAdvantageOutOfBounds(uint16 provided);
    error UnknownContest(uint256 contestId);
    error ContestAlreadySettled(uint256 contestId);
    error NotAContestant(address participant);
    error ScoringNotOpen(uint64 scoringStart, uint64 scoringEnd);
    error ScoringWindowNotFinished(uint64 scoringEnd);
    error InvalidScoringDay(uint8 scoringDay);
    error ScoringDayAlreadySubmitted(uint8 scoringDay);
    error ScoreOutOfRange(uint256 score);

    /// @param admin Delayed administrator, expected to be MovenRunTimelock.
    /// @param guardian Emergency address permitted to pause new declarations only.
    /// @param moveToken_ MovenRun MOVE token.
    /// @param deed_ MovenRun deed collection.
    /// @param contestSigner_ Signer of contest declaration and score authorizations.
    /// @param initialHomeAdvantageBps Home advantage, inside the fixed bounds.
    /// @param initialRulesVersion Rules version new authorizations must declare.
    constructor(
        address admin,
        address guardian,
        address moveToken_,
        address deed_,
        address contestSigner_,
        uint16 initialHomeAdvantageBps,
        uint16 initialRulesVersion
    ) EIP712("MovenRunContests", "3") {
        if (
            admin == address(0) ||
            guardian == address(0) ||
            moveToken_ == address(0) ||
            deed_ == address(0) ||
            contestSigner_ == address(0)
        ) revert ZeroAddress();
        if (
            initialHomeAdvantageBps < MIN_HOME_ADVANTAGE_BPS ||
            initialHomeAdvantageBps > MAX_HOME_ADVANTAGE_BPS
        ) revert HomeAdvantageOutOfBounds(initialHomeAdvantageBps);

        moveToken = IMovenRunToken(moveToken_);
        deed = IMovenRunDeed(deed_);
        contestSigner = contestSigner_;
        homeAdvantageBps = initialHomeAdvantageBps;
        rulesVersion = initialRulesVersion;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GUARDIAN_ROLE, guardian);
    }

    // ---------------------------------------------------------------------
    // Declaration
    // ---------------------------------------------------------------------

    /// @notice Declares a contest for a deed, burning the entry fee and escrowing the deed.
    /// @param authorization MovenRun statement covering exactly this challenger and deed.
    /// @param signature Contest signer's signature over the authorization.
    /// @param maxEntryFee Highest entry fee the caller is willing to have burned.
    function declareContest(
        DeclarationAuthorization calldata authorization,
        bytes calldata signature,
        uint256 maxEntryFee
    ) external nonReentrant returns (uint256 contestId) {
        if (declarationsPaused) revert DeclarationsArePaused();
        if (block.timestamp > authorization.expiry) revert AuthorizationExpired(authorization.expiry);
        if (authorization.challenger != msg.sender) {
            revert WrongChallenger(authorization.challenger, msg.sender);
        }
        if (authorization.rulesVersion != rulesVersion) {
            revert UnexpectedRulesVersion(authorization.rulesVersion, rulesVersion);
        }
        if (authorizationNonceUsed[authorization.nonce]) {
            revert AuthorizationAlreadyUsed(authorization.nonce);
        }
        if (ECDSA.recover(hashDeclaration(authorization), signature) != contestSigner) {
            revert InvalidDeclarationSignature();
        }
        if (authorization.fortificationBps > MAX_FORTIFICATION_BPS) {
            revert FortificationAboveCeiling(authorization.fortificationBps, MAX_FORTIFICATION_BPS);
        }
        if (authorization.entryFee > maxEntryFee) {
            revert EntryFeeAboveMaximum(authorization.entryFee, maxEntryFee);
        }

        uint256 tokenId = authorization.tokenId;
        {
            uint256 existing = activeContestOf[tokenId];
            if (existing != 0) revert ContestAlreadyActive(tokenId, existing);

            uint64 cooldownUntil = challengerCooldownUntil[msg.sender];
            if (block.timestamp < cooldownUntil) revert ChallengerInCooldown(cooldownUntil);

            uint64 peaceUntil = deedPeaceUntil[tokenId];
            if (block.timestamp < peaceUntil) revert DeedInPeacePeriod(peaceUntil);
        }

        address defender = deed.ownerOf(tokenId);
        if (defender == msg.sender) revert ChallengerIsHolder();

        authorizationNonceUsed[authorization.nonce] = true;
        contestId = ++lastContestId;

        _openContest(contestId, tokenId, defender, authorization.fortificationBps);

        // Take the challenger's city capacity now. This reverts the whole declaration when
        // they have none, which is the only point at which a capacity refusal is acceptable.
        uint32 cityId = deed.cityOf(tokenId);
        deed.reserveCitySlot(msg.sender, cityId);
        emit ContestCapacityReserved(contestId, msg.sender, cityId);

        if (authorization.entryFee > 0) {
            moveToken.burnFrom(msg.sender, authorization.entryFee);
        }

        deed.escrowToContests(tokenId);

        _emitContestDeclared(contestId, authorization.entryFee);
    }

    /// @dev Records a newly declared contest and marks the deed as carrying it.
    function _openContest(
        uint256 contestId,
        uint256 tokenId,
        address defender,
        uint16 fortificationBps
    ) private {
        uint64 scoringStart = uint64(block.timestamp) + NOTICE_PERIOD;

        _contests[contestId] = Contest({
            tokenId: tokenId,
            challenger: msg.sender,
            defender: defender,
            declaredAt: uint64(block.timestamp),
            scoringStart: scoringStart,
            scoringEnd: scoringStart + SCORING_WINDOW,
            homeAdvantageBps: homeAdvantageBps,
            fortificationBps: fortificationBps,
            settled: false,
            winner: address(0)
        });
        activeContestOf[tokenId] = contestId;
    }

    /// @dev Emitted from the stored record so the declaration path keeps a shallow stack.
    function _emitContestDeclared(uint256 contestId, uint256 burnedEntryFee) private {
        Contest storage contest = _contests[contestId];
        emit ContestDeclared(
            contestId,
            contest.tokenId,
            contest.challenger,
            contest.defender,
            contest.scoringStart,
            contest.scoringEnd,
            contest.homeAdvantageBps,
            contest.fortificationBps,
            burnedEntryFee
        );
    }

    // ---------------------------------------------------------------------
    // Scoring
    // ---------------------------------------------------------------------

    /// @notice Records one already-verified daily score for one side of one contest.
    /// @dev The authorization is bound to this exact contest, participant and scoring day,
    ///      expires, and is single-use, so a score can never be replayed onto another
    ///      contest, another day or another participant. Only the deterministic integer
    ///      score crosses the boundary; no route or movement detail is submitted or stored.
    function submitScore(ScoreAuthorization calldata authorization, bytes calldata signature)
        external
    {
        if (block.timestamp > authorization.expiry) revert AuthorizationExpired(authorization.expiry);
        if (authorization.rulesVersion != rulesVersion) {
            revert UnexpectedRulesVersion(authorization.rulesVersion, rulesVersion);
        }
        if (authorizationNonceUsed[authorization.nonce]) {
            revert AuthorizationAlreadyUsed(authorization.nonce);
        }
        if (ECDSA.recover(hashScore(authorization), signature) != contestSigner) {
            revert InvalidScoreSignature();
        }
        if (authorization.scoringDay >= SCORING_DAYS) {
            revert InvalidScoringDay(authorization.scoringDay);
        }
        if (authorization.score > type(uint128).max) revert ScoreOutOfRange(authorization.score);

        Contest storage contest = _contests[authorization.contestId];
        if (contest.challenger == address(0)) revert UnknownContest(authorization.contestId);
        if (contest.settled) revert ContestAlreadySettled(authorization.contestId);
        if (
            authorization.participant != contest.challenger &&
            authorization.participant != contest.defender
        ) revert NotAContestant(authorization.participant);
        if (block.timestamp < contest.scoringStart || block.timestamp > contest.scoringEnd) {
            revert ScoringNotOpen(contest.scoringStart, contest.scoringEnd);
        }

        SideScore storage side = _scores[authorization.contestId][authorization.participant];
        uint8 dayBit = uint8(1) << authorization.scoringDay;
        if (side.submittedDays & dayBit != 0) {
            revert ScoringDayAlreadySubmitted(authorization.scoringDay);
        }

        authorizationNonceUsed[authorization.nonce] = true;
        side.submittedDays |= dayBit;
        _recordBestThree(side, uint128(authorization.score));

        emit ContestScoreSubmitted(
            authorization.contestId,
            authorization.participant,
            authorization.scoringDay,
            authorization.score
        );
    }

    /// @dev Keeps only the best three daily scores for a side.
    function _recordBestThree(SideScore storage side, uint128 score) private {
        if (score > side.best1) {
            side.best3 = side.best2;
            side.best2 = side.best1;
            side.best1 = score;
        } else if (score > side.best2) {
            side.best3 = side.best2;
            side.best2 = score;
        } else if (score > side.best3) {
            side.best3 = score;
        }
    }

    // ---------------------------------------------------------------------
    // Settlement
    // ---------------------------------------------------------------------

    /// @notice Settles a contest whose scoring window has closed.
    /// @dev Callable by anybody. Neither side can refuse, delay or veto it, and no approval
    ///      from the losing side is involved in moving the deed out of escrow. The city
    ///      capacity the challenger reserved at declaration is what the deed hands them on a
    ///      win, so this path has no capacity check that could fail.
    function settleContest(uint256 contestId) external nonReentrant returns (address winner) {
        Contest storage contest = _contests[contestId];
        if (contest.challenger == address(0)) revert UnknownContest(contestId);
        if (contest.settled) revert ContestAlreadySettled(contestId);
        if (block.timestamp <= contest.scoringEnd) revert ScoringWindowNotFinished(contest.scoringEnd);

        uint256 challengerTotal = _sideTotal(_scores[contestId][contest.challenger]);
        uint256 defenderBase = _sideTotal(_scores[contestId][contest.defender]);
        uint256 defenderTotal = (defenderBase *
            (BPS_DENOMINATOR + contest.homeAdvantageBps + contest.fortificationBps)) / BPS_DENOMINATOR;

        // A tie leaves the deed with the current holder.
        winner = challengerTotal > defenderTotal ? contest.challenger : contest.defender;

        contest.settled = true;
        contest.winner = winner;
        uint256 tokenId = contest.tokenId;
        delete activeContestOf[tokenId];

        if (winner == contest.defender) {
            challengerCooldownUntil[contest.challenger] = uint64(block.timestamp) + CHALLENGER_COOLDOWN;
            deedPeaceUntil[tokenId] = uint64(block.timestamp) + DEFENDER_PEACE_PERIOD;
        }

        deed.settleContestEscrow(tokenId, contest.defender, contest.challenger, winner);

        emit ContestSettled(contestId, tokenId, winner, challengerTotal, defenderTotal, msg.sender);
    }

    function _sideTotal(SideScore storage side) private view returns (uint256) {
        return uint256(side.best1) + uint256(side.best2) + uint256(side.best3);
    }

    // ---------------------------------------------------------------------
    // Hashing and views
    // ---------------------------------------------------------------------

    /// @notice EIP-712 digest the contest signer authorizes for a declaration.
    function hashDeclaration(DeclarationAuthorization calldata authorization)
        public
        view
        returns (bytes32)
    {
        return
            _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        DECLARATION_AUTHORIZATION_TYPEHASH,
                        authorization.challenger,
                        authorization.tokenId,
                        authorization.fortificationBps,
                        authorization.entryFee,
                        authorization.rulesVersion,
                        authorization.nonce,
                        authorization.expiry
                    )
                )
            );
    }

    /// @notice EIP-712 digest the contest signer authorizes for a daily score.
    function hashScore(ScoreAuthorization calldata authorization) public view returns (bytes32) {
        return
            _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        SCORE_AUTHORIZATION_TYPEHASH,
                        authorization.contestId,
                        authorization.participant,
                        authorization.scoringDay,
                        authorization.score,
                        authorization.rulesVersion,
                        authorization.nonce,
                        authorization.expiry
                    )
                )
            );
    }

    /// @notice Full record of a contest.
    function contestOf(uint256 contestId) external view returns (Contest memory) {
        return _contests[contestId];
    }

    /// @notice Best three counted scores recorded for one side of a contest.
    function sideScoreOf(uint256 contestId, address participant)
        external
        view
        returns (SideScore memory)
    {
        return _scores[contestId][participant];
    }

    /// @notice Sum of a side's counted scores, before any home advantage or fortification.
    function sideTotalOf(uint256 contestId, address participant) external view returns (uint256) {
        return _sideTotal(_scores[contestId][participant]);
    }

    // ---------------------------------------------------------------------
    // Administration
    // ---------------------------------------------------------------------

    /// @notice Rotates the contest signer. Delayed administration only.
    function setContestSigner(address newSigner) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newSigner == address(0)) revert ZeroAddress();
        emit ContestSignerUpdated(contestSigner, newSigner);
        contestSigner = newSigner;
    }

    /// @notice Adjusts the current-holder home advantage inside its fixed bounds.
    function setHomeAdvantage(uint16 newHomeAdvantageBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (
            newHomeAdvantageBps < MIN_HOME_ADVANTAGE_BPS ||
            newHomeAdvantageBps > MAX_HOME_ADVANTAGE_BPS
        ) revert HomeAdvantageOutOfBounds(newHomeAdvantageBps);
        emit HomeAdvantageUpdated(homeAdvantageBps, newHomeAdvantageBps);
        homeAdvantageBps = newHomeAdvantageBps;
    }

    /// @notice Updates the rules version new authorizations must declare.
    function setRulesVersion(uint16 newVersion) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit RulesVersionUpdated(rulesVersion, newVersion);
        rulesVersion = newVersion;
    }

    /// @notice Pauses new contest declarations. Active contests remain settleable.
    function pauseDeclarations() external onlyRole(GUARDIAN_ROLE) {
        declarationsPaused = true;
        emit DeclarationsPauseUpdated(true, msg.sender);
    }

    /// @notice Resumes contest declarations. Delayed administration only.
    function unpauseDeclarations() external onlyRole(DEFAULT_ADMIN_ROLE) {
        declarationsPaused = false;
        emit DeclarationsPauseUpdated(false, msg.sender);
    }
}
