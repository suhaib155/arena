/**
 * Email/OTP form rules and public error copy.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authErrorMessage,
  canSubmitEmail,
  canSubmitOtp,
  normalizeEmail,
  normalizeOtpCode,
  OTP_LENGTH,
} from "../emailAuth";

test("email normalization matches the server rule (trim + lowercase, fail closed)", () => {
  assert.equal(normalizeEmail("  Runner@Example.COM "), "runner@example.com");
  assert.equal(normalizeEmail(""), null);
  assert.equal(normalizeEmail("nope"), null);
  assert.equal(normalizeEmail("a@b"), null, "the domain needs a dot");
  assert.equal(normalizeEmail("a b@c.com"), null, "no whitespace");
  assert.equal(normalizeEmail(`${"a".repeat(250)}@b.com`), null, "over 254 characters");
});

test("no account-existence probing: normalization is the only local check", () => {
  // Two different addresses are treated identically — the client never learns
  // or reveals whether either one already has an account.
  assert.equal(canSubmitEmail("new@example.com"), canSubmitEmail("returning@example.com"));
});

test("the one-time code is digits only and fixed length", () => {
  assert.equal(normalizeOtpCode("12-34 56"), "123456");
  assert.equal(normalizeOtpCode("1234567890"), "123456");
  assert.equal(canSubmitOtp("12345"), false);
  assert.equal(canSubmitOtp("123456"), true);
  assert.equal(canSubmitOtp("abcdef"), false);
  assert.equal(OTP_LENGTH, 6);
});

test("every public error code maps to fixed, non-technical copy", () => {
  const codes = [
    "api_base_url_unset",
    "client_unavailable",
    "service_unavailable",
    "invalid_email",
    "verification_failed",
    "code_expired",
    "too_many_attempts",
    "provider_not_configured",
    "session_invalid",
  ];
  for (const code of codes) {
    const message = authErrorMessage(code);
    assert.ok(message && message.length > 0, code);
    assert.ok(!message!.includes(code), `${code}: the raw code must not be shown`);
    assert.ok(!/http|fetch|undefined|null|stack|Error:/i.test(message!), `${code}: no technical detail`);
  }
});

test("an unknown code collapses to one neutral message and leaks nothing", () => {
  assert.equal(authErrorMessage(null), null);
  const unknown = authErrorMessage("user_not_found_in_shard_7");
  assert.equal(unknown, "Something went wrong. Please try again.");
  // Crucially, an unknown code can never disclose account existence.
  assert.equal(unknown, authErrorMessage("some_other_backend_code"));
});
