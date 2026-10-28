// NEW issue-ledger tests (28 Oct, not in c8262ec). RESEARCH/PROPOSED, unaudited. Patched build,
// Hardhat in-process network only: no RPC, no deploy, no keys beyond Hardhat's built-in test
// accounts. See docs/contracts/G5_ISSUE_LEDGER.md for the ledger these tests back.
//   G. counter release on deed void: retry, daily, lifetime, nullifier, adversarial cycling
//   I. issue counterexamples. A test named "FIXED ..." asserts the patched prototype's fix.
//      A test named "OPEN-ISSUE ..." asserts the CURRENT UNSAFE behaviour on purpose, so the
//      suite stays truthful: it passes while the issue is open and must be rewritten when a
//      fix lands. No test here is skipped.
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { cellToLatLng } from "h3-js";
import {
  ONE,
  DAY,
  TIMELOCK_DELAY,
  Suite,
  buildRewardTree,
  claimDeed,
  claimWithAttestation,
  configureCityCap,
  declareContest,
  deploySuite,
  eligibilityAttestationV2,
  execBatchViaTimelock,
  execViaTimelock,
  fundLockedMove,
  publishSettlement,
  settlementAuthorization,
  waitOutChallengeWindow,
  AttestationV2,
} from "./portHelpers";
import { cityCells } from "../v3/cells";

const CITY = 7;
const RECLAIM_COOLDOWN = 7 * DAY;
const EPOCH_CAP = 3_000_000n * ONE;
const VALVE_EPOCH = 30 * DAY;
const FAULT = 2n;
const ADMIN_RESTORED = 3n;

async function cityFx(): Promise<Suite> {
  const f = await deploySuite();
  await configureCityCap(f, CITY, 3); // per-holder 3, city-wide 1000, cluster cap 1, 50/day, 1000 total
  return f;
}
const fxCity = (): Promise<Suite> => loadFixture(cityFx);
const fx = (): Promise<Suite> => loadFixture(deploySuite);
const cells = cityCells(60);
const setLimits = (f: Suite, perCluster: number, perDay: number, total: number, salt: string) =>
  execViaTimelock(f, f.addresses.deedClaims,
    f.deedClaims.interface.encodeFunctionData("setIssuanceLimits", [perCluster, perDay, total]), ethers.id(salt));
const raise = (f: Suite, amount: bigint, salt: string) =>
  execViaTimelock(f, f.addresses.settlement,
    f.settlement.interface.encodeFunctionData("raiseLiquidIssuanceAllowance", [amount]), ethers.id(salt));
const today = async () => BigInt(Math.floor((await time.latest()) / DAY));

/** Deterministic PRNG (mulberry32) so every adversarial run is reproducible. */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("G5 issue ledger: counter release and issue counterexamples (patched, RESEARCH/PROPOSED)", () => {
  describe("G. counter release on deed void", () => {
    it("G1 claim retry: a reverted claim consumes nothing, so the same attestation succeeds on retry (same day or next day)", async () => {
      const f = await fxCity();
      await setLimits(f, 1, 1, 1000, "g1-limits");
      const expiry = (await time.latest()) + 3 * DAY;
      const a = await eligibilityAttestationV2({ claimant: f.alice.address, h3CellId: cells[0], cityId: CITY, expiry, claimFee: 0n });
      await (await claimWithAttestation(f, f.alice, a)).wait();
      // City daily limit reached: bob's attempt reverts and spends neither nonce nor counters.
      const b = await eligibilityAttestationV2({ claimant: f.bob.address, h3CellId: cells[1], cityId: CITY, expiry });
      await expect(claimWithAttestation(f, f.bob, b)).to.be.revertedWithCustomError(f.deedClaims, "CityDailyClaimLimitReached");
      expect(await f.deedClaims.attestationNonceUsed(b.nonce)).to.equal(false);
      expect(await f.deedClaims.clusterClaimCount(CITY, b.clusterId)).to.equal(0n);
      expect(await f.deedClaims.totalClaims()).to.equal(1n);
      await time.increase(DAY);
      await (await claimWithAttestation(f, f.bob, b)).wait();
      expect(await f.deed.ownerOf(cells[1])).to.equal(f.bob.address);
      // A successful claim is never repeatable.
      await time.increase(DAY);
      await expect(claimWithAttestation(f, f.bob, b)).to.be.revertedWithCustomError(f.deedClaims, "AttestationAlreadyUsed");
    });

    it("G2 legitimately consumed daily allowance: a void of either class never returns the per-city daily slot (the next day opens normally)", async () => {
      const f = await fxCity();
      await setLimits(f, 1, 2, 1000, "g2-limits");
      const d = await today();
      await (await claimDeed(f, f.alice, cells[0], CITY)).wait();
      await (await claimDeed(f, f.bob, cells[1], CITY)).wait();
      await (await f.deed.connect(f.voider).voidPendingDeed(cells[0], 1)).wait();
      await (await f.deed.connect(f.voider).voidPendingDeedAdministrative(cells[1], 9)).wait();
      expect(await f.deedClaims.cityClaimsOnDay(CITY, d)).to.equal(2n);
      await expect(claimDeed(f, f.carol, cells[2], CITY)).to.be.revertedWithCustomError(f.deedClaims, "CityDailyClaimLimitReached");
      await time.increase(DAY);
      await (await claimDeed(f, f.carol, cells[2], CITY)).wait();
    });

    it("G3 lifetime counter: voided fraud no longer uses up the lifetime ceiling honest claimants need, and live + final claims never exceed it", async () => {
      const f = await fxCity();
      await setLimits(f, 1, 50, 2, "g3-limits");
      // A ring fills the ceiling; both claims are voided as FAULT.
      await (await claimDeed(f, f.alice, cells[0], CITY, { clusterId: ethers.id("ring-1") })).wait();
      await (await claimDeed(f, f.bob, cells[1], CITY, { clusterId: ethers.id("ring-2") })).wait();
      await expect(claimDeed(f, f.carol, cells[2], CITY)).to.be.revertedWithCustomError(f.deedClaims, "TotalClaimCeilingReached");
      await (await f.deed.connect(f.voider).voidPendingDeed(cells[0], 1)).wait();
      await (await f.deed.connect(f.voider).voidPendingDeed(cells[1], 1)).wait();
      expect(await f.deedClaims.totalClaims()).to.equal(2n); // claim ids and attempts stay monotonic
      expect(await f.deedClaims.voidedClaims()).to.equal(2n);
      expect(await f.deedClaims.effectiveClaims()).to.equal(0n);
      // Before this patch carol was refused here for good (TotalClaimCeilingReached).
      await (await claimDeed(f, f.carol, cells[2], CITY)).wait();
      await (await claimDeed(f, f.carol, cells[3], CITY)).wait();
      await expect(claimDeed(f, f.carol, cells[4], CITY)).to.be.revertedWithCustomError(f.deedClaims, "TotalClaimCeilingReached");
      expect(await f.deed.totalDeeds()).to.equal(2n);
      // The ring's clusters stay spent: the release gives the ring nothing back.
      await expect(claimDeed(f, f.alice, cells[5], CITY, { clusterId: ethers.id("ring-1") }))
        .to.be.revertedWithCustomError(f.deedClaims, "ClusterCapReached");
    });

    it("G4 nullifier: a FAULT void nullifies its evidence for that (city, cluster) even when the cluster cap allows more; fresh evidence is needed; an appeal lifts it", async () => {
      const f = await fxCity();
      await setLimits(f, 2, 50, 1000, "g4-limits");
      const ring = ethers.id("ring-g4");
      const evidence = ethers.id("evidence:g4");
      await (await claimDeed(f, f.alice, cells[0], CITY, { clusterId: ring, evidenceHash: evidence })).wait();
      await (await f.deed.connect(f.voider).voidPendingDeed(cells[0], 1)).wait();
      const key = await f.deedClaims.evidenceNullifier(CITY, ring, evidence);
      expect(await f.deedClaims.evidenceNullified(key)).to.equal(true);
      // Same evidence, new nonce, another cell, cluster still has a slot: refused.
      await expect(claimDeed(f, f.bob, cells[1], CITY, { clusterId: ring, evidenceHash: evidence }))
        .to.be.revertedWithCustomError(f.deedClaims, "EvidenceNullified");
      // Admin voids do not nullify (operator error, the evidence was not at fault).
      const other = ethers.id("evidence:g4-admin");
      await (await claimDeed(f, f.bob, cells[2], CITY, { clusterId: ethers.id("ring-g4b"), evidenceHash: other })).wait();
      await (await f.deed.connect(f.voider).voidPendingDeedAdministrative(cells[2], 9)).wait();
      expect(await f.deedClaims.evidenceNullified(await f.deedClaims.evidenceNullifier(CITY, ethers.id("ring-g4b"), other))).to.equal(false);
      // An appeal (timelock) reverses the fault finding and lifts the nullifier.
      await execViaTimelock(f, f.addresses.deedClaims,
        f.deedClaims.interface.encodeFunctionData("reclassifyFaultVoid", [1n]), ethers.id("g4-appeal"));
      expect(await f.deedClaims.evidenceNullified(key)).to.equal(false);
      expect((await f.deedClaims.claimRecord(1n)).status).to.equal(ADMIN_RESTORED);
    });

    it("G5 adversarial claim/void cycling (deterministic, 3 seeds x 90 steps): no cluster ever holds more than its cap, mints at most cap + 1 restoration, replays always fail, and live claims never exceed the ceiling", async () => {
      let restorations = 0;
      let refused = 0;
      let totalMints = 0;
      const reasons = new Set<string>();
      for (const seed of [0x5eed01, 0x5eed02, 0x5eed03]) {
        const f = await cityFx();
        const PER_DAY = 4;
        const CEILING = 4;
        await setLimits(f, 1, PER_DAY, CEILING, `g5-limits-${seed}`);
        const rnd = prng(seed);
        const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
        const clusters = ["A", "B", "C", "D", "E", "F"].map((c) => ethers.id(`ring-${c}`));
        const claimants = [f.alice, f.bob, f.carol, f.outsider];
        const minted: Array<{ cell: bigint; cluster: string; att: AttestationV2; claimant: any }> = [];
        let nextCell = 0;
        let replays = 0;
        for (let step = 0; step < 90; step += 1) {
          const r = rnd();
          const pending = [];
          for (const m of minted) if ((await f.deed.deedExists(m.cell)) && !(await f.deed.isFinal(m.cell))) pending.push(m);
          if (r < 0.4 && nextCell < cells.length) {
            const claimant = pick(claimants);
            const att = await eligibilityAttestationV2({
              claimant: claimant.address, h3CellId: cells[nextCell++], cityId: CITY, clusterId: pick(clusters),
              evidenceHash: ethers.id(`ev-${seed}-${step}`), expiry: (await time.latest()) + 30 * DAY,
            });
            try {
              await (await claimWithAttestation(f, claimant, att)).wait();
              minted.push({ cell: att.h3CellId, cluster: att.clusterId, att, claimant });
            } catch (e: any) {
              // Refused by a limit: nothing to record (G1 proves nothing is consumed).
              refused += 1;
              const m = /custom error '(\w+)/.exec(String(e?.message));
              reasons.add(m ? m[1] : "other");
            }
          } else if (r < 0.55 && pending.length > 0) {
            await (await f.deed.connect(f.voider).voidPendingDeed(pick(pending).cell, 1)).wait();
          } else if (r < 0.7 && pending.length > 0) {
            await (await f.deed.connect(f.voider).voidPendingDeedAdministrative(pick(pending).cell, 9)).wait();
          } else if (r < 0.75 && minted.length > 0) {
            const m = pick(minted);
            if (await f.deed.deedExists(m.cell)) await (await f.deed.connect(m.claimant).relinquish(m.cell)).wait();
          } else if (r < 0.85 && minted.length > 0) {
            // Replay: the same signed facts, re-signed with a fresh expiry, keep their spent nonce.
            const m = pick(minted);
            const again = { ...m.att, expiry: (await time.latest()) + 3600 };
            await expect(claimWithAttestation(f, m.claimant, again))
              .to.be.revertedWithCustomError(f.deedClaims, "AttestationAlreadyUsed");
            replays += 1;
          } else {
            await time.increase(3600 + Math.floor(rnd() * 9 * DAY));
          }
          // Invariants after every step.
          let live = 0;
          for (const c of clusters) {
            const ofCluster = minted.filter((m) => m.cluster === c);
            let liveC = 0;
            for (const m of ofCluster) if (await f.deed.deedExists(m.cell)) liveC += 1;
            live += liveC;
            const restored = (await f.deedClaims.clusterRestorationUsed(CITY, c)) ? 1 : 0;
            expect(liveC, `seed ${seed} step ${step}: live deeds per cluster`).to.be.lte(1);
            expect(ofCluster.length, `seed ${seed} step ${step}: mints per cluster`).to.be.lte(1 + restored);
            expect(await f.deedClaims.clusterClaimCount(CITY, c)).to.be.lte(1n);
          }
          expect(await f.deed.totalDeeds()).to.equal(BigInt(live));
          expect(await f.deedClaims.totalClaims()).to.equal(BigInt(minted.length));
          expect(await f.deedClaims.effectiveClaims()).to.be.lte(BigInt(CEILING));
          expect(await f.deedClaims.cityClaimsOnDay(CITY, await today())).to.be.lte(BigInt(PER_DAY));
        }
        // Across all clusters, extra rights from voids are bounded by one restoration each.
        expect(minted.length).to.be.lte(clusters.length * 2);
        expect(replays).to.be.gt(0);
        for (const c of clusters) if (await f.deedClaims.clusterRestorationUsed(CITY, c)) restorations += 1;
        totalMints += minted.length;
      }
      // The run is not vacuous: restorations happened and limits refused cycling attempts.
      expect(restorations).to.be.gt(0);
      expect(refused).to.be.gt(0);
      expect(reasons.has("ClusterCapReached") || reasons.has("ClusterReclaimCoolingDown")).to.equal(true);
      expect(reasons.has("TotalClaimCeilingReached")).to.equal(true);
      // 3 seeds x 6 clusters: more than one mint per cluster happened only through restorations.
      expect(totalMints).to.be.gt(3 * 6);
      expect(totalMints).to.be.lte(3 * 6 + restorations);
    });

    it("G6 an honest claimant whose deed is voided administratively is not bricked by concurrent ring activity: after the cooldown, on a fresh day, the claim goes through", async () => {
      const f = await cityFx();
      await setLimits(f, 1, 3, 1000, "g6-limits");
      const honest = ethers.id("honest-g6");
      await (await claimDeed(f, f.carol, cells[0], CITY, { clusterId: honest })).wait();
      await (await f.deed.connect(f.voider).voidPendingDeedAdministrative(cells[0], 9)).wait();
      // A ring uses up the city's daily slots every day of the cooldown, and is voided.
      let c = 1;
      for (let d = 0; d < 8; d += 1) {
        for (let k = 0; k < (d === 0 ? 2 : 3); k += 1) {
          const who = k % 2 === 0 ? f.alice : f.bob;
          await (await claimDeed(f, who, cells[c], CITY, { clusterId: ethers.id(`ring-g6-${c}`) })).wait();
          await (await f.deed.connect(f.voider).voidPendingDeed(cells[c], 1)).wait();
          c += 1;
        }
        await expect(claimDeed(f, f.carol, cells[c], CITY, { clusterId: honest })).to.be.reverted;
        await time.increase(DAY);
      }
      // Fresh day, cooldown over: the honest cluster claims before the ring does.
      await (await claimDeed(f, f.carol, cells[c], CITY, { clusterId: honest })).wait();
      expect(await f.deed.ownerOf(cells[c])).to.equal(f.carol.address);
      expect(await f.deedClaims.effectiveClaims()).to.equal(1n);
    });
  });

  describe("I. issue counterexamples", () => {
    it("FIXED I-02 persistent 400M allowance: raising the maximum every epoch and never drawing, the standing allowance never exceeds one epoch cap", async () => {
      const f = await fx();
      const genesis = Number(await f.settlement.genesis());
      for (let e = 0; e < 4; e += 1) {
        await time.increaseTo(Math.max((await time.latest()) + 1, genesis + e * VALVE_EPOCH + 3600));
        await raise(f, EPOCH_CAP, `i02-${e}`);
        expect(await f.settlement.liquidIssuanceAllowance()).to.equal(EPOCH_CAP);
      }
      await time.increaseTo(genesis + 4 * VALVE_EPOCH + 3600);
      expect(await f.settlement.liquidIssuanceAllowance()).to.equal(0n);
      expect(await f.settlement.lifetimeLiquidAuthorized()).to.equal(4n * EPOCH_CAP);
    });

    it("FIXED I-03a a halted valve now also refuses toll credits, so a halt stops every new liquid reward; locked days continue", async () => {
      const f = await fx();
      await (await f.settlement.connect(f.guardian).haltValve()).wait();
      const gross = 1_000n * ONE;
      await expect(publishSettlement(f, await settlementAuthorization(f, {
        dayId: 1, grossIssuance: gross, tollBase: gross, tollCredits: (gross * 200n) / 10_000n,
      }))).to.be.revertedWithCustomError(f.settlement, "ValveIsHalted");
      await (await publishSettlement(f, await settlementAuthorization(f, { dayId: 1, grossIssuance: gross }))).wait();
    });

    it("OPEN-ISSUE I-03b with the valve shut by a zero allowance (not halted), toll credits are still issued liquid and are transferable", async () => {
      const f = await fx();
      expect(await f.settlement.liquidIssuanceAllowance()).to.equal(0n);
      const gross = 1_000n * ONE;
      const toll = (gross * 200n) / 10_000n;
      const tree = buildRewardTree(f.chainId, f.addresses.rewards, 1, [
        { leafIndex: 0, account: f.carol.address, lockedAmount: 0n, liquidAmount: toll },
      ]);
      await (await publishSettlement(f, await settlementAuthorization(f, {
        dayId: 1, grossIssuance: gross, tollBase: gross, tollCredits: toll, merkleRoot: tree.root,
      }))).wait();
      await (await f.rewards.connect(f.relayer).claim(1, 0, f.carol.address, 0n, toll, tree.proofFor(0))).wait();
      expect(await f.token.liquidBalanceOf(f.carol.address)).to.equal(toll);
      await (await f.token.connect(f.carol).transfer(f.outsider.address, toll)).wait();
      expect(await f.token.balanceOf(f.outsider.address)).to.equal(toll);
    });

    it("OPEN-ISSUE I-04 legacy greatBurn moves MOVE to the treasury: total supply is unchanged while the GreatBurn event reports it as burned", async () => {
      const [deployer, owner, operator] = (await ethers.getSigners()).slice(15, 18);
      const token = await (await ethers.getContractFactory("GreatBurnProbeToken", deployer)).deploy();
      const zones = await (await ethers.getContractFactory("GreatBurnProbeZones", deployer)).deploy();
      const oracle = await (await ethers.getContractFactory("GreatBurnProbeOracle", deployer)).deploy(operator.address);
      const controller = await (await ethers.getContractFactory("SeasonController", deployer))
        .deploy(await token.getAddress(), await zones.getAddress(), deployer.address);
      await (await controller.setGpsOracle(await oracle.getAddress())).wait();
      const hexId = 0x8860145b4bfffffn;
      await (await zones.setZoneOwner(hexId, owner.address)).wait();
      await (await token.mint(owner.address, 1_000n * ONE)).wait();
      await (await token.connect(owner).approve(await controller.getAddress(), 1_000n * ONE)).wait();
      const yields = [500n * ONE];
      const payload = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "uint256", "uint64[]", "uint256[]"], [31337, await controller.seasonNumber(), [hexId], yields]));
      const sig = await operator.signMessage(ethers.getBytes(payload));
      const supplyBefore = await token.totalSupply();
      const treasury = await controller.daoTreasury();
      await expect(controller.greatBurn([hexId], yields, sig))
        .to.emit(controller, "GreatBurn").withArgs(0n, 50n * ONE);
      expect(await token.totalSupply()).to.equal(supplyBefore); // nothing destroyed
      expect(await token.balanceOf(treasury)).to.equal(50n * ONE); // moved to the treasury
      expect(await token.balanceOf(owner.address)).to.equal(950n * ONE);
    });

    it("OPEN-ISSUE I-05b the timelock floor is 1 hour (fixture compatibility), not the proposed 48-hour production floor", async () => {
      const f = await fx();
      expect(await f.timelock.MIN_DELAY_FLOOR()).to.equal(3600n);
      expect(BigInt(TIMELOCK_DELAY)).to.be.lt(48n * 3600n);
      const factory = await ethers.getContractFactory("MovenRunTimelock");
      const t = await factory.deploy(2 * 3600, [f.admin.address], [f.admin.address], f.admin.address);
      expect(await t.getMinDelay()).to.equal(7200n);
    });

    it("OPEN-ISSUE I-06b the timelock alone replaces BOTH settlement signers, and the two new keys then publish settlement days", async () => {
      const f = await fx();
      const s = await ethers.getSigners();
      const [x, y] = [s[16], s[17]];
      await execBatchViaTimelock(f, [f.addresses.settlement, f.addresses.settlement], [
        f.settlement.interface.encodeFunctionData("setSettlementSigner", [x.address]),
        f.settlement.interface.encodeFunctionData("setReconciliationSigner", [y.address]),
      ], ethers.id("i06b"));
      const swapped = { ...f, settlementSigner: x, reconciliationSigner: y } as Suite;
      await (await publishSettlement(swapped, await settlementAuthorization(f, { dayId: 1, grossIssuance: ONE }))).wait();
      await expect(publishSettlement(f, await settlementAuthorization(f, { dayId: 2, grossIssuance: ONE })))
        .to.be.revertedWithCustomError(f.settlement, "InvalidSettlementSignature");
    });

    it("OPEN-ISSUE I-06c the timelock alone replaces BOTH contest score keys (no independent approval as on eligibility signers)", async () => {
      const f = await fx();
      const s = await ethers.getSigners();
      const [x, y] = [s[16], s[17]];
      await execBatchViaTimelock(f, [f.addresses.contests, f.addresses.contests], [
        f.contests.interface.encodeFunctionData("setContestSigner", [x.address]),
        f.contests.interface.encodeFunctionData("setContestCoSigner", [y.address]),
      ], ethers.id("i06c"));
      expect(await f.contests.contestSigner()).to.equal(x.address);
      expect(await f.contests.contestCoSigner()).to.equal(y.address);
    });

    it("OPEN-ISSUE I-06d eligibility signers: if the approver role and the timelock proposer are the same party, that party swaps both signers and mints", async () => {
      const f = await cityFx(); // direct deploy: fixture snapshots are not mixed across sections
      const role = await f.deedClaims.SIGNER_APPROVER_ROLE();
      await (await f.deedClaims.connect(f.guardian).grantRole(role, f.admin.address)).wait();
      const s = await ethers.getSigners();
      const [k1, k2] = [s[16], s[17]];
      await (await f.deedClaims.connect(f.admin).approveEligibilitySignerAddition(k1.address)).wait();
      await (await f.deedClaims.connect(f.admin).approveEligibilitySignerAddition(k2.address)).wait();
      const enc = (a: string, on: boolean) => f.deedClaims.interface.encodeFunctionData("setEligibilitySignerRegistered", [a, on]);
      await execBatchViaTimelock(f, Array(4).fill(f.addresses.deedClaims),
        [enc(k1.address, true), enc(k2.address, true), enc(f.deedSigner.address, false), enc(f.eligibilityCoSigner.address, false)],
        ethers.id("i06d"));
      const att = await eligibilityAttestationV2({ claimant: f.alice.address, h3CellId: cells[0], cityId: CITY });
      await (await claimWithAttestation(f, f.alice, att, [k1, k2])).wait();
      expect(await f.deed.ownerOf(cells[0])).to.equal(f.alice.address);
    });

    it("OPEN-ISSUE I-07 contest declarations are single-signed: one contest key escrows a defender's final deed and reserves the challenger's city slot", async () => {
      const f = await cityFx(); // direct deploy: fixture snapshots are not mixed across sections
      await (await claimDeed(f, f.bob, cells[0], CITY)).wait();
      // portHelpers.declareContest signs with the contest signer ONLY (base helper, unchanged).
      await (await declareContest(f, f.alice, cells[0])).wait();
      expect(await f.deed.ownerOf(cells[0])).to.equal(f.addresses.contests);
      expect(await f.contests.activeContestOf(cells[0])).to.equal(1n);
    });

    it("OPEN-ISSUE I-08 locked-only rewards pay the claim fee, and the resulting deed becomes freely transferable once final", async () => {
      const f = await cityFx(); // direct deploy: fixture snapshots are not mixed across sections
      await fundLockedMove(f, 1, [{ account: f.alice.address, amount: 10n * ONE }]);
      expect(await f.token.liquidBalanceOf(f.alice.address)).to.equal(0n);
      await (await f.token.connect(f.alice).approve(f.addresses.deedClaims, 10n * ONE)).wait();
      await (await claimDeed(f, f.alice, cells[0], CITY, { claimFee: 10n * ONE })).wait();
      expect(await f.token.lockedBalanceOf(f.alice.address)).to.equal(0n);
      await waitOutChallengeWindow(f, cells[0]);
      await (await f.deed.connect(f.alice).transferFrom(f.alice.address, f.bob.address, cells[0])).wait();
      expect(await f.deed.ownerOf(cells[0])).to.equal(f.bob.address);
    });

    it("OPEN-ISSUE I-09 deed ids are bare H3 resolution-8 cells: the public token id alone gives the location to within about half a kilometre", async () => {
      const f = await cityFx(); // direct deploy: fixture snapshots are not mixed across sections
      await (await claimDeed(f, f.alice, cells[0], CITY)).wait();
      const filter = f.deed.filters.Transfer(ethers.ZeroAddress, f.alice.address);
      const [log] = await f.deed.queryFilter(filter);
      const tokenId: bigint = log.args.tokenId;
      expect(tokenId).to.equal(cells[0]);
      const [lat, lng] = cellToLatLng(tokenId.toString(16));
      expect(Math.abs(lat - 12.9716)).to.be.lt(0.01); // the synthetic test point (city centre)
      expect(Math.abs(lng - 77.5946)).to.be.lt(0.01);
    });
  });
});
