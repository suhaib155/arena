/**
 * The capture lifecycle.
 *
 * The properties here used to be refs and booleans inside the movement screen,
 * where the only proof they held was reading the component carefully. A double
 * tap on Start, a replayed effect, a Finish pressed twice while a dialog
 * animated out — none of those were provable, and two of them were only
 * prevented by a disabled button.
 *
 * Now they are properties of a pure function, and this file is where they are
 * proven: one id, one start, one finish, pauses that cannot overlap, and a
 * failed start that leaves nothing behind.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  activeMsSoFar,
  finish,
  hasSession,
  idleLifecycle,
  isCapturing,
  pause,
  pausedMsSoFar,
  requestStart,
  resume,
  sessionMetadata,
  trackerFailed,
  trackerStarted,
  type SessionLifecycle,
} from "../sessionLifecycle";
import { activeMs, DEFAULT_MOVEMENT_MODE, SESSION_RULES_VERSION } from "@movenrun/shared/session";

const T0 = 1_756_000_000_000;
const ID = "mv-test-session-1";

/** A lifecycle that has actually started, the only way one legitimately can. */
function started(at = T0, id = ID): SessionLifecycle {
  const requested = requestStart(idleLifecycle());
  const running = trackerStarted(requested.lifecycle, { clientSessionId: id, at });
  return running.lifecycle;
}

/* ── identity ─────────────────────────────────────────────────────────────── */

test("no session exists until the tracker has actually started", () => {
  const idle = idleLifecycle();
  assert.equal(idle.clientSessionId, null);
  assert.equal(hasSession(idle), false);

  const requested = requestStart(idle);
  assert.equal(requested.outcome, "ok");
  assert.equal(requested.lifecycle.state, "starting");
  /* Nothing is stamped yet. A session that only exists once something is
     capturing cannot be half-created by a tracker that never ran. */
  assert.equal(requested.lifecycle.clientSessionId, null);
  assert.equal(requested.lifecycle.startedAt, null);
  assert.equal(requested.lifecycle.mode, null);
  assert.equal(requested.lifecycle.rulesVersion, null);
});

test("identity, mode, rules version and start time are stamped together", () => {
  const live = started();
  assert.equal(live.state, "active");
  assert.equal(live.clientSessionId, ID);
  assert.equal(live.startedAt, T0);
  assert.equal(live.mode, DEFAULT_MOVEMENT_MODE);
  assert.equal(live.rulesVersion, SESSION_RULES_VERSION);
});

test("a second Start is ignored — one tap or ten, one session", () => {
  const requested = requestStart(idleLifecycle());
  const again = requestStart(requested.lifecycle);
  assert.equal(again.outcome, "ignored");
  assert.equal(again.lifecycle, requested.lifecycle, "the lifecycle must be untouched");

  const live = started();
  for (const state of [live, pause(live, T0 + 1).lifecycle]) {
    const extra = requestStart(state);
    assert.equal(extra.outcome, "ignored");
    assert.equal(extra.lifecycle.clientSessionId, ID, "a second Start must not re-mint");
  }
});

test("the id survives pause, resume and finish unchanged", () => {
  let l = started();
  l = pause(l, T0 + 1_000).lifecycle;
  assert.equal(l.clientSessionId, ID);
  l = resume(l, T0 + 2_000).lifecycle;
  assert.equal(l.clientSessionId, ID);
  l = finish(l, T0 + 3_000).lifecycle;
  assert.equal(l.clientSessionId, ID);
});

test("a failed start leaves nothing behind and Start becomes available again", () => {
  /* The bug this closes: the screen used to mint an id during render and start
     the tracker in an effect that swallowed its own failure, so a revoked
     permission left a session that looked live, counted time, and recorded
     nothing. */
  const requested = requestStart(idleLifecycle());
  const failed = trackerFailed(requested.lifecycle);
  assert.equal(failed.outcome, "ok");
  assert.deepEqual(failed.lifecycle, idleLifecycle());
  assert.equal(hasSession(failed.lifecycle), false);

  const retry = requestStart(failed.lifecycle);
  assert.equal(retry.outcome, "ok", "Start must be actionable again after a failure");
});

test("a tracker cannot report started, or failed, when nothing was starting", () => {
  for (const l of [idleLifecycle(), started(), finish(started(), T0 + 1).lifecycle]) {
    assert.equal(trackerStarted(l, { clientSessionId: "mv-other", at: T0 }).outcome === "ok", l.state === "starting");
    assert.equal(trackerFailed(l).outcome === "ok", l.state === "starting");
  }
});

/* ── pause and resume ─────────────────────────────────────────────────────── */

test("pause and resume move between active and paused", () => {
  const live = started();
  const paused = pause(live, T0 + 1_000);
  assert.equal(paused.outcome, "ok");
  assert.equal(paused.lifecycle.state, "paused");
  assert.equal(isCapturing(paused.lifecycle), false);

  const resumed = resume(paused.lifecycle, T0 + 4_000);
  assert.equal(resumed.outcome, "ok");
  assert.equal(resumed.lifecycle.state, "active");
  assert.deepEqual(resumed.lifecycle.pauses, [{ startedAt: T0 + 1_000, endedAt: T0 + 4_000 }]);
});

test("a second Pause opens no second interval", () => {
  const paused = pause(started(), T0 + 1_000).lifecycle;
  const again = pause(paused, T0 + 2_000);
  assert.equal(again.outcome, "ignored");
  assert.equal(again.lifecycle.openPauseAt, T0 + 1_000, "the original pause must stand");
  const resumed = resume(again.lifecycle, T0 + 5_000).lifecycle;
  assert.equal(resumed.pauses.length, 1);
});

test("a second Resume closes nothing extra", () => {
  const resumed = resume(pause(started(), T0 + 1_000).lifecycle, T0 + 3_000).lifecycle;
  const again = resume(resumed, T0 + 4_000);
  assert.equal(again.outcome, "ignored");
  assert.equal(again.lifecycle.pauses.length, 1);
});

test("pauses accumulate in order and never overlap", () => {
  let l = started();
  l = resume(pause(l, T0 + 1_000).lifecycle, T0 + 2_000).lifecycle;
  l = resume(pause(l, T0 + 5_000).lifecycle, T0 + 9_000).lifecycle;
  assert.deepEqual(l.pauses, [
    { startedAt: T0 + 1_000, endedAt: T0 + 2_000 },
    { startedAt: T0 + 5_000, endedAt: T0 + 9_000 },
  ]);
  for (let i = 1; i < l.pauses.length; i++) {
    assert.ok(l.pauses[i].startedAt >= l.pauses[i - 1].endedAt, "pauses overlap");
  }
});

test("a resume timestamped before its own pause cannot produce a negative interval", () => {
  const paused = pause(started(), T0 + 5_000).lifecycle;
  const resumed = resume(paused, T0 + 1_000).lifecycle;
  assert.deepEqual(resumed.pauses, [{ startedAt: T0 + 5_000, endedAt: T0 + 5_000 }]);
});

test("pause and resume are invalid outside their own states", () => {
  assert.equal(pause(idleLifecycle(), T0).outcome, "invalid");
  assert.equal(resume(idleLifecycle(), T0).outcome, "invalid");
  assert.equal(resume(requestStart(idleLifecycle()).lifecycle, T0).outcome, "invalid");
  const done = finish(started(), T0 + 1_000).lifecycle;
  assert.equal(pause(done, T0 + 2_000).outcome, "invalid");
});

/* ── finish ───────────────────────────────────────────────────────────────── */

test("Finish happens exactly once, however many times it is pressed", () => {
  const live = started();
  const first = finish(live, T0 + 10_000);
  assert.equal(first.outcome, "ok");
  assert.equal(first.lifecycle.state, "finished");
  assert.equal(first.lifecycle.finishedAt, T0 + 10_000);

  const second = finish(first.lifecycle, T0 + 11_000);
  assert.equal(second.outcome, "ignored");
  assert.equal(second.lifecycle.finishedAt, T0 + 10_000, "the finish time must not move");
  assert.equal(second.lifecycle, first.lifecycle, "a second Finish must change nothing");
});

test("finishing while paused closes the open pause at the finish time", () => {
  const paused = pause(started(), T0 + 4_000).lifecycle;
  const done = finish(paused, T0 + 9_000).lifecycle;
  assert.equal(done.state, "finished");
  assert.equal(done.openPauseAt, null, "no pause may be left open in evidence");
  assert.deepEqual(done.pauses, [{ startedAt: T0 + 4_000, endedAt: T0 + 9_000 }]);
});

test("a finish earlier than its own start is clamped rather than recorded", () => {
  const done = finish(started(T0), T0 - 5_000).lifecycle;
  assert.equal(done.finishedAt, T0);
  assert.ok((done.finishedAt ?? 0) >= (done.startedAt ?? 0));
});

test("Finish is invalid before a session exists", () => {
  assert.equal(finish(idleLifecycle(), T0).outcome, "invalid");
  assert.equal(finish(requestStart(idleLifecycle()).lifecycle, T0).outcome, "invalid");
});

/* ── evidence ─────────────────────────────────────────────────────────────── */

test("metadata exists only once a session has finished", () => {
  assert.equal(sessionMetadata(idleLifecycle()), null);
  assert.equal(sessionMetadata(requestStart(idleLifecycle()).lifecycle), null);
  assert.equal(sessionMetadata(started()), null, "a live session has no finish time to report");
  assert.equal(sessionMetadata(pause(started(), T0 + 1).lifecycle), null);
  assert.ok(sessionMetadata(finish(started(), T0 + 1_000).lifecycle));
});

test("finished metadata is the provenance stamped at Start", () => {
  let l = started(T0);
  l = resume(pause(l, T0 + 2_000).lifecycle, T0 + 5_000).lifecycle;
  l = finish(l, T0 + 20_000).lifecycle;
  const m = sessionMetadata(l);
  assert.deepEqual(m, {
    mode: DEFAULT_MOVEMENT_MODE,
    rulesVersion: SESSION_RULES_VERSION,
    startedAt: T0,
    finishedAt: T0 + 20_000,
    pauses: [{ startedAt: T0 + 2_000, endedAt: T0 + 5_000 }],
  });
});

test("evidence is copied out, so a later transition cannot reach into it", () => {
  const done = finish(resume(pause(started(), T0 + 1_000).lifecycle, T0 + 2_000).lifecycle, T0 + 9_000).lifecycle;
  const m = sessionMetadata(done)!;
  m.pauses[0].endedAt = 0;
  m.pauses.push({ startedAt: 1, endedAt: 2 });
  const again = sessionMetadata(done)!;
  assert.deepEqual(again.pauses, [{ startedAt: T0 + 1_000, endedAt: T0 + 2_000 }]);
});

/* ── the clock on screen is the clock in the evidence ─────────────────────── */

test("active time excludes pauses, live and finished alike", () => {
  let l = started(T0);
  assert.equal(activeMsSoFar(l, T0 + 10_000), 10_000);

  l = pause(l, T0 + 10_000).lifecycle;
  /* While paused the displayed time stands still rather than running on. */
  assert.equal(activeMsSoFar(l, T0 + 15_000), 10_000);
  assert.equal(pausedMsSoFar(l, T0 + 15_000), 5_000);

  l = resume(l, T0 + 20_000).lifecycle;
  assert.equal(activeMsSoFar(l, T0 + 30_000), 20_000);
});

test("the number the screen showed is the number the finished session carries", () => {
  /* `durationMs` on a FinishedSession and `activeMs` of its metadata are two
     computations of one quantity. They are asserted equal rather than assumed,
     because the screen's clock and the evidence are written in different
     places and could drift apart silently. */
  let l = started(T0);
  l = resume(pause(l, T0 + 3_000).lifecycle, T0 + 8_000).lifecycle;
  l = resume(pause(l, T0 + 12_000).lifecycle, T0 + 14_000).lifecycle;
  l = finish(l, T0 + 30_000).lifecycle;

  const onScreen = activeMsSoFar(l, T0 + 30_000);
  const inEvidence = activeMs(sessionMetadata(l)!);
  assert.equal(onScreen, inEvidence);
  assert.equal(onScreen, 30_000 - 5_000 - 2_000);
});

test("time before a session starts is zero, not negative", () => {
  assert.equal(activeMsSoFar(idleLifecycle(), T0), 0);
  assert.equal(pausedMsSoFar(idleLifecycle(), T0), 0);
});

/* ── mode and rules version are immutable ─────────────────────────────────── */

test("no transition can change the mode or the rules version", () => {
  let l = started();
  const originalMode = l.mode;
  const originalRules = l.rulesVersion;
  for (const step of [
    (x: SessionLifecycle) => pause(x, T0 + 1_000).lifecycle,
    (x: SessionLifecycle) => resume(x, T0 + 2_000).lifecycle,
    (x: SessionLifecycle) => pause(x, T0 + 3_000).lifecycle,
    (x: SessionLifecycle) => finish(x, T0 + 4_000).lifecycle,
    (x: SessionLifecycle) => finish(x, T0 + 5_000).lifecycle,
  ]) {
    l = step(l);
    assert.equal(l.mode, originalMode);
    assert.equal(l.rulesVersion, originalRules);
  }
  const m = sessionMetadata(l)!;
  assert.equal(m.mode, originalMode);
  assert.equal(m.rulesVersion, originalRules);
});

test("start time is immutable once stamped", () => {
  let l = started(T0);
  for (const step of [
    (x: SessionLifecycle) => pause(x, T0 + 1_000).lifecycle,
    (x: SessionLifecycle) => resume(x, T0 + 2_000).lifecycle,
    (x: SessionLifecycle) => finish(x, T0 + 3_000).lifecycle,
  ]) {
    l = step(l);
    assert.equal(l.startedAt, T0);
  }
});

/* ── capture is only live in one state ────────────────────────────────────── */

test("only an active session is capturing", () => {
  assert.equal(isCapturing(idleLifecycle()), false);
  assert.equal(isCapturing(requestStart(idleLifecycle()).lifecycle), false);
  assert.equal(isCapturing(started()), true);
  assert.equal(isCapturing(pause(started(), T0 + 1).lifecycle), false);
  assert.equal(isCapturing(finish(started(), T0 + 1).lifecycle), false);
});

test("every transition is total — no input throws", () => {
  const states: SessionLifecycle[] = [
    idleLifecycle(),
    requestStart(idleLifecycle()).lifecycle,
    started(),
    pause(started(), T0 + 1).lifecycle,
    finish(started(), T0 + 1).lifecycle,
  ];
  for (const l of states) {
    for (const at of [T0, 0, -1, NaN, Number.MAX_SAFE_INTEGER]) {
      assert.doesNotThrow(() => requestStart(l));
      assert.doesNotThrow(() => trackerStarted(l, { clientSessionId: ID, at }));
      assert.doesNotThrow(() => trackerFailed(l));
      assert.doesNotThrow(() => pause(l, at));
      assert.doesNotThrow(() => resume(l, at));
      assert.doesNotThrow(() => finish(l, at));
      assert.doesNotThrow(() => sessionMetadata(l));
    }
  }
});

test("every declared capture state is reachable", () => {
  /* A state nothing can enter still has to be handled by every reader and
     every `switch` that covers the union, and it quietly invites the
     assumption that it is supported — the same reason `cycling` is absent from
     the movement modes rather than present and refused. Declared and reachable
     are asserted to be the same set, so a decorative state fails here instead
     of living on in the type. */
  const source = readFileSync(join(process.cwd(), "src", "lib", "sessionLifecycle.ts"), "utf8");
  const union = source.match(/export type CaptureState =([\s\S]*?);/);
  assert.ok(union, "the CaptureState union was not found");
  const declared = (union[1].match(/"[a-z]+"/g) ?? []).map((s) => s.slice(1, -1));
  assert.ok(declared.length >= 4, "the union scan found suspiciously little");

  const idle = idleLifecycle();
  const starting = requestStart(idle).lifecycle;
  const active = trackerStarted(starting, { clientSessionId: ID, at: T0 }).lifecycle;
  const paused = pause(active, T0 + 1_000).lifecycle;
  const reached = new Set([
    idle.state,
    starting.state,
    trackerFailed(starting).lifecycle.state,
    active.state,
    paused.state,
    resume(paused, T0 + 2_000).lifecycle.state,
    finish(active, T0 + 3_000).lifecycle.state,
  ]);

  assert.deepEqual(
    declared.slice().sort(),
    [...reached].sort(),
    "a declared capture state has no transition into it",
  );
});
