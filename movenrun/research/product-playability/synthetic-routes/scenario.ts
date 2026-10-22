/**
 * Synthetic scenario model: what really happened, and what the phone reported.
 *
 * SYNTHETIC / NOT LIVE. Nothing here is a recording of a person. A scenario is
 * a seeded description of ground truth (where a synthetic walker actually was,
 * second by second) plus the ways a phone can misreport it: noise, accuracy
 * spikes, missing fixes, a teleport, a wrong system clock, a backgrounded app.
 *
 * The client and server code under test never see the ground truth; the
 * harness keeps it so a measurement can be compared with what actually moved.
 */
import { gaussian, mulberry32, type Rng } from "./prng";
import { along, lengthOf, offset, SYNTHETIC_ORIGIN, type LatLng, type Xy } from "./frame";

/** One leg of the synthetic walker's real movement. */
export type Leg =
  | { kind: "move"; path: Xy[]; speedMps: number; /** false for a vehicle leg: real displacement that is not on-foot movement. */ onFoot?: boolean }
  | { kind: "still"; seconds: number };

/** A user or operating-system event at a second offset from scenario start. */
export type ScenarioEvent =
  | { at: number; type: "pause" }
  | { at: number; type: "resume" }
  | { at: number; type: "background" }
  | { at: number; type: "foreground" }
  /** The native location watch reports an error (e.g. provider turned off). */
  | { at: number; type: "trackerError" }
  /** The OS kills the process; in-memory state is gone. */
  | { at: number; type: "processKill" }
  | { at: number; type: "finish" };

/** A window, in seconds from start, where the reported fixes are altered. */
export type Disturbance =
  | { from: number; to: number; type: "noFixes" }
  | { from: number; to: number; type: "accuracy"; accuracyM: number; sigmaM: number }
  /** Reported position jumps by (east, north) metres for the window. */
  | { from: number; to: number; type: "teleport"; eastM: number; northM: number }
  /** Native speed field reports this value (m/s). */
  | { from: number; to: number; type: "nativeSpeed"; mps: number }
  /** The phone's system clock (Date.now) is shifted by `offsetMs` from GNSS time. */
  | { from: number; to: number; type: "systemClock"; offsetMs: number }
  /** Accuracy is unknown (null) for the window. */
  | { from: number; to: number; type: "unknownAccuracy" };

export interface Scenario {
  seed: number;
  /** GNSS/UTC epoch ms at scenario second 0. */
  epochMs: number;
  origin?: LatLng;
  legs: Leg[];
  /** Baseline reported accuracy and the true positional error spread. */
  accuracyM: number;
  sigmaM: number;
  /** AR(1) correlation of the positional error per second (0 = white noise). */
  errorCorrelation?: number;
  disturbances?: Disturbance[];
  events: ScenarioEvent[];
  /** Permission state at Start. */
  permission?: "granted" | "denied" | "approximate";
  /** Location services switched off at Start. */
  servicesOff?: boolean;
  /** Delivery latency from fix time to callback, ms. */
  latencyMs?: number;
}

/** One second of ground truth and the raw sensor report for it. */
export interface SensorSample {
  second: number;
  gnssTime: number;
  systemTime: number;
  truth: Xy;
  truthMoving: boolean;
  /** The truth displacement into this second was on foot. */
  truthOnFoot: boolean;
  /** Null when no fix is produced for this second. */
  reported: {
    latitude: number;
    longitude: number;
    timestamp: number;
    accuracy: number | null;
    speed: number | null;
  } | null;
}

export function totalSeconds(s: Scenario): number {
  const legs = s.legs.reduce((sum, leg) =>
    sum + (leg.kind === "still" ? leg.seconds : Math.ceil(lengthOf(leg.path) / leg.speedMps)), 0);
  const lastEvent = s.events.reduce((m, e) => Math.max(m, e.at), 0);
  return Math.max(legs, lastEvent);
}

/** Truth position at a whole second, walking legs in order then holding still. */
function truthAt(s: Scenario, second: number): { at: Xy; moving: boolean; onFoot: boolean } {
  let t = second;
  let cursor: Xy = { x: 0, y: 0 };
  for (const leg of s.legs) {
    if (leg.kind === "still") {
      if (t < leg.seconds) return { at: cursor, moving: false, onFoot: true };
      t -= leg.seconds;
      continue;
    }
    const length = lengthOf(leg.path);
    const duration = length / leg.speedMps;
    const shifted = leg.path.map((p) => ({ x: p.x + cursor.x - leg.path[0]!.x, y: p.y + cursor.y - leg.path[0]!.y }));
    if (t < duration) return { at: along(shifted, t * leg.speedMps), moving: true, onFoot: leg.onFoot !== false };
    t -= duration;
    cursor = shifted[shifted.length - 1]!;
  }
  return { at: cursor, moving: false, onFoot: true };
}

function active<T extends Disturbance["type"]>(s: Scenario, second: number, type: T) {
  return (s.disturbances ?? []).find((d) => d.type === type && second >= d.from && second < d.to) as
    Extract<Disturbance, { type: T }> | undefined;
}

/** Ground truth and raw sensor samples, one per second. Deterministic for a seed. */
export function sample(s: Scenario): SensorSample[] {
  const rng: Rng = mulberry32(s.seed);
  const origin = s.origin ?? SYNTHETIC_ORIGIN;
  const rho = s.errorCorrelation ?? 0.8;
  let ex = 0, ey = 0;
  const out: SensorSample[] = [];
  const end = totalSeconds(s);
  for (let second = 0; second <= end; second++) {
    const { at, moving, onFoot } = truthAt(s, second);
    const prior = second > 0 ? truthAt(s, second - 1) : null;
    const accuracyWindow = active(s, second, "accuracy");
    const sigma = accuracyWindow?.sigmaM ?? s.sigmaM;
    // Correlated error: GNSS error drifts rather than jumping independently each second.
    const innovation = Math.sqrt(1 - rho * rho);
    ex = rho * ex + innovation * sigma * gaussian(rng);
    ey = rho * ey + innovation * sigma * gaussian(rng);
    const teleport = active(s, second, "teleport");
    const east = at.x + ex + (teleport?.eastM ?? 0);
    const north = at.y + ey + (teleport?.northM ?? 0);
    const gnssTime = s.epochMs + second * 1000;
    const clock = active(s, second, "systemClock");
    const systemTime = gnssTime + (clock?.offsetMs ?? 0);
    const position = offset(origin, east, north);
    const speedWindow = active(s, second, "nativeSpeed");
    const unknown = active(s, second, "unknownAccuracy");
    const reported = active(s, second, "noFixes") ? null : {
      latitude: position.latitude,
      longitude: position.longitude,
      timestamp: gnssTime,
      accuracy: unknown ? null : Math.round((accuracyWindow?.accuracyM ?? s.accuracyM) * 10) / 10,
      speed: speedWindow ? speedWindow.mps : null,
    };
    out.push({ second, gnssTime, systemTime, truth: at, truthMoving: moving, truthOnFoot: (prior?.onFoot ?? true) && onFoot, reported });
  }
  return out;
}
