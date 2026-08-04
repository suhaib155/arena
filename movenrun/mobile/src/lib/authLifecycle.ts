/**
 * Auth + session-restoration lifecycle — pure types and classification.
 *
 * The store used to start at `signedOut`, which made "we haven't looked yet"
 * indistinguishable from "the server confirmed this user is signed out". That
 * is a fail-open shape: a slow or unreachable backend looked exactly like a
 * real sign-out and would have thrown a returning user back to the account
 * screen. The statuses below keep those cases apart, and the restore outcome
 * is a discriminated union instead of a boolean, so a transient network
 * failure can never be mistaken for a rejected session.
 *
 * Platform-free on purpose: no fetch, no storage, no React.
 */

export type AuthStatus =
  /** Nothing has been checked yet (initial state — never render signed-out UI). */
  | "unknown"
  /** A stored session is being restored right now. */
  | "restoring"
  /** Confirmed signed out: there is no stored session, or the server rejected it. */
  | "signedOut"
  /** A user-initiated authentication is in flight. */
  | "authenticating"
  /** The server confirmed this session. */
  | "signedIn"
  /** Recoverable service failure — stored credentials are intact and untouched. */
  | "error";

/** Outcome of the identity client's bounded refresh attempt. */
export type RefreshOutcome =
  | { kind: "refreshed" }
  /** Nothing stored to refresh. */
  | { kind: "no-session" }
  /** The server answered: these credentials are dead (they have been cleared). */
  | { kind: "rejected" }
  /** Network/backend problem — credentials deliberately left in place. */
  | { kind: "unavailable" };

/** Result of restoring a stored session at startup. */
export type RestoreKind = "restored" | "no-session" | "rejected" | "unavailable";

/**
 * Map a restore outcome onto the auth status.
 *
 * `unavailable` is the important one: it becomes `error` (recoverable), never
 * `signedOut`, because the stored session may still be perfectly valid.
 */
export function restoreKindToAuthStatus(kind: RestoreKind): AuthStatus {
  switch (kind) {
    case "restored":
      return "signedIn";
    case "no-session":
    case "rejected":
      return "signedOut";
    case "unavailable":
      return "error";
  }
}

/** Whether the restore result is one the user can retry out of. */
export function isRecoverableRestore(kind: RestoreKind): boolean {
  return kind === "unavailable";
}

/**
 * Stable public error code for a failed restore. Raw exception text and raw
 * backend messages never reach the UI — screens map these codes to fixed copy.
 */
export function restoreErrorCode(kind: RestoreKind): string | null {
  return kind === "unavailable" ? "service_unavailable" : null;
}
