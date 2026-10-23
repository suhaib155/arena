/**
 * MR-A-01 — honest short and slow walks against the minimum-evidence policy.
 *
 * Every route is captured through the real on-foot rule (shared `inspectFix`
 * against the last accepted fix, see testing/syntheticWalks.ts) and verified
 * through the production anomaly wiring, real GpsService distance, real H3 and
 * real sealing. Fixture ids follow the Track A corpus (W04 and neighbours) so
 * results can be compared; the scenarios are rebuilt here from the
 * runtime code rather than imported from a mirrored pipeline.
 *
 * SYNTHETIC / NOT LIVE: no route here is a recording of anyone.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import { DEFAULT_MOVEMENT_MODE, SESSION_RULES_VERSION } from "@movenrun/shared/session";

import { IdentityError } from "../identity/domain/errors.js";
import { GpsService } from "../services/gps.service.js";
import { HexService } from "../services/hex.service.js";
import { verifyMovement, type VerifyMovementDeps } from "./domain/verification.js";
import type { MovementObservation, ObservedPoint } from "./domain/types.js";
import { detectMovementAnomalies } from "./http/productionRouter.js";
import { createMovementRouter } from "./http/router.js";
import { InMemoryMovementVerificationRepository } from "./repositories/interfaces.js";
import { MovementVerificationService } from "./services/movementVerification.service.js";
import { captureWalk, line, observationOf, type WalkScenario } from "./testing/syntheticWalks.js";

const EPOCH = Date.UTC(2026, 9, 22, 9, 0, 0);
const NOW = EPOCH + 60 * 60_000;
const gps = new GpsService();
const hex = new HexService();

const deps: VerifyMovementDeps = {
  now: () => NOW,
  detectAnomalies: (observation) => detectMovementAnomalies(gps, observation),
  calculateDistance: (points) => gps.calculateDistance(points as never),
  traversedHexIds: (points) => hex.getHexIdsForPoints(points),
};

const warm = { kind: "still" as const, seconds: 15 };
const scenario = (seed: number, over: Partial<WalkScenario>): WalkScenario =>
  ({ seed, epochMs: EPOCH, legs: [], accuracyM: 8, sigmaM: 3, ...over });

const W04 = scenario(204, {
  legs: [warm, { kind: "move", path: line(220), speedMps: 1.4 }, { kind: "still", seconds: 5 }],
  accuracyM: 15, sigmaM: 5,
});

function verify(points: ObservedPoint[], session = true, walk = captureWalk(W04)) {
  return verifyMovement(observationOf(points, session ? walk.session : undefined), deps);
}

/* ── W04 and neighbours: honest walks that must verify ───────────────────── */

const HONEST: [string, WalkScenario][] = [
  ["W02 plausible 300 m walk", scenario(202, {
    legs: [warm, { kind: "move", path: [[0, 0], [200, 0], [200, 100]], speedMps: 1.4 }, { kind: "still", seconds: 5 }] })],
  ["W03 750 m block loop", scenario(203, {
    legs: [warm, { kind: "move", path: [[0, 0], [225, 0], [225, 150], [0, 150], [0, 0]], speedMps: 1.3 },
      { kind: "still", seconds: 5 }] })],
  ["W04 honest 220 m walk, 15 m city accuracy", W04],
  ["W06 slow 150 m stroll at 0.42 m/s", scenario(206, {
    legs: [warm, { kind: "move", path: line(150), speedMps: 0.42 }, { kind: "still", seconds: 5 }] })],
  ["W06u slow 150 m stroll at 0.42 m/s with 15 m city accuracy", scenario(216, {
    legs: [warm, { kind: "move", path: line(150), speedMps: 0.42 }, { kind: "still", seconds: 5 }],
    accuracyM: 15, sigmaM: 5 })],
  ["T02 pause, walk 80 m while paused, resume", scenario(302, {
    legs: [warm, { kind: "move", path: line(380), speedMps: 1.4 }, { kind: "still", seconds: 5 }],
    pauses: [[15 + 107, 15 + 107 + 57]] })],
  ["T03 three-minute stop at a crossing", scenario(303, {
    legs: [warm, { kind: "move", path: line(150), speedMps: 1.4 }, { kind: "still", seconds: 180 },
      { kind: "move", path: line(150), speedMps: 1.4 }, { kind: "still", seconds: 5 }] })],
];

for (const [name, fixture] of HONEST) {
  test(`honest: ${name} verifies with a distance close to the walk`, () => {
    const walk = captureWalk(fixture);
    const result = verifyMovement(observationOf(walk.accepted, walk.session), deps);
    assert.equal(result.status, "verified", `${name} rejected: ${result.rejectionReasons.join("; ")}`);
    const distance = result.distanceMeters!;
    assert.ok(Math.abs(distance - walk.truthMeters) <= walk.truthMeters * 0.2 + 25,
      `${name}: ${distance} m measured for ${walk.truthMeters.toFixed(0)} m walked`);
  });
}

test("W04 really exercises the short-route lane: fewer than ten accepted fixes", () => {
  const walk = captureWalk(W04);
  assert.ok(walk.accepted.length >= 5 && walk.accepted.length < 10,
    `W04 captured ${walk.accepted.length} accepted fixes`);
  const slow = captureWalk(HONEST.find(([n]) => n.startsWith("W06u"))![1]);
  assert.ok(slow.accepted.length >= 5 && slow.accepted.length < 10, `W06u captured ${slow.accepted.length} accepted fixes`);
});

/* ── legacy submissions keep the ten-point floor ─────────────────────────── */

test("legacy: the same honest W04 route without session metadata still fails closed", () => {
  const walk = captureWalk(W04);
  const result = verify(walk.accepted, false, walk);
  assert.equal(result.status, "rejected");
  assert.ok(result.rejectionReasons.some((r) => /Too few GPS points: \d$/.test(r)), result.rejectionReasons.join("; "));
  assert.equal(result.distanceMeters, null);
});

/* ── same-length fabricated routes ───────────────────────────────────────── */

test("fabricated: W04 geometry with zero reported accuracy is not credible evidence", () => {
  const walk = captureWalk(W04);
  const result = verify(walk.accepted.map((p) => ({ ...p, accuracy: 0 })), true, walk);
  assert.equal(result.status, "rejected");
  assert.ok(result.rejectionReasons.some((r) => /accuracy/i.test(r)), result.rejectionReasons.join("; "));
});

test("fabricated: W04 geometry with timestamps one second apart fails (impossible pace)", () => {
  const walk = captureWalk(W04);
  const t0 = walk.accepted[0]!.timestamp;
  const result = verify(walk.accepted.map((p, i) => ({ ...p, timestamp: t0 + i * 1000 })), true, walk);
  assert.equal(result.status, "rejected");
});

test("fabricated: W04 geometry with a duplicated timestamp fails", () => {
  const walk = captureWalk(W04);
  const points = walk.accepted.map((p) => ({ ...p }));
  points[3]!.timestamp = points[2]!.timestamp;
  const result = verify(points, true, walk);
  assert.equal(result.status, "rejected");
  assert.ok(result.rejectionReasons.some((r) => /increasing time order/.test(r)));
});

test("fabricated: W04 route array replayed in reverse time order fails", () => {
  const walk = captureWalk(W04);
  const times = walk.accepted.map((p) => p.timestamp);
  const result = verify(walk.accepted.map((p, i) => ({ ...p, timestamp: times[times.length - 1 - i]! })), true, walk);
  assert.equal(result.status, "rejected");
});

test("fabricated: an unfiltered dense array of the same 220 m is not on-foot evidence", () => {
  const walk = captureWalk(W04);
  const result = verify(walk.raw, true, walk);
  assert.equal(result.status, "rejected");
  assert.deepEqual(result.rejectionReasons, ["Route measurement quality needs review"]);
});

/* ── stationary phones and drift ─────────────────────────────────────────── */

test("stationary: S01 phone on a bench for 90 s does not verify", () => {
  const walk = captureWalk(scenario(101, { legs: [{ kind: "still", seconds: 105 }], accuracyM: 10, sigmaM: 4 }));
  const result = verifyMovement(observationOf(walk.accepted, walk.session), deps);
  assert.notEqual(result.status, "verified");
});

test("stationary: S02 phone still for five minutes does not verify", () => {
  const walk = captureWalk(scenario(102, { legs: [{ kind: "still", seconds: 315 }], accuracyM: 10, sigmaM: 4 }));
  const result = verifyMovement(observationOf(walk.accepted, walk.session), deps);
  assert.notEqual(result.status, "verified", `${walk.accepted.length} accepted fixes verified`);
});

test("stationary: drift that hops between accuracy circles but never leaves the spot fails", () => {
  // Six fixes, 5 m accuracy, each hop 12 m (clears both circles), all within ~15 m of the start.
  const offsets: [number, number][] = [[0, 0], [12, 0], [12, 12], [0, 12], [-6, 2], [6, 5]];
  const points = offsets.map(([e, n], i) => ({
    lat: 0.25 + n / 111_320, lng: -25 + e / 111_320, accuracy: 5, timestamp: EPOCH + i * 20_000,
  }));
  const result = verifyMovement(observationOf(points, {
    mode: DEFAULT_MOVEMENT_MODE, rulesVersion: SESSION_RULES_VERSION,
    startedAt: EPOCH - 1_000, finishedAt: EPOCH + 200_000, pauses: [],
  }), deps);
  assert.equal(result.status, "rejected");
  assert.ok(result.rejectionReasons.some((r) => /drift/.test(r)), result.rejectionReasons.join("; "));
});

test("zero distance: repeated identical fixes fail", () => {
  const walk = captureWalk(W04);
  const p = walk.accepted[0]!;
  const result = verify(walk.accepted.map((q) => ({ ...p, timestamp: q.timestamp })), true, walk);
  assert.equal(result.status, "rejected");
  assert.equal(result.distanceMeters, null);
});

/* ── adverse accuracy, few fixes, clock anomalies, pauses ────────────────── */

test("adverse accuracy: the W04 walk at 30 m accuracy is not enough evidence", () => {
  const walk = captureWalk({ ...W04, accuracyM: 30, sigmaM: 10 });
  const result = verifyMovement(observationOf(walk.accepted, walk.session), deps);
  assert.equal(result.status, "rejected", `${walk.accepted.length} fixes verified`);
});

test("adverse accuracy: one fix weaker than the short-route band fails the short lane", () => {
  const walk = captureWalk(W04);
  const result = verify(walk.accepted.map((p, i) => (i === 3 ? { ...p, accuracy: 30 } : p)), true, walk);
  assert.equal(result.status, "rejected");
});

test("few fixes: four accurate fixes over 220 m fail", () => {
  const walk = captureWalk(W04);
  const a = walk.accepted;
  const result = verify([a[0]!, a[2]!, a[4]!, a[a.length - 1]!], true, walk);
  assert.equal(result.status, "rejected");
  assert.ok(result.rejectionReasons.some((r) => /Too few accepted GPS fixes/.test(r)), result.rejectionReasons.join("; "));
});

test("clock: five fixes squeezed into 20 s of observation fail", () => {
  const points = [0, 1, 2, 3, 4].map((i) => ({
    lat: 0.25, lng: -25 + (i * 20) / 111_320, accuracy: 5, timestamp: EPOCH + i * 5_000,
  }));
  const result = verifyMovement(observationOf(points, {
    mode: DEFAULT_MOVEMENT_MODE, rulesVersion: SESSION_RULES_VERSION,
    startedAt: EPOCH - 1_000, finishedAt: EPOCH + 30_000, pauses: [],
  }), deps);
  assert.equal(result.status, "rejected");
  assert.ok(result.rejectionReasons.some((r) => /continuous observation/.test(r)), result.rejectionReasons.join("; "));
});

test("clock: an honest W04 dated in the future fails", () => {
  const walk = captureWalk({ ...W04, epochMs: NOW + 60 * 60_000 });
  const result = verifyMovement(observationOf(walk.accepted, walk.session), deps);
  assert.equal(result.status, "rejected");
  assert.ok(result.rejectionReasons.some((r) => /future/.test(r)));
});

test("clock: points that fall outside the declared session window fail", () => {
  const walk = captureWalk(W04);
  const result = verifyMovement({ ...observationOf(walk.accepted, walk.session),
    session: { ...walk.session, finishedAt: walk.accepted[3]!.timestamp } }, deps);
  assert.equal(result.status, "rejected");
});

test("pause: a short route split by a pause counts only continuous segments", () => {
  const walk = captureWalk(W04);
  const five = walk.accepted.slice(0, 5);
  const pauseAt = five[3]!.timestamp - 1;
  const session = { ...walk.session, pauses: [{ startedAt: pauseAt - 1, endedAt: pauseAt }] };
  const result = verifyMovement(observationOf(five, session), deps);
  assert.equal(result.status, "rejected");
  assert.ok(result.rejectionReasons.some((r) => /continuous GPS segments for a short route: 3/.test(r)), result.rejectionReasons.join("; "));
});

test("pause: W04 with a pause in the middle still verifies and does not bridge it", () => {
  const walk = captureWalk({ ...W04,
    legs: [warm, { kind: "move", path: line(260), speedMps: 1.4 }, { kind: "still", seconds: 5 }],
    pauses: [[15 + 80, 15 + 100]] });
  const result = verifyMovement(observationOf(walk.accepted, walk.session), deps);
  assert.equal(result.status, "verified", result.rejectionReasons.join("; "));
  assert.ok(result.distanceMeters! < 260 - 15, `${result.distanceMeters} m bridges the paused 28 m`);
});

/* ── the authoritative endpoint ──────────────────────────────────────────── */

async function withServer(fn: (base: string, repository: InMemoryMovementVerificationRepository) => Promise<void>) {
  const repository = new InMemoryMovementVerificationRepository();
  let next = 0;
  const service = new MovementVerificationService({ ...deps, repository, generateId: () => `mv-a01-${++next}` });
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/movement", createMovementRouter({
    service,
    verifyBearer: async (token) => {
      if (token === "walker-token") return { userId: "walker" };
      throw new IdentityError("session_invalid");
    },
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}/movement/verify`, repository);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
}

async function post(base: string, sessionId: string, observation: MovementObservation) {
  const response = await fetch(base, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer walker-token" },
    body: JSON.stringify({ sessionId, ...observation }),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

test("endpoint: honest W04 verifies and is stored verified; same-length fabrications are stored rejected", async () => {
  await withServer(async (base, repository) => {
    const walk = captureWalk(W04);

    const honest = await post(base, "mra01-w04-honest", observationOf(walk.accepted, walk.session));
    assert.equal(honest.status, 201);
    assert.equal(honest.body.status, "verified", JSON.stringify(honest.body.rejectionReasons));
    assert.ok(Number(honest.body.distanceMeters) >= 180 && Number(honest.body.distanceMeters) <= 260);
    const stored = await repository.findByUserSession("walker", "mra01-w04-honest");
    assert.equal(stored?.status, "verified");
    assert.equal(stored?.distanceMeters, honest.body.distanceMeters);

    const zeroAccuracy = await post(base, "mra01-w04-zero-accuracy",
      observationOf(walk.accepted.map((p) => ({ ...p, accuracy: 0 })), walk.session));
    assert.equal(zeroAccuracy.body.status, "rejected");
    assert.equal(zeroAccuracy.body.distanceMeters, null);

    const legacy = await post(base, "mra01-w04-legacy", observationOf(walk.accepted));
    assert.equal(legacy.body.status, "rejected");

    const stationary = captureWalk(scenario(102, { legs: [{ kind: "still", seconds: 315 }], accuracyM: 10, sigmaM: 4 }));
    if (stationary.accepted.length >= 2) {
      const still = await post(base, "mra01-s02-still", observationOf(stationary.accepted, stationary.session));
      assert.equal(still.body.status, "rejected");
    }

    const records = await Promise.all(["mra01-w04-zero-accuracy", "mra01-w04-legacy"]
      .map((id) => repository.findByUserSession("walker", id)));
    for (const record of records) assert.equal(record?.status, "rejected");
  });
});
