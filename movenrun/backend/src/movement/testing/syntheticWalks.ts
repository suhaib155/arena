/**
 * Deterministic synthetic walks for movement-verification tests.
 *
 * SYNTHETIC / NOT LIVE. Every route here is built from a seed in an
 * open-ocean frame; none is a recording, a real person or a real place.
 *
 * The capture step is the real runtime rule, not a copy of it: every raw fix
 * goes through the shared `inspectFix` against the last ACCEPTED fix, a resume
 * drops the anchor and marks the next accepted fix `breakBefore`, and fixes
 * inside a pause are discarded. That is what the session screen does before a
 * route is submitted, so the accepted list below is the shape the server sees.
 */
import { inspectFix } from "@movenrun/shared/measurement";
import { DEFAULT_MOVEMENT_MODE, SESSION_RULES_VERSION, type SessionMetadata } from "@movenrun/shared/session";

import type { MovementObservation, ObservedPoint } from "../domain/types.js";

/** Open Atlantic, far from any coastline. */
const ORIGIN = { lat: 0.25, lng: -25 };
const M_PER_DEG = 111_320;

export type Leg =
  | { kind: "still"; seconds: number }
  /** Walk along a polyline of [east, north] metres relative to the leg's start. */
  | { kind: "move"; path: [number, number][]; speedMps: number };

export interface WalkScenario {
  seed: number;
  epochMs: number;
  legs: Leg[];
  /** Reported horizontal accuracy on every fix. */
  accuracyM: number;
  /** Real (hidden) position error, one sigma, in metres. */
  sigmaM: number;
  /** AR(1) correlation of the real error between consecutive fixes (0..1). */
  errorCorrelation?: number;
  /** Pauses as seconds since the first fix: [start, end). */
  pauses?: [number, number][];
}

export const line = (metres: number): [number, number][] => [[0, 0], [metres, 0]];

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

function toLatLng(east: number, north: number) {
  return {
    lat: ORIGIN.lat + north / M_PER_DEG,
    lng: ORIGIN.lng + east / (M_PER_DEG * Math.cos(ORIGIN.lat * Math.PI / 180)),
  };
}

/** True positions at 1 Hz. */
function truePath(legs: Leg[]): [number, number][] {
  const out: [number, number][] = [];
  let pos: [number, number] = [0, 0];
  for (const leg of legs) {
    if (leg.kind === "still") {
      for (let s = 0; s < leg.seconds; s++) out.push([...pos]);
      continue;
    }
    const base = pos;
    const pts = leg.path.map(([e, n]) => [base[0] + e, base[1] + n] as [number, number]);
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1]!, [bx, by] = pts[i]!;
      const length = Math.hypot(bx - ax, by - ay);
      const steps = Math.max(1, Math.round(length / leg.speedMps));
      for (let s = 0; s < steps; s++) out.push([ax + (bx - ax) * s / steps, ay + (by - ay) * s / steps]);
    }
    pos = pts[pts.length - 1]!;
  }
  out.push([...pos]);
  return out;
}

export interface CapturedWalk {
  /** Every raw fix the phone received, accepted or not. */
  raw: ObservedPoint[];
  /** Fixes the on-foot capture accepted — the submitted route. */
  accepted: ObservedPoint[];
  session: SessionMetadata;
  /** Ground-truth distance walked while capturing (excludes paused walking). */
  truthMeters: number;
}

export function captureWalk(scenario: WalkScenario): CapturedWalk {
  const random = mulberry32(scenario.seed);
  const gaussian = () => {
    const u = Math.max(random(), 1e-12), v = random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const rho = scenario.errorCorrelation ?? 0;
  const scale = Math.sqrt(1 - rho * rho);
  let error: [number, number] = [gaussian() * scenario.sigmaM, gaussian() * scenario.sigmaM];
  const pauses = scenario.pauses ?? [];
  const paused = (s: number) => pauses.some(([a, b]) => s >= a && s < b);

  const truth = truePath(scenario.legs);
  const raw: ObservedPoint[] = [];
  const accepted: ObservedPoint[] = [];
  let truthMeters = 0;
  let brokenAnchor = false;
  for (let s = 0; s < truth.length; s++) {
    if (s > 0) {
      error = [rho * error[0] + scale * gaussian() * scenario.sigmaM, rho * error[1] + scale * gaussian() * scenario.sigmaM];
      if (!paused(s) && !paused(s - 1)) {
        truthMeters += Math.hypot(truth[s]![0] - truth[s - 1]![0], truth[s]![1] - truth[s - 1]![1]);
      }
    }
    const [east, north] = truth[s]!;
    const { lat, lng } = toLatLng(east + error[0], north + error[1]);
    const fix: ObservedPoint = { lat, lng, accuracy: scenario.accuracyM, timestamp: scenario.epochMs + s * 1000 };
    raw.push(fix);
    if (paused(s)) { brokenAnchor = true; continue; }
    const prior = brokenAnchor ? null : accepted[accepted.length - 1] ?? null;
    const decision = inspectFix(
      prior && { latitude: prior.lat, longitude: prior.lng, timestamp: prior.timestamp, accuracy: prior.accuracy },
      { latitude: fix.lat, longitude: fix.lng, timestamp: fix.timestamp, accuracy: fix.accuracy },
      fix.timestamp,
    );
    if (!decision.accepted) continue;
    accepted.push(brokenAnchor && accepted.length > 0 ? { ...fix, breakBefore: true } : fix);
    brokenAnchor = false;
  }
  const session: SessionMetadata = {
    mode: DEFAULT_MOVEMENT_MODE,
    rulesVersion: SESSION_RULES_VERSION,
    startedAt: scenario.epochMs - 1_000,
    finishedAt: scenario.epochMs + truth.length * 1000,
    pauses: pauses.map(([a, b]) => ({ startedAt: scenario.epochMs + a * 1000 - 500, endedAt: scenario.epochMs + b * 1000 - 500 })),
  };
  return { raw, accepted, session, truthMeters };
}

/** The observation the app would submit for a captured walk. */
export function observationOf(points: ObservedPoint[], session?: SessionMetadata): MovementObservation {
  const times = points.map((p) => p.timestamp);
  return {
    startTime: Math.min(...times),
    endTime: Math.max(...times),
    points,
    ...(session ? { session } : {}),
  };
}
