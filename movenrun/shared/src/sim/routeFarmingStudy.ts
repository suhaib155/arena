/**
 * The route-farming study: the same synthetic season settled under several
 * route credit rules (`routeCredit.ts`), with the same seeds, populations,
 * trust weights and activity, so the only difference between rows is the
 * rule. See `docs/SIM_ROUTE_FARMING_STUDY.md`.
 *
 * SIMULATION ONLY: synthetic populations on a synthetic grid, not real users.
 * Credits are settled by the V3 reference model (`settleDay`, economy rules
 * version 1, unchanged). Territory runs through the holding ledger with
 * sim-pilot-2's holding rules (76 m units). XP, streak and achievements are
 * simulator-side tallies of verified movement (the reference models have no
 * XP), computed from the same sessions every rule receives.
 */

import { economyRulesFor, dailyPoolMicro, MICRO_PER_MOVE } from "../domain/economyV3";
import type { UnitState } from "../domain/holding";
import { applyLedger, type PushEvent } from "../domain/holdingLedger";
import { SIM_PILOT_2 } from "./pilotRuleset";
import {
  REPEAT_ROUTE_UNSCORED_3,
  ROUTE_CANDIDATE,
  ROUTE_CANDIDATE_3,
  ROUTE_CANDIDATE_K2,
  ROUTE_CLUSTER_K1,
  ROUTE_CLUSTER_K2,
  ROUTE_CLUSTER_K3,
  ROUTE_REVIEW_3PLUS,
  ROUTE_REVIEW_ALL,
  ROUTE_SOFT_CEILING,
  ROUTE_TAPER_12,
  ROUTE_TRUST_AFTER,
  ROUTE_BASELINE,
  ROUTE_DAILY_BOUND,
  ROUTE_LINKED_AS_ONE,
  ROUTE_LINKED_AS_ONE_06,
  ROUTE_TAPER_10,
  ROUTE_TAPER_14,
  ROUTE_TAPER_6,
  RouteCreditState,
  routeRuleProblems,
  settleRouteDay,
  type RouteCreditRuleset,
  type RouteDayPlayer,
  type RouteSession,
} from "./routeCredit";
import { agg } from "./sweeps";
import { axialFromMeters, hash32, keyed, unitId } from "./world";

/* ── populations (ASSUMPTION: synthetic behaviour, not measurements) ──────── */

export type RoutePopulation =
  | "commuter"
  | "rural"
  | "low_mobility"
  | "laps_runner"
  | "park_walker"
  | "gps_jitter"
  | "household"
  | "route_farmer"
  | "spoofer"
  | "colluder"
  | "exercise_loop"
  | "accessible_loop"
  | "family"
  | "colluder_pair";

export const ROUTE_POPULATIONS: readonly RoutePopulation[] = ["commuter", "rural", "low_mobility", "laps_runner", "park_walker", "gps_jitter", "household", "route_farmer", "spoofer", "colluder", "exercise_loop", "accessible_loop", "family", "colluder_pair"];
export const HONEST: readonly RoutePopulation[] = ["commuter", "rural", "low_mobility", "laps_runner", "park_walker", "gps_jitter", "household", "exercise_loop", "accessible_loop", "family"];

/** Honest populations grouped the way the owner asked for false-positive rates. */
export const HONEST_GROUPS: Readonly<Record<string, readonly RoutePopulation[]>> = Object.freeze({
  commuters: ["commuter"],
  "loop walkers": ["laps_runner", "park_walker", "gps_jitter", "exercise_loop"],
  "accessible loops": ["low_mobility", "accessible_loop"],
  households: ["household", "family"],
  rural: ["rural"],
});
export const EXPLOIT: readonly RoutePopulation[] = ["route_farmer", "spoofer", "colluder", "colluder_pair"];

/** Accounts per population. Households are linked pairs, colluders linked triples carried by one walker. */
export const ROUTE_STUDY_POPULATION: Readonly<Record<RoutePopulation, number>> = Object.freeze({
  commuter: 30,
  rural: 20,
  low_mobility: 20,
  laps_runner: 20,
  park_walker: 25,
  gps_jitter: 20,
  household: 20,
  route_farmer: 15,
  spoofer: 10,
  colluder: 15,
  exercise_loop: 0,
  accessible_loop: 0,
  family: 0,
  colluder_pair: 0,
});

/**
 * Second-round population: the first round's plus three explicit honest
 * repeat populations (same 3 km exercise loop, a short wheelchair /
 * limited-mobility loop, linked families of three) and one exploit (one
 * walker carrying two linked phones, the gap a household allowance of two
 * leaves open). The first round's
 * accounts are generated identically (same keys), so only these are added.
 */
export const ROUTE_STUDY_POPULATION_2: Readonly<Record<RoutePopulation, number>> = Object.freeze({
  ...ROUTE_STUDY_POPULATION,
  exercise_loop: 20,
  accessible_loop: 20,
  family: 18,
  colluder_pair: 10,
});

/** Accounts per physical walker: colluders carry three linked phones; a household is two people. */
export const ACCOUNTS_PER_WALKER: Readonly<Record<RoutePopulation, number>> = Object.freeze({
  commuter: 1, rural: 1, low_mobility: 1, laps_runner: 1, park_walker: 1, gps_jitter: 1, household: 1, route_farmer: 1, spoofer: 1, colluder: 3, exercise_loop: 1, accessible_loop: 1, family: 1, colluder_pair: 2,
});

/** Trust weights (SOURCE §17 slot, values ASSUMPTION), identical under every rule. */
export const ROUTE_TRUST: Readonly<Record<RoutePopulation, number>> = Object.freeze({
  commuter: 1, rural: 1, low_mobility: 1, laps_runner: 1, park_walker: 1, gps_jitter: 1, household: 1, route_farmer: 1, spoofer: 0.5, colluder: 1, exercise_loop: 1, accessible_loop: 1, family: 1, colluder_pair: 1,
});

type Pt = [number, number];

interface Account {
  id: string;
  pop: RoutePopulation;
  linked: string[];
  /** Leader id for a linked group that moves together (household, colluder), else own id. */
  mover: string;
  home: Pt;
  /** Fixed routes this account repeats (metres), by name. */
  routes: Record<string, Pt[]>;
  gpsSigma: number;
}

const ring = (c: Pt, r: number, n: number, phase = 0): Pt[] => {
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = phase + (2 * Math.PI * i) / n;
    pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
  }
  return pts;
};
const rect = (c: Pt, w: number, h: number): Pt[] => [
  [c[0], c[1]],
  [c[0] + w, c[1]],
  [c[0] + w, c[1] + h],
  [c[0], c[1] + h],
  [c[0], c[1]],
];
function randomLoop(g: () => number, c: Pt, radius: number): Pt[] {
  const n = 4 + Math.floor(g() * 3);
  const angles = Array.from({ length: n }, () => g() * 2 * Math.PI).sort((a, b) => a - b);
  const pts: Pt[] = [c, ...angles.map((a): Pt => { const r = radius * (0.4 + 0.6 * g()); return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]; }), c];
  return pts;
}
const lengthOf = (pts: Pt[]) => pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - pts[i]![0], p[1] - pts[i]![1]), 0);

function gauss(g: () => number): number {
  const u = Math.max(1e-12, g());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * g());
}

const UNIT_SPACING = Math.sqrt(3) * SIM_PILOT_2.unitEdgeMeters;

/** Samples the route every 15 m with GPS noise and returns the distinct units stepped, in order. */
function stepUnits(pts: Pt[], sigma: number, g: () => number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]!;
    const [bx, by] = pts[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 15));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const x = ax + (bx - ax) * t + (sigma > 0 ? sigma * gauss(g) : 0);
      const y = ay + (by - ay) * t + (sigma > 0 ? sigma * gauss(g) : 0);
      const [q, r] = axialFromMeters(x, y, UNIT_SPACING);
      const id = unitId(q, r);
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out;
}

/** The coarse parent zone (201 m scale) a unit's centre falls in, as the churn study's D5 zones. */
export function parentZoneOf(unit: string, parentEdgeMeters: number): string {
  const m = /^u(-?\d+)_(-?\d+)$/.exec(unit)!;
  const q = Number(m[1]);
  const r = Number(m[2]);
  const x = UNIT_SPACING * (q + r / 2);
  const y = UNIT_SPACING * (Math.sqrt(3) / 2) * r;
  const [zq, zr] = axialFromMeters(x, y, Math.sqrt(3) * parentEdgeMeters);
  return `z${zq}_${zr}`;
}

function buildAccounts(seed: number, spec: Readonly<Record<RoutePopulation, number>>): Account[] {
  const out: Account[] = [];
  for (const pop of ROUTE_POPULATIONS) {
    const group = pop === "colluder" || pop === "family" ? 3 : pop === "household" || pop === "colluder_pair" ? 2 : 1;
    for (let i = 0; i < spec[pop]; i += group) {
      const g = keyed(seed, "route-account", pop, i);
      const a = g() * 2 * Math.PI;
      const d = Math.sqrt(g()) * 5000;
      const home: Pt = [d * Math.cos(a), d * Math.sin(a)];
      const routes: Record<string, Pt[]> = {};
      let sigma = 6;
      if (pop === "commuter") {
        const ang = g() * 2 * Math.PI;
        const dist = 1800 + g() * 1400;
        const work: Pt = [home[0] + dist * Math.cos(ang), home[1] + dist * Math.sin(ang)];
        const bend: Pt = g() < 0.5 ? [work[0], home[1]] : [home[0], work[1]];
        routes.out = [home, bend, work];
        routes.back = [work, bend, home];
      } else if (pop === "rural") {
        const ang = g() * 2 * Math.PI;
        const len = 2000 + g() * 1000;
        const far: Pt = [home[0] + len * Math.cos(ang), home[1] + len * Math.sin(ang)];
        const other: Pt = [home[0] - len * Math.cos(ang), home[1] - len * Math.sin(ang)];
        routes.main = [home, far, home];
        routes.other = [home, other, home];
        sigma = 8;
      } else if (pop === "low_mobility") {
        routes.block = rect(home, 200 + g() * 30, 190 + g() * 20);
      } else if (pop === "laps_runner") {
        const track: Pt = [home[0] + 300, home[1]];
        routes.track = Array.from({ length: 11 }, () => ring(track, 64, 12)).flat();
      } else if (pop === "park_walker") {
        routes.park = [[home[0] + 400, home[1]]];
      } else if (pop === "gps_jitter") {
        routes.dog = randomLoop(g, home, 450);
        sigma = 35;
      } else if (pop === "route_farmer") {
        routes.farm = rect(home, 200, 190);
      } else if (pop === "spoofer") {
        routes.replay = randomLoop(g, home, 260);
        sigma = i % 2 === 0 ? 0 : 10;
        // Odd spoofers evade exact matching: each replay is shifted by up to 80 m and noised.
        if (i % 2 === 1) routes.evade = [[1, 1]];
      } else if (pop === "exercise_loop") {
        routes.loop = randomLoop(g, home, 550);
      } else if (pop === "accessible_loop") {
        // A short step-free loop (wheelchair or limited mobility): 760–800 m at 55 m/min, just over §2's minimum.
        routes.loop = rect(home, 190 + g() * 10, 190 + g() * 10);
      } else if (pop === "family") {
        routes.usual = randomLoop(g, home, 600);
      }
      const ids = Array.from({ length: Math.min(group, spec[pop] - i) }, (_, k) => `${pop}-${String(i + k + 1).padStart(3, "0")}`);
      for (const id of ids) out.push({ id, pop, linked: ids.filter((x) => x !== id), mover: ids[0]!, home, routes, gpsSigma: sigma });
    }
  }
  return out;
}

interface PlannedRoute {
  pts: Pt[];
  /** Verified metres per minute. */
  pace: number;
}

/** Who plans an account's day: a colluder's carrier always; a household walks together on 70% of days. */
function plannerOf(acc: Account, day: number, seed: number): string {
  if (acc.pop === "colluder" || acc.pop === "colluder_pair") return acc.mover;
  if (acc.pop === "household") return keyed(seed, "together", day, acc.mover)() < 0.7 ? acc.mover : acc.id;
  if (acc.pop === "family") return keyed(seed, "together", day, acc.mover)() < 0.6 ? acc.mover : acc.id;
  return acc.id;
}

/** One planner's routes for a day (shared by a linked group that moves together). */
function planDay(acc: Account, day: number, seed: number, planner: string): PlannedRoute[] {
  const g = keyed(seed, "route-day", day, planner);
  const weekday = day % 7 < 5;
  const r = acc.routes;
  switch (acc.pop) {
    case "commuter":
      if (weekday) return g() < 0.92 ? [{ pts: r.out!, pace: 80 }, { pts: r.back!, pace: 80 }] : [];
      return g() < 0.35 ? [{ pts: randomLoop(g, acc.home, 900), pace: 75 }] : [];
    case "rural":
      if (g() >= 0.85) return [];
      return [{ pts: g() < 0.8 ? r.main! : r.other!, pace: 85 }];
    case "low_mobility": {
      if (g() >= 0.9) return [];
      return g() < 0.8 ? [{ pts: r.block!, pace: 60 }, { pts: r.block!, pace: 60 }] : [{ pts: r.block!, pace: 60 }];
    }
    case "laps_runner":
      if (g() >= (weekday ? 0.75 : 0.5)) return [];
      return g() < 0.8 ? [{ pts: r.track!, pace: 200 }] : [{ pts: randomLoop(g, acc.home, 1200), pace: 180 }];
    case "park_walker": {
      if (g() >= 0.7) return [];
      const one = { pts: randomLoop(g, r.park![0]!, 500), pace: 75 };
      return g() < 0.2 ? [one, { pts: randomLoop(g, r.park![0]!, 500), pace: 75 }] : [one];
    }
    case "gps_jitter":
      if (g() >= 0.85) return [];
      return g() < 0.3 ? [{ pts: r.dog!, pace: 80 }, { pts: r.dog!, pace: 80 }] : [{ pts: r.dog!, pace: 80 }];
    case "household":
      if (g() >= 0.6) return [];
      return [{ pts: randomLoop(g, acc.home, 600), pace: 75 }];
    case "route_farmer":
      // The minimum qualifying loop (SOURCE §2: 10 min, 750 m), three times a day.
      return g() < 0.98 ? [0, 1, 2].map(() => ({ pts: r.farm!, pace: 72 })) : [];
    case "spoofer":
      return [0, 1, 2].map(() => {
        if (!r.evade) return { pts: r.replay!, pace: 90 };
        const dx = (g() - 0.5) * 160;
        const dy = (g() - 0.5) * 160;
        return { pts: r.replay!.map(([x, y]): Pt => [x + dx, y + dy]), pace: 90 };
      });
    case "colluder":
    case "colluder_pair": {
      if (g() >= 0.9) return [];
      return [0, 1].map(() => ({ pts: randomLoop(g, acc.home, 700), pace: 80 }));
    }
    case "exercise_loop":
      // The same neighbourhood loop, most days; one day in four twice (morning and evening).
      if (g() >= 0.8) return [];
      return g() < 0.25 ? [{ pts: r.loop!, pace: 110 }, { pts: r.loop!, pace: 110 }] : [{ pts: r.loop!, pace: 110 }];
    case "accessible_loop": {
      if (g() >= 0.9) return [];
      const x = g();
      const n = x < 0.4 ? 3 : x < 0.8 ? 2 : 1;
      return Array.from({ length: n }, () => ({ pts: r.loop!, pace: 55 }));
    }
    case "family":
      if (planner === acc.mover) {
        // Together: their usual loop or a new one.
        if (g() >= 0.65) return [];
        return [{ pts: g() < 0.6 ? r.usual! : randomLoop(g, acc.home, 600), pace: 70 }];
      }
      // Apart: half the time each walks the usual loop alone, at their own time.
      return g() < 0.5 ? [{ pts: r.usual!, pace: 75 }] : [];
  }
}

/* ── one season ───────────────────────────────────────────────────────────── */

export type PoolRegime = "launch" | "binding";

export interface RouteStudyOptions {
  seed: number;
  rule: RouteCreditRuleset;
  population?: Readonly<Record<RoutePopulation, number>>;
  days?: number;
  /** "launch": V3's season-one daily pool (ceilings bind). "binding": the pool scaled to 8 credits per account, as if far more players shared it. */
  regime?: PoolRegime;
  /** Run the holding ledger for territory (slower). Default true. */
  territory?: boolean;
  /** Trust weight overrides by population (sensitivity runs); default `ROUTE_TRUST`. */
  trust?: Partial<Record<RoutePopulation, number>>;
  /** Reviewer model for review flags (ASSUMPTION); default `assumedReviewer`. */
  reviewer?: ReviewerModel;
}

/** ASSUMPTION: how often a human reviewer upholds a flag, by what the flagged group really is. */
export interface ReviewerModel {
  /** One walker carrying several linked accounts. */
  upholdColluder: number;
  /** Real people walking together (households, families). */
  upholdGenuine: number;
}
export const ASSUMED_REVIEWER: Readonly<ReviewerModel> = Object.freeze({ upholdColluder: 0.9, upholdGenuine: 0.05 });

export interface MovementTally {
  sessions: number;
  verifiedMinutes: number;
  verifiedMeters: number;
  /** Simulator XP: one per verified minute (ASSUMPTION; XP is not in the reference models). */
  xp: number;
  activeDays: number;
  longestStreak: number;
  /** Achievements: 10/50/100/250 km of verified distance, 7- and 30-day streaks. */
  achievements: number;
}

export interface RouteStudyResult {
  rule: string;
  seed: number;
  regime: PoolRegime;
  days: number;
  accounts: number;
  creditsByAccount: Record<string, number>;
  popOf: Record<string, RoutePopulation>;
  movement: Record<string, MovementTally>;
  /** Per population: sessions settled unscored by the rule and scoring sessions it reduced, as a share of that population's sessions. */
  unscoredShare: Record<RoutePopulation, number>;
  reducedShare: Record<RoutePopulation, number>;
  territory: { fingerprint: string; claimed: number; reinforced: number; eroded: number; flipped: number; refused: number } | null;
  books: { pool: number; credited: number; returned: number; withheld: number; ok: boolean };
  /** Credits settled each day. A rule only ever acts on the day being settled: earlier days never change. */
  dailyCreditedMicro: number[];
  /** Accounts ever flagged for review, and those whose review was upheld (review rules only). */
  flagged: string[];
  upheld: string[];
  reviewCount: number;
  /** Every day's reconciliation problems (empty when the books close exactly). */
  problems: string[];
}

export function runRouteStudy(opts: RouteStudyOptions): RouteStudyResult {
  const ruleProblems = routeRuleProblems(opts.rule);
  if (ruleProblems.length > 0) throw new RangeError(`route rule ${opts.rule.name}: ${ruleProblems.join("; ")}`);
  const econ = economyRulesFor(SIM_PILOT_2.economyRulesVersion)!;
  const days = opts.days ?? econ.seasonDays;
  const regime = opts.regime ?? "launch";
  const accounts = buildAccounts(opts.seed, opts.population ?? ROUTE_STUDY_POPULATION);
  const pool = regime === "launch" ? dailyPoolMicro(econ, SIM_PILOT_2.season) : accounts.length * 8 * MICRO_PER_MOVE;
  const state = new RouteCreditState();
  const reviewerModel = opts.reviewer ?? ASSUMED_REVIEWER;
  state.reviewer = (ids, day) => {
    const colluding = ids.some((id) => EXPLOIT.includes(popOf[id]!));
    const g = keyed(opts.seed, "review", day, ids.join("+"))();
    return g < (colluding ? reviewerModel.upholdColluder : reviewerModel.upholdGenuine);
  };
  const trustOf = (p: RoutePopulation) => opts.trust?.[p] ?? ROUTE_TRUST[p];
  const problems: string[] = [];
  const credits: Record<string, number> = {};
  const popOf: Record<string, RoutePopulation> = {};
  const movement: Record<string, MovementTally> = {};
  const active = new Map<string, boolean[]>();
  const streak = new Map<string, number>();
  const sessionsByPop = Object.fromEntries(ROUTE_POPULATIONS.map((p) => [p, 0])) as Record<RoutePopulation, number>;
  const unscored = { ...sessionsByPop };
  const reduced = { ...sessionsByPop };
  for (const a of accounts) {
    credits[a.id] = 0;
    popOf[a.id] = a.pop;
    movement[a.id] = { sessions: 0, verifiedMinutes: 0, verifiedMeters: 0, xp: 0, activeDays: 0, longestStreak: 0, achievements: 0 };
    active.set(a.id, []);
    streak.set(a.id, 0);
  }
  let store = new Map<string, UnitState>();
  const terr = { claimed: 0, reinforced: 0, eroded: 0, flipped: 0, refused: 0 };
  const books = { pool: 0, credited: 0, returned: 0, withheld: 0, ok: true };
  const dailyCreditedMicro: number[] = [];

  for (let day = 0; day < days; day++) {
    const plans = new Map<string, PlannedRoute[]>();
    const players: RouteDayPlayer[] = [];
    for (const a of accounts) {
      const planner = plannerOf(a, day, opts.seed);
      const plan = plans.get(planner) ?? planDay(a, day, opts.seed, planner);
      plans.set(planner, plan);
      const gn = keyed(opts.seed, "gps", day, a.id);
      const sessions: RouteSession[] = plan.map((p, si) => {
        const meters = Math.round(lengthOf(p.pts));
        const stepped = stepUnits(p.pts, a.gpsSigma, gn);
        // Start time: shared by a group planned together (own streams, so earlier draws are unchanged), ±3 min per phone.
        const base = 360 + si * 480 + Math.floor(keyed(opts.seed, "start", day, planner, si)() * 420);
        const startMinute = base + Math.round((keyed(opts.seed, "start-jitter", day, a.id, si)() - 0.5) * 6);
        return { minutes: Math.round((meters / p.pace) * 10) / 10, meters, stepped, parents: stepped.map((u) => parentZoneOf(u, opts.rule.fingerprint.parentEdgeMeters)), startMinute };
      });
      const hist = active.get(a.id)!;
      hist.push(sessions.length > 0);
      if (sessions.length === 0) {
        streak.set(a.id, 0);
        continue;
      }
      // Movement tally: every verified session, whatever the rule does with credits.
      const m = movement[a.id]!;
      const before = m.verifiedMeters;
      for (const s of sessions) {
        m.sessions += 1;
        m.verifiedMinutes += s.minutes;
        m.verifiedMeters += s.meters;
        m.xp += Math.floor(s.minutes);
      }
      m.activeDays += 1;
      const st = streak.get(a.id)! + 1;
      streak.set(a.id, st);
      m.longestStreak = Math.max(m.longestStreak, st);
      for (const km of [10, 50, 100, 250]) if (before < km * 1000 && m.verifiedMeters >= km * 1000) m.achievements += 1;
      if (st === 7 || st === 30) m.achievements += 1;
      sessionsByPop[a.pop] += sessions.length;
      players.push({ playerId: a.id, linkedPlayerIds: a.linked, sessions, activeDaysThisWeek: Math.max(1, Math.min(7, hist.slice(-7).filter(Boolean).length)), trustWeight: trustOf(a.pop) });
    }

    const res = settleRouteDay(econ, opts.rule, state, day, pool, players);
    books.pool += res.poolMicro;
    books.credited += res.creditedMicro;
    books.returned += res.returnedMicro;
    books.withheld += res.withheldByRuleMicro;
    dailyCreditedMicro.push(res.creditedMicro);
    if (res.creditedMicro + res.returnedMicro !== res.poolMicro || res.withheldByRuleMicro < 0 || res.creditedMicro > res.v3.books.mintedMicro) books.ok = false;
    if (res.problems.length > 0) {
      books.ok = false;
      problems.push(...res.problems.map((x) => `day ${day}: ${x}`));
    }
    for (const r of res.players) {
      credits[r.playerId] += r.dayCreditsMicro;
      unscored[popOf[r.playerId]!] += r.unscoredByRule;
      reduced[popOf[r.playerId]!] += r.reducedByRule;
    }

    if (opts.territory !== false) {
      // Territory: every stepped unit of every verified session is a solid push, whatever the rule.
      const events: PushEvent[] = [];
      const order = players.map((p) => ({ p, key: hash32(`${opts.seed}:route-order:${day}:${p.playerId}`) })).sort((a, b) => a.key - b.key || (a.p.playerId < b.p.playerId ? -1 : 1));
      for (const { p } of order) p.sessions.forEach((s, si) => s.stepped.forEach((u, k) => events.push({ eventId: `d${String(day).padStart(3, "0")}:${p.playerId}:${si}:${String(k).padStart(4, "0")}`, unitId: u, walkerId: p.playerId, push: { kind: "solid" }, day })));
      const led = applyLedger({ states: store, events, rules: SIM_PILOT_2.holding, createMissing: true });
      store = led.states;
      for (const e of led.entries) {
        if (e.outcome === "claimed") terr.claimed += 1;
        else if (e.outcome === "reinforced") terr.reinforced += 1;
        else if (e.outcome === "eroded") terr.eroded += 1;
        else if (e.outcome === "flipped") terr.flipped += 1;
        else terr.refused += 1;
      }
    }
  }

  const share = (a: Record<RoutePopulation, number>) => Object.fromEntries(ROUTE_POPULATIONS.map((p) => [p, sessionsByPop[p] > 0 ? a[p] / sessionsByPop[p] : 0])) as Record<RoutePopulation, number>;
  let territory: RouteStudyResult["territory"] = null;
  if (opts.territory !== false) {
    const lines = [...store.values()].sort((a, b) => (a.unitId < b.unitId ? -1 : 1)).map((s) => `${s.unitId}:${s.holderId}:${s.strength}:${s.ground}:${s.asOfDay}`);
    territory = { fingerprint: hash32(lines.join("|")).toString(16), ...terr };
  }
  const flagged = [...new Set(state.reviews.flatMap((v) => v.ids))].sort();
  const upheld = [...new Set(state.reviews.filter((v) => v.upheld).flatMap((v) => v.ids))].sort();
  return { rule: opts.rule.name, seed: opts.seed, regime, days, accounts: accounts.length, creditsByAccount: credits, popOf, movement, unscoredShare: share(unscored), reducedShare: share(reduced), territory, books, dailyCreditedMicro, flagged, upheld, reviewCount: state.reviews.length, problems };
}

/* ── the comparison ───────────────────────────────────────────────────────── */

export interface RouteCase {
  comparator: string;
  label: string;
  rule: RouteCreditRuleset;
  /** Trust weight overrides for a sensitivity run (the baseline keeps `ROUTE_TRUST`). */
  trust?: Partial<Record<RoutePopulation, number>>;
}

export function routeFarmingPlan(): RouteCase[] {
  return [
    { comparator: "1", label: "baseline", rule: ROUTE_BASELINE },
    { comparator: "2", label: "repeat-route-unscored-3", rule: REPEAT_ROUTE_UNSCORED_3 },
    { comparator: "3", label: "taper-14", rule: ROUTE_TAPER_14 },
    { comparator: "3", label: "taper-10", rule: ROUTE_TAPER_10 },
    { comparator: "3", label: "taper-6", rule: ROUTE_TAPER_6 },
    { comparator: "4", label: "identical-daily-bound", rule: ROUTE_DAILY_BOUND },
    { comparator: "5", label: "linked-identical-as-one", rule: ROUTE_LINKED_AS_ONE },
    { comparator: "5", label: "linked-identical-as-one-0.6", rule: ROUTE_LINKED_AS_ONE_06 },
  ];
}

/** Season measures of one run against the baseline run of the same seed and regime. */
export interface RouteMeasures {
  /** Mean season credits per account, by population. */
  credits: Record<RoutePopulation, number>;
  /** Mean credits per account ÷ baseline, by population. */
  vsBaseline: Record<RoutePopulation, number>;
  /** Share of a population's accounts earning at least 1% less than under the baseline. */
  penalised: Record<RoutePopulation, number>;
  /** Share of all honest accounts penalised. */
  honestPenalised: number;
  /** Credits per physical walker ÷ honest credits per walker, by exploit population. */
  advantage: Record<RoutePopulation, number>;
  /** Credits per verified hour, by population. */
  perHour: Record<RoutePopulation, number>;
  /** Territory, XP, streak and achievements identical to the baseline run. */
  movementUnchanged: boolean;
  territoryUnchanged: boolean | null;
  unscoredShare: Record<RoutePopulation, number>;
  reducedShare: Record<RoutePopulation, number>;
  booksOk: boolean;
  /** Populations with at least one account in this run. */
  present: RoutePopulation[];
  /** Share of a population's accounts ever flagged for review / with a review upheld. */
  flagged: Record<RoutePopulation, number>;
  upheld: Record<RoutePopulation, number>;
  /** Share of all honest accounts ever flagged for review (a flag never cuts credits by itself). */
  honestFlagged: number;
  /** Reviews opened over the season per 1,000 accounts (reviewer workload). */
  reviewsPer1000: number;
  /** Share of colluding accounts (trios and pairs) whose review was upheld. */
  colludersUpheld: number;
  /** Share of each honest group's accounts penalised, and its credits ÷ baseline. */
  groupPenalised: Record<string, number>;
  groupVsBaseline: Record<string, number>;
}

const byPop = <T>(f: (p: RoutePopulation) => T) => Object.fromEntries(ROUTE_POPULATIONS.map((p) => [p, f(p)])) as Record<RoutePopulation, T>;

export function measure(run: RouteStudyResult, base: RouteStudyResult): RouteMeasures {
  const ids = Object.keys(run.creditsByAccount);
  const of = (p: RoutePopulation) => ids.filter((id) => run.popOf[id] === p);
  const mean = (p: RoutePopulation, r: RouteStudyResult) => {
    const xs = of(p);
    return xs.reduce((a, id) => a + r.creditsByAccount[id]!, 0) / (xs.length || 1) / MICRO_PER_MOVE;
  };
  const credits = byPop((p) => mean(p, run));
  const vsBaseline = byPop((p) => (mean(p, base) > 0 ? credits[p] / mean(p, base) : 1));
  const hit = (id: string) => run.creditsByAccount[id]! < base.creditsByAccount[id]! * 0.99;
  const penalised = byPop((p) => of(p).filter(hit).length / (of(p).length || 1));
  const honestIds = ids.filter((id) => HONEST.includes(run.popOf[id]!));
  const honestPerWalker = honestIds.reduce((a, id) => a + run.creditsByAccount[id]!, 0) / honestIds.length / MICRO_PER_MOVE;
  const advantage = byPop((p) => (honestPerWalker > 0 ? (credits[p] * ACCOUNTS_PER_WALKER[p]) / honestPerWalker : 0));
  const perHour = byPop((p) => {
    const xs = of(p);
    const hours = xs.reduce((a, id) => a + run.movement[id]!.verifiedMinutes, 0) / 60 / ACCOUNTS_PER_WALKER[p];
    return hours > 0 ? (credits[p] * xs.length) / hours : 0;
  });
  const movementUnchanged = JSON.stringify(run.movement) === JSON.stringify(base.movement);
  const territoryUnchanged = run.territory && base.territory ? JSON.stringify(run.territory) === JSON.stringify(base.territory) : null;
  return {
    credits,
    vsBaseline,
    penalised,
    honestPenalised: honestIds.filter(hit).length / honestIds.length,
    advantage,
    perHour,
    movementUnchanged,
    territoryUnchanged,
    unscoredShare: run.unscoredShare,
    reducedShare: run.reducedShare,
    booksOk: run.books.ok,
    present: ROUTE_POPULATIONS.filter((p) => of(p).length > 0),
    flagged: byPop((p) => of(p).filter((id) => run.flagged.includes(id)).length / (of(p).length || 1)),
    upheld: byPop((p) => of(p).filter((id) => run.upheld.includes(id)).length / (of(p).length || 1)),
    honestFlagged: honestIds.filter((id) => run.flagged.includes(id)).length / honestIds.length,
    reviewsPer1000: (run.reviewCount * 1000) / ids.length,
    colludersUpheld: (() => {
      const xs = ids.filter((id) => run.popOf[id] === "colluder" || run.popOf[id] === "colluder_pair");
      return xs.length ? xs.filter((id) => run.upheld.includes(id)).length / xs.length : 0;
    })(),
    ...(() => {
      const groupPenalised: Record<string, number> = {};
      const groupVsBaseline: Record<string, number> = {};
      for (const [g, pops] of Object.entries(HONEST_GROUPS)) {
        const xs = ids.filter((id) => pops.includes(run.popOf[id]!));
        if (xs.length === 0) continue;
        groupPenalised[g] = xs.filter(hit).length / xs.length;
        const b = xs.reduce((a, id) => a + base.creditsByAccount[id]!, 0);
        groupVsBaseline[g] = b > 0 ? xs.reduce((a, id) => a + run.creditsByAccount[id]!, 0) / b : 1;
      }
      return { groupPenalised, groupVsBaseline };
    })(),
  };
}

export interface RouteCaseResult {
  comparator: string;
  label: string;
  rule: string;
  regime: PoolRegime;
  measures: RouteMeasures[];
}

export function runRouteFarmingStudy(opts: {
  seeds: number[];
  regimes?: PoolRegime[];
  cases?: RouteCase[];
  days?: number;
  population?: Readonly<Record<RoutePopulation, number>>;
  /** Run the holding ledger in the launch regime (default true). */
  territory?: boolean;
  onRun?: (label: string, seed: number, regime: PoolRegime, ms: number) => void;
}): RouteCaseResult[] {
  const cases = opts.cases ?? routeFarmingPlan();
  const out: RouteCaseResult[] = [];
  for (const regime of opts.regimes ?? ["launch", "binding"]) {
    const bases = new Map<number, RouteStudyResult>();
    const runs = new Map<string, RouteMeasures[]>(cases.map((c) => [c.label, []]));
    for (const seed of opts.seeds) {
      const territory = regime === "launch" && opts.territory !== false;
      const population = opts.population;
      const t0 = Date.now();
      const base = runRouteStudy({ seed, rule: ROUTE_BASELINE, regime, territory, days: opts.days, population });
      opts.onRun?.("baseline", seed, regime, Date.now() - t0);
      bases.set(seed, base);
      for (const c of cases) {
        const t = Date.now();
        const same = c.rule === ROUTE_BASELINE && !c.trust;
        const r = same ? base : runRouteStudy({ seed, rule: c.rule, regime, territory, days: opts.days, population, trust: c.trust });
        if (!same) opts.onRun?.(c.label, seed, regime, Date.now() - t);
        runs.get(c.label)!.push(measure(r, base));
      }
    }
    for (const c of cases) out.push({ comparator: c.comparator, label: c.label, rule: c.rule.name, regime, measures: runs.get(c.label)! });
  }
  return out;
}

/* ── tables ───────────────────────────────────────────────────────────────── */

const cell = (xs: number[], d: number, pct = false) => {
  const a = agg(xs);
  const f = (n: number) => (pct ? `${(n * 100).toFixed(d)}%` : n.toFixed(d));
  return a.min === a.max ? f(a.mean) : `${f(a.mean)} (${f(a.min)}–${f(a.max)})`;
};

/** Credits per account, % of baseline (seed range), and share penalised, one row per comparator, one column per population. */
export function populationTable(results: readonly RouteCaseResult[], regime: PoolRegime, what: "vsBaseline" | "penalised" | "credits" | "perHour" | "unscoredShare" | "reducedShare" | "flagged" | "upheld"): string {
  const rows = results.filter((r) => r.regime === regime);
  const pops = ROUTE_POPULATIONS.filter((p) => rows.some((r) => r.measures.some((m) => m.present.includes(p))));
  const head = ["#", "rule", ...pops];
  const lines = [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`];
  const pct = what !== "credits" && what !== "perHour";
  const digits = what === "credits" ? 0 : what === "perHour" ? 1 : 0;
  for (const r of rows) lines.push(`| ${[r.comparator, r.label, ...pops.map((p) => cell(r.measures.map((m) => m[what][p]), digits, pct))].join(" | ")} |`);
  return lines.join("\n");
}

export function summaryTable(results: readonly RouteCaseResult[], regime: PoolRegime): string {
  const rows = results.filter((r) => r.regime === regime);
  const head = ["#", "rule", "honest penalised", "farmer adv. ×", "spoofer adv. ×", "colluder adv. × (per walker)", "territory unchanged", "XP/streak/achievements unchanged", "books"];
  const lines = [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`];
  for (const r of rows) {
    const t = r.measures.map((m) => m.territoryUnchanged);
    lines.push(
      `| ${[
        r.comparator,
        r.label,
        cell(r.measures.map((m) => m.honestPenalised), 1, true),
        cell(r.measures.map((m) => m.advantage.route_farmer), 2),
        cell(r.measures.map((m) => m.advantage.spoofer), 2),
        cell(r.measures.map((m) => m.advantage.colluder), 2),
        t.every((x) => x === null) ? "n/a" : t.every((x) => x === true) ? "yes" : "NO",
        r.measures.every((m) => m.movementUnchanged) ? "yes" : "NO",
        r.measures.every((m) => m.booksOk) ? "ok" : "FAIL",
      ].join(" | ")} |`,
    );
  }
  return lines.join("\n");
}

/* ── second round: less punitive alternatives ─────────────────────────────── */

/**
 * The second-round comparison, run on `ROUTE_STUDY_POPULATION_2`. Every
 * case changes credits only; the minimum session (SOURCE §2: 10 min,
 * 750 m) is unchanged throughout.
 */
export function routeAlternativesPlan(): RouteCase[] {
  return [
    { comparator: "1", label: "baseline", rule: ROUTE_BASELINE },
    { comparator: "3", label: "taper-10", rule: ROUTE_TAPER_10 },
    { comparator: "3", label: "taper-12", rule: ROUTE_TAPER_12 },
    { comparator: "3", label: "taper-14", rule: ROUTE_TAPER_14 },
    { comparator: "A", label: "soft-ceiling-100w", rule: ROUTE_SOFT_CEILING },
    { comparator: "5", label: "linked-identical-as-one", rule: ROUTE_LINKED_AS_ONE },
    { comparator: "B", label: "cluster-together-k1", rule: ROUTE_CLUSTER_K1 },
    { comparator: "B", label: "cluster-together-k2", rule: ROUTE_CLUSTER_K2 },
    { comparator: "B", label: "cluster-together-k3", rule: ROUTE_CLUSTER_K3 },
    { comparator: "C", label: "review-flag-2plus", rule: ROUTE_REVIEW_ALL },
    { comparator: "C", label: "review-flag-3plus", rule: ROUTE_REVIEW_3PLUS },
    { comparator: "T", label: "trust-after-ceiling", rule: ROUTE_TRUST_AFTER },
    { comparator: "T", label: "spoofer-trust-0.25-before", rule: ROUTE_BASELINE, trust: { spoofer: 0.25 } },
    { comparator: "T", label: "spoofer-trust-0.25-after", rule: ROUTE_TRUST_AFTER, trust: { spoofer: 0.25 } },
    { comparator: "T", label: "spoofer-trust-0.75-after", rule: ROUTE_TRUST_AFTER, trust: { spoofer: 0.75 } },
    { comparator: "★", label: "candidate-review2-trust-after", rule: ROUTE_CANDIDATE },
    { comparator: "★", label: "candidate-review3-trust-after", rule: ROUTE_CANDIDATE_3 },
    { comparator: "★", label: "k2-review3-trust-after", rule: ROUTE_CANDIDATE_K2 },
  ];
}

/** Student t, two-sided 95%, by degrees of freedom (1–30); 1.96 beyond. */
const T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];

/** Mean, 95% confidence half-width across seeds (t distribution), min and max. Seeds are the unit of replication. */
export function ci95(xs: readonly number[]): { mean: number; half: number; min: number; max: number; n: number } {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / (n || 1);
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1)) : 0;
  const t = n > 1 ? (T95[n - 2] ?? 1.96) : 0;
  return { mean, half: (t * sd) / Math.sqrt(n || 1), min: Math.min(...xs), max: Math.max(...xs), n };
}

const ciCell = (xs: number[], d: number, pct = false) => {
  const c = ci95(xs);
  const f = (n: number) => (pct ? `${(n * 100).toFixed(d)}%` : n.toFixed(d));
  return c.half === 0 && c.min === c.max ? f(c.mean) : `${f(c.mean)} ± ${pct ? (c.half * 100).toFixed(d) : c.half.toFixed(d)} [${f(c.min)}–${f(c.max)}]`;
};

/** One row per case: false positives by honest group, household loss, exploit multipliers, flags, checks. Mean ± 95% CI [seed range]. */
export function alternativesTable(results: readonly RouteCaseResult[], regime: PoolRegime): string {
  const rows = results.filter((r) => r.regime === regime);
  const head = ["#", "rule", "honest penalised", "commuters", "loop walkers", "accessible loops", "households penalised", "household credits vs baseline", "colluder trio × (per walker)", "colluder pair × (per walker)", "spoofer ×", "farmer ×", "honest flagged", "colluders upheld", "reviews / 1,000 accounts", "movement unchanged", "books"];
  const lines = [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`];
  for (const r of rows) {
    const M = r.measures;
    const honestFlag = M.map((m) => m.honestFlagged);
    lines.push(
      `| ${[
        r.comparator,
        r.label,
        ciCell(M.map((m) => m.honestPenalised), 1, true),
        ciCell(M.map((m) => m.groupPenalised.commuters ?? 0), 1, true),
        ciCell(M.map((m) => m.groupPenalised["loop walkers"] ?? 0), 1, true),
        ciCell(M.map((m) => m.groupPenalised["accessible loops"] ?? 0), 1, true),
        ciCell(M.map((m) => m.groupPenalised.households ?? 0), 1, true),
        ciCell(M.map((m) => m.groupVsBaseline.households ?? 1), 1, true),
        ciCell(M.map((m) => m.advantage.colluder), 2),
        ciCell(M.map((m) => m.advantage.colluder_pair), 2),
        ciCell(M.map((m) => m.advantage.spoofer), 2),
        ciCell(M.map((m) => m.advantage.route_farmer), 2),
        ciCell(honestFlag, 1, true),
        ciCell(M.map((m) => m.colludersUpheld), 0, true),
        ciCell(M.map((m) => m.reviewsPer1000), 1),
        M.every((m) => m.movementUnchanged && m.territoryUnchanged !== false) ? "yes" : "NO",
        M.every((m) => m.booksOk) ? "exact" : "FAIL",
      ].join(" | ")} |`,
    );
  }
  return lines.join("\n");
}
