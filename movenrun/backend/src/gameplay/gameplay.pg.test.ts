/**
 * Gameplay against real PostgreSQL: the proposed migration 0011 (revision 3,
 * compact storage) applied on top of the committed chain 0000 to 0010, the
 * service, the HTTP router and the API's feature flag.
 *
 * Skipped, loudly, when MOVENRUN_TEST_DATABASE_URL is not set: a green suite
 * on a machine without PostgreSQL must not read as this having been verified.
 * Each run creates and drops its own database. The URL's role needs CREATEDB
 * and, for the row level security checks, the Supabase-style `anon` and
 * `authenticated` roles (created here when missing and permitted).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, randomBytes } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import express from "express";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { gridDisk, latLngToCell } from "h3-js";
import type { Db } from "../db/client.js";
import { IdentityError } from "../identity/domain/errors.js";
import { createDrizzleAccountDeletionStore } from "../identity/accountDeletion.js";
import { DAY_MS, PILOT_PROPOSAL, type GameplayRules } from "./rules.js";
import { GameplayService, GameplayError } from "./service.js";
import { SEALED_LOOP, SEAL_COLUMNS, sealLiteral } from "./sealFixtures.js";
import { createCapacityGuard, DEFAULT_THRESHOLDS } from "./capacity.js";
import { createGameplayRouter } from "./router.js";
import { cellToInt8 } from "./cells.js";

const DATABASE_URL = process.env.MOVENRUN_TEST_DATABASE_URL;
const BACKEND = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKIP = DATABASE_URL ? false : "MOVENRUN_TEST_DATABASE_URL is not set — the gameplay PostgreSQL path was NOT verified";

const D = Math.floor(Date.UTC(2026, 9, 1) / DAY_MS); // season 1, day 1
const RULES: GameplayRules = { ...PILOT_PROPOSAL, holding: { ...PILOT_PROPOSAL.holding }, seasonOneStartDay: D };
const at = (day: number, hour: number) => day * DAY_MS + hour * 3_600_000;

/** Resolution 8 cells, as the movement pipeline stores them, named by test (a synthetic area). */
const CELLS = gridDisk(latLngToCell(52.37, 4.9, 8), 4).sort();
const NAMES = ["u-idem-1", "u-idem-2", "u-race-s1", "u-race-s2", "u-race-s3", "u-rule-1", "u-race-many", "u-late-1",
  "u-club-r1", "u-club-r2", "u-club-b1", "u-http-1", "u-forged", "u-budget-0"];
function u(name: string): string {
  const i = NAMES.indexOf(name);
  if (i < 0) throw new Error(`no test cell named ${name}`);
  return CELLS[i]!;
}
const big = (name: string) => cellToInt8(u(name));
/** The ledger as the API sees it: user ids and outcome names. */
const LEDGER = `(SELECT e.seq, e.day, e.unit, e.source_no, w.user_id AS walker_id, ph.user_id AS previous_holder_id, nh.user_id AS new_holder_id,
    (ARRAY['claimed', 'reinforced', 'eroded', 'flipped'])[e.outcome] AS outcome, e.strength_before, e.strength_after
  FROM gameplay_push_events e JOIN gameplay_players w ON w.player_no = e.walker_no
  LEFT JOIN gameplay_players ph ON ph.player_no = e.previous_holder_no LEFT JOIN gameplay_players nh ON nh.player_no = e.new_holder_no) ledger`;
const playerNo = async (userId: string) => Number((await pool.query("SELECT player_no FROM gameplay_players WHERE user_id = $1", [userId])).rows[0]?.player_no);

let admin: pg.Pool;
let pool: pg.Pool;
let db: Db;
let dbName: string;
let dbUrl: string;
let clock = at(D, 9);
let service: GameplayService;

function sqlFile(path: string): string[] {
  return readFileSync(join(BACKEND, path), "utf8").split("--> statement-breakpoint").filter((s) => s.trim());
}

async function runInTx(client: pg.Pool, statements: string[]): Promise<void> {
  const c = await client.connect();
  try {
    await c.query("BEGIN");
    for (const s of statements) await c.query(s);
    await c.query("COMMIT");
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  } finally {
    c.release();
  }
}

const migrateUp = () => runInTx(pool, sqlFile("drizzle-proposed/0011_gameplay_holdings.sql"));
const migrateDown = () => runInTx(pool, sqlFile("drizzle-proposed/0011_gameplay_holdings.down.sql"));

async function committedChain(): Promise<void> {
  const journal = JSON.parse(readFileSync(join(BACKEND, "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
  await runInTx(pool, journal.entries.flatMap((e) => sqlFile(`drizzle/${e.tag}.sql`)));
}

async function user(id: string): Promise<string> {
  await pool.query("INSERT INTO users (id) VALUES ($1)", [id]);
  await pool.query("INSERT INTO auth_identities (id, user_id, provider, provider_subject) VALUES ($1, $2, 'supabase', $3)", [randomUUID(), id, `sub-${id}`]);
  return id;
}

/**
 * A verified movement session ending at `endMs`, 30 minutes and 3 km long,
 * through `units`, received by the server now on the test clock (settlement
 * and apply select by receipt time, never the machine's wall clock).
 */
async function session(userId: string, clientSessionId: string, endMs: number, units: string[], status = "verified"): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO movement_verifications (id, user_id, client_session_id, status, distance_meters, duration_seconds, traversed_hex_ids, start_time, end_time, created_at, ${SEAL_COLUMNS})
     VALUES ($1, $2, $3, $4, 3000, 1800, $5, $6, $7, (to_timestamp($8::float8 / 1000) AT TIME ZONE current_setting('TimeZone')), ${sealLiteral(SEALED_LOOP)})`,
    [id, userId, clientSessionId, status, units, endMs - 1_800_000, endMs, clock],
  );
  return id;
}

async function asAuthenticated<T>(sub: string | null, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE authenticated");
    if (sub) await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub, role: "authenticated" })]);
    return await fn(c);
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
}

async function errorCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (err) {
    return (err as { code?: string }).code;
  }
}

before(async () => {
  if (!DATABASE_URL) return;
  admin = new pg.Pool({ connectionString: DATABASE_URL });
  for (const role of ["anon", "authenticated"]) {
    // gameplayRules.pg.test.ts may create the same role at the same moment.
    await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`)
      .catch((err: { code?: string }) => { if (err.code !== "23505" && err.code !== "42710") throw err; });
  }
  dbName = `gameplay_test_${randomBytes(6).toString("hex")}`;
  await admin.query(`CREATE DATABASE "${dbName}"`);
  const url = new URL(DATABASE_URL);
  url.pathname = `/${dbName}`;
  dbUrl = url.toString();
  pool = new pg.Pool({ connectionString: dbUrl, max: 20 });
  // As in hookContract.test.ts: the final DROP DATABASE … WITH (FORCE) ends
  // any backend the pool has not finished closing, and an unhandled pool
  // error would fail the file after its tests have passed.
  pool.on("error", () => undefined);
  db = drizzle(pool) as unknown as Db;
  await committedChain();
  service = new GameplayService({ db, rules: RULES, now: () => clock });
});

after(async () => {
  if (!DATABASE_URL) return;
  await pool.end();
  admin.on("error", () => undefined);
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.end();
});

/* ── migration ──────────────────────────────────────────────────────────── */

test("0011 applies on the committed chain, rolls back cleanly, and applies again", { skip: SKIP }, async () => {
  const tables = async () => (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")).rows.map((r) => r.tablename as string);
  const before = await tables();
  assert.ok(!before.some((t) => t.startsWith("gameplay_")));
  await migrateUp();
  const withGameplay = await tables();
  assert.equal(withGameplay.filter((t) => t.startsWith("gameplay_")).length, 18);  // 17 + the settlement halt log
  assert.ok(withGameplay.includes("gameplay_session_paths"), "revision 3 folds in 1002's session paths");
  // The ledger and the walker days are partitioned by day; partitions are made ahead of use.
  const parted = await pool.query("SELECT c.relname FROM pg_partitioned_table p JOIN pg_class c ON c.oid = p.partrelid ORDER BY 1");
  assert.deepEqual(parted.rows.map((r) => r.relname), ["gameplay_push_events", "gameplay_walker_days"]);
  assert.equal(Number((await pool.query("SELECT public.gameplay_ensure_day_partitions($1, $2) AS n", [D - 1, D + 1])).rows[0].n), 6);
  // Every table, old and new, partitioned parents and their partitions, keeps row level security on.
  const open = await pool.query(`SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'gameplay_partitions') AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity`);
  assert.deepEqual(open.rows, []);
  await migrateDown();
  assert.deepEqual(await tables(), before, "rollback leaves exactly the 0000–0010 tables");
  const fns = await pool.query("SELECT proname FROM pg_proc WHERE proname LIKE 'gameplay_%'");
  assert.deepEqual(fns.rows, []);
  const leftovers = await pool.query(`SELECT relname FROM pg_class WHERE relname LIKE 'gameplay_%'
    UNION ALL SELECT nspname FROM pg_namespace WHERE nspname = 'gameplay_partitions'`);
  assert.deepEqual(leftovers.rows, [], "partitions, sequences and the partition schema go too");
  await migrateUp();
  await migrateUp(); // and re-running it is harmless
  assert.deepEqual(await tables(), withGameplay);
});

test("default deny: no privilege and no policy at all for anon or the signed-in role on any gameplay table", { skip: SKIP }, async () => {
  const gameplay = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'gameplay_%'")).rows.map((r) => r.tablename as string);
  assert.equal(gameplay.length, 18);  // 17 + the settlement halt log
  for (const t of gameplay) {
    for (const role of ["anon", "authenticated"]) {
      for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
        const r = await pool.query("SELECT has_table_privilege($1, $2, $3) AS ok", [role, `public.${t}`, priv]);
        assert.equal(r.rows[0].ok, false, `${role} ${priv} on ${t}`);
      }
      const col = await pool.query("SELECT has_any_column_privilege($1, $2, 'SELECT') AS s, has_any_column_privilege($1, $2, 'INSERT') AS i, has_any_column_privilege($1, $2, 'UPDATE') AS u", [role, `public.${t}`]);
      assert.deepEqual(col.rows[0], { s: false, i: false, u: false }, `${role} columns of ${t}`);
    }
    const rls = await pool.query("SELECT relrowsecurity FROM pg_class WHERE oid = $1::regclass", [`public.${t}`]);
    assert.equal(rls.rows[0].relrowsecurity, true, t);
  }
  const policies = await pool.query("SELECT tablename, policyname FROM pg_policies WHERE tablename LIKE 'gameplay_%'");
  assert.deepEqual(policies.rows, [], "no policy for any role");
  const exposed = await pool.query("SELECT proname FROM pg_proc WHERE proname = 'gameplay_current_player_id'");
  assert.deepEqual(exposed.rows, [], "revision 2's JWT helper is gone");
  for (const role of ["anon", "authenticated"]) {
    const r = await pool.query(`SELECT has_function_privilege($1, 'public.gameplay_ensure_day_partitions(integer, integer)', 'EXECUTE') AS f,
      has_schema_privilege($1, 'gameplay_partitions', 'USAGE') AS s, has_sequence_privilege($1, 'public.gameplay_push_seq', 'USAGE') AS q,
      has_sequence_privilege($1, 'public.gameplay_source_no_seq', 'USAGE') AS q2`, [role]);
    assert.deepEqual(r.rows[0], { f: false, s: false, q: false, q2: false }, role);
  }
});

test("partitions made later get RLS and no privilege, even where API roles are granted new tables by default (as on Supabase)", { skip: SKIP }, async () => {
  // Supabase's default: every new table in public is granted to the API roles.
  await pool.query("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated");
  await pool.query("ALTER DEFAULT PRIVILEGES IN SCHEMA gameplay_partitions GRANT ALL ON TABLES TO anon, authenticated");
  try {
    assert.equal(Number((await pool.query("SELECT public.gameplay_ensure_day_partitions($1, $2) AS n", [D + 40, D + 41])).rows[0].n), 4);
    assert.equal(Number((await pool.query("SELECT public.gameplay_ensure_day_partitions($1, $2) AS n", [D + 40, D + 41])).rows[0].n), 0, "idempotent");
    const parts = (await pool.query(`SELECT c.oid::regclass::text AS t, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'gameplay_partitions' AND (c.relname LIKE '%_d${D + 40}' OR c.relname LIKE '%_d${D + 41}')`)).rows;
    assert.equal(parts.length, 4);
    for (const p of parts) {
      assert.equal(p.relrowsecurity, true, p.t);
      for (const role of ["anon", "authenticated"]) {
        const r = await pool.query("SELECT has_table_privilege($1, $2, 'SELECT') AS s, has_table_privilege($1, $2, 'INSERT') AS i", [role, p.t]);
        assert.deepEqual(r.rows[0], { s: false, i: false }, `${role} ${p.t}`);
      }
    }
    // A bad range is refused, and no API role can run the function at all.
    assert.equal(await errorCode(pool.query("SELECT public.gameplay_ensure_day_partitions(10, 5)")), "22023");
    assert.equal(await errorCode(pool.query("SELECT public.gameplay_ensure_day_partitions(0, 100)")), "22023");
    await asAuthenticated(null, async (c) => {
      assert.equal(await errorCode(c.query("SELECT public.gameplay_ensure_day_partitions(1, 1)")), "42501");
    });
  } finally {
    await pool.query("ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated");
    await pool.query("ALTER DEFAULT PRIVILEGES IN SCHEMA gameplay_partitions REVOKE ALL ON TABLES FROM anon, authenticated");
  }
});

/* ── pushes ─────────────────────────────────────────────────────────────── */

test("applying a session is idempotent: a replay changes nothing", { skip: SKIP }, async () => {
  clock = at(D, 9);
  const a = await user("usr-idem-a");
  const mvId = await session(a, "idem-session-1", at(D, 8), [u("u-idem-1"), u("u-idem-2"), u("u-idem-2")]);
  const first = await service.applySession(a, "idem-session-1");
  assert.equal(first.replayed, false);
  assert.equal(first.applied, 2);
  assert.equal(first.outcomes.claimed, 2);
  const again = await service.applySession(a, "idem-session-1");
  assert.equal(again.replayed, true);
  assert.deepEqual({ ...again, replayed: false }, first);
  const events = await pool.query(`SELECT count(*)::int AS n FROM ${LEDGER} WHERE walker_id = $1`, [a]);
  assert.equal(events.rows[0].n, 2);
  // The event id is derived, not stored: (the session's source number, the cell).
  const src = Number((await pool.query("SELECT source_no FROM gameplay_applied_sessions WHERE movement_verification_id = $1", [mvId])).rows[0].source_no);
  assert.deepEqual((await pool.query(`SELECT unit::text AS unit FROM ${LEDGER} WHERE source_no = $1 ORDER BY seq`, [src])).rows.map((r) => r.unit), [big("u-idem-1"), big("u-idem-2")]);
  // Replaying the same events through the batch entry skips them all; an id not of the derived form is invalid.
  const replay = await service.applyPushes([{ eventId: `mv:${mvId}:${u("u-idem-1")}`, unitId: u("u-idem-1"), walkerId: a, push: { kind: "solid" }, day: D }]);
  assert.deepEqual([replay.applied, replay.skipped], [0, 1]);
  const malformed = await service.applyPushes([{ eventId: "no-source", unitId: u("u-idem-1"), walkerId: a, push: { kind: "solid" }, day: D }]);
  assert.deepEqual([malformed.applied, malformed.rejected, malformed.rejectedByReason.invalid_event], [0, 1, 1]);
  // A session's key is only ever applied by applySession.
  const unappliedMv = await session(a, "idem-session-unapplied", at(D, 8), [u("u-idem-1")]);
  const forgedKey = await service.applyPushes([{ eventId: `mv:${unappliedMv}:${u("u-idem-1")}`, unitId: u("u-idem-1"), walkerId: a, push: { kind: "solid" }, day: D }]);
  assert.deepEqual([forgedKey.applied, forgedKey.rejected], [0, 1]);
  // A cell in another spelling, or something that is not a cell, is not a unit the store can hold.
  await session(a, "idem-upper", at(D, 8), [u("u-idem-1").toUpperCase()]);
  await assert.rejects(service.applySession(a, "idem-upper"), (e: unknown) => e instanceof GameplayError && e.code === "unit_resolution_mismatch");
  await session(a, "idem-not-cell", at(D, 8), ["u-not-a-cell"]);
  await assert.rejects(service.applySession(a, "idem-not-cell"), (e: unknown) => e instanceof GameplayError && e.code === "unit_resolution_mismatch");
  // Someone else's session id, an unknown id and a rejected session.
  const b = await user("usr-idem-b");
  await assert.rejects(service.applySession(b, "idem-session-1"), (e: unknown) => e instanceof GameplayError && e.status === 404);
  await session(b, "idem-rejected", at(D, 8), [u("u-idem-1")], "rejected");
  await assert.rejects(service.applySession(b, "idem-rejected"), (e: unknown) => e instanceof GameplayError && e.code === "session_not_verified");
});

test("the same session applied five times at once is applied exactly once", { skip: SKIP }, async () => {
  clock = at(D, 10);
  const a = await user("usr-race-same");
  await session(a, "race-same-1", at(D, 9), [u("u-race-s1"), u("u-race-s2"), u("u-race-s3")]);
  const results = await Promise.all(Array.from({ length: 5 }, () => service.applySession(a, "race-same-1")));
  assert.equal(results.filter((r) => !r.replayed).length, 1);
  const n = await pool.query(`SELECT count(*)::int AS n FROM ${LEDGER} WHERE walker_id = $1`, [a]);
  assert.equal(n.rows[0].n, 3);
});

test("one push per walker per unit per day: refused by the model and by the database", { skip: SKIP }, async () => {
  clock = at(D, 12);
  const a = await user("usr-rule-a");
  const b = await user("usr-rule-b");
  const unit = u("u-rule-1");
  await session(a, "rule-a-1", at(D, 8), [unit]);
  await session(b, "rule-b-1", at(D, 9), [unit]);
  await session(a, "rule-a-2", at(D, 10), [unit]);
  await session(b, "rule-b-2", at(D, 11), [unit]);
  assert.equal((await service.applySession(a, "rule-a-1")).outcomes.claimed, 1);
  // V3 numbers (A9): a 100 push against fresh 100 ground flips it at 1.
  assert.equal((await service.applySession(b, "rule-b-1")).outcomes.flipped, 1);
  assert.equal((await service.applySession(a, "rule-a-2")).outcomes.flipped, 1);
  // B already pushed this unit today while someone else held it.
  assert.equal((await service.applySession(b, "rule-b-2")).outcomes.refused_daily_limit, 1);
  const unitRow = await pool.query("SELECT holder_id, strength FROM gameplay_units WHERE unit = $1", [cellToInt8(unit)]);
  assert.deepEqual(unitRow.rows[0], { holder_id: a, strength: 99 });
  // The refusal changed nothing and is a counter, not a ledger row.
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${LEDGER} WHERE walker_id = $1 AND unit = $2`, [b, cellToInt8(unit)])).rows[0].n, 1);
  const counter = (await pool.query("SELECT refused_daily_limit, units_used, visit_units::text[] AS v FROM gameplay_walker_days WHERE walker_no = $1 AND day = $2", [await playerNo(b), D])).rows[0];
  assert.deepEqual(counter, { refused_daily_limit: 1, units_used: 2, v: [cellToInt8(unit)] });

  // The database itself refuses a second erode/flip row, whatever the code does.
  const forged = await pool.query(
    `INSERT INTO gameplay_push_events (unit, day, source_no, walker_no, previous_holder_no, new_holder_no, strength_before, strength_after, outcome, holding_rules_version)
     VALUES ($1, $2, 999999, $3, $4, $4, 99, 9, 3, $5)`,
    [cellToInt8(unit), D, await playerNo(b), await playerNo(a), RULES.holding.rulesVersion]).then(() => null, (err: { code?: string; constraint?: string }) => err);
  assert.equal(forged?.code, "23505");
  // Reported under the day partition's copy of the one-push index.
  const parent = await pool.query("SELECT inhparent::regclass::text AS p FROM pg_inherits WHERE inhrelid = to_regclass($1)", [`gameplay_partitions.${forged?.constraint}`]);
  assert.equal(parent.rows[0]?.p, "gameplay_push_events_one_push_per_walker_unit_day");
  // A refusal is never a ledger row.
  assert.equal(await errorCode(pool.query(
    `INSERT INTO gameplay_push_events (unit, day, source_no, walker_no, strength_before, strength_after, outcome, holding_rules_version)
     VALUES ($1, $2, 999998, $3, 99, 99, 7, $4)`, [cellToInt8(unit), D, await playerNo(b), RULES.holding.rulesVersion])), "23514");
  // The ledger is append-only.
  assert.equal(await errorCode(pool.query("UPDATE gameplay_push_events SET strength_after = 100 WHERE unit = $1", [cellToInt8(unit)])), "23001");
  assert.equal(await errorCode(pool.query("DELETE FROM gameplay_push_events WHERE unit = $1", [cellToInt8(unit)])), "23001");
  // A unit state the holding model calls inconsistent cannot be stored, nor a unit that is not a cell index.
  assert.equal(await errorCode(pool.query("UPDATE gameplay_units SET strength = 0 WHERE unit = $1", [cellToInt8(unit)])), "23514");
  assert.equal(await errorCode(pool.query("INSERT INTO gameplay_units (unit, as_of_day, holding_rules_version) VALUES (12345, 1, 1001)")), "23514");
});

test("concurrent pushes on one unit by ten walkers give one consistent ledger", { skip: SKIP }, async () => {
  clock = at(D, 14);
  const unit = u("u-race-many");
  const owner = await user("usr-race-owner");
  await session(owner, "race-owner-1", at(D, 8), [unit]);
  await service.applySession(owner, "race-owner-1");
  const walkers: string[] = [];
  for (let i = 0; i < 10; i++) {
    const w = await user(`usr-race-${i}`);
    walkers.push(w);
    await session(w, `race-walker-${i}`, at(D, 13), [unit]);
  }
  const results = await Promise.all(walkers.map((w, i) => service.applySession(w, `race-walker-${i}`)));
  assert.equal(results.reduce((a, r) => a + r.applied, 0), 10);
  const events = (await pool.query(
    `SELECT walker_id, outcome, previous_holder_id, new_holder_id, strength_before, strength_after FROM ${LEDGER} WHERE unit = $1 ORDER BY seq`, [cellToInt8(unit)])).rows;
  assert.equal(events.length, 11);
  // Each push starts where the previous one left the unit.
  for (let i = 1; i < events.length; i++) {
    assert.equal(events[i].previous_holder_id, events[i - 1].new_holder_id, `event ${i}`);
    assert.equal(events[i].strength_before, events[i - 1].strength_after, `event ${i}`);
  }
  const last = events[events.length - 1];
  const unitRow = (await pool.query("SELECT holder_id, strength FROM gameplay_units WHERE unit = $1", [cellToInt8(unit)])).rows[0];
  assert.deepEqual(unitRow, { holder_id: last.new_holder_id, strength: last.strength_after });
  const dupes = await pool.query(
    `SELECT walker_id FROM ${LEDGER} WHERE unit = $1 AND outcome IN ('eroded', 'flipped') GROUP BY walker_id, day HAVING count(*) > 1`, [cellToInt8(unit)]);
  assert.deepEqual(dupes.rows, []);
});

/* ── capacity: unit budget and guard ────────────────────────────────────── */

test("unit budget: a walker's verified units a day are capped on the server, spent once, and a retry spends nothing", { skip: SKIP }, async () => {
  clock = at(D, 15);
  const small = new GameplayService({ db, rules: RULES, now: () => clock, unitBudget: 5 });
  const w = await user("usr-budget");
  const cells = CELLS.slice(20, 28);
  await session(w, "budget-1", at(D, 14), cells.slice(0, 3));
  await session(w, "budget-2", at(D, 14), cells.slice(3, 8));
  assert.equal((await small.applySession(w, "budget-1")).applied, 3);
  const second = await small.applySession(w, "budget-2");
  assert.deepEqual([second.applied, second.rejected, second.rejectedByReason.unit_budget], [2, 3, 3]);
  const again = await small.applySession(w, "budget-2");
  assert.deepEqual({ ...again, replayed: false }, second, "the receipt, unchanged");
  const row = async (who: string) => (await pool.query("SELECT units_used FROM gameplay_walker_days WHERE walker_no = $1 AND day = $2", [await playerNo(who), D])).rows[0];
  assert.equal((await row(w)).units_used, 5);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${LEDGER} WHERE walker_id = $1`, [w])).rows[0].n, 5);
  // Ten sessions of one walker at once against a budget of five: exactly five units.
  const v = await user("usr-budget-par");
  for (let i = 0; i < 10; i++) await session(v, `budget-par-${i}`, at(D, 14), [CELLS[30 + i]!]);
  const par = await Promise.all(Array.from({ length: 10 }, (_, i) => small.applySession(v, `budget-par-${i}`)));
  assert.equal(par.reduce((a, r) => a + r.applied, 0), 5);
  assert.equal(par.reduce((a, r) => a + (r.rejectedByReason.unit_budget ?? 0), 0), 5);
  assert.equal((await row(v)).units_used, 5);
  // The default budget (300) leaves normal play alone.
  assert.equal((await service.applySession(w, "budget-1").then((r) => r.replayed)), true);
});

test("capacity guard: a hard stop refuses pushes with 503 and writes nothing, a failing guard fails closed, backpressure shrinks the budget", { skip: SKIP }, async () => {
  clock = at(D, 16);
  let decision = { level: "hard_stop" as const, acceptPushes: false, pushBudgetFactor: 0, reasons: ["over_hard_stop"] };
  let fail = false;
  const guarded = new GameplayService({
    db, rules: RULES, now: () => clock, unitBudget: 10,
    capacityGuard: async () => { if (fail) throw new Error("size unreadable"); return decision as never; },
  });
  const w = await user("usr-cap");
  const mv = await session(w, "cap-1", at(D, 15), CELLS.slice(41, 49));
  const counts = async () => (await pool.query(`SELECT (SELECT count(*) FROM gameplay_units)::int AS units, (SELECT count(*) FROM gameplay_push_events)::int AS pushes,
    (SELECT count(*) FROM gameplay_applied_sessions)::int AS sessions, (SELECT count(*) FROM gameplay_players)::int AS players`)).rows[0];
  const before = await counts();
  const is503 = (e: unknown) => e instanceof GameplayError && e.status === 503 && e.code === "capacity_hard_stop";
  await assert.rejects(guarded.applySession(w, "cap-1"), is503);
  await assert.rejects(guarded.applyPushes([{ eventId: `srv:cap:${CELLS[41]}`, unitId: CELLS[41]!, walkerId: w, push: { kind: "solid" }, day: D }]), is503);
  fail = true;
  await assert.rejects(guarded.applySession(w, "cap-1"), is503, "an unreadable size is a stop");
  decision = { level: "backpressure" as never, acceptPushes: true, pushBudgetFactor: Number.NaN, reasons: [] };
  fail = false;
  await assert.rejects(guarded.applySession(w, "cap-1"), is503, "a nonsense factor is a stop");
  assert.deepEqual(await counts(), before, "nothing was written");
  // Backpressure at half: 10 units become 5.
  decision = { level: "backpressure" as never, acceptPushes: true, pushBudgetFactor: 0.5, reasons: ["over_backpressure"] };
  const r = await guarded.applySession(w, "cap-1");
  assert.deepEqual([r.applied, r.rejectedByReason.unit_budget], [5, 3]);
  // At the hard stop a replay still returns its receipt, and reads and settlement are never asked.
  decision = { level: "hard_stop" as const, acceptPushes: false, pushBudgetFactor: 0, reasons: ["over_hard_stop"] };
  assert.equal((await guarded.applySession(w, "cap-1")).replayed, true);
  assert.equal((await guarded.myHoldings(w)).unitsHeld, 5);
  assert.ok(mv);

  // The real guard, on this database's real size: a quota it is already past stops pushes.
  const size = Number((await pool.query("SELECT pg_database_size(current_database()) AS b")).rows[0].b);
  const real = createCapacityGuard({
    thresholds: { ...DEFAULT_THRESHOLDS, quotaBytes: Math.floor(size / 2), reserveBytes: 1024 },
    readSizeBytes: async () => Number((await pool.query("SELECT pg_database_size(current_database()) AS b")).rows[0].b),
  });
  assert.equal((await real()).level, "hard_stop");
  const realGuarded = new GameplayService({ db, rules: RULES, now: () => clock, capacityGuard: real });
  await session(w, "cap-2", at(D, 15), [CELLS[50]!]);
  await assert.rejects(realGuarded.applySession(w, "cap-2"), is503);
  const roomy = createCapacityGuard({ thresholds: { ...DEFAULT_THRESHOLDS, quotaBytes: size * 100 }, readSizeBytes: async () => size });
  assert.equal((await roomy()).acceptPushes, true);
  assert.equal((await new GameplayService({ db, rules: RULES, now: () => clock, capacityGuard: roomy }).applySession(w, "cap-2")).applied, 1);
});

/* ── row level security ─────────────────────────────────────────────────── */

test("RLS: a signed-in player, with or without JWT claims, reads and writes nothing; anon neither", { skip: SKIP }, async () => {
  const b = "usr-rule-b";
  for (const [sql, args] of [
    ["SELECT unit, holder_id FROM gameplay_units", []],
    ["SELECT user_id FROM gameplay_applied_sessions", []],
    ["SELECT 1 FROM gameplay_credit_lines", []],
    ["SELECT 1 FROM gameplay_clubs", []],
    ["SELECT 1 FROM gameplay_club_memberships", []],
    ["SELECT 1 FROM gameplay_session_paths", []],
    ["SELECT day FROM gameplay_day_settlements", []],
    ["INSERT INTO gameplay_units (unit, as_of_day, holding_rules_version) VALUES ($1, 1, 1)", [big("u-forged")]],
    ["UPDATE gameplay_units SET strength = 100 WHERE holder_id = $1", [b]],
    ["SELECT walker_no FROM gameplay_push_events", []],
    ["SELECT 1 FROM gameplay_walker_days", []],
    ["SELECT 1 FROM gameplay_players", []],
    ["SELECT 1 FROM gameplay_player_day_proofs", []],
    [`SELECT 1 FROM gameplay_partitions.gameplay_push_events_d${D}`, []],
    ["DELETE FROM gameplay_push_events WHERE walker_no = 1", []],
    ["INSERT INTO gameplay_clubs (club_id, name) VALUES ('forged-club-1', 'Forged')", []],
    ["SELECT * FROM gameplay_unit_day_states", []],
    ["SELECT * FROM gameplay_unit_challenges", []],
  ] as const) {
    for (const sub of ["sub-usr-rule-a", null]) {
      const code = await asAuthenticated(sub, (c) => errorCode(c.query(sql, [...args])));
      assert.equal(code, "42501", `${sub ?? "no claims"}: ${sql}`);
    }
    const anon = await pool.connect();
    try {
      await anon.query("BEGIN; SET LOCAL ROLE anon");
      assert.equal(await errorCode(anon.query(sql, [...args])), "42501", `anon: ${sql}`);
    } finally {
      await anon.query("ROLLBACK");
      anon.release();
    }
  }
});

/* ── day close ──────────────────────────────────────────────────────────── */

test("day close settles once, the books balance, and the day is then closed to pushes", { skip: SKIP }, async () => {
  // Day D is still open before midnight plus the grace.
  clock = at(D + 1, 1);
  await assert.rejects(service.settleDay(D), (e: unknown) => e instanceof GameplayError && e.code === "day_not_closed");
  clock = at(D + 1, 3);
  // D20: an operator-loaded district map (here every unit so far is in one district).
  await pool.query(`INSERT INTO gameplay_unit_districts (unit, district_id, districts_version)
    SELECT unit, 'district-south', 'test-v1' FROM gameplay_units`);
  const runs = await Promise.all([service.settleDay(D), service.settleDay(D), service.settleDay(D)]);
  assert.equal(runs.filter((r) => r.created).length, 1);
  const s = runs[0]!;
  assert.equal(s.status, "settled");
  assert.ok(s.players >= 10);
  assert.equal(await service.settleDueDays(), 0, "nothing else is due");

  const h = (await pool.query("SELECT * FROM gameplay_day_settlements WHERE day = $1", [D])).rows[0];
  const sum = (await pool.query(
    "SELECT sum(net_micro)::bigint AS net, sum(earned_micro)::bigint AS earned, count(*)::int AS n FROM gameplay_credit_lines WHERE day = $1", [D])).rows[0];
  assert.equal(Number(h.minted_micro) + Number(h.returned_micro), Number(h.pool_micro));
  assert.equal(Number(h.credited_micro) + Number(h.toll_paid_micro) + Number(h.burned_micro), Number(h.minted_micro));
  assert.equal(Number(sum.net), Number(h.credited_micro) + Number(h.toll_received_micro));
  assert.equal(Number(sum.earned), Number(h.minted_micro));
  assert.equal(sum.n, h.players);
  assert.match(h.input_digest, /^[0-9a-f]{64}$/);

  // The pool is far from binding: one session earns the session ceiling (12),
  // two earn the day ceiling (20), SOURCE §17.
  const earned = async (p: string) => Number((await pool.query("SELECT earned_micro FROM gameplay_credit_lines WHERE day = $1 AND player_id = $2", [D, p])).rows[0].earned_micro);
  assert.equal(await earned("usr-race-0"), 12_000_000);
  assert.equal(await earned("usr-rule-a"), 20_000_000);

  // A settled day is final, and a late push for it is refused.
  assert.equal(await errorCode(pool.query("UPDATE gameplay_day_settlements SET pool_micro = 0 WHERE day = $1", [D])), "23001");
  assert.equal(await errorCode(pool.query("DELETE FROM gameplay_credit_lines WHERE day = $1", [D])), "23001");
  const late = await user("usr-late");
  await session(late, "late-session-1", at(D, 20), [u("u-late-1")]);
  await assert.rejects(service.applySession(late, "late-session-1"), (e: unknown) => e instanceof GameplayError && e.code === "day_closed");

  // The database refuses books that do not close, and lines that do not add up
  // (days 1 and 2 pinned to a rule set first, as every header must be; in a
  // season of their own, since a season keeps one rule set).
  await pool.query(`INSERT INTO gameplay_day_rules (day, season, ruleset, holding_rules_version, takeover_policy, unit_zone_rule, config, config_digest)
    VALUES (1, 99, 'x', 1, 'immediate', 'unit', '{}', $1), (2, 99, 'x', 1, 'immediate', 'unit', '{}', $1)`, ["0".repeat(64)]);
  assert.equal(await errorCode(pool.query(
    `INSERT INTO gameplay_day_settlements (day, season, status, ruleset, economy_rules_version, holding_rules_version, pool_micro, minted_micro, credited_micro, returned_micro, clubs_status, input_digest, receipt_cutoff_at)
     VALUES (1, 1, 'settled', 'x', 1, 1, 100, 60, 50, 40, 'skipped', $1, now())`, ["0".repeat(64)])), "23514");
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(`INSERT INTO gameplay_day_settlements (day, season, status, ruleset, economy_rules_version, holding_rules_version, pool_micro, minted_micro, credited_micro, returned_micro, players, clubs_status, input_digest, receipt_cutoff_at)
      VALUES (2, 1, 'settled', 'x', 1, 1, 100, 60, 60, 40, 1, 'skipped', $1, now())`, ["0".repeat(64)]);
    await c.query(`INSERT INTO gameplay_credit_lines (day, player_id, earned_micro, toll_paid_micro, toll_received_micro, recharge_micro, upkeep_taken_micro, upkeep_in_condition_micro, zones_held, net_micro)
      VALUES (2, 'usr-late', 50, 0, 0, 0, 0, 0, 0, 50)`);
    assert.equal(await errorCode(c.query("COMMIT")), "23514");
  } finally {
    await c.query("ROLLBACK").catch(() => undefined);
    c.release();
  }
});

test("clubs, districts and season boards come from settled days only", { skip: SKIP }, async () => {
  clock = at(D + 1, 9);
  const red = await user("usr-club-red");
  const blue = await user("usr-club-blue");
  const created = await service.createClub(red, "club-red-0001", "Red Runners");
  assert.deepEqual([created.created, created.fromDay], [true, D + 2]);
  assert.equal((await service.createClub(red, "club-red-0001", "Red Runners")).created, false, "repeat is a no-op");
  await assert.rejects(service.createClub(blue, "club-red-0001", "Something"), (e: unknown) => e instanceof GameplayError && e.code === "club_id_taken");
  await assert.rejects(service.createClub(blue, "club-blue-001", "red runners"), (e: unknown) => e instanceof GameplayError && e.code === "club_name_taken");
  await service.createClub(blue, "club-blue-001", "Blue Walkers");
  await assert.rejects(service.joinClub(blue, "club-red-0001"), (e: unknown) => e instanceof GameplayError && e.code === "already_in_club");
  // Leaving before the membership starts removes it; joining again is allowed.
  assert.deepEqual(await service.leaveClub(blue), { left: true, toDay: D + 2 });
  assert.deepEqual(await service.leaveClub(blue), { left: false, toDay: null });
  assert.equal((await service.joinClub(blue, "club-blue-001")).changed, true);

  // D20: districts come from the operator-loaded map.
  await pool.query(`INSERT INTO gameplay_unit_districts (unit, district_id, districts_version)
    VALUES ($1, 'district-north', 'test-v1'), ($2, 'district-north', 'test-v1'), ($3, 'district-north', 'test-v1')`, [big("u-club-r1"), big("u-club-r2"), big("u-club-b1")]);

  // Day D+1: nobody is in a club yet. Day D+2: both are.
  clock = at(D + 2, 10);
  await session(red, "club-red-1", at(D + 2, 9), [u("u-club-r1"), u("u-club-r2")]);
  await session(blue, "club-blue-1", at(D + 2, 9), [u("u-club-b1")]);
  await service.applySession(red, "club-red-1");
  await service.applySession(blue, "club-blue-1");
  clock = at(D + 3, 3);
  assert.equal(await service.settleDueDays(), 2);

  const north = (await service.districtsDay(D + 2)).districts.find((d) => d.districtId === "district-north");
  assert.equal(north?.status, "controlled");
  assert.equal(north?.controllerClubId, "club-red-0001");
  const clubDay = await service.clubDay("club-red-0001", D + 2);
  assert.equal(clubDay.members, 1);
  assert.equal(JSON.stringify(clubDay).includes(red), false, "club aggregates name no player");

  const districtsBoard = await service.leaderboard(red, 1, "club_district_days");
  assert.equal(districtsBoard.status, "settled");
  if (districtsBoard.status === "settled") {
    assert.equal(districtsBoard.daysSettled, 3);
    assert.equal(districtsBoard.throughDay, D + 2);
    assert.deepEqual(districtsBoard.rows[0], { rank: 1, clubId: "club-red-0001", name: "Red Runners", score: 1 });
  }
  const players = await service.leaderboard(red, 1, "player_credits");
  assert.equal(players.status, "settled");
  if (players.status === "settled") {
    assert.equal(JSON.stringify(players).includes("usr-"), false, "player boards carry no ids");
    assert.equal(players.rows.filter((r) => "self" in r && r.self).length, 1);
  }
  const mine = await service.myCredits(red, 1);
  assert.equal(mine.days.length, 1);
  assert.equal(mine.kind, "off_chain_credits");
  const holdings = await service.myHoldings(red);
  assert.equal(holdings.unitsHeld, 2);
});

test("account deletion still works and leaves no gameplay row naming the person", { skip: SKIP }, async () => {
  const victim = "usr-rule-a"; // holds u-rule-1, has pushes, a refusal-free day row, credit lines, a proof, and is a previous holder in B's events
  const no = await playerNo(victim);
  assert.ok(no > 0);
  const before = async (table: string, col: string) => Number((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${col} = $1`, [no])).rows[0].n);
  assert.ok(await before("gameplay_push_events", "walker_no") > 0);
  assert.ok(await before("gameplay_push_events", "previous_holder_no") > 0);
  assert.ok(await before("gameplay_player_day_proofs", "player_no") > 0);
  const erased = await createDrizzleAccountDeletionStore(db).erase(victim);
  assert.equal(erased.users, 1);
  for (const [table, col] of [["gameplay_units", "holder_id"], ["gameplay_credit_lines", "player_id"],
    ["gameplay_applied_sessions", "user_id"], ["gameplay_club_memberships", "walker_id"], ["gameplay_unit_challenges", "walker_id"], ["gameplay_players", "user_id"]] as const) {
    const n = await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${col} = $1`, [victim]);
    assert.equal(n.rows[0].n, 0, `${table}.${col}`);
  }
  for (const [table, col] of [["gameplay_unit_day_states", "holder_no"], ["gameplay_push_events", "walker_no"], ["gameplay_push_events", "previous_holder_no"],
    ["gameplay_push_events", "new_holder_no"], ["gameplay_walker_days", "walker_no"], ["gameplay_player_day_proofs", "player_no"]] as const) {
    assert.equal(await before(table, col), 0, `${table}.${col}`);
  }
  const unit = (await pool.query("SELECT holder_id, strength, level FROM gameplay_units WHERE unit = $1", [big("u-rule-1")])).rows[0];
  assert.deepEqual(unit, { holder_id: null, strength: 0, level: 1 });
  // The settled day's header stands.
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM gameplay_day_settlements WHERE day = $1", [D])).rows[0].n, 1);
});

/* ── HTTP and the feature flag ──────────────────────────────────────────── */

test("HTTP: auth on every route, strict bodies, idempotent apply", { skip: SKIP }, async () => {
  clock = at(D + 3, 10);
  const walker = await user("usr-http-1");
  await session(walker, "http-session-1", at(D + 3, 9), [u("u-http-1")]);
  const app = express();
  app.use(express.json({ limit: "8kb" }));
  app.use("/gameplay", createGameplayRouter({
    service,
    verifyBearer: async (token) => {
      if (token === "walker-token") return { userId: walker };
      throw new IdentityError("session_invalid");
    },
  }));
  const server: Server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/gameplay`;
  const call = (method: string, path: string, body?: unknown, token = "walker-token") => fetch(`${base}${path}`, {
    method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    for (const [method, path] of [["POST", "/sessions/http-session-1/apply"], ["POST", "/clubs"], ["POST", "/clubs/leave"], ["GET", "/me/holdings"],
      ["GET", "/me/credits?season=1"], ["GET", `/districts/days/${D}`], ["GET", "/leaderboards/1"]] as const) {
      assert.equal((await call(method, path, method === "POST" ? {} : undefined, "")).status, 401, path);
      assert.equal((await call(method, path, method === "POST" ? {} : undefined, "bad-token")).status, 401, path);
    }
    // The phone cannot name a unit, an outcome or a strength.
    assert.equal((await call("POST", "/sessions/http-session-1/apply", { unitId: u("u-http-1"), outcome: "flipped" })).status, 400);
    assert.equal((await call("POST", "/clubs", { clubId: "club-http-01", name: "<script>" })).status, 400);
    assert.equal((await call("POST", "/sessions/x/apply", {})).status, 400);
    const first = await call("POST", "/sessions/http-session-1/apply", {});
    assert.equal(first.status, 201);
    const second = await call("POST", "/sessions/http-session-1/apply", {});
    assert.equal(second.status, 200);
    assert.equal(((await second.json()) as { replayed: boolean }).replayed, true);
    assert.equal((await call("POST", "/sessions/nobody-session/apply", {})).status, 404);
    const board = await call("GET", "/leaderboards/1?metric=player_credits");
    assert.equal(board.status, 200);
    assert.equal((await call("GET", "/leaderboards/1?metric=everything")).status, 400);
  } finally {
    server.close();
  }
});

test("flag off: the API mounts no gameplay route; flag on: it does, behind auth", { skip: SKIP }, async () => {
  const keys = ["NODE_ENV", "DATABASE_URL", "IDENTITY_SESSION_PEPPER", "CORS_ORIGINS", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY", "IDENTITY_AUTH_DOMAIN", "MOVENRUN_GAMEPLAY_SEASON_START_DAY", "MOVENRUN_GAMEPLAY_ENABLED"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const savedFetch = globalThis.fetch;
  // Maintenance tasks may try the sign-in provider; nothing may leave the machine.
  globalThis.fetch = async () => { throw new Error("no network in this test"); };
  const { closeDb } = await import("../db/client.js");
  try {
    Object.assign(process.env, {
      NODE_ENV: "production", DATABASE_URL: dbUrl, IDENTITY_SESSION_PEPPER: randomBytes(32).toString("hex"),
      CORS_ORIGINS: "https://preview.example.com", SUPABASE_URL: "https://movenrun-test.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test", SUPABASE_SECRET_KEY: "sb_secret_test", IDENTITY_AUTH_DOMAIN: "movenrun.xyz",
      MOVENRUN_GAMEPLAY_SEASON_START_DAY: String(Math.floor(Date.now() / DAY_MS)),
    });
    const { resolveApiConfig } = await import("../api/config.js");
    const { createApiApp } = await import("../api/app.js");
    for (const flag of [undefined, "true"]) {
      if (flag === undefined) delete process.env.MOVENRUN_GAMEPLAY_ENABLED;
      else process.env.MOVENRUN_GAMEPLAY_ENABLED = flag;
      const server: Server = createApiApp(resolveApiConfig()).listen(0, "127.0.0.1");
      await once(server, "listening");
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      try {
        for (const [method, path] of [["POST", "/gameplay/sessions/abcdefgh/apply"], ["POST", "/gameplay/clubs"], ["GET", "/gameplay/me/holdings"], ["GET", "/gameplay/leaderboards/1"]]) {
          const res = await savedFetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, body: method === "POST" ? "{}" : undefined });
          assert.equal(res.status, flag ? 401 : 404, `${flag ?? "unset"} ${path}`);
        }
        assert.equal((await savedFetch(`${base}/health`)).status, 200);
      } finally {
        server.close();
      }
    }
    // Enabled without a season start, the API refuses to start.
    process.env.MOVENRUN_GAMEPLAY_ENABLED = "true";
    delete process.env.MOVENRUN_GAMEPLAY_SEASON_START_DAY;
    assert.throws(() => createApiApp(resolveApiConfig()), /SEASON_START_DAY/);
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    globalThis.fetch = savedFetch;
    await closeDb();
  }
});

test("flag off against a database without 0011: no gameplay route, no gameplay relation, no failed statement", { skip: SKIP }, async () => {
  const bare = `gameplay_bare_${randomBytes(6).toString("hex")}`;
  await admin.query(`CREATE DATABASE "${bare}"`);
  const url = new URL(DATABASE_URL!);
  url.pathname = `/${bare}`;
  const barePool = new pg.Pool({ connectionString: url.toString() });
  barePool.on("error", () => undefined);
  const keys = ["NODE_ENV", "DATABASE_URL", "IDENTITY_SESSION_PEPPER", "CORS_ORIGINS", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY", "IDENTITY_AUTH_DOMAIN", "MOVENRUN_GAMEPLAY_SEASON_START_DAY", "MOVENRUN_GAMEPLAY_ENABLED"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("no network in this test"); };
  const { closeDb } = await import("../db/client.js");
  try {
    const journal = JSON.parse(readFileSync(join(BACKEND, "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
    await runInTx(barePool, journal.entries.flatMap((e) => sqlFile(`drizzle/${e.tag}.sql`)));
    const rollbacks = async () => Number((await barePool.query("SELECT xact_rollback FROM pg_stat_database WHERE datname = current_database()")).rows[0].xact_rollback);
    const rolledBack = await rollbacks();
    Object.assign(process.env, {
      NODE_ENV: "production", DATABASE_URL: url.toString(), IDENTITY_SESSION_PEPPER: randomBytes(32).toString("hex"),
      CORS_ORIGINS: "https://preview.example.com", SUPABASE_URL: "https://movenrun-test.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test", SUPABASE_SECRET_KEY: "sb_secret_test", IDENTITY_AUTH_DOMAIN: "movenrun.xyz",
      MOVENRUN_GAMEPLAY_SEASON_START_DAY: String(Math.floor(Date.now() / DAY_MS)),
    });
    delete process.env.MOVENRUN_GAMEPLAY_ENABLED;
    const { resolveApiConfig } = await import("../api/config.js");
    const { createApiApp } = await import("../api/app.js");
    const server: Server = createApiApp(resolveApiConfig()).listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      for (const [method, path] of [["POST", "/gameplay/sessions/abcdefgh/apply"], ["GET", "/gameplay/me/holdings"], ["GET", "/gameplay/leaderboards/1"]]) {
        const res = await savedFetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, body: method === "POST" ? "{}" : undefined });
        assert.equal(res.status, 404, path);
      }
      assert.equal((await savedFetch(`${base}/health`)).status, 200);
      // Give the maintenance loop the chance it gets after a response.
      await new Promise((r) => setTimeout(r, 300));
    } finally {
      server.close();
    }
    const rel = await barePool.query("SELECT relname FROM pg_class WHERE relname LIKE 'gameplay%' UNION ALL SELECT nspname FROM pg_namespace WHERE nspname LIKE 'gameplay%'");
    assert.deepEqual(rel.rows, [], "nothing of 0011 exists or was created");
    assert.equal(await rollbacks(), rolledBack, "no statement failed (a gameplay query here would have)");
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    globalThis.fetch = savedFetch;
    await closeDb();
    await barePool.end();
    await admin.query(`DROP DATABASE IF EXISTS "${bare}" WITH (FORCE)`);
  }
});

test("a push for a day with no partition yet creates it outside the push transaction, then applies", { skip: SKIP }, async () => {
  clock = at(D + 60, 10);
  const exists = async () => (await pool.query("SELECT to_regclass($1) IS NOT NULL AS ok", [`gameplay_partitions.gameplay_push_events_d${D + 60}`])).rows[0].ok;
  assert.equal(await exists(), false);
  const w = await user("usr-late-partition");
  await session(w, "late-partition-1", at(D + 60, 9), [CELLS[55]!]);
  assert.equal((await service.applySession(w, "late-partition-1")).applied, 1);
  assert.equal(await exists(), true);
  // Dropping a whole day partition (retention, owner only) gives its space back at once; row triggers do not run.
  const sizeOf = async () => Number((await pool.query("SELECT pg_total_relation_size($1) AS b", [`gameplay_partitions.gameplay_push_events_d${D + 60}`])).rows[0].b);
  assert.ok(await sizeOf() > 0);
  await pool.query(`DROP TABLE gameplay_partitions.gameplay_push_events_d${D + 60}`);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM gameplay_push_events WHERE day = $1`, [D + 60])).rows[0].n, 0);
});

/* ── the flag off, the partition race and the deadlock retry ───────────── */

test("flag off on 0000–0010 alone: every gameplay route is a 404 for GET and POST, no gameplay relation appears, and the scheduler queries no gameplay table", { skip: SKIP }, async () => {
  const gate = `gameplay_gate_${randomBytes(6).toString("hex")}`;
  await admin.query(`CREATE DATABASE "${gate}"`);
  const url = new URL(DATABASE_URL!);
  url.pathname = `/${gate}`;
  const gatePool = new pg.Pool({ connectionString: url.toString() });
  gatePool.on("error", () => undefined);
  const keys = ["NODE_ENV", "DATABASE_URL", "IDENTITY_SESSION_PEPPER", "CORS_ORIGINS", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY", "IDENTITY_AUTH_DOMAIN", "MOVENRUN_GAMEPLAY_SEASON_START_DAY", "MOVENRUN_GAMEPLAY_ENABLED"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const savedFetch = globalThis.fetch;
  // Maintenance may try the sign-in provider; nothing may leave the machine.
  globalThis.fetch = async () => { throw new Error("no network in this test"); };
  const { closeDb } = await import("../db/client.js");
  // Every query any pg client sends while the API and its scheduler run (the API's pool is made by getDb).
  const proto = pg.Client.prototype as unknown as { query: (...args: unknown[]) => unknown };
  const realQuery = proto.query;
  const sent: string[] = [];
  const rollbacks = async () => Number((await gatePool.query("SELECT xact_rollback FROM pg_stat_database WHERE datname = current_database()")).rows[0].xact_rollback);
  try {
    const journal = JSON.parse(readFileSync(join(BACKEND, "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
    await runInTx(gatePool, journal.entries.flatMap((e) => sqlFile(`drizzle/${e.tag}.sql`)));
    const rolledBack = await rollbacks();
    Object.assign(process.env, {
      NODE_ENV: "production", DATABASE_URL: url.toString(), IDENTITY_SESSION_PEPPER: randomBytes(32).toString("hex"),
      CORS_ORIGINS: "https://preview.example.com", SUPABASE_URL: "https://movenrun-test.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test", SUPABASE_SECRET_KEY: "sb_secret_test", IDENTITY_AUTH_DOMAIN: "movenrun.xyz",
      MOVENRUN_GAMEPLAY_SEASON_START_DAY: String(Math.floor(Date.now() / DAY_MS)),
    });
    const { resolveApiConfig } = await import("../api/config.js");
    const { createApiApp } = await import("../api/app.js");
    // Every gameplay route, under the path the router defines, with GET and with POST.
    const paths = ["/gameplay/sessions/abcdefgh/apply", "/gameplay/clubs", "/gameplay/clubs/club-gate-01/join", "/gameplay/clubs/leave",
      "/gameplay/me/holdings", "/gameplay/me/credits", "/gameplay/clubs/club-gate-01/days/1", "/gameplay/districts/days/1",
      "/gameplay/leaderboards/1", "/gameplay/nothing-here"];
    for (const flag of [undefined, "false"]) {
      if (flag === undefined) delete process.env.MOVENRUN_GAMEPLAY_ENABLED;
      else process.env.MOVENRUN_GAMEPLAY_ENABLED = flag;
      const server: Server = createApiApp(resolveApiConfig()).listen(0, "127.0.0.1");
      await once(server, "listening");
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      sent.length = 0;
      proto.query = function (this: unknown, ...args: unknown[]) {
        const q = args[0];
        sent.push(typeof q === "string" ? q : String((q as { text?: unknown } | null)?.text ?? ""));
        return realQuery.apply(this, args);
      };
      try {
        for (const path of paths) {
          for (const method of ["GET", "POST"]) {
            const res = await savedFetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, body: method === "POST" ? "{}" : undefined });
            // The application's own catch-all answers, not a gameplay route.
            assert.equal(res.status, 404, `${flag ?? "unset"} ${method} ${path}`);
            assert.deepEqual(await res.json(), { error: "not_found" }, `${flag ?? "unset"} ${method} ${path}`);
          }
        }
        // Maintenance runs after each response and, on start, a few seconds later: give it time.
        await new Promise((r) => setTimeout(r, 1500));
        assert.ok(sent.length > 0, "the scheduler ran (its identity clean-up queried the database)");
        assert.deepEqual(sent.filter((q) => /gameplay/i.test(q)), [], `${flag ?? "unset"}: no statement names a gameplay relation`);
      } finally {
        proto.query = realQuery;
        server.close();
      }
    }
    const rel = await gatePool.query("SELECT relname FROM pg_class WHERE relname LIKE 'gameplay%' UNION ALL SELECT nspname FROM pg_namespace WHERE nspname LIKE 'gameplay%'");
    assert.deepEqual(rel.rows, [], "nothing of 0011 exists or was created");
    assert.equal(await rollbacks(), rolledBack, "no statement failed");
  } finally {
    proto.query = realQuery;
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    globalThis.fetch = savedFetch;
    await closeDb();
    await gatePool.end();
    await admin.query(`DROP DATABASE IF EXISTS "${gate}" WITH (FORCE)`);
  }
});

test("a day partition another creator commits first (42P07) is skipped; a push that gets 40P01 is retried, and its fifth failure is refused and rolled back", { skip: SKIP }, async () => {
  /* 1. The partition race. Another creator's CREATE of the day's ledger partition is uncommitted when the
   *    function runs: its to_regclass cannot see that table, its CREATE waits behind the creator, and once the
   *    creator commits the duplicate is SQLSTATE 42P07, which the function skips. Deterministic: the caller is
   *    only released after it is seen blocked on a lock. */
  const race = D + 300;
  const ledgerPartition = `gameplay_push_events_d${race}`;
  const creator = await pool.connect();
  const caller = await pool.connect();
  try {
    await creator.query("BEGIN");
    await creator.query(`CREATE TABLE gameplay_partitions.${ledgerPartition} PARTITION OF public.gameplay_push_events FOR VALUES FROM (${race}) TO (${race + 1})`);
    await creator.query(`ALTER TABLE gameplay_partitions.${ledgerPartition} ENABLE ROW LEVEL SECURITY`);
    await creator.query(`REVOKE ALL ON TABLE gameplay_partitions.${ledgerPartition} FROM PUBLIC`);
    const callerPid = Number((await caller.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
    const call = caller.query("SELECT public.gameplay_ensure_day_partitions($1, $1) AS n", [race]);
    for (let i = 0; ; i++) {
      const state = await pool.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1", [callerPid]);
      if (state.rows[0]?.wait_event_type === "Lock") break;
      if (i >= 500) throw new Error("the racing creation never blocked");
      await new Promise((r) => setTimeout(r, 10));
    }
    await creator.query("COMMIT");
    // Only the walker-day partition is made here: the ledger partition was the other creator's.
    assert.equal(Number((await call).rows[0].n), 1);
  } finally {
    await creator.query("ROLLBACK").catch(() => undefined);
    creator.release();
    caller.release();
  }
  const exists = await pool.query("SELECT to_regclass($1) IS NOT NULL AS ok, (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass($1)) AS rls", [`gameplay_partitions.${ledgerPartition}`]);
  assert.deepEqual(exists.rows[0], { ok: true, rls: true }, "the other creator's partition stands, with row level security");
  assert.equal(Number((await pool.query("SELECT public.gameplay_ensure_day_partitions($1, $1) AS n", [race])).rows[0].n), 0, "creating it again changes nothing");

  /* 2. The deadlock retry. The injected 40P01 fires after the push has written its rows, so every failed
   *    attempt rolls back real work. Test seam: a database handle that delegates to the real one and fails
   *    each transaction after its callback has run, for the first `failures` transactions. */
  await service.ensurePartitions(D + 400, D + 400);
  clock = at(D + 400, 14);
  const deadlock = () => Object.assign(new Error("deadlock detected"), { code: "40P01" });
  const flaky = (failures: number) => {
    let attempts = 0;
    const wrapped = new Proxy(db, {
      get(target, prop) {
        if (prop !== "transaction") {
          const value = Reflect.get(target, prop, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return (fn: (tx: unknown) => Promise<unknown>, config?: unknown) => {
          attempts += 1;
          return target.transaction((tx) => fn(tx).then((result) => {
            if (attempts <= failures) throw deadlock();
            return result;
          }), config as never);
        };
      },
    });
    return { service: new GameplayService({ db: wrapped as unknown as Db, rules: RULES, now: () => clock }), attempts: () => attempts };
  };
  // Everything a push writes, as a fingerprint: equal before and after means nothing was written.
  const fingerprint = async () => (await pool.query(`SELECT
      (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM gameplay_push_events t) AS events,
      (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM gameplay_applied_sessions t) AS sessions,
      (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM gameplay_walker_days t) AS walker_days,
      (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM gameplay_unit_day_states t) AS unit_states,
      (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM gameplay_units t) AS units,
      (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM gameplay_players t) AS players`)).rows[0];
  const ledgerRows = async (userId: string) => (await pool.query(`SELECT count(*)::int AS n FROM ${LEDGER} WHERE walker_id = $1`, [userId])).rows[0].n;

  const walker = await user("usr-deadlock-a");
  await session(walker, "deadlock-session-1", at(D + 400, 13), [CELLS[58]!]);
  // Four failures, then the fifth attempt: applied once, with one ledger row, and a replay changes nothing.
  const retried = flaky(4);
  const applied = await retried.service.applySession(walker, "deadlock-session-1");
  assert.equal(retried.attempts(), 5);
  assert.equal(applied.replayed, false);
  assert.equal(applied.applied, 1);
  assert.equal(await ledgerRows(walker), 1);
  assert.equal((await service.applySession(walker, "deadlock-session-1")).replayed, true);
  assert.equal(await ledgerRows(walker), 1);

  // Five failures: refused after the fifth attempt, nothing written by any attempt, no reward.
  await session(walker, "deadlock-session-2", at(D + 400, 13), [CELLS[59]!]);
  const before = await fingerprint();
  const refused = flaky(5);
  await assert.rejects(refused.service.applySession(walker, "deadlock-session-2"), (err: unknown) =>
    err instanceof GameplayError && err.status === 409 && err.code === "concurrent_push_retry");
  assert.equal(refused.attempts(), 5, "five attempts, then no sixth");
  assert.deepEqual(await fingerprint(), before, "every attempt was rolled back");
  // Over HTTP the exhausted case is a 409 the client can retry, not a 500.
  const httpApp = express();
  httpApp.use(express.json({ limit: "8kb" }));
  httpApp.use("/gameplay", createGameplayRouter({ service: flaky(5).service, verifyBearer: async () => ({ userId: walker }) }));
  const httpServer: Server = httpApp.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  try {
    const res = await fetch(`http://127.0.0.1:${(httpServer.address() as { port: number }).port}/gameplay/sessions/deadlock-session-2/apply`, {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer t" }, body: "{}",
    });
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: "concurrent_push_retry" });
  } finally {
    httpServer.close();
  }
  assert.deepEqual(await fingerprint(), before, "the HTTP attempts were rolled back too");
  assert.equal(await ledgerRows(walker), 1, "no ledger row from the refused push");
  // The session is still unapplied, so an honest retry applies it exactly once.
  assert.equal((await service.applySession(walker, "deadlock-session-2")).applied, 1);
  assert.equal(await ledgerRows(walker), 2);
});
