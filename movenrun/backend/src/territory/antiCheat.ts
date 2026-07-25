/**
 * Risk-based anti-cheat for submitted routes.
 *
 * ## Why risk, not a boolean
 * GPS is noisy. A tunnel, a dense city block, a phone in a pocket, a cold start
 * — all of these produce anomalies that look exactly like a small fake. A single
 * hard threshold therefore either bans honest runners or lets real fakes
 * through. This scores signals into a risk total and maps that to one of four
 * verdicts, so an ambiguous route can be held for review instead of punished.
 *
 * **One ambiguous anomaly must never permanently ban anyone.** The strongest
 * verdict a single soft signal can reach is `needsReview`.
 *
 * ## The mocked-location flag
 * `RouteSample.mocked` (Android's `isMocked`) is advisory. A device that is
 * lying about its location can equally lie about the flag, so it *raises* risk
 * but is never sufficient on its own — every verdict at or above `rejected`
 * requires a physics signal the client cannot fake without also faking a
 * self-consistent route.
 *
 * ## What this does not replace
 * The server-side route hash and per-wallet time-overlap dedup in
 * `route.service.ts` remain the authoritative replay protection. This module
 * adds signals; it removes nothing.
 */
import type { TerritoryConfig } from "./config.js";
import { assessRouteQuality, type RouteQualityFindings } from "./capture.js";
import type { GeoPoint } from "./geometry.js";

export type RiskVerdict = "accepted" | "acceptedWithWarnings" | "needsReview" | "rejected";

export type RiskSignal =
  | "impossibleSpeed"
  | "impossibleAcceleration"
  | "teleportation"
  | "poorAccuracy"
  | "repeatedIdenticalPoints"
  | "timestampReversal"
  | "unrealisticStraightLine"
  | "vehicleLikeMovement"
  | "mockedLocationReported"
  | "excessiveBackgroundGap"
  | "invalidCoordinateRange"
  | "deviceIntegrityFailed";

export interface RiskFinding {
  signal: RiskSignal;
  /** How many samples/segments exhibited it. */
  count: number;
  /** Contribution to the risk total. */
  weight: number;
}

export interface RiskAssessment {
  verdict: RiskVerdict;
  score: number;
  findings: RiskFinding[];
  /** The raw quality traversal, reused from capture evaluation. */
  quality: RouteQualityFindings;
}

/**
 * Signal weights. A "hard" signal is one the laws of physics rule out; a "soft"
 * signal is one a bad GPS day can produce. Only hard signals can push a route
 * to `rejected` on their own.
 */
export const RISK_WEIGHTS: Record<RiskSignal, { weight: number; hard: boolean }> = {
  // Hard: physically impossible for the claimed activity.
  impossibleSpeed: { weight: 45, hard: true },
  impossibleAcceleration: { weight: 40, hard: true },
  teleportation: { weight: 50, hard: true },
  timestampReversal: { weight: 45, hard: true },
  invalidCoordinateRange: { weight: 60, hard: true },

  // Soft: suspicious, but reachable by honest hardware.
  poorAccuracy: { weight: 10, hard: false },
  repeatedIdenticalPoints: { weight: 12, hard: false },
  unrealisticStraightLine: { weight: 18, hard: false },
  vehicleLikeMovement: { weight: 25, hard: false },
  mockedLocationReported: { weight: 30, hard: false },
  excessiveBackgroundGap: { weight: 8, hard: false },
  deviceIntegrityFailed: { weight: 20, hard: false },
};

export const RISK_THRESHOLDS = {
  /** At or above: hold for human/automated review. */
  needsReview: 30,
  /** At or above, AND at least one hard signal: reject. */
  rejected: 60,
} as const;

export interface AntiCheatInput {
  points: GeoPoint[];
  /** Any sample reported the platform mocked-location flag. */
  mockedLocationReported?: boolean;
  /** A device-integrity attestation was requested and failed. */
  deviceIntegrityFailed?: boolean;
  /** Longest gap in ms with no samples — a backgrounded or killed app. */
  longestGapMs?: number;
  /** Gap beyond which a run is considered to have holes. Default 5 minutes. */
  maxAcceptableGapMs?: number;
}

/**
 * Longest run of consecutive samples that lie on an almost perfectly straight
 * line at an almost constant speed. Real running does neither for long; a
 * synthesised route does both by construction.
 */
function longestSyntheticRun(points: GeoPoint[]): number {
  if (points.length < 5) return 0;
  let longest = 0;
  let current = 0;

  for (let i = 2; i < points.length; i++) {
    const a = points[i - 2];
    const b = points[i - 1];
    const c = points[i];
    if (a.timestamp == null || b.timestamp == null || c.timestamp == null) continue;

    const bearing1 = Math.atan2(c.lng - b.lng, c.lat - b.lat);
    const bearing2 = Math.atan2(b.lng - a.lng, b.lat - a.lat);
    let turn = Math.abs(bearing1 - bearing2);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;

    const dt1 = (b.timestamp - a.timestamp) / 1000;
    const dt2 = (c.timestamp - b.timestamp) / 1000;
    const consistentCadence = dt1 > 0 && dt2 > 0 && Math.abs(dt1 - dt2) < 0.05;

    // Under ~0.6° of turn AND a metronomic sample interval.
    if (turn < 0.01 && consistentCadence) {
      current += 1;
      if (current > longest) longest = current;
    } else {
      current = 0;
    }
  }
  return longest;
}

/** Segments whose speed change implies acceleration a human cannot produce. */
function impossibleAccelerationCount(points: GeoPoint[]): number {
  // ~4 m/s² sustained is beyond human sprint acceleration.
  const MAX_ACCELERATION = 4;
  let count = 0;
  let previousSpeed: number | null = null;

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a.timestamp == null || b.timestamp == null) continue;
    const dt = (b.timestamp - a.timestamp) / 1000;
    if (dt <= 0) continue;

    const dLat = (b.lat - a.lat) * 111_320;
    const dLng = (b.lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
    const speed = Math.hypot(dLat, dLng) / dt;

    if (previousSpeed !== null && Math.abs(speed - previousSpeed) / dt > MAX_ACCELERATION) {
      count += 1;
    }
    previousSpeed = speed;
  }
  return count;
}

/**
 * Assess a route's risk. Pure: no clock, no I/O, no persistence — the caller
 * decides what to do with the verdict.
 */
export function assessRouteRisk(
  input: AntiCheatInput,
  config: TerritoryConfig,
): RiskAssessment {
  const { points } = input;
  const quality = assessRouteQuality(points, config);
  const findings: RiskFinding[] = [];

  const add = (signal: RiskSignal, count: number): void => {
    if (count <= 0) return;
    findings.push({ signal, count, weight: RISK_WEIGHTS[signal].weight });
  };

  add("invalidCoordinateRange", quality.invalidCoordinateCount);
  add("timestampReversal", quality.timestampReversalCount);
  add("impossibleSpeed", quality.impossibleSpeedCount);
  add("teleportation", quality.impossibleJumpCount);
  add("impossibleAcceleration", impossibleAccelerationCount(points));
  add("repeatedIdenticalPoints", quality.identicalPointRuns > points.length * 0.2 ? quality.identicalPointRuns : 0);

  // Poor accuracy only counts once the share exceeds the configured tolerance.
  if (quality.poorAccuracyRatio > config.maxPoorAccuracyRatio) {
    add("poorAccuracy", quality.poorAccuracyCount);
  }

  const syntheticRun = longestSyntheticRun(points);
  // 12 consecutive perfectly-straight, metronomic samples is not a person.
  add("unrealisticStraightLine", syntheticRun >= 12 ? syntheticRun : 0);

  // Sustained speed well past a sprint but below the outright-impossible
  // threshold reads as a vehicle. Half again the configured ceiling.
  if (
    quality.maxObservedSpeedMetersPerSecond > config.maxSpeedMetersPerSecond * 1.5 &&
    quality.impossibleSpeedCount === 0
  ) {
    add("vehicleLikeMovement", 1);
  }

  if (input.mockedLocationReported) add("mockedLocationReported", 1);
  if (input.deviceIntegrityFailed) add("deviceIntegrityFailed", 1);

  const maxGap = input.maxAcceptableGapMs ?? 5 * 60_000;
  if ((input.longestGapMs ?? 0) > maxGap) add("excessiveBackgroundGap", 1);

  const score = findings.reduce((total, finding) => total + finding.weight, 0);
  const hasHardSignal = findings.some((f) => RISK_WEIGHTS[f.signal].hard);

  let verdict: RiskVerdict;
  if (score >= RISK_THRESHOLDS.rejected && hasHardSignal) {
    verdict = "rejected";
  } else if (score >= RISK_THRESHOLDS.needsReview) {
    // A route can reach this from soft signals alone. That is the point:
    // ambiguity is held for review, never punished outright.
    verdict = "needsReview";
  } else if (findings.length > 0) {
    verdict = "acceptedWithWarnings";
  } else {
    verdict = "accepted";
  }

  return { verdict, score, findings, quality };
}

/** Whether a verdict still permits territory to be awarded. */
export function permitsCapture(verdict: RiskVerdict): boolean {
  return verdict === "accepted" || verdict === "acceptedWithWarnings";
}

/** Whether the run's evidence was weak enough that rewards should be damped. */
export function isDegradedQuality(assessment: RiskAssessment): boolean {
  return assessment.verdict === "acceptedWithWarnings";
}
