/**
 * Auth + session-restoration lifecycle — pure types and classification.
 *
 * Four *different* facts used to share one `status` field: whether there is a
 * session, whether a request is in flight, why a sign-in attempt failed, and
 * why a session could not be restored. Overloading one enum that way is what
 * froze the OTP form (a successful "send code" left `status: "authenticating"`,
 * so the code input stayed disabled) and what made an invalid OTP offer a
 * session-restore Retry. They are separated here:
 *
 *  - {@link AuthStatus}    — is there a session? (session truth)
 *  - {@link AuthOperation} — is an auth request in flight right now?
 *  - `authErrorCode`       — why the last sign-in *attempt* failed
 *  - `restoreErrorCode`    — why the last *restore* failed
 *
 * The store owns the last two as separate fields. Platform-free on purpose: no
 * fetch, no storage, no React.
 */

/**
 * Session truth only. Deliberately has no "authenticating" and no "error"
 * member — an in-flight request is an {@link AuthOperation}, and a failure is
 * an error code, neither of which changes whether a session exists.
 *
 * `unknown` means exactly that: it is the initial value AND the value after a
 * restore that could not reach the server. It is never rendered as signed-out.
 */
export type AuthStatus =
  /** Not determined: nothing checked yet, or the check could not complete. */
  | "unknown"
  /** A stored session is being restored right now. */
  | "restoring"
  /** Confirmed: no session — nothing stored, or the server rejected it. */
  | "signedOut"
  /** The server confirmed this session. */
  | "signedIn";

/** The single auth request that may be in flight. Only one at a time. */
export type AuthOperation = "idle" | "sendingOtp" | "verifyingOtp";

/**
 * Why something could not be determined. Both are recoverable and neither is
 * evidence about whether a session exists — they only say the app could not
 * ask, and they map to different user-facing copy.
 */
export type UnavailableCode = "service_unavailable" | "secure_storage_unavailable";

/** Outcome of the identity client's bounded, single-flight refresh attempt. */
export type RefreshOutcome =
  | { kind: "refreshed" }
  /** Nothing stored to refresh. */
  | { kind: "no-session" }
  /** The server answered: these credentials are dead (they have been cleared). */
  | { kind: "rejected" }
  /** Network/backend/keystore problem — credentials deliberately left alone. */
  | { kind: "unavailable"; code: UnavailableCode };

/** Result of restoring a stored session at startup. */
export type RestoreKind = "restored" | "no-session" | "rejected" | "unavailable";

/**
 * Map a restore outcome onto session truth.
 *
 * `unavailable` is the important one: it stays `unknown`, never `signedOut`,
 * because the stored session may still be perfectly valid — the app simply
 * could not ask. The accompanying `restoreErrorCode` is what makes the state
 * *resolved* (and offers Retry) rather than "still deciding".
 */
export function restoreKindToAuthStatus(kind: RestoreKind): AuthStatus {
  switch (kind) {
    case "restored":
      return "signedIn";
    case "no-session":
    case "rejected":
      return "signedOut";
    case "unavailable":
      return "unknown";
  }
}

/** Whether the restore result is one the user can retry out of. */
export function isRecoverableRestore(kind: RestoreKind): boolean {
  return kind === "unavailable";
}

/**
 * Stable public error code for a failed restore. Raw exception text, raw
 * backend messages and platform/keystore exceptions never reach the UI —
 * screens map these codes to fixed copy.
 */
export function restoreErrorCode(
  kind: RestoreKind,
  code: UnavailableCode = "service_unavailable",
): string | null {
  return kind === "unavailable" ? code : null;
}

/** Whether an auth request is in flight (used to gate conflicting actions). */
export function isAuthBusy(operation: AuthOperation): boolean {
  return operation !== "idle";
}
