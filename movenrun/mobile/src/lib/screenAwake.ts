/**
 * Keeping the screen on during a movement session.
 *
 * Tracking is foreground only. On Android, expo-location removes its location
 * updates when the activity pauses (`LocationModule.onHostPause` →
 * `stopWatching`), and the screen timing out pauses the activity. So a phone
 * that dimmed and locked itself 30 seconds into a walk recorded nothing for
 * the rest of it: one long gap and almost no distance, on the default settings
 * of nearly every phone.
 *
 * Holding the screen on for the capture is the foreground-only answer. It uses
 * the window's keep-screen-on flag, needs no permission and no background
 * location, and ends with the capture. Locking the phone by hand still pauses
 * GPS and is still recorded as a gap; that is the player's choice, and the
 * Start screen says so.
 */
import type { CaptureState } from "./sessionLifecycle";

export const SESSION_KEEP_AWAKE_TAG = "movenrun-movement-session";

/** On while a capture exists (moving or paused), off before Start and after Finish. */
export function shouldKeepScreenOn(captureState: CaptureState): boolean {
  return captureState === "active" || captureState === "paused";
}

export const SCREEN_ON_FACT = "Screen stays on while you move; locking the phone pauses GPS";
