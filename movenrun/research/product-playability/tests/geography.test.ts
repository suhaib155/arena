/**
 * Geography acceptance fixtures for the concept overlay (SIMULATED / NOT LIVE).
 * Each test is one row of GEOGRAPHY_ACCEPTANCE_FIXTURES.md.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cellToParent, getResolution, gridDisk, latLngToCell } from "h3-js";
import {
  cellsForZoom, coverageLayers, crossesAntimeridian, diskAround, publicBoard, ringArea, setSmoothing,
  MIN_PUBLIC_CROWD, PUBLIC_RESOLUTION, type CellRecord,
} from "../geography/coverage";
import { conceptContributions, conceptRecords, renderSvg } from "../geography/conceptDataset";

const rec = (cells: string[], state: CellRecord["state"], confirmed = true): CellRecord[] => cells.map((cell) => ({ cell, state, confirmed }));

test("GEO-01 a ring of cells becomes one polygon with a hole", () => {
  setSmoothing(false);
  const centre = latLngToCell(0.5, -25.5, 8);
  const ring = gridDisk(centre, 2).filter((c) => !gridDisk(centre, 0).includes(c));
  const solid = coverageLayers(rec(ring, "solid")).find((l) => l.state === "solid")!;
  assert.equal(solid.fill.length, 1, "one polygon");
  assert.equal(solid.fill[0]!.length, 2, "outer ring plus one hole");
  setSmoothing(true);
});

test("GEO-02 disconnected patches stay separate polygons", () => {
  const a = diskAround(0.5, -25.5, 1), b = diskAround(0.5, -25.45, 1);
  const solid = coverageLayers(rec([...a, ...b], "solid")).find((l) => l.state === "solid")!;
  assert.equal(solid.fill.length, 2);
});

test("GEO-03 antimeridian: rings that cross 180° are unwrapped so they stay contiguous", () => {
  const cells = diskAround(10, 179.999, 2);
  setSmoothing(false);
  const layer = coverageLayers(rec(cells, "solid")).find((l) => l.state === "solid")!;
  setSmoothing(true);
  for (const poly of layer.fill) for (const ring of poly) {
    assert.ok(!crossesAntimeridian(ring), "no 360° jump inside a ring");
    const lngs = ring.map((p) => p[0]);
    assert.ok(Math.max(...lngs) - Math.min(...lngs) < 1, "the patch is narrow, as it is on the ground");
  }
});

test("GEO-04 polar cells produce valid finite rings (pilots will not be polar, but the code must not crash)", () => {
  const cells = diskAround(89.9, 0, 1);
  const layer = coverageLayers(rec(cells, "shade")).find((l) => l.state === "shade")!;
  for (const ring of layer.fill.flat()) for (const [lng, lat] of ring) assert.ok(Number.isFinite(lng) && Number.isFinite(lat));
});

test("GEO-05 shared boundaries: adjacent states partition the cells with no overlap", () => {
  const records = conceptRecords();
  const seen = new Set<string>();
  for (const r of records) { assert.ok(!seen.has(r.cell)); seen.add(r.cell); }
});

test("GEO-06 masked terrain (water, private land) is omitted, never shown as open ground", () => {
  const records = conceptRecords();
  const masked = new Set(records.slice(0, 20).map((r) => r.cell));
  const withMask = coverageLayers(records, { masked });
  const without = coverageLayers(records);
  const area = (ls: typeof without) => ls.flatMap((l) => [...l.fill, ...l.outline]).flat().reduce((s, r) => s + ringArea(r), 0);
  assert.ok(area(withMask) < area(without));
});

test("GEO-07 pending claims are outline only and never filled", () => {
  const layers = coverageLayers(conceptRecords());
  const pending = layers.find((l) => l.state === "pending")!;
  assert.equal(pending.fill.length, 0);
  assert.ok(pending.outline.length > 0);
  // An unconfirmed 'solid' is drawn as outline too: a claim is not shown as confirmed before the server says so.
  const unconfirmed = coverageLayers(rec(diskAround(0.5, -25.5, 1), "solid", false)).find((l) => l.state === "solid")!;
  assert.equal(unconfirmed.fill.length, 0);
});

test("GEO-08 zoom simplification compacts whole parents and never invents coverage", () => {
  const parent = cellToParent(latLngToCell(0.5, -25.5, 8), 7);
  const children = gridDisk(latLngToCell(0.5, -25.5, 8), 3).filter((c) => cellToParent(c, 7) === parent);
  const compacted = cellsForZoom(children, 11);
  assert.ok(compacted.length <= children.length);
  assert.ok(compacted.every((c) => getResolution(c) <= 8));
});

test("GEO-09 display smoothing keeps area within 10% and leaves the cell set untouched", () => {
  const records = conceptRecords();
  setSmoothing(false);
  const raw = coverageLayers(records).find((l) => l.state === "solid")!.fill.flat().reduce((s, r) => s + ringArea(r), 0);
  setSmoothing(true);
  const smooth = coverageLayers(records).find((l) => l.state === "solid")!.fill.flat().reduce((s, r) => s + ringArea(r), 0);
  assert.ok(Math.abs(smooth - raw) / raw < 0.1, `raw ${raw} smooth ${smooth}`);
});

test("GEO-10 public board: coarse areas only, crowd of at least 3, no cells, routes or player ids", () => {
  const board = publicBoard(conceptContributions());
  for (const row of board) {
    assert.equal(getResolution(row.area), PUBLIC_RESOLUTION);
    assert.ok(row.players >= MIN_PUBLIC_CROWD);
    assert.deepEqual(Object.keys(row).sort(), ["area", "players"]);
  }
  const lonely = publicBoard([{ cell: latLngToCell(0.5, -25.5, 8), playerId: "p1" }, { cell: latLngToCell(0.5, -25.5, 8), playerId: "p2" }]);
  assert.deepEqual(lonely, [], "two players is not a crowd; the area is suppressed");
});

test("GEO-11 the concept render is stamped SIMULATED / NOT LIVE and has no place names", () => {
  const svg = renderSvg(conceptRecords());
  assert.ok(svg.includes("SIMULATED / NOT LIVE"));
  assert.ok(!/\b(street|avenue|park|district|city|owner)\b/i.test(svg.replace(/no real place, owner or activity/, "")));
});

test("GEO-12 states are encoded by pattern as well as colour (colour-blind safe)", () => {
  const patterns = coverageLayers(conceptRecords()).map((l) => l.pattern);
  assert.equal(new Set(patterns).size, patterns.length, "every state has a distinct non-colour encoding");
});
