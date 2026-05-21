// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./MoveToken.sol";

/// @title MoveVault — Staking, protocol-owned liquidity, and treasury management
/// @notice Users stake $MOVE to earn rewards proportional to their share of total staked.
///         The DAO can add protocol-owned liquidity and withdraw treasury funds.
///         All user-facing state-changing functions are protected against reentrancy.
contract MoveVault is AccessControl, ReentrancyGuard {
    bytes32 public constant VAULT_ADMIN_ROLE = keccak256("VAULT_ADMIN_ROLE");
    bytes32 public constant DAO_ROLE         = keccak256("DAO_ROLE");

    MoveToken public moveToken;

    struct StakeInfo {
        uint256 amount;
        uint256 stakedAt;
        uint256 lastRewardClaim;
    }
    mapping(address => StakeInfo) public stakes;
    uint256 public totalStaked;

    // $MOVE per second per staked $MOVE (set by DAO; expressed in 1e18 = 100%)
    uint256 public rewardRatePerSecond;

    uint256 public polBalance;       // protocol-owned liquidity in $MOVE
    uint256 public treasuryBalance;

    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 reward);
    event TreasuryDeposit(address indexed from, uint256 amount);
    event TreasuryWithdrawal(address indexed to, uint256 amount);
    event POLAdded(uint256 amount);

    constructor(address _moveToken, address admin) {
        moveToken = MoveToken(_moveToken);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(VAULT_ADMIN_ROLE, admin);
        _grantRole(DAO_ROLE, admin);
    }

    /// @notice Stake $MOVE. Pending rewards are claimed before the stake is updated.
    ///         Caller must have approved this contract for `amount`.
    /// @param amount $MOVE to stake
    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "MoveVault: zero amount");
        _claimReward(msg.sender);
        moveToken.transferFrom(msg.sender, address(this), amount);
        stakes[msg.sender].amount += amount;
        stakes[msg.sender].stakedAt = block.timestamp;
        stakes[msg.sender].lastRewardClaim = block.timestamp;
        totalStaked += amount;
        emit Staked(msg.sender, amount);
    }

    /// @notice Unstake $MOVE. Pending rewards are claimed before the withdrawal.
    /// @param amount $MOVE to withdraw
    function unstake(uint256 amount) external nonReentrant {
        require(stakes[msg.sender].amount >= amount, "MoveVault: insufficient stake");
        _claimReward(msg.sender);
        stakes[msg.sender].amount -= amount;
        totalStaked -= amount;
        moveToken.transfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    /// @notice Claim accumulated staking rewards.
    function claimReward() external nonReentrant {
        _claimReward(msg.sender);
    }

    /// @notice Returns the pending reward for a user without state changes.
    /// @param user Staker address
    function pendingReward(address user) external view returns (uint256) {
        uint256 elapsed = block.timestamp - stakes[user].lastRewardClaim;
        return (stakes[user].amount * rewardRatePerSecond * elapsed) / 1 ether;
    }

    /// @notice Deposit $MOVE into the treasury. Anyone may fund the treasury.
    /// @param amount $MOVE to deposit
    function depositTreasury(uint256 amount) external {
        moveToken.transferFrom(msg.sender, address(this), amount);
        treasuryBalance += amount;
        emit TreasuryDeposit(msg.sender, amount);
    }

    /// @notice Withdraw $MOVE from the treasury. Restricted to DAO_ROLE.
    /// @param to     Recipient address
    /// @param amount $MOVE to withdraw
    function withdrawTreasury(address to, uint256 amount) external onlyRole(DAO_ROLE) {
        require(treasuryBalance >= amount, "MoveVault: insufficient treasury");
        treasuryBalance -= amount;
        moveToken.transfer(to, amount);
        emit TreasuryWithdrawal(to, amount);
    }

    /// @notice Add protocol-owned liquidity. Restricted to VAULT_ADMIN_ROLE.
    /// @param amount $MOVE to lock as POL
    function addPOL(uint256 amount) external onlyRole(VAULT_ADMIN_ROLE) {
        moveToken.transferFrom(msg.sender, address(this), amount);
        polBalance += amount;
        emit POLAdded(amount);
    }

    /// @notice Update the staking reward rate. Restricted to DAO_ROLE.
    /// @param newRate New reward rate in $MOVE wei per second per staked $MOVE wei
    function setRewardRate(uint256 newRate) external onlyRole(DAO_ROLE) {
        rewardRatePerSecond = newRate;
    }

    function _claimReward(address user) internal {
        uint256 elapsed = block.timestamp - stakes[user].lastRewardClaim;
        uint256 reward = (stakes[user].amount * rewardRatePerSecond * elapsed) / 1 ether;
        stakes[user].lastRewardClaim = block.timestamp;
        if (reward > 0 && treasuryBalance >= reward) {
            treasuryBalance -= reward;
            moveToken.transfer(user, reward);
            emit RewardClaimed(user, reward);
        }
    }
}
