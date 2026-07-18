/**
 * Provider configuration — fail-closed validation. Errors must identify the
 * offending FIELD but never echo a secret value. Offline, deterministic.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveProviderConfig } from "./providerConfig.js";

const SECRET = "s".repeat(40);

test("a fully-disabled development config resolves (explicit disabled-provider mode)", () => {
  const r = resolveProviderConfig({ NODE_ENV: "development" }, { requireStrict: false });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.config.providerName, "disabled");
    assert.equal(r.config.providerStatus, "disabled");
    assert.equal(r.config.webhooks.enabled, false);
  }
});

test("a valid strict config with webhooks enabled resolves and freezes", () => {
  const r = resolveProviderConfig(
    {
      NODE_ENV: "production",
      IDENTITY_FEATURE_WEBHOOKS: "true",
      IDENTITY_WEBHOOK_CURRENT_KEY_ID: "k2",
      IDENTITY_WEBHOOK_CURRENT_SECRET: SECRET,
      IDENTITY_WEBHOOK_PREVIOUS_KEY_ID: "k1",
      IDENTITY_WEBHOOK_PREVIOUS_SECRET: SECRET,
      IDENTITY_WEBHOOK_PREVIOUS_EXPIRES_AT: "2026-08-01T00:00:00Z",
      IDENTITY_REDIRECT_ORIGINS: "https://movenrun.app",
      IDENTITY_DEEPLINK_SCHEMES: "movenrun",
    },
    { requireStrict: true }
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.config.webhooks.enabled, true);
    assert.equal(r.config.webhooks.currentKey!.keyId, "k2");
    assert.equal(r.config.webhooks.previousKey!.keyId, "k1");
    assert.ok(Object.isFrozen(r.config));
    assert.ok(Object.isFrozen(r.config.webhooks));
  }
});

test("webhooks enabled without a signing key fails closed", () => {
  const r = resolveProviderConfig(
    { NODE_ENV: "production", IDENTITY_FEATURE_WEBHOOKS: "true" },
    { requireStrict: true }
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.some((e) => e.includes("IDENTITY_WEBHOOK_CURRENT")));
});

test("a short webhook secret is rejected and its value never appears in the error", () => {
  const shortSecret = "too-short-secret";
  const r = resolveProviderConfig(
    {
      NODE_ENV: "production",
      IDENTITY_FEATURE_WEBHOOKS: "true",
      IDENTITY_WEBHOOK_CURRENT_KEY_ID: "k1",
      IDENTITY_WEBHOOK_CURRENT_SECRET: shortSecret,
    },
    { requireStrict: true }
  );
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.errors.some((e) => e.includes("IDENTITY_WEBHOOK_CURRENT_SECRET")));
    assert.ok(!r.errors.join(" ").includes(shortSecret), "secret value must never be echoed");
  }
});

test("a previous key without a bounded expiry is rejected (no unlimited historical keys)", () => {
  const r = resolveProviderConfig(
    {
      NODE_ENV: "production",
      IDENTITY_FEATURE_WEBHOOKS: "true",
      IDENTITY_WEBHOOK_CURRENT_KEY_ID: "k2",
      IDENTITY_WEBHOOK_CURRENT_SECRET: SECRET,
      IDENTITY_WEBHOOK_PREVIOUS_KEY_ID: "k1",
      IDENTITY_WEBHOOK_PREVIOUS_SECRET: SECRET,
      // no IDENTITY_WEBHOOK_PREVIOUS_EXPIRES_AT
    },
    { requireStrict: true }
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.some((e) => e.includes("bounded overlap")));
});

test("a malformed provider API URL is rejected", () => {
  const r = resolveProviderConfig(
    { NODE_ENV: "production", IDENTITY_PROVIDER_API_BASE_URL: "not a url" },
    { requireStrict: true }
  );
  assert.equal(r.ok, false);
});

test("plain http is rejected in production but loopback http is allowed outside it", () => {
  const prod = resolveProviderConfig(
    { NODE_ENV: "production", IDENTITY_PROVIDER_API_BASE_URL: "http://api.example.com" },
    { requireStrict: true }
  );
  assert.equal(prod.ok, false);
  const dev = resolveProviderConfig(
    { NODE_ENV: "development", IDENTITY_PROVIDER_API_BASE_URL: "http://127.0.0.1:9999" },
    { requireStrict: false }
  );
  assert.equal(dev.ok, true);
});

test("debug/tunnel endpoints are rejected in production even over https", () => {
  for (const url of ["https://api.dev", "https://abc.ngrok.io", "https://x.trycloudflare.com", "https://localhost"]) {
    const r = resolveProviderConfig(
      { NODE_ENV: "production", IDENTITY_PROVIDER_API_BASE_URL: url },
      { requireStrict: true }
    );
    assert.equal(r.ok, false, `${url} must be rejected`);
  }
});

test("wildcard redirect origins are rejected", () => {
  const r = resolveProviderConfig(
    { NODE_ENV: "production", IDENTITY_REDIRECT_ORIGINS: "https://*.movenrun.app" },
    { requireStrict: true }
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.some((e) => e.includes("wildcard")));
});

test("redirect origins with paths or queries are rejected (exact origins only)", () => {
  const r = resolveProviderConfig(
    { NODE_ENV: "production", IDENTITY_REDIRECT_ORIGINS: "https://movenrun.app/callback" },
    { requireStrict: true }
  );
  assert.equal(r.ok, false);
});

test("an unknown provider name is rejected", () => {
  const r = resolveProviderConfig(
    { NODE_ENV: "production", IDENTITY_PROVIDER_NAME: "totally-unknown-vendor" },
    { requireStrict: true }
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.some((e) => e.includes("unknown provider")));
});

test("a short provider API secret is rejected without echoing it", () => {
  const r = resolveProviderConfig(
    { NODE_ENV: "development", IDENTITY_PROVIDER_API_SECRET: "shorty" },
    { requireStrict: false }
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(!r.errors.join(" ").includes("shorty"));
});

test("no feature gate can bypass verification: enabling webhooks without keys never yields an enabled boundary", () => {
  // Even outside strict mode the gate cannot turn on an unverifiable boundary.
  const r = resolveProviderConfig(
    { NODE_ENV: "development", IDENTITY_FEATURE_WEBHOOKS: "true" },
    { requireStrict: false }
  );
  // Non-strict mode: missing keys are an error too — the gate is all-or-nothing.
  assert.equal(r.ok, false);
});
