// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./MoveTokenV2.sol";

/// MoveVaultV2 — staking, protocol-owned liquidity, treasury, with
/// checkpointed reward accounting.
///
/// Reward semantics (same economic meaning as V1's rewardRatePerSecond):
/// rewardRatePerSecond = $MOVE-wei accrued per second per 1e18 staked wei.
///
/// Global index (1e18 precision):
///   accRewardPerToken += rewardRatePerSecond * elapsed
/// Per user:
///   accrued = user.amount * (accRewardPerToken - user.rewardIndex) / 1e18
///
/// The global index and the user's accrual are checkpointed before every
/// stake, unstake, claim, and reward-rate change, so:
/// - rate changes are never retroactive,
/// - increasing a stake never earns historical rewards,
/// - unstaking never loses accrued rewards.
///
/// Payment is partial-friendly: payableAmount = min(pending, treasuryBalance).
/// The unpaid remainder is retained in unpaidRewards and claimable after a
/// treasury top-up (V1 was all-or-nothing).
contract MoveVaultV2 is AccessControl, ReentrancyGuard {
    bytes32 public constant VAULT_ADMIN_ROLE = keccak256("VAULT_ADMIN_ROLE");
    bytes32 public constant DAO_ROLE = keccak256("DAO_ROLE");

    uint256 private constant PRECISION = 1e18;

    MoveTokenV2 public moveToken;

    struct StakeInfo {
        uint256 amount;
        uint256 rewardIndex;   // accRewardPerToken snapshot at last user update
        uint256 unpaidRewards; // accrued but not yet paid out
    }
    mapping(address => StakeInfo) public stakes;
    uint256 public totalStaked;

    /// $MOVE-wei per second per 1e18 staked wei (set by DAO_ROLE / timelock).
    uint256 public rewardRatePerSecond;
    /// Global reward index, 1e18 precision.
    uint256 public accRewardPerToken;
    uint256 public lastGlobalUpdate;

    uint256 public polBalance; // protocol-owned liquidity in $MOVE
    uint256 public treasuryBalance;

    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 paid, uint256 remainingUnpaid);
    event RewardRateUpdated(uint256 oldRate, uint256 newRate);
    event TreasuryDeposit(address indexed from, uint256 amount);
    event TreasuryWithdrawal(address indexed to, uint256 amount);
    event POLAdded(uint256 amount);

    constructor(address _moveToken) {
        require(_moveToken != address(0), "MoveVaultV2: zero address");
        moveToken = MoveTokenV2(_moveToken);
        lastGlobalUpdate = block.timestamp;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(VAULT_ADMIN_ROLE, msg.sender);
        _grantRole(DAO_ROLE, msg.sender);
    }

    // ── Checkpointing ───────────────────────────────────────────────────────

    function _updateGlobal() internal {
        uint256 elapsed = block.timestamp - lastGlobalUpdate;
        if (elapsed > 0) {
            accRewardPerToken += rewardRatePerSecond * elapsed;
            lastGlobalUpdate = block.timestamp;
        }
    }

    function _updateUser(address user) internal {
        StakeInfo storage s = stakes[user];
        uint256 delta = accRewardPerToken - s.rewardIndex;
        if (delta > 0 && s.amount > 0) {
            s.unpaidRewards += (s.amount * delta) / PRECISION;
        }
        s.rewardIndex = accRewardPerToken;
    }

    // ── Staking ─────────────────────────────────────────────────────────────

    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "MoveVaultV2: zero amount");
        _updateGlobal();
        _updateUser(msg.sender);
        stakes[msg.sender].amount += amount;
        totalStaked += amount;
        moveToken.transferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    function unstake(uint256 amount) external nonReentrant {
        require(amount > 0, "MoveVaultV2: zero amount");
        require(stakes[msg.sender].amount >= amount, "MoveVaultV2: insufficient stake");
        _updateGlobal();
        _updateUser(msg.sender);
        stakes[msg.sender].amount -= amount;
        totalStaked -= amount;
        moveToken.transfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    // ── Rewards ─────────────────────────────────────────────────────────────

    /// Pays min(pending, treasuryBalance); the unpaid remainder survives in
    /// unpaidRewards and can be claimed after a treasury top-up.
    function claimReward() external nonReentrant {
        _updateGlobal();
        _updateUser(msg.sender);
        StakeInfo storage s = stakes[msg.sender];
        uint256 pending = s.unpaidRewards;
        uint256 payableAmount = pending <= treasuryBalance ? pending : treasuryBalance;
        if (payableAmount > 0) {
            s.unpaidRewards = pending - payableAmount;
            treasuryBalance -= payableAmount;
            moveToken.transfer(msg.sender, payableAmount);
        }
        emit RewardClaimed(msg.sender, payableAmount, s.unpaidRewards);
    }

    /// View of total pending rewards (accrued-but-unpaid + since-last-update).
    function pendingReward(address user) external view returns (uint256) {
        StakeInfo storage s = stakes[user];
        uint256 acc = accRewardPerToken + rewardRatePerSecond * (block.timestamp - lastGlobalUpdate);
        return s.unpaidRewards + (s.amount * (acc - s.rewardIndex)) / PRECISION;
    }

    /// Rate changes checkpoint the global index first, so they are never
    /// retroactive over time that elapsed at the old rate.
    function setRewardRate(uint256 newRate) external onlyRole(DAO_ROLE) {
        _updateGlobal();
        emit RewardRateUpdated(rewardRatePerSecond, newRate);
        rewardRatePerSecond = newRate;
    }

    // ── Treasury / POL ──────────────────────────────────────────────────────

    function depositTreasury(uint256 amount) external {
        moveToken.transferFrom(msg.sender, address(this), amount);
        treasuryBalance += amount;
        emit TreasuryDeposit(msg.sender, amount);
    }

    function withdrawTreasury(address to, uint256 amount) external onlyRole(DAO_ROLE) {
        require(treasuryBalance >= amount, "MoveVaultV2: insufficient treasury");
        treasuryBalance -= amount;
        moveToken.transfer(to, amount);
        emit TreasuryWithdrawal(to, amount);
    }

    function addPOL(uint256 amount) external onlyRole(VAULT_ADMIN_ROLE) {
        moveToken.transferFrom(msg.sender, address(this), amount);
        polBalance += amount;
        emit POLAdded(amount);
    }
}
