// Copied next to test/v3/ by run.sh (original mode); imports resolve there.
// G5 revenue-valve, liquidity-fallback and emission invariants on the prototype at the
// pinned commit. Each test is either a FAILURE MODE (the prototype allows something the
// design intends to forbid) or an INVARIANT THAT HOLDS. In-process Hardhat network only.
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  ONE,
  DAY_ONE_POOL,
  Suite,
  deploySuite,
  execViaTimelock,
  fundLockedMove,
  publishSettlement,
  settlementAuthorization,
} from "../v3/helpers";

const DAY = 24 * 3600;
const fx = (): Promise<Suite> => loadFixture(deploySuite);
const raise = (f: Suite, amount: bigint, salt: string) =>
  execViaTimelock(f, f.addresses.settlement,
    f.settlement.interface.encodeFunctionData("raiseLiquidIssuanceAllowance", [amount]), ethers.id(salt));

describe("G5 valve / fallback / emission (c8262ec)", () => {
  it("FAILURE MODE V1: one timelocked action opens the valve to the whole 400M allocation; nothing links it to revenue", async () => {
    const f = await fx();
    await raise(f, 400_000_000n * ONE, "v1");
    expect(await f.settlement.liquidIssuanceAllowance()).to.equal(400_000_000n * ONE);
    // The first day's whole pool can then be issued liquid.
    await (await publishSettlement(f, await settlementAuthorization({
      dayId: 1, grossIssuance: DAY_ONE_POOL, lockedClaims: 0n, liquidMovementClaims: DAY_ONE_POOL,
    }))).wait();
    expect((await f.rewards.dayAllocation(1)).liquidAllocated).to.equal(DAY_ONE_POOL);
  });

  it("FAILURE MODE V2: unused allowance never expires; it is still spendable a year later", async () => {
    const f = await fx();
    await raise(f, 1_000n * ONE, "v2");
    await time.increase(365 * DAY);
    expect(await f.settlement.liquidIssuanceAllowance()).to.equal(1_000n * ONE);
    await (await publishSettlement(f, await settlementAuthorization({
      dayId: 1, grossIssuance: 1_000n * ONE, lockedClaims: 0n, liquidMovementClaims: 1_000n * ONE,
    }))).wait();
    expect(await f.settlement.liquidIssuanceAllowance()).to.equal(0n);
  });

  it("FAILURE MODE V3 (= M4): with the valve shut, toll credits are still issued liquid, so the all-locked legal fallback cannot be set by configuration", async () => {
    const f = await fx();
    expect(await f.settlement.liquidIssuanceAllowance()).to.equal(0n);
    const gross = 1_000n * ONE;
    const toll = (gross * 200n) / 10_000n;
    await (await publishSettlement(f, await settlementAuthorization({ dayId: 1, grossIssuance: gross, tollBase: gross, tollCredits: toll }))).wait();
    expect((await f.rewards.dayAllocation(1)).liquidAllocated).to.equal(toll);
    // The only lever left is pausing publication, which stops every reward, locked included.
    await (await f.settlement.connect(f.guardian).pausePublication()).wait();
    await expect(publishSettlement(f, await settlementAuthorization({ dayId: 2, grossIssuance: gross })))
      .to.be.revertedWithCustomError(f.settlement, "PublicationIsPaused");
  });

  it("INVARIANT: the guardian can shut the valve at once (saturating at zero) but can never open it", async () => {
    const f = await fx();
    await raise(f, 500n * ONE, "inv1");
    await (await f.settlement.connect(f.guardian).reduceLiquidIssuanceAllowance(10n ** 30n)).wait();
    expect(await f.settlement.liquidIssuanceAllowance()).to.equal(0n);
    await expect(f.settlement.connect(f.guardian).raiseLiquidIssuanceAllowance(1n)).to.be.reverted;
    await expect(f.settlement.connect(f.settlementSigner).reduceLiquidIssuanceAllowance(1n)).to.be.reverted;
  });

  it("INVARIANT: liquid issued never exceeds the allowance raised (plus tolls): a second draw on a spent valve is refused", async () => {
    const f = await fx();
    await raise(f, 100n * ONE, "inv2");
    await (await publishSettlement(f, await settlementAuthorization({
      dayId: 1, grossIssuance: 100n * ONE, lockedClaims: 0n, liquidMovementClaims: 100n * ONE,
    }))).wait();
    await expect(publishSettlement(f, await settlementAuthorization({
      dayId: 2, grossIssuance: 1n, lockedClaims: 0n, liquidMovementClaims: 1n,
    }))).to.be.revertedWithCustomError(f.settlement, "LiquidIssuanceAllowanceExceeded");
  });

  it("INVARIANT: burning never frees lifetime mint capacity (cumulativeMinted is monotonic)", async () => {
    const f = await fx();
    await fundLockedMove(f, 1, [{ account: f.alice.address, amount: 50n * ONE }]);
    const before = await f.token.cumulativeMinted();
    const capacity = await f.token.remainingMintCapacity();
    await (await f.token.connect(f.alice).burn(50n * ONE)).wait();
    expect(await f.token.cumulativeMinted()).to.equal(before);
    expect(await f.token.remainingMintCapacity()).to.equal(capacity);
    expect(await f.token.totalSupply()).to.equal(0n);
  });

  it("INVARIANT: the automatic day-close burn is capped at 60% of the day's gross", async () => {
    const f = await fx();
    const gross = 1_000n * ONE;
    await expect(publishSettlement(f, await settlementAuthorization({ dayId: 1, grossIssuance: gross, automaticBurn: (gross * 6001n) / 10_000n })))
      .to.be.revertedWithCustomError(f.settlement, "AutomaticBurnExceedsCap");
    await expect(publishSettlement(f, await settlementAuthorization({ dayId: 1, grossIssuance: gross, automaticBurn: (gross * 6000n) / 10_000n })))
      .to.not.be.reverted;
  });

  it("FAILURE MODE V4: locked balances cannot be transferred, but they are spendable on deed fees (see M7), which is the locked-to-liquid leak", async () => {
    const f = await fx();
    await fundLockedMove(f, 1, [{ account: f.alice.address, amount: 10n * ONE }]);
    await expect(f.token.connect(f.alice).transfer(f.bob.address, 1n))
      .to.be.revertedWithCustomError(f.token, "LockedBalanceNotTransferable");
    expect(await f.token.lockedBalanceOf(f.alice.address)).to.equal(10n * ONE);
  });
});
