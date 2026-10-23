/**
 * MR-C stationary drift on the authoritative path (LOCAL, SYNTHETIC evidence).
 *
 * Track A S03: a phone standing still for five minutes whose reported accuracy
 * (6 m) is smaller than its real error (~15 m) uploaded 632 m of accepted
 * fixes and the server verified them. An older or modified client can still
 * upload exactly that, so the server checks the route itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_MOVEMENT_MODE, SESSION_RULES_VERSION } from "@movenrun/shared/session";
import type { MeasurementFix } from "@movenrun/shared/measurement";

import { capture, circle, fixStream, line } from "../../../shared/src/domain/__tests__/support/driftRoute.js";
import { verifyMovement, type VerifyMovementDeps } from "./domain/verification.js";
import { detectMovementAnomalies } from "./http/productionRouter.js";
import { GpsService } from "../services/gps.service.js";
import { HexService } from "../services/hex.service.js";
import type { MovementObservation } from "./domain/types.js";

const gps = new GpsService();
const hex = new HexService();

function upload(accepted: MeasurementFix[]): { observation: MovementObservation; now: number } {
  const points = accepted.map((f) => ({ lat: f.latitude, lng: f.longitude, accuracy: f.accuracy!, timestamp: f.timestamp }));
  const startedAt = points[0]!.timestamp - 1_000, finishedAt = points[points.length - 1]!.timestamp + 1_000;
  return {
    now: finishedAt + 30_000,
    observation: {
      startTime: points[0]!.timestamp, endTime: points[points.length - 1]!.timestamp, points,
      session: { mode: DEFAULT_MOVEMENT_MODE, rulesVersion: SESSION_RULES_VERSION, startedAt, finishedAt, pauses: [] },
    },
  };
}

function verify(accepted: MeasurementFix[]) {
  const { observation, now } = upload(accepted);
  const deps: VerifyMovementDeps = {
    now: () => now,
    detectAnomalies: (o) => detectMovementAnomalies(gps, o),
    calculateDistance: (points) => gps.calculateDistance(points as never),
    traversedHexIds: (points) => hex.getHexIdsForPoints(points),
  };
  return verifyMovement(observation, deps);
}

test("S03: an unguarded stationary upload is rejected, not verified as hundreds of metres", () => {
  const { accepted, meters } = capture(fixStream({ seed: 1031, seconds: 300, accuracy: 6, sigma: 15 }), false);
  assert.ok(meters > 400, `the upload claims ${meters.toFixed(0)} m`);
  const result = verify(accepted);
  assert.equal(result.status, "rejected");
  assert.ok(result.rejectionReasons.includes("Route wanders in place like stationary GPS drift"),
    result.rejectionReasons.join("; "));
  assert.equal(result.distanceMeters, null);
});

test("honest walks and small loops still verify", () => {
  for (const path of [line(1.4), circle(25, 1.4), circle(60, 1.4)]) {
    const { accepted } = capture(fixStream({ seed: 77, seconds: 300, accuracy: 8, sigma: 3, correlation: 0.8, path }), true);
    const result = verify(accepted);
    assert.equal(result.status, "verified", result.rejectionReasons.join("; "));
  }
});
