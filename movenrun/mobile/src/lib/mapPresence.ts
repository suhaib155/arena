/**
 * What the readiness chip is allowed to say, given what the map can actually
 * draw.
 *
 * ## The contradiction this module exists to make impossible
 *
 * A physical build once showed `GPS locked` in the header while the map beneath
 * it said `Waiting for your first location fix…`, on a world-scale view with no
 * marker on it. Both statements were produced honestly by their own screen: the
 * chip was reporting that the tracker had started, and the map was reporting
 * that it had no coordinate. They were answering different questions and only
 * one of them was the question the player was asking, which is *does this app
 * know where I am*.
 *
 * So readiness is derived here, from one input the chip and the map share: the
 * location the map is currently able to draw. {@link gpsPresence} cannot return
 * `ready` — or `weak`, which also claims a fix — without one. The chip and the
 * overlay are then two renderings of a single fact rather than two opinions.
 *
 * Platform-free and pure, so the invariant is a property of a tested function
 * rather than of a screen being read carefully.
 */
import type { GpsAcquisitionState } from "./gpsAcquisitionState";
import type { TrackPoint } from "./geo";

/**
 * How the app's knowledge of the player's position reads to the player.
 *
 * Deliberately not the same type as {@link GpsAcquisitionState}: that one
 * describes the *acquisition policy's* progress, which is an internal matter,
 * and this one describes what the player is being told.
 */
export type GpsPresence =
  /** No drawable fix at all yet. */
  | "locating"
  /** Fixes are arriving but nothing qualified has reached the map yet. */
  | "improving"
  /** A qualified fix is on the map, and the signal behind it is usable. */
  | "ready"
  /** A fix is on the map, but the last accepted one was poor. */
  | "weak";

export interface PresenceInput {
  /** The acquisition policy's own view of progress. */
  acquisition: GpsAcquisitionState;
  /**
   * The coordinate the map is drawing right now, or null when it is drawing
   * none. This is the whole point of the module: readiness is a statement
   * about this value.
   */
  displayLocation: TrackPoint | null;
  /** The most recent accepted fix was poor, or the watch reported an error. */
  degraded?: boolean;
}

/**
 * Readiness, derived rather than announced.
 *
 * `ready` and `weak` both assert that the app knows where the player is, so
 * both require a display location. Without one the answer is `locating` before
 * any fix has been seen and `improving` once some have, which is what the
 * acquisition state already distinguishes.
 */
export function gpsPresence({ acquisition, displayLocation, degraded = false }: PresenceInput): GpsPresence {
  if (displayLocation === null) {
    /* No coordinate on the map means no claim of readiness, whatever the
       tracker thinks. A resolved `start()` is not a position. */
    return acquisition === "locating" ? "locating" : "improving";
  }
  if (degraded) return "weak";
  return acquisition === "ready" ? "ready" : "improving";
}

/** Whether this state asserts the app knows where the player is. */
export function claimsPosition(presence: GpsPresence): boolean {
  return presence === "ready" || presence === "weak";
}

/** The chip's words. One vocabulary, so two screens cannot disagree. */
export function presenceLabel(presence: GpsPresence): string {
  switch (presence) {
    case "locating": return "Locating…";
    case "improving": return "Improving GPS…";
    case "weak": return "Weak signal";
    case "ready": return "GPS locked";
  }
}
