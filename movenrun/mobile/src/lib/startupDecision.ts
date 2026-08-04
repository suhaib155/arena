/**
 * Startup bootstrap — the single authoritative "where does the app open?"
 * decision.
 *
 * Startup used to be spread across three independent things: the game store's
 * hydration flag, a redirect effect that only knew about two booleans, and an
 * auth store that had never been asked whether a session existed. This module
 * folds all of it into one pure function so the whole startup matrix (cold
 * start, returning local user, returning signed-in user, rejected session,
 * backend down, backend absent) is decidable in a unit test.
 *
 * It performs no I/O and holds no secrets — the caller supplies already-known
 * facts and gets back a route plus a stable public error code.
 */
import type { AuthStatus } from "./authLifecycle";
import type { FirstRunState } from "./firstRun";

export type BootstrapStatus =
  | "hydrating"
  | "restoring-session"
  | "ready"
  | "recoverable-error";

/** Where startup sends the user. Mapped to concrete routes by the layout. */
export type StartupRoute =
  /** Keep the branded splash up — we are still deciding. */
  | "splash"
  /** Account choice (email or local beta). */
  | "account"
  /** The canonical three-step intro. */
  | "intro"
  /** The normal app. */
  | "app"
  /** Recoverable service failure with a stored session — retry, don't sign out. */
  | "service-error";

export interface StartupInput {
  /** Persisted gameplay state has finished loading from AsyncStorage. */
  hydrated: boolean;
  authStatus: AuthStatus;
  firstRun: FirstRunState;
  /** `EXPO_PUBLIC_API_URL` is configured in this build. */
  backendConfigured: boolean;
  /** The user explicitly chose to continue without the account service after a
   *  recoverable failure. Transient (never persisted) and never set by the app
   *  on the user's behalf — stored credentials remain untouched either way. */
  serviceErrorAcknowledged: boolean;
}

export interface StartupDecision {
  status: BootstrapStatus;
  route: StartupRoute;
  /** Stable public code, never a raw error message. Null unless recoverable. */
  errorCode: string | null;
}

/** Route implied purely by how far the user got through first run. */
function routeForStage(firstRun: FirstRunState): StartupRoute {
  switch (firstRun.stage) {
    case "ready":
      return "app";
    case "intro":
      return "intro";
    case "account":
      return "account";
  }
}

/**
 * Decide the startup destination. Total and deterministic for every input.
 *
 * Order matters:
 *  1. Nothing renders before persisted state exists (no signed-out flash, no
 *     flash of empty gameplay data).
 *  2. Nothing renders while a stored session is still being restored.
 *  3. A restore that failed *transiently* only blocks a user who actually had
 *     a session (`mode: "signed_in"`); everyone else continues into the local
 *     experience rather than being held hostage by an unreachable backend.
 *  4. Otherwise first-run stage decides, which is what makes a returning user
 *     — signed in or local beta — land straight on Home.
 */
export function decideStartup(input: StartupInput): StartupDecision {
  if (!input.hydrated) {
    return { status: "hydrating", route: "splash", errorCode: null };
  }

  if (input.authStatus === "unknown" || input.authStatus === "restoring") {
    return { status: "restoring-session", route: "splash", errorCode: null };
  }

  if (
    input.authStatus === "error" &&
    input.backendConfigured &&
    input.firstRun.mode === "signed_in" &&
    !input.serviceErrorAcknowledged
  ) {
    // A session is stored and may still be valid — surface a retryable state
    // instead of silently demoting the user to signed-out.
    return { status: "recoverable-error", route: "service-error", errorCode: "service_unavailable" };
  }

  return { status: "ready", route: routeForStage(input.firstRun), errorCode: null };
}

/** Whether the splash should stay on screen for this decision. */
export function isDecidingStartup(decision: StartupDecision): boolean {
  return decision.route === "splash";
}
