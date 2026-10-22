/**
 * Independent checks on a settled day. These are written from the source's
 * constraints, not copied from `dayBooksProblems`: the toll is recomputed in
 * exact bigint rational arithmetic, the trimmed amount is decomposed into its
 * parts, and every amount must be a safe integer.
 */
import {
  consistencyMultiplier,
  effort,
  scoringSessionIndices,
  type DayInput,
  type DaySettlement,
  type EconomyRules,
} from "@movenrun/shared/economy-v3";

export const isMicro = (v: number): boolean => Number.isSafeInteger(v) && v >= 0;

/** Exact §20 toll for one session: per owner floor(R × bp × cells ÷ (10,000 × distinct)). */
export function exactSessionToll(
  rules: EconomyRules,
  rewardMicro: number,
  crossedCells: readonly string[],
  deedOwnerByCell: ReadonlyMap<string, string>,
  runnerAndLinked: ReadonlySet<string>,
): { paid: bigint; toOwners: Map<string, bigint>; exactNumerator: bigint; denominator: bigint } {
  const distinct = [...new Set(crossedCells)];
  const byOwner = new Map<string, bigint>();
  for (const c of distinct) {
    const o = deedOwnerByCell.get(c);
    if (o === undefined || runnerAndLinked.has(o)) continue;
    byOwner.set(o, (byOwner.get(o) ?? 0n) + 1n);
  }
  const tolled = [...byOwner.values()].reduce((a, b) => a + b, 0n);
  const toOwners = new Map<string, bigint>();
  const den = 10_000n * BigInt(Math.max(1, distinct.length));
  if (tolled === 0n || rewardMicro <= 0) return { paid: 0n, toOwners, exactNumerator: 0n, denominator: den };
  const R = BigInt(rewardMicro);
  const bp = BigInt(rules.tollBasisPoints);
  let paid = 0n;
  for (const [o, c] of byOwner) {
    const share = (R * bp * c) / den;
    if (share > 0n) toOwners.set(o, share);
    paid += share;
  }
  return { paid, toOwners, exactNumerator: R * bp * tolled, denominator: den };
}

export interface DayCheck {
  violations: string[];
  /** Owner shares where the reference model's float arithmetic differs from the exact floor. */
  tollShareDivergences: number;
  /** The exact toll minus what was paid, summed: the remainder left with runners. */
  remainderToRunnersMicro: bigint;
}

/**
 * Every bookkeeping invariant for one settled day (G0). `input` is what was
 * passed to settleDay; `s` is its result.
 */
export function checkDay(rules: EconomyRules, input: DayInput, s: DaySettlement): DayCheck {
  const v: string[] = [];
  const b = s.books;
  let divergences = 0;
  let remainder = 0n;
  for (const [k, val] of Object.entries(b)) if (!isMicro(val)) v.push(`books.${k} is not a non-negative safe integer (${val})`);
  if (b.mintedMicro > b.poolMicro) v.push("INV-POOL-01 minted above the daily pool");
  if (b.mintedMicro + b.returnedToSeasonPoolMicro !== b.poolMicro) v.push("INV-POOL-02 pool not conserved");
  if (b.tollPaidMicro !== b.tollReceivedMicro) v.push("INV-TOLL-01 tolls paid ≠ received");
  if (b.creditedMicro + b.tollPaidMicro + b.burnedMicro !== b.mintedMicro) v.push("INV-MINT-01 minted not fully accounted");

  const expectedReceived = new Map<string, bigint>();
  let netSum = 0;
  for (let k = 0; k < s.players.length; k++) {
    const r = s.players[k]!;
    const p = input.players[k]!;
    const where = `player ${r.playerId}`;
    if (r.playerId !== p.playerId) v.push(`${where}: result order differs from input`);
    for (const x of [r.dayRewardMicro, r.tollPaidMicro, r.tollReceivedMicro, r.creditedMicro, ...r.sessionRewardsMicro,
      r.charges.rechargeMicro, r.charges.upkeepTakenMicro, r.charges.upkeepOwedMicro, r.charges.upkeepPaidInConditionMicro]) {
      if (!isMicro(x)) v.push(`${where}: amount ${x} is not a non-negative safe integer`);
    }
    if (r.sessionRewardsMicro.some((x) => x > rules.sessionCeilingMicro)) v.push(`INV-CEIL-01 ${where} session over 12`);
    if (r.dayRewardMicro > rules.dayCeilingMicro) v.push(`INV-CEIL-02 ${where} day over 20`);
    const idx = scoringSessionIndices(rules, p.sessions);
    if (idx.length > rules.scoringSessionsPerDay) v.push(`INV-SESS-01 ${where} more than two scoring sessions`);
    if (r.sessionRewardsMicro.length !== idx.length) v.push(`${where}: session rewards do not match the scoring sessions`);
    const runnerAndLinked = new Set([p.playerId, ...(p.linkedPlayerIds ?? [])]);
    let expectedPaid = 0n;
    idx.forEach((si, j) => {
      const R = r.sessionRewardsMicro[j] ?? 0;
      const ex = exactSessionToll(rules, R, p.sessions[si]!.crossedCells ?? [], input.deedOwnerByCell, runnerAndLinked);
      expectedPaid += ex.paid;
      // 2% of one session, never multiplied by the number of owners.
      if (ex.paid * 10_000n > BigInt(R) * BigInt(rules.tollBasisPoints)) v.push(`INV-TOLL-02 ${where} session toll above 2%`);
      remainder += ex.denominator > 0n ? ex.exactNumerator / ex.denominator - ex.paid : 0n;
      for (const [o, amt] of ex.toOwners) {
        if (runnerAndLinked.has(o)) v.push(`INV-TOLL-04 ${where} pays own or linked land`);
        expectedReceived.set(o, (expectedReceived.get(o) ?? 0n) + amt);
      }
    });
    if (BigInt(r.tollPaidMicro) !== expectedPaid) divergences += 1;
    if (r.tollPaidMicro * 10_000 > r.dayRewardMicro * rules.tollBasisPoints) v.push(`INV-TOLL-02 ${where} day toll above 2%`);
    const auto = r.charges.rechargeMicro + r.charges.upkeepTakenMicro;
    if (auto * 10_000 > r.dayRewardMicro * rules.autoChargeCapBasisPoints) v.push(`INV-COST-01 ${where} automatic charges above 60%`);
    if (auto + r.tollPaidMicro > r.dayRewardMicro) v.push(`INV-COST-02 ${where} costs exceed the reward`);
    if (r.creditedMicro !== r.dayRewardMicro - r.tollPaidMicro - auto) v.push(`INV-TOLL-03 ${where} remainder not kept by the runner`);
    if (r.charges.upkeepTakenMicro + r.charges.upkeepPaidInConditionMicro !== r.charges.upkeepOwedMicro) v.push(`${where}: upkeep owed not split exactly`);
    if (r.creditedMicro < 0 || r.creditedMicro + r.tollReceivedMicro < 0) v.push(`INV-NEG-01 ${where} negative balance`);
    if (idx.length === 0 && r.dayRewardMicro !== 0) v.push(`INV-SESS-02 ${where} reward without a scoring session`);
    netSum += r.creditedMicro + r.tollReceivedMicro;
  }
  for (const r of s.players) {
    const ex = expectedReceived.get(r.playerId) ?? 0n;
    if (BigInt(r.tollReceivedMicro) !== ex) divergences += 1;
  }
  // Supply effect of the day: credits kept by players plus every toll received (outsiders included) = minted − burned.
  const playersReceived = s.players.reduce((a, r) => a + r.tollReceivedMicro, 0);
  if (netSum - playersReceived + b.tollReceivedMicro !== b.mintedMicro - b.burnedMicro) v.push("INV-BURN-01 net credits ≠ minted − burned");
  return { violations: v, tollShareDivergences: divergences, remainderToRunnersMicro: remainder };
}

/**
 * The parts of `returnedToSeasonPoolMicro`, rebuilt independently (§17): the
 * split's rounding dust, the trust-withheld share, the session-ceiling trim,
 * and the day-ceiling trim (with its rounding). Each must be ≥ 0 and they must
 * sum to what the books return.
 */
export function returnDecomposition(rules: EconomyRules, input: DayInput, s: DaySettlement) {
  const pts = input.players.map((p) => {
    const idx = scoringSessionIndices(rules, p.sessions);
    const c = idx.length > 0 ? consistencyMultiplier(rules, p.activeDaysThisWeek) : 0;
    return idx.map((i) => effort(rules, p.sessions[i]!.minutes) * c);
  });
  const total = s.totalPoints;
  let split = 0;
  let trust = 0;
  let sessionTrim = 0;
  let dayTrim = 0;
  input.players.forEach((p, k) => {
    const unweighted = pts[k]!.map((x) => (total > 0 ? Math.floor((input.poolMicro * x) / total) : 0));
    const weighted = unweighted.map((u) => Math.floor(u * p.trustWeight));
    const capped = weighted.map((w) => Math.min(w, rules.sessionCeilingMicro));
    split += unweighted.reduce((a, x) => a + x, 0);
    trust += unweighted.reduce((a, x, i) => a + (x - weighted[i]!), 0);
    sessionTrim += weighted.reduce((a, x, i) => a + (x - capped[i]!), 0);
    dayTrim += capped.reduce((a, x) => a + x, 0) - s.players[k]!.dayRewardMicro;
  });
  const dust = input.poolMicro - split;
  return { dust, trust, sessionTrim, dayTrim, sum: dust + trust + sessionTrim + dayTrim };
}
