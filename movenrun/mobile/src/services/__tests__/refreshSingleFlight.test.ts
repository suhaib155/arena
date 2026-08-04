/**
 * Single-flight refresh — the concurrency test for a real security defect.
 *
 * The backend rotates the refresh token on every use and treats a second
 * presentation of the same token as a replay: it revokes the WHOLE session
 * family and signs the user out everywhere (backend SessionService.refresh,
 * `refresh_replay_detected`). Meanwhile `restoreSession()` deliberately runs
 * `me()` and `listWallets()` in parallel — so without a shared refresh, one
 * expired access token would produce two refresh requests with the same token
 * and destroy a valid session on every cold start after expiry.
 *
 * The fake server below models that hostile behaviour exactly: the first
 * refresh succeeds and rotates; any reuse of a rotated token revokes the family
 * and answers `refresh_reuse_detected`. A client that refreshes twice cannot
 * pass these tests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSecureSessionStore, type SecureSessionStore } from "../../lib/secureSession";
import { createTestSecureBackend } from "../../lib/secureSession.testBackend";
import { IdentityApiClient } from "../identityApi";

const FUTURE = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

interface RotatingServer {
  refreshCalls: number;
  familyRevoked: boolean;
  replayResponses: number;
  protectedCalls: number;
  currentAccess: string;
  currentRefresh: string;
  /** Resolve the gate to let both in-flight refreshes proceed together. */
  fetch: typeof fetch;
}

/**
 * A server that rotates refresh tokens and revokes the family on reuse.
 * Protected endpoints answer 401 until the access token has been rotated once.
 */
function rotatingServer(opts: { refreshOutcome?: "ok" | "rejected" | "unavailable" } = {}): RotatingServer {
  const s: RotatingServer = {
    refreshCalls: 0,
    familyRevoked: false,
    replayResponses: 0,
    protectedCalls: 0,
    currentAccess: "access-v1",
    currentRefresh: "refresh-v1",
    fetch: (async () => json(404, {})) as typeof fetch,
  };
  const usedRefreshTokens = new Set<string>();

  s.fetch = (async (input: string, init?: RequestInit) => {
    const url = String(input);

    if (url.endsWith("/identity/auth/refresh")) {
      s.refreshCalls += 1;
      const presented = JSON.parse(String(init?.body ?? "{}")).refreshToken as string;
      if (usedRefreshTokens.has(presented) || s.familyRevoked) {
        // Replay: exactly what the real backend does.
        s.familyRevoked = true;
        s.replayResponses += 1;
        return json(401, { error: { code: "refresh_reuse_detected" } });
      }
      usedRefreshTokens.add(presented);
      if (opts.refreshOutcome === "rejected") {
        return json(401, { error: { code: "session_invalid" } });
      }
      if (opts.refreshOutcome === "unavailable") {
        throw new TypeError("Network request failed");
      }
      s.currentAccess = "access-v2";
      s.currentRefresh = "refresh-v2";
      return json(200, {
        session: {
          id: "ses_2",
          assuranceLevel: "aal1",
          issuedAt: FUTURE(),
          expiresAt: FUTURE(),
          accessToken: s.currentAccess,
          accessTokenExpiresAt: FUTURE(),
          refreshToken: s.currentRefresh,
          refreshTokenExpiresAt: FUTURE(),
        },
      });
    }

    // Protected endpoints: 401 unless the caller presents the rotated token.
    s.protectedCalls += 1;
    const auth = (init?.headers as Record<string, string> | undefined)?.authorization ?? "";
    if (s.familyRevoked || auth !== `Bearer ${s.currentAccess}`) {
      return json(401, { error: { code: "unauthenticated" } });
    }
    if (url.endsWith("/identity/me")) {
      return json(200, {
        user: { id: "usr_1", status: "active", createdAt: FUTURE() },
        session: {},
        identities: [],
      });
    }
    if (url.endsWith("/identity/wallets")) return json(200, { wallets: [] });
    return json(404, {});
  }) as typeof fetch;

  return s;
}

async function seeded(): Promise<SecureSessionStore> {
  const store = createSecureSessionStore(createTestSecureBackend());
  await store.save({
    accessToken: "access-v1-expired",
    accessTokenExpiresAt: FUTURE(),
    refreshToken: "refresh-v1",
    refreshTokenExpiresAt: FUTURE(),
  });
  return store;
}

test("two concurrent 401s trigger exactly ONE refresh — no replay, no family revocation", async () => {
  const server = rotatingServer();
  globalThis.fetch = server.fetch;
  const store = await seeded();
  const client = new IdentityApiClient({ baseUrl: "https://identity.test", store });

  const outcome = await client.restoreSession();

  assert.equal(server.refreshCalls, 1, "the rotating refresh token is presented exactly once");
  assert.equal(server.replayResponses, 0, "no replay response was ever produced");
  assert.equal(server.familyRevoked, false, "the session family survives");
  assert.equal(outcome.kind, "restored", "both protected requests completed after the retry");

  const stored = await store.load();
  assert.notEqual(stored, null, "credentials are still present");
  assert.equal(stored?.accessToken, "access-v2", "the rotated tokens were persisted once");
  assert.equal(stored?.refreshToken, "refresh-v2");
});

test("concurrent protected calls outside restore share the same refresh too", async () => {
  const server = rotatingServer();
  globalThis.fetch = server.fetch;
  const store = await seeded();
  const client = new IdentityApiClient({ baseUrl: "https://identity.test", store });

  const [me, wallets] = await Promise.all([client.me(), client.listWallets()]);

  assert.equal(server.refreshCalls, 1);
  assert.equal(server.familyRevoked, false);
  assert.equal(me.user.id, "usr_1", "first request succeeded after retry");
  assert.deepEqual(wallets.wallets, [], "second request succeeded after retry");
});

test("a concurrent rejected refresh clears credentials exactly once", async () => {
  const server = rotatingServer({ refreshOutcome: "rejected" });
  globalThis.fetch = server.fetch;
  const store = await seeded();
  const client = new IdentityApiClient({ baseUrl: "https://identity.test", store });

  const outcome = await client.restoreSession();

  assert.equal(outcome.kind, "rejected");
  assert.equal(server.refreshCalls, 1, "one rejection is enough — the second caller shares it");
  assert.equal(await store.load(), null, "dead credentials are removed");
});

test("a concurrent unavailable refresh preserves credentials and reports unavailable", async () => {
  const server = rotatingServer({ refreshOutcome: "unavailable" });
  globalThis.fetch = server.fetch;
  const store = await seeded();
  const client = new IdentityApiClient({ baseUrl: "https://identity.test", store });

  const outcome = await client.restoreSession();

  assert.equal(outcome.kind, "unavailable");
  assert.equal(server.refreshCalls, 1, "one attempt, shared — not one per waiting request");
  assert.notEqual(await store.load(), null, "a valid session survives an unreachable backend");
});

test("the in-flight slot clears, so a later independent expiry refreshes again", async () => {
  const server = rotatingServer();
  globalThis.fetch = server.fetch;
  const store = await seeded();
  const client = new IdentityApiClient({ baseUrl: "https://identity.test", store });

  const first = await client.restoreSession();
  assert.equal(first.kind, "restored");
  assert.equal(server.refreshCalls, 1);

  // Simulate a *new* expiry: the server starts rejecting the current access
  // token again and will rotate to a third generation.
  server.currentAccess = "access-v3";
  const second = await client.restoreSession();

  assert.equal(second.kind, "restored", "the second cycle also completes");
  assert.equal(server.refreshCalls, 2, "a genuinely later expiry starts a NEW refresh");
  assert.equal(server.replayResponses, 0, "and still never replays a spent token");
  assert.equal(server.familyRevoked, false);
});

test("a keystore write failure during refresh drops the spent token instead of risking a replay", async () => {
  const server = rotatingServer();
  globalThis.fetch = server.fetch;
  const backend = createTestSecureBackend();
  const store = createSecureSessionStore(backend);
  await store.save({
    accessToken: "access-v1-expired",
    accessTokenExpiresAt: FUTURE(),
    refreshToken: "refresh-v1",
    refreshTokenExpiresAt: FUTURE(),
  });
  const client = new IdentityApiClient({ baseUrl: "https://identity.test", store });
  backend.options.failSet = true; // the rotated tokens cannot be persisted

  const outcome = await client.restoreSession();

  assert.equal(outcome.kind, "rejected", "the app never believes a persist that did not happen");
  assert.equal(await store.load(), null, "the now-rotated token is discarded, not left to replay");
  assert.equal(server.familyRevoked, false, "and no replay was ever sent");
});
