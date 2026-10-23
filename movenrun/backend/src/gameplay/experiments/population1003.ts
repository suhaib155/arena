/**
 * SIMULATION ONLY. The synthetic population of experiment 1003. Every
 * cohort is a behaviour ASSUMPTION written for this experiment, not an
 * observation of real players. Deterministic for a seed. Uses the trace and
 * loop helpers of the fairness study (`fairness.ts`).
 */
import { DAY_MS } from "../rules.js";
import { loop, prng, trace, type SimSession, type TraceOpts, type XY } from "../fairness.js";
import type { PathFix } from "../path.js";

const H = 3_600_000;
const MIN = 60_000;
const EARTH_RADIUS_M = 6_371_000;
const DEG = Math.PI / 180;

export type Cohort1003 =
  | "commuter" | "runner" | "loop" | "long" | "household" | "sibling" | "shared" | "transit" | "drift"
  | "duplicate" | "malicious" | "spoofer" | "ring";

export const COHORTS_1003: readonly Cohort1003[] = [
  "commuter", "runner", "loop", "long", "household", "sibling", "shared", "transit", "drift", "duplicate", "malicious", "spoofer", "ring",
];
/** Honest cohorts. Two-device duplicates are neither honest nor adversarial here and are reported on their own. */
export const HONEST_1003: readonly Cohort1003[] = ["commuter", "runner", "loop", "long", "household", "sibling", "shared", "transit", "drift"];
export const ADVERSARY_1003: readonly Cohort1003[] = ["malicious", "spoofer", "ring"];
/** Cohorts whose accounts the risk graph links (the only ones a linked-account review can see). */
export const LINKED_1003: readonly Cohort1003[] = ["household", "sibling", "duplicate"];

export const COHORT_1003_LABEL: Readonly<Record<Cohort1003, string>> = {
  commuter: "commuters", runner: "runners", loop: "loop walkers", long: "long-distance walkers", household: "households (linked pairs)",
  sibling: "siblings (linked trios)", shared: "shared public routes", transit: "public transit riders", drift: "location drift",
  duplicate: "two-device duplicates (linked)", malicious: "malicious walkers", spoofer: "GPS spoofers", ring: "collusion ring (unlinked)",
};

export interface Population1003Spec {
  seed: number;
  days: number;
  counts: Readonly<Record<Cohort1003, number>>;
  origin: { latitude: number; longitude: number };
}

/** Accounts per seed. Households even (pairs), siblings a multiple of 3, duplicates even (one person, two accounts). */
export const DEFAULT_COUNTS_1003: Readonly<Record<Cohort1003, number>> = Object.freeze({
  commuter: 24, runner: 8, loop: 16, long: 6, household: 16, sibling: 9, shared: 12, transit: 8, drift: 6, duplicate: 8, malicious: 4, spoofer: 4, ring: 5,
});

export interface Walker1003 {
  id: string;
  cohort: Cohort1003;
  home: XY;
  /** Linked group id (households, siblings, duplicates), else null. Collusion rings are not linked. */
  group: string | null;
  route: XY[];
  work: XY | null;
}

export interface Session1003 extends Omit<SimSession, "cohort"> { cohort: Cohort1003 }

const uniform = (rnd: () => number, a: number, b: number) => a + (b - a) * rnd();

function toFix(origin: Population1003Spec["origin"], x: number, y: number, t: number): PathFix {
  return { lat: origin.latitude + y / EARTH_RADIUS_M / DEG, lng: origin.longitude + x / EARTH_RADIUS_M / DEG / Math.cos(origin.latitude * DEG), timestamp: t };
}

/** Synthetic population and sessions, sorted by server receipt; the same for every rule set. */
export function population1003(spec: Population1003Spec, day0: number): { walkers: Walker1003[]; sessions: Session1003[] } {
  const rnd = prng(spec.seed ^ 0x1003);
  const c = spec.counts;
  if (c.household % 2 || c.duplicate % 2 || c.sibling % 3) throw new Error("linked groups must be whole");
  const town = () => [(rnd() - 0.5) * 4000, (rnd() - 0.5) * 4000] as XY;
  const centre = () => [(rnd() - 0.5) * 1600, (rnd() - 0.5) * 1600] as XY;
  // Two public routes per seed: a park loop and an out-and-back canal path.
  const park = loop(rnd, centre(), 450);
  const canalA = town(), canalB: XY = [canalA[0] + uniform(rnd, -2500, 2500), canalA[1] + uniform(rnd, -800, 800)];
  const canal: XY[] = [canalA, canalB, canalA];
  // Offices where drifting phones sit (shared with commuters' work area).
  const offices: XY[] = Array.from({ length: 3 }, centre);
  const ringBase = loop(rnd, town(), 400);

  const walkers: Walker1003[] = [];
  for (const cohort of COHORTS_1003) {
    const size = cohort === "sibling" ? 3 : cohort === "household" || cohort === "duplicate" ? 2 : 1;
    for (let i = 0; i < c[cohort]; i++) {
      const id = `${cohort}-${i}`;
      const g = size > 1 ? `${cohort}-g${Math.floor(i / size)}` : null;
      if (size > 1 && i % size !== 0) {
        const lead = walkers[walkers.length - 1]!;
        walkers.push({ ...lead, id });
        continue;
      }
      const home = town();
      let work: XY | null = null;
      let route: XY[];
      if (cohort === "commuter" || cohort === "transit") {
        work = centre();
        route = [home, [work[0], home[1]], work];
      } else if (cohort === "shared") route = rnd() < 0.5 ? park : canal;
      else if (cohort === "ring") route = ringBase;
      else if (cohort === "drift") {
        work = offices[Math.floor(rnd() * offices.length)]!;
        route = [work];
      } else route = loop(rnd, home, uniform(rnd, 350, 700));
      walkers.push({ id, cohort, home, group: g, route, work });
    }
  }
  const honestHomes = walkers.filter((w) => HONEST_1003.includes(w.cohort)).map((w) => w.home);
  const target = () => honestHomes[Math.floor(rnd() * honestHomes.length)]!;
  const sessions: Session1003[] = [];
  const push = (w: Walker1003, fixes: PathFix[], uploadAfterMs: number, receivedMs?: number) => {
    if (fixes.length < 2) return;
    const endMs = fixes[fixes.length - 1]!.timestamp;
    sessions.push({ walker: w.id, cohort: w.cohort, startMs: fixes[0]!.timestamp, endMs, receivedMs: receivedMs ?? endMs + uploadAfterMs, fixes });
  };
  const walk = (w: Walker1003, xy: readonly XY[], startMs: number, opts: TraceOpts, uploadAfterMs: number) =>
    push(w, trace(rnd, xy, spec.origin, startMs, opts), uploadAfterMs);
  const up = () => uniform(rnd, 1, 5) * MIN;
  const byGroup = new Map<string, Walker1003[]>();
  for (const w of walkers) if (w.group) (byGroup.get(w.group) ?? byGroup.set(w.group, []).get(w.group)!).push(w);
  // Attack targets change every two days, so an attacker returns to the same ground the next day.
  const attackTargets = new Map<string, XY[]>();
  const tourFor = (w: Walker1003, d: number, n: number, k: number) => {
    const key = `${w.id}:${k}`;
    if (d % 2 === 0 || !attackTargets.has(key)) attackTargets.set(key, Array.from({ length: n }, target));
    const t = attackTargets.get(key)!;
    return [...t, t[0]!];
  };

  for (let d = 0; d < spec.days; d++) {
    const day = day0 + d;
    const base = day * DAY_MS;
    const weekend = [0, 6].includes((day + 4) % 7);
    for (const w of walkers) {
      switch (w.cohort) {
        case "commuter":
          if (!weekend && rnd() < 0.85) {
            walk(w, w.route, base + uniform(rnd, 7, 9) * H, { noiseM: 6 }, up());
            walk(w, [...w.route].reverse(), base + uniform(rnd, 16.5, 18.5) * H, { noiseM: 6 }, up());
          } else if (weekend && rnd() < 0.35) walk(w, loop(rnd, w.home, uniform(rnd, 300, 700)), base + uniform(rnd, 9, 18) * H, { noiseM: 6 }, up());
          break;
        case "runner":
          // 3 m/s, 6-12 km loops, about four days a week.
          if (rnd() < 0.55) walk(w, loop(rnd, w.home, uniform(rnd, 1000, 2000)), base + (rnd() < 0.5 ? uniform(rnd, 6, 8) : uniform(rnd, 18, 20)) * H, { noiseM: 6, speedMps: 3 }, up());
          break;
        case "loop":
          if (rnd() < 0.75) {
            const s = uniform(rnd, 6, 17);
            walk(w, w.route, base + s * H, { noiseM: 6 }, up());
            if (rnd() < 0.2) walk(w, w.route, base + Math.min(21.5, s + uniform(rnd, 3, 6)) * H, { noiseM: 6 }, up());
          }
          break;
        case "long":
          if (rnd() < 0.45) walk(w, loop(rnd, w.home, uniform(rnd, 1800, 3500)), base + uniform(rnd, 7, 9.5) * H, { noiseM: 6 }, up());
          break;
        case "shared":
          // Unrelated walkers on the same public route at their own times.
          if (rnd() < 0.6) walk(w, w.route, base + uniform(rnd, 6, 21) * H, { noiseM: 6 }, up());
          break;
        case "transit":
          // Walk to the stop, a bus leg at 8 m/s that passes verification (ASSUMPTION, see limits), walk to work; and back.
          if (!weekend && rnd() < 0.85) {
            for (const [from, to, at] of [[w.home, w.work!, uniform(rnd, 7, 9)], [w.work!, w.home, uniform(rnd, 16.5, 18.5)]] as const) {
              const s1: XY = [from[0] + (to[0] - from[0]) * 0.1, from[1] + (to[1] - from[1]) * 0.1];
              const s2: XY = [from[0] + (to[0] - from[0]) * 0.9, from[1] + (to[1] - from[1]) * 0.9];
              const a = trace(rnd, [from, s1], spec.origin, base + at * H, { noiseM: 6 });
              const bus = trace(rnd, [s1, s2], spec.origin, a[a.length - 1]!.timestamp + 5 * MIN, { noiseM: 10, speedMps: 8 });
              const c2 = trace(rnd, [s2, to], spec.origin, bus[bus.length - 1]!.timestamp + MIN, { noiseM: 6 });
              push(w, [...a, ...bus, ...c2], up());
            }
          }
          break;
        case "drift": {
          // A phone left on a desk: 30-90 min of 15 m random wander round one office point, on most weekdays.
          if (!weekend && rnd() < 0.8) {
            const start = base + uniform(rnd, 9, 15) * H;
            const n = Math.round(uniform(rnd, 30, 90) * 6);
            let x = 0, y = 0;
            const fixes: PathFix[] = [];
            for (let k = 0; k < n; k++) {
              x = 0.9 * x + (rnd() - 0.5) * 12;
              y = 0.9 * y + (rnd() - 0.5) * 12;
              fixes.push(toFix(spec.origin, w.work![0] + x, w.work![1] + y, start + k * 10_000));
            }
            push(w, fixes, up());
          }
          break;
        }
        case "household":
        case "sibling":
        case "duplicate": {
          const g = byGroup.get(w.group!)!;
          if (g[0]!.id !== w.id) break; // the group is generated once, from its first member
          if (w.cohort === "duplicate") {
            // One person carrying two phones signed in to two accounts: every walk recorded twice.
            if (rnd() < 0.75) {
              const route = rnd() < 0.5 ? w.route : loop(rnd, w.home, uniform(rnd, 300, 800));
              const s = base + uniform(rnd, 7, 20) * H;
              for (const m of g) walk(m, route, s + uniform(rnd, 0, 10) * 1000, { noiseM: 6 }, up());
            }
            break;
          }
          if (rnd() >= (w.cohort === "sibling" ? 0.7 : 0.75)) break;
          if (rnd() < (w.cohort === "sibling" ? 0.5 : 0.7)) {
            const route = rnd() < 0.5 ? w.route : loop(rnd, w.home, uniform(rnd, 300, 800));
            const s = base + uniform(rnd, 7, 20) * H;
            const order = [...g];
            for (let k = order.length - 1; k > 0; k--) {
              const j = Math.floor(rnd() * (k + 1));
              [order[k], order[j]] = [order[j]!, order[k]!];
            }
            for (const m of order) walk(m, route, s + uniform(rnd, 0, 4) * MIN, { noiseM: 6 }, up());
          } else for (const m of g) if (rnd() < 0.5) walk(m, loop(rnd, m.home, uniform(rnd, 300, 700)), base + uniform(rnd, 7, 20) * H, { noiseM: 6 }, up());
          break;
        }
        case "malicious": {
          // A daytime tour through six honest homes, repeated the next day; and the midnight straddle round one home.
          walk(w, tourFor(w, d, 6, 0), base + uniform(rnd, 9, 10) * H, { noiseM: 6 }, MIN);
          const short = loop(rnd, target(), 350);
          walk(w, short, base + 23.4 * H, { noiseM: 6 }, MIN);
          if (d < spec.days - 1) walk(w, short, base + DAY_MS + 0.05 * H, { noiseM: 6 }, MIN);
          break;
        }
        case "spoofer": {
          // Fabricated traces that pass verification: three tours of four honest homes, each repeated the next day …
          [uniform(rnd, 8, 9), uniform(rnd, 12, 13), uniform(rnd, 17, 18)].forEach((s, k) => walk(w, tourFor(w, d, 4, k), base + s * H, { noiseM: 3 }, 30_000));
          // … and the grace backdate across midnight.
          if (d < spec.days - 1) {
            const short = loop(rnd, target(), 350);
            const upload = base + DAY_MS + uniform(rnd, 0.9, 1.4) * H;
            const a = trace(rnd, short, spec.origin, base + 23.3 * H, { noiseM: 3 });
            const b = trace(rnd, short, spec.origin, base + DAY_MS + 0.08 * H, { noiseM: 3 });
            push(w, a, 0, upload);
            push(w, b, 0, Math.max(upload, b[b.length - 1]!.timestamp) + MIN);
          }
          break;
        }
        case "ring": {
          // Unlinked accounts acting together: each walks the shared base loop every day (they trade it among
          // themselves, farming flips), and each tours four honest homes of its own, repeated the next day.
          walk(w, w.route, base + uniform(rnd, 7, 21) * H, { noiseM: 5 }, MIN);
          walk(w, tourFor(w, d, 4, 0), base + uniform(rnd, 10, 11) * H, { noiseM: 5 }, MIN);
          break;
        }
      }
    }
  }
  sessions.sort((x, y) => x.receivedMs - y.receivedMs || (x.walker < y.walker ? -1 : x.walker > y.walker ? 1 : x.endMs - y.endMs));
  return { walkers, sessions };
}
