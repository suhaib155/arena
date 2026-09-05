/** Exercise serialized requests through the production movement router and
 * real verification, GPS, H3 and sealing. Only storage, bearer resolution and
 * time are injected; PostgreSQL persistence has a separate integration suite. */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import { RouteStatus } from "@movenrun/shared";
import { DEFAULT_MOVEMENT_MODE, SESSION_RULES_VERSION } from "@movenrun/shared/session";
import { IdentityError } from "../../identity/domain/errors.js";
import { GpsService } from "../../services/gps.service.js";
import { HexService } from "../../services/hex.service.js";
import type { MovementObservation } from "../domain/types.js";
import { InMemoryMovementVerificationRepository } from "../repositories/interfaces.js";
import { MovementVerificationService } from "../services/movementVerification.service.js";
import { createMovementRouter } from "./router.js";

const T0 = 1_756_000_000_000;
const OFFSETS = [
  [0, 0], [0, 20], [0, 40], [0, 60], [20, 60], [40, 60],
  [60, 60], [60, 45], [60, 30], [30, 30], [-30, 30], [-60, 30],
];

function requestBody(sessionId = "session-http-provenance") {
  return {
    sessionId,
    startTime: T0,
    endTime: T0 + 110_000,
    points: OFFSETS.map(([east, north], index) => ({
      lat: 12.9716 + north / 111_320,
      lng: 77.5946 + east / (111_320 * Math.cos(12.9716 * Math.PI / 180)),
      accuracy: 8,
      timestamp: T0 + index * 10_000,
    })),
    session: {
      mode: DEFAULT_MOVEMENT_MODE,
      rulesVersion: SESSION_RULES_VERSION,
      startedAt: T0 - 1_000,
      finishedAt: T0 + 130_000,
      pauses: [{ startedAt: T0 + 115_000, endedAt: T0 + 120_000 }],
    },
  };
}

function harness() {
  const repository = new InMemoryMovementVerificationRepository();
  const gps = new GpsService();
  const hex = new HexService();
  const measured: MovementObservation[] = [];
  let nextId = 0;
  const service = new MovementVerificationService({
    repository,
    generateId: () => `verification-${++nextId}`,
    now: () => T0 + 300_000,
    detectAnomalies: (observation) => {
      measured.push(observation);
      return gps.validateRoute({
        id: "", userId: "", walletAddress: "", distanceMeters: 0,
        hexIds: [], status: RouteStatus.Processing, ...observation,
      });
    },
    calculateDistance: (points) => gps.calculateDistance(points),
    traversedHexIds: (points) => hex.getHexIdsForPoints(points),
  });
  return { repository, measured, service };
}

async function withServer(fn: (base: string, context: ReturnType<typeof harness>) => Promise<void>) {
  const context = harness();
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/movement", createMovementRouter({
    service: context.service,
    verifyBearer: async (token) => {
      if (token === "user-a-token") return { userId: "user-a" };
      if (token === "user-b-token") return { userId: "user-b" };
      throw new IdentityError(token === "expired-token" ? "session_expired" : "session_invalid");
    },
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}/movement/verify`, context);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function submit(base: string, body: unknown, authorization = "Bearer user-a-token") {
  const response = await fetch(base, {
    method: "POST",
    headers: { "content-type": "application/json", authorization },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test("HTTP provenance: the same route seals through the router and direct service", async () => {
  await withServer(async (base, { service, repository, measured }) => {
    const body = requestBody();
    const { sessionId, ...observation } = body;
    const direct = await service.submit({ userId: "direct-user", clientSessionId: sessionId, observation });
    assert.equal(direct.record.sealed, true, "the fixture must seal before comparing HTTP");
    assert.ok(direct.record.sealMethods?.includes("self_cross"));

    const http = await submit(base, body);
    assert.equal(http.status, 201);
    assert.equal(http.body.status, "verified");
    assert.equal(http.body.sealed, direct.record.sealed, "HTTP lost provenance: service-direct sealed but HTTP did not");
    assert.deepEqual(http.body.sealMethods, direct.record.sealMethods);
    assert.equal(http.body.sealCount, direct.record.sealEventCount);
    assert.equal(http.body.distanceMeters, direct.record.distanceMeters);
    assert.deepEqual(measured[1], observation, "the domain must receive the exact parsed metadata and observations");

    const stored = await repository.findByUserSession("user-a", sessionId);
    assert.ok(stored);
    assert.equal(stored.movementMode, body.session.mode);
    assert.equal(stored.rulesVersion, body.session.rulesVersion);
    assert.equal(stored.startedAt, body.session.startedAt);
    assert.equal(stored.finishedAt, body.session.finishedAt);
    assert.equal(stored.pausedMs, 5_000);
    for (const key of ["points", "pauses", "session", "intersection", "sealEvents", "xp", "owner", "capturedCells"]) {
      assert.ok(!(key in stored), `repository retained ${key}`);
      assert.ok(!(key in http.body), `response exposed ${key}`);
    }
  });
});

test("HTTP provenance: pause timestamps reach sealing without reconstruction", async () => {
  await withServer(async (base) => {
    const body = requestBody();
    body.session.pauses = [{ startedAt: T0 + 91_000, endedAt: T0 + 99_000 }];
    const http = await submit(base, body);
    assert.equal(http.status, 201);
    assert.equal(http.body.status, "verified");
    assert.deepEqual(http.body.sealMethods, ["return_to_start"], "the paused crossing cannot be a self-cross seal");
    assert.equal(http.body.sealCount, 1);
  });
});

test("HTTP provenance: lifecycle contradictions are rejected before measurement", async () => {
  await withServer(async (base, { measured }) => {
    const cases = [
      { change: { startedAt: T0 + 1 }, reason: /begin before the session started/ },
      { change: { finishedAt: T0 + 100_000 }, reason: /continue after the session finished/ },
      { change: { startedAt: T0 + 140_000 }, reason: /finished before it started/ },
      { change: { pauses: [{ startedAt: T0 + 20_000, endedAt: T0 + 10_000 }] }, reason: /end before they begin/ },
      { change: { pauses: [{ startedAt: T0 - 2_000, endedAt: T0 }] }, reason: /fall outside the session/ },
      { change: { pauses: [
        { startedAt: T0 + 10_000, endedAt: T0 + 30_000 },
        { startedAt: T0 + 20_000, endedAt: T0 + 40_000 },
      ] }, reason: /overlap or are out of order/ },
    ];
    for (const [index, { change, reason }] of cases.entries()) {
      const body = requestBody(`session-contradiction-${index}`);
      const result = await submit(base, { ...body, session: { ...body.session, ...change } });
      assert.equal(result.status, 201, "structurally rejected evidence still has an idempotent result");
      assert.equal(result.body.status, "rejected", String(reason));
      assert.ok(result.body.rejectionReasons.some((value: string) => reason.test(value)));
      assert.equal(result.body.distanceMeters, null);
      assert.equal(result.body.sealed, null);
      assert.deepEqual(result.body.traversedHexIds, []);
      assert.ok(!JSON.stringify(result.body.rejectionReasons).includes(String(T0)));
    }
    assert.equal(measured.length, 0);
  });
});

test("HTTP provenance: immutable retries conflict and leave the first result untouched", async () => {
  await withServer(async (base, { measured }) => {
    const body = requestBody();
    const first = await submit(base, body);
    assert.equal(first.status, 201);
    for (const change of [
      { startedAt: T0 - 2_000 },
      { finishedAt: T0 + 140_000 },
      { pauses: [] },
    ]) {
      const changed = await submit(base, { ...body, session: { ...body.session, ...change } });
      assert.equal(changed.status, 409);
      assert.deepEqual(changed.body, { error: "session_metadata_conflict" });
    }
    const replay = await submit(base, body);
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.body, first.body);
    assert.equal(measured.length, 1);
  });
});

test("HTTP provenance: legacy absence remains unknown and cannot backfill a stored result", async () => {
  await withServer(async (base, { repository }) => {
    const modern = requestBody();
    const { session: _session, ...legacy } = modern;
    const first = await submit(base, legacy);
    assert.equal(first.status, 201);
    assert.equal(first.body.status, "verified");
    assert.equal(first.body.sealed, null);
    assert.equal(first.body.sealMethods, null);
    assert.equal(first.body.sealCount, null);
    const replay = await submit(base, modern);
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.body, first.body);
    const stored = await repository.findByUserSession("user-a", modern.sessionId);
    for (const key of ["movementMode", "rulesVersion", "startedAt", "finishedAt", "pausedMs"] as const) {
      assert.equal(stored?.[key], null);
    }

    const current = requestBody("session-current-legacy-retry");
    const currentResult = await submit(base, current);
    const { session: _currentSession, ...oldRetry } = current;
    const oldResult = await submit(base, oldRetry);
    assert.equal(oldResult.status, 200);
    assert.equal(oldResult.body.sealed, true);
    assert.deepEqual(oldResult.body, currentResult.body);
  });
});

test("HTTP provenance: strict schemas reject authority fields and unknown rules before storage", async () => {
  await withServer(async (base, { measured, repository }) => {
    const body = requestBody();
    const forbidden = [
      { sealed: true }, { sealMethods: ["self_cross"] }, { sealCount: 99 },
      { distanceMeters: 99_000 }, { durationSeconds: 1 }, { traversedHexIds: [] },
      { capturedCells: [] }, { xp: 100 }, { owner: "user-b" }, { userId: "user-b" },
      { trustScore: 1 }, { status: "verified" }, { heldCells: [] },
    ];
    const badBodies = [
      ...forbidden.map((extra) => ({ ...body, ...extra })),
      ...forbidden.map((extra) => ({ ...body, session: { ...body.session, ...extra } })),
      { ...body, session: { ...body.session, rulesVersion: 999 } },
      { ...body, session: { ...body.session, mode: "cycling" } },
      { ...body, points: [{ ...body.points[0], verified: true }, ...body.points.slice(1)] },
      { ...body, session: { ...body.session, pauses: [{ ...body.session.pauses[0], sealed: true }] } },
    ];
    for (const badBody of badBodies) {
      const result = await submit(base, badBody);
      assert.equal(result.status, 400);
      assert.equal(result.body.error.code, "invalid_request");
      assert.ok(!JSON.stringify(result.body).includes(String(body.points[0].lat)));
    }
    assert.equal(measured.length, 0);
    assert.equal(await repository.findByUserSession("user-a", body.sessionId), null);
  });
});

test("HTTP provenance: authentication remains authoritative and reads remain owner-scoped", async () => {
  await withServer(async (base, { repository, measured }) => {
    const body = requestBody();
    for (const authorization of ["", "Basic abc", "Bearer ", "Bearer unknown", "Bearer expired-token"]) {
      const result = await submit(base, { ...body, userId: "user-a" }, authorization);
      assert.equal(result.status, 401, "authentication precedes even strict body validation");
    }
    assert.equal(measured.length, 0);
    const mine = await submit(base, body);
    assert.equal(mine.status, 201);
    assert.ok(await repository.findByUserSession("user-a", body.sessionId));
    assert.equal(await repository.findByUserSession("user-b", body.sessionId), null);
    const theirs = await fetch(`${base}/${body.sessionId}`, { headers: { authorization: "Bearer user-b-token" } });
    assert.equal(theirs.status, 404);
    const own = await fetch(`${base}/${body.sessionId}`, { headers: { authorization: "Bearer user-a-token" } });
    assert.equal(own.status, 200);
    assert.deepEqual(await own.json(), mine.body);
  });
});
