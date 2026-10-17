/**
 * Gameplay against real PostgreSQL: the proposed migration 0011 applied on
 * top of the committed chain 0000 to 0010, the service, the HTTP router and
 * the API's feature flag.
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
import type { Db } from "../db/client.js";
import { IdentityError } from "../identity/domain/errors.js";
import { createDrizzleAccountDeletionStore } from "../identity/accountDeletion.js";
import { DAY_MS, PILOT_PROPOSAL, type GameplayRules } from "./rules.js";
import { GameplayService, GameplayError } from "./service.js";
import { createGameplayRouter } from "./router.js";

const DATABASE_URL = process.env.MOVENRUN_TEST_DATABASE_URL;
const BACKEND = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKIP = DATABASE_URL ? false : "MOVENRUN_TEST_DATABASE_URL is not set — the gameplay PostgreSQL path was NOT verified";

const D = Math.floor(Date.UTC(2026, 9, 1) / DAY_MS); // season 1, day 1
const RULES: GameplayRules = { ...PILOT_PROPOSAL, holding: { ...PILOT_PROPOSAL.holding }, seasonOneStartDay: D };
const at = (day: number, hour: number) => day * DAY_MS + hour * 3_600_000;

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

/** A verified movement session ending at `endMs`, 30 minutes and 3 km long, through `units`. */
async function session(userId: string, clientSessionId: string, endMs: number, units: string[], status = "verified"): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO movement_verifications (id, user_id, client_session_id, status, distance_meters, duration_seconds, traversed_hex_ids, start_time, end_time)
     VALUES ($1, $2, $3, $4, 3000, 1800, $5, $6, $7)`,
    [id, userId, clientSessionId, status, units, endMs - 1_800_000, endMs],
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
    await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`);
  }
  dbName = `gameplay_test_${randomBytes(6).toString("hex")}`;
  await admin.query(`CREATE DATABASE "${dbName}"`);
  const url = new URL(DATABASE_URL);
  url.pathname = `/${dbName}`;
  dbUrl = url.toString();
  pool = new pg.Pool({ connectionString: dbUrl, max: 20 });
  db = drizzle(pool) as unknown as Db;
  await committedChain();
  service = new GameplayService({ db, rules: RULES, now: () => clock });
});

after(async () => {
  if (!DATABASE_URL) return;
  await pool.end();
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
  assert.equal(withGameplay.filter((t) => t.startsWith("gameplay_")).length, 11);
  // Every public table, old and new, keeps row level security on.
  const open = await pool.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity");
  assert.deepEqual(open.rows, []);
  await migrateDown();
  assert.deepEqual(await tables(), before, "rollback leaves exactly the 0000–0010 tables");
  const fns = await pool.query("SELECT proname FROM pg_proc WHERE proname LIKE 'gameplay_%'");
  assert.deepEqual(fns.rows, []);
  await migrateUp();
  await migrateUp(); // and re-running it is harmless
  assert.deepEqual(await tables(), withGameplay);
});

test("no privilege at all for anon; the signed-in role can only read", { skip: SKIP }, async () => {
  const gameplay = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'gameplay_%'")).rows.map((r) => r.tablename as string);
  for (const t of gameplay) {
    for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
      const anon = await pool.query("SELECT has_table_privilege('anon', $1, $2) AS ok", [`public.${t}`, priv]);
      assert.equal(anon.rows[0].ok, false, `anon ${priv} on ${t}`);
      if (priv !== "SELECT") {
        const authd = await pool.query("SELECT has_table_privilege('authenticated', $1, $2) AS ok", [`public.${t}`, priv]);
        assert.equal(authd.rows[0].ok, false, `authenticated ${priv} on ${t}`);
      }
    }
    const anyAnon = await pool.query("SELECT has_any_column_privilege('anon', $1, 'SELECT') AS ok", [`public.${t}`]);
    assert.equal(anyAnon.rows[0].ok, false, `anon column SELECT on ${t}`);
  }
  const fn = await pool.query("SELECT has_function_privilege('anon', 'public.gameplay_current_player_id()', 'EXECUTE') AS ok");
  assert.equal(fn.rows[0].ok, false);
});

/* ── pushes ─────────────────────────────────────────────────────────────── */

test("applying a session is idempotent: a replay changes nothing", { skip: SKIP }, async () => {
  clock = at(D, 9);
  const a = await user("usr-idem-a");
  await session(a, "idem-session-1", at(D, 8), ["u-idem-1", "u-idem-2", "u-idem-2"]);
  const first = await service.applySession(a, "idem-session-1");
  assert.equal(first.replayed, false);
  assert.equal(first.applied, 2);
  assert.equal(first.outcomes.claimed, 2);
  const again = await service.applySession(a, "idem-session-1");
  assert.equal(again.replayed, true);
  assert.deepEqual({ ...again, replayed: false }, first);
  const events = await pool.query("SELECT count(*)::int AS n FROM gameplay_push_events WHERE walker_id = $1", [a]);
  assert.equal(events.rows[0].n, 2);
  // Replaying the same events through the batch entry skips them all.
  const replay = await service.applyPushes([{ eventId: (await pool.query("SELECT event_id FROM gameplay_push_events WHERE walker_id = $1 LIMIT 1", [a])).rows[0].event_id, unitId: "u-idem-1", walkerId: a, push: { kind: "solid" }, day: D }]);
  assert.deepEqual([replay.applied, replay.skipped], [0, 1]);
  // Someone else's session id, an unknown id and a rejected session.
  const b = await user("usr-idem-b");
  await assert.rejects(service.applySession(b, "idem-session-1"), (e: unknown) => e instanceof GameplayError && e.status === 404);
  await session(b, "idem-rejected", at(D, 8), ["u-idem-1"], "rejected");
  await assert.rejects(service.applySession(b, "idem-rejected"), (e: unknown) => e instanceof GameplayError && e.code === "session_not_verified");
});

test("the same session applied five times at once is applied exactly once", { skip: SKIP }, async () => {
  clock = at(D, 10);
  const a = await user("usr-race-same");
  await session(a, "race-same-1", at(D, 9), ["u-race-s1", "u-race-s2", "u-race-s3"]);
  const results = await Promise.all(Array.from({ length: 5 }, () => service.applySession(a, "race-same-1")));
  assert.equal(results.filter((r) => !r.replayed).length, 1);
  const n = await pool.query("SELECT count(*)::int AS n FROM gameplay_push_events WHERE walker_id = $1", [a]);
  assert.equal(n.rows[0].n, 3);
});

test("one push per walker per unit per day: refused by the model and by the database", { skip: SKIP }, async () => {
  clock = at(D, 12);
  const a = await user("usr-rule-a");
  const b = await user("usr-rule-b");
  const unit = "u-rule-1";
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
  const unitRow = await pool.query("SELECT holder_id, strength FROM gameplay_units WHERE unit_id = $1", [unit]);
  assert.deepEqual(unitRow.rows[0], { holder_id: a, strength: 99 });

  // The database itself refuses a second erode/flip row, whatever the code does.
  const forged = await pool.query(
    `INSERT INTO gameplay_push_events (event_id, unit_id, walker_id, day, push_kind, outcome, previous_holder_id, new_holder_id, strength_before, strength_after, holding_rules_version)
     VALUES ('forged-second-push', $1, $2, $3, 'solid', 'eroded', $4, $4, 99, 9, $5)`,
    [unit, b, D, a, RULES.holding.rulesVersion]).then(() => null, (err: { code?: string; constraint?: string }) => err);
  assert.equal(forged?.code, "23505");
  assert.equal(forged?.constraint, "gameplay_push_events_one_push_per_walker_unit_day");
  // The ledger is append-only.
  assert.equal(await errorCode(pool.query("UPDATE gameplay_push_events SET strength_after = 100 WHERE unit_id = $1", [unit])), "23001");
  assert.equal(await errorCode(pool.query("DELETE FROM gameplay_push_events WHERE unit_id = $1", [unit])), "23001");
  // A unit state the holding model calls inconsistent cannot be stored.
  assert.equal(await errorCode(pool.query("UPDATE gameplay_units SET strength = 0 WHERE unit_id = $1", [unit])), "23514");
});

test("concurrent pushes on one unit by ten walkers give one consistent ledger", { skip: SKIP }, async () => {
  clock = at(D, 14);
  const unit = "u-race-many";
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
    "SELECT walker_id, outcome, previous_holder_id, new_holder_id, strength_before, strength_after FROM gameplay_push_events WHERE unit_id = $1 ORDER BY seq", [unit])).rows;
  assert.equal(events.length, 11);
  // Each push starts where the previous one left the unit.
  for (let i = 1; i < events.length; i++) {
    assert.equal(events[i].previous_holder_id, events[i - 1].new_holder_id, `event ${i}`);
    assert.equal(events[i].strength_before, events[i - 1].strength_after, `event ${i}`);
  }
  const last = events[events.length - 1];
  const unitRow = (await pool.query("SELECT holder_id, strength FROM gameplay_units WHERE unit_id = $1", [unit])).rows[0];
  assert.deepEqual(unitRow, { holder_id: last.new_holder_id, strength: last.strength_after });
  const dupes = await pool.query(
    "SELECT walker_id FROM gameplay_push_events WHERE unit_id = $1 AND outcome IN ('eroded', 'flipped') GROUP BY walker_id, day HAVING count(*) > 1", [unit]);
  assert.deepEqual(dupes.rows, []);
});

/* ── row level security ─────────────────────────────────────────────────── */

test("RLS: a signed-in player reads only their own rows and writes nothing", { skip: SKIP }, async () => {
  const a = "usr-rule-a";
  const b = "usr-rule-b";
  await asAuthenticated(`sub-${a}`, async (c) => {
    const units = await c.query("SELECT unit_id, holder_id FROM gameplay_units");
    assert.ok(units.rows.length > 0);
    assert.ok(units.rows.every((r) => r.holder_id === a));
    const events = await c.query("SELECT walker_id FROM gameplay_push_events");
    assert.ok(events.rows.length > 0 && events.rows.every((r) => r.walker_id === a));
    const sessions = await c.query("SELECT user_id FROM gameplay_applied_sessions");
    assert.ok(sessions.rows.every((r) => r.user_id === a));
    // Columns outside the grant are refused.
    assert.equal(await errorCode(c.query("SELECT masked FROM gameplay_units")), "42501");
  });
  for (const [sql, args] of [
    ["INSERT INTO gameplay_units (unit_id, as_of_day, holding_rules_version) VALUES ('u-forged', 1, 1)", []],
    ["UPDATE gameplay_units SET strength = 100 WHERE holder_id = $1", [b]],
    ["DELETE FROM gameplay_push_events WHERE walker_id = $1", [b]],
    ["INSERT INTO gameplay_clubs (club_id, name) VALUES ('forged-club-1', 'Forged')", []],
    ["SELECT problems FROM gameplay_day_settlements", []],
    ["SELECT * FROM gameplay_unit_day_states", []],
  ] as const) {
    const code = await asAuthenticated(`sub-${a}`, (c) => errorCode(c.query(sql, [...args])));
    assert.equal(code, "42501", sql);
  }
  // No JWT claims: the signed-in role sees nothing at all.
  await asAuthenticated(null, async (c) => {
    assert.equal((await c.query("SELECT 1 FROM gameplay_units")).rows.length, 0);
    assert.equal((await c.query("SELECT 1 FROM gameplay_clubs")).rows.length, 0);
  });
  // anon reads nothing.
  const anon = await pool.connect();
  try {
    await anon.query("BEGIN; SET LOCAL ROLE anon");
    assert.equal(await errorCode(anon.query("SELECT 1 FROM gameplay_units")), "42501");
  } finally {
    await anon.query("ROLLBACK");
    anon.release();
  }
});

/* ── day close ──────────────────────────────────────────────────────────── */

test("day close settles once, the books balance, and the day is then closed to pushes", { skip: SKIP }, async () => {
  // Day D is still open before midnight plus the grace.
  clock = at(D + 1, 1);
  await assert.rejects(service.settleDay(D), (e: unknown) => e instanceof GameplayError && e.code === "day_not_closed");
  clock = at(D + 1, 3);
  // D20: an operator-loaded district map (here every unit so far is in one district).
  await pool.query(`INSERT INTO gameplay_unit_districts (unit_id, district_id, districts_version)
    SELECT unit_id, 'district-south', 'test-v1' FROM gameplay_units`);
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
  await session(late, "late-session-1", at(D, 20), ["u-late-1"]);
  await assert.rejects(service.applySession(late, "late-session-1"), (e: unknown) => e instanceof GameplayError && e.code === "day_closed");

  // The database refuses books that do not close, and lines that do not add up.
  assert.equal(await errorCode(pool.query(
    `INSERT INTO gameplay_day_settlements (day, season, status, ruleset, economy_rules_version, holding_rules_version, pool_micro, minted_micro, credited_micro, returned_micro, clubs_status, input_digest)
     VALUES (1, 1, 'settled', 'x', 1, 1, 100, 60, 50, 40, 'skipped', $1)`, ["0".repeat(64)])), "23514");
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(`INSERT INTO gameplay_day_settlements (day, season, status, ruleset, economy_rules_version, holding_rules_version, pool_micro, minted_micro, credited_micro, returned_micro, players, clubs_status, input_digest)
      VALUES (2, 1, 'settled', 'x', 1, 1, 100, 60, 60, 40, 1, 'skipped', $1)`, ["0".repeat(64)]);
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
  await pool.query(`INSERT INTO gameplay_unit_districts (unit_id, district_id, districts_version)
    VALUES ('u-club-r1', 'district-north', 'test-v1'), ('u-club-r2', 'district-north', 'test-v1'), ('u-club-b1', 'district-north', 'test-v1')`);

  // Day D+1: nobody is in a club yet. Day D+2: both are.
  clock = at(D + 2, 10);
  await session(red, "club-red-1", at(D + 2, 9), ["u-club-r1", "u-club-r2"]);
  await session(blue, "club-blue-1", at(D + 2, 9), ["u-club-b1"]);
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
  const victim = "usr-rule-a"; // holds u-rule-1, has pushes, credit lines and is a previous holder in B's events
  const erased = await createDrizzleAccountDeletionStore(db).erase(victim);
  assert.equal(erased.users, 1);
  for (const [table, col] of [["gameplay_units", "holder_id"], ["gameplay_unit_day_states", "holder_id"], ["gameplay_push_events", "walker_id"],
    ["gameplay_push_events", "previous_holder_id"], ["gameplay_push_events", "new_holder_id"], ["gameplay_credit_lines", "player_id"],
    ["gameplay_applied_sessions", "user_id"], ["gameplay_club_memberships", "walker_id"]] as const) {
    const n = await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${col} = $1`, [victim]);
    assert.equal(n.rows[0].n, 0, `${table}.${col}`);
  }
  const unit = (await pool.query("SELECT holder_id, strength, level FROM gameplay_units WHERE unit_id = 'u-rule-1'")).rows[0];
  assert.deepEqual(unit, { holder_id: null, strength: 0, level: 1 });
  // The settled day's header stands.
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM gameplay_day_settlements WHERE day = $1", [D])).rows[0].n, 1);
});

/* ── HTTP and the feature flag ──────────────────────────────────────────── */

test("HTTP: auth on every route, strict bodies, idempotent apply", { skip: SKIP }, async () => {
  clock = at(D + 3, 10);
  const walker = await user("usr-http-1");
  await session(walker, "http-session-1", at(D + 3, 9), ["u-http-1"]);
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
    assert.equal((await call("POST", "/sessions/http-session-1/apply", { unitId: "u-http-1", outcome: "flipped" })).status, 400);
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
