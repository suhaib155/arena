/**
 * Circular-progress geometry — pure, platform-free, testable.
 *
 * React Native ships no SVG and no arc primitive, so a progress ring is built
 * from two clipped semicircles that are rotated into place (see
 * components/ProgressRing.tsx). Getting those two rotations right is the whole
 * trick, so the maths lives here where it can be verified exhaustively.
 *
 * The sweep starts at 12 o'clock and runs clockwise. The right semicircle
 * renders the first half (0°–180°), the left semicircle the second (180°–360°).
 * Each is authored lying in its own half of the circle and rotated *back* by
 * 180° at zero progress, which parks it under the opposite clip — invisible.
 */

/** Rotation (deg) for each clipped semicircle of a progress ring. */
export interface RingSweep {
  /** Rotation of the right-hand semicircle: -180 (empty) → 0 (full half). */
  rightDeg: number;
  /** Rotation of the left-hand semicircle: -180 (empty) → 0 (full half). */
  leftDeg: number;
  /** Progress clamped to 0..1, for callers that also render a numeric label. */
  progress: number;
}

/**
 * Convert 0..1 progress into the two semicircle rotations.
 *
 * Values outside 0..1 are clamped rather than throwing: progress is routinely
 * derived from live counters (distance/target, xp/level) where a transient
 * overshoot is normal and must render as "full", not crash a tracking screen.
 */
export function ringSweep(progress: number): RingSweep {
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  const angle = p * 360;
  return {
    progress: p,
    rightDeg: Math.min(180, angle) - 180,
    leftDeg: Math.max(0, angle - 180) - 180,
  };
}

/**
 * Stroke width for a ring of a given diameter. Thin rings look incidental and
 * thick ones swallow the centred value, so the weight tracks the diameter and
 * is clamped to a range that stays legible at both extremes.
 */
export function ringStroke(size: number): number {
  return Math.round(Math.max(6, Math.min(16, size * 0.085)));
}
