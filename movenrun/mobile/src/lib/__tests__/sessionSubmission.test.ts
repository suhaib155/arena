/**
 * Completed-session submission — identity, boundary, and the completion/
 * verification separation.
 *
 * The invariant under test: one real completed foreground session has one
 * stable identity, makes one logical verification submission, and remains a
 * completed workout whatever the server says or fails to say.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  CLIENT_SESSION_ID_RE,
  INITIAL_VERIFICATION,
  UNKNOWN_ACCURACY_M,
  isVerifiable,
  newClientSessionId,
  shouldSubmit,
  toObservations,
  type VerificationState,
} from "../movementVerification";
import {
  submitCompletedSession,
  pendingReasonFor,
  __resetInFlight,
} from "@/services/verifySession";
import { MovementApiError } from "@/services/movementApi";
import type { FinishedSession } from "@/services/moveSession";
import type { TrackPoint } from "../geo";

const APP = join(process.cwd(), "app");
const SRC = join(process.cwd(), "src");
const read = (p: string) => readFileSync(p, "utf8");

const START = 1_700_000_000_000;

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
    clientSessionId: "mv-test-session-0001",
    mode: "gps",
    points: points(),
    distanceM: 420,
    durationMs: 300_000,
    finishedAt: START + 300_000,
    ...over,
  };
}

/** A state cell that behaves like moveSession's, including id addressing. */
function stateCell(id: string) {
  let current: VerificationState = INITIAL_VERIFICATION;
  const writes: VerificationState[] = [];
  return {
    writes,
    readState: () => current,
    writeState: (sessionId: string, next: VerificationState) => {
      if (sessionId !== id) return;
      current = next;
      writes.push(next);
    },
    get current() {
      return current;
    },
  };
}

function fakeClient(impl: (req: unknown) => Promise<unknown>) {
  const requests: any[] = [];
  return {
    calls: () => requests.length,
    requests,
    client: {
      submit: async (req: unknown) => {
        requests.push(req);
        return impl(req) as never;
      },
    } as never,
  };
}

const verifiedReply = {
  verification: {
    sessionId: "mv-test-session-0001",
    status: "verified" as const,
    distanceMeters: 431,
    durationSeconds: 300,
    traversedHexIds: ["8a1fb46622dffff", "8a1fb46622d7fff"],
    rejectionReasons: [] as string[],
    verifiedAt: "2026-08-20T21:00:00.000Z",
  },
  replayed: false,
};

/* ── stable identity ──────────────────────────────────────────────────────── */

test("a minted session id satisfies the backend's accepted format", () => {
  for (let i = 0; i < 200; i++) {
    const id = newClientSessionId();
    assert.match(id, CLIENT_SESSION_ID_RE, `${id} would be rejected as a 400`);
  }
});

test("ids are distinct across sessions and carry no location", () => {
  const ids = new Set(Array.from({ length: 500 }, () => newClientSessionId()));
  assert.equal(ids.size, 500, "session ids collided");
  const id = newClientSessionId(START, () => 0.5);
  assert.ok(!id.includes("51.5"), "an id must not encode a coordinate");
  assert.ok(!id.includes("-0.12"), "an id must not encode a coordinate");
});

test("the id is minted at session start, not at finish, save, or per attempt", () => {
  const screen = read(join(APP, "move", "session.tsx"));

  /* Exactly one mint site in the whole screen, held in a ref, and consumed by
     the finished-session hand-off. Asserted as intent rather than as one exact
     spelling, so the idiom can change without the guard going quiet — what may
     not change is that it happens once, at the top of the component. */
  const mints = screen.match(/newClientSessionId\(/g) ?? [];
  assert.equal(mints.length, 1, "a session must mint exactly one id");

  /* The mint must be ONCE-ONLY, not merely once in the source.
     This guard has now been wrong twice, in opposite directions. It first
     accepted a bare `clientSessionIdRef.current = newClientSessionId()` — what
     an unconditional per-render re-mint looks like — because it checked the
     assignment's shape and never its condition. It was then repaired by
     pinning two exact spellings, which made it fail the moment the mint moved
     into the lifecycle transition where it belongs, for a reason that had
     nothing to do with re-minting.

     So it now asserts the property instead of any spelling: the id is minted
     as the argument to `trackerStarted`, a transition the pure machine accepts
     only from `starting`. A render cannot reach it, because a render does not
     transition; a second Start is `ignored` before the mint is evaluated. The
     once-only behaviour itself is proven directly in sessionLifecycle.test.ts,
     against the machine rather than against this file's text. */
  assert.match(
    screen,
    /trackerStarted\(lifecycleRef\.current, \{\s*clientSessionId: newClientSessionId\(\)/,
    "the id must be minted at the start transition, which only fires once per session",
  );
  assert.match(screen, /clientSessionId: id,/, "the finished session carries the minted id");

  /* And crucially NOT inside finish() — minting there would tie identity to
     the end of the session rather than the whole of it. */
  const finishStart = screen.indexOf("const finish = useCallback(");
  assert.ok(finishStart > 0, "finish() not found — this guard needs updating");
  const afterFinish = screen.slice(finishStart);
  const finishBody = afterFinish.slice(0, afterFinish.indexOf("const quit"));
  assert.ok(
    !/newClientSessionId\(/.test(finishBody),
    "the id must not be minted at finish — it identifies the session, not its end",
  );

  // And nowhere downstream may mint one.
  for (const file of [
    join(APP, "move", "summary.tsx"),
    join(SRC, "services", "verifySession.ts"),
    join(SRC, "services", "movementApi.ts"),
    join(SRC, "services", "authedTransport.ts"),
  ]) {
    assert.ok(
      !/newClientSessionId\(/.test(read(file)),
      `${file} mints a session id — retries would stop being idempotent`,
    );
  }
});

test("the movement client rides the shared authenticated transport", () => {
  /* There was no guard on this at all on the mobile side. A screen that built
     its own transport would get a second bearer attachment and a second
     refresh slot, and every submission test would still pass — they inject
     their own transport and never look at the screen. */
  const summary = read(join(APP, "move", "summary.tsx"));
  assert.match(
    summary,
    /new MovementApiClient\(\s*identityClient\.transport\s*\)/,
    "summary must construct the movement client from the identity client's transport",
  );
  assert.ok(
    !/new AuthedJsonTransport\(/.test(summary),
    "no screen may construct its own transport",
  );
  // And no other screen may build a movement client at all.
  const screens = readdirSync(join(APP, "move")).filter((f) => f.endsWith(".tsx"));
  for (const file of screens) {
    if (file === "summary.tsx") continue;
    assert.ok(
      !/new MovementApiClient\(/.test(read(join(APP, "move", file))),
      `${file} builds its own movement client — there must be one submission path`,
    );
  }
});

test("the same id is reused across a failure and a later attempt", async () => {
  __resetInFlight();
  const s = session();
  const cell = stateCell(s.clientSessionId);
  let attempt = 0;
  const offline = fakeClient(async () => {
    attempt += 1;
    if (attempt === 1) throw new MovementApiError("network_unavailable", 0, "service_unavailable");
    return verifiedReply;
  });

  const first = await submitCompletedSession(s, { client: offline.client, ...cell });
  assert.deepEqual(first, { kind: "pending", reason: "offline" });

  const second = await submitCompletedSession(s, { client: offline.client, ...cell });
  assert.equal(second.kind, "verified");

  assert.equal(offline.requests.length, 2);
  assert.equal(offline.requests[0].sessionId, offline.requests[1].sessionId);
  assert.equal(offline.requests[0].sessionId, s.clientSessionId);
});

/* ── the submission boundary ──────────────────────────────────────────────── */

test("an unfinished, demo, or too-short session is never verifiable", () => {
  const base = { mode: "gps", finished: true, saveable: true, points: [1, 2] };
  assert.ok(isVerifiable(base));
  assert.ok(!isVerifiable({ ...base, finished: false }), "an active session must not submit");
  assert.ok(!isVerifiable({ ...base, mode: "demo" }), "a demo session is not real movement");
  assert.ok(!isVerifiable({ ...base, saveable: false }), "a junk-short session must not upload GPS");
  assert.ok(!isVerifiable({ ...base, points: [1] }), "one point cannot be measured");
});

test("an ineligible session makes no request at all", async () => {
  for (const over of [
    { mode: "demo" as const },
    { distanceM: 10, durationMs: 1_000 },
    { points: [points()[0]] },
  ]) {
    __resetInFlight();
    const s = session(over);
    const cell = stateCell(s.clientSessionId);
    const spy = fakeClient(async () => verifiedReply);
    await submitCompletedSession(s, { client: spy.client, ...cell });
    assert.equal(spy.calls(), 0, `an ineligible session was uploaded: ${JSON.stringify(over)}`);
    assert.equal(cell.current.kind, "local");
  }
});

test("submission is bound to the deliberate save action, not to finishing or mounting", () => {
  const summary = read(join(APP, "move", "summary.tsx"));
  const sessionScreen = read(join(APP, "move", "session.tsx"));

  // The session screen finishes and navigates; it never uploads.
  assert.ok(
    !/submitCompletedSession/.test(sessionScreen),
    "finishing a session must not upload — saving is the user's deliberate act",
  );
  // The summary submits from save(), never from an effect that a mount,
  // re-render, or reopen would replay.
  assert.match(summary, /void submitCompletedSession\(/);
  const effects = summary.match(/useEffect\(/g) ?? [];
  assert.deepEqual(effects, [], "no effect may trigger submission on mount or re-render");
});

/* ── one logical submission ───────────────────────────────────────────────── */

test("concurrent invocations share one in-flight request", async () => {
  __resetInFlight();
  const s = session();
  const cell = stateCell(s.clientSessionId);
  let release: (v: unknown) => void = () => {};
  const gate = new Promise((r) => {
    release = r;
  });
  const spy = fakeClient(async () => {
    await gate;
    return verifiedReply;
  });

  // Double tap / re-render / effect replay, all before the first resolves.
  const all = Promise.all([
    submitCompletedSession(s, { client: spy.client, ...cell }),
    submitCompletedSession(s, { client: spy.client, ...cell }),
    submitCompletedSession(s, { client: spy.client, ...cell }),
  ]);
  release(null);
  const results = await all;

  assert.equal(spy.calls(), 1, "one completed session must make one logical request");
  assert.equal(new Set(results.map((r) => r.kind)).size, 1);
  assert.equal(results[0].kind, "verified");
});

test("a settled session is not resubmitted", async () => {
  __resetInFlight();
  const s = session();
  const cell = stateCell(s.clientSessionId);
  const spy = fakeClient(async () => verifiedReply);

  await submitCompletedSession(s, { client: spy.client, ...cell });
  await submitCompletedSession(s, { client: spy.client, ...cell });
  await submitCompletedSession(s, { client: spy.client, ...cell });

  assert.equal(spy.calls(), 1, "a verified session must not be asked again");
  assert.ok(!shouldSubmit(cell.current));
});

test("state transitions are addressed by session id, so a late reply cannot mislabel", async () => {
  __resetInFlight();
  const s = session();
  // A cell that belongs to a DIFFERENT session — as it would after the user
  // started a new one while the old request was still in flight.
  const cell = stateCell("mv-some-other-session");
  const spy = fakeClient(async () => verifiedReply);
  await submitCompletedSession(s, { client: spy.client, ...cell });
  assert.equal(cell.current.kind, "local", "a stale reply must not label the current session");
});

/* ── failure semantics ────────────────────────────────────────────────────── */

test("every transport failure leaves the session pending, never verified", async () => {
  const cases: [MovementApiError, string][] = [
    [new MovementApiError("network_unavailable", 0, "service_unavailable"), "offline"],
    [new MovementApiError("timeout", 0, "request_timeout"), "timeout"],
    [new MovementApiError("unauthorized", 401, "unauthenticated"), "unauthenticated"],
    [new MovementApiError("forbidden", 403, "forbidden"), "unauthenticated"],
    [new MovementApiError("server_error", 500, "request_failed"), "server_error"],
    [new MovementApiError("malformed_response", 200, "malformed_response"), "malformed_response"],
  ];
  for (const [error, reason] of cases) {
    __resetInFlight();
    const s = session();
    const cell = stateCell(s.clientSessionId);
    const spy = fakeClient(async () => {
      throw error;
    });
    const result = await submitCompletedSession(s, { client: spy.client, ...cell });
    assert.deepEqual(result, { kind: "pending", reason }, `${error.kind} misclassified`);
    assert.notEqual(result.kind, "verified");
  }
  /* 4xx is kept apart from 5xx: the server having READ the request and refused
     it is a different fact from the server failing to answer, and the retry
     layer added in the offline-retry work has to tell them apart or it will
     resend a permanently invalid payload until its budget runs out. */
  assert.equal(pendingReasonFor(new MovementApiError("not_found", 404, "not_found")), "not_found");
  assert.equal(
    pendingReasonFor(new MovementApiError("invalid_request", 422, "invalid_request")),
    "invalid_request",
  );
});

test("an unknown thrown value still cannot produce verified state", async () => {
  __resetInFlight();
  const s = session();
  const cell = stateCell(s.clientSessionId);
  const spy = fakeClient(async () => {
    throw new Error("something entirely unexpected");
  });
  const result = await submitCompletedSession(s, { client: spy.client, ...cell });
  assert.equal(result.kind, "pending");
});

test("a server rejection is a domain result, and stays unverified", async () => {
  __resetInFlight();
  const s = session();
  const cell = stateCell(s.clientSessionId);
  const spy = fakeClient(async () => ({
    verification: {
      ...verifiedReply.verification,
      status: "rejected" as const,
      distanceMeters: null,
      traversedHexIds: [] as string[],
      rejectionReasons: ["Implausible speed at index 2"],
    },
    replayed: false,
  }));
  const result = await submitCompletedSession(s, { client: spy.client, ...cell });
  assert.deepEqual(result, { kind: "rejected", reasons: ["Implausible speed at index 2"] });
});

/* ── observations only ────────────────────────────────────────────────────── */

test("the request carries observations and no authority claim", async () => {
  __resetInFlight();
  const s = session();
  const cell = stateCell(s.clientSessionId);
  const spy = fakeClient(async () => verifiedReply);
  await submitCompletedSession(s, { client: spy.client, ...cell });

  const sent = spy.requests[0];
  assert.deepEqual(Object.keys(sent).sort(), ["endTime", "points", "sessionId", "startTime"]);
  for (const forbidden of [
    "userId", "walletAddress", "distanceMeters", "durationSeconds", "traversedHexIds",
    "capturedZones", "xp", "lockedMove", "trustScore", "verified", "status", "mode",
  ]) {
    assert.ok(!(forbidden in sent), `request leaked ${forbidden}`);
  }
  // The app's own display distance is never sent as a claim.
  assert.ok(!JSON.stringify(sent).includes("420"), "local display distance must not be submitted");
});

test("the session window contains every point, including after a pause", () => {
  // A paused session's duration is shorter than its wall-clock span, so
  // deriving start from finishedAt - durationMs would land after the first
  // point and the server would reject the payload.
  const pts = points(5);
  const obs = toObservations({ points: pts, durationMs: 60_000, finishedAt: START + 600_000 });
  for (const p of obs.points) {
    assert.ok(p.timestamp >= obs.startTime, "a point fell before the window");
    assert.ok(p.timestamp <= obs.endTime, "a point fell after the window");
  }
  assert.ok(obs.endTime > obs.startTime);
});

test("unknown accuracy is reported as the honest ceiling, never as perfect", () => {
  const obs = toObservations({
    points: [{ latitude: 51.5, longitude: -0.12, timestamp: START, accuracy: null }],
    durationMs: 1_000,
    finishedAt: START + 1_000,
  });
  assert.equal(obs.points[0].accuracy, UNKNOWN_ACCURACY_M);
  assert.notEqual(obs.points[0].accuracy, 0, "0 would claim a perfect fix we did not observe");
});

/* ── completion, XP and territory are untouched ───────────────────────────── */

test("the orchestrator never touches the game store, rewards, or zones", () => {
  const src = read(join(SRC, "services", "verifySession.ts"));
  for (const forbidden of [
    "useGameStore", "completeQuest", "captureZone", "defendZones", "newCapturedZone",
    "addRouteTrustRecord", "setRouteTrust", "xp", "lockedMove",
  ]) {
    assert.ok(
      !new RegExp(`\\b${forbidden}\\b`).test(src),
      `verification must not reach into ${forbidden} — it is not a reward authority`,
    );
  }
});

test("verified traversed hexes are never mapped onto territory", async () => {
  __resetInFlight();
  const s = session();
  const cell = stateCell(s.clientSessionId);
  const spy = fakeClient(async () => verifiedReply);
  const result = await submitCompletedSession(s, { client: spy.client, ...cell });

  assert.equal(result.kind, "verified");
  assert.ok(result.kind === "verified" && Array.isArray(result.traversedHexIds));
  // The state union has no capture/ownership shape at all.
  assert.ok(!("capturedZones" in result));
  assert.ok(!("ownedZones" in result));
  assert.ok(!("zones" in result));

  const src = read(join(SRC, "lib", "movementVerification.ts"));
  assert.ok(!/captured|owned|deed/i.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "")),
    "no capture/ownership vocabulary in the verification model's code");
});

test("saving still awards XP and captures locally exactly as before", () => {
  const summary = read(join(APP, "move", "summary.tsx"));
  // The pre-existing completion path is intact and unconditioned on verification.
  assert.match(summary, /completeQuest\(sessionQuest\)/);
  assert.match(summary, /captureZone\(newCapturedZone\(candidate, false\)\)/);
  assert.match(summary, /defendZones\(ownedTouched\.map/);
  // And none of it is gated on a verification result.
  assert.ok(
    !/if\s*\([^)]*verif[^)]*\)\s*\{[\s\S]{0,200}completeQuest/i.test(summary),
    "XP must not depend on server verification",
  );
  // Submission is fire-and-forget, so it cannot delay or block completion.
  assert.match(summary, /void submitCompletedSession\(/);
});

test("verification state is its own axis, not a flag on completion", () => {
  /* The invariant is that verification must never become a BIT ON completion,
     XP, or a zone — not that the word may not appear in the store. Task 4 adds
     a `movementVerifications` slice, which is the separation working rather
     than failing: its own list, awarding nothing. So this asserts the shape
     rather than banning an identifier. */
  const store = read(join(SRC, "store", "useGameStore.ts"));

  // Nothing on the completion outcome may carry a verdict.
  const outcome = store.slice(store.indexOf("interface CompletionOutcome"));
  const outcomeBody = outcome.slice(0, outcome.indexOf("}"));
  for (const leaked of ["verified", "verification", "clientSessionId"]) {
    assert.ok(
      !new RegExp(`\\b${leaked}`, "i").test(outcomeBody),
      `CompletionOutcome gained ${leaked} — completing a quest is not being verified`,
    );
  }

  // Nor may a zone.
  const types = read(join(SRC, "types.ts"));
  const zone = types.slice(types.indexOf("interface Zone"));
  const zoneBody = zone.slice(0, zone.indexOf("}"));
  for (const leaked of ["verified", "verification", "clientSessionId"]) {
    assert.ok(
      !new RegExp(`\\b${leaked}`, "i").test(zoneBody),
      `Zone gained ${leaked} — a zone is local simulation, not a server verdict`,
    );
  }

  // And the XP path must not read verification at all.
  const completeQuest = store.slice(store.indexOf("completeQuest: (quest)"));
  const questBody = completeQuest.slice(0, completeQuest.indexOf("captureZone:"));
  assert.ok(
    !/verif/i.test(questBody),
    "the XP award path reads verification state — reward authority has not moved",
  );
});
