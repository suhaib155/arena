/**
 * Territory API request validation.
 *
 * The important ones are the map-viewport bounds: an unvalidated bounding box
 * is a request to serialise every territory on Earth into one JSON response.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  capFeatures,
  validateCellId,
  validateHistoryLimit,
  validateMapViewport,
} from "./validation.js";
import { TERRITORY_DEFAULTS, type TerritoryConfig } from "../config.js";

const config: TerritoryConfig = { ...TERRITORY_DEFAULTS };

/** A small, valid London viewport. */
const VALID = { west: "-0.11", south: "51.49", east: "-0.09", north: "51.51" };

function expectError(result: ReturnType<typeof validateMapViewport>, pattern: RegExp): void {
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, pattern);
}

// ------------------------------------------------------------- happy path

test("a well-formed viewport parses", () => {
  const result = validateMapViewport(VALID, config);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    { ...result.value, zoom: null },
    { west: -0.11, south: 51.49, east: -0.09, north: 51.51, zoom: null, gridVersion: 2 },
  );
});

test("zoom and gridVersion are optional", () => {
  const result = validateMapViewport({ ...VALID, zoom: "15", gridVersion: "2" }, config);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.zoom, 15);
    assert.equal(result.value.gridVersion, 2);
  }
});

test("gridVersion defaults to the configured territory grid", () => {
  const result = validateMapViewport(VALID, config);
  assert.equal(result.ok && result.value.gridVersion, 2);
});

// ---------------------------------------------------------- missing / junk

test("every bound is required", () => {
  for (const missing of ["west", "south", "east", "north"]) {
    const query: Record<string, unknown> = { ...VALID };
    delete query[missing];
    expectError(validateMapViewport(query, config), new RegExp(`${missing} is required`));
  }
});

test("non-numeric bounds are rejected", () => {
  expectError(validateMapViewport({ ...VALID, west: "west" }, config), /must be a number/);
});

test("repeated query parameters are rejected rather than silently taking one", () => {
  expectError(
    validateMapViewport({ ...VALID, west: ["-0.11", "-0.2"] }, config),
    /must be a single value/,
  );
});

// -------------------------------------------------------------- coordinates

test("out-of-range longitude is rejected", () => {
  expectError(
    validateMapViewport({ ...VALID, west: "-181" }, config),
    /west and east must be between -180 and 180/,
  );
});

test("out-of-range latitude is rejected", () => {
  expectError(
    validateMapViewport({ ...VALID, north: "91" }, config),
    /south and north must be between -90 and 90/,
  );
});

// ----------------------------------------------------------------- ordering

test("inverted west/east ordering is rejected", () => {
  expectError(
    validateMapViewport({ ...VALID, west: "-0.09", east: "-0.11" }, config),
    /west must be less than east/,
  );
});

test("inverted south/north ordering is rejected", () => {
  expectError(
    validateMapViewport({ ...VALID, south: "51.51", north: "51.49" }, config),
    /south must be less than north/,
  );
});

test("a degenerate zero-area viewport is rejected", () => {
  expectError(
    validateMapViewport({ ...VALID, west: "-0.1", east: "-0.1" }, config),
    /west must be less than east/,
  );
});

// ---------------------------------------------------------------- oversize

test("an oversized viewport is rejected", () => {
  expectError(
    validateMapViewport({ west: "-10", south: "40", east: "10", north: "60" }, config),
    /Viewport too large/,
  );
});

test("a whole-planet viewport is rejected", () => {
  expectError(
    validateMapViewport({ west: "-180", south: "-90", east: "180", north: "90" }, config),
    /Viewport too large/,
  );
});

test("the viewport cap is configuration, not a constant", () => {
  const generous = { ...config, maxMapViewportArea: 1000 };
  const result = validateMapViewport({ west: "-10", south: "40", east: "10", north: "60" }, generous);
  assert.equal(result.ok, true);
});

test("a viewport exactly at the limit is accepted", () => {
  // 0.25 x 0.25 = 0.0625, the default cap.
  const result = validateMapViewport(
    { west: "0", south: "0", east: "0.25", north: "0.25" },
    config,
  );
  assert.equal(result.ok, true);
});

// -------------------------------------------------------------- zoom / grid

test("an out-of-range zoom is rejected", () => {
  expectError(validateMapViewport({ ...VALID, zoom: "40" }, config), /zoom must be between/);
});

test("an unknown grid version is rejected", () => {
  expectError(validateMapViewport({ ...VALID, gridVersion: "99" }, config), /Unknown gridVersion/);
});

test("the legacy grid version is a known version and may be requested", () => {
  const result = validateMapViewport({ ...VALID, gridVersion: "1" }, config);
  assert.equal(result.ok && result.value.gridVersion, 1);
});

// ------------------------------------------------------------------ cell id

test("a well-formed cell id is accepted and lowercased", () => {
  const result = validateCellId("892A1008943FFFF");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, "892a1008943ffff");
});

test("junk cell ids are rejected before they reach a query", () => {
  for (const bad of ["", "not-a-cell", "'; DROP TABLE territories; --", "892a1008943fff", "z".repeat(15)]) {
    const result = validateCellId(bad);
    assert.equal(result.ok, false, `${JSON.stringify(bad)} should be rejected`);
  }
});

test("a non-string cell id is rejected", () => {
  assert.equal(validateCellId(undefined).ok, false);
  assert.equal(validateCellId(42).ok, false);
});

// ------------------------------------------------------------------- limits

test("history limit defaults, clamps and validates", () => {
  const defaulted = validateHistoryLimit(undefined);
  assert.equal(defaulted.ok && defaulted.value, 25);
  const clamped = validateHistoryLimit("5000");
  assert.equal(clamped.ok && clamped.value, 100);
  assert.equal(validateHistoryLimit("0").ok, false);
  assert.equal(validateHistoryLimit("-1").ok, false);
  assert.equal(validateHistoryLimit("abc").ok, false);
});

// ------------------------------------------------------------ feature cap

test("feature lists under the cap pass through untouched", () => {
  const items = Array.from({ length: 10 }, (_, i) => i);
  const result = capFeatures(items, config);
  assert.equal(result.truncated, false);
  assert.equal(result.items.length, 10);
  assert.equal(result.total, 10);
});

test("feature lists over the cap are truncated and say so", () => {
  const items = Array.from({ length: config.maxMapFeatures + 500 }, (_, i) => i);
  const result = capFeatures(items, config);
  assert.equal(result.truncated, true);
  assert.equal(result.items.length, config.maxMapFeatures);
  assert.equal(result.total, config.maxMapFeatures + 500);
});
