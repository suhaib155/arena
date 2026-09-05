/** Explicitly enabled, in-memory diagnostics. Never stores coordinates or logs. */
import type { FixDecision, MeasurementFix } from "@movenrun/shared/measurement";
export const DISTANCE_DIAGNOSTIC_LIMIT = 128;
export interface DistanceDiagnostic {
  timestamp: number;
  accuracyMeters: number | null;
  nativeSpeedMetersPerSecond: number | null;
  segmentMeters: number;
  accepted: boolean;
  reason: string | null;
  localMeters: number;
  retainedPoints: number;
}
export function createDistanceDiagnostics(enabled: boolean) {
  let sessionId: string | null = null, received = 0, accepted = 0;
  let backendMeters: number | null = null;
  const entries: DistanceDiagnostic[] = [];
  return {
    reset(id: string | null = null) {
      sessionId = enabled ? id : null; received = accepted = 0; backendMeters = null; entries.length = 0;
    },
    bind(id: string | null) { if (enabled) sessionId = id; },
    record(fix: MeasurementFix, decision: FixDecision, localMeters: number, retainedPoints: number) {
      if (!enabled) return;
      received += 1; if (decision.accepted) accepted += 1;
      if (entries.length === DISTANCE_DIAGNOSTIC_LIMIT) entries.shift();
      entries.push({ timestamp: fix.timestamp, accuracyMeters: fix.accuracy,
        nativeSpeedMetersPerSecond: fix.speed ?? null, segmentMeters: decision.segmentMeters,
        accepted: decision.accepted, reason: decision.reason, localMeters, retainedPoints });
    },
    backend(id: string, meters: number | null) {
      if (enabled && id === sessionId) backendMeters = meters;
    },
    snapshot() { return { received, accepted, backendMeters, entries: entries.map((entry) => ({ ...entry })) }; },
  };
}
export const distanceDiagnostics = createDistanceDiagnostics(typeof __DEV__ !== "undefined" && __DEV__);
