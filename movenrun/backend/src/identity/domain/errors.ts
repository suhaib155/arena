/**
 * Stable public error codes for the identity/wallet surface.
 *
 * Every failure the API can return maps to one of these codes. The codes are a
 * public contract (mirrored in the OpenAPI spec) but are deliberately coarse
 * and non-attacker-helpful: they never reveal whether a specific account,
 * email, wallet, or identity exists, and they never carry provider tokens,
 * signatures, or secret material.
 *
 * `IdentityError` is the only error type the HTTP layer converts into a
 * structured response; anything else bubbles to the generic 500 handler so an
 * unexpected internal fault can never leak as a "helpful" 4xx.
 */

export type IdentityErrorCode =
  // Generic / input
  | "invalid_request"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "provider_not_configured"
  // Auth / OTP — intentionally uniform so responses can't be used to
  // enumerate accounts or distinguish "wrong code" from "no such challenge".
  | "verification_failed"
  | "challenge_expired"
  | "challenge_consumed"
  | "too_many_attempts"
  // Sessions
  | "session_invalid"
  | "session_expired"
  | "refresh_reuse_detected"
  | "recent_auth_required"
  | "step_up_required"
  // Identity linking
  | "identity_already_linked"
  | "identity_owned_by_another_user"
  | "final_login_method"
  // Wallets
  | "wallet_owned_by_another_user"
  | "wallet_challenge_invalid"
  | "wallet_operation_locked"
  // Transient provider failure — 503, so clients know a retry is legitimate.
  | "provisioning_failed"
  // Terminal — 409, so clients know NOT to retry (recovery flow instead).
  | "provisioning_not_retryable";

/** HTTP status each code maps to. Kept here (not in the router) so the mapping
 *  is one source of truth and testable without spinning up Express. */
export const ERROR_HTTP_STATUS: Record<IdentityErrorCode, number> = {
  invalid_request: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  provider_not_configured: 503,
  verification_failed: 401,
  challenge_expired: 401,
  challenge_consumed: 401,
  too_many_attempts: 429,
  session_invalid: 401,
  session_expired: 401,
  refresh_reuse_detected: 401,
  recent_auth_required: 401,
  step_up_required: 401,
  identity_already_linked: 409,
  identity_owned_by_another_user: 409,
  final_login_method: 409,
  wallet_owned_by_another_user: 409,
  wallet_challenge_invalid: 401,
  wallet_operation_locked: 409,
  provisioning_failed: 503,
  provisioning_not_retryable: 409,
};

export class IdentityError extends Error {
  readonly code: IdentityErrorCode;
  /** Optional public, non-sensitive detail. NEVER contains tokens, signatures,
   *  addresses of other users, or whether an account exists. */
  readonly publicDetail?: string;

  constructor(code: IdentityErrorCode, publicDetail?: string) {
    super(publicDetail ? `${code}: ${publicDetail}` : code);
    this.name = "IdentityError";
    this.code = code;
    this.publicDetail = publicDetail;
  }

  get status(): number {
    return ERROR_HTTP_STATUS[this.code];
  }

  /** The shape sent to clients. Deliberately minimal. */
  toPublicJSON(): { error: { code: IdentityErrorCode; detail?: string } } {
    return { error: { code: this.code, ...(this.publicDetail ? { detail: this.publicDetail } : {}) } };
  }
}

export function isIdentityError(err: unknown): err is IdentityError {
  return err instanceof IdentityError;
}
