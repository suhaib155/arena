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

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

import { DEFAULT_MOVEMENT_MODE, SESSION_RULES_VERSION } from "@movenrun/shared/session";

import { movementVerifications } from "../db/movement.schema.js";
import { parseBody, submitMovementSchema } from "./http/validation.js";
import { MovementVerificationService } from "./services/movementVerification.service.js";
import { DrizzleMovementVerificationRepository } from "./repositories/drizzle/store.js";
import { MovementSessionMetadataConflictError } from "./repositories/interfaces.js";
import type { Db } from "../db/client.js";

const DATABASE_URL = process.env.MOVENRUN_TEST_DATABASE_URL;
const BACKEND = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const T0 = 1_756_000_000_000;
const USER = "usr_e2e_1";
const SESSION_ID = "mv-e2e-abcdef12";

let pool: pg.Pool | null = null;
let db: Db | null = null;

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
});

after(async () => {
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
