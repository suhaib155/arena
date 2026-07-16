/**
 * WalletProvisioningService — idempotent request, no duplicate under
 * concurrency, safe transient retry, observable terminal failure, provider
 * replay idempotency, no secret persisted, active-wallet set exactly once.
 * Offline: the embedded provider is a deterministic double, never a network SDK.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness, type Harness } from "../testDoubles/harness.js";
import { EmbeddedWalletProviderDouble } from "../testDoubles/index.js";
import { EMBEDDED_WALLET_SOURCE } from "./authOrchestrator.service.js";
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

async function newUser(h: Harness): Promise<string> {
  const r = await h.identity.authenticate({ provider: "google", providerSubject: `p-${Math.random()}` });
  return r.user.id;
}

test("a provisioning request is created exactly once (idempotent)", async () => {
  const h = createHarness();
  const userId = await newUser(h);
  const a = await h.provisioning.request(userId, EMBEDDED_WALLET_SOURCE);
  const b = await h.provisioning.request(userId, EMBEDDED_WALLET_SOURCE);
  assert.equal(a.id, b.id);
  assert.equal(a.provisioningState, "requested");
  const all = await h.stores.wallets.listByUser(userId);
  assert.equal(all.filter((w) => w.isEmbedded).length, 1);
});

test("concurrent provisioning requests do not duplicate the wallet", async () => {
  const h = createHarness();
  const userId = await newUser(h);
  const results = await Promise.all(
    Array.from({ length: 8 }, () => h.provisioning.request(userId, EMBEDDED_WALLET_SOURCE))
  );
  const ids = new Set(results.map((w) => w.id));
  assert.equal(ids.size, 1);
});

test("provision completes, verifies, and sets the wallet active exactly once", async () => {
  const h = createHarness();
  const userId = await newUser(h);
  const requested = await h.provisioning.request(userId, EMBEDDED_WALLET_SOURCE);
  const provisioned = await h.provisioning.provision(requested.id);
  assert.equal(provisioned.provisioningState, "active");
  assert.equal(provisioned.ownershipStatus, "verified");
  assert.equal(provisioned.isActive, true);
  assert.ok(provisioned.addressCanonical && provisioned.addressCanonical.startsWith("0x"));
  // Provisioning again is a no-op (already active) — no second provider call.
  const again = await h.provisioning.provision(requested.id);
  assert.equal(again.provisioningState, "active");
  const active = await h.stores.wallets.findActiveByUser(userId);
  assert.equal(active!.id, provisioned.id);
});

test("a transient failure can be retried safely and then succeeds", async () => {
  const embedded = new EmbeddedWalletProviderDouble({ transientFailures: 1 });
  const h = createHarness({ embeddedProvider: embedded });
  const userId = await newUser(h);
  const requested = await h.provisioning.request(userId, EMBEDDED_WALLET_SOURCE);
  await expectError(() => h.provisioning.provision(requested.id), "conflict");
  const afterFail = await h.provisioning.status(requested.id);
  assert.equal(afterFail!.provisioningState, "failed_transient");
  const retried = await h.provisioning.retry(requested.id);
  assert.equal(retried.provisioningState, "active");
});

test("a terminal failure is observable and not silently retryable", async () => {
  const embedded = new EmbeddedWalletProviderDouble({ terminal: true });
  const h = createHarness({ embeddedProvider: embedded });
  const userId = await newUser(h);
  const requested = await h.provisioning.request(userId, EMBEDDED_WALLET_SOURCE);
  await expectError(() => h.provisioning.provision(requested.id), "provisioning_not_retryable");
  const state = await h.provisioning.status(requested.id);
  assert.equal(state!.provisioningState, "failed_terminal");
  await expectError(() => h.provisioning.retry(requested.id), "provisioning_not_retryable");
});

test("a provider replay is idempotent (same address, one active wallet)", async () => {
  const embedded = new EmbeddedWalletProviderDouble();
  const h = createHarness({ embeddedProvider: embedded });
  const userId = await newUser(h);
  const requested = await h.provisioning.request(userId, EMBEDDED_WALLET_SOURCE);
  const first = await h.provisioning.provision(requested.id);
  const second = await h.provisioning.provision(requested.id);
  assert.equal(first.addressCanonical, second.addressCanonical);
  const wallets = await h.stores.wallets.listByUser(userId);
  assert.equal(wallets.filter((w) => w.isActive).length, 1);
});

test("no secret material is persisted on the wallet record", async () => {
  const h = createHarness();
  const userId = await newUser(h);
  const requested = await h.provisioning.request(userId, EMBEDDED_WALLET_SOURCE);
  const provisioned = await h.provisioning.provision(requested.id);
  const keys = Object.keys(provisioned);
  for (const k of keys) {
    assert.ok(
      !/priv|secret|mnemonic|seed|key/i.test(k) || k === "providerWalletRef",
      `wallet record must not carry secret-shaped field: ${k}`
    );
  }
  // providerWalletRef is an opaque handle, not a secret.
  assert.ok(provisioned.providerWalletRef && !/^0x[0-9a-f]{64}$/i.test(provisioned.providerWalletRef));
});

test("provision fails closed when no embedded provider is configured", async () => {
  const h = createHarness({ embeddedProvider: null });
  const userId = await newUser(h);
  const requested = await h.provisioning.request(userId, EMBEDDED_WALLET_SOURCE);
  await expectError(() => h.provisioning.provision(requested.id), "provider_not_configured");
  // The wallet stays observably in `requested` — no fake wallet is created.
  const state = await h.provisioning.status(requested.id);
  assert.equal(state!.provisioningState, "requested");
});

test("full signup orchestration creates user, session, provisioning request, and (enabled) wallet", async () => {
  const h = createHarness({ embeddedWalletEnabled: true, provisionSynchronously: true });
  const result = await h.orchestrator.signupOrLogin({
    providerIdentity: { provider: "google", providerSubject: "orch-1", emailVerified: true },
  });
  assert.equal(result.created, true);
  assert.ok(result.session.accessToken);
  assert.ok(result.session.refreshToken);
  assert.ok(result.embeddedWallet);
  assert.equal(result.embeddedWallet!.provisioningState, "active");
  assert.equal(result.embeddedWallet!.isActive, true);
});

test("signup orchestration records a provisioning request even when provider is disabled", async () => {
  const h = createHarness({ embeddedWalletEnabled: false });
  const result = await h.orchestrator.signupOrLogin({
    providerIdentity: { provider: "google", providerSubject: "orch-2" },
  });
  assert.ok(result.embeddedWallet);
  assert.equal(result.embeddedWallet!.provisioningState, "requested");
  assert.equal(result.embeddedWallet!.isActive, false);
});
