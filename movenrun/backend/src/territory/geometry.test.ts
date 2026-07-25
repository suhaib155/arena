/**
 * Territory geometry — coordinate validity, distance, rings, area,
 * self-intersection, point-in-polygon and bounding boxes.
 *
 * Area is checked against independently-known values (a degree of latitude is
 * ~111.32 km everywhere) rather than against the implementation's own output,
 * so a sign or radius error can't pass by agreeing with itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boundingBox,
  getLoopClosureDistanceMeters,
  hasSelfIntersection,
  haversineMeters,
  isClosedLoop,
  isValidCoordinate,
  normalizePolygonCoordinates,
  pointInPolygon,
  polygonAreaSquareMeters,
  ringToPolygonFeature,
  routeDistanceMeters,
  routeToLineString,
  routeToRing,
  type GeoPoint,
  type Ring,
} from "./geometry.js";

const point = (lat: number, lng: number): GeoPoint => ({ lat, lng });

// ------------------------------------------------------------- coordinates

test("coordinate validation accepts the full valid range", () => {
  assert.ok(isValidCoordinate(0, 0));
  assert.ok(isValidCoordinate(90, 180));
  assert.ok(isValidCoordinate(-90, -180));
});

test("coordinate validation rejects out-of-range latitude", () => {
  assert.ok(!isValidCoordinate(90.0001, 0));
  assert.ok(!isValidCoordinate(-90.0001, 0));
  assert.ok(!isValidCoordinate(1000, 0));
});

test("coordinate validation rejects out-of-range longitude", () => {
  assert.ok(!isValidCoordinate(0, 180.0001));
  assert.ok(!isValidCoordinate(0, -180.0001));
});

test("coordinate validation rejects NaN and Infinity", () => {
  assert.ok(!isValidCoordinate(Number.NaN, 0));
  assert.ok(!isValidCoordinate(0, Number.NaN));
  assert.ok(!isValidCoordinate(Number.POSITIVE_INFINITY, 0));
  assert.ok(!isValidCoordinate(0, Number.NEGATIVE_INFINITY));
});

// ---------------------------------------------------------------- distance

test("haversine matches the known length of a degree of latitude", () => {
  const distance = haversineMeters(point(51.5, -0.1), point(52.5, -0.1));
  assert.ok(Math.abs(distance - 111_195) < 500, `expected ~111.2 km, got ${distance}`);
});

test("haversine is zero for identical points and symmetric otherwise", () => {
  const a = point(51.5, -0.1);
  const b = point(51.6, -0.2);
  assert.equal(haversineMeters(a, a), 0);
  assert.equal(haversineMeters(a, b), haversineMeters(b, a));
});

test("route distance sums consecutive legs", () => {
  const total = routeDistanceMeters([point(51.5, -0.1), point(51.51, -0.1), point(51.52, -0.1)]);
  const leg = haversineMeters(point(51.5, -0.1), point(51.51, -0.1));
  assert.ok(Math.abs(total - leg * 2) < 2);
});

// ----------------------------------------------------------------- closure

test("closure distance measures first to last, not last to previous", () => {
  const closure = getLoopClosureDistanceMeters([
    point(51.5, -0.1),
    point(51.52, -0.1),
    point(51.5001, -0.1),
  ]);
  assert.ok(closure !== null);
  assert.ok(closure < 20, `expected a near-closed loop, got ${closure} m`);
});

test("closure distance is null below two points", () => {
  assert.equal(getLoopClosureDistanceMeters([]), null);
  assert.equal(getLoopClosureDistanceMeters([point(51.5, -0.1)]), null);
});

test("a route ending exactly at its start has zero closure distance", () => {
  const start = point(51.5, -0.1);
  assert.equal(getLoopClosureDistanceMeters([start, point(51.51, -0.1), start]), 0);
});

test("closure tolerance is inclusive at its boundary", () => {
  // ~111.2 m apart: inside a 150 m tolerance, outside a 50 m one.
  const route = [point(51.5, -0.1), point(51.52, -0.1), point(51.501, -0.1)];
  assert.ok(isClosedLoop(route, 150));
  assert.ok(!isClosedLoop(route, 50));
});

// -------------------------------------------------------------------- rings

test("routeToRing converts to GeoJSON order and closes the ring", () => {
  const ring = routeToRing([point(51.5, -0.1), point(51.5, -0.09), point(51.51, -0.09)]);
  assert.ok(ring);
  assert.deepEqual(ring[0], [-0.1, 51.5], "position must be [longitude, latitude]");
  assert.equal(ring.length, 4, "3 corners + repeated closing position");
  assert.deepEqual(ring[ring.length - 1], ring[0]);
});

test("routeToRing drops invalid coordinates and consecutive duplicates", () => {
  const ring = routeToRing([
    point(51.5, -0.1),
    point(51.5, -0.1),
    point(999, -0.1),
    point(51.5, -0.09),
    point(51.51, -0.09),
  ]);
  assert.ok(ring);
  assert.equal(ring.length, 4);
});

test("routeToRing returns null when fewer than three distinct corners survive", () => {
  assert.equal(routeToRing([]), null);
  assert.equal(routeToRing([point(51.5, -0.1)]), null);
  assert.equal(routeToRing([point(51.5, -0.1), point(51.5, -0.09)]), null);
  // A route that goes out and comes straight back is a line, not an area.
  assert.equal(routeToRing([point(51.5, -0.1), point(51.5, -0.1), point(51.5, -0.1)]), null);
});

test("an already-closed input is not double-closed", () => {
  const ring = routeToRing([
    point(51.5, -0.1),
    point(51.5, -0.09),
    point(51.51, -0.09),
    point(51.5, -0.1),
  ]);
  assert.ok(ring);
  assert.equal(ring.length, 4);
});

test("normalizePolygonCoordinates round-trips a GeoJSON ring", () => {
  const ring = normalizePolygonCoordinates([
    [-0.1, 51.5],
    [-0.09, 51.5],
    [-0.09, 51.51],
  ]);
  assert.ok(ring);
  assert.deepEqual(ring[0], [-0.1, 51.5]);
  assert.deepEqual(ring[ring.length - 1], ring[0]);
});

// --------------------------------------------------------------------- area

/** A rectangle in degrees, as a closed GeoJSON ring. */
function rectangle(south: number, west: number, north: number, east: number): Ring {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

test("polygon area matches an independently computed rectangle", () => {
  // 0.01° latitude ≈ 1111.95 m; 0.01° longitude at 51.5°N ≈ 692.0 m.
  const ring = rectangle(51.5, -0.1, 51.51, -0.09);
  const expected = 1111.95 * (1111.95 * Math.cos((51.505 * Math.PI) / 180));
  const area = polygonAreaSquareMeters(ring);
  assert.ok(
    Math.abs(area - expected) / expected < 0.01,
    `expected ~${Math.round(expected)} m², got ${Math.round(area)} m²`,
  );
});

test("polygon area is orientation-independent", () => {
  const clockwise = rectangle(51.5, -0.1, 51.51, -0.09);
  const counterClockwise = [...clockwise].reverse();
  assert.ok(
    Math.abs(
      polygonAreaSquareMeters(clockwise) - polygonAreaSquareMeters(counterClockwise),
    ) < 1,
  );
});

test("polygon area is zero for a degenerate ring", () => {
  assert.equal(polygonAreaSquareMeters([]), 0);
  assert.equal(
    polygonAreaSquareMeters([
      [-0.1, 51.5],
      [-0.09, 51.5],
      [-0.1, 51.5],
    ]),
    0,
  );
});

test("area scales roughly quadratically with linear size", () => {
  const small = polygonAreaSquareMeters(rectangle(51.5, -0.1, 51.51, -0.09));
  const doubled = polygonAreaSquareMeters(rectangle(51.5, -0.1, 51.52, -0.08));
  assert.ok(doubled / small > 3.9 && doubled / small < 4.1, `ratio ${doubled / small}`);
});

// ------------------------------------------------------- self-intersection

test("a simple rectangle does not self-intersect", () => {
  assert.equal(hasSelfIntersection(rectangle(51.5, -0.1, 51.51, -0.09)), false);
});

test("a bow-tie ring is detected as self-intersecting", () => {
  const bowTie: Ring = [
    [-0.1, 51.5],
    [-0.09, 51.51],
    [-0.1, 51.51],
    [-0.09, 51.5],
    [-0.1, 51.5],
  ];
  assert.equal(hasSelfIntersection(bowTie), true);
});

test("a figure-of-eight route is detected as self-intersecting", () => {
  const figureEight: Ring = [
    [-0.100, 51.500],
    [-0.098, 51.500],
    [-0.098, 51.502],
    [-0.096, 51.502],
    [-0.096, 51.500],
    [-0.099, 51.500],
    [-0.099, 51.503],
    [-0.100, 51.503],
    [-0.100, 51.500],
  ];
  assert.equal(hasSelfIntersection(figureEight), true);
});

test("adjacent segments sharing an endpoint are not an intersection", () => {
  // A convex polygon: every consecutive pair touches, none of it is a crossing.
  const hexagon: Ring = [
    [-0.100, 51.500],
    [-0.098, 51.499],
    [-0.096, 51.500],
    [-0.096, 51.502],
    [-0.098, 51.503],
    [-0.100, 51.502],
    [-0.100, 51.500],
  ];
  assert.equal(hasSelfIntersection(hexagon), false);
});

test("a long realistic loop does not false-positive and completes quickly", () => {
  // 2000-point circle: convex, so no crossing anywhere.
  const ring: Ring = [];
  for (let i = 0; i < 2000; i++) {
    const angle = (i / 2000) * Math.PI * 2;
    ring.push([-0.1 + 0.004 * Math.cos(angle), 51.5 + 0.004 * Math.sin(angle)]);
  }
  ring.push([ring[0][0], ring[0][1]]);
  const started = Date.now();
  assert.equal(hasSelfIntersection(ring), false);
  assert.ok(Date.now() - started < 4000, "self-intersection sweep should not be quadratic-slow");
});

// -------------------------------------------------- point-in-polygon / bbox

test("point-in-polygon distinguishes inside from outside", () => {
  const ring = rectangle(51.5, -0.1, 51.51, -0.09);
  assert.equal(pointInPolygon([-0.095, 51.505], ring), true);
  assert.equal(pointInPolygon([-0.2, 51.505], ring), false);
  assert.equal(pointInPolygon([-0.095, 51.6], ring), false);
});

test("bounding box spans the ring's extremes", () => {
  const bounds = boundingBox(rectangle(51.5, -0.1, 51.51, -0.09));
  assert.deepEqual(bounds, { west: -0.1, south: 51.5, east: -0.09, north: 51.51 });
});

// ------------------------------------------------------------ GeoJSON shape

test("routeToLineString emits [longitude, latitude] and needs two points", () => {
  assert.equal(routeToLineString([point(51.5, -0.1)]), null);
  const line = routeToLineString([point(51.5, -0.1), point(51.51, -0.09)]);
  assert.ok(line);
  assert.equal(line.geometry.type, "LineString");
  assert.deepEqual(line.geometry.coordinates[0], [-0.1, 51.5]);
});

test("ringToPolygonFeature nests the ring one level deep, as GeoJSON requires", () => {
  const ring = rectangle(51.5, -0.1, 51.51, -0.09);
  const feature = ringToPolygonFeature(ring, { cellId: "abc" });
  assert.equal(feature.geometry.type, "Polygon");
  assert.equal(feature.geometry.coordinates.length, 1);
  assert.deepEqual(feature.geometry.coordinates[0], ring);
  assert.equal(feature.properties.cellId, "abc");
});
