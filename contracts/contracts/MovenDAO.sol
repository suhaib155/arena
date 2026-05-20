// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./ZoneNFT.sol";

interface IBurnable {
    function burnFrom(address account, uint256 amount) external;
}

/// @notice 3-tier DAO governance:
///   CORE_ROLE       — emergency pause (team 2-of-3 multisig externally)
///   ZONE_GOVERNOR   — emission-rate votes requiring $ZONE balance, 67% quorum, 7-day timelock
///   ZONE_HOLDER     — local zone-rule votes requiring Zone NFT ownership
contract MovenDAO is Pausable, AccessControl, ReentrancyGuard {

    bytes32 public constant CORE_ROLE          = keccak256("CORE_ROLE");
    bytes32 public constant ZONE_GOVERNOR_ROLE = keccak256("ZONE_GOVERNOR_ROLE");
    bytes32 public constant ZONE_HOLDER_ROLE   = keccak256("ZONE_HOLDER_ROLE");

    uint256 public constant PROPOSAL_COST     = 250e18; // 250 MOVE burned
    uint256 public constant VOTING_PERIOD     = 7 days;
    uint256 public constant TIMELOCK_PERIOD   = 7 days;
    uint256 public constant GOVERNOR_QUORUM   = 67;     // 67 % of ZONE supply

    enum ProposalTier { ZONE_GOVERNOR, ZONE_HOLDER }

    struct Proposal {
        string        description;
        bytes         callData;
        address       target;
        ProposalTier  tier;
        uint256       forVotes;
        uint256       againstVotes;
        uint256       votingDeadline;
        uint256       executionTime;   // 0 until queued
        bool          executed;
        bool          cancelled;
    }

    IERC20   public zoneToken;
    ZoneNFT  public zoneNFT;
    IERC20   public moveToken;

    uint256  public proposalCount;
    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    event ProposalCreated(uint256 indexed id, address indexed proposer, ProposalTier tier, string description);
    event VoteCast(uint256 indexed id, address indexed voter, bool support, uint256 weight);
    event ProposalQueued(uint256 indexed id, uint256 executionTime);
    event ProposalExecuted(uint256 indexed id);
    event ProposalCancelled(uint256 indexed id);
    event EmergencyPause(address indexed caller);
    event EmergencyUnpause(address indexed caller);

    constructor(address moveToken_, address zoneToken_, address zoneNFT_) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(CORE_ROLE, msg.sender);

        moveToken = IERC20(moveToken_);
        zoneToken = IERC20(zoneToken_);
        zoneNFT   = ZoneNFT(zoneNFT_);
    }

    // ── Emergency pause (CORE_ROLE = team multisig) ────────────────────────────

    function emergencyPause() external onlyRole(CORE_ROLE) {
        _pause();
        emit EmergencyPause(msg.sender);
    }

    function emergencyUnpause() external onlyRole(CORE_ROLE) {
        _unpause();
        emit EmergencyUnpause(msg.sender);
    }

    // ── Proposal lifecycle ─────────────────────────────────────────────────────

    /// @notice Create a proposal. Costs 250 MOVE (burned from proposer).
    function propose(
        string    calldata description,
        bytes     calldata callData,
        address   target,
        ProposalTier tier
    ) external whenNotPaused nonReentrant returns (uint256 id) {
        // Burn 250 MOVE from proposer
        IBurnable(address(moveToken)).burnFrom(msg.sender, PROPOSAL_COST);

        // ZONE_GOVERNOR tier requires ZONE_GOVERNOR_ROLE
        if (tier == ProposalTier.ZONE_GOVERNOR) {
            require(hasRole(ZONE_GOVERNOR_ROLE, msg.sender) || zoneToken.balanceOf(msg.sender) > 0,
                "DAO: needs ZONE");
        }

        id = ++proposalCount;
        proposals[id] = Proposal({
            description:    description,
            callData:       callData,
            target:         target,
            tier:           tier,
            forVotes:       0,
            againstVotes:   0,
            votingDeadline: block.timestamp + VOTING_PERIOD,
            executionTime:  0,
            executed:       false,
            cancelled:      false
        });

        emit ProposalCreated(id, msg.sender, tier, description);
    }

    /// @notice Cast a vote. Weight = $ZONE balance for ZONE_GOVERNOR tier;
    ///         weight = 1 (NFT ownership) for ZONE_HOLDER tier.
    function vote(uint256 proposalId, bool support) external whenNotPaused {
        Proposal storage p = proposals[proposalId];
        require(!p.executed && !p.cancelled, "DAO: finished");
        require(block.timestamp <= p.votingDeadline, "DAO: voting ended");
        require(!hasVoted[proposalId][msg.sender], "DAO: already voted");

        hasVoted[proposalId][msg.sender] = true;

        uint256 weight;
        if (p.tier == ProposalTier.ZONE_GOVERNOR) {
            weight = zoneToken.balanceOf(msg.sender);
            require(weight > 0, "DAO: no ZONE balance");
        } else {
            // ZONE_HOLDER: any Zone NFT holder gets 1 vote
            require(zoneNFT.balanceOf(msg.sender) > 0, "DAO: no Zone NFT");
            weight = 1;
        }

        if (support) {
            p.forVotes += weight;
        } else {
            p.againstVotes += weight;
        }

        emit VoteCast(proposalId, msg.sender, support, weight);
    }

    /// @notice Queue a passed proposal for execution after timelock.
    function queue(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        require(!p.executed && !p.cancelled, "DAO: finished");
        require(block.timestamp > p.votingDeadline, "DAO: voting active");
        require(p.executionTime == 0, "DAO: already queued");
        require(_isPassed(p), "DAO: not passed");

        p.executionTime = block.timestamp + TIMELOCK_PERIOD;
        emit ProposalQueued(proposalId, p.executionTime);
    }

    /// @notice Execute a queued proposal after timelock.
    function execute(uint256 proposalId) external nonReentrant whenNotPaused {
        Proposal storage p = proposals[proposalId];
        require(!p.executed && !p.cancelled, "DAO: finished");
        require(p.executionTime > 0 && block.timestamp >= p.executionTime, "DAO: timelock");

        p.executed = true;

        (bool ok,) = p.target.call(p.callData);
        require(ok, "DAO: execution failed");

        emit ProposalExecuted(proposalId);
    }

    function cancel(uint256 proposalId) external onlyRole(CORE_ROLE) {
        proposals[proposalId].cancelled = true;
        emit ProposalCancelled(proposalId);
    }

    // ── Internal helpers ───────────────────────────────────────────────────────

    function _isPassed(Proposal storage p) internal view returns (bool) {
        uint256 totalVotes = p.forVotes + p.againstVotes;
        if (totalVotes == 0) return false;

        if (p.tier == ProposalTier.ZONE_GOVERNOR) {
            // 67% quorum of $ZONE supply
            uint256 supply = zoneToken.totalSupply();
            if (supply == 0) return false;
            // forVotes must be ≥ 67% of total supply (not just votes cast)
            return (p.forVotes * 100) / supply >= GOVERNOR_QUORUM;
        } else {
            // Simple majority for ZONE_HOLDER
            return p.forVotes > p.againstVotes;
        }
    }

    function isPassed(uint256 proposalId) external view returns (bool) {
        return _isPassed(proposals[proposalId]);
    }

    // ── Interface support ──────────────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
