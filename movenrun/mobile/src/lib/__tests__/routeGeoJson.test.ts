/**
 * Route → GeoJSON conversion, with coordinate order as the headline invariant.
 *
 * GeoJSON is `[longitude, latitude]`. Every MovenRun point type is
 * `{ latitude, longitude }`. A silent flip produces geometry that still parses,
 * still renders, and is entirely wrong — so these tests assert the actual
 * numbers land in the actual slots, not just that a feature came back.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLiveRouteGeoJson,
  calculateApproximateDistance,
  calculateClosureDistance,
  closeRoutePolygon,
  isValidCoordinate,
  pointsToFeatureCollection,
  pointsToLineString,
  simplifyRouteForRendering,
  toPosition,
} from "../geo/routeGeoJson";
import type { RouteSample } from "../geo/routeSample";

/** London: latitude ~51.5 (positive), longitude ~-0.13 (negative). The signs
 *  differ, so a flipped pair is unmistakable. */
const LONDON = { latitude: 51.5072, longitude: -0.1276 };

function sample(latitude: number, longitude: number, timestamp: number): RouteSample {
  return {
    latitude,
    longitude,
    timestamp,
    accuracy: 8,
    altitude: null,
    altitudeAccuracy: null,
    speed: null,
    heading: null,
    mocked: null,
  };
}

test("toPosition emits [longitude, latitude], not [latitude, longitude]", () => {
  const position = toPosition(LONDON);
  assert.equal(position[0], -0.1276, "index 0 must be longitude");
  assert.equal(position[1], 51.5072, "index 1 must be latitude");
});

test("a LineString's every coordinate is [longitude, latitude]", () => {
  const line = pointsToLineString([
    { latitude: 51.5, longitude: -0.1 },
    { latitude: 51.6, longitude: -0.2 },
    { latitude: 51.7, longitude: -0.3 },
  ]);
  assert.ok(line);
  assert.deepEqual(line.geometry.coordinates, [
    [-0.1, 51.5],
    [-0.2, 51.6],
    [-0.3, 51.7],
  ]);
  // Longitudes are the negative values here; latitudes the ~51 values.
  for (const [lon, lat] of line.geometry.coordinates) {
    assert.ok(lon < 0 && lon > -1, `longitude out of slot: ${lon}`);
    assert.ok(lat > 51 && lat < 52, `latitude out of slot: ${lat}`);
  }
});

test("a closed polygon ring is [longitude, latitude] and repeats its first position", () => {
  const polygon = closeRoutePolygon([
    { latitude: 51.5, longitude: -0.1 },
    { latitude: 51.5, longitude: -0.09 },
    { latitude: 51.51, longitude: -0.09 },
    { latitude: 51.51, longitude: -0.1 },
  ]);
  assert.ok(polygon);
  const ring = polygon.geometry.coordinates[0];
  assert.equal(ring.length, 5, "4 corners + repeated closing position");
  assert.deepEqual(ring[0], [-0.1, 51.5]);
  assert.deepEqual(ring[ring.length - 1], ring[0]);
  for (const [lon, lat] of ring) {
    assert.ok(Math.abs(lon) < 1, `longitude out of slot: ${lon}`);
    assert.ok(lat > 51, `latitude out of slot: ${lat}`);
  }
});

test("an already-closed route is not double-closed", () => {
  const start = { latitude: 51.5, longitude: -0.1 };
  const polygon = closeRoutePolygon([
    start,
    { latitude: 51.5, longitude: -0.09 },
    { latitude: 51.51, longitude: -0.09 },
    start,
  ]);
  assert.ok(polygon);
  assert.equal(polygon.geometry.coordinates[0].length, 4);
});

test("a LineString needs two points; a polygon needs three", () => {
  assert.equal(pointsToLineString([]), null);
  assert.equal(pointsToLineString([LONDON]), null);
  assert.ok(pointsToLineString([LONDON, { latitude: 51.6, longitude: -0.2 }]));

  assert.equal(closeRoutePolygon([LONDON]), null);
  assert.equal(closeRoutePolygon([LONDON, { latitude: 51.6, longitude: -0.2 }]), null);
});

test("a FeatureCollection is empty rather than invalid when the route is too short", () => {
  const collection = pointsToFeatureCollection([LONDON]);
  assert.equal(collection.type, "FeatureCollection");
  assert.deepEqual(collection.features, []);
});

test("invalid coordinates are rejected, including NaN and Infinity", () => {
  assert.ok(isValidCoordinate(51.5, -0.1));
  assert.ok(isValidCoordinate(-90, 180));
  assert.ok(isValidCoordinate(90, -180));
  assert.ok(!isValidCoordinate(91, 0));
  assert.ok(!isValidCoordinate(-91, 0));
  assert.ok(!isValidCoordinate(0, 181));
  assert.ok(!isValidCoordinate(0, -181));
  assert.ok(!isValidCoordinate(Number.NaN, 0));
  assert.ok(!isValidCoordinate(0, Number.POSITIVE_INFINITY));
});

test("invalid points are filtered out of generated geometry", () => {
  const line = pointsToLineString([
    { latitude: 51.5, longitude: -0.1 },
    { latitude: 999, longitude: -0.1 },
    { latitude: 51.6, longitude: -0.2 },
  ]);
  assert.ok(line);
  assert.equal(line.geometry.coordinates.length, 2);
});

test("approximate distance matches a known separation", () => {
  // 0.01° of latitude ≈ 1111 m anywhere on Earth.
  const distance = calculateApproximateDistance([
    { latitude: 51.5, longitude: -0.1 },
    { latitude: 51.51, longitude: -0.1 },
  ]);
  assert.ok(Math.abs(distance - 1111) < 15, `expected ~1111 m, got ${distance}`);
});

test("closure distance measures last point back to first, not to the previous point", () => {
  const closure = calculateClosureDistance([
    { latitude: 51.5, longitude: -0.1 },
    { latitude: 51.51, longitude: -0.1 },
    { latitude: 51.5, longitude: -0.1 },
  ]);
  assert.ok(closure !== null);
  assert.ok(closure < 1, `a returning route should be ~0 m from start, got ${closure}`);
});

test("closure distance is null before there are two points", () => {
  assert.equal(calculateClosureDistance([]), null);
  assert.equal(calculateClosureDistance([LONDON]), null);
});

test("simplification keeps the endpoints and drops only near-collinear points", () => {
  const straight = Array.from({ length: 50 }, (_, i) => ({
    latitude: 51.5 + i * 0.0001,
    longitude: -0.1,
  }));
  const simplified = simplifyRouteForRendering(straight, 4);
  assert.ok(simplified.length < straight.length);
  assert.deepEqual(simplified[0], straight[0]);
  assert.deepEqual(simplified[simplified.length - 1], straight[straight.length - 1]);
});

test("simplification respects the hard vertex ceiling", () => {
  // A jagged route that survives tolerance-based simplification.
  const jagged = Array.from({ length: 3000 }, (_, i) => ({
    latitude: 51.5 + (i % 2 === 0 ? 0.001 : -0.001) + i * 0.00001,
    longitude: -0.1 + i * 0.00001,
  }));
  const simplified = simplifyRouteForRendering(jagged, 1, 300);
  assert.ok(simplified.length <= 300, `expected ≤300 vertices, got ${simplified.length}`);
  assert.deepEqual(simplified[0], jagged[0]);
});

test("simplification never mutates the input array", () => {
  const points = [
    { latitude: 51.5, longitude: -0.1 },
    { latitude: 51.5001, longitude: -0.1 },
    { latitude: 51.502, longitude: -0.1 },
  ];
  const before = JSON.stringify(points);
  simplifyRouteForRendering(points, 4);
  assert.equal(JSON.stringify(points), before);
});

test("live route geometry measures distance and closure on the FULL sample list", () => {
  // A square loop returning to its start; dense enough that simplification bites.
  const samples: RouteSample[] = [];
  let t = 0;
  const corners = [
    [51.5, -0.1],
    [51.5, -0.098],
    [51.502, -0.098],
    [51.502, -0.1],
    [51.5, -0.1],
  ];
  for (let c = 1; c < corners.length; c++) {
    for (let step = 0; step < 40; step++) {
      const ratio = step / 40;
      samples.push(
        sample(
          corners[c - 1][0] + (corners[c][0] - corners[c - 1][0]) * ratio,
          corners[c - 1][1] + (corners[c][1] - corners[c - 1][1]) * ratio,
          (t += 2000),
        ),
      );
    }
  }
  samples.push(sample(51.5, -0.1, (t += 2000)));

  const live = buildLiveRouteGeoJson(samples, { toleranceMeters: 5, maxPoints: 100 });

  assert.ok(live.line);
  assert.ok(live.polygon);
  // Simplified for rendering…
  assert.ok(live.renderedPointCount < samples.length);
  // …but the closure measurement used the raw first and last samples.
  assert.ok(live.closureDistanceMeters !== null);
  assert.ok(live.closureDistanceMeters < 1);
  // Full-resolution distance, not the simplified one.
  assert.equal(
    Math.round(live.distanceMeters),
    Math.round(calculateApproximateDistance(samples)),
  );
});
