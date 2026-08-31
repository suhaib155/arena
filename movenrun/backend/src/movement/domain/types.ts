/**
 * Movement-verification domain vocabulary.
 *
 * Scope boundary, stated once so it cannot drift: this domain answers "did the
 * server measure this movement, and is the observation self-consistent?" It
 * does NOT answer "who owns this ground". There is no server-side territory
 * model — `hex_activities`, `user_route_hexes` and `zones` exist in the schema
 * but no code writes them — so nothing here may be called captured or owned.
 */

/** Terminal outcome of one verification. There is no pending state: the check
 *  is pure CPU over a bounded payload and runs inline, so a caller never has
 *  to poll and no job can be lost or redelivered. */
export type MovementVerificationStatus = "verified" | "rejected";

/** One raw observation from the device. Everything here is untrusted input. */
export interface ObservedPoint {
  lat: number;
  lng: number;
  /** Reported horizontal accuracy in metres. */
  accuracy: number;
  /** Unix ms. */
  timestamp: number;
}

/** The complete client observation. Note what is absent: no distance, no
 *  duration, no hexes, no XP, no capture, no trust score, no wallet, no user
 *  id. The client reports what its sensors saw; the server decides everything
 *  that follows. */
export interface MovementObservation {
  startTime: number;
  endTime: number;
  points: ObservedPoint[];
}

/** What the server derived. Every field here is server-computed. */
export interface MovementVerificationResult {
  status: MovementVerificationStatus;
  /** Server-computed. Null when rejected before measurement. */
  distanceMeters: number | null;
  durationSeconds: number | null;
  /**
   * H3 cells the route passed through, server-derived from the points.
   *
   * Traversal, not capture. This records where movement happened; it grants
   * nothing and is not territory. Consumers must not present it as ownership.
   */
  traversedHexIds: string[];
  /** 0..1 anomaly-check confidence, when a measurement ran. */
  confidence: number | null;
  /** Non-empty exactly when status is "rejected". Public, non-sensitive. */
  rejectionReasons: string[];
}
