/**
 * The app's projection of a route onto real geography.
 *
 * Two properties, and they pull in opposite directions, which is why both are
 * here: the cells must be *real* — the same ones the backend derives from the
 * same coordinates — and they must be *only* cells, carrying no ownership, no
 * capture and no claim on the ground they name.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  cellName,
  cellsForRoute,
  currentCell,
  isGameplayCell,
  parseGameplayCell,
} from "../territoryCells";
import { isLegacyLatticeZoneId, newCapturedZone, zoneNameForId } from "../zones";
import type { TrackPoint } from "../geo";

const SRC = join(process.cwd(), "src");
const read = (p: string) => readFileSync(p, "utf8");

/** Committed golden cells, matching `shared/src/domain/__tests__/h3.test.ts`.
 *  Repeated rather than imported so that a change to the shared fixtures
 *  cannot quietly change what the app is asserted to produce. */
const BENGALURU = { latitude: 12.9716, longitude: 77.5946, cell: "8860145b49fffff" };
const BERLIN = { latitude: 52.52, longitude: 13.405, cell: "881f1d4895fffff" };

function point(latitude: number, longitude: number, timestamp = 1_756_000_000_000): TrackPoint {
  return { latitude, longitude, timestamp, accuracy: 8 };
}

/* ── real cells ───────────────────────────────────────────────────────────── */

test("a route yields real H3 cells, not lattice ids", () => {
  const touches = cellsForRoute([point(BENGALURU.latitude, BENGALURU.longitude)]);
  assert.equal(touches.length, 1);
  assert.equal(touches[0].id, BENGALURU.cell);
  assert.ok(isGameplayCell(touches[0].id));
  assert.equal(isLegacyLatticeZoneId(touches[0].id), false);
});

test("cells arrive in first-touch order, each once", () => {
  const touches = cellsForRoute([
    point(BENGALURU.latitude, BENGALURU.longitude),
    point(BERLIN.latitude, BERLIN.longitude),
    point(BENGALURU.latitude, BENGALURU.longitude),
  ]);
  assert.deepEqual(touches.map((t) => t.id), [BENGALURU.cell, BERLIN.cell]);
});

test("an empty route touches nothing", () => {
  assert.deepEqual(cellsForRoute([]), []);
});

test("a malformed sample is skipped, never clamped onto real ground", () => {
  /* The device can emit a bad fix. Dropping it is safe because nothing here
     can invent a cell to stand in for it; clamping to ±90 would silently place
     the player at a pole. */
  const touches = cellsForRoute([
    point(BENGALURU.latitude, BENGALURU.longitude),
    point(NaN, 0),
    point(91, 0),
    point(0, 200),
  ]);
  assert.deepEqual(touches.map((t) => t.id), [BENGALURU.cell]);
});

test("a route of nothing but bad samples produces no cells rather than a fake one", () => {
  assert.deepEqual(cellsForRoute([point(NaN, NaN), point(Infinity, 0)]), []);
});

/* ── no location, no current cell ─────────────────────────────────────────── */

test("no location means no current cell — there is no fallback", () => {
  assert.equal(currentCell(null), null);
  assert.equal(currentCell(undefined), null);
  assert.equal(currentCell(point(NaN, 0)), null);
  assert.equal(currentCell(point(91, 0)), null);
});

test("a usable fix is the cell it is actually in", () => {
  const current = currentCell(point(BERLIN.latitude, BERLIN.longitude));
  assert.equal(current?.id, BERLIN.cell);
});

/* ── raw indexes stay internal ────────────────────────────────────────────── */

test("a cell is presented by a friendly name, never by its index", () => {
  const touches = cellsForRoute([point(BENGALURU.latitude, BENGALURU.longitude)]);
  const { name, id } = touches[0];
  assert.ok(name.length > 0);
  assert.ok(!name.includes(id), "the label must not contain the raw index");
  assert.ok(!/^[0-9a-f]{15}$/.test(name), "the label must not BE the raw index");
  assert.equal(name, cellName(id));
});

test("naming is deterministic and total across both id eras", () => {
  /* The same function names a real cell and an archived lattice id, which is
     what lets a migration describe what it removed without a second namer. */
  assert.equal(zoneNameForId(BENGALURU.cell), zoneNameForId(BENGALURU.cell));
  assert.notEqual(zoneNameForId(BENGALURU.cell), zoneNameForId(BERLIN.cell));
  assert.ok(zoneNameForId("mrx-1qz8x4").length > 0);
});

test("no screen renders a bare cell id", () => {
  /* The board, the sheet and the summary all show `zone.name`. A screen
     reaching for `zone.id` as display text is how `882…fffff` ends up as a
     zone title, so the surfaces that show a zone are checked for it. */
  for (const file of [
    join(process.cwd(), "app", "territory", "map.tsx"),
    join(process.cwd(), "app", "move", "summary.tsx"),
    join(process.cwd(), "app", "zone", "[id].tsx"),
  ]) {
    const src = read(file);
    assert.ok(
      !/<Text[^>]*>\s*\{\s*\w+\.id\s*\}/.test(src),
      `${file} renders a raw id as text`,
    );
  }
});

/* ── a cell is not a claim ────────────────────────────────────────────────── */

test("a touched cell carries an id and a label and nothing else", () => {
  const [touch] = cellsForRoute([point(BENGALURU.latitude, BENGALURU.longitude)]);
  assert.deepEqual(Object.keys(touch).sort(), ["id", "name"]);
  for (const forbidden of [
    "owner", "owned", "captured", "held", "holder", "solid", "shade", "seal",
    "sealed", "strength", "controlPercent", "defensePercent", "deed", "verified",
  ]) {
    assert.ok(!(forbidden in touch), `geography grew a gameplay field: ${forbidden}`);
  }
});

test("deriving cells captures nothing", () => {
  /* The module boundary, checked structurally: this is the file where a cell
     could become a zone, so it must not be able to reach the store. */
  const code = read(join(SRC, "lib", "territoryCells.ts")).replace(
    /\/\*[\s\S]*?\*\/|\/\/.*/g,
    "",
  );
  for (const forbidden of [
    "useGameStore", "captureZone", "newCapturedZone", "defendZones", "fortifyZone",
    "AsyncStorage", "SecureStore",
  ]) {
    assert.ok(
      !new RegExp(`\\b${forbidden}\\b`).test(code),
      `territoryCells reaches for ${forbidden} — deriving geography must not change state`,
    );
  }
});

test("capture is a separate act that takes a cell rather than producing one", () => {
  const [touch] = cellsForRoute([point(BENGALURU.latitude, BENGALURU.longitude)]);
  const zone = newCapturedZone(touch, false);
  assert.equal(zone.id, touch.id, "a captured zone is keyed by the real cell");
  assert.equal(zone.state, "yours");
  /* And the cell itself is untouched by having been captured — the zone is a
     new record beside it, not a mutation of geography. */
  assert.deepEqual(Object.keys(touch).sort(), ["id", "name"]);
});

/* ── legacy recognition, without legacy generation ────────────────────────── */

test("lattice ids are recognisable but no longer producible", () => {
  assert.ok(isLegacyLatticeZoneId("mrx-1qz8x4"));
  assert.ok(isLegacyLatticeZoneId("mrx-0"));
  assert.equal(isLegacyLatticeZoneId(BENGALURU.cell), false);
  assert.equal(isLegacyLatticeZoneId("mrx-"), false);
  assert.equal(isLegacyLatticeZoneId("MRX-1QZ8X4"), false);
  assert.equal(isLegacyLatticeZoneId(null), false);
  assert.equal(isLegacyLatticeZoneId(42), false);

  const zones = read(join(SRC, "lib", "zones.ts"));
  assert.ok(!/export function cellForCoord\b/.test(zones), "the lattice generator is back");
  assert.ok(!/export function zoneIdForCell\b/.test(zones), "the lattice id minter is back");
  assert.ok(!/`mrx-\$\{/.test(zones), "something in zones.ts still mints an mrx- id");
});

test("a lattice id is not geography and never parses as one", () => {
  for (const legacy of ["mrx-1qz8x4", "mrx-0", "mrx-zzzzzz"]) {
    assert.equal(isGameplayCell(legacy), false);
    assert.equal(parseGameplayCell(legacy), null);
  }
});
