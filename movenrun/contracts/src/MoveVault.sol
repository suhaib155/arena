// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./MoveToken.sol";

// MoveVault: staking, protocol-owned liquidity (POL), treasury management
contract MoveVault is AccessControl, ReentrancyGuard {
    bytes32 public constant VAULT_ADMIN_ROLE = keccak256("VAULT_ADMIN_ROLE");
    bytes32 public constant DAO_ROLE = keccak256("DAO_ROLE");

    MoveToken public moveToken;

    // Staking state
    struct StakeInfo {
        uint256 amount;
        uint256 stakedAt;
        uint256 lastRewardClaim;
    }
    mapping(address => StakeInfo) public stakes;
    uint256 public totalStaked;

    // Reward rate: $MOVE per second per staked $MOVE (set by DAO)
    uint256 public rewardRatePerSecond;

    // Treasury assets
    uint256 public polBalance; // protocol-owned liquidity in $MOVE
    uint256 public treasuryBalance;

    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 reward);
    event TreasuryDeposit(address indexed from, uint256 amount);
    event TreasuryWithdrawal(address indexed to, uint256 amount);
    event POLAdded(uint256 amount);

    constructor(address _moveToken) {
        require(_moveToken != address(0), "MoveVault: zero address"); // FIX-003
        moveToken = MoveToken(_moveToken);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(VAULT_ADMIN_ROLE, msg.sender);
        _grantRole(DAO_ROLE, msg.sender);
    }

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

    function unstake(uint256 amount) external nonReentrant {
        require(stakes[msg.sender].amount >= amount, "MoveVault: insufficient stake");
        _claimReward(msg.sender);
        stakes[msg.sender].amount -= amount;
        totalStaked -= amount;
        moveToken.transfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    function claimReward() external nonReentrant {
        _claimReward(msg.sender);
    }

    function _claimReward(address user) internal {
        uint256 elapsed = block.timestamp - stakes[user].lastRewardClaim;
        uint256 reward = (stakes[user].amount * rewardRatePerSecond * elapsed) / 1 ether;
        // Only advance the claim timestamp when reward is actually paid;
        // if treasury is dry the accrual window stays open so nothing is lost.
        if (reward > 0 && treasuryBalance >= reward) {
            stakes[user].lastRewardClaim = block.timestamp;
            treasuryBalance -= reward;
            moveToken.transfer(user, reward);
            emit RewardClaimed(user, reward);
        }
    }

    function pendingReward(address user) external view returns (uint256) {
        uint256 elapsed = block.timestamp - stakes[user].lastRewardClaim;
        return (stakes[user].amount * rewardRatePerSecond * elapsed) / 1 ether;
    }

    function depositTreasury(uint256 amount) external {
        moveToken.transferFrom(msg.sender, address(this), amount);
        treasuryBalance += amount;
        emit TreasuryDeposit(msg.sender, amount);
    }

    function withdrawTreasury(address to, uint256 amount) external onlyRole(DAO_ROLE) {
        require(treasuryBalance >= amount, "MoveVault: insufficient treasury");
        treasuryBalance -= amount;
        moveToken.transfer(to, amount);
        emit TreasuryWithdrawal(to, amount);
    }

    function addPOL(uint256 amount) external onlyRole(VAULT_ADMIN_ROLE) {
        moveToken.transferFrom(msg.sender, address(this), amount);
        polBalance += amount;
        emit POLAdded(amount);
    }

    function setRewardRate(uint256 newRate) external onlyRole(DAO_ROLE) {
        rewardRatePerSecond = newRate;
    }
}
