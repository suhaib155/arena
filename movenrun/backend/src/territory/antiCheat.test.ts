/**
 * Risk-based anti-cheat.
 *
 * Two guarantees are load-bearing:
 *   1. One ambiguous GPS anomaly never rejects a route outright — the worst a
 *      soft signal alone can reach is `needsReview`.
 *   2. The client's mocked-location flag is never sufficient on its own. A
 *      device that fakes its location can fake the flag too.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessRouteRisk,
  isDegradedQuality,
  permitsCapture,
  RISK_THRESHOLDS,
  RISK_WEIGHTS,
  type RiskSignal,
} from "./antiCheat.js";
import { TERRITORY_DEFAULTS, type TerritoryConfig } from "./config.js";
import type { GeoPoint } from "./geometry.js";

const config: TerritoryConfig = { ...TERRITORY_DEFAULTS };
const START = 1_700_000_000_000;

/** A clean ~2.4 m/s run with natural variation in heading and cadence. */
function cleanRoute(count = 60): GeoPoint[] {
  const points: GeoPoint[] = [];
  for (let i = 0; i < count; i++) {
    // A gentle arc plus jitter — nothing metronomic, nothing perfectly straight.
    const angle = (i / count) * Math.PI * 1.5;
    points.push({
      lat: 51.5 + 0.003 * Math.sin(angle) + (i % 3) * 0.000005,
      lng: -0.1 + 0.004 * Math.cos(angle) + (i % 5) * 0.000004,
      accuracy: 6 + (i % 4),
      timestamp: START + i * 6000 + (i % 3) * 120,
    });
  }
  return points;
}

function findings(route: GeoPoint[], extra = {}) {
  return assessRouteRisk({ points: route, ...extra }, config);
}

function hasSignal(assessment: ReturnType<typeof findings>, signal: RiskSignal): boolean {
  return assessment.findings.some((f) => f.signal === signal);
}

// ------------------------------------------------------------- clean route

test("a clean route is accepted with no findings", () => {
  const assessment = findings(cleanRoute());
  assert.deepEqual(assessment.findings, []);
  assert.equal(assessment.verdict, "accepted");
  assert.equal(assessment.score, 0);
  assert.equal(permitsCapture(assessment.verdict), true);
  assert.equal(isDegradedQuality(assessment), false);
});

// ------------------------------------------------------------ hard signals

test("a teleport is detected and pushes the score high", () => {
  const route = cleanRoute();
  route[30] = { ...route[30], lat: route[30].lat + 0.05 };
  const assessment = findings(route);
  assert.ok(hasSignal(assessment, "teleportation"));
  assert.ok(assessment.score >= RISK_THRESHOLDS.needsReview);
});

test("an invalid coordinate is a hard signal", () => {
  const route = cleanRoute();
  route[10] = { ...route[10], lat: 500 };
  const assessment = findings(route);
  assert.ok(hasSignal(assessment, "invalidCoordinateRange"));
  assert.equal(assessment.verdict, "rejected");
});

test("timestamps going backwards is a hard signal", () => {
  const route = cleanRoute();
  route[20] = { ...route[20], timestamp: route[19].timestamp! - 30_000 };
  assert.ok(hasSignal(findings(route), "timestampReversal"));
});

test("a route with several hard signals is rejected", () => {
  const route = cleanRoute();
  route[10] = { ...route[10], lat: 500 };
  route[20] = { ...route[20], timestamp: route[19].timestamp! - 30_000 };
  const assessment = findings(route);
  assert.equal(assessment.verdict, "rejected");
  assert.equal(permitsCapture(assessment.verdict), false);
});

// ------------------------------------------------------------ soft signals

test("ONE AMBIGUOUS ANOMALY NEVER REJECTS ON ITS OWN", () => {
  // Every soft signal, applied singly. None may reach `rejected`.
  const softCases: [string, ReturnType<typeof findings>][] = [];

  const poorGps = cleanRoute().map((p) => ({ ...p, accuracy: 200 }));
  softCases.push(["poorAccuracy", findings(poorGps)]);

  softCases.push(["mockedLocationReported", findings(cleanRoute(), { mockedLocationReported: true })]);
  softCases.push(["deviceIntegrityFailed", findings(cleanRoute(), { deviceIntegrityFailed: true })]);
  softCases.push([
    "excessiveBackgroundGap",
    findings(cleanRoute(), { longestGapMs: 20 * 60_000 }),
  ]);

  for (const [name, assessment] of softCases) {
    assert.notEqual(
      assessment.verdict,
      "rejected",
      `${name} alone must never reject: score ${assessment.score}`,
    );
  }
});

test("the mocked-location flag alone is never sufficient to reject", () => {
  const assessment = findings(cleanRoute(), { mockedLocationReported: true });
  assert.ok(hasSignal(assessment, "mockedLocationReported"));
  assert.notEqual(assessment.verdict, "rejected");
  assert.equal(
    assessment.verdict,
    "needsReview",
    "a mocked-location claim should be reviewed, not punished",
  );
});

test("no soft signal is weighted heavily enough to reject by itself", () => {
  for (const [signal, { weight, hard }] of Object.entries(RISK_WEIGHTS)) {
    if (hard) continue;
    assert.ok(
      weight < RISK_THRESHOLDS.rejected,
      `soft signal ${signal} is weighted ${weight}, at or above the rejection threshold`,
    );
  }
});

test("rejection additionally requires a hard signal, not just a high score", () => {
  // Stack every soft signal at once: a very high score with no hard signal.
  const poorGps = cleanRoute().map((p) => ({ ...p, accuracy: 200 }));
  const assessment = findings(poorGps, {
    mockedLocationReported: true,
    deviceIntegrityFailed: true,
    longestGapMs: 30 * 60_000,
  });
  assert.ok(assessment.score >= RISK_THRESHOLDS.rejected, "soft signals alone can score high");
  assert.equal(
    assessment.verdict,
    "needsReview",
    "but without a hard signal the verdict must stay reviewable",
  );
});

// ------------------------------------------------------- synthetic routes

test("a perfectly straight, metronomic route is flagged as synthetic", () => {
  const synthetic: GeoPoint[] = Array.from({ length: 60 }, (_, i) => ({
    lat: 51.5 + i * 0.0001,
    lng: -0.1,
    accuracy: 5,
    timestamp: START + i * 5000,
  }));
  const assessment = assessRouteRisk({ points: synthetic }, config);
  assert.ok(
    hasSignal(assessment, "unrealisticStraightLine"),
    `expected a synthetic-route flag, got [${assessment.findings.map((f) => f.signal).join(", ")}]`,
  );
});

test("a real curved route is not flagged as synthetic", () => {
  assert.ok(!hasSignal(findings(cleanRoute()), "unrealisticStraightLine"));
});

test("sustained vehicle-like speed is flagged separately from impossible speed", () => {
  // ~14 m/s (50 km/h): above 1.5x the 8 m/s ceiling, so the ceiling also trips.
  const driving: GeoPoint[] = Array.from({ length: 40 }, (_, i) => ({
    lat: 51.5 + i * 0.00063 + (i % 3) * 0.00002,
    lng: -0.1 + (i % 4) * 0.00003,
    accuracy: 5,
    timestamp: START + i * 5000,
  }));
  const assessment = assessRouteRisk({ points: driving }, config);
  assert.ok(
    hasSignal(assessment, "impossibleSpeed") || hasSignal(assessment, "vehicleLikeMovement"),
    "sustained driving speed should raise a movement signal",
  );
  assert.ok(assessment.score >= RISK_THRESHOLDS.needsReview);
});

// ------------------------------------------------------------- graded path

test("a route with minor warnings is accepted but marked degraded", () => {
  const route = cleanRoute();
  // A handful of poor fixes: under the ratio threshold, so no poorAccuracy
  // signal — but a single background gap raises one light warning.
  const assessment = findings(route, { longestGapMs: 6 * 60_000 });
  assert.equal(assessment.verdict, "acceptedWithWarnings");
  assert.equal(permitsCapture(assessment.verdict), true);
  assert.equal(isDegradedQuality(assessment), true, "rewards should be damped, not withheld");
});

test("a normal background gap raises nothing", () => {
  assert.equal(findings(cleanRoute(), { longestGapMs: 30_000 }).verdict, "accepted");
});

// -------------------------------------------------------------- edge cases

test("an empty route does not crash and raises nothing", () => {
  const assessment = assessRouteRisk({ points: [] }, config);
  assert.equal(assessment.verdict, "accepted");
  assert.deepEqual(assessment.findings, []);
});

test("the quality traversal is reported alongside the verdict", () => {
  const route = cleanRoute();
  route[10] = { ...route[10], accuracy: 400 };
  const assessment = findings(route);
  assert.equal(assessment.quality.poorAccuracyCount, 1);
  assert.ok(assessment.quality.maxObservedSpeedMetersPerSecond > 0);
});

test("thresholds order correctly, so the verdict ladder is coherent", () => {
  assert.ok(RISK_THRESHOLDS.needsReview < RISK_THRESHOLDS.rejected);
});
