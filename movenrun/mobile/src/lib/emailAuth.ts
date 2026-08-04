/**
 * Email/OTP form rules and stable public error copy — pure.
 *
 * Two hard rules shape this module:
 *
 *  1. The SERVER is authoritative. The normalization/plausibility check here
 *     mirrors `backend/src/identity/domain/email.ts` so the app doesn't burn a
 *     round trip on obviously malformed input, but it never decides anything
 *     security-relevant and never tells the user whether an address exists —
 *     the client does not probe for account existence, before or after sending
 *     a code. (Mobile cannot import backend source; the rule is duplicated
 *     deliberately and must be kept in step with that file.)
 *
 *  2. Raw backend errors never reach the UI. Screens render only the fixed
 *     strings below, keyed by the server's stable error codes.
 */

/** Same rule as the server: a single @, a dot in the domain, no whitespace. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

/** Lowercase + trim, or null when the input isn't a plausible address. */
export function normalizeEmail(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed || trimmed.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(trimmed)) return null;
  return trimmed;
}

/** Whether "Continue with email" may be pressed for this raw input. */
export function canSubmitEmail(input: string): boolean {
  return normalizeEmail(input) !== null;
}

/** The OTP length the server issues. Used only to enable the verify button. */
export const OTP_LENGTH = 6;

/** Digits only, capped — keeps a pasted code from carrying stray characters. */
export function normalizeOtpCode(input: string): string {
  return input.replace(/\D+/g, "").slice(0, OTP_LENGTH);
}

export function canSubmitOtp(input: string): boolean {
  return normalizeOtpCode(input).length === OTP_LENGTH;
}

/**
 * Stable, user-facing copy for a public error code. Unknown codes collapse to
 * one neutral message — a code the app doesn't recognise must never be printed
 * verbatim, and must never leak whether an account exists.
 */
export function authErrorMessage(code: string | null): string | null {
  if (!code) return null;
  switch (code) {
    case "api_base_url_unset":
    case "client_unavailable":
      return "This build has no MovenRun account service configured. You can still explore the local beta.";
    case "service_unavailable":
      return "We couldn't reach MovenRun. Check your connection and try again.";
    case "secure_storage_unavailable":
      return "This device's secure storage is unavailable right now. Your account is untouched — please try again.";
    case "account_sync_unavailable":
      return "You're signed in, but your account details couldn't be refreshed. Pull to refresh or try again shortly.";
    case "invalid_email":
      return "That email address doesn't look right.";
    case "verification_failed":
      return "That code didn't match. Check it and try again.";
    case "code_expired":
      return "That code has expired. Send a new one.";
    case "too_many_attempts":
      return "Too many attempts. Please wait a moment and try again.";
    case "provider_not_configured":
      return "This sign-in method isn't available yet.";
    case "session_invalid":
      return "Your session ended. Sign in again to continue.";
    default:
      return "Something went wrong. Please try again.";
  }
}
