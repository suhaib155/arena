/**
 * Solid means physically stepped (V3 §4): under rule set 1002 only units
 * that contain an accepted fix push. Units inferred between fixes stay in the
 * stored path for display and analysis, but never claim, erode, take, defend,
 * spend the unit budget or count as a crossing. Through the real movement
 * pipeline on PostgreSQL; synthetic geometry only. Skipped, loudly, without
 * MOVENRUN_TEST_DATABASE_URL.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cellsForObservations } from "@movenrun/shared/h3";
import { GpsService } from "../services/gps.service.js";
import { DrizzleMovementVerificationRepository } from "../movement/repositories/drizzle/store.js";
import { MovementVerificationService } from "../movement/services/movementVerification.service.js";
import { sessionPathFor, territorySealFor, toValidatable } from "../movement/http/productionRouter.js";
import { ENCLOSED_LOOP_V1 } from "./sealLoop.js";
import type { MovementObservation, ObservedPoint } from "../movement/domain/types.js";
import { bitsToFlags, cellToInt8, int8ToCell, VERIFIED_STEPS_V1 } from "./path.js";
import { fixesOf, poly } from "./pathFixtures.js";
import { DAY_MS, SIM_PILOT_2_PROPOSAL, type GameplayRules } from "./rules.js";
import { GameplayService } from "./service.js";
import { SEALED_LOOP, SEAL_COLUMNS, sealLiteral, sessionFor } from "./sealFixtures.js";
import { createTestDb, type TestDb } from "./pgTestDb.js";

const DATABASE_URL = process.env.MOVENRUN_TEST_DATABASE_URL;
const SKIP = DATABASE_URL ? false : "MOVENRUN_TEST_DATABASE_URL is not set — inferred units on PostgreSQL were NOT verified";

const D = Math.floor(Date.UTC(2026, 9, 1) / DAY_MS);
const at = (day: number, hour: number) => day * DAY_MS + Math.round(hour * 3_600_000);
const P2: GameplayRules = { ...SIM_PILOT_2_PROPOSAL, holding: { ...SIM_PILOT_2_PROPOSAL.holding }, seasonOneStartDay: D };

let t: TestDb;
let clock = at(D, 12);
let p2: GameplayService;

before(async () => {
  if (!DATABASE_URL) return;
  t = await createTestDb(DATABASE_URL, "interp_1002", { gameplay: true });
  p2 = new GameplayService({ db: t.db, rules: P2, now: () => clock });
});
after(async () => {
  if (DATABASE_URL) await t.drop();
});

const gps = new GpsService();
let n = 0;
const pipeline = () => new MovementVerificationService({
  repository: new DrizzleMovementVerificationRepository(t.db),
  generateId: () => `interp-${++n}`,
  now: () => clock,
  detectAnomalies: (o) => gps.validateRoute(toValidatable(o) as never),
  calculateDistance: (points: ObservedPoint[]) => gps.calculateDistance(points as never),
  traversedHexIds: (points: ObservedPoint[]) => cellsForObservations(points.map((p) => ({ latitude: p.lat, longitude: p.lng }))),
  sessionPath: sessionPathFor(VERIFIED_STEPS_V1),
  territorySeal: territorySealFor(ENCLOSED_LOOP_V1, { resolution: VERIFIED_STEPS_V1.resolution, stepMeters: VERIFIED_STEPS_V1.stepMeters }),
});

/**
 * A walk at 1.4 m/s with accurate GPS: a closed 400 m square with a fix every
 * 14 m (the loop that seals, by crossing its own first side), then a sparse leg out with one fix every
 * `spacing` metres. The sparse steps are walked by the 1002 path rule (up to
 * 200 m), so they cross resolution 10 units no fix is in; sealing v2 treats
 * any step over 50 m as a gap no loop may cross, so only the dense square
 * seals.
 */
function sparseLoop(spacing: number, endMs: number, origin = { latitude: 51.52, longitude: -0.1 }): MovementObservation {
  // The square's last side runs on past the start and cuts its first side: a self-crossing seal.
  const dense = poly([[0, 0], [400, 0], [400, 400], [20, 400], [20, -40]], 14);
  const sparse = poly([[20, -40], [20, -1040]], spacing).slice(1);
  const times: number[] = [];
  let t = 0;
  dense.forEach((_, i) => { if (i > 0) t += 10_000; times.push(t); });
  sparse.forEach(() => { t += Math.round((spacing / 1.4) * 1000); times.push(t); });
  const fixes = fixesOf([...dense, ...sparse], origin, 1);
  const shift = endMs - times[times.length - 1]!;
  const points = fixes.map((f, i) => ({ lat: f.lat, lng: f.lng, accuracy: 5, timestamp: times[i]! + shift }));
  return { startTime: points[0]!.timestamp, endTime: points[points.length - 1]!.timestamp, points, session: sessionFor(points) };
}

async function submit(userId: string, sid: string, obs: MovementObservation) {
  await t.pool.query("INSERT INTO users (id) VALUES ($1) ON CONFLICT DO NOTHING", [userId]);
  const { record } = await pipeline().submit({ userId, clientSessionId: sid, observation: obs });
  // The database stamps its real clock; re-date the receipt to this synthetic day (trigger bypassed for this test only).
  await t.pool.query("ALTER TABLE movement_verifications DISABLE TRIGGER gameplay_movement_receipt_immutable");
  await t.pool.query("UPDATE movement_verifications SET created_at = (to_timestamp($2::float8 / 1000) AT TIME ZONE current_setting('TimeZone')) WHERE id = $1", [record.id, clock]);
  await t.pool.query("ALTER TABLE movement_verifications ENABLE TRIGGER gameplay_movement_receipt_immutable");
  const [path] = (await t.pool.query("SELECT unit_ids::text[] AS ids, interpolated::text AS bits FROM gameplay_session_paths WHERE movement_verification_id = $1", [record.id])).rows;
  const units = (path.ids as string[]).map(int8ToCell);
  const flags = bitsToFlags(path.bits, units.length);
  return { record, stepped: units.filter((_, i) => !flags[i]), inferred: units.filter((_, i) => flags[i]) };
}

test("sparse accurate GPS: the stored path keeps inferred units, but only stepped units push, spend budget or appear in the ledger", { skip: SKIP }, async () => {
  const { record, stepped, inferred } = await submit("ivy", "sparse", sparseLoop(120, at(D, 10)));
  assert.equal(record.status, "verified");
  assert.equal(record.sealed, true);
  assert.ok(inferred.length >= 3, `inferred ${inferred.length}, stepped ${stepped.length}`);
  // Sealing v2 claim scope: of the stepped units, only those on or inside the dense square claim; the sparse leg claims nothing.
  const claimCells = new Set(((await t.pool.query("SELECT territory_claim_units::text[] AS u FROM movement_verifications WHERE id = $1", [record.id])).rows[0].u as string[]).map(int8ToCell));
  const claimable = stepped.filter((u) => claimCells.has(u));
  assert.ok(claimable.length > 0 && claimable.length < stepped.length, `claimable ${claimable.length} of ${stepped.length} stepped`);
  const r = await p2.applySession("ivy", "sparse");
  assert.equal(r.applied, claimable.length);
  assert.equal(r.outcomes.claimed, claimable.length);
  const pushed = (await t.pool.query("SELECT unit::text AS unit FROM gameplay_push_events ORDER BY seq")).rows.map((x) => int8ToCell(x.unit));
  assert.deepEqual(pushed, claimable, "walk order, stepped and claimable units only");
  const used = (await t.pool.query("SELECT units_used FROM gameplay_walker_days d JOIN gameplay_players p ON p.player_no = d.walker_no WHERE p.user_id = 'ivy'")).rows[0];
  assert.equal(Number(used.units_used), claimable.length, "the unit budget counts physical, claimable steps only");
  const held = Number((await t.pool.query("SELECT count(*)::int AS n FROM gameplay_units WHERE holder_id = 'ivy' AND unit = ANY($1::bigint[])", [inferred.map(cellToInt8)])).rows[0].n);
  assert.equal(held, 0, "no inferred unit is held");
});

test("an inferred unit never erodes or takes a rival's ground", { skip: SKIP }, async () => {
  clock = at(D + 1, 12);
  const { stepped, inferred } = await submit("jon", "probe", sparseLoop(120, at(D + 1, 8), { latitude: 51.53, longitude: -0.12 }));
  const target = inferred.find((u) => !stepped.includes(u))!;
  // A rival already holds that unit, stepped on directly (a sealed session written as the pipeline would).
  await t.pool.query("INSERT INTO users (id) VALUES ('kim') ON CONFLICT DO NOTHING");
  await t.pool.query(
    `INSERT INTO movement_verifications (id, user_id, client_session_id, status, distance_meters, duration_seconds, traversed_hex_ids, start_time, end_time, created_at, ${SEAL_COLUMNS})
     VALUES ('mv-kim', 'kim', 'kim-1', 'verified', 3000, 1800, '{}', $1, $2, (to_timestamp($3::float8 / 1000) AT TIME ZONE current_setting('TimeZone')), ${sealLiteral(SEALED_LOOP, [target])})`,
    [at(D + 1, 7) - 1_800_000, at(D + 1, 7), clock]);
  await t.pool.query(`INSERT INTO gameplay_session_paths (movement_verification_id, path_version, resolution, unit_ids, interpolated, skipped_segments, truncated)
    VALUES ('mv-kim', 1, 10, $1::bigint[], B'0', 0, false)`, [[cellToInt8(target)]]);
  assert.equal((await p2.applySession("kim", "kim-1")).outcomes.claimed, 1);
  const before = (await t.pool.query("SELECT holder_id, strength FROM gameplay_units WHERE unit = $1", [cellToInt8(target)])).rows[0];
  const r = await p2.applySession("jon", "probe");
  assert.equal(r.outcomes.eroded + r.outcomes.flipped, 0);
  assert.deepEqual((await t.pool.query("SELECT holder_id, strength FROM gameplay_units WHERE unit = $1", [cellToInt8(target)])).rows[0], before);
});
