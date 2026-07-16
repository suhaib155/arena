/**
 * Security primitives for the identity/wallet surface — all built on
 * `node:crypto`, no third-party dependency, no network.
 *
 * Design rules enforced here:
 *  - Secrets (refresh tokens, OTP codes) are compared and stored ONLY as
 *    salted/keyed hashes — plaintext never touches persistence.
 *  - Comparisons are constant-time to avoid timing oracles.
 *  - Random material is drawn from `crypto.randomBytes` (CSPRNG), never
 *    `Math.random`.
 *  - NOTHING in this file generates, derives, imports, or handles an EVM
 *    private key or mnemonic — that is the embedded-wallet provider's job and
 *    is explicitly out of MovenRun's trust boundary (see ADR-0008).
 */
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

/** URL-safe opaque token (default 32 bytes → 43 base64url chars). Used for
 *  session identifiers, refresh secrets, OTP-challenge ids, and challenge
 *  nonces. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** A fresh UUIDv4 for primary keys. */
export function newId(): string {
  return randomUUID();
}

/**
 * Numeric OTP of `digits` length, drawn from the CSPRNG with rejection
 * sampling so every code is uniformly distributed (no modulo bias). Returned
 * as a zero-padded string; callers hash it immediately and never log it.
 */
export function randomNumericOtp(digits = 6): string {
  if (digits < 1 || digits > 9) throw new Error("otp digits out of range");
  const max = 10 ** digits;
  // Reject values in the final, incomplete window to keep the distribution
  // uniform. With a 32-bit draw and max <= 1e9 the reject rate is tiny.
  const limit = Math.floor(0xffffffff / max) * max;
  let n: number;
  do {
    n = randomBytes(4).readUInt32BE(0);
  } while (n >= limit);
  return String(n % max).padStart(digits, "0");
}

/**
 * Keyed hash of a secret for storage/comparison. HMAC-SHA-256 under a
 * server-held pepper so a leaked database alone cannot be brute-forced for
 * low-entropy secrets (OTPs) without also holding the pepper. High-entropy
 * secrets (refresh tokens) don't strictly need the pepper, but using one path
 * keeps the code uniform and fail-closed.
 */
export function keyedHash(secret: string, pepper: string): string {
  return createHmac("sha256", pepper).update(secret, "utf8").digest("hex");
}

/** Plain SHA-256 hex — for non-secret fingerprints (e.g. deriving a stable
 *  storage key from an opaque token when no pepper is warranted). */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Constant-time string equality. Returns false for length mismatch without
 * leaking which side differed. Both inputs are hashed to a fixed width first so
 * `timingSafeEqual`'s own length requirement can't itself leak length.
 */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Split a presented bearer/refresh token of the form `<id>.<secret>` into its
 * parts. Returns null on any malformed input — callers treat null as an
 * ordinary auth failure (fail closed), never as a parse error to report.
 */
export function splitCompositeToken(token: string): { id: string; secret: string } | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const id = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (!id || !secret) return null;
  return { id, secret };
}

/** Compose an `<id>.<secret>` token. The secret half is what gets hashed for
 *  storage; the id half is a fast lookup key. */
export function makeCompositeToken(id: string, secret: string): string {
  return `${id}.${secret}`;
}
