/**
 * Account erasure against closed, append-only settlement (directive 28 Oct,
 * section 5 item 5; docs/G34_ERASURE_TOMBSTONES.md). Erasing a walker must
 * leave no row naming them or their paths, must not change anybody else's
 * balance, rank or proof, and every closed day it touched must still pass
 * the reconciler, through a hash-chained erasure record and a random
 * tombstone in place of their credit line. No legal-hold shortcut: nothing
 * identity-linked is kept.
 *
 * Synthetic users and cells only. Skipped, loudly, without
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
import { createDrizzleAccountDeletionStore } from "../identity/accountDeletion.js";
import { DrizzleAuthIdentityRepository, DrizzleUserRepository } from "../identity/repositories/drizzle/stores.js";

const DATABASE_URL = process.env.MOVENRUN_TEST_DATABASE_URL;
const SKIP = DATABASE_URL ? false : "MOVENRUN_TEST_DATABASE_URL is not set — erasure tombstones on PostgreSQL were NOT verified";

const D = Math.floor(Date.UTC(2026, 9, 1) / DAY_MS);
const RULES: GameplayRules = { ...PILOT_PROPOSAL, holding: { ...PILOT_PROPOSAL.holding }, seasonOneStartDay: D };
const at = (day: number, hour: number) => day * DAY_MS + Math.round(hour * 3_600_000);
const CLOSE = (day: number) => dayCloseMs(RULES, day);
const C = gridDisk(latLngToCell(51.5007, -0.1246, 8), 1).sort();

/** Distinctive synthetic ids, so a row naming one cannot match by accident. */
const ANA = "erasure-walker-ana-5f1c";
const BEN = "erasure-walker-ben-a20e";
const CAL = "erasure-walker-cal-77b9";

async function code(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (err) {
    if (err instanceof GameplayError) return err.code;
    return (err as { code?: string }).code;
  }
}

interface World {
  t: TestDb;
  svc: GameplayService;
  setClock(ms: number): void;
  user(id: string, subject?: string): Promise<string>;
  walk(userId: string, sid: string, endMs: number, units: string[], receivedMs?: number): Promise<string>;
  q<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<T[]>;
  playerNo(userId: string): Promise<number | undefined>;
}

async function world(prefix: string): Promise<World> {
  const t = await createTestDb(DATABASE_URL!, prefix, { gameplay: true });
  let clock = at(D, 9);
  const svc = new GameplayService({ db: t.db, rules: RULES, now: () => clock });
  const w: World = {
    t, svc,
    setClock: (ms) => { clock = ms; },
    async user(id, subject = `sub-${id}`) {
      await t.pool.query("INSERT INTO users (id) VALUES ($1)", [id]);
      await t.pool.query("INSERT INTO auth_identities (id, user_id, provider, provider_subject) VALUES ($1, $2, 'supabase', $3)", [randomUUID(), id, subject]);
      return id;
    },
    async walk(userId, sid, endMs, units, receivedMs = endMs + 60_000) {
      const id = randomUUID();
      await t.pool.query(
        `INSERT INTO movement_verifications (id, user_id, client_session_id, status, distance_meters, duration_seconds, traversed_hex_ids, start_time, end_time, created_at, ${SEAL_COLUMNS})
         VALUES ($1, $2, $3, 'verified', 3000, 1800, $4, $5, $6, (to_timestamp($7::float8 / 1000) AT TIME ZONE current_setting('TimeZone')), ${sealLiteral(SEALED_LOOP)})`,
        [id, userId, sid, units, endMs - 1_800_000, endMs, receivedMs]);
      return id;
    },
    async q(text, values = []) {
      return (await t.pool.query(text, values)).rows;
    },
    async playerNo(userId) {
      const [r] = await w.q<{ player_no: number }>("SELECT player_no FROM gameplay_players WHERE user_id = $1", [userId]);
      return r?.player_no;
    },
  };
  return w;
}

/**
 * Two settled days. Ana claims C0 and C1 on D; Ben walks C2 on D and pushes
 * Ana's C0 on D+1, so Ana is the previous holder in Ben's ledger row (the
 * case that used to change Ben's proof). Cal only moves.
 */
async function history(w: World) {
  for (const u of [ANA, BEN, CAL]) await w.user(u);
  w.setClock(at(D, 9));
  await w.walk(ANA, "a1", at(D, 8), [C[0]!, C[1]!]);
  await w.svc.applySession(ANA, "a1");
  await w.walk(BEN, "b1", at(D, 8.2), [C[2]!]);
  await w.svc.applySession(BEN, "b1");
  await w.walk(CAL, "c1", at(D, 8.4), [C[3]!]);
  w.setClock(at(D + 1, 9));
  await w.walk(BEN, "b2", at(D + 1, 8), [C[0]!]);
  await w.svc.applySession(BEN, "b2");
  await w.walk(ANA, "a2", at(D + 1, 8.5), [C[1]!]);
  await w.svc.applySession(ANA, "a2");
  w.setClock(CLOSE(D + 1) + 60_000);
  await w.svc.settleDay(D);
  await w.svc.settleDay(D + 1);
}

/** Every row of every gameplay table (partitions included), as text, that names `text`. */
async function rowsNaming(w: World, text: string): Promise<string[]> {
  const tables = await w.q<{ t: string }>(`SELECT format('%I.%I', schemaname, tablename) AS t FROM pg_tables
    WHERE (schemaname = 'public' AND tablename LIKE 'gameplay\\_%') OR schemaname = 'gameplay_partitions' ORDER BY 1`);
  const hits: string[] = [];
  for (const { t } of tables) {
    const n = await w.q<{ n: number }>(`SELECT count(*)::int AS n FROM ${t} x WHERE x::text LIKE '%' || $1 || '%'`, [text]);
    if (n[0]!.n > 0) hits.push(t);
  }
  return hits;
}

test("erasure: no row names the walker, their line becomes a random tombstone, and every closed day still reconciles", { skip: SKIP }, async () => {
  const w = await world("erase_core");
  try {
    await history(w);
    const anaNo = (await w.playerNo(ANA))!;
    const benNo = (await w.playerNo(BEN))!;
    assert.ok((await w.q("SELECT 1 FROM gameplay_push_events WHERE walker_no = $1 AND previous_holder_no = $2", [benNo, anaNo])).length > 0, "Ana is a previous holder in Ben's ledger");
    const header = async (d: number) => (await w.q("SELECT * FROM gameplay_day_settlements WHERE day = $1", [d]))[0];
    const proofs = async (no: number) => w.q("SELECT day, encode(events_sha256, 'hex') AS sha FROM gameplay_player_day_proofs WHERE player_no = $1 ORDER BY day", [no]);
    const before = {
      h: [await header(D), await header(D + 1)],
      anaLines: await w.q("SELECT day, earned_micro, toll_paid_micro, toll_received_micro, net_micro FROM gameplay_credit_lines WHERE player_id = $1 ORDER BY day", [ANA]),
      benCredits: await w.svc.myCredits(BEN, 1),
      calCredits: await w.svc.myCredits(CAL, 1),
      benProofs: await proofs(benNo),
      benBoard: (await w.svc.leaderboard(BEN, 1, "player_credits")),
    };
    assert.equal(before.anaLines.length, 2);
    for (const d of [D, D + 1]) await w.svc.verifyDay(d);

    const erased = await createDrizzleAccountDeletionStore(w.t.db).erase(ANA);
    assert.equal(erased.users, 1);

    // Nothing names Ana: not her id, not her player number, not her sessions or paths.
    assert.deepEqual(await rowsNaming(w, ANA), []);
    for (const [table, col] of [["gameplay_push_events", "walker_no"], ["gameplay_push_events", "previous_holder_no"], ["gameplay_push_events", "new_holder_no"],
      ["gameplay_walker_days", "walker_no"], ["gameplay_unit_day_states", "holder_no"], ["gameplay_player_day_proofs", "player_no"]] as const) {
      assert.equal((await w.q(`SELECT 1 FROM ${table} WHERE ${col} = $1`, [anaNo])).length, 0, `${table}.${col}`);
    }
    assert.equal((await w.q("SELECT 1 FROM movement_verifications WHERE user_id = $1", [ANA])).length, 0);
    assert.equal((await w.q("SELECT 1 FROM gameplay_session_paths p LEFT JOIN movement_verifications m ON m.id = p.movement_verification_id WHERE m.id IS NULL")).length, 0);

    // Her lines are tombstones: same amounts, a random id per day, nothing linking them to her or to each other.
    const tombs = await w.q<{ day: number; erasure_record_id: string; line_key: string }>(`
      SELECT day, erasure_record_id::text AS erasure_record_id, line_key, earned_micro, toll_paid_micro, toll_received_micro, net_micro
        FROM gameplay_credit_lines WHERE player_id IS NULL ORDER BY day`);
    assert.deepEqual(tombs.map(({ day, earned_micro, toll_paid_micro, toll_received_micro, net_micro }: Record<string, unknown>) =>
      ({ day, earned_micro, toll_paid_micro, toll_received_micro, net_micro })), before.anaLines);
    assert.notEqual(tombs[0]!.erasure_record_id, tombs[1]!.erasure_record_id, "one tombstone per day");
    for (const tb of tombs) assert.match(tb.line_key, /^erased:[0-9a-f-]{36}$/);
    const recordCols = (await w.q<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'gameplay_erasure_records' ORDER BY 1")).map((c) => c.column_name);
    assert.deepEqual(recordCols, ["day", "line_tombstoned", "post_digest", "pre_digest", "pre_verified", "prev_hash", "record_hash", "record_id", "seq"], "no user, player or time column");

    // Headers are untouched, every closed day reconciles, and the reconciler does not halt.
    assert.deepEqual([await header(D), await header(D + 1)], before.h);
    for (const d of [D, D + 1]) {
      await w.svc.verifyDayOrHalt(d);
    }
    assert.equal((await w.svc.settlementStatus()).halted, false);

    // Nobody else's balance, proof or rank moved.
    assert.deepEqual(await w.svc.myCredits(BEN, 1), before.benCredits);
    assert.deepEqual(await w.svc.myCredits(CAL, 1), before.calCredits);
    assert.deepEqual(await proofs(benNo), before.benProofs, "Ben's proofs do not depend on Ana's player number");
    const board = await w.svc.leaderboard(BEN, 1, "player_credits");
    type Row = { rank: number; score: number; self: boolean };
    const rowsOf = (b: unknown) => ((b as { rows?: Row[] }).rows ?? []);
    assert.equal(board.status, "settled");
    const anaTotal = before.anaLines.reduce((a, l) => a + Number((l as { net_micro: string }).net_micro), 0);
    const left = rowsOf(before.benBoard).map((r) => r.score);
    left.splice(left.indexOf(anaTotal), 1);
    assert.deepEqual(rowsOf(board).map((r) => r.score), left, "the erased walker left the board as one player; every other score is unchanged");
    assert.equal(rowsOf(board).find((r) => r.self)!.score, rowsOf(before.benBoard).find((r) => r.self)!.score);
    assert.deepEqual(rowsOf(board).map((r) => r.rank), rowsOf(board).map((_, i) => i + 1), "ranked again without gaps (distinct scores here)");

    // Later days settle normally and verify.
    w.setClock(CLOSE(D + 2) + 60_000);
    await w.svc.settleDay(D + 2);
    await w.svc.verifyDay(D + 2);
  } finally {
    await w.t.drop();
  }
});

test("replayed and duplicated erasure is idempotent: a retry or a concurrent second request changes nothing more", { skip: SKIP }, async () => {
  const w = await world("erase_idem");
  try {
    await history(w);
    const store = createDrizzleAccountDeletionStore(w.t.db);
    const runs = await Promise.all([store.erase(ANA), store.erase(ANA)]);
    assert.deepEqual(runs.map((r) => r.users).sort(), [0, 1], "exactly one erasure did the work");
    const snapshot = async () => ({
      records: await w.q("SELECT * FROM gameplay_erasure_records ORDER BY seq"),
      lines: await w.q("SELECT * FROM gameplay_credit_lines ORDER BY day, line_key"),
      fence: await w.q("SELECT 1 FROM gameplay_erasure_fence"),
    });
    const first = await snapshot();
    assert.equal(first.records.length, 2);
    const again = await store.erase(ANA);
    assert.equal(again.users, 0);
    assert.equal(again.movementSessions, 0);
    assert.deepEqual(await snapshot(), first);
    for (const d of [D, D + 1]) await w.svc.verifyDay(d);
  } finally {
    await w.t.drop();
  }
});

test("two walkers erased one after the other: the day's records chain, and the day still reconciles", { skip: SKIP }, async () => {
  const w = await world("erase_chain");
  try {
    await history(w);
    const benBefore = await w.svc.myCredits(BEN, 1);
    const store = createDrizzleAccountDeletionStore(w.t.db);
    await store.erase(ANA);
    await store.erase(CAL);
    const recs = await w.q<{ day: number; pre_digest: string; post_digest: string; prev_hash: string; record_hash: string }>(
      "SELECT day, pre_digest, post_digest, prev_hash, record_hash FROM gameplay_erasure_records WHERE day = $1 ORDER BY seq", [D]);
    assert.equal(recs.length, 2);
    const h = (await w.q<{ input_digest: string }>("SELECT input_digest FROM gameplay_day_settlements WHERE day = $1", [D]))[0]!;
    assert.equal(recs[0]!.pre_digest, h.input_digest);
    assert.equal(recs[1]!.pre_digest, recs[0]!.post_digest);
    assert.equal(recs[1]!.prev_hash, recs[0]!.record_hash);
    for (const d of [D, D + 1]) await w.svc.verifyDay(d);
    assert.deepEqual(await w.svc.myCredits(BEN, 1), benBefore);
  } finally {
    await w.t.drop();
  }
});

test("erasure records and tombstones are append-only, the chain is checked, and a tampered chain halts the reconciler", { skip: SKIP }, async () => {
  const w = await world("erase_tamper");
  try {
    await history(w);
    await createDrizzleAccountDeletionStore(w.t.db).erase(ANA);
    assert.equal(await code(w.t.pool.query("UPDATE gameplay_erasure_records SET pre_verified = pre_verified")), "23001");
    assert.equal(await code(w.t.pool.query("DELETE FROM gameplay_erasure_records")), "23001");
    assert.equal(await code(w.t.pool.query("UPDATE gameplay_credit_lines SET player_id = $1, erasure_record_id = NULL WHERE player_id IS NULL", [BEN])), "23001", "a tombstone is never re-identified");
    assert.equal(await code(w.t.pool.query("DELETE FROM gameplay_credit_lines")), "23001", "credit lines are never deleted");
    // A forged record that does not extend the day's chain is refused by the database.
    assert.equal(await code(w.t.pool.query(`INSERT INTO gameplay_erasure_records (record_id, day, pre_digest, post_digest, pre_verified, line_tombstoned, prev_hash, record_hash)
      VALUES ($1, $2, $3, $3, true, false, $3, $3)`, [randomUUID(), D, "a".repeat(64)])), "23514");
    // Editing a record past the triggers is caught by the reconciler, which halts.
    const c = await w.t.pool.connect();
    try {
      await c.query("ALTER TABLE gameplay_erasure_records DISABLE TRIGGER gameplay_erasure_records_guard");
      await c.query("UPDATE gameplay_erasure_records SET post_digest = $1 WHERE day = $2", ["b".repeat(64), D]);
      await c.query("ALTER TABLE gameplay_erasure_records ENABLE TRIGGER gameplay_erasure_records_guard");
    } finally {
      c.release();
    }
    assert.equal(await code(w.svc.verifyDayOrHalt(D)), "closed_day_erasure_invalid");
    assert.equal((await w.svc.settlementStatus()).halted, true);
  } finally {
    await w.t.drop();
  }
});

test("erasure cannot launder an earlier mismatch: a day that failed before the erasure still fails after it", { skip: SKIP }, async () => {
  const w = await world("erase_launder");
  try {
    await history(w);
    await w.t.pool.query("UPDATE movement_verifications SET distance_meters = 9000 WHERE user_id = $1", [BEN]);
    assert.equal(await code(w.svc.verifyDay(D)), "closed_day_replay_mismatch");
    await createDrizzleAccountDeletionStore(w.t.db).erase(ANA);
    const recs = await w.q<{ pre_verified: boolean }>("SELECT pre_verified FROM gameplay_erasure_records WHERE day = $1", [D]);
    assert.deepEqual(recs.map((r) => r.pre_verified), [false]);
    assert.equal(await code(w.svc.verifyDay(D)), "closed_day_erasure_invalid");
  } finally {
    await w.t.drop();
  }
});

test("a deletion that skips the erasure step fails closed instead of breaking a closed day", { skip: SKIP }, async () => {
  const w = await world("erase_skip");
  try {
    await history(w);
    // Everything 0000-0010 holds for Ben goes, as a deletion that knows nothing of gameplay would do it.
    await w.t.pool.query("DELETE FROM movement_verifications WHERE user_id = $1", [BEN]);
    await w.t.pool.query("DELETE FROM auth_identities WHERE user_id = $1", [BEN]);
    assert.equal(await code(w.t.pool.query("DELETE FROM users WHERE id = $1", [BEN])), "23503");
    assert.equal((await w.q("SELECT 1 FROM users WHERE id = $1", [BEN])).length, 1);
    assert.equal((await w.q("SELECT 1 FROM gameplay_credit_lines WHERE player_id = $1", [BEN])).length, 2);
  } finally {
    await w.t.drop();
  }
});

test("settlement race: erasure and day close running together leave a day that settles once and reconciles", { skip: SKIP }, async () => {
  const w = await world("erase_race");
  try {
    await history(w);
    // D+2: everyone moves; the day closes while Ana is being erased.
    w.setClock(at(D + 2, 9));
    await w.walk(BEN, "b3", at(D + 2, 8), [C[4]!]);
    await w.svc.applySession(BEN, "b3");
    await w.walk(ANA, "a3", at(D + 2, 8.5), [C[1]!, C[5]!]);
    await w.svc.applySession(ANA, "a3");
    w.setClock(CLOSE(D + 2) + 60_000);
    // An erasure holding the fence makes the close wait; it then re-reads, so Ana is in no line of D+2.
    const held = await w.t.pool.connect();
    let close: Promise<unknown> | undefined;
    try {
      await held.query("BEGIN");
      await held.query("UPDATE gameplay_erasure_fence SET erasures = erasures + 1");
      let settled = false;
      close = w.svc.settleDay(D + 2).then((r) => { settled = true; return r; });
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(settled, false, "the close waits for the erasure");
      await held.query("COMMIT");
    } finally {
      await held.query("ROLLBACK").catch(() => undefined);
      held.release();
    }
    await close;
    await w.svc.verifyDay(D + 2);

    // The real thing, concurrently, on a fresh day.
    w.setClock(at(D + 3, 9));
    await w.walk(BEN, "b4", at(D + 3, 8), [C[6]!]);
    await w.svc.applySession(BEN, "b4");
    w.setClock(CLOSE(D + 3) + 60_000);
    const [erased, day] = await Promise.all([createDrizzleAccountDeletionStore(w.t.db).erase(ANA), w.svc.settleDay(D + 3)]);
    assert.equal(erased.users, 1);
    assert.equal(day.status, "settled");
    for (const d of [D, D + 1, D + 2, D + 3]) await w.svc.verifyDay(d);
    assert.deepEqual(await rowsNaming(w, ANA), []);
  } finally {
    await w.t.drop();
  }
});

test("deletion then sign-up again with the same provider identity: a fresh walker, no carried credit, ground or link, and a late upload for an old day is refused while the session stays truthful", { skip: SKIP }, async () => {
  const w = await world("erase_recreate");
  try {
    await history(w);
    const oldNo = (await w.playerNo(ANA))!;
    await createDrizzleAccountDeletionStore(w.t.db).erase(ANA);
    const identities = new DrizzleAuthIdentityRepository(w.t.db);
    assert.equal(await identities.findActiveByProviderSubject("supabase", `sub-${ANA}`), null, "the provider identity resolves to nobody");
    // The sign-in flow then creates a new user under a new id for the same subject.
    const again = randomUUID();
    await new DrizzleUserRepository(w.t.db).create({ id: again });
    await identities.create({ id: randomUUID(), userId: again, provider: "supabase", providerSubject: `sub-${ANA}` });

    w.setClock(at(D + 2, 9));
    await w.walk(again, "n1", at(D + 2, 8), [C[1]!]);
    const applied = await w.svc.applySession(again, "n1");
    assert.equal(applied.outcomes.claimed, 1, "C1 went back on the map at erasure and is claimed afresh");
    const newNo = (await w.playerNo(again))!;
    assert.ok(newNo > oldNo, "a new player number; numbers are never reused");
    assert.deepEqual((await w.svc.myCredits(again, 1)).days, [], "no credit carried over");
    assert.equal((await w.svc.myHoldings(again)).unitsHeld, 1);

    // A late upload of an old day by the new account: refused for gameplay, kept as a truthful verified session.
    const late = await w.walk(again, "late-d", at(D, 22), [C[2]!], CLOSE(D + 1) + 3_600_000);
    assert.equal(await code(w.svc.applySession(again, "late-d")), "day_closed");
    const row = (await w.q<{ status: string; distance_meters: number; user_id: string }>("SELECT status, distance_meters, user_id FROM movement_verifications WHERE id = $1", [late]))[0]!;
    assert.deepEqual(row, { status: "verified", distance_meters: 3000, user_id: again }, "the session record is unchanged");
    w.setClock(CLOSE(D + 2) + 60_000);
    await w.svc.settleDueDays();
    for (const d of [D, D + 1, D + 2]) await w.svc.verifyDay(d);
    assert.deepEqual((await w.svc.myCredits(again, 1)).days.map((x) => x.day), [D + 2], "credit only for the new walker's own day");
    // No erasure record or tombstone points at the new account.
    assert.deepEqual(await rowsNaming(w, ANA), []);
    assert.equal((await w.q("SELECT 1 FROM gameplay_credit_lines WHERE player_id = $1 AND day < $2", [again, D + 2])).length, 0);
  } finally {
    await w.t.drop();
  }
});

test("without 0011 (flag off, applied chain only) account deletion still works and touches no gameplay relation", { skip: SKIP }, async () => {
  const t = await createTestDb(DATABASE_URL!, "erase_bare", { gameplay: false });
  try {
    await t.pool.query("INSERT INTO users (id) VALUES ($1)", [ANA]);
    const r = await createDrizzleAccountDeletionStore(t.db).erase(ANA);
    assert.equal(r.users, 1);
    assert.deepEqual((await t.pool.query("SELECT relname FROM pg_class WHERE relname LIKE 'gameplay%'")).rows, []);
  } finally {
    await t.drop();
  }
});
