// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./ZoneToken.sol";

interface IBurnable {
    function burn(uint256 amount) external;
}

interface IUniswapV2Router {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

/// @notice Staking vault — lock $MOVE for 90 / 180 / 365 days to earn $ZONE.
/// Also manages Protocol Owned Liquidity (POL).
contract MoveVault is AccessControl, ReentrancyGuard {

    // ── Constants ──────────────────────────────────────────────────────────────

    /// ZONE earned per MOVE (in wei) per second at 1× multiplier.
    /// 1e10 → ~0.000864 ZONE per MOVE for 90 days.
    uint256 public constant ZONE_REWARD_RATE = 1e10;

    uint256 public constant LOCK_90  = 90 days;
    uint256 public constant LOCK_180 = 180 days;
    uint256 public constant LOCK_365 = 365 days;

    // Multipliers in basis points (100 = 1×)
    uint256 public constant MULT_90  = 100;
    uint256 public constant MULT_180 = 150;
    uint256 public constant MULT_365 = 200;

    // ── State ──────────────────────────────────────────────────────────────────

    struct StakeInfo {
        uint256 amount;
        uint256 lockEnd;
        uint256 multiplier;   // basis points
        uint256 lastClaimTime;
    }

    IERC20    public moveToken;
    ZoneToken public zoneToken;
    IERC20    public usdc;

    address public protocolLiquidity; // Uniswap pool or treasury wallet
    IUniswapV2Router public uniswapRouter;

    uint256 public polBalance;  // USDC held as POL reserve

    mapping(address => StakeInfo) public stakes;

    // ── Events ─────────────────────────────────────────────────────────────────
    event Staked(address indexed user, uint256 amount, uint256 lockDays);
    event Unstaked(address indexed user, uint256 amount);
    event RewardsClaimed(address indexed user, uint256 zoneAmount);
    event POLDeposited(uint256 amount);
    event EmergencyBuyback(uint256 usdcSpent, uint256 moveBurned);

    constructor(
        address moveToken_,
        address zoneToken_,
        address usdc_,
        address protocolLiquidity_,
        address uniswapRouter_
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

        moveToken          = IERC20(moveToken_);
        zoneToken          = ZoneToken(zoneToken_);
        usdc               = IERC20(usdc_);
        protocolLiquidity  = protocolLiquidity_;
        uniswapRouter      = IUniswapV2Router(uniswapRouter_);
    }

    // ── Staking ────────────────────────────────────────────────────────────────

    function stake(uint256 amount, uint256 lockDays) external nonReentrant {
        require(stakes[msg.sender].amount == 0, "MoveVault: already staking");
        require(amount > 0, "MoveVault: zero amount");

        uint256 lockDuration;
        uint256 multiplier;

        if (lockDays == 90) {
            lockDuration = LOCK_90;
            multiplier   = MULT_90;
        } else if (lockDays == 180) {
            lockDuration = LOCK_180;
            multiplier   = MULT_180;
        } else if (lockDays == 365) {
            lockDuration = LOCK_365;
            multiplier   = MULT_365;
        } else {
            revert("MoveVault: invalid lockDays");
        }

        require(moveToken.transferFrom(msg.sender, address(this), amount), "MoveVault: transfer");

        stakes[msg.sender] = StakeInfo({
            amount:        amount,
            lockEnd:       block.timestamp + lockDuration,
            multiplier:    multiplier,
            lastClaimTime: block.timestamp
        });

        emit Staked(msg.sender, amount, lockDays);
    }

    function unstake() external nonReentrant {
        StakeInfo storage s = stakes[msg.sender];
        require(s.amount > 0,                        "MoveVault: not staking");
        require(block.timestamp >= s.lockEnd,        "MoveVault: still locked");

        // Harvest pending rewards first
        _claimRewards(msg.sender);

        uint256 amount = s.amount;
        delete stakes[msg.sender];

        require(moveToken.transfer(msg.sender, amount), "MoveVault: unstake transfer");
        emit Unstaked(msg.sender, amount);
    }

    function claimRewards() external nonReentrant {
        _claimRewards(msg.sender);
    }

    function _claimRewards(address user) internal {
        uint256 reward = earned(user);
        if (reward == 0) return;
        stakes[user].lastClaimTime = block.timestamp;
        zoneToken.mint(user, reward);
        emit RewardsClaimed(user, reward);
    }

    function earned(address user) public view returns (uint256) {
        StakeInfo storage s = stakes[user];
        if (s.amount == 0) return 0;
        uint256 elapsed = block.timestamp - s.lastClaimTime;
        // amount (MOVE wei) × rate × elapsed × multiplier / (100 × 1e18)
        return (s.amount * ZONE_REWARD_RATE * elapsed * s.multiplier) / (100 * 1e18);
    }

    // ── Protocol Owned Liquidity ───────────────────────────────────────────────

    function depositPOL(uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(usdc.transferFrom(msg.sender, address(this), amount), "MoveVault: POL transfer");
        polBalance += amount;
        emit POLDeposited(amount);
    }

    /// @notice Uses POL reserves to buy $MOVE from Uniswap and burn it.
    function emergencyBuyback() external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        require(polBalance > 0, "MoveVault: no POL");

        uint256 buyAmount = polBalance / 2;
        polBalance -= buyAmount;

        usdc.approve(address(uniswapRouter), buyAmount);

        address[] memory path = new address[](2);
        path[0] = address(usdc);
        path[1] = address(moveToken);

        uint256[] memory amounts = uniswapRouter.swapExactTokensForTokens(
            buyAmount,
            0,
            path,
            address(this),
            block.timestamp + 15 minutes
        );

        uint256 moveBought = amounts[amounts.length - 1];
        IBurnable(address(moveToken)).burn(moveBought);

        emit EmergencyBuyback(buyAmount, moveBought);
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
