/**
 * Sealing, where the server decides it.
 *
 * The engine's geometry is proven in the shared domain. What is proven here is
 * everything the server adds around it: that sealing runs on the route the
 * server *believes*, that a rejected route produces no authoritative seal, that
 * the client cannot assert one, that what reaches the database is a summary and
 * never a place, and that a retry gets the same answer.
 *
 * The database half runs against a real PostgreSQL and is skipped, loudly, when
 * `MOVENRUN_TEST_DATABASE_URL` is not set — skipped rather than quietly passing,
 * so a green suite on a machine without Postgres does not read as proof.
 *
 * It builds into a **database of its own**. The test runner gives each file its
 * own process and runs them at the same time, so two files that both rebuilt
 * `public` would take turns dropping the tables out from under each other — a
 * race that passes most of the time, which is the worst kind.
 *
 * A database rather than a schema, because the committed migrations name
 * `"public"."routes"` and `"public"."users"` explicitly in their foreign keys.
 * Redirecting `search_path` creates the tables somewhere else and leaves those
 * references pointing at a schema that no longer has them — which passes on a
 * machine whose `public` still holds tables from an earlier run, and fails on a
 * fresh one. Each database has its own `public`, so the migrations mean what
 * they say.
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
import { verifyMovement } from "./domain/verification.js";
import { toSealSummary } from "./domain/types.js";
import { MovementVerificationService } from "./services/movementVerification.service.js";
import { DrizzleMovementVerificationRepository } from "./repositories/drizzle/store.js";
import { InMemoryMovementVerificationRepository } from "./repositories/interfaces.js";
import type { MovementObservation, ObservedPoint } from "./domain/types.js";
import type { Db } from "../db/client.js";

const DATABASE_URL = process.env.MOVENRUN_TEST_DATABASE_URL;
/** This file's own database. See the header: concurrent files must not share one. */
const DATABASE = "movenrun_test_sealing";

/** The same server, a different database. */
function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}
const BACKEND = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const T0 = 1_756_000_000_000;
const USER = "usr_seal_1";

const ORIGIN = { lat: 12.9716, lng: 77.5946 };
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);

/** A fix `e` metres east and `n` metres north of the origin. */
function at(e: number, n: number, index: number): ObservedPoint {
  return {
    lat: ORIGIN.lat + n / M_PER_DEG_LAT,
    lng: ORIGIN.lng + e / M_PER_DEG_LON,
    accuracy: 8,
    timestamp: T0 + index * 10_000,
  };
}

function points(offsets: readonly (readonly [number, number])[]): ObservedPoint[] {
  return offsets.map(([e, n], i) => at(e, n, i));
}

/** Up, round, and back across the line you came up — the canonical closure. */
const LASSO = [
  [0, 0],
  [0, 60],
  [60, 60],
  [60, 30],
  [-30, 30],
] as const;

/** Away and never back: a perfectly good session that does not close. */
const OPEN_ROUTE = [
  [0, 0],
  [180, 0],
  [360, 0],
  [540, 0],
  [720, 0],
] as const;

function session(over: Record<string, unknown> = {}) {
  return {
    mode: DEFAULT_MOVEMENT_MODE,
    rulesVersion: SESSION_RULES_VERSION,
    startedAt: T0 - 1_000,
    finishedAt: T0 + 600_000,
    pauses: [] as { startedAt: number; endedAt: number }[],
    ...over,
  };
}

function observation(
  offsets: readonly (readonly [number, number])[],
  withSession: boolean | Record<string, unknown> = true,
): MovementObservation {
  const p = points(offsets);
  return {
    startTime: p[0]!.timestamp,
    endTime: p[p.length - 1]!.timestamp,
    points: p,
    session:
      withSession === false
        ? undefined
        : (session(typeof withSession === "object" ? withSession : {}) as never),
  };
}

const deps = {
  detectAnomalies: () => ({ isAnomaly: false, reasons: [], confidence: 0.95 }),
  calculateDistance: () => 431,
  traversedHexIds: () => ["8860145b49fffff"],
  now: () => T0 + 900_000,
};

/* ── sealing runs on the route the server believes ────────────────────────── */

test("a verified route that cuts its own line seals", () => {
  const result = verifyMovement(observation(LASSO), deps);
  assert.equal(result.status, "verified");
  const summary = toSealSummary(result.sealEvaluation)!;
  assert.equal(summary.sealed, true);
  assert.deepEqual(summary.methods, ["self_cross", "return_to_start"]);
  assert.equal(summary.eventCount, 2);
});

test("a verified route that stays open is evaluated and does not seal", () => {
  const result = verifyMovement(observation(OPEN_ROUTE), deps);
  assert.equal(result.status, "verified");
  const summary = toSealSummary(result.sealEvaluation)!;
  assert.equal(summary.sealed, false, "an open route must not seal");
  assert.deepEqual(summary.methods, []);
  /* And it is still a perfectly good verification — unsealed is not rejected. */
  assert.equal(result.rejectionReasons.length, 0);
  assert.equal(result.distanceMeters, 431);
});

test("a rejected route produces no authoritative seal at all", () => {
  /* The loop is right there in the geometry, and the phone may well have shown
     it. A route the server does not believe cannot close anything. */
  const anomalous = verifyMovement(observation(LASSO), {
    ...deps,
    detectAnomalies: () => ({ isAnomaly: true, reasons: ["Implausible speed"], confidence: 0.2 }),
  });
  assert.equal(anomalous.status, "rejected");
  assert.equal(anomalous.sealEvaluation, null);
  assert.equal(toSealSummary(anomalous.sealEvaluation), null);

  const structural = verifyMovement(
    { ...observation(LASSO), endTime: T0 - 5_000 },
    deps,
  );
  assert.equal(structural.status, "rejected");
  assert.equal(structural.sealEvaluation, null);
});

test("a legacy submission carrying no provenance seals nothing, rather than sealing under today's rules", () => {
  const result = verifyMovement(observation(LASSO, false), deps);
  assert.equal(result.status, "verified");
  assert.equal(result.sealEvaluation, null);
  assert.equal(toSealSummary(result.sealEvaluation), null);
});

test("an unknown rules version fails closed instead of being read as current", () => {
  const result = verifyMovement(observation(LASSO, { rulesVersion: 9 }), deps);
  /* The session schema would refuse this at the edge; the domain refuses it
     again, because a rules version this build cannot interpret must not be
     interpreted. */
  assert.ok(
    result.status === "rejected" || toSealSummary(result.sealEvaluation) === null,
    "an unknown rules version produced a seal summary",
  );
});

test("held ground is never claimed by the server, because nothing can vouch for it", () => {
  const result = verifyMovement(observation(LASSO), deps);
  const evaluation = result.sealEvaluation!;
  assert.equal(evaluation.methods.includes("finish_on_held_ground"), false);
  assert.deepEqual(
    evaluation.unavailable.filter((u) => u.method === "finish_on_held_ground"),
    [{ method: "finish_on_held_ground", reason: "no_trusted_territory" }],
    "the server must report the method unavailable, not evaluate it as false",
  );
});

test("the transient evaluation carries the route slice, and the summary does not", () => {
  /* The split this PR exists to hold: geometry lives for one request so the
     territory work can consume it, and what outlives the request is three
     scalars. */
  const result = verifyMovement(observation(LASSO), deps);
  const crossing = result.sealEvaluation!.events.find((e) => e.method === "self_cross")!;
  assert.equal(typeof crossing.startIndex, "number");
  assert.equal(typeof crossing.endIndex, "number");
  assert.equal(crossing.closure.kind, "crossing");

  const summary = toSealSummary(result.sealEvaluation)!;
  assert.deepEqual(Object.keys(summary).sort(), ["eventCount", "methods", "sealed"]);
  const serialized = JSON.stringify(summary);
  for (const located of ["Index", "closure", "fraction", "12.97", "77.59"]) {
    assert.ok(!serialized.includes(located), `the summary carries ${located}`);
  }
});

/* ── the client cannot assert a seal ──────────────────────────────────────── */

test("the strict schema refuses every sealing and territory field a client might send", () => {
  const valid = {
    sessionId: "mv-seal-abcdef12",
    startTime: T0,
    endTime: T0 + 40_000,
    points: points(LASSO).map((p) => ({ ...p })),
    session: session(),
  };
  for (const forbidden of [
    { sealed: true },
    { sealMethod: "self_cross" },
    { sealMethods: ["self_cross"] },
    { sealEvents: [] },
    { sealCount: 3 },
    { intersection: { lat: 12.97, lng: 77.59 } },
    { sealPolygon: [] },
    { heldCells: ["8860145b49fffff"] },
    { capturedCells: ["8860145b49fffff"] },
    { solidCells: [] },
    { shadeCells: [] },
    { finishOnOwned: true },
  ]) {
    assert.throws(
      () => parseBody(submitMovementSchema, { ...valid, ...forbidden }),
      /invalid/i,
      `the schema accepted ${Object.keys(forbidden)[0]}`,
    );
  }
});

test("a seal field smuggled inside the session block is refused too", () => {
  const valid = {
    sessionId: "mv-seal-abcdef12",
    startTime: T0,
    endTime: T0 + 40_000,
    points: points(LASSO).map((p) => ({ ...p })),
  };
  for (const extra of [{ sealed: true }, { heldCells: [] }, { sealEvents: [] }]) {
    assert.throws(
      () => parseBody(submitMovementSchema, { ...valid, session: { ...session(), ...extra } }),
      /invalid/i,
      `the session block accepted ${Object.keys(extra)[0]}`,
    );
  }
});

/* ── determinism and retry ────────────────────────────────────────────────── */

test("the same route always seals the same way", () => {
  const observed = observation(LASSO);
  const a = verifyMovement(observed, deps);
  const b = verifyMovement(observed, deps);
  assert.deepEqual(a.sealEvaluation, b.sealEvaluation);
});

test("a retry returns the seal the first submission established", async () => {
  const service = new MovementVerificationService({
    repository: new InMemoryMovementVerificationRepository(),
    generateId: () => "mv-row-1",
    ...deps,
  });
  const input = {
    userId: USER,
    clientSessionId: "mv-retry-abcdef12",
    observation: observation(LASSO),
  };
  const first = await service.submit(input);
  assert.equal(first.created, true);
  assert.equal(first.record.sealed, true);
  assert.equal(first.record.sealEventCount, 2);

  const retry = await service.submit(input);
  assert.equal(retry.created, false);
  assert.equal(retry.record.sealed, true);
  assert.deepEqual(retry.record.sealMethods, first.record.sealMethods);
  assert.equal(retry.record.sealEventCount, first.record.sealEventCount);
});

test("a legacy row keeps NULL sealing rather than being backfilled", async () => {
  const service = new MovementVerificationService({
    repository: new InMemoryMovementVerificationRepository(),
    generateId: () => "mv-row-legacy",
    ...deps,
  });
  const { record } = await service.submit({
    userId: USER,
    clientSessionId: "mv-legacy-abcdef12",
    observation: observation(LASSO, false),
  });
  assert.equal(record.sealed, null);
  assert.equal(record.sealMethods, null);
  assert.equal(record.sealEventCount, null);
  /* NULL is not "did not seal". It is "the engine never ran on this row", and
     the two must stay distinguishable for as long as legacy rows exist. */
  assert.notEqual(record.sealed, false);
});

/* ── the database ─────────────────────────────────────────────────────────── */

let pool: pg.Pool | null = null;
let db: Db | null = null;

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
  /* Rebuilt from nothing on every run, so a leftover table from a previous run
     can never stand in for one a migration was supposed to create. */
  const admin = new pg.Pool({ connectionString: DATABASE_URL });
  await admin.query(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${DATABASE}`);
  await admin.end();

  pool = new pg.Pool({ connectionString: withDatabase(DATABASE_URL, DATABASE) });
  await migrate(pool);
  db = drizzle(pool) as unknown as Db;
});

after(async () => {
  await pool?.end();
});

const skip = DATABASE_URL
  ? false
  : "MOVENRUN_TEST_DATABASE_URL is not set — the PostgreSQL path was NOT verified";

function pgService(database: Db, id: string) {
  return new MovementVerificationService({
    repository: new DrizzleMovementVerificationRepository(database),
    generateId: () => id,
    ...deps,
  });
}

test("a sealed session reaches PostgreSQL as three scalars and nothing more", { skip }, async () => {
  const { record } = await pgService(db!, "mv-pg-sealed").submit({
    userId: USER,
    clientSessionId: "mv-pg-sealed-1",
    observation: observation(LASSO),
  });
  assert.equal(record.sealed, true);
  assert.deepEqual(record.sealMethods, ["self_cross", "return_to_start"]);
  assert.equal(record.sealEventCount, 2);

  const rows = await db!
    .select()
    .from(movementVerifications)
    .where(eq(movementVerifications.clientSessionId, "mv-pg-sealed-1"));
  assert.equal(rows.length, 1);
  const serialized = JSON.stringify(rows[0]);
  /* The lasso runs through Bengaluru and closes at a specific street corner.
     None of that may be on disk — not the route, not the crossing, not the
     polygon it encloses. */
  for (const coordinate of ["12.97", "77.59"]) {
    assert.ok(!serialized.includes(coordinate), `the row stores a coordinate: ${coordinate}`);
  }
  for (const column of [
    "sealPolygon", "seal_polygon", "intersection", "sealEvents", "seal_events",
    "sealStart", "seal_start", "startIndex", "start_index", "closure",
  ]) {
    assert.ok(!(column in rows[0]!), `the row grew seal geometry: ${column}`);
  }
});

test("an unsealed session is stored as evaluated-and-open, not as unknown", { skip }, async () => {
  const { record } = await pgService(db!, "mv-pg-open").submit({
    userId: USER,
    clientSessionId: "mv-pg-open-1",
    observation: observation(OPEN_ROUTE),
  });
  assert.equal(record.sealed, false);
  assert.deepEqual(record.sealMethods, []);
  assert.equal(record.sealEventCount, 0);
  assert.equal(record.status, "verified", "an unsealed route is still verified movement");
});

test("a legacy submission stores NULL sealing beside a sealed row", { skip }, async () => {
  const { record } = await pgService(db!, "mv-pg-legacy").submit({
    userId: USER,
    clientSessionId: "mv-pg-legacy-1",
    observation: observation(LASSO, false),
  });
  assert.equal(record.sealed, null);
  assert.equal(record.sealMethods, null);
  assert.equal(record.sealEventCount, null);
  assert.equal(record.status, "verified");
});

test("a rejected session stores NULL sealing, never a seal it did not earn", { skip }, async () => {
  const service = new MovementVerificationService({
    repository: new DrizzleMovementVerificationRepository(db!),
    generateId: () => "mv-pg-rejected",
    ...deps,
    detectAnomalies: () => ({ isAnomaly: true, reasons: ["Implausible speed"], confidence: 0.2 }),
  });
  const { record } = await service.submit({
    userId: USER,
    clientSessionId: "mv-pg-rejected-1",
    observation: observation(LASSO),
  });
  assert.equal(record.status, "rejected");
  assert.equal(record.sealed, null);
});

test("a retry of a sealed session converges on one row with one seal", { skip }, async () => {
  const observed = observation(LASSO);
  const results = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      pgService(db!, `mv-pg-race-${i}`).submit({
        userId: USER,
        clientSessionId: "mv-pg-race-1",
        observation: observed,
      }),
    ),
  );
  const rows = await db!
    .select()
    .from(movementVerifications)
    .where(eq(movementVerifications.clientSessionId, "mv-pg-race-1"));
  assert.equal(rows.length, 1, "the unique constraint did not hold");
  assert.equal(rows[0]!.sealed, true);
  assert.equal(rows[0]!.sealEventCount, 2);
  for (const r of results) assert.equal(r.record.sealEventCount, 2, "callers disagreed on the seal");
});

test("sealing writes nothing to any territory table", { skip }, async () => {
  /* A closed loop is not owned ground, and this is the assertion that says so
     against a real database rather than against a comment. */
  for (const table of ["zones", "hex_activities", "user_route_hexes"]) {
    const { rows } = await pool!.query(
      `select count(*)::int as n from information_schema.tables
        where table_schema = 'public' and table_name = $1`,
      [table],
    );
    if (rows[0].n === 0) continue;
    const { rows: counted } = await pool!.query(`select count(*)::int as n from "${table}"`);
    assert.equal(counted[0].n, 0, `${table} has rows — sealing wrote territory`);
  }
});

test("the sealing columns are exactly three, and none of them is spatial", { skip }, async () => {
  const { rows } = await pool!.query(
    `select column_name, data_type, is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = 'movement_verifications'
        and column_name like 'seal%'
      order by column_name`,
  );
  assert.deepEqual(
    rows.map((r: { column_name: string }) => r.column_name),
    ["seal_event_count", "seal_methods", "sealed"],
  );
  for (const row of rows as { is_nullable: string; data_type: string }[]) {
    assert.equal(row.is_nullable, "YES", "a sealing column is NOT NULL, so legacy rows must lie");
    assert.notEqual(row.data_type, "USER-DEFINED", "a sealing column is a spatial type");
  }
});

test("the PostgreSQL path was actually exercised, in its own database", { skip }, async () => {
  assert.ok(db, "no database handle — the suite above proved nothing");
  const { rows } = await pool!.query("select version() as v, current_database() as d");
  assert.match(rows[0].v, /PostgreSQL/);
  assert.equal(
    rows[0].d,
    DATABASE,
    "this suite ran against a shared database, where another file can drop its tables",
  );
});
