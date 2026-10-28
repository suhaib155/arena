/**
 * Late uploads against real PostgreSQL (Track B finding 1): a closed day's
 * settlement counts a session only if the server received it before that
 * day's close (midnight plus the grace window), by `created_at`, the
 * database's own receipt time. When settlement runs, how often it is
 * retried, and what arrives after the close never change a closed day.
 *
 * Each scenario runs in its own throwaway database (pgTestDb.ts), so two
 * databases fed the same synthetic history can be compared. Skipped, loudly,
 * without MOVENRUN_TEST_DATABASE_URL.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { gridDisk, latLngToCell } from "h3-js";
import type { Db } from "../db/client.js";
import { DAY_MS, PILOT_PROPOSAL, dayCloseMs, type GameplayRules } from "./rules.js";
import { GameplayError, GameplayService } from "./service.js";
import { SEALED_LOOP, SEAL_COLUMNS, sealLiteral } from "./sealFixtures.js";
import { createTestDb, type TestDb } from "./pgTestDb.js";

const DATABASE_URL = process.env.MOVENRUN_TEST_DATABASE_URL;
const SKIP = DATABASE_URL ? false : "MOVENRUN_TEST_DATABASE_URL is not set — the receipt cutoff on PostgreSQL was NOT verified";

const D = Math.floor(Date.UTC(2026, 9, 1) / DAY_MS); // season 1, day 1
const RULES: GameplayRules = { ...PILOT_PROPOSAL, holding: { ...PILOT_PROPOSAL.holding }, seasonOneStartDay: D };
const at = (day: number, hour: number) => day * DAY_MS + Math.round(hour * 3_600_000);
const CLOSE = (day: number) => dayCloseMs(RULES, day);
/** Synthetic resolution 8 cells (1001 stores the pipeline's cells as they are). */
const C = gridDisk(latLngToCell(51.5007, -0.1246, 8), 1).sort();

interface World {
  t: TestDb;
  svc: GameplayService;
  setClock(ms: number): void;
  user(id: string): Promise<string>;
  session(userId: string, sid: string, endMs: number, receivedMs: number, units?: string[]): Promise<string>;
  day(day: number): Promise<{ header: Record<string, unknown>; lines: Record<string, unknown>[] }>;
}

async function world(prefix: string, wrap?: (db: Db) => Db): Promise<World> {
  const t = await createTestDb(DATABASE_URL!, prefix, { gameplay: true });
  let clock = at(D, 9);
  const svc = new GameplayService({ db: wrap ? wrap(t.db) : t.db, rules: RULES, now: () => clock });
  return {
    t, svc,
    setClock: (ms) => { clock = ms; },
    async user(id) {
      await t.pool.query("INSERT INTO users (id) VALUES ($1)", [id]);
      return id;
    },
    async session(userId, sid, endMs, receivedMs, units = [C[0]!]) {
      const id = randomUUID();
      await t.pool.query(
        `INSERT INTO movement_verifications (id, user_id, client_session_id, status, distance_meters, duration_seconds, traversed_hex_ids, start_time, end_time, created_at, ${SEAL_COLUMNS})
         VALUES ($1, $2, $3, 'verified', 3000, 1800, $4, $5, $6, (to_timestamp($7::float8 / 1000) AT TIME ZONE current_setting('TimeZone')), ${sealLiteral(SEALED_LOOP)})`,
        [id, userId, sid, units, endMs - 1_800_000, endMs, receivedMs]);
      return id;
    },
    async day(day) {
      const header = (await t.pool.query(`SELECT day, season, status, pool_micro, minted_micro, credited_micro, toll_paid_micro, toll_received_micro,
        burned_micro, returned_micro, day_share_micro, players, input_digest, (extract(epoch FROM receipt_cutoff_at) * 1000)::float8 AS cutoff_ms
        FROM gameplay_day_settlements WHERE day = $1`, [day])).rows[0];
      const lines = (await t.pool.query("SELECT * FROM gameplay_credit_lines WHERE day = $1 ORDER BY player_id", [day])).rows;
      return { header, lines };
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

const players = (lines: Record<string, unknown>[]) => lines.map((l) => l.player_id as string);

test("cutoff: a session received before the close counts, at or after it never does", { skip: SKIP }, async () => {
  const w = await world("cutoff_edges");
  try {
    for (const u of ["early", "grace", "last-ms", "on-close", "after"]) await w.user(u);
    await w.session("early", "s1", at(D, 19), at(D, 20));
    await w.session("grace", "s1", at(D, 23.5), at(D + 1, 1)); // in the grace window after midnight
    await w.session("last-ms", "s1", at(D, 23), CLOSE(D) - 1);
    await w.session("on-close", "s1", at(D, 23), CLOSE(D));
    await w.session("after", "s1", at(D, 23), CLOSE(D) + 3_600_000);
    w.setClock(CLOSE(D) + 2 * 3_600_000);
    const s = await w.svc.settleDay(D);
    assert.equal(s.status, "settled");
    const { header, lines } = await w.day(D);
    assert.deepEqual(players(lines), ["early", "grace", "last-ms"]);
    assert.equal(Number(header.players), 3);
    assert.equal(Number(header.cutoff_ms), CLOSE(D), "the cutoff is stored with the day");
  } finally {
    await w.t.drop();
  }
});

/** One history, settled on time or three days late with the late upload already in: the closed day is the same. */
async function lateHistory(w: World) {
  for (const u of ["ana", "ben", "late"]) await w.user(u);
  await w.session("ana", "a1", at(D, 8), at(D, 9), [C[0]!, C[1]!]);
  await w.session("ben", "b1", at(D, 18), at(D, 18.5), [C[2]!]);
}

test("delayed scheduler: settling at the close or days later, with a late upload in between, gives the same closed day", { skip: SKIP }, async () => {
  const prompt = await world("cutoff_prompt");
  const delayed = await world("cutoff_delayed");
  try {
    await lateHistory(prompt);
    prompt.setClock(CLOSE(D));
    await prompt.svc.settleDay(D);
    await prompt.session("late", "l1", at(D, 22), CLOSE(D) + 5 * 60_000, [C[3]!]);
    prompt.setClock(CLOSE(D) + 3 * DAY_MS);
    assert.equal((await prompt.svc.settleDay(D)).created, false);
    assert.equal(await prompt.svc.settleDueDays(), 3, "only the later days are settled");

    await lateHistory(delayed);
    await delayed.session("late", "l1", at(D, 22), CLOSE(D) + 5 * 60_000, [C[3]!]);
    delayed.setClock(CLOSE(D) + 3 * DAY_MS);
    assert.equal(await delayed.svc.settleDueDays(), 4);

    const a = await prompt.day(D);
    const b = await delayed.day(D);
    assert.deepEqual(players(b.lines), ["ana", "ben"], "the late upload earns nothing");
    assert.deepEqual(b.header, a.header, "same books, same input digest, same cutoff");
    assert.deepEqual(b.lines, a.lines);
    // The late session's own day is closed: it never counts on a later day either.
    for (const d of [D + 1, D + 2]) assert.deepEqual(players((await delayed.day(d)).lines), []);
    // A replay of the closed day matches what is stored, in both.
    assert.equal((await prompt.svc.verifyDay(D)).inputDigest, a.header.input_digest);
    assert.equal((await delayed.svc.verifyDay(D)).inputDigest, a.header.input_digest);
  } finally {
    await prompt.t.drop();
    await delayed.t.drop();
  }
});

test("late upload repeated: a retry is the same row, a new id is still late, its receipt time cannot be rewritten, and no credit appears", { skip: SKIP }, async () => {
  const w = await world("cutoff_repeat");
  try {
    await lateHistory(w);
    w.setClock(CLOSE(D) + 60_000);
    await w.svc.settleDay(D);
    const before = await w.day(D);
    const id = await w.session("late", "l1", at(D, 22), CLOSE(D) + 10 * 60_000, [C[3]!]);
    // The same session again: the movement pipeline's unique key keeps one row and its receipt time.
    assert.equal(await code(w.session("late", "l1", at(D, 22), at(D, 22.5), [C[3]!])), "23505");
    await w.session("late", "l2", at(D, 22), CLOSE(D) + 20 * 60_000, [C[3]!]);
    for (const sid of ["l1", "l2"]) assert.equal(await code(w.svc.applySession("late", sid)), "day_closed");
    // Pulling it back before the close is refused by the database.
    assert.equal(await code(w.t.pool.query("UPDATE movement_verifications SET created_at = created_at - interval '1 day' WHERE id = $1", [id])), "55000");
    w.setClock(CLOSE(D) + 2 * DAY_MS);
    await w.svc.settleDueDays();
    assert.deepEqual(await w.day(D), before);
    assert.deepEqual((await w.svc.myCredits("late", 1)).days, [], "no retroactive credit, on any day");
    await w.svc.verifyDay(D);
  } finally {
    await w.t.drop();
  }
});

test("active-day multiplier: sessions backdated into the week after their days closed do not raise it", { skip: SKIP }, async () => {
  const honest = await world("cutoff_week_honest");
  const backdated = await world("cutoff_week_backdated");
  try {
    for (const w of [honest, backdated]) {
      await w.user("eve");
      await w.session("eve", "e3", at(D + 3, 10), at(D + 3, 10.5));
    }
    // The same player uploads three sessions dated D to D+2, received on D+3.
    for (const d of [D, D + 1, D + 2]) await backdated.session("eve", `old-${d}`, at(d, 10), at(D + 3, 11));
    for (const w of [honest, backdated]) {
      w.setClock(CLOSE(D + 3));
      await w.svc.settleDueDays();
    }
    // The input digest binds each player's active-day count: equal only if the backdated days were not counted.
    for (const d of [D, D + 1, D + 2, D + 3]) assert.deepEqual((await backdated.day(d)).header, (await honest.day(d)).header, `day ${d}`);
    assert.deepEqual((await backdated.day(D + 3)).lines, (await honest.day(D + 3)).lines);
  } finally {
    await honest.t.drop();
    await backdated.t.drop();
  }
});

test("season boundary: the last day of a season closes on its own receipt cutoff, and a late session does not reach the next season", { skip: SKIP }, async () => {
  const last = D + 89;
  const a = await world("cutoff_season_a");
  const b = await world("cutoff_season_b");
  try {
    for (const w of [a, b]) {
      for (const u of ["gil", "hal"]) await w.user(u);
      await w.session("gil", "g1", at(last, 23), at(last + 1, 1)); // in the grace window, counted for season 1
      await w.session("hal", "h2", at(last + 1, 9), at(last + 1, 9.5));
    }
    await b.session("hal", "h1", at(last, 23), CLOSE(last) + 60_000); // late for the season's last day
    for (const w of [a, b]) {
      w.setClock(CLOSE(last + 1));
      await w.svc.settleDay(last);
      await w.svc.settleDay(last + 1);
    }
    const s1 = await b.day(last);
    const s2 = await b.day(last + 1);
    assert.equal(Number(s1.header.season), 1);
    assert.equal(Number(s2.header.season), 2);
    assert.deepEqual(players(s1.lines), ["gil"]);
    assert.deepEqual(s1.header, (await a.day(last)).header);
    assert.deepEqual(s2.header, (await a.day(last + 1)).header, "nor its active days in the next season");
  } finally {
    await a.t.drop();
    await b.t.drop();
  }
});

test("retry and concurrency: a serialization failure is retried to the same day, concurrent closes write it once", { skip: SKIP }, async () => {
  let failures = 1;
  const flaky = (db: Db): Db => new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "transaction") {
        return (fn: unknown, cfg: unknown) => {
          if (failures > 0) {
            failures -= 1;
            return Promise.reject(Object.assign(new Error("could not serialize access"), { code: "40001" }));
          }
          return (target.transaction as (f: unknown, c: unknown) => Promise<unknown>).call(target, fn, cfg);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  const a = await world("cutoff_retry", flaky);
  const b = await world("cutoff_race");
  try {
    for (const w of [a, b]) await lateHistory(w);
    a.setClock(CLOSE(D));
    const first = await a.svc.settleDay(D);
    assert.equal(failures, 0, "the first attempt failed and was retried");
    assert.equal(first.created, true);
    b.setClock(CLOSE(D));
    const lateRow = b.session("late", "l1", at(D, 23), CLOSE(D) + 1, [C[3]!]);
    const runs = await Promise.all([1, 2, 3, 4, 5].map(() => b.svc.settleDay(D)));
    await lateRow;
    assert.equal(runs.filter((r) => r.created).length, 1);
    assert.deepEqual((await b.day(D)).header, (await a.day(D)).header);
  } finally {
    await a.t.drop();
    await b.t.drop();
  }
});

test("replay fails closed: a session whose receipt predates the close appearing after the day closed changes no book and is reported", { skip: SKIP }, async () => {
  const w = await world("cutoff_replay");
  try {
    await lateHistory(w);
    w.setClock(CLOSE(D) + 60_000);
    await w.svc.settleDay(D);
    const before = await w.day(D);
    // Not reachable through the API (the database sets created_at at insert):
    // a row written directly with a receipt time before the close, as a
    // restored backup or a manual repair could.
    await w.session("late", "l1", at(D, 22), at(D, 23), [C[3]!]);
    assert.equal(await code(w.svc.verifyDay(D)), "closed_day_replay_mismatch");
    assert.equal((await w.svc.settleDay(D)).created, false, "settlement never rewrites a closed day");
    assert.deepEqual(await w.day(D), before);
    assert.equal(await code(w.svc.verifyDay(D + 1)), "day_not_settled");
  } finally {
    await w.t.drop();
  }
});
