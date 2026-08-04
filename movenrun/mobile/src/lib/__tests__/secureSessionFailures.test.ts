/**
 * Secure-storage failure classification.
 *
 * "There is no credential" and "the keystore could not be read" are different
 * facts. Collapsing the second into `null` let a transient read failure surface
 * as an unauthenticated request, which the restore path then classified as a
 * REJECTED session — and rejected sessions get deleted. These tests pin the
 * distinction at every layer: the store core, the identity client, and the
 * auth store's public error code.
 *
 * Fail-closed behaviour is unchanged: an unreadable keystore still grants no
 * access, still never falls back to AsyncStorage, and still exposes no token
 * material or platform exception text.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSecureSessionStore,
  isSecureSessionStorageError,
  SecureSessionStorageError,
  SESSION_STORAGE_KEY,
} from "../secureSession";
import { createTestSecureBackend } from "../secureSession.testBackend";
import { IdentityApiClient } from "../../services/identityApi";
import { authErrorMessage } from "../emailAuth";

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

// ---- the store core ---------------------------------------------------------

test("a missing key is no session — not a failure", async () => {
  const store = createSecureSessionStore(createTestSecureBackend());
  assert.equal(await store.load(), null);
});

test("a malformed record is no session, and is deleted best-effort", async () => {
  const backend = createTestSecureBackend();
  backend.map.set(SESSION_STORAGE_KEY, "{not json");
  const store = createSecureSessionStore(backend);
  assert.equal(await store.load(), null);
  assert.equal(backend.map.has(SESSION_STORAGE_KEY), false, "corrupt data is removed");
});

test("an expired record is no session, and is deleted best-effort", async () => {
  const backend = createTestSecureBackend();
  const store = createSecureSessionStore(backend);
  await store.save({ ...TOKENS(), refreshTokenExpiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal(await store.load(), null);
  assert.equal(backend.map.has(SESSION_STORAGE_KEY), false);
});

test("a keystore READ failure is a typed error, never a silent 'no session'", async () => {
  const backend = createTestSecureBackend();
  backend.options.failGet = true;
  const store = createSecureSessionStore(backend);

  await assert.rejects(
    () => store.load(),
    (err: unknown) => {
      assert.ok(isSecureSessionStorageError(err));
      assert.equal((err as SecureSessionStorageError).code, "read_unavailable");
      // No token material and no platform exception text travels with it.
      assert.ok(!/access-1|refresh-1|keystore unavailable/.test(String((err as Error).message)));
      return true;
    },
  );
});

test("write and clear failures are typed too — a persist is never assumed", async () => {
  const backend = createTestSecureBackend();
  const store = createSecureSessionStore(backend);

  backend.options.failSet = true;
  await assert.rejects(
    () => store.save(TOKENS()),
    (err: unknown) => isSecureSessionStorageError(err) && err.code === "write_failed",
  );

  backend.options.failSet = false;
  await store.save(TOKENS());
  backend.options.failDelete = true;
  await assert.rejects(
    () => store.clear(),
    (err: unknown) => isSecureSessionStorageError(err) && err.code === "clear_failed",
  );
});

// ---- the identity client ----------------------------------------------------

test("a read failure at restore is recoverable and deletes nothing", async () => {
  const backend = createTestSecureBackend();
  const store = createSecureSessionStore(backend);
  await store.save(TOKENS());
  const client = new IdentityApiClient({ baseUrl: "https://identity.test", store });
  let requests = 0;
  globalThis.fetch = (async () => {
    requests += 1;
    return json(200, {});
  }) as typeof fetch;

  backend.options.failGet = true;
  const outcome = await client.restoreSession();

  assert.equal(outcome.kind, "unavailable");
  assert.equal(outcome.kind === "unavailable" && outcome.code, "secure_storage_unavailable");
  assert.equal(requests, 0, "nothing is sent without credentials");
  backend.options.failGet = false;
  assert.notEqual(await store.load(), null, "the credential is still there");
});

test("a read failure MID-FLIGHT cannot become a false unauthorized", async () => {
  /* The dangerous sequence: the first read succeeds, the protected request is
     sent, and a later read fails transiently. Previously that produced `null`
     → 401 `unauthenticated` → classified as rejected → credentials deleted. */
  const backend = createTestSecureBackend();
  const store = createSecureSessionStore(backend);
  await store.save(TOKENS());
  const client = new IdentityApiClient({ baseUrl: "https://identity.test", store });

  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    // Force the refresh path, which performs another keystore read.
    backend.options.failGet = true;
    return json(401, { error: { code: "unauthenticated" } });
  }) as typeof fetch;

  const outcome = await client.restoreSession();

  assert.equal(outcome.kind, "unavailable", "not classified as rejected");
  assert.equal(outcome.kind === "unavailable" && outcome.code, "secure_storage_unavailable");
  backend.options.failGet = false;
  assert.notEqual(await store.load(), null, "valid credentials were NOT deleted");
  assert.ok(calls > 0);
});

test("a protected request whose OWN read fails is never classified as unauthorized", async () => {
  /* The precise dangerous path: `restoreSession` reads successfully, then the
     read inside the protected request fails. If that surfaced as 401
     `unauthenticated`, `restoreSession` would classify the session as REJECTED
     and delete valid credentials — without the server having said anything. */
  const backend = createTestSecureBackend();
  const store = createSecureSessionStore(backend);
  await store.save(TOKENS());

  let reads = 0;
  let deletes = 0;
  const flaky = {
    async getItem(key: string) {
      reads += 1;
      if (reads > 1) throw new Error("keystore temporarily unavailable");
      return backend.getItem(key);
    },
    setItem: (key: string, value: string) => backend.setItem(key, value),
    async deleteItem(key: string) {
      deletes += 1;
      return backend.deleteItem(key);
    },
  };
  const client = new IdentityApiClient({
    baseUrl: "https://identity.test",
    store: createSecureSessionStore(flaky),
  });
  let requests = 0;
  globalThis.fetch = (async () => {
    requests += 1;
    return json(200, {});
  }) as typeof fetch;

  const outcome = await client.restoreSession();

  assert.equal(outcome.kind, "unavailable", "a read failure is not a rejection");
  assert.equal(outcome.kind === "unavailable" && outcome.code, "secure_storage_unavailable");
  assert.equal(deletes, 0, "no credential deletion was even attempted");
  assert.equal(requests, 0, "and nothing was sent without a token");
  assert.notEqual(await store.load(), null, "the credential survived");
});

test("recovery: once storage works again, the session restores normally", async () => {
  const backend = createTestSecureBackend();
  const store = createSecureSessionStore(backend);
  await store.save(TOKENS());
  const client = new IdentityApiClient({ baseUrl: "https://identity.test", store });
  globalThis.fetch = (async (input: string) => {
    const url = String(input);
    if (url.endsWith("/identity/me")) {
      return json(200, { user: { id: "usr_1", status: "active", createdAt: FUTURE() }, session: {}, identities: [] });
    }
    if (url.endsWith("/identity/wallets")) return json(200, { wallets: [] });
    return json(404, {});
  }) as typeof fetch;

  backend.options.failGet = true;
  assert.equal((await client.restoreSession()).kind, "unavailable");

  backend.options.failGet = false;
  const outcome = await client.restoreSession();
  assert.equal(outcome.kind, "restored", "retry after recovery works");
});

test("a token-persist failure during login is a typed public code, not a claimed sign-in", async () => {
  const backend = createTestSecureBackend();
  const store = createSecureSessionStore(backend);
  const client = new IdentityApiClient({ baseUrl: "https://identity.test", store });
  globalThis.fetch = (async () =>
    json(200, {
      user: { id: "usr_1", status: "active", createdAt: FUTURE() },
      session: { id: "s1", assuranceLevel: "aal1", issuedAt: FUTURE(), expiresAt: FUTURE(), ...TOKENS() },
      embeddedWallet: null,
    })) as typeof fetch;
  backend.options.failSet = true;

  await assert.rejects(
    () => client.completeEmailOtp("runner@example.com", "123456"),
    (err: unknown) => (err as { code?: string }).code === "secure_storage_unavailable",
  );
  assert.equal(await store.load(), null, "nothing was persisted");
});

// ---- public copy ------------------------------------------------------------

test("the storage codes map to stable, non-technical copy", () => {
  for (const code of ["secure_storage_unavailable", "account_sync_unavailable"]) {
    const message = authErrorMessage(code);
    assert.ok(message && message.length > 0, code);
    assert.ok(!message!.includes(code), "the raw code is never shown");
    assert.ok(!/keystore|SecureStore|Error|stack|null/i.test(message!), `${code}: no technical detail`);
  }
});
