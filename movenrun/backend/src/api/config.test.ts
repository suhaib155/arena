import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { resolveApiConfig } from "./config.js";

const env = () => ({
  NODE_ENV: "production", DATABASE_URL: "postgres://localhost/preview_test",
  CORS_ORIGINS: "https://preview.example.com",
  IDENTITY_SESSION_PEPPER: randomBytes(32).toString("hex"),
  SUPABASE_URL: "https://movenrun-test.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_SECRET_KEY: "sb_secret_test",
  IDENTITY_AUTH_DOMAIN: "movenrun.xyz",
});

test("V3 boot configuration needs no worker, Redis, oracle or contract variables", () => {
  assert.equal(resolveApiConfig(env()).PORT, 3000);
});

test("V3 refuses a missing or short session pepper in every environment", () => {
  for (const NODE_ENV of ["production", "development", "test"]) {
    const valid = { ...env(), NODE_ENV };
    assert.throws(() => resolveApiConfig({ ...valid, IDENTITY_SESSION_PEPPER: undefined }));
    assert.throws(() => resolveApiConfig({ ...valid, IDENTITY_SESSION_PEPPER: "short".repeat(4) }));
    // Email codes are not part of the API, so their settings change nothing.
    assert.doesNotThrow(() => resolveApiConfig({ ...valid, RESEND_API_KEY: "re_test", IDENTITY_OTP_PEPPER: undefined }));
  }
});

test("V3 needs Supabase Auth and a wallet sign-in domain, and no email delivery", () => {
  assert.equal(resolveApiConfig(env()).supabase.url, "https://movenrun-test.supabase.co");
  for (const key of ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "IDENTITY_AUTH_DOMAIN"]) {
    assert.throws(() => resolveApiConfig({ ...env(), [key]: undefined }), key);
  }
  assert.throws(() => resolveApiConfig({ ...env(), IDENTITY_AUTH_DOMAIN: "https://movenrun.xyz" }));
  assert.throws(() => resolveApiConfig({ ...env(), SUPABASE_SECRET_KEY: "sb_publishable_test" }));
  assert.equal("RESEND_API_KEY" in env(), false);
});

test("V3 requires explicit HTTPS origins and bounded proxy/rate-limit settings", () => {
  for (const CORS_ORIGINS of [undefined, "", "*", "http://example.com", "https://example.com/path", "https://user:password@example.com"]) {
    assert.throws(() => resolveApiConfig({ ...env(), CORS_ORIGINS }));
  }
  for (const [key, value] of [["TRUST_PROXY_HOPS", "4"], ["TRUST_PROXY", "all"], ["TRUST_PROXY_HOPS", "-1"], ["RATE_LIMIT_MAX", "0"], ["DATABASE_URL", "https://example.com"]]) {
    assert.throws(() => resolveApiConfig({ ...env(), [key]: value }));
  }
});
