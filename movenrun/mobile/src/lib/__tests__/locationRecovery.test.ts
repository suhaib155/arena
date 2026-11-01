/**
 * Recovery after a location interruption: a permission or the location toggle
 * fixed in system Settings, or a watch that died mid-session.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  absorbBackgroundSpan,
  interruptionMessage,
  recoveryOnForeground,
  restartWhenLocationReturns,
  shouldCheckLocationServices,
  silentGapStart,
} from "../locationRecovery";

const base = { captureState: "idle" as const, startErrorSettingsRelevant: false, watchStopped: false, restarting: false };

test("a start blocked by permission or the location toggle retries on return from Settings", () => {
  assert.equal(recoveryOnForeground({ ...base, startErrorSettingsRelevant: true }), "retry_start");
});

test("a start that failed for another reason, or never failed, is not retried by itself", () => {
  assert.equal(recoveryOnForeground(base), "none");
  for (const captureState of ["starting", "active", "paused", "finished"] as const) {
    assert.equal(recoveryOnForeground({ ...base, captureState, startErrorSettingsRelevant: true }), "none");
  }
});

test("a live or paused session whose watch died restarts it, once", () => {
  assert.equal(recoveryOnForeground({ ...base, captureState: "active", watchStopped: true }), "restart_watch");
  assert.equal(recoveryOnForeground({ ...base, captureState: "paused", watchStopped: true }), "restart_watch");
  assert.equal(recoveryOnForeground({ ...base, captureState: "active", watchStopped: true, restarting: true }), "none");
  assert.equal(recoveryOnForeground({ ...base, captureState: "active" }), "none");
  assert.equal(recoveryOnForeground({ ...base, captureState: "finished", watchStopped: true }), "none");
});

test("location services are asked about only for a degraded live capture", () => {
  assert.equal(shouldCheckLocationServices("active", "degraded"), true);
  assert.equal(shouldCheckLocationServices("active", "usable"), false);
  assert.equal(shouldCheckLocationServices("active", "unknown"), false);
  assert.equal(shouldCheckLocationServices("paused", "degraded"), false);
  assert.equal(shouldCheckLocationServices("idle", "degraded"), false);
});

test("the banner names the cause and promises only what the summary shows", () => {
  assert.match(interruptionMessage("services_off"), /Location is off/);
  assert.match(interruptionMessage("watch_stopped"), /interrupted/);
  for (const cause of ["services_off", "watch_stopped"] as const) {
    assert.match(interruptionMessage(cause), /summary/);
    assert.doesNotMatch(interruptionMessage(cause), /XP|territory|ground/i);
  }
});

test("a silent toggle's gap starts at the last fix seen, never after detection", () => {
  assert.equal(silentGapStart(1_000, 22_000), 1_000);
  assert.equal(silentGapStart(null, 22_000), 22_000);
  assert.equal(silentGapStart(30_000, 22_000), 22_000, "a fix stamped after detection cannot move the start later");
});

test("leaving for Settings during an open gap extends that gap instead of adding a second", () => {
  assert.equal(absorbBackgroundSpan(null, 5_000), null, "no open gap: the background span is its own");
  assert.equal(absorbBackgroundSpan(10_000, 15_000), 10_000);
  assert.equal(absorbBackgroundSpan(10_000, 4_000), 4_000);
  assert.equal(absorbBackgroundSpan(10_000, null), 10_000);
});

test("location coming back restarts only a watch that actually stopped", () => {
  assert.equal(restartWhenLocationReturns(false), false);
  assert.equal(restartWhenLocationReturns(true), true);
});

/* The screens must listen to AppState, because returning from Settings never
   changes navigation focus. These pins fail if the listeners are removed. */
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("the readiness screen re-checks permission when the app returns to the foreground", () => {
  const s = src("app/move/index.tsx");
  assert.match(s, /AppState\.addEventListener\("change"[\s\S]{0,120}next === "active"\) void refresh\(\)/);
});

test("the session screen acts on foreground return and on a silent location toggle", () => {
  const s = src("app/move/session.tsx");
  assert.match(s, /recoveryOnForeground\(\{/);
  assert.match(s, /action === "retry_start"\) setStartAttempt/);
  assert.match(s, /action === "restart_watch"\) restartWatchRef\.current\?\.\(\)/);
  assert.match(s, /shouldCheckLocationServices\(lifecycleRef\.current\.state, signalNow\)/);
  /* A services-off spell breaks the route and opens a gap, like a background spell. */
  assert.match(s, /markInterruption\("services_off"\);\s*continuityBrokenRef\.current = true;\s*trackerGapAtRef\.current \?\?=/);
  /* A restart reuses the same evidence callback and never re-stamps the session. */
  assert.match(s, /restartWatchRef\.current = \(\) => \{[\s\S]{0,200}tracker\.start\(onEvidence, onWatchError, onAcquisition, onDisplay\)/);
  const restart = s.slice(s.indexOf("restartWatchRef.current = () =>"), s.indexOf("tracker\n      .start(onEvidence"));
  assert.doesNotMatch(restart, /trackerStarted|newClientSessionId|createSessionClock/);
  /* A failed restart leaves no watch running, so it must be marked stopped. */
  assert.match(restart, /markWatchStopped\(true\);\s*markInterruption\("watch_stopped"\)/);
  /* Location returning leaves a working registration alone. */
  assert.match(s, /if \(restartWhenLocationReturns\(watchStoppedRef\.current\)\) restartWatchRef\.current\?\.\(\)/);
  assert.match(s, /trackerGapAtRef\.current \?\?= silentGapStart\(lastFixSeenAtRef\.current/);
  /* Resume and foreground return re-arm the silent-gap bound, so a gap cannot
     reach back across a pause or a background spell already accounted for. */
  assert.equal((s.match(/healthRef\.current\?\.rearm\(at\);[\s\S]{0,200}?lastFixSeenAtRef\.current = at;/g) ?? []).length, 2);
  /* Retry GPS is offered only while no watch runs. */
  assert.match(s, /\{watchStopped \? \(\s*<Button label="Retry GPS"/);
  /* A background spell during an open tracker gap is absorbed, not double counted. */
  assert.match(s, /const openGap = absorbBackgroundSpan\(trackerGapAtRef\.current, startedAt\);\s*if \(openGap !== null\) trackerGapAtRef\.current = openGap;\s*else if \(startedAt != null\) recordGap/);
});
