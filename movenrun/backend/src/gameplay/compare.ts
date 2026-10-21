/**
 * SIMULATION ONLY. A same-seed comparison of rule sets 1001 and 1002 from
 * the same synthetic verified walks: every session is a sequence of accepted
 * fixes; 1001 gets the cells the movement pipeline stores (resolution 8,
 * `cellsForObservations`), 1002 gets the canonical resolution 10 path
 * (`deriveSessionPath`). Both run through the server's own ledger step
 * (`applyServerLedger`) with their own holding rules, take budget, walk order
 * and second-push gap, so the only difference between the columns is the
 * rule set. A third column runs 1002 without the gap, to isolate the
 * midnight-straddle fix.
 *
 * The players, routes and timings are synthetic behaviour assumptions, not
 * observations of real players, and nothing here is evidence about real
 * retention or fairness. Credits are not simulated.
 */
import { getHexagonAreaAvg, latLngToCell } from "h3-js";
import { cellsForObservations } from "@movenrun/shared/h3";
import { newUnit, stageOf, decayTo, type UnitState } from "@movenrun/shared/holding";
import type { PushEvent } from "@movenrun/shared/holdingLedger";
import { applyServerLedger } from "./policy.js";
import { deriveSessionPath, pushUnitsOf, type PathFix } from "./path.js";
import { DAY_MS, PILOT_PROPOSAL, SIM_PILOT_2_PROPOSAL, type GameplayRules } from "./rules.js";

type Rules = Omit<GameplayRules, "seasonOneStartDay">;
const H = 3_600_000;
const EARTH_RADIUS_M = 6_371_000;
const DEG = Math.PI / 180;

export interface CompareSpec {
  seed: number;
  days: number;
  casual: number;
  attackers: number;
  origin: { latitude: number; longitude: number };
}

export const DEFAULT_COMPARE: Readonly<Omit<CompareSpec, "seed">> = Object.freeze({
  days: 14, casual: 40, attackers: 4, origin: { latitude: 51.52, longitude: -0.1 },
});

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

type XY = [number, number];
interface Session { walker: string; kind: "casual" | "attacker"; endMs: number; receivedMs: number; fixes: PathFix[] }

function toFixes(xy: XY[], origin: CompareSpec["origin"], startMs: number): PathFix[] {
  // A fix every 10 s at 1.4 m/s (14 m), as accepted fixes would be spaced.
  const out: PathFix[] = [];
  let t = startMs;
  for (let i = 0; i < xy.length; i++) {
    const a = xy[i]!, b = xy[(i + 1) % xy.length]!;
    if (i === xy.length - 1) break;
    const n = Math.max(1, Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / 14));
    for (let k = 0; k < n; k++) {
      const x = a[0] + ((b[0] - a[0]) * k) / n, y = a[1] + ((b[1] - a[1]) * k) / n;
      out.push({ lat: origin.latitude + y / EARTH_RADIUS_M / DEG, lng: origin.longitude + x / EARTH_RADIUS_M / DEG / Math.cos(origin.latitude * DEG), timestamp: t });
      t += 10_000;
    }
  }
  return out;
}

function loop(rnd: () => number, cx: number, cy: number, radius: number): XY[] {
  const n = 4 + Math.floor(rnd() * 3);
  const angles = Array.from({ length: n }, () => rnd() * Math.PI * 2).sort((a, b) => a - b);
  const pts = angles.map((a) => [cx + Math.cos(a) * radius * (0.6 + 0.4 * rnd()), cy + Math.sin(a) * radius * (0.6 + 0.4 * rnd())] as XY);
  return [...pts, pts[0]!];
}

/** The same synthetic sessions for every rule set. */
export function sessionsFor(spec: CompareSpec, day0: number): Session[] {
  const rnd = prng(spec.seed);
  const homes: XY[] = Array.from({ length: spec.casual }, () => [(rnd() - 0.5) * 4000, (rnd() - 0.5) * 4000]);
  const commute = homes.map((h) => loop(rnd, h[0], h[1], 400 + rnd() * 400));
  const sessions: Session[] = [];
  for (let d = 0; d < spec.days; d++) {
    const base = (day0 + d) * DAY_MS;
    homes.forEach((h, i) => {
      if (rnd() > 0.6) return; // casual walkers walk on about 60% of days
      const route = rnd() < 0.5 ? commute[i]! : loop(rnd, h[0], h[1], 300 + rnd() * 600);
      const start = base + (7 + rnd() * 12) * H;
      const fixes = toFixes(route, spec.origin, start);
      const end = fixes[fixes.length - 1]!.timestamp;
      sessions.push({ walker: `c${i}`, kind: "casual", endMs: end, receivedMs: end + 120_000, fixes });
    });
    for (let a = 0; a < spec.attackers; a++) {
      // A long daytime route through six casual homes, uploaded at once …
      const tour: XY[] = Array.from({ length: 6 }, () => homes[Math.floor(rnd() * homes.length)]!);
      const fixes = toFixes([...tour, tour[0]!], spec.origin, base + 10 * H);
      const end = fixes[fixes.length - 1]!.timestamp;
      sessions.push({ walker: `a${a}`, kind: "attacker", endMs: end, receivedMs: end + 60_000, fixes });
      // … and the midnight straddle: the same short loop round a casual home at 23:30 and again just after midnight.
      const h = homes[Math.floor(rnd() * homes.length)]!;
      const short = loop(rnd, h[0], h[1], 350);
      for (const [startMs, tag] of [[base + 23.4 * H, "late"], [base + DAY_MS + 0.05 * H, "early"]] as const) {
        const f = toFixes(short, spec.origin, startMs);
        const e = f[f.length - 1]!.timestamp;
        if (tag === "early" && d === spec.days - 1) continue;
        sessions.push({ walker: `a${a}`, kind: "attacker", endMs: e, receivedMs: e + 60_000, fixes: f });
      }
    }
  }
  return sessions.sort((x, y) => x.receivedMs - y.receivedMs || (x.walker < y.walker ? -1 : 1));
}

export interface CompareRow {
  label: string;
  unitAreaKm2: number;
  /** Area held by attackers at the end. */
  attackerHeldKm2: number;
  /** Area attackers flipped from someone else, summed over the run. */
  attackerFlippedKm2: number;
  /** Flips by attackers that completed less than 20 hours after the challenge opened (the midnight straddle). */
  straddleFlips: number;
  /** Area casual walkers held at the end. */
  casualHeldKm2: number;
  /** Area casual walkers lost to an attacker's flip. */
  casualLostToAttackersKm2: number;
  /** Casual walkers holding any ground at the end, of all casual walkers. */
  casualWithGround: number;
  /** Casual sessions that claimed or reinforced at least one unit. */
  casualSessionsWithAccess: number;
  casualSessions: number;
  /** Pushes refused by the take budget, by kind of walker. */
  budgetRefusedCasual: number;
  budgetRefusedAttacker: number;
}

export function compareRun(spec: CompareSpec, label: string, rules: Rules, gap: boolean): CompareRow {
  const day0 = 20_000;
  const sessions = sessionsFor(spec, day0);
  const fine = rules.units.source?.kind === "session-path" ? rules.units.source.rule : null;
  const resolution = fine ? fine.resolution : 8;
  const area = getHexagonAreaAvg(resolution, "km2");
  const tk = rules.takeover;
  let states = new Map<string, UnitState>();
  let opened = new Map<string, number>();
  const used = new Map<string, number>();
  // The metric's own record of when each walker's first push on a unit reached the server (not a rule input).
  const challengeOpenedAt = new Map<string, number>();
  const row: CompareRow = {
    label, unitAreaKm2: area, attackerHeldKm2: 0, attackerFlippedKm2: 0, straddleFlips: 0, casualHeldKm2: 0, casualLostToAttackersKm2: 0,
    casualWithGround: 0, casualSessionsWithAccess: 0, casualSessions: 0, budgetRefusedCasual: 0, budgetRefusedAttacker: 0,
  };
  const kindOf = (w: string) => (w.startsWith("a") ? "attacker" : "casual");
  sessions.forEach((s, n) => {
    const day = Math.floor(s.endMs / DAY_MS);
    const units = fine
      ? pushUnitsOf(deriveSessionPath(s.fixes, [], fine), fine)
      : [...new Set(cellsForObservations(s.fixes.map((f) => ({ latitude: f.lat, longitude: f.lng }))))].sort();
    const events: PushEvent[] = units.map((u) => ({ eventId: `s${n}:${u}`, unitId: u, walkerId: s.walker, day, push: { kind: "solid" } }));
    for (const e of events) {
      const st = states.get(e.unitId);
      if (!st) states.set(e.unitId, newUnit(e.unitId, day));
    }
    const k = `${s.walker}:${day}`;
    const r = applyServerLedger({
      states, events, holding: rules.holding, budget: rules.takeBudget, takesUsed: new Map([[s.walker, used.get(k) ?? 0]]),
      walkOrder: new Map(events.map((e, i) => [e.eventId, i])),
      secondPush: gap && tk.name === "two-day-challenge" && tk.policyVersion === 2
        ? { minElapsedMs: tk.secondPush.minElapsedMs, windowDays: tk.windowDays, eventReceivedMs: new Map(events.map((e) => [e.eventId, s.receivedMs])), challengeOpenedMs: opened }
        : undefined,
    });
    states = r.states;
    opened = r.challengeOpenedMs;
    used.set(k, r.takesUsed.get(s.walker) ?? 0);
    if (s.kind === "casual") {
      row.casualSessions += 1;
      if (r.entries.some((e) => e.outcome === "claimed" || e.outcome === "reinforced")) row.casualSessionsWithAccess += 1;
    }
    for (const e of r.entries) {
      if (e.outcome === "refused_take_budget") {
        if (s.kind === "casual") row.budgetRefusedCasual += 1;
        else row.budgetRefusedAttacker += 1;
      }
      const key = `${e.unitId}\u0000${e.walkerId}`;
      if (e.outcome === "flipped" && s.kind === "attacker") {
        row.attackerFlippedKm2 += area;
        if (e.previousHolderId && kindOf(e.previousHolderId) === "casual") row.casualLostToAttackersKm2 += area;
        // A straddle flip: the attacker's own first push on this unit reached the server under 20 hours before.
        const first = challengeOpenedAt.get(key);
        if (first !== undefined && s.receivedMs - first < 20 * H) row.straddleFlips += 1;
      }
      if (e.outcome === "eroded" && !challengeOpenedAt.has(key)) challengeOpenedAt.set(key, s.receivedMs);
      if (e.outcome === "flipped" || e.outcome === "reinforced") {
        for (const k2 of [...challengeOpenedAt.keys()]) if (k2.startsWith(`${e.unitId}\u0000`)) challengeOpenedAt.delete(k2);
      }
    }
  });
  const lastDay = day0 + spec.days;
  const casualHolders = new Set<string>();
  for (const s of states.values()) {
    const d = decayTo(s, Math.max(lastDay, s.asOfDay), rules.holding);
    if (d.holderId === null || stageOf(d, rules.holding) === "unheld") continue;
    if (kindOf(d.holderId) === "attacker") row.attackerHeldKm2 += area;
    else {
      row.casualHeldKm2 += area;
      casualHolders.add(d.holderId);
    }
  }
  row.casualWithGround = casualHolders.size;
  return row;
}

/** The three columns for one seed. */
export function compareSeed(seed: number, over: Partial<Omit<CompareSpec, "seed">> = {}): CompareRow[] {
  const spec = { ...DEFAULT_COMPARE, ...over, seed };
  const out: CompareRow[] = [];
  for (const [label, rules, gap] of [["1001", PILOT_PROPOSAL, false], ["1002 without the gap", SIM_PILOT_2_PROPOSAL, false], ["1002", SIM_PILOT_2_PROPOSAL, true]] as const) {
    out.push(compareRun(spec, label, rules, gap));
  }
  return out;
}

/** Units of the run's resolution at a coordinate, for tests. */
export const unitAt = (lat: number, lng: number, res: number) => latLngToCell(lat, lng, res);
