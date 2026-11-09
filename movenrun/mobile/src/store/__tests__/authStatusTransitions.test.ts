/**
 * Session truth moves only along `AUTH_STATUS_TRANSITIONS`.
 *
 * The auth store writes `status` from several helpers. Rather than trusting
 * each one, these tests drive the real store through the flows a user can
 * reach and record every move `status` makes. A move outside the table is a
 * new edge someone has to add on purpose, with the doc in
 * `docs/STATE_MACHINES.md`.
 */
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { canTransition, reachableFrom, statesOf } from "@movenrun/shared/state-machine";
import { createSecureSessionStore } from "../../lib/secureSession";
import { createTestSecureBackend } from "../../lib/secureSession.testBackend";
import { AUTH_STATUS_TRANSITIONS, type AuthStatus } from "../../lib/authLifecycle";
import { IdentityApiClient } from "../../services/identityApi";
import { resetAuthBootstrapForTests, useAuthStore } from "../useAuthStore";

const FUTURE = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
const TOKENS = () => ({
  accessToken: "access-1",
  accessTokenExpiresAt: FUTURE(),
  refreshToken: "refresh-1",
  refreshTokenExpiresAt: FUTURE(),
});
const USER = () => ({ id: "usr_1", status: "active", createdAt: FUTURE() });
const SESSION = () => ({
  id: "ses_1",
  assuranceLevel: "aal1",
  issuedAt: FUTURE(),
  expiresAt: FUTURE(),
  ...TOKENS(),
});

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

const state = () => useAuthStore.getState();

/** Every distinct `from->to` the store's status made while `run` ran. */
async function observe(run: () => Promise<unknown>): Promise<string[]> {
  const moves: string[] = [];
  let prev: AuthStatus = state().status;
  const unsubscribe = useAuthStore.subscribe((s) => {
    if (s.status !== prev) moves.push(`${prev}->${s.status}`);
    prev = s.status;
  });
  try {
    await run();
  } finally {
    unsubscribe();
  }
  return moves;
}

function assertAllowed(moves: string[]): void {
  for (const move of moves) {
    const [from, to] = move.split("->") as [AuthStatus, AuthStatus];
    assert.ok(canTransition(AUTH_STATUS_TRANSITIONS, from, to), `status moved ${move}, which is not in the table`);
  }
}

async function freshStore(opts: { stored: boolean; fetch: (url: string) => Promise<Response> }) {
  const store = createSecureSessionStore(createTestSecureBackend());
  if (opts.stored) await store.save(TOKENS());
  globalThis.fetch = (async (input: string) => opts.fetch(String(input))) as typeof fetch;
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
    client: new IdentityApiClient({ baseUrl: "https://identity.test", store }),
  });
}

const liveServer = async (url: string) => {
  if (url.endsWith("/identity/me")) return json(200, { user: USER(), session: SESSION(), identities: [] });
  if (url.endsWith("/identity/wallets")) return json(200, { wallets: [] });
  if (url.endsWith("/email/complete")) return json(200, { user: USER(), session: SESSION(), embeddedWallet: null });
  return json(200, {});
};

afterEach(() => resetAuthBootstrapForTests());

test("the table covers every status and every status is reachable from the initial one", () => {
  assert.deepEqual(statesOf(AUTH_STATUS_TRANSITIONS).sort(), ["restoring", "signedIn", "signedOut", "unknown"]);
  assert.equal(reachableFrom(AUTH_STATUS_TRANSITIONS, "unknown").size, 4);
});

test("a stored session that restores moves unknown -> restoring -> signedIn", async () => {
  await freshStore({ stored: true, fetch: liveServer });
  const moves = await observe(() => state().initialize());
  assert.deepEqual(moves, ["unknown->restoring", "restoring->signedIn"]);
  assertAllowed(moves);
});

test("nothing stored moves unknown -> restoring -> signedOut", async () => {
  await freshStore({ stored: false, fetch: liveServer });
  const moves = await observe(() => state().initialize());
  assert.deepEqual(moves, ["unknown->restoring", "restoring->signedOut"]);
  assertAllowed(moves);
});

test("a rejected session moves restoring -> signedOut", async () => {
  await freshStore({ stored: true, fetch: async () => json(401, { error: "unauthenticated" }) });
  const moves = await observe(() => state().initialize());
  assert.equal(state().status, "signedOut");
  assertAllowed(moves);
});

test("an unreachable server returns to unknown, and Retry then restores", async () => {
  let reachable = false;
  await freshStore({
    stored: true,
    fetch: async (url) => {
      if (!reachable) throw new TypeError("Network request failed");
      return liveServer(url);
    },
  });
  const first = await observe(() => state().initialize());
  assert.deepEqual(first, ["unknown->restoring", "restoring->unknown"]);
  reachable = true;
  const retry = await observe(() => state().retryRestore());
  assert.deepEqual(retry, ["unknown->restoring", "restoring->signedIn"]);
  assertAllowed([...first, ...retry]);
});

test("sign-in from signed out, then sign-out, stay inside the table", async () => {
  await freshStore({ stored: false, fetch: liveServer });
  await state().initialize();
  assert.equal(state().status, "signedOut");
  const signIn = await observe(() => state().completeEmailOtp("runner@example.com", "123456", "Android device"));
  assert.deepEqual(signIn, ["signedOut->signedIn"]);
  const signOut = await observe(() => state().signOut());
  assert.deepEqual(signOut, ["signedIn->signedOut"]);
  assertAllowed([...signIn, ...signOut]);
});
