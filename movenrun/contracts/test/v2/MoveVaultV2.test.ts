import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { deployV2, V2Fixture, mintMoveTo } from "./helpers";

describe("MoveVaultV2", function () {
  let f: V2Fixture;
  let admin: SignerWithAddress;
  let oracle: SignerWithAddress;
  let treasury: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  // rewardRatePerSecond is $MOVE-wei per second per 1e18 staked wei.
  // RATE = 1e15 → 0.001 MOVE per MOVE staked per second.
  const RATE = ethers.parseEther("0.001");
  const STAKE = ethers.parseEther("100");

  beforeEach(async function () {
    [admin, oracle, treasury, alice, bob] = await ethers.getSigners();
    f = await deployV2(admin, oracle, treasury);
    // admin retains DAO_ROLE from the constructor for direct rate control in
    // unit tests; governance-driven control is covered in the governor suite.
    await mintMoveTo(f, alice.address, 20_000n); // 200 MOVE
    await mintMoveTo(f, bob.address, 20_000n);
    await mintMoveTo(f, admin.address, 20_000n); // treasury funding budget
    await f.moveToken.connect(alice).approve(await f.moveVault.getAddress(), ethers.MaxUint256);
    await f.moveToken.connect(bob).approve(await f.moveVault.getAddress(), ethers.MaxUint256);
    await f.moveToken.connect(admin).approve(await f.moveVault.getAddress(), ethers.MaxUint256);
  });

  async function fundTreasury(amount: bigint) {
    // admin was funded with 200 MOVE in beforeEach; no time travel here so
    // reward accrual in the calling test stays controlled.
    await f.moveVault.connect(admin).depositTreasury(amount);
  }

  describe("accrual", function () {
    it("accrues amount * rate * elapsed / 1e18", async function () {
      await f.moveVault.setRewardRate(RATE);
      await f.moveVault.connect(alice).stake(STAKE);
      await time.increase(1000);
      // 100 MOVE * 0.001/s * 1000s = 100 MOVE
      expect(await f.moveVault.pendingReward(alice.address)).to.be.closeTo(
        ethers.parseEther("100"),
        ethers.parseEther("0.001") // ±1s of accrual tolerance
      );
    });

    it("zero stake accrues nothing", async function () {
      await f.moveVault.setRewardRate(RATE);
      await time.increase(1000);
      expect(await f.moveVault.pendingReward(alice.address)).to.equal(0n);
      await f.moveVault.connect(alice).claimReward(); // no-op, no revert
      expect(await f.moveToken.balanceOf(await f.moveVault.getAddress())).to.equal(0n);
    });

    it("rate changes are not retroactive", async function () {
      await f.moveVault.connect(alice).stake(STAKE); // rate is 0
      await time.increase(10_000);
      expect(await f.moveVault.pendingReward(alice.address)).to.equal(0n);

      await f.moveVault.setRewardRate(RATE);
      const tRateSet = await time.latest();
      await time.increase(500);
      // Only the 500s after the rate change accrue (±couple blocks).
      const pending = await f.moveVault.pendingReward(alice.address);
      const elapsed = BigInt((await time.latest()) - tRateSet);
      expect(pending).to.equal((STAKE * RATE * elapsed) / ethers.parseEther("1"));

      // Dropping the rate to 0 keeps what was accrued, adds nothing more.
      await f.moveVault.setRewardRate(0n);
      const frozen = await f.moveVault.pendingReward(alice.address);
      await time.increase(10_000);
      expect(await f.moveVault.pendingReward(alice.address)).to.equal(frozen);
    });

    it("a stake increase does not receive historical rewards", async function () {
      await f.moveVault.setRewardRate(RATE);
      await f.moveVault.connect(alice).stake(STAKE);
      await time.increase(1000);

      // Bob stakes now — his index starts at the current global index, so
      // he gets none of the previous 1000s of rewards.
      await f.moveVault.connect(bob).stake(STAKE);
      expect(await f.moveVault.pendingReward(bob.address)).to.be.lt(
        ethers.parseEther("0.5")
      );

      // Alice doubles her stake — her prior accrual is checkpointed, and the
      // new amount earns only from now on.
      const aliceBefore = await f.moveVault.pendingReward(alice.address);
      await f.moveVault.connect(alice).stake(STAKE);
      await time.increase(100);
      const aliceAfter = await f.moveVault.pendingReward(alice.address);
      // ~100s * 200 MOVE * 0.001 = ~20 MOVE more — NOT a doubling of history.
      expect(aliceAfter - aliceBefore).to.be.closeTo(
        ethers.parseEther("20"),
        ethers.parseEther("1")
      );
    });

    it("unstaking does not lose accrued rewards", async function () {
      await f.moveVault.setRewardRate(RATE);
      await f.moveVault.connect(alice).stake(STAKE);
      await time.increase(1000);
      await f.moveVault.connect(alice).unstake(STAKE);
      // ~100 MOVE accrued survives the unstake as unpaidRewards.
      const pending = await f.moveVault.pendingReward(alice.address);
      expect(pending).to.be.closeTo(ethers.parseEther("100"), ethers.parseEther("1"));
      // And stays claimable later once the treasury can pay.
      await fundTreasury(ethers.parseEther("150"));
      const balBefore = await f.moveToken.balanceOf(alice.address);
      await f.moveVault.connect(alice).claimReward();
      expect((await f.moveToken.balanceOf(alice.address)) - balBefore).to.equal(pending);
    });
  });

  describe("partial payment against the treasury", function () {
    it("pays min(pending, treasury); the remainder survives and is claimable after top-up", async function () {
      await f.moveVault.setRewardRate(RATE);
      await f.moveVault.connect(alice).stake(STAKE);
      await fundTreasury(ethers.parseEther("30"));
      // Overshoot the treasury: accrue ~100 MOVE pending.
      await time.increase(1000);

      const balBefore = await f.moveToken.balanceOf(alice.address);
      await f.moveVault.connect(alice).claimReward();
      // Paid exactly the treasury's 30; remainder retained.
      expect((await f.moveToken.balanceOf(alice.address)) - balBefore).to.equal(
        ethers.parseEther("30")
      );
      expect(await f.moveVault.treasuryBalance()).to.equal(0n);
      const stakeInfo = await f.moveVault.stakes(alice.address);
      expect(stakeInfo.unpaidRewards).to.be.gt(ethers.parseEther("69"));

      // Stop further accrual to make the remainder exact, then top up.
      await f.moveVault.setRewardRate(0n);
      const remainder = await f.moveVault.pendingReward(alice.address);
      await fundTreasury(ethers.parseEther("150"));
      const balMid = await f.moveToken.balanceOf(alice.address);
      await f.moveVault.connect(alice).claimReward();
      expect((await f.moveToken.balanceOf(alice.address)) - balMid).to.equal(remainder);
      expect((await f.moveVault.stakes(alice.address)).unpaidRewards).to.equal(0n);
    });

    it("claim with zero treasury pays nothing and loses nothing", async function () {
      await f.moveVault.setRewardRate(RATE);
      await f.moveVault.connect(alice).stake(STAKE);
      await time.increase(1000);
      const pendingBefore = await f.moveVault.pendingReward(alice.address);
      await f.moveVault.connect(alice).claimReward();
      // Nothing paid; everything retained as unpaidRewards.
      expect((await f.moveVault.stakes(alice.address)).unpaidRewards).to.be.gte(pendingBefore);
    });

    it("repeated claims never double-pay", async function () {
      await f.moveVault.setRewardRate(RATE);
      await f.moveVault.connect(alice).stake(STAKE);
      await fundTreasury(ethers.parseEther("150"));
      await time.increase(1000);
      await f.moveVault.setRewardRate(0n); // freeze accrual for exactness

      const balBefore = await f.moveToken.balanceOf(alice.address);
      await f.moveVault.connect(alice).claimReward();
      const paidOnce = (await f.moveToken.balanceOf(alice.address)) - balBefore;
      expect(paidOnce).to.be.gt(0n);

      await f.moveVault.connect(alice).claimReward();
      await f.moveVault.connect(alice).claimReward();
      expect((await f.moveToken.balanceOf(alice.address)) - balBefore).to.equal(paidOnce);
    });
  });

  describe("precision / rounding", function () {
    it("accrued rewards round down (floor) and never overpay", async function () {
      // 1 wei staked at 3 wei/s per 1e18 staked: floor((1 * 3 * t) / 1e18) = 0
      // for any realistic t — sub-precision dust is never paid out.
      await f.moveVault.setRewardRate(3n);
      await f.moveVault.connect(alice).stake(1n);
      await time.increase(1_000_000);
      expect(await f.moveVault.pendingReward(alice.address)).to.equal(0n);
    });

    it("whole-token staking at an integer rate accrues the exact product", async function () {
      await f.moveVault.connect(alice).stake(ethers.parseEther("1"));
      await f.moveVault.setRewardRate(3n); // 3 wei/s per 1e18 staked
      const t0 = await time.latest();
      await time.increase(1000);
      await f.moveVault.setRewardRate(0n); // freeze at an exact boundary
      const elapsed = BigInt(await time.latest()) - BigInt(t0);
      expect(await f.moveVault.pendingReward(alice.address)).to.equal(3n * elapsed);
    });
  });

  describe("access control", function () {
    it("setRewardRate is DAO_ROLE-gated (held by admin and the timelock)", async function () {
      await expect(f.moveVault.connect(alice).setRewardRate(1n)).to.be.reverted;
      const DAO_ROLE = ethers.id("DAO_ROLE");
      expect(await f.moveVault.hasRole(DAO_ROLE, await f.timelock.getAddress())).to.equal(true);
    });

    it("withdrawTreasury is DAO_ROLE-gated and bounded by the treasury", async function () {
      await fundTreasury(ethers.parseEther("10"));
      await expect(
        f.moveVault.connect(alice).withdrawTreasury(alice.address, 1n)
      ).to.be.reverted;
      await expect(
        f.moveVault.withdrawTreasury(admin.address, ethers.parseEther("11"))
      ).to.be.revertedWith("MoveVaultV2: insufficient treasury");
      await f.moveVault.withdrawTreasury(admin.address, ethers.parseEther("10"));
    });

    it("unstake cannot exceed the stake", async function () {
      await f.moveVault.connect(alice).stake(STAKE);
      await expect(
        f.moveVault.connect(alice).unstake(STAKE + 1n)
      ).to.be.revertedWith("MoveVaultV2: insufficient stake");
    });
  });
});
