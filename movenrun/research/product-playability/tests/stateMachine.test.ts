/**
 * The capture lifecycle, exhaustively: every state against every event,
 * through the real machine in mobile/src/lib/sessionLifecycle.ts.
 *
 * The table this produces is the one in SESSION_STATE_MACHINE.md; the test
 * pins it so the document cannot drift from the code.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  finish, idleLifecycle, pause, requestStart, resume, sessionMetadata, trackerFailed, trackerStarted,
  activeMsSoFar, type SessionLifecycle, type CaptureState,
} from "../../../mobile/src/lib/sessionLifecycle";
import { CAPTURE_TABLE, reach } from "../state-machine/captureTable";

const EVENTS = {
  requestStart: (l: SessionLifecycle) => requestStart(l),
  trackerStarted: (l: SessionLifecycle) => trackerStarted(l, { clientSessionId: "synthetic-0001", at: 2_000 }),
  trackerFailed: (l: SessionLifecycle) => trackerFailed(l),
  pause: (l: SessionLifecycle) => pause(l, 3_000),
  resume: (l: SessionLifecycle) => resume(l, 4_000),
  finish: (l: SessionLifecycle) => finish(l, 5_000),
} as const;

test("the documented transition table matches the machine for every state x event", () => {
  for (const row of CAPTURE_TABLE) {
    const from = reach(row.from);
    const result = EVENTS[row.event](from);
    assert.equal(result.outcome, row.outcome, `${row.from} --${row.event}--> outcome`);
    assert.equal(result.lifecycle.state, row.to, `${row.from} --${row.event}--> state`);
  }
  const states: CaptureState[] = ["idle", "starting", "active", "paused", "finished"];
  assert.equal(CAPTURE_TABLE.length, states.length * Object.keys(EVENTS).length, "table is exhaustive");
});

test("double Finish yields one finished session; metadata is stable", () => {
  const once = finish(reach("active"), 5_000);
  const twice = finish(once.lifecycle, 9_000);
  assert.equal(twice.outcome, "ignored");
  assert.deepEqual(sessionMetadata(twice.lifecycle), sessionMetadata(once.lifecycle));
});

test("rapid Pause/Resume taps never open overlapping pauses", () => {
  let l = reach("active");
  const taps = [pause, pause, resume, resume, pause, resume];
  let t = 2_100;
  for (const tap of taps) { l = tap(l, (t += 100)).lifecycle; }
  for (let i = 1; i < l.pauses.length; i++) assert.ok(l.pauses[i]!.startedAt >= l.pauses[i - 1]!.endedAt);
  assert.equal(l.pauses.length, 2);
});

test("a failed start burns nothing: no id, no start time", () => {
  const failed = trackerFailed(requestStart(idleLifecycle()).lifecycle).lifecycle;
  assert.equal(failed.state, "idle");
  assert.equal(failed.clientSessionId, null);
  assert.equal(failed.startedAt, null);
});

test("FINDING MR-A-03: active time is wall-clock arithmetic, so a clock jump changes Save eligibility", () => {
  const l = trackerStarted(requestStart(idleLifecycle()).lifecycle, { clientSessionId: "synthetic-0002", at: 0 }).lifecycle;
  // Two real minutes, then the phone clock is moved forward one hour before Finish.
  const finished = finish(l, 120_000 + 3_600_000).lifecycle;
  assert.equal(activeMsSoFar(finished, 0), 3_720_000);
});
