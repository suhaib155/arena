/**
 * Day close racing account erasure, and the settlement retry loop, on real
 * PostgreSQL (docs/G34_ERASURE_TOMBSTONES.md section 1.5; the 200-player
 * erasure benchmark of 29 Oct saw settleDay exhaust its retries while ten
 * erasures queued on the fence).
 *
 * Every interleaving here is forced, not hoped for: an erasure is paused by a
 * row lock the test holds on the account, a settlement is paused at a point
 * inside its transaction, and the test waits for a backend to be blocked on a
 * lock (pg_stat_activity) before it lets the other side go. Serialization
 * failures are injected by a trigger inside the settlement transaction, after
 * it has written, so a retried attempt really is rolled back. Backoff runs on
 * injected random, sleep and clock functions.
 *
 * Synthetic users and cells only. Skipped, loudly, without
 * MOVENRUN_TEST_DATABASE_URL.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { gridDisk, latLngToCell } from "h3-js";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { DAY_MS, PILOT_PROPOSAL, dayCloseMs, type GameplayRules } from "./rules.js";
import * as service from "./service.js";
import { GameplayError, GameplayService, type GameplayServiceDeps } from "./service.js";
import { SEALED_LOOP, SEAL_COLUMNS, sealLiteral } from "./sealFixtures.js";
import { createTestDb, type TestDb } from "./pgTestDb.js";
import { createDrizzleAccountDeletionStore } from "../identity/accountDeletion.js";

const DATABASE_URL = process.env.MOVENRUN_TEST_DATABASE_URL;
const SKIP = DATABASE_URL ? false : "MOVENRUN_TEST_DATABASE_URL is not set — settlement against concurrent erasure on PostgreSQL was NOT verified";

const D = Math.floor(Date.UTC(2026, 9, 1) / DAY_MS);
const RULES: GameplayRules = { ...PILOT_PROPOSAL, holding: { ...PILOT_PROPOSAL.holding }, seasonOneStartDay: D };
const at = (day: number, hour: number) => day * DAY_MS + Math.round(hour * 3_600_000);
const CLOSE = (day: number) => dayCloseMs(RULES, day);
const C = gridDisk(latLngToCell(51.5007, -0.1246, 8), 2).sort();

const ANA = "race-walker-ana-31d0";
const BEN = "race-walker-ben-8c4e";
const QUEUED = [1, 2, 3, 4, 5].map((i) => `race-walker-q${i}-e9a7`);
const dialect = new PgDialect();

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
  clock(): number;
  setClock(ms: number): void;
  service(db: Db, deps?: Partial<GameplayServiceDeps>): GameplayService;
  user(id: string): Promise<string>;
  walk(userId: string, sid: string, endMs: number, units: string[]): Promise<void>;
  q<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<T[]>;
}

async function world(prefix: string): Promise<World> {
  const t = await createTestDb(DATABASE_URL!, prefix, { gameplay: true });
  let clock = at(D, 9);
  const make = (db: Db, deps: Partial<GameplayServiceDeps> = {}) => new GameplayService({ db, rules: RULES, now: () => clock, ...deps });
  const w: World = {
    t,
    svc: make(t.db),
    clock: () => clock,
    setClock: (ms) => { clock = ms; },
    service: make,
    async user(id) {
      await t.pool.query("INSERT INTO users (id) VALUES ($1)", [id]);
      await t.pool.query("INSERT INTO auth_identities (id, user_id, provider, provider_subject) VALUES ($1, $2, 'supabase', $3)", [randomUUID(), id, `sub-${id}`]);
      return id;
    },
    async walk(userId, sid, endMs, units) {
      await t.pool.query(
        `INSERT INTO movement_verifications (id, user_id, client_session_id, status, distance_meters, duration_seconds, traversed_hex_ids, start_time, end_time, created_at, ${SEAL_COLUMNS})
         VALUES ($1, $2, $3, 'verified', 3000, 1800, $4, $5, $6, (to_timestamp($7::float8 / 1000) AT TIME ZONE current_setting('TimeZone')), ${sealLiteral(SEALED_LOOP, units)})`,
        [randomUUID(), userId, sid, units, endMs - 1_800_000, endMs, endMs + 60_000]);
      const keep = clock;
      clock = endMs + 120_000;
      try {
        await make(t.db).applySession(userId, sid);
      } finally {
        clock = keep;
      }
    },
    async q(text, values = []) {
      return (await t.pool.query(text, values)).rows;
    },
  };
  return w;
}

/** Every gameplay table (partitions included) holding a row that names `text`. */
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

/** Waits (bounded) until at least `n` backends of this database are blocked on a lock. A condition, not a sleep. */
async function lockWaiters(w: World, n: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [r] = await w.q<{ n: number }>("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'");
    if (r!.n >= n) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${n} backend(s) blocked on a lock (have ${r!.n})`);
    await new Promise((res) => setTimeout(res, 5));
  }
}

async function deadlocks(w: World): Promise<number> {
  const [r] = await w.q<{ n: string }>("SELECT deadlocks::text AS n FROM pg_stat_database WHERE datname = current_database()");
  return Number(r!.n);
}

/** A Db whose serializable transactions call `before(attempt)` first; read-only and other transactions pass through. */
function hooked(db: Db, before: (attempt: number) => Promise<void>, wrapTx?: (tx: unknown) => unknown): { db: Db; attempts: () => number } {
  let attempts = 0;
  const proxy = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop !== "transaction") return Reflect.get(target, prop, receiver);
      return async (fn: (tx: unknown) => Promise<unknown>, cfg?: { isolationLevel?: string }) => {
        const real = target.transaction as (f: unknown, c: unknown) => Promise<unknown>;
        if (cfg?.isolationLevel !== "serializable") return real.call(target, fn, cfg);
        attempts += 1;
        await before(attempts);
        return real.call(target, wrapTx ? (tx: unknown) => fn(wrapTx(tx)) : fn, cfg);
      };
    },
  });
  return { db: proxy, attempts: () => attempts };
}

/** A Db whose serializable transactions fail with 40001 while `failing()` says so. */
function contended(db: Db, failing: () => boolean): { db: Db; attempts: () => number } {
  return hooked(db, async () => {
    if (failing()) throw Object.assign(new Error("could not serialize access due to concurrent update"), { code: "40001" });
  });
}

/** Arms a trigger that raises `errcode` after the next `times` credit-line inserts (inside the settlement transaction, after it wrote). */
async function injectAfterLines(w: World, times: number, errcode = "40001"): Promise<void> {
  await w.q("DROP TRIGGER IF EXISTS test_inject_after_lines ON gameplay_credit_lines");
  await w.q("DROP SEQUENCE IF EXISTS test_inject_seq");
  await w.q("CREATE SEQUENCE test_inject_seq");
  await w.q(`CREATE OR REPLACE FUNCTION test_inject_after_lines() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF nextval('test_inject_seq') <= ${times} THEN RAISE EXCEPTION 'injected failure after the credit lines were written' USING ERRCODE = '${errcode}'; END IF;
      RETURN NULL;
    END $$`);
  await w.q("CREATE TRIGGER test_inject_after_lines AFTER INSERT ON gameplay_credit_lines FOR EACH STATEMENT EXECUTE FUNCTION test_inject_after_lines()");
}

async function dayRows(w: World, day: number): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of ["gameplay_day_settlements", "gameplay_credit_lines", "gameplay_player_day_proofs", "gameplay_club_days", "gameplay_district_days"]) {
    const [r] = await w.q<{ n: number }>(`SELECT count(*)::int AS n FROM ${t} WHERE day = $1`, [day]);
    out[t] = r!.n;
  }
  return out;
}

/** D and D+1 settled with Ana and Ben; then D+2 walked by Ben and by every queued walker. */
async function history(w: World): Promise<void> {
  for (const u of [ANA, BEN, ...QUEUED]) await w.user(u);
  await w.walk(ANA, "a1", at(D, 8), [C[0]!, C[1]!]);
  await w.walk(BEN, "b1", at(D, 8.2), [C[2]!]);
  await w.walk(BEN, "b2", at(D + 1, 8), [C[0]!]);
  await w.walk(ANA, "a2", at(D + 1, 8.5), [C[1]!]);
  w.setClock(CLOSE(D + 1) + 60_000);
  await w.svc.settleDay(D);
  await w.svc.settleDay(D + 1);
  await w.walk(BEN, "b3", at(D + 2, 8), [C[3]!]);
  for (const [i, q] of QUEUED.entries()) await w.walk(q, `q${i}`, at(D + 2, 9 + i * 0.25), [C[4 + i]!, C[10 + i]!]);
}

test("root cause: a day close waiting on the fence is not aborted by each erasure that commits ahead of it (5 erasures, first attempt settles)", { skip: SKIP }, async () => {
  const w = await world("race_queue");
  try {
    await history(w);
    w.setClock(CLOSE(D + 2) + 60_000);
    const dl0 = await deadlocks(w);
    const store = createDrizzleAccountDeletionStore(w.t.db);
    const erasures: Promise<unknown>[] = [];
    const releases: Promise<void>[] = [];
    // Before each settlement attempt: an erasure takes the fence and is held on
    // its account row by the test; once the close is also blocked, the account
    // lock is released and the erasure commits while the close waits.
    const h = hooked(w.t.db, async (attempt) => {
      if (attempt > QUEUED.length) return;
      const who = QUEUED[attempt - 1]!;
      const hold = await w.t.pool.connect();
      await hold.query("BEGIN");
      await hold.query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", [who]);
      erasures.push(store.erase(who));
      await lockWaiters(w, 1);
      releases.push((async () => {
        try {
          await lockWaiters(w, 2);
        } finally {
          await hold.query("COMMIT");
          hold.release();
        }
      })());
    });
    const svc = w.service(h.db, { retrySleep: async () => undefined });
    const result = await svc.settleDay(D + 2).then((r) => ({ ok: true as const, r }), (err: unknown) => ({ ok: false as const, err }));
    await Promise.all(releases);
    const erased = await Promise.all(erasures);
    assert.ok(result.ok, `the close failed: ${result.ok ? "" : String((result as { err: unknown }).err)} after ${h.attempts()} attempt(s)`);
    assert.equal(result.r.created, true);
    assert.equal(h.attempts(), 1, "one attempt: the close waited for the erasure instead of being aborted by it");
    assert.equal(erased.length, 1);
    assert.equal((erased[0] as { users: number }).users, 1);

    // The first queued walker was erased before the day's books were read: no
    // line, no proof, no row anywhere. The rest are erased now, after the close.
    assert.deepEqual(await rowsNaming(w, QUEUED[0]!), []);
    for (const q of QUEUED.slice(1)) assert.equal((await store.erase(q)).users, 1);
    const [state] = await w.q<{ erasures: number; tombstones: number; all_pre_verified: boolean }>(
      "SELECT erasures, tombstones, all_pre_verified FROM gameplay_erasure_days WHERE day = $1", [D + 2]);
    assert.deepEqual({ ...state }, { erasures: 4, tombstones: 4, all_pre_verified: true });
    const [header] = await w.q<{ players: number }>("SELECT players FROM gameplay_day_settlements WHERE day = $1", [D + 2]);
    const lines = await w.q<{ player_id: string | null }>("SELECT player_id FROM gameplay_credit_lines WHERE day = $1 ORDER BY line_key", [D + 2]);
    assert.equal(lines.length, header!.players);
    assert.equal(lines.filter((l) => l.player_id === null).length, 4, "the four walkers erased after the close are tombstones");
    assert.ok(lines.filter((l) => l.player_id !== null).every((l) => l.player_id === ANA || l.player_id === BEN), "everyone else named is Ana or Ben");
    assert.ok(lines.some((l) => l.player_id === BEN));
    for (const d of [D, D + 1, D + 2]) await w.svc.verifyDay(d);
    for (const q of QUEUED) assert.deepEqual(await rowsNaming(w, q), []);
    assert.equal((await w.svc.settlementStatus()).halted, false);
    assert.equal(await deadlocks(w), dl0, "no 40P01");
  } finally {
    await w.t.drop();
  }
});

test("erasure before, during and after a day close: each day settles once, replays, and keeps nothing naming the walker", { skip: SKIP }, async () => {
  const w = await world("race_phases");
  try {
    await history(w);
    const [before, during, after] = QUEUED;
    await w.walk(BEN, "b4", at(D + 3, 8), [C[3]!]);
    await w.walk(during!, "d4", at(D + 3, 9), [C[7]!]);
    await w.walk(BEN, "b5", at(D + 4, 8), [C[3]!]);
    await w.walk(after!, "f5", at(D + 4, 9), [C[8]!]);
    w.setClock(CLOSE(D + 4) + 60_000);
    const store = createDrizzleAccountDeletionStore(w.t.db);
    const dl0 = await deadlocks(w);

    // Before: erased, then D+2 closes without them.
    assert.equal((await store.erase(before!)).users, 1);
    await w.svc.settleDay(D + 2);
    assert.deepEqual(await rowsNaming(w, before!), []);

    // During: D+3's close is paused after writing its credit lines; the erasure starts then and must wait for it.
    let paused!: () => void;
    let resume!: () => void;
    const atPause = new Promise<void>((r) => { paused = r; });
    const go = new Promise<void>((r) => { resume = r; });
    const pauseAfterLines = (tx: unknown) => new Proxy(tx as object, {
      get(target, prop, receiver) {
        const v = Reflect.get(target, prop, receiver);
        if (prop !== "execute") return v;
        return async (q: SQL) => {
          const r = await (v as (q: SQL) => Promise<unknown>).call(target, q);
          if (/INSERT INTO gameplay_credit_lines/.test(dialect.sqlToQuery(q).sql)) { paused(); await go; }
          return r;
        };
      },
    });
    const h = hooked(w.t.db, async () => undefined, pauseAfterLines);
    const closing = w.service(h.db).settleDay(D + 3);
    await atPause;
    const erasing = store.erase(during!);
    await lockWaiters(w, 1);
    resume();
    const [closed, erased] = await Promise.all([closing, erasing]);
    assert.equal(closed.created, true);
    assert.equal(erased.users, 1);
    assert.equal(h.attempts(), 1);
    const [s3] = await w.q<{ erasures: number; tombstones: number }>("SELECT erasures, tombstones FROM gameplay_erasure_days WHERE day = $1", [D + 3]);
    assert.deepEqual({ ...s3 }, { erasures: 1, tombstones: 1 }, "the erasure ran after the close and tombstoned their D+3 line");

    // After: D+4 closes, then the walker is erased.
    await w.svc.settleDay(D + 4);
    assert.equal((await store.erase(after!)).users, 1);
    const [s4] = await w.q<{ erasures: number; tombstones: number }>("SELECT erasures, tombstones FROM gameplay_erasure_days WHERE day = $1", [D + 4]);
    assert.deepEqual({ ...s4 }, { erasures: 1, tombstones: 1 });

    for (let d = D; d <= D + 4; d++) await w.svc.verifyDayOrHalt(d);
    for (const who of [before!, during!, after!]) assert.deepEqual(await rowsNaming(w, who), []);
    for (let d = D; d <= D + 4; d++) assert.equal((await dayRows(w, d)).gameplay_day_settlements, 1);
    assert.equal((await w.svc.settlementStatus()).halted, false);
    assert.equal(await deadlocks(w), dl0, "no 40P01");
  } finally {
    await w.t.drop();
  }
});

test("exactly once: a 40001 after the lines were written is rolled back whole and retried with backoff; concurrent closes write the day once", { skip: SKIP }, async () => {
  const w = await world("race_once");
  try {
    await history(w);
    await w.walk(BEN, "b4", at(D + 3, 8), [C[3]!]);
    await w.walk(ANA, "a4", at(D + 3, 9), [C[9]!]);
    w.setClock(CLOSE(D + 3) + 60_000);
    const sleeps: number[] = [];
    const svc = w.service(w.t.db, { retryRandom: () => 0.5, retrySleep: async (ms: number) => { sleeps.push(ms); } });

    await injectAfterLines(w, 2);
    const first = await svc.settleDay(D + 2);
    assert.equal(first.created, true);
    assert.equal(sleeps.length, 2, "two injected failures, two backoff waits");
    const rows2 = await dayRows(w, D + 2);
    assert.equal(rows2.gameplay_day_settlements, 1);
    assert.equal(rows2.gameplay_credit_lines, first.players, "one line per player, none duplicated");
    const lines = await w.q<{ k: string }>("SELECT line_key AS k FROM gameplay_credit_lines WHERE day = $1", [D + 2]);
    assert.equal(new Set(lines.map((l) => l.k)).size, lines.length);
    const digest = (await w.svc.verifyDay(D + 2)).inputDigest;
    const again = await svc.settleDay(D + 2);
    assert.equal(again.created, false);
    assert.deepEqual({ ...again, created: true }, first, "a settled day is returned as stored");
    assert.equal((await w.svc.verifyDay(D + 2)).inputDigest, digest);

    // Five concurrent closes of one day, with one injected failure among them: one creates it.
    sleeps.length = 0;
    await injectAfterLines(w, 1);
    const runs = await Promise.all([1, 2, 3, 4, 5].map(() => svc.settleDay(D + 3)));
    assert.equal(runs.filter((r) => r.created).length, 1);
    assert.equal((await dayRows(w, D + 3)).gameplay_credit_lines, runs[0]!.players);
    await w.svc.verifyDay(D + 3);
    assert.equal((await w.svc.settlementStatus()).halted, false);
  } finally {
    await w.t.drop();
  }
});

test("bounded backoff: capped exponential with full jitter on injected random, sleep and clock; a hard cap on attempts and on total time; a typed outcome the day-close loop retries", { skip: SKIP }, async () => {
  const w = await world("race_backoff");
  try {
    await history(w);
    w.setClock(CLOSE(D + 2) + 60_000);
    let failing = true;
    const c = contended(w.t.db, () => failing);
    const randoms = [0, 0.5, 0.999, 0.25, 0.75, 0.75];
    let fake = 1_000;
    const sleeps: number[] = [];
    const deps = {
      settlementRetry: { maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 1_000, maxTotalMs: 60_000 },
      retryRandom: () => randoms.shift()!,
      retrySleep: async (ms: number) => { sleeps.push(ms); fake += ms; },
      retryClock: () => fake,
    };
    const svc = w.service(c.db, deps);
    const err = await svc.settleDay(D + 2).then(() => undefined, (e: unknown) => e);
    assert.ok(err instanceof service.SettlementRetryExhaustedError, `typed exhaustion, got ${String(err)}`);
    assert.equal(err.code, "settlement_retry_exhausted");
    assert.equal(err.status, 503);
    assert.equal(err.day, D + 2);
    assert.equal(err.attempts, 5);
    assert.equal(err.lastCode, "40001");
    assert.equal(err.reason, "attempts");
    assert.equal(c.attempts(), 5, "hard cap on attempts");
    // Retry n waits floor(random * min(1000, 100 * 2^(n-1))) ms; no wait after the last attempt.
    assert.deepEqual(sleeps, [0, 100, 399, 200]);
    assert.equal((await dayRows(w, D + 2)).gameplay_day_settlements, 0);

    // Total time: the next wait would pass 250 ms, so it gives up after two attempts.
    sleeps.length = 0;
    const timed = w.service(contended(w.t.db, () => true).db, {
      ...deps, settlementRetry: { maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 1_000, maxTotalMs: 250 }, retryRandom: () => 0.99,
    });
    const terr = await timed.settleDay(D + 2).then(() => undefined, (e: unknown) => e);
    assert.ok(terr instanceof service.SettlementRetryExhaustedError);
    assert.equal(terr.reason, "time");
    assert.equal(terr.attempts, 2);
    assert.deepEqual(sleeps, [99]);
    assert.throws(() => w.service(w.t.db, { settlementRetry: { maxAttempts: 0 } }), /settlement retry/);
    assert.throws(() => w.service(w.t.db, { settlementRetry: { maxAttempts: 51 } }), /settlement retry/);

    // The day-close loop reports the same typed outcome and leaves the day due; its next run settles it.
    const loop = w.service(c.db, { ...deps, retryRandom: () => 0, retrySleep: async () => undefined });
    const lerr = await loop.settleDueDays().then(() => undefined, (e: unknown) => e);
    assert.ok(lerr instanceof service.SettlementRetryExhaustedError);
    assert.equal((await dayRows(w, D + 2)).gameplay_day_settlements, 0);
    failing = false;
    assert.equal(await loop.settleDueDays(), 1);
    await w.svc.verifyDay(D + 2);
  } finally {
    await w.t.drop();
  }
});

test("safe failure: exhausted retries leave nothing half-settled and raise no halt; a non-contention error is not retried; a real replay mismatch still halts", { skip: SKIP }, async () => {
  const w = await world("race_safe");
  try {
    await history(w);
    w.setClock(CLOSE(D + 2) + 60_000);
    const sleeps: number[] = [];
    const svc = w.service(w.t.db, { retryRandom: () => 0.5, retrySleep: async (ms: number) => { sleeps.push(ms); } });

    // Every attempt writes its header, lines and proofs and then fails with 40001.
    await injectAfterLines(w, 1_000);
    const err = await svc.settleDay(D + 2).then(() => undefined, (e: unknown) => e);
    assert.ok(err instanceof service.SettlementRetryExhaustedError, `typed exhaustion, got ${String(err)}`);
    assert.deepEqual(await dayRows(w, D + 2), {
      gameplay_day_settlements: 0, gameplay_credit_lines: 0, gameplay_player_day_proofs: 0, gameplay_club_days: 0, gameplay_district_days: 0,
    }, "nothing of the day survives a rolled-back attempt");
    assert.equal((await w.svc.settlementStatus()).halted, false, "a transient serialization failure never halts settlement");

    // A failure that is not contention is raised at once, untouched, and not retried.
    sleeps.length = 0;
    await injectAfterLines(w, 1, "23514");
    assert.equal(await code(svc.settleDay(D + 2)), "23514");
    assert.equal(sleeps.length, 0);
    assert.equal((await dayRows(w, D + 2)).gameplay_day_settlements, 0);

    // The day is still due and settles normally once the contention is gone.
    await w.q("DROP TRIGGER test_inject_after_lines ON gameplay_credit_lines");
    assert.equal((await svc.settleDay(D + 2)).created, true);
    for (const d of [D, D + 1, D + 2]) await w.svc.verifyDayOrHalt(d);
    assert.equal((await w.svc.settlementStatus()).halted, false);

    // A real invariant failure (a closed day whose inputs were edited) still halts.
    await w.q("UPDATE movement_verifications SET distance_meters = 9000 WHERE user_id = $1", [BEN]);
    assert.equal(await code(w.svc.verifyDayOrHalt(D)), "closed_day_replay_mismatch");
    assert.equal((await w.svc.settlementStatus()).halted, true);
  } finally {
    await w.t.drop();
  }
});
