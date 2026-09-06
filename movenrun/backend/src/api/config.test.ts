import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { resolveApiConfig } from "./config.js";

const env = () => ({
  NODE_ENV: "production", DATABASE_URL: "postgres://localhost/preview_test",
  CORS_ORIGINS: "https://preview.example.com",
  IDENTITY_SESSION_PEPPER: randomBytes(32).toString("hex"),
  IDENTITY_OTP_PEPPER: randomBytes(32).toString("hex"),
});

test("V3 boot configuration needs no worker, Redis, oracle or contract variables", () => {
  assert.equal(resolveApiConfig(env()).PORT, 3000);
});

test("V3 refuses missing, short or reused peppers in every environment", () => {
  for (const NODE_ENV of ["production", "development", "test"]) {
    const valid = { ...env(), NODE_ENV };
    assert.throws(() => resolveApiConfig({ ...valid, IDENTITY_SESSION_PEPPER: undefined }));
    assert.throws(() => resolveApiConfig({ ...valid, IDENTITY_OTP_PEPPER: undefined }));
    assert.throws(() => resolveApiConfig({ ...valid, IDENTITY_OTP_PEPPER: "short" }));
    assert.throws(() => resolveApiConfig({ ...valid, IDENTITY_OTP_PEPPER: valid.IDENTITY_SESSION_PEPPER }));
  }
});

test("V3 requires explicit HTTPS origins and bounded proxy/rate-limit settings", () => {
  for (const CORS_ORIGINS of [undefined, "", "*", "http://example.com", "https://example.com/path", "https://user:password@example.com"]) {
    assert.throws(() => resolveApiConfig({ ...env(), CORS_ORIGINS }));
  }
  for (const [key, value] of [["TRUST_PROXY_HOPS", "2"], ["RATE_LIMIT_MAX", "0"], ["DATABASE_URL", "https://example.com"]]) {
    assert.throws(() => resolveApiConfig({ ...env(), [key]: value }));
  }
});
