/**
 * Bounded, account-safe offline verification retry.
 *
 * The invariant under test, stated once:
 *
 *   a pending route may retry only for the same authenticated account, with
 *   the same clientSessionId, for a bounded period, without storing
 *   credentials or turning the app into an indefinite GPS archive.
 *
 * The account half of that is a security boundary rather than a feature, so it
 * is tested first and hardest: user A's unsent route must never leave the
 * device under user B's bearer session, by any sequence of sign-outs, sign-ins,
 * late responses or button presses.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_ATTEMPTS,
  MAX_PENDING_AGE_MS,
  MAX_PENDING_ITEMS,
  PENDING_SCHEMA_VERSION,
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  backoffMs,
  buildPendingItem,
  classifyOutcome,
  isDeadVerdict,
  isExpired,
  parsePendingItem,
  parseQueue,
  retryEligibility,
  serializeQueue,
  upsertPending,
  withAttempt,
  type PendingVerificationItem,
} from "../pendingVerification";
import { toObservations, type VerificationState } from "../movementVerification";
import {
  __resetInFlight,
  discardPendingRetries,
  retryPendingVerifications,
  retryVerification,
  submitCompletedSession,
} from "@/services/verifySession";
import {
  VERIFICATION_QUEUE_KEY,
  installVerificationQueueStore,
  loadPendingQueue,
} from "@/services/verificationQueue";
import { MovementApiError } from "@/services/movementApi";
import type { FinishedSession } from "@/services/moveSession";
import type { TrackPoint } from "../geo";

const SRC = join(process.cwd(), "src");
const read = (p: string) => readFileSync(p, "utf8");

/**
 * Source with comments removed.
 *
 * The structural guards below ask what the code *does*, and a doc comment
 * saying "this never reads workout history" is not the code reading workout
 * history. Scanning the raw file conflated the two and made these guards fail
 * on their own explanations — which is the same failure mode in reverse: a
 * guard that answers a different question from the one it claims to.
 */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");

const START = 1_700_000_000_000;
const END = START + 180_000;
const USER_A = "usr_aaaaaaaaaaaaaaaa";
const USER_B = "usr_bbbbbbbbbbbbbbbb";

test("privacy barrier: a delayed failure cannot resurrect coordinates after discard", async () => {
  let fail!: (error: unknown) => void;
  const response = new Promise<never>((_, reject) => { fail = reject; });
  const cell = stateCell(session().clientSessionId);
  const running = submitCompletedSession(session(), {
    client: fakeClient(() => response).client as any,
    ownerUserId: USER_A, ...cell, now: () => END + 1000,
  });
  await discardPendingRetries();
  fail(offline());
  await running;
  assert.equal(storage.raw(), null, "late failure must not restore deleted GPS");
  assert.equal(cell.current.kind, "submitting", "stale callback cannot publish state");
});

/* ── harness ──────────────────────────────────────────────────────────────── */

/** An in-memory stand-in for AsyncStorage, with the writes kept for inspection. */
function fakeStore() {
  const data = new Map<string, string>();
  const writes: string[] = [];
  return {
    data,
    writes,
    raw: () => data.get(VERIFICATION_QUEUE_KEY) ?? null,
    seed(value: string) {
      data.set(VERIFICATION_QUEUE_KEY, value);
    },
    store: {
      getItem: async (key: string) => data.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        writes.push(value);
        data.set(key, value);
      },
      removeItem: async (key: string) => {
        data.delete(key);
      },
    },
  };
}

let storage = fakeStore();

beforeEach(() => {
  __resetInFlight();
  storage = fakeStore();
  installVerificationQueueStore(storage.store);
});

function points(n = 4): TrackPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    latitude: 51.5 + i * 0.0009,
    longitude: -0.12,
    timestamp: START + i * 60_000,
    accuracy: 6,
  }));
}

function session(over: Partial<FinishedSession> = {}): FinishedSession {
  return {
    clientSessionId: "mv-offline-session-01",
    mode: "gps",
    points: points(),
    distanceM: 420,
    durationMs: 180_000,
    finishedAt: END,
    ...over,
  };
}

/** Mirrors moveSession's id-addressed cell. */
function stateCell(id: string) {
  let current: VerificationState = { kind: "local" };
  return {
    readState: () => current,
    writeState: (sessionId: string, next: VerificationState) => {
      if (sessionId !== id) return;
      current = next;
    },
    get current() {
      return current;
    },
  };
}

function fakeClient(impl: (req: any) => Promise<unknown>) {
  const requests: any[] = [];
  return {
    requests,
    calls: () => requests.length,
    client: {
      submit: async (req: any) => {
        requests.push(req);
        return impl(req) as never;
      },
    } as never,
  };
}

const offline = () => new MovementApiError("network_unavailable", 0, "service_unavailable");

function verifiedReply(sessionId: string) {
  return {
    verification: {
      sessionId,
      status: "verified" as const,
      distanceMeters: 431,
      durationSeconds: 180,
      traversedHexIds: ["8a1fb46622dffff", "8a1fb46622d7fff"],
      rejectionReasons: [] as string[],
      verifiedAt: "2026-08-25T21:00:00.000Z",
    },
    replayed: false,
  };
}

function rejectedReply(sessionId: string) {
  return {
    verification: {
      sessionId,
      status: "rejected" as const,
      distanceMeters: null,
      durationSeconds: null,
      traversedHexIds: [] as string[],
      rejectionReasons: ["Implausible speed at index 2"],
      verifiedAt: "2026-08-25T21:00:00.000Z",
    },
    replayed: false,
  };
}

/** Queue one failed submission for `owner` and return the resulting item. */
async function queueOne(owner: string | null, at = END + 1_000): Promise<PendingVerificationItem[]> {
  const s = session();
  const cell = stateCell(s.clientSessionId);
  const spy = fakeClient(async () => {
    throw offline();
  });
  await submitCompletedSession(s, {
    client: spy.client,
    ...cell,
    ownerUserId: owner,
    now: () => at,
  });
  return loadPendingQueue();
}

function item(over: Partial<PendingVerificationItem> = {}): PendingVerificationItem {
  return {
    ...buildPendingItem({
      clientSessionId: "mv-offline-session-01",
      ownerUserId: USER_A,
      observations: toObservations({ points: points(), durationMs: 180_000, finishedAt: END }),
      reason: "offline",
      now: END + 1_000,
    }),
    ...over,
  };
}

/* ══ 1. account isolation — the hard gate ═════════════════════════════════ */

test("A's queued route is never submitted while B is the authenticated account", async () => {
  const queued = await queueOne(USER_A);
  assert.equal(queued.length, 1, "A's failed submission should have queued exactly one item");
  assert.equal(queued[0].ownerUserId, USER_A);

  __resetInFlight();
  const spy = fakeClient(async (req) => verifiedReply(req.sessionId));
  const sweep = await retryPendingVerifications({
    client: spy.client,
    writeState: () => {},
    ownerUserId: USER_B,
    now: () => END + MAX_PENDING_AGE_MS / 2,
  });

  assert.equal(spy.calls(), 0, "B's session must never carry A's route to the server");
  assert.deepEqual(sweep.attempted, []);
  assert.equal(sweep.skipped["mv-offline-session-01"], "not_owner");
});

test("B cannot adopt, see, or manually retry A's pending record", async () => {
  await queueOne(USER_A);
  __resetInFlight();

  const spy = fakeClient(async (req) => verifiedReply(req.sessionId));
  const result = await retryVerification("mv-offline-session-01", {
    client: spy.client,
    writeState: () => {},
    ownerUserId: USER_B,
    now: () => END + 60 * 60 * 1000,
  });

  assert.equal(result, null, "a manual retry must not authorise a cross-account submission");
  assert.equal(spy.calls(), 0);

  // And the record is not re-homed: it still belongs to A, untouched.
  const queue = await loadPendingQueue();
  assert.equal(queue.length, 1);
  assert.equal(queue[0].ownerUserId, USER_A, "an orphan must never be adopted by the new account");
  assert.equal(queue[0].attempts, 1, "a refused retry must not consume A's attempt budget");
});

test("the ownership check is decided before age, budget and backoff", () => {
  /* Ordering IS the property: no arrangement of clocks or counters may reach a
     submission with the account check unevaluated. */
  const stale = item({ attempts: MAX_ATTEMPTS, lastAttemptAt: END });
  const ctx = { now: END + MAX_PENDING_AGE_MS * 10, currentUserId: USER_B };
  assert.equal(retryEligibility(stale, ctx), "not_owner");
  assert.equal(retryEligibility(stale, { ...ctx, manual: true }), "not_owner");
});

test("a manual retry relaxes backoff and nothing else", () => {
  const fresh = item({ attempts: 1, lastAttemptAt: END });
  const justAfter = { now: END + 1, currentUserId: USER_A };
  assert.equal(retryEligibility(fresh, justAfter), "backoff");
  assert.equal(retryEligibility(fresh, { ...justAfter, manual: true }), "ok");

  for (const [over, verdict] of [
    [{ attempts: MAX_ATTEMPTS }, "budget_exhausted"],
    [{ observations: { ...fresh.observations, endTime: 1 } }, "expired"],
    [{ ownerUserId: USER_B }, "not_owner"],
  ] as const) {
    assert.equal(
      retryEligibility(item({ ...over, lastAttemptAt: END }), { ...justAfter, manual: true }),
      verdict,
      "a button press is evidence of intent, not of authorisation",
    );
  }
});

test("signing out discards the queue, so nothing survives to be adopted", async () => {
  await queueOne(USER_A);
  assert.notEqual(storage.raw(), null);

  await discardPendingRetries();

  assert.equal(storage.raw(), null, "sign-out must delete unsent route observations");
  assert.deepEqual(await loadPendingQueue(), []);
});

test("no authenticated account means no coordinates are ever written to disk", async () => {
  const queued = await queueOne(null);
  assert.deepEqual(queued, [], "an unowned route has nobody who may retry it — never store it");
  assert.equal(storage.raw(), null);
});

test("a sweep with no resolved account reads nothing and sends nothing", async () => {
  await queueOne(USER_A);
  __resetInFlight();
  let read = false;
  installVerificationQueueStore({
    getItem: async () => {
      read = true;
      return storage.raw();
    },
    setItem: async () => {},
    removeItem: async () => {},
  });

  const spy = fakeClient(async (req) => verifiedReply(req.sessionId));
  const sweep = await retryPendingVerifications({
    client: spy.client,
    writeState: () => {},
    ownerUserId: null,
    now: () => END + 60_000,
  });

  assert.equal(read, false, "storage must not even be read before authentication resolves");
  assert.equal(spy.calls(), 0);
  assert.deepEqual(sweep.attempted, []);
});

test("a late response for A cannot label B's session", async () => {
  /* The id-addressed writer is what stops it: the response names A's session,
     the cell holds B's, and the write is dropped. */
  const bCell = stateCell("mv-user-b-session-002");
  bCell.writeState("mv-offline-session-01", { kind: "verified", distanceMeters: 9_999, durationSeconds: 1, traversedHexIds: [] });
  assert.deepEqual(bCell.current, { kind: "local" }, "A's verdict must not land on B's session");
});

test("an account reset clears queued observations along with the store", async () => {
  await queueOne(USER_A);
  assert.notEqual(storage.raw(), null);
  // The store action calls exactly this; asserted structurally below too.
  await discardPendingRetries();
  assert.equal(storage.raw(), null);
});

/* ══ 2. stable session identity ═══════════════════════════════════════════ */

test("a retry reuses the original session id and never mints a new one", async () => {
  const queued = await queueOne(USER_A);
  const originalId = queued[0].clientSessionId;
  assert.equal(originalId, "mv-offline-session-01");

  __resetInFlight();
  const spy = fakeClient(async (req) => verifiedReply(req.sessionId));
  await retryPendingVerifications({
    client: spy.client,
    writeState: () => {},
    ownerUserId: USER_A,
    now: () => END + 10 * 60_000,
  });

  assert.equal(spy.calls(), 1);
  assert.equal(
    spy.requests[0].sessionId,
    originalId,
    "a fresh id would make the backend treat the retry as a second verification",
  );
});

test("a manual retry uses the same id as the automatic path", async () => {
  await queueOne(USER_A);
  __resetInFlight();
  const spy = fakeClient(async (req) => verifiedReply(req.sessionId));
  await retryVerification("mv-offline-session-01", {
    client: spy.client,
    writeState: () => {},
    ownerUserId: USER_A,
    now: () => END + 1,
  });
  assert.equal(spy.requests[0].sessionId, "mv-offline-session-01");
});

test("the id survives serialisation, restart and reparse unchanged", async () => {
  await queueOne(USER_A);
  const raw = storage.raw();
  assert.ok(raw);
  // A fresh process: nothing in memory, only what is on disk.
  const restored = parseQueue(raw);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].clientSessionId, "mv-offline-session-01");
  assert.equal(restored[0].observations.points.length, 4);
});

test("counting another attempt never re-anchors the owner, window or route", () => {
  const first = item();
  const second = withAttempt(first, "timeout", END + 5 * 60_000);
  assert.equal(second.attempts, 2);
  assert.equal(second.ownerUserId, first.ownerUserId);
  assert.deepEqual(second.observations, first.observations);
  assert.equal(
    second.observations.endTime,
    first.observations.endTime,
    "retrying must not refresh the clock that expiry is measured against",
  );
});

/* ══ 3. queue behaviour ═══════════════════════════════════════════════════ */

test("one offline saved session creates exactly one pending item", async () => {
  const queued = await queueOne(USER_A);
  assert.equal(queued.length, 1);
  const parsed = JSON.parse(storage.raw() as string);
  assert.equal(parsed.items.length, 1);
});

test("repeated failures update the one item rather than accumulating copies", async () => {
  await queueOne(USER_A);
  for (let i = 0; i < 3; i++) {
    __resetInFlight();
    const spy = fakeClient(async () => {
      throw offline();
    });
    await retryPendingVerifications({
      client: spy.client,
      writeState: () => {},
      ownerUserId: USER_A,
      now: () => END + (i + 1) * 24 * 60 * 60 * 1000 / 6,
    });
  }
  const queue = await loadPendingQueue();
  assert.equal(queue.length, 1, "one session, one queue entry");
  assert.equal(queue[0].attempts, 4);
});

test("the queue is capped, and overflow drops the oldest route first", () => {
  let queue: PendingVerificationItem[] = [];
  for (let i = 0; i < MAX_PENDING_ITEMS + 2; i++) {
    queue = upsertPending(
      queue,
      item({
        clientSessionId: `mv-session-${String(i).padStart(4, "0")}`,
        observations: { startTime: START + i, endTime: END + i * 1_000, points: [] as never },
      }),
    );
  }
  assert.equal(queue.length, MAX_PENDING_ITEMS);
  assert.equal(queue[0].clientSessionId, "mv-session-0002", "oldest routes leave first");
});

test("two simultaneous triggers rejoin one request instead of racing", async () => {
  await queueOne(USER_A);
  __resetInFlight();

  let release: (v: unknown) => void = () => {};
  const gate = new Promise((r) => {
    release = r;
  });
  const spy = fakeClient(async (req) => {
    await gate;
    return verifiedReply(req.sessionId);
  });
  const deps = {
    client: spy.client,
    writeState: () => {},
    ownerUserId: USER_A,
    now: () => END + 10 * 60_000,
  };

  const sweep = retryPendingVerifications(deps);
  const manual = retryVerification("mv-offline-session-01", deps);
  release(null);
  await Promise.all([sweep, manual]);

  assert.equal(spy.calls(), 1, "a foreground sweep and a Retry tap must share one request");
});

/* ══ 4. settling and cleanup ══════════════════════════════════════════════ */

test("a successful retry deletes the stored route observations", async () => {
  await queueOne(USER_A);
  __resetInFlight();
  const spy = fakeClient(async (req) => verifiedReply(req.sessionId));
  const settled: [string, VerificationState][] = [];
  await retryPendingVerifications({
    client: spy.client,
    writeState: () => {},
    ownerUserId: USER_A,
    now: () => END + 10 * 60_000,
    onSettled: (id, state) => settled.push([id, state]),
  });

  assert.equal(settled.length, 1);
  assert.equal(settled[0][1].kind, "verified");
  assert.deepEqual(await loadPendingQueue(), [], "a verdict makes the raw route unnecessary");
  assert.equal(storage.raw(), null, "the key itself is removed once nothing is pending");
});

test("an idempotent repeat verdict settles normally and leaves nothing queued", async () => {
  await queueOne(USER_A);
  __resetInFlight();
  const spy = fakeClient(async (req) => ({ ...verifiedReply(req.sessionId), replayed: true }));
  await retryPendingVerifications({
    client: spy.client,
    writeState: () => {},
    ownerUserId: USER_A,
    now: () => END + 10 * 60_000,
  });
  assert.deepEqual(await loadPendingQueue(), []);
});

test("a terminal rejection settles and stops retrying", async () => {
  await queueOne(USER_A);
  __resetInFlight();
  const spy = fakeClient(async (req) => rejectedReply(req.sessionId));
  const states: VerificationState[] = [];
  await retryPendingVerifications({
    client: spy.client,
    writeState: () => {},
    ownerUserId: USER_A,
    now: () => END + 10 * 60_000,
    onSettled: (_id, s) => states.push(s),
  });

  assert.equal(states[0].kind, "rejected");
  assert.deepEqual(await loadPendingQueue(), [], "the server answered — there is nothing to retry");

  __resetInFlight();
  const again = fakeClient(async (req) => rejectedReply(req.sessionId));
  await retryPendingVerifications({
    client: again.client,
    writeState: () => {},
    ownerUserId: USER_A,
    now: () => END + 60 * 60_000,
  });
  assert.equal(again.calls(), 0, "a rejected session must not be resubmitted");
});

test("a settled verification keeps no duplicate raw payload anywhere", async () => {
  await queueOne(USER_A);
  __resetInFlight();
  const spy = fakeClient(async (req) => verifiedReply(req.sessionId));
  await retryPendingVerifications({
    client: spy.client,
    writeState: () => {},
    ownerUserId: USER_A,
    now: () => END + 10 * 60_000,
  });
  /* Every value that was ever written, not merely the final one: a cleanup that
     leaves the coordinates in an earlier revision is not a cleanup. */
  assert.equal(storage.data.size, 0);
  assert.deepEqual(await loadPendingQueue(), []);
});

/* ══ 5. failure classification ════════════════════════════════════════════ */

test("classification separates 'the server never answered' from 'the server refused'", () => {
  assert.equal(classifyOutcome("offline"), "retry");
  assert.equal(classifyOutcome("timeout"), "retry");
  assert.equal(classifyOutcome("server_error"), "retry");
  assert.equal(classifyOutcome("unauthenticated"), "auth_blocked");
  assert.equal(classifyOutcome("invalid_request"), "terminal");
  assert.equal(classifyOutcome("not_found"), "terminal");
  assert.equal(classifyOutcome("malformed_response"), "terminal");
});

test("a 422 structural rejection is never queued for retry", async () => {
  const s = session();
  const cell = stateCell(s.clientSessionId);
  const spy = fakeClient(async () => {
    throw new MovementApiError("invalid_request", 422, "invalid_request");
  });
  const state = await submitCompletedSession(s, {
    client: spy.client,
    ...cell,
    ownerUserId: USER_A,
    now: () => END + 1_000,
  });

  assert.deepEqual(state, { kind: "pending", reason: "invalid_request" });
  assert.deepEqual(
    await loadPendingQueue(),
    [],
    "the server read the payload and refused it — identical bytes will be refused identically",
  );
  assert.equal(storage.raw(), null);
});

test("a retryable 5xx stays queued", async () => {
  const s = session();
  const cell = stateCell(s.clientSessionId);
  const spy = fakeClient(async () => {
    throw new MovementApiError("server_error", 503, "request_failed");
  });
  await submitCompletedSession(s, {
    client: spy.client,
    ...cell,
    ownerUserId: USER_A,
    now: () => END + 1_000,
  });
  const queue = await loadPendingQueue();
  assert.equal(queue.length, 1);
  assert.equal(queue[0].lastReason, "server_error");
});

test("a permanent auth failure consumes budget and stops rather than spinning", async () => {
  let now = END + 1_000;
  const s = session();
  const cell = stateCell(s.clientSessionId);
  const authFail = fakeClient(async () => {
    throw new MovementApiError("unauthorized", 401, "unauthenticated");
  });
  await submitCompletedSession(s, {
    client: authFail.client,
    ...cell,
    ownerUserId: USER_A,
    now: () => now,
  });

  let attempts = 0;
  for (let round = 0; round < 20; round++) {
    __resetInFlight();
    now += RETRY_MAX_DELAY_MS;
    const spy = fakeClient(async () => {
      throw new MovementApiError("unauthorized", 401, "unauthenticated");
    });
    await retryPendingVerifications({
      client: spy.client,
      writeState: () => {},
      ownerUserId: USER_A,
      now: () => now,
    });
    attempts += spy.calls();
  }

  assert.ok(attempts < MAX_ATTEMPTS, `unbounded auth retry: ${attempts} extra attempts`);
  assert.deepEqual(await loadPendingQueue(), [], "a spent item must not keep holding coordinates");
});

/* ══ 6. bounds ════════════════════════════════════════════════════════════ */

test("the attempt budget is bounded and spent items are discarded, not retried", async () => {
  let now = END + 1_000;
  await queueOne(USER_A, now);

  let sent = 1;
  for (let round = 0; round < 20; round++) {
    __resetInFlight();
    now += RETRY_MAX_DELAY_MS;
    const spy = fakeClient(async () => {
      throw offline();
    });
    const sweep = await retryPendingVerifications({
      client: spy.client,
      writeState: () => {},
      ownerUserId: USER_A,
      now: () => now,
    });
    sent += spy.calls();
    if (sweep.discarded.length) break;
  }

  assert.equal(sent, MAX_ATTEMPTS, `expected exactly ${MAX_ATTEMPTS} attempts, got ${sent}`);
  assert.deepEqual(await loadPendingQueue(), []);
});

test("an over-budget item is refused before any request is made", async () => {
  const spent = item({ attempts: MAX_ATTEMPTS, lastAttemptAt: END });
  assert.equal(
    retryEligibility(spent, { now: END + RETRY_MAX_DELAY_MS * 10, currentUserId: USER_A }),
    "budget_exhausted",
  );
  assert.ok(isDeadVerdict("budget_exhausted"));
});

test("retention is bounded, measured from the session, and far below the backend ceiling", () => {
  const BACKEND_CEILING_MS = 30 * 24 * 60 * 60 * 1000;
  assert.ok(
    MAX_PENDING_AGE_MS < BACKEND_CEILING_MS,
    "the client must never hold a route longer than the server would accept it",
  );
  assert.ok(MAX_PENDING_AGE_MS <= BACKEND_CEILING_MS / 4, "retention should be materially shorter");

  const fresh = item();
  assert.equal(isExpired(fresh, END + MAX_PENDING_AGE_MS), false);
  assert.equal(isExpired(fresh, END + MAX_PENDING_AGE_MS + 1), true);
});

test("an expired route is deleted, never uploaded", async () => {
  await queueOne(USER_A);
  __resetInFlight();
  const spy = fakeClient(async (req) => verifiedReply(req.sessionId));
  const sweep = await retryPendingVerifications({
    client: spy.client,
    writeState: () => {},
    ownerUserId: USER_A,
    now: () => END + MAX_PENDING_AGE_MS + 1,
  });

  assert.equal(spy.calls(), 0, "an expired route must never leave the device");
  assert.equal(sweep.skipped["mv-offline-session-01"], "expired");
  assert.deepEqual(sweep.discarded, ["mv-offline-session-01"]);
  assert.equal(storage.raw(), null);
});

test("expiry cannot be evaded by re-queuing, and touches no workout timestamp", async () => {
  await queueOne(USER_A);
  const before = (await loadPendingQueue())[0];

  // Fail again, close to the deadline: the attempt clock moves, the session's
  // own end time — the thing expiry is measured against — does not.
  __resetInFlight();
  const spy = fakeClient(async () => {
    throw offline();
  });
  await retryPendingVerifications({
    client: spy.client,
    writeState: () => {},
    ownerUserId: USER_A,
    now: () => END + MAX_PENDING_AGE_MS - 1_000,
  });

  const after = (await loadPendingQueue())[0];
  assert.equal(after.observations.endTime, before.observations.endTime);
  assert.equal(after.observations.startTime, before.observations.startTime);
  assert.equal(
    isExpired(after, END + MAX_PENDING_AGE_MS + 1),
    true,
    "a retry must not buy the route another week on the device",
  );
});

test("backoff is deterministic, monotonic and capped", () => {
  assert.equal(backoffMs(0), 0);
  assert.equal(backoffMs(1), RETRY_BASE_DELAY_MS);
  assert.equal(backoffMs(2), RETRY_BASE_DELAY_MS * 2);
  let previous = 0;
  for (let n = 1; n <= 40; n++) {
    const delay = backoffMs(n);
    assert.ok(delay >= previous, "backoff must not decrease");
    assert.ok(delay <= RETRY_MAX_DELAY_MS, "backoff must be capped");
    previous = delay;
  }
  assert.equal(backoffMs(40), RETRY_MAX_DELAY_MS);
});

test("an automatic sweep inside the backoff window sends nothing", async () => {
  await queueOne(USER_A);
  __resetInFlight();
  const spy = fakeClient(async (req) => verifiedReply(req.sessionId));
  const sweep = await retryPendingVerifications({
    client: spy.client,
    writeState: () => {},
    ownerUserId: USER_A,
    now: () => END + 2_000,
  });
  assert.equal(spy.calls(), 0);
  assert.equal(sweep.skipped["mv-offline-session-01"], "backoff");
  assert.equal((await loadPendingQueue()).length, 1, "backoff defers, it does not discard");
});

/* ══ 7. malformed persistence fails closed ════════════════════════════════ */

test("nothing malformed is ever parsed into a submittable item", () => {
  const good = item();
  const base = JSON.parse(serializeQueue([good])).items[0];
  assert.ok(parsePendingItem(base), "the honest shape must still parse");

  const corruptions: [string, unknown][] = [
    ["not an object", "mv-offline-session-01"],
    ["null", null],
    ["future schema version", { ...base, schemaVersion: PENDING_SCHEMA_VERSION + 1 }],
    ["missing schema version", { ...base, schemaVersion: undefined }],
    ["no owner", { ...base, ownerUserId: undefined }],
    ["empty owner", { ...base, ownerUserId: "" }],
    ["non-string owner", { ...base, ownerUserId: 42 }],
    ["session id the backend would reject", { ...base, clientSessionId: "no" }],
    ["session id with illegal characters", { ...base, clientSessionId: "mv session/../.." }],
    ["attempts below one", { ...base, attempts: 0 }],
    ["fractional attempts", { ...base, attempts: 1.5 }],
    ["NaN attempts", { ...base, attempts: Number.NaN }],
    ["unknown reason", { ...base, lastReason: "vibes" }],
    ["no observations", { ...base, observations: null }],
    ["window inverted", { ...base, observations: { ...base.observations, startTime: END + 1, endTime: START } }],
    ["single point", { ...base, observations: { ...base.observations, points: base.observations.points.slice(0, 1) } }],
    ["points not an array", { ...base, observations: { ...base.observations, points: "51.5,-0.12" } }],
    [
      "latitude out of range",
      { ...base, observations: { ...base.observations, points: [{ ...base.observations.points[0], lat: 991 }, base.observations.points[1]] } },
    ],
    [
      "longitude out of range",
      { ...base, observations: { ...base.observations, points: [{ ...base.observations.points[0], lng: -999 }, base.observations.points[1]] } },
    ],
    [
      "infinite coordinate",
      { ...base, observations: { ...base.observations, points: [{ ...base.observations.points[0], lat: Number.POSITIVE_INFINITY }, base.observations.points[1]] } },
    ],
    [
      "negative accuracy",
      { ...base, observations: { ...base.observations, points: [{ ...base.observations.points[0], accuracy: -1 }, base.observations.points[1]] } },
    ],
    [
      "point outside the declared window",
      { ...base, observations: { ...base.observations, points: [{ ...base.observations.points[0], timestamp: START - 1 }, base.observations.points[1]] } },
    ],
  ];

  for (const [label, corrupt] of corruptions) {
    assert.equal(parsePendingItem(corrupt), null, `${label} must fail closed`);
  }
});

test("a corrupt queue file yields no work rather than a guess", () => {
  assert.deepEqual(parseQueue(null), []);
  assert.deepEqual(parseQueue("not json at all"), []);
  assert.deepEqual(parseQueue("[]"), []);
  assert.deepEqual(parseQueue(JSON.stringify({ version: 99, items: [] })), []);
  assert.deepEqual(parseQueue(JSON.stringify({ version: PENDING_SCHEMA_VERSION, items: "nope" })), []);
  // One bad apple is dropped; a good sibling survives.
  const good = JSON.parse(serializeQueue([item()])).items[0];
  const mixed = parseQueue(
    JSON.stringify({ version: PENDING_SCHEMA_VERSION, items: [{ nonsense: true }, good] }),
  );
  assert.equal(mixed.length, 1);
});

test("a malformed persisted item is never submitted", async () => {
  storage.seed(
    JSON.stringify({
      version: PENDING_SCHEMA_VERSION,
      items: [{ schemaVersion: PENDING_SCHEMA_VERSION, clientSessionId: "mv-broken-000001", ownerUserId: USER_A }],
    }),
  );
  const spy = fakeClient(async (req) => verifiedReply(req.sessionId));
  const sweep = await retryPendingVerifications({
    client: spy.client,
    writeState: () => {},
    ownerUserId: USER_A,
    now: () => END + 10 * 60_000,
  });
  assert.equal(spy.calls(), 0, "an item that failed validation must never reach the network");
  assert.deepEqual(sweep.attempted, []);
});

/* ══ 8. persisted secrecy — the field list is the privacy surface ═════════ */

test("the persisted shape is exactly the reviewed field list, and no more", async () => {
  await queueOne(USER_A);
  const raw = storage.raw();
  assert.ok(raw);
  const parsed = JSON.parse(raw);

  assert.deepEqual(Object.keys(parsed).sort(), ["items", "version"]);
  assert.deepEqual(
    Object.keys(parsed.items[0]).sort(),
    [
      "attempts",
      "clientSessionId",
      "lastAttemptAt",
      "lastReason",
      "observations",
      "ownerUserId",
      "schemaVersion",
    ],
    "a new persisted field is a new privacy decision and must be reviewed here",
  );
  assert.deepEqual(Object.keys(parsed.items[0].observations).sort(), ["endTime", "points", "startTime"]);
  assert.deepEqual(
    Object.keys(parsed.items[0].observations.points[0]).sort(),
    ["accuracy", "lat", "lng", "timestamp"],
  );
});

test("no credential, header or account secret is ever written to the queue", async () => {
  await queueOne(USER_A);
  const written = [storage.raw() ?? "", ...storage.writes].join("\n").toLowerCase();
  const forbidden = [
    "authorization",
    "bearer",
    "accesstoken",
    "access_token",
    "refreshtoken",
    "refresh_token",
    "password",
    "otp",
    "privatekey",
    "private_key",
    "walletaddress",
    "advertisingid",
    "idfa",
    "cookie",
    "sessiontoken",
  ];
  for (const needle of forbidden) {
    assert.ok(!written.includes(needle), `"${needle}" must never be persisted beside a route`);
  }
});

test("no reward, ownership or trust state rides along in the queue", async () => {
  await queueOne(USER_A);
  const written = (storage.raw() ?? "").toLowerCase();
  for (const needle of ["xp", "lockedmove", "trustscore", "capturedzone", "ownedzone", "deed"]) {
    assert.ok(!written.includes(needle), `"${needle}" is not a verification observation`);
  }
});

test("serialisation picks fields rather than spreading, so nothing can ride along", () => {
  const smuggled = { ...item(), authorization: "Bearer secret-token", debugRoute: "51.5,-0.12" } as PendingVerificationItem;
  const serialized = serializeQueue([smuggled]);
  assert.ok(!serialized.includes("secret-token"));
  assert.ok(!serialized.toLowerCase().includes("authorization"));
  assert.ok(!serialized.includes("debugRoute"));
});

/* ══ 9. historical upload is structurally impossible ══════════════════════ */

test("nothing enrols existing history into verification", () => {
  /* The queue can only be filled by a submission that ran and failed. There is
     no code path from a stored workout to a new upload, and these are the
     symbols such a path would have to use. */
  for (const file of [
    join(SRC, "services", "verificationQueue.ts"),
    join(SRC, "services", "verifySession.ts"),
    join(SRC, "lib", "pendingVerification.ts"),
  ]) {
    const source = code(file);
    for (const banned of [
      "useGameStore",
      "routeTrustHistory",
      "addRouteTrustRecord",
      "CompletionRecord",
      "RouteTrustRecord",
      ".history",
      "newClientSessionId",
      "AsyncStorage",
    ]) {
      assert.ok(
        !source.includes(banned),
        `${file} references ${banned} — the retry path must not reach workout history, ` +
          "mint identifiers, or bind itself to a storage implementation",
      );
    }
  }
});

test("a device full of pre-feature history produces an empty queue", async () => {
  /* Nothing has failed, so nothing is pending — regardless of how much local
     workout history exists. The queue is seeded only by live failures. */
  assert.deepEqual(await loadPendingQueue(), []);
  const spy = fakeClient(async (req) => verifiedReply(req.sessionId));
  const sweep = await retryPendingVerifications({
    client: spy.client,
    writeState: () => {},
    ownerUserId: USER_A,
    now: () => END + 10 * 60_000,
  });
  assert.deepEqual(sweep.attempted, []);
  assert.equal(spy.calls(), 0);
});

test("buildPendingItem takes observations, never a session id to look up", () => {
  const source = read(join(SRC, "lib", "pendingVerification.ts"));
  const signature = source.slice(source.indexOf("export function buildPendingItem"));
  assert.ok(
    signature.includes("observations: SessionObservations"),
    "the only way to obtain observations must be to have just held them in memory",
  );
});

/* ══ 10. structural guards ════════════════════════════════════════════════ */

test("the retry path never logs, and never touches reward or territory state", () => {
  for (const file of [
    join(SRC, "services", "verificationQueue.ts"),
    join(SRC, "services", "verifySession.ts"),
    join(SRC, "lib", "pendingVerification.ts"),
    join(SRC, "hooks", "useVerificationRetry.ts"),
    join(SRC, "services", "verificationQueueStorage.ts"),
  ]) {
    const source = code(file);
    for (const banned of ["console.log", "console.warn", "console.error", "console.debug"]) {
      assert.ok(!source.includes(banned), `${file} logs — a GPS trace must never reach a log buffer`);
    }
    for (const banned of ["captureZone", "defendZones", "fortifyZone", "addXp", "lockedMove", "completeQuest"]) {
      assert.ok(!source.includes(banned), `${file} reaches for ${banned}; verification is not a reward authority`);
    }
  }
});

test("the retry queue is not persisted in the game store", () => {
  const store = code(join(SRC, "store", "useGameStore.ts"));
  for (const banned of ["PendingVerificationItem", "pendingVerification", "observations", "points"]) {
    assert.ok(
      !store.includes(banned),
      `the game store must not hold route observations — it survives sign-out and has no retention policy`,
    );
  }
});

test("every signed-out transition goes through the discard helper", () => {
  const auth = read(join(SRC, "store", "useAuthStore.ts"));
  const spreads = auth.match(/\.\.\.SIGNED_OUT_BASE/g) ?? [];
  assert.equal(
    spreads.length,
    1,
    "SIGNED_OUT_BASE may only be spread inside `signedOut()`, which is what discards queued routes",
  );
  assert.ok(auth.includes("discardPendingVerifications()"));
  const helper = auth.slice(auth.indexOf("function signedOut"));
  const body = helper.slice(0, helper.indexOf("\n}"));
  assert.ok(body.includes("discardPendingVerifications()"), "the discard must be unconditional");
});

test("an account/progress reset discards queued routes too", () => {
  const store = read(join(SRC, "store", "useGameStore.ts"));
  const resetBody = store.slice(store.indexOf("reset: () =>"), store.indexOf("viewedRouteProof: false,\n        });"));
  assert.ok(
    resetBody.includes("discardPendingVerifications()"),
    "clearing local progress must not leave unsent coordinates orphaned",
  );
});

test("retry is foreground-only: no timers, no background tasks, no new permissions", () => {
  const hook = code(join(SRC, "hooks", "useVerificationRetry.ts"));
  for (const banned of [
    "setInterval",
    "setTimeout",
    "BackgroundFetch",
    "TaskManager",
    "startLocationUpdatesAsync",
    "defineTask",
    "expo-background",
  ]) {
    assert.ok(!hook.includes(banned), `${banned} would make this background work`);
  }
  assert.ok(hook.includes('AppState.addEventListener("change"'), "foreground transitions are the trigger");
  assert.ok(hook.includes('status !== "signedIn"'), "nothing runs before authentication resolves");

  const config = JSON.parse(read(join(process.cwd(), "app.json"))).expo;
  const permissions: string[] = config.android?.permissions ?? [];
  for (const forbidden of [
    "android.permission.ACCESS_BACKGROUND_LOCATION",
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.FOREGROUND_SERVICE_LOCATION",
  ]) {
    assert.ok(!permissions.includes(forbidden), `retry must not widen the tracking policy (${forbidden})`);
  }
});

test("retry rides the shared authenticated transport, not a client of its own", () => {
  const hook = code(join(SRC, "hooks", "useVerificationRetry.ts"));
  assert.ok(
    hook.includes("new MovementApiClient(identityClient.transport)"),
    "one bearer attachment and one single-flight refresh for the whole app",
  );
  for (const banned of ["fetch(", "Authorization", "refreshToken", "AuthedJsonTransport"]) {
    assert.ok(!hook.includes(banned), `${banned}: retry must not build its own auth path`);
  }
});

test("the queue module stays free of storage and platform imports", () => {
  const queue = code(join(SRC, "services", "verificationQueue.ts"));
  for (const banned of ["react-native", "async-storage", "expo-", "SecureStore"]) {
    assert.ok(
      !queue.includes(banned),
      `${banned} in verificationQueue.ts would make the retry policy untestable off-device`,
    );
  }
});

test("the storage adapter claims no encryption it cannot prove", () => {
  const adapter = read(join(SRC, "services", "verificationQueueStorage.ts"));
  assert.ok(adapter.includes("AsyncStorage"));
  assert.ok(
    /NOT encrypted-at-rest|not encrypted/i.test(adapter),
    "AsyncStorage is unencrypted; the file must say so rather than imply otherwise",
  );
  assert.ok(!/encrypted at rest\b(?!.*not)/i.test(adapter.replace(/NOT encrypted-at-rest/g, "")));
});

test("verification state stays honest: pending is a client state, never a verdict", () => {
  const model = read(join(SRC, "lib", "movementVerification.ts"));
  assert.ok(model.includes("There is no `pending` status on the wire"));
  const retry = code(join(SRC, "lib", "pendingVerification.ts"));
  for (const banned of ["Captured", "Owned", "Reward earned", "Verified territory"]) {
    assert.ok(!retry.includes(banned), `${banned} is not established by a queued retry`);
  }
});
