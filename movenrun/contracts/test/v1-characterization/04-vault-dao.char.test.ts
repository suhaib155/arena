// V1 CHARACTERIZATION — MoveVault reward accounting & MovenDAO governance.
//
// Proves current deployed-V1 behavior (issues #12, #13, #14, #15). Test names
// are tagged so the proven behavior is never mistaken for an approved
// invariant. See docs/CONTRACT_V1_DISCREPANCIES.md. No contract source is modified.
import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture, impersonateAccount, setBalance } from "@nomicfoundation/hardhat-network-helpers";
import { deployAll, fundMove } from "./helpers";

const MAX = ethers.MaxUint256;

describe("V1 characterization — MoveVault & MovenDAO", function () {
  // ── Issue #12 ─────────────────────────────────────────────────────────────
  it("V1 characterization (known discrepancy #12): under-funded treasury pays NOTHING (all-or-nothing), does not advance the claim timestamp, and the debt keeps growing", async function () {
    const d = await deployAll();
    const alice = d.signers[2];

    await fundMove(d, alice, 20_000n); // 200 $MOVE
    await d.moveToken.connect(alice).approve(await d.moveVault.getAddress(), MAX);

    await d.moveVault.connect(alice).stake(ethers.parseEther("100"));
    // DAO_ROLE is held by the deployer here (see #15); use it to set the rate.
    await d.moveVault.setRewardRate(ethers.parseEther("0.001")); // 1e15 wei/sec/token
    // Fund the treasury with far less than the reward will accrue to.
    await d.moveVault.connect(alice).depositTreasury(ethers.parseEther("1"));

    await time.increase(1000);

    const pending = await d.moveVault.pendingReward(alice.address);
    const treasury = await d.moveVault.treasuryBalance();
    expect(pending).to.be.gt(treasury); // reward owed exceeds the treasury

    const aliceBefore = await d.moveToken.balanceOf(alice.address);
    await d.moveVault.connect(alice).claimReward();

    // Nothing is paid (not even a partial amount), and the treasury is untouched.
    expect(await d.moveToken.balanceOf(alice.address)).to.equal(aliceBefore);
    expect(await d.moveVault.treasuryBalance()).to.equal(treasury);

    // The claim timestamp was NOT advanced, so the debt keeps compounding —
    // pending strictly grows after more time elapses.
    await time.increase(1000);
    expect(await d.moveVault.pendingReward(alice.address)).to.be.gt(pending);

    // Intended V2 invariant: partial payment or explicit unpaid-reward
    // accounting, so an under-funded treasury cannot permanently strand rewards.
  });

  // ── Issue #13 ─────────────────────────────────────────────────────────────
  it("V1 characterization (known discrepancy #13): changing rewardRatePerSecond retroactively re-prices the ENTIRE interval since the last claim", async function () {
    const d = await deployAll();
    const alice = d.signers[2];

    await fundMove(d, alice, 20_000n);
    await d.moveToken.connect(alice).approve(await d.moveVault.getAddress(), MAX);

    // Stake while the reward rate is still 0 (default).
    const stakeAmount = ethers.parseEther("100");
    await d.moveVault.connect(alice).stake(stakeAmount);
    expect(await d.moveVault.rewardRatePerSecond()).to.equal(0n);

    // Let a long interval pass with rate == 0. No reward should have "really"
    // accrued during this window.
    await time.increase(1000);
    expect(await d.moveVault.pendingReward(alice.address)).to.equal(0n);

    // Now raise the rate. Because accrual is computed as
    // amount * rate * (now - lastClaim), the whole 1000s that elapsed at rate 0
    // is retroactively re-priced at the NEW rate.
    const newRate = ethers.parseEther("0.001"); // 1e15
    await d.moveVault.setRewardRate(newRate);

    const pending = await d.moveVault.pendingReward(alice.address);
    // Retroactive lower bound: amount * newRate * ~1000s / 1e18 (allow slack for
    // the couple of extra seconds from intervening txs). A checkpointed design
    // would show ~0 here.
    const retroLowerBound = (stakeAmount * newRate * 1000n) / ethers.parseEther("1");
    expect(pending).to.be.gte(retroLowerBound);

    // Intended V2 invariant: rate changes must be checkpointed and must not
    // rewrite historical accrual.
  });

  // ── Issue #14 ─────────────────────────────────────────────────────────────
  it("V1 characterization (known discrepancy #14): the same tokens vote twice when transferred between wallets (live-balance voting, no snapshot)", async function () {
    const d = await deployAll();
    const walletA = d.signers[2];
    const walletB = d.signers[3];

    await fundMove(d, walletA, 20_000n); // 200 $MOVE, enough to propose (>=100)
    const amount = await d.moveToken.balanceOf(walletA.address);
    expect(await d.moveToken.balanceOf(walletB.address)).to.equal(0n);

    // Propose an EmissionAdjust that calls moveToken.updateBaseRate — MovenDAO
    // holds GOVERNOR_ROLE (deploy wiring), so this target call is executable.
    const callData = d.moveToken.interface.encodeFunctionData("updateBaseRate", [ethers.parseEther("7")]);
    const proposeTx = await d.movenDAO
      .connect(walletA)
      .propose(3 /* EmissionAdjust */, "retro rate", await d.moveToken.getAddress(), callData);
    await proposeTx.wait();
    const proposalId = 1n;

    // walletA votes with its live balance.
    await d.movenDAO.connect(walletA).vote(proposalId, true);
    // The exact same tokens are moved to walletB, who votes again.
    await d.moveToken.connect(walletA).transfer(walletB.address, amount);
    await d.movenDAO.connect(walletB).vote(proposalId, true);

    const p = await d.movenDAO.proposals(proposalId);
    // forVotes counts the same tokens twice: weightA (amount) + weightB (amount).
    expect(p.forVotes).to.equal(amount * 2n);
    expect(await d.movenDAO.hasVoted(proposalId, walletA.address)).to.equal(true);
    expect(await d.movenDAO.hasVoted(proposalId, walletB.address)).to.equal(true);

    // Quorum is read LIVE from moveVault.totalStaked() at execution time (not a
    // snapshot). With no stakers it is 0, so the double-counted proposal
    // executes and actually changes the base rate.
    expect(await d.moveVault.totalStaked()).to.equal(0n);
    await time.increase(9 * 24 * 3600 + 1); // VOTING_PERIOD (7d) + EXECUTION_DELAY (2d)
    await d.movenDAO.execute(proposalId);
    expect(await d.moveToken.baseRate()).to.equal(ethers.parseEther("7"));

    // Intended V2 invariant: vote weight must come from a snapshot at proposal
    // creation, and quorum from a snapshotted stake total — not live balances.
  });

  // ── Issue #15 ─────────────────────────────────────────────────────────────
  it("V1 characterization (known discrepancy #15): as-deployed wiring never grants MoveVault.DAO_ROLE to MovenDAO, so DAO-scoped vault functions are unreachable by the DAO", async function () {
    const d = await deployAll(); // wiring mirrors scripts/deploy/baseSepolia.ts

    const DAO_ROLE = ethers.id("DAO_ROLE");
    // The deploy script grants MoveToken roles to the DAO, but NEVER calls
    // moveVault.grantRole(DAO_ROLE, movenDAO). So the DAO lacks it:
    expect(await d.moveVault.hasRole(DAO_ROLE, await d.movenDAO.getAddress())).to.equal(false);

    // Prove the consequence directly: a call originating from the MovenDAO
    // contract address to a DAO_ROLE-gated vault function reverts on access
    // control. (A governance proposal targeting the vault would bubble this up
    // as "MovenDAO: execution failed".)
    const daoAddr = await d.movenDAO.getAddress();
    await impersonateAccount(daoAddr);
    await setBalance(daoAddr, ethers.parseEther("1"));
    const daoSigner = await ethers.getSigner(daoAddr);

    await expect(
      d.moveVault.connect(daoSigner).setRewardRate(ethers.parseEther("0.001")),
    ).to.be.revertedWithCustomError(d.moveVault, "AccessControlUnauthorizedAccount");
    await expect(
      d.moveVault.connect(daoSigner).withdrawTreasury(daoAddr, 1n),
    ).to.be.revertedWithCustomError(d.moveVault, "AccessControlUnauthorizedAccount");

    // NOTE: this PR does NOT change roles. V2 deployment wiring must decide and
    // document whether MovenDAO should hold MoveVault.DAO_ROLE.
  });
});
