/**
 * Settlement invariants against real PostgreSQL (items 1 and 3): the
 * read-only replay re-checks the books and credit lines actually STORED for a
 * closed day (not only the input digest) and compares them with a fresh
 * settlement under the day's pinned rules; the season roll-up re-verifies
 * every constituent day and fails closed on a missing or corrupted one.
 *
 * Corruption is simulated the only way the owner role can: disabling the
 * finality trigger for one statement. Skipped, loudly, without
 * MOVENRUN_TEST_DATABASE_URL.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { gridDisk, latLngToCell } from "h3-js";
import { DAY_MS, PILOT_PROPOSAL, dayCloseMs, type GameplayRules } from "./rules.js";
import { GameplayError, GameplayService } from "./service.js";
import { SEALED_LOOP, SEAL_COLUMNS, sealLiteral } from "./sealFixtures.js";
import { createTestDb, type TestDb } from "./pgTestDb.js";

const DATABASE_URL = process.env.MOVENRUN_TEST_DATABASE_URL;
const SKIP = DATABASE_URL ? false : "MOVENRUN_TEST_DATABASE_URL is not set — settlement invariants on PostgreSQL were NOT verified";

const D = Math.floor(Date.UTC(2026, 9, 1) / DAY_MS);
const RULES: GameplayRules = { ...PILOT_PROPOSAL, holding: { ...PILOT_PROPOSAL.holding }, seasonOneStartDay: D };
const at = (day: number, hour: number) => day * DAY_MS + Math.round(hour * 3_600_000);
const CLOSE = (day: number) => dayCloseMs(RULES, day);
const C = gridDisk(latLngToCell(51.5007, -0.1246, 8), 1).sort();

async function world(prefix: string) {
  const t = await createTestDb(DATABASE_URL!, prefix, { gameplay: true });
  let clock = at(D, 9);
  const svc = new GameplayService({ db: t.db, rules: RULES, now: () => clock });
  const w = {
    t, svc,
    setClock: (ms: number) => { clock = ms; },
    async user(id: string) { await t.pool.query("INSERT INTO users (id) VALUES ($1)", [id]); },
    async session(userId: string, sid: string, endMs: number, minutes = 30) {
      await t.pool.query(
        `INSERT INTO movement_verifications (id, user_id, client_session_id, status, distance_meters, duration_seconds, traversed_hex_ids, start_time, end_time, created_at, ${SEAL_COLUMNS})
         VALUES ($1, $2, $3, 'verified', 3000, $4, $5, $6, $7, (to_timestamp($8::float8 / 1000) AT TIME ZONE current_setting('TimeZone')), ${sealLiteral(SEALED_LOOP)})`,
        [randomUUID(), userId, sid, minutes * 60, [C[0]!], endMs - minutes * 60_000, endMs, endMs + 60_000]);
    },
    /** One statement with a finality trigger off: what a corrupted or hand-edited book looks like. */
    async tamper(table: string, trigger: string, statement: string) {
      const c = await t.pool.connect();
      try {
        await c.query("BEGIN");
        await c.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
        await c.query(statement);
        await c.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
        await c.query("COMMIT");
      } finally {
        c.release();
      }
    },
  };
  return w;
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

async function twoWalkers(w: Awaited<ReturnType<typeof world>>, day: number) {
  await w.session("ana", `a${day}`, at(day, 8), 30);
  await w.session("ben", `b${day}`, at(day, 18), 45);
}

test("replay: a stored credit line edited after close is caught, though the input digest still matches", { skip: SKIP }, async () => {
  const w = await world("inv_line");
  try {
    await w.user("ana");
    await w.user("ben");
    await twoWalkers(w, D);
    w.setClock(CLOSE(D) + 60_000);
    assert.equal((await w.svc.settleDay(D)).status, "settled");
    await w.svc.verifyDay(D);
    await w.tamper("gameplay_credit_lines", "gameplay_credit_lines_final",
      `UPDATE gameplay_credit_lines SET earned_micro = earned_micro + 5, net_micro = net_micro + 5 WHERE day = ${D} AND player_id = 'ana'`);
    assert.equal(await code(w.svc.verifyDay(D)), "closed_day_books_invalid");
  } finally {
    await w.t.drop();
  }
});

test("replay: a header edited so its own identities still hold, but no longer matching its lines, is caught", { skip: SKIP }, async () => {
  const w = await world("inv_header");
  try {
    await w.user("ana");
    await w.user("ben");
    await twoWalkers(w, D);
    w.setClock(CLOSE(D) + 60_000);
    await w.svc.settleDay(D);
    await w.tamper("gameplay_day_settlements", "gameplay_day_settlements_final",
      `UPDATE gameplay_day_settlements SET credited_micro = credited_micro + 1, burned_micro = burned_micro - 1 WHERE day = ${D}`);
    assert.equal(await code(w.svc.verifyDay(D)), "closed_day_books_invalid");
  } finally {
    await w.t.drop();
  }
});

test("replay: books edited consistently (every identity holds) still differ from a fresh settlement and are caught", { skip: SKIP }, async () => {
  const w = await world("inv_consistent");
  try {
    await w.user("ana");
    await w.user("ben");
    await twoWalkers(w, D);
    w.setClock(CLOSE(D) + 60_000);
    await w.svc.settleDay(D);
    // One micro moved from ana's recharge (burned) to her net (credited).
    await w.tamper("gameplay_credit_lines", "gameplay_credit_lines_final",
      `UPDATE gameplay_credit_lines SET recharge_micro = recharge_micro - 1, net_micro = net_micro + 1 WHERE day = ${D} AND player_id = 'ana'`);
    await w.tamper("gameplay_day_settlements", "gameplay_day_settlements_final",
      `UPDATE gameplay_day_settlements SET credited_micro = credited_micro + 1, burned_micro = burned_micro - 1 WHERE day = ${D}`);
    assert.equal(await code(w.svc.verifyDay(D)), "closed_day_replay_mismatch");
  } finally {
    await w.t.drop();
  }
});

test("season roll-up: re-verifies every closed day, fails closed on a missing or corrupted one, and keeps the version pin", { skip: SKIP }, async () => {
  const w = await world("inv_season");
  try {
    await w.user("ana");
    await w.user("ben");
    for (const d of [D, D + 1, D + 2]) await twoWalkers(w, d);
    w.setClock(CLOSE(D + 2) + 60_000);
    await w.svc.settleDay(D);
    await w.svc.settleDay(D + 2);
    const gap = await w.svc.verifySeason(1);
    assert.equal(gap.status, "refused");
    if (gap.status === "refused") assert.ok(gap.problems.some((p) => p.includes(`day ${D + 1}`) && /missing/.test(p)), gap.problems.join("; "));

    await w.svc.settleDay(D + 1);
    const ok = await w.svc.verifySeason(1);
    assert.equal(ok.status, "verified", ok.status === "refused" ? ok.problems.join("; ") : "");
    if (ok.status === "verified") {
      assert.equal(ok.days, 3);
      assert.equal(ok.throughDay, D + 2);
      assert.deepEqual(ok.rulesets, [{ ruleset: RULES.ruleset, economyRulesVersion: 1, holdingRulesVersion: RULES.holding.rulesVersion }]);
      assert.equal(BigInt(ok.mintedMicro) + BigInt(ok.returnedMicro), BigInt(ok.poolMicro));
    }

    await w.tamper("gameplay_credit_lines", "gameplay_credit_lines_final",
      `UPDATE gameplay_credit_lines SET earned_micro = earned_micro + 5, net_micro = net_micro + 5 WHERE day = ${D + 1} AND player_id = 'ben'`);
    const bad = await w.svc.verifySeason(1);
    assert.equal(bad.status, "refused");
    if (bad.status === "refused") assert.ok(bad.problems.some((p) => p.includes(`day ${D + 1}`)), bad.problems.join("; "));
    assert.equal(await code(w.svc.verifySeason(0)), "invalid_season");
  } finally {
    await w.t.drop();
  }
});
