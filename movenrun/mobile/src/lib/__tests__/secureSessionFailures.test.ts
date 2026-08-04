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

test("a write failure is typed — a persist is never assumed", async () => {
  const backend = createTestSecureBackend();
  const store = createSecureSessionStore(backend);
  backend.options.failSet = true;
  await assert.rejects(
    () => store.save(TOKENS()),
    (err: unknown) => isSecureSessionStorageError(err) && err.code === "write_failed",
  );
});

test("a delete failure still destroys the credential, via a non-secret tombstone", async () => {
  const backend = createTestSecureBackend();
  const store = createSecureSessionStore(backend);
  await store.save(TOKENS());

  backend.options.failDelete = true;
  await store.clear(); // reports success: the credential IS gone, see below

  const record = backend.map.get(SESSION_STORAGE_KEY);
  assert.ok(record, "something is still stored (the delete genuinely failed)");
  assert.ok(!/access-1|refresh-1/.test(record!), "but it contains no token material");
  // It can never be parsed as a session again...
  assert.equal(JSON.parse(record!).accessToken, undefined, "not a session record");
  backend.options.failDelete = false;
  assert.equal(await store.load(), null, "the tombstone is not a credential");
  // ...and the next successful read cleans it up rather than leaving litter.
  assert.equal(backend.map.has(SESSION_STORAGE_KEY), false, "tombstone removed on load");
});

test("only a total storage failure reports clear_failed — never silently", async () => {
  const backend = createTestSecureBackend();
  const store = createSecureSessionStore(backend);
  await store.save(TOKENS());
  backend.options.failDelete = true;
  backend.options.failSet = true; // neither delete nor overwrite is possible
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

// ---- spent credentials must never be re-presented ---------------------------

/** A server that rotates refresh tokens and revokes the family on reuse —
 *  exactly what backend SessionService.refresh does. */
function rotatingServer() {
  const spent = new Set<string>();
  const s = { refreshCalls: 0, replayResponses: 0, familyRevoked: false };
  const fetchImpl = (async (input: string, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/identity/auth/refresh")) {
      s.refreshCalls += 1;
      const presented = JSON.parse(String(init?.body ?? "{}")).refreshToken as string;
      if (spent.has(presented) || s.familyRevoked) {
        s.familyRevoked = true;
        s.replayResponses += 1;
        return json(401, { error: { code: "refresh_reuse_detected" } });
      }
      spent.add(presented);
      return json(200, {
        session: {
          id: "s2",
          assuranceLevel: "aal1",
          issuedAt: FUTURE(),
          expiresAt: FUTURE(),
          accessToken: "access-v2",
          accessTokenExpiresAt: FUTURE(),
          refreshToken: "refresh-v2",
          refreshTokenExpiresAt: FUTURE(),
        },
      });
    }
    return json(401, { error: { code: "unauthenticated" } });
  }) as typeof fetch;
  return { state: s, fetchImpl };
}

test("a spent credential whose delete failed is NOT replayed after a restart", async () => {
  /* The failure this locks out: the server rejects a refresh (or rotation
     succeeds but the new tokens cannot be written), the local delete then
     fails, and the SPENT refresh token stays on disk. The next launch loads it
     and presents it — which the server treats as a replay and answers by
     revoking the whole session family, signing the user out on every device.
     Our own cleanup failure must never cost the user their other devices. */
  const backend = createTestSecureBackend();
  const store = createSecureSessionStore(backend);
  await store.save(TOKENS());

  const { state: srv, fetchImpl } = rotatingServer();
  globalThis.fetch = fetchImpl;

  // Rotation succeeds server-side, then the local delete refuses.
  backend.options.failDelete = true;
  const client = new IdentityApiClient({ baseUrl: "https://identity.test", store });
  await client.restoreSession();
  backend.options.failDelete = false;

  const refreshesBeforeRestart = srv.refreshCalls;

  // "Restart": the first store/client are discarded; a freshly constructed
  // store and client run over the SAME durable backend, through production
  // load() — this is the cross-launch path the original bug lived on.
  const restarted = createSecureSessionStore(backend);
  assert.equal(await restarted.load(), null, "the spent credential is not loadable");

  const outcome = await new IdentityApiClient({
    baseUrl: "https://identity.test",
    store: restarted,
  }).restoreSession();

  assert.equal(outcome.kind, "no-session", "a confirmed signed-out start, not a replay");
  assert.equal(srv.refreshCalls, refreshesBeforeRestart, "the restart called refresh zero times");
  assert.equal(srv.replayResponses, 0, "the spent token was never presented again");
  assert.equal(srv.familyRevoked, false, "the user's other devices survive");
});

test("sign-out-everywhere leaves nothing re-presentable either, even when the delete fails", async () => {
  const backend = createTestSecureBackend();
  const store = createSecureSessionStore(backend);
  await store.save(TOKENS());
  const { state: srv, fetchImpl } = rotatingServer();
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    if (String(input).endsWith("/session/revoke-all")) return json(200, { revoked: 3 });
    return fetchImpl(input as never, init as never);
  }) as typeof fetch;

  backend.options.failDelete = true;
  await new IdentityApiClient({ baseUrl: "https://identity.test", store }).signOutEverywhere();
  backend.options.failDelete = false;

  const restarted = createSecureSessionStore(backend);
  assert.equal(await restarted.load(), null, "the revoked credential is not loadable");
  const outcome = await new IdentityApiClient({
    baseUrl: "https://identity.test",
    store: restarted,
  }).restoreSession();
  assert.equal(outcome.kind, "no-session", "a clean signed-out start after restart");
  assert.equal(srv.refreshCalls, 0, "the refresh endpoint is never called");
  assert.equal(srv.replayResponses, 0);
  assert.equal(srv.familyRevoked, false);
});

test("sign-out leaves nothing re-presentable either, even when the delete fails", async () => {
  const backend = createTestSecureBackend();
  const store = createSecureSessionStore(backend);
  await store.save(TOKENS());
  const { state: srv, fetchImpl } = rotatingServer();
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    if (String(input).endsWith("/session/revoke")) return json(200, { revoked: true });
    return fetchImpl(input as never, init as never);
  }) as typeof fetch;

  backend.options.failDelete = true;
  await new IdentityApiClient({ baseUrl: "https://identity.test", store }).signOut();
  backend.options.failDelete = false;

  const restarted = createSecureSessionStore(backend);
  assert.equal(await restarted.load(), null, "the revoked credential is not loadable");
  const outcome = await new IdentityApiClient({
    baseUrl: "https://identity.test",
    store: restarted,
  }).restoreSession();
  assert.equal(outcome.kind, "no-session", "a clean signed-out start after restart");
  assert.equal(srv.refreshCalls, 0, "the refresh endpoint is never called");
  assert.equal(srv.replayResponses, 0);
  assert.equal(srv.familyRevoked, false);
});
