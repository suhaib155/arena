/**
 * EmailOtpService — hashed codes, single use, attempt caps, resend throttle,
 * no user enumeration, fail-closed delivery. Offline: delivery is a capturing
 * double, never a real email provider.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "../testDoubles/harness.js";
import { EmailOtpService } from "./emailOtp.service.js";
import { isIdentityError, type IdentityErrorCode } from "../domain/errors.js";

async function expectError(fn: () => Promise<unknown>, code: IdentityErrorCode): Promise<void> {
  try {
    await fn();
    assert.fail(`expected IdentityError(${code}) but call succeeded`);
  } catch (err) {
    assert.ok(isIdentityError(err), `expected IdentityError, got ${String(err)}`);
    assert.equal(err.code, code);
  }
}

test("begin issues a challenge and delivers a code out-of-band (never returned)", async () => {
  const h = createHarness({ otpGen: () => "123456" });
  const { challengeId } = await h.emailOtp.begin({ email: "User@Example.com" });
  assert.ok(challengeId);
  assert.notEqual(challengeId, "123456");
  // The code reached the delivery channel only, normalized email.
  assert.equal(h.delivery.lastCodeFor("user@example.com"), "123456");
  // The stored challenge holds only a hash, never the plaintext code.
  const stored = await h.stores.otpChallenges.findActiveByEmail("user@example.com", h.now());
  assert.ok(stored);
  assert.notEqual(stored!.codeHash, "123456");
});

test("complete with the correct code returns a verified email identity", async () => {
  const h = createHarness({ otpGen: () => "111111" });
  await h.emailOtp.begin({ email: "a@example.com" });
  const result = await h.emailOtp.complete({ email: "a@example.com", code: "111111" });
  assert.equal(result.provider, "email_otp");
  assert.equal(result.providerSubject, "a@example.com");
  assert.equal(result.emailVerified, true);
});

test("a wrong code fails and is indistinguishable from no challenge (no enumeration)", async () => {
  const h = createHarness({ otpGen: () => "222222" });
  await h.emailOtp.begin({ email: "known@example.com" });
  await expectError(() => h.emailOtp.complete({ email: "known@example.com", code: "000000" }), "verification_failed");
  // Unknown email → same error code, no distinguishing signal.
  await expectError(() => h.emailOtp.complete({ email: "unknown@example.com", code: "000000" }), "verification_failed");
});

test("the code is single-use", async () => {
  const h = createHarness({ otpGen: () => "333333" });
  await h.emailOtp.begin({ email: "s@example.com" });
  await h.emailOtp.complete({ email: "s@example.com", code: "333333" });
  await expectError(() => h.emailOtp.complete({ email: "s@example.com", code: "333333" }), "verification_failed");
});

test("attempts are capped", async () => {
  const h = createHarness({ otpGen: () => "444444" });
  await h.emailOtp.begin({ email: "cap@example.com" });
  for (let i = 0; i < 5; i++) {
    await expectError(() => h.emailOtp.complete({ email: "cap@example.com", code: "999999" }), "verification_failed");
  }
  // 6th attempt is blocked by the cap (maxAttempts = 5).
  await expectError(() => h.emailOtp.complete({ email: "cap@example.com", code: "444444" }), "too_many_attempts");
});

test("resend is throttled, then allowed after the cooldown", async () => {
  const h = createHarness({ otpGen: () => "555555" });
  await h.emailOtp.begin({ email: "throttle@example.com" });
  await expectError(() => h.emailOtp.begin({ email: "throttle@example.com" }), "too_many_attempts");
  h.advanceSeconds(31); // otpResendCooldownSeconds = 30
  const again = await h.emailOtp.begin({ email: "throttle@example.com" });
  assert.ok(again.challengeId);
});

test("begin fails closed when no delivery provider is configured", async () => {
  const h = createHarness();
  const noDelivery = new EmailOtpService({
    otpChallenges: h.stores.otpChallenges,
    audit: h.audit,
    config: { otpPepper: "p".repeat(16), otpTtlSeconds: 300, otpMaxAttempts: 5, otpResendCooldownSeconds: 30 },
    delivery: null,
    now: h.now,
  });
  await expectError(() => noDelivery.begin({ email: "ok@example.com" }), "provider_not_configured");
});

test("an invalid email is rejected without leaking anything", async () => {
  const h = createHarness();
  await expectError(() => h.emailOtp.begin({ email: "not-an-email" }), "invalid_request");
});

test("email OTP integrates with identity to create a canonical user", async () => {
  const h = createHarness({ otpGen: () => "666666" });
  await h.emailOtp.begin({ email: "flow@example.com" });
  const verified = await h.emailOtp.complete({ email: "flow@example.com", code: "666666" });
  const auth = await h.identity.authenticate({
    provider: verified.provider,
    providerSubject: verified.providerSubject,
    normalizedEmail: verified.normalizedEmail,
    emailVerified: true,
  });
  assert.equal(auth.created, true);
  assert.equal(auth.identity.provider, "email_otp");
});

// ---- app-review sign-in ----------------------------------------------------

const REVIEW = { email: "play-review@movenrun.test", code: "730518" };

test("the review email signs in with the configured code and nothing is emailed", async () => {
  const h = createHarness({ otpGen: () => "999999", reviewAccess: REVIEW });
  const { challengeId } = await h.emailOtp.begin({ email: "Play-Review@MovenRun.test" });
  assert.ok(challengeId);
  assert.equal(h.delivery.lastCodeFor(REVIEW.email), undefined, "no email is sent for the review account");
  const stored = await h.stores.otpChallenges.findActiveByEmail(REVIEW.email, h.now());
  assert.ok(stored);
  assert.notEqual(stored!.codeHash, REVIEW.code, "the review code is stored hashed like any other");
  const result = await h.emailOtp.complete({ email: REVIEW.email, code: REVIEW.code });
  assert.equal(result.providerSubject, REVIEW.email);
});

test("the review code works only for the review email, only after begin, and only once", async () => {
  const h = createHarness({ otpGen: () => "999999", reviewAccess: REVIEW });
  // No challenge yet: the static code alone is not a sign-in.
  await expectError(() => h.emailOtp.complete({ email: REVIEW.email, code: REVIEW.code }), "verification_failed");
  // Any other email gets a normal emailed code; the review code is useless there.
  await h.emailOtp.begin({ email: "someone@example.com" });
  assert.equal(h.delivery.lastCodeFor("someone@example.com"), "999999");
  await expectError(() => h.emailOtp.complete({ email: "someone@example.com", code: REVIEW.code }), "verification_failed");
  // Single use.
  await h.emailOtp.begin({ email: REVIEW.email });
  await h.emailOtp.complete({ email: REVIEW.email, code: REVIEW.code });
  await expectError(() => h.emailOtp.complete({ email: REVIEW.email, code: REVIEW.code }), "verification_failed");
});

test("the review account keeps the attempt cap, expiry and resend throttle", async () => {
  const h = createHarness({ reviewAccess: REVIEW });
  await h.emailOtp.begin({ email: REVIEW.email });
  await expectError(() => h.emailOtp.begin({ email: REVIEW.email }), "too_many_attempts");
  for (let i = 0; i < 5; i++) {
    await expectError(() => h.emailOtp.complete({ email: REVIEW.email, code: "000001" }), "verification_failed");
  }
  await expectError(() => h.emailOtp.complete({ email: REVIEW.email, code: REVIEW.code }), "too_many_attempts");
  h.advanceSeconds(301);
  await expectError(() => h.emailOtp.complete({ email: REVIEW.email, code: REVIEW.code }), "verification_failed");
});

test("without review configuration the review email is an ordinary email", async () => {
  const h = createHarness({ otpGen: () => "246810" });
  await h.emailOtp.begin({ email: REVIEW.email });
  assert.equal(h.delivery.lastCodeFor(REVIEW.email), "246810");
  await expectError(() => h.emailOtp.complete({ email: REVIEW.email, code: REVIEW.code }), "verification_failed");
});
