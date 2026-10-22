/**
 * Server-authority invariants that need SQL (B4), on a disposable local
 * PostgreSQL database built by the backend's own harness (pgTestDb.ts): the
 * committed chain 0000-0010 plus the proposed 0011 revision 3.
 *
 * Skipped cleanly when MOVENRUN_TEST_DATABASE_URL is unset, so the default
 * suite stays green. Never point it at a hosted database: each run creates
 * and drops its own database on the server the URL names.
 *
 * Tests named "documents defect" are EXPECTED to pass: they assert that the
 * problematic behaviour occurs. See SERVER_AUTHORITY_INVARIANTS.md.
 *
 * Season 1 (days D to D+89) runs rule set 1002; season 2 (from D+90) runs 1001,
 * because a season keeps one rule set.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cellToChildren, gridDisk, latLngToCell } from "h3-js";
import { cellsForObservations } from "@movenrun/shared/h3";
import { SESSION_RULES_VERSION } from "@movenrun/shared/session";
import type { PushEvent } from "@movenrun/shared/holdingLedger";
import { GpsService } from "../../../backend/src/services/gps.service.ts";
import { DrizzleMovementVerificationRepository } from "../../../backend/src/movement/repositories/drizzle/store.ts";
import { MovementVerificationService } from "../../../backend/src/movement/services/movementVerification.service.ts";
import { sessionPathFor, toValidatable } from "../../../backend/src/movement/http/productionRouter.ts";
import type { MovementObservation, ObservedPoint } from "../../../backend/src/movement/domain/types.ts";
import { cellToInt8, deriveSessionPath, int8ToCell, VERIFIED_STEPS_V1 } from "../../../backend/src/gameplay/path.ts";
import { DAY_MS, PILOT_PROPOSAL, SIM_PILOT_2_PROPOSAL, type GameplayRules } from "../../../backend/src/gameplay/rules.ts";
import { GameplayError, GameplayService } from "../../../backend/src/gameplay/service.ts";
import { createTestDb, type TestDb } from "../../../backend/src/gameplay/pgTestDb.ts";
import { ll, proofDigest, type ProofLedgerRow } from "./helpers.ts";

const DATABASE_URL = process.env.MOVENRUN_TEST_DATABASE_URL;
const SKIP = DATABASE_URL ? false : "MOVENRUN_TEST_DATABASE_URL is not set: the SQL invariants were NOT verified";

const D = Math.floor(Date.UTC(2026, 9, 1) / DAY_MS);
const H = 3_600_000;
const at = (day: number, hour: number) => day * DAY_MS + Math.round(hour * H);
const P2: GameplayRules = { ...SIM_PILOT_2_PROPOSAL, holding: { ...SIM_PILOT_2_PROPOSAL.holding }, seasonOneStartDay: D };
const A9: GameplayRules = { ...PILOT_PROPOSAL, holding: { ...PILOT_PROPOSAL.holding }, seasonOneStartDay: D };
const U = gridDisk(latLngToCell(51.53, -0.12, 9), 4).sort().flatMap((z) => cellToChildren(z, 10).sort());
const R8 = gridDisk(latLngToCell(51.53, -0.12, 8), 13).sort();

let t: TestDb;
let clock = at(D, 9);
let p2: GameplayService;
let a9: GameplayService;

before(async () => {
  if (!DATABASE_URL) return;
  t = await createTestDb(DATABASE_URL, "b4_invariants", { gameplay: true });
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

/** A verified movement row (as the pipeline writes it) received by the server at `receivedMs`, with an optional 1002 path. */
async function session(userId: string, sid: string, endMs: number, opts: {
  units?: string[]; interpolated?: boolean[]; res8?: string[]; receivedMs?: number; status?: string;
} = {}) {
  const id = `mv-${sid}`;
  await t.pool.query(
    `INSERT INTO movement_verifications (id, user_id, client_session_id, status, distance_meters, duration_seconds, traversed_hex_ids, start_time, end_time, created_at)
     VALUES ($1, $2, $3, $4, 3000, 1800, $5, $6, $7, (to_timestamp($8::float8 / 1000) AT TIME ZONE current_setting('TimeZone')))`,
    [id, userId, sid, opts.status ?? "verified", opts.res8 ?? [], endMs - 1_800_000, endMs, opts.receivedMs ?? clock]);
  if (opts.units) {
    await t.pool.query(
      `INSERT INTO gameplay_session_paths (movement_verification_id, path_version, resolution, unit_ids, interpolated, skipped_segments, truncated)
       VALUES ($1, 1, $4, $2::bigint[], $3::varbit, 0, false)`,
      [id, opts.units.map(cellToInt8), (opts.interpolated ?? opts.units.map(() => false)).map((f) => (f ? "1" : "0")).join(""),
       opts.units.length > 0 ? Number(BigInt(`0x${opts.units[0]}`) >> 52n & 15n) : 10]);
  }
  return id;
}
const walk = async (svc: GameplayService, userId: string, sid: string, endMs: number, opts: Parameters<typeof session>[3]) => {
  await session(userId, sid, endMs, { receivedMs: clock, ...opts });
  return svc.applySession(userId, sid);
};
/** Retry a lost concurrent race (409 concurrent_push_retry) the way a client would. */
async function applyRetrying(svc: GameplayService, userId: string, sid: string) {
  for (let i = 0; ; i++) {
    try {
      return await svc.applySession(userId, sid);
    } catch (err) {
      if (!(err instanceof GameplayError && err.code === "concurrent_push_retry") || i > 8) throw err;
    }
  }
}
const unitRow = async (u: string) => (await q("SELECT holder_id, strength, ground FROM gameplay_units WHERE unit = $1", [cellToInt8(u)]))[0];

/** Row counts of every gameplay table, and the walker-day counters: the whole gameplay state. */
async function snapshot(): Promise<Record<string, string>> {
  const tables = (await q(`SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'gameplay\\_%' AND table_type = 'BASE TABLE' ORDER BY table_name`)).map((r) => r.table_name as string);
  const out: Record<string, string> = {};
  for (const name of tables) out[name] = String((await q(`SELECT count(*)::text AS n FROM "${name}"`))[0].n);
  const c = (await q("SELECT coalesce(sum(units_used),0)::text AS u, coalesce(sum(takes_used),0)::text AS k, coalesce(sum(refused_daily_limit),0)::text AS r FROM gameplay_walker_days"))[0];
  out.counters = `${c.u}/${c.k}/${c.r}`;
  out.units = String((await q("SELECT md5(coalesce(string_agg(unit::text || ':' || coalesce(holder_id,'') || ':' || strength, ',' ORDER BY unit), '')) AS h FROM gameplay_units"))[0].h);
  return out;
}

/* ── cross-account injection ──────────────────────────────────────────── */

test("cross-account session injection: another user's session id is not found, and its source key cannot carry a push", { skip: SKIP }, async () => {
  clock = at(D + 1, 12);
  const alice = await user("b4-alice");
  const bob = await user("b4-bob");
  const aliceMv = await session(alice, "alice-walk-0001", at(D + 1, 11), { units: [U[0]!, U[1]!] });
  assert.equal(await code(p2.applySession(bob, "alice-walk-0001")), "session_not_found");
  const forged: PushEvent[] = [{ eventId: `mv:${aliceMv}:${U[0]}`, unitId: U[0]!, walkerId: bob, push: { kind: "solid" }, day: D + 1 }];
  const before = await p2.applyPushes(forged);
  assert.deepEqual([before.applied, before.rejected, before.rejectedByReason.invalid_event], [0, 1, 1], "a session key that was never applied is refused");
  const mine = await p2.applySession(alice, "alice-walk-0001");
  assert.equal(mine.applied, 2);
  const afterApply = await p2.applyPushes(forged);
  assert.deepEqual([afterApply.applied, afterApply.skipped], [0, 1], "an applied session key is skipped whole");
  assert.equal((await q("SELECT count(*)::int AS n FROM gameplay_push_events e JOIN gameplay_players p ON p.player_no = e.walker_no WHERE p.user_id = $1", [bob]))[0].n, 0);
  assert.equal((await unitRow(U[0]!)).holder_id, alice);
});

/* ── interpolation, end to end ────────────────────────────────────────── */

const gps = new GpsService();
function pipeline() {
  let n = 0;
  return new MovementVerificationService({
    repository: new DrizzleMovementVerificationRepository(t.db),
    generateId: () => `b4-pipe-${++n}-${clock}`,
    now: () => clock,
    detectAnomalies: (o) => gps.validateRoute(toValidatable(o) as never),
    calculateDistance: (points: ObservedPoint[]) => gps.calculateDistance(points as never),
    traversedHexIds: (points: ObservedPoint[]) => cellsForObservations(points.map((p) => ({ latitude: p.lat, longitude: p.lng }))),
    sessionPath: sessionPathFor(VERIFIED_STEPS_V1),
  });
}

/** Ten fixes east along y = 0 to (40, 0), a 120 s gap to (190, 100), then ten fixes north: 1.4 m/s, accuracy 5 m. */
function gapWalk(endMs: number): MovementObservation {
  const xy: [number, number, number][] = [];
  for (let i = 0; i < 10; i++) xy.push([40 - 14 * (9 - i), 0, i * 10_000]);
  for (let i = 0; i < 10; i++) xy.push([190, 100 + 14 * i, 90_000 + 120_000 + i * 10_000]);
  const shift = endMs - xy[xy.length - 1]![2];
  const points = xy.map(([x, y, dt]) => ({ ...ll(x, y), accuracy: 5, timestamp: dt + shift }));
  const start = points[0]!.timestamp, end = points[points.length - 1]!.timestamp;
  return { startTime: start, endTime: end, points, session: { mode: "onFoot", rulesVersion: SESSION_RULES_VERSION, startedAt: start, finishedAt: end, pauses: [] } };
}

test("requires ratification: a real verified walk with a 120 s GPS gap is stored with interpolated units, and 1002 pushes them as solid, flipping weak ground", { skip: SKIP }, async () => {
  const obs = gapWalk(at(D + 34, 11));
  const expected = deriveSessionPath(obs.points, [], VERIFIED_STEPS_V1);
  const interp = expected.units.filter((_, i) => expected.interpolated[i]);
  assert.ok(interp.length >= 2);
  const weak = interp[0]!;
  // Carol stepped on `weak` 29 days earlier and never came back: 100 - 29 x 3 = 13 by day D+34.
  clock = at(D + 5, 12);
  const carol = await user("b4-carol");
  await walk(p2, carol, "carol-walk-0001", at(D + 5, 11), { units: [weak] });

  clock = at(D + 34, 12);
  const walker = await user("b4-walker");
  const { record } = await pipeline().submit({ userId: walker, clientSessionId: "gap-walk-0001", observation: obs });
  assert.equal(record.status, "verified", "the movement pipeline accepts the gap");
  const [row] = await q("SELECT unit_ids::text[] AS ids, interpolated::text AS bits FROM gameplay_session_paths WHERE movement_verification_id = $1", [record.id]);
  assert.deepEqual(row.ids, expected.units.map(cellToInt8));
  assert.equal(row.bits, expected.interpolated.map((f) => (f ? "1" : "0")).join(""));
  const r = await p2.applySession(walker, "gap-walk-0001");
  assert.equal(r.applied, expected.units.length, "every unit of the path is pushed, interpolated ones included");
  assert.equal(r.outcomes.flipped, 1);
  for (const u of interp) assert.deepEqual(await unitRow(u), { holder_id: walker, strength: u === weak ? 87 : 100, ground: "solid" });
});

/* ── idempotency: duplicate finalisation and two phones ───────────────── */

test("idempotency: one session finalised ten times at once applies once; two phones walking the same units push each once", { skip: SKIP }, async () => {
  const day = D + 50;
  clock = at(day, 8);
  const hana = await user("b4-hana");
  await walk(p2, hana, "hana-walk-0001", at(day, 7.5), { units: U.slice(10, 15) });
  clock = at(day, 12);
  const dan = await user("b4-dan");
  await session(dan, "dan-walk-0001", at(day, 11), { units: U.slice(10, 15) });
  const runs = await Promise.all(Array.from({ length: 10 }, () => applyRetrying(p2, dan, "dan-walk-0001")));
  assert.equal(runs.filter((r) => !r.replayed).length, 1);
  for (const r of runs) assert.equal(r.outcomes.eroded, 5);
  // Phone A and phone B upload two different sessions over the same five units at the same moment.
  await session(dan, "dan-phone-a01", at(day, 11.5), { units: U.slice(10, 15) });
  await session(dan, "dan-phone-b01", at(day, 11.5), { units: [...U.slice(10, 15)].reverse() });
  const phones = await Promise.all([applyRetrying(p2, dan, "dan-phone-a01"), applyRetrying(p2, dan, "dan-phone-b01")]);
  for (const r of phones) assert.equal(r.outcomes.refused_daily_limit, 5, "both phones are refused: the first session already pushed every unit today");
  const rows = await q(`SELECT e.unit::text AS unit, count(*)::int AS n FROM gameplay_push_events e JOIN gameplay_players p ON p.player_no = e.walker_no
    WHERE p.user_id = $1 AND e.day = $2 GROUP BY e.unit ORDER BY e.unit`, [dan, day]);
  assert.deepEqual(rows.map((r) => r.n), [1, 1, 1, 1, 1]);
  const [wd] = await q("SELECT d.takes_used, d.units_used, d.refused_daily_limit FROM gameplay_walker_days d JOIN gameplay_players p ON p.player_no = d.walker_no WHERE p.user_id = $1 AND d.day = $2", [dan, day]);
  assert.deepEqual([wd.takes_used, wd.units_used, wd.refused_daily_limit], [5, 15, 10], "takes spent once; every verified unit counted against the capacity budget");
});

/* ── once per walker, unit and day through the service ────────────────── */

test("once per day through the service: survives a challenge reset and a flip (1002), and a flip and take-back (1001)", { skip: SKIP }, async () => {
  const u = U[30]!;
  let day = D + 60;
  const holder = await user("b4-holder");
  const ch = await user("b4-challenger");
  let n = 0;
  const go = async (svc: GameplayService, w: string, hour: number, opts: Parameters<typeof session>[3]) => {
    clock = at(day, hour);
    const r = await walk(svc, w, `once-${++n}-${w}`, at(day, hour - 0.1), opts);
    return (Object.entries(r.outcomes).find(([, v]) => v > 0) ?? ["none"])[0];
  };
  assert.equal(await go(p2, holder, 8, { units: [u] }), "claimed");
  assert.equal(await go(p2, ch, 9, { units: [u] }), "eroded");
  assert.equal(await go(p2, holder, 10, { units: [u] }), "reinforced");
  assert.equal(await go(p2, ch, 11, { units: [u] }), "refused_daily_limit", "the holder's answer does not give back the challenger's push");
  day += 1;
  assert.equal(await go(p2, ch, 12, { units: [u] }), "eroded", "a new challenge: the old one was answered");
  day += 1;
  assert.equal(await go(p2, ch, 13, { units: [u] }), "flipped", "25 h by server receipt after the new challenge opened");
  assert.equal(await go(p2, holder, 14, { units: [u] }), "eroded");
  assert.equal(await go(p2, ch, 15, { units: [u] }), "reinforced");
  assert.equal(await go(p2, holder, 16, { units: [u] }), "refused_daily_limit");

  // 1001 in season 2: an immediate flip, the holder takes it straight back, and the taker is then refused.
  day = D + 95;
  const c8 = R8[0]!;
  assert.equal(await go(a9, holder, 8, { res8: [c8] }), "claimed");
  assert.equal(await go(a9, ch, 9, { res8: [c8] }), "flipped");
  assert.equal(await go(a9, holder, 10, { res8: [c8] }), "flipped");
  assert.equal(await go(a9, ch, 11, { res8: [c8] }), "refused_daily_limit");
});

/* ── settlement watermark ─────────────────────────────────────────────── */

test("documents defect: settlement credits a session the server received after the day's close, depending on when the maintenance run happens", { skip: SKIP }, async () => {
  const X = D + 70, Y = D + 71;
  const ana = await user("b4-ana");
  const ben = await user("b4-ben");
  clock = at(X, 10);
  await walk(p2, ana, "ana-x-0001", at(X, 9.5), { units: [U[40]!] });
  clock = at(Y, 10);
  await walk(p2, ana, "ana-y-0001", at(Y, 9.5), { units: [U[41]!] });

  // Settlement waits for the close watermark (PASS).
  clock = at(X + 1, 1.9);
  assert.equal(await code(p2.settleDay(X)), "day_not_closed");

  // Day X: Ben's session ended at 20:00 but reached the server at 03:00, after the close (00:00 + 2 h).
  clock = at(X + 1, 3);
  await session(ben, "ben-x-late-01", at(X, 20), { units: [U[42]!], receivedMs: clock });
  assert.equal(await code(p2.applySession(ben, "ben-x-late-01")), "day_closed", "its pushes are refused");
  const sx = await p2.settleDay(X);
  assert.equal(sx.status, "settled");
  const benX = await q("SELECT earned_micro::bigint AS e FROM gameplay_credit_lines WHERE day = $1 AND player_id = $2", [X, ben]);
  assert.equal(benX.length, 1, "DEFECT: the late session still earns credits for day X");
  assert.ok(Number(benX[0].e) > 0);

  // Day Y: the same late upload, but the maintenance run settled the day first: no credits, ever.
  clock = at(Y + 1, 3);
  assert.equal((await p2.settleDay(Y)).status, "settled");
  clock = at(Y + 1, 4);
  await session(ben, "ben-y-late-01", at(Y, 20), { units: [U[43]!], receivedMs: clock });
  assert.equal(await code(p2.applySession(ben, "ben-y-late-01")), "day_closed");
  assert.equal((await p2.settleDay(Y)).created, false);
  assert.equal((await q("SELECT 1 FROM gameplay_credit_lines WHERE day = $1 AND player_id = $2", [Y, ben])).length, 0);
});

/* ── proofs ───────────────────────────────────────────────────────────── */

test("proofs: the restated digest matches the stored one; ledger and credits are final, but the proof row itself can be rewritten", { skip: SKIP }, async () => {
  const X = D + 70; // settled by the previous test
  const ana = "b4-ana";
  const [p] = await q(`SELECT pr.player_no, encode(pr.events_sha256, 'hex') AS sha FROM gameplay_player_day_proofs pr
    JOIN gameplay_players pl ON pl.player_no = pr.player_no WHERE pl.user_id = $1 AND pr.day = $2`, [ana, X]);
  assert.ok(p, "a proof was written for the walker's day");
  const rows = await q(`SELECT source_no, unit::text AS unit, outcome, previous_holder_no, new_holder_no, strength_before, strength_after, shade_strength
    FROM gameplay_push_events WHERE day = $1 AND walker_no = $2 ORDER BY seq`, [X, p.player_no]) as ProofLedgerRow[];
  const [rf] = await q(`SELECT refused_deeded, refused_masked, refused_daily_limit, refused_take_budget, visit_units::text[] AS visit_units
    FROM gameplay_walker_days WHERE day = $1 AND walker_no = $2`, [X, p.player_no]);
  assert.equal(proofDigest(rows.map((r) => ({ ...r, outcome: Number(r.outcome) as 1 })), rf ? { ...rf, visit_units: rf.visit_units ?? [] } : null), p.sha);

  // The ledger and the credit lines refuse edits (PASS) ...
  assert.equal(await code(t.pool.query("UPDATE gameplay_push_events SET strength_after = 1 WHERE day = $1 AND walker_no = $2", [X, p.player_no])), "23001");
  assert.equal(await code(t.pool.query("UPDATE gameplay_credit_lines SET net_micro = net_micro + 1 WHERE day = $1", [X])), "23001");
  // ... the proof does not (LIMITATION): a table writer can make proof and archive agree.
  const upd = await t.pool.query("UPDATE gameplay_player_day_proofs SET events_sha256 = decode(repeat('00', 32), 'hex') WHERE day = $1 AND player_no = $2", [X, p.player_no]);
  assert.equal(upd.rowCount, 1);
});

/* ── refusals leave nothing behind ─────────────────────────────────────── */

test("a refusal leaves no half-state: nine refusal paths change no gameplay row, counter or unit", { skip: SKIP }, async () => {
  const day = D + 80;
  clock = at(day, 12);
  const ivy = await user("b4-ivy");
  // Pin the day and give it some state first, so refusals run against a live day.
  await walk(p2, ivy, "ivy-base-0001", at(day, 11), { units: [U[50]!] });
  const stop = new GameplayService({ db: t.db, rules: P2, now: () => clock, capacityGuard: async () => ({ level: "hard_stop", acceptPushes: false, pushBudgetFactor: 0, reasons: ["over_hard_stop"] }) });
  const broken = new GameplayService({ db: t.db, rules: P2, now: () => clock, capacityGuard: async () => { throw new Error("size unreadable"); } });
  const zone = latLngToCell(51.53, -0.12, 9);
  await session(ivy, "ivy-res9-0001", at(day, 11), { units: [zone] });
  await session(ivy, "ivy-nopath-01", at(day, 11));
  await session(ivy, "ivy-stop-0001", at(day, 11), { units: [U[51]!] });
  await session(ivy, "ivy-rejected1", at(day, 11), { units: [U[52]!], status: "rejected" });
  await session(ivy, "ivy-future-01", at(day + 1, 0.05), { units: [U[53]!] });
  await session(ivy, "ivy-closed-01", at(day - 2, 20), { units: [U[54]!] });
  await session(ivy, "ivy-a9-same01", at(day, 11), { res8: [R8[1]!] });
  await session(ivy, "ivy-a9-many01", at(D + 96, 11), { res8: R8.slice(0, 501) });
  const cases: [string, () => Promise<unknown>, string][] = [
    ["resolution 9 path", () => p2.applySession(ivy, "ivy-res9-0001"), "unit_resolution_mismatch"],
    ["no stored path", () => p2.applySession(ivy, "ivy-nopath-01"), "session_path_unavailable"],
    ["capacity hard stop", () => stop.applySession(ivy, "ivy-stop-0001"), "capacity_hard_stop"],
    ["capacity guard failing", () => broken.applySession(ivy, "ivy-stop-0001"), "capacity_hard_stop"],
    ["not verified", () => p2.applySession(ivy, "ivy-rejected1"), "session_not_verified"],
    ["device clock ahead", () => p2.applySession(ivy, "ivy-future-01"), "session_in_future"],
    ["day closed", () => p2.applySession(ivy, "ivy-closed-01"), "day_closed"],
    ["1001 on a 1002 season", () => a9.applySession(ivy, "ivy-a9-same01"), "season_rules_changed"],
  ];
  for (const [name, run, expected] of cases) {
    const before = await snapshot();
    assert.equal(await code(run()), expected, name);
    assert.deepEqual(await snapshot(), before, `${name}: nothing changed`);
  }
  clock = at(D + 96, 12);
  const before = await snapshot();
  assert.equal(await code(a9.applySession(ivy, "ivy-a9-many01")), "too_many_units");
  assert.deepEqual(await snapshot(), before, "too_many_units: nothing changed");
  // Each refused session can still be applied later, once: nothing was half-recorded as applied.
  assert.equal((await q("SELECT count(*)::int AS n FROM gameplay_applied_sessions a JOIN movement_verifications m ON m.id = a.movement_verification_id WHERE m.user_id = $1", [ivy]))[0].n, 1);
  clock = at(day, 13);
  const later = await p2.applySession(ivy, "ivy-stop-0001");
  assert.deepEqual([later.replayed, later.applied], [false, 1]);
  assert.equal(int8ToCell(cellToInt8(U[51]!)), U[51]);
});
