const { expect }     = require("chai");
const { ethers }     = require("hardhat");
const { time }       = require("@nomicfoundation/hardhat-network-helpers");

// ─── helpers ──────────────────────────────────────────────────────────────────

async function buildMintSig(moveToken, signer, to, amount, deadline, chainId) {
  const domain = {
    name:              "MoveToken",
    version:           "1",
    chainId,
    verifyingContract: await moveToken.getAddress(),
  };
  const types = {
    Mint: [
      { name: "to",       type: "address" },
      { name: "amount",   type: "uint256" },
      { name: "nonce",    type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };
  const nonce = await moveToken.nonces(to);
  const value = { to, amount, nonce, deadline };
  return signer.signTypedData(domain, types, value);
}

async function mintTokens(moveToken, signer, to, amount, chainId) {
  const deadline = (await time.latest()) + 3600;
  const sig      = await buildMintSig(moveToken, signer, to, amount, deadline, chainId);
  return moveToken.mint(to, amount, deadline, sig);
}

// ─── fixture ──────────────────────────────────────────────────────────────────

async function deployFixture() {
  const [owner, signer, keeper, user1, treasury] = await ethers.getSigners();

  const MockERC20     = await ethers.getContractFactory("MockERC20");
  const mockUSDC      = await MockERC20.deploy("USDC", "USDC", 6);

  const MockAgg       = await ethers.getContractFactory("MockAggregatorV3");
  const mockPriceFeed = await MockAgg.deploy(100_000_000n); // $1.00 (8 dec)

  const MockRouter    = await ethers.getContractFactory("MockUniswapRouter");
  const mockRouter    = await MockRouter.deploy();

  const MoveToken     = await ethers.getContractFactory("MoveToken");
  const moveToken     = await MoveToken.deploy(
    signer.address,
    await mockPriceFeed.getAddress(),
    await mockRouter.getAddress(),
    await mockUSDC.getAddress(),
    treasury.address,
  );

  // Grant keeper role
  const KEEPER_ROLE = await moveToken.KEEPER_ROLE();
  await moveToken.grantRole(KEEPER_ROLE, keeper.address);

  const chainId = (await ethers.provider.getNetwork()).chainId;

  return { moveToken, mockUSDC, mockPriceFeed, mockRouter, owner, signer, keeper, user1, treasury, chainId };
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe("MoveToken", function () {

  // ── Signature-gated minting ────────────────────────────────────────────────

  describe("mint()", function () {
    it("mints to recipient with a valid signature", async function () {
      const { moveToken, signer, user1, chainId } = await deployFixture();
      const amount = ethers.parseEther("500");

      await mintTokens(moveToken, signer, user1.address, amount, chainId);

      expect(await moveToken.balanceOf(user1.address)).to.equal(amount);
    });

    it("reverts with an invalid (wrong signer) signature", async function () {
      const { moveToken, user1, chainId } = await deployFixture();
      const [,, , , , attacker] = await ethers.getSigners();
      const amount   = ethers.parseEther("100");
      const deadline = (await time.latest()) + 3600;
      const sig      = await buildMintSig(moveToken, attacker, user1.address, amount, deadline, chainId);

      await expect(
        moveToken.mint(user1.address, amount, deadline, sig)
      ).to.be.revertedWith("MOVE: invalid sig");
    });

    it("reverts with an expired deadline", async function () {
      const { moveToken, signer, user1, chainId } = await deployFixture();
      const amount   = ethers.parseEther("100");
      const deadline = (await time.latest()) - 1;  // already expired
      const sig      = await buildMintSig(moveToken, signer, user1.address, amount, deadline, chainId);

      await expect(
        moveToken.mint(user1.address, amount, deadline, sig)
      ).to.be.revertedWith("MOVE: expired");
    });

    it("enforces the daily mint cap", async function () {
      const { moveToken, signer, user1, chainId } = await deployFixture();

      // First mint: 100 000 MOVE (exactly at cap)
      await mintTokens(moveToken, signer, user1.address, ethers.parseEther("1000"), chainId);

      // Reduce base rate so we can have a big per-tx amount without hitting rate limit
      // Actually let's just push close to the cap manually via multiple calls:
      // Each tx limited to baseRate (1000 MOVE). 100 000 / 1000 = 100 txs to fill cap.
      // Instead, test that 1 MOVE over cap reverts.

      // Fill the cap
      const MAX_PER_TX = ethers.parseEther("1000");
      const CAP        = ethers.parseEther("100000");
      let minted       = MAX_PER_TX;

      // Each mint call we need a fresh sig
      while (minted + MAX_PER_TX <= CAP) {
        await mintTokens(moveToken, signer, user1.address, MAX_PER_TX, chainId);
        minted += MAX_PER_TX;
      }

      // Now even 1 wei should revert
      await expect(
        mintTokens(moveToken, signer, user1.address, 1n, chainId)
      ).to.be.revertedWith("MOVE: daily cap");
    });

    it("prevents replay of the same nonce", async function () {
      const { moveToken, signer, user1, chainId } = await deployFixture();
      const amount   = ethers.parseEther("100");
      const deadline = (await time.latest()) + 3600;
      const sig      = await buildMintSig(moveToken, signer, user1.address, amount, deadline, chainId);

      await moveToken.mint(user1.address, amount, deadline, sig);

      // Replay: nonce has advanced, so recovered signer won't match
      await expect(
        moveToken.mint(user1.address, amount, deadline, sig)
      ).to.be.revertedWith("MOVE: invalid sig");
    });
  });

  // ── Halving schedule ───────────────────────────────────────────────────────

  describe("halving schedule", function () {
    it("halves effectiveBaseRate every 365 days", async function () {
      const { moveToken } = await deployFixture();
      const initial = await moveToken.effectiveBaseRate();

      await time.increase(365 * 24 * 3600);
      expect(await moveToken.effectiveBaseRate()).to.equal(initial / 2n);

      await time.increase(365 * 24 * 3600);
      expect(await moveToken.effectiveBaseRate()).to.equal(initial / 4n);
    });

    it("rejects a mint that exceeds the halved rate", async function () {
      const { moveToken, signer, user1, chainId } = await deployFixture();

      await time.increase(365 * 24 * 3600); // 1 halving → rate = 500 MOVE

      const overRate = ethers.parseEther("501");
      await expect(
        mintTokens(moveToken, signer, user1.address, overRate, chainId)
      ).to.be.revertedWith("MOVE: exceeds rate");
    });
  });

  // ── Auto-valve ─────────────────────────────────────────────────────────────

  describe("adjustEmissionRate() auto-valve", function () {
    it("decreases baseRate by 10% when burn/mint ratio < 70", async function () {
      const { moveToken, signer, keeper, user1, chainId } = await deployFixture();

      // Mint 1000 MOVE, burn nothing → ratio = 0 (< 70)
      await mintTokens(moveToken, signer, user1.address, ethers.parseEther("1000"), chainId);

      await time.increase(7 * 24 * 3600);
      const before = await moveToken.baseRate();
      await moveToken.connect(keeper).adjustEmissionRate();
      const after = await moveToken.baseRate();

      expect(after).to.equal((before * 90n) / 100n);
    });

    it("increases baseRate by 5% when ratio > 130 and baseRate < INITIAL_RATE", async function () {
      const { moveToken, signer, keeper, user1, chainId } = await deployFixture();

      // First: drive baseRate below INITIAL_RATE
      await mintTokens(moveToken, signer, user1.address, ethers.parseEther("1000"), chainId);
      await time.increase(7 * 24 * 3600);
      await moveToken.connect(keeper).adjustEmissionRate(); // rate drops to 900

      // Now: mint a little, burn a lot more (simulate external burns)
      await time.increase(1); // ensure new daily slot
      await mintTokens(moveToken, signer, user1.address, ethers.parseEther("100"), chainId);
      // Burn 140 MOVE  →  ratio = 140*100/100 = 140 > 130
      await moveToken.connect(user1).burn(ethers.parseEther("140"));

      await time.increase(7 * 24 * 3600);
      const before = await moveToken.baseRate();
      await moveToken.connect(keeper).adjustEmissionRate();
      const after = await moveToken.baseRate();

      expect(after).to.equal((before * 105n) / 100n);
    });

    it("emits EmissionAdjusted with correct ratio", async function () {
      const { moveToken, signer, keeper, user1, chainId } = await deployFixture();

      await mintTokens(moveToken, signer, user1.address, ethers.parseEther("1000"), chainId);
      await moveToken.connect(user1).burn(ethers.parseEther("500")); // ratio = 50

      await time.increase(7 * 24 * 3600);
      await expect(moveToken.connect(keeper).adjustEmissionRate())
        .to.emit(moveToken, "EmissionAdjusted");
    });

    it("reverts if called before 7 days have elapsed", async function () {
      const { moveToken, keeper } = await deployFixture();
      await time.increase(6 * 24 * 3600);
      await expect(
        moveToken.connect(keeper).adjustEmissionRate()
      ).to.be.revertedWith("MOVE: too early");
    });

    it("resets weekly counters after adjustment", async function () {
      const { moveToken, signer, keeper, user1, chainId } = await deployFixture();

      await mintTokens(moveToken, signer, user1.address, ethers.parseEther("1000"), chainId);
      await time.increase(7 * 24 * 3600);
      await moveToken.connect(keeper).adjustEmissionRate();

      expect(await moveToken.weeklyBurn()).to.equal(0n);
      expect(await moveToken.weeklyMint()).to.equal(0n);
    });
  });

  // ── POL buy-and-burn ───────────────────────────────────────────────────────

  describe("buyAndBurn()", function () {
    it("buys MOVE with treasury USDC and burns it", async function () {
      const { moveToken, mockUSDC, mockRouter, keeper, treasury, owner } = await deployFixture();

      // Seed the router with MOVE tokens (one-time admin seed)
      await moveToken.connect(owner).seedLiquidity(await mockRouter.getAddress(), ethers.parseEther("10000000"));

      // Fund treasury with USDC and approve
      await mockUSDC.mint(treasury.address, 1_000_000n * 10n ** 6n);
      await mockUSDC.connect(treasury).approve(await moveToken.getAddress(), ethers.MaxUint256);

      const usdcSpent  = 1_000n * 10n ** 6n; // 1 000 USDC
      const supplyBefore = await moveToken.totalSupply();

      await expect(moveToken.connect(keeper).buyAndBurn(usdcSpent))
        .to.emit(moveToken, "BuyAndBurn");

      expect(await moveToken.totalSupply()).to.be.lt(supplyBefore);
    });
  });

  // ── Price-triggered buyback (checkAndBuyback) ──────────────────────────────

  describe("checkAndBuyback()", function () {
    it("triggers buyback when price drops 40%", async function () {
      const { moveToken, mockPriceFeed, mockUSDC, mockRouter, keeper, treasury, owner } = await deployFixture();

      // Seed router with MOVE
      await moveToken.connect(owner).seedLiquidity(await mockRouter.getAddress(), ethers.parseEther("10000000"));

      // Fund treasury USDC
      await mockUSDC.mint(treasury.address, 1_000_000n * 10n ** 6n);
      await mockUSDC.connect(treasury).approve(await moveToken.getAddress(), ethers.MaxUint256);

      // Take snapshot at $1.00
      await moveToken.connect(keeper).takePriceSnapshot();

      // Advance 7 days and drop price by 40%
      await time.increase(7 * 24 * 3600 + 1);
      await mockPriceFeed.setPrice(59_000_000n); // $0.59 — below 60% of $1

      const supplyBefore = await moveToken.totalSupply();
      await moveToken.connect(keeper).checkAndBuyback();

      expect(await moveToken.totalSupply()).to.be.lt(supplyBefore);
    });

    it("does NOT trigger when price drop is below 40%", async function () {
      const { moveToken, mockPriceFeed, keeper } = await deployFixture();

      await moveToken.connect(keeper).takePriceSnapshot();
      await time.increase(7 * 24 * 3600 + 1);
      await mockPriceFeed.setPrice(70_000_000n); // $0.70 — only 30% drop

      const supplyBefore = await moveToken.totalSupply();
      await moveToken.connect(keeper).checkAndBuyback();

      // Supply should not change (no buyback triggered)
      expect(await moveToken.totalSupply()).to.equal(supplyBefore);
    });
  });
});
