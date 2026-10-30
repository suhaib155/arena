/**
 * Deterministic synthetic GPS routes for movement-integrity tests.
 *
 * SYNTHETIC, LOCAL evidence only: these are generated tracks, not phone
 * recordings. The generator emits raw fixes; `acceptOnFoot` then runs them
 * through the real shared `inspectFix` with the same anchor rule the app's
 * capture loop uses (compare against the last accepted fix, drop rejected
 * fixes, drop fixes while paused). What survives is what a phone uploads.
 */
import { inspectFix, type MeasurementFix } from "../../measurement";
import type { PauseInterval } from "../../session";

export const ORIGIN = { latitude: 51.5, longitude: -0.12 };
export const T0 = 1_756_000_000_000;
const M_PER_DEG_LAT = 111_320;

export type Leg =
  /** Moving at `speed` m/s for `seconds`, sampled normally. */
  | { kind: "move"; speed: number; seconds: number; heading?: number }
  /** Moving, but the receiver produces no fixes (tunnel, subway, sleep). */
  | { kind: "outage"; speed: number; seconds: number; heading?: number }
  /** Standing still; fixes keep arriving with jitter. */
  | { kind: "still"; seconds: number }
  /** User pressed Pause; may move meanwhile. Fixes arrive but are dropped. */
  | { kind: "pause"; speed: number; seconds: number; heading?: number };

export interface RouteSpec {
  seed: number;
  legs: Leg[];
  accuracy: number;
  /** Seconds between raw fixes: fixed number, or [min, max] for irregular sampling. */
  interval?: number | [number, number];
  /** Position jitter amplitude in metres (uniform, per axis). */
  jitter?: number;
  /** Raw-fix seconds (from start) replaced by a displaced spike. */
  spikes?: { atSecond: number; offsetMeters: number; accuracy: number }[];
}

export interface SyntheticRoute {
  accepted: MeasurementFix[];
  pauses: PauseInterval[];
  startedAt: number;
  finishedAt: number;
  /** Metres covered on foot in observed (non-outage, non-pause) legs moving at <= 3 m/s. */
  walkedTruthMeters: number;
  rawFixes: number;
}

function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function toCoordinate(x: number, y: number) {
  return {
    latitude: ORIGIN.latitude + y / M_PER_DEG_LAT,
    longitude: ORIGIN.longitude + x / (M_PER_DEG_LAT * Math.cos((ORIGIN.latitude * Math.PI) / 180)),
  };
}

export function buildRoute(spec: RouteSpec): SyntheticRoute {
  const rand = prng(spec.seed);
  const interval = spec.interval ?? 1;
  const jitter = spec.jitter ?? 1;
  const nextGap = () => typeof interval === "number"
    ? interval
    : interval[0] + rand() * (interval[1] - interval[0]);

  let x = 0, y = 0, t = 0; // metres, seconds
  let walked = 0;
  const raw: { fix: MeasurementFix; paused: boolean }[] = [];
  const pauses: PauseInterval[] = [];
  for (const leg of spec.legs) {
    const heading = ((leg.kind === "still" ? 0 : leg.heading ?? 0) * Math.PI) / 180;
    const speed = leg.kind === "still" ? 0 : leg.speed;
    const end = t + leg.seconds;
    if (leg.kind === "pause") pauses.push({ startedAt: T0 + Math.round(t * 1000), endedAt: T0 + Math.round(end * 1000) });
    while (t < end) {
      const step = Math.min(nextGap(), end - t);
      t += step;
      x += Math.sin(heading) * speed * step;
      y += Math.cos(heading) * speed * step;
      if (leg.kind === "move" && speed <= 3) walked += speed * step;
      if (leg.kind === "outage") continue;
      const spike = spec.spikes?.find((s) => Math.abs(s.atSecond - t) < step / 2 + 1e-9);
      const jx = (rand() * 2 - 1) * jitter, jy = (rand() * 2 - 1) * jitter;
      const position = toCoordinate(x + jx + (spike?.offsetMeters ?? 0), y + jy);
      raw.push({
        fix: { ...position, timestamp: T0 + Math.round(t * 1000), accuracy: spike?.accuracy ?? spec.accuracy },
        paused: leg.kind === "pause",
      });
    }
  }

  const accepted: MeasurementFix[] = [];
  for (const { fix, paused } of raw) {
    if (paused) continue;
    const decision = inspectFix(accepted[accepted.length - 1] ?? null, fix, fix.timestamp);
    if (decision.accepted) accepted.push(fix);
  }
  return {
    accepted,
    pauses,
    startedAt: T0,
    finishedAt: T0 + Math.round(t * 1000) + 1_000,
    walkedTruthMeters: walked,
    rawFixes: raw.length,
  };
}

/** Fixture I02 (after Track A): walk, 2 min in a vehicle at 15 m/s, walk. */
export const I02: RouteSpec = {
  seed: 202,
  accuracy: 5,
  legs: [
    { kind: "move", speed: 1.4, seconds: 107, heading: 0 },
    { kind: "move", speed: 15, seconds: 120, heading: 0 },
    { kind: "move", speed: 1.4, seconds: 107, heading: 0 },
  ],
};
