/**
 * Start Move readiness — pure state machine, platform-free and testable.
 *
 * Maps what is *knowable before a session starts* (foreground-permission
 * status, whether device location services are on, any existing validation
 * block, and whether the user is online) to a single honest readiness state:
 * what is wrong, why it matters, and what to do next. It never claims
 * "GPS Ready" unless permission is actually granted, and it never weakens or
 * bypasses the real permission request / validation — the screen still calls
 * the existing `requestForegroundPermission()` and start guards.
 *
 * Signal quality (weak/locked) is only known *during* a session, so it is not
 * part of pre-session readiness; Active Move classifies that via
 * `lib/signalQuality.ts`.
 */

/** Foreground-permission status, mirroring expo-location's states. */
export type PermissionStatus = "checking" | "undetermined" | "granted" | "denied";

export type ReadinessKind =
  | "checking"
  | "ready"
  | "permission-required"
  | "permission-denied"
  | "location-unavailable"
  | "blocked";

export interface ReadinessInput {
  permission: PermissionStatus;
  /** Device location services enabled. Unknown ⇒ treat as on (we only flip to
   *  unavailable when we positively know they're off, to avoid false alarms). */
  locationServicesOn: boolean;
  /** An existing start validation is blocking (anti-cheat / not-ready). When
   *  set, nothing else can enable Start. */
  blockedReason: string | null;
  /** Online status. GPS is on-device, so offline never *blocks* a session —
   *  it is surfaced as context only (see `offlineNote`). */
  online: boolean;
}

export interface Readiness {
  kind: ReadinessKind;
  title: string;
  message: string;
  /** Label for the primary action button in this state. */
  primaryLabel: string;
  /** True only when a real GPS session can begin right now. */
  canStartGps: boolean;
  /** Whether to offer the clearly-labelled demo route fallback. */
  offerDemo: boolean;
  tone: "neutral" | "ready" | "warning" | "danger";
  icon: string;
  /** Non-blocking note shown when offline (GPS still works on-device). */
  offlineNote: string | null;
}

/**
 * Resolve readiness. Priority: an existing validation block wins over
 * everything; then we still determining; then permission problems; then device
 * location services; otherwise ready.
 */
export function resolveReadiness(input: ReadinessInput): Readiness {
  const offlineNote = input.online
    ? null
    : "You're offline. A movement session still works — your route is tracked on-device and syncs later.";

  // 1. Existing validation block — authoritative, never overridden here.
  if (input.blockedReason) {
    return {
      kind: "blocked",
      title: "Not ready to start",
      message: input.blockedReason,
      primaryLabel: "Start Move",
      canStartGps: false,
      offerDemo: true,
      tone: "danger",
      icon: "lock-closed-outline",
      offlineNote,
    };
  }

  // 2. Still determining permission/services.
  if (input.permission === "checking") {
    return {
      kind: "checking",
      title: "Checking readiness…",
      message: "Confirming location access before your session.",
      primaryLabel: "Checking…",
      canStartGps: false,
      offerDemo: false,
      tone: "neutral",
      icon: "ellipsis-horizontal",
      offlineNote,
    };
  }

  // 3. Permission denied — actionable, with the demo fallback.
  if (input.permission === "denied") {
    return {
      kind: "permission-denied",
      title: "Location is off",
      message:
        "MovenRun needs location while a session runs to draw your route. Turn it on in Settings, or try a demo route.",
      primaryLabel: "Open Settings",
      canStartGps: false,
      offerDemo: true,
      tone: "danger",
      icon: "location-outline",
      offlineNote,
    };
  }

  // 4. Device location services off (permission may be fine, radio isn't).
  if (!input.locationServicesOn) {
    return {
      kind: "location-unavailable",
      title: "Location unavailable",
      message:
        "Device location services are off, so a route can't be tracked. Enable location in system settings, or try a demo route.",
      primaryLabel: "Open Settings",
      canStartGps: false,
      offerDemo: true,
      tone: "warning",
      icon: "cloud-offline-outline",
      offlineNote,
    };
  }

  // 5. Permission not yet requested — the primary action asks for it.
  if (input.permission === "undetermined") {
    return {
      kind: "permission-required",
      title: "Allow location to start",
      message:
        "Location is used only while a session is running, foreground only, and stays on your device.",
      primaryLabel: "Allow Location",
      canStartGps: false,
      offerDemo: true,
      tone: "neutral",
      icon: "navigate-outline",
      offlineNote,
    };
  }

  // 6. Granted — genuinely ready.
  return {
    kind: "ready",
    title: "Ready to move",
    message: "Location is on. Start when you are — your route draws as you go.",
    primaryLabel: "Start Move",
    canStartGps: true,
    offerDemo: true,
    tone: "ready",
    icon: "navigate",
    offlineNote,
  };
}
