/**
 * MR-A-02 on the authoritative path (LOCAL, SYNTHETIC evidence).
 *
 * The server never sees the fixes the phone rejected, so it cannot rely on a
 * client marker after a rejected jump. These tests upload exactly what the
 * phone would (accepted fixes only, no breakBefore) and check each server
 * stage with the production wiring: structural checks, on-foot quality, the
 * GpsService anomaly pass via `toValidatable`, distance, duration, sealing,
 * and the exactly-once service.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_MOVEMENT_MODE, SESSION_RULES_VERSION } from "@movenrun/shared/session";

import { buildRoute, I02, type RouteSpec, type SyntheticRoute } from
  "../../../shared/src/domain/__tests__/support/syntheticRoute.js";
import { structuralRejections, verifyMovement, type VerifyMovementDeps } from "./domain/verification.js";
import { toValidatable } from "./http/productionRouter.js";
import { GpsService } from "../services/gps.service.js";
import { HexService } from "../services/hex.service.js";
import { InMemoryMovementVerificationRepository } from "./repositories/interfaces.js";
import { MovementVerificationService } from "./services/movementVerification.service.js";
import type { MovementObservation } from "./domain/types.js";

const gps = new GpsService();
const hex = new HexService();

function deps(now: number): VerifyMovementDeps {
  return {
    now: () => now,
    detectAnomalies: (observation) => gps.validateRoute(toValidatable(observation) as never),
    calculateDistance: (points) => gps.calculateDistance(points as never),
    traversedHexIds: (points) => hex.getHexIdsForPoints(points),
  };
}

function upload(route: SyntheticRoute, withSession = true): MovementObservation {
  const points = route.accepted.map((fix) => ({
    lat: fix.latitude, lng: fix.longitude, accuracy: fix.accuracy!, timestamp: fix.timestamp,
  }));
  return {
    startTime: points[0]!.timestamp,
    endTime: points[points.length - 1]!.timestamp,
    points,
    ...(withSession ? { session: {
      mode: DEFAULT_MOVEMENT_MODE,
      rulesVersion: SESSION_RULES_VERSION,
      startedAt: route.startedAt,
      finishedAt: route.finishedAt,
      pauses: route.pauses,
    } } : {}),
  };
}

function verify(spec: RouteSpec, withSession = true) {
  const route = buildRoute(spec);
  const observation = upload(route, withSession);
  const now = route.finishedAt + 60_000;
  return { route, observation, now, result: verifyMovement(observation, deps(now)) };
}

test("I02 stages: structural, quality and anomaly pass; distance excludes the vehicle leg", () => {
  const { route, observation, now, result } = verify(I02);
  assert.deepEqual(structuralRejections(observation, now), []);
  assert.equal(gps.validateRoute(toValidatable(observation) as never).isAnomaly, false);
  assert.equal(result.status, "verified", result.rejectionReasons.join("; "));
  assert.ok(result.distanceMeters! < route.walkedTruthMeters + 30,
    `server credited ${result.distanceMeters} m for ${route.walkedTruthMeters} m walked`);
  assert.ok(result.distanceMeters! > 0.6 * route.walkedTruthMeters, `walking lost: ${result.distanceMeters}`);
});

test("I02: observed duration does not include the unobserved bridge", () => {
  const { observation, result } = verify(I02);
  const span = (observation.endTime - observation.startTime) / 1000;
  // The stale-anchor gap is ~150 s of the ~300 s span.
  assert.ok(result.durationSeconds! < span - 100, `duration ${result.durationSeconds} of span ${span}`);
});

test("I02 without session metadata (legacy) gets no bridge credit either", () => {
  const { route, result } = verify(I02, false);
  assert.equal(result.status, "verified", result.rejectionReasons.join("; "));
  assert.ok(result.distanceMeters! < route.walkedTruthMeters + 30, `${result.distanceMeters}`);
});

test("a bridge never excuses an over-speed pair: quality and anomaly gates still reject", () => {
  const { observation, now } = verify(I02);
  // From point 5 on, shift the rest of the walk 600 m north and 15 s later:
  // one consecutive pair now moves ~26 m/s over a > 10 s gap, which the
  // bridge rule also flags. It must still reject, not quietly drop a segment.
  const shifted = observation.points.map((p, i) => i < 5 ? p
    : { ...p, lat: p.lat + 0.0054, timestamp: p.timestamp + 15_000 });
  const last = shifted[shifted.length - 1]!.timestamp;
  const tampered: MovementObservation = { ...observation, points: shifted, endTime: last,
    session: { ...observation.session!, finishedAt: last + 1_000 } };
  assert.deepEqual(structuralRejections(tampered, now), []);
  assert.equal(verifyMovement(tampered, deps(now)).status, "rejected");
  const { session: _session, ...legacy } = tampered;
  assert.equal(gps.validateRoute(toValidatable(legacy) as never).isAnomaly, true);
  assert.equal(verifyMovement(legacy, deps(now)).status, "rejected");
});

test("subway outage: server credits only the walking on either side", () => {
  const { route, result } = verify({
    seed: 11, accuracy: 6,
    legs: [
      { kind: "move", speed: 1.3, seconds: 160 },
      { kind: "outage", speed: 8, seconds: 300, heading: 90 },
      { kind: "move", speed: 1.3, seconds: 160 },
    ],
  });
  assert.equal(result.status, "verified", result.rejectionReasons.join("; "));
  assert.ok(result.distanceMeters! < route.walkedTruthMeters + 30, `${result.distanceMeters}`);
});

test("pause and resume semantics are unchanged on the server", () => {
  const { route, result } = verify({
    seed: 12, accuracy: 5,
    legs: [
      { kind: "move", speed: 1.4, seconds: 150 },
      { kind: "pause", speed: 6, seconds: 120, heading: 45 },
      { kind: "move", speed: 1.4, seconds: 150 },
    ],
  });
  assert.equal(result.status, "verified", result.rejectionReasons.join("; "));
  assert.ok(result.distanceMeters! > 0.8 * route.walkedTruthMeters &&
    result.distanceMeters! < route.walkedTruthMeters + 30, `${result.distanceMeters}`);
});

test("stop/start, irregular sampling, slow walker and a benign spike stay verified at full distance", () => {
  const cases: RouteSpec[] = [
    { seed: 14, accuracy: 8, jitter: 3, legs: [
      { kind: "move", speed: 1.4, seconds: 150 }, { kind: "still", seconds: 180 }, { kind: "move", speed: 1.4, seconds: 150 }] },
    { seed: 15, accuracy: 7, interval: [1, 8], legs: [{ kind: "move", speed: 1.3, seconds: 480, heading: 30 }] },
    { seed: 19, accuracy: 15, legs: [{ kind: "move", speed: 0.5, seconds: 1_800, heading: 300 }] },
    { seed: 18, accuracy: 6, legs: [{ kind: "move", speed: 1.4, seconds: 400 }],
      spikes: [{ atSecond: 200, offsetMeters: 90, accuracy: 6 }] },
  ];
  for (const spec of cases) {
    const { route, result } = verify(spec);
    assert.equal(result.status, "verified", `seed ${spec.seed}: ${result.rejectionReasons.join("; ")}`);
    assert.ok(result.distanceMeters! > 0.8 * route.walkedTruthMeters &&
      result.distanceMeters! < route.walkedTruthMeters + 30, `seed ${spec.seed}: ${result.distanceMeters}`);
  }
});

test("I02 through the service: stored once, a retry returns the same bridge-free record", async () => {
  const route = buildRoute(I02);
  const observation = upload(route);
  let id = 0;
  const service = new MovementVerificationService({
    ...deps(route.finishedAt + 60_000),
    repository: new InMemoryMovementVerificationRepository(),
    generateId: () => `mv_bridge_${++id}`,
  });
  const first = await service.submit({ userId: "usr_bridge", clientSessionId: "mv-bridge-0001", observation });
  const retry = await service.submit({ userId: "usr_bridge", clientSessionId: "mv-bridge-0001", observation });
  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.deepEqual(retry.record, first.record);
  assert.equal(id, 1);
  assert.ok(first.record.distanceMeters! < route.walkedTruthMeters + 30, `${first.record.distanceMeters}`);
});
