/**
 * Auth store lifecycle — behavioural tests against the real store and a real
 * identity client (memory secure store + stubbed fetch).
 *
 * These exist because the previous model was unusable in a way no unit test
 * could see: `beginEmailOtp` left `status: "authenticating"` after the server
 * accepted the request, so the code field stayed disabled and signup could
 * never be completed. Every assertion below is written against what the FORM
 * can observe — is a request in flight, is the user signed in, which error is
 * owned by whom — rather than against internal wiring.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSecureSessionStore } from "../../lib/secureSession";
import { createTestSecureBackend } from "../../lib/secureSession.testBackend";
import { IdentityApiClient } from "../../services/identityApi";
import { isAuthBusy } from "../../lib/authLifecycle";
import { useAuthStore } from "../useAuthStore";

const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const USER = { id: "usr_1", status: "active", createdAt: FUTURE };
const SESSION = {
  id: "ses_1",
  assuranceLevel: "aal1",
  issuedAt: FUTURE,
  expiresAt: FUTURE,
  accessToken: "access-1",
  accessTokenExpiresAt: FUTURE,
  refreshToken: "refresh-1",
  refreshTokenExpiresAt: FUTURE,
};

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

interface Harness {
  calls: string[];
  client: IdentityApiClient;
}

function harness(handler: (url: string, init?: RequestInit) => Promise<Response>): Harness {
  const store = createSecureSessionStore(createTestSecureBackend());
  const calls: string[] = [];
  const client = new IdentityApiClient({ baseUrl: "https://identity.test", store });
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    calls.push(String(input));
    return handler(String(input), init);
  }) as typeof fetch;
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
  return { calls, client };
}

const state = () => useAuthStore.getState();

beforeEach(() => {
  useAuthStore.setState({ operation: "idle", authErrorCode: null, restoreErrorCode: null });
});

// ---- send code --------------------------------------------------------------

test("a successful send passes through sendingOtp, returns to idle, and stays signed out", async () => {
  const seen: string[] = [];
  const unsubscribe = useAuthStore.subscribe((s) => seen.push(s.operation));
  const h = harness(async () => json(200, { challengeId: "ch_1" }));

  const sent = await state().beginEmailOtp("runner@example.com");
  unsubscribe();

  assert.equal(sent, true, "the caller learns the server accepted it");
  assert.ok(seen.includes("sendingOtp"), "the request is observable while in flight");
  assert.equal(state().operation, "idle", "and the operation ends");
  assert.equal(state().status, "signedOut", "sending a code does not authenticate anyone");
  assert.equal(state().authErrorCode, null);
  assert.equal(h.calls.length, 1);
});

test("after a successful send the OTP entry is usable — the exact bug that blocked signup", () => {
  // The form disables its code field on `busy`, which is derived ONLY from the
  // auth operation. Idle after a successful send is what makes entry possible.
  assert.equal(state().operation, "idle");
  assert.equal(isAuthBusy(state().operation), false, "the code field must be editable");
});

test("a failed send returns to idle and exposes only a stable public code", async () => {
  harness(async () => json(429, { error: { code: "too_many_attempts" } }));

  const sent = await state().beginEmailOtp("runner@example.com");

  assert.equal(sent, false);
  assert.equal(state().operation, "idle");
  assert.equal(state().status, "signedOut");
  assert.equal(state().authErrorCode, "too_many_attempts");
  assert.equal(state().restoreErrorCode, null, "a send failure is NOT a restore failure");
});

// ---- verify code ------------------------------------------------------------

test("verification signs the user in only after the server confirms it", async () => {
  const seen: string[] = [];
  const unsubscribe = useAuthStore.subscribe((s) => seen.push(`${s.status}:${s.operation}`));
  harness(async (url) => {
    if (url.endsWith("/email/complete")) {
      return json(200, { user: USER, session: SESSION, embeddedWallet: null });
    }
    if (url.endsWith("/identity/me")) return json(200, { user: USER, session: SESSION, identities: [] });
    if (url.endsWith("/identity/wallets")) return json(200, { wallets: [] });
    return json(404, {});
  });

  const ok = await state().completeEmailOtp("runner@example.com", "123456", "Android device");
  unsubscribe();

  assert.equal(ok, true);
  assert.equal(state().status, "signedIn");
  assert.equal(state().operation, "idle");
  assert.equal(state().user?.id, "usr_1", "server-derived state is populated");
  assert.ok(
    seen.some((s) => s === "signedOut:verifyingOtp"),
    "signed-in is never claimed while the request is still running",
  );
});

test("an invalid code returns to idle, keeps entry usable, and never invokes restore", async () => {
  const h = harness(async () => json(400, { error: { code: "verification_failed" } }));

  const ok = await state().completeEmailOtp("runner@example.com", "000000", "Android device");

  assert.equal(ok, false);
  assert.equal(state().operation, "idle", "the code field is editable again");
  assert.notEqual(state().status, "signedIn", "no fabricated session");
  assert.equal(state().authErrorCode, "verification_failed");
  assert.equal(state().restoreErrorCode, null, "an invalid code must never earn a restore Retry");
  // A session restore would have hit /identity/me — nothing did.
  assert.ok(!h.calls.some((c) => c.endsWith("/identity/me")), "no session-restore action ran");
});

// ---- repeated taps ----------------------------------------------------------

test("repeated taps produce exactly one send and one verify request", async () => {
  const h = harness(async (url) => {
    if (url.endsWith("/email/begin")) return json(200, { challengeId: "ch_1" });
    if (url.endsWith("/email/complete")) return json(400, { error: { code: "verification_failed" } });
    return json(404, {});
  });

  await Promise.all([
    state().beginEmailOtp("runner@example.com"),
    state().beginEmailOtp("runner@example.com"),
    state().beginEmailOtp("runner@example.com"),
  ]);
  assert.equal(h.calls.filter((c) => c.endsWith("/email/begin")).length, 1, "one send request");

  await Promise.all([
    state().completeEmailOtp("runner@example.com", "123456"),
    state().completeEmailOtp("runner@example.com", "123456"),
  ]);
  assert.equal(h.calls.filter((c) => c.endsWith("/email/complete")).length, 1, "one verify request");
  assert.equal(state().operation, "idle");
});

test("auth actions refuse to run while already signed in", async () => {
  const h = harness(async () => json(200, { challengeId: "ch_1" }));
  useAuthStore.setState({ status: "signedIn" });

  assert.equal(await state().beginEmailOtp("runner@example.com"), false);
  assert.equal(await state().completeEmailOtp("runner@example.com", "123456"), false);
  assert.deepEqual(h.calls, []);
});

// ---- error ownership --------------------------------------------------------

test("a restore failure sets only the restore error; a form failure sets only the form error", async () => {
  harness(async () => json(400, { error: { code: "verification_failed" } }));
  await state().completeEmailOtp("runner@example.com", "000000");
  assert.equal(state().authErrorCode, "verification_failed");
  assert.equal(state().restoreErrorCode, null);

  useAuthStore.setState({ authErrorCode: null });
  const store = createSecureSessionStore(createTestSecureBackend());
  await store.save({
    accessToken: "a",
    accessTokenExpiresAt: FUTURE,
    refreshToken: "r",
    refreshTokenExpiresAt: FUTURE,
  });
  globalThis.fetch = (async () => {
    throw new TypeError("Network request failed");
  }) as typeof fetch;
  useAuthStore.setState({
    client: new IdentityApiClient({ baseUrl: "https://identity.test", store }),
  });

  await state().retryRestore();
  assert.equal(state().restoreErrorCode, "service_unavailable");
  assert.equal(state().authErrorCode, null, "a restore problem is not a form problem");
  assert.equal(state().status, "unknown", "and it is never reported as signed out");
});
