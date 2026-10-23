/**
 * SIMULATION ONLY. Group-level fairness of rule sets 1001 and 1002 on the
 * same synthetic verified walks, by cohort. It extends the same-seed
 * comparison in `compare.ts`: the same sessions are fed to each rule set, 1001
 * gets the resolution 8 cells the movement pipeline stores
 * (`cellsForObservations`), 1002 gets its canonical resolution 10 session path
 * (`deriveSessionPath`), and both run through the server's own ledger step
 * (`applyServerLedger`) with their own holding rules, take budget, walk order
 * and second-push gap. The server's per-walker daily unit budget (a capacity
 * guard, 300 by default, not part of any rule set) is applied to both, as the
 * service applies it, and so is day close (a session received after midnight
 * plus the 2 hour grace of its day is refused, `day_closed`).
 *
 * Cohorts (synthetic behaviour assumptions, not observations): casual
 * commuters, loop walkers, long-distance walkers, hostile walkers, GPS
 * spoofers (fabricated traces that pass verification, including a session
 * backdated inside the grace to straddle midnight), household-linked honest
 * co-walkers, and walkers with GPS gaps and late (offline) uploads.
 *
 * It also replays the appealable review candidate of the route-farming study
 * (`review-flag-2plus`): a linked group of 2 or more accounts walking
 * together (zone sets with Jaccard similarity at least 0.8, starts within 20
 * minutes) on 4 days in a trailing 14 opens a review. The only linked groups
 * here are honest co-walker households, so every flag is a false positive by
 * construction. The review is a credit-side candidate: no sanction exists in
 * the server and none is approved; credits are not simulated here, so only
 * the flag and appeal burden is reported.
 *
 * Nothing here changes a rule set or its digest, and nothing here is evidence
 * about real players, real retention or real fairness.
 */
import { cellToParent, getHexagonAreaAvg } from "h3-js";
import { cellsForObservations } from "@movenrun/shared/h3";
import { decayTo, newUnit, stageOf, type UnitState } from "@movenrun/shared/holding";
import type { PushEvent } from "@movenrun/shared/holdingLedger";
import { DEFAULT_UNIT_BUDGET } from "./capacity.js";
import { applyServerLedger } from "./policy.js";
import { deriveSessionPath, pushUnitsOf, type PathFix } from "./path.js";
import { DAY_MS, PILOT_PROPOSAL, SIM_PILOT_2_PROPOSAL, type GameplayRules } from "./rules.js";

type Rules = Omit<GameplayRules, "seasonOneStartDay">;
const H = 3_600_000;
const P2 = SIM_PILOT_2_PROPOSAL.takeover;
/** Flips completed sooner than 1002's second-push gap count as straddles, under either rule set. */
const STRADDLE_MS = P2.name === "two-day-challenge" && P2.policyVersion === 2 ? P2.secondPush.minElapsedMs : 20 * H;
const MIN = 60_000;
const EARTH_RADIUS_M = 6_371_000;
const DEG = Math.PI / 180;
/** Walking speed and fix spacing of every synthetic trace: 1.4 m/s, a fix every 10 s. */
const SPEED = 1.4;
const FIX_MS = 10_000;

export type Cohort = "commuter" | "loop" | "long" | "hostile" | "spoofer" | "cowalker" | "gaps";
export const COHORTS: readonly Cohort[] = ["commuter", "loop", "long", "cowalker", "gaps", "hostile", "spoofer"];
/** Honest cohorts: everyone except hostile walkers and spoofers. */
export const HONEST: readonly Cohort[] = ["commuter", "loop", "long", "cowalker", "gaps"];
export const COHORT_LABEL: Readonly<Record<Cohort, string>> = {
  commuter: "casual commuters", loop: "loop walkers", long: "long-distance walkers", cowalker: "household co-walkers (linked)",
  gaps: "GPS gaps / late uploads", hostile: "hostile walkers", spoofer: "GPS spoofers",
};

/** The appealable review candidate of the route-farming study (`review-flag-2plus`). ASSUMPTION parameters. */
export interface ReviewSpec {
  /** A group is flagged when more than this many of its accounts walk together. 1 = pairs are flagged. */
  flagAboveAccounts: number;
  flagDays: number;
  windowDays: number;
  similarity: number;
  startWithinMs: number;
  /** A group a reviewer cleared is not flagged again for this many days. */
  clearedExemptDays: number;
  /** ASSUMPTION (route-farming study): share of flags on real co-walkers a reviewer wrongly upholds. */
  wrongUpholdRate: number;
}

export const REVIEW_2PLUS: Readonly<ReviewSpec> = Object.freeze({
  flagAboveAccounts: 1, flagDays: 4, windowDays: 14, similarity: 0.8, startWithinMs: 20 * MIN, clearedExemptDays: 90, wrongUpholdRate: 0.05,
});

/** The same review, but pairs are never flagged: only 3 or more linked accounts walking together. */
export const REVIEW_3PLUS: Readonly<ReviewSpec> = Object.freeze({ ...REVIEW_2PLUS, flagAboveAccounts: 2 });

export interface FairnessSpec {
  seed: number;
  days: number;
  /** Accounts per cohort. Co-walkers come in linked pairs, so their count must be even. */
  counts: Readonly<Record<Cohort, number>>;
  origin: { latitude: number; longitude: number };
  /** The server's per-walker daily unit budget, or null for none. */
  unitBudget: number | null;
  review: ReviewSpec;
}

export const DEFAULT_FAIRNESS: Readonly<Omit<FairnessSpec, "seed">> = Object.freeze({
  days: 28,
  counts: Object.freeze({ commuter: 24, loop: 16, long: 6, cowalker: 16, gaps: 10, hostile: 4, spoofer: 4 }),
  origin: { latitude: 51.52, longitude: -0.1 },
  unitBudget: DEFAULT_UNIT_BUDGET,
  review: REVIEW_2PLUS,
});

export function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type XY = [number, number];
const uniform = (rnd: () => number, a: number, b: number) => a + (b - a) * rnd();
function gauss(rnd: () => number): number {
  const u = Math.max(rnd(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

export interface Walker { id: string; cohort: Cohort; home: XY; partner: string | null; route: XY[]; work: XY | null }
export interface SimSession {
  walker: string;
  cohort: Cohort;
  startMs: number;
  endMs: number;
  /** Server receipt time (the movement row's created_at). */
  receivedMs: number;
  fixes: PathFix[];
}

export function loop(rnd: () => number, c: XY, radius: number): XY[] {
  const n = 5 + Math.floor(rnd() * 3);
  const angles = Array.from({ length: n }, () => rnd() * Math.PI * 2).sort((a, b) => a - b);
  const pts = angles.map((a) => [c[0] + Math.cos(a) * radius * (0.6 + 0.4 * rnd()), c[1] + Math.sin(a) * radius * (0.6 + 0.4 * rnd())] as XY);
  return [...pts, pts[0]!];
}

export interface TraceOpts {
  noiseM: number;
  gaps?: { count: number; minMs: number; maxMs: number };
  /** Speed along the polyline in m/s. Absent: walking speed, 1.4 m/s (every cohort of this study). */
  speedMps?: number;
}

/** Walk a polyline at 1.4 m/s (or `opts.speedMps`) with a fix every 10 s, add GPS noise, and drop fixes in gaps. */
export function trace(rnd: () => number, xy: readonly XY[], origin: FairnessSpec["origin"], startMs: number, opts: TraceOpts): PathFix[] {
  const pts: { x: number; y: number; t: number }[] = [];
  const step = (opts.speedMps ?? SPEED) * (FIX_MS / 1000);
  let t = startMs;
  let carry = 0;
  for (let i = 0; i + 1 < xy.length; i++) {
    const a = xy[i]!, b = xy[i + 1]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let d = carry;
    while (d < len) {
      pts.push({ x: a[0] + ((b[0] - a[0]) * d) / len, y: a[1] + ((b[1] - a[1]) * d) / len, t });
      t += FIX_MS;
      d += step;
    }
    carry = d - len;
  }
  const last = xy[xy.length - 1]!;
  pts.push({ x: last[0], y: last[1], t });
  const keep = pts.map(() => true);
  if (opts.gaps && pts.length > 20) {
    for (let g = 0; g < opts.gaps.count; g++) {
      const len = Math.round(uniform(rnd, opts.gaps.minMs, opts.gaps.maxMs) / FIX_MS);
      const at = 1 + Math.floor(rnd() * Math.max(1, pts.length - len - 2));
      for (let k = at; k < Math.min(pts.length - 1, at + len); k++) keep[k] = false;
    }
  }
  const cosLat = Math.cos(origin.latitude * DEG);
  const out: PathFix[] = [];
  pts.forEach((p, i) => {
    const nx = opts.noiseM > 0 ? gauss(rnd) * opts.noiseM : 0;
    const ny = opts.noiseM > 0 ? gauss(rnd) * opts.noiseM : 0;
    if (!keep[i]) return;
    out.push({
      lat: origin.latitude + (p.y + ny) / EARTH_RADIUS_M / DEG,
      lng: origin.longitude + (p.x + nx) / EARTH_RADIUS_M / DEG / cosLat,
      timestamp: p.t,
    });
  });
  return out;
}

/** The synthetic population, deterministic for a seed. */
export function walkersFor(spec: FairnessSpec, rnd: () => number): Walker[] {
  if (spec.counts.cowalker % 2 !== 0) throw new Error("co-walkers come in linked pairs");
  const town = () => [(rnd() - 0.5) * 4000, (rnd() - 0.5) * 4000] as XY;
  const out: Walker[] = [];
  for (const cohort of COHORTS) {
    for (let i = 0; i < spec.counts[cohort]; i++) {
      const id = `${cohort}-${i}`;
      if (cohort === "cowalker" && i % 2 === 1) {
        const p = out[out.length - 1]!;
        p.partner = id;
        out.push({ id, cohort, home: p.home, partner: p.id, route: p.route, work: null });
        continue;
      }
      const home = town();
      const work = cohort === "commuter" ? ([(rnd() - 0.5) * 1600, (rnd() - 0.5) * 1600] as XY) : null;
      const route = work ? [home, [work[0], home[1]] as XY, work] : loop(rnd, home, uniform(rnd, 350, 700));
      out.push({ id, cohort, home, partner: null, route, work });
    }
  }
  return out;
}

/** The same synthetic sessions for every rule set, sorted by server receipt. */
export function fairnessSessions(spec: FairnessSpec, day0: number): { walkers: Walker[]; sessions: SimSession[] } {
  const rnd = prng(spec.seed);
  const walkers = walkersFor(spec, rnd);
  const honestHomes = walkers.filter((w) => HONEST.includes(w.cohort)).map((w) => w.home);
  const target = () => honestHomes[Math.floor(rnd() * honestHomes.length)]!;
  const sessions: SimSession[] = [];
  const add = (w: Walker, xy: readonly XY[], startMs: number, opts: TraceOpts, uploadAfterMs: number) => {
    const fixes = trace(rnd, xy, spec.origin, startMs, opts);
    if (fixes.length < 2) return;
    const endMs = fixes[fixes.length - 1]!.timestamp;
    sessions.push({ walker: w.id, cohort: w.cohort, startMs: fixes[0]!.timestamp, endMs, receivedMs: endMs + uploadAfterMs, fixes });
  };
  const honestUpload = () => uniform(rnd, 1, 5) * MIN;
  for (let d = 0; d < spec.days; d++) {
    const day = day0 + d;
    const base = day * DAY_MS;
    const weekend = [0, 6].includes((day + 4) % 7); // day 0 (1970-01-01) was a Thursday
    for (const w of walkers) {
      switch (w.cohort) {
        case "commuter": {
          if (!weekend && rnd() < 0.85) {
            add(w, w.route, base + uniform(rnd, 7, 9) * H, { noiseM: 6 }, honestUpload());
            add(w, [...w.route].reverse(), base + uniform(rnd, 16.5, 18.5) * H, { noiseM: 6 }, honestUpload());
          } else if (weekend && rnd() < 0.35) add(w, loop(rnd, w.home, uniform(rnd, 300, 700)), base + uniform(rnd, 9, 18) * H, { noiseM: 6 }, honestUpload());
          break;
        }
        case "loop": {
          if (rnd() < 0.75) {
            const s = uniform(rnd, 6, 17);
            add(w, w.route, base + s * H, { noiseM: 6 }, honestUpload());
            if (rnd() < 0.2) add(w, w.route, base + Math.min(21.5, s + uniform(rnd, 3, 6)) * H, { noiseM: 6 }, honestUpload());
          }
          break;
        }
        case "long": {
          if (rnd() < 0.45) {
            add(w, loop(rnd, w.home, uniform(rnd, 1800, 3500)), base + uniform(rnd, 7, 9.5) * H, { noiseM: 6 }, honestUpload());
            if (rnd() < 0.3) add(w, loop(rnd, w.home, uniform(rnd, 700, 950)), base + uniform(rnd, 18, 19.5) * H, { noiseM: 6 }, honestUpload());
          }
          break;
        }
        case "gaps": {
          if (rnd() < 0.7) {
            const late = rnd() < 0.35;
            add(w, w.route, base + uniform(rnd, 7, 19) * H, { noiseM: 10, gaps: { count: 2 + Math.floor(rnd() * 4), minMs: 60_000, maxMs: 300_000 } },
              late ? uniform(rnd, 1, 10) * H : honestUpload());
          }
          break;
        }
        case "cowalker": {
          if (w.id > w.partner!) break; // the pair is generated once, from its first member
          const partner = walkers.find((x) => x.id === w.partner)!;
          if (rnd() >= 0.75) break;
          if (rnd() < 0.7) {
            // Together: the same route, starts within 3 minutes, each phone with its own noise and upload.
            const route = rnd() < 0.5 ? w.route : loop(rnd, w.home, uniform(rnd, 300, 800));
            const s = base + uniform(rnd, 7, 20) * H;
            const first = rnd() < 0.5 ? [w, partner] : [partner, w];
            for (const m of first) add(m, route, s + uniform(rnd, 0, 3) * MIN, { noiseM: 6 }, honestUpload());
          } else {
            for (const m of [w, partner]) if (rnd() < 0.6) add(m, loop(rnd, m.home, uniform(rnd, 300, 700)), base + uniform(rnd, 7, 20) * H, { noiseM: 6 }, honestUpload());
          }
          break;
        }
        case "hostile": {
          // A long daytime tour through six honest homes, then the midnight straddle round one home.
          const tour: XY[] = Array.from({ length: 6 }, target);
          add(w, [...tour, tour[0]!], base + uniform(rnd, 9, 11) * H, { noiseM: 6 }, MIN);
          const short = loop(rnd, target(), 350);
          add(w, short, base + 23.4 * H, { noiseM: 6 }, MIN);
          if (d < spec.days - 1) add(w, short, base + DAY_MS + 0.05 * H, { noiseM: 6 }, MIN);
          break;
        }
        case "spoofer": {
          // Fabricated traces that pass verification: three tours through four honest homes a day, uploaded at once …
          for (const s of [uniform(rnd, 8, 11), uniform(rnd, 12, 16), uniform(rnd, 17, 20.5)]) {
            const tour: XY[] = Array.from({ length: 4 }, target);
            add(w, [...tour, tour[0]!], base + s * H, { noiseM: 3 }, 30_000);
          }
          // … and the grace backdate: at about 01:00 a session dated yesterday 23:20, then at once one dated today 00:05.
          if (d < spec.days - 1) {
            const short = loop(rnd, target(), 350);
            const upload = base + DAY_MS + uniform(rnd, 0.9, 1.4) * H;
            const a = trace(rnd, short, spec.origin, base + 23.3 * H, { noiseM: 3 });
            const b = trace(rnd, short, spec.origin, base + DAY_MS + 0.08 * H, { noiseM: 3 });
            sessions.push({ walker: w.id, cohort: w.cohort, startMs: a[0]!.timestamp, endMs: a[a.length - 1]!.timestamp, receivedMs: upload, fixes: a });
            sessions.push({ walker: w.id, cohort: w.cohort, startMs: b[0]!.timestamp, endMs: b[b.length - 1]!.timestamp, receivedMs: Math.max(upload, b[b.length - 1]!.timestamp) + MIN, fixes: b });
          }
          break;
        }
      }
    }
  }
  sessions.sort((x, y) => x.receivedMs - y.receivedMs || (x.walker < y.walker ? -1 : x.walker > y.walker ? 1 : x.endMs - y.endMs));
  return { walkers, sessions };
}

export interface CohortStats {
  walkers: number;
  /** Sessions accepted for a day (not refused by day close). */
  sessions: number;
  /** Sessions refused because they reached the server after their day closed (midnight + 2 h). */
  sessionsDayClosed: number;
  /** Accepted sessions that claimed or reinforced at least one unit. */
  sessionsWithAccess: number;
  /** Walker-days with at least one accepted session. */
  activeWalkerDays: number;
  /** Empty-ground acquisitions (outcome `claimed`). */
  claims: number;
  /** Takes made: pushes on ground another walker held (`eroded` or `flipped`). */
  takes: number;
  flipsMade: number;
  /** Flips this cohort made on honest walkers' ground. */
  flipsOnHonest: number;
  /** Units this cohort lost to someone else's flip. */
  flipsLost: number;
  areaLostKm2: number;
  /** Takes on the linked partner's ground (co-walkers only). */
  takesOnPartner: number;
  flipsOnPartner: number;
  takeBudgetRefused: number;
  walkerDaysAtTakeCap: number;
  unitBudgetRefused: number;
  walkerDaysAtUnitBudget: number;
  /** Most units one walker pushed (applied or refused by the take budget) in one day. */
  maxUnitsWalkerDay: number;
  /** Would-be challenge completions held back by the 20 hour server-receipt gap. */
  gapHeld: number;
  /** Flips completed under 20 hours of server time after the walker's challenge opened. */
  straddleFlips: number;
  /** Pushes the ledger rejected as earlier than the unit's day (`stale_day`). */
  staleRejected: number;
  heldEndUnits: number;
  heldEndKm2: number;
  walkersWithGround: number;
}

export interface ReviewStats {
  linkedGroups: number;
  linkedAccounts: number;
  /** Group-days on which two or more linked accounts walked together. */
  togetherGroupDays: number;
  groupsFlagged: number;
  accountsFlagged: number;
  /** Flags by cohort; only linked groups can be flagged. */
  flaggedByCohort: Record<Cohort, number>;
  /** Reviews opened per 1,000 accounts over the run. */
  reviewsPer1000: number;
  /** Seeded draw at the assumed wrong-uphold rate. Every flag here is on real co-walkers. */
  wronglyUpheld: number;
  meanFirstFlagDay: number | null;
}

export interface FairnessRow {
  label: string;
  unitAreaKm2: number;
  totalHeldKm2: number;
  /** All flips on the map divided by the units held at the end. */
  mapFlipsPerHeldUnit: number;
  cohorts: Record<Cohort, CohortStats>;
  /** The candidate (`spec.review`, 2+ linked accounts by default). */
  review: ReviewStats;
  /** The variant that never flags pairs (3+ linked accounts). */
  review3plus: ReviewStats;
}

const emptyStats = (walkers: number): CohortStats => ({
  walkers, sessions: 0, sessionsDayClosed: 0, sessionsWithAccess: 0, activeWalkerDays: 0, claims: 0, takes: 0, flipsMade: 0, flipsOnHonest: 0,
  flipsLost: 0, areaLostKm2: 0, takesOnPartner: 0, flipsOnPartner: 0, takeBudgetRefused: 0, walkerDaysAtTakeCap: 0, unitBudgetRefused: 0,
  walkerDaysAtUnitBudget: 0, maxUnitsWalkerDay: 0, gapHeld: 0, straddleFlips: 0, staleRejected: 0, heldEndUnits: 0, heldEndKm2: 0, walkersWithGround: 0,
});

function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The review candidate on the run's zone sets (1001: the stored cell; 1002: its resolution 9 parent). */
function reviewOf(spec: FairnessSpec, R: ReviewSpec, walkers: Walker[], accepted: { s: SimSession; day: number; zones: Set<string> }[], day0: number): ReviewStats {
  const cohortOf = new Map(walkers.map((w) => [w.id, w.cohort]));
  const groups = walkers.filter((w) => w.partner !== null && w.id < w.partner).map((w) => [w.id, w.partner!]);
  const byWalkerDay = new Map<string, typeof accepted>();
  for (const a of accepted) {
    const k = `${a.s.walker}:${a.day}`;
    (byWalkerDay.get(k) ?? byWalkerDay.set(k, []).get(k)!).push(a);
  }
  const jaccard = (x: Set<string>, y: Set<string>) => {
    let inter = 0;
    for (const z of x) if (y.has(z)) inter += 1;
    const union = x.size + y.size - inter;
    return union === 0 ? 0 : inter / union;
  };
  const flaggedByCohort = Object.fromEntries(COHORTS.map((c) => [c, 0])) as Record<Cohort, number>;
  let together = 0, flagged = 0, accounts = 0, upheld = 0;
  const firstDays: number[] = [];
  for (const ids of groups) {
    const hits: number[] = [];
    let lastFlag: number | null = null;
    for (let d = 0; d < spec.days; d++) {
      const day = day0 + d;
      const a = byWalkerDay.get(`${ids[0]}:${day}`) ?? [];
      const b = byWalkerDay.get(`${ids[1]}:${day}`) ?? [];
      const walked = a.some((x) => b.some((y) => Math.abs(x.s.startMs - y.s.startMs) <= R.startWithinMs && jaccard(x.zones, y.zones) >= R.similarity));
      if (walked) together += 1;
      // A pair is 2 accounts: a hit only when 2 > flagAboveAccounts.
      if (walked && 2 > R.flagAboveAccounts) hits.push(d);
      const recent = hits.filter((h) => d - h < R.windowDays);
      const exempt = lastFlag !== null && d - lastFlag < Math.max(R.windowDays, R.clearedExemptDays);
      if (!exempt && recent.length >= R.flagDays) {
        lastFlag = d;
        flagged += 1;
        accounts += ids.length;
        for (const id of ids) flaggedByCohort[cohortOf.get(id)!] += 1;
        firstDays.push(d + 1);
        if (prng(hash32(`${spec.seed}:${ids.join(",")}:${d}`))() < R.wrongUpholdRate) upheld += 1;
      }
    }
  }
  return {
    linkedGroups: groups.length, linkedAccounts: groups.length * 2, togetherGroupDays: together, groupsFlagged: flagged, accountsFlagged: accounts,
    flaggedByCohort, reviewsPer1000: (flagged * 1000) / walkers.length, wronglyUpheld: upheld,
    meanFirstFlagDay: firstDays.length ? firstDays.reduce((x, y) => x + y, 0) / firstDays.length : null,
  };
}

export function fairnessRun(spec: FairnessSpec, label: string, rules: Rules, gap: boolean): FairnessRow {
  const day0 = 20_000;
  const { walkers, sessions } = fairnessSessions(spec, day0);
  const cohortOf = new Map(walkers.map((w) => [w.id, w.cohort]));
  const partnerOf = new Map(walkers.map((w) => [w.id, w.partner]));
  const isHonest = (id: string | null) => id !== null && HONEST.includes(cohortOf.get(id)!);
  const fine = rules.units.source?.kind === "session-path" ? rules.units.source.rule : null;
  const resolution = fine ? fine.resolution : 8;
  const area = getHexagonAreaAvg(resolution, "km2");
  const tk = rules.takeover;
  const cap = rules.takeBudget?.perWalkerPerDay ?? null;
  const stats = Object.fromEntries(COHORTS.map((c) => [c, emptyStats(spec.counts[c])])) as Record<Cohort, CohortStats>;
  const states = new Map<string, UnitState>();
  let opened = new Map<string, number>();
  const takes = new Map<string, number>();
  const units = new Map<string, number>();
  const active = new Set<string>();
  const capHit = new Set<string>();
  const budgetHit = new Set<string>();
  const challengeOpenedAt = new Map<string, number>();
  const accepted: { s: SimSession; day: number; zones: Set<string> }[] = [];
  let mapFlips = 0;

  sessions.forEach((s, n) => {
    const st = stats[s.cohort];
    const day = Math.floor(s.endMs / DAY_MS);
    if (s.receivedMs >= (day + 1) * DAY_MS + rules.dayCloseGraceMs) {
      st.sessionsDayClosed += 1;
      return;
    }
    const unitIds = fine
      ? pushUnitsOf(deriveSessionPath(s.fixes, [], fine), fine)
      : [...new Set(cellsForObservations(s.fixes.map((f) => ({ latitude: f.lat, longitude: f.lng }))))].sort();
    accepted.push({ s, day, zones: new Set(fine ? unitIds.map((u) => cellToParent(u, 9)) : unitIds) });
    st.sessions += 1;
    const wd = `${s.walker}:${day}`;
    if (!active.has(wd)) {
      active.add(wd);
      st.activeWalkerDays += 1;
    }
    const events: PushEvent[] = unitIds.map((u) => ({ eventId: `s${n}:${u}`, unitId: u, walkerId: s.walker, day, push: { kind: "solid" } }));
    // Only the session's units take part, so the step sees exactly the state it would load and lock.
    const sub = new Map<string, UnitState>();
    const pendingChallenge = new Set<string>();
    const windowDays = tk.name === "two-day-challenge" ? tk.windowDays : 0;
    for (const u of unitIds) {
      const cur = states.get(u) ?? newUnit(u, day);
      sub.set(u, cur);
      if (cur.holderId !== null && cur.holderId !== s.walker && cur.challenges?.some((c) => c.walkerId === s.walker && c.day < day && day - c.day <= windowDays)) {
        pendingChallenge.add(u);
      }
    }
    const r = applyServerLedger({
      states: sub, events, holding: rules.holding, budget: rules.takeBudget, takesUsed: new Map([[s.walker, takes.get(wd) ?? 0]]),
      unitsRemaining: spec.unitBudget === null ? undefined : new Map([[s.walker, Math.max(0, spec.unitBudget - (units.get(wd) ?? 0))]]),
      walkOrder: new Map(events.map((e, i) => [e.eventId, i])),
      secondPush: gap && tk.name === "two-day-challenge" && tk.policyVersion === 2
        ? { minElapsedMs: tk.secondPush.minElapsedMs, windowDays: tk.windowDays, eventReceivedMs: new Map(events.map((e) => [e.eventId, s.receivedMs])), challengeOpenedMs: opened }
        : undefined,
    });
    for (const [u, v] of r.states) states.set(u, v);
    opened = r.challengeOpenedMs;
    takes.set(wd, r.takesUsed.get(s.walker) ?? 0);
    units.set(wd, (units.get(wd) ?? 0) + (r.unitsUsed.get(s.walker) ?? 0));
    st.maxUnitsWalkerDay = Math.max(st.maxUnitsWalkerDay, units.get(wd) ?? 0);
    if (cap !== null && (takes.get(wd) ?? 0) >= cap && !capHit.has(wd)) {
      capHit.add(wd);
      st.walkerDaysAtTakeCap += 1;
    }
    for (const x of r.results) {
      if (x.status !== "rejected") continue;
      if (x.reason === "unit_budget") {
        st.unitBudgetRefused += 1;
        if (!budgetHit.has(wd)) {
          budgetHit.add(wd);
          st.walkerDaysAtUnitBudget += 1;
        }
      } else if (x.reason === "stale_day") st.staleRejected += 1;
    }
    if (r.entries.some((e) => e.outcome === "claimed" || e.outcome === "reinforced")) st.sessionsWithAccess += 1;
    for (const e of r.entries) {
      const key = `${e.unitId}\u0000${e.walkerId}`;
      if (e.outcome === "refused_take_budget") st.takeBudgetRefused += 1;
      if (e.outcome === "claimed") st.claims += 1;
      if (e.outcome === "eroded" || e.outcome === "flipped") {
        st.takes += 1;
        if (e.previousHolderId !== null && e.previousHolderId === partnerOf.get(s.walker)) st.takesOnPartner += 1;
      }
      if (e.outcome === "eroded" && pendingChallenge.has(e.unitId)) st.gapHeld += 1;
      if (e.outcome === "flipped") {
        mapFlips += 1;
        st.flipsMade += 1;
        if (isHonest(e.previousHolderId)) st.flipsOnHonest += 1;
        if (e.previousHolderId !== null) {
          const lost = stats[cohortOf.get(e.previousHolderId)!];
          lost.flipsLost += 1;
          lost.areaLostKm2 += area;
          if (e.previousHolderId === partnerOf.get(s.walker)) st.flipsOnPartner += 1;
        }
        const first = challengeOpenedAt.get(key);
        if (first !== undefined && s.receivedMs - first < STRADDLE_MS) st.straddleFlips += 1;
      }
      if (e.outcome === "eroded" && !challengeOpenedAt.has(key)) challengeOpenedAt.set(key, s.receivedMs);
      if (e.outcome === "flipped" || e.outcome === "reinforced") {
        for (const k2 of [...challengeOpenedAt.keys()]) if (k2.startsWith(`${e.unitId}\u0000`)) challengeOpenedAt.delete(k2);
      }
    }
  });

  const lastDay = day0 + spec.days;
  const holders = new Set<string>();
  let total = 0;
  for (const s of states.values()) {
    const d = decayTo(s, Math.max(lastDay, s.asOfDay), rules.holding);
    if (d.holderId === null || stageOf(d, rules.holding) === "unheld") continue;
    const st = stats[cohortOf.get(d.holderId)!];
    st.heldEndUnits += 1;
    st.heldEndKm2 += area;
    total += 1;
    holders.add(d.holderId);
  }
  for (const id of holders) stats[cohortOf.get(id)!].walkersWithGround += 1;
  return {
    label, unitAreaKm2: area, totalHeldKm2: total * area, mapFlipsPerHeldUnit: total === 0 ? 0 : mapFlips / total, cohorts: stats,
    review: reviewOf(spec, spec.review, walkers, accepted, day0),
    review3plus: reviewOf(spec, REVIEW_3PLUS, walkers, accepted, day0),
  };
}

export const FAIRNESS_RULESETS = [
  ["1001", PILOT_PROPOSAL, false],
  ["1002 without the gap", SIM_PILOT_2_PROPOSAL, false],
  ["1002", SIM_PILOT_2_PROPOSAL, true],
] as const;

/** The three columns for one seed: 1001, 1002 without the 20 hour gap (for the stress table only), 1002. */
export function fairnessSeed(seed: number, over: Partial<Omit<FairnessSpec, "seed">> = {}): FairnessRow[] {
  const spec: FairnessSpec = { ...DEFAULT_FAIRNESS, ...over, seed };
  return FAIRNESS_RULESETS.map(([label, rules, gap]) => fairnessRun(spec, label, rules, gap));
}
