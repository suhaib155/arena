/**
 * Territory geometry — cells in, map regions out.
 *
 * The claims under test are the ones a map relies on: neighbouring cells come
 * back as one area with no internal edges, a ring of cells keeps its hole,
 * separate areas stay separate, the result does not depend on input order, it
 * carries no cell id, bad input is refused rather than dropped, and the exact
 * outline really contains every cell it was built from.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { gridDisk } from "h3-js";

import { cellCenter, cellForCoordinate, H3DomainError, neighborhood, type H3Cell } from "../h3";
import {
  connectedCellGroups,
  MAX_REGION_CELLS,
  regionsForCells,
  smoothRing,
  TERRITORY_STATES,
  type LngLat,
  type PolygonRings,
} from "../territoryGeometry";

const LONDON = cellForCoordinate({ latitude: 51.5074, longitude: -0.1278 });
const MANCHESTER = cellForCoordinate({ latitude: 53.4808, longitude: -2.2426 });

function inRing([x, y]: LngLat, ring: readonly LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(point: LngLat, polygon: PolygonRings): boolean {
  return inRing(point, polygon[0]) && !polygon.slice(1).some((hole) => inRing(point, hole));
}

const area2 = (ring: readonly LngLat[]) =>
  ring.slice(0, -1).reduce((s, [x, y], i) => s + x * ring[i + 1][1] - ring[i + 1][0] * y, 0);

const lngLat = (cell: H3Cell): LngLat => {
  const c = cellCenter(cell);
  return [c.longitude, c.latitude];
};

test("neighbouring cells merge into one area with one outer ring and no holes", () => {
  const cells = neighborhood(LONDON, 1);
  const { features } = regionsForCells(cells, "covered");
  assert.equal(features.length, 1);
  const [region] = features;
  assert.equal(region.properties.cellCount, 7);
  assert.equal(region.geometry.coordinates.length, 1, "one polygon");
  assert.equal(region.geometry.coordinates[0].length, 1, "no hole");
  const outer = region.geometry.coordinates[0][0];
  assert.deepEqual(outer[0], outer[outer.length - 1], "ring is closed");
  assert.ok(area2(outer) > 0, "outer ring is counter-clockwise (RFC 7946)");
  // The merged outline of 7 hexagons has 18 corners, not 7 × 6 = 42 edges.
  assert.equal(outer.length - 1, 18, "internal cell edges are gone");
  for (const cell of cells) assert.ok(inPolygon(lngLat(cell), region.geometry.coordinates[0]), `contains ${cell}`);
});

test("a ring of cells keeps its hole, and the hole really is outside", () => {
  const ring = neighborhood(LONDON, 1).filter((c) => c !== LONDON);
  const [region] = regionsForCells(ring, "covered").features;
  const polygon = region.geometry.coordinates[0];
  assert.equal(polygon.length, 2, "outer ring plus one hole");
  assert.ok(area2(polygon[1]) < 0, "hole is clockwise");
  assert.ok(!inPolygon(lngLat(LONDON), polygon), "the missing centre is not covered");
  for (const cell of ring) assert.ok(inPolygon(lngLat(cell), polygon));
});

test("separate areas stay separate, sorted the same way whatever the input order", () => {
  const a = regionsForCells([MANCHESTER, LONDON], "covered");
  const b = regionsForCells([LONDON, MANCHESTER, LONDON], "covered");
  assert.equal(a.features.length, 2);
  assert.deepEqual(a, b, "order and duplicates do not change the result");
  assert.notEqual(a.features[0].id, a.features[1].id);
  assert.deepEqual(connectedCellGroups([MANCHESTER, LONDON]).map((g) => g.length), [1, 1]);
});

test("the output carries no cell id: ids are opaque and properties are summary only", () => {
  const cells = neighborhood(LONDON, 2);
  const json = JSON.stringify(regionsForCells(cells, "covered"));
  for (const cell of cells) assert.ok(!json.includes(cell), `no ${cell} in output`);
  const [region] = regionsForCells(cells, "covered").features;
  assert.deepEqual(Object.keys(region.properties).sort(), ["areaKm2", "cellCount", "cellEdgeMeters", "outline", "state"]);
  assert.match(region.id, /^covered-[0-9a-f]{8}-19$/);
  assert.ok(region.properties.cellEdgeMeters > 500 && region.properties.cellEdgeMeters < 560);
  assert.ok(region.properties.areaKm2 > 12 && region.properties.areaKm2 < 13, "19 cells of about 0.66 km²");
});

test("bad input is refused, never dropped", () => {
  assert.throws(() => regionsForCells([LONDON.toUpperCase()], "covered"), H3DomainError, "uppercase is not canonical");
  assert.throws(() => regionsForCells(["89195da49bbffff"], "covered"), H3DomainError, "wrong resolution");
  assert.throws(() => regionsForCells(["zzz", LONDON], "covered"), H3DomainError);
  assert.throws(() => regionsForCells([LONDON], "owned" as never), H3DomainError, "unknown state");
  assert.throws(() => regionsForCells([LONDON], "covered", { outline: "fancy" as never }), H3DomainError);
});

test("the cell limit is enforced before any geometry work", () => {
  const many = gridDisk(LONDON, 41) as H3Cell[];
  assert.ok(many.length > MAX_REGION_CELLS);
  assert.throws(() => regionsForCells(many, "covered"), /more than 5000 cells/);
  assert.equal(regionsForCells(many.slice(0, MAX_REGION_CELLS), "covered").features.length >= 1, true);
});

test("smoothed outlines are labelled, closed, rounder, and stay inside the exact outline's bounds", () => {
  const cells = neighborhood(LONDON, 1);
  const exact = regionsForCells(cells, "covered").features[0];
  const smooth = regionsForCells(cells, "covered", { outline: "smoothed" }).features[0];
  assert.equal(smooth.properties.outline, "smoothed");
  const e = exact.geometry.coordinates[0][0];
  const s = smooth.geometry.coordinates[0][0];
  assert.deepEqual(s[0], s[s.length - 1]);
  assert.equal(s.length - 1, (e.length - 1) * 4, "two Chaikin passes quadruple the corners");
  const [minX, maxX] = [Math.min(...e.map((p) => p[0])), Math.max(...e.map((p) => p[0]))];
  const [minY, maxY] = [Math.min(...e.map((p) => p[1])), Math.max(...e.map((p) => p[1]))];
  for (const [x, y] of s) assert.ok(x >= minX && x <= maxX && y >= minY && y <= maxY);
  assert.equal(smooth.id, exact.id, "same ground, same id");
  assert.deepEqual(smoothRing([[0, 0], [1, 0], [0, 0]]), [[0, 0], [1, 0], [0, 0]], "degenerate rings pass through");
});

test("only covered is a state a server produces today, and it is listed first", () => {
  assert.equal(TERRITORY_STATES[0], "covered");
  assert.deepEqual([...TERRITORY_STATES], ["covered", "held", "contested", "at_risk"]);
});
