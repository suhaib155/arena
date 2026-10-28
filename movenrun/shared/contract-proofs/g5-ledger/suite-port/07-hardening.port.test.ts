// NEW hardening tests (not in c8262ec). RESEARCH/PROPOSED, unaudited. Patched build, Hardhat
// in-process network only; no RPC, no deploy, no keys beyond Hardhat's built-in test accounts.
//   D. deed void lifecycle (docs/contracts/DEED_VOID_LIFECYCLE.md)
//   E. time-locked valve: epoch cap, monotonic budget, expiry, emergency halt, timelock floor
//   F. eligibility signer roles: one admin key cannot rotate both signers alone
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  ONE,
  DAY,
  CHALLENGE_WINDOW,
  PLAYER_MOVEMENT_ALLOCATION,
  TIMELOCK_DELAY,
  ZERO_ADDRESS,
  ZERO_BYTES32,
  Suite,
  claimDeed,
  claimWithAttestation,
  configureCityCap,
  deploySuite,
  eligibilityAttestationV2,
  execViaTimelock,
  publishSettlement,
  settlementAuthorization,
  waitOutChallengeWindow,
} from "./portHelpers";
import { cityCells } from "../v3/cells";

const CITY = 7;
const EPOCH_CAP = 3_000_000n * ONE;
const VALVE_EPOCH = 30 * DAY;
const RECLAIM_COOLDOWN = 7 * DAY;
const APPEAL_WINDOW = 30 * DAY;
const LIVE = 1n;
const FAULT = 2n;
const ADMIN_RESTORED = 3n;
const ADMIN_NOT_RESTORED = 4n;

const fx = (): Promise<Suite> => loadFixture(deploySuite);
async function cityFx(): Promise<Suite> {
  const f = await deploySuite();
  await configureCityCap(f, CITY, 3); // per-holder 3, city-wide 1000, cluster cap 1, 50/day
  return f;
}
const fxCity = (): Promise<Suite> => loadFixture(cityFx);
const raise = (f: Suite, amount: bigint, salt: string) =>
  execViaTimelock(f, f.addresses.settlement,
    f.settlement.interface.encodeFunctionData("raiseLiquidIssuanceAllowance", [amount]), ethers.id(salt));
const cells = cityCells(10);
const RING = ethers.id("cluster:honest-solo");

describe("G5 hardening: void lifecycle, valve, signer roles (patched, RESEARCH/PROPOSED)", () => {
  describe("D. deed void lifecycle", () => {
    it("D1 claim+FAULT void: every counter stays spent; the same cluster cannot reclaim (no free retry)", async () => {
      const f = await fxCity();
      await (await claimDeed(f, f.alice, cells[0], CITY, { clusterId: RING })).wait();
      expect(await f.deedClaims.claimIdOfToken(cells[0])).to.equal(1n);
      await expect(f.deed.connect(f.voider).voidPendingDeed(cells[0], 1))
        .to.emit(f.deedClaims, "ClaimVoided").withArgs(1n, cells[0], f.alice.address, FAULT);
      expect((await f.deedClaims.claimRecord(1n)).status).to.equal(FAULT);
      expect(await f.deedClaims.clusterClaimCount(CITY, RING)).to.equal(1n);
      expect(await f.deedClaims.totalClaims()).to.equal(1n);
      await time.increase(60 * DAY);
      await expect(claimDeed(f, f.alice, cells[1], CITY, { clusterId: RING }))
        .to.be.revertedWithCustomError(f.deedClaims, "ClusterCapReached");
    });

    it("D2 claim+ADMINISTRATIVE void: the honest cluster is not bricked, but only after the cooldown; daily and lifetime counters stay spent", async () => {
      const f = await fxCity();
      await (await claimDeed(f, f.alice, cells[0], CITY, { clusterId: RING })).wait();
      const day = BigInt(Math.floor((await time.latest()) / DAY));
      await expect(f.deed.connect(f.voider).voidPendingDeedAdministrative(cells[0], 9))
        .to.emit(f.deedClaims, "ClusterCapacityRestored");
      expect((await f.deedClaims.claimRecord(1n)).status).to.equal(ADMIN_RESTORED);
      expect(await f.deedClaims.clusterClaimCount(CITY, RING)).to.equal(0n);
      expect(await f.deedClaims.cityClaimsOnDay(CITY, day)).to.equal(1n);
      expect(await f.deedClaims.totalClaims()).to.equal(1n);
      expect(await f.deed.holderCityDeedCount(f.alice.address, CITY)).to.equal(0n);
      // No immediate reclaim: same cell or another, same cluster.
      await expect(claimDeed(f, f.alice, cells[0], CITY, { clusterId: RING }))
        .to.be.revertedWithCustomError(f.deedClaims, "ClusterReclaimCoolingDown");
      await time.increase(RECLAIM_COOLDOWN - 60);
      await expect(claimDeed(f, f.alice, cells[1], CITY, { clusterId: RING }))
        .to.be.revertedWithCustomError(f.deedClaims, "ClusterReclaimCoolingDown");
      await time.increase(120);
      await (await claimDeed(f, f.alice, cells[0], CITY, { clusterId: RING })).wait();
      expect(await f.deed.ownerOf(cells[0])).to.equal(f.alice.address);
      expect(await f.deedClaims.totalClaims()).to.equal(2n);
    });

    it("D3 loop: claim -> admin void -> reclaim -> admin void ends with the cluster exhausted; it never holds more than the cluster cap and gets exactly one restoration", async () => {
      const f = await fxCity();
      let live = 0;
      let maxLive = 0;
      await (await claimDeed(f, f.alice, cells[0], CITY, { clusterId: RING })).wait();
      maxLive = Math.max(maxLive, ++live);
      await (await f.deed.connect(f.voider).voidPendingDeedAdministrative(cells[0], 9)).wait(); live--;
      await time.increase(RECLAIM_COOLDOWN);
      await (await claimDeed(f, f.alice, cells[1], CITY, { clusterId: RING })).wait();
      maxLive = Math.max(maxLive, ++live);
      await expect(claimDeed(f, f.alice, cells[2], CITY, { clusterId: RING }))
        .to.be.revertedWithCustomError(f.deedClaims, "ClusterCapReached");
      await expect(f.deed.connect(f.voider).voidPendingDeedAdministrative(cells[1], 9))
        .to.emit(f.deedClaims, "ClaimVoided").withArgs(2n, cells[1], f.alice.address, ADMIN_NOT_RESTORED);
      live--;
      expect(await f.deedClaims.clusterRestorationUsed(CITY, RING)).to.equal(true);
      for (let i = 0; i < 3; i += 1) {
        await time.increase(RECLAIM_COOLDOWN);
        await expect(claimDeed(f, f.alice, cells[3 + i], CITY, { clusterId: RING }))
          .to.be.revertedWithCustomError(f.deedClaims, "ClusterCapReached");
      }
      expect(maxLive).to.equal(1);
      expect(live).to.equal(0);
      expect(await f.deed.balanceOf(f.alice.address)).to.equal(0n);
      expect(await f.deedClaims.totalClaims()).to.equal(2n); // lifetime issuance per cluster <= cap + 1
    });

    it("D4 replay: the voided attestation cannot be resubmitted (nonce consumed), the hook is deed-only, and a final deed cannot be voided in either class", async () => {
      const f = await fxCity();
      const att = await eligibilityAttestationV2({ claimant: f.alice.address, h3CellId: cells[0], cityId: CITY, clusterId: RING });
      await (await claimWithAttestation(f, f.alice, att)).wait();
      await (await f.deed.connect(f.voider).voidPendingDeedAdministrative(cells[0], 9)).wait();
      await time.increase(RECLAIM_COOLDOWN);
      const fresh = { ...att, expiry: (await time.latest()) + 3600 };
      await expect(claimWithAttestation(f, f.alice, fresh))
        .to.be.revertedWithCustomError(f.deedClaims, "AttestationAlreadyUsed");
      await expect(f.deedClaims.connect(f.alice).onDeedVoided(cells[0], f.alice.address, true))
        .to.be.revertedWithCustomError(f.deedClaims, "NotDeedContract");
      await expect(f.deedClaims.connect(f.voider).onDeedVoided(cells[0], f.alice.address, true))
        .to.be.revertedWithCustomError(f.deedClaims, "NotDeedContract");
      // A deed past its window is out of administrative reach (seizure protection kept).
      await (await claimDeed(f, f.bob, cells[1], CITY)).wait();
      await waitOutChallengeWindow(f, cells[1]);
      await expect(f.deed.connect(f.voider).voidPendingDeedAdministrative(cells[1], 9))
        .to.be.revertedWithCustomError(f.deed, "DeedAlreadyFinal");
      await expect(f.deed.connect(f.voider).voidPendingDeed(cells[1], 1))
        .to.be.revertedWithCustomError(f.deed, "DeedAlreadyFinal");
      await expect(f.deed.connect(f.alice).voidPendingDeedAdministrative(cells[1], 9)).to.be.reverted;
      void CHALLENGE_WINDOW;
    });

    it("D5 appeal: the timelock may reclassify a FAULT void once inside 30 days (capacity only, deed not reinstated); not the voider, not twice, not late", async () => {
      const f = await fxCity();
      await (await claimDeed(f, f.alice, cells[0], CITY, { clusterId: RING })).wait();
      await (await f.deed.connect(f.voider).voidPendingDeed(cells[0], 1)).wait();
      await expect(f.deedClaims.connect(f.voider).reclassifyFaultVoid(1n)).to.be.reverted;
      await expect(f.deedClaims.connect(f.admin).reclassifyFaultVoid(1n)).to.be.reverted;
      const call = f.deedClaims.interface.encodeFunctionData("reclassifyFaultVoid", [1n]);
      await execViaTimelock(f, f.addresses.deedClaims, call, ethers.id("appeal-1"));
      expect((await f.deedClaims.claimRecord(1n)).status).to.equal(ADMIN_RESTORED);
      expect(await f.deed.deedExists(cells[0])).to.equal(false);
      await expect(execViaTimelock(f, f.addresses.deedClaims, call, ethers.id("appeal-2")))
        .to.be.revertedWithCustomError(f.deedClaims, "NotAFaultVoid");
      await time.increase(RECLAIM_COOLDOWN);
      await (await claimDeed(f, f.alice, cells[0], CITY, { clusterId: RING })).wait();

      // A second cluster whose appeal arrives after the window stays voided as FAULT.
      const other = ethers.id("cluster:late");
      await (await claimDeed(f, f.bob, cells[1], CITY, { clusterId: other })).wait();
      await (await f.deed.connect(f.voider).voidPendingDeed(cells[1], 1)).wait();
      await time.increase(APPEAL_WINDOW + 1);
      await expect(execViaTimelock(f, f.addresses.deedClaims,
        f.deedClaims.interface.encodeFunctionData("reclassifyFaultVoid", [3n]), ethers.id("appeal-late")))
        .to.be.revertedWithCustomError(f.deedClaims, "AppealWindowClosed");
      expect((await f.deedClaims.claimRecord(3n)).status).to.equal(FAULT);
    });

    it("D6 relinquish of a pending deed restores nothing, and a cell reclaimed by someone else keeps its own live record", async () => {
      const f = await fxCity();
      await (await claimDeed(f, f.alice, cells[0], CITY, { clusterId: RING })).wait();
      await (await f.deed.connect(f.alice).relinquish(cells[0])).wait();
      expect(await f.deedClaims.clusterClaimCount(CITY, RING)).to.equal(1n);
      expect((await f.deedClaims.claimRecord(1n)).status).to.equal(LIVE);
      await (await claimDeed(f, f.bob, cells[0], CITY)).wait();
      expect(await f.deedClaims.claimIdOfToken(cells[0])).to.equal(2n);
      await (await f.deed.connect(f.voider).voidPendingDeedAdministrative(cells[0], 9)).wait();
      expect((await f.deedClaims.claimRecord(2n)).status).to.equal(ADMIN_RESTORED);
      expect((await f.deedClaims.claimRecord(1n)).status).to.equal(LIVE); // alice's relinquished claim untouched
      expect(await f.deedClaims.clusterClaimCount(CITY, RING)).to.equal(1n);
    });
  });

  describe("E. time-locked valve", () => {
    it("E1 a single call cannot open the full 400M, nor even one wei above the epoch cap", async () => {
      const f = await fx();
      await expect(raise(f, PLAYER_MOVEMENT_ALLOCATION, "e1a"))
        .to.be.revertedWithCustomError(f.settlement, "EpochReleaseCapExceeded");
      await expect(raise(f, EPOCH_CAP + 1n, "e1b"))
        .to.be.revertedWithCustomError(f.settlement, "EpochReleaseCapExceeded");
      await raise(f, EPOCH_CAP / 2n, "e1c");
      await expect(raise(f, EPOCH_CAP / 2n + 1n, "e1d"))
        .to.be.revertedWithCustomError(f.settlement, "EpochReleaseCapExceeded").withArgs(EPOCH_CAP / 2n + 1n, EPOCH_CAP / 2n);
      await raise(f, EPOCH_CAP / 2n, "e1e");
      expect(await f.settlement.liquidIssuanceAllowance()).to.equal(EPOCH_CAP);
    });

    it("E2 monotonic budget: guardian reduction does not give epoch headroom back, so reduce+raise cannot loop past the cap", async () => {
      const f = await fx();
      await raise(f, EPOCH_CAP, "e2a");
      await (await f.settlement.connect(f.guardian).reduceLiquidIssuanceAllowance(EPOCH_CAP)).wait();
      expect(await f.settlement.liquidIssuanceAllowance()).to.equal(0n);
      expect(await f.settlement.epochLiquidRaised(0)).to.equal(EPOCH_CAP);
      await expect(raise(f, 1n, "e2b")).to.be.revertedWithCustomError(f.settlement, "EpochReleaseCapExceeded");
      expect(await f.settlement.lifetimeLiquidAuthorized()).to.equal(EPOCH_CAP);
    });

    it("E3 stale approval expires: allowance raised in one epoch is zero in the next and cannot be drawn", async () => {
      const f = await fx();
      await raise(f, 500n * ONE, "e3");
      const genesis = Number(await f.settlement.genesis());
      await time.increaseTo(genesis + VALVE_EPOCH - 10);
      expect(await f.settlement.liquidIssuanceAllowance()).to.equal(500n * ONE);
      await time.increaseTo(genesis + VALVE_EPOCH);
      expect(await f.settlement.liquidIssuanceAllowance()).to.equal(0n);
      await expect(publishSettlement(f, await settlementAuthorization(f, {
        dayId: 30, grossIssuance: 500n * ONE, lockedClaims: 0n, liquidMovementClaims: 500n * ONE,
      }))).to.be.revertedWithCustomError(f.settlement, "LiquidIssuanceAllowanceExceeded").withArgs(500n * ONE, 0n);
      // A fresh epoch has a fresh cap; the old remainder does not stack onto it.
      await raise(f, EPOCH_CAP, "e3b");
      expect(await f.settlement.liquidIssuanceAllowance()).to.equal(EPOCH_CAP);
    });

    it("E4 emergency halt: guardian halts at once; a raise already queued in the timelock then fails; liquid publication refused; only the timelock resumes, at zero", async () => {
      const f = await fx();
      await raise(f, 1_000n * ONE, "e4a");
      const data = f.settlement.interface.encodeFunctionData("raiseLiquidIssuanceAllowance", [1_000n * ONE]);
      await (await f.timelock.connect(f.admin).schedule(f.addresses.settlement, 0, data, ZERO_BYTES32, ethers.id("e4q"), TIMELOCK_DELAY)).wait();
      await expect(f.settlement.connect(f.alice).haltValve()).to.be.reverted;
      await expect(f.settlement.connect(f.guardian).haltValve()).to.emit(f.settlement, "ValveHaltUpdated").withArgs(true, f.guardian.address);
      expect(await f.settlement.liquidIssuanceAllowance()).to.equal(0n);
      await time.increase(TIMELOCK_DELAY + 1);
      await expect(f.timelock.connect(f.admin).execute(f.addresses.settlement, 0, data, ZERO_BYTES32, ethers.id("e4q")))
        .to.be.revertedWithCustomError(f.settlement, "ValveIsHalted");
      await expect(publishSettlement(f, await settlementAuthorization(f, {
        dayId: 1, grossIssuance: ONE, lockedClaims: 0n, liquidMovementClaims: ONE,
      }))).to.be.revertedWithCustomError(f.settlement, "ValveIsHalted");
      // Locked rewards keep flowing while the valve is halted.
      await (await publishSettlement(f, await settlementAuthorization(f, { dayId: 2, grossIssuance: ONE }))).wait();
      await expect(f.settlement.connect(f.guardian).resumeValve()).to.be.reverted;
      await execViaTimelock(f, f.addresses.settlement, f.settlement.interface.encodeFunctionData("resumeValve", []), ethers.id("e4r"));
      expect(await f.settlement.valveHalted()).to.equal(false);
      expect(await f.settlement.liquidIssuanceAllowance()).to.equal(0n);
    });

    it("E5 timelock floor: 1-second delays are refused at deploy and through updateDelay", async () => {
      const f = await fx();
      const factory = await ethers.getContractFactory("MovenRunTimelock");
      await expect(factory.deploy(1, [f.admin.address], [f.admin.address], ZERO_ADDRESS))
        .to.be.revertedWithCustomError(factory, "DelayBelowFloor");
      await expect(execViaTimelock(f, f.addresses.timelock, f.timelock.interface.encodeFunctionData("updateDelay", [1]), ethers.id("e5a")))
        .to.be.revertedWithCustomError(f.timelock, "DelayBelowFloor");
      await execViaTimelock(f, f.addresses.timelock, f.timelock.interface.encodeFunctionData("updateDelay", [2 * DAY]), ethers.id("e5b"));
      expect(await f.timelock.getMinDelay()).to.equal(BigInt(2 * DAY));
    });
    // Rewritten by the issue-ledger patch (28 Oct). Was "E6 epoch boundary (documented limit)",
    // which asserted that more than one epoch cap could be drawn within about three hours.
    it("FIXED E6 epoch boundary: withheld days spent across the boundary are refused by the rolling window; no 30-day interval issues more than one epoch cap", async () => {
      const f = await fx();
      const genesis = Number(await f.settlement.genesis());
      const CEIL = 200_000n * ONE;
      // Same attack as before: nothing published for 59 days, raise 2 hours before epoch 1 ends.
      await time.increaseTo(genesis + 2 * VALVE_EPOCH - 3 * 3600);
      await raise(f, EPOCH_CAP, "e6a");
      let day = 31;
      let liquid = 0n;
      const publishMax = async (lastDay: number) => {
        while (day <= lastDay) {
          const allowance: bigint = await f.settlement.liquidIssuanceAllowance();
          if (allowance === 0n) return;
          let gross: bigint = day === 31 ? 100_000n * ONE : await f.settlement.dailyPoolOf(day);
          if (gross > CEIL) gross = CEIL;
          if (gross > allowance) gross = allowance;
          await (await publishSettlement(f, await settlementAuthorization(f, {
            dayId: day, grossIssuance: gross, lockedClaims: 0n, liquidMovementClaims: gross,
          }))).wait();
          liquid += gross;
          day += 1;
        }
      };
      await publishMax(59);
      expect(liquid).to.equal(EPOCH_CAP);
      expect(await f.settlement.rollingLiquidRemaining()).to.equal(0n);
      // The calendar epoch cap alone would allow a second burst: the raise itself still succeeds.
      await time.increaseTo(genesis + 2 * VALVE_EPOCH);
      await raise(f, EPOCH_CAP, "e6b");
      expect(await f.settlement.epochLiquidRaised(2)).to.equal(EPOCH_CAP);
      expect(await f.settlement.liquidIssuanceAllowance()).to.equal(EPOCH_CAP);
      // But the rolling window refuses even one wei of liquid for the next 30 days.
      await expect(publishSettlement(f, await settlementAuthorization(f, {
        dayId: 60, grossIssuance: ONE, lockedClaims: 0n, liquidMovementClaims: ONE,
      }))).to.be.revertedWithCustomError(f.settlement, "RollingLiquidCapExceeded").withArgs(ONE, 0n);
      // Locked rewards are unaffected.
      await (await publishSettlement(f, await settlementAuthorization(f, { dayId: 60, grossIssuance: ONE }))).wait();
      expect(liquid).to.equal(EPOCH_CAP);
    });

    it("E7 rolling window recovers: 31 wall-clock days after a full burst, liquid capacity is available again (within that epoch's raise)", async () => {
      const f = await fx();
      const genesis = Number(await f.settlement.genesis());
      await time.increaseTo(genesis + 40 * DAY);
      await raise(f, EPOCH_CAP, "e7a");
      for (let d = 1; d <= 40; d += 1) {
        const left: bigint = await f.settlement.rollingLiquidRemaining();
        if (left === 0n) break;
        let gross: bigint = await f.settlement.dailyPoolOf(d);
        if (gross > 200_000n * ONE) gross = 200_000n * ONE;
        if (gross > left) gross = left;
        await (await publishSettlement(f, await settlementAuthorization(f, {
          dayId: d, grossIssuance: gross, lockedClaims: 0n, liquidMovementClaims: gross,
        }))).wait();
      }
      expect(await f.settlement.rollingLiquidPublished()).to.equal(EPOCH_CAP);
      const burstDay = Math.floor((await time.latest()) / DAY);
      await time.increaseTo((burstDay + 30) * DAY + 10);
      expect(await f.settlement.rollingLiquidRemaining()).to.equal(0n);
      await time.increaseTo((burstDay + 31) * DAY + 10);
      expect(await f.settlement.rollingLiquidRemaining()).to.equal(EPOCH_CAP);
      await raise(f, 100_000n * ONE, "e7b");
      const next = Number(await f.settlement.lastSettledDay()) + 1;
      await (await publishSettlement(f, await settlementAuthorization(f, {
        dayId: next, grossIssuance: 100_000n * ONE, lockedClaims: 0n, liquidMovementClaims: 100_000n * ONE,
      }))).wait();
    });
  });

  describe("F. eligibility signer roles", () => {
    it("F1 one admin key cannot replace both eligibility signers alone; with one approval it can add exactly one", async () => {
      const f = await fx();
      await configureCityCap(f, CITY, 3);
      const [k1, k2] = [f.outsider, f.voider];
      const reg = (who: string, salt: string) => execViaTimelock(f, f.addresses.deedClaims,
        f.deedClaims.interface.encodeFunctionData("setEligibilitySignerRegistered", [who, true]), ethers.id(salt));
      await expect(reg(k1.address, "f1a")).to.be.revertedWithCustomError(f.deedClaims, "SignerAdditionNotApproved");
      await (await f.deedClaims.connect(f.guardian).approveEligibilitySignerAddition(k1.address)).wait();
      await reg(k1.address, "f1b");
      // The approval is consumed: removing and re-adding k1, or adding k2, needs new approvals.
      await expect(reg(k2.address, "f1c")).to.be.revertedWithCustomError(f.deedClaims, "SignerAdditionNotApproved");
      await expect(execViaTimelock(f, f.addresses.deedClaims,
        f.deedClaims.interface.encodeFunctionData("setEligibilitySigner", [k2.address]), ethers.id("f1d")))
        .to.be.revertedWithCustomError(f.deedClaims, "SignerAdditionNotApproved");
      // Removal needs no approval (fails closed): the admin can drop keys but not replace them.
      await execViaTimelock(f, f.addresses.deedClaims,
        f.deedClaims.interface.encodeFunctionData("setEligibilitySignerRegistered", [f.deedSigner.address, false]), ethers.id("f1e"));
      await execViaTimelock(f, f.addresses.deedClaims,
        f.deedClaims.interface.encodeFunctionData("setEligibilitySignerRegistered", [f.eligibilityCoSigner.address, false]), ethers.id("f1f"));
      const att = await eligibilityAttestationV2({ claimant: f.alice.address, h3CellId: cells[0], cityId: CITY });
      await expect(claimWithAttestation(f, f.alice, att, [k1, k2]))
        .to.be.revertedWithCustomError(f.deedClaims, "SignersNotAscendingOrUnknown");
      await expect(claimWithAttestation(f, f.alice, att, [k1])).to.be.revertedWithCustomError(f.deedClaims, "ThresholdNotMet");
    });

    it("F2 approvals expire after 7 days, can be revoked, and the approver cannot register a signer itself", async () => {
      const f = await fx();
      await (await f.deedClaims.connect(f.guardian).approveEligibilitySignerAddition(f.outsider.address)).wait();
      await time.increase(7 * DAY + 1);
      await expect(execViaTimelock(f, f.addresses.deedClaims,
        f.deedClaims.interface.encodeFunctionData("setEligibilitySignerRegistered", [f.outsider.address, true]), ethers.id("f2a")))
        .to.be.revertedWithCustomError(f.deedClaims, "SignerAdditionNotApproved");
      await (await f.deedClaims.connect(f.guardian).approveEligibilitySignerAddition(f.outsider.address)).wait();
      await (await f.deedClaims.connect(f.guardian).revokeEligibilitySignerApproval(f.outsider.address)).wait();
      await expect(execViaTimelock(f, f.addresses.deedClaims,
        f.deedClaims.interface.encodeFunctionData("setEligibilitySignerRegistered", [f.outsider.address, true]), ethers.id("f2b")))
        .to.be.revertedWithCustomError(f.deedClaims, "SignerAdditionNotApproved");
      await expect(f.deedClaims.connect(f.guardian).setEligibilitySignerRegistered(f.outsider.address, true))
        .to.be.revertedWithCustomError(f.deedClaims, "AccessControlUnauthorizedAccount");
      await expect(f.deedClaims.connect(f.alice).approveEligibilitySignerAddition(f.alice.address))
        .to.be.revertedWithCustomError(f.deedClaims, "AccessControlUnauthorizedAccount");
      const role = await f.deedClaims.SIGNER_APPROVER_ROLE();
      expect(await f.deedClaims.getRoleAdmin(role)).to.equal(role);
    });
  });
});
