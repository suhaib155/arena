import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import {
  ONE,
  Suite,
  buildRewardTree,
  deploySuite,
  publishSettlement,
  settlementAuthorization,
} from "./helpers";

const GROSS = 10_000n * ONE;
const TOLL = 200n * ONE; // exactly two percent of the gross reward base
const LOCKED = GROSS - TOLL;

/** A finalized day whose tree pays one runner in locked MOVE and one deed owner the toll. */
async function finalizedDay() {
  const fx: Suite = await loadFixture(deploySuite);
  const entries = [
    { leafIndex: 0, account: fx.alice.address, lockedAmount: 6_000n * ONE, liquidAmount: 0n },
    { leafIndex: 1, account: fx.bob.address, lockedAmount: 3_800n * ONE, liquidAmount: 0n },
    { leafIndex: 2, account: fx.carol.address, lockedAmount: 0n, liquidAmount: TOLL },
  ];
  const tree = buildRewardTree(fx.chainId, fx.addresses.rewards, 1, entries);

  await (
    await publishSettlement(
      fx,
      await settlementAuthorization({
        dayId: 1,
        grossIssuance: GROSS,
        lockedClaims: LOCKED,
        tollBase: GROSS,
        tollCredits: TOLL,
        merkleRoot: tree.root,
        participantCount: 3,
      })
    )
  ).wait();

  return { fx, entries, tree };
}

describe("V3 MovenRunRewards", () => {
  it("finalizes the day with the locked and liquid allocation the settlement declared", async () => {
    const { fx } = await finalizedDay();
    const day = await fx.rewards.dayAllocation(1);

    expect(day.finalized).to.equal(true);
    expect(day.lockedAllocated).to.equal(LOCKED);
    expect(day.liquidAllocated).to.equal(TOLL);
    expect(await fx.token.balanceOf(fx.addresses.rewards)).to.equal(GROSS);
  });

  it("pays a valid proof and classifies locked and liquid correctly", async () => {
    const { fx, entries, tree } = await finalizedDay();

    await (
      await fx.rewards
        .connect(fx.relayer)
        .claim(1, 0, fx.alice.address, entries[0].lockedAmount, 0n, tree.proofFor(0))
    ).wait();

    // A movement reward arrives locked: present in the balance, not transferable.
    expect(await fx.token.balanceOf(fx.alice.address)).to.equal(6_000n * ONE);
    expect(await fx.token.lockedBalanceOf(fx.alice.address)).to.equal(6_000n * ONE);
    expect(await fx.token.liquidBalanceOf(fx.alice.address)).to.equal(0n);
    await expect(
      fx.token.connect(fx.alice).transfer(fx.bob.address, 1n)
    ).to.be.revertedWithCustomError(fx.token, "LockedBalanceNotTransferable");

    // The deed owner's toll credit arrives liquid and moves freely.
    await (
      await fx.rewards.connect(fx.relayer).claim(1, 2, fx.carol.address, 0n, TOLL, tree.proofFor(2))
    ).wait();
    expect(await fx.token.lockedBalanceOf(fx.carol.address)).to.equal(0n);
    expect(await fx.token.liquidBalanceOf(fx.carol.address)).to.equal(TOLL);
    await (await fx.token.connect(fx.carol).transfer(fx.bob.address, TOLL)).wait();
    expect(await fx.token.balanceOf(fx.bob.address)).to.equal(TOLL);
  });

  it("pays the committed account even when somebody else relays the claim", async () => {
    const { fx, entries, tree } = await finalizedDay();
    await (
      await fx.rewards
        .connect(fx.bob)
        .claim(1, 0, fx.alice.address, entries[0].lockedAmount, 0n, tree.proofFor(0))
    ).wait();
    expect(await fx.token.balanceOf(fx.alice.address)).to.equal(6_000n * ONE);
  });

  it("refuses a proof that does not belong to the leaf", async () => {
    const { fx, entries, tree } = await finalizedDay();

    await expect(
      fx.rewards.connect(fx.alice).claim(1, 0, fx.alice.address, entries[0].lockedAmount, 0n, tree.proofFor(1))
    ).to.be.revertedWithCustomError(fx.rewards, "InvalidMerkleProof");

    // An amount the tree never committed to is equally unprovable.
    await expect(
      fx.rewards.connect(fx.alice).claim(1, 0, fx.alice.address, 6_001n * ONE, 0n, tree.proofFor(0))
    ).to.be.revertedWithCustomError(fx.rewards, "InvalidMerkleProof");

    // So is redirecting another account's leaf.
    await expect(
      fx.rewards.connect(fx.alice).claim(1, 1, fx.alice.address, entries[1].lockedAmount, 0n, tree.proofFor(1))
    ).to.be.revertedWithCustomError(fx.rewards, "InvalidMerkleProof");
  });

  it("refuses a duplicate claim of the same leaf", async () => {
    const { fx, entries, tree } = await finalizedDay();

    await (
      await fx.rewards.connect(fx.alice).claim(1, 0, fx.alice.address, entries[0].lockedAmount, 0n, tree.proofFor(0))
    ).wait();
    expect(await fx.rewards.isClaimed(1, 0)).to.equal(true);

    await expect(
      fx.rewards.connect(fx.alice).claim(1, 0, fx.alice.address, entries[0].lockedAmount, 0n, tree.proofFor(0))
    )
      .to.be.revertedWithCustomError(fx.rewards, "RewardAlreadyClaimed")
      .withArgs(1, 0);
  });

  it("refuses a claim against a day that was never finalized", async () => {
    const { fx, entries, tree } = await finalizedDay();
    await expect(
      fx.rewards.connect(fx.alice).claim(2, 0, fx.alice.address, entries[0].lockedAmount, 0n, tree.proofFor(0))
    ).to.be.revertedWithCustomError(fx.rewards, "DayNotFinalized");
  });

  it("refuses aggregate claims beyond the day's declared allocation", async () => {
    const fx: Suite = await loadFixture(deploySuite);

    // A tree that promises more than the settlement funded. The root is committed offchain,
    // so the contract has to be the thing that refuses to overpay.
    const entries = [
      { leafIndex: 0, account: fx.alice.address, lockedAmount: 600n * ONE, liquidAmount: 0n },
      { leafIndex: 1, account: fx.bob.address, lockedAmount: 600n * ONE, liquidAmount: 0n },
    ];
    const tree = buildRewardTree(fx.chainId, fx.addresses.rewards, 1, entries);

    await (
      await publishSettlement(
        fx,
        await settlementAuthorization({ dayId: 1, grossIssuance: 1_000n * ONE, merkleRoot: tree.root })
      )
    ).wait();

    await (
      await fx.rewards.connect(fx.alice).claim(1, 0, fx.alice.address, 600n * ONE, 0n, tree.proofFor(0))
    ).wait();

    await expect(
      fx.rewards.connect(fx.bob).claim(1, 1, fx.bob.address, 600n * ONE, 0n, tree.proofFor(1))
    )
      .to.be.revertedWithCustomError(fx.rewards, "LockedAllocationExceeded")
      .withArgs(1);
  });

  it("refuses aggregate liquid claims beyond the day's liquid allocation", async () => {
    const fx: Suite = await loadFixture(deploySuite);
    const entries = [
      { leafIndex: 0, account: fx.alice.address, lockedAmount: 0n, liquidAmount: 30n * ONE },
      { leafIndex: 1, account: fx.bob.address, lockedAmount: 980n * ONE, liquidAmount: 0n },
    ];
    const tree = buildRewardTree(fx.chainId, fx.addresses.rewards, 1, entries);

    await (
      await publishSettlement(
        fx,
        await settlementAuthorization({
          dayId: 1,
          grossIssuance: 1_000n * ONE,
          lockedClaims: 980n * ONE,
          tollBase: 1_000n * ONE,
          tollCredits: 20n * ONE,
          merkleRoot: tree.root,
        })
      )
    ).wait();

    await expect(
      fx.rewards.connect(fx.alice).claim(1, 0, fx.alice.address, 0n, 30n * ONE, tree.proofFor(0))
    )
      .to.be.revertedWithCustomError(fx.rewards, "LiquidAllocationExceeded")
      .withArgs(1);
  });

  it("keeps claims available while settlement publication is paused", async () => {
    const { fx, entries, tree } = await finalizedDay();

    await (await fx.settlement.connect(fx.guardian).pausePublication()).wait();
    expect(await fx.settlement.publicationPaused()).to.equal(true);

    await (
      await fx.rewards.connect(fx.alice).claim(1, 0, fx.alice.address, entries[0].lockedAmount, 0n, tree.proofFor(0))
    ).wait();
    expect(await fx.token.balanceOf(fx.alice.address)).to.equal(6_000n * ONE);
  });

  it("has no administrator, no pause and no withdrawal path", async () => {
    const fx: Suite = await loadFixture(deploySuite);
    const functions = fx.rewards.interface.fragments
      .filter((f: any) => f.type === "function")
      .map((f: any) => f.name);

    for (const forbidden of ["pause", "unpause", "withdraw", "rescue", "sweep", "grantRole", "setOwner", "transferOwnership"]) {
      expect(functions).to.not.include(forbidden);
    }
    expect(await fx.rewards.bootstrapper()).to.equal(ethers.ZeroAddress);
  });

  it("finalizes a day only on behalf of the settlement contract", async () => {
    const fx: Suite = await loadFixture(deploySuite);
    await expect(
      fx.rewards.connect(fx.admin).finalizeDay(1, ethers.id("root"), 1n, 0n)
    ).to.be.revertedWithCustomError(fx.rewards, "NotSettlement");
  });

  it("binds a reward leaf to this chain and this rewards contract", async () => {
    const fx: Suite = await loadFixture(deploySuite);
    const onchain = await fx.rewards.rewardLeaf(1, 0, fx.alice.address, 1n * ONE, 0n);
    const offchain = buildRewardTree(fx.chainId, fx.addresses.rewards, 1, [
      { leafIndex: 0, account: fx.alice.address, lockedAmount: 1n * ONE, liquidAmount: 0n },
    ]).leaves[0];
    expect(onchain).to.equal(offchain);

    const otherChain = buildRewardTree(fx.chainId + 1, fx.addresses.rewards, 1, [
      { leafIndex: 0, account: fx.alice.address, lockedAmount: 1n * ONE, liquidAmount: 0n },
    ]).leaves[0];
    expect(onchain).to.not.equal(otherChain);
  });
});
