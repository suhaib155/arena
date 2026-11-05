/** Foreground measurement policy v1. Quality checks do not establish human proof. */
import { haversineMeters } from "./geo";
export const ON_FOOT_MEASUREMENT_POLICY_VERSION = 1;
export const ON_FOOT_POLICY = Object.freeze({
  maxAccuracyMeters: 40,
  minDisplacementMeters: 2,
  // 43.2 km/h retains fast running but excludes the reproduced 54 km/h route.
  maxSpeedMetersPerSecond: 12,
  acquisitionAccuracyMeters: 20,
  acquisitionFixes: 3,
  acquisitionSpanMs: 8_000,
  acquisitionTimeoutMs: 30_000,
  maxFixAgeMs: 10_000,
  // Unobserved bridges (MR-A-02). A gap longer than maxFixAgeMs between two
  // accepted fixes was not followed by the sampling. It is bridged only when
  // the displacement its uncertainty cannot explain is at walking pace.
  maxBridgeSpeedMetersPerSecond: 2.5,
  // A silence this long is never bridged, whatever the displacement.
  maxBridgeGapMs: 300_000,
});
export interface MeasurementFix {
  latitude: number;
  longitude: number;
  timestamp: number;
  accuracy: number | null;
  /** Optional native speed, never an authority or distance source. */
  speed?: number | null;
}
export type FixRejection = "acquiring" | "invalid_fix" | "unknown_accuracy" | "weak_accuracy" |
  "non_increasing_time" | "stale_fix" | "future_fix" | "within_uncertainty" | "implausible_speed";
export interface FixDecision { accepted: boolean; reason: FixRejection | null; segmentMeters: number }

export function inspectFix(previous: MeasurementFix | null, next: MeasurementFix,
  receivedAt?: number): FixDecision {
  const reject = (reason: FixRejection, segmentMeters = 0): FixDecision =>
    ({ accepted: false, reason, segmentMeters });
  if (!Number.isFinite(next.latitude) || Math.abs(next.latitude) > 90 ||
    !Number.isFinite(next.longitude) || Math.abs(next.longitude) > 180 ||
    !Number.isFinite(next.timestamp) || next.timestamp <= 0 ||
    (next.accuracy !== null && (!Number.isFinite(next.accuracy) || next.accuracy < 0))) {
    return reject("invalid_fix");
  }
  if (next.accuracy === null) return reject("unknown_accuracy");
  if (next.accuracy > ON_FOOT_POLICY.maxAccuracyMeters) return reject("weak_accuracy");
  if (receivedAt !== undefined) {
    if (next.timestamp > receivedAt) return reject("future_fix");
    if (receivedAt - next.timestamp > ON_FOOT_POLICY.maxFixAgeMs) return reject("stale_fix");
  }
  if (previous && next.timestamp <= previous.timestamp) return reject("non_increasing_time");
  const segmentMeters = previous ? haversineMeters(previous, next) : 0;
  if (next.speed != null && Number.isFinite(next.speed) && next.speed > ON_FOOT_POLICY.maxSpeedMetersPerSecond) {
    return reject("implausible_speed", segmentMeters);
  }
  if (previous) {
    const speed = segmentMeters / ((next.timestamp - previous.timestamp) / 1000);
    if (speed > ON_FOOT_POLICY.maxSpeedMetersPerSecond) return reject("implausible_speed", segmentMeters);
    // Require disjoint reported uncertainty circles. Keep the accepted anchor
    // through noise so slow walking can build a measurable baseline.
    const uncertainty = (previous.accuracy ?? ON_FOOT_POLICY.maxAccuracyMeters) + next.accuracy;
    if (segmentMeters <= Math.max(ON_FOOT_POLICY.minDisplacementMeters, uncertainty)) {
      return reject("within_uncertainty", segmentMeters);
    }
  }
  return { accepted: true, reason: null, segmentMeters };
}

/** A point the bridge rule can read; accuracy is optional and capped. */
export interface BridgePoint {
  latitude: number;
  longitude: number;
  timestamp: number;
  accuracy?: number | null;
}

/**
 * True when the straight line between two consecutive accepted fixes was not
 * observed and must not count as on-foot movement: a stale anchor after a
 * rejected jump (vehicle leg), a GPS outage, or a long silence.
 *
 * Pure function of the pair, so the server applies it to uploaded points
 * without trusting any client marker. Gaps within the fix-age window are left
 * to `inspectFix`. Reported accuracy is capped at the policy maximum (missing
 * reads as the cap), so a client cannot claim a huge uncertainty to explain a
 * vehicle leg away; the cap is also the most lenient value, so measuring a
 * stretch again without accuracy never adds a break the first pass did not.
 */
export function isUnobservedBridge(previous: BridgePoint, next: BridgePoint): boolean {
  const gapMs = next.timestamp - previous.timestamp;
  if (!(gapMs > ON_FOOT_POLICY.maxFixAgeMs)) return false;
  if (gapMs > ON_FOOT_POLICY.maxBridgeGapMs) return true;
  const cap = (accuracy: number | null | undefined) =>
    accuracy != null && Number.isFinite(accuracy) && accuracy >= 0
      ? Math.min(accuracy, ON_FOOT_POLICY.maxAccuracyMeters)
      : ON_FOOT_POLICY.maxAccuracyMeters;
  const unexplained = haversineMeters(previous, next) - cap(previous.accuracy) - cap(next.accuracy);
  return unexplained / (gapMs / 1000) > ON_FOOT_POLICY.maxBridgeSpeedMetersPerSecond;
}

/** Constant-memory acquisition; these samples never become session evidence. */
export function createGpsAcquisition() {
  let first: MeasurementFix | null = null, previous: MeasurementFix | null = null, count = 0;
  return {
    push(point: MeasurementFix, receivedAt: number): boolean {
      const quality = inspectFix(null, point, receivedAt);
      if (!quality.accepted || point.accuracy! > ON_FOOT_POLICY.acquisitionAccuracyMeters) {
        first = previous = null; count = 0; return false;
      }
      if (previous) {
        if (point.timestamp <= previous.timestamp) return false;
        const seconds = (point.timestamp - previous.timestamp) / 1000;
        if (haversineMeters(previous, point) / seconds > ON_FOOT_POLICY.maxSpeedMetersPerSecond ||
          point.timestamp - previous.timestamp > ON_FOOT_POLICY.maxFixAgeMs) {
          first = previous = point; count = 1; return false;
        }
      }
      if (!first) first = point;
      previous = point; count += 1;
      return count >= ON_FOOT_POLICY.acquisitionFixes &&
        point.timestamp - first.timestamp >= ON_FOOT_POLICY.acquisitionSpanMs;
    },
  };
}
