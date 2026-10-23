/**
 * Deterministic synthetic fix streams for stationary-drift tests.
 *
 * SYNTHETIC, LOCAL evidence only. A walker (or a phone left still) produces a
 * fix every `interval` seconds; the reported position carries an AR(1)
 * correlated error of spread `sigma` while the phone REPORTS `accuracy`. The
 * overconfident case (Track A S03) is accuracy 6 m with sigma 15 m and
 * correlation 0.95 per second.
 *
 * `capture` replays the app's capture loop: compare against the last accepted
 * fix, drop rejected fixes and, when a guard is given, let it withhold an
 * accepted fix exactly as `mobile/app/move/session.tsx` does.
 */
import { haversineMeters } from "../../geo";
import { inspectFix, type MeasurementFix } from "../../measurement";
import { createStationaryDriftGuard } from "../../evidence";

const ORIGIN = { latitude: -30, longitude: -140 }; // open ocean
const T0 = 1_761_123_600_000;
const M = 111_320;

export interface DriftSpec {
  seed: number;
  seconds: number;
  accuracy: number;
  sigma: number;
  correlation?: number;
  interval?: number;
  /** Path as a function of seconds, metres east/north of the origin. */
  path?: (t: number) => { x: number; y: number };
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

export function fixStream(spec: DriftSpec): MeasurementFix[] {
  const rand = prng(spec.seed);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const rho = spec.correlation ?? 0.95;
  const step = Math.sqrt(1 - rho * rho) * spec.sigma;
  const interval = spec.interval ?? 4;
  const path = spec.path ?? (() => ({ x: 0, y: 0 }));
  let ex = 0, ey = 0;
  const fixes: MeasurementFix[] = [];
  for (let t = 0; t <= spec.seconds; t++) {
    ex = rho * ex + step * gauss();
    ey = rho * ey + step * gauss();
    if (t % interval !== 0) continue;
    const at = path(t);
    fixes.push({
      latitude: ORIGIN.latitude + (at.y + ey) / M,
      longitude: ORIGIN.longitude + (at.x + ex) / (M * Math.cos((ORIGIN.latitude * Math.PI) / 180)),
      timestamp: T0 + t * 1000,
      accuracy: spec.accuracy,
    });
  }
  return fixes;
}

export function capture(fixes: readonly MeasurementFix[], guarded: boolean) {
  const guard = guarded ? createStationaryDriftGuard() : null;
  const accepted: MeasurementFix[] = [];
  for (const fix of fixes) {
    const previous = accepted[accepted.length - 1] ?? null;
    const decision = inspectFix(previous, fix, fix.timestamp + 300);
    guard?.observe(fix);
    if (decision.accepted && !guard?.withholds(previous, fix)) accepted.push(fix);
  }
  let meters = 0;
  for (let i = 1; i < accepted.length; i++) meters += haversineMeters(accepted[i - 1]!, accepted[i]!);
  return { accepted, meters };
}

export const line = (speed: number) => (t: number) => ({ x: speed * t, y: 0 });
export const circle = (radius: number, speed: number) => (t: number) => {
  const a = (speed * t) / radius;
  return { x: radius * Math.sin(a), y: radius - radius * Math.cos(a) };
};
