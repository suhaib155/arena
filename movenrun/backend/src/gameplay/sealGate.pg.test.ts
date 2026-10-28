/**
 * V3 rule 3 against real PostgreSQL: nothing is claimed until sealed. A
 * verified session creates or changes a holding only when the movement
 * pipeline's own seal (the shared sealing engine, run by the server on the
 * fixes it accepted) says the route closed, under a sealing rules version
 * the gameplay rules list. Everything else is refused whole, writes nothing,
 * and leaves the route and its verification as they were.
 *
 * Routes go through the real pipeline (verification, sealing, the stored
 * summary and, for 1002, the stored path) wherever the case is a route; the
 * forged and stale rows are written directly, as only a direct database
 * write could. Synthetic geometry only. Skipped, loudly, without
 * MOVENRUN_TEST_DATABASE_URL.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cellsForObservations } from "@movenrun/shared/h3";
import { GpsService } from "../services/gps.service.js";
import { DrizzleMovementVerificationRepository } from "../movement/repositories/drizzle/store.js";
import { MovementVerificationService } from "../movement/services/movementVerification.service.js";
import { sessionPathFor, territorySealFor, toValidatable } from "../movement/http/productionRouter.js";
import type { MovementObservation, ObservedPoint } from "../movement/domain/types.js";
import { VERIFIED_STEPS_V1 } from "./path.js";
import { ENCLOSED_LOOP_V1 } from "./sealLoop.js";
import { fixesOf, poly } from "./pathFixtures.js";
import { DAY_MS, PILOT_PROPOSAL, SIM_PILOT_2_PROPOSAL, type GameplayRules } from "./rules.js";
import { GameplayError, GameplayService } from "./service.js";
import { SEALED_LOOP, SEAL_COLUMNS, sealLiteral, sessionFor, type SealColumns } from "./sealFixtures.js";
import { createTestDb, type TestDb } from "./pgTestDb.js";

const DATABASE_URL = process.env.MOVENRUN_TEST_DATABASE_URL;
const SKIP = DATABASE_URL ? false : "MOVENRUN_TEST_DATABASE_URL is not set — the seal gate on PostgreSQL was NOT verified";

const D = Math.floor(Date.UTC(2026, 9, 1) / DAY_MS);
const at = (day: number, hour: number) => day * DAY_MS + Math.round(hour * 3_600_000);
const A9: GameplayRules = { ...PILOT_PROPOSAL, holding: { ...PILOT_PROPOSAL.holding }, seasonOneStartDay: D };
const P2: GameplayRules = { ...SIM_PILOT_2_PROPOSAL, holding: { ...SIM_PILOT_2_PROPOSAL.holding }, seasonOneStartDay: D + 200 };
type XY = [number, number];

let a9db: TestDb;
let p2db: TestDb;
let clock = at(D, 12);
let a9: GameplayService;
let p2: GameplayService;

before(async () => {
  if (!DATABASE_URL) return;
  a9db = await createTestDb(DATABASE_URL, "seal_gate_1001", { gameplay: true });
  p2db = await createTestDb(DATABASE_URL, "seal_gate_1002", { gameplay: true });
  a9 = new GameplayService({ db: a9db.db, rules: A9, now: () => clock });
  p2 = new GameplayService({ db: p2db.db, rules: P2, now: () => clock });
});
after(async () => {
  if (!DATABASE_URL) return;
  await a9db.drop();
  await p2db.drop();
});

const gps = new GpsService();
let ids = 0;
function pipeline(t: TestDb, withPath: boolean) {
  return new MovementVerificationService({
    repository: new DrizzleMovementVerificationRepository(t.db),
    generateId: () => `seal-${++ids}`,
    now: () => clock,
    detectAnomalies: (o) => gps.validateRoute(toValidatable(o) as never),
    calculateDistance: (points: ObservedPoint[]) => gps.calculateDistance(points as never),
    traversedHexIds: (points: ObservedPoint[]) => cellsForObservations(points.map((p) => ({ latitude: p.lat, longitude: p.lng }))),
    ...(withPath ? { sessionPath: sessionPathFor(VERIFIED_STEPS_V1) } : {}),
    // Both rule sets name sealing v2, so the pipeline computes the territory seal as production would.
    territorySeal: territorySealFor(ENCLOSED_LOOP_V1),
  });
}

/**
 * A walk at about 1.4 m/s (a fix every 10 s, 14 m apart, accuracy 5 m) along
 * each polyline in turn, in metres from a synthetic origin. Between polylines
 * the phone saw nothing for five minutes; with `pause` the player paused.
 */
function route(parts: XY[][], endMs: number, opts: { pause?: boolean; metadata?: boolean; jumpMs?: number } = {}): MovementObservation {
  const origin = { latitude: 51.52, longitude: -0.1 };
  let points: ObservedPoint[] = [];
  const pauses: { startedAt: number; endedAt: number }[] = [];
  for (const part of parts) {
    const fixes = fixesOf(poly(part, 14), origin, 10_000);
    const gap = points.length === 0 ? 0 : points[points.length - 1]!.timestamp + (opts.jumpMs ?? 300_000) - fixes[0]!.timestamp;
    const next = fixes.map((f) => ({ lat: f.lat, lng: f.lng, accuracy: 5, timestamp: f.timestamp + gap }));
    if (points.length > 0 && opts.pause) pauses.push({ startedAt: points[points.length - 1]!.timestamp + 1_000, endedAt: next[0]!.timestamp - 1_000 });
    points = points.concat(next);
  }
  const shift = endMs - points[points.length - 1]!.timestamp;
  points = points.map((p) => ({ ...p, timestamp: p.timestamp + shift }));
  const shiftedPauses = pauses.map((p) => ({ startedAt: p.startedAt + shift, endedAt: p.endedAt + shift }));
  const session = opts.metadata === false ? undefined : { ...sessionFor(points), pauses: shiftedPauses };
  return { startTime: points[0]!.timestamp, endTime: points[points.length - 1]!.timestamp, points, ...(session ? { session } : {}) };
}

/**
 * Submit through the pipeline, then re-date the row's receipt time to the
 * test clock (the database stamps the real clock, weeks after this synthetic
 * day; the receipt trigger is bypassed for this test only).
 */
async function submit(t: TestDb, userId: string, sid: string, obs: MovementObservation, withPath = false) {
  await t.pool.query("INSERT INTO users (id) VALUES ($1) ON CONFLICT DO NOTHING", [userId]);
  const { record } = await pipeline(t, withPath).submit({ userId, clientSessionId: sid, observation: obs });
  await t.pool.query("ALTER TABLE movement_verifications DISABLE TRIGGER gameplay_movement_receipt_immutable");
  await t.pool.query("UPDATE movement_verifications SET created_at = (to_timestamp($2::float8 / 1000) AT TIME ZONE current_setting('TimeZone')) WHERE id = $1", [record.id, clock]);
  await t.pool.query("ALTER TABLE movement_verifications ENABLE TRIGGER gameplay_movement_receipt_immutable");
  return record;
}

async function code(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (err) {
    return err instanceof GameplayError ? err.code : (err as { code?: string }).code;
  }
}

/** Every gameplay row a session could have written for this walker. */
async function territoryOf(t: TestDb, userId: string) {
  const q = async (s: string) => Number((await t.pool.query(s, [userId])).rows[0].n);
  return {
    held: await q("SELECT count(*)::int AS n FROM gameplay_units WHERE holder_id = $1"),
    pushes: await q("SELECT count(*)::int AS n FROM gameplay_push_events e JOIN gameplay_players p ON p.player_no = e.walker_no WHERE p.user_id = $1"),
    receipts: await q("SELECT count(*)::int AS n FROM gameplay_applied_sessions WHERE user_id = $1"),
    counters: await q("SELECT count(*)::int AS n FROM gameplay_walker_days d JOIN gameplay_players p ON p.player_no = d.walker_no WHERE p.user_id = $1"),
  };
}
const NOTHING = { held: 0, pushes: 0, receipts: 0, counters: 0 };

const SQUARE: XY[] = [[0, 0], [600, 0], [600, 600], [0, 600], [0, 0]];

test("an honest closed loop claims; the same walker's open route afterwards claims nothing and stays a verified route", { skip: SKIP }, async () => {
  const loop = await submit(a9db, "w-honest", "loop", route([SQUARE], at(D, 10)));
  assert.equal(loop.status, "verified");
  assert.equal(loop.sealed, true);
  const r = await a9.applySession("w-honest", "loop");
  assert.ok(r.outcomes.claimed > 0);
  const before = await territoryOf(a9db, "w-honest");

  const open = await submit(a9db, "w-honest", "open", route([[[0, 0], [600, 0], [600, 600], [1200, 600]]], at(D, 11)));
  assert.equal(open.status, "verified");
  assert.equal(open.sealed, false, "evaluated, did not close");
  assert.equal(await code(a9.applySession("w-honest", "open")), "session_not_sealed");
  assert.deepEqual(await territoryOf(a9db, "w-honest"), before, "no partial write");
  const row = (await a9db.pool.query("SELECT status, distance_meters FROM movement_verifications WHERE client_session_id = 'open'")).rows[0];
  assert.equal(row.status, "verified", "the route and its verification stand");
  assert.ok(Number(row.distance_meters) > 1000);
});

test("near miss: finishing 160 m from the start does not seal; 150 m seals the movement route (v1) but its 150 m closing edge was never walked, so only 40 m claims", { skip: SKIP }, async () => {
  const miss = await submit(a9db, "w-miss", "miss", route([[[0, 0], [600, 0], [600, 600], [0, 600], [0, 160]]], at(D, 10)));
  assert.equal(miss.sealed, false);
  assert.equal(await code(a9.applySession("w-miss", "miss")), "session_not_sealed");
  assert.deepEqual(await territoryOf(a9db, "w-miss"), NOTHING);
  const edge = await submit(a9db, "w-edge", "edge", route([[[0, 0], [600, 0], [600, 600], [0, 600], [0, 150]]], at(D, 10)));
  assert.equal(edge.sealed, true);
  assert.equal(await code(a9.applySession("w-edge", "edge")), "seal_not_enclosed");
  assert.deepEqual(await territoryOf(a9db, "w-edge"), NOTHING);
  const near = await submit(a9db, "w-near", "near", route([[[0, 0], [600, 0], [600, 600], [0, 600], [0, 40]]], at(D, 10)));
  assert.equal(near.sealed, true);
  assert.ok((await a9.applySession("w-near", "near")).applied > 0);
});

test("direction reversal: out and back to the start seals the movement route (v1, return to start) but encloses nothing; turning back short of it does not seal", { skip: SKIP }, async () => {
  const full = await submit(a9db, "w-rev", "rev-full", route([[[0, 0], [1500, 0], [0, 0]]], at(D, 9)));
  assert.equal(full.sealed, true);
  const short = await submit(a9db, "w-rev2", "rev-short", route([[[0, 0], [1500, 0], [700, 0]]], at(D, 9)));
  assert.equal(short.sealed, false);
  assert.equal(await code(a9.applySession("w-rev", "rev-full")), "seal_not_enclosed");
  assert.deepEqual(await territoryOf(a9db, "w-rev"), NOTHING);
  assert.equal(await code(a9.applySession("w-rev2", "rev-short")), "session_not_sealed");
  assert.deepEqual(await territoryOf(a9db, "w-rev2"), NOTHING);
});

test("an unobserved line across the route never seals it: walked across it closes, the same crossing over a pause or a gap does not", { skip: SKIP }, async () => {
  const walked = await submit(a9db, "w-cross", "walked", route([[[0, -300], [0, 300], [200, 300], [200, 5], [-310, 5]]], at(D, 9)));
  assert.equal(walked.sealed, true);
  assert.deepEqual(walked.sealMethods, ["self_cross"]);
  // The unobserved stretch is 260 m: past the engine's 200 m continuity break,
  // so without a pause it is not evidence either. (A shorter silent gap with no
  // pause is treated as walked by the sealing rules, version 1, but never by
  // the territory seal: see the sealing v2 test below.)
  const parts: XY[][] = [[[0, -300], [0, 300], [200, 300], [200, 5], [130, 5]], [[-130, 5], [-310, 5]]];
  const paused = await submit(a9db, "w-gap1", "paused", route(parts, at(D, 9), { pause: true }));
  const gap = await submit(a9db, "w-gap2", "gap", route(parts, at(D, 9)));
  for (const [r, w, sid] of [[paused, "w-gap1", "paused"], [gap, "w-gap2", "gap"]] as const) {
    assert.equal(r.status, "verified");
    assert.equal(r.sealed, false, sid);
    assert.equal(await code(a9.applySession(w, sid)), "session_not_sealed");
    assert.deepEqual(await territoryOf(a9db, w), NOTHING);
  }
});

test("teleporting: a loop closed by an impossible jump is not believed, so it is neither sealed nor able to claim", { skip: SKIP }, async () => {
  const jump = await submit(a9db, "w-tele", "tele", route([[[0, 0], [600, 0], [600, 600], [0, 600]], [[0, 100], [0, 0]]], at(D, 9), { jumpMs: 10_000 }));
  // 500 m in ten seconds after 600 m of walking: the anomaly check refuses the route before sealing runs.
  assert.equal(jump.status, "rejected");
  assert.equal(jump.sealed, null);
  assert.equal(await code(a9.applySession("w-tele", "tele")), "session_not_verified");
  assert.deepEqual(await territoryOf(a9db, "w-tele"), NOTHING);
});

test("sealing v2: out-and-back, parallel sidewalks, a small knot and a gap under 200 m seal the movement route (v1) but claim no land", { skip: SKIP }, async () => {
  const loopholes: [string, MovementObservation][] = [
    // One street, there and back to the door.
    ["one-street", route([[[0, 0], [1200, 0], [0, 0]]], at(D, 9))],
    // Down one sidewalk and back up the other, 15 m apart.
    ["sidewalks", route([[[0, 0], [800, 0], [800, 15], [0, 15], [0, 0]]], at(D, 9))],
    // A 1 km straight walk with a 20 m knot in the middle (a self-crossing).
    ["knot", route([[[0, 0], [500, 0], [520, 15], [510, -10], [495, 10], [1000, 0]]], at(D, 9))],
    // A 190 x 400 m "loop" whose top side is a 190 m jump nobody walked (20 s, no pause).
    ["gap", route([[[0, 0], [0, 400]], [[190, 400], [190, 0], [0, 0]]], at(D, 9), { jumpMs: 20_000 })],
  ];
  for (const [sid, obs] of loopholes) {
    const r = await submit(a9db, `w-v2-${sid}`, sid, obs);
    assert.equal(r.status, "verified", `${sid}: ${r.rejectionReasons.join("; ")}`);
    assert.equal(r.sealed, true, `${sid}: the movement engine (rules version 1) still calls it sealed`);
    assert.ok(Number(r.distanceMeters) > 0, `${sid}: still a verified movement session with distance`);
    assert.equal(await code(a9.applySession(`w-v2-${sid}`, sid)), "seal_not_enclosed", sid);
    assert.deepEqual(await territoryOf(a9db, `w-v2-${sid}`), NOTHING, sid);
  }
  // The same walker's honest block claims.
  await submit(a9db, "w-v2-one-street", "block", route([[[0, 0], [150, 0], [150, 100], [0, 100], [0, 0]]], at(D, 10)));
  assert.ok((await a9.applySession("w-v2-one-street", "block")).applied > 0);
});

test("missing, stale, inconsistent or forged seals fail closed", { skip: SKIP }, async () => {
  // A legacy submission without session metadata: the engine never ran.
  const legacy = await submit(a9db, "w-legacy", "legacy", route([SQUARE], at(D, 9), { metadata: false }));
  assert.equal(legacy.sealed, null);
  assert.equal(await code(a9.applySession("w-legacy", "legacy")), "seal_missing");
  // Rows only a direct database write could produce.
  const forged = async (userId: string, sid: string, c: SealColumns) => {
    await a9db.pool.query("INSERT INTO users (id) VALUES ($1) ON CONFLICT DO NOTHING", [userId]);
    await a9db.pool.query(
      `INSERT INTO movement_verifications (id, user_id, client_session_id, status, distance_meters, duration_seconds, traversed_hex_ids, start_time, end_time, created_at, ${SEAL_COLUMNS})
       VALUES ($1, $2, $3, 'verified', 3000, 1800, $4, $5, $6, (to_timestamp($7::float8 / 1000) AT TIME ZONE current_setting('TimeZone')), ${sealLiteral(c)})`,
      [`mv-${sid}`, userId, sid, [legacy.traversedHexIds[0]!], at(D, 9) - 1_800_000, at(D, 9), clock]);
    return a9.applySession(userId, sid);
  };
  const cases: [string, SealColumns, string][] = [
    ["stale", { ...SEALED_LOOP, rules_version: 2 }, "seal_rules_version_unsupported"],
    ["no-version", { ...SEALED_LOOP, rules_version: null }, "seal_missing"],
    ["no-events", { ...SEALED_LOOP, seal_event_count: 0 }, "seal_inconsistent"],
    ["no-methods", { ...SEALED_LOOP, seal_methods: [] }, "seal_inconsistent"],
    ["bad-method", { ...SEALED_LOOP, seal_methods: ["admin_seal"] }, "seal_inconsistent"],
    ["false-with-events", { ...SEALED_LOOP, sealed: false }, "seal_inconsistent"],
    // Sealing v2: the territory seal is the server's, computed at verification.
    ["no-territory", { ...SEALED_LOOP, territory_seal_version: null, territory_sealed: null, territory_seal_reason: null }, "territory_seal_missing"],
    ["territory-v2", { ...SEALED_LOOP, territory_seal_version: 2 }, "territory_seal_version_unsupported"],
    ["not-enclosed", { ...SEALED_LOOP, territory_sealed: false, territory_seal_reason: "loop_too_thin" }, "seal_not_enclosed"],
    ["territory-without-v1", { ...SEALED_LOOP, sealed: false, seal_methods: [], seal_event_count: 0 }, "session_not_sealed"],
  ];
  for (const [name, c, expected] of cases) {
    assert.equal(await code(forged(`w-${name}`, name, c)), expected, name);
    assert.deepEqual(await territoryOf(a9db, `w-${name}`), NOTHING, name);
  }
});

test("concurrent retries: an unsealed session refused five times at once writes nothing; a sealed one applies exactly once", { skip: SKIP }, async () => {
  await submit(a9db, "w-race", "race-open", route([[[0, 0], [800, 0], [800, 300]]], at(D, 9)));
  await submit(a9db, "w-race", "race-loop", route([SQUARE], at(D, 11)));
  const refused = await Promise.allSettled([1, 2, 3, 4, 5].map(() => a9.applySession("w-race", "race-open")));
  assert.deepEqual(refused.map((r) => (r.status === "rejected" ? (r.reason as GameplayError).code : "ok")), Array(5).fill("session_not_sealed"));
  assert.deepEqual(await territoryOf(a9db, "w-race"), NOTHING);
  const applied = await Promise.all([1, 2, 3, 4, 5].map(() => a9.applySession("w-race", "race-loop")));
  assert.equal(applied.filter((r) => !r.replayed).length, 1);
  assert.equal((await territoryOf(a9db, "w-race")).receipts, 1);
});

test("coarse and fine units: under 1002 (resolution 10 path) the same gate holds as under 1001 (resolution 8 cells)", { skip: SKIP }, async () => {
  clock = at(D + 200, 12);
  const loop = await submit(p2db, "f-loop", "loop", route([SQUARE], at(D + 200, 10)), true);
  const open = await submit(p2db, "f-open", "open", route([[[0, 0], [600, 0], [600, 600], [1200, 600]]], at(D + 200, 10)), true);
  assert.equal(loop.sealed, true);
  assert.equal(open.sealed, false);
  const r = await p2.applySession("f-loop", "loop");
  assert.ok(r.outcomes.claimed > 0);
  const units = Number((await p2db.pool.query("SELECT count(*)::int AS n FROM gameplay_units WHERE holder_id = 'f-loop'")).rows[0].n);
  assert.ok(units > loop.traversedHexIds.length, "resolution 10 path units outnumber the resolution 8 cells");
  assert.equal(await code(p2.applySession("f-open", "open")), "session_not_sealed");
  assert.deepEqual(await territoryOf(p2db, "f-open"), NOTHING);
  clock = at(D, 12);
});
