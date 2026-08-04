/**
 * Bootstrap must never get permanently stuck.
 *
 * The previous implementation set a module-level `bootstrapped = true` BEFORE
 * awaiting restoration. Any unexpected rejection beneath it (a keystore
 * adapter throwing, an uninstalled secure store, a malformed response) left the
 * app pinned on `restoring` forever, with the flag suppressing every future
 * attempt. These tests drive the real store through each of those failures.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSecureSessionStore } from "../../lib/secureSession";
import { createTestSecureBackend } from "../../lib/secureSession.testBackend";
import { IdentityApiClient } from "../../services/identityApi";
import { resetAuthBootstrapForTests, useAuthStore } from "../useAuthStore";

const FUTURE = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
const TOKENS = () => ({
  accessToken: "access-1",
  accessTokenExpiresAt: FUTURE(),
  refreshToken: "refresh-1",
  refreshTokenExpiresAt: FUTURE(),
});

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

const state = () => useAuthStore.getState();

/** Put the store back in a pre-bootstrap shape with the given client. */
function reset(client: IdentityApiClient | null) {
  resetAuthBootstrapForTests();
  useAuthStore.setState({
    status: "unknown",
    operation: "idle",
    lastRestore: null,
    authErrorCode: null,
    restoreErrorCode: null,
    restoreErrorAcknowledged: false,
    user: null,
    identities: [],
    wallets: [],
    client,
  });
}

test("a SecureStore read failure resolves to a recoverable state, never a stuck splash", async () => {
  const backend = createTestSecureBackend();
  backend.options.failGet = true; // every load() throws inside the adapter
  const store = createSecureSessionStore(backend);
  globalThis.fetch = (async () => json(200, {})) as typeof fetch;
  reset(new IdentityApiClient({ baseUrl: "https://identity.test", store }));

  await state().retryRestore();

  // The secure-store core fails closed on a read: "no session" is a definite
  // answer, so the app resolves rather than hanging.
  assert.notEqual(state().status, "restoring", "never left mid-restore");
  assert.notEqual(state().lastRestore, null, "the attempt resolved");
  assert.equal(state().operation, "idle");
});

test("an unexpected throw inside restoration is recoverable and clears nothing", async () => {
  const store = createSecureSessionStore(createTestSecureBackend());
  await store.save(TOKENS());
  const client = new IdentityApiClient({ baseUrl: "https://identity.test", store });
  // Force an unexpected rejection from the client itself.
  Object.defineProperty(client, "restoreSession", {
    value: async () => {
      throw new Error("boom: unexpected internal failure");
    },
  });
  reset(client);

  await state().retryRestore();

  assert.equal(state().status, "unknown", "no false signed-out claim");
  assert.equal(state().lastRestore, "unavailable");
  assert.equal(state().restoreErrorCode, "service_unavailable", "a stable public code");
  assert.notEqual(await store.load(), null, "credentials are untouched by an unknown failure");
});

test("the recoverable failure never leaks exception text into a public code", async () => {
  assert.equal(state().restoreErrorCode, "service_unavailable");
  assert.ok(!/boom|Error|stack/i.test(String(state().restoreErrorCode)));
});

test("a recoverable failure stays retryable — Retry genuinely retries", async () => {
  const store = createSecureSessionStore(createTestSecureBackend());
  await store.save(TOKENS());
  let attempt = 0;
  globalThis.fetch = (async (input: string) => {
    const url = String(input);
    attempt += 1;
    if (attempt <= 2) throw new TypeError("Network request failed");
    if (url.endsWith("/identity/me")) {
      return json(200, { user: { id: "usr_1", status: "active", createdAt: FUTURE() }, session: {}, identities: [] });
    }
    if (url.endsWith("/identity/wallets")) return json(200, { wallets: [] });
    return json(404, {});
  }) as typeof fetch;
  reset(new IdentityApiClient({ baseUrl: "https://identity.test", store }));

  await state().initialize();
  assert.equal(state().restoreErrorCode, "service_unavailable", "first attempt fails recoverably");
  assert.equal(state().status, "unknown");

  await state().retryRestore();
  assert.equal(state().status, "signedIn", "the retry actually reached the server");
  assert.equal(state().restoreErrorCode, null, "and cleared the recoverable error");
});

test("concurrent initialize calls share ONE initialization", async () => {
  const store = createSecureSessionStore(createTestSecureBackend());
  await store.save(TOKENS());
  let meCalls = 0;
  globalThis.fetch = (async (input: string) => {
    const url = String(input);
    if (url.endsWith("/identity/me")) {
      meCalls += 1;
      return json(200, { user: { id: "usr_1", status: "active", createdAt: FUTURE() }, session: {}, identities: [] });
    }
    if (url.endsWith("/identity/wallets")) return json(200, { wallets: [] });
    return json(404, {});
  }) as typeof fetch;
  reset(new IdentityApiClient({ baseUrl: "https://identity.test", store }));

  await Promise.all([state().initialize(), state().initialize(), state().initialize()]);

  assert.equal(meCalls, 1, "three callers, one restore");
  assert.equal(state().status, "signedIn");

  // And a completed initialization is idempotent.
  await state().initialize();
  assert.equal(meCalls, 1, "a settled initialization does not run again");
});

test("with no backend configured, bootstrap resolves to a confirmed signed-out state", async () => {
  reset(null);
  // No client and no EXPO_PUBLIC_API_URL in the test environment.
  await state().retryRestore();

  assert.equal(state().status, "signedOut");
  assert.equal(state().lastRestore, "no-session");
  assert.equal(state().restoreErrorCode, null, "an unconfigured build is not an error to retry");
});

test("retryRestore refuses to race an in-flight auth request", async () => {
  const store = createSecureSessionStore(createTestSecureBackend());
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return json(200, {});
  }) as typeof fetch;
  reset(new IdentityApiClient({ baseUrl: "https://identity.test", store }));
  useAuthStore.setState({ operation: "verifyingOtp" });

  await state().retryRestore();

  assert.equal(calls, 0, "no restore is started underneath a verification");
  useAuthStore.setState({ operation: "idle" });
});
