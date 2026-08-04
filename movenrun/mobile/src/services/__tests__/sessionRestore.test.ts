/**
 * Session restoration — behavioural tests against the real identity client.
 *
 * These drive `IdentityApiClient` with a memory-backed secure store and a
 * stubbed `fetch`, so the failure semantics are proven rather than asserted by
 * regex. The invariant that matters most: a transient network/backend failure
 * must NEVER be classified as a rejected session, and must never delete stored
 * credentials.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSecureSessionStore, type SecureSessionStore } from "../../lib/secureSession";
import { createTestSecureBackend } from "../../lib/secureSession.testBackend";
import { IdentityApiClient } from "../identityApi";

const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

const TOKENS = {
  accessToken: "access-token-value",
  accessTokenExpiresAt: FUTURE,
  refreshToken: "refresh-token-value",
  refreshTokenExpiresAt: FUTURE,
};

const USER = { id: "usr_1", status: "active", createdAt: FUTURE };

function json(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

interface Harness {
  client: IdentityApiClient;
  store: SecureSessionStore;
  backend: ReturnType<typeof createTestSecureBackend>;
  calls: string[];
}

/** Build a client whose HTTP layer is `handler`. */
function harness(handler: (url: string) => Promise<Response>): Harness {
  const backend = createTestSecureBackend();
  const store = createSecureSessionStore(backend);
  const calls: string[] = [];
  const client = new IdentityApiClient({ baseUrl: "https://identity.test", store });
  globalThis.fetch = (async (input: string) => {
    calls.push(String(input));
    return handler(String(input));
  }) as typeof fetch;
  return { client, store, backend, calls };
}

test("no stored session → confirmed signed out, nothing requested", async () => {
  const h = harness(async () => json(200, {}));
  const outcome = await h.client.restoreSession();
  assert.equal(outcome.kind, "no-session");
  assert.deepEqual(h.calls, [], "an empty store is answered without a network call");
});

test("a valid stored session restores server-derived state (and no tokens)", async () => {
  const h = harness(async (url) => {
    if (url.endsWith("/identity/me")) return json(200, { user: USER, session: {}, identities: [] });
    if (url.endsWith("/identity/wallets")) return json(200, { wallets: [] });
    return json(404, {});
  });
  await h.store.save(TOKENS);

  const outcome = await h.client.restoreSession();
  assert.equal(outcome.kind, "restored");
  assert.equal(outcome.kind === "restored" && outcome.user.id, "usr_1");
  // The outcome carries no token material at all.
  assert.ok(!JSON.stringify(outcome).includes(TOKENS.accessToken));
  assert.ok(!JSON.stringify(outcome).includes(TOKENS.refreshToken));
  // Credentials remain exactly where they were: the secure store.
  assert.notEqual(await h.store.load(), null);
});

test("a server-rejected session signs out AND clears the stored credentials", async () => {
  const h = harness(async (url) => {
    if (url.includes("/refresh")) return json(401, { error: { code: "invalid_refresh_token" } });
    return json(401, { error: { code: "unauthenticated" } });
  });
  await h.store.save(TOKENS);

  const outcome = await h.client.restoreSession();
  assert.equal(outcome.kind, "rejected");
  assert.equal(await h.store.load(), null, "dead credentials must not linger on the device");
});

test("a network failure is 'unavailable' — credentials are left untouched", async () => {
  const h = harness(async () => {
    throw new TypeError("Network request failed");
  });
  await h.store.save(TOKENS);

  const outcome = await h.client.restoreSession();
  assert.equal(outcome.kind, "unavailable", "a blip is not a sign-out");
  assert.notEqual(await h.store.load(), null, "a valid session must survive a network blip");
});

test("a 5xx backend is 'unavailable' — it has judged nothing", async () => {
  const h = harness(async () => json(503, { error: { code: "unavailable" } }));
  await h.store.save(TOKENS);

  const outcome = await h.client.restoreSession();
  assert.equal(outcome.kind, "unavailable");
  assert.notEqual(await h.store.load(), null);
});

test("a 401 whose refresh fails transiently is 'unavailable', not rejected", async () => {
  let refreshAttempts = 0;
  const h = harness(async (url) => {
    if (url.includes("/refresh")) {
      refreshAttempts += 1;
      throw new TypeError("Network request failed");
    }
    return json(401, { error: { code: "unauthenticated" } });
  });
  await h.store.save(TOKENS);

  const outcome = await h.client.restoreSession();
  assert.equal(outcome.kind, "unavailable");
  assert.notEqual(await h.store.load(), null, "an unreachable refresh endpoint must not evict a session");
  assert.ok(refreshAttempts >= 1);
});

test("the refresh attempt is bounded: at most one per request, no retry loop", async () => {
  let refreshCalls = 0;
  const h = harness(async (url) => {
    if (url.includes("/refresh")) {
      refreshCalls += 1;
      // A successful refresh, but the retried call still 401s.
      return json(200, { session: { ...TOKENS, id: "s1", assuranceLevel: "aal1", issuedAt: FUTURE, expiresAt: FUTURE } });
    }
    return json(401, { error: { code: "unauthenticated" } });
  });
  await h.store.save(TOKENS);

  const outcome = await h.client.restoreSession();
  assert.equal(outcome.kind, "rejected");
  // me() and listWallets() run in parallel, so at most one refresh each — and
  // crucially the retried call does not refresh again (no recursion).
  assert.ok(refreshCalls <= 2, `bounded refresh attempts, saw ${refreshCalls}`);
});

test("expired stored material is deleted and reported as no session, not as a rejection", async () => {
  const h = harness(async () => json(200, {}));
  const past = new Date(Date.now() - 1000).toISOString();
  await h.store.save({ ...TOKENS, refreshTokenExpiresAt: past });

  const outcome = await h.client.restoreSession();
  assert.equal(outcome.kind, "no-session");
  assert.deepEqual(h.calls, [], "expired material never reaches the network");
});
