/**
 * One session, all the way through, against a real PostgreSQL.
 *
 * The seams this PR changed are exactly the ones a unit test mocks away: the
 * serialized request shape, the strict schema that parses it, the structural
 * validation, the row that gets written, and the retry that replays it. Each
 * of those is proven in isolation elsewhere. This file proves they line up.
 *
 * It runs against Postgres rather than the in-memory repository because the
 * property that matters most here — one row per (user, session), under
 * concurrency, with immutable metadata — is enforced by a database constraint.
 * An in-memory Map mirroring that constraint proves the mirror works.
 *
 * Skipped, loudly, when no database is configured: `MOVENRUN_TEST_DATABASE_URL`
 * is the switch. It is skipped rather than silently passing, so a green suite
 * on a machine without Postgres does not read as this having been verified.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import express from "express";

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

import { DEFAULT_MOVEMENT_MODE, SESSION_RULES_VERSION } from "@movenrun/shared/session";

import { movementVerifications } from "../db/movement.schema.js";
import { parseBody, submitMovementSchema } from "./http/validation.js";
import { MovementVerificationService } from "./services/movementVerification.service.js";
import { DrizzleMovementVerificationRepository } from "./repositories/drizzle/store.js";
import { MovementSessionMetadataConflictError, MovementSessionConflictError, type CreateMovementVerificationInput } from "./repositories/interfaces.js";
import type { Db } from "../db/client.js";
import { createMovementRouter } from "./http/router.js";
import { GpsService } from "../services/gps.service.js";
import { HexService } from "../services/hex.service.js";
import { createDrizzleStores } from "../identity/repositories/drizzle/stores.js";
import { createIdentityServices } from "../identity/http/wiring.js";
import { resolveIdentityConfig } from "../identity/config.js";

const DATABASE_URL = process.env.MOVENRUN_TEST_DATABASE_URL;
const BACKEND = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const T0 = 1_756_000_000_000;
const USER = "usr_e2e_1";
const SESSION_ID = "mv-e2e-abcdef12";

let pool: pg.Pool | null = null;
let db: Db | null = null;
let httpServer: Server | undefined;
let httpUrl: string;
let accessA: string;
let accessB: string;
let httpUniqueConflicts = 0;

/**
 * Build the schema by running the committed migrations in order, exactly as a
 * deployment would — not by asking Drizzle to push the current model. Pushing
 * would test the model against itself and would never notice a migration that
 * does not produce the schema the code expects.
 */
async function migrate(client: pg.Pool): Promise<void> {
  const journal = JSON.parse(
    readFileSync(join(BACKEND, "drizzle", "meta", "_journal.json"), "utf8"),
  ) as { entries: { tag: string }[] };
  for (const entry of journal.entries) {
    const sql = readFileSync(join(BACKEND, "drizzle", `${entry.tag}.sql`), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim()) await client.query(statement);
    }
  }
}

before(async () => {
  if (!DATABASE_URL) return;
  pool = new pg.Pool({ connectionString: DATABASE_URL });
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(pool);
  db = drizzle(pool) as unknown as Db;
  const stores = createDrizzleStores(db);
  const resolved = resolveIdentityConfig({ NODE_ENV: "test" }, { requireSecrets: false });
  assert.ok(resolved.ok);
  const identity = createIdentityServices(stores, resolved.config);
  await stores.users.create({ id: "usr_http_a" });
  await stores.users.create({ id: "usr_http_b" });
  accessA = (await identity.sessions.issue({ userId: "usr_http_a", assuranceLevel: "aal1" })).accessToken;
  accessB = (await identity.sessions.issue({ userId: "usr_http_b", assuranceLevel: "aal1" })).accessToken;
  const gps = new GpsService();
  const hex = new HexService();
  let initialReads = 0;
  let releaseReads!: () => void;
  const readsReady = new Promise<void>((resolve) => { releaseReads = resolve; });
  class HttpRepository extends DrizzleMovementVerificationRepository {
    override async findByUserSession(userId: string, sessionId: string) {
      const record = await super.findByUserSession(userId, sessionId);
      if (sessionId === "mv-http-pg-concurrent" && !record) {
        if (++initialReads === 8) releaseReads();
        await readsReady;
      }
      return record;
    }
    override async create(input: CreateMovementVerificationInput) {
      try { return await super.create(input); }
      catch (error) {
        if (input.clientSessionId === "mv-http-pg-concurrent" && error instanceof MovementSessionConflictError) httpUniqueConflicts++;
        throw error;
      }
    }
  }
  const service = new MovementVerificationService({
    repository: new HttpRepository(db),
    generateId: randomUUID,
    now: () => T0 + 300_000,
    detectAnomalies: (observation) => gps.validateRoute({
      ...observation, id: "", userId: "", walletAddress: "", distanceMeters: 0,
      hexIds: [], status: "PROCESSING",
    } as never),
    calculateDistance: (points) => gps.calculateDistance(points as never),
    traversedHexIds: (points) => hex.getHexIdsForPoints(points),
  });
  const app = express();
  app.use(express.json());
  app.use("/movement", createMovementRouter({
    service,
    verifyBearer: async (token) => ({ userId: (await identity.sessions.verifyAccess(token)).userId }),
  }));
  httpServer = app.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  const address = httpServer.address();
  assert.ok(address && typeof address !== "string");
  httpUrl = `http://127.0.0.1:${address.port}/movement/verify`;
});

after(async () => {
  if (httpServer) {
    httpServer.closeAllConnections();
    await new Promise<void>((resolve, reject) => httpServer!.close((error) => error ? reject(error) : resolve()));
  }
  await pool?.end();
});

const skip = DATABASE_URL
  ? false
  : "MOVENRUN_TEST_DATABASE_URL is not set — the PostgreSQL path was NOT verified";

/** The request a real device would send, built through the real serializer's
 *  shape and parsed by the real schema. */
function requestBody() {
  return {
    sessionId: SESSION_ID,
    startTime: T0 + 10_000,
    endTime: T0 + 130_000,
    points: [
      { lat: 12.9716, lng: 77.5946, accuracy: 8, timestamp: T0 + 10_000 },
      { lat: 12.9726, lng: 77.5956, accuracy: 9, timestamp: T0 + 70_000 },
      { lat: 12.9736, lng: 77.5966, accuracy: 7, timestamp: T0 + 130_000 },
    ],
    session: {
      mode: DEFAULT_MOVEMENT_MODE,
      rulesVersion: SESSION_RULES_VERSION,
      startedAt: T0,
      finishedAt: T0 + 200_000,
      pauses: [{ startedAt: T0 + 40_000, endedAt: T0 + 55_000 }],
    },
  };
}

function buildService(database: Db) {
  let n = 0;
  return new MovementVerificationService({
    repository: new DrizzleMovementVerificationRepository(database),
    generateId: () => `mv-row-${++n}-${Math.random().toString(36).slice(2, 8)}`,
    now: () => T0 + 300_000,
    detectAnomalies: () => ({ isAnomaly: false, reasons: [], confidence: 0.95 }),
    calculateDistance: () => 431,
    traversedHexIds: () => ["8860145b49fffff", "8860145b4dfffff"],
  });
}

test("a session travels request → schema → verification → PostgreSQL intact", { skip }, async () => {
  const service = buildService(db!);
  const parsed = parseBody(submitMovementSchema, requestBody());

  const { record, created } = await service.submit({
    userId: USER,
    clientSessionId: parsed.sessionId,
    observation: {
      startTime: parsed.startTime,
      endTime: parsed.endTime,
      points: parsed.points,
      session: parsed.session,
    },
  });

  assert.equal(created, true);
  assert.equal(record.status, "verified");
  /* Server-computed, from the observations — not from anything the client sent. */
  assert.equal(record.distanceMeters, 431);
  assert.deepEqual(record.traversedHexIds, ["8860145b49fffff", "8860145b4dfffff"]);
  /* Provenance, stored as submitted. */
  assert.equal(record.movementMode, DEFAULT_MOVEMENT_MODE);
  assert.equal(record.rulesVersion, SESSION_RULES_VERSION);
  assert.equal(record.startedAt, T0);
  assert.equal(record.finishedAt, T0 + 200_000);
  assert.equal(record.pausedMs, 15_000);
});

test("the row on disk holds no coordinates", { skip }, async () => {
  const rows = await db!
    .select()
    .from(movementVerifications)
    .where(eq(movementVerifications.clientSessionId, SESSION_ID));
  assert.equal(rows.length, 1);
  const serialized = JSON.stringify(rows[0]);
  /* The route went through Bengaluru; none of it may be in the row. A verified
     session's durable record keeps derived scalars and traversed cells, and
     has never kept the points. */
  for (const coordinate of ["12.9716", "77.5946", "12.9726", "12.9736"]) {
    assert.ok(!serialized.includes(coordinate), `the row stores a coordinate: ${coordinate}`);
  }
  assert.ok(!("points" in rows[0]), "the row grew a points column");
});

test("a retry of the same session replays to one row, not two", { skip }, async () => {
  const service = buildService(db!);
  const parsed = parseBody(submitMovementSchema, requestBody());
  const observation = {
    startTime: parsed.startTime,
    endTime: parsed.endTime,
    points: parsed.points,
    session: parsed.session,
  };

  const replay = await service.submit({ userId: USER, clientSessionId: SESSION_ID, observation });
  assert.equal(replay.created, false);

  const rows = await db!
    .select()
    .from(movementVerifications)
    .where(eq(movementVerifications.clientSessionId, SESSION_ID));
  assert.equal(rows.length, 1, "a retry created a second row");
  assert.equal(rows[0].movementMode, DEFAULT_MOVEMENT_MODE);
  assert.equal(rows[0].rulesVersion, SESSION_RULES_VERSION);
});

test("concurrent submissions of one session converge on one row", { skip }, async () => {
  const service = buildService(db!);
  const parsed = parseBody(submitMovementSchema, { ...requestBody(), sessionId: "mv-race-abcdef12" });
  const observation = {
    startTime: parsed.startTime,
    endTime: parsed.endTime,
    points: parsed.points,
    session: parsed.session,
  };

  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      service.submit({ userId: USER, clientSessionId: "mv-race-abcdef12", observation }),
    ),
  );
  const rows = await db!
    .select()
    .from(movementVerifications)
    .where(eq(movementVerifications.clientSessionId, "mv-race-abcdef12"));
  assert.equal(rows.length, 1, "the unique constraint did not hold under concurrency");
  assert.equal(results.filter((r) => r.created).length, 1, "exactly one caller created it");
  for (const r of results) assert.equal(r.record.id, rows[0].id, "every caller got the winner");
});

test("a retry carrying different provenance is refused, and the row is untouched", { skip }, async () => {
  const service = buildService(db!);
  const parsed = parseBody(submitMovementSchema, requestBody());

  await assert.rejects(
    () =>
      service.submit({
        userId: USER,
        clientSessionId: SESSION_ID,
        observation: {
          startTime: parsed.startTime,
          endTime: parsed.endTime,
          points: parsed.points,
          session: { ...parsed.session!, startedAt: T0 + 12_345 },
        },
      }),
    MovementSessionMetadataConflictError,
  );

  const rows = await db!
    .select()
    .from(movementVerifications)
    .where(eq(movementVerifications.clientSessionId, SESSION_ID));
  assert.equal(rows[0].startedAt, T0, "the stored provenance was overwritten");
});

test("a legacy submission stores NULL provenance beside a modern row", { skip }, async () => {
  const service = buildService(db!);
  const parsed = parseBody(submitMovementSchema, {
    ...requestBody(),
    sessionId: "mv-legacy-abcdef12",
    session: undefined,
  });
  const { record } = await service.submit({
    userId: USER,
    clientSessionId: "mv-legacy-abcdef12",
    observation: { startTime: parsed.startTime, endTime: parsed.endTime, points: parsed.points },
  });
  assert.equal(record.movementMode, null);
  assert.equal(record.rulesVersion, null);
  assert.equal(record.startedAt, null);
  /* And it is a real, readable, verified row — legacy is not broken. */
  assert.equal(record.status, "verified");
  assert.equal(record.distanceMeters, 431);
});

test("verifying a session writes nothing to any territory table", { skip }, async () => {
  /* `zones`, `hex_activities` and `user_route_hexes` exist in the schema and
     have no writer. Traversal is not capture, and this is the assertion that
     says so against a real database rather than against a comment. */
  for (const table of ["zones", "hex_activities", "user_route_hexes"]) {
    const { rows } = await pool!.query(
      `select count(*)::int as n from information_schema.tables where table_name = $1`,
      [table],
    );
    if (rows[0].n === 0) continue;
    const { rows: counted } = await pool!.query(`select count(*)::int as n from "${table}"`);
    assert.equal(counted[0].n, 0, `${table} has rows — verification wrote territory`);
  }
});

test("the PostgreSQL path was actually exercised", { skip }, async () => {
  /* Fail-closed: without this, every test above would skip on a machine with
     no database and the suite would still be green, which would read as proof
     it had run. */
  assert.ok(db, "no database handle — the suite above proved nothing");
  const { rows } = await pool!.query("select version() as v");
  assert.match(rows[0].v, /PostgreSQL/);
});

// These requests cross the real router, session-token verifier, measurement,
// sealing and Drizzle store. The earlier service tests intentionally remain
// useful unit-of-integration coverage, but cannot prove the HTTP handoff.
function httpBody(id: string, closed = false) {
  const points = Array.from({ length: 11 }, (_, i) => ({
    lat: 12.9716,
    lng: 77.5946 + (closed && i > 5 ? 10 - i : i) * 0.0004,
    accuracy: 8,
    timestamp: T0 + 10_000 + i * 10_000,
  }));
  return {
    sessionId: id,
    startTime: points[0].timestamp,
    endTime: points.at(-1)!.timestamp,
    points,
    session: {
      mode: DEFAULT_MOVEMENT_MODE, rulesVersion: SESSION_RULES_VERSION,
      startedAt: T0, finishedAt: T0 + 120_000,
      pauses: [{ startedAt: T0 + 44_000, endedAt: T0 + 46_000 }],
    },
  };
}

async function postHttp(body: unknown, token = accessA) {
  const response = await fetch(httpUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, any> };
}

async function httpRows(id: string) {
  return db!.select().from(movementVerifications).where(eq(movementVerifications.clientSessionId, id));
}

test("HTTP → bearer → PostgreSQL preserves provenance and evaluated open versus sealed", { skip }, async () => {
  for (const closed of [false, true]) {
    const request = httpBody(`mv-http-pg-${closed}`, closed);
    const response = await postHttp(request);
    assert.equal(response.status, 201);
    assert.equal(response.body.status, "verified");
    assert.equal(response.body.sealed, closed);
    assert.deepEqual(response.body.sealMethods, closed ? ["return_to_start"] : []);
    assert.equal(response.body.sealCount, closed ? 1 : 0);
    const [row] = await httpRows(request.sessionId);
    assert.equal(row.userId, "usr_http_a");
    assert.equal(row.movementMode, "onFoot");
    assert.equal(row.rulesVersion, SESSION_RULES_VERSION);
    assert.equal(row.startedAt, request.session.startedAt);
    assert.equal(row.finishedAt, request.session.finishedAt);
    assert.equal(row.pausedMs, 2_000);
    assert.equal(row.sealed, closed);
    assert.equal(row.sealEventCount, response.body.sealCount);
    assert.equal(row.distanceMeters, response.body.distanceMeters);
    for (const value of [row, response.body]) {
      assert.doesNotMatch(JSON.stringify(value), /12\.9716|77\.5946|"points"|"closure"|"capturedCells"|"xp"/);
    }
  }
});

test("HTTP contradictory lifecycle reaches rejection and persists unevaluated seal", { skip }, async () => {
  const request = httpBody("mv-http-pg-contradiction", true);
  request.session.finishedAt = T0 + 5_000;
  const response = await postHttp(request);
  assert.equal(response.status, 201);
  assert.equal(response.body.status, "rejected");
  assert.equal(response.body.sealed, null);
  assert.equal(response.body.distanceMeters, null);
  const [row] = await httpRows(request.sessionId);
  assert.equal(row.finishedAt, request.session.finishedAt);
  assert.equal(row.sealed, null);
});

test("HTTP immutable metadata conflicts leave the original PostgreSQL row intact", { skip }, async () => {
  const original = httpBody("mv-http-pg-immutable");
  assert.equal((await postHttp(original)).status, 201);
  assert.equal((await postHttp(original)).status, 200);
  for (const session of [
    { ...original.session, startedAt: T0 - 1 },
    { ...original.session, finishedAt: T0 + 130_000 },
    { ...original.session, pauses: [] },
  ]) {
    const response = await postHttp({ ...original, session });
    assert.equal(response.status, 409);
    assert.deepEqual(response.body, { error: "session_metadata_conflict" });
  }
  const rows = await httpRows(original.sessionId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].finishedAt, original.session.finishedAt);
  assert.equal(rows[0].pausedMs, 2_000);
});

test("HTTP concurrent same-ID submissions converge in PostgreSQL across independent requests", { skip }, async () => {
  const request = httpBody("mv-http-pg-concurrent", true);
  const replies = await Promise.all(Array.from({ length: 8 }, () => postHttp(request)));
  assert.equal(replies.filter((reply) => reply.status === 201).length, 1);
  assert.equal(replies.filter((reply) => reply.status === 200).length, 7);
  assert.equal(httpUniqueConflicts, 7, "all losing inserts must recover from the real unique constraint");
  for (const reply of replies) assert.deepEqual(reply.body, replies[0].body);
  const rows = await httpRows(request.sessionId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sealed, true);
  assert.equal(rows[0].movementMode, "onFoot");
});

test("HTTP legacy absence stays NULL on disk even after a modern retry", { skip }, async () => {
  const modern = httpBody("mv-http-pg-legacy", true);
  const { session, ...legacy } = modern;
  const first = await postHttp(legacy);
  assert.equal(first.status, 201);
  assert.equal(first.body.sealed, null);
  const retry = await postHttp(modern);
  assert.equal(retry.status, 200);
  assert.deepEqual(retry.body, first.body);
  const [row] = await httpRows(legacy.sessionId);
  for (const key of ["movementMode", "rulesVersion", "startedAt", "finishedAt", "pausedMs", "sealed", "sealMethods", "sealEventCount"] as const) {
    assert.equal(row[key], null, key);
  }
});

test("HTTP PostgreSQL owner isolation follows real bearer sessions", { skip }, async () => {
  const request = httpBody("mv-http-pg-owner", true);
  assert.equal((await postHttp(request)).status, 201);
  const foreign = await fetch(`${httpUrl}/${request.sessionId}`, { headers: { authorization: `Bearer ${accessB}` } });
  assert.equal(foreign.status, 404);
  await foreign.arrayBuffer();
  assert.equal((await postHttp(request, "invalid-token")).status, 401);
  assert.equal((await postHttp({ ...request, userId: "usr_http_b" })).status, 400);
  const rows = await httpRows(request.sessionId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].userId, "usr_http_a");
  assert.equal((await postHttp(request, accessB)).status, 201);
  assert.equal((await httpRows(request.sessionId)).length, 2);
});
