/**
 * Signal health from the age of the last fix the capture path accepted.
 *
 * ## The defect this replaces
 *
 * The session chip used to change only when a fix arrived, and only for two
 * rejection reasons (`weak_accuracy`, `stale_fix`). Every other way of losing
 * the route left it saying usable: with the phone clock set back an hour each
 * fix was rejected as `future_fix` and the chip stayed green for 200 s while
 * the distance stopped (Track A fixture C01), and when fixes stop arriving at
 * all nothing re-evaluates the chip.
 *
 * Health is now a function of time on the session clock (see
 * `sessionClock.ts`), not of how many points were supplied or drawn: the signal
 * is usable only while the newest *healthy* fix is younger than
 * {@link FIX_HEALTH.staleAfterMs}. The screen re-reads it on a timer, so a
 * frozen watch degrades even though no callback fires.
 *
 * ## What counts as healthy
 *
 * A fix the measurement policy accepted, or one it turned down only as
 * `within_uncertainty`. The second is a current, well-bounded position that
 * did not move far enough to count as distance, which is exactly what a player
 * standing at a crossing produces; calling that a bad signal would replace one
 * false statement with another (see `degradesSignal` in `mapPresence.ts`).
 *
 * Everything else is not healthy and simply does not refresh the age:
 * `future_fix`, `stale_fix`, `weak_accuracy`, `unknown_accuracy`,
 * `invalid_fix`, `non_increasing_time`, `implausible_speed`. `weak_accuracy`
 * and `stale_fix` still degrade at once, as before.
 *
 * ## Residual cases
 *
 * A phone that is perfectly still and whose OS delivers no fix at all (the
 * session watch has a 5 m distance filter) degrades after the window. That is
 * a statement the app can defend: it has not heard a current position.
 *
 * Pure and platform-free. Nothing here accepts, rejects or measures a fix.
 */
import type { FixDecision } from "@movenrun/shared/measurement";

import { STRONG_ACCURACY_M } from "./signalQuality";
import { degradesSignal } from "./mapPresence";

export const FIX_HEALTH = Object.freeze({
  /**
   * The newest healthy fix must be younger than this. Five session-watch
   * intervals (4 s each): long enough that one or two dropped callbacks do not
   * flicker the chip, short enough that a lost signal shows within seconds
   * rather than minutes.
   */
  staleAfterMs: 20_000,
});

export type FixHealthSignal = "unknown" | "usable" | "degraded";

export interface FixHealth {
  /** A delivered fix and the capture path's decision about it. */
  observe(decision: FixDecision, accuracy: number | null, at: number): void;
  /** The watch reported an error: degraded until a healthy fix arrives. */
  interrupt(): void;
  /**
   * Start a fresh window at `at` (session start, resume, return to the
   * foreground). Fixes are not delivered while paused or backgrounded, so the
   * age is measured from when they could next arrive.
   */
  rearm(at: number): void;
  /** What the chip may say at `at`. */
  signal(at: number): FixHealthSignal;
}

export function createFixHealth(startedAt: number): FixHealth {
  let windowFrom = startedAt;
  let lastHealthyAt: number | null = null;
  let lastHealthyAccuracy: number | null = null;
  let degradedNow = false;
  return {
    observe(decision, accuracy, at) {
      if (decision.accepted || decision.reason === "within_uncertainty") {
        lastHealthyAt = Math.max(lastHealthyAt ?? at, at);
        lastHealthyAccuracy = accuracy;
        degradedNow = false;
        return;
      }
      if (degradesSignal(decision.reason)) degradedNow = true;
    },
    interrupt() {
      degradedNow = true;
    },
    rearm(at) {
      windowFrom = Math.max(windowFrom, at);
    },
    signal(at) {
      if (degradedNow) return "degraded";
      const reference = Math.max(windowFrom, lastHealthyAt ?? -Infinity);
      if (at - reference > FIX_HEALTH.staleAfterMs) return "degraded";
      if (lastHealthyAt === null || lastHealthyAt < windowFrom) return "unknown";
      return lastHealthyAccuracy != null && lastHealthyAccuracy > STRONG_ACCURACY_M ? "degraded" : "usable";
    },
  };
}
