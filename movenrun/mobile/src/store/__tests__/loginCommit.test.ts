/**
 * The authentication commit point, and what may follow it.
 *
 * Previously the store waited for `/identity/me` AND `/identity/wallets` before
 * setting `signedIn`. If those failed transiently the device already held a
 * valid session — tokens persisted, one-time code spent — while the UI insisted
 * the sign-in had failed, and a restart would suddenly sign the user in. The
 * commit point is now: server confirmed the login AND the tokens were stored.
 * Everything after that is enrichment.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSecureSessionStore } from "../../lib/secureSession";
import { createTestSecureBackend } from "../../lib/secureSession.testBackend";
import { IdentityApiClient } from "../../services/identityApi";
import { resetAuthBootstrapForTests, useAuthStore } from "../useAuthStore";

const FUTURE = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
const USER = { id: "usr_1", status: "active", createdAt: FUTURE() };
const USER_2 = { id: "usr_2", status: "active", createdAt: FUTURE() };
const SESSION = () => ({
  id: "ses_1",
  assuranceLevel: "aal1",
  issuedAt: FUTURE(),
  expiresAt: FUTURE(),
  accessToken: "access-1",
  accessTokenExpiresAt: FUTURE(),
  refreshToken: "refresh-1",
  refreshTokenExpiresAt: FUTURE(),
});
const EMBEDDED_WALLET = {
  id: "wal_1",
  address: null,
  addressChecksum: null,
  walletType: "embedded_eoa",
  sourceProvider: "movenrun",
  chainFamily: "evm",
  ownershipStatus: "verified",
  isEmbedded: true,
  isActive: true,
  provisioningState: "provisioning",
  createdAt: FUTURE(),
};

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

const state = () => useAuthStore.getState();

/** Wait until the authentication commit has landed (the enrichment is then the
 *  only thing still in flight). Never waits forever. */
async function waitForCommit(): Promise<void> {
  for (let i = 0; i < 100 && state().status !== "signedIn"; i += 1) {
    await new Promise((r) => setImmediate(r));
  }
  assert.equal(state().status, "signedIn", "the commit point was reached");
}

function harness(handler: (url: string) => Promise<Response>, backendOpts: { failSet?: boolean } = {}) {
  const backend = createTestSecureBackend();
  if (backendOpts.failSet) backend.options.failSet = true;
  const store = createSecureSessionStore(backend);
  const client = new IdentityApiClient({ baseUrl: "https://identity.test", store });
  globalThis.fetch = (async (input: string) => handler(String(input))) as typeof fetch;
  resetAuthBootstrapForTests();
  useAuthStore.setState({
    status: "signedOut",
    operation: "idle",
    lastRestore: "no-session",
    authErrorCode: null,
    restoreErrorCode: null,
    accountErrorCode: null,
    user: null,
    identities: [],
    wallets: [],
    client,
  });
  return { store, backend, client };
}

/** A server where login works and enrichment behaves as configured. */
function server(opts: { me?: "ok" | "fail" | "401"; wallets?: "ok" | "fail" } = {}) {
  return async (url: string) => {
    if (url.endsWith("/email/complete")) {
      return json(200, { user: USER, session: SESSION(), embeddedWallet: EMBEDDED_WALLET });
    }
    if (url.endsWith("/identity/me")) {
      if (opts.me === "401") return json(401, { error: { code: "unauthenticated" } });
      if (opts.me === "fail") throw new TypeError("Network request failed");
      return json(200, { user: USER, session: SESSION(), identities: [{ id: "idn_1", provider: "email_otp", verificationStatus: "verified", assuranceLevel: "aal1", createdAt: FUTURE() }] });
    }
    if (url.endsWith("/identity/wallets")) {
      if (opts.wallets === "fail") throw new TypeError("Network request failed");
      return json(200, { wallets: [{ ...EMBEDDED_WALLET, provisioningState: "ready" }] });
    }
    if (url.endsWith("/identity/auth/refresh")) return json(401, { error: { code: "session_invalid" } });
    return json(404, {});
  };
}

test("login + enrichment both succeed: signed in with fully refreshed public state", async () => {
  const h = harness(server());

  const ok = await state().completeEmailOtp("runner@example.com", "123456");

  assert.equal(ok, true);
  assert.equal(state().status, "signedIn");
  assert.equal(state().operation, "idle");
  assert.equal(state().user?.id, "usr_1");
  assert.equal(state().identities.length, 1, "identities arrive with the sync");
  assert.equal(state().wallets[0]?.provisioningState, "ready", "seeded wallet replaced by server view");
  assert.equal(state().accountErrorCode, null);
  assert.notEqual(await h.store.load(), null, "the session is stored");
});

test("/identity/me fails transiently: still signed in, no return to OTP entry", async () => {
  const h = harness(server({ me: "fail" }));

  const ok = await state().completeEmailOtp("runner@example.com", "123456");

  assert.equal(ok, true, "the sign-in succeeded — the caller is not told otherwise");
  assert.equal(state().status, "signedIn", "the device holds a valid session; the UI says so");
  assert.equal(state().authErrorCode, null, "no form error — the form must not reappear");
  assert.equal(state().accountErrorCode, "account_sync_unavailable", "a stable sync code only");
  assert.notEqual(await h.store.load(), null, "secure tokens remain");
});

test("the wallet refresh fails: still signed in, seeded wallet state stays typed and safe", async () => {
  harness(server({ wallets: "fail" }));

  await state().completeEmailOtp("runner@example.com", "123456");

  assert.equal(state().status, "signedIn");
  assert.equal(state().wallets.length, 1, "seeded from the login response");
  assert.equal(state().wallets[0]?.isEmbedded, true);
  assert.equal(state().accountErrorCode, "account_sync_unavailable");
});

test("enrichment proving the session invalid closes it (the one authoritative failure)", async () => {
  harness(server({ me: "401" }));

  await state().completeEmailOtp("runner@example.com", "123456");

  assert.equal(state().status, "signedOut", "a server 401 is authoritative");
  assert.equal(state().user, null);
});

test("a secure-token save failure never claims signed in and leaves no partial identity", async () => {
  const h = harness(server(), { failSet: true });

  const ok = await state().completeEmailOtp("runner@example.com", "123456");

  assert.equal(ok, false);
  assert.notEqual(state().status, "signedIn", "no session was stored, so none is claimed");
  assert.equal(state().user, null, "no partial runtime identity state");
  assert.deepEqual(state().wallets, []);
  assert.equal(state().authErrorCode, "secure_storage_unavailable", "a stable public code");
  assert.equal(await h.store.load(), null);
});

// ---- stale enrichment -------------------------------------------------------

test("signing out while enrichment is in flight discards the late result", async () => {
  let releaseMe: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    releaseMe = resolve;
  });
  harness(async (url) => {
    if (url.endsWith("/email/complete")) {
      return json(200, { user: USER, session: SESSION(), embeddedWallet: EMBEDDED_WALLET });
    }
    if (url.endsWith("/identity/me")) {
      await gate; // hold the enrichment open, well past the commit
      return json(200, { user: USER, session: SESSION(), identities: [] });
    }
    if (url.endsWith("/identity/wallets")) return json(200, { wallets: [{ ...EMBEDDED_WALLET }] });
    if (url.endsWith("/session/revoke")) return json(200, { revoked: true });
    return json(404, {});
  });

  const login = state().completeEmailOtp("runner@example.com", "123456");
  await waitForCommit();

  await state().signOut();
  assert.equal(state().status, "signedOut");

  releaseMe!();
  await login;

  assert.equal(state().status, "signedOut", "a late enrichment cannot resurrect the session");
  assert.equal(state().user, null, "nor the user");
  assert.deepEqual(state().wallets, [], "nor the wallets");
});

test("a second sign-in supersedes the first: stale results are discarded", async () => {
  let releaseFirst: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let completeCalls = 0;
  let meCalls = 0;
  harness(async (url) => {
    if (url.endsWith("/email/complete")) {
      completeCalls += 1;
      return json(200, {
        user: completeCalls === 1 ? USER : USER_2,
        session: SESSION(),
        embeddedWallet: null,
      });
    }
    if (url.endsWith("/identity/me")) {
      meCalls += 1;
      if (meCalls === 1) {
        await gate; // the FIRST user's enrichment is held open
        return json(200, { user: USER, session: SESSION(), identities: [] });
      }
      return json(200, { user: USER_2, session: SESSION(), identities: [] });
    }
    if (url.endsWith("/identity/wallets")) return json(200, { wallets: [] });
    if (url.endsWith("/session/revoke")) return json(200, { revoked: true });
    return json(404, {});
  });

  const first = state().completeEmailOtp("first@example.com", "123456");
  await waitForCommit();

  // A different account takes over this device.
  await state().signOut();
  await state().completeEmailOtp("second@example.com", "123456");
  assert.equal(state().user?.id, "usr_2", "the second user is signed in");

  releaseFirst!();
  await first;

  assert.equal(state().user?.id, "usr_2", "the first user's late result did not overwrite it");
  assert.equal(state().status, "signedIn");
});
