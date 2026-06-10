/**
 * Locked MOVE — DISPLAY PREVIEW ONLY.
 *
 * Locked MOVE is non-liquid in-app progress that ships with the territory
 * beta (see docs/ROADMAP.md). There is no ledger, nothing is earned, nothing
 * is stored, and nothing leaves the device: until the real system lands, the
 * UI derives a preview figure from XP so screens can already show the shape
 * of the reward loop. Always label it as a preview / in-app progress.
 */

/** XP per previewed Locked MOVE unit. Purely cosmetic. */
const XP_PER_LOCKED_MOVE = 12;

export function lockedMovePreview(totalXp: number): number {
  return Math.floor(Math.max(0, totalXp) / XP_PER_LOCKED_MOVE);
}
