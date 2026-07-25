/**
 * Map recentre / follow state (D4).
 *
 * ## The defect this replaces
 * The live map's "Recentre on my location" control did not use the device
 * location at all. It computed the centre of the *last fetched viewport* and
 * moved the camera there — which is wherever the user had already panned to, so
 * pressing it did nothing visible. Worse, the accessibility label said "my
 * location", so a screen-reader user was told the button did something it
 * demonstrably did not.
 *
 * ## The model
 * One small state machine, kept pure so the whole behaviour is testable without
 * a device, a permission dialog or a native map:
 *
 *   idle ──press──▶ locating ──fix──▶ following ──pan──▶ idle
 *                        │
 *                        ├──▶ denied      (permission refused)
 *                        ├──▶ disabled    (location services off)
 *                        └──▶ unavailable (no fix, timeout, hardware error)
 *
 * `following` is the only state in which the camera is locked to the runner. A
 * map gesture always drops it — a camera that fights the user's pan is worse
 * than one that never follows — and pressing the control again restores it.
 *
 * ## Honest labels
 * `followLabel` derives the accessibility label from the state, so the button
 * never claims a capability it does not have. "Location permission denied" is a
 * more useful thing to hear than "Recentre on my location" on a button that
 * cannot.
 */

export type FollowStatus =
  /** Not following; the control is ready to be pressed. */
  | "idle"
  /** A fix has been requested and has not arrived yet. */
  | "locating"
  /** The camera is locked to the runner. */
  | "following"
  /** Foreground location permission was refused. */
  | "denied"
  /** The device's location services are switched off. */
  | "disabled"
  /** Permission is granted but no fix could be obtained. */
  | "unavailable";

export interface FollowState {
  status: FollowStatus;
  /** The last known device position, `[longitude, latitude]`. */
  coordinate: [number, number] | null;
  /** Non-null when the last attempt failed, for the visible message. */
  message: string | null;
}

export const INITIAL_FOLLOW_STATE: FollowState = {
  status: "idle",
  coordinate: null,
  message: null,
};

/** What a location attempt came back with. Mirrors what the adapter can know. */
export type LocationOutcome =
  | { kind: "fix"; coordinate: [number, number] }
  | { kind: "denied" }
  | { kind: "servicesDisabled" }
  | { kind: "unavailable"; reason?: string };

export type FollowAction =
  /** The recentre control was pressed. */
  | { type: "recenterPressed" }
  /** A location attempt resolved. */
  | { type: "locationResolved"; outcome: LocationOutcome }
  /** The user panned, zoomed or rotated the map themselves. */
  | { type: "userGesture" }
  /** The screen lost focus / the map unmounted. */
  | { type: "reset" };

const MESSAGES: Record<Exclude<FollowStatus, "idle" | "locating" | "following">, string> = {
  denied: "Location permission is off, so the map can't centre on you. Enable it in Settings.",
  disabled: "Your device's location services are off.",
  unavailable: "Couldn't get a location fix. Try again in the open.",
};

export function followReducer(state: FollowState, action: FollowAction): FollowState {
  switch (action.type) {
    case "recenterPressed":
      // Pressing while already following is a no-op rather than a re-request:
      // the camera is already where the button promises to put it.
      if (state.status === "following") return state;
      if (state.status === "locating") return state;
      return { ...state, status: "locating", message: null };

    case "locationResolved":
      // A fix that arrives after the user has panned away must not yank the
      // camera back — they have already said where they want to look.
      if (state.status !== "locating") return state;
      switch (action.outcome.kind) {
        case "fix":
          return { status: "following", coordinate: action.outcome.coordinate, message: null };
        case "denied":
          return { ...state, status: "denied", message: MESSAGES.denied };
        case "servicesDisabled":
          return { ...state, status: "disabled", message: MESSAGES.disabled };
        case "unavailable":
          return { ...state, status: "unavailable", message: MESSAGES.unavailable };
      }
      return state;

    case "userGesture":
      // Any deliberate map movement ends follow — including one that lands
      // mid-request, which also cancels the pending fix's right to move the
      // camera (handled by the `status !== "locating"` guard above).
      if (state.status === "idle") return state;
      return { ...state, status: "idle", message: null };

    case "reset":
      return { ...INITIAL_FOLLOW_STATE, coordinate: state.coordinate };
  }
}

/** True only while the camera should be locked to the runner. */
export function isFollowing(state: FollowState): boolean {
  return state.status === "following";
}

/** True while a fix is in flight — the control shows a spinner. */
export function isLocating(state: FollowState): boolean {
  return state.status === "locating";
}

/**
 * The accessibility label for the recentre control.
 *
 * Never says "my location" unless pressing it can actually centre on the user.
 */
export function followLabel(state: FollowState): string {
  switch (state.status) {
    case "locating":
      return "Finding your location";
    case "following":
      return "Following your location. Pan the map to stop.";
    case "denied":
      return "Location permission denied. Enable location access to centre the map on you.";
    case "disabled":
      return "Location services are off. Turn them on to centre the map on you.";
    case "unavailable":
      return "Location unavailable. Try again to centre the map on you.";
    case "idle":
      return "Centre the map on my location";
  }
}

/** The visible (non-a11y) message, or null when there is nothing to say. */
export function followMessage(state: FollowState): string | null {
  return state.message;
}
