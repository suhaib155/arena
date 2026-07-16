/**
 * Email OTP: begin (issue + deliver a hashed code) and complete (verify).
 *
 * Security properties:
 *  - The code is stored ONLY as a keyed (peppered) hash — never plaintext,
 *    never logged, never returned by the API.
 *  - Single-use with an atomic consume; short expiry; per-challenge attempt
 *    cap; resend throttling.
 *  - No user enumeration: begin() behaves identically for known and unknown
 *    emails, and complete() returns the SAME `verification_failed` error for
 *    "no such challenge", "wrong code", and "already used".
 *  - The replay/rate-limit authority is the shared store (DB in production),
 *    so it is replica-safe — not a process-local Map.
 *
 * Delivery is an external side effect behind EmailOtpDeliveryProvider; this PR
 * wires no real sender, so begin() fails closed (`provider_not_configured`)
 * unless a delivery adapter is supplied. Tests supply a capturing double.
 */
import { keyedHash, newId, randomNumericOtp, safeEqual } from "../crypto/secure.js";
import { normalizeEmail } from "../domain/email.js";
import { IdentityError } from "../domain/errors.js";
import type { OtpChallengeRepository } from "../repositories/interfaces.js";
import type { EmailOtpDeliveryProvider } from "../providers/types.js";
import type { AuditService } from "./audit.service.js";

export interface EmailOtpConfig {
  otpPepper: string;
  otpTtlSeconds: number;
  otpMaxAttempts: number;
  otpResendCooldownSeconds: number;
}

interface Deps {
  otpChallenges: OtpChallengeRepository;
  audit: AuditService;
  config: EmailOtpConfig;
  delivery?: EmailOtpDeliveryProvider | null;
  now?: () => Date;
  idGen?: () => string;
  /** Overridable for deterministic tests. */
  otpGen?: () => string;
}

export interface OtpVerificationResult {
  provider: "email_otp";
  providerSubject: string;
  normalizedEmail: string;
  emailVerified: true;
}

export class EmailOtpService {
  private readonly otpChallenges: OtpChallengeRepository;
  private readonly audit: AuditService;
  private readonly config: EmailOtpConfig;
  private readonly delivery: EmailOtpDeliveryProvider | null;
  private readonly now: () => Date;
  private readonly idGen: () => string;
  private readonly otpGen: () => string;

  constructor(deps: Deps) {
    this.otpChallenges = deps.otpChallenges;
    this.audit = deps.audit;
    this.config = deps.config;
    this.delivery = deps.delivery ?? null;
    this.now = deps.now ?? (() => new Date());
    this.idGen = deps.idGen ?? newId;
    this.otpGen = deps.otpGen ?? (() => randomNumericOtp(6));
  }

  /** Issue and deliver an OTP. Returns an opaque challenge id only — never the
   *  code, and no signal about whether the email is already known. */
  async begin(input: { email: string; requestSourceHash?: string | null }): Promise<{ challengeId: string }> {
    if (!this.delivery) throw new IdentityError("provider_not_configured");
    const email = normalizeEmail(input.email);
    if (!email) throw new IdentityError("invalid_request", "invalid email");

    const now = this.now();
    const existing = await this.otpChallenges.findActiveByEmail(email, now);
    if (existing) {
      const sinceLastSent = (now.getTime() - existing.lastSentAt.getTime()) / 1000;
      if (sinceLastSent < this.config.otpResendCooldownSeconds) {
        // Uniform throttle response — does not reveal whether the email exists.
        throw new IdentityError("too_many_attempts");
      }
    }

    const code = this.otpGen();
    const challenge = await this.otpChallenges.create({
      id: this.idGen(),
      normalizedEmail: email,
      purpose: "auth",
      codeHash: keyedHash(code, this.config.otpPepper),
      maxAttempts: this.config.otpMaxAttempts,
      requestSourceHash: input.requestSourceHash ?? null,
      expiresAt: new Date(now.getTime() + this.config.otpTtlSeconds * 1000),
    });

    // Deliver out-of-band. The code lives only in this call frame and the
    // provider; it is never persisted, logged, or returned.
    await this.delivery.sendOtp({ email, code, ttlSeconds: this.config.otpTtlSeconds });
    return { challengeId: challenge.id };
  }

  /** Verify a submitted code. On success returns the verified email identity
   *  the caller uses to resolve/create the MovenRun user. */
  async complete(input: { email: string; code: string }): Promise<OtpVerificationResult> {
    const email = normalizeEmail(input.email);
    if (!email) throw new IdentityError("verification_failed");

    const now = this.now();
    const challenge = await this.otpChallenges.findActiveByEmail(email, now);
    if (!challenge) {
      await this.audit.record("login_failed", { metadata: { method: "email_otp", reason: "no_active_challenge" } });
      throw new IdentityError("verification_failed");
    }
    if (challenge.attempts >= challenge.maxAttempts) {
      throw new IdentityError("too_many_attempts");
    }

    await this.otpChallenges.incrementAttempts(challenge.id);
    const expected = challenge.codeHash;
    const presented = keyedHash(input.code, this.config.otpPepper);
    if (!safeEqual(presented, expected)) {
      await this.audit.record("login_failed", { metadata: { method: "email_otp", reason: "bad_code" } });
      throw new IdentityError("verification_failed");
    }

    // Atomic single-use consume — a valid code cannot be replayed.
    const consumed = await this.otpChallenges.consume(challenge.id, now);
    if (!consumed) throw new IdentityError("verification_failed");

    return { provider: "email_otp", providerSubject: email, normalizedEmail: email, emailVerified: true };
  }
}
