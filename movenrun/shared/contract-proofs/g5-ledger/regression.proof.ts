// Copied next to test/v3/ by run.sh; imports resolve there.
// G5 regression proofs for the draft patches in ./patched (H1, H2, H3/M1, N1).
// Each scenario runs against BOTH builds:
//   G5_MODE=original  the prototype at the pinned commit: the test asserts the issue exists
//   G5_MODE=patched   the draft patches copied over src/v3: the test asserts the fix holds
// In-process Hardhat network only. No RPC, no keys beyond Hardhat's built-in test accounts.
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { cellToParent } from "h3-js";
import {
  ONE,
  SEASON_ONE_BUDGET,
  Suite,
  configureCityCap,
  declareContest,
  deploySuite,
  domain,
  eligibilityAttestation,
  execViaTimelock,
  publishSettlement,
  settlementAuthorization,
  signEligibility,
  submitScore,
  RULES_VERSION,
  nextNonce,
  futureExpiry,
} from "../v3/helpers";
import { cityCells } from "../v3/cells";

const PATCHED = process.env.G5_MODE === "patched";
const CITY = 1;
const OTHER_CITY = 2;
const DAY = 24 * 3600;
const NOMINAL_DAY = SEASON_ONE_BUDGET / 90n;

// ---------------------------------------------------------------------------
// Patched-build helpers
// ---------------------------------------------------------------------------

const ELIGIBILITY_TYPES_V2 = {
  DeedEligibilityAttestation: [
    { name: "claimant", type: "address" },
    { name: "h3CellId", type: "uint64" },
    { name: "cityId", type: "uint32" },
    { name: "solidGround", type: "bool" },
    { name: "tenureDays", type: "uint32" },
    { name: "distinctCrossers", type: "uint32" },
    { name: "trafficDays", type: "uint32" },
    { name: "relatedTrafficExcluded", type: "bool" },
    { name: "clusterId", type: "bytes32" },
    { name: "evidenceHash", type: "bytes32" },
    { name: "claimFee", type: "uint256" },
    { name: "rulesVersion", type: "uint16" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint64" },
  ],
};

const DAY_SCORES_TYPES = {
  DayScoresAuthorization: [
    { name: "contestId", type: "uint256" },
    { name: "scoringDay", type: "uint8" },
    { name: "challengerScore", type: "uint256" },
    { name: "defenderScore", type: "uint256" },
    { name: "rulesVersion", type: "uint16" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint64" },
  ],
};

const hex = (c: bigint) => c.toString(16);
const res5Parent = (cell: bigint) => BigInt(`0x${cellToParent(hex(cell), 5)}`);

function regionLeaf(parent: bigint, cityId: number): string {
  const inner = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint64", "uint32"], [parent, cityId]));
  return ethers.keccak256(inner);
}
const pair = (a: string, b: string) =>
  BigInt(a) <= BigInt(b) ? ethers.keccak256(ethers.concat([a, b])) : ethers.keccak256(ethers.concat([b, a]));

/** Minimal sorted-pair Merkle tree compatible with OpenZeppelin MerkleProof. */
function regionTree(entries: Array<[bigint, number]>) {
  const leaves = entries.map(([p, c]) => regionLeaf(p, c));
  const layers: string[][] = [leaves];
  while (layers[layers.length - 1].length > 1) {
    const cur = layers[layers.length - 1];
    const next: string[] = [];
    for (let i = 0; i < cur.length; i += 2) next.push(i + 1 < cur.length ? pair(cur[i], cur[i + 1]) : cur[i]);
    layers.push(next);
  }
  const proofFor = (parent: bigint, cityId: number) => {
    let idx = leaves.indexOf(regionLeaf(parent, cityId));
    if (idx < 0) return [] as string[];
    const proof: string[] = [];
    for (let l = 0; l < layers.length - 1; l++) {
      const sib = idx % 2 === 0 ? idx + 1 : idx - 1;
      if (sib < layers[l].length) proof.push(layers[l][sib]);
      idx = Math.floor(idx / 2);
    }
    return proof;
  };
  return { root: layers[layers.length - 1][0], proofFor };
}

interface Patched extends Suite {
  eligibilityCoSigner: any;
  contestCoSigner: any;
  voider: any;
  outsider: any;
  tree: ReturnType<typeof regionTree>;
  t0: number;
}

const CELLS = cityCells(12);

async function patchedSuite(): Promise<Patched> {
  const f = await deploySuite();
  const t0 = await time.latest();
  const s = await ethers.getSigners();
  const [eligibilityCoSigner, contestCoSigner, voider, outsider] = [s[11], s[12], s[13], s[14]];
  const parents = [...new Set(CELLS.map((c) => res5Parent(c).toString()))].map(BigInt);
  const tree = regionTree(parents.map((p) => [p, CITY] as [bigint, number]));
  if (PATCHED) {
    const run = (target: string, iface: any, fn: string, args: any[], salt: string) =>
      execViaTimelock(f, target, iface.encodeFunctionData(fn, args), ethers.id(salt));
    // Fixture adjustment (signer roles patch): the guardian holds SIGNER_APPROVER_ROLE initially.
    await (await f.deedClaims.connect(f.guardian).approveEligibilitySignerAddition(eligibilityCoSigner.address)).wait();
    await run(f.addresses.deedClaims, f.deedClaims.interface, "setEligibilitySignerRegistered", [eligibilityCoSigner.address, true], "co");
    await run(f.addresses.deedClaims, f.deedClaims.interface, "setCityRegionRoot", [tree.root], "root");
    await run(f.addresses.deedClaims, f.deedClaims.interface, "setCityWideCap", [CITY, 50], "citycap");
    await run(f.addresses.contests, f.contests.interface, "setContestCoSigner", [contestCoSigner.address], "cco");
    await run(f.addresses.deed, f.deed.interface, "grantRole", [await f.deed.VOIDER_ROLE(), voider.address], "voider");
  }
  return { ...f, eligibilityCoSigner, contestCoSigner, voider, outsider, tree, t0 };
}
const fx = () => loadFixture(patchedSuite);

async function attestationV2(f: Patched, claimant: string, cell: bigint, cityId: number, clusterId?: string) {
  return {
    claimant,
    h3CellId: cell,
    cityId,
    solidGround: true,
    tenureDays: 30,
    distinctCrossers: 40,
    trafficDays: 15,
    relatedTrafficExcluded: true,
    clusterId: clusterId ?? ethers.id(`cluster:${claimant}`),
    evidenceHash: ethers.id(`evidence:${cell}`),
    claimFee: 0n,
    rulesVersion: RULES_VERSION,
    nonce: nextNonce(),
    expiry: await futureExpiry(),
  };
}

async function signV2(f: Patched, att: any, signers: any[]) {
  const dom = domain("MovenRunDeedClaims", f.chainId, f.addresses.deedClaims);
  const sorted = [...signers].sort((a, b) => (BigInt(a.address) < BigInt(b.address) ? -1 : 1));
  return Promise.all(sorted.map((s) => s.signTypedData(dom, ELIGIBILITY_TYPES_V2, att)));
}

/** Claims a deed on either build: single signer on the original, threshold + region proof on the patch. */
async function claimEither(f: Patched, who: any, cell: bigint, cityId = CITY, clusterId?: string) {
  if (!PATCHED) {
    const a = await eligibilityAttestation({ claimant: who.address, h3CellId: cell, cityId });
    return f.deedClaims.connect(who).claim(a, await signEligibility(f, a), 0);
  }
  const a = await attestationV2(f, who.address, cell, cityId, clusterId);
  const sigs = await signV2(f, a, [f.deedSigner, f.eligibilityCoSigner]);
  return f.deedClaims.connect(who).claimWithThreshold(a, sigs, f.tree.proofFor(res5Parent(cell), cityId), 0);
}

async function dayScores(f: Patched, contestId: bigint, day: number, c: bigint, d: bigint, signers?: any[]) {
  const auth = {
    contestId, scoringDay: day, challengerScore: c, defenderScore: d,
    rulesVersion: RULES_VERSION, nonce: nextNonce(), expiry: await futureExpiry(30 * DAY),
  };
  const dom = domain("MovenRunContests", f.chainId, f.addresses.contests);
  const [s1, s2] = signers ?? [f.contestScoreSigner, f.contestCoSigner];
  return f.contests.connect(f.relayer).submitDayScores(
    auth, await s1.signTypedData(dom, DAY_SCORES_TYPES, auth), await s2.signTypedData(dom, DAY_SCORES_TYPES, auth));
}

const mode = PATCHED ? "[patched: fix holds]" : "[original: issue reproduced]";

// ---------------------------------------------------------------------------

describe(`G5 regression proofs ${mode}`, () => {
  describe("H1 settlement day bound to the clock, per-publication ceiling", () => {
    it("day 90 straight after day 1", async () => {
      const f = await fx();
      if (!PATCHED) {
        await (await publishSettlement(f, await settlementAuthorization({ dayId: 1, grossIssuance: ONE }))).wait();
        await (await publishSettlement(f, await settlementAuthorization({ dayId: 90, grossIssuance: SEASON_ONE_BUDGET - ONE }))).wait();
        expect(await f.settlement.seasonIssued(1)).to.equal(SEASON_ONE_BUDGET);
        return;
      }
      // Day 1 cannot even be published before it closes.
      await expect(publishSettlement(f, await settlementAuthorization({ dayId: 1, grossIssuance: ONE })))
        .to.be.revertedWithCustomError(f.settlement, "DayNotYetClosed");
      await time.increaseTo(Number(await f.settlement.genesis()) + DAY);
      await (await publishSettlement(f, await settlementAuthorization({ dayId: 1, grossIssuance: ONE }))).wait();
      await expect(publishSettlement(f, await settlementAuthorization({ dayId: 90, grossIssuance: ONE })))
        .to.be.revertedWithCustomError(f.settlement, "DayNotYetClosed");
    });

    it("after a real 90-day gap, the backlog is not released in one call; skipped days are forfeited on the record", async () => {
      const f = await fx();
      if (!PATCHED) {
        // Original: with or without the gap, one call takes the whole remaining season budget.
        await time.increase(90 * DAY);
        await (await publishSettlement(f, await settlementAuthorization({ dayId: 90, grossIssuance: SEASON_ONE_BUDGET }))).wait();
        expect(await f.settlement.seasonIssued(1)).to.equal(SEASON_ONE_BUDGET);
        return;
      }
      await time.increaseTo(Number(await f.settlement.genesis()) + 90 * DAY);
      await expect(publishSettlement(f, await settlementAuthorization({ dayId: 90, grossIssuance: SEASON_ONE_BUDGET })))
        .to.be.revertedWithCustomError(f.settlement, "PublicationAboveDailyCeiling");
      const ceiling = (SEASON_ONE_BUDGET * 2n) / 90n;
      await expect(publishSettlement(f, await settlementAuthorization({ dayId: 90, grossIssuance: ceiling })))
        .to.emit(f.settlement, "DaysForfeited").withArgs(1, 89);
      expect(await f.settlement.seasonIssued(1)).to.equal(ceiling);
    });

    it("property: an attacker holding both settlement keys, over 25 random steps, stays within 2 x nominal x closed days", async () => {
      const f = await fx();
      let seed = 1234567;
      const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n; };
      const genesis = PATCHED ? Number(await f.settlement.genesis()) : f.t0;
      let violated = false;
      for (let step = 0; step < 25; step++) {
        await time.increase(rnd(3) * DAY + rnd(DAY));
        const last = Number(await f.settlement.lastSettledDay());
        if (last >= 90) break;
        // The attacker tries the most damaging day first (90 holds the whole backlog), then a
        // random near day, and keeps the first publication the contract accepts.
        const candidates = [90, Math.min(90, last + 1 + rnd(5))];
        for (const dayId of candidates) {
          const issued = await f.settlement.seasonIssued(1);
          const pool = (SEASON_ONE_BUDGET - issued) / BigInt(90 - dayId + 1);
          const gross = PATCHED ? (pool < 2n * NOMINAL_DAY ? pool : 2n * NOMINAL_DAY) : pool;
          try {
            await (await publishSettlement(f, await settlementAuthorization({ dayId, grossIssuance: gross }))).wait();
            break;
          } catch { /* refused by the contract: try the next candidate */ }
        }
        const closedDays = BigInt(Math.max(0, Math.floor(((await time.latest()) - genesis) / DAY)));
        if ((await f.settlement.lifetimeMovementIssued()) > 2n * NOMINAL_DAY * closedDays) violated = true;
      }
      expect(violated).to.equal(!PATCHED);
    });

    it("L5: an authorization valid until 2100", async () => {
      const f = await fx();
      if (PATCHED) await time.increaseTo(Number(await f.settlement.genesis()) + DAY);
      const p = publishSettlement(f, await settlementAuthorization({ dayId: 1, grossIssuance: ONE, expiry: 4102444800 }));
      if (PATCHED) await expect(p).to.be.revertedWithCustomError(f.settlement, "AuthorizationLifetimeTooLong");
      else await expect(p).to.not.be.reverted;
    });
  });

  describe("H2 contest scores need two keys, both sides per day, bound to the calendar", () => {
    async function openContest(f: Patched) {
      await configureCityCap(f, CITY, 5);
      const cell = CELLS[0];
      await (await claimEither(f, f.alice, cell)).wait();
      if (PATCHED) await time.increase(7 * DAY + 1); // pending window (N1)
      await (await declareContest(f, f.bob, cell)).wait();
      return { cell, contestId: await f.contests.lastContestId() };
    }

    it("one key alone hands a deed to the challenger", async () => {
      const f = await fx();
      const { cell, contestId } = await openContest(f);
      await time.increase(72 * 3600 + 1);
      if (!PATCHED) {
        for (let d = 0; d < 7; d++) await (await submitScore(f, contestId, f.bob.address, d, 1n)).wait();
        await time.increase(7 * DAY);
        await (await f.contests.settleContest(contestId)).wait();
        expect(await f.deed.ownerOf(cell)).to.equal(f.bob.address);
        return;
      }
      await expect(submitScore(f, contestId, f.bob.address, 0, 1n))
        .to.be.revertedWithCustomError(f.contests, "SingleSidedScoresDisabled");
      await time.increase(DAY);
      // The same key twice is not two keys.
      await expect(dayScores(f, contestId, 0, 1n, 0n, [f.contestScoreSigner, f.contestScoreSigner]))
        .to.be.revertedWithCustomError(f.contests, "InvalidCoSignature");
      // The co-signer alone is not enough either.
      await expect(dayScores(f, contestId, 0, 1n, 0n, [f.contestCoSigner, f.contestCoSigner]))
        .to.be.revertedWithCustomError(f.contests, "InvalidScoreSignature");
      expect(await f.contests.dayScoresPosted(contestId)).to.equal(0n);
    });

    it("scoring days are bound to the calendar and posted for both sides at once", async () => {
      const f = await fx();
      const { cell, contestId } = await openContest(f);
      await time.increase(72 * 3600 + 1);
      if (!PATCHED) {
        // Original: all seven days relayed in the first minute of the window, one side only.
        for (let d = 0; d < 7; d++) await (await submitScore(f, contestId, f.bob.address, d, 5n)).wait();
        expect((await f.contests.sideScoreOf(contestId, f.bob.address)).submittedDays).to.equal(127n);
        expect((await f.contests.sideScoreOf(contestId, f.alice.address)).submittedDays).to.equal(0n);
        return;
      }
      await expect(dayScores(f, contestId, 0, 5n, 5n)).to.be.revertedWithCustomError(f.contests, "ScoringDayNotClosed");
      for (let d = 0; d < 7; d++) {
        await time.increase(DAY);
        await (await dayScores(f, contestId, d, 105n, 100n)).wait();
      }
      expect((await f.contests.sideScoreOf(contestId, f.alice.address)).submittedDays).to.equal(127n);
      await expect(dayScores(f, contestId, 3, 999n, 0n)).to.be.revertedWithCustomError(f.contests, "ScoringDayAlreadySubmitted");
      await expect(f.contests.settleContest(contestId)).to.be.revertedWithCustomError(f.contests, "ScoringWindowNotFinished");
      await time.increase(DAY + 1);
      await (await f.contests.settleContest(contestId)).wait();
      // 315 vs 300 x 1.05 = 315: the tie stays with the defender.
      expect(await f.deed.ownerOf(cell)).to.equal(f.alice.address);
    });

    it("scoring fails closed until a co-signer is set, and each daily score is bounded", async () => {
      if (!PATCHED) {
        const f = await fx();
        const { contestId } = await openContest(f);
        await time.increase(72 * 3600 + 1);
        const big = 2n ** 120n;
        await (await submitScore(f, contestId, f.bob.address, 0, big)).wait();
        expect(await f.contests.sideTotalOf(contestId, f.bob.address)).to.equal(big);
        return;
      }
      const f = await fx();
      const { contestId } = await openContest(f);
      await time.increase(72 * 3600 + DAY + 1);
      await expect(dayScores(f, contestId, 0, 100_001n, 0n)).to.be.revertedWithCustomError(f.contests, "ScoreOutOfRange");
      const bare = await deploySuite(); // plain deploy, not a second fixture snapshot
      expect(await bare.contests.contestCoSigner()).to.equal(ethers.ZeroAddress);
      await expect(
        bare.contests.connect(bare.relayer).submitDayScores(
          { contestId: 1, scoringDay: 0, challengerScore: 1, defenderScore: 0, rulesVersion: RULES_VERSION, nonce: nextNonce(), expiry: await futureExpiry() },
          "0x", "0x")
      ).to.be.revertedWithCustomError(bare.contests, "CoSignerNotConfigured");
    });
  });

  describe("H3 / M1 threshold attestation, city bound to cell, cluster and issuance caps", () => {
    it("a single eligibility key mints a deed", async () => {
      const f = await fx();
      await configureCityCap(f, CITY, 5);
      if (!PATCHED) {
        await (await claimEither(f, f.alice, CELLS[0])).wait();
        expect(await f.deed.balanceOf(f.alice.address)).to.equal(1n);
        return;
      }
      const a0 = await attestationV2(f, f.alice.address, CELLS[0], CITY);
      await expect(f.deedClaims.connect(f.alice).claim(a0, (await signV2(f, a0, [f.deedSigner]))[0], 0))
        .to.be.revertedWithCustomError(f.deedClaims, "SingleSignerClaimsDisabled");
      const a = await attestationV2(f, f.alice.address, CELLS[0], CITY);
      const proof = f.tree.proofFor(res5Parent(CELLS[0]), CITY);
      const one = await signV2(f, a, [f.deedSigner]);
      await expect(f.deedClaims.connect(f.alice).claimWithThreshold(a, one, proof, 0))
        .to.be.revertedWithCustomError(f.deedClaims, "ThresholdNotMet");
      const dup = [one[0], one[0]];
      await expect(f.deedClaims.connect(f.alice).claimWithThreshold(a, dup, proof, 0))
        .to.be.revertedWithCustomError(f.deedClaims, "SignersNotAscendingOrUnknown");
      const withOutsider = await signV2(f, a, [f.deedSigner, f.outsider]);
      await expect(f.deedClaims.connect(f.alice).claimWithThreshold(a, withOutsider, proof, 0))
        .to.be.revertedWithCustomError(f.deedClaims, "SignersNotAscendingOrUnknown");
      await (await claimEither(f, f.alice, CELLS[0])).wait();
      expect(await f.deed.balanceOf(f.alice.address)).to.equal(1n);
    });

    it("the threshold can never be lowered below two", async () => {
      const f = await fx();
      if (!PATCHED) {
        const names = f.deedClaims.interface.fragments.map((x: any) => x.name);
        expect(names).to.not.include("attestationThreshold");
        return;
      }
      expect(await f.deedClaims.attestationThreshold()).to.equal(2n);
      const data = f.deedClaims.interface.encodeFunctionData("setAttestationThreshold", [1]);
      await f.timelock.connect(f.admin).schedule(f.addresses.deedClaims, 0, data, ethers.ZeroHash, ethers.id("t1"), 3600);
      await time.increase(3601);
      await expect(f.timelock.connect(f.admin).execute(f.addresses.deedClaims, 0, data, ethers.ZeroHash, ethers.id("t1")))
        .to.be.reverted;
    });

    it("cityId is a signer-chosen label", async () => {
      const f = await fx();
      await configureCityCap(f, CITY, 1);
      await configureCityCap(f, OTHER_CITY, 1);
      await (await claimEither(f, f.alice, CELLS[0], CITY)).wait();
      const second = claimEither(f, f.alice, CELLS[1], OTHER_CITY, ethers.id("other"));
      if (!PATCHED) {
        await (await second).wait();
        expect(await f.deed.balanceOf(f.alice.address)).to.equal(2n);
      } else {
        await expect(second).to.be.revertedWithCustomError(f.deedClaims, "CellNotInCity");
      }
    });

    it("on-chain parent computation matches h3-js for every test cell", async () => {
      const f = await fx();
      if (!PATCHED) return; // no such function on the original
      for (const c of CELLS) expect(await f.deedClaims.parentCell(c)).to.equal(res5Parent(c));
    });

    it("a ring of three linked wallets labelled as one cluster", async () => {
      const f = await fx();
      await configureCityCap(f, CITY, 1);
      const ring = ethers.id("ring-1");
      const results: boolean[] = [];
      for (const [i, w] of [f.alice, f.bob, f.carol].entries()) {
        try { await (await claimEither(f, w, CELLS[i], CITY, ring)).wait(); results.push(true); }
        catch (e: any) { expect(String(e.message)).to.contain("ClusterCapReached"); results.push(false); }
      }
      expect(results).to.deep.equal(PATCHED ? [true, false, false] : [true, true, true]);
    });

    it("issuance limits: the sixth claim in one city on one day", async () => {
      const f = await fx();
      await configureCityCap(f, CITY, 10);
      for (let i = 0; i < 5; i++) await (await claimEither(f, f.alice, CELLS[i], CITY, ethers.id(`c${i}`))).wait();
      const sixth = claimEither(f, f.alice, CELLS[5], CITY, ethers.id("c5"));
      if (!PATCHED) { await (await sixth).wait(); expect(await f.deed.cityDeedCount(CITY)).to.equal(6n); return; }
      await expect(sixth).to.be.revertedWithCustomError(f.deedClaims, "CityDailyClaimLimitReached");
      await time.increase(DAY);
      await (await claimEither(f, f.alice, CELLS[5], CITY, ethers.id("c5"))).wait();
      // City-wide cap: lower it to the current count and the next claim is refused.
      await execViaTimelock(f, f.addresses.deedClaims,
        f.deedClaims.interface.encodeFunctionData("setCityWideCap", [CITY, 6]), ethers.id("cap6"));
      await expect(claimEither(f, f.alice, CELLS[6], CITY, ethers.id("c6")))
        .to.be.revertedWithCustomError(f.deedClaims, "CityWideCapReached");
      // Lifetime ceiling.
      await execViaTimelock(f, f.addresses.deedClaims,
        f.deedClaims.interface.encodeFunctionData("setCityWideCap", [CITY, 50]), ethers.id("cap50"));
      await execViaTimelock(f, f.addresses.deedClaims,
        f.deedClaims.interface.encodeFunctionData("setIssuanceLimits", [1, 5, 6]), ethers.id("lim"));
      await expect(claimEither(f, f.alice, CELLS[6], CITY, ethers.id("c6")))
        .to.be.revertedWithCustomError(f.deedClaims, "TotalClaimCeilingReached");
    });

    it("guardian pause stops claims only; unpause needs the timelock; voids and final transfers still work", async () => {
      const f = await fx();
      await configureCityCap(f, CITY, 5);
      await (await claimEither(f, f.alice, CELLS[0])).wait();
      await (await claimEither(f, f.bob, CELLS[1])).wait();
      await (await f.deedClaims.connect(f.guardian).pauseClaims()).wait();
      await expect(claimEither(f, f.carol, CELLS[2])).to.be.revertedWithCustomError(f.deedClaims, "ClaimsArePaused");
      await expect(f.deedClaims.connect(f.guardian).unpauseClaims()).to.be.reverted;
      if (PATCHED) {
        await (await f.deed.connect(f.voider).voidPendingDeed(CELLS[1], 3)).wait();
        await time.increase(7 * DAY + 1);
      }
      await (await f.deed.connect(f.alice).transferFrom(f.alice.address, f.carol.address, CELLS[0])).wait();
      expect(await f.deed.ownerOf(CELLS[0])).to.equal(f.carol.address);
    });
  });

  describe("N1 pending window, void, relinquish", () => {
    it("a freshly minted deed moves and can be contested at once, and can never be voided", async () => {
      const f = await fx();
      await configureCityCap(f, CITY, 5);
      await (await claimEither(f, f.alice, CELLS[0])).wait();
      if (!PATCHED) {
        await (await f.deed.connect(f.alice).transferFrom(f.alice.address, f.carol.address, CELLS[0])).wait();
        const names = f.deed.interface.fragments.map((x: any) => x.name);
        expect(names).to.not.include("voidPendingDeed");
        expect(names).to.not.include("burn");
        return;
      }
      expect(await f.deed.isFinal(CELLS[0])).to.equal(false);
      await expect(f.deed.connect(f.alice).transferFrom(f.alice.address, f.carol.address, CELLS[0]))
        .to.be.revertedWithCustomError(f.deed, "DeedPending");
      await expect(declareContest(f, f.bob, CELLS[0])).to.be.revertedWithCustomError(f.deed, "DeedPending");
    });

    it("a wrongly attested deed is voided inside the window; counters are exact; the cell can be claimed again", async () => {
      const f = await fx();
      await configureCityCap(f, CITY, 5);
      await (await claimEither(f, f.alice, CELLS[0])).wait();
      if (!PATCHED) {
        await expect(claimEither(f, f.bob, CELLS[0])).to.be.revertedWithCustomError(f.deed, "DeedAlreadyExists");
        return;
      }
      await expect(f.deed.connect(f.deedSigner).voidPendingDeed(CELLS[0], 1))
        .to.be.revertedWithCustomError(f.deed, "AccessControlUnauthorizedAccount");
      await expect(f.deed.connect(f.voider).voidPendingDeed(CELLS[0], 1)).to.emit(f.deed, "DeedVoided");
      expect(await f.deed.totalDeeds()).to.equal(0n);
      expect(await f.deed.cityDeedCount(CITY)).to.equal(0n);
      expect(await f.deed.holderCityDeedCount(f.alice.address, CITY)).to.equal(0n);
      await (await claimEither(f, f.bob, CELLS[0])).wait();
      expect(await f.deed.ownerOf(CELLS[0])).to.equal(f.bob.address);
    });

    it("after the window there is no administrative revoke; the holder alone may relinquish", async () => {
      const f = await fx();
      await configureCityCap(f, CITY, 5);
      await (await claimEither(f, f.alice, CELLS[0])).wait();
      if (!PATCHED) {
        await time.increase(7 * DAY + 1);
        const names = f.deed.interface.fragments.map((x: any) => x.name);
        expect(names).to.not.include("relinquish");
        return;
      }
      await time.increase(7 * DAY + 1);
      expect(await f.deed.isFinal(CELLS[0])).to.equal(true);
      await expect(f.deed.connect(f.voider).voidPendingDeed(CELLS[0], 1))
        .to.be.revertedWithCustomError(f.deed, "DeedAlreadyFinal");
      await expect(f.deed.connect(f.bob).relinquish(CELLS[0])).to.be.revertedWithCustomError(f.deed, "NotDeedHolder");
      await (await f.deed.connect(f.alice).relinquish(CELLS[0])).wait();
      expect(await f.deed.totalDeeds()).to.equal(0n);
    });
  });
});
