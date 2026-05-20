// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IAggregatorV3 {
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}

interface IUniswapV2Router02 {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

/// @notice $MOVE — the core move-to-earn token.
/// Minting requires a backend ECDSA signature; emission is governed by an
/// auto-valve Chainlink Keeper and protected by a Protocol Owned Liquidity hook.
contract MoveToken is ERC20, ERC20Burnable, AccessControl, EIP712, ReentrancyGuard {
    using ECDSA for bytes32;

    // ── Roles ─────────────────────────────────────────────────────────────────
    bytes32 public constant MINTER_ROLE  = keccak256("MINTER_ROLE");
    bytes32 public constant KEEPER_ROLE  = keccak256("KEEPER_ROLE");

    // ── Token economics ────────────────────────────────────────────────────────
    uint256 public constant MAX_SUPPLY      = 1_000_000_000e18;
    uint256 public constant DAILY_MINT_CAP  = 100_000e18;
    uint256 public constant INITIAL_RATE    = 1_000e18;  // max per-tx mint at launch
    uint256 public constant HALVING_INTERVAL = 365 days;

    bytes32 private constant MINT_TYPEHASH =
        keccak256("Mint(address to,uint256 amount,uint256 nonce,uint256 deadline)");

    // ── Emission state ─────────────────────────────────────────────────────────
    uint256 public baseRate;
    uint256 public weeklyBurn;
    uint256 public weeklyMint;
    uint256 public lastAdjustmentTime;
    uint256 public immutable deploymentTime;

    // ── Daily cap bookkeeping ──────────────────────────────────────────────────
    mapping(uint256 => uint256) public dailyMinted; // epochDay => amount

    // ── Signature nonces ───────────────────────────────────────────────────────
    mapping(address => uint256) public nonces;

    // ── POL / price feed ───────────────────────────────────────────────────────
    IAggregatorV3 public priceFeed;
    int256  public priceSevenDaysAgo;
    uint256 public priceSnapshotTime;

    IUniswapV2Router02 public uniswapRouter;
    address public usdc;
    address public treasury;

    // ── Seed guard ─────────────────────────────────────────────────────────────
    bool public seeded;

    // ── Events ─────────────────────────────────────────────────────────────────
    event EmissionAdjusted(uint256 newBaseRate, uint256 ratio);
    event PriceSnapshotTaken(int256 price, uint256 timestamp);
    event BuyAndBurn(uint256 usdcSpent, uint256 tokensBurned);

    constructor(
        address signer_,
        address priceFeed_,
        address uniswapRouter_,
        address usdc_,
        address treasury_
    ) ERC20("MoveToken", "MOVE") EIP712("MoveToken", "1") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, signer_);

        baseRate         = INITIAL_RATE;
        deploymentTime   = block.timestamp;
        lastAdjustmentTime = block.timestamp;

        priceFeed    = IAggregatorV3(priceFeed_);
        uniswapRouter = IUniswapV2Router02(uniswapRouter_);
        usdc         = usdc_;
        treasury     = treasury_;
    }

    // ── Minting ────────────────────────────────────────────────────────────────

    /// @notice Mint tokens using a backend-issued EIP-712 signature.
    function mint(
        address to,
        uint256 amount,
        uint256 deadline,
        bytes calldata sig
    ) external {
        require(block.timestamp <= deadline, "MOVE: expired");

        bytes32 structHash = keccak256(
            abi.encode(MINT_TYPEHASH, to, amount, nonces[to]++, deadline)
        );
        address recovered = ECDSA.recover(_hashTypedDataV4(structHash), sig);
        require(hasRole(MINTER_ROLE, recovered), "MOVE: invalid sig");

        uint256 today = block.timestamp / 1 days;
        require(dailyMinted[today] + amount <= DAILY_MINT_CAP, "MOVE: daily cap");
        dailyMinted[today] += amount;

        uint256 halvings = (block.timestamp - deploymentTime) / HALVING_INTERVAL;
        uint256 effectiveRate = baseRate >> halvings;
        require(amount <= effectiveRate, "MOVE: exceeds rate");

        weeklyMint += amount;
        require(totalSupply() + amount <= MAX_SUPPLY, "MOVE: max supply");
        _mint(to, amount);
    }

    /// @notice One-time admin seed for initial liquidity bootstrapping.
    function seedLiquidity(address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(!seeded, "MOVE: already seeded");
        seeded = true;
        require(totalSupply() + amount <= MAX_SUPPLY, "MOVE: max supply");
        _mint(to, amount);
    }

    // ── Burn overrides (track weeklyBurn) ──────────────────────────────────────

    function burn(uint256 amount) public override {
        weeklyBurn += amount;
        super.burn(amount);
    }

    function burnFrom(address account, uint256 amount) public override {
        weeklyBurn += amount;
        super.burnFrom(account, amount);
    }

    // ── Auto-valve (Chainlink Keeper) ──────────────────────────────────────────

    /// @notice Called by Chainlink Keeper every 7 days to adjust emission.
    function adjustEmissionRate() external onlyRole(KEEPER_ROLE) {
        require(block.timestamp >= lastAdjustmentTime + 7 days, "MOVE: too early");

        uint256 ratio = weeklyMint > 0 ? (weeklyBurn * 100) / weeklyMint : 100;

        uint256 newBaseRate = baseRate;
        if (ratio < 70) {
            newBaseRate = (baseRate * 90) / 100;
        } else if (ratio > 130 && baseRate < INITIAL_RATE) {
            newBaseRate = (baseRate * 105) / 100;
            if (newBaseRate > INITIAL_RATE) newBaseRate = INITIAL_RATE;
        }

        baseRate           = newBaseRate;
        weeklyBurn         = 0;
        weeklyMint         = 0;
        lastAdjustmentTime = block.timestamp;

        emit EmissionAdjusted(newBaseRate, ratio);
    }

    // ── POL price-protection hook ──────────────────────────────────────────────

    /// @notice Keeper snapshots the current $MOVE price.
    function takePriceSnapshot() external onlyRole(KEEPER_ROLE) {
        (, int256 price, , ,) = priceFeed.latestRoundData();
        priceSevenDaysAgo = price;
        priceSnapshotTime = block.timestamp;
        emit PriceSnapshotTaken(price, block.timestamp);
    }

    /// @notice Keeper checks for a 40 % price drop; if triggered, buys-and-burns.
    function checkAndBuyback() external onlyRole(KEEPER_ROLE) {
        require(priceSnapshotTime > 0, "MOVE: no snapshot");
        require(block.timestamp >= priceSnapshotTime + 7 days, "MOVE: not 7 days");
        require(priceSevenDaysAgo > 0, "MOVE: bad snapshot");

        (, int256 currentPrice, , ,) = priceFeed.latestRoundData();

        // 40% drop: currentPrice <= 60% of old price
        if (currentPrice * 100 <= priceSevenDaysAgo * 60) {
            uint256 usdcBalance = IERC20(usdc).balanceOf(treasury);
            if (usdcBalance > 0) {
                _buyAndBurn(usdcBalance / 10); // use 10% of treasury
            }
        }

        // Reset snapshot
        priceSevenDaysAgo = currentPrice;
        priceSnapshotTime = block.timestamp;
    }

    /// @notice Keeper-initiated manual buy-and-burn.
    function buyAndBurn(uint256 usdcAmount) external onlyRole(KEEPER_ROLE) nonReentrant {
        _buyAndBurn(usdcAmount);
    }

    function _buyAndBurn(uint256 usdcAmount) internal {
        IERC20(usdc).transferFrom(treasury, address(this), usdcAmount);
        IERC20(usdc).approve(address(uniswapRouter), usdcAmount);

        address[] memory path = new address[](2);
        path[0] = usdc;
        path[1] = address(this);

        uint256[] memory amounts = uniswapRouter.swapExactTokensForTokens(
            usdcAmount,
            0,
            path,
            address(this),
            block.timestamp + 15 minutes
        );

        uint256 tokensBought = amounts[amounts.length - 1];
        weeklyBurn += tokensBought;
        _burn(address(this), tokensBought);

        emit BuyAndBurn(usdcAmount, tokensBought);
    }

    // ── Views ──────────────────────────────────────────────────────────────────

    function currentHalvings() public view returns (uint256) {
        return (block.timestamp - deploymentTime) / HALVING_INTERVAL;
    }

    function effectiveBaseRate() public view returns (uint256) {
        return baseRate >> currentHalvings();
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
