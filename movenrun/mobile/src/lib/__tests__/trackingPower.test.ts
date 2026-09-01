/**
 * Battery, buffering and tracking-honesty rules for a movement session.
 *
 * These cover the three things that actually decide whether a session is cheap
 * to run and truthful afterwards: what we ask the GPS radio for, how the route
 * buffer grows, and whether we admit it when tracking stopped.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACCURACY,
  FORBIDDEN_ACCURACY,
  isBatterySafe,
  SESSION_WATCH,
  type WatchConfig,
} from "../trackingConfig";
import {
  gapNotice,
  MAX_STORED_POINTS,
  MIN_GAP_MS,
  PREVIEW_STRIDE,
  pushPoint,
  recordGap,
  shouldRefreshPreview,
  SIGNIFICANT_GAP_MS,
  summarizeGaps,
  type TrackingGap,
} from "../trackPoints";
import { MAX_ACCURACY_M, MIN_STEP_M, type TrackPoint } from "../geo";
import { scoreRoute } from "../routeTrust";

const point = (i: number): TrackPoint => ({
  latitude: 40.78 + i * 0.0001,
  longitude: -73.96,
  timestamp: 1_700_000_000_000 + i * 4000,
  accuracy: 8,
});

// ---- GPS power -------------------------------------------------------------

test("the session never asks for navigation-grade GPS", () => {
  // BestForNavigation keeps the chip at full rate and fuses extra sensors for
  // turn-by-turn guidance. Held open for an hour it is the single most
  // expensive thing the app can do, and our own filters throw away the
  // precision it buys.
  assert.notEqual(SESSION_WATCH.accuracy, ACCURACY.BestForNavigation);
  assert.notEqual(SESSION_WATCH.accuracy, ACCURACY.Highest);
  assert.ok(isBatterySafe(SESSION_WATCH), "the shipped config must be battery-safe");
  for (const accuracy of FORBIDDEN_ACCURACY) {
    assert.equal(isBatterySafe({ ...SESSION_WATCH, accuracy }), false, `${accuracy} is too costly`);
  }
});

test("the requested accuracy is still good enough for our own filters", () => {
  // Asking for less precision than we accept would make every fix suspect.
  assert.ok(SESSION_WATCH.accuracy >= ACCURACY.High, "High or better");
  assert.ok(MAX_ACCURACY_M >= 10, "High is ~10 m and must sit inside the accept window");
});

test("we never wake more often than we would accept a point", () => {
  // Requesting fixes finer than MIN_STEP_M spends battery producing points
  // acceptPoint() immediately discards.
  assert.ok(SESSION_WATCH.distanceInterval >= MIN_STEP_M);
  assert.ok(SESSION_WATCH.timeInterval >= 1000);
  const tooEager: WatchConfig = { ...SESSION_WATCH, distanceInterval: MIN_STEP_M - 1 };
  assert.equal(isBatterySafe(tooEager), false);
  assert.equal(isBatterySafe({ ...SESSION_WATCH, timeInterval: 500 }), false);
});

test("the tracker uses the shared config and hardcodes nothing", () => {
  const src = readFileSync(join(process.cwd(), "src", "services", "moveTracker.ts"), "utf8");
  assert.match(src, /SESSION_WATCH/, "the tracker must read the shared config");
  assert.ok(
    !/BestForNavigation/.test(src),
    "navigation-grade accuracy must not appear in the tracker at all",
  );
  assert.ok(
    !/timeInterval:\s*\d/.test(src),
    "intervals belong to trackingConfig, not inline in the tracker",
  );
});

// ---- the route buffer ------------------------------------------------------

test("appending a point does not copy the buffer", () => {
  // The regression: `points = [...points, p]` per fix is O(n) each time and
  // O(n^2) across a session.
  const buffer: TrackPoint[] = [];
  const first = pushPoint(buffer, point(0));
  const second = pushPoint(buffer, point(1));
  assert.equal(first, buffer, "same array, mutated in place");
  assert.equal(second, buffer);
  assert.equal(buffer.length, 2);
});

test("the buffer is bounded however long the session runs", () => {
  const buffer: TrackPoint[] = [];
  for (let i = 0; i < MAX_STORED_POINTS * 4 + 7; i++) pushPoint(buffer, point(i));
  assert.ok(buffer.length <= MAX_STORED_POINTS + 1, `grew to ${buffer.length}`);
  assert.ok(buffer.length > MAX_STORED_POINTS / 4, "and does not collapse to nothing");
});

test("decimation keeps the start and the newest fix", () => {
  const cap = 8;
  const buffer: TrackPoint[] = [];
  for (let i = 0; i < 40; i++) pushPoint(buffer, point(i), cap);
  assert.equal(buffer[0]!.timestamp, point(0).timestamp, "the route still starts where it started");
  assert.equal(
    buffer[buffer.length - 1]!.timestamp,
    point(39).timestamp,
    "the head must stay where the user actually is",
  );
  // Still ordered in time after repeated halving.
  for (let i = 1; i < buffer.length; i++) {
    assert.ok(buffer[i]!.timestamp > buffer[i - 1]!.timestamp, "chronological order survives");
  }
});

test("the drawn route refreshes on a stride, not on every fix", () => {
  // The canvas draws ~110 dots; redrawing per fix reconciles them for a change
  // no one can see.
  assert.ok(shouldRefreshPreview(1), "the first fixes must show immediately");
  assert.ok(shouldRefreshPreview(2));
  assert.ok(shouldRefreshPreview(PREVIEW_STRIDE));
  assert.equal(shouldRefreshPreview(PREVIEW_STRIDE + 1), false);
  let refreshes = 0;
  for (let n = 1; n <= 1000; n++) if (shouldRefreshPreview(n)) refreshes++;
  assert.ok(refreshes < 300, `1000 fixes should not cause ${refreshes} redraws`);
});

// ---- tracking gaps ---------------------------------------------------------

test("a brief interruption is not reported as a gap", () => {
  // Pulling down the notification shade deactivates the app without losing
  // meaningful distance. Flagging that would cry wolf every session.
  const gaps: TrackingGap[] = [];
  recordGap(gaps, 1000, 1000 + MIN_GAP_MS - 1);
  assert.deepEqual(gaps, []);
});

test("a real background span is recorded", () => {
  const gaps: TrackingGap[] = [];
  recordGap(gaps, 1000, 1000 + MIN_GAP_MS);
  recordGap(gaps, 50_000, 50_000 + 120_000);
  assert.equal(gaps.length, 2);
});

test("untracked time is summarised against the session, not in isolation", () => {
  const gaps: TrackingGap[] = [{ startedAt: 0, endedAt: 30_000 }];
  // 30s missing from a 10-minute session: under the absolute threshold, and 5%.
  const small = summarizeGaps(gaps, 600_000);
  assert.equal(small.count, 1);
  assert.equal(small.totalMs, 30_000);
  assert.ok(Math.abs(small.share - 0.05) < 1e-9);
  assert.equal(small.significant, false);

  // The same 30s out of a 2-minute session is a quarter of it.
  const large = summarizeGaps(gaps, 120_000);
  assert.equal(large.significant, true, "share matters, not just absolute time");

  // And a long gap is significant regardless of how long the session ran.
  const long = summarizeGaps([{ startedAt: 0, endedAt: SIGNIFICANT_GAP_MS }], 60 * 60_000);
  assert.equal(long.significant, true);
});

test("a clean session reports no gaps and no notice", () => {
  const clean = summarizeGaps([], 600_000);
  assert.deepEqual(clean, { count: 0, totalMs: 0, share: 0, significant: false });
  assert.equal(gapNotice(clean), null, "never invent a warning for a clean route");
});

test("the gap notice says what was lost, in plain words", () => {
  const notice = gapNotice(summarizeGaps([{ startedAt: 0, endedAt: 180_000 }], 600_000));
  assert.ok(notice, "a real gap must be surfaced");
  assert.match(notice!, /background/, "it must say why");
  assert.match(notice!, /3 min/, "and how much");
  assert.ok(!/error|invalid|corrupt/i.test(notice!), "it is an explanation, not an alarm");

  const twice = gapNotice(
    summarizeGaps(
      [
        { startedAt: 0, endedAt: 60_000 },
        { startedAt: 120_000, endedAt: 180_000 },
      ],
      600_000,
    ),
  );
  assert.match(twice!, /2 times/);
});

test("a zero-length session cannot produce a divide-by-zero share", () => {
  const s = summarizeGaps([{ startedAt: 0, endedAt: 10_000 }], 0);
  assert.equal(s.share, 0);
  assert.ok(Number.isFinite(s.share));
});

// ---- trust must know about gaps -------------------------------------------

test("a route with a real tracking gap cannot score as clean", () => {
  const points: TrackPoint[] = Array.from({ length: 60 }, (_, i) => ({
    latitude: 40.78 + i * 0.0002,
    longitude: -73.96,
    timestamp: 1_700_000_000_000 + i * 4000,
    accuracy: 8,
  }));
  const base = {
    /* Required since completed sessions gained a stable identity. Fixed here
       because these tests measure route trust from tracking gaps, and the id
       is not part of that. */
    clientSessionId: "mv-tracking-power-01",
    mode: "gps" as const,
    points,
    distanceM: 1400,
    durationMs: 12 * 60_000,
    finishedAt: 1_700_000_300_000,
  };

  const clean = scoreRoute(base);
  assert.ok(clean.positiveSignals.includes("Clean route"), "the control route is clean");
  assert.ok(!clean.riskFlags.includes("Tracking gap"));

  // Four minutes of a twelve-minute session were never recorded.
  const withGap = scoreRoute({ ...base, gaps: [{ startedAt: 0, endedAt: 4 * 60_000 }] });
  assert.ok(withGap.riskFlags.includes("Tracking gap"), "the hole must be declared");
  assert.ok(!withGap.positiveSignals.includes("Clean route"), "and it is no longer clean");
  assert.ok(withGap.score < clean.score, "a route with a hole scores lower");
});

test("a momentary interruption does not brand the route", () => {
  const points: TrackPoint[] = Array.from({ length: 60 }, (_, i) => ({
    latitude: 40.78 + i * 0.0002,
    longitude: -73.96,
    timestamp: 1_700_000_000_000 + i * 4000,
    accuracy: 8,
  }));
  const withBlip = scoreRoute({
    clientSessionId: "mv-tracking-power-02",
    mode: "gps",
    points,
    distanceM: 1400,
    durationMs: 20 * 60_000,
    finishedAt: 1_700_000_300_000,
    gaps: [{ startedAt: 0, endedAt: 10_000 }],
  });
  assert.ok(!withBlip.riskFlags.includes("Tracking gap"), "10s out of 20min is not a gap worth flagging");
});
