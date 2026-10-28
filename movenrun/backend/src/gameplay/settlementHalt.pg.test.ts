/**
 * Operator halt (settlement invariants, item 4) against real PostgreSQL.
 * A halt is an audited, reversible status that can only STOP settlement: it
 * writes no settlement, line or credit, overrides nothing, and a day settled
 * after a resume is exactly the day an unhalted server settles. The
 * reconciler halts settlement itself when a closed day's replay fails.
 *
 * Skipped, loudly, without MOVENRUN_TEST_DATABASE_URL.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { gridDisk, latLngToCell } from "h3-js";
import { DAY_MS, PILOT_PROPOSAL, dayCloseMs, type GameplayRules } from "./rules.js";
import { GameplayError, GameplayService } from "./service.js";
import { SEALED_LOOP, SEAL_COLUMNS, sealLiteral } from "./sealFixtures.js";
import { createTestDb } from "./pgTestDb.js";

const DATABASE_URL = process.env.MOVENRUN_TEST_DATABASE_URL;
const SKIP = DATABASE_URL ? false : "MOVENRUN_TEST_DATABASE_URL is not set — the operator halt on PostgreSQL was NOT verified";

const D = Math.floor(Date.UTC(2026, 9, 1) / DAY_MS);
const RULES: GameplayRules = { ...PILOT_PROPOSAL, holding: { ...PILOT_PROPOSAL.holding }, seasonOneStartDay: D };
const at = (day: number, hour: number) => day * DAY_MS + Math.round(hour * 3_600_000);
const CLOSE = (day: number) => dayCloseMs(RULES, day);
const C = gridDisk(latLngToCell(51.5007, -0.1246, 8), 1).sort();

async function world(prefix: string) {
  const t = await createTestDb(DATABASE_URL!, prefix, { gameplay: true });
  let clock = at(D, 9);
  const svc = new GameplayService({ db: t.db, rules: RULES, now: () => clock });
  return {
    t, svc,
    setClock: (ms: number) => { clock = ms; },
    async user(id: string) { await t.pool.query("INSERT INTO users (id) VALUES ($1)", [id]); },
    async session(userId: string, sid: string, endMs: number, receivedMs = endMs + 60_000) {
      const id = randomUUID();
      await t.pool.query(
        `INSERT INTO movement_verifications (id, user_id, client_session_id, status, distance_meters, duration_seconds, traversed_hex_ids, start_time, end_time, created_at, ${SEAL_COLUMNS})
         VALUES ($1, $2, $3, 'verified', 3000, 1800, $4, $5, $6, (to_timestamp($7::float8 / 1000) AT TIME ZONE current_setting('TimeZone')), ${sealLiteral(SEALED_LOOP)})`,
        [id, userId, sid, [C[0]!], endMs - 1_800_000, endMs, receivedMs]);
      return id;
    },
    async counts() {
      const q = async (s: string) => Number((await t.pool.query(s)).rows[0].n);
      return { days: await q("SELECT count(*) AS n FROM gameplay_day_settlements"), lines: await q("SELECT count(*) AS n FROM gameplay_credit_lines") };
    },
    async books(day: number) {
      const h = (await t.pool.query(`SELECT status, pool_micro, minted_micro, credited_micro, toll_paid_micro, toll_received_micro, burned_micro, returned_micro,
        players, input_digest FROM gameplay_day_settlements WHERE day = $1`, [day])).rows[0];
      const l = (await t.pool.query("SELECT * FROM gameplay_credit_lines WHERE day = $1 ORDER BY player_id", [day])).rows;
      return { h, l };
    },
  };
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

test("halt stops settlement and writes nothing; resume settles exactly what an unhalted server settles", { skip: SKIP }, async () => {
  const halted = await world("halt_basic");
  const plain = await world("halt_plain");
  try {
    for (const w of [halted, plain]) {
      await w.user("ana");
      await w.user("ben");
      await w.session("ana", "a1", at(D, 8));
      await w.session("ben", "b1", at(D, 18));
      w.setClock(CLOSE(D) + 60_000);
    }
    const h = await halted.svc.haltSettlement({ actor: "ops-oncall", reason: "books under review" });
    assert.equal(h.halted, true);
    assert.equal(await code(halted.svc.settleDay(D)), "settlement_halted");
    assert.equal(await halted.svc.settleDueDays(), 0, "the maintenance loop settles nothing while halted");
    assert.deepEqual(await halted.counts(), { days: 0, lines: 0 }, "nothing written");
    const status = await halted.svc.settlementStatus();
    assert.equal(status.halted, true);
    assert.equal(status.actor, "ops-oncall");
    assert.equal(status.reason, "books under review");

    const r = await halted.svc.resumeSettlement({ actor: "ops-oncall", reason: "reviewed" });
    assert.equal(r.halted, false);
    assert.deepEqual(await halted.counts(), { days: 0, lines: 0 }, "a resume settles nothing by itself");
    await halted.svc.settleDay(D);
    await plain.svc.settleDay(D);
    assert.deepEqual(await halted.books(D), await plain.books(D), "no override: the same books as a server never halted");
    const log = (await halted.t.pool.query("SELECT action, actor, reason FROM gameplay_settlement_halts ORDER BY id")).rows;
    assert.deepEqual(log, [{ action: "halt", actor: "ops-oncall", reason: "books under review" }, { action: "resume", actor: "ops-oncall", reason: "reviewed" }]);
  } finally {
    await halted.t.drop();
    await plain.t.drop();
  }
});

test("retry and double close: a repeated halt is a no-op, a settled day is returned as stored even while halted, and re-closing after resume writes nothing", { skip: SKIP }, async () => {
  const w = await world("halt_retry");
  try {
    await w.user("ana");
    await w.session("ana", "a1", at(D, 8));
    await w.session("ana", "a2", at(D + 1, 8));
    w.setClock(CLOSE(D + 1) + 60_000);
    assert.equal((await w.svc.settleDay(D)).created, true);
    await w.svc.haltSettlement({ actor: "ops-oncall", reason: "first" });
    assert.equal((await w.svc.haltSettlement({ actor: "ops-oncall", reason: "again" })).changed, false, "already halted");
    assert.equal((await w.svc.settleDay(D)).created, false, "a closed day is read back, never re-settled");
    for (let i = 0; i < 3; i++) assert.equal(await code(w.svc.settleDay(D + 1)), "settlement_halted", `retry ${i}`);
    await w.svc.resumeSettlement({ actor: "ops-oncall", reason: "done" });
    assert.equal((await w.svc.resumeSettlement({ actor: "ops-oncall", reason: "again" })).changed, false, "already running");
    assert.equal((await w.svc.settleDay(D + 1)).created, true);
    assert.equal((await w.svc.settleDay(D + 1)).created, false, "double close");
    assert.deepEqual(await w.counts(), { days: 2, lines: 2 });
    assert.equal(Number((await w.t.pool.query("SELECT count(*) AS n FROM gameplay_settlement_halts")).rows[0].n), 2);
  } finally {
    await w.t.drop();
  }
});

test("late data: a session the server received after the close counts for nothing, however long settlement was halted", { skip: SKIP }, async () => {
  const w = await world("halt_late");
  try {
    for (const u of ["ana", "late"]) await w.user(u);
    await w.session("ana", "a1", at(D, 8));
    w.setClock(CLOSE(D) - 60_000);
    await w.svc.haltSettlement({ actor: "ops-oncall", reason: "maintenance" });
    await w.session("late", "l1", at(D, 22), CLOSE(D) + 2 * 3_600_000);
    w.setClock(CLOSE(D) + 3 * DAY_MS);
    await w.svc.resumeSettlement({ actor: "ops-oncall", reason: "back" });
    await w.svc.settleDay(D);
    const { l } = await w.books(D);
    assert.deepEqual(l.map((x) => x.player_id), ["ana"]);
  } finally {
    await w.t.drop();
  }
});

test("mismatch: a closed day whose inputs changed halts settlement through the reconciler, and the day is not rewritten", { skip: SKIP }, async () => {
  const w = await world("halt_mismatch");
  try {
    await w.user("ana");
    const id = await w.session("ana", "a1", at(D, 8));
    await w.session("ana", "a2", at(D + 1, 8));
    w.setClock(CLOSE(D + 1) + 60_000);
    await w.svc.settleDay(D);
    const before = await w.books(D);
    await w.t.pool.query("UPDATE movement_verifications SET distance_meters = 9000 WHERE id = $1", [id]);
    assert.equal(await code(w.svc.verifyDayOrHalt(D)), "closed_day_replay_mismatch");
    const s = await w.svc.settlementStatus();
    assert.equal(s.halted, true);
    assert.equal(s.actor, "reconciler");
    assert.equal(s.day, D);
    assert.equal(await code(w.svc.settleDay(D + 1)), "settlement_halted");
    assert.deepEqual(await w.books(D), before, "the closed day is untouched");
    assert.equal(await code(w.svc.verifyDay(D)), "closed_day_replay_mismatch", "replay still works while halted, read-only");
  } finally {
    await w.t.drop();
  }
});

test("corrupted book: an edited credit line halts settlement; the halt neither repairs nor rewrites it, and a settled day stays final", { skip: SKIP }, async () => {
  const w = await world("halt_corrupt");
  try {
    await w.user("ana");
    await w.session("ana", "a1", at(D, 8));
    w.setClock(CLOSE(D) + 60_000);
    await w.svc.settleDay(D);
    const c = await w.t.pool.connect();
    try {
      await c.query("ALTER TABLE gameplay_credit_lines DISABLE TRIGGER gameplay_credit_lines_final");
      await c.query(`UPDATE gameplay_credit_lines SET earned_micro = earned_micro + 5, net_micro = net_micro + 5 WHERE day = ${D}`);
      await c.query("ALTER TABLE gameplay_credit_lines ENABLE TRIGGER gameplay_credit_lines_final");
    } finally {
      c.release();
    }
    const corrupted = await w.books(D);
    assert.equal(await code(w.svc.verifyDayOrHalt(D)), "closed_day_books_invalid");
    assert.equal((await w.svc.settlementStatus()).halted, true);
    await w.svc.resumeSettlement({ actor: "ops-oncall", reason: "incident opened separately" });
    assert.deepEqual(await w.books(D), corrupted, "resume repairs nothing; repair is its own authorised incident");
    assert.equal(await code(w.t.pool.query(`UPDATE gameplay_day_settlements SET minted_micro = 0 WHERE day = ${D}`)), "23001", "a settled day is final");
  } finally {
    await w.t.drop();
  }
});

test("the halt log is audited: append-only, a role label (never an address) and a reason are required", { skip: SKIP }, async () => {
  const w = await world("halt_audit");
  try {
    assert.equal((await w.svc.settlementStatus()).halted, false);
    assert.equal(await code(w.svc.haltSettlement({ actor: "someone@example.org", reason: "x" })), "invalid_actor");
    assert.equal(await code(w.svc.haltSettlement({ actor: "ops-oncall", reason: "" })), "invalid_reason");
    await w.svc.haltSettlement({ actor: "ops-oncall", reason: "drill" });
    assert.equal(await code(w.t.pool.query("UPDATE gameplay_settlement_halts SET reason = 'edited'")), "23001");
    assert.equal(await code(w.t.pool.query("DELETE FROM gameplay_settlement_halts")), "23001");
    assert.equal(await code(w.t.pool.query("INSERT INTO gameplay_settlement_halts (action, actor, reason) VALUES ('halt', 'a@b', 'x')")), "23514");
  } finally {
    await w.t.drop();
  }
});
