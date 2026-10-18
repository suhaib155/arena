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
  | { kind: "linked_identical_as_one"; similarity: number };

export interface RouteCreditRuleset {
  /** "sim-route-" prefix marks a simulation rule. */
  name: string;
  version: number;
  status: typeof SIM_ONLY;
  fingerprint: RouteFingerprintSpec;
  rule: RouteCreditRule;
}

/** PILOT fingerprint: 32-slot MinHash over 201 m parent zones, kept 14 days. */
export const ROUTE_FINGERPRINT_PILOT: Readonly<RouteFingerprintSpec> = Object.freeze({
  kind: "minhash_parents",
  parentEdgeMeters: 201,
  hashes: 32,
  retentionDays: 14,
  salt: "sim-season-1",
});

const ruleset = (name: string, rule: RouteCreditRule, version = 1): Readonly<RouteCreditRuleset> =>
  Object.freeze({ name, version, status: SIM_ONLY, fingerprint: ROUTE_FINGERPRINT_PILOT, rule: Object.freeze(rule) });

export const ROUTE_BASELINE = ruleset("sim-route-baseline", { kind: "none" });
export const REPEAT_ROUTE_UNSCORED_3 = ruleset("sim-route-repeat-route-unscored-3", { kind: "unscored_identical", days: 3 });
/** Free for 14 matching scoring sessions a week (two a day), then −15% per further match, never below 25%. */
export const ROUTE_TAPER_14 = ruleset("sim-route-taper-14", { kind: "marginal_taper", windowDays: 7, similarity: 0.8, freeRepeats: 14, stepPerRepeat: 0.15, floor: 0.25 });
export const ROUTE_TAPER_10 = ruleset("sim-route-taper-10", { kind: "marginal_taper", windowDays: 7, similarity: 0.8, freeRepeats: 10, stepPerRepeat: 0.15, floor: 0.25 });
export const ROUTE_TAPER_6 = ruleset("sim-route-taper-6", { kind: "marginal_taper", windowDays: 7, similarity: 0.8, freeRepeats: 6, stepPerRepeat: 0.15, floor: 0.25 });
export const ROUTE_DAILY_BOUND = ruleset("sim-route-identical-daily-bound", { kind: "identical_daily_bound", similarity: 0.8, boundMicro: 12_000_000 });
export const ROUTE_LINKED_AS_ONE = ruleset("sim-route-linked-identical-as-one", { kind: "linked_identical_as_one", similarity: 0.8 });
export const ROUTE_LINKED_AS_ONE_06 = ruleset("sim-route-linked-identical-as-one-0.6", { kind: "linked_identical_as_one", similarity: 0.6 });

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
  }
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
  /** Withheld by the rule after V3 settled (comparators 3–5), back to the season pool. */
  withheldByRuleMicro: number;
  v3: DaySettlement;
  players: RouteDayPlayerResult[];
}

/** The per-walker memory a rule keeps between days: fingerprints only, except comparator 2's unit sets. */
export class RouteCreditState {
  readonly qualifyingDayUnits = new Map<string, Set<string>[]>();
  readonly scoredFingerprints = new Map<string, { day: number; fp: RouteFingerprint }[]>();
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
  const v3 = settleDay(econ, { poolMicro, players: inputs, deedOwnerByCell: new Map() });

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
  return { poolMicro, creditedMicro: credited, returnedMicro: poolMicro - credited, withheldByRuleMicro: minted - credited, v3, players: out };
}
