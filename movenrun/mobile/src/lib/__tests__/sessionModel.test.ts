/**
 * The boundaries the session model must not cross.
 *
 * Richer session metadata is a new surface for old mistakes: a field that
 * claims a distance, a rules version rewritten on retry, a demo route reaching
 * the real queue, a session id printed on a screen. Each of those is cheap to
 * introduce and invisible in review, so each has a test here.
 *
 * Behaviour first, source scans only where behaviour cannot reach — and every
 * scan is aimed at the specific file where the mistake would be made rather
 * than swept across the repository, because a repo-wide regex passes for years
 * while checking nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DEFAULT_MOVEMENT_MODE,
  SESSION_RULES_VERSION,
  type SessionMetadata,
} from "@movenrun/shared/session";

import { toObservations, toSubmission } from "../movementVerification";
import {
  __resetInFlight,
  retryVerification,
  submitCompletedSession,
} from "../../services/verifySession";
import {
  installVerificationQueueStore,
  loadPendingQueue,
} from "../../services/verificationQueue";
import { MovementApiError } from "../../services/movementApi";
import { buildPendingItem, parsePendingItem, withAttempt } from "../pendingVerification";
import { finish, requestStart, sessionMetadata, trackerStarted } from "../sessionLifecycle";
import { isSaveable } from "../../services/moveSession";
import type { FinishedSession } from "../../services/moveSession";

const MOBILE = process.cwd();
const SRC = join(MOBILE, "src");
const APP = join(MOBILE, "app");
const read = (p: string) => readFileSync(p, "utf8");
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");

const T0 = 1_756_000_000_000;
const ID = "mv-model-session-1";

function liveSession(): SessionMetadata {
  const requested = requestStart({
    state: "idle",
    clientSessionId: null,
    mode: null,
    rulesVersion: null,
    startedAt: null,
    finishedAt: null,
    pauses: [],
    openPauseAt: null,
  });
  const running = trackerStarted(requested.lifecycle, { clientSessionId: ID, at: T0 });
  return sessionMetadata(finish(running.lifecycle, T0 + 600_000).lifecycle)!;
}

function finishedSession(over: Partial<FinishedSession> = {}): FinishedSession {
  const meta = liveSession();
  return {
    clientSessionId: ID,
    mode: "gps",
    session: meta,
    points: [
      { latitude: 12.9716, longitude: 77.5946, timestamp: T0 + 1_000, accuracy: 8 },
      { latitude: 12.9726, longitude: 77.5956, timestamp: T0 + 300_000, accuracy: 8 },
    ],
    distanceM: 420,
    durationMs: 600_000,
    finishedAt: meta.finishedAt,
    ...over,
  };
}

/* ── the phone reports observations, not authority ────────────────────────── */

test("a submission carries observations and provenance, and nothing that measures", () => {
  const submission = toSubmission(finishedSession());
  assert.deepEqual(Object.keys(submission).sort(), ["observations", "session"]);
  assert.deepEqual(Object.keys(submission.observations).sort(), ["endTime", "points", "startTime"]);

  /* Every key anywhere in the payload, checked by name rather than by
     substring — an earlier version of this scanned the serialized JSON for
     "points", which the legitimate observations key matches. Substring
     matching on a payload is how a guard ends up failing on its own subject. */
  assert.deepEqual(
    [...keysDeep(submission)].filter((k) => FORBIDDEN_PAYLOAD_KEYS.has(k)),
    [],
    "the submission carries a field the client has no authority over",
  );
});

/** Every key in an object graph, at any depth. */
function keysDeep(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) keysDeep(item, into);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      into.add(key);
      keysDeep(child, into);
    }
  }
  return into;
}

/** Fields that would make the phone an authority on its own reward. */
const FORBIDDEN_PAYLOAD_KEYS = new Set([
  "distanceMeters", "distance", "durationSeconds", "duration", "traversedCells",
  "traversedHexIds", "cells", "capturedCells", "captured", "ownership", "owned",
  "holder", "seal", "sealed", "solid", "shade", "strength", "xp", "credits",
  "rewardPoints", "trustScore", "verified", "status", "eligible",
]);

test("the device's own distance is never sent, though the app computes one", () => {
  /* The screen shows a distance and the finished session holds one. Neither
     goes on the wire: the server measures the route itself, and a second
     number would only raise the question of which is authoritative. */
  const session = finishedSession({ distanceM: 999_999 });
  const submission = toSubmission(session);
  assert.ok(!JSON.stringify(submission).includes("999999"));
});

test("session metadata is provenance only — the same five fields the domain defines", () => {
  const submission = toSubmission(finishedSession());
  assert.deepEqual(
    Object.keys(submission.session!).sort(),
    ["finishedAt", "mode", "pauses", "rulesVersion", "startedAt"],
  );
});

/* ── the two clocks stay separate ─────────────────────────────────────────── */

test("the observation window and the lifecycle window are computed separately", () => {
  /* The lifecycle starts before the first fix and finishes after the last —
     which is what really happens, since the tracker needs a moment and the
     user presses Finish after their last step. Collapsing the two would either
     break the server's containment check or misreport when the session ran. */
  const session = finishedSession();
  const submission = toSubmission(session);
  const { startTime, endTime } = submission.observations;
  const { startedAt, finishedAt } = submission.session!;

  assert.ok(startedAt <= startTime, "the session started at or before its first observation");
  assert.ok(finishedAt >= endTime, "the session finished at or after its last observation");
  assert.notEqual(startedAt, startTime, "the two clocks are not the same number here");
});

test("the observation window still contains every point", () => {
  const submission = toSubmission(finishedSession());
  const { startTime, endTime, points } = submission.observations;
  for (const p of points) {
    assert.ok(p.timestamp >= startTime && p.timestamp <= endTime);
  }
});

test("a session without metadata still produces a legacy submission rather than failing", () => {
  const legacy = finishedSession({ session: undefined });
  const submission = toSubmission(legacy);
  assert.equal(submission.session, undefined);
  assert.deepEqual(submission.observations, toObservations(legacy));
});

/* ── retry replays the original session ───────────────────────────────────── */

test("a queued item carries the metadata the session was stamped with", () => {
  const submission = toSubmission(finishedSession());
  const item = buildPendingItem({
    clientSessionId: ID,
    ownerUserId: "usr_1",
    observations: submission.observations,
    session: submission.session,
    reason: "offline",
    now: T0 + 700_000,
  });
  assert.deepEqual(item.session, submission.session);
});

test("counting another attempt never rewrites the metadata", () => {
  /* The mutation this catches: rebuilding the item at retry time from the
     current default mode and the current rules version, which would silently
     reinterpret a session captured under older rules after an app update. */
  const submission = toSubmission(finishedSession());
  const item = buildPendingItem({
    clientSessionId: ID,
    ownerUserId: "usr_1",
    observations: submission.observations,
    session: submission.session,
    reason: "offline",
    now: T0,
  });
  let carried = item;
  for (let i = 1; i <= 4; i++) carried = withAttempt(carried, "timeout", T0 + i * 60_000);
  assert.equal(carried.attempts, 5);
  assert.deepEqual(carried.session, item.session);
  assert.deepEqual(carried.observations, item.observations);
  assert.equal(carried.clientSessionId, ID, "the id is the session's, not the attempt's");
});

test("a queued item from before the session model survives, and stays legacy", () => {
  /* The upgrade case: a user had a failed verification queued when they
     updated. The item has no mode and no rules version, and there is nothing
     truthful to invent — so it is kept and resubmitted as legacy rather than
     dropped or stamped with today's values. */
  const legacy = {
    schemaVersion: 1,
    clientSessionId: ID,
    ownerUserId: "usr_1",
    observations: toObservations(finishedSession()),
    attempts: 2,
    lastAttemptAt: T0 + 100,
    lastReason: "offline",
  };
  const parsed = parsePendingItem(legacy);
  assert.ok(parsed, "a pre-#92 item must still parse — dropping it loses a real verification");
  assert.equal(parsed.session, undefined, "absence is the legacy signal");
  assert.equal(parsed.clientSessionId, ID);
  assert.equal(parsed.attempts, 2);
});

test("an item whose metadata is corrupt is rejected, not half-accepted", () => {
  /* Half-readable provenance is worse than none: it would be submitted as
     though it were what the session recorded. */
  const base = {
    schemaVersion: 1,
    clientSessionId: ID,
    ownerUserId: "usr_1",
    observations: toObservations(finishedSession()),
    attempts: 1,
    lastAttemptAt: T0,
    lastReason: "offline" as const,
  };
  for (const bad of [
    { mode: "cycling", rulesVersion: 1, startedAt: T0, finishedAt: T0 + 1, pauses: [] },
    { mode: "onFoot", rulesVersion: 99, startedAt: T0, finishedAt: T0 + 1, pauses: [] },
    { mode: "onFoot", rulesVersion: 1, startedAt: T0 + 5, finishedAt: T0, pauses: [] },
    { mode: "onFoot", rulesVersion: 1, startedAt: T0, finishedAt: T0 + 10, pauses: [{ startedAt: T0 + 8, endedAt: T0 + 2 }] },
    { mode: "onFoot", rulesVersion: 1, startedAt: T0, finishedAt: T0 + 10, pauses: "no" },
    "metadata",
    42,
  ]) {
    assert.equal(
      parsePendingItem({ ...base, session: bad }),
      null,
      `corrupt metadata was accepted: ${JSON.stringify(bad)}`,
    );
  }
});

test("valid metadata round-trips through storage unchanged", () => {
  const submission = toSubmission(finishedSession());
  const item = buildPendingItem({
    clientSessionId: ID,
    ownerUserId: "usr_1",
    observations: submission.observations,
    session: submission.session,
    reason: "offline",
    now: T0,
  });
  const parsed = parsePendingItem(JSON.parse(JSON.stringify(item)));
  assert.deepEqual(parsed?.session, submission.session);
});

/* ── the retry path itself, not just its helpers ──────────────────────────── */

/**
 * A queue backed by memory, and a client that records what it was asked to
 * send.
 *
 * The tests below drive the REAL submission pipeline rather than the pure
 * helpers around it. That distinction matters: an earlier version of this file
 * asserted `withAttempt` preserved metadata — true, and useless, because the
 * retry path does not build its request with `withAttempt`. A mutation that
 * rebuilt the metadata from the current defaults inside `runPending` passed
 * every test here. The guard was blind to the code it was guarding.
 */
function memoryQueue() {
  let raw: string | null = null;
  installVerificationQueueStore({
    getItem: async () => raw,
    setItem: async (_k: string, v: string) => {
      raw = v;
    },
    removeItem: async () => {
      raw = null;
    },
  });
}

function recordingClient(impl: (req: Record<string, unknown>) => Promise<unknown>) {
  const requests: Record<string, unknown>[] = [];
  return {
    requests,
    client: {
      submit: async (req: Record<string, unknown>) => {
        requests.push(req);
        return impl(req) as never;
      },
    } as never,
  };
}

const offline = () => new MovementApiError("network_unavailable", 0, "service_unavailable");

/** Queue one failed submission and return the request the retry then sends. */
async function queueThenRetry(session: FinishedSession): Promise<Record<string, unknown>> {
  __resetInFlight();
  memoryQueue();
  let state: unknown = { kind: "local" };

  const failing = recordingClient(async () => {
    throw offline();
  });
  await submitCompletedSession(session, {
    client: failing.client,
    readState: () => state as never,
    writeState: (_id, next) => {
      state = next;
    },
    ownerUserId: "usr_1",
    now: () => session.finishedAt + 1_000,
  });

  const queued = await loadPendingQueue();
  assert.equal(queued.length, 1, "the failed submission did not queue");

  __resetInFlight();
  const retrying = recordingClient(async (req) => ({
    verification: {
      sessionId: req.sessionId,
      status: "verified" as const,
      distanceMeters: 431,
      durationSeconds: 180,
      traversedHexIds: [] as string[],
      rejectionReasons: [] as string[],
      verifiedAt: "2026-09-02T21:00:00.000Z",
    },
    replayed: false,
  }));
  await retryVerification(session.clientSessionId, {
    client: retrying.client,
    writeState: () => {},
    ownerUserId: "usr_1",
    now: () => session.finishedAt + 120_000,
    manual: true,
  } as never);

  assert.equal(retrying.requests.length, 1, "the retry did not send a request");
  return retrying.requests[0];
}

test("a retry sends the metadata the session was stamped with, not today's defaults", async () => {
  /* The mutation this exists to catch: `runPending` rebuilding the session
     block from the current mode and the current rules version. That would
     reinterpret a session captured under older rules after an app update, and
     it passed every earlier test in this file. */
  const original = finishedSession();
  const request = await queueThenRetry(original);
  assert.deepEqual(request.session, original.session);
  assert.equal(request.sessionId, ID, "the retry must reuse the original id");
});

test("a retry of a legacy session sends no metadata rather than inventing some", async () => {
  const legacy = finishedSession({ session: undefined });
  const request = await queueThenRetry(legacy);
  assert.equal(
    request.session,
    undefined,
    "a session captured before the model must not be stamped with today's values",
  );
});

test("the original submission sends the session's own metadata too", async () => {
  __resetInFlight();
  memoryQueue();
  const session = finishedSession();
  const spy = recordingClient(async (req) => ({
    verification: {
      sessionId: req.sessionId,
      status: "verified" as const,
      distanceMeters: 431,
      durationSeconds: 180,
      traversedHexIds: [] as string[],
      rejectionReasons: [] as string[],
      verifiedAt: "2026-09-02T21:00:00.000Z",
    },
    replayed: false,
  }));
  await submitCompletedSession(session, {
    client: spy.client,
    readState: () => ({ kind: "local" }) as never,
    writeState: () => {},
    ownerUserId: "usr_1",
    now: () => session.finishedAt + 1_000,
  });
  assert.equal(spy.requests.length, 1);
  assert.deepEqual(spy.requests[0].session, session.session);
});

/* ── a pause is not a tracking gap ────────────────────────────────────────── */

test("backgrounding records a tracking gap and never a pause", () => {
  /* These mean opposite things. A gap says "we lost your data, the distance is
     a floor"; a pause says "you chose to stop, nothing was missed". Turning a
     gap into a pause would silence a data-loss warning in the direction that
     flatters the app.

     This guard did not exist, and a mutation that replaced `recordGap` with a
     pause/resume pair passed the entire suite. The AppState handler is scanned
     directly, because that is the one place the substitution would be made. */
  const screen = code(join(APP, "move", "session.tsx"));
  const start = screen.indexOf('AppState.addEventListener');
  assert.ok(start > 0, "the AppState handler is gone — this guard lost its subject");
  const handler = screen.slice(start, screen.indexOf("return () => sub.remove();", start));

  assert.match(handler, /recordGap\(gapsRef\.current/, "backgrounding must record a gap");
  for (const forbidden of ["pauseLifecycle", "resumeLifecycle", "openPauseAt", "pauses"]) {
    assert.ok(
      !new RegExp(`\\b${forbidden}\\b`).test(handler),
      `the AppState handler reaches for ${forbidden} — a gap is not a pause`,
    );
  }
});

test("pausing records no tracking gap, and the two lists stay separate", () => {
  /* The other direction: a user pause must not raise the "your distance is
     incomplete" notice, because nothing was missed. */
  const screen = code(join(APP, "move", "session.tsx"));
  const start = screen.indexOf("const togglePause = useCallback(");
  assert.ok(start > 0, "togglePause is gone — this guard lost its subject");
  const body = screen.slice(start, screen.indexOf("const finish = useCallback(", start));
  assert.ok(!/recordGap|gapsRef/.test(body), "pausing must not record a tracking gap");
});

test("a session can carry both a pause and a gap, and neither erases the other", () => {
  /* The evidence keeps them in different places entirely: pauses live in the
     session metadata, gaps in `gaps`. A session that was paused once and
     backgrounded once reports both. */
  const session = finishedSession({
    session: {
      mode: DEFAULT_MOVEMENT_MODE,
      rulesVersion: SESSION_RULES_VERSION,
      startedAt: T0,
      finishedAt: T0 + 600_000,
      pauses: [{ startedAt: T0 + 100_000, endedAt: T0 + 160_000 }],
    },
    gaps: [{ startedAt: T0 + 300_000, endedAt: T0 + 320_000 }],
  });
  assert.equal(session.session?.pauses.length, 1);
  assert.equal(session.gaps?.length, 1);
  /* And they describe different spans — one is not the other relabelled. */
  assert.notEqual(session.session!.pauses[0].startedAt, session.gaps![0].startedAt);
});

/* ── demo sessions stay out ───────────────────────────────────────────────── */

test("a demo session is not verifiable and never reaches the queue", () => {
  const demo = finishedSession({ mode: "demo" });
  /* The submission gate is `isVerifiable`, and mode `demo` fails it before any
     request is built — so a demo route never consumes a server idempotency key
     and never writes coordinates to disk. */
  const submitPath = code(join(SRC, "services", "verifySession.ts"));
  assert.match(submitPath, /isVerifiable\(\{/);
  assert.match(submitPath, /mode: session\.mode/);
  assert.equal(demo.mode, "demo");
});

test("the demo tracker is anchored to a fixed synthetic place, not the user", () => {
  const tracker = code(join(SRC, "services", "moveTracker.ts"));
  assert.match(tracker, /class DemoTracker/);
  assert.ok(
    !/getCurrentPosition|getLastKnownPosition/.test(tracker.slice(tracker.indexOf("class DemoTracker"))),
    "the demo route must not be seeded from the user's real location",
  );
});

/* ── the save threshold is unchanged ──────────────────────────────────────── */

test("the baseline save threshold is exactly what it was — eligibility is a later PR", () => {
  /* V3 contemplates 10 minutes and 750 metres. That is the Session Eligibility
     PR's rule, not this one's, and smuggling it in here would change who earns
     what while claiming to be a model refactor. This asserts the CURRENT
     product behaviour, and is deliberately not a statement about the final
     rule. */
  assert.equal(isSaveable(200, 0), true, "200 m alone still saves");
  assert.equal(isSaveable(0, 5 * 60_000), true, "five minutes alone still saves");
  assert.equal(isSaveable(199, 5 * 60_000 - 1), false);
  assert.equal(isSaveable(0, 0), false);

  /* And the V3 numbers are NOT in force. */
  assert.equal(isSaveable(300, 0), true, "a 300 m session must still save — 750 m is not the rule yet");
  assert.equal(isSaveable(0, 6 * 60_000), true, "six minutes must still save — 10 minutes is not the rule yet");
});

test("no eligibility rule from the later PR has been introduced anywhere", () => {
  /* The specific numbers V3 names, scanned in the files that decide whether a
     session counts. A constant like `750` or `10 * 60_000` appearing here
     would be this PR quietly becoming the eligibility PR. */
  for (const file of [
    join(SRC, "services", "moveSession.ts"),
    join(SRC, "lib", "movementVerification.ts"),
    join(SRC, "lib", "sessionLifecycle.ts"),
    join(APP, "move", "summary.tsx"),
  ]) {
    const src = code(file);
    assert.ok(!/\b750\b/.test(src), `${file} mentions 750 — the V3 distance threshold`);
    assert.ok(!/\bmergeWindow|antiSplit|scoringSession|qualifying/i.test(src), `${file} implements eligibility`);
  }
});

/* ── nothing internal reaches the screen ──────────────────────────────────── */

test("no screen renders a session id or a rules version", () => {
  for (const file of [
    join(APP, "move", "session.tsx"),
    join(APP, "move", "summary.tsx"),
    join(APP, "move", "captured.tsx"),
  ]) {
    const src = read(file);
    assert.ok(
      !/<Text[^>]*>\s*\{[^}]*clientSessionId[^}]*\}/.test(src),
      `${file} renders a session id`,
    );
    assert.ok(
      !/<Text[^>]*>\s*\{[^}]*rulesVersion[^}]*\}/.test(src),
      `${file} renders a rules version`,
    );
    /* The blanket ban this used to be became wrong when the sealing preview
       started needing the session's rules version to know which rules to read.
       The invariant was never "the identifier is absent" — it was "the player
       never sees it" — so the guard checks that instead: a rules version may be
       passed to a function, and may not appear anywhere inside rendered JSX. */
    for (const rendered of src.match(/>[^<>]*</g) ?? []) {
      assert.ok(
        !/rulesVersion|clientSessionId/.test(rendered),
        `${file} renders a session id or rules version: ${rendered.trim()}`,
      );
    }
  }
});

test("the movement path logs nothing", () => {
  /* Session metadata travels with route observations, so any sink on this path
     is a sink for location-adjacent data. The scan is scoped to the files that
     actually handle a session. */
  for (const file of [
    join(SRC, "lib", "sessionLifecycle.ts"),
    join(SRC, "lib", "movementVerification.ts"),
    join(SRC, "lib", "pendingVerification.ts"),
    join(SRC, "services", "verifySession.ts"),
    join(SRC, "services", "movementApi.ts"),
    join(APP, "move", "session.tsx"),
  ]) {
    const src = code(file);
    for (const sink of [/\bconsole\s*\./, /\banalytics\b/i, /\bSentry\b/, /\btrack\s*\(/]) {
      assert.ok(!sink.test(src), `${file} reaches a logging or analytics sink (${sink})`);
    }
  }
});

test("the log scan can see a log, so an empty result means something", () => {
  const src = read(join(SRC, "lib", "sessionLifecycle.ts"));
  assert.ok(src.length > 500);
  assert.ok(/\bconsole\s*\./.test(`${src}\nconsole.log(lifecycle);`), "the scanner is blind");
});

test("no pause or lifecycle timestamp reaches durable local history", () => {
  const store = code(join(SRC, "store", "useGameStore.ts"));
  for (const forbidden of ["pauses", "openPauseAt", "startedAt", "rulesVersion", "movementMode"]) {
    assert.ok(
      !new RegExp(`\\b${forbidden}\\b`).test(store),
      `the persisted game store grew ${forbidden}`,
    );
  }
});

/* ── one submission path ──────────────────────────────────────────────────── */

test("there is exactly one place a session is submitted", () => {
  const offenders: string[] = [];
  for (const file of [
    join(APP, "move", "summary.tsx"),
    join(APP, "move", "session.tsx"),
    join(SRC, "hooks", "useVerificationRetry.ts"),
  ]) {
    if (/\.submit\(/.test(code(file))) offenders.push(file);
  }
  assert.deepEqual(offenders, [], "a screen calls the movement client directly");
  assert.match(code(join(SRC, "services", "verifySession.ts")), /deps\.client\s*\n?\s*\.submit\(request\)/);
});

test("the finished session is built once, at Finish, from the lifecycle", () => {
  const screen = code(join(APP, "move", "session.tsx"));
  const calls = screen.match(/setLastSession\(/g) ?? [];
  assert.equal(calls.length, 1, "a session must be materialised exactly once");
  assert.match(screen, /session: metadata,/, "the finished session carries its provenance");
});

test("the tracker is started once, from a source that cannot change under it", () => {
  const screen = code(join(APP, "move", "session.tsx"));

  /* One subscription for the life of the screen. */
  assert.equal((screen.match(/createTracker\(/g) ?? []).length, 1, "one tracker, one session");
  assert.match(screen, /createTracker\(evidenceSourceRef\.current\)/);

  /* The start effect's dependency list, checked because the failure it
     prevents is silent: a dependency that can change would run the cleanup —
     stopping the tracker — and the re-run would then be turned away by
     `requestStart`'s single-flight guard, leaving a session that still reads
     as active with nothing capturing it. */
  const deps = screen.match(/tracker\.stop\(\);[\s\S]*?\};\s*\},\s*\[([^\]]*)\]\);/);
  assert.ok(deps, "the start effect's dependency list was not found");
  assert.equal(
    deps![1].trim(),
    "apply",
    "the start effect depends on a value that can change under a live session",
  );

  /* And the finished session records the source that actually produced the
     points, rather than whatever the render scope happens to hold at Finish. */
  assert.match(screen, /mode: evidenceSourceRef\.current,/);
});
