/**
 * The recorded GPS sample model and its client-side classification.
 *
 * Pure module — no `expo-location`, no `react-native` — so it runs under
 * `node --test`. `services/location/locationTask.ts` converts Expo's
 * `LocationObject` into a `RouteSample`; everything downstream works on this
 * shape.
 *
 * ## Four distinct notions of "is this point good?"
 *
 *  - **raw sample** — exactly what the OS reported, never modified.
 *  - **client-accepted** — the client thinks it is a clean fix and will draw it.
 *  - **client-rejected** — the client thinks it is noise and will not draw it.
 *  - **backend-authoritative decision** — the only one that decides territory.
 *
 * Client rejection is a *label*, never a deletion: rejected samples stay in the
 * session and are still uploaded. The server re-derives distance, cells,
 * closure and area from the full evidence (see PHASE 18), so silently dropping
 * points here would destroy evidence the server needs — including the evidence
 * that proves a route was faked.
 */

/** One recorded GPS fix. Nullable fields are "the OS didn't report this". */
export interface RouteSample {
  latitude: number;
  longitude: number;
  /** ms since epoch, from the OS fix (not from `Date.now()` at receipt). */
  timestamp: number;
  /** Horizontal accuracy in metres. */
  accuracy: number | null;
  altitude: number | null;
  altitudeAccuracy: number | null;
  /** Ground speed in m/s, when the OS provides it. */
  speed: number | null;
  /** Course over ground in degrees, when the OS provides it. */
  heading: number | null;
  /**
   * The platform's mocked-location indicator (Android `isMocked`). Advisory
   * only — never the sole basis for a decision (see PHASE 15): a device can lie
   * about it, so the server's physics checks remain authoritative.
   */
  mocked: boolean | null;
}

export type SampleRejectionReason =
  | "invalidCoordinate"
  | "poorAccuracy"
  | "timestampReversal"
  | "impossibleSpeed"
  | "duplicatePoint";

export type SampleDecision = "accepted" | "rejected";

export interface ClassifiedSample {
  /** The untouched raw sample. Always preserved. */
  sample: RouteSample;
  /** What the *client* thinks. The backend decides independently. */
  decision: SampleDecision;
  /** Empty when accepted. */
  reasons: SampleRejectionReason[];
}

/** Client-side filtering thresholds. Intentionally looser than the backend's,
 *  so the client never rejects something the server would have accepted. */
export const SAMPLE_FILTER = {
  /** Fixes worse than this are drawn as low-confidence, not used for distance. */
  maxAccuracyMeters: 40,
  /** ~43 km/h — a jump above this between fixes is a GPS glitch, not a runner. */
  maxSpeedMetersPerSecond: 12,
  /** Below this, treat consecutive fixes as standing-still jitter. */
  minStepMeters: 2,
} as const;

const EARTH_RADIUS_M = 6_371_000;

/** Latitude/longitude range check. Rejects NaN and Infinity too. */
export function isValidCoordinate(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

/** Haversine distance in metres between two samples. */
export function sampleDistanceMeters(
  a: Pick<RouteSample, "latitude" | "longitude">,
  b: Pick<RouteSample, "latitude" | "longitude">,
): number {
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const la = (a.latitude * Math.PI) / 180;
  const lb = (b.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Classify a sample against the previously **accepted** sample.
 *
 * Returns a decision and reasons; it never mutates or discards the input. Pass
 * `previous = null` for the first sample of a session.
 */
export function classifyRouteSample(
  previous: RouteSample | null,
  next: RouteSample,
): ClassifiedSample {
  const reasons: SampleRejectionReason[] = [];

  if (!isValidCoordinate(next.latitude, next.longitude)) {
    // Nothing else can be computed from a bad coordinate.
    return { sample: next, decision: "rejected", reasons: ["invalidCoordinate"] };
  }

  if (next.accuracy != null && next.accuracy > SAMPLE_FILTER.maxAccuracyMeters) {
    reasons.push("poorAccuracy");
  }

  if (previous) {
    if (next.timestamp < previous.timestamp) {
      reasons.push("timestampReversal");
    }
    const distance = sampleDistanceMeters(previous, next);
    if (distance < SAMPLE_FILTER.minStepMeters) {
      reasons.push("duplicatePoint");
    }
    const seconds = Math.max(0.5, (next.timestamp - previous.timestamp) / 1000);
    if (distance / seconds > SAMPLE_FILTER.maxSpeedMetersPerSecond) {
      reasons.push("impossibleSpeed");
    }
  }

  return {
    sample: next,
    decision: reasons.length === 0 ? "accepted" : "rejected",
    reasons,
  };
}

/** Rolling summary of a recording session. Derived from accepted samples only,
 *  but reports how much raw evidence exists alongside it. */
export interface RouteSummary {
  /** Samples the client accepted — what the drawn route is made of. */
  acceptedCount: number;
  /** Every raw sample recorded, accepted or not. */
  rawCount: number;
  /** Metres along the accepted samples. Client estimate; the server recomputes. */
  distanceMeters: number;
  /** ms between the first and last accepted sample. */
  durationMs: number;
  /** Worst (largest) accuracy among accepted samples, or null when unknown. */
  worstAccuracyMeters: number | null;
  /** True when any raw sample carried the platform mocked-location flag. */
  sawMockedLocation: boolean;
}

/** Build a summary from a full classified-sample list. */
export function summarizeRoute(classified: ClassifiedSample[]): RouteSummary {
  const accepted = classified.filter((c) => c.decision === "accepted").map((c) => c.sample);
  let distanceMeters = 0;
  for (let i = 1; i < accepted.length; i++) {
    distanceMeters += sampleDistanceMeters(accepted[i - 1], accepted[i]);
  }
  const accuracies = accepted
    .map((s) => s.accuracy)
    .filter((a): a is number => a != null);
  return {
    acceptedCount: accepted.length,
    rawCount: classified.length,
    distanceMeters,
    durationMs:
      accepted.length >= 2
        ? accepted[accepted.length - 1].timestamp - accepted[0].timestamp
        : 0,
    worstAccuracyMeters: accuracies.length > 0 ? Math.max(...accuracies) : null,
    sawMockedLocation: classified.some((c) => c.sample.mocked === true),
  };
}

/** Coarse GPS quality for the live UI. Never gates capture — the server does. */
export type GpsQuality = "waiting" | "strong" | "fair" | "weak";

export function gpsQuality(latest: RouteSample | null): GpsQuality {
  if (!latest) return "waiting";
  if (latest.accuracy == null) return "fair";
  if (latest.accuracy <= 10) return "strong";
  if (latest.accuracy <= SAMPLE_FILTER.maxAccuracyMeters) return "fair";
  return "weak";
}
