/**
 * Clock integrity and acquisition health (MR-C items 1 and 2).
 *
 * SYNTHETIC / NOT LIVE. The fixes below are made-up points in open ocean; the
 * scenarios mirror Track A fixtures C01 (system clock set back one hour
 * mid-walk) and C02 (set forward one hour mid-walk). Fix timestamps are GNSS
 * time; only the phone's wall clock moves.
 *
 * Device suspend/resume is NOT covered here: whether the runtime's monotonic
 * source keeps counting while the phone sleeps has to be measured on hardware.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { inspectFix, type FixDecision } from "@movenrun/shared/measurement";

import { createSessionClock } from "../sessionClock";
import { createFixHealth, FIX_HEALTH } from "../fixHealth";
import { activeMsSoFar, finish, idleLifecycle, requestStart, trackerStarted } from "../sessionLifecycle";
import { isSaveable, sessionXp } from "../../services/moveSession";

const EPOCH = Date.UTC(2026, 9, 22, 9, 0, 0);
const HOUR = 3_600_000;

/** A controllable world: true elapsed time, and a wall clock that can be moved. */
function world() {
  let elapsed = 0;
  let wallOffset = 0;
  return {
    advance(ms: number) { elapsed += ms; },
    setWallOffset(ms: number) { wallOffset = ms; },
    wall: () => EPOCH + elapsed + wallOffset,
    monotonic: () => 5_000 + elapsed,
    gnss: () => EPOCH + elapsed,
  };
}

/** A fix `metres` north of the synthetic origin at GNSS time `t`. */
function fix(metres: number, t: number, accuracy = 8) {
  return { latitude: -30 + metres / 111_320, longitude: -140, timestamp: t, accuracy };
}

test("C02: a forward wall-clock step mid-walk does not stretch the session's duration", () => {
  const w = world();
  const clock = createSessionClock(w.wall, w.monotonic);
  let lifecycle = requestStart(idleLifecycle()).lifecycle;
  lifecycle = trackerStarted(lifecycle, { clientSessionId: "mv-synthetic-c02", at: clock.now() }).lifecycle;
  w.advance(65_000);
  w.setWallOffset(HOUR); // the player moves the phone clock forward
  w.advance(45_000);
  const ended = finish(lifecycle, clock.now()).lifecycle;
  const activeMs = activeMsSoFar(ended, ended.finishedAt!);
  assert.equal(activeMs, 110_000, "duration is real elapsed time, not the wall-clock span");
  /* 82 m in under two minutes: not a session, and no XP for an hour. */
  assert.equal(isSaveable(82, activeMs), false);
  assert.ok(sessionXp(82, activeMs) < 191);
});

test("C01: a backward wall-clock step mid-walk does not make current fixes future-dated", () => {
  const w = world();
  const clock = createSessionClock(w.wall, w.monotonic);
  let previous = fix(0, w.gnss());
  w.advance(20_000);
  w.setWallOffset(-HOUR); // phone clock now an hour behind GNSS
  let accepted = 0;
  for (let i = 1; i <= 20; i++) {
    w.advance(4_000);
    const next = fix(i * 6, w.gnss());
    const decision = inspectFix(previous, next, clock.now() + 300);
    assert.notEqual(decision.reason, "future_fix", `fix ${i} judged against the session clock`);
    if (decision.accepted) { accepted += 1; previous = next; }
  }
  assert.ok(accepted >= 5, `walking fixes keep counting (${accepted} accepted)`);
  /* And the same fix judged by the raw wall clock is exactly the C01 defect. */
  assert.equal(inspectFix(null, fix(0, w.gnss()), w.wall()).reason, "future_fix");
});

test("the session clock never runs backwards, even without a monotonic source", () => {
  const w = world();
  const clock = createSessionClock(w.wall, null);
  assert.equal(clock.monotonic, false);
  w.advance(10_000);
  const before = clock.now();
  w.setWallOffset(-HOUR);
  assert.ok(clock.now() >= before, "a backward step is clamped");
});

const ACCEPT: FixDecision = { accepted: true, reason: null, segmentMeters: 10 };
const STILL: FixDecision = { accepted: false, reason: "within_uncertainty", segmentMeters: 1 };
const FUTURE: FixDecision = { accepted: false, reason: "future_fix", segmentMeters: 0 };
const WEAK: FixDecision = { accepted: false, reason: "weak_accuracy", segmentMeters: 0 };

test("health degrades within the window when every fix is rejected as future-dated (C01)", () => {
  const start = 1_000_000;
  const health = createFixHealth(start);
  health.observe(ACCEPT, 8, start + 4_000);
  assert.equal(health.signal(start + 4_000), "usable");
  let degradedAt: number | null = null;
  for (let t = start + 8_000; t <= start + 200_000; t += 4_000) {
    health.observe(FUTURE, 8, t);
    if (degradedAt === null && health.signal(t) === "degraded") degradedAt = t;
  }
  assert.ok(degradedAt !== null, "the chip stops claiming a usable signal");
  assert.ok(degradedAt - (start + 4_000) <= FIX_HEALTH.staleAfterMs + 4_000,
    `degraded ${(degradedAt - start - 4_000) / 1000} s after the last accepted fix (was 200 s silent)`);
});

test("health degrades when fixes stop arriving at all (frozen watch)", () => {
  const health = createFixHealth(0);
  health.observe(ACCEPT, 8, 4_000);
  assert.equal(health.signal(4_000 + FIX_HEALTH.staleAfterMs), "usable");
  assert.equal(health.signal(4_001 + FIX_HEALTH.staleAfterMs), "degraded");
  health.observe(ACCEPT, 8, 60_000);
  assert.equal(health.signal(60_000), "usable", "a fresh accepted fix restores it");
});

test("a stationary player (within_uncertainty) keeps a usable signal", () => {
  const health = createFixHealth(0);
  for (let t = 4_000; t <= 300_000; t += 4_000) health.observe(STILL, 6, t);
  assert.equal(health.signal(300_000), "usable");
});

test("weak accuracy still degrades at once; a weak accepted fix is degraded", () => {
  const health = createFixHealth(0);
  health.observe(ACCEPT, 8, 4_000);
  health.observe(WEAK, 60, 8_000);
  assert.equal(health.signal(8_000), "degraded");
  health.observe(ACCEPT, 30, 12_000);
  assert.equal(health.signal(12_000), "degraded");
  health.observe(ACCEPT, 10, 16_000);
  assert.equal(health.signal(16_000), "usable");
});

test("background and pause rearm the window instead of reporting the gap as a bad signal", () => {
  const health = createFixHealth(0);
  health.observe(ACCEPT, 8, 4_000);
  assert.equal(health.signal(120_000), "degraded", "two minutes with no fix");
  health.rearm(120_000); // back in the foreground / resumed
  assert.equal(health.signal(125_000), "unknown");
  assert.equal(health.signal(120_000 + FIX_HEALTH.staleAfterMs + 1), "degraded", "and degrades again if nothing comes");
  health.interrupt();
  health.observe(ACCEPT, 8, 150_000);
  assert.equal(health.signal(150_000), "usable");
});

test("the session screen measures with the session clock and reads health from fix age", () => {
  const screen = readFileSync(join(__dirname, "..", "..", "..", "app", "move", "session.tsx"), "utf8");
  const code = screen.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/Date\.now\(\)/.test(code), "no capture-path reading of the raw wall clock");
  assert.match(code, /createSessionClock\(\)/);
  assert.match(code, /createFixHealth\(/);
  assert.match(code, /setInterval\(\(\) => refreshSignal\(/, "health is re-read on a timer");
});
