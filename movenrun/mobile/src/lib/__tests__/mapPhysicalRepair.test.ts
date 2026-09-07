/**
 * The physical map failure, pinned.
 *
 * A preview APK built from this branch reached a phone and showed, on the live
 * Move screen: a world-scale basemap somewhere over Europe and Africa, no
 * position marker, no route, no H3 context, `0 m`, a header reading `Moving`, a
 * chip reading `GPS locked`, and — at the same time, on the same screen — an
 * overlay reading `Waiting for your first location fix…`. Home was the same
 * failure with a different continent: real Google tiles, a random view over
 * South America, and a `Locate me` button that did not bring the map to the
 * phone.
 *
 * Every automated check had passed. They passed because each half of the path
 * was correct on its own: the acquisition policy really had qualified a fix,
 * the tracker really had started, and the map really had no coordinate. What
 * nothing tested was the *join* — that the fix which satisfied acquisition was
 * consumed by the policy and never handed to anything that draws.
 *
 * These tests are that join, and are written against the real acquisition
 * watch, the real acquisition policy and the real fix inspector rather than
 * against mocks of them.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { AcquiredForegroundWatch } from "../acquiredForegroundWatch";
import { gpsPresence, presenceLabel, claimsPosition, type GpsPresence } from "../mapPresence";
import { areaCells, contextCells, heldCells } from "../mapCells";
import { createMapAreaTimings, MAX_EVENTS } from "../mapAreaTimings";
import { SESSION_WATCH, ACQUISITION_WATCH } from "../trackingConfig";
import { MIN_STEP_M } from "../geo";
import type { TrackPoint } from "../geo";

const epoch = 1_700_000_000_000;
const point = (offset: number, accuracy: number | null = 5): TrackPoint =>
  ({ latitude: 26.1445, longitude: 91.7362, timestamp: epoch + offset, accuracy });

const source = (relative: string) => readFileSync(resolve(__dirname, "../..", relative), "utf8");

/**
 * Drive the real watch to readiness while the player stands still.
 *
 * The stationary case is the one the device hit and the one nothing simulated:
 * the session watch below only wakes on displacement, so after the swap a
 * motionless player produces no further points at all.
 */
function standStill() {
  let now = epoch;
  const acquisitionCallbacks: Array<(p: TrackPoint) => void> = [];
  const sessionCallbacks: Array<(p: TrackPoint) => void> = [];
  let attachSession!: (sub: { remove(): void }) => void;
  const evidence: TrackPoint[] = [];
  const display: TrackPoint[] = [];
  const states: string[] = [];
  const watch = new AcquiredForegroundWatch({
    now: () => now,
    watch: async (acquiring, callback) => {
      if (acquiring) { acquisitionCallbacks.push(callback); return { remove() {} }; }
      sessionCallbacks.push(callback);
      return new Promise(resolve => { attachSession = resolve; });
    },
  });
  let ready = false;
  const started = watch
    .start(p => evidence.push(p), undefined, s => states.push(s), p => display.push(p))
    .then(() => { ready = true; });
  return {
    watch, evidence, display, states, started,
    ready: () => ready,
    /** One fix from the warm-up watch, at `offset` ms after the session began. */
    warmUp(offset: number, accuracy: number | null = 5) {
      now = epoch + offset;
      acquisitionCallbacks[0]!(point(offset, accuracy));
    },
    session(offset: number) { sessionCallbacks[0]!(point(offset)); },
    attachSession: () => attachSession({ remove() {} }),
  };
}

/** Walk the real policy to readiness: three usable fixes across eight seconds. */
async function acquire(run: ReturnType<typeof standStill>) {
  await Promise.resolve();
  run.warmUp(0, 60);   // too coarse to draw and too coarse to qualify
  run.warmUp(0);
  run.warmUp(4000);
  run.warmUp(8000);
  await run.started;
}

test("the qualifying warm-up fix reaches the map, and nothing else does", async () => {
  const run = standStill();
  await acquire(run);

  assert.equal(run.ready(), true);
  assert.equal(run.states.at(-1), "ready");

  /* The whole repair, in one assertion: the exact fix that satisfied the
     acquisition policy is on the display channel. Before this it was pushed
     into the policy, returned true, and was dropped on the floor. */
  assert.equal(run.display.at(-1)!.timestamp, epoch + 8000,
    "the fix that satisfied acquisition must reach the map, not just the policy");

  /* Earlier warm-up fixes centre the map too, so the player is not shown an
     arbitrary continent for the length of the acquisition window — but only
     the ones that are honest geography. The 60 m fix is not drawable. */
  assert.deepEqual(run.display.map(p => p.timestamp - epoch), [0, 4000, 8000]);

  /* …and none of it is evidence. This is the invariant that keeps a browsing
     or warm-up position out of distance, sealing, XP and territory. */
  assert.equal(run.evidence.length, 0, "warm-up fixes are not route evidence");
});

test("a stationary player after the watch swap keeps a position and gains no distance", async () => {
  const run = standStill();
  await acquire(run);
  run.attachSession();
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

  /* This is the device failure exactly. The session watch wakes on
     displacement — see SESSION_WATCH — so a player standing still delivers
     nothing more, forever. */
  assert.ok(SESSION_WATCH.distanceInterval >= MIN_STEP_M,
    "the session watch only wakes on displacement, which is why the seed is required");
  assert.equal(ACQUISITION_WATCH.distanceInterval, 0);

  const displays = run.display.length;
  const evidence = run.evidence.length;
  await Promise.resolve();
  assert.equal(run.display.length, displays, "standing still produces no new fixes at all");
  assert.equal(run.evidence.length, evidence);

  /* And yet the map is not empty, because the seed arrived before the swap. */
  assert.ok(run.display.length > 0);
  assert.equal(run.evidence.length, 0, "standing still is not movement");

  const presence = gpsPresence({ acquisition: "ready", displayLocation: run.display.at(-1)!, degraded: false });
  assert.equal(presence, "ready");
  assert.equal(presenceLabel(presence), "GPS locked");
});

test("readiness cannot be claimed while the map has no location", () => {
  /* The contradiction the phone displayed: `GPS locked` beside `Waiting for
     your first location fix…`. It is now unrepresentable — every state that
     claims a position requires one. */
  for (const acquisition of ["locating", "improving", "evaluating", "ready"] as const) {
    for (const degraded of [false, true]) {
      const presence = gpsPresence({ acquisition, displayLocation: null, degraded });
      assert.equal(claimsPosition(presence), false,
        `${acquisition} must not claim a position with nothing on the map`);
      assert.notEqual(presenceLabel(presence), "GPS locked");
    }
  }
  assert.equal(gpsPresence({ acquisition: "locating", displayLocation: null }), "locating");
  assert.equal(gpsPresence({ acquisition: "evaluating", displayLocation: null }), "improving");
  /* A resolved tracker start is not a position, and a position is not yet a
     lock: readiness needs both. */
  assert.equal(gpsPresence({ acquisition: "evaluating", displayLocation: point(0) }), "improving");
  assert.equal(gpsPresence({ acquisition: "ready", displayLocation: point(0) }), "ready");
  assert.equal(gpsPresence({ acquisition: "ready", displayLocation: point(0), degraded: true }), "weak");
  const labels = (["locating", "improving", "ready", "weak"] as GpsPresence[]).map(presenceLabel);
  assert.equal(new Set(labels).size, labels.length, "one vocabulary, no two states sharing words");
});

test("the first accepted session point begins evidence without a duplicated seed", async () => {
  const run = standStill();
  await acquire(run);
  run.attachSession();
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

  const seeded = run.display.length;
  run.session(20_000);
  assert.equal(run.evidence.length, 1, "the session watch's first point is evidence");
  assert.equal(run.evidence[0]!.timestamp, epoch + 20_000);
  /* The seed is not replayed into the route, and the route's first point is not
     replayed into the seed's channel — the screen sets the display location
     from the accepted point itself, which is a separate decision it documents. */
  assert.equal(run.display.length, seeded, "an evidence point is not echoed onto the display channel");
  assert.ok(!run.evidence.some(p => p.timestamp === epoch + 8000),
    "the acquisition seed never becomes the route's first segment");
});

test("cancellation before readiness publishes no position at all", async () => {
  const run = standStill();
  await Promise.resolve();
  run.watch.stop();
  await assert.rejects(run.started, /cancelled/);
  run.warmUp(0);
  assert.equal(run.display.length, 0, "a cancelled acquisition draws nothing");
  assert.equal(run.evidence.length, 0);
});

test("H3 context exists with zero owned zones and never invents ownership", () => {
  const here = point(0);
  const withNothing = areaCells([], here);
  assert.ok(withNothing.length > 1, "a player who owns no ground still sees the grid they stand on");
  assert.equal(withNothing.filter(cell => cell.tone === "current").length, 1);
  assert.ok(withNothing.every(cell => cell.tone === "current" || cell.tone === "context"),
    "nothing is drawn as held, touched or selected for a player who holds nothing");

  /* Recorded ground still wins, and is still only what the store recorded. */
  const held = heldCells([{ id: contextCells(here).at(-1)!.id as string }]);
  assert.equal(held.length, 1);
  const merged = areaCells(held, here);
  assert.equal(merged.filter(cell => cell.tone === "held").length, 1);
  assert.equal(merged.filter(cell => cell.tone === "current").length, 0,
    "a held cell is not downgraded to scenery because the player is standing in it");
  assert.equal(merged.at(-1)!.tone, "held", "held paints over context");
  assert.equal(new Set(merged.map(cell => cell.id)).size, merged.length, "no cell drawn twice");

  /* No location, no fabricated grid. */
  assert.deepEqual(areaCells([], null), []);
  assert.deepEqual(areaCells(held, null), held);
});

test("the area diagnostic records event names and timings and never a coordinate", () => {
  let now = 0;
  const timings = createMapAreaTimings(true, () => now);
  timings.begin(false);
  now = 12; timings.permission(true);
  now = 30; timings.seed();
  now = 31; timings.requested();
  now = 900; timings.fix(true);
  const trace = timings.snapshot();
  assert.deepEqual(trace.events, ["auto", "permission_granted", "seed_shown", "fix_requested", "fix_validated"]);
  assert.deepEqual(trace.offsetsMs, [0, 12, 30, 31, 900]);

  /* A new attempt replaces the trace rather than growing it. */
  timings.begin(true);
  assert.deepEqual(timings.snapshot().events, ["tap"]);

  /* Bounded even if something loops. */
  for (let i = 0; i < MAX_EVENTS * 3; i++) timings.seed();
  assert.equal(timings.snapshot().events.length, MAX_EVENTS);

  /* Inert in production. */
  const production = createMapAreaTimings(false, () => now);
  production.begin(true); production.permission(true); production.fix(true);
  assert.deepEqual(production.snapshot(), { events: [], offsetsMs: [] });

  /* And structurally incapable of holding a position: the probe's whole API
     takes booleans. A regression that started passing fixes through it would
     have to change this file. */
  const probe = readFileSync(resolve(__dirname, "../mapAreaTimings.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")   // the doc says these words; the code must not
    .replace(/\/\/.*$/gm, "");
  for (const forbidden of ["latitude", "longitude", "accuracy", "TrackPoint", "coords"]) {
    assert.ok(!probe.includes(forbidden), `the diagnostic must not name ${forbidden}`);
  }
});

test("display position and route evidence stay separate all the way to the screen", () => {
  const session = source("../app/move/session.tsx");

  /* The display channel is the watch's fourth callback and is guarded only by
     cancellation — it must run before the lifecycle is active, which is the
     window the device failure lived in. */
  assert.match(session, /\(p\) => \{ if \(!cancelled\) showLocation\(p\); \}/);

  /* …and it touches no evidence. Everything that measures, seals or banks is
     reached only from the accepted branch of the evidence callback. */
  const displayCallback = session.slice(session.indexOf("(p) => { if (!cancelled) showLocation(p); }"));
  const displayLine = displayCallback.slice(0, displayCallback.indexOf("\n"));
  for (const forbidden of ["pushPoint", "distanceRef", "previewRef", "acceptedRef", "setDistanceM"]) {
    assert.ok(!displayLine.includes(forbidden), `the display channel must not touch ${forbidden}`);
  }

  /* A rejected fix moves neither distance nor the marker — the documented
     decision, pinned so it cannot be quietly reversed. */
  const rejected = session.slice(session.indexOf("if (!decision.accepted)"), session.indexOf("showLocation(p);\n        setSignal"));
  assert.ok(!rejected.includes("showLocation"), "a rejected fix does not move the marker");

  /* `showLocation` is the single writer, and it writes display state only —
     the ref the finish handler reads, and the state the map renders. Anything
     that measured, sealed or banked from here would put a browsing position
     into the game. */
  const writer = session.slice(session.indexOf("const showLocation = useCallback("));
  const writerBody = writer.slice(0, writer.indexOf("}, []);"));
  for (const forbidden of ["pushPoint", "distanceRef", "previewRef", "acceptedRef", "setDistanceM", "setRoutePreview"]) {
    assert.ok(!writerBody.includes(forbidden), `the display writer must not touch ${forbidden}`);
  }

  /* Readiness is derived, never announced. Nothing in this screen may set a
     lock; the only thing that can produce the word is `presenceLabel`. */
  assert.ok(!/setGpsState\(/.test(session), "the screen no longer holds its own readiness opinion");
  assert.match(session, /gpsPresence\(\{\s*acquisition: acquisitionState,\s*displayLocation: head,/);
  assert.ok(!/label="GPS locked"/.test(session));

  /* The map is handed the position as a position. */
  assert.match(session, /currentLocation=\{head\}/);
  assert.match(session, /const head = displayLocation \?\?/);

  /* The finished session carries the position for the summary to draw, and
     `toSubmission` names the fields it sends, so it cannot reach the wire. */
  assert.match(session, /displaySeed: displayLocationRef\.current === null \? null : \{ \.\.\.displayLocationRef\.current \}/);
});

test("the map draws the player from the position input, not from the route", () => {
  const map = source("components/map/MovenMap.tsx");

  /* Marker, camera and waiting overlay all read the position. Keyed to the
     route they said "waiting for your first location fix" to a player whose
     position was already known. */
  assert.match(map, /const point = currentLocation \?\? routeHead\(points\);/);
  assert.match(map, /\{live && head === null \?/);
  assert.ok(!/live && points\.length === 0/.test(map), "the waiting overlay is not a route-length test");
  assert.match(map, /head: live \? head : null/);
  assert.match(map, /\{live && head !== null \? \(\s*<CurrentLocationMarker/);

  /* The start marker stays route evidence: a position is not a start line. */
  assert.match(map, /const point = routeStart\(points\);/);

  /* No fabricated fallback anywhere on the path. */
  for (const forbidden of ["DEFAULT_REGION", "FALLBACK_COORDINATE", "0.0, 0.0"]) {
    assert.ok(!map.includes(forbidden), forbidden);
  }
});
