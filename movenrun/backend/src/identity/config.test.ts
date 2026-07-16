/**
 * Identity config — fail-closed validation. In production, missing session/OTP
 * peppers and a half-configured Google provider are hard errors; a fully unset
 * Google provider is simply disabled.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveIdentityConfig } from "./config.js";

test("production requires the session and OTP peppers", () => {
  const r = resolveIdentityConfig({ NODE_ENV: "production" }, { requireSecrets: true });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.includes("IDENTITY_SESSION_PEPPER")));
    assert.ok(r.errors.some((e) => e.includes("IDENTITY_OTP_PEPPER")));
  }
});

test("a fully-provided production config resolves", () => {
  const r = resolveIdentityConfig(
    {
      NODE_ENV: "production",
      IDENTITY_SESSION_PEPPER: "x".repeat(24),
      IDENTITY_OTP_PEPPER: "y".repeat(24),
      IDENTITY_ALLOWED_CHAIN_IDS: "84532, 8453",
      IDENTITY_AUTH_DOMAIN: "movenrun.app",
    },
    { requireSecrets: true }
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.config.allowedChainIds, [84532, 8453]);
    assert.equal(r.config.googleStatus, "disabled");
    assert.equal(r.config.embeddedWalletEnabled, false);
  }
});

test("a partially-configured Google provider fails closed in production", () => {
  const r = resolveIdentityConfig(
    {
      NODE_ENV: "production",
      IDENTITY_SESSION_PEPPER: "x".repeat(24),
      IDENTITY_OTP_PEPPER: "y".repeat(24),
      IDENTITY_GOOGLE_CLIENT_ID: "client-id-only",
    },
    { requireSecrets: true }
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.some((e) => e.toLowerCase().includes("google")));
});

test("a fully-configured Google provider is enabled", () => {
  const r = resolveIdentityConfig(
    {
      NODE_ENV: "production",
      IDENTITY_SESSION_PEPPER: "x".repeat(24),
      IDENTITY_OTP_PEPPER: "y".repeat(24),
      IDENTITY_GOOGLE_CLIENT_ID: "cid",
      IDENTITY_GOOGLE_CLIENT_SECRET: "csecret",
      IDENTITY_GOOGLE_REDIRECT_URIS: "https://movenrun.app/cb,https://movenrun.app/cb2",
    },
    { requireSecrets: true }
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.config.googleStatus, "enabled");
    assert.equal(r.config.google!.redirectUris.length, 2);
  }
});

test("development without peppers resolves (dev-only fallback), never for production", () => {
  const r = resolveIdentityConfig({ NODE_ENV: "development" }, { requireSecrets: false });
  assert.equal(r.ok, true);
  if (r.ok) assert.ok(r.config.sessionPepper.length >= 16);
});
