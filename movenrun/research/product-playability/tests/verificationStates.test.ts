/**
 * Verification never shows a false green.
 *
 * Drives the real `submitCompletedSession` (mobile/src/services/verifySession.ts)
 * with a fake transport for each failure a free-tier backend produces: no
 * network, a cold-start timeout, 401/403, 404, 5xx, a malformed body, and a
 * slow success. Only a decoded verified verdict may become `verified`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MovementApiError, type MovementApiErrorKind } from "../../../mobile/src/services/movementApi";
import { submitCompletedSession, __resetInFlight } from "../../../mobile/src/services/verifySession";
import { setLastSession, getLastSession, clearLastSession, type FinishedSession } from "../../../mobile/src/services/moveSession";
import { INITIAL_VERIFICATION, type VerificationState } from "../../../mobile/src/lib/movementVerification";
import { invalidateVerificationPrivacy } from "../../../mobile/src/services/verificationPrivacy";
import { installVerificationQueueStore, loadPendingQueue } from "../../../mobile/src/services/verificationQueue";
import { fixtureById } from "../synthetic-routes/fixtures";
import { runClient } from "../synthetic-routes/clientPipeline";

function finishedFromFixture(id: string, clientSessionId: string): FinishedSession {
  const c = runClient(fixtureById(id).scenario);
  return {
    clientSessionId, mode: "gps", session: c.metadata!, points: c.points, evidenceStatus: c.evidenceStatus!,
    distanceM: c.distanceM, durationMs: c.durationMs, finishedAt: c.metadata!.finishedAt, gaps: c.gaps,
  };
}

function memoryQueue() {
  const memory = new Map<string, string>();
  installVerificationQueueStore({
    getItem: async (k) => memory.get(k) ?? null,
    setItem: async (k, v) => { memory.set(k, v); },
    removeItem: async (k) => { memory.delete(k); },
  });
}

const FAILURES: MovementApiErrorKind[] = ["network_unavailable", "timeout", "unauthorized", "forbidden", "not_found", "invalid_request", "server_error", "malformed_response"];

for (const kind of FAILURES) {
  test(`${kind}: the session is never shown verified and the workout is kept`, async () => {
    __resetInFlight(); memoryQueue();
    const session = finishedFromFixture("W02-walk-300m", `synthetic-${kind}`.slice(0, 40));
    setLastSession(session);
    let state: VerificationState = INITIAL_VERIFICATION;
    const seen: string[] = [];
    const result = await submitCompletedSession(session, {
      client: { submit: async () => { throw new MovementApiError(kind, 0, kind); } } as never,
      readState: () => state, writeState: (_id, next) => { state = next; seen.push(next.kind); }, ownerUserId: "synthetic-owner",
    });
    assert.notEqual(result.kind, "verified");
    assert.ok(!seen.includes("verified"));
    assert.equal(getLastSession(), session, "a failed verification never erases the completed workout");
    const queue = await loadPendingQueue();
    // Retryable failures and an expired sign-in (auth_blocked, retried after the
    // same account signs in again) keep the route; terminal verdicts delete it.
    const kept = ["network_unavailable", "timeout", "server_error", "unauthorized", "forbidden"].includes(kind);
    assert.equal(queue.length, kept ? 1 : 0, "terminal failures delete the route from the device");
  });
}

test("cold start: a slow success shows submitting, then verified, and nothing earlier", async () => {
  __resetInFlight(); memoryQueue();
  const session = finishedFromFixture("W02-walk-300m", "synthetic-coldstart");
  setLastSession(session);
  let state: VerificationState = INITIAL_VERIFICATION;
  const seen: string[] = [];
  const result = await submitCompletedSession(session, {
    client: { submit: () => new Promise((resolve) => setTimeout(() => resolve({ verification: {
      sessionId: "synthetic-coldstart", status: "verified", distanceMeters: 290, durationSeconds: 208,
      traversedHexIds: [], rejectionReasons: [], verifiedAt: new Date(0).toISOString(), sealed: false } } as never), 50)) } as never,
    readState: () => state, writeState: (_id, next) => { state = next; seen.push(next.kind); }, ownerUserId: "synthetic-owner",
  });
  assert.deepEqual(seen, ["submitting", "verified"]);
  assert.equal(result.kind, "verified");
});

test("duplicate taps and remounts send one request", async () => {
  __resetInFlight(); memoryQueue();
  const session = finishedFromFixture("W02-walk-300m", "synthetic-doubletap");
  setLastSession(session);
  let state: VerificationState = INITIAL_VERIFICATION;
  let calls = 0;
  const deps = {
    client: { submit: async () => { calls += 1; await new Promise((r) => setTimeout(r, 20)); return { verification: {
      sessionId: "synthetic-doubletap", status: "verified", distanceMeters: 290, durationSeconds: 208,
      traversedHexIds: [], rejectionReasons: [], verifiedAt: new Date(0).toISOString() } }; } } as never,
    readState: () => state, writeState: (_id: string, next: VerificationState) => { state = next; }, ownerUserId: "synthetic-owner",
  };
  await Promise.all([submitCompletedSession(session, deps), submitCompletedSession(session, deps), submitCompletedSession(session, deps)]);
  assert.equal(calls, 1);
});

test("sign-out mid-flight: the late verdict is not written and the route is erased", async () => {
  __resetInFlight(); memoryQueue();
  const session = finishedFromFixture("W02-walk-300m", "synthetic-signout");
  setLastSession(session);
  let state: VerificationState = INITIAL_VERIFICATION;
  const seen: string[] = [];
  const pending = submitCompletedSession(session, {
    client: { submit: () => new Promise((resolve) => setTimeout(() => resolve({ verification: {
      sessionId: "synthetic-signout", status: "verified", distanceMeters: 290, durationSeconds: 208,
      traversedHexIds: [], rejectionReasons: [], verifiedAt: new Date(0).toISOString() } } as never), 30)) } as never,
    readState: () => state, writeState: (_id, next) => { state = next; seen.push(next.kind); }, ownerUserId: "synthetic-owner",
  });
  invalidateVerificationPrivacy(); // what sign-out / account switch calls
  await pending;
  assert.ok(!seen.includes("verified"), "a previous account's verdict never lands");
  assert.equal(getLastSession(), null, "the in-memory route is erased with the account");
  clearLastSession();
});
