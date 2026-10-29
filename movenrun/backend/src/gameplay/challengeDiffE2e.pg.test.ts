/**
 * Challenge writes end to end on PostgreSQL 16, through the real HTTP route.
 *
 * The same scripted scenario runs twice, against two fresh databases: once with the
 * default delete-and-insert challenge writes and once with the diff mode. Every step goes
 * through POST /gameplay/sessions/:id/apply on a real listening server (rule set 1002, the
 * two-day challenge), and the logical state after each step must be identical in both modes:
 *
 *   push -> challenge state -> identical repeat push (no row rewritten in diff mode, proven by
 *   xmin, ctid and a row-level trigger counter) -> changed push -> first_day change ->
 *   rules-version mismatch refused -> forced failure mid-write rolls back -> concurrent
 *   pushes by one walker on one day -> day settlement.
 *
 * How the diff mode is enabled: only by constructing GameplayService with
 * `challengeWrites: "diff"` (service.ts, GameplayServiceDeps). createProductionGameplay
 * (wiring.ts) does not pass it and no environment variable reads it, so production is
 * always delete-and-insert today.
 *
 * Rules-version note: a challenge row exists only on held ground, and held ground written
 * under another rules version is refused (409 unit_rules_version_mismatch) before any write,
 * so the HTTP route cannot produce a kept row with a stale version. The version restamp of
 * diff mode is covered at the writeChallenges level by challengeDiff.pg.test.ts; here the
 * route is shown to fail closed and leave the rows untouched.
 *
 * Skipped, loudly, without MOVENRUN_TEST_DATABASE_URL. Synthetic ids and cells only.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import express from "express";
import { cellToChildren, gridDisk, latLngToCell } from "h3-js";
import { IdentityError } from "../identity/domain/errors.js";
import { cellToInt8 } from "./path.js";
import { DAY_MS, SIM_PILOT_2_PROPOSAL, type GameplayRules } from "./rules.js";
import { GameplayService, type ChallengeWriteMode } from "./service.js";
import { SEALED_LOOP, SEAL_COLUMNS, sealLiteral } from "./sealFixtures.js";
import { createGameplayRouter } from "./router.js";
import { createTestDb, type TestDb } from "./pgTestDb.js";

const DATABASE_URL = process.env.MOVENRUN_TEST_DATABASE_URL;
const SKIP = DATABASE_URL ? false : "MOVENRUN_TEST_DATABASE_URL is not set — the challenge write path over HTTP was NOT verified";

const D = Math.floor(Date.UTC(2026, 9, 1) / DAY_MS);
const H = 3_600_000;
const RULES: GameplayRules = { ...SIM_PILOT_2_PROPOSAL, holding: { ...SIM_PILOT_2_PROPOSAL.holding }, seasonOneStartDay: D };
const at = (day: number, hour: number) => day * DAY_MS + Math.round(hour * H);
const ZONES = gridDisk(latLngToCell(51.52, -0.1, 9), 7).sort();
const U = ZONES.flatMap((z) => cellToChildren(z, 10).sort());
const ROUNDS = 6;

const MODES: ChallengeWriteMode[] = ["delete-insert", "diff"];
type Dump = Record<string, unknown>;
const dumps = new Map<ChallengeWriteMode, { step: string; dump: Dump }[]>();
const evidence = new Map<ChallengeWriteMode, Record<string, unknown>>();

interface Harness {
  t: TestDb;
  server: Server;
  clock: { now: number };
  api: (user: string, sid: string) => Promise<{ status: number; body: any }>;
  q: (text: string, params?: unknown[]) => Promise<any[]>;
  user: (id: string) => Promise<string>;
  session: (userId: string, sid: string, endMs: number, units: string[]) => Promise<void>;
  service: GameplayService;
}

async function harness(mode: ChallengeWriteMode): Promise<Harness> {
  const t = await createTestDb(DATABASE_URL!, `diff_e2e_${mode === "diff" ? "d" : "i"}`, { gameplay: true });
  const clock = { now: at(D, 9) };
  const service = new GameplayService({ db: t.db, rules: RULES, now: () => clock.now, challengeWrites: mode });
  const app = express();
  app.use(express.json({ limit: "8kb" }));
  app.use("/gameplay", createGameplayRouter({
    service,
    verifyBearer: async (token) => {
      if (token.startsWith("tok-")) return { userId: token.slice(4) };
      throw new IdentityError("session_invalid");
    },
  }));
  // A failure the route does not map is a 500 with no body: keep the test output free of stack traces.
  app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(500).json({ error: "internal" }); });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/gameplay`;
  const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;
  return {
    t, server, clock, service, q,
    api: async (user, sid) => {
      const res = await fetch(`${base}/sessions/sid-${sid}/apply`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer tok-${user}` }, body: "{}" });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    user: async (id) => { await t.pool.query("INSERT INTO users (id) VALUES ($1) ON CONFLICT DO NOTHING", [id]); return id; },
    session: async (userId, sid, endMs, units) => {
      await t.pool.query(
        `INSERT INTO movement_verifications (id, user_id, client_session_id, status, distance_meters, duration_seconds, traversed_hex_ids, start_time, end_time, created_at, ${SEAL_COLUMNS})
         VALUES ($1, $2, $3, 'verified', 3000, 1800, $4, $5, $6, (to_timestamp($7::float8 / 1000) AT TIME ZONE current_setting('TimeZone')), ${sealLiteral(SEALED_LOOP, units)})`,
        [`mv-${sid}`, userId, `sid-${sid}`, [], endMs - 1_800_000, endMs, clock.now]);
      await t.pool.query(
        `INSERT INTO gameplay_session_paths (movement_verification_id, path_version, resolution, unit_ids, interpolated, skipped_segments, truncated)
         VALUES ($1, 1, 10, $2::bigint[], $3::varbit, 0, false)`,
        [`mv-${sid}`, units.map(cellToInt8), units.map(() => "0").join("")]);
    },
  };
}

/** The challenge table with physical identity: what a rewrite changes and a no-op leaves alone. */
const PHYS = `SELECT unit::text AS unit, walker_id, first_day, holding_rules_version AS hv, (extract(epoch FROM opened_received_at) * 1000)::float8 AS opened_ms, xmin::text AS xmin, ctid::text AS ctid
  FROM gameplay_unit_challenges ORDER BY unit, walker_id`;
const logical = (rows: any[]) => rows.map(({ xmin: _x, ctid: _c, ...rest }) => rest);

/** Everything an operator could compare between two modes: no timestamps of the wall clock, no sequence numbers. */
async function dumpState(h: Harness, orderFree = false): Promise<Dump> {
  const q = h.q;
  return {
    challenges: logical(await q(PHYS)),
    units: await q(`SELECT unit::text AS unit, holder_id, strength, ground, level, fortified, deeded, masked, as_of_day, holding_rules_version AS hv, version FROM gameplay_units ORDER BY unit`),
    // After the concurrent rounds the order two contenders ran in is the database's to choose, so the strengths
    // a push saw (not what it did) are left out of the comparison there, and so is the input digest of that day (it
    // hashes the ledger in ledger order); the day's books and credit lines are still compared in full.
    ledger: await q(`SELECT e.unit::text AS unit, e.day, w.user_id AS walker, ph.user_id AS prev, nh.user_id AS next,
        (ARRAY['claimed','reinforced','eroded','flipped'])[e.outcome] AS outcome${orderFree ? "" : ", e.strength_before, e.strength_after"}
      FROM gameplay_push_events e JOIN gameplay_players w ON w.player_no = e.walker_no
      LEFT JOIN gameplay_players ph ON ph.player_no = e.previous_holder_no LEFT JOIN gameplay_players nh ON nh.player_no = e.new_holder_no
      ORDER BY e.day, e.unit, w.user_id, e.outcome`),
    walkerDays: await q(`SELECT p.user_id AS walker, d.day, d.takes_used, d.units_used FROM gameplay_walker_days d JOIN gameplay_players p ON p.player_no = d.walker_no ORDER BY d.day, p.user_id`),
    applied: await q(`SELECT user_id, count(*)::int AS n FROM gameplay_applied_sessions GROUP BY user_id ORDER BY user_id`),
    settlements: await q(`SELECT day, season, status, ruleset, holding_rules_version, pool_micro::text, minted_micro::text, credited_micro::text, toll_paid_micro::text, toll_received_micro::text,
        burned_micro::text, returned_micro::text, players, ${orderFree ? `CASE WHEN day = ${D + 5} THEN NULL ELSE input_digest END` : "input_digest"} AS input_digest FROM gameplay_day_settlements ORDER BY day`),
    credits: await q(`SELECT day, player_id, earned_micro::text, toll_paid_micro::text, toll_received_micro::text, upkeep_taken_micro::text, net_micro::text FROM gameplay_credit_lines ORDER BY day, player_id`),
  };
}

/** Counts of row-level writes to the challenge table, from a trigger (committed work only: a rolled-back write leaves nothing). */
const writeCounts = async (h: Harness) => Object.fromEntries((await h.q(`SELECT op, count(*)::int AS n FROM e2e_challenge_writes GROUP BY op`)).map((r) => [r.op, r.n]));
const deadlocks = async (h: Harness) => Number((await h.q(`SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()`))[0].deadlocks);

async function install(h: Harness): Promise<void> {
  await h.t.pool.query(`
    CREATE TABLE e2e_challenge_writes (id bigserial PRIMARY KEY, op text NOT NULL, walker_id text NOT NULL, unit bigint NOT NULL);
    CREATE TABLE e2e_fail_flag (target text PRIMARY KEY);
    CREATE FUNCTION e2e_count_writes() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO e2e_challenge_writes (op, walker_id, unit) VALUES (TG_OP, coalesce(NEW.walker_id, OLD.walker_id), coalesce(NEW.unit, OLD.unit));
      RETURN NULL;
    END $$;
    CREATE TRIGGER e2e_count AFTER INSERT OR UPDATE OR DELETE ON gameplay_unit_challenges FOR EACH ROW EXECUTE FUNCTION e2e_count_writes();
    CREATE FUNCTION e2e_fail() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM e2e_fail_flag WHERE target = TG_ARGV[0]) THEN RAISE EXCEPTION 'e2e injected failure in %', TG_ARGV[0] USING ERRCODE = 'P0001'; END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER e2e_fail_challenges BEFORE INSERT OR UPDATE ON gameplay_unit_challenges FOR EACH ROW EXECUTE FUNCTION e2e_fail('challenges');
    CREATE TRIGGER e2e_fail_events BEFORE INSERT ON gameplay_push_events FOR EACH ROW EXECUTE FUNCTION e2e_fail('events');`);
}

async function scenario(mode: ChallengeWriteMode): Promise<void> {
  const h = await harness(mode);
  const steps: { step: string; dump: Dump }[] = [];
  const mark = async (step: string, orderFree = false) => { steps.push({ step, dump: await dumpState(h, orderFree) }); };
  const ev: Record<string, unknown> = {};
  try {
    await install(h);
    const deadlocks0 = await deadlocks(h);
    const [ana, ben, cal, dan] = await Promise.all(["ana", "ben", "cal", "dan"].map(h.user));
    const [u1, u2, u3] = [U[0]!, U[1]!, U[2]!];
    const walk = async (who: string, sid: string, endHour: number, units: string[], day = D) => {
      await h.session(who, sid, at(day, endHour), units);
      return h.api(who, sid);
    };

    /* 1. push: Ana claims three units; Ben erodes two and Cal one, each opening a challenge. */
    h.clock.now = at(D, 9);
    // Ana's claims, plus the ground the concurrency rounds will contest.
    const contested = U.slice(100, 100 + ROUNDS * 5);
    const claim = await walk(ana, "ana-1", 8.5, [u1, u2, u3, ...contested]);
    assert.equal(claim.status, 201);
    assert.equal(claim.body.outcomes.claimed, 3 + contested.length);
    h.clock.now = at(D, 12);
    assert.equal((await walk(ben, "ben-1", 11.5, [u1, u2])).body.outcomes.eroded, 2);
    h.clock.now = at(D, 12.5);
    assert.equal((await walk(cal, "cal-1", 12.2, [u1])).body.outcomes.eroded, 1);
    /* 2. challenge state. */
    const s2 = await h.q(PHYS);
    assert.deepEqual(logical(s2).map((r) => `${r.walker_id}@${r.unit === cellToInt8(u1) ? "u1" : "u2"}`).sort(), ["ben@u1", "ben@u2", "cal@u1"]);
    assert.ok(s2.every((r) => r.first_day === D && r.hv === 1002 && Math.abs(Number(r.opened_ms) - (r.walker_id === ben ? at(D, 12) : at(D, 12.5))) < 1));
    await mark("1-3 push and challenge state");

    /* 3. identical repeat push (a second session by Ben over the same two units, same day): refused by the
     *    daily limit, so the touched units' open challenges are rewritten as they already are. */
    const beforeRepeat = await h.q(PHYS);
    const writesBefore = await writeCounts(h);
    h.clock.now = at(D, 13);
    const repeat = await walk(ben, "ben-2", 12.8, [u1, u2]);
    assert.equal(repeat.status, 201);
    assert.equal(repeat.body.outcomes.eroded, 0);
    const afterRepeat = await h.q(PHYS);
    const writesAfter = await writeCounts(h);
    assert.deepEqual(logical(afterRepeat), logical(beforeRepeat), "the repeat changes nothing logically");
    const delta = (k: string) => (writesAfter[k] ?? 0) - (writesBefore[k] ?? 0);
    if (mode === "diff") {
      assert.deepEqual(afterRepeat.map((r) => [r.xmin, r.ctid]), beforeRepeat.map((r) => [r.xmin, r.ctid]), "diff: no tuple was rewritten (xmin and ctid unchanged)");
      assert.deepEqual([delta("INSERT"), delta("UPDATE"), delta("DELETE")], [0, 0, 0], "diff: the row trigger saw no write at all");
    } else {
      assert.ok(afterRepeat.every((r, i) => r.xmin !== beforeRepeat[i]!.xmin), "delete-insert: every kept row was physically rewritten (the baseline the diff mode removes)");
      assert.deepEqual([delta("INSERT"), delta("DELETE")], [3, 3]);
    }
    ev.repeatPush = { rows: afterRepeat.length, xminChanged: afterRepeat.filter((r, i) => r.xmin !== beforeRepeat[i]!.xmin).length, trigger: { INSERT: delta("INSERT"), UPDATE: delta("UPDATE"), DELETE: delta("DELETE") } };
    await mark("4 identical repeat push");

    /* 4. changed push: Cal now also walks u2 and Dan walks u1, so two rows open. In diff mode Ben's kept rows stay put. */
    const beforeChange = await h.q(PHYS);
    h.clock.now = at(D, 14);
    assert.equal((await walk(cal, "cal-2", 13.8, [u2])).body.outcomes.eroded, 1);
    assert.equal((await walk(dan, "dan-1", 13.9, [u1])).body.outcomes.eroded, 1);
    const afterChange = await h.q(PHYS);
    assert.equal(afterChange.length, 5);
    if (mode === "diff") {
      for (const b of beforeChange) {
        const a = afterChange.find((r) => r.unit === b.unit && r.walker_id === b.walker_id)!;
        assert.deepEqual([a.xmin, a.ctid], [b.xmin, b.ctid], `diff: kept ${b.walker_id} row not rewritten by an unrelated challenger`);
      }
    }
    await mark("5 changed push (new challengers)");

    /* 5. first_day change: four days on, the old challenges are out of the window. Ben's push restarts his own at
     *    the new day (first_day moves, same key) and the others' stale rows close. */
    const beforeDay = await h.q(PHYS);
    h.clock.now = at(D + 4, 10);
    assert.equal((await walk(ben, "ben-d4", 9.5, [u1, u2], D + 4)).body.outcomes.eroded, 2);
    const afterDay = await h.q(PHYS);
    assert.deepEqual(logical(afterDay).map((r) => `${r.walker_id}:${r.first_day}`).sort(), [`${ben}:${D + 4}`, `${ben}:${D + 4}`]);
    // NOT asserted here: the receipt time of a restarted challenge. It keeps the old row's time in both modes
    // (see the KNOWN BUG test at the end of this file).
    assert.ok(afterDay.every((r) => r.hv === 1002));
    if (mode === "diff") {
      // Same keys as before: updated in place by key (first_day), not deleted and re-inserted.
      const w = await writeCounts(h);
      assert.ok((w.UPDATE ?? 0) >= 2, "diff: Ben's two kept rows were UPDATEd");
      assert.ok(beforeDay.some((r) => r.walker_id === ben));
    }
    await mark("6 first_day change");

    /* 6. rules version: held ground under another version is refused before any write; rows and ledger untouched. */
    // The database itself keeps a challenge on its unit's version, so the unit moves first.
    await h.q(`UPDATE gameplay_units SET holding_rules_version = 1001 WHERE unit = $1`, [cellToInt8(u1)]);
    await h.q(`UPDATE gameplay_unit_challenges SET holding_rules_version = 1001 WHERE unit = $1`, [cellToInt8(u1)]);
    const beforeVersion = await h.q(PHYS);
    const unitsBefore = await h.q(`SELECT unit::text, strength, version, as_of_day FROM gameplay_units ORDER BY unit`);
    h.clock.now = at(D + 4, 11);
    const mismatch = await walk(cal, "cal-d4", 10.5, [u1], D + 4);
    assert.deepEqual([mismatch.status, mismatch.body], [409, { error: "unit_rules_version_mismatch" }]);
    assert.deepEqual(await h.q(PHYS), beforeVersion, "a refused push leaves the challenge table bit for bit as it was");
    assert.deepEqual(await h.q(`SELECT unit::text, strength, version, as_of_day FROM gameplay_units ORDER BY unit`), unitsBefore);
    await h.q(`UPDATE gameplay_units SET holding_rules_version = 1002 WHERE unit = $1`, [cellToInt8(u1)]);
    await h.q(`UPDATE gameplay_unit_challenges SET holding_rules_version = 1002 WHERE unit = $1`, [cellToInt8(u1)]);
    // The refused session is not applied, so the same session id applies cleanly once the data is whole again.
    const retried = await h.api(cal, "cal-d4");
    assert.equal(retried.status, 201);
    assert.equal(retried.body.outcomes.eroded, 1);
    await mark("7 rules-version mismatch refused, then applied");

    /* 7. forced failure mid-write: an injected error inside the challenge write, and another after it (in the ledger
     *    insert, later in the same transaction). Each is a 500, and everything the transaction touched is rolled back. */
    // u3 carries a stale challenger of Dan's from day D+4's point of view, so a diff has a DELETE to do before the failure.
    await h.q(`INSERT INTO gameplay_unit_challenges (unit, walker_id, first_day, holding_rules_version, opened_received_at) VALUES ($1, $2, $3, 1002, to_timestamp($4::float8 / 1000))`,
      [cellToInt8(u3), dan, D, at(D, 10)]);
    const sealedRows = async () => ({
      challenges: await h.q(PHYS),
      units: await h.q(`SELECT unit::text, holder_id, strength, version, as_of_day FROM gameplay_units ORDER BY unit`),
      ledger: Number((await h.q(`SELECT count(*) FROM gameplay_push_events`))[0].count),
      applied: Number((await h.q(`SELECT count(*) FROM gameplay_applied_sessions`))[0].count),
      writes: await writeCounts(h),
    });
    const failed: Record<string, number> = {};
    for (const target of ["challenges", "events"]) {
      await h.q(`INSERT INTO e2e_fail_flag (target) VALUES ($1)`, [target]);
      const before = await sealedRows();
      h.clock.now = at(D + 4, 12);
      const sid = `ben-fail-${target}`;
      const res = await walk(ben, sid, 11.5, [u3, u2], D + 4);
      failed[target] = res.status;
      assert.equal(res.status, 500, `${target}: the injected failure surfaces`);
      assert.deepEqual(await sealedRows(), before, `${target}: challenges (xmin, ctid), units, ledger, applied sessions and write counters all unchanged`);
      await h.q(`DELETE FROM e2e_fail_flag`);
    }
    ev.forcedFailures = failed;
    // The flags are off: the same two sessions now apply, once each.
    h.clock.now = at(D + 4, 13);
    for (const target of ["challenges", "events"]) assert.equal((await h.api(ben, `ben-fail-${target}`)).status, 201);
    assert.equal((await h.api(ben, "ben-fail-events")).status, 200, "and a replay changes nothing");
    await h.q(`DELETE FROM gameplay_unit_challenges WHERE walker_id = $1 AND unit = $2 AND first_day = $3`, [dan, cellToInt8(u3), D]);
    await mark("8 forced failures rolled back, then applied");

    /* 8. concurrency: one walker, one day, two sessions at once sharing a unit (and a third contender across them).
     *    A deadlock the service retries would hide behind a 201, so the database's own counter is read. */
    h.clock.now = at(D + 5, 10);
    const results: number[] = [];
    for (let r = 0; r < ROUNDS; r++) {
      const base = contested.slice(r * 5, r * 5 + 5);
      const w = await h.user(`eve-${r}`);
      const x = await h.user(`fay-${r}`);
      await h.session(w, `eve-${r}-a`, at(D + 5, 9), [base[0]!, base[1]!, base[2]!]);
      await h.session(w, `eve-${r}-b`, at(D + 5, 9.1), [base[2]!, base[3]!, base[4]!]);
      await h.session(x, `fay-${r}-a`, at(D + 5, 9.2), [base[2]!, base[4]!]);
      const out = await Promise.all([h.api(w, `eve-${r}-a`), h.api(w, `eve-${r}-b`), h.api(x, `fay-${r}-a`)]);
      for (const o of out) { results.push(o.status); assert.equal(o.status, 201, JSON.stringify(o.body)); }
    }
    const dl = (await deadlocks(h)) - deadlocks0;
    assert.equal(dl, 0, `PostgreSQL reported ${dl} deadlock(s) (40P01) in this run: report it, do not retry it away`);
    // One consistent state: per walker and unit, one accepted push a day; challenges match the ledger.
    const dupes = await h.q(`SELECT e.unit, e.walker_no, e.day, count(*)::int AS n FROM gameplay_push_events e WHERE e.outcome IN (3, 4) GROUP BY 1, 2, 3 HAVING count(*) > 1`);
    assert.deepEqual(dupes, [], "no walker pushed a unit twice in a day");
    const takesVsLedger = await h.q(`SELECT p.user_id, d.takes_used, (SELECT count(*)::int FROM gameplay_push_events e WHERE e.walker_no = d.walker_no AND e.day = d.day AND e.outcome IN (3, 4)) AS ledger
      FROM gameplay_walker_days d JOIN gameplay_players p ON p.player_no = d.walker_no WHERE d.day = $1 AND p.user_id LIKE 'eve-%'`, [D + 5]);
    assert.equal(takesVsLedger.length, ROUNDS);
    assert.ok(takesVsLedger.every((r) => r.takes_used === 5 && r.ledger === 5), JSON.stringify(takesVsLedger));
    for (let r = 0; r < ROUNDS; r++) {
      const base = contested.slice(r * 5, r * 5 + 5);
      const rows = (await h.q(`SELECT unit::text AS unit, walker_id, first_day FROM gameplay_unit_challenges WHERE walker_id = ANY($1::text[]) ORDER BY unit, walker_id`, [[`eve-${r}`, `fay-${r}`]]));
      const expected = [...base.map((u) => ({ unit: cellToInt8(u), walker_id: `eve-${r}`, first_day: D + 5 })),
        ...[base[2]!, base[4]!].map((u) => ({ unit: cellToInt8(u), walker_id: `fay-${r}`, first_day: D + 5 }))]
        .sort((a, b) => (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : a.walker_id < b.walker_id ? -1 : 1));
      assert.deepEqual(rows.map((x) => ({ ...x, first_day: Number(x.first_day) })).sort((a, b) => (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : a.walker_id < b.walker_id ? -1 : 1)), expected, `round ${r}`);
    }
    ev.concurrency = { rounds: ROUNDS, requests: results.length, statuses: [...new Set(results)], deadlocksReportedByPostgres: dl };
    await mark("9 concurrent pushes, one walker one day", true);

    /* 9. day settlement: every closed day settles, once, with the same books in both modes. */
    h.clock.now = at(D + 7, 12);
    const settled = await h.service.settleDueDays();
    assert.ok(settled >= 2, `settled ${settled} days`);
    assert.equal(await h.service.settleDueDays(), 0);
    const books = await h.q(`SELECT day, status FROM gameplay_day_settlements ORDER BY day`);
    assert.ok(books.every((b) => b.status === "settled"), JSON.stringify(books));
    ev.settledDays = books.length;
    await mark("10 day settlement", true);
    dumps.set(mode, steps);
    evidence.set(mode, ev);
  } finally {
    h.server.close();
    await h.t.drop();
  }
}

for (const mode of MODES) {
  test(`${mode}: push, challenge state, repeat, change, first_day, version, forced failure, concurrency and settlement over HTTP`, { skip: SKIP, timeout: 240_000 }, async () => {
    await scenario(mode);
    console.log(`# challengeDiffE2e ${mode}: ${JSON.stringify(evidence.get(mode))}`);
  });
}

test("default and diff modes give identical logical results at every step", { skip: SKIP }, () => {
  const a = dumps.get("delete-insert")!, b = dumps.get("diff")!;
  assert.ok(a && b && a.length === b.length && a.length === 8, "both scenarios ran");
  for (let i = 0; i < a.length; i++) assert.deepEqual(b[i]!.dump, a[i]!.dump, `step "${a[i]!.step}" differs between modes`);
});

/**
 * KNOWN BUG (found by this suite, present in both write modes, not caused by the diff mode): a challenge that
 * lapsed out of the window and is restarted keeps the OLD row's opened_received_at, because service.ts reuses
 * `openedBefore` for any key that still has a row (service.ts openedAt, around line 878) and policy.ts only
 * records a new receipt time when the walker had no row at all (policy.ts, applyServerLedger, around line 195).
 * The 20-hour second-push gap is then measured from the lapsed challenge, so a restart at 23:50 can be completed
 * by a push at 00:20. Marked todo so the suite stays green while the report is open; remove `todo` with the fix.
 */
for (const mode of MODES) {
  test(`KNOWN BUG (${mode}): a restarted challenge measures the 20-hour gap from its own restart, not from the lapsed one`, { skip: SKIP, todo: "restarted challenge keeps the lapsed receipt time (service.ts openedAt / policy.ts applyServerLedger)" }, async () => {
    const h = await harness(mode);
    try {
      const [ana, ben] = await Promise.all(["ana", "ben"].map(h.user));
      const unit = U[0]!;
      h.clock.now = at(D, 9);
      await h.session(ana, "bug-ana", at(D, 8.5), [unit]);
      assert.equal((await h.api(ana, "bug-ana")).status, 201);
      h.clock.now = at(D, 12);
      await h.session(ben, "bug-ben-1", at(D, 11.5), [unit]);
      assert.equal((await h.api(ben, "bug-ben-1")).body.outcomes.eroded, 1);
      // Day D+4: the window (3 days) has lapsed, so this is a fresh first push.
      h.clock.now = at(D + 4, 23.84);
      await h.session(ben, "bug-ben-2", at(D + 4, 23.8), [unit]);
      assert.equal((await h.api(ben, "bug-ben-2")).body.outcomes.eroded, 1);
      const restarted = (await h.q(`SELECT first_day, (extract(epoch FROM opened_received_at) * 1000)::float8 AS ms FROM gameplay_unit_challenges`))[0];
      assert.equal(Number(restarted.first_day), D + 4);
      assert.ok(Math.abs(Number(restarted.ms) - h.clock.now) < 1, `the restart should be stamped with its own receipt time, got ${new Date(Number(restarted.ms)).toISOString()}`);
      // Thirty minutes later, after midnight: the 20-hour gap cannot have passed, so this must not flip.
      h.clock.now = at(D + 5, 0.34);
      await h.session(ben, "bug-ben-3", at(D + 5, 0.3), [unit]);
      assert.equal((await h.api(ben, "bug-ben-3")).body.outcomes.flipped, 0, "flipped 30 minutes after the restart");
    } finally {
      h.server.close();
      await h.t.drop();
    }
  });
}
