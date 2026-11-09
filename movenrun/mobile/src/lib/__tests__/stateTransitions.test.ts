/**
 * The capture lifecycle and the verification state, checked against their
 * transition tables.
 *
 * Each table is the single written answer to "where can this go from here".
 * These tests prove the code agrees with it in both directions: every move the
 * functions make is an edge in the table, and every edge in the table is a
 * move some function makes. A table that drifted from the code would fail one
 * side or the other.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { canTransition, statesOf, terminalStates } from "@movenrun/shared/state-machine";
import {
  CAPTURE_TRANSITIONS,
  finish,
  idleLifecycle,
  pause,
  requestStart,
  resume,
  trackerFailed,
  trackerStarted,
  type CaptureState,
  type SessionLifecycle,
  type Transition,
} from "../sessionLifecycle";
import {
  canMoveVerification,
  VERIFICATION_TRANSITIONS,
  type VerificationKind,
  type VerificationState,
} from "../movementVerification";
import {
  clearLastSession,
  getVerificationState,
  setLastSession,
  setVerificationState,
  subscribeVerification,
  type FinishedSession,
} from "../../services/moveSession";
import { __resetInFlight, submitCompletedSession } from "../../services/verifySession";
import { MovementApiError } from "../../services/movementApi";

/* ── capture lifecycle ────────────────────────────────────────────────────── */

function lifecycleIn(state: CaptureState): SessionLifecycle {
  let l = idleLifecycle();
  if (state === "idle") return l;
  l = requestStart(l).lifecycle;
  if (state === "starting") return l;
  l = trackerStarted(l, { clientSessionId: "s-1", at: 1_000 }).lifecycle;
  if (state === "active") return l;
  if (state === "paused") return pause(l, 2_000).lifecycle;
  return finish(l, 3_000).lifecycle;
}

const EVENTS: Record<string, (l: SessionLifecycle) => Transition> = {
  requestStart: (l) => requestStart(l),
  trackerStarted: (l) => trackerStarted(l, { clientSessionId: "s-2", at: 5_000 }),
  trackerFailed: (l) => trackerFailed(l),
  pause: (l) => pause(l, 6_000),
  resume: (l) => resume(l, 7_000),
  finish: (l) => finish(l, 8_000),
};

test("every move the capture functions make is an edge of CAPTURE_TRANSITIONS, and every edge is made", () => {
  const made = new Set<string>();
  for (const from of statesOf(CAPTURE_TRANSITIONS)) {
    const start = lifecycleIn(from);
    assert.equal(start.state, from, `fixture for ${from}`);
    for (const [name, event] of Object.entries(EVENTS)) {
      const { lifecycle, outcome } = event(start);
      if (outcome === "ok") {
        assert.ok(
          canTransition(CAPTURE_TRANSITIONS, from, lifecycle.state),
          `${name} moved ${from} -> ${lifecycle.state}, which is not in the table`,
        );
        made.add(`${from}->${lifecycle.state}`);
      } else {
        assert.equal(lifecycle, start, `${name} from ${from} is ${outcome} and must leave the lifecycle untouched`);
      }
    }
  }
  const edges = statesOf(CAPTURE_TRANSITIONS).flatMap((from) =>
    CAPTURE_TRANSITIONS[from].map((to) => `${from}->${to}`));
  assert.deepEqual([...made].sort(), edges.sort(), "the table lists no edge the code cannot make");
});

test("finished is the only terminal capture state", () => {
  assert.deepEqual(terminalStates(CAPTURE_TRANSITIONS), ["finished"]);
});

/* ── verification state ───────────────────────────────────────────────────── */

const SAMPLE: Record<VerificationKind, VerificationState> = {
  local: { kind: "local" },
  submitting: { kind: "submitting" },
  verified: { kind: "verified", distanceMeters: 1200, durationSeconds: 600, traversedHexIds: [] },
  rejected: { kind: "rejected", reasons: ["too_fast"] },
  pending: { kind: "pending", reason: "offline" },
};

test("the verification table: a verdict is final and nothing moves back to local", () => {
  assert.deepEqual(terminalStates(VERIFICATION_TRANSITIONS).sort(), ["rejected", "verified"]);
  assert.equal(canMoveVerification(SAMPLE.verified, SAMPLE.pending), false);
  assert.equal(canMoveVerification(SAMPLE.rejected, SAMPLE.submitting), false);
  assert.equal(canMoveVerification(SAMPLE.local, SAMPLE.verified), false, "no verdict without a request");
  assert.equal(canMoveVerification(SAMPLE.pending, SAMPLE.submitting), true, "a retry may start");
  assert.equal(canMoveVerification(SAMPLE.submitting, SAMPLE.local), false);
});

test("the real pipeline through the guarded store: local -> submitting -> pending -> submitting -> verified", async () => {
  __resetInFlight();
  const session = {
    clientSessionId: "v-pipe",
    mode: "gps",
    points: Array.from({ length: 4 }, (_, i) => ({
      latitude: 51.5 + i * 0.0009, longitude: -0.12, timestamp: 1_700_000_000_000 + i * 60_000, accuracy: 6,
    })),
    distanceM: 420,
    durationMs: 300_000,
    finishedAt: 1_700_000_300_000,
  } as unknown as FinishedSession;
  setLastSession(session);
  const seen: string[] = [getVerificationState().kind];
  const unsubscribe = subscribeVerification(() => seen.push(getVerificationState().kind));
  let attempt = 0;
  const client = {
    submit: async () => {
      attempt += 1;
      if (attempt === 1) throw new MovementApiError("network_unavailable", 0, "service_unavailable");
      return {
        verification: {
          sessionId: "v-pipe", status: "verified", distanceMeters: 431, durationSeconds: 300,
          traversedHexIds: [], rejectionReasons: [], verifiedAt: "2026-08-20T21:00:00.000Z",
        },
      };
    },
  } as never;
  const deps = { client, readState: getVerificationState, writeState: setVerificationState };
  assert.equal((await submitCompletedSession(session, deps)).kind, "pending");
  assert.equal((await submitCompletedSession(session, deps)).kind, "verified");
  unsubscribe();
  assert.deepEqual(seen, ["local", "submitting", "pending", "submitting", "verified"]);
  for (let i = 1; i < seen.length; i++) {
    assert.ok(canTransition(VERIFICATION_TRANSITIONS, seen[i - 1] as VerificationKind, seen[i] as VerificationKind));
  }
  clearLastSession();
});

function heldSession(id: string): FinishedSession {
  return {
    clientSessionId: id,
    mode: "gps",
    points: [],
    distanceM: 0,
    durationMs: 0,
  } as unknown as FinishedSession;
}

test("the held session follows the normal path local -> submitting -> verified", () => {
  setLastSession(heldSession("v-1"));
  assert.equal(getVerificationState().kind, "local");
  setVerificationState("v-1", SAMPLE.submitting);
  assert.equal(getVerificationState().kind, "submitting");
  setVerificationState("v-1", SAMPLE.verified);
  assert.equal(getVerificationState().kind, "verified");
  clearLastSession();
});

test("a failed attempt can be retried: submitting -> pending -> submitting -> rejected", () => {
  setLastSession(heldSession("v-2"));
  for (const next of [SAMPLE.submitting, SAMPLE.pending, SAMPLE.submitting, SAMPLE.rejected]) {
    setVerificationState("v-2", next);
    assert.equal(getVerificationState().kind, next.kind);
  }
  clearLastSession();
});

test("a late result cannot relabel a verified session as waiting", () => {
  setLastSession(heldSession("v-3"));
  setVerificationState("v-3", SAMPLE.submitting);
  setVerificationState("v-3", SAMPLE.verified);
  setVerificationState("v-3", SAMPLE.pending);
  setVerificationState("v-3", SAMPLE.submitting);
  assert.equal(getVerificationState().kind, "verified");
  clearLastSession();
});

test("a new session starts again from local", () => {
  setLastSession(heldSession("v-4"));
  setVerificationState("v-4", SAMPLE.submitting);
  setVerificationState("v-4", SAMPLE.rejected);
  setLastSession(heldSession("v-5"));
  assert.equal(getVerificationState().kind, "local");
  clearLastSession();
});
