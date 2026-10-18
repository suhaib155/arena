/**
 * Route-farming credit rules: named, versioned, optional simulation rules that
 * change only how many credits a verified session earns. They never touch the
 * session's GPS proof, its stepped units (territory), XP, streak or
 * achievements: a rule's only output is a credit amount per session, and the
 * movement it is given is passed on unchanged. See
 * `docs/SIM_ROUTE_FARMING_STUDY.md`. SIMULATION ONLY: every value is PILOT,
 * none is final, and no V3 source constant or default is changed.
 *
 * Privacy: the comparison is made on a coarse route fingerprint, a MinHash
 * signature over the *set* of coarse parent zones (about H3 resolution 9
 * scale, 201 m edge) a session stepped through. It keeps no order, no times,
 * no points and no unit ids, and is salted per season. Only
 * `repeat-route-unscored-3` (the sim-pilot-1 candidate, kept for comparison)
 * needs the exact stepped units of the walker's last three qualifying days.
 */

import {
  dayBooksProblems,
  scoringSessionIndices,
  sessionQualifies,
  settleDay,
  type DaySettlement,
  type EconomyRules,
  type SessionInput,
} from "../domain/economyV3";
import { SIM_ONLY } from "./pilotRuleset";
import { hash32 } from "./world";

/* ── the fingerprint ──────────────────────────────────────────────────────── */

export interface RouteFingerprintSpec {
  kind: "minhash_parents";
  /** Edge of the coarse parent zone, metres (201 m is the H3 resolution 9 scale). */
  parentEdgeMeters: number;
  /** Signature length. */
  hashes: number;
  /** Days a signature is kept before it is deleted. */
  retentionDays: number;
  /** Per-season salt, so signatures cannot be compared across seasons or looked up from a place. */
  salt: string;
}

/** A MinHash signature: `hashes` 32-bit minima. Nothing else is kept. */
export type RouteFingerprint = readonly number[];

export function routeFingerprint(spec: RouteFingerprintSpec, parentZones: Iterable<string>): RouteFingerprint {
  const zones = [...new Set(parentZones)];
  const sig: number[] = [];
  for (let k = 0; k < spec.hashes; k++) {
    let min = 0xffffffff;
    for (const z of zones) {
      const h = hash32(`${spec.salt}\u0000${k}\u0000${z}`);
      if (h < min) min = h;
    }
    sig.push(zones.length === 0 ? 0xffffffff : min);
  }
  return sig;
}

/** Estimated Jaccard similarity of the two parent sets: the share of equal slots. */
export function fingerprintSimilarity(a: RouteFingerprint, b: RouteFingerprint): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let same = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i] && a[i] !== 0xffffffff) same += 1;
  return same / a.length;
}

/* ── the rules ────────────────────────────────────────────────────────────── */

export type RouteCreditRule =
  /** Comparator 1: no repeat-route adjustment. */
  | { kind: "none" }
  /**
   * Comparator 2 (`repeat-route-unscored-3`, from sim-pilot-1): a session is
   * settled as unscored (SOURCE §8: no tokens, still takes ground, streak,
   * XP) when every unit it stepped on was also stepped on, by the same
   * walker, on each of the walker's previous `days` qualifying days. Exact
   * units, not the fingerprint.
   */
  | { kind: "unscored_identical"; days: number }
  /**
   * Comparator 3: decreasing marginal credits on highly repeated routes. A
   * scoring session whose fingerprint matches (similarity ≥ `similarity`)
   * `n` scoring sessions of the same walker in the trailing `windowDays`
   * (today included) earns its V3 reward × max(floor, 1 − step × (n + 1 −
   * freeRepeats)) once n ≥ freeRepeats; otherwise the full reward.
   */
  | { kind: "marginal_taper"; windowDays: number; similarity: number; freeRepeats: number; stepPerRepeat: number; floor: number }
  /**
   * Comparator 4: one walker's matching sessions on one day together earn
   * at most `boundMicro` (V3's session ceiling, 12 credits, by default),
   * trimmed in proportion.
   */
  | { kind: "identical_daily_bound"; similarity: number; boundMicro: number }
  /**
   * Comparator 5: matching sessions on one day by accounts linked to each
   * other (the risk graph's `linkedPlayerIds`) together earn what the
   * best-paid one of those accounts earned for that route alone, split in
   * proportion. A single account is never changed.
   */
  | { kind: "linked_identical_as_one"; similarity: number }
  /**
   * Alternative A (soft ceiling): no route test at all. Credits an account
   * earns beyond `softMicro` in the trailing `windowDays` (today included)
   * are paid at `rateAbove`. Only the share above the soft ceiling is
   * touched; the first credits of every week are always paid in full.
   */
  | { kind: "soft_ceiling"; windowDays: number; softMicro: number; rateAbove: number }
  /**
   * Alternative B (cluster-level, not account-level): matching sessions of
   * accounts linked to each other on one day form a cluster; with
   * `timeWindowMinutes` they must also start within that many minutes of
   * each other (walking together, not the same park at different hours).
   * `allowance` (household allowance) is how many co-walkers keep full
   * credits: a cluster of more accounts earns what its `allowance`
   * best-paid accounts earned, trimmed in proportion; null means no
   * automatic damping. A single account is never changed.
   *
   * `review` (alternative C, appealable flags): a cluster with more than
   * `flagAboveAccounts` accounts on `flagDays` days within `windowDays`
   * opens a review of that linked group instead of (or as well as) an
   * automatic cut. Credits are untouched while the review is open. Only if
   * a reviewer upholds it does `upheldAllowance` apply, from
   * `reviewDelayDays` after the flag, never to days already settled. A
   * group a reviewer cleared is not flagged again for `clearedExemptDays`
   * (otherwise a genuine household is re-reviewed every window and a small
   * reviewer error rate compounds).
   */
  | {
      kind: "linked_cluster";
      similarity: number;
      timeWindowMinutes: number | null;
      allowance: number | null;
      review: null | { flagAboveAccounts: number; flagDays: number; windowDays: number; reviewDelayDays: number; upheldAllowance: number; clearedExemptDays: number };
    };

/**
 * Where the trust weight (SOURCE §17 slot) acts. "before_ceiling" is
 * ASSUMPTION A6 as the V3 reference model reads it today: trust scales the
 * pool share, then the 12 / 20 ceilings cut, so while ceilings bind a
 * weight below 1 withholds nothing. "after_ceiling" is the alternative
 * reading: settle at full trust, apply the ceilings, then scale by trust.
 * Withheld credits return to the season pool either way. The V3 reference
 * model itself is not changed; this switch lives only in the simulation
 * layer.
 */
export type TrustOrder = "before_ceiling" | "after_ceiling";

export interface RouteCreditRuleset {
  /** "sim-route-" prefix marks a simulation rule. */
  name: string;
  version: number;
  status: typeof SIM_ONLY;
  fingerprint: RouteFingerprintSpec;
  rule: RouteCreditRule;
  /** Absent = "before_ceiling" (A6 as the reference model reads it). */
  trustOrder?: TrustOrder;
}

/** PILOT fingerprint: 32-slot MinHash over 201 m parent zones, kept 14 days. */
export const ROUTE_FINGERPRINT_PILOT: Readonly<RouteFingerprintSpec> = Object.freeze({
  kind: "minhash_parents",
  parentEdgeMeters: 201,
  hashes: 32,
  retentionDays: 14,
  salt: "sim-season-1",
});

const ruleset = (name: string, rule: RouteCreditRule, version = 1, trustOrder?: TrustOrder): Readonly<RouteCreditRuleset> =>
  Object.freeze({ name, version, status: SIM_ONLY, fingerprint: ROUTE_FINGERPRINT_PILOT, rule: Object.freeze(rule), ...(trustOrder ? { trustOrder } : {}) });

export const ROUTE_BASELINE = ruleset("sim-route-baseline", { kind: "none" });
export const REPEAT_ROUTE_UNSCORED_3 = ruleset("sim-route-repeat-route-unscored-3", { kind: "unscored_identical", days: 3 });
/** Free for 14 matching scoring sessions a week (two a day), then −15% per further match, never below 25%. */
export const ROUTE_TAPER_14 = ruleset("sim-route-taper-14", { kind: "marginal_taper", windowDays: 7, similarity: 0.8, freeRepeats: 14, stepPerRepeat: 0.15, floor: 0.25 });
export const ROUTE_TAPER_10 = ruleset("sim-route-taper-10", { kind: "marginal_taper", windowDays: 7, similarity: 0.8, freeRepeats: 10, stepPerRepeat: 0.15, floor: 0.25 });
export const ROUTE_TAPER_6 = ruleset("sim-route-taper-6", { kind: "marginal_taper", windowDays: 7, similarity: 0.8, freeRepeats: 6, stepPerRepeat: 0.15, floor: 0.25 });
export const ROUTE_DAILY_BOUND = ruleset("sim-route-identical-daily-bound", { kind: "identical_daily_bound", similarity: 0.8, boundMicro: 12_000_000 });
export const ROUTE_LINKED_AS_ONE = ruleset("sim-route-linked-identical-as-one", { kind: "linked_identical_as_one", similarity: 0.8 });
export const ROUTE_LINKED_AS_ONE_06 = ruleset("sim-route-linked-identical-as-one-0.6", { kind: "linked_identical_as_one", similarity: 0.6 });

/* ── less punitive alternatives (second round) ────────────────────────────── */

export const ROUTE_TAPER_12 = ruleset("sim-route-taper-12", { kind: "marginal_taper", windowDays: 7, similarity: 0.8, freeRepeats: 12, stepPerRepeat: 0.15, floor: 0.25 });
/** 100 credits a rolling week in full (about 14 a day), half rate above. */
export const ROUTE_SOFT_CEILING = ruleset("sim-route-soft-ceiling-100w", { kind: "soft_ceiling", windowDays: 7, softMicro: 100_000_000, rateAbove: 0.5 });
const cluster = (timeWindowMinutes: number | null, allowance: number | null, review: Extract<RouteCreditRule, { kind: "linked_cluster" }>["review"] = null) =>
  ({ kind: "linked_cluster", similarity: 0.8, timeWindowMinutes, allowance, review }) as const;
/** Linked accounts on the same walk, starting within 20 minutes, earn as one. */
export const ROUTE_CLUSTER_K1 = ruleset("sim-route-cluster-together-k1", cluster(20, 1));
/** Household allowance 2: two linked co-walkers keep full credits; a third and beyond are damped. */
export const ROUTE_CLUSTER_K2 = ruleset("sim-route-cluster-together-k2", cluster(20, 2));
export const ROUTE_CLUSTER_K3 = ruleset("sim-route-cluster-together-k3", cluster(20, 3));
const REVIEW = { flagDays: 4, windowDays: 14, reviewDelayDays: 3, upheldAllowance: 1, clearedExemptDays: 90 };
/** No automatic cut: any linked pair or more walking together on 4 days in 14 opens a review. */
export const ROUTE_REVIEW_ALL = ruleset("sim-route-review-flag-2plus", cluster(20, null, { flagAboveAccounts: 1, ...REVIEW }));
/** No automatic cut: three or more linked co-walkers on 4 days in 14 open a review; pairs are never flagged. */
export const ROUTE_REVIEW_3PLUS = ruleset("sim-route-review-flag-3plus", cluster(20, null, { flagAboveAccounts: 2, ...REVIEW }));
/** Trust weight after the ceilings, no route rule. */
export const ROUTE_TRUST_AFTER = ruleset("sim-route-trust-after-ceiling", { kind: "none" }, 1, "after_ceiling");
/** Candidate: no automatic route cut; review flags for 2+ linked co-walkers (cleared groups exempt for the season); trust after the ceilings. */
export const ROUTE_CANDIDATE = ruleset("sim-route-candidate-review2-trust-after", cluster(20, null, { flagAboveAccounts: 1, ...REVIEW }), 1, "after_ceiling");
/** Variant of the candidate: pairs are never flagged (household allowance 2), only 3+. */
export const ROUTE_CANDIDATE_3 = ruleset("sim-route-candidate-review3-trust-after", cluster(20, null, { flagAboveAccounts: 2, ...REVIEW }), 1, "after_ceiling");
/** Automatic household allowance 2 combined with the same review and trust order, for comparison. */
export const ROUTE_CANDIDATE_K2 = ruleset("sim-route-k2-review3-trust-after", cluster(20, 2, { flagAboveAccounts: 2, ...REVIEW }), 1, "after_ceiling");

export function routeRuleProblems(r: RouteCreditRuleset): string[] {
  const p: string[] = [];
  if (r.status !== SIM_ONLY) p.push("route rules are simulation only");
  if (!r.name.startsWith("sim-route-")) p.push("a route rule name starts with sim-route-");
  if (!(Number.isInteger(r.version) && r.version >= 1)) p.push("version must be a whole number, 1 or more");
  const f = r.fingerprint;
  if (!(f.parentEdgeMeters > 0)) p.push("parent edge must be above 0");
  if (!(Number.isInteger(f.hashes) && f.hashes >= 8)) p.push("a fingerprint needs 8 hashes or more");
  if (!(Number.isInteger(f.retentionDays) && f.retentionDays >= 1)) p.push("retention must be 1 day or more");
  const x = r.rule;
  const sim = (s: number) => s > 0 && s <= 1;
  switch (x.kind) {
    case "none":
      break;
    case "unscored_identical":
      if (!(Number.isInteger(x.days) && x.days >= 1)) p.push("repeat-route days must be a whole number, 1 or more");
      break;
    case "marginal_taper":
      if (!sim(x.similarity)) p.push("similarity must be above 0 and at most 1");
      if (!(Number.isInteger(x.windowDays) && x.windowDays >= 1 && x.windowDays <= f.retentionDays)) p.push("taper window must be 1 day or more and within retention");
      if (!(Number.isInteger(x.freeRepeats) && x.freeRepeats >= 1)) p.push("free repeats must be a whole number, 1 or more");
      if (!(x.stepPerRepeat > 0 && x.stepPerRepeat <= 1)) p.push("taper step must be above 0 and at most 1");
      if (!(x.floor > 0 && x.floor < 1)) p.push("taper floor must be above 0 (verified movement keeps earning) and below 1");
      break;
    case "identical_daily_bound":
      if (!sim(x.similarity)) p.push("similarity must be above 0 and at most 1");
      if (!(Number.isInteger(x.boundMicro) && x.boundMicro > 0)) p.push("daily bound must be a whole number of micro-credits above 0");
      break;
    case "linked_identical_as_one":
      if (!sim(x.similarity)) p.push("similarity must be above 0 and at most 1");
      break;
    case "soft_ceiling":
      if (!(Number.isInteger(x.windowDays) && x.windowDays >= 1)) p.push("soft ceiling window must be a whole number of days, 1 or more");
      if (!(Number.isInteger(x.softMicro) && x.softMicro > 0)) p.push("soft ceiling must be a whole number of micro-credits above 0");
      if (!(x.rateAbove > 0 && x.rateAbove < 1)) p.push("rate above the soft ceiling must be above 0 (verified movement keeps earning) and below 1");
      break;
    case "linked_cluster": {
      if (!sim(x.similarity)) p.push("similarity must be above 0 and at most 1");
      if (x.timeWindowMinutes !== null && !(x.timeWindowMinutes > 0)) p.push("time window must be above 0 minutes, or null");
      const k = (v: number) => Number.isInteger(v) && v >= 1;
      if (x.allowance !== null && !k(x.allowance)) p.push("allowance must be a whole number of accounts, 1 or more, or null");
      if (x.allowance === null && x.review === null) p.push("a cluster rule needs an allowance or a review");
      if (x.review) {
        const v = x.review;
        if (!k(v.flagAboveAccounts)) p.push("review flag threshold must be 1 account or more");
        if (!(k(v.flagDays) && k(v.windowDays) && v.flagDays <= v.windowDays && v.windowDays <= f.retentionDays)) p.push("review needs 1 ≤ flag days ≤ window ≤ retention");
        if (!k(v.reviewDelayDays)) p.push("an upheld review takes effect 1 day or more after the flag (never on a settled day)");
        if (!k(v.upheldAllowance)) p.push("upheld allowance must be 1 account or more");
        if (!(Number.isInteger(v.clearedExemptDays) && v.clearedExemptDays >= 0)) p.push("cleared exemption must be a whole number of days, 0 or more");
      }
      break;
    }
  }
  if (r.trustOrder !== undefined && r.trustOrder !== "before_ceiling" && r.trustOrder !== "after_ceiling") p.push("trust order must be before_ceiling or after_ceiling");
  return p;
}

/** The marginal factor of comparator 3 for a session that matches `n` earlier scoring sessions. */
export function taperFactor(rule: Extract<RouteCreditRule, { kind: "marginal_taper" }>, n: number): number {
  if (n < rule.freeRepeats) return 1;
  return Math.max(rule.floor, 1 - rule.stepPerRepeat * (n + 1 - rule.freeRepeats));
}

/* ── settling a day under a rule ──────────────────────────────────────────── */

export interface RouteSession {
  minutes: number;
  meters: number;
  /** Distinct units the verified route stepped on (territory pushes). Passed on unchanged. */
  stepped: readonly string[];
  /** Coarse parent zone of each stepped unit; only its fingerprint is kept. */
  parents: readonly string[];
  /** Start, minutes after local midnight. Only cluster rules with a time window read it. */
  startMinute?: number;
}

export interface RouteDayPlayer {
  playerId: string;
  linkedPlayerIds: readonly string[];
  sessions: readonly RouteSession[];
  activeDaysThisWeek: number;
  trustWeight: number;
}

export interface RouteDayPlayerResult {
  playerId: string;
  /** Credits per session after V3 and the rule; 0 for a session V3 did not score. */
  sessionCreditsMicro: number[];
  dayCreditsMicro: number;
  /** The V3 reward before the rule (after unscored marking for comparator 2). */
  v3DayRewardMicro: number;
  /** Sessions the rule settled as unscored (comparator 2 only). */
  unscoredByRule: number;
  /** Scoring sessions whose credits the rule reduced. */
  reducedByRule: number;
}

export interface RouteDayResult {
  poolMicro: number;
  creditedMicro: number;
  /** pool − credited: V3's returned share plus anything the rule withheld. */
  returnedMicro: number;
  /** Withheld after V3 settled (route rule, and trust under "after_ceiling"), back to the season pool. */
  withheldByRuleMicro: number;
  /** Of that, withheld by an "after_ceiling" trust weight. */
  withheldByTrustMicro: number;
  /** The day's reconciliation: empty when the books close exactly. */
  problems: string[];
  v3: DaySettlement;
  players: RouteDayPlayerResult[];
}

/** The per-walker memory a rule keeps between days: fingerprints only, except comparator 2's unit sets. */
export class RouteCreditState {
  readonly qualifyingDayUnits = new Map<string, Set<string>[]>();
  readonly scoredFingerprints = new Map<string, { day: number; fp: RouteFingerprint }[]>();
  /** Soft ceiling: credits per account per day (amounts only, no location). */
  readonly creditedByDay = new Map<string, { day: number; micro: number }[]>();
  /** Review: days a linked group walked together above the flag size (group key = sorted ids). */
  readonly reviewHits = new Map<string, number[]>();
  /** Review log: every flag, its outcome and when an upheld outcome takes effect. Auditable, appealable. */
  readonly reviews: { group: string; ids: string[]; flaggedDay: number; upheld: boolean; effectiveDay: number }[] = [];
  /**
   * Who decides a review. The simulation plugs in an ASSUMPTION model of a
   * human reviewer; absent, nothing is ever upheld (flags only).
   */
  reviewer?: (ids: readonly string[], day: number) => boolean;
}

/** Linked groups (2+ accounts) among the day's players, by union of their linked ids. */
function linkedGroups(players: readonly RouteDayPlayer[]): string[][] {
  const parent = new Map(players.map((p) => [p.playerId, p.playerId]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  for (const p of players) for (const l of p.linkedPlayerIds) if (parent.has(l)) parent.set(find(l), find(p.playerId));
  const groups = new Map<string, string[]>();
  for (const p of players) {
    const g = find(p.playerId);
    groups.set(g, [...(groups.get(g) ?? []), p.playerId]);
  }
  return [...groups.values()].filter((g) => g.length >= 2).map((g) => g.sort());
}

/**
 * Settles one day through the V3 reference model (`settleDay`), then applies
 * the rule. The movement given in is never changed; the result carries only
 * credits.
 */
export function settleRouteDay(
  econ: EconomyRules,
  rs: RouteCreditRuleset,
  state: RouteCreditState,
  day: number,
  poolMicro: number,
  players: readonly RouteDayPlayer[],
): RouteDayResult {
  const R = rs.rule;
  const fps = new Map<string, RouteFingerprint[]>();
  for (const p of players) fps.set(p.playerId, p.sessions.map((s) => routeFingerprint(rs.fingerprint, s.parents)));

  // Comparator 2 acts before settlement, as SOURCE §8's unscored mark does.
  const unscoredMarks = new Map<string, boolean[]>();
  for (const p of players) {
    let marks = p.sessions.map(() => false);
    if (R.kind === "unscored_identical") {
      const hist = (state.qualifyingDayUnits.get(p.playerId) ?? []).slice(-R.days);
      if (hist.length === R.days) marks = p.sessions.map((s) => s.stepped.length > 0 && s.stepped.every((u) => hist.every((d) => d.has(u))));
    }
    unscoredMarks.set(p.playerId, marks);
  }

  const inputs = players.map((p) => {
    const marks = unscoredMarks.get(p.playerId)!;
    const sessions: SessionInput[] = p.sessions.map((s, i) => ({ minutes: s.minutes, meters: s.meters, crossedCells: s.stepped, ...(marks[i] ? { unscored: true } : {}) }));
    return { playerId: p.playerId, linkedPlayerIds: p.linkedPlayerIds, sessions, activeDaysThisWeek: p.activeDaysThisWeek, trustWeight: p.trustWeight, kitLevel: 1 as const, zonesHeld: 0, unvisitedZoneLevels: [] };
  });
  const afterCeiling = rs.trustOrder === "after_ceiling";
  const v3 = settleDay(econ, { poolMicro, players: afterCeiling ? inputs.map((x) => ({ ...x, trustWeight: 1 })) : inputs, deedOwnerByCell: new Map() });

  // Per-session V3 credits.
  const credits = new Map<string, number[]>();
  const scored = new Map<string, number[]>();
  v3.players.forEach((r, k) => {
    const idx = scoringSessionIndices(econ, inputs[k]!.sessions);
    const arr = players[k]!.sessions.map(() => 0);
    idx.forEach((i, j) => (arr[i] = r.sessionRewardsMicro[j]!));
    credits.set(r.playerId, arr);
    scored.set(r.playerId, idx);
  });
  const v3Credits = new Map([...credits].map(([k, v]) => [k, [...v]]));

  if (R.kind === "marginal_taper") {
    for (const p of players) {
      const hist = (state.scoredFingerprints.get(p.playerId) ?? []).filter((h) => day - h.day < R.windowDays);
      const arr = credits.get(p.playerId)!;
      for (const i of scored.get(p.playerId)!) {
        const fp = fps.get(p.playerId)![i]!;
        const n = hist.filter((h) => fingerprintSimilarity(h.fp, fp) >= R.similarity).length;
        arr[i] = Math.floor(arr[i]! * taperFactor(R, n));
        hist.push({ day, fp });
      }
    }
  } else if (R.kind === "identical_daily_bound") {
    for (const p of players) {
      const arr = credits.get(p.playerId)!;
      const clusters: { fp: RouteFingerprint; members: number[] }[] = [];
      for (const i of scored.get(p.playerId)!) {
        const fp = fps.get(p.playerId)![i]!;
        const c = clusters.find((x) => fingerprintSimilarity(x.fp, fp) >= R.similarity);
        if (c) c.members.push(i);
        else clusters.push({ fp, members: [i] });
      }
      for (const c of clusters) {
        const total = c.members.reduce((a, i) => a + arr[i]!, 0);
        if (total > R.boundMicro) for (const i of c.members) arr[i] = Math.floor((arr[i]! * R.boundMicro) / total);
      }
    }
  } else if (R.kind === "linked_identical_as_one") {
    // Groups: accounts connected through the day's linked ids.
    const parent = new Map(players.map((p) => [p.playerId, p.playerId]));
    const find = (x: string): string => {
      let r = x;
      while (parent.get(r) !== r) r = parent.get(r)!;
      return r;
    };
    for (const p of players) for (const l of p.linkedPlayerIds) if (parent.has(l)) parent.set(find(l), find(p.playerId));
    const groups = new Map<string, string[]>();
    for (const p of players) {
      const g = find(p.playerId);
      groups.set(g, [...(groups.get(g) ?? []), p.playerId]);
    }
    for (const ids of groups.values()) {
      if (ids.length < 2) continue;
      const clusters: { fp: RouteFingerprint; members: { id: string; i: number }[] }[] = [];
      for (const id of [...ids].sort()) {
        for (const i of scored.get(id)!) {
          const fp = fps.get(id)![i]!;
          const c = clusters.find((x) => fingerprintSimilarity(x.fp, fp) >= R.similarity);
          if (c) c.members.push({ id, i });
          else clusters.push({ fp, members: [{ id, i }] });
        }
      }
      for (const c of clusters) {
        const byAccount = new Map<string, number>();
        for (const m of c.members) byAccount.set(m.id, (byAccount.get(m.id) ?? 0) + credits.get(m.id)![m.i]!);
        if (byAccount.size < 2) continue;
        const bound = Math.max(...byAccount.values());
        const total = [...byAccount.values()].reduce((a, b) => a + b, 0);
        if (total > bound) for (const m of c.members) credits.get(m.id)![m.i] = Math.floor((credits.get(m.id)![m.i]! * bound) / total);
      }
    }
  }

  if (R.kind === "soft_ceiling") {
    for (const p of players) {
      const hist = (state.creditedByDay.get(p.playerId) ?? []).filter((h) => day - h.day < R.windowDays);
      let used = hist.reduce((a, h) => a + h.micro, 0);
      const arr = credits.get(p.playerId)!;
      for (const i of scored.get(p.playerId)!) {
        const v = arr[i]!;
        const full = Math.min(v, Math.max(0, R.softMicro - used));
        arr[i] = full + Math.floor((v - full) * R.rateAbove);
        used += arr[i]!;
      }
      hist.push({ day, micro: arr.reduce((a, b) => a + b, 0) });
      state.creditedByDay.set(p.playerId, hist);
    }
  } else if (R.kind === "linked_cluster") {
    const startOf = (id: string, i: number) => players.find((q) => q.playerId === id)!.sessions[i]!.startMinute;
    const upheldNow = new Set(state.reviews.filter((v) => v.upheld && v.effectiveDay <= day).flatMap((v) => v.ids));
    for (const ids of linkedGroups(players)) {
      const clusters: { fp: RouteFingerprint; start: number | undefined; members: { id: string; i: number }[] }[] = [];
      for (const id of ids) {
        for (const i of scored.get(id)!) {
          const fp = fps.get(id)![i]!;
          const st = startOf(id, i);
          const c = clusters.find(
            (x) =>
              fingerprintSimilarity(x.fp, fp) >= R.similarity &&
              (R.timeWindowMinutes === null || x.start === undefined || st === undefined || Math.abs(x.start - st) <= R.timeWindowMinutes),
          );
          if (c) c.members.push({ id, i });
          else clusters.push({ fp, start: st, members: [{ id, i }] });
        }
      }
      let biggest = 0;
      for (const c of clusters) {
        const byAccount = new Map<string, number>();
        for (const m of c.members) byAccount.set(m.id, (byAccount.get(m.id) ?? 0) + credits.get(m.id)![m.i]!);
        biggest = Math.max(biggest, byAccount.size);
        let k = R.allowance ?? Infinity;
        if (R.review && [...byAccount.keys()].some((id) => upheldNow.has(id))) k = Math.min(k, R.review.upheldAllowance);
        if (byAccount.size <= k) continue;
        const bound = [...byAccount.values()].sort((a, b) => b - a).slice(0, k).reduce((a, b) => a + b, 0);
        const total = [...byAccount.values()].reduce((a, b) => a + b, 0);
        if (total > bound) for (const m of c.members) credits.get(m.id)![m.i] = Math.floor((credits.get(m.id)![m.i]! * bound) / total);
      }
      if (R.review) {
        const v = R.review;
        const key = ids.join("+");
        const hits = (state.reviewHits.get(key) ?? []).filter((d) => day - d < v.windowDays);
        if (biggest > v.flagAboveAccounts) hits.push(day);
        state.reviewHits.set(key, hits);
        const open = state.reviews.some((x) => x.group === key && (x.upheld || day - x.flaggedDay < Math.max(v.windowDays, v.clearedExemptDays)));
        if (!open && hits.length >= v.flagDays) {
          const upheld = state.reviewer ? state.reviewer(ids, day) : false;
          state.reviews.push({ group: key, ids, flaggedDay: day, upheld, effectiveDay: day + v.reviewDelayDays });
        }
      }
    }
  }

  // Trust after the ceilings: the alternative reading of A6.
  const beforeTrust = new Map([...credits].map(([k, v]) => [k, v.reduce((a, b) => a + b, 0)]));
  if (afterCeiling) {
    for (const p of players) {
      const arr = credits.get(p.playerId)!;
      for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(arr[i]! * p.trustWeight);
    }
  }

  // Memory for the next days.
  for (const p of players) {
    if (R.kind === "unscored_identical") {
      const q = p.sessions.filter((s) => sessionQualifies(econ, s.minutes, s.meters));
      if (q.length > 0) {
        const hist = state.qualifyingDayUnits.get(p.playerId) ?? [];
        hist.push(new Set(q.flatMap((s) => s.stepped)));
        if (hist.length > R.days) hist.shift();
        state.qualifyingDayUnits.set(p.playerId, hist);
      }
    }
    if (R.kind === "marginal_taper") {
      const hist = (state.scoredFingerprints.get(p.playerId) ?? []).filter((h) => day - h.day < rs.fingerprint.retentionDays);
      for (const i of scored.get(p.playerId)!) hist.push({ day, fp: fps.get(p.playerId)![i]! });
      state.scoredFingerprints.set(p.playerId, hist);
    }
  }

  const out: RouteDayPlayerResult[] = v3.players.map((r) => {
    const arr = credits.get(r.playerId)!;
    const before = v3Credits.get(r.playerId)!;
    return {
      playerId: r.playerId,
      sessionCreditsMicro: arr,
      dayCreditsMicro: arr.reduce((a, b) => a + b, 0),
      v3DayRewardMicro: r.dayRewardMicro,
      unscoredByRule: unscoredMarks.get(r.playerId)!.filter(Boolean).length,
      reducedByRule: arr.filter((v, i) => v < before[i]!).length,
    };
  });
  const credited = out.reduce((a, r) => a + r.dayCreditsMicro, 0);
  const minted = v3.books.mintedMicro;
  const preTrust = [...beforeTrust.values()].reduce((a, b) => a + b, 0);
  // Reconciliation: the V3 books close, the rule never pays more than V3
  // minted for any session, every ceiling holds, and pool = credited + returned.
  const problems = dayBooksProblems(econ, v3).map((x) => `v3: ${x}`);
  for (const r of out) {
    const before = v3Credits.get(r.playerId)!;
    if (r.sessionCreditsMicro.some((v, i) => v < 0 || v > before[i]!)) problems.push(`${r.playerId}: a session paid more than V3 minted, or below zero`);
    if (r.sessionCreditsMicro.some((v) => v > econ.sessionCeilingMicro)) problems.push(`${r.playerId}: over the session ceiling`);
    if (r.dayCreditsMicro > econ.dayCeilingMicro) problems.push(`${r.playerId}: over the day ceiling`);
  }
  if (credited > minted || minted > poolMicro) problems.push("credited more than minted, or minted more than the pool");
  if (poolMicro - credited < 0) problems.push("returned below zero");
  return {
    poolMicro,
    creditedMicro: credited,
    returnedMicro: poolMicro - credited,
    withheldByRuleMicro: minted - credited,
    withheldByTrustMicro: preTrust - credited,
    problems,
    v3,
    players: out,
  };
}
