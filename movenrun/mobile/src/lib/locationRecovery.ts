/**
 * What the Move screens do when location comes back after an interruption.
 *
 * Tracking is foreground only, so the player fixes a lost permission or a
 * switched-off location toggle in system Settings and then returns to the app.
 * Returning is an AppState change, not a navigation focus change, so a check
 * hung on screen focus never re-runs and the screen kept showing the stale
 * "permission needed" state. These decisions are pure so the rules are tested
 * here rather than in a component.
 */
import type { CaptureState } from "./sessionLifecycle";

export type ForegroundRecovery = "none" | "retry_start" | "restart_watch";

export interface ForegroundRecoveryInput {
  captureState: CaptureState;
  /** The start failed for a reason only system Settings can fix. */
  startErrorSettingsRelevant: boolean;
  /** A running session's watch reported a failure and has not restarted. */
  watchStopped: boolean;
  /** A restart is already in flight; never start a second one. */
  restarting: boolean;
}

/**
 * Called when the app returns to the foreground.
 *
 * - A session that failed to start for a permission or location-toggle reason
 *   retries once, so the player who just fixed it in Settings is not left on a
 *   stale error. If it is still broken the same error shows again; it never
 *   loops, because it only runs on a foreground transition.
 * - A running (or paused) session whose watch died restarts the watch. The
 *   missed span is already recorded as a gap and the route breaks there, so a
 *   restart cannot draw a line across ground that was never observed.
 */
export function recoveryOnForeground(input: ForegroundRecoveryInput): ForegroundRecovery {
  if (input.captureState === "idle" && input.startErrorSettingsRelevant) return "retry_start";
  if ((input.captureState === "active" || input.captureState === "paused") &&
    input.watchStopped && !input.restarting) return "restart_watch";
  return "none";
}

/**
 * Whether the screen should ask the system if location services are on.
 *
 * Android keeps a watch registered when the location toggle is switched off;
 * it reports no error and simply stops delivering fixes. So a degraded signal
 * during a live capture is the moment to ask, and nothing else is.
 */
export function shouldCheckLocationServices(captureState: CaptureState, signal: string): boolean {
  return captureState === "active" && signal === "degraded";
}

/** The interruption banner, worded for what actually stopped. */
export function interruptionMessage(cause: "services_off" | "watch_stopped"): string {
  return cause === "services_off"
    ? "Location is off. Turn it on to keep recording; the missing section will be shown in your summary."
    : "GPS tracking was interrupted. Time continues; missing route sections will be shown in your summary.";
}
