/**
 * Seeded synthetic corpus for the stationary-risk rule (stationary-risk/v1).
 *
 * SYNTHETIC / NOT LIVE. Every route is built from a seed in an open-ocean
 * frame; none is a recording, a person or a place. Nothing here is evidence of
 * how a real phone behaves: the error model below is an assumption, stated so
 * the measured rates can be read against it.
 *
 * Assumptions (also in docs/play-launch/STATIONARY_RISK_RULE_28OCT.md):
 *  - true position error is an AR(1) process per second, per axis, with spread
 *    `sigmaM` and correlation `rho`;
 *  - honest routes report an accuracy about 2.5x their real one-axis error
 *    (accuracy 8 m for sigma 3.2 m), the S03 family reports LESS than its real
 *    error (accuracy 6 m for sigma 15 m: multipath the receiver does not see);
 *  - the OS delivers a fix at most every 4 s and only after 5 m of reported
 *    displacement, as the session watch is configured (trackingConfig.ts);
 *  - every delivered fix goes through the real shared `inspectFix` against the
 *    last accepted fix, exactly as the session screen does; accepted fixes are
 *    the upload.
 */
import { inspectFix } from "@movenrun/shared/measurement";
import { DEFAULT_MOVEMENT_MODE, SESSION_RULES_VERSION } from "@movenrun/shared/session";

import type { MovementObservation, ObservedPoint } from "../domain/types.js";

const ORIGIN = { lat: -0.75, lng: -24.5 };
const M_PER_DEG = 111_320;
const EPOCH = Date.UTC(2026, 9, 1, 8, 0, 0);
const WATCH_INTERVAL_S = 4;
const WATCH_DISTANCE_M = 5;

export interface Xy { x: number; y: number }
export type CorpusLeg = { kind: "still"; seconds: number } | { kind: "move"; path: Xy[]; speedMps: number };
/** Reported accuracy and real error for a window of seconds from the start. */
export interface AccuracyWindow { from: number; to: number; accuracyM: number; sigmaM: number }

export interface CorpusScenario {
  seed: number;
  legs: CorpusLeg[];
  accuracyM: number;
  sigmaM: number;
  rho?: number;
  windows?: AccuracyWindow[];
}

export type CorpusTruth = "stationary" | "honest" | "stress";

export interface CorpusFamily {
  name: string;
  truth: CorpusTruth;
  scenario: (seed: number) => CorpusScenario;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function along(path: readonly Xy[], s: number): Xy {
  let remaining = s;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (remaining <= length && length > 0) return { x: a.x + (b.x - a.x) * remaining / length, y: a.y + (b.y - a.y) * remaining / length };
    remaining -= length;
  }
  return path[path.length - 1]!;
}

function lengthOf(path: readonly Xy[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
  return total;
}

/** Truth at 1 Hz by arc length, legs in order. */
function truth(legs: readonly CorpusLeg[]): Xy[] {
  const out: Xy[] = [];
  let at: Xy = { x: 0, y: 0 };
  for (const leg of legs) {
    if (leg.kind === "still") {
      for (let s = 0; s < leg.seconds; s++) out.push(at);
      continue;
    }
    const shifted = leg.path.map((p) => ({ x: p.x - leg.path[0]!.x + at.x, y: p.y - leg.path[0]!.y + at.y }));
    const total = lengthOf(shifted);
    for (let s = 0; s * leg.speedMps < total; s++) out.push(along(shifted, s * leg.speedMps));
    at = shifted[shifted.length - 1]!;
  }
  out.push(at);
  return out;
}

export interface CapturedRoute {
  observation: MovementObservation;
  /** A server clock a few seconds after the finish. */
  now: number;
  truthMeters: number;
}

/** Run a scenario through the watch cadence and the real capture rule. */
export function captureRoute(scenario: CorpusScenario): CapturedRoute {
  const random = mulberry32(scenario.seed);
  const gaussian = () => Math.sqrt(-2 * Math.log(Math.max(random(), 1e-12))) * Math.cos(2 * Math.PI * random());
  const rho = scenario.rho ?? 0.8;
  const innovation = Math.sqrt(1 - rho * rho);
  const positions = truth(scenario.legs);
  const accepted: ObservedPoint[] = [];
  let ex = 0, ey = 0;
  let lastDelivered: { t: number; x: number; y: number } | null = null;
  let truthMeters = 0;
  for (let s = 0; s < positions.length; s++) {
    const window = scenario.windows?.find((w) => s >= w.from && s < w.to);
    const sigma = window?.sigmaM ?? scenario.sigmaM;
    const accuracy = window?.accuracyM ?? scenario.accuracyM;
    ex = rho * ex + innovation * sigma * gaussian();
    ey = rho * ey + innovation * sigma * gaussian();
    if (s > 0) truthMeters += Math.hypot(positions[s]!.x - positions[s - 1]!.x, positions[s]!.y - positions[s - 1]!.y);
    const x = positions[s]!.x + ex, y = positions[s]!.y + ey;
    if (lastDelivered && s - lastDelivered.t < WATCH_INTERVAL_S) continue;
    if (lastDelivered && Math.hypot(x - lastDelivered.x, y - lastDelivered.y) < WATCH_DISTANCE_M) continue;
    lastDelivered = { t: s, x, y };
    const fix: ObservedPoint = {
      lat: ORIGIN.lat + y / M_PER_DEG,
      lng: ORIGIN.lng + x / (M_PER_DEG * Math.cos((ORIGIN.lat * Math.PI) / 180)),
      accuracy,
      timestamp: EPOCH + s * 1000,
    };
    const prior = accepted[accepted.length - 1] ?? null;
    const decision = inspectFix(
      prior && { latitude: prior.lat, longitude: prior.lng, timestamp: prior.timestamp, accuracy: prior.accuracy },
      { latitude: fix.lat, longitude: fix.lng, timestamp: fix.timestamp, accuracy: fix.accuracy },
      fix.timestamp + 300,
    );
    if (decision.accepted) accepted.push(fix);
  }
  const startTime = accepted[0]?.timestamp ?? EPOCH;
  const endTime = accepted[accepted.length - 1]?.timestamp ?? EPOCH;
  const finishedAt = EPOCH + positions.length * 1000;
  return {
    observation: {
      startTime, endTime, points: accepted,
      session: { mode: DEFAULT_MOVEMENT_MODE, rulesVersion: SESSION_RULES_VERSION, startedAt: EPOCH - 1_000, finishedAt, pauses: [] },
    },
    now: finishedAt + 5_000,
    truthMeters,
  };
}

/* ── shapes, in metres east/north ─────────────────────────────────────────── */

export const line = (metres: number): Xy[] => [{ x: 0, y: 0 }, { x: metres, y: 0 }];
export function circle(circumference: number, laps: number): Xy[] {
  const r = circumference / (2 * Math.PI);
  const out: Xy[] = [];
  for (let i = 0; i <= Math.ceil(72 * laps); i++) {
    const a = (i / 72) * 2 * Math.PI;
    out.push({ x: r * Math.sin(a), y: r - r * Math.cos(a) });
  }
  return out;
}
/** A 400 m oval: two 84.39 m straights joined by 36.5 m radius bends. */
export function track400(laps: number): Xy[] {
  const r = 36.5, straight = 84.39;
  const lap: Xy[] = [{ x: 0, y: 0 }, { x: straight, y: 0 }];
  for (let i = 1; i <= 36; i++) { const a = (i / 36) * Math.PI; lap.push({ x: straight + r * Math.sin(a), y: r - r * Math.cos(a) }); }
  lap.push({ x: 0, y: 2 * r });
  for (let i = 1; i <= 36; i++) { const a = (i / 36) * Math.PI; lap.push({ x: -r * Math.sin(a), y: r + r * Math.cos(a) }); }
  const out: Xy[] = [];
  for (let l = 0; l < laps; l++) out.push(...(l === 0 ? lap : lap.slice(1)));
  return out;
}
export function block(width: number, height: number, laps: number): Xy[] {
  const lap = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }, { x: 0, y: 0 }];
  const out: Xy[] = [];
  for (let l = 0; l < laps; l++) out.push(...(l === 0 ? lap : lap.slice(1)));
  return out;
}
export const shuttle = (metres: number, legs: number): Xy[] =>
  Array.from({ length: legs + 1 }, (_, i) => ({ x: i % 2 ? metres : 0, y: 0 }));

const still = (seconds: number): CorpusLeg => ({ kind: "still", seconds });
const move = (path: Xy[], speedMps: number): CorpusLeg => ({ kind: "move", path, speedMps });
/** Honest accuracy: reported 8 m for 3.2 m real spread, or 5 m for 2 m, alternating by seed. */
const honest = (seed: number, legs: CorpusLeg[]): CorpusScenario =>
  ({ seed, legs: [still(15), ...legs, still(5)], accuracyM: seed % 2 ? 5 : 8, sigmaM: seed % 2 ? 2 : 3.2 });

/** The families the rule doc reports. Stationary first, then honest, then stress. */
export const CORPUS: readonly CorpusFamily[] = [
  ...([[6, 15, 0.95, 300], [6, 15, 0.95, 600], [5, 10, 0.95, 600], [8, 12, 0.9, 600], [10, 20, 0.95, 600],
    [4, 8, 0.95, 300], [3, 6, 0.9, 300], [15, 25, 0.95, 600], [6, 15, 0.98, 600], [8, 8, 0.8, 600],
    [6, 15, 0.95, 120], [6, 15, 0.95, 180], [6, 15, 0.95, 1200]] as const).map(([accuracyM, sigmaM, rho, seconds]) => ({
    name: `still ${seconds}s, accuracy ${accuracyM} m, real error ${sigmaM} m, rho ${rho}`,
    truth: "stationary" as const,
    scenario: (seed: number): CorpusScenario => ({ seed, legs: [still(seconds + 15)], accuracyM, sigmaM, rho }),
  })),
  ...[100, 200, 300, 400].flatMap((lap) => ([["walk", 1.4], ["jog", 2.8], ["run", 4.0]] as const).map(([pace, v]) => ({
    name: `loop ${lap} m, ${pace} ${v} m/s`,
    truth: "honest" as const,
    scenario: (seed: number) => honest(seed, [move(circle(lap, Math.max(2, Math.ceil(1200 / lap))), v)]),
  }))),
  { name: "400 m track, 5.5 m/s, 4 laps", truth: "honest", scenario: (seed) => honest(seed, [move(track400(4), 5.5)]) },
  { name: "400 m track, walk, 2 laps", truth: "honest", scenario: (seed) => honest(seed, [move(track400(2), 1.4)]) },
  { name: "400 m track, 5.5 m/s, accuracy 12 m", truth: "honest",
    scenario: (seed) => ({ ...honest(seed, [move(track400(4), 5.5)]), accuracyM: 12, sigmaM: 5 }) },
  { name: "stop/start walk, two stops (120 s, 60 s)", truth: "honest",
    scenario: (seed) => honest(seed, [move(line(300), 1.4), still(120), move(block(80, 80, 1), 1.4), still(60), move(line(200), 1.4)]) },
  { name: "stop/start track intervals, 90 s rests", truth: "honest",
    scenario: (seed) => honest(seed, [move(track400(1), 4.5), still(90), move(track400(1), 4.5), still(90), move(track400(1), 4.5)]) },
  { name: "slow walk 0.5 m/s, 250 m", truth: "honest", scenario: (seed) => honest(seed, [move(line(250), 0.5)]) },
  { name: "slow walk 0.8 m/s, 100 m block", truth: "honest", scenario: (seed) => honest(seed, [move(block(100, 100, 1), 0.8)]) },
  { name: "urban canyon, accuracy 20 m, 800 m", truth: "honest",
    scenario: (seed) => ({ ...honest(seed, [move(line(800), 1.4)]), accuracyM: 20, sigmaM: 8 }) },
  { name: "urban canyon, accuracy 20 m, real 12 m, 800 m", truth: "honest",
    scenario: (seed) => ({ ...honest(seed, [move(line(800), 1.4)]), accuracyM: 20, sigmaM: 12, rho: 0.9 }) },
  { name: "urban canyon block x3, accuracy 20 m", truth: "honest",
    scenario: (seed) => ({ ...honest(seed, [move(block(100, 100, 3), 1.4)]), accuracyM: 20, sigmaM: 8 }) },
  { name: "canyon section: 2 min at accuracy 35 m in a 900 m walk", truth: "honest",
    scenario: (seed) => ({ ...honest(seed, [move(line(900), 1.4)]), windows: [{ from: 200, to: 320, accuracyM: 35, sigmaM: 15 }] }) },
  { name: "loop 100 m walk, accuracy 12 m", truth: "honest",
    scenario: (seed) => ({ ...honest(seed, [move(circle(100, 10), 1.4)]), accuracyM: 12, sigmaM: 5 }) },
  { name: "out-and-back 300 m walk", truth: "honest", scenario: (seed) => honest(seed, [move([{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 0, y: 0 }], 1.4)]) },
  { name: "shuttle 50 m x12 run", truth: "honest", scenario: (seed) => honest(seed, [move(shuttle(50, 12), 3.5)]) },
  { name: "W04-like 220 m walk, accuracy 15 m", truth: "honest",
    scenario: (seed) => ({ ...honest(seed, [move(line(220), 1.4)]), accuracyM: 15, sigmaM: 5 }) },
  { name: "I02-like walk, 1.8 km bus leg at 15 m/s, walk", truth: "honest",
    scenario: (seed) => honest(seed, [move(line(150), 1.4), move(line(1800), 15), move(line(150), 1.4)]) },
  { name: "STRESS honest 600 m walk under multipath (accuracy 6 m, real 15 m)", truth: "stress",
    scenario: (seed) => ({ seed, legs: [still(15), move(line(600), 1.4), still(5)], accuracyM: 6, sigmaM: 15, rho: 0.95 }) },
  { name: "STRESS honest 200 m loop walk under multipath (accuracy 6 m, real 15 m)", truth: "stress",
    scenario: (seed) => ({ seed, legs: [still(15), move(circle(200, 4), 1.4), still(5)], accuracyM: 6, sigmaM: 15, rho: 0.95 }) },
  { name: "STRESS walk with a 5 min multipath stop mid-route", truth: "stress",
    scenario: (seed) => ({ seed, legs: [still(15), move(line(600), 1.4), still(300), move(line(600), 1.4), still(5)], accuracyM: 8, sigmaM: 3,
      rho: 0.95, windows: [{ from: 445, to: 745, accuracyM: 6, sigmaM: 15 }] }) },
];

/** Seed for run `i` of a family (stable across runs and machines). */
export const corpusSeed = (family: CorpusFamily, i: number) => 0x5eed + i * 7919 + family.name.length * 131;
