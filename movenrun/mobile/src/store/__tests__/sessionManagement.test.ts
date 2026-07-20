/**
 * Mobile session & device management — offline node tests over the exact
 * production modules: the typed API client (services/identityApi), the auth
 * store (store/useAuthStore), the presentation rules behind the Account
 * Security screen (lib/sessionPresentation), and the conservative device
 * label (lib/deviceLabel). fetch is stubbed per test; no network, no RN
 * runtime, no new dependencies.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createSecureSessionStore, type SecureSessionTokens } from "../../lib/secureSession";
import { createTestSecureBackend } from "../../lib/secureSession.testBackend";
import { IdentityApiClient, type PublicSessionSummary } from "../../services/identityApi";
import { useAuthStore } from "../useAuthStore";
import {
  canRevokeSession,
  groupSessions,
  sessionCaption,
  sessionStatusLabel,
} from "../../lib/sessionPresentation";
import { buildDeviceLabel, displayDeviceLabel, GENERIC_DEVICE_LABEL } from "../../lib/deviceLabel";

const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const TOKENS: SecureSessionTokens = {
  accessToken: "at-1",
  accessTokenExpiresAt: FUTURE,
  refreshToken: "rt-1",
  refreshTokenExpiresAt: FUTURE,
};

function makeSession(over: Partial<PublicSessionSummary> = {}): PublicSessionSummary {
  return {
    id: "sess-1",
    isCurrent: false,
    deviceLabel: "Android device",
    status: "active",
    assuranceLevel: "aal2",
    issuedAt: "2026-07-01T10:00:00.000Z",
    expiresAt: FUTURE,
    lastUsedAt: "2026-07-02T09:30:00.000Z",
    revokedAt: null,
    ...over,
  };
}

interface StubCall {
  url: string;
  method: string;
  body: string | null;
}

/** Route-table fetch stub recording every call. */
function stubFetch(routes: Record<string, (call: StubCall) => { status: number; json: unknown }>) {
  const calls: StubCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: StubCall = {
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : null,
    };
    calls.push(call);
    const key = Object.keys(routes).find((k) => call.url.includes(k));
    if (!key) return new Response(JSON.stringify({ error: { code: "not_found" } }), { status: 404 });
    const out = routes[key](call);
    return new Response(JSON.stringify(out.json), { status: out.status });
  }) as typeof fetch;
  return calls;
}

const originalFetch = globalThis.fetch;
let backend: ReturnType<typeof createTestSecureBackend>;
let client: IdentityApiClient;

beforeEach(async () => {
  backend = createTestSecureBackend();
  const store = createSecureSessionStore(backend);
  await store.save(TOKENS);
  client = new IdentityApiClient({ baseUrl: "http://127.0.0.1:9", store });
  useAuthStore.setState({
    status: "signedIn",
    user: { id: "u1", status: "active", createdAt: FUTURE },
    identities: [],
    wallets: [],
    errorCode: null,
    client,
    sessions: [],
    sessionsStatus: "idle",
    sessionsErrorCode: null,
    pendingSessionAction: null,
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---- API client -------------------------------------------------------------

test("listSessions parses the inventory and sends the bearer token", async () => {
  const current = makeSession({ id: "cur", isCurrent: true });
  const calls = stubFetch({
    "/identity/sessions": () => ({ status: 200, json: { sessions: [current, makeSession()] } }),
  });
  const { sessions } = await client.listSessions();
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].id, "cur");
  assert.equal(sessions[0].isCurrent, true);
  assert.equal(calls[0].method, "GET");
});

test("revokeSession posts to the per-session path with the id URL-encoded", async () => {
  const calls = stubFetch({
    "/identity/sessions/": () => ({ status: 200, json: { revoked: true } }),
  });
  await client.revokeSession("abc/../etc");
  assert.equal(calls[0].method, "POST");
  assert.ok(calls[0].url.includes("/identity/sessions/abc%2F..%2Fetc/revoke"), calls[0].url);
});

test("revokeOtherSessions posts to revoke-others and does NOT clear local credentials", async () => {
  stubFetch({ "/identity/session/revoke-others": () => ({ status: 200, json: { revoked: 2 } }) });
  const { revoked } = await client.revokeOtherSessions();
  assert.equal(revoked, 2);
  const store = createSecureSessionStore(backend);
  assert.deepEqual(await store.load(), TOKENS, "current device's credentials survive revoke-others");
});

test("completeEmailOtp includes the device label only when provided", async () => {
  const session = {
    id: "s", assuranceLevel: "aal2", issuedAt: FUTURE, expiresAt: FUTURE,
    ...TOKENS,
  };
  const calls = stubFetch({
    "/identity/auth/email/complete": () => ({
      status: 200,
      json: { user: { id: "u1", status: "active", createdAt: FUTURE }, session, embeddedWallet: null },
    }),
  });
  await client.completeEmailOtp("a@example.com", "123456", "Android device");
  assert.deepEqual(JSON.parse(calls[0].body!), { email: "a@example.com", code: "123456", deviceLabel: "Android device" });
  await client.completeEmailOtp("a@example.com", "123456");
  assert.deepEqual(JSON.parse(calls[1].body!), { email: "a@example.com", code: "123456" });
});

// ---- store: inventory -------------------------------------------------------

test("loadSessions stores the server list and never fabricates sessions on failure", async () => {
  stubFetch({ "/identity/sessions": () => ({ status: 200, json: { sessions: [makeSession({ isCurrent: true })] } }) });
  await useAuthStore.getState().loadSessions();
  assert.equal(useAuthStore.getState().sessionsStatus, "ready");
  assert.equal(useAuthStore.getState().sessions.length, 1);

  // Backend becomes unavailable: existing list is retained, error surfaced,
  // and nothing is invented locally.
  stubFetch({ "/identity/sessions": () => ({ status: 503, json: { error: { code: "unavailable" } } }) });
  await useAuthStore.getState().loadSessions("refresh");
  const st = useAuthStore.getState();
  assert.equal(st.sessionsStatus, "error");
  assert.equal(st.sessions.length, 1, "recoverable: last confirmed list retained, not fabricated");
});

test("a 401 that survives the refresh retry clears local auth safely", async () => {
  stubFetch({
    "/identity/sessions": () => ({ status: 401, json: { error: { code: "session_invalid" } } }),
    "/identity/auth/refresh": () => ({ status: 401, json: { error: { code: "refresh_reuse_detected" } } }),
  });
  await useAuthStore.getState().loadSessions();
  const st = useAuthStore.getState();
  assert.equal(st.status, "signedOut", "externally revoked session falls back to signed-out");
  assert.equal(st.sessions.length, 0);
  const store = createSecureSessionStore(backend);
  assert.equal(await store.load(), null, "stale credentials cleared from the secure store");
});

// ---- store: revocation actions ---------------------------------------------

test("revokeSession revokes on the server, then re-lists (no optimistic deletion)", async () => {
  let revoked = false;
  const calls = stubFetch({
    "/identity/sessions/other-1/revoke": () => {
      revoked = true;
      return { status: 200, json: { revoked: true } };
    },
    "/identity/sessions": () => ({
      status: 200,
      json: { sessions: revoked ? [makeSession({ id: "cur", isCurrent: true })] : [makeSession({ id: "cur", isCurrent: true }), makeSession({ id: "other-1" })] },
    }),
  });
  useAuthStore.setState({ sessions: [makeSession({ id: "cur", isCurrent: true }), makeSession({ id: "other-1" })] });
  await useAuthStore.getState().revokeSession("other-1");
  const st = useAuthStore.getState();
  assert.equal(st.pendingSessionAction, null);
  assert.deepEqual(st.sessions.map((s) => s.id), ["cur"], "row removed only after server confirmation");
  assert.ok(calls.some((c) => c.method === "POST" && c.url.includes("/revoke")));
  assert.ok(calls.some((c) => c.method === "GET"), "list re-fetched after revocation");
});

test("a failed revoke leaves the list unchanged and recoverable", async () => {
  stubFetch({
    "/identity/sessions/ghost/revoke": () => ({ status: 404, json: { error: { code: "not_found" } } }),
  });
  const before = [makeSession({ id: "cur", isCurrent: true }), makeSession({ id: "other-1" })];
  useAuthStore.setState({ sessions: before });
  await useAuthStore.getState().revokeSession("ghost");
  const st = useAuthStore.getState();
  assert.equal(st.sessionsErrorCode, "not_found");
  assert.equal(st.pendingSessionAction, null, "action unlocked after failure");
  assert.deepEqual(st.sessions, before, "no optimistic mutation on failure");
  assert.equal(st.status, "signedIn", "a 404 is not an auth loss");
});

test("session actions are deduplicated while one is in flight", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  let posts = 0;
  stubFetch({
    "/identity/sessions/slow/revoke": () => {
      posts++;
      return { status: 200, json: { revoked: true } };
    },
    "/identity/sessions": () => ({ status: 200, json: { sessions: [] } }),
  });
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    const res = await realFetch(...args);
    inFlight--;
    return res;
  }) as typeof fetch;
  const st = useAuthStore.getState();
  await Promise.all([st.revokeSession("slow"), st.revokeSession("slow"), st.revokeOtherSessions()]);
  assert.equal(posts, 1, "second tap and concurrent revoke-others are ignored while pending");
});

test("revokeOtherSessions keeps this device signed in and refreshes the list", async () => {
  stubFetch({
    "/identity/session/revoke-others": () => ({ status: 200, json: { revoked: 3 } }),
    "/identity/sessions": () => ({ status: 200, json: { sessions: [makeSession({ id: "cur", isCurrent: true })] } }),
  });
  await useAuthStore.getState().revokeOtherSessions();
  const st = useAuthStore.getState();
  assert.equal(st.status, "signedIn");
  assert.deepEqual(st.sessions.map((s) => s.id), ["cur"]);
  const store = createSecureSessionStore(backend);
  assert.deepEqual(await store.load(), TOKENS, "SecureStore untouched by revoke-others");
});

test("signOutEverywhere (revoke-all) clears SecureStore, runtime state, and the session list", async () => {
  const calls = stubFetch({
    "/identity/session/revoke-all": () => ({ status: 200, json: { revoked: 2 } }),
  });
  useAuthStore.setState({ sessions: [makeSession({ isCurrent: true })] });
  await useAuthStore.getState().signOutEverywhere();
  const st = useAuthStore.getState();
  assert.equal(st.status, "signedOut");
  assert.equal(st.user, null);
  assert.equal(st.sessions.length, 0);
  assert.equal(st.pendingSessionAction, null);
  const store = createSecureSessionStore(backend);
  assert.equal(await store.load(), null, "credentials wiped");
  // Exactly one revoke-all call — no refresh/retry loop after revocation.
  assert.equal(calls.filter((c) => c.url.includes("revoke-all")).length, 1);
  assert.equal(calls.filter((c) => c.url.includes("/auth/refresh")).length, 0);
});

test("no token or hash material ever enters the store's session state", async () => {
  stubFetch({ "/identity/sessions": () => ({ status: 200, json: { sessions: [makeSession({ isCurrent: true })] } }) });
  await useAuthStore.getState().loadSessions();
  const { client: _client, ...rest } = useAuthStore.getState();
  const blob = JSON.stringify(rest);
  for (const secret of [TOKENS.accessToken, TOKENS.refreshToken, "refreshTokenHash", "familyId", "userAgentHash", "securityVersion"]) {
    assert.ok(!blob.includes(secret), `store state must not contain ${secret}`);
  }
});

// ---- presentation rules (Account Security screen logic) ---------------------

test("groupSessions: current card first and alone; active others and settled sessions separated", () => {
  const cur = makeSession({ id: "cur", isCurrent: true });
  const other = makeSession({ id: "o1" });
  const revoked = makeSession({ id: "r1", status: "revoked", revokedAt: FUTURE });
  const expired = makeSession({ id: "e1", status: "expired" });
  const g = groupSessions([cur, other, revoked, expired]);
  assert.equal(g.current!.id, "cur");
  assert.deepEqual(g.otherActive.map((s) => s.id), ["o1"]);
  assert.deepEqual(g.recentlyEnded.map((s) => s.id), ["r1", "e1"]);
  // Empty inventory → clean empty groups, nothing fabricated.
  const empty = groupSessions([]);
  assert.equal(empty.current, null);
  assert.equal(empty.otherActive.length + empty.recentlyEnded.length, 0);
});

test("the current session NEVER offers the per-session revoke control; settled sessions don't either", () => {
  assert.equal(canRevokeSession(makeSession({ isCurrent: true })), false);
  assert.equal(canRevokeSession(makeSession({ status: "revoked" })), false);
  assert.equal(canRevokeSession(makeSession({ status: "expired" })), false);
  assert.equal(canRevokeSession(makeSession()), true, "only other ACTIVE sessions are revocable");
});

test("status labels and captions show only privacy-preserving fields", () => {
  assert.equal(sessionStatusLabel(makeSession({ isCurrent: true })), "This device");
  assert.equal(sessionStatusLabel(makeSession()), "Active");
  assert.equal(sessionStatusLabel(makeSession({ status: "revoked" })), "Signed out");
  assert.equal(sessionStatusLabel(makeSession({ status: "expired" })), "Expired");
  const caption = sessionCaption(makeSession({ status: "revoked", revokedAt: "2026-07-03T08:00:00.000Z" }));
  assert.ok(caption.includes("Signed in"));
  assert.ok(caption.includes("signed out"));
  const nullSafe = sessionCaption(makeSession({ issuedAt: "garbage", lastUsedAt: null }));
  assert.equal(typeof nullSafe, "string", "invalid timestamps never crash the caption");
});

// ---- device label -----------------------------------------------------------

test("buildDeviceLabel derives only a coarse platform label", () => {
  assert.equal(buildDeviceLabel("ios"), "iPhone");
  assert.equal(buildDeviceLabel("android"), "Android device");
  assert.equal(buildDeviceLabel("web"), GENERIC_DEVICE_LABEL);
  assert.equal(buildDeviceLabel(undefined), GENERIC_DEVICE_LABEL);
});

test("displayDeviceLabel refuses control characters and overlong values, falling back to generic", () => {
  assert.equal(displayDeviceLabel("  My   Pixel  "), "My Pixel");
  assert.equal(displayDeviceLabel("bad\u0000label"), GENERIC_DEVICE_LABEL);
  assert.equal(displayDeviceLabel("bad\u009flabel"), GENERIC_DEVICE_LABEL);
  assert.equal(displayDeviceLabel("x".repeat(65)), GENERIC_DEVICE_LABEL);
  assert.equal(displayDeviceLabel(""), GENERIC_DEVICE_LABEL);
  assert.equal(displayDeviceLabel(null), GENERIC_DEVICE_LABEL);
});
