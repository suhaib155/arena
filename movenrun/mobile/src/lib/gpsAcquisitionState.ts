import { inspectFix, ON_FOOT_POLICY, type MeasurementFix } from "@movenrun/shared/measurement";

export type GpsAcquisitionState = "locating" | "improving" | "evaluating" | "ready";
export function acquisitionFixState(point: MeasurementFix, now: number): GpsAcquisitionState {
  return inspectFix(null, point, now).accepted && point.accuracy! <= ON_FOOT_POLICY.acquisitionAccuracyMeters
    ? "evaluating" : "improving";
}
export function acquisitionLabel(state: GpsAcquisitionState): string {
  return state === "locating" ? "Finding GPS" : state === "improving" ? "Improving GPS…"
    : state === "evaluating" ? "Stabilizing GPS…" : "GPS ready";
}

/** One bounded, coordinate-free development timing sample per tracker run. */
export function createGpsTimings(enabled: boolean, now = Date.now) {
  let permission: number | null = null, first: number | null = null, accepted: number | null = null, live: number | null = null;
  return {
    reset() { permission = first = accepted = live = null; },
    permission() { if (enabled) permission = now(); },
    state(state: GpsAcquisitionState) {
      if (!enabled) return;
      if (state !== "locating") first ??= now();
      if (state === "ready") accepted ??= now();
    },
    live() { if (enabled) live ??= now(); },
    snapshot() { return {
      permissionToFirstFixMs: permission !== null && first !== null ? first - permission : null,
      firstToAcceptedFixMs: first !== null && accepted !== null ? accepted - first : null,
      acceptedToLiveUiMs: accepted !== null && live !== null ? live - accepted : null,
    }; },
  };
}
export const gpsTimings = createGpsTimings(typeof __DEV__ !== "undefined" && __DEV__);
