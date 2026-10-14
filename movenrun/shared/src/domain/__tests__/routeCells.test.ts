/**
 * Route cells — the cells a route crossed, including those between samples.
 *
 * Claims under test: a straight leg with samples only at its ends still yields
 * every cell in between, all of them neighbours in sequence; samples inside one
 * cell add nothing; a gap longer than the bridge limit is left open and
 * counted; the observed cells are always present; bad points are refused.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { areNeighborCells } from "h3-js";
import { cellForCoordinate, cellsForObservations, H3DomainError } from "../h3";
import { cellsAlongRoute, MAX_BRIDGE_METERS } from "../routeCells";
import { haversineMeters } from "../geo";

const A = { latitude: 51.5007, longitude: -0.1246 };
// About 1.8 km east of A: within the bridge limit, several cells away.
const B = { latitude: 51.5007, longitude: -0.0986 };
// About 9 km east of A: beyond the bridge limit.
const FAR = { latitude: 51.5007, longitude: 0.005 };

test("a bridged leg includes the cells between the two samples", () => {
  assert.ok(haversineMeters(A, B) < MAX_BRIDGE_METERS);
  const observed = cellsForObservations([A, B]);
  const route = cellsAlongRoute([A, B]);

  assert.equal(route.cells[0], cellForCoordinate(A));
  assert.equal(route.cells[route.cells.length - 1], cellForCoordinate(B));
  for (const cell of observed) assert.ok(route.cells.includes(cell));
  assert.ok(route.cells.length > observed.length, "cells between the samples are added");
  assert.equal(route.interpolatedCells, route.cells.length - observed.length);
  assert.equal(route.bridgedGaps, 1);
  assert.equal(route.unbridgedGaps, 0);
  for (let i = 1; i < route.cells.length; i++) {
    assert.ok(areNeighborCells(route.cells[i - 1], route.cells[i]), `cell ${i} touches the one before`);
  }
});

test("dense samples need no bridging and add no cells", () => {
  const dense = Array.from({ length: 200 }, (_, i) => ({
    latitude: A.latitude,
    longitude: A.longitude + ((B.longitude - A.longitude) * i) / 199,
  }));
  const route = cellsAlongRoute(dense);
  assert.deepEqual(route.cells, cellsForObservations(dense));
  assert.equal(route.interpolatedCells, 0);
  assert.equal(route.bridgedGaps, 0);
});

test("a gap beyond the bridge limit is left open and counted", () => {
  const route = cellsAlongRoute([A, FAR]);
  assert.deepEqual(route.cells, cellsForObservations([A, FAR]));
  assert.equal(route.unbridgedGaps, 1);
  assert.equal(route.bridgedGaps, 0);
  assert.equal(route.interpolatedCells, 0);

  const zero = cellsAlongRoute([A, B], { maxBridgeMeters: 0 });
  assert.equal(zero.unbridgedGaps, 1);
  assert.equal(zero.interpolatedCells, 0);
});

test("a route that returns lists each cell once", () => {
  const route = cellsAlongRoute([A, B, A]);
  assert.equal(new Set(route.cells).size, route.cells.length);
  assert.equal(route.bridgedGaps, 2);
});

test("empty and single-point routes", () => {
  assert.deepEqual(cellsAlongRoute([]), { cells: [], interpolatedCells: 0, bridgedGaps: 0, unbridgedGaps: 0 });
  assert.deepEqual(cellsAlongRoute([A]).cells, [cellForCoordinate(A)]);
});

test("bad input is refused", () => {
  assert.throws(() => cellsAlongRoute([A, { latitude: 91, longitude: 0 }]), H3DomainError);
  assert.throws(() => cellsAlongRoute([A, B], { maxBridgeMeters: -1 }), RangeError);
  assert.throws(() => cellsAlongRoute([A, B], { maxBridgeMeters: Number.NaN }), RangeError);
});
