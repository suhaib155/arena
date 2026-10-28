/**
 * Rule set 1002's pilot-candidate fixes against real PostgreSQL 16:
 *
 * - the canonical resolution 10 path, derived by the real movement pipeline
 *   from verified fixes and stored with the verification, is what 1002
 *   pushes (the resolution 8 mismatch), while with gameplay off the pipeline
 *   touches no gameplay table at all;
 * - the take budget in walk order, through the service;
 * - the challenge's 20-hour second-push gap by server receipt, including a
 *   device clock that is ahead;
 * - more than 25 parallel submissions: one walker on several devices with
 *   retries, many challengers on one unit, and two rule sets racing to pin
 *   one season (mid-season change fails closed);
 * - per-holder zone partitions at day close, the toll's stepped-only crossed
 *   cells, and nothing about another walker in the read routes;
 * - erasure removes the stored paths.
 *
 * CODE TESTED LOCALLY. Skipped without MOVENRUN_TEST_DATABASE_URL; each run
 * creates and drops its own databases.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cellToChildren, getResolution, gridDisk, latLngToCell } from "h3-js";
import { cellsForObservations } from "@movenrun/shared/h3";
import { createDrizzleAccountDeletionStore } from "../identity/accountDeletion.js";
import { GpsService } from "../services/gps.service.js";
import { DrizzleMovementVerificationRepository } from "../movement/repositories/drizzle/store.js";
import { MovementVerificationService } from "../movement/services/movementVerification.service.js";
import { sessionPathFor, territorySealFor, toValidatable } from "../movement/http/productionRouter.js";
import { ENCLOSED_LOOP_V1 } from "./sealLoop.js";
import type { MovementObservation, ObservedPoint } from "../movement/domain/types.js";
import { cellToInt8, deriveSessionPath, int8ToCell, VERIFIED_STEPS_V1 } from "./path.js";
import { fixesOf, poly, ROUTE_FIXTURES } from "./pathFixtures.js";
import { DAY_MS, PILOT_PROPOSAL, SIM_PILOT_2_PROPOSAL, type GameplayRules } from "./rules.js";
import { GameplayError, GameplayService } from "./service.js";
import { SEALED_LOOP, SEAL_COLUMNS, sealLiteral, sessionFor } from "./sealFixtures.js";
import { createTestDb, type TestDb } from "./pgTestDb.js";

const DATABASE_URL = process.env.MOVENRUN_TEST_DATABASE_URL;
const SKIP = DATABASE_URL ? false : "MOVENRUN_TEST_DATABASE_URL is not set — rule set 1002 on PostgreSQL was NOT verified";

const D = Math.floor(Date.UTC(2026, 9, 1) / DAY_MS);
const H = 3_600_000;
const P2: GameplayRules = { ...SIM_PILOT_2_PROPOSAL, holding: { ...SIM_PILOT_2_PROPOSAL.holding }, seasonOneStartDay: D };
const A9: GameplayRules = { ...PILOT_PROPOSAL, holding: { ...PILOT_PROPOSAL.holding }, seasonOneStartDay: D };
const at = (day: number, hour: number) => day * DAY_MS + Math.round(hour * H);
const ZONES = gridDisk(latLngToCell(51.52, -0.1, 9), 7).sort();
const U = ZONES.flatMap((z) => cellToChildren(z, 10).sort());
/** Resolution 8 cells for rule set 1001, which pushes the pipeline's stored cells. */
const R8 = gridDisk(latLngToCell(51.52, -0.1, 8), 3).sort();
/** The ledger (revision 3: player numbers, bigint units, outcome codes) as user ids and outcome names. */
const LEDGER = `(SELECT e.seq, e.day, e.unit, e.source_no, w.user_id AS walker_id, ph.user_id AS previous_holder_id, nh.user_id AS new_holder_id,
    (ARRAY['claimed', 'reinforced', 'eroded', 'flipped'])[e.outcome] AS outcome, e.strength_before, e.strength_after
  FROM gameplay_push_events e JOIN gameplay_players w ON w.player_no = e.walker_no
  LEFT JOIN gameplay_players ph ON ph.player_no = e.previous_holder_no LEFT JOIN gameplay_players nh ON nh.player_no = e.new_holder_no) ledger`;
const DAYROWS = `(SELECT d.*, p.user_id AS walker_id FROM gameplay_walker_days d JOIN gameplay_players p ON p.player_no = d.walker_no) dayrows`;

let t: TestDb;
let clock = at(D, 9);
let p2: GameplayService;
let a9: GameplayService;

before(async () => {
  if (!DATABASE_URL) return;
  t = await createTestDb(DATABASE_URL, "rules_g1002", { gameplay: true });
  p2 = new GameplayService({ db: t.db, rules: P2, now: () => clock });
  a9 = new GameplayService({ db: t.db, rules: A9, now: () => clock });
});
after(async () => {
  if (DATABASE_URL) await t.drop();
});

const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;
async function user(id: string) {
  await t.pool.query("INSERT INTO users (id) VALUES ($1) ON CONFLICT DO NOTHING", [id]);
  return id;
}
async function code(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (err) {
    return err instanceof GameplayError ? err.code : (err as { code?: string }).code;
  }
}

/** A verified session with a stored 1002 path (walk order), received by the server at `receivedMs`. */
async function session(userId: string, sid: string, endMs: number, units: string[], opts: { receivedMs?: number; interpolated?: boolean[]; path?: boolean } = {}) {
  const id = `mv-${sid}`;
  await t.pool.query(
    `INSERT INTO movement_verifications (id, user_id, client_session_id, status, distance_meters, duration_seconds, traversed_hex_ids, start_time, end_time, created_at, ${SEAL_COLUMNS})
     VALUES ($1, $2, $3, 'verified', 3000, 1800, $4, $5, $6, (to_timestamp($7::float8 / 1000) AT TIME ZONE current_setting('TimeZone')), ${sealLiteral(SEALED_LOOP)})`,
    [id, userId, sid, [], endMs - 1_800_000, endMs, opts.receivedMs ?? clock]);
  if (opts.path !== false) {
    await t.pool.query(
      `INSERT INTO gameplay_session_paths (movement_verification_id, path_version, resolution, unit_ids, interpolated, skipped_segments, truncated)
       VALUES ($1, 1, 10, $2::bigint[], $3::varbit, 0, false)`,
      [id, units.map(cellToInt8), (opts.interpolated ?? units.map(() => false)).map((f) => (f ? "1" : "0")).join("")]);
  }
  return id;
}
const walk = async (svc: GameplayService, userId: string, sid: string, endMs: number, units: string[], opts?: Parameters<typeof session>[4]) => {
  await session(userId, sid, endMs, units, opts);
  return svc.applySession(userId, sid);
};
const unitRow = async (u: string) => (await q("SELECT holder_id, strength FROM gameplay_units WHERE unit = $1", [cellToInt8(u)]))[0];

/* ── the resolution mismatch, through the real pipeline ─────────────────── */

const gps = new GpsService();
function pipeline(withPath: boolean, db = t.db, ids = { n: 0 }) {
  return new MovementVerificationService({
    repository: new DrizzleMovementVerificationRepository(db),
    generateId: () => `pipe-${withPath ? "p" : "x"}-${++ids.n}`,
    now: () => clock,
    detectAnomalies: (o) => gps.validateRoute(toValidatable(o) as never),
    calculateDistance: (points: ObservedPoint[]) => gps.calculateDistance(points as never),
    traversedHexIds: (points: ObservedPoint[]) => cellsForObservations(points.map((p) => ({ latitude: p.lat, longitude: p.lng }))),
    ...(withPath ? { sessionPath: sessionPathFor(VERIFIED_STEPS_V1) } : {}),
    // Gameplay on: both rule sets name sealing v2, so the territory seal is computed at verification, as in production.
    ...(withPath ? { territorySeal: territorySealFor(ENCLOSED_LOOP_V1) } : {}),
  });
}
/** A real-looking verified walk: a route fixture moved to `origin`, a fix every 10 s at 1.4 m/s, accuracy 5 m. */
function observation(fixture: number, endMs: number, origin = { latitude: 51.52, longitude: -0.1 }): MovementObservation {
  const xy = poly(ROUTE_FIXTURES[fixture]!.vertices, 14);
  const fixes = fixesOf(xy, origin, 10_000);
  const shift = endMs - fixes[fixes.length - 1]!.timestamp;
  const points = fixes.map((f) => ({ lat: f.lat, lng: f.lng, accuracy: 5, timestamp: f.timestamp + shift }));
  // With session metadata, as the app sends it, so the pipeline runs the real sealing engine.
  return { startTime: points[0]!.timestamp, endTime: points[points.length - 1]!.timestamp, points, session: sessionFor(points) };
}

/**
 * The pipeline's row carries the database's real receipt time, weeks after
 * this synthetic day closed; re-date it to the test clock (bypassing, for
 * these tests only, the trigger that otherwise keeps it immutable).
 */
async function redate(id: string): Promise<void> {
  await t.pool.query("ALTER TABLE movement_verifications DISABLE TRIGGER gameplay_movement_receipt_immutable");
  await t.pool.query("UPDATE movement_verifications SET created_at = (to_timestamp($2::float8 / 1000) AT TIME ZONE current_setting('TimeZone')) WHERE id = $1", [id, clock]);
  await t.pool.query("ALTER TABLE movement_verifications ENABLE TRIGGER gameplay_movement_receipt_immutable");
}

test("the movement pipeline stores the resolution 10 path of verified fixes; 1002 pushes exactly it, in walk order", { skip: SKIP }, async () => {
  clock = at(D, 12);
  const ana = await user("ana");
  const obs = observation(0, at(D, 11));
  const { record } = await pipeline(true).submit({ userId: ana, clientSessionId: "pipe-1", observation: obs });
  assert.equal(record.status, "verified");
  await redate(record.id);
  for (const c of record.traversedHexIds) assert.equal(getResolution(c), 8, "the pipeline's own column is unchanged");
  const [row] = await q("SELECT path_version, resolution, unit_ids::text[] AS ids, interpolated::text AS bits, truncated, pg_column_size(unit_ids) AS bytes FROM gameplay_session_paths WHERE movement_verification_id = $1", [record.id]);
  const expected = deriveSessionPath(obs.points, [], VERIFIED_STEPS_V1);
  assert.deepEqual(row.ids, expected.units.map(cellToInt8));
  assert.equal(row.bits.length, expected.units.length);
  const r = await p2.applySession(ana, "pipe-1");
  assert.equal(r.outcomes.claimed, expected.units.length);
  const seqOrder = (await q(`SELECT ledger.unit::text AS unit FROM ${LEDGER} JOIN gameplay_applied_sessions s ON s.source_no = ledger.source_no
    WHERE s.movement_verification_id = $1 ORDER BY ledger.seq`, [record.id])).map((x) => int8ToCell(x.unit));
  assert.deepEqual(seqOrder, expected.units, "stored in walk order");
  if (process.env.MOVENRUN_PRINT_MEASUREMENTS) {
    const text = (await q("SELECT pg_column_size($1::text[]) AS b", [expected.units]))[0].b;
    console.log(`session path: ${expected.units.length} units, unit_ids ${row.bytes} bytes as bigint[] vs ${text} as text[]`);
  }
  // A session verified while gameplay was off has no territory seal and no path: 1002 refuses it rather than guessing
  // (the seal gate comes first; session_path_unavailable is covered by sessions written without a path).
  await redate((await pipeline(false).submit({ userId: ana, clientSessionId: "pipe-2", observation: observation(1, at(D, 11.5)) })).record.id);
  assert.equal(await code(p2.applySession(ana, "pipe-2")), "territory_seal_missing");
  // 1001 still pushes the stored resolution 8 cells, as before (different day, a season of its own is not needed: unit ids differ).
});

test("gameplay off: the pipeline works on a database without 0011 and stores nothing for gameplay", { skip: SKIP }, async () => {
  const bare = await createTestDb(DATABASE_URL!, "rules_bare", { gameplay: false });
  try {
    await bare.pool.query("INSERT INTO users (id) VALUES ('solo')");
    const out = await pipeline(false, bare.db).submit({ userId: "solo", clientSessionId: "s", observation: observation(1, at(D, 11)) });
    assert.equal(out.record.status, "verified");
    const tables = (await bare.pool.query("SELECT count(*)::int AS n FROM pg_tables WHERE tablename LIKE 'gameplay_%'")).rows[0].n;
    assert.equal(tables, 0);
    // With the gameplay dependencies on and no 0011, the verification fails whole: nothing half-written.
    await assert.rejects(pipeline(true, bare.db).submit({ userId: "solo", clientSessionId: "s2", observation: observation(1, at(D, 11.2)) }));
    assert.equal((await bare.pool.query("SELECT count(*)::int AS n FROM movement_verifications WHERE client_session_id = 's2'")).rows[0].n, 0);
  } finally {
    await bare.drop();
  }
});

/* ── walk order through the service ─────────────────────────────────────── */

test("the budget is applied in walk order: of twenty units walked in reverse id order, the first thirteen walked are taken", { skip: SKIP }, async () => {
  clock = at(D, 13);
  const units = U.slice(100, 120);
  await walk(p2, "ana", "ana-own", at(D, 8), units);
  const ben = await user("ben");
  const walked = [...units].reverse();
  const r = await walk(p2, ben, "ben-walk", at(D, 12), walked);
  assert.deepEqual([r.outcomes.eroded, r.outcomes.refused_take_budget], [13, 7]);
  const taken = (await q(`SELECT unit::text AS unit FROM ${LEDGER} WHERE walker_id = $1 AND outcome = 'eroded' ORDER BY seq`, [ben])).map((x) => int8ToCell(x.unit));
  assert.deepEqual(taken, walked.slice(0, 13));
});

/* ── the day boundary ───────────────────────────────────────────────────── */

test("midnight straddle by server receipt: 23:50 then 00:20 cannot flip; back 20 hours after the first upload, it flips", { skip: SKIP }, async () => {
  const cal = await user("cal");
  const u = U[100]!; // Ana's, challenged by Ben today at 12:00 (eroded); Cal challenges it too.
  clock = at(D, 23.84);
  assert.equal((await walk(p2, cal, "cal-2350", at(D, 23.83), [u])).outcomes.eroded, 1);
  clock = at(D + 1, 0.34);
  const early = await walk(p2, cal, "cal-0020", at(D + 1, 0.33), [u]);
  assert.deepEqual([early.day, early.outcomes.flipped, early.outcomes.eroded], [D + 1, 0, 1]);
  assert.equal((await unitRow(u)).holder_id, "ana");
  assert.deepEqual((await q("SELECT first_day FROM gameplay_unit_challenges WHERE unit = $1 AND walker_id = $2", [cellToInt8(u), cal])).map((x) => Number(x.first_day)), [D]);
  // Device clock ahead: a walk the device dates tomorrow is refused by server time, whatever its receipt.
  clock = at(D + 1, 19);
  assert.equal(await code(walk(p2, cal, "cal-ahead", at(D + 2, 0.2), [u])), "session_in_future");
  // Day D+2, 20 hours and more after the server first received Cal's challenge: it completes.
  clock = at(D + 2, 10);
  assert.equal((await walk(p2, cal, "cal-d2", at(D + 2, 9.5), [u])).outcomes.flipped, 1);
  assert.equal((await unitRow(u)).holder_id, cal);
});

/* ── concurrency ────────────────────────────────────────────────────────── */

test("one walker on three devices: 30 overlapping sessions, each submitted twice at once, spend exactly 13 takes and push each unit once", { skip: SKIP }, async () => {
  clock = at(D + 2, 12);
  const pool15 = U.slice(200, 215);
  await walk(p2, "ana", "ana-200", at(D + 2, 8), pool15);
  const dev = await user("dev");
  const sids: string[] = [];
  for (let i = 0; i < 30; i++) {
    const sid = `dev-${["phone", "watch", "tablet"][i % 3]}-${i}`;
    sids.push(sid);
    await session(dev, sid, at(D + 2, 11), [pool15[i % 15]!, pool15[(i + 4) % 15]!, pool15[(i + 9) % 15]!]);
  }
  const runs = await Promise.allSettled([...sids, ...sids].map((s) => p2.applySession(dev, s)));
  const failed = runs.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  for (const f of failed) assert.equal((f.reason as GameplayError).code, "concurrent_push_retry");
  // Idempotent retries of anything that had to be retried.
  for (const s of sids) await p2.applySession(dev, s);
  const perUnit = await q(`SELECT unit, count(*)::int AS n FROM ${LEDGER} WHERE walker_id = $1 AND outcome IN ('eroded','flipped') GROUP BY unit`, [dev]);
  assert.ok(perUnit.every((r) => r.n === 1), "one push per walker, unit and day");
  assert.equal(perUnit.length, 13);
  assert.equal((await q(`SELECT takes_used FROM ${DAYROWS} WHERE walker_id = $1 AND day = $2`, [dev, D + 2]))[0].takes_used, 13);
  assert.equal((await q("SELECT count(*)::int AS n FROM gameplay_applied_sessions WHERE user_id = $1", [dev]))[0].n, 30);
  if (process.env.MOVENRUN_PRINT_MEASUREMENTS) console.log(`devices: ${failed.length} of 60 concurrent applies asked to retry`);
});

test("30 challengers on one unit at once, then all 30 back 22 hours later at once: one chain, one flip, the rest start new challenges", { skip: SKIP }, async () => {
  clock = at(D + 2, 13);
  const u = U[300]!;
  await walk(p2, "ana", "ana-300", at(D + 2, 8), [u]);
  const ws: string[] = [];
  for (let i = 0; i < 30; i++) {
    ws.push(await user(`ch-${String(i).padStart(2, "0")}`));
    await session(ws[i]!, `ch-${i}-a`, at(D + 2, 12.5), [u]);
  }
  const first = await Promise.all(ws.map((w, i) => p2.applySession(w, `ch-${i}-a`)));
  assert.equal(first.reduce((a, r) => a + r.outcomes.eroded, 0), 30);
  clock = at(D + 3, 11);
  for (let i = 0; i < 30; i++) await session(ws[i]!, `ch-${i}-b`, at(D + 3, 10.5), [u]);
  const second = await Promise.all(ws.map((w, i) => p2.applySession(w, `ch-${i}-b`)));
  assert.equal(second.reduce((a, r) => a + r.outcomes.flipped, 0), 1);
  assert.equal(second.reduce((a, r) => a + r.outcomes.eroded, 0), 29);
  const winner = (await unitRow(u)).holder_id as string;
  assert.ok(ws.includes(winner));
  const open = await q("SELECT walker_id, first_day FROM gameplay_unit_challenges WHERE unit = $1", [cellToInt8(u)]);
  assert.equal(open.length, 29);
  assert.ok(open.every((c) => Number(c.first_day) === D + 3 && c.walker_id !== winner));
  const chain = await q(`SELECT previous_holder_id, new_holder_id, strength_before, strength_after, day FROM ${LEDGER} WHERE unit = $1 ORDER BY seq`, [cellToInt8(u)]);
  for (let i = 1; i < chain.length; i++) {
    assert.equal(chain[i].previous_holder_id, chain[i - 1].new_holder_id);
    if (chain[i].day === chain[i - 1].day) assert.equal(chain[i].strength_before, chain[i - 1].strength_after);
  }
});

test("mid-season rule change fails closed: 1001 cannot touch a 1002 season, and two rule sets racing to pin a new season leave one", { skip: SKIP }, async () => {
  clock = at(D + 3, 12);
  assert.equal(await code(walk(a9, "ana", "a9-mid", at(D + 3, 11), [], { path: false })), "rules_version_mismatch", "a pinned day");
  clock = at(D + 4, 12);
  await session("ana", "a9-new-day", at(D + 4, 11), [], { path: false });
  await t.pool.query("UPDATE movement_verifications SET traversed_hex_ids = $1 WHERE client_session_id = 'a9-new-day'", [[R8[0]!]]);
  assert.equal(await code(a9.applySession("ana", "a9-new-day")), "season_rules_changed", "a new day of the 1002 season");
  // Season 2 starts on D+90. 20 pushes under each rule set race on its first two days (the first in its grace).
  const S2 = D + 90;
  clock = at(S2 + 1, 1);
  const racers: string[] = [];
  for (let i = 0; i < 20; i++) {
    const w = await user(`racer-${i}`);
    racers.push(w);
    const end = i % 2 === 0 ? at(S2, 21) : at(S2 + 1, 0.5);
    await session(w, `race-p2-${i}`, end, [U[400 + i]!]);
    await t.pool.query(
      `INSERT INTO movement_verifications (id, user_id, client_session_id, status, distance_meters, duration_seconds, traversed_hex_ids, start_time, end_time, created_at, ${SEAL_COLUMNS})
       VALUES ($1, $2, $3, 'verified', 3000, 1800, $4, $5, $6, (to_timestamp($7::float8 / 1000) AT TIME ZONE current_setting('TimeZone')), ${sealLiteral(SEALED_LOOP)})`,
      [`mv-race-a9-${i}`, w, `race-a9-${i}`, [R8[i + 1]!], end - 1_800_000, end, clock]);
  }
  const settled = await Promise.allSettled(racers.flatMap((w, i) => [p2.applySession(w, `race-p2-${i}`), a9.applySession(w, `race-a9-${i}`)]));
  const codes = settled.map((s) => (s.status === "fulfilled" ? "ok" : (s.reason as GameplayError).code));
  const pins = await q("SELECT DISTINCT holding_rules_version AS v FROM gameplay_day_rules WHERE season = 2");
  assert.equal(pins.length, 1, "one rule set for the season");
  const winner = Number(pins[0].v);
  settled.forEach((s, i) => {
    const mine = i % 2 === 0 ? 1002 : 1001;
    if (mine === winner) assert.equal(codes[i], "ok", `job ${i}`);
    else assert.ok(["season_rules_changed", "rules_version_mismatch"].includes(codes[i]!), `job ${i}: ${codes[i]}`);
  });
});

/* ── day close: partitions, the toll, private reads, erasure ────────────── */

test("day close: a zone shared by two holders splits per holder (levels differ, the day still settles); the toll reads stepped units only; reads leak nothing", { skip: SKIP }, async () => {
  const S = D + 10;
  clock = at(S, 12);
  const kids = cellToChildren(ZONES[20]!, 10).sort();
  const eve = await user("eve");
  const fay = await user("fay");
  await walk(p2, eve, "eve-s", at(S, 8), [kids[0]!, kids[1]!, kids[2]!]);
  await walk(p2, fay, "fay-s", at(S, 9), [kids[3]!]);
  // One of Eve's units at level 2 (no level purchase exists; set by hand): the shared model alone would refuse the day.
  await t.pool.query("UPDATE gameplay_units SET level = 2 WHERE unit = $1", [cellToInt8(kids[0]!)]);
  await t.pool.query("UPDATE gameplay_unit_day_states SET level = 2 WHERE unit = $1 AND day = $2", [cellToInt8(kids[0]!), S]);
  // Fay's unit is deeded: crossing it costs a toll only when stepped on, never when interpolated.
  await t.pool.query("UPDATE gameplay_units SET deeded = true WHERE unit = $1", [cellToInt8(kids[3]!)]);
  await t.pool.query("UPDATE gameplay_unit_day_states SET deeded = true WHERE unit = $1 AND day = $2", [cellToInt8(kids[3]!), S]);
  const gus = await user("gus");
  const hal = await user("hal");
  await walk(p2, gus, "gus-s", at(S, 10), [kids[4]!, kids[3]!, kids[5]!], { interpolated: [false, true, false] });
  await walk(p2, hal, "hal-s", at(S, 11), [kids[6]!, kids[3]!], { interpolated: [false, false] });
  await t.pool.query("INSERT INTO gameplay_unit_districts (unit, district_id, districts_version) SELECT unit, 'district-a', 'test-v1' FROM gameplay_units ON CONFLICT DO NOTHING");
  clock = at(S + 1, 3);
  const day = await p2.settleDay(S);
  const header = (await q("SELECT status, problems FROM gameplay_day_settlements WHERE day = $1", [S]))[0];
  assert.equal(day.status, "settled", JSON.stringify(header.problems));
  const lines = new Map((await q("SELECT player_id, zones_held, toll_paid_micro, toll_received_micro FROM gameplay_credit_lines WHERE day = $1", [S])).map((r) => [r.player_id, r]));
  assert.equal(lines.get(eve).zones_held, 1, "Eve holds her partition once");
  assert.equal(lines.get(fay).zones_held, 1, "Fay holds hers");
  assert.equal(Number(lines.get(gus).toll_paid_micro), 0, "interpolated crossing: no toll");
  assert.ok(Number(lines.get(hal).toll_paid_micro) > 0, "stepped crossing: toll");
  assert.equal(Number(lines.get(fay).toll_received_micro), Number(lines.get(hal).toll_paid_micro));
  // Reads: counts only, never a unit, a zone or another walker.
  const mine = JSON.stringify([await p2.myHoldings(eve), await p2.myCredits(eve, 1), await p2.leaderboard(eve, 1, "player_credits")]);
  for (const other of [fay, gus, hal]) assert.ok(!mine.includes(other), other);
  assert.doesNotMatch(mine, /\b8[0-9a-f]{14}\b/, "no H3 index");
  // Erasure removes the person's stored paths with their sessions.
  await createDrizzleAccountDeletionStore(t.db).erase(hal);
  assert.equal((await q("SELECT count(*)::int AS n FROM gameplay_session_paths WHERE movement_verification_id = 'mv-hal-s'"))[0].n, 0);
});
