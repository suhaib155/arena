// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./MoveToken.sol";
import "./MoveVault.sol";
import "./ZoneNFT.sol";

// MovenDAO: 3-tier governance
// Tier 1 (Core):      zone owners with >6 month loyalty — 3x voting weight (future)
// Tier 2 (Active):    wallets with ≥1000 $MOVE staked  — 1.5x voting weight
// Tier 3 (Community): any $MOVE holder                 — 1x voting weight
contract MovenDAO is AccessControl, ReentrancyGuard {
    bytes32 public constant DAO_ADMIN_ROLE = keccak256("DAO_ADMIN_ROLE");

    uint256 public constant VOTING_PERIOD   = 7 days;
    uint256 public constant EXECUTION_DELAY = 2 days;
    uint256 public constant QUORUM_BPS      = 1_000;

    MoveToken public moveToken;
    ZoneNFT   public zoneNFT;
    MoveVault public moveVault;

    enum ProposalState { Active, Succeeded, Defeated, Executed, Cancelled }
    enum ProposalType  { ParameterChange, TreasurySpend, ContractUpgrade, EmissionAdjust }

    struct Proposal {
        uint256      id;
        address      proposer;
        ProposalType pType;
        string       description;
        bytes        callData;
        address      target;
        uint256      startTime;
        uint256      endTime;
        uint256      forVotes;
        uint256      againstVotes;
        bool         executed;
        bool         cancelled;
    }

    uint256 public nextProposalId = 1;
    mapping(uint256 => Proposal)                    public proposals;
    mapping(uint256 => mapping(address => bool))    public hasVoted;

    event ProposalCreated(uint256 indexed id, address indexed proposer, ProposalType pType, string description);
    event Voted(uint256 indexed proposalId, address indexed voter, bool support, uint256 weight);
    event ProposalExecuted(uint256 indexed id);
    event ProposalCancelled(uint256 indexed id);

    constructor(address _moveToken, address _zoneNFT, address _moveVault) {
        moveToken = MoveToken(_moveToken);
        zoneNFT   = ZoneNFT(_zoneNFT);
        moveVault = MoveVault(_moveVault);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(DAO_ADMIN_ROLE, msg.sender);
    }

    function propose(
        ProposalType  pType,
        string calldata description,
        address       target,
        bytes calldata callData
    ) external returns (uint256 proposalId) {
        require(moveToken.balanceOf(msg.sender) >= 100 ether, "MovenDAO: need 100 $MOVE to propose");
        proposalId = nextProposalId++;
        proposals[proposalId] = Proposal({
            id:           proposalId,
            proposer:     msg.sender,
            pType:        pType,
            description:  description,
            callData:     callData,
            target:       target,
            startTime:    block.timestamp,
            endTime:      block.timestamp + VOTING_PERIOD,
            forVotes:     0,
            againstVotes: 0,
            executed:     false,
            cancelled:    false
        });
        emit ProposalCreated(proposalId, msg.sender, pType, description);
    }

    function vote(uint256 proposalId, bool support) external {
        Proposal storage p = proposals[proposalId];
        require(block.timestamp < p.endTime, "MovenDAO: voting ended");
        require(!hasVoted[proposalId][msg.sender], "MovenDAO: already voted");
        hasVoted[proposalId][msg.sender] = true;

        uint256 weight = _votingWeight(msg.sender);
        require(weight > 0, "MovenDAO: no voting weight");

        if (support) { p.forVotes += weight; } else { p.againstVotes += weight; }

        emit Voted(proposalId, msg.sender, support, weight);
    }

    function execute(uint256 proposalId) external nonReentrant {
        Proposal storage p = proposals[proposalId];
        require(!p.executed && !p.cancelled, "MovenDAO: invalid state");
        require(block.timestamp >= p.endTime + EXECUTION_DELAY, "MovenDAO: delay not elapsed");
        require(p.forVotes > p.againstVotes, "MovenDAO: not passed");

        uint256 quorum = (moveVault.totalStaked() * QUORUM_BPS) / 10_000;
        require(p.forVotes >= quorum, "MovenDAO: quorum not met");

        p.executed = true;
        (bool success, ) = p.target.call(p.callData);
        require(success, "MovenDAO: execution failed");

        emit ProposalExecuted(proposalId);
    }

    function cancel(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        require(msg.sender == p.proposer || hasRole(DAO_ADMIN_ROLE, msg.sender), "MovenDAO: not authorized");
        require(!p.executed, "MovenDAO: already executed");
        p.cancelled = true;
        emit ProposalCancelled(proposalId);
    }

    function getProposalState(uint256 proposalId) external view returns (ProposalState) {
        Proposal storage p = proposals[proposalId];
        if (p.cancelled) return ProposalState.Cancelled;
        if (p.executed)  return ProposalState.Executed;
        if (block.timestamp < p.endTime) return ProposalState.Active;
        if (p.forVotes > p.againstVotes) return ProposalState.Succeeded;
        return ProposalState.Defeated;
    }

    function _votingWeight(address voter) internal view returns (uint256) {
        (uint256 staked, , ) = _stakeInfo(voter);
        uint256 balance    = moveToken.balanceOf(voter);
        uint256 totalPower = staked + balance;
        if (staked >= 1_000 ether) return (totalPower * 15) / 10;
        return totalPower;
    }

    function _stakeInfo(address user) internal view returns (uint256 amount, uint256 stakedAt, uint256 lastClaim) {
        return moveVault.stakes(user);
    }
}
