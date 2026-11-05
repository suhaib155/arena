/**
 * MR-C clock integrity on the authoritative path (LOCAL, SYNTHETIC evidence).
 *
 * Track A C02: the phone clock moved forward one hour mid-walk. Fix timestamps
 * are GNSS time and stay correct; the lifecycle stamps an older client took
 * from the wall clock do not. The server must not let those stamps stand in
 * for elapsed time, and must not accept a lifecycle that finishes after it was
 * received.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_MOVEMENT_MODE, SESSION_RULES_VERSION } from "@movenrun/shared/session";

import { buildRoute } from "../../../shared/src/domain/__tests__/support/syntheticRoute.js";
import { MAX_FUTURE_SKEW_MS, structuralRejections, verifyMovement, type VerifyMovementDeps } from "./domain/verification.js";
import { toValidatable } from "./http/productionRouter.js";
import { GpsService } from "../services/gps.service.js";
import { HexService } from "../services/hex.service.js";
import type { MovementObservation } from "./domain/types.js";

const gps = new GpsService();
const hex = new HexService();
const HOUR = 3_600_000;

function deps(now: number): VerifyMovementDeps {
  return {
    now: () => now,
    detectAnomalies: (observation) => gps.validateRoute(toValidatable(observation) as never),
    calculateDistance: (points) => gps.calculateDistance(points as never),
    traversedHexIds: (points) => hex.getHexIdsForPoints(points),
  };
}

/** A 3.5 minute walk (~290 m) whose lifecycle finish is shifted by `finishShiftMs`. */
function walk(finishShiftMs: number): { observation: MovementObservation; receivedAt: number } {
  const route = buildRoute({ seed: 702, accuracy: 6, legs: [{ kind: "move", speed: 1.4, seconds: 210 }] });
  const points = route.accepted.map((fix) => ({
    lat: fix.latitude, lng: fix.longitude, accuracy: fix.accuracy!, timestamp: fix.timestamp,
  }));
  return {
    receivedAt: route.finishedAt + 5_000,
    observation: {
      startTime: points[0]!.timestamp,
      endTime: points[points.length - 1]!.timestamp,
      points,
      session: {
        mode: DEFAULT_MOVEMENT_MODE, rulesVersion: SESSION_RULES_VERSION,
        startedAt: route.startedAt, finishedAt: route.finishedAt + finishShiftMs, pauses: [],
      },
    },
  };
}

test("C02: a lifecycle that finishes an hour after the server received it is rejected", () => {
  const { observation, receivedAt } = walk(HOUR);
  const reasons = structuralRejections(observation, receivedAt);
  assert.ok(reasons.includes("Session lifecycle finishes in the future"), reasons.join("; "));
  const result = verifyMovement(observation, deps(receivedAt));
  assert.equal(result.status, "rejected");
});

test("the same walk with an honest lifecycle verifies, within the existing skew allowance", () => {
  const honest = walk(0);
  assert.deepEqual(structuralRejections(honest.observation, honest.receivedAt), []);
  assert.equal(verifyMovement(honest.observation, deps(honest.receivedAt)).status, "verified");
  const skewed = walk(MAX_FUTURE_SKEW_MS - 10_000);
  assert.deepEqual(structuralRejections(skewed.observation, skewed.receivedAt), []);
});

test("server duration is observation coverage, never the lifecycle's wall-clock span", () => {
  /* A lifecycle stretched to an hour (but not in the future) still yields the
     observed minutes, so a moved clock cannot buy duration on the server. */
  const { observation, receivedAt } = walk(0);
  const stretched = { ...observation, session: { ...observation.session!, startedAt: observation.session!.startedAt - HOUR } };
  const result = verifyMovement(stretched, deps(receivedAt));
  assert.equal(result.status, "verified", result.rejectionReasons.join("; "));
  assert.ok(result.durationSeconds! <= 215, `duration ${result.durationSeconds} s`);
});
