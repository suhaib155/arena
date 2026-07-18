/**
 * Email normalization for identity resolution.
 *
 * Two goals:
 *  1. A single canonical form so the same mailbox typed with different casing
 *     resolves to the same auth-identity lookup key.
 *  2. NEVER letting "same normalized email" silently merge two MovenRun users
 *     — normalization is only a lookup aid; account linking always requires an
 *     authenticated, recently-verified session (see IdentityLinkService and
 *     ADR-0001). This module deliberately does no provider-specific address
 *     folding (e.g. Gmail dot/plus stripping): treating `a.b@gmail` and
 *     `ab@gmail` as one identity is an anti-abuse policy decision, not a
 *     normalization default, and folding here would risk cross-account merges.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Lowercases and trims. Returns null when the input is not a plausible email,
 * so callers fail closed. Does NOT verify deliverability — that is the OTP
 * flow's job.
 */
export function normalizeEmail(input: string): string | null {
  const trimmed = input?.trim().toLowerCase();
  if (!trimmed || trimmed.length > 254 || !EMAIL_RE.test(trimmed)) return null;
  return trimmed;
}
