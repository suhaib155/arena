/**
 * Security primitives — OTP shape/uniqueness, keyed hashing determinism,
 * constant-time equality, and composite-token parsing. Pure, offline.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  keyedHash,
  makeCompositeToken,
  randomNumericOtp,
  randomToken,
  safeEqual,
  sha256Hex,
  splitCompositeToken,
} from "./secure.js";

test("randomNumericOtp returns a zero-padded code of the requested length", () => {
  for (let i = 0; i < 200; i++) {
    const otp = randomNumericOtp(6);
    assert.match(otp, /^[0-9]{6}$/);
  }
});

test("randomToken values are URL-safe and effectively unique", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const t = randomToken(16);
    assert.match(t, /^[A-Za-z0-9_-]+$/);
    assert.ok(!seen.has(t));
    seen.add(t);
  }
});

test("keyedHash is deterministic per (secret, pepper) and changes with the pepper", () => {
  assert.equal(keyedHash("code", "pepper-a"), keyedHash("code", "pepper-a"));
  assert.notEqual(keyedHash("code", "pepper-a"), keyedHash("code", "pepper-b"));
  assert.notEqual(keyedHash("code-1", "pepper-a"), keyedHash("code-2", "pepper-a"));
  // The hash never contains the plaintext secret.
  assert.ok(!keyedHash("supersecret", "pepper").includes("supersecret"));
});

test("safeEqual compares by value and rejects differences", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false);
});

test("composite token round-trips and rejects malformed input", () => {
  const t = makeCompositeToken("sessionId", "secretPart");
  assert.deepEqual(splitCompositeToken(t), { id: "sessionId", secret: "secretPart" });
  assert.equal(splitCompositeToken("nodot"), null);
  assert.equal(splitCompositeToken(".onlysecret"), null);
  assert.equal(splitCompositeToken("onlyid."), null);
});

test("sha256Hex is stable", () => {
  assert.equal(sha256Hex("x"), sha256Hex("x"));
  assert.match(sha256Hex("x"), /^[0-9a-f]{64}$/);
});
