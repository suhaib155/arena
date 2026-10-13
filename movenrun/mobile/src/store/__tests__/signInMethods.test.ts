/**
 * Google and wallet sign-in through the store: the same commit point as every
 * other sign-in, with backing out treated as nothing happening.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSecureSessionStore } from "../../lib/secureSession";
import { createTestSecureBackend } from "../../lib/secureSession.testBackend";
import { IdentityApiClient, IdentityApiError } from "../../services/identityApi";
import { useAuthStore } from "../useAuthStore";

const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const USER = { id: "usr_g", status: "active", createdAt: FUTURE };
const SESSION = {
  id: "ses_g", assuranceLevel: "aal2", issuedAt: FUTURE, expiresAt: FUTURE,
  accessToken: "access-g", accessTokenExpiresAt: FUTURE, refreshToken: "refresh-g", refreshTokenExpiresAt: FUTURE,
};

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

function harness() {
  const store = createSecureSessionStore(createTestSecureBackend());
  const requests: { url: string; body: unknown }[] = [];
  const client = new IdentityApiClient({ baseUrl: "https://identity.test", store });
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith("/identity/auth/google/complete") || url.endsWith("/identity/auth/wallet/exchange")) {
      return json(200, { user: USER, session: SESSION, embeddedWallet: null });
    }
    if (url.endsWith("/identity/me")) return json(200, { user: USER, session: SESSION, identities: [] });
    if (url.endsWith("/identity/wallets")) return json(200, { wallets: [] });
    return json(404, { error: "not_found" });
  }) as typeof fetch;
  useAuthStore.setState({
    status: "signedOut", operation: "idle", lastRestore: "no-session",
    authErrorCode: null, restoreErrorCode: null, accountErrorCode: null,
    user: null, identities: [], wallets: [], client,
  });
  return { requests, client, store };
}

test("Google sign-in commits the server's session and stores it", async () => {
  const h = harness();
  const ok = await useAuthStore.getState().signInWith((client) => client.completeGoogleSignIn("supabase-access-token-xxxxxxxx", "Android device"));
  assert.equal(ok, true);
  assert.equal(useAuthStore.getState().status, "signedIn");
  assert.equal(useAuthStore.getState().user?.id, "usr_g");
  assert.deepEqual(h.requests[0], { url: "https://identity.test/identity/auth/google/complete", body: { accessToken: "supabase-access-token-xxxxxxxx", deviceLabel: "Android device" } });
  assert.equal((await h.store.load())?.accessToken, "access-g");
});

test("wallet sign-in spends the code with the device's verifier", async () => {
  const h = harness();
  const ok = await useAuthStore.getState().signInWith((client) => client.exchangeWalletSignIn("ABCDEFGHJKMN", "v".repeat(43)));
  assert.equal(ok, true);
  assert.deepEqual(h.requests[0], { url: "https://identity.test/identity/auth/wallet/exchange", body: { code: "ABCDEFGHJKMN", codeVerifier: "v".repeat(43) } });
});

test("backing out of the browser is not an error and changes nothing", async () => {
  harness();
  const ok = await useAuthStore.getState().signInWith(async () => null);
  assert.equal(ok, false);
  assert.equal(useAuthStore.getState().status, "signedOut");
  assert.equal(useAuthStore.getState().operation, "idle");
  assert.equal(useAuthStore.getState().authErrorCode, null);
});

test("a refused sign-in shows its public code, and the account cap is one of them", async () => {
  harness();
  const ok = await useAuthStore.getState().signInWith(async () => { throw new IdentityApiError(403, "registration_closed"); });
  assert.equal(ok, false);
  assert.equal(useAuthStore.getState().status, "signedOut");
  assert.equal(useAuthStore.getState().operation, "idle");
  assert.equal(useAuthStore.getState().authErrorCode, "registration_closed");
});

test("one sign-in at a time", async () => {
  harness();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const first = useAuthStore.getState().signInWith(async (client) => { await gate; return client.completeGoogleSignIn("supabase-access-token-xxxxxxxx"); });
  assert.equal(useAuthStore.getState().operation, "signingIn");
  assert.equal(await useAuthStore.getState().signInWith(async () => { throw new Error("must not run"); }), false);
  release();
  assert.equal(await first, true);
});
