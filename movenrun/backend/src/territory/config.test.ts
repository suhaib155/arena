/**
 * Territory configuration validation.
 *
 * The rule under test is "fail closed": a production deployment must never
 * silently fall back to a default after someone mistypes a threshold, because
 * the failure mode is handing out territory (or refusing all of it) with no
 * signal that anything is wrong.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertTerritoryConfig,
  LEGACY_GRID_VERSION,
  LEGACY_H3_RESOLUTION,
  loadTerritoryConfig,
  TERRITORY_DEFAULTS,
} from "./config.js";

test("an empty environment yields the documented defaults", () => {
  const { config, errors } = loadTerritoryConfig({});
  assert.deepEqual(errors, []);
  assert.deepEqual(config, TERRITORY_DEFAULTS);
});

test("defaults match the specified starting values", () => {
  assert.equal(TERRITORY_DEFAULTS.gridVersion, 2);
  assert.equal(TERRITORY_DEFAULTS.resolution, 9);
  assert.equal(TERRITORY_DEFAULTS.minRoutePoints, 40);
  assert.equal(TERRITORY_DEFAULTS.minRouteDistanceMeters, 800);
  assert.equal(TERRITORY_DEFAULTS.minDurationSeconds, 300);
  assert.equal(TERRITORY_DEFAULTS.maxClosureDistanceMeters, 50);
  assert.equal(TERRITORY_DEFAULTS.minAreaSquareMeters, 10_000);
  assert.equal(TERRITORY_DEFAULTS.maxGpsAccuracyMeters, 30);
});

test("the legacy grid constants are not configurable", () => {
  assert.equal(LEGACY_GRID_VERSION, 1);
  assert.equal(LEGACY_H3_RESOLUTION, 8);
});

test("every documented variable is read from the environment", () => {
  const { config, errors } = loadTerritoryConfig({
    TERRITORY_GRID_VERSION: "3",
    TERRITORY_H3_RESOLUTION: "10",
    TERRITORY_MIN_ROUTE_POINTS: "25",
    TERRITORY_MIN_ROUTE_DISTANCE_METERS: "500",
    TERRITORY_MIN_DURATION_SECONDS: "120",
    TERRITORY_MAX_CLOSURE_DISTANCE_METERS: "80",
    TERRITORY_MIN_AREA_SQUARE_METERS: "5000",
    TERRITORY_MAX_AREA_SQUARE_METERS: "1000000",
    TERRITORY_MAX_GPS_ACCURACY_METERS: "25",
    TERRITORY_MAX_SPEED_METERS_PER_SECOND: "10",
    TERRITORY_MAX_MAP_VIEWPORT_AREA: "0.02",
    TERRITORY_MAX_MAP_FEATURES: "500",
  });
  assert.deepEqual(errors, []);
  assert.equal(config.gridVersion, 3);
  assert.equal(config.resolution, 10);
  assert.equal(config.minRoutePoints, 25);
  assert.equal(config.minRouteDistanceMeters, 500);
  assert.equal(config.minDurationSeconds, 120);
  assert.equal(config.maxClosureDistanceMeters, 80);
  assert.equal(config.minAreaSquareMeters, 5_000);
  assert.equal(config.maxAreaSquareMeters, 1_000_000);
  assert.equal(config.maxGpsAccuracyMeters, 25);
  assert.equal(config.maxSpeedMetersPerSecond, 10);
  assert.equal(config.maxMapViewportArea, 0.02);
  assert.equal(config.maxMapFeatures, 500);
});

test("a blank value falls through to the default without an error", () => {
  const { config, errors } = loadTerritoryConfig({ TERRITORY_MIN_ROUTE_POINTS: "   " });
  assert.deepEqual(errors, []);
  assert.equal(config.minRoutePoints, TERRITORY_DEFAULTS.minRoutePoints);
});

test("a non-numeric value is an error, not a silent default", () => {
  const { errors } = loadTerritoryConfig({ TERRITORY_MIN_ROUTE_POINTS: "forty" });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /TERRITORY_MIN_ROUTE_POINTS must be a number/);
});

test("a negative threshold is rejected", () => {
  const { errors } = loadTerritoryConfig({ TERRITORY_MIN_AREA_SQUARE_METERS: "-1" });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /must be greater than 0/);
});

test("a non-integer point count is rejected", () => {
  const { errors } = loadTerritoryConfig({ TERRITORY_MIN_ROUTE_POINTS: "40.5" });
  assert.match(errors[0], /must be a positive integer/);
});

test("an out-of-range H3 resolution is rejected", () => {
  assert.match(
    loadTerritoryConfig({ TERRITORY_H3_RESOLUTION: "16" }).errors[0],
    /between 0 and 15/,
  );
});

test("an inverted area band is rejected", () => {
  const { errors } = loadTerritoryConfig({
    TERRITORY_MIN_AREA_SQUARE_METERS: "900000",
    TERRITORY_MAX_AREA_SQUARE_METERS: "1000",
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /must be below TERRITORY_MAX_AREA_SQUARE_METERS/);
});

test("reusing the legacy grid version for territory is rejected", () => {
  const { errors } = loadTerritoryConfig({ TERRITORY_GRID_VERSION: "1" });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /reserved for the legacy resolution-8/);
});

test("all problems are reported at once, not just the first", () => {
  const { errors } = loadTerritoryConfig({
    TERRITORY_MIN_ROUTE_POINTS: "nope",
    TERRITORY_MIN_DURATION_SECONDS: "-5",
    TERRITORY_MAX_MAP_FEATURES: "0",
  });
  assert.equal(errors.length, 3);
});

test("the startup assertion throws with every problem listed", () => {
  assert.throws(
    () =>
      assertTerritoryConfig({
        TERRITORY_MIN_ROUTE_POINTS: "nope",
        TERRITORY_MIN_DURATION_SECONDS: "-5",
      }),
    (error: Error) => {
      assert.match(error.message, /Invalid territory configuration/);
      assert.match(error.message, /TERRITORY_MIN_ROUTE_POINTS/);
      assert.match(error.message, /TERRITORY_MIN_DURATION_SECONDS/);
      return true;
    },
  );
});

test("the startup assertion passes a valid environment through", () => {
  const config = assertTerritoryConfig({ TERRITORY_MIN_ROUTE_POINTS: "50" });
  assert.equal(config.minRoutePoints, 50);
});
