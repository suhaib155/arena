/**
 * Versioned H3 territory grid.
 *
 * The two things that must never drift:
 *  1. The legacy grid stays at resolution 8 — the deployed contracts and the
 *     existing route-proof path depend on it.
 *  2. Coordinate order into and out of h3-js is GeoJSON `[lng, lat]`. h3's own
 *     API defaults to `[lat, lng]`, so every call site here passes the GeoJSON
 *     flag explicitly and these tests prove it took effect.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as h3 from "h3-js";
import {
  assertSameGridVersion,
  cellBoundaryRing,
  cellCenterLatLng,
  cellsInBoundingBox,
  getCapturedHexIdsForLoop,
  getNeighboringCells,
  getTraversedHexIds,
  h3CellsToGeoJsonFeatureCollection,
  h3CellToGeoJsonFeature,
  isCellOnGrid,
  isKnownGridVersion,
  latLngToCell,
  LEGACY_GRID_VERSION,
  LEGACY_H3_RESOLUTION,
  resolutionForGridVersion,
  TERRITORY_GRID_VERSION,
  TERRITORY_H3_RESOLUTION_V2,
  _clearBoundaryCacheForTests,
} from "./h3.js";
import type { Ring } from "./geometry.js";

/** A block-sized rectangle in central London, as a closed GeoJSON ring. */
const LONDON_BLOCK: Ring = [
  [-0.1, 51.5],
  [-0.096, 51.5],
  [-0.096, 51.503],
  [-0.1, 51.503],
  [-0.1, 51.5],
];

// ------------------------------------------------------------ grid versions

test("the legacy grid stays at resolution 8", () => {
  assert.equal(LEGACY_GRID_VERSION, 1);
  assert.equal(LEGACY_H3_RESOLUTION, 8);
  assert.equal(resolutionForGridVersion(LEGACY_GRID_VERSION), 8);
});

test("territory ownership uses grid version 2 at resolution 9", () => {
  assert.equal(TERRITORY_GRID_VERSION, 2);
  assert.equal(TERRITORY_H3_RESOLUTION_V2, 9);
  assert.equal(resolutionForGridVersion(TERRITORY_GRID_VERSION), 9);
});

test("the two grids are distinct — v2 must never reuse the legacy resolution", () => {
  assert.notEqual(TERRITORY_H3_RESOLUTION_V2, LEGACY_H3_RESOLUTION);
  assert.notEqual(TERRITORY_GRID_VERSION, LEGACY_GRID_VERSION);
});

test("unknown grid versions have no resolution", () => {
  assert.equal(resolutionForGridVersion(99), null);
  assert.equal(isKnownGridVersion(99), false);
  assert.equal(isKnownGridVersion(TERRITORY_GRID_VERSION), true);
});

test("mixing cells from different grid versions throws loudly", () => {
  assert.doesNotThrow(() => assertSameGridVersion(2, 2, "test"));
  assert.throws(
    () => assertSameGridVersion(2, 1, "capture merge"),
    /grid version mismatch in capture merge/i,
  );
});

test("legacy resolution-8 behaviour is unchanged by the territory grid", () => {
  // The exact call the pre-existing HexService makes.
  const legacyCell = h3.latLngToCell(51.5, -0.1, LEGACY_H3_RESOLUTION);
  assert.equal(h3.getResolution(legacyCell), 8);
  // The territory grid produces a *different* cell for the same coordinate.
  const territoryCell = latLngToCell(51.5, -0.1, TERRITORY_H3_RESOLUTION_V2);
  assert.ok(territoryCell);
  assert.notEqual(territoryCell, legacyCell);
  assert.equal(h3.getResolution(territoryCell), 9);
});

test("a v2 cell is not on the legacy grid, and vice versa", () => {
  const territoryCell = latLngToCell(51.5, -0.1, TERRITORY_H3_RESOLUTION_V2)!;
  const legacyCell = h3.latLngToCell(51.5, -0.1, LEGACY_H3_RESOLUTION);
  assert.ok(isCellOnGrid(territoryCell, TERRITORY_H3_RESOLUTION_V2));
  assert.ok(!isCellOnGrid(territoryCell, LEGACY_H3_RESOLUTION));
  assert.ok(isCellOnGrid(legacyCell, LEGACY_H3_RESOLUTION));
  assert.ok(!isCellOnGrid(legacyCell, TERRITORY_H3_RESOLUTION_V2));
});

test("an invalid cell id is on no grid", () => {
  assert.equal(isCellOnGrid("not-a-cell", 9), false);
});

// ------------------------------------------------------------- lat/lng → cell

test("latLngToCell rejects invalid coordinates rather than throwing", () => {
  assert.equal(latLngToCell(999, 0, 9), null);
  assert.equal(latLngToCell(0, 999, 9), null);
  assert.equal(latLngToCell(Number.NaN, 0, 9), null);
});

test("traversed cells are distinct and in first-visit order", () => {
  const points = [
    { lat: 51.5, lng: -0.1 },
    { lat: 51.5, lng: -0.1 }, // same cell again
    { lat: 51.505, lng: -0.1 },
    { lat: 51.5, lng: -0.1 }, // back to the first cell
  ];
  const traversed = getTraversedHexIds(points, TERRITORY_H3_RESOLUTION_V2);
  assert.equal(new Set(traversed).size, traversed.length, "no duplicates");
  assert.equal(traversed[0], latLngToCell(51.5, -0.1, TERRITORY_H3_RESOLUTION_V2));
  assert.ok(traversed.length >= 2);
});

test("traversed cells skip invalid points instead of failing the whole route", () => {
  const traversed = getTraversedHexIds(
    [
      { lat: 51.5, lng: -0.1 },
      { lat: 999, lng: -0.1 },
      { lat: 51.51, lng: -0.1 },
    ],
    TERRITORY_H3_RESOLUTION_V2,
  );
  assert.equal(traversed.length, 2);
});

// ---------------------------------------------------------- polygon → cells

test("polygonToCells is called with GeoJSON order, so the cells land in London", () => {
  const cells = getCapturedHexIdsForLoop(LONDON_BLOCK, TERRITORY_H3_RESOLUTION_V2);
  assert.ok(cells.length > 0, "a block-sized loop should enclose at least one cell");
  for (const cell of cells) {
    const [lat, lng] = cellCenterLatLng(cell);
    assert.ok(lat > 51.49 && lat < 51.51, `cell latitude ${lat} is not in London`);
    assert.ok(lng > -0.11 && lng < -0.09, `cell longitude ${lng} is not in London`);
  }
});

test("a flipped ring would land somewhere else entirely — order is not cosmetic", () => {
  const flipped: Ring = LONDON_BLOCK.map(([lng, lat]) => [lat, lng] as [number, number]);
  const correct = getCapturedHexIdsForLoop(LONDON_BLOCK, TERRITORY_H3_RESOLUTION_V2);
  const wrong = getCapturedHexIdsForLoop(flipped, TERRITORY_H3_RESOLUTION_V2);
  // Whatever the flipped ring yields, it must not be the London cells.
  for (const cell of wrong) assert.ok(!correct.includes(cell));
});

test("every captured cell sits at the configured resolution", () => {
  for (const cell of getCapturedHexIdsForLoop(LONDON_BLOCK, TERRITORY_H3_RESOLUTION_V2)) {
    assert.equal(h3.getResolution(cell), TERRITORY_H3_RESOLUTION_V2);
  }
});

test("a degenerate ring captures nothing", () => {
  assert.deepEqual(getCapturedHexIdsForLoop([], TERRITORY_H3_RESOLUTION_V2), []);
  assert.deepEqual(
    getCapturedHexIdsForLoop([[-0.1, 51.5], [-0.09, 51.5]], TERRITORY_H3_RESOLUTION_V2),
    [],
  );
});

test("enclosed cells and traversed cells are genuinely different sets", () => {
  // A route tracing only the ring's edge, versus the cells the ring encloses.
  const edgePoints = LONDON_BLOCK.map(([lng, lat]) => ({ lat, lng }));
  const traversed = getTraversedHexIds(edgePoints, TERRITORY_H3_RESOLUTION_V2);
  const enclosed = getCapturedHexIdsForLoop(LONDON_BLOCK, TERRITORY_H3_RESOLUTION_V2);
  assert.notDeepEqual(new Set(traversed), new Set(enclosed));
});

// --------------------------------------------------------------- boundaries

test("a cell boundary is a closed GeoJSON ring in [lng, lat] order", () => {
  _clearBoundaryCacheForTests();
  const cell = latLngToCell(51.5, -0.1, TERRITORY_H3_RESOLUTION_V2)!;
  const ring = cellBoundaryRing(cell);
  assert.ok(ring.length >= 7, "a hexagon has 6 corners plus the repeated close");
  assert.deepEqual(ring[ring.length - 1], ring[0], "ring must be closed");
  for (const [lng, lat] of ring) {
    assert.ok(lng > -0.11 && lng < -0.09, `longitude out of slot: ${lng}`);
    assert.ok(lat > 51.49 && lat < 51.51, `latitude out of slot: ${lat}`);
  }
});

test("cell boundaries are cached and the cache returns identical rings", () => {
  _clearBoundaryCacheForTests();
  const cell = latLngToCell(51.5, -0.1, TERRITORY_H3_RESOLUTION_V2)!;
  const first = cellBoundaryRing(cell);
  const second = cellBoundaryRing(cell);
  assert.equal(first, second, "second call should hit the cache, not rebuild");
});

test("a cell feature carries its own cellId plus supplied properties", () => {
  const cell = latLngToCell(51.5, -0.1, TERRITORY_H3_RESOLUTION_V2)!;
  const feature = h3CellToGeoJsonFeature(cell, { relationship: "mine", controlScore: 7 });
  assert.equal(feature.type, "Feature");
  assert.equal(feature.id, cell);
  assert.equal(feature.properties.cellId, cell);
  assert.equal(feature.properties.relationship, "mine");
  assert.equal(feature.properties.controlScore, 7);
  assert.equal(feature.geometry.coordinates.length, 1);
});

test("a feature collection maps every cell exactly once", () => {
  const cells = getCapturedHexIdsForLoop(LONDON_BLOCK, TERRITORY_H3_RESOLUTION_V2);
  const collection = h3CellsToGeoJsonFeatureCollection(cells, (id) => ({ state: "neutral", id }));
  assert.equal(collection.type, "FeatureCollection");
  assert.equal(collection.features.length, cells.length);
  assert.deepEqual(
    collection.features.map((f) => f.id),
    cells,
  );
  assert.equal(collection.features[0].properties.state, "neutral");
});

// ---------------------------------------------------------------- neighbours

test("a cell has six ring-1 neighbours and is not its own neighbour", () => {
  const cell = latLngToCell(51.5, -0.1, TERRITORY_H3_RESOLUTION_V2)!;
  const neighbours = getNeighboringCells(cell);
  assert.equal(neighbours.length, 6);
  assert.ok(!neighbours.includes(cell));
  for (const neighbour of neighbours) {
    assert.equal(h3.getResolution(neighbour), TERRITORY_H3_RESOLUTION_V2);
  }
});

test("neighbours of an invalid cell is empty, not a throw", () => {
  assert.deepEqual(getNeighboringCells("not-a-cell"), []);
});

// ------------------------------------------------------------ viewport cells

test("bounding-box cells stay inside the requested box", () => {
  const bounds = { west: -0.1, south: 51.5, east: -0.09, north: 51.51 };
  const cells = cellsInBoundingBox(bounds, TERRITORY_H3_RESOLUTION_V2);
  assert.ok(cells.length > 0);
  for (const cell of cells) {
    const [lat, lng] = cellCenterLatLng(cell);
    assert.ok(lng >= bounds.west && lng <= bounds.east, `longitude ${lng} outside box`);
    assert.ok(lat >= bounds.south && lat <= bounds.north, `latitude ${lat} outside box`);
  }
});

test("a larger viewport yields strictly more cells", () => {
  const small = cellsInBoundingBox({ west: -0.1, south: 51.5, east: -0.09, north: 51.51 }, 9);
  const large = cellsInBoundingBox({ west: -0.12, south: 51.48, east: -0.07, north: 51.53 }, 9);
  assert.ok(large.length > small.length);
});
