import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { AuthedJsonTransport } from "../authedTransport";
import { IdentityApiClient } from "../identityApi";
import { verificationGeneration, captureVerificationScope, setVerificationAccount, resetVerificationAccountForTests } from "../verificationPrivacy";
import { clearPendingQueue, installVerificationQueueStore, loadPendingQueue, savePendingItem, VERIFICATION_QUEUE_KEY } from "../verificationQueue";
import { buildPendingItem, serializeQueue } from "../../lib/pendingVerification";
import { __resetInFlight, submitCompletedSession, retryPendingVerifications } from "../verifySession";
import { MovementApiError } from "../movementApi";
import { getLastSession, setLastSession, type FinishedSession } from "../moveSession";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const END = 1_700_000_180_000;
const session: FinishedSession = {
  clientSessionId: "mv-privacy-session-01", mode: "gps", distanceM: 420,
  durationMs: 180_000, finishedAt: END,
  points: [0, 1, 2, 3].map((i) => ({ latitude: 51.5 + i * 0.0009,
    longitude: -0.12, accuracy: 6, timestamp: END - 180_000 + i * 60_000 })),
};
const item = (ownerUserId = "account-a", id = session.clientSessionId) => buildPendingItem({
  ownerUserId, clientSessionId: id, now: END + 1000, reason: "offline",
  observations: { startTime: END - 180_000, endTime: END,
    points: session.points.map((p) => ({ lat: p.latitude, lng: p.longitude, accuracy: p.accuracy!, timestamp: p.timestamp })) },
});
const reply = { verification: { status: "verified", distanceMeters: 420, durationSeconds: 180, traversedHexIds: [] } };
const offline = () => new MovementApiError("network_unavailable", 0, "service_unavailable");
let data = new Map<string, string>();
const adapter = () => ({ getItem: async (key: string) => data.get(key) ?? null,
  setItem: async (key: string, value: string) => { data.set(key, value); },
  removeItem: async (key: string) => { data.delete(key); } });
const originalFetch = globalThis.fetch;
async function gameStoreWithMemoryAdapter() {
  const require = createRequire(process.cwd() + "/package.json");
  const key = require.resolve("@react-native-async-storage/async-storage");
  const previous = require.cache[key];
  require.cache[key] = { exports: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } } as NodeModule;
  try { return (await import("../../store/useGameStore")).useGameStore; }
  finally { if (previous) require.cache[key] = previous; else delete require.cache[key]; }
}
beforeEach(async () => { __resetInFlight(); resetVerificationAccountForTests(); data = new Map(); installVerificationQueueStore(adapter()); await clearPendingQueue(); setLastSession(session); });
afterEach(() => { globalThis.fetch = originalFetch; });

test("late success after reset publishes neither state nor reconciliation, and erases finished memory", async () => {
  await savePendingItem(item());
  setLastSession(session);
  const response = deferred<any>();
  const states: string[] = [];
  const settled: string[] = [];
  const running = retryPendingVerifications({ client: { submit: () => response.promise } as any,
    ownerUserId: "account-a", now: () => END + 120_000,
    writeState: (_, s) => states.push(s.kind), onSettled: (_, s) => settled.push(s.kind) });
  await tick();
  await clearPendingQueue();
  assert.equal(getLastSession(), null);
  response.resolve(reply);
  await running;
  assert.deepEqual(states, ["submitting"]);
  assert.deepEqual(settled, []);
  assert.equal(data.get(VERIFICATION_QUEUE_KEY), undefined);
});

test("in-flight ownership and generation isolate reused session IDs and late finalizers", async () => {
  const a = deferred<any>(); const b = deferred<any>(); let callsB = 0;
  const deps = (ownerUserId: string, response: typeof a) => ({
    client: { submit: () => { if (ownerUserId === "account-b") callsB++; return response.promise; } } as any,
    ownerUserId, now: () => END + 1000, readState: () => ({ kind: "local" as const }), writeState: () => {},
  });
  const pa = submitCompletedSession(session, deps("account-a", a));
  const pb = submitCompletedSession(session, deps("account-b", b));
  assert.notEqual(pa, pb);
  a.reject(offline()); await pa;
  assert.equal(submitCompletedSession(session, deps("account-b", b)), pb);
  assert.equal(callsB, 1);
  b.reject(offline()); await pb;
  assert.deepEqual((await loadPendingQueue()).map((i) => i.ownerUserId).sort(), ["account-a", "account-b"]);
  await clearPendingQueue();
  assert.equal(data.size, 0);
});

test("serialized read-modify-write retains concurrent sessions", async () => {
  await Promise.all([savePendingItem(item("account-a", "mv-session-000001")), savePendingItem(item("account-a", "mv-session-000002"))]);
  assert.equal((await loadPendingQueue()).length, 2);
});

test("a stale A closure cannot start a request after B has signed in", async () => {
  setVerificationAccount("account-a");
  setVerificationAccount("account-b");
  let calls = 0;
  const state = await submitCompletedSession({ ...session }, { client: { submit: async () => { calls++; return reply; } } as any,
    ownerUserId: "account-a", now: () => END + 1000,
    readState: () => ({ kind: "local" }), writeState: () => {} });
  assert.equal(calls, 0);
  assert.equal(state.kind, "pending");
});

test("retained finished evidence cannot be re-enrolled by B or a later A login", async () => {
  await clearPendingQueue();
  let calls = 0;
  for (const ownerUserId of ["account-b", "account-a"]) {
    setVerificationAccount(ownerUserId);
    await submitCompletedSession(session, { client: { submit: async () => { calls++; return reply; } } as any,
      ownerUserId, now: () => END + 1000, readState: () => ({ kind: "local" }), writeState: () => {} });
  }
  assert.equal(calls, 0);
});

test("clear follows already-started writes and prevents stale queued writes", async () => {
  const writing = deferred<void>(); const entered = deferred<void>();
  const base = adapter();
  installVerificationQueueStore({ ...base, setItem: async (key, value) => {
    entered.resolve(); await writing.promise; await base.setItem(key, value);
  } });
  const oldScope = captureVerificationScope("account-a");
  const saving = savePendingItem(item(), oldScope);
  await entered.promise;
  const clearing = clearPendingQueue();
  const staleSaving = savePendingItem(item(), oldScope);
  writing.resolve();
  await Promise.all([saving, clearing, staleSaving]);
  assert.equal(data.size, 0);
});

test("restart preserves honest bounded retry but corrupt queue is durably removed", async () => {
  data.set(VERIFICATION_QUEUE_KEY, serializeQueue([item()]));
  installVerificationQueueStore(adapter()); __resetInFlight();
  assert.equal((await loadPendingQueue()).length, 1);
  data.set(VERIFICATION_QUEUE_KEY, "corrupt");
  assert.deepEqual(await loadPendingQueue(), []);
  assert.equal(data.size, 0);
});

test("queue deletion falls back to an empty tombstone and reports total storage failure", async () => {
  data.set(VERIFICATION_QUEUE_KEY, serializeQueue([item()]));
  installVerificationQueueStore({ ...adapter(), removeItem: async () => { throw Error("unavailable"); } });
  await clearPendingQueue();
  assert.equal(JSON.parse(data.get(VERIFICATION_QUEUE_KEY)!).items.length, 0);
  installVerificationQueueStore({ ...adapter(), removeItem: async () => { throw Error("unavailable"); }, setItem: async () => { throw Error("unavailable"); } });
  await assert.rejects(clearPendingQueue());
});

test("production progress reset awaits erasure and blocks delayed route resurrection", async () => {
  const game = await gameStoreWithMemoryAdapter();
  game.setState({ totalXp: 99 });
  const erase = deferred<void>(); const entered = deferred<void>(); const failedRequest = deferred<any>();
  const base = adapter();
  installVerificationQueueStore({ ...base, removeItem: async (key) => { entered.resolve(); await erase.promise; await base.removeItem(key); } });
  const pending = submitCompletedSession(session, { client: { submit: () => failedRequest.promise } as any,
    ownerUserId: "account-a", now: () => END + 1000, readState: () => ({ kind: "local" }), writeState: () => {} });
  const reset = game.getState().reset();
  await entered.promise;
  assert.equal(game.getState().totalXp, 99, "reset cannot announce completion ahead of erasure");
  failedRequest.reject(offline()); await pending;
  erase.resolve(); await reset;
  assert.equal(game.getState().totalXp, 0);
  assert.equal(data.size, 0);
});

test("production reset reports total deletion failure and preserves progress for retry", async () => {
  const game = await gameStoreWithMemoryAdapter();
  game.setState({ totalXp: 99 });
  installVerificationQueueStore({ ...adapter(), removeItem: async () => { throw Error("unavailable"); }, setItem: async () => { throw Error("unavailable"); } });
  await assert.rejects(game.getState().reset());
  assert.equal(game.getState().totalXp, 99);
});

for (const phase of ["initial-token", "refresh", "retry-token", "response-json"] as const) {
  test(`A payload cannot cross an account change during ${phase}`, async () => {
    const delayed = deferred<any>(); const reached = deferred<void>();
    let reads = 0; let sends = 0; let statusCalls = 0;
    const transport = new AuthedJsonTransport({ baseUrl: "https://test.invalid",
      loadAccessToken: async () => {
        reads++;
        if (phase === "initial-token" || (phase === "retry-token" && reads === 2)) { reached.resolve(); return delayed.promise; }
        return "account-a-token";
      },
      performRefresh: async () => {
        if (phase === "refresh") { reached.resolve(); return delayed.promise; }
        return { kind: "refreshed" };
      }, error: (status, code) => Object.assign(new Error(code), { status, code }),
    });
    globalThis.fetch = async () => {
      sends++;
      if (phase === "response-json") return { status: 200, ok: true, json: async () => { reached.resolve(); return delayed.promise; } } as Response;
      return new Response("{}", { status: 401 });
    };
    const request = transport.request("/movement/verify", { auth: true, method: "POST", body: { fixture: "a-route" }, onStatus: () => statusCalls++ });
    await reached.promise;
    await clearPendingQueue();
    delayed.resolve(phase === "refresh" ? { kind: "refreshed" } : phase === "response-json" ? {} : "account-b-token");
    await assert.rejects(request, /session_changed/);
    assert.equal(sends, phase === "initial-token" ? 0 : 1);
    assert.equal(statusCalls, 0);
  });
}

test("identity sign-out invalidates a pending route before remote revoke completes", async () => {
  const revoke = deferred<Response>();
  globalThis.fetch = async () => revoke.promise;
  const tokens = { accessToken: "a", refreshToken: "ra", accessTokenExpiresAt: "2099-01-01", refreshTokenExpiresAt: "2099-01-01" };
  let cleared = false;
  const identity = new IdentityApiClient({ baseUrl: "https://test.invalid", store: {
    load: async () => tokens, save: async () => {}, clear: async () => { cleared = true; },
  } });
  const pending = deferred<any>();
  const running = submitCompletedSession(session, { client: { submit: () => pending.promise } as any,
    ownerUserId: "account-a", now: () => END + 1000,
    readState: () => ({ kind: "local" }), writeState: () => {} });
  const generation = verificationGeneration();
  const signingOut = identity.signOut();
  assert.ok(verificationGeneration() > generation);
  pending.reject(offline()); await running;
  assert.equal(data.size, 0);
  revoke.resolve(new Response('{"revoked":true}', { status: 200 })); await signingOut;
  assert.equal(cleared, true);
});

for (const status of [200, 401]) {
  test(`late A refresh (${status}) cannot replace or clear B credentials`, async () => {
    const refresh = deferred<Response>(); const entered = deferred<void>();
    let tokens: any = { accessToken: "a", refreshToken: "ra" };
    const writes: string[] = [];
    const identity = new IdentityApiClient({ baseUrl: "https://test.invalid", store: {
      load: async () => tokens,
      save: async (next) => { writes.push(next.accessToken); tokens = next; },
      clear: async () => { writes.push("clear"); tokens = null; },
    } });
    globalThis.fetch = async (url) => {
      if (String(url).endsWith("/refresh")) { entered.resolve(); return refresh.promise; }
      if (String(url).endsWith("/complete")) return new Response(JSON.stringify({ user: { id: "account-b" }, session: { accessToken: "b", refreshToken: "rb" } }), { status: 200 });
      return new Response("{}", { status: 401 });
    };
    const oldRequest = identity.me();
    const rejection = assert.rejects(oldRequest, /session_changed/);
    await entered.promise;
    await identity.completeEmailOtp("b@example.test", "123456");
    refresh.resolve(new Response(JSON.stringify({ session: { accessToken: "a-rotated", refreshToken: "ra-rotated" } }), { status }));
    await rejection;
    assert.equal(tokens.accessToken, "b");
    assert.deepEqual(writes, ["b"]);
  });
}

test("signout finalizer cannot clear an intervening B login", async () => {
  const revoke = deferred<Response>(); const entered = deferred<void>();
  let tokens: any = { accessToken: "a", refreshToken: "ra" };
  const identity = new IdentityApiClient({ baseUrl: "https://test.invalid", store: {
    load: async () => tokens, save: async (next) => { tokens = next; }, clear: async () => { tokens = null; },
  } });
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/revoke")) { entered.resolve(); return revoke.promise; }
    return new Response(JSON.stringify({ user: { id: "account-b" }, session: { accessToken: "b", refreshToken: "rb" } }), { status: 200 });
  };
  const signingOut = identity.signOut();
  const rejected = assert.rejects(signingOut, /session_changed/);
  await entered.promise;
  await identity.completeEmailOtp("b@example.test", "123456");
  revoke.resolve(new Response("{}", { status: 200 })); await rejected;
  assert.equal(tokens.accessToken, "b");
});
