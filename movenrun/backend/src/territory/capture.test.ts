/**
 * Closed-loop capture evaluation.
 *
 * Every test starts from one known-good loop and breaks exactly one thing, so a
 * failure names the requirement that regressed. The loop is a 250 m square in
 * central London: 1 km of running over ~6.7 minutes enclosing ~62 500 m².
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateLoopCapture, assessRouteQuality, type CaptureRejectionReason } from "./capture.js";
import { TERRITORY_DEFAULTS, type TerritoryConfig } from "./config.js";
import type { GeoPoint } from "./geometry.js";

const config: TerritoryConfig = { ...TERRITORY_DEFAULTS };

const START_TIME = 1_700_000_000_000;
/** 6 min 40 s — comfortably over the 5-minute minimum. */
const DURATION_MS = 400_000;

const LAT0 = 51.5;
const LNG0 = -0.1;
/** 250 m expressed in degrees at 51.5°N. */
const LAT_STEP = 250 / 111_320;
const LNG_STEP = 250 / (111_320 * Math.cos((LAT0 * Math.PI) / 180));

/**
 * A closed square loop: 15 samples per side plus the closing point, evenly
 * spaced in time. ~1 km at ~2.5 m/s.
 */
function squareLoop(
  options: { pointsPerSide?: number; scale?: number; accuracy?: number; durationMs?: number } = {},
): GeoPoint[] {
  const pointsPerSide = options.pointsPerSide ?? 15;
  const scale = options.scale ?? 1;
  const accuracy = options.accuracy ?? 8;
  const durationMs = options.durationMs ?? DURATION_MS;

  const corners: [number, number][] = [
    [LAT0, LNG0],
    [LAT0, LNG0 + LNG_STEP * scale],
    [LAT0 + LAT_STEP * scale, LNG0 + LNG_STEP * scale],
    [LAT0 + LAT_STEP * scale, LNG0],
    [LAT0, LNG0],
  ];

  const points: GeoPoint[] = [];
  for (let side = 0; side < 4; side++) {
    const [fromLat, fromLng] = corners[side];
    const [toLat, toLng] = corners[side + 1];
    for (let step = 0; step < pointsPerSide; step++) {
      const ratio = step / pointsPerSide;
      points.push({
        lat: fromLat + (toLat - fromLat) * ratio,
        lng: fromLng + (toLng - fromLng) * ratio,
        accuracy,
        timestamp: 0, // filled in below
      });
    }
  }
  points.push({ lat: LAT0, lng: LNG0, accuracy, timestamp: 0 });

  const interval = durationMs / (points.length - 1);
  return points.map((point, index) => ({
    ...point,
    timestamp: START_TIME + Math.round(index * interval),
  }));
}

function evaluate(points: GeoPoint[], overrides: Partial<TerritoryConfig> = {}) {
  const endTime = points[points.length - 1].timestamp ?? START_TIME + DURATION_MS;
  return evaluateLoopCapture(
    { points, startTime: points[0].timestamp ?? START_TIME, endTime },
    { ...config, ...overrides },
  );
}

function assertRejectedFor(
  result: ReturnType<typeof evaluate>,
  reason: CaptureRejectionReason,
): void {
  assert.equal(result.captureEligible, false);
  assert.ok(
    result.captureRejectionReasons.includes(reason),
    `expected ${reason}, got [${result.captureRejectionReasons.join(", ")}]`,
  );
}

// --------------------------------------------------------------- happy path

test("a valid closed loop is capture-eligible", () => {
  const result = evaluate(squareLoop());
  assert.deepEqual(result.captureRejectionReasons, []);
  assert.equal(result.captureEligible, true);
  assert.equal(result.loopClosed, true);
  assert.equal(result.closureDistanceMeters, 0);
  assert.ok(result.capturedHexIds.length > 0);
  assert.ok(result.traversedHexIds.length > 0);
});

test("an eligible capture reports the configured grid version and resolution", () => {
  const result = evaluate(squareLoop());
  assert.equal(result.captureGridVersion, 2);
  assert.equal(result.captureResolution, 9);
});

test("the server recomputes distance and area rather than trusting input", () => {
  const result = evaluate(squareLoop());
  assert.ok(
    Math.abs(result.distanceMeters - 1000) < 30,
    `expected ~1000 m of running, got ${Math.round(result.distanceMeters)}`,
  );
  assert.ok(
    Math.abs(result.enclosedAreaSquareMeters - 62_500) < 2_000,
    `expected ~62 500 m², got ${Math.round(result.enclosedAreaSquareMeters)}`,
  );
  assert.ok(result.bounds !== null);
});

test("a final point exactly at the start closes the loop", () => {
  const result = evaluate(squareLoop());
  assert.equal(result.closureDistanceMeters, 0);
  assert.equal(result.loopClosed, true);
});

test("a final point inside the closure tolerance still closes the loop", () => {
  const points = squareLoop();
  // Stop ~22 m short of the start and off to one side — the realistic "close
  // but not exact" finish. Deliberately not collinear with the first leg: an
  // exactly-collinear overshoot is a self-touching ring, which is a different
  // rejection and is covered by the self-intersection test.
  points[points.length - 1] = {
    ...points[points.length - 1],
    lat: LAT0 - 0.00015,
    lng: LNG0 - 0.0002,
  };
  const result = evaluate(points);
  assert.equal(result.loopClosed, true);
  assert.ok(
    result.closureDistanceMeters! > 10 && result.closureDistanceMeters! < 50,
    `expected a 10–50 m gap, got ${result.closureDistanceMeters}`,
  );
  assert.equal(result.captureEligible, true);
});

// ------------------------------------------------------------- loop closure

test("an open route is not closed and cannot capture", () => {
  const points = squareLoop().slice(0, 46); // stop before returning
  const result = evaluate(points);
  assert.equal(result.loopClosed, false);
  assertRejectedFor(result, "loopNotClosed");
  assert.deepEqual(result.capturedHexIds, [], "a rejected route must expose no captured cells");
});

test("a final point outside the closure tolerance is rejected", () => {
  const points = squareLoop();
  // ~111 m from the start: outside the 50 m tolerance.
  points[points.length - 1] = { ...points[points.length - 1], lat: LAT0 + 0.001 };
  const result = evaluate(points);
  assert.equal(result.loopClosed, false);
  assertRejectedFor(result, "loopNotClosed");
});

test("closing the loop is NOT sufficient on its own", () => {
  // A tiny closed loop: endpoints touch, but nothing else qualifies.
  const now = START_TIME;
  const points: GeoPoint[] = [
    { lat: LAT0, lng: LNG0, accuracy: 5, timestamp: now },
    { lat: LAT0 + 0.00005, lng: LNG0, accuracy: 5, timestamp: now + 10_000 },
    { lat: LAT0 + 0.00005, lng: LNG0 + 0.00005, accuracy: 5, timestamp: now + 20_000 },
    { lat: LAT0, lng: LNG0, accuracy: 5, timestamp: now + 30_000 },
  ];
  const result = evaluate(points);
  assert.equal(result.loopClosed, true, "endpoints do touch");
  assert.equal(result.captureEligible, false, "but that alone must never grant capture");
  for (const reason of [
    "insufficientPoints",
    "insufficientDistance",
    "insufficientDuration",
    "areaBelowMinimum",
  ] as CaptureRejectionReason[]) {
    assert.ok(result.captureRejectionReasons.includes(reason), `missing ${reason}`);
  }
});

// -------------------------------------------------------- volume / duration

test("too few points is rejected", () => {
  const result = evaluate(squareLoop({ pointsPerSide: 5 }));
  assertRejectedFor(result, "insufficientPoints");
});

test("too little distance is rejected", () => {
  // A quarter-scale loop: ~250 m, under the 800 m minimum.
  const result = evaluate(squareLoop({ scale: 0.25 }));
  assertRejectedFor(result, "insufficientDistance");
});

test("too short a duration is rejected", () => {
  const result = evaluate(squareLoop({ durationMs: 60_000 }));
  assertRejectedFor(result, "insufficientDuration");
});

// -------------------------------------------------------------- coordinates

test("an invalid latitude is rejected", () => {
  const points = squareLoop();
  points[10] = { ...points[10], lat: 91 };
  assertRejectedFor(evaluate(points), "invalidCoordinates");
});

test("an invalid longitude is rejected", () => {
  const points = squareLoop();
  points[10] = { ...points[10], lng: 181 };
  assertRejectedFor(evaluate(points), "invalidCoordinates");
});

// ------------------------------------------------------------------ physics

test("a timestamp going backwards is rejected", () => {
  const points = squareLoop();
  points[20] = { ...points[20], timestamp: points[19].timestamp! - 5_000 };
  assertRejectedFor(evaluate(points), "timestampReversal");
});

test("an impossible jump is rejected", () => {
  const points = squareLoop();
  // 1 km sideways in one step, well past the 250 m jump ceiling.
  points[30] = { ...points[30], lat: points[30].lat + 0.009 };
  assertRejectedFor(evaluate(points), "impossibleJump");
});

test("impossible speed is rejected even when the hop is short", () => {
  const points = squareLoop();
  // 100 m covered in 1 s = 100 m/s: under the jump ceiling, over the speed one.
  points[30] = {
    ...points[30],
    lat: points[29].lat + 0.0009,
    timestamp: points[29].timestamp! + 1_000,
  };
  const result = evaluate(points);
  assertRejectedFor(result, "impossibleSpeed");
});

test("poor GPS accuracy across the route is rejected", () => {
  const result = evaluate(squareLoop({ accuracy: 120 }));
  assertRejectedFor(result, "poorGpsAccuracy");
});

test("a few poor fixes below the ratio threshold are tolerated", () => {
  const points = squareLoop();
  // 6 of 61 points ≈ 10%, under the 30% threshold.
  for (let i = 0; i < 6; i++) points[i] = { ...points[i], accuracy: 120 };
  const result = evaluate(points);
  assert.equal(result.captureEligible, true);
});

// ----------------------------------------------------------------- geometry

test("a self-intersecting route is rejected safely", () => {
  const points = squareLoop();
  // Drag one mid-route point across the far side to create a crossing.
  points[22] = { ...points[22], lat: LAT0 + LAT_STEP * 1.5, lng: LNG0 - LNG_STEP * 0.5 };
  const result = evaluate(points);
  assertRejectedFor(result, "selfIntersectingRoute");
  assert.deepEqual(result.capturedHexIds, []);
});

test("a degenerate route with no area is rejected, not crashed", () => {
  const points: GeoPoint[] = Array.from({ length: 50 }, (_, i) => ({
    lat: LAT0,
    lng: LNG0,
    accuracy: 5,
    timestamp: START_TIME + i * 10_000,
  }));
  const result = evaluate(points);
  assert.equal(result.captureEligible, false);
  assertRejectedFor(result, "degenerateGeometry");
  assert.equal(result.enclosedAreaSquareMeters, 0);
});

test("an area below the minimum is rejected", () => {
  // Scale 0.3 → ~5 600 m², under the 10 000 m² floor, but long enough in time.
  const result = evaluate(squareLoop({ scale: 0.3 }), { minRouteDistanceMeters: 1 });
  assertRejectedFor(result, "areaBelowMinimum");
});

test("an area above the maximum is rejected", () => {
  const result = evaluate(squareLoop({ scale: 12 }));
  assertRejectedFor(result, "areaAboveMaximum");
  assert.ok(result.enclosedAreaSquareMeters > config.maxAreaSquareMeters);
});

// --------------------------------------------------------------- reporting

test("every failed requirement is reported, not just the first", () => {
  const result = evaluate(squareLoop({ pointsPerSide: 3, scale: 0.2, durationMs: 30_000 }));
  assert.ok(
    result.captureRejectionReasons.length >= 3,
    `expected several reasons, got [${result.captureRejectionReasons.join(", ")}]`,
  );
});

test("a rejected route still reports closure, area and traversed cells", () => {
  const points = squareLoop().slice(0, 46);
  const result = evaluate(points);
  assert.equal(result.captureEligible, false);
  assert.ok(result.closureDistanceMeters !== null, "the runner should see how close they came");
  assert.ok(result.enclosedAreaSquareMeters > 0);
  assert.ok(result.traversedHexIds.length > 0);
});

test("captured cells include the cells the route ran through", () => {
  const result = evaluate(squareLoop());
  for (const traversed of result.traversedHexIds) {
    assert.ok(
      result.capturedHexIds.includes(traversed),
      `traversed cell ${traversed} should be claimable by an eligible loop`,
    );
  }
});

test("captured cells are de-duplicated", () => {
  const result = evaluate(squareLoop());
  assert.equal(new Set(result.capturedHexIds).size, result.capturedHexIds.length);
});

// ------------------------------------------------------------ configurability

test("closure tolerance is configurable", () => {
  const points = squareLoop();
  points[points.length - 1] = { ...points[points.length - 1], lat: LAT0 + 0.001 };
  assert.equal(evaluate(points).loopClosed, false);
  assert.equal(evaluate(points, { maxClosureDistanceMeters: 200 }).loopClosed, true);
});

test("the capture resolution follows configuration", () => {
  const coarse = evaluate(squareLoop(), { resolution: 8, gridVersion: 3 });
  assert.equal(coarse.captureResolution, 8);
  assert.equal(coarse.captureGridVersion, 3);
});

// ----------------------------------------------------------- quality report

test("route quality reports counts without judging eligibility", () => {
  const points = squareLoop();
  points[5] = { ...points[5], accuracy: 200 };
  points[10] = { ...points[10], timestamp: points[9].timestamp! - 1_000 };
  const findings = assessRouteQuality(points, config);
  assert.equal(findings.poorAccuracyCount, 1);
  assert.equal(findings.timestampReversalCount, 1);
  assert.ok(findings.poorAccuracyRatio > 0 && findings.poorAccuracyRatio < 0.05);
  assert.ok(findings.maxObservedSpeedMetersPerSecond > 0);
});

test("route quality on an empty route is all zeroes", () => {
  const findings = assessRouteQuality([], config);
  assert.equal(findings.invalidCoordinateCount, 0);
  assert.equal(findings.poorAccuracyRatio, 0);
  assert.equal(findings.maxObservedJumpMeters, 0);
});
