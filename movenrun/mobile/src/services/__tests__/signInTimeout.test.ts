/**
 * Sign-in against a sleeping free host: the API wakes before it is needed,
 * and a sign-in that gets no answer ends in a retry message, not a spinner.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSecureSessionStore } from "../../lib/secureSession";
import { createTestSecureBackend } from "../../lib/secureSession.testBackend";
import { authErrorMessage } from "../../lib/emailAuth";
import { IdentityApiClient, IdentityApiError, SIGN_IN_TIMEOUT_MS } from "../identityApi";

function client(signInTimeoutMs?: number) {
  const store = createSecureSessionStore(createTestSecureBackend());
  return { store, client: new IdentityApiClient({ baseUrl: "https://identity.test", store, signInTimeoutMs }) };
}

/** A fetch that answers only when its request is aborted. */
function hangingFetch(calls: string[]) {
  globalThis.fetch = ((input: string, init?: RequestInit) => {
    calls.push(String(input));
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
  }) as typeof fetch;
}

test("the default sign-in wait covers a free-host cold start", () => {
  assert.ok(SIGN_IN_TIMEOUT_MS >= 60_000);
  assert.ok(SIGN_IN_TIMEOUT_MS <= 120_000);
});

test("a sign-in the server never answers ends with request_timeout and stores nothing", async () => {
  const calls: string[] = [];
  hangingFetch(calls);
  const { client: c, store } = client(30);
  await assert.rejects(c.completeGoogleSignIn("supabase-access-token"), (err: unknown) =>
    err instanceof IdentityApiError && err.code === "request_timeout");
  await assert.rejects(c.exchangeWalletSignIn("ABCDEFGHJKMN", "v".repeat(43)), (err: unknown) =>
    err instanceof IdentityApiError && err.code === "request_timeout");
  assert.deepEqual(calls, ["https://identity.test/identity/auth/google/complete", "https://identity.test/identity/auth/wallet/exchange"]);
  assert.equal(await store.load(), null);
});

test("the timeout has its own retry copy", () => {
  const text = authErrorMessage("request_timeout");
  assert.ok(text && /try again/.test(text));
  assert.notEqual(text, authErrorMessage("unknown_code"));
});

test("waking the server is one unauthenticated GET /health, shared while it runs, and never throws", async () => {
  const seen: Array<{ url: string; method?: string; auth?: string }> = [];
  let answer!: () => void;
  globalThis.fetch = ((input: string, init?: RequestInit) => {
    seen.push({ url: String(input), method: init?.method, auth: (init?.headers as Record<string, string>)?.authorization });
    return new Promise((resolve) => { answer = () => resolve({ ok: true, status: 200, json: async () => ({ status: "ok" }) } as Response); });
  }) as typeof fetch;
  const { client: c } = client();
  const first = c.wakeServer();
  const second = c.wakeServer();
  assert.equal(first, second);
  answer();
  await first;
  assert.deepEqual(seen, [{ url: "https://identity.test/health", method: "GET", auth: undefined }]);

  globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
  await c.wakeServer();
  globalThis.fetch = (async () => ({ ok: false, status: 503, json: async () => ({}) }) as Response) as typeof fetch;
  await c.wakeServer();
});

test("a paused sign-up has its own copy that keeps guest play open", () => {
  const text = authErrorMessage("registration_busy");
  assert.ok(text && /try again later/.test(text) && /guest/.test(text));
});
