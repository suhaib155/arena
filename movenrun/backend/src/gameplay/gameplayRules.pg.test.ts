/**
 * The versioned rule sets against real PostgreSQL: rule set 1002
 * (sim-pilot-2's two-day challenge, 13-take budget and resolution 9 zones)
 * through the service on migration 0011, with more than 25 parallel
 * submissions, day attribution, late and out-of-order uploads, version
 * pinning that fails closed, replay against the stored record, and erasure.
 *
 * Like gameplay.pg.test.ts: skipped, loudly, without MOVENRUN_TEST_DATABASE_URL;
 * each run creates and drops its own database.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, randomBytes } from "node:crypto";
import { cellToChildren, cellToParent, getResolution, gridDisk, isValidCell, latLngToCell } from "h3-js";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { newUnit, type UnitState } from "@movenrun/shared/holding";
import type { PushEvent } from "@movenrun/shared/holdingLedger";
import type { Db } from "../db/client.js";
import { createDrizzleAccountDeletionStore } from "../identity/accountDeletion.js";
import { applyServerLedger, challengeKey } from "./policy.js";
import { claimCellOptionsOf, DAY_MS, PILOT_PROPOSAL, SIM_PILOT_2_PROPOSAL, rulesetConfig, rulesetDigest, type GameplayRules } from "./rules.js";
import { GameplayError, GameplayService } from "./service.js";
import { SEALED_LOOP, SEAL_COLUMNS, sealLiteral } from "./sealFixtures.js";
import { cellToInt8, int8ToCell } from "./cells.js";
import { createHash } from "node:crypto";

const DATABASE_URL = process.env.MOVENRUN_TEST_DATABASE_URL;
const BACKEND = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKIP = DATABASE_URL ? false : "MOVENRUN_TEST_DATABASE_URL is not set — the gameplay rule sets on PostgreSQL were NOT verified";

const D = Math.floor(Date.UTC(2026, 9, 1) / DAY_MS);
const P2: GameplayRules = { ...SIM_PILOT_2_PROPOSAL, holding: { ...SIM_PILOT_2_PROPOSAL.holding }, seasonOneStartDay: D };
const A9: GameplayRules = { ...PILOT_PROPOSAL, holding: { ...PILOT_PROPOSAL.holding }, seasonOneStartDay: D };
const at = (day: number, hour: number) => day * DAY_MS + Math.round(hour * 3_600_000);

/** Resolution 10 units in resolution 9 zones (internal ids only). */
const ZONES = gridDisk(latLngToCell(51.5007, -0.1246, 9), 2).sort();
const U = ZONES.flatMap((z) => cellToChildren(z, 10).sort());
/** Resolution 8 cells for rule set 1001, which stores the pipeline's cells as they are. */
const R8 = gridDisk(latLngToCell(51.5007, -0.1246, 8), 1).sort();
/** The ledger as the API sees it: user ids, cells and outcome names. */
const LEDGER = `(SELECT e.seq, e.day, e.unit, e.source_no, e.walker_no, w.user_id AS walker_id, ph.user_id AS previous_holder_id, nh.user_id AS new_holder_id,
    e.previous_holder_no, e.new_holder_no, e.outcome AS outcome_code, (ARRAY['claimed', 'reinforced', 'eroded', 'flipped'])[e.outcome] AS outcome,
    e.strength_before, e.strength_after, e.shade_strength, e.holding_rules_version
  FROM gameplay_push_events e JOIN gameplay_players w ON w.player_no = e.walker_no
  LEFT JOIN gameplay_players ph ON ph.player_no = e.previous_holder_no LEFT JOIN gameplay_players nh ON nh.player_no = e.new_holder_no) ledger`;
const DAYROWS = `(SELECT d.*, p.user_id AS walker_id FROM gameplay_walker_days d JOIN gameplay_players p ON p.player_no = d.walker_no) dayrows`;
const playerNo = async (userId: string) => Number((await pool.query("SELECT player_no FROM gameplay_players WHERE user_id = $1", [userId])).rows[0]?.player_no);

let admin: pg.Pool;
let pool: pg.Pool;
let db: Db;
let dbName: string;
let clock = at(D, 9);
let p2: GameplayService;
let a9: GameplayService;

function sqlFile(path: string): string[] {
  return readFileSync(join(BACKEND, path), "utf8").split("--> statement-breakpoint").filter((s) => s.trim());
}

async function runInTx(statements: string[]): Promise<void> {
  const c = await pool.connect();
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

async function user(id: string): Promise<string> {
  await pool.query("INSERT INTO users (id) VALUES ($1)", [id]);
  return id;
}

/**
 * A verified session, received by the server at `receivedMs` (default: the
 * test clock). Resolution 10 units also get the stored 1002 path, in the
 * given (walk) order, as the movement pipeline writes it with gameplay on;
 * `path: false` stores none, as for a session verified with gameplay off.
 */
async function session(userId: string, clientSessionId: string, endMs: number, units: string[],
  opts: { receivedMs?: number; path?: boolean; interpolated?: boolean[]; claimResolution?: number } = {}): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO movement_verifications (id, user_id, client_session_id, status, distance_meters, duration_seconds, traversed_hex_ids, start_time, end_time, created_at, ${SEAL_COLUMNS})
     VALUES ($1, $2, $3, 'verified', 3000, 1800, $4, $5, $6, (to_timestamp($7::float8 / 1000) AT TIME ZONE current_setting('TimeZone')), ${sealLiteral(SEALED_LOOP, units, opts.claimResolution)})`,
    [id, userId, clientSessionId, units, endMs - 1_800_000, endMs, opts.receivedMs ?? clock],
  );
  const fine = units.length > 0 && units.every((u) => isValidCell(u) && getResolution(u) === 10);
  if (opts.path ?? fine) {
    const flags = opts.interpolated ?? units.map(() => false);
    await pool.query(
      `INSERT INTO gameplay_session_paths (movement_verification_id, path_version, resolution, unit_ids, interpolated, skipped_segments, truncated)
       VALUES ($1, 1, 10, $2::bigint[], $3::varbit, 0, false)`,
      [id, units.map(cellToInt8), flags.map((f) => (f ? "1" : "0")).join("")],
    );
  }
  return id;
}

/** Create the session and apply it. */
async function walk(svc: GameplayService, userId: string, sid: string, endMs: number, units: string[]) {
  // The territory seal's claimable cells as the pipeline of the service's own rule set stamps them.
  await session(userId, sid, endMs, units, { claimResolution: claimCellOptionsOf(svc.rules).resolution });
  return svc.applySession(userId, sid);
}

async function code(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (err) {
    if (err instanceof GameplayError) return err.code;
    return (err as { code?: string }).code;
  }
}

const unitRow = async (u: string) => (await pool.query("SELECT holder_id, strength, as_of_day, holding_rules_version FROM gameplay_units WHERE unit = $1", [cellToInt8(u)])).rows[0];
const challengers = async (u: string) => (await pool.query("SELECT walker_id, first_day FROM gameplay_unit_challenges WHERE unit = $1 ORDER BY walker_id", [cellToInt8(u)])).rows
  .map((r) => [r.walker_id as string, Number(r.first_day)]);

before(async () => {
  if (!DATABASE_URL) return;
  admin = new pg.Pool({ connectionString: DATABASE_URL });
  admin.on("error", () => undefined);
  for (const role of ["anon", "authenticated"]) {
    // Another test file may create the same role at the same moment.
    await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`)
      .catch((err: { code?: string }) => { if (err.code !== "23505" && err.code !== "42710") throw err; });
  }
  dbName = `gameplay_rules_test_${randomBytes(6).toString("hex")}`;
  await admin.query(`CREATE DATABASE "${dbName}"`);
  const url = new URL(DATABASE_URL);
  url.pathname = `/${dbName}`;
  pool = new pg.Pool({ connectionString: url.toString(), max: 20 });
  // The final DROP DATABASE … WITH (FORCE) ends any backend the pool has not
  // finished closing; an unhandled pool error would fail the file after its tests passed.
  pool.on("error", () => undefined);
  db = drizzle(pool) as unknown as Db;
  const journal = JSON.parse(readFileSync(join(BACKEND, "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
  await runInTx(journal.entries.flatMap((e) => sqlFile(`drizzle/${e.tag}.sql`)));
  await runInTx(sqlFile("drizzle-proposed/0011_gameplay_holdings.sql"));
  p2 = new GameplayService({ db, rules: P2, now: () => clock });
  a9 = new GameplayService({ db, rules: A9, now: () => clock });
});

after(async () => {
  if (!DATABASE_URL) return;
  await pool.end();
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.end();
});

/* ── takeover ───────────────────────────────────────────────────────────── */

test("1002 two-day challenge: first push, same-day repeat, second-day flip, holder defence, and the day pinned to 1002", { skip: SKIP }, async () => {
  clock = at(D, 12);
  const ana = await user("ana");
  const ben = await user("ben");
  const cal = await user("cal");
  assert.equal((await walk(p2, ana, "ana-d0-a", at(D, 8), [U[0]!, U[1]!])).outcomes.claimed, 2);
  const first = await walk(p2, ben, "ben-d0-a", at(D, 9), [U[0]!]);
  assert.equal(first.outcomes.eroded, 1);
  assert.deepEqual(await unitRow(U[0]!), { holder_id: ana, strength: 50, as_of_day: D, holding_rules_version: 1002 });
  assert.deepEqual(await challengers(U[0]!), [[ben, D]]);
  assert.equal((await walk(p2, ben, "ben-d0-b", at(D, 10), [U[0]!])).outcomes.refused_daily_limit, 1, "one push per walker, unit and day");
  assert.equal((await walk(p2, cal, "cal-d0-a", at(D, 11), [U[1]!])).outcomes.eroded, 1);
  const pin = (await pool.query("SELECT ruleset, holding_rules_version, takeover_policy, take_budget, unit_zone_rule FROM gameplay_day_rules WHERE day = $1", [D])).rows[0];
  assert.deepEqual(pin, { ruleset: "server-sim-pilot-2-proposal", holding_rules_version: 1002, takeover_policy: "two-day-challenge", take_budget: 13, unit_zone_rule: "h3-parent/each-holder-holds-zone" });

  clock = at(D + 1, 12);
  assert.equal((await walk(p2, ben, "ben-d1-a", at(D + 1, 9), [U[0]!])).outcomes.flipped, 1, "the challenger's second day");
  assert.equal((await unitRow(U[0]!)).holder_id, ben);
  assert.deepEqual(await challengers(U[0]!), [], "a flip clears every challenge");
  // Ana defends U1 before Cal returns: Cal's push the next day is a new challenge, not a flip.
  assert.equal((await walk(p2, ana, "ana-d1-a", at(D + 1, 8), [U[1]!])).outcomes.reinforced, 1);
  assert.deepEqual(await challengers(U[1]!), []);
  assert.equal((await walk(p2, cal, "cal-d1-a", at(D + 1, 10), [U[1]!])).outcomes.eroded, 1);
  assert.deepEqual(await challengers(U[1]!), [[cal, D + 1]]);
  assert.equal((await unitRow(U[1]!)).holder_id, ana);
});

test("more than 25 parallel submissions: one session 30 times, 30 challengers on one unit, 30 sessions of one walker against the budget", { skip: SKIP }, async () => {
  clock = at(D + 1, 14);
  const ana = "ana";
  // The same session 30 times at once: applied once.
  await session(ana, "ana-d1-many", at(D + 1, 13), [U[2]!, ...U.slice(10, 40)]);
  const same = await Promise.all(Array.from({ length: 30 }, () => p2.applySession(ana, "ana-d1-many")));
  assert.equal(same.filter((r) => !r.replayed).length, 1);
  assert.equal(same[0]!.outcomes.claimed, 31);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM gameplay_push_events e JOIN gameplay_applied_sessions s ON s.source_no = e.source_no
    JOIN movement_verifications m ON m.id = s.movement_verification_id WHERE m.client_session_id = 'ana-d1-many'`)).rows[0].n, 31);

  // Thirty challengers on U2 at once: each erodes once and holds their own challenge; one chain.
  const ws: string[] = [];
  for (let i = 0; i < 30; i++) {
    ws.push(await user(`chal-${String(i).padStart(2, "0")}`));
    await session(ws[i]!, `chal-${i}-d1`, at(D + 1, 13), [U[2]!]);
  }
  const res = await Promise.all(ws.map((w, i) => p2.applySession(w, `chal-${i}-d1`)));
  assert.equal(res.reduce((a, r) => a + r.outcomes.eroded, 0), 30);
  assert.equal((await unitRow(U[2]!)).holder_id, ana);
  assert.equal((await challengers(U[2]!)).length, 30);
  const chain = (await pool.query(`SELECT previous_holder_id, new_holder_id, strength_before, strength_after FROM ${LEDGER} WHERE unit = $1 ORDER BY seq`, [cellToInt8(U[2]!)])).rows;
  for (let i = 1; i < chain.length; i++) {
    assert.equal(chain[i].previous_holder_id, chain[i - 1].new_holder_id);
    assert.equal(chain[i].strength_before, chain[i - 1].strength_after);
  }

  // One walker, thirty sessions at once, each on a different unit Ana holds: exactly 13 takes.
  const heavy = await user("heavy");
  for (let i = 0; i < 30; i++) await session(heavy, `heavy-d1-${String(i).padStart(2, "0")}`, at(D + 1, 13), [U[10 + i]!]);
  const runs = await Promise.all(Array.from({ length: 30 }, (_, i) => p2.applySession(heavy, `heavy-d1-${String(i).padStart(2, "0")}`)));
  assert.equal(runs.reduce((a, r) => a + r.outcomes.eroded + r.outcomes.flipped, 0), 13);
  assert.equal(runs.reduce((a, r) => a + r.outcomes.refused_take_budget, 0), 17);
  const counter = (await pool.query(`SELECT takes_used, units_used, refused_take_budget FROM ${DAYROWS} WHERE walker_id = $1 AND day = $2`, [heavy, D + 1])).rows[0];
  assert.deepEqual(counter, { takes_used: 13, units_used: 30, refused_take_budget: 17 });
  // Only the 13 takes are ledger rows; the 17 refusals are the counter above.
  const stored = (await pool.query(`SELECT outcome, count(*)::int AS n FROM ${LEDGER} WHERE walker_id = $1 GROUP BY outcome ORDER BY outcome`, [heavy])).rows;
  assert.deepEqual(stored, [{ outcome: "eroded", n: 13 }]);
  // Refused takes changed nothing: the units are still Ana's at full strength.
  const taken = new Set((await pool.query(`SELECT unit::text AS unit FROM ${LEDGER} WHERE walker_id = $1`, [heavy])).rows.map((r) => int8ToCell(r.unit)));
  const refusedUnits = U.slice(10, 40).filter((u) => !taken.has(u));
  assert.equal(refusedUnits.length, 17);
  for (const u of refusedUnits) assert.deepEqual([(await unitRow(u)).holder_id, (await unitRow(u)).strength], [ana, 100]);
  // Replaying all thirty, and a server batch retried 30 times at once, spend nothing more.
  const again = await Promise.all(Array.from({ length: 30 }, (_, i) => p2.applySession(heavy, `heavy-d1-${String(i).padStart(2, "0")}`)));
  assert.ok(again.every((r) => r.replayed));
  const batch: PushEvent[] = [U[41]!, U[42]!, U[43]!].map((u) => ({ eventId: `srv:heavy:${u}`, unitId: u, walkerId: heavy, push: { kind: "solid" }, day: D + 1 }));
  const retried = await Promise.all(Array.from({ length: 30 }, () => p2.applyPushes(batch)));
  assert.equal(retried.reduce((a, r) => a + r.applied, 0), 3);
  assert.equal(retried.reduce((a, r) => a + r.skipped, 0), 87);
  assert.equal((await pool.query(`SELECT takes_used FROM ${DAYROWS} WHERE walker_id = $1 AND day = $2`, [heavy, D + 1])).rows[0].takes_used, 13, "claims are free");
});

test("the database refuses a 14th take, a take the counter does not know, a push under another version, and a re-pinned day", { skip: SKIP }, async () => {
  const heavyNo = await playerNo("heavy");
  const anaNo = await playerNo("ana");
  const insertTake = (c: pg.PoolClient, unit: string) => c.query(
    `INSERT INTO gameplay_push_events (unit, day, source_no, walker_no, previous_holder_no, new_holder_no, strength_before, strength_after, outcome, holding_rules_version)
     VALUES ($1, $2, 999999, $3, $4, $4, 100, 50, 3, 1002)`, [cellToInt8(unit), D + 1, heavyNo, anaNo]);
  for (const bumpCounter of [false, true]) {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await insertTake(c, U[41]!);
      if (bumpCounter) await c.query("UPDATE gameplay_walker_days SET takes_used = 14 WHERE walker_no = $2 AND day = $1", [D + 1, heavyNo]);
      assert.equal(await code(c.query("COMMIT")), "23514", bumpCounter ? "over the budget" : "counter mismatch");
    } finally {
      await c.query("ROLLBACK").catch(() => undefined);
      c.release();
    }
  }
  assert.equal(await code(pool.query("UPDATE gameplay_walker_days SET takes_used = 14 WHERE walker_no = $2 AND day = $1", [D + 1, heavyNo])), undefined,
    "the counter alone may move; the takes it counts are checked when one is written");
  await pool.query("UPDATE gameplay_walker_days SET takes_used = 13 WHERE walker_no = $2 AND day = $1", [D + 1, heavyNo]);
  // A row under a version the day is not pinned to cannot be stored.
  const calNo = await playerNo("cal");
  assert.equal(await code(pool.query(
    `INSERT INTO gameplay_push_events (unit, day, source_no, walker_no, previous_holder_no, new_holder_no, strength_before, strength_after, outcome, holding_rules_version)
     VALUES ($1, $2, 999998, $3, NULL, $3, 0, 100, 1, 1001)`, [cellToInt8(U[2]!), D + 1, calNo])), "23503");
  assert.equal(await code(pool.query("UPDATE gameplay_day_rules SET take_budget = 99 WHERE day = $1", [D])), "23001");
  assert.equal(await code(pool.query("DELETE FROM gameplay_day_rules WHERE day = $1", [D])), "23001");
  // A challenge by the unit's own holder, or on unheld ground, is refused.
  assert.equal(await code(pool.query("INSERT INTO gameplay_unit_challenges (unit, walker_id, first_day, holding_rules_version) VALUES ($1, 'ana', $2, 1002)", [cellToInt8(U[1]!), D + 1])), "23514");
  // No grant on the server-only tables for either Supabase role.
  for (const t of ["gameplay_day_rules", "gameplay_walker_days", "gameplay_unit_challenges", "gameplay_players", "gameplay_push_events", "gameplay_player_day_proofs"]) {
    for (const role of ["anon", "authenticated"]) {
      const r = await pool.query("SELECT has_any_column_privilege($1, $2, 'SELECT') AS s, has_table_privilege($1, $2, 'INSERT') AS i", [role, `public.${t}`]);
      assert.deepEqual(r.rows[0], { s: false, i: false }, `${role} ${t}`);
    }
    const rls = await pool.query("SELECT relrowsecurity FROM pg_class WHERE relname = $1", [t]);
    assert.equal(rls.rows[0].relrowsecurity, true, t);
  }
});

test("multiple challengers, decay between days, and one of thirty finishing on the second day", { skip: SKIP }, async () => {
  clock = at(D + 2, 12);
  // Chal-07 returns: their own challenge from yesterday completes; the 29 others end with the flip.
  assert.equal((await walk(p2, "chal-07", "chal-7-d2", at(D + 2, 9), [U[2]!])).outcomes.flipped, 1);
  assert.equal((await unitRow(U[2]!)).holder_id, "chal-07");
  assert.deepEqual(await challengers(U[2]!), []);
  // Cal's challenge on U1 from day D+1 is still open; someone else only decays the unit.
  const dee = await user("dee");
  assert.equal((await walk(p2, dee, "dee-d2", at(D + 2, 10), [U[1]!])).outcomes.eroded, 1);
  assert.deepEqual([(await unitRow(U[1]!)).holder_id, (await unitRow(U[1]!)).strength], ["ana", 47]);
  assert.deepEqual(await challengers(U[1]!), [["cal", D + 1], [dee, D + 2]]);
});

/* ── day attribution, clocks, late and out-of-order uploads ─────────────── */

test("server time decides the day: a future-dated session is refused, a late upload inside the grace counts for its day, one after it never does", { skip: SKIP }, async () => {
  clock = at(D + 2, 13);
  const eve = await user("eve");
  // Device clock ahead: a session that ends tomorrow by its own clock.
  assert.equal(await code(walk(p2, eve, "eve-future", at(D + 3, 1), [U[70]!])), "session_in_future");
  // Device clock far behind, or a long offline session uploaded days later: the day has closed.
  assert.equal(await code(walk(p2, eve, "eve-old", at(D, 20), [U[70]!])), "day_closed");
  // A session from the previous day uploaded at 01:00 counts for that day (D1 grace) …
  clock = at(D + 3, 1);
  const late = await walk(p2, eve, "eve-late", at(D + 2, 23.5), [U[71]!]);
  assert.equal(late.day, D + 2);
  // … but a unit already pushed on the new day cannot be rewritten by it (out of order).
  const fay = await user("fay");
  assert.equal((await walk(p2, fay, "fay-d3-early", at(D + 3, 0.5), [U[72]!])).day, D + 3);
  const stale = await walk(p2, eve, "eve-late-2", at(D + 2, 23.75), [U[72]!]);
  assert.deepEqual([stale.day, stale.rejected, stale.rejectedByReason.stale_day], [D + 2, 1, 1]);
  // After the grace the previous day is closed to every upload.
  clock = at(D + 3, 2.5);
  assert.equal(await code(walk(p2, eve, "eve-too-late", at(D + 2, 23.9), [U[73]!])), "day_closed");
  // Under 1002 the units come from the stored session path, never from the resolution 8 cells:
  // a session verified without a path (gameplay off at the time) is refused, and so is a path under another rule.
  assert.equal(await code(walk(p2, eve, "eve-res8", at(D + 3, 2), ["88194ad14dfffff"])), "session_path_unavailable");
  const odd = await session(eve, "eve-odd-path", at(D + 3, 2), [U[74]!]);
  await pool.query("UPDATE gameplay_session_paths SET path_version = 2 WHERE movement_verification_id = $1", [odd]);
  assert.equal(await code(p2.applySession(eve, "eve-odd-path")), "session_path_version_mismatch");
  // A stored path whose units are not resolution 10 is refused whole.
  await session(eve, "eve-res9-path", at(D + 3, 2), [ZONES[5]!], { path: true });
  assert.equal(await code(p2.applySession(eve, "eve-res9-path")), "unit_resolution_mismatch");
});

test("split sessions: one walk in two uploads takes a unit once and spends one take; across midnight it is two days", { skip: SKIP }, async () => {
  clock = at(D + 3, 3);
  const gus = await user("gus");
  // Two parts of one walk on the same day, crossing the same three units of Ana's.
  const a = await walk(p2, gus, "gus-part-1", at(D + 3, 2.6), [U[12]!, U[13]!]);
  const b = await walk(p2, gus, "gus-part-2", at(D + 3, 2.8), [U[13]!, U[14]!]);
  assert.deepEqual([a.outcomes.eroded, b.outcomes.eroded, b.outcomes.refused_daily_limit], [2, 1, 1]);
  assert.equal((await pool.query(`SELECT takes_used FROM ${DAYROWS} WHERE walker_id = $1 AND day = $2`, [gus, D + 3])).rows[0].takes_used, 3);
  // The midnight straddle: a challenge at 23:50 and a push at 00:20 are two D1 days, but the server
  // received them 30 minutes apart, so the second erodes and keeps the challenge's first day (1002's
  // 20-hour second-push gap). Under D1 alone this flipped (the exploit).
  clock = at(D + 4, 0.5);
  const hal = await user("hal");
  const before = await walk(p2, hal, "hal-2350", at(D + 3, 23.83), [U[15]!]);
  const afterMidnight = await walk(p2, hal, "hal-0020", at(D + 4, 0.33), [U[15]!]);
  assert.deepEqual([before.day, before.outcomes.eroded, afterMidnight.day, afterMidnight.outcomes.flipped, afterMidnight.outcomes.eroded], [D + 3, 1, D + 4, 0, 1]);
  assert.deepEqual((await challengers(U[15]!)).filter(([w]) => w === hal), [[hal, D + 3]], "too early: the challenge is kept, not restarted");
  assert.equal((await unitRow(U[15]!)).holder_id, "ana");
});

/* ── masked and deeded ──────────────────────────────────────────────────── */

test("masked units are never claimable and deeded units are immune through the service, and neither spends the budget", { skip: SKIP }, async () => {
  clock = at(D + 4, 10);
  await pool.query("INSERT INTO gameplay_units (unit, as_of_day, holding_rules_version, masked) VALUES ($1, $2, 1002, true)", [cellToInt8(U[80]!), D + 4]);
  await walk(p2, "ana", "ana-d4", at(D + 4, 8), [U[81]!]);
  await pool.query("UPDATE gameplay_units SET deeded = true WHERE unit = $1", [cellToInt8(U[81]!)]);
  const r = await walk(p2, "dee", "dee-d4", at(D + 4, 9), [U[80]!, U[81]!]);
  assert.deepEqual([r.outcomes.refused_masked, r.outcomes.refused_deeded, r.outcomes.eroded], [1, 1, 0]);
  assert.equal((await unitRow(U[80]!)).holder_id, null);
  assert.equal((await unitRow(U[81]!)).holder_id, "ana");
  const deeDay = (await pool.query(`SELECT takes_used, units_used, refused_masked, refused_deeded, visit_units::text[] AS v FROM ${DAYROWS} WHERE walker_id = 'dee' AND day = $1`, [D + 4])).rows[0];
  // Both refusals are counters. U80 and U81 are in one zone, so one kept unit records the visit.
  assert.equal(cellToParent(U[80]!, 9), cellToParent(U[81]!, 9));
  assert.deepEqual(deeDay, { takes_used: 0, units_used: 2, refused_masked: 1, refused_deeded: 1, v: [cellToInt8(U[80]!)] });
  await pool.query("UPDATE gameplay_units SET deeded = false WHERE unit = $1", [cellToInt8(U[81]!)]);
});

/* ── day close under 1002, and replay ───────────────────────────────────── */

test("day close under 1002: books balance, every holder of a mixed zone holds it, and replaying the ledger gives the stored record", { skip: SKIP }, async () => {
  clock = at(D + 4, 12);
  // D20 map for the held units: one district.
  await pool.query("INSERT INTO gameplay_unit_districts (unit, district_id, districts_version) SELECT unit, 'district-a', 'test-v1' FROM gameplay_units");
  assert.equal(await p2.settleDueDays(), 4);
  const headers = (await pool.query("SELECT day, status, holding_rules_version, ruleset, problems, pool_micro, minted_micro, credited_micro, toll_paid_micro, burned_micro, returned_micro FROM gameplay_day_settlements ORDER BY day")).rows;
  assert.equal(headers.length, 4);
  for (const h of headers) {
    assert.equal(h.status, "settled", JSON.stringify(h.problems));
    assert.equal(h.holding_rules_version, 1002);
    assert.equal(Number(h.minted_micro) + Number(h.returned_micro), Number(h.pool_micro));
    assert.equal(Number(h.credited_micro) + Number(h.toll_paid_micro) + Number(h.burned_micro), Number(h.minted_micro));
  }
  // Day D+1: U0 is Ben's and U1 Ana's, both in the first zone. Each holds it once; neither is its only holder.
  const zone = ZONES[0]!;
  assert.deepEqual(cellToChildren(zone, 10).sort().slice(0, 2), [U[0]!, U[1]!]);
  const lines = new Map((await pool.query("SELECT player_id, zones_held FROM gameplay_credit_lines WHERE day = $1", [D + 1])).rows.map((r) => [r.player_id, r.zones_held]));
  assert.equal(lines.get("ben"), 1);
  assert.ok(lines.get("ana") >= 1);

  // Replay: every stored push, one at a time in commit order, from unheld ground, under the recorded version.
  // Refusals are not rows: they changed no ground, so the accepted rows alone rebuild every unit.
  // Each row's receipt time is the server's: its session row's created_at (or the batch receipt's applied_at).
  const events = (await pool.query(`SELECT ledger.source_no, ledger.unit::text AS unit, ledger.walker_id, ledger.day, ledger.shade_strength, ledger.outcome,
      ledger.new_holder_id, ledger.strength_after, ledger.holding_rules_version,
      (extract(epoch FROM (COALESCE(mv.created_at, s.applied_at) AT TIME ZONE current_setting('TimeZone'))) * 1000)::float8 AS received_ms
    FROM ${LEDGER} JOIN gameplay_applied_sessions s ON s.source_no = ledger.source_no
    LEFT JOIN movement_verifications mv ON mv.id = s.movement_verification_id ORDER BY ledger.seq`)).rows
    .map((e) => ({ ...e, unit_id: int8ToCell(e.unit), event_id: `${e.source_no}:${int8ToCell(e.unit)}` }));
  const tk = P2.takeover;
  assert.ok(tk.name === "two-day-challenge" && tk.policyVersion === 2);
  let opened = new Map<string, number>();
  const masked = new Set((await pool.query("SELECT unit::text AS unit FROM gameplay_units WHERE masked")).rows.map((r) => int8ToCell(r.unit)));
  let states = new Map<string, UnitState>();
  const used = new Map<string, number>();
  for (const e of events) {
    assert.equal(e.holding_rules_version, 1002);
    if (!states.has(e.unit_id)) states.set(e.unit_id, newUnit(e.unit_id, Number(e.day), masked.has(e.unit_id)));
    const k = `${e.walker_id}:${e.day}`;
    const r = applyServerLedger({
      states, holding: P2.holding, budget: P2.takeBudget, takesUsed: new Map([[e.walker_id, used.get(k) ?? 0]]),
      secondPush: { minElapsedMs: tk.secondPush.minElapsedMs, windowDays: tk.windowDays, eventReceivedMs: new Map([[e.event_id, Number(e.received_ms)]]), challengeOpenedMs: opened },
      events: [{ eventId: e.event_id, unitId: e.unit_id, walkerId: e.walker_id, day: Number(e.day), push: Number(e.shade_strength) > 0 ? { kind: "shade", strength: Number(e.shade_strength) } : { kind: "solid" } }],
    });
    assert.equal(r.entries[0]?.outcome, e.outcome, e.event_id);
    assert.equal(r.entries[0]?.newHolderId, e.new_holder_id, e.event_id);
    assert.equal(r.entries[0]?.strengthAfter, e.strength_after, e.event_id);
    used.set(k, r.takesUsed.get(e.walker_id)!);
    states = r.states;
    opened = r.challengeOpenedMs;
  }
  for (const [u, s] of states) {
    const row = await unitRow(u);
    assert.deepEqual([row.holder_id, row.strength, row.as_of_day], [s.holderId, s.strength, s.asOfDay], u);
    assert.deepEqual(await challengers(u), (s.challenges ?? []).map((c) => [c.walkerId, c.day]), u);
  }
  // Every open challenge stores the server receipt time the replay derives for it (opened_received_at).
  const stored = (await pool.query("SELECT unit::text AS unit, walker_id, (extract(epoch FROM opened_received_at) * 1000)::float8 AS ms FROM gameplay_unit_challenges")).rows;
  assert.ok(stored.length > 0);
  for (const c of stored) {
    const want = opened.get(challengeKey(int8ToCell(c.unit), c.walker_id));
    assert.ok(want !== undefined && c.ms !== null && Math.abs(Number(c.ms) - want) < 1, `${c.unit}:${c.walker_id}`);
  }
  // The counters equal the takes in the ledger, for every walker and day.
  const counters = (await pool.query(`SELECT walker_id, day, takes_used FROM ${DAYROWS}`)).rows;
  for (const c of counters) assert.equal(c.takes_used, used.get(`${c.walker_id}:${c.day}`) ?? 0, `${c.walker_id}:${c.day}`);
  // Every refusal any receipt reported is on a day row, and nothing else is.
  const receipts = (await pool.query("SELECT coalesce(sum(outcome_counts[5] + outcome_counts[6] + outcome_counts[7] + outcome_counts[8]), 0)::int AS n FROM gameplay_applied_sessions")).rows[0].n;
  const counted = (await pool.query("SELECT coalesce(sum(refused_deeded + refused_masked + refused_daily_limit + refused_take_budget), 0)::int AS n FROM gameplay_walker_days")).rows[0].n;
  assert.ok(receipts > 0);
  assert.equal(counted, receipts);

  // Proofs: one per walker and settled day, and an independent reconciler gets the same digest from the raw rows.
  const proofs = (await pool.query("SELECT player_no, day, accepted, takes, refused, units_used, encode(events_sha256, 'hex') AS sha FROM gameplay_player_day_proofs WHERE day BETWEEN $1 AND $2 ORDER BY day, player_no", [D, D + 3])).rows;
  const ledgerDays = (await pool.query(`SELECT walker_no, day, count(*)::int AS n FROM ${LEDGER} WHERE day BETWEEN $1 AND $2 GROUP BY walker_no, day`, [D, D + 3])).rows;
  for (const l of ledgerDays) assert.equal(proofs.find((p) => p.player_no === l.walker_no && p.day === l.day)?.accepted, l.n, `${l.walker_no}:${l.day}`);
  const heavyNo = await playerNo("heavy");
  const hp = proofs.find((p) => p.player_no === heavyNo && p.day === D + 1)!;
  assert.deepEqual([hp.accepted, hp.takes, hp.refused, hp.units_used], [16, 13, 17, 33]);
  const raw = (await pool.query(`SELECT source_no, unit::text AS unit, outcome_code, previous_holder_no, new_holder_no, strength_before, strength_after, shade_strength
    FROM ${LEDGER} WHERE walker_no = $1 AND day = $2 ORDER BY seq`, [heavyNo, D + 1])).rows;
  const dayRow = (await pool.query("SELECT refused_deeded, refused_masked, refused_daily_limit, refused_take_budget, visit_units::text[] AS v FROM gameplay_walker_days WHERE walker_no = $1 AND day = $2", [heavyNo, D + 1])).rows[0];
  // Proof encoding 2: no other player's number, so erasing a holder never changes this proof.
  const proofLines = raw.map((e) => [e.source_no, e.unit, e.outcome_code, `${e.strength_before}>${e.strength_after}`, e.shade_strength].join(":"));
  proofLines.push(["refused", dayRow.refused_deeded, dayRow.refused_masked, dayRow.refused_daily_limit, dayRow.refused_take_budget, dayRow.v.join(",")].join(":"));
  assert.equal(createHash("sha256").update(proofLines.join("\n")).digest("hex"), hp.sha);
});

/* ── rules versions fail closed ─────────────────────────────────────────── */

test("no silent migration: another version on a pinned day, on held ground or at day close fails closed", { skip: SKIP }, async () => {
  clock = at(D + 4, 12);
  // D+4 is pinned to 1002: the 1001 service cannot push on it.
  const ivy = await user("ivy");
  assert.equal(await code(walk(a9, ivy, "ivy-d4", at(D + 4, 11), [R8[0]!])), "rules_version_mismatch");
  // D+5 is unpinned, but season 1 runs 1002: 1001 cannot pin a new day of it (mid-season change), held ground or not.
  clock = at(D + 5, 12);
  assert.equal(await code(walk(a9, ivy, "ivy-d5-held", at(D + 5, 9), [U[0]!])), "season_rules_changed");
  assert.equal(await code(walk(a9, ivy, "ivy-d5-free-0", at(D + 5, 9.5), [R8[1]!])), "season_rules_changed");
  assert.equal(await code(a9.settleDay(D)), undefined, "a settled day is returned as stored, whatever the instance runs");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM gameplay_day_rules WHERE day = $1", [D + 5])).rows[0].n, 0, "the refused batches pinned nothing");
  // An explicitly recorded pin (an operator's migration decision, not built) is the only way in. With D+5
  // pinned to 1001, the ground Ben holds under 1002 is still never re-read under 1001.
  await pool.query(`INSERT INTO gameplay_day_rules (day, season, ruleset, holding_rules_version, takeover_policy, take_budget, unit_zone_rule, config, config_digest)
    VALUES ($1, 1, $2, 1001, 'immediate', NULL, 'unit/unit-is-zone', $3::jsonb, $4)`, [D + 5, A9.ruleset, JSON.stringify(rulesetConfig(A9)), rulesetDigest(A9)]);
  assert.equal(await code(walk(a9, ivy, "ivy-d5-held-2", at(D + 5, 9.6), [U[0]!])), "unit_rules_version_mismatch");
  // Unheld ground carries no rule state: 1001 may claim it, and that pins D+5 to 1001 …
  assert.equal((await walk(a9, ivy, "ivy-d5-free", at(D + 5, 10), [R8[1]!])).outcomes.claimed, 1);
  assert.equal(await code(walk(p2, ivy, "ivy-d5-p2", at(D + 5, 11), [U[90]!])), "rules_version_mismatch");
  // … and D+5 then settles under 1001 even when 1002 runs, refusing because ground held under 1002 is in it.
  clock = at(D + 6, 3);
  const d5 = await p2.settleDay(D + 5);
  assert.equal(d5.status, "refused");
  const h5 = (await pool.query("SELECT holding_rules_version, problems FROM gameplay_day_settlements WHERE day = $1", [D + 5])).rows[0];
  assert.equal(h5.holding_rules_version, 1001);
  assert.ok((h5.problems as string[]).some((p) => p.includes("held under holding rules version 1002")));

  // A day pinned to a version this build does not know, or whose config changed under its number: nothing is settled.
  await pool.query(`INSERT INTO gameplay_day_rules (day, season, ruleset, holding_rules_version, takeover_policy, unit_zone_rule, config, config_digest)
    VALUES ($1, 1, 'from-a-newer-build', 4242, 'immediate', 'unit/unit-is-zone', '{}', $2), ($3, 1, 'server-sim-pilot-2-proposal', 1002, 'two-day-challenge', 'h3-parent/each-holder-holds-zone', '{}', $2)`,
  [D + 6, "0".repeat(64), D + 7]);
  clock = at(D + 7, 10);
  assert.equal(await code(walk(p2, ivy, "ivy-d7", at(D + 7, 9), [U[91]!])), "rules_version_mismatch", "same number, other config");
  clock = at(D + 8, 3);
  assert.equal(await code(p2.settleDay(D + 6)), "unknown_rules_version");
  assert.equal(await code(p2.settleDay(D + 7)), "rules_config_mismatch");
  assert.equal(await code(p2.settleDueDays()), "unknown_rules_version", "the day-close run stops at the first such day");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM gameplay_day_settlements WHERE day >= $1", [D + 6])).rows[0].n, 0);
});

/* ── erasure ────────────────────────────────────────────────────────────── */

test("erasure removes a challenger's challenges and a holder's, leaving no gameplay row naming either", { skip: SKIP }, async () => {
  assert.deepEqual(await challengers(U[1]!), [["cal", D + 1], ["dee", D + 2]]);
  const store = createDrizzleAccountDeletionStore(db);
  const calNo = await playerNo("cal");
  const anaNo = await playerNo("ana");
  assert.ok(calNo > 0 && anaNo > 0);
  await store.erase("cal");
  assert.deepEqual(await challengers(U[1]!), [["dee", D + 2]]);
  await store.erase("ana");
  assert.deepEqual(await challengers(U[1]!), [], "unheld ground has no challenges");
  assert.equal((await unitRow(U[1]!)).holder_id, null);
  for (const [table, col] of [["gameplay_unit_challenges", "walker_id"], ["gameplay_units", "holder_id"], ["gameplay_players", "user_id"]] as const) {
    for (const who of ["cal", "ana"]) {
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${col} = $1`, [who])).rows[0].n, 0, `${table}.${col} ${who}`);
    }
  }
  for (const no of [calNo, anaNo]) {
    for (const [table, col] of [["gameplay_walker_days", "walker_no"], ["gameplay_push_events", "walker_no"], ["gameplay_push_events", "new_holder_no"],
      ["gameplay_push_events", "previous_holder_no"], ["gameplay_unit_day_states", "holder_no"], ["gameplay_player_day_proofs", "player_no"]] as const) {
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${col} = $1`, [no])).rows[0].n, 0, `${table}.${col} ${no}`);
    }
  }
});
