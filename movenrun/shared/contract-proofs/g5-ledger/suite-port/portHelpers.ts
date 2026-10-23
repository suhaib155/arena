// RESEARCH ONLY. Fixture and helper layer that lets the original v3 suite (c8262ec, test/v3)
// run against the G5 draft patches in ../patched. Everything the patches did not change is
// re-exported untouched from ../v3/helpers; only the helpers whose ABI or timing the patches
// changed are replaced here, each with a comment naming the patch:
//   H1  settlementAuthorization / fundLockedMove / fundLiquidMove wait for the day to close
//   H2  submitDayScores / playOutContest replace the single-sided submitScore
//   H3  claimDeed signs with two signers, passes a city-region proof and a cluster id
//   N1  waitOutChallengeWindow; declareContest waits for the deed to leave its pending window
// In-process Hardhat network only. No RPC, no keys beyond Hardhat's built-in test accounts.
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { cellToParent } from "h3-js";
import * as base from "../v3/helpers";
import { cityCells } from "../v3/cells";

export * from "../v3/helpers";

export const DAY = 24 * 3600;
export const CHALLENGE_WINDOW = 7 * DAY;
export const SCORE_GRACE = DAY;

// ---------------------------------------------------------------------------
// City regions (H3 / M1): the contract derives the city from the cell
// ---------------------------------------------------------------------------

const hex = (c: bigint) => c.toString(16);
const h3Parent5 = (cell: bigint) => BigInt(`0x${cellToParent(hex(cell), 5)}`);

/** JS twin of MovenRunDeedClaims.parentCell: pure bit arithmetic, defined for any uint64. */
export function contractParent(cell: bigint): bigint {
  const lowMask = (1n << 30n) - 1n;
  const cleared = cell & ~(0xfn << 52n) & ~lowMask;
  return BigInt.asUintN(64, cleared | (5n << 52n) | lowMask);
}

function regionLeaf(parent: bigint, cityId: number): string {
  const inner = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint64", "uint32"], [parent, cityId]));
  return ethers.keccak256(inner);
}
const pair = (a: string, b: string) =>
  BigInt(a) <= BigInt(b) ? ethers.keccak256(ethers.concat([a, b])) : ethers.keccak256(ethers.concat([b, a]));

export function buildRegionTree(entries: Array<[bigint, number]>) {
  const leaves = entries.map(([p, c]) => regionLeaf(p, c));
  const layers: string[][] = [leaves];
  while (layers[layers.length - 1].length > 1) {
    const cur = layers[layers.length - 1];
    const next: string[] = [];
    for (let i = 0; i < cur.length; i += 2) next.push(i + 1 < cur.length ? pair(cur[i], cur[i + 1]) : cur[i]);
    layers.push(next);
  }
  const proofFor = (parent: bigint, cityId: number): string[] => {
    let idx = leaves.indexOf(regionLeaf(parent, cityId));
    if (idx < 0) return [];
    const proof: string[] = [];
    for (let l = 0; l < layers.length - 1; l += 1) {
      const sib = idx % 2 === 0 ? idx + 1 : idx - 1;
      if (sib < layers[l].length) proof.push(layers[l][sib]);
      idx = Math.floor(idx / 2);
    }
    return proof;
  };
  return { root: layers[layers.length - 1][0], proofFor };
}
export type RegionTree = ReturnType<typeof buildRegionTree>;

/** Bangalore (the suite's usual cells) is city 7, Berlin city 9: the ids the original tests use. */
export const BANGALORE_CITY = 7;
export const BERLIN_CITY = 9;
export function defaultRegionEntries(): Array<[bigint, number]> {
  const out = new Map<string, [bigint, number]>();
  for (const cell of cityCells(60)) out.set(`b${h3Parent5(cell)}`, [h3Parent5(cell), BANGALORE_CITY]);
  for (const cell of cityCells(2, 52.52, 13.405)) out.set(`z${h3Parent5(cell)}`, [h3Parent5(cell), BERLIN_CITY]);
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

export interface Suite extends base.Suite {
  eligibilityCoSigner: any;
  contestCoSigner: any;
  voider: any;
  outsider: any;
  regionTree: RegionTree;
}

/** Runs several administrative calls through the real timelock as one delayed batch. */
export async function execBatchViaTimelock(fx: base.Suite, targets: string[], payloads: string[], salt: string) {
  const values = targets.map(() => 0n);
  await (
    await fx.timelock
      .connect(fx.admin)
      .scheduleBatch(targets, values, payloads, base.ZERO_BYTES32, salt, base.TIMELOCK_DELAY)
  ).wait();
  await time.increase(base.TIMELOCK_DELAY + 1);
  await (
    await fx.timelock.connect(fx.admin).executeBatch(targets, values, payloads, base.ZERO_BYTES32, salt)
  ).wait();
}

/**
 * The original deployment plus the configuration the patched build needs before it can
 * work at all (every new control fails closed): a second eligibility signer, the committed
 * city regions, a contest co-signer and a voider. Two distinct keys per two-key duty.
 */
export async function deploySuite(): Promise<Suite> {
  const f = await base.deploySuite();
  const s = await ethers.getSigners();
  const [eligibilityCoSigner, contestCoSigner, voider, outsider] = [s[11], s[12], s[13], s[14]];
  const regionTree = buildRegionTree(defaultRegionEntries());
  // FIXTURE ADJUSTMENT (signer roles patch): a new eligibility signer needs a prior approval
  // from SIGNER_APPROVER_ROLE, which the constructor gives to the guardian.
  await (await f.deedClaims.connect(f.guardian).approveEligibilitySignerAddition(eligibilityCoSigner.address)).wait();
  await execBatchViaTimelock(
    f,
    [f.addresses.deedClaims, f.addresses.deedClaims, f.addresses.contests, f.addresses.deed],
    [
      f.deedClaims.interface.encodeFunctionData("setEligibilitySignerRegistered", [eligibilityCoSigner.address, true]),
      f.deedClaims.interface.encodeFunctionData("setCityRegionRoot", [regionTree.root]),
      f.contests.interface.encodeFunctionData("setContestCoSigner", [contestCoSigner.address]),
      f.deed.interface.encodeFunctionData("grantRole", [await f.deed.VOIDER_ROLE(), voider.address]),
    ],
    ethers.id("port-fixture-config")
  );
  return { ...f, eligibilityCoSigner, contestCoSigner, voider, outsider, regionTree };
}

/**
 * Opens a city. Original: one timelock call setting the per-holder cap. Patched (H3 / M1)
 * additionally needs a non-zero city-wide cap (0 = closed) and, for the suite's scenarios
 * that claim many deeds in one day, a higher per-city daily claim limit. Cluster cap stays 1;
 * claimDeed gives every claim its own cluster id, so the cluster cap is never the binding
 * rule in the ported tests (the focused tests exercise it).
 */
export async function configureCityCap(fx: Suite, cityId: number, capPerHolder: number, cityWide = 1_000) {
  await execBatchViaTimelock(
    fx,
    [fx.addresses.deed, fx.addresses.deedClaims, fx.addresses.deedClaims],
    [
      fx.deed.interface.encodeFunctionData("configureCityConcentrationCap", [cityId, capPerHolder]),
      fx.deedClaims.interface.encodeFunctionData("setCityWideCap", [cityId, cityWide]),
      fx.deedClaims.interface.encodeFunctionData("setIssuanceLimits", [1, 50, 1_000]),
    ],
    ethers.id(`port-city-${cityId}-${capPerHolder}-${cityWide}`)
  );
}

// ---------------------------------------------------------------------------
// H1: settlement days close on the wall clock
// ---------------------------------------------------------------------------

/** Moves the chain to the moment `dayId` has closed (genesis + dayId days), then builds the authorization. */
export async function settlementAuthorization(
  fx: Suite,
  overrides: Partial<base.SettlementAuthorization> & { dayId: number; grossIssuance: bigint }
): Promise<base.SettlementAuthorization> {
  const genesis = Number(await fx.settlement.genesis());
  const closesAt = genesis + overrides.dayId * DAY;
  if ((await time.latest()) < closesAt) await time.increaseTo(closesAt);
  return base.settlementAuthorization(overrides);
}

export async function fundLockedMove(fx: Suite, dayId: number, grants: base.Grant[]) {
  const entries = grants.map((g, i) => ({ leafIndex: i, account: g.account, lockedAmount: g.amount, liquidAmount: 0n }));
  const total = grants.reduce((sum, g) => sum + g.amount, 0n);
  const tree = base.buildRewardTree(fx.chainId, fx.addresses.rewards, dayId, entries);
  await (
    await base.publishSettlement(
      fx,
      await settlementAuthorization(fx, { dayId, grossIssuance: total, merkleRoot: tree.root, participantCount: grants.length })
    )
  ).wait();
  for (const e of entries) {
    await (
      await fx.rewards.connect(fx.relayer).claim(dayId, e.leafIndex, e.account, e.lockedAmount, 0n, tree.proofFor(e.leafIndex))
    ).wait();
  }
}

export async function fundLiquidMove(fx: Suite, dayId: number, grants: base.Grant[]) {
  const total = grants.reduce((sum, g) => sum + g.amount, 0n);
  await base.execViaTimelock(
    fx,
    fx.addresses.settlement,
    fx.settlement.interface.encodeFunctionData("raiseLiquidIssuanceAllowance", [total]),
    ethers.id(`liquid-allowance-${dayId}-${total}`)
  );
  const entries = grants.map((g, i) => ({ leafIndex: i, account: g.account, lockedAmount: 0n, liquidAmount: g.amount }));
  const tree = base.buildRewardTree(fx.chainId, fx.addresses.rewards, dayId, entries);
  await (
    await base.publishSettlement(
      fx,
      await settlementAuthorization(fx, {
        dayId,
        grossIssuance: total,
        lockedClaims: 0n,
        liquidMovementClaims: total,
        merkleRoot: tree.root,
        participantCount: grants.length,
      })
    )
  ).wait();
  for (const e of entries) {
    await (
      await fx.rewards.connect(fx.relayer).claim(dayId, e.leafIndex, e.account, 0n, e.liquidAmount, tree.proofFor(e.leafIndex))
    ).wait();
  }
}

// ---------------------------------------------------------------------------
// H3 / M1: threshold attestations, city regions, clusters
// ---------------------------------------------------------------------------

export const ELIGIBILITY_TYPES_V2 = {
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

export interface AttestationV2 extends base.EligibilityAttestation {
  clusterId: string;
  evidenceHash: string;
}

export async function eligibilityAttestationV2(
  overrides: Partial<AttestationV2> & { claimant: string; h3CellId: bigint; cityId: number }
): Promise<AttestationV2> {
  return {
    solidGround: true,
    tenureDays: 30,
    distinctCrossers: 40,
    trafficDays: 15,
    relatedTrafficExcluded: true,
    clusterId: ethers.id(`cluster:${overrides.claimant}:${overrides.h3CellId}`),
    evidenceHash: ethers.id(`evidence:${overrides.h3CellId}`),
    claimFee: 0n,
    rulesVersion: base.RULES_VERSION,
    nonce: base.nextNonce(),
    expiry: await base.futureExpiry(),
    ...overrides,
  };
}

/** Signatures ordered by ascending signer address, as the contract requires. */
export async function signThreshold(fx: Suite, att: AttestationV2, signers?: any[]): Promise<string[]> {
  const dom = base.domain("MovenRunDeedClaims", fx.chainId, fx.addresses.deedClaims);
  const list = [...(signers ?? [fx.deedSigner, fx.eligibilityCoSigner])];
  list.sort((a, b) => (BigInt(a.address) < BigInt(b.address) ? -1 : 1));
  return Promise.all(list.map((s) => s.signTypedData(dom, ELIGIBILITY_TYPES_V2, att)));
}

export function proofFor(fx: Suite, cell: bigint, cityId: number): string[] {
  return fx.regionTree.proofFor(contractParent(cell), cityId);
}

/** Submits a pre-built attestation under the given signers (default: the two registered keys). */
export async function claimWithAttestation(fx: Suite, claimant: any, att: AttestationV2, signers?: any[], maxFee?: bigint) {
  const sigs = await signThreshold(fx, att, signers);
  return fx.deedClaims
    .connect(claimant)
    .claimWithThreshold(att, sigs, proofFor(fx, att.h3CellId, att.cityId), maxFee ?? att.claimFee);
}

export async function claimDeed(
  fx: Suite,
  claimant: any,
  h3CellId: bigint,
  cityId: number,
  overrides: Partial<AttestationV2> = {}
) {
  const att = await eligibilityAttestationV2({ claimant: claimant.address, h3CellId, cityId, ...overrides });
  return claimWithAttestation(fx, claimant, att);
}

// ---------------------------------------------------------------------------
// N1: a new deed is pending for seven days
// ---------------------------------------------------------------------------

/** Moves time to the end of a deed's challenge window. */
export async function waitOutChallengeWindow(fx: Suite, tokenId: bigint) {
  const finalAt = Number(await fx.deed.finalAt(tokenId));
  if ((await time.latest()) < finalAt) await time.increaseTo(finalAt);
}

/** N1: a pending deed cannot be escrowed, so the helper waits out the window first. */
export async function declareContest(
  fx: Suite,
  challenger: any,
  tokenId: bigint,
  overrides: Partial<base.DeclarationAuthorization> = {}
) {
  await waitOutChallengeWindow(fx, tokenId);
  return base.declareContest(fx, challenger, tokenId, overrides);
}

// ---------------------------------------------------------------------------
// H2: both sides of one closed day, two keys
// ---------------------------------------------------------------------------

export const DAY_SCORES_TYPES = {
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

export async function dayScoresAuthorization(contestId: bigint, day: number, c: bigint, d: bigint) {
  return {
    contestId,
    scoringDay: day,
    challengerScore: c,
    defenderScore: d,
    rulesVersion: base.RULES_VERSION,
    nonce: base.nextNonce(),
    expiry: await base.futureExpiry(30 * DAY),
  };
}

export async function submitDayScores(
  fx: Suite,
  contestId: bigint,
  day: number,
  challengerScore: bigint,
  defenderScore: bigint,
  signers?: any[]
) {
  const auth = await dayScoresAuthorization(contestId, day, challengerScore, defenderScore);
  const dom = base.domain("MovenRunContests", fx.chainId, fx.addresses.contests);
  const [s1, s2] = signers ?? [fx.contestScoreSigner, fx.contestCoSigner];
  return fx.contests
    .connect(fx.relayer)
    .submitDayScores(auth, await s1.signTypedData(dom, DAY_SCORES_TYPES, auth), await s2.signTypedData(dom, DAY_SCORES_TYPES, auth));
}

/** Moves to the moment scoring day `day` (0-based) has closed. */
export async function closeScoringDay(fx: Suite, contestId: bigint, day: number) {
  const c = await fx.contests.contestOf(contestId);
  await time.increaseTo(Number(c.scoringStart) + (day + 1) * DAY + 1);
}

/** Waits out the scoring window and the submission grace, then settles from an unrelated account. */
export async function settleAfterGrace(fx: Suite, contestId: bigint) {
  const c = await fx.contests.contestOf(contestId);
  const target = Number(c.scoringEnd) + SCORE_GRACE + 60;
  if ((await time.latest()) < target) await time.increaseTo(target);
  return fx.contests.connect(fx.relayer).settleContest(contestId);
}

/**
 * Original playOut posted each side separately as soon as the window opened. Patched: each day
 * is posted for both sides together, only after that day has closed; a side with fewer scores
 * is given 0 for the remaining days (an unscored day and a zero day count the same).
 */
export async function playOutContest(
  fx: Suite,
  contestId: bigint,
  challengerScores: bigint[],
  defenderScores: bigint[]
) {
  const days = Math.max(challengerScores.length, defenderScores.length);
  for (let day = 0; day < days; day += 1) {
    await closeScoringDay(fx, contestId, day);
    await (await submitDayScores(fx, contestId, day, challengerScores[day] ?? 0n, defenderScores[day] ?? 0n)).wait();
  }
  return settleAfterGrace(fx, contestId);
}
