/**
 * Diff-only challenge writes (G34): the "diff" mode of writeChallenges must leave
 * gameplay_unit_challenges exactly as the live delete-and-insert does, on randomized batches that
 * include kept rows whose first_day, rules version or receipt time changes, and must not rewrite
 * a kept row that is unchanged.
 *
 * Skipped, loudly, when MOVENRUN_TEST_DATABASE_URL is not set. Synthetic ids only.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { DEFAULT_CHALLENGE_WRITE_MODE, GameplayService, writeChallenges, type ChallengeWriteMode, type OpenChallenge } from "./service.js";
import { PILOT_PROPOSAL, type GameplayRules } from "./rules.js";
const RULES: GameplayRules = { ...PILOT_PROPOSAL, holding: { ...PILOT_PROPOSAL.holding }, seasonOneStartDay: 20_000 };

const DATABASE_URL = process.env.MOVENRUN_TEST_DATABASE_URL;
const BACKEND = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKIP = DATABASE_URL ? false : "MOVENRUN_TEST_DATABASE_URL is not set — the challenge write path was NOT verified";
const UNIT_BASE = 1n << 59n; // mode 1, as 0011's check requires; synthetic ids
const unitId = (n: number) => (UNIT_BASE + BigInt(n)).toString();

let admin: pg.Pool;
let pool: pg.Pool;
let db: Db;
let dbName: string;

const sqlFile = (path: string) => readFileSync(join(BACKEND, path), "utf8").split("--> statement-breakpoint").filter((s) => s.trim());
async function runInTx(client: pg.Pool, statements: string[]) {
  const c = await client.connect();
  try { await c.query("BEGIN"); for (const s of statements) await c.query(s); await c.query("COMMIT"); }
  catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}

before(async () => {
  if (!DATABASE_URL) return;
  admin = new pg.Pool({ connectionString: DATABASE_URL });
  for (const role of ["anon", "authenticated"]) {
    await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`)
      .catch((err: { code?: string }) => { if (err.code !== "23505" && err.code !== "42710") throw err; });
  }
  dbName = `challenge_diff_${randomBytes(6).toString("hex")}`;
  await admin.query(`CREATE DATABASE "${dbName}"`);
  const url = new URL(DATABASE_URL); url.pathname = `/${dbName}`;
  pool = new pg.Pool({ connectionString: url.toString(), max: 4 });
  pool.on("error", () => undefined);
  db = drizzle(pool) as unknown as Db;
  const journal = JSON.parse(readFileSync(join(BACKEND, "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
  await runInTx(pool, journal.entries.flatMap((e) => sqlFile(`drizzle/${e.tag}.sql`)));
  await runInTx(pool, sqlFile("drizzle-proposed/0011_gameplay_holdings.sql"));
});

after(async () => {
  if (!DATABASE_URL) return;
  await pool.end();
  admin.on("error", () => undefined);
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.end();
});

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rollback extends Error {}
/** Run fn in a transaction that is rolled back; returns what fn returned. */
async function dry<T>(fn: (tx: Parameters<Parameters<Db["transaction"]>[0]>[0]) => Promise<T>): Promise<T> {
  let out!: T;
  await db.transaction(async (tx) => { out = await fn(tx); throw new Rollback(); }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
  return out;
}

const SNAP = `SELECT unit::text AS unit, walker_id, first_day, holding_rules_version AS hv, (extract(epoch FROM opened_received_at) * 1000)::float8 AS opened_ms, xmin::text AS xmin
  FROM gameplay_unit_challenges ORDER BY unit, walker_id`;
type Snap = { unit: string; walker_id: string; first_day: number; hv: number; opened_ms: number; xmin: string };
const content = (s: Snap[]) => s.map(({ xmin: _x, ...rest }) => rest);

test("the default stays the live delete-and-insert; a bad mode is refused", () => {
  assert.equal(DEFAULT_CHALLENGE_WRITE_MODE, "delete-insert");
  assert.throws(() => new GameplayService({ db: {} as Db, rules: RULES, challengeWrites: "blind" as unknown as ChallengeWriteMode }), /challengeWrites/);
  assert.doesNotThrow(() => new GameplayService({ db: {} as Db, rules: RULES }));
  assert.doesNotThrow(() => new GameplayService({ db: {} as Db, rules: RULES, challengeWrites: "diff" }));
});

test("randomized batches: diff and delete-insert leave identical tables, across rules-version, first_day and receipt-time changes; unchanged kept rows are not rewritten", { skip: SKIP }, async () => {
  const U = 40, W = 30, H = 6;
  await pool.query(`INSERT INTO users (id) SELECT unnest($1::text[])`, [[...Array.from({ length: H }, (_, i) => `h${i}`), ...Array.from({ length: W }, (_, i) => `w${i}`)]]);
  await pool.query(`INSERT INTO gameplay_units (unit, holder_id, strength, as_of_day, holding_rules_version)
    SELECT ${UNIT_BASE}::bigint + n, 'h' || (n % ${H}), 50, 1000, 1001 FROM generate_series(0, ${U - 1}) AS n`);
  const rng = mulberry32(20261028);
  let hv = 1001;
  const stats = { batches: 0, versionChanges: 0, dayChanges: 0, receiptChanges: 0, kept: 0, keptUntouched: 0, keptRewritten: 0, closed: 0, opened: 0 };

  for (let b = 0; b < 120; b++) {
    if (rng() < 0.25) hv += 1; // a new rules version: every kept row's stamp must move with it
    const start = Math.floor(rng() * (U - 12)), count = 3 + Math.floor(rng() * 9);
    const units = Array.from({ length: count }, (_, i) => unitId(start + i));
    // The caller's invariant: the touched units are locked and already carry the batch's rules version.
    await pool.query(`UPDATE gameplay_units SET holding_rules_version = $2, version = version + 1 WHERE unit = ANY($1::bigint[])`, [units, hv]);
    const before = (await pool.query(SNAP)).rows as Snap[];
    const current = before.filter((r) => units.includes(r.unit));
    const open: OpenChallenge[] = [];
    const rule = (n: number, w: string) => ({ n, w });
    const seen = new Set<string>();
    for (const c of current) {
      if (rng() < 0.3) { stats.closed++; continue; } // closed
      let day = c.first_day, openedMs = Number(c.opened_ms);
      if (rng() < 0.15) { day = c.first_day === 100 ? 90 + Math.floor(rng() * 9) : 100; stats.dayChanges++; }
      if (rng() < 0.1) { openedMs += 60_000; stats.receiptChanges++; }
      open.push({ unit: c.unit, walkerId: c.walker_id, day, openedMs });
      seen.add(`${c.unit}/${c.walker_id}`);
    }
    for (const unit of units) {
      if (rng() < 0.45) {
        const r = rule(0, `w${Math.floor(rng() * W)}`);
        if (seen.has(`${unit}/${r.w}`)) continue;
        seen.add(`${unit}/${r.w}`);
        open.push({ unit, walkerId: r.w, day: 95 + Math.floor(rng() * 6), openedMs: 1_700_000_000_000 + b * 1000 + Math.floor(rng() * 1000) });
        stats.opened++;
      }
    }
    const versionChanged = current.some((c) => c.hv !== hv);
    if (versionChanged) stats.versionChanges++;

    const viaDiff = await dry(async (tx) => { await writeChallenges(tx, "diff", units, open, hv); return (await tx.execute(sql.raw(SNAP))).rows as Snap[]; });
    const viaDelIns = await dry(async (tx) => { await writeChallenges(tx, "delete-insert", units, open, hv); return (await tx.execute(sql.raw(SNAP))).rows as Snap[]; });
    assert.deepEqual(content(viaDiff), content(viaDelIns), `batch ${b}: tables differ`);
    // Every kept row carries the batch's version.
    assert.ok(viaDiff.filter((r) => units.includes(r.unit)).every((r) => r.hv === hv), `batch ${b}: a kept row kept a stale rules version`);

    // Unchanged kept rows keep their tuple (same xmin); changed ones are rewritten.
    const keptKeys = new Map(open.map((o) => [`${o.unit}/${o.walkerId}`, o]));
    for (const row of viaDiff) {
      const old = before.find((x) => x.unit === row.unit && x.walker_id === row.walker_id);
      if (!old || !keptKeys.has(`${row.unit}/${row.walker_id}`)) continue;
      const o = keptKeys.get(`${row.unit}/${row.walker_id}`)!;
      const changed = old.first_day !== o.day || old.hv !== hv || Math.abs(Number(old.opened_ms) - o.openedMs) > 0.5;
      stats.kept++;
      if (changed) { stats.keptRewritten++; assert.notEqual(row.xmin, old.xmin, `batch ${b}: a changed row was not written`); }
      else { stats.keptUntouched++; assert.equal(row.xmin, old.xmin, `batch ${b}: an unchanged row was rewritten`); }
    }
    // Rows of untouched units are never written by either mode.
    for (const row of viaDiff.filter((r) => !units.includes(r.unit))) assert.equal(row.xmin, before.find((x) => x.unit === row.unit && x.walker_id === row.walker_id)!.xmin);

    await db.transaction((tx) => writeChallenges(tx, "delete-insert", units, open, hv)); // the live path advances the state
    stats.batches++;
  }
  assert.ok(stats.versionChanges >= 10 && stats.dayChanges >= 10 && stats.receiptChanges >= 5 && stats.keptUntouched >= 100 && stats.closed >= 50 && stats.opened >= 100, JSON.stringify(stats));
  console.log(`# challengeDiff randomized: ${JSON.stringify(stats)}`);
});

test("a kept row with equal first_day and receipt time but an old rules version is restamped (a first_day-only comparison would leave it stale)", { skip: SKIP }, async () => {
  const unit = unitId(1000);
  await pool.query(`INSERT INTO gameplay_units (unit, holder_id, strength, as_of_day, holding_rules_version) VALUES ($1, 'h0', 50, 1000, 1001)`, [unit]);
  await pool.query(`INSERT INTO gameplay_unit_challenges (unit, walker_id, first_day, holding_rules_version, opened_received_at) VALUES ($1, 'w1', 99, 1001, '2026-10-01T10:00:00Z')`, [unit]);
  await pool.query(`UPDATE gameplay_units SET holding_rules_version = 1002 WHERE unit = $1`, [unit]);
  const open: OpenChallenge[] = [{ unit, walkerId: "w1", day: 99, openedMs: Date.parse("2026-10-01T10:00:00Z") }];
  await db.transaction((tx) => writeChallenges(tx, "diff", [unit], open, 1002));
  const row = (await pool.query(`SELECT first_day, holding_rules_version AS hv FROM gameplay_unit_challenges WHERE unit = $1`, [unit])).rows[0];
  assert.deepEqual(row, { first_day: 99, hv: 1002 });
});

test("diff mode with nothing left open closes every row of the touched units and leaves other units alone", { skip: SKIP }, async () => {
  const a = unitId(1001), b = unitId(1002);
  await pool.query(`INSERT INTO gameplay_units (unit, holder_id, strength, as_of_day, holding_rules_version) VALUES ($1, 'h0', 50, 1000, 1002), ($2, 'h0', 50, 1000, 1002)`, [a, b]);
  await pool.query(`INSERT INTO gameplay_unit_challenges (unit, walker_id, first_day, holding_rules_version, opened_received_at) VALUES ($1, 'w1', 99, 1002, now()), ($2, 'w2', 99, 1002, now())`, [a, b]);
  await db.transaction((tx) => writeChallenges(tx, "diff", [a], [], 1002));
  const left = (await pool.query(`SELECT unit::text FROM gameplay_unit_challenges WHERE unit IN ($1, $2)`, [a, b])).rows.map((r) => r.unit);
  assert.deepEqual(left, [b]);
});
