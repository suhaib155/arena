/**
 * Movement verification — trust boundary, idempotency, and account isolation.
 *
 * The property under test is not "the endpoint works". It is: the client can
 * report only what its sensors saw, the server decides everything else, and the
 * same completed session can never be verified twice — including when two
 * retries race.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import {
  InMemoryMovementVerificationRepository,
  MovementSessionConflictError,
  type CreateMovementVerificationInput,
  type MovementVerificationRepository,
} from "./repositories/interfaces.js";
import { MovementVerificationService } from "./services/movementVerification.service.js";
import { createMovementRouter } from "./http/router.js";
import { structuralRejections, verifyMovement } from "./domain/verification.js";
import { submitMovementSchema } from "./http/validation.js";
import type { MovementObservation } from "./domain/types.js";

const NOW = 1_700_000_600_000;
const START = 1_700_000_000_000;
const END = 1_700_000_300_000;

function observation(over: Partial<MovementObservation> = {}): MovementObservation {
  return {
    startTime: START,
    endTime: END,
    points: [
      { lat: 51.5, lng: -0.12, accuracy: 6, timestamp: START + 1_000 },
      { lat: 51.5009, lng: -0.12, accuracy: 6, timestamp: START + 120_000 },
      { lat: 51.5018, lng: -0.12, accuracy: 6, timestamp: START + 240_000 },
    ],
    ...over,
  };
}

let idCounter = 0;
function buildService(repository: MovementVerificationRepository = new InMemoryMovementVerificationRepository()) {
  return new MovementVerificationService({
    repository,
    generateId: () => `mv_${++idCounter}`,
    now: () => NOW,
    detectAnomalies: () => ({ isAnomaly: false, reasons: [], confidence: 0.95 }),
    calculateDistance: () => 412,
    traversedHexIds: () => ["8a1fb46622dffff", "8a1fb46622d7fff"],
  });
}

/* ── the client cannot assert authority ───────────────────────────────────── */

test("the request schema has no field for any authoritative value", () => {
  const authoritative = {
    sessionId: "session-abcdef01",
    startTime: START,
    endTime: END,
    points: observation().points,
  };
  assert.ok(submitMovementSchema.safeParse(authoritative).success);

  // Every one of these is a value only the server may decide. `.strict()`
  // means each is a hard rejection, not a silently ignored extra field.
  for (const smuggled of [
    { distanceMeters: 99_000 },
    { durationSeconds: 1 },
    { traversedHexIds: ["8a1fb46622dffff"] },
    { capturedZones: ["8a1fb46622dffff"] },
    { xp: 5_000 },
    { lockedMove: "1000" },
    { trustScore: 1 },
    { verified: true },
    { status: "verified" },
    { walletAddress: "0x" + "a".repeat(40) },
    { userId: "usr_someone_else" },
  ]) {
    const parsed = submitMovementSchema.safeParse({ ...authoritative, ...smuggled });
    assert.equal(
      parsed.success,
      false,
      `body accepted an authoritative field: ${Object.keys(smuggled)[0]}`,
    );
  }
});

test("the server computes distance, duration and traversed hexes itself", () => {
  const result = verifyMovement(observation(), {
    detectAnomalies: () => ({ isAnomaly: false, reasons: [], confidence: 0.95 }),
    calculateDistance: () => 412,
    traversedHexIds: () => ["8a1fb46622dffff"],
    now: () => NOW,
  });
  assert.equal(result.status, "verified");
  assert.equal(result.distanceMeters, 412);
  assert.equal(result.durationSeconds, 300);
  assert.deepEqual(result.traversedHexIds, ["8a1fb46622dffff"]);
});

/* ── cross-field validation ───────────────────────────────────────────────── */

test("cross-field checks the per-point anomaly pass cannot express", () => {
  const cases: [string, MovementObservation, RegExp][] = [
    ["inverted window", observation({ startTime: END, endTime: START }), /after its start/],
    [
      "points outside the window",
      observation({ points: [
        { lat: 51.5, lng: -0.12, accuracy: 6, timestamp: START - 60_000 },
        { lat: 51.5, lng: -0.12, accuracy: 6, timestamp: END + 60_000 },
      ] }),
      /outside the session window/,
    ],
    [
      "unordered timestamps",
      observation({ points: [
        { lat: 51.5, lng: -0.12, accuracy: 6, timestamp: START + 200_000 },
        { lat: 51.5, lng: -0.12, accuracy: 6, timestamp: START + 100_000 },
      ] }),
      /increasing time order/,
    ],
    ["in the future", observation({ startTime: NOW + 3_600_000, endTime: NOW + 7_200_000 }), /in the future/],
    ["too old", observation({ startTime: NOW - 90 * 86_400_000, endTime: NOW - 89 * 86_400_000 }), /too old/],
    ["over 24 hours", observation({ startTime: START, endTime: START + 25 * 3_600_000 }), /exceeds 24 hours/],
    [
      "non-finite coordinate",
      observation({ points: [
        { lat: Number.NaN, lng: -0.12, accuracy: 6, timestamp: START + 1_000 },
        { lat: 51.5, lng: -0.12, accuracy: 6, timestamp: START + 2_000 },
      ] }),
      /non-finite/,
    ],
  ];

  for (const [name, obs, expected] of cases) {
    const reasons = structuralRejections(obs, NOW);
    assert.ok(reasons.length > 0, `${name} was accepted`);
    assert.ok(reasons.some((r) => expected.test(r)), `${name}: got ${JSON.stringify(reasons)}`);
  }
});

test("a structurally invalid session is never measured", () => {
  // A self-inconsistent payload must not come back carrying a distance that
  // looks authoritative.
  const result = verifyMovement(observation({ startTime: END, endTime: START }), {
    detectAnomalies: () => assert.fail("anomaly detection must not run"),
    calculateDistance: () => assert.fail("distance must not be computed"),
    traversedHexIds: () => assert.fail("hexes must not be derived"),
    now: () => NOW,
  });
  assert.equal(result.status, "rejected");
  assert.equal(result.distanceMeters, null);
  assert.deepEqual(result.traversedHexIds, []);
});

/* ── idempotency ──────────────────────────────────────────────────────────── */

test("an exact retry returns the original result, not a duplicate or a rejection", async () => {
  const repository = new InMemoryMovementVerificationRepository();
  const service = buildService(repository);
  const input = { userId: "usr_a", clientSessionId: "session-aaaaaaa1", observation: observation() };

  const first = await service.submit(input);
  const second = await service.submit(input);

  assert.equal(first.created, true);
  assert.equal(second.created, false, "a retry must not create a second verification");
  assert.equal(second.record.id, first.record.id, "same row");
  assert.equal(second.record.status, "verified", "a retry is not a duplicate-rejection");
  assert.deepEqual(second.record, first.record);
});

test("two concurrent retries converge on one row via the DB constraint", async () => {
  // Models the race the unique index exists for. BOTH callers must miss the
  // lookup, or the loser never reaches the insert and the conflict path — the
  // only thing that actually holds under concurrency — goes untested.
  const inner = new InMemoryMovementVerificationRepository();
  let lookups = 0;
  const racing: MovementVerificationRepository = {
    async findByUserSession(userId, sessionId) {
      lookups += 1;
      // The first two lookups are the two callers checking before inserting;
      // both legitimately see nothing. Later lookups are the loser re-reading.
      if (lookups <= 2) return null;
      return inner.findByUserSession(userId, sessionId);
    },
    create: (input: CreateMovementVerificationInput) => inner.create(input),
  };
  let verifications = 0;
  const service = new MovementVerificationService({
    repository: racing,
    generateId: () => `mv_race_${++idCounter}`,
    now: () => NOW,
    detectAnomalies: () => {
      verifications += 1;
      return { isAnomaly: false, reasons: [], confidence: 0.95 };
    },
    calculateDistance: () => 412,
    traversedHexIds: () => [],
  });
  const input = { userId: "usr_a", clientSessionId: "session-race0001", observation: observation() };

  const a = await service.submit(input);
  const b = await service.submit(input);

  assert.equal(a.record.id, b.record.id, "the loser must adopt the winner's row");
  assert.equal(a.created, true);
  assert.equal(b.created, false, "the loser must not report a fresh verification");
  assert.equal(verifications, 2, "both raced, so both measured — but only one row survives");
});

test("the stored result is returned without re-running verification", async () => {
  // The fast-path lookup is what stops a retry from re-measuring. Correctness
  // does not depend on it — the DB constraint is the real arbiter — but a
  // retry that silently re-verifies would burn CPU on every offline replay and
  // would mask a mismatch between two runs over the same points.
  const repository = new InMemoryMovementVerificationRepository();
  let verifications = 0;
  const service = new MovementVerificationService({
    repository,
    generateId: () => `mv_fast_${++idCounter}`,
    now: () => NOW,
    detectAnomalies: () => {
      verifications += 1;
      return { isAnomaly: false, reasons: [], confidence: 0.95 };
    },
    calculateDistance: () => 412,
    traversedHexIds: () => [],
  });
  const input = { userId: "usr_a", clientSessionId: "session-fast0001", observation: observation() };

  await service.submit(input);
  await service.submit(input);
  await service.submit(input);

  assert.equal(verifications, 1, "a retry must reuse the stored result, not re-measure");
});

test("a conflict with no readable winner fails closed rather than verifying twice", async () => {
  const lying: MovementVerificationRepository = {
    async findByUserSession() { return null; },
    async create() { throw new MovementSessionConflictError(); },
  };
  const service = buildService(lying);
  await assert.rejects(
    () => service.submit({ userId: "usr_a", clientSessionId: "session-liar0001", observation: observation() }),
    MovementSessionConflictError,
  );
});

test("a rejected session stays rejected on retry, and is still only stored once", async () => {
  const repository = new InMemoryMovementVerificationRepository();
  const service = new MovementVerificationService({
    repository,
    generateId: () => `mv_rej_${++idCounter}`,
    now: () => NOW,
    detectAnomalies: () => ({ isAnomaly: true, reasons: ["Implausible speed at index 1"], confidence: 0.2 }),
    calculateDistance: () => assert.fail("a rejected session must not be measured"),
    traversedHexIds: () => assert.fail("a rejected session must not derive hexes"),
  });
  const input = { userId: "usr_a", clientSessionId: "session-rej00001", observation: observation() };

  const first = await service.submit(input);
  const second = await service.submit(input);

  assert.equal(first.record.status, "rejected");
  assert.equal(second.created, false);
  assert.equal(second.record.id, first.record.id);
  assert.deepEqual(second.record.rejectionReasons, ["Implausible speed at index 1"]);
});

/* ── account isolation ────────────────────────────────────────────────────── */

test("the same session id under two users is two independent verifications", async () => {
  const repository = new InMemoryMovementVerificationRepository();
  const service = buildService(repository);
  const sessionId = "session-shared01";

  const a = await service.submit({ userId: "usr_a", clientSessionId: sessionId, observation: observation() });
  const b = await service.submit({ userId: "usr_b", clientSessionId: sessionId, observation: observation() });

  assert.equal(a.created, true);
  assert.equal(b.created, true, "user B must not inherit user A's verification");
  assert.notEqual(a.record.id, b.record.id);
  assert.equal(a.record.userId, "usr_a");
  assert.equal(b.record.userId, "usr_b");
});

test("a read is scoped to the owner — another user's session id does not resolve", async () => {
  const service = buildService();
  await service.submit({ userId: "usr_a", clientSessionId: "session-owned001", observation: observation() });

  assert.ok(await service.get("usr_a", "session-owned001"));
  assert.equal(await service.get("usr_b", "session-owned001"), null);
});

/* ── HTTP surface ─────────────────────────────────────────────────────────── */

async function withServer(
  fn: (base: string) => Promise<void>,
  verifyBearer = async (token: string) => {
    if (token === "token-a") return { userId: "usr_a" };
    if (token === "token-b") return { userId: "usr_b" };
    const { IdentityError } = await import("../identity/domain/errors.js");
    throw new IdentityError("unauthenticated");
  },
) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/movement", createMovementRouter({ service: buildService(), verifyBearer }));
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const body = (sessionId: string) => JSON.stringify({
  sessionId,
  startTime: START,
  endTime: END,
  points: observation().points,
});

test("HTTP: no bearer token is a 401 before anything is parsed or stored", async () => {
  await withServer(async (base) => {
    for (const headers of [{}, { authorization: "Basic abc" }, { authorization: "Bearer " }]) {
      const res = await fetch(`${base}/movement/verify`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: body("session-noauth01"),
      });
      assert.equal(res.status, 401);
    }
  });
});

test("HTTP: first submit is 201, the retry is 200, and both bodies are identical", async () => {
  await withServer(async (base) => {
    const send = () =>
      fetch(`${base}/movement/verify`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer token-a" },
        body: body("session-http0001"),
      });

    const first = await send();
    const firstJson = await first.json();
    const second = await send();
    const secondJson = await second.json();

    assert.equal(first.status, 201);
    assert.equal(second.status, 200, "a retry is an existing result, not a new submission");
    assert.deepEqual(secondJson, firstJson);
    assert.equal(firstJson.status, "verified");
    assert.equal(firstJson.distanceMeters, 412);
  });
});

test("HTTP: the response carries no chain artefact, no wallet, and no anti-cheat signal", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/movement/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer token-a" },
      body: body("session-shape001"),
    });
    const json = await res.json();
    assert.deepEqual(
      Object.keys(json).sort(),
      ["distanceMeters", "durationSeconds", "rejectionReasons", "sessionId", "status", "traversedHexIds", "verifiedAt"],
    );
    for (const leaked of ["oracleSig", "routeHash", "walletAddress", "userId", "confidence", "capturedZones", "xp", "owner"]) {
      assert.ok(!(leaked in json), `response leaked ${leaked}`);
    }
  });
});

test("HTTP: one user cannot read another user's verification", async () => {
  await withServer(async (base) => {
    await fetch(`${base}/movement/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer token-a" },
      body: body("session-private1"),
    });

    const mine = await fetch(`${base}/movement/verify/session-private1`, {
      headers: { authorization: "Bearer token-a" },
    });
    assert.equal(mine.status, 200);

    // 404, not 403 — the endpoint must not confirm that the id exists.
    const theirs = await fetch(`${base}/movement/verify/session-private1`, {
      headers: { authorization: "Bearer token-b" },
    });
    assert.equal(theirs.status, 404);
  });
});

test("HTTP: a malformed body is a stable 400 that does not echo the payload", async () => {
  await withServer(async (base) => {
    for (const bad of [
      { sessionId: "short", startTime: START, endTime: END, points: observation().points },
      { sessionId: "session-bad00001", startTime: START, endTime: END, points: [observation().points[0]] },
      { sessionId: "session-bad00001", startTime: START, endTime: END, points: observation().points, xp: 10 },
      { sessionId: "session-bad00001", startTime: START, endTime: END },
    ]) {
      const res = await fetch(`${base}/movement/verify`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer token-a" },
        body: JSON.stringify(bad),
      });
      assert.equal(res.status, 400);
      const text = await res.text();
      assert.ok(!text.includes("51.5"), "the error must not echo submitted coordinates");
    }
  });
});
