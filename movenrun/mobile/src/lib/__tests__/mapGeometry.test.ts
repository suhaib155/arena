/**
 * What the map is allowed to draw, and where it points the camera.
 *
 * The rule under test throughout is the one in `lib/mapGeometry.ts`: a span the
 * device did not observe is never drawn as a line. Everything else here is
 * viewport arithmetic, which matters only because a wrong viewport is how a
 * real route ends up displayed over grey nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PADDING_RATIO,
  MIN_SPAN_DEGREES,
  boundsOf,
  isolatedFixes,
  polylineSegments,
  regionAround,
  regionForBounds,
  regionForPoints,
  redactEndpoints,
  regionsClose,
  routeHead,
  routeStart,
  routeSegments,
} from "@/lib/mapGeometry";
import { contextCells, currentCellKey, touchedCells } from "@/lib/mapCells";
import { haversineMeters } from "@movenrun/shared/geo";
import type { TrackPoint } from "@/lib/geo";

function fix(
  latitude: number,
  longitude: number,
  timestamp: number,
  extra: Partial<TrackPoint> = {},
): TrackPoint {
  return { latitude, longitude, timestamp, accuracy: 5, ...extra };
}

/* A short straight walk, one fix per second, ~11 m apart. */
function walk(count: number, startTs = 1_000): TrackPoint[] {
  return Array.from({ length: count }, (_, i) =>
    fix(51.5 + i * 0.0001, -0.12, startTs + i * 1000),
  );
}

/* ── the rule: a gap is never bridged ─────────────────────────────────────── */

test("a continuous route is one segment", () => {
  const segments = routeSegments(walk(5));
  assert.equal(segments.length, 1);
  assert.equal(segments[0]!.length, 5);
});

test("breakBefore splits the route, and nothing joins the halves", () => {
  const points = walk(6);
  points[3] = { ...points[3]!, breakBefore: true };

  const segments = routeSegments(points);
  assert.equal(segments.length, 2, "the break must end a segment");
  assert.deepEqual(
    segments.map((s) => s.length),
    [3, 3],
  );
  /* The decisive property: no drawn segment contains both the fix before the
     break and the fix after it, so no polyline can span the missing stretch. */
  for (const segment of segments) {
    const hasBefore = segment.includes(points[2]!);
    const hasAfter = segment.includes(points[3]!);
    assert.ok(!(hasBefore && hasAfter), "a segment bridges the gap");
  }
});

test("a pause splits the route even when no point is flagged", () => {
  /* The other source of a break: the player paused, so the fixes either side
     are continuous as far as the device knows and discontinuous as far as the
     session is concerned. The domain owns this rule; the map obeys it. */
  const points = walk(6);
  const pauses = [{ startedAt: points[2]!.timestamp + 1, endedAt: points[3]!.timestamp - 1 }];

  assert.equal(routeSegments(points, pauses).length, 2);
  assert.equal(routeSegments(points).length, 1, "without the pause it is one route");
});

test("several breaks produce several segments", () => {
  const points = walk(9);
  points[3] = { ...points[3]!, breakBefore: true };
  points[6] = { ...points[6]!, breakBefore: true };
  assert.deepEqual(
    routeSegments(points).map((s) => s.length),
    [3, 3, 3],
  );
});

test("a break on the first fix is not a break — there is nothing before it", () => {
  const points = walk(4);
  points[0] = { ...points[0]!, breakBefore: true };
  assert.equal(routeSegments(points).length, 1);
});

test("polylines need two points; lone fixes are reported separately", () => {
  const points = walk(5);
  /* Isolate the middle fix: a break before it and a break after it. */
  points[2] = { ...points[2]!, breakBefore: true };
  points[3] = { ...points[3]!, breakBefore: true };

  const lines = polylineSegments(points);
  const strays = isolatedFixes(points);

  assert.equal(lines.length, 2, "two drawable spans");
  assert.equal(strays.length, 1, "and one observation that is not a line");
  assert.deepEqual(strays[0], { latitude: points[2]!.latitude, longitude: points[2]!.longitude });

  /* Every observed fix is accounted for by exactly one of the two, so nothing
     the tracker accepted is silently dropped from the map. */
  const drawn = lines.reduce((n, line) => n + line.length, 0) + strays.length;
  assert.equal(drawn, points.length);
});

test("an empty route draws nothing at all", () => {
  assert.deepEqual(routeSegments([]), []);
  assert.deepEqual(polylineSegments([]), []);
  assert.deepEqual(isolatedFixes([]), []);
  assert.equal(boundsOf([]), null);
  assert.equal(regionForPoints([]), null);
  assert.equal(routeHead([]), null);
  assert.equal(routeStart([]), null);
});

test("polyline coordinates carry only position", () => {
  /* A timestamp or an accuracy handed to the provider is location metadata
     going somewhere it is not needed. */
  const [line] = polylineSegments(walk(3));
  for (const coordinate of line!) {
    assert.deepEqual(Object.keys(coordinate).sort(), ["latitude", "longitude"]);
  }
});

/* ── viewports ────────────────────────────────────────────────────────────── */

test("bounds contain every point and ignore non-finite ones", () => {
  const bounds = boundsOf([
    { latitude: 10, longitude: 20 },
    { latitude: -5, longitude: 40 },
    { latitude: Number.NaN, longitude: 0 },
    { latitude: 3, longitude: Number.POSITIVE_INFINITY },
  ])!;
  assert.equal(bounds.minLatitude, -5);
  assert.equal(bounds.maxLatitude, 10);
  assert.equal(bounds.minLongitude, 20);
  assert.equal(bounds.maxLongitude, 40);
});

test("bounds of only unusable points are no bounds", () => {
  assert.equal(boundsOf([{ latitude: Number.NaN, longitude: Number.NaN }]), null);
});

test("a stationary route still gets a viewport with real ground in it", () => {
  /* Two identical fixes have zero span. Without a floor the camera zooms past
     the deepest tile level and the player sees a route on grey. */
  const region = regionForPoints([
    { latitude: 51.5, longitude: -0.12 },
    { latitude: 51.5, longitude: -0.12 },
  ])!;
  assert.ok(region.latitudeDelta >= MIN_SPAN_DEGREES);
  assert.ok(region.longitudeDelta >= MIN_SPAN_DEGREES);
  assert.equal(region.latitude, 51.5);
  assert.equal(region.longitude, -0.12);
});

test("the viewport is centred on the route and padded beyond it", () => {
  const region = regionForBounds({
    minLatitude: 0,
    maxLatitude: 1,
    minLongitude: 0,
    maxLongitude: 1,
  });
  assert.equal(region.latitude, 0.5);
  assert.equal(region.longitude, 0.5);
  assert.ok(region.latitudeDelta > 1, "the route must not touch the frame");
  assert.equal(region.latitudeDelta, 1 * (1 + DEFAULT_PADDING_RATIO));
});

test("longitude is widened with latitude so the view is not squeezed", () => {
  /* One degree of longitude is a smaller distance on the ground the further
     from the equator you are. An unadjusted box would show far less width than
     height at the latitudes people actually walk at. */
  const equator = regionForBounds({
    minLatitude: 0, maxLatitude: 0, minLongitude: 0, maxLongitude: 0,
  });
  const north = regionForBounds({
    minLatitude: 60, maxLatitude: 60, minLongitude: 0, maxLongitude: 0,
  });
  assert.ok(
    north.longitudeDelta > equator.longitudeDelta * 1.9,
    "a 60° latitude viewport must be about twice as wide in degrees",
  );
});

test("the widening does not run away at the poles", () => {
  const polar = regionForBounds({
    minLatitude: 89.999, maxLatitude: 89.999, minLongitude: 0, maxLongitude: 0,
  });
  assert.ok(Number.isFinite(polar.longitudeDelta));
  assert.ok(polar.longitudeDelta <= MIN_SPAN_DEGREES * 20 + 1e-9);
});

test("the follow viewport spans roughly the radius asked for", () => {
  const region = regionAround({ latitude: 0, longitude: 0 }, 140);
  /* 280 m of latitude ≈ 0.00251°. */
  assert.ok(Math.abs(region.latitudeDelta - 0.00251) < 0.0002, `got ${region.latitudeDelta}`);
});

test("near-identical viewports are not worth a camera command", () => {
  const a = { latitude: 51.5, longitude: -0.12, latitudeDelta: 0.002, longitudeDelta: 0.003 };
  assert.ok(regionsClose(a, { ...a, latitude: a.latitude + 1e-7 }));
  assert.ok(!regionsClose(a, { ...a, latitude: a.latitude + 0.01 }));
  assert.ok(regionsClose(null, null), "no viewport equals no viewport");
  assert.ok(!regionsClose(a, null));
});

/* ── privacy redaction ────────────────────────────────────────────────────── */

test("both ends of a shared route are hidden", () => {
  /* 40 fixes ~11 m apart: a ~430 m straight line. A 100 m radius should take
     roughly nine fixes off each end and leave the middle. */
  const points = walk(40);
  const kept = redactEndpoints(points, 100);

  assert.ok(kept.length > 0 && kept.length < points.length, `kept ${kept.length}`);
  assert.ok(
    haversineMeters(points[0]!, kept[0]!) > 100,
    "the first surviving fix is still inside the hidden radius",
  );
  assert.ok(
    haversineMeters(points[points.length - 1]!, kept[kept.length - 1]!) > 100,
    "the last surviving fix is still inside the hidden radius",
  );
});

test("redaction never leaves a line pointing at what it hid", () => {
  /* The failure this guards: filtering points out leaves two survivors that
     were never adjacent, and a naive polyline joins them with a straight line
     across the removed ground — aimed directly at the hidden address. */
  const points = walk(40);
  const kept = redactEndpoints(points, 100);
  const removedInTheMiddle = kept.some((point) => point.breakBefore === true);

  const before = polylineSegments(points);
  const after = polylineSegments(kept);
  assert.equal(before.length, 1, "the original is one unbroken line");
  if (removedInTheMiddle) {
    assert.ok(after.length > 1, "a redacted middle must break the drawn line");
  }
  /* Whatever survived, no drawn coordinate may sit inside a hidden zone. */
  for (const segment of after) {
    for (const coordinate of segment) {
      assert.ok(haversineMeters(points[0]!, coordinate) > 100);
      assert.ok(haversineMeters(points[points.length - 1]!, coordinate) > 100);
    }
  }
});

test("an out-and-back that passes home mid-route hides that pass too", () => {
  /* The reason redaction is a radius and not a trim of the first and last N
     points: a loop back past the door would otherwise survive in the middle. */
  const out = walk(20);
  const back = out
    .slice(0, 19)
    .reverse()
    .map((point, i) => ({ ...point, timestamp: out[19]!.timestamp + (i + 1) * 1000 }));
  const there = [...out, ...back];

  const kept = redactEndpoints(there, 100);
  for (const point of kept) {
    assert.ok(
      haversineMeters(there[0]!, point) > 100,
      "a mid-route pass through the hidden zone survived",
    );
  }
});

test("a route entirely inside the hidden radius shares nothing", () => {
  const kept = redactEndpoints(walk(4), 5_000);
  assert.deepEqual(kept, [], "the map must be empty rather than partly revealing");
  assert.deepEqual(polylineSegments(kept), []);
});

test("a zero radius redacts nothing, and an empty route stays empty", () => {
  const points = walk(5);
  assert.deepEqual(redactEndpoints(points, 0), points);
  assert.deepEqual(redactEndpoints([], 200), []);
});

test("redaction does not mutate the route it was given", () => {
  /* The summary and the share preview read the same in-memory session. */
  const points = walk(30);
  const snapshot = JSON.parse(JSON.stringify(points));
  redactEndpoints(points, 100);
  assert.deepEqual(points, snapshot);
});

/* ── H3 context ───────────────────────────────────────────────────────────── */

test("the grid around the player is the cell plus one ring, current last", () => {
  const cells = contextCells(fix(51.5007, -0.1246, 1_000));
  assert.ok(cells.length >= 6 && cells.length <= 7, `unexpected ring size ${cells.length}`);

  const current = cells.filter((cell) => cell.tone === "current");
  assert.equal(current.length, 1, "exactly one cell is the one the player is in");
  assert.equal(cells[cells.length - 1]!.tone, "current", "it must paint over its neighbours");
  assert.ok(
    cells.slice(0, -1).every((cell) => cell.tone === "context"),
    "neighbours are context and nothing stronger",
  );

  const ids = new Set(cells.map((cell) => cell.id as string));
  assert.equal(ids.size, cells.length, "a cell must not be drawn twice");
});

test("no fix means no grid — never a last-known or fallback cell", () => {
  assert.deepEqual(contextCells(null), []);
  assert.deepEqual(contextCells(undefined), []);
  assert.equal(currentCellKey(null), null);
  assert.deepEqual(contextCells(fix(Number.NaN, Number.NaN, 1_000)), []);
});

test("the memo key changes only when the player changes cell", () => {
  /* This is what stops the overlay rebuilding on every GPS fix. */
  const a = currentCellKey(fix(51.5007, -0.1246, 1_000));
  const b = currentCellKey(fix(51.50071, -0.12461, 2_000));
  assert.equal(a, b, "a metre of movement is the same ground");

  const far = currentCellKey(fix(48.8566, 2.3522, 3_000));
  assert.notEqual(a, far, "a different city is different ground");
});

test("a finished route's cells are evidence of movement, never a holding", () => {
  const cells = touchedCells([{ id: "8a1fb46622dffff" as never }]);
  assert.deepEqual(
    cells.map((cell) => cell.tone),
    ["touched"],
  );
  assert.ok(
    !cells.some((cell) => cell.tone === "held"),
    "walking through ground is not holding it",
  );
});
