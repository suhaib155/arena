/**
 * The durable account erasure queue on real PostgreSQL
 * (docs/G34_ERASURE_QUEUE.md): acceptance, the worker's lease and retry
 * loop, crash recovery, races with day close and sign-in, provider outage,
 * and the gameplay-off / no-0011 paths.
 *
 * Interleavings are forced (a lock the test holds, a backend the test
 * terminates, a lease the test lets expire), never hoped for. Synthetic
 * users, subjects and cells only; no provider is called (a stand-in records
 * what would be removed). Skipped, loudly, without MOVENRUN_TEST_DATABASE_URL.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { gridDisk, latLngToCell } from "h3-js";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Db } from "../db/client.js";
import { DAY_MS, PILOT_PROPOSAL, dayCloseMs, type GameplayRules } from "../gameplay/rules.js";
import { GameplayService } from "../gameplay/service.js";
import { SEALED_LOOP, SEAL_COLUMNS, sealLiteral } from "../gameplay/sealFixtures.js";
import { createTestDb, type TestDb } from "../gameplay/pgTestDb.js";
import * as deletion from "./accountDeletion.js";
import type * as workerTypes from "./erasureWorker.js";
import { createDrizzleStores } from "./repositories/drizzle/stores.js";
import { createIdentityServices } from "./http/wiring.js";
import { resolveIdentityConfig } from "./config.js";
import { isIdentityError } from "./domain/errors.js";

const DATABASE_URL = process.env.MOVENRUN_TEST_DATABASE_URL;
const SKIP = DATABASE_URL ? false : "MOVENRUN_TEST_DATABASE_URL is not set — the account erasure queue on PostgreSQL was NOT verified";

const D = Math.floor(Date.UTC(2026, 9, 1) / DAY_MS);
const RULES: GameplayRules = { ...PILOT_PROPOSAL, holding: { ...PILOT_PROPOSAL.holding }, seasonOneStartDay: D };
const at = (day: number, hour: number) => day * DAY_MS + Math.round(hour * 3_600_000);
const C = gridDisk(latLngToCell(51.5007, -0.1246, 8), 2).sort();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Loaded dynamically so this file also runs on a base without the queue, where
// every test fails on an assertion rather than the whole file on an import.
const jobs = (await import("../gameplay/erasureJobs.js").catch(() => ({}))) as typeof import("../gameplay/erasureJobs.js");
const workerModule = (await import("./erasureWorker.js").catch(() => ({}))) as typeof import("./erasureWorker.js");
const store = (db: Db, opts?: Record<string, unknown>) =>
  (deletion.createDrizzleAccountDeletionStore as (db: Db, o?: unknown) => deletion.DrizzleAccountDeletionStore)(db, opts);
const QUEUED = { queue: { onAccepted: () => undefined } };
const FAST = { baseDelayMs: 20, maxDelayMs: 40, maxAttempts: 5, leaseMs: 60_000, lockTimeoutMs: 200 };

function makeWorker(db: Db, s: deletion.DrizzleAccountDeletionStore, extra: Partial<workerTypes.ErasureWorkerDeps> = {}) {
  const events: workerTypes.ErasureWorkerEvent[] = [];
  const create = (workerModule as Partial<typeof workerTypes>).createErasureWorker;
  assert.ok(create, "the erasure worker exists");
  const w = create({ db, store: s, policy: FAST, random: () => 0.5, log: { info: () => undefined, warn: () => undefined }, onEvent: (e) => events.push(e), ...extra });
  return { w, events };
}

interface World {
  t: TestDb;
  clock: { ms: number };
  svc: GameplayService;
  q<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<T[]>;
  user(id: string): Promise<string>;
  walk(userId: string, sid: string, endMs: number, units: string[]): Promise<void>;
}

async function world(prefix: string, gameplay = true): Promise<World> {
  const t = await createTestDb(DATABASE_URL!, prefix, { gameplay });
  const clock = { ms: at(D, 9) };
  const svc = new GameplayService({ db: t.db, rules: RULES, now: () => clock.ms });
  const w: World = {
    t, clock, svc,
    async q(text, values = []) { return (await t.pool.query(text, values)).rows; },
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
      const keep = clock.ms;
      clock.ms = endMs + 120_000;
      try { await svc.applySession(userId, sid); } finally { clock.ms = keep; }
    },
  };
  return w;
}

/** Two walkers with settled history, plus `extra` walkers who walked an unsettled closed day. */
async function history(w: World, extra: string[]): Promise<void> {
  for (const u of ["q-ana-71c2", "q-ben-0d5e", ...extra]) await w.user(u);
  await w.walk("q-ana-71c2", "a1", at(D, 8), [C[0]!, C[1]!]);
  await w.walk("q-ben-0d5e", "b1", at(D, 8.2), [C[2]!]);
  await w.walk("q-ben-0d5e", "b2", at(D + 1, 8), [C[0]!]);
  for (const [i, u] of extra.entries()) await w.walk(u, `x${i}a`, at(D + 1, 9 + i * 0.1), [C[3 + (i % 10)]!, C[1]!]);
  w.clock.ms = dayCloseMs(RULES, D + 1) + 60_000;
  await w.svc.settleDay(D);
  await w.svc.settleDay(D + 1);
  for (const [i, u] of extra.entries()) await w.walk(u, `x${i}b`, at(D + 2, 9 + i * 0.1), [C[4 + (i % 10)]!]);
  await w.walk("q-ben-0d5e", "b3", at(D + 2, 8), [C[3]!]);
  w.clock.ms = dayCloseMs(RULES, D + 2) + 60_000;
}

async function rowsNaming(w: World, text: string): Promise<string[]> {
  const tables = await w.q<{ t: string }>(`SELECT format('%I.%I', schemaname, tablename) AS t FROM pg_tables
    WHERE (schemaname = 'public' AND (tablename LIKE 'gameplay\\_%' OR tablename IN ('users','auth_identities','auth_sessions','movement_verifications','security_audit_events')))
       OR schemaname = 'gameplay_partitions' ORDER BY 1`);
  const hits: string[] = [];
  for (const { t } of tables) {
    const [n] = await w.q<{ n: number }>(`SELECT count(*)::int AS n FROM ${t} x WHERE x::text LIKE '%' || $1 || '%'`, [text]);
    if (n!.n > 0) hits.push(t);
  }
  return hits;
}

async function lockWaiters(w: World, n: number, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [r] = await w.q<{ n: number }>("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'");
    if (r!.n >= n) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${n} lock waiter(s)`);
    await sleep(5);
  }
}

async function deadlocks(w: World): Promise<number> {
  const [r] = await w.q<{ n: string }>("SELECT deadlocks::text AS n FROM pg_stat_database WHERE datname = current_database()");
  return Number(r!.n);
}

async function job(w: World, id: string) {
  const [r] = await w.q<{ state: string; user_id: string | null; attempts: number; last_outcome: string | null; provider_stage: string | null; due_in_ms: number }>(
    "SELECT state, user_id, attempts, last_outcome, provider_stage, (extract(epoch FROM next_attempt_at - now()) * 1000)::float8 AS due_in_ms FROM gameplay_account_deletion_jobs WHERE id = $1", [id]);
  return r;
}

async function makeDue(w: World): Promise<void> {
  await w.q("UPDATE gameplay_account_deletion_jobs SET next_attempt_at = now() WHERE state = 'pending'");
}

/** A held SHARE lock on the fence: what a long day close holds. */
async function holdFence(w: World) {
  const c = await w.t.pool.connect();
  await c.query("BEGIN");
  await c.query("LOCK TABLE gameplay_erasure_fence IN SHARE MODE");
  return { async release() { await c.query("COMMIT"); c.release(); } };
}

test("accepted, not deleted: the request commits a job and signs the account out; the worker erases it and completes the job in the same transaction", { skip: SKIP }, async () => {
  const w = await world("erq_accept");
  try {
    const who = "q-walker-a1f0";
    await history(w, [who]);
    await w.q("INSERT INTO auth_sessions (id, user_id, family_id, assurance_level, refresh_token_hash, security_version, expires_at, last_authenticated_at) VALUES ($1, $2, $3, 'aal2', $4, 0, now() + interval '1 day', now())",
      [randomUUID(), who, randomUUID(), "h".repeat(43)]);
    const s = store(w.t.db, QUEUED);
    assert.equal(typeof s.request, "function", "the store accepts requests");
    const out = await s.request(who);
    assert.equal(out.status, "pending", "a queued deletion is reported as pending, never as completed");
    const requestId = (out as { requestId: string }).requestId;
    assert.match(requestId, /^[0-9a-f-]{36}$/);
    const [u] = await w.q<{ status: string; security_version: number }>("SELECT status, security_version FROM users WHERE id = $1", [who]);
    assert.deepEqual({ ...u }, { status: "deleting", security_version: 1 });
    assert.equal((await w.q("SELECT 1 FROM auth_sessions WHERE user_id = $1", [who])).length, 0, "signed out everywhere at acceptance");
    assert.ok((await w.q("SELECT 1 FROM gameplay_applied_sessions WHERE user_id = $1", [who])).length > 0, "nothing erased yet");
    assert.deepEqual(await s.status(requestId), { status: "pending", delayed: false, signInRecord: "pending" });
    assert.equal((await job(w, requestId))!.state, "pending");

    const { w: worker, events } = makeWorker(w.t.db, s);
    assert.equal(await worker.drain(), 1);
    assert.deepEqual(events.map((e) => e.kind), ["completed"]);
    const j = (await job(w, requestId))!;
    assert.equal(j.state, "completed");
    assert.equal(j.user_id, null, "a completed job forgets whose it was");
    // Unlinkable from the books: the job table has no day, no tombstone and no
    // player column, so a completed row cannot order or group anyone's days
    // (its times record the request, as the account_deleted audit row does).
    const cols = (await w.q<{ c: string }>("SELECT column_name AS c FROM information_schema.columns WHERE table_name = 'gameplay_account_deletion_jobs' ORDER BY ordinal_position")).map((r) => r.c);
    assert.deepEqual(cols, ["id", "user_id", "state", "attempts", "requested_at", "next_attempt_at", "lease_token", "lease_expires_at", "last_outcome", "provider_stage", "attention_at", "completed_at"]);
    assert.equal(j.provider_stage, "queued", "no provider client wired: the sign-in record stays queued");
    assert.deepEqual(await s.status(requestId), { status: "completed", delayed: false, signInRecord: "pending" });
    assert.deepEqual(await rowsNaming(w, who), []);
    assert.equal((await w.q("SELECT 1 FROM pending_auth_user_deletions WHERE subject = $1", [`sub-${who}`])).length, 1);
    for (const d of [D, D + 1]) await w.svc.verifyDay(d);
    // Draining again does nothing: no second completion.
    assert.equal(await worker.drain(), 0);
    assert.equal((await w.q("SELECT 1 FROM security_audit_events WHERE event_type = 'account_deleted'")).length, 1);
  } finally {
    await w.t.drop();
  }
});

test("10 s client budget, queued: acceptance answers while a day close holds the fence (it takes no gameplay lock)", { skip: SKIP }, async () => {
  const w = await world("erq_budget_q");
  try {
    await history(w, ["q-walker-b2c1"]);
    const fence = await holdFence(w);
    try {
      const t0 = Date.now();
      const out = await store(w.t.db, QUEUED).request?.("q-walker-b2c1");
      assert.equal(out?.status, "pending");
      assert.ok(Date.now() - t0 < 2_000, `acceptance took ${Date.now() - t0} ms behind a held fence`);
    } finally {
      await fence.release();
    }
  } finally {
    await w.t.drop();
  }
});

test("10 s client budget, synchronous: behind a fence held past the lock budget the erasure gives up with a typed busy error and writes nothing", { skip: SKIP }, async () => {
  const w = await world("erq_budget_s");
  try {
    await history(w, ["q-walker-b2c2"]);
    const fence = await holdFence(w);
    // A day close that ends on its own after 3 s, so a base without a lock
    // budget waits it out instead of hanging the test.
    const releasing = sleep(3_000).then(() => fence.release());
    try {
      const sync = store(w.t.db, { lockTimeoutMs: 300 });
      const t1 = Date.now();
      const err = await sync.erase("q-walker-b2c2").then(() => null, (e: unknown) => e);
      const took = Date.now() - t1;
      assert.ok(err, `the synchronous erasure waited ${took} ms for the fence instead of giving up within its lock budget`);
      const Busy = (deletion as { ErasureBusyError?: new (...a: never[]) => Error }).ErasureBusyError;
      assert.ok(Busy && err instanceof Busy, `typed busy error, got ${String(err)}`);
      assert.equal((err as unknown as { reason: string }).reason, "lock_timeout");
      assert.ok(took < 2_000, `gave up after ${took} ms`);
      const [u] = await w.q<{ status: string }>("SELECT status FROM users WHERE id = $1", ["q-walker-b2c2"]);
      assert.equal(u?.status, "active", "nothing was written");
    } finally {
      await releasing;
    }
  } finally {
    await w.t.drop();
  }
});

test("acceptance does not wait for a key-share lock on the account (a push or day close in flight): it answers at once with one job, and duplicates still share it", { skip: SKIP }, async () => {
  const w = await world("erq_keyshare");
  try {
    const who = "q-walker-k5h1";
    await history(w, [who]);
    // What a push's foreign-key check (or a day close reading the account) holds.
    const hold = await w.t.pool.connect();
    await hold.query("BEGIN");
    await hold.query("SELECT 1 FROM users WHERE id = $1 FOR KEY SHARE", [who]);
    try {
      const s = store(w.t.db, QUEUED);
      const t0 = Date.now();
      const outs = await Promise.all([s.request(who), s.request(who), s.request(who)]);
      const took = Date.now() - t0;
      assert.ok(outs.every((o) => o.status === "pending"), JSON.stringify(outs));
      assert.equal(new Set(outs.map((o) => (o as { requestId: string }).requestId)).size, 1, "one job");
      assert.ok(took < 1_000, `acceptance waited ${took} ms behind a key-share lock`);
      assert.equal((await w.q("SELECT 1 FROM gameplay_account_deletion_jobs")).length, 1);
    } finally {
      await hold.query("COMMIT");
      hold.release();
    }
    // The erasure itself (FOR UPDATE) still conflicts with key share: it ran after the holder let go.
    const { w: worker } = makeWorker(w.t.db, store(w.t.db, QUEUED));
    assert.equal(await worker.drain(), 1);
    assert.deepEqual(await rowsNaming(w, who), []);
  } finally {
    await w.t.drop();
  }
});

test("flag on but no 0011: the worker probes for the job table and never queries it", { skip: SKIP }, async () => {
  const w = await world("erq_noq_worker", false);
  try {
    const seen: string[] = [];
    const proxied = new Proxy(w.t.db, {
      get(target, prop, receiver) {
        if (prop === "execute") return (q: unknown) => { seen.push(JSON.stringify(q)); return target.execute(q as never); };
        return Reflect.get(target, prop, receiver);
      },
    }) as Db;
    const { w: worker } = makeWorker(proxied, store(proxied, QUEUED));
    assert.equal(await worker.drain(), 0);
    assert.equal(await worker.drain(), 0);
    const naming = seen.filter((q) => /gameplay_/.test(q));
    assert.ok(naming.length > 0 && naming.every((q) => /to_regclass/.test(q)), `only catalogue probes: ${naming.join(" | ")}`);
  } finally {
    await w.t.drop();
  }
});

test("lock held beyond the budget: the attempt is a typed lock_timeout, rolled back and rescheduled with backoff; it completes once the lock is gone", { skip: SKIP }, async () => {
  const w = await world("erq_lock");
  try {
    const who = "q-walker-c3d4";
    await history(w, [who]);
    const s = store(w.t.db, QUEUED);
    const { requestId } = (await s.request(who)) as { requestId: string };
    const { w: worker, events } = makeWorker(w.t.db, s);
    const fence = await holdFence(w);
    try {
      assert.equal(await worker.drain(), 0);
    } finally {
      await fence.release();
    }
    assert.deepEqual(events.map((e) => `${e.kind}:${"outcome" in e ? e.outcome : ""}`), ["retry:lock_timeout"]);
    const j = (await job(w, requestId))!;
    assert.equal(j.state, "pending");
    assert.equal(j.attempts, 1);
    assert.equal(j.last_outcome, "lock_timeout");
    assert.ok(j.due_in_ms > 0, "the next attempt waits");
    assert.ok((await w.q("SELECT 1 FROM gameplay_applied_sessions WHERE user_id = $1", [who])).length > 0, "nothing erased by the failed attempt");
    assert.deepEqual(await s.status(requestId), { status: "pending", delayed: true, signInRecord: "pending" });
    await sleep(60);
    assert.equal(await worker.drain(), 1);
    assert.equal((await job(w, requestId))!.state, "completed");
    assert.deepEqual(await rowsNaming(w, who), []);
  } finally {
    await w.t.drop();
  }
});

test("duplicate requests: concurrent and repeated requests for one account share one job and one completion", { skip: SKIP }, async () => {
  const w = await world("erq_dup");
  try {
    const who = "q-walker-d5e6";
    await history(w, [who]);
    const s = store(w.t.db, QUEUED);
    const outs = await Promise.all(Array.from({ length: 6 }, () => s.request(who)));
    const ids = new Set(outs.map((o) => (o as { requestId?: string }).requestId));
    assert.equal(ids.size, 1, `one job id, got ${[...ids].join(",")}`);
    assert.ok(outs.every((o) => o.status === "pending"));
    assert.equal((await w.q("SELECT 1 FROM gameplay_account_deletion_jobs")).length, 1);
    const { w: worker } = makeWorker(w.t.db, s);
    await worker.drain();
    const again = await s.request(who);
    assert.equal(again.status, "completed", "after completion the account is gone: an idempotent completed with zero counts");
    assert.equal((again as { result: { users: number } }).result.users, 0);
    assert.equal((await w.q("SELECT 1 FROM gameplay_account_deletion_jobs")).length, 1);
    assert.equal((await w.q("SELECT 1 FROM security_audit_events WHERE event_type = 'account_deleted'")).length, 1);
  } finally {
    await w.t.drop();
  }
});

test("two workers, one job: concurrent claims hand it to exactly one; concurrent drains complete it once", { skip: SKIP }, async () => {
  const w = await world("erq_claim");
  try {
    const who = "q-walker-e7f8";
    await history(w, [who]);
    const s = store(w.t.db, QUEUED);
    await s.request(who);
    const claims = await Promise.all(Array.from({ length: 8 }, () => jobs.claimErasureJob(w.t.db, 60_000)));
    assert.equal(claims.filter(Boolean).length, 1, "SKIP LOCKED: one claim");
    await w.q("UPDATE gameplay_account_deletion_jobs SET state = 'pending', lease_token = NULL, lease_expires_at = NULL");
    const a = makeWorker(w.t.db, s);
    const b = makeWorker(w.t.db, s);
    const done = await Promise.all([a.w.drain(), b.w.drain()]);
    assert.equal(done[0]! + done[1]!, 1);
    assert.equal([...a.events, ...b.events].filter((e) => e.kind === "completed").length, 1);
    assert.equal((await w.q("SELECT 1 FROM security_audit_events WHERE event_type = 'account_deleted'")).length, 1);
    assert.deepEqual(await rowsNaming(w, who), []);
  } finally {
    await w.t.drop();
  }
});

test("crash between claim and commit: an abandoned lease is taken over after it expires; the stale worker's late attempt is refused and rolls back", { skip: SKIP }, async () => {
  const w = await world("erq_crash");
  try {
    const who = "q-walker-f9a0";
    await history(w, [who]);
    const s = store(w.t.db, QUEUED);
    const { requestId } = (await s.request(who)) as { requestId: string };
    // Worker A claims with a short lease and "dies" (never attempts).
    const stale = await jobs.claimErasureJob(w.t.db, 300);
    assert.ok(stale);
    const { w: b, events } = makeWorker(w.t.db, s);
    assert.equal(await b.drain(), 0, "a live lease is not taken");
    await sleep(400);
    assert.equal(await b.drain(), 1, "the expired lease is taken over");
    assert.equal(events[0]!.kind, "completed");
    assert.equal((events[0] as { attempts: number }).attempts, 2);
    // A wakes up and tries to finish: its lease is gone, nothing is written twice.
    const late = await s.eraseJob(stale!, 200).then(() => null, (e: unknown) => e);
    assert.equal(jobs.classifyErasureError(late), "lease_lost");
    assert.equal((await w.q("SELECT 1 FROM security_audit_events WHERE event_type = 'account_deleted'")).length, 1);
    assert.equal((await job(w, requestId))!.state, "completed");
  } finally {
    await w.t.drop();
  }
});

test("crash mid-transaction: a worker whose backend dies while it waits inside the erasure leaves nothing committed; the job is retried and completes", { skip: SKIP }, async () => {
  const w = await world("erq_kill");
  const after: (() => Promise<void>)[] = [];
  try {
    const who = "q-walker-0b1c";
    await history(w, [who]);
    const s = store(w.t.db, QUEUED);
    const { requestId } = (await s.request(who)) as { requestId: string };
    const hold = await w.t.pool.connect();
    await hold.query("BEGIN");
    await hold.query("SELECT 1 FROM users WHERE id = $1 FOR KEY SHARE", [who]);
    // The worker's own pool, with an error listener on every client: a backend
    // killed while its client is checked out must surface as a failed query,
    // not as an unhandled 'error' event.
    const pool = new pg.Pool({ connectionString: (w.t.pool as unknown as { options: { connectionString: string } }).options.connectionString, max: 4 });
    pool.on("error", () => undefined);
    pool.on("connect", (c) => { c.on("error", () => undefined); });
    after.push(() => pool.end());
    const wdb = drizzle(pool) as unknown as Db;
    const { w: worker, events } = makeWorker(wdb, store(wdb, QUEUED), { policy: { ...FAST, lockTimeoutMs: 30_000 } });
    const run = worker.drain();
    await lockWaiters(w, 1);
    // The worker's backend holds the fence and waits on the account row: kill it.
    await w.q("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'");
    await run;
    await hold.query("COMMIT");
    hold.release();
    assert.equal(events[0]!.kind, "retry");
    assert.equal((events[0] as { outcome: string }).outcome, "connection");
    const j = (await job(w, requestId))!;
    assert.equal(j.state, "pending");
    assert.ok((await w.q("SELECT 1 FROM gameplay_applied_sessions WHERE user_id = $1", [who])).length > 0, "nothing committed");
    const [fence] = await w.q<{ erasures: string }>("SELECT erasures::text FROM gameplay_erasure_fence");
    assert.equal(fence!.erasures, "0", "the killed transaction's fence update rolled back");
    await makeDue(w);
    assert.equal(await worker.drain(), 1);
    assert.deepEqual(await rowsNaming(w, who), []);
  } finally {
    for (const f of after) await f();
    await w.t.drop();
  }
});

test("settlement against queued erasure: closes and the worker run together; each day settles once, every day replays, no deadlock", { skip: SKIP }, async () => {
  const w = await world("erq_settle");
  try {
    const walkers = ["q-walker-1a", "q-walker-2b", "q-walker-3c", "q-walker-4d", "q-walker-5e"];
    await history(w, walkers);
    // One more closed, unsettled day.
    await w.walk("q-ben-0d5e", "b4", at(D + 3, 8), [C[3]!]);
    for (const [i, u] of walkers.entries()) await w.walk(u, `x${i}c`, at(D + 3, 9 + i * 0.1), [C[5 + i]!]);
    w.clock.ms = dayCloseMs(RULES, D + 3) + 60_000;
    const dl0 = await deadlocks(w);
    const s = store(w.t.db, QUEUED);
    for (const u of walkers) assert.equal((await s.request(u)).status, "pending");
    const { w: worker, events } = makeWorker(w.t.db, s, { policy: { ...FAST, lockTimeoutMs: 5_000 } });
    const [closed, done] = await Promise.all([
      (async () => { const out = []; for (const d of [D + 2, D + 3]) out.push(await w.svc.settleDay(d)); return out; })(),
      worker.drain(),
    ]);
    await makeDue(w);
    const more = await worker.drain();
    assert.equal(done + more, walkers.length, `events ${JSON.stringify(events)}`);
    assert.equal(closed.length, 2);
    for (const d of [D, D + 1, D + 2, D + 3]) {
      assert.equal((await w.q("SELECT 1 FROM gameplay_day_settlements WHERE day = $1", [d])).length, 1, `day ${d - D} settled once`);
      await w.svc.verifyDay(d);
    }
    for (const u of walkers) assert.deepEqual(await rowsNaming(w, u), []);
    assert.equal((await w.svc.settlementStatus()).halted, false);
    assert.equal(await deadlocks(w), dl0, "no 40P01");
    const [left] = await w.q<{ n: number }>("SELECT count(*)::int AS n FROM gameplay_account_deletion_jobs WHERE state <> 'completed'");
    assert.equal(left!.n, 0);
  } finally {
    await w.t.drop();
  }
});

test("provider outage: the data erasure completes, the sign-in record stays queued and is reported as pending; a working provider marks it removed", { skip: SKIP }, async () => {
  const w = await world("erq_provider");
  try {
    await history(w, ["q-walker-p1", "q-walker-p2"]);
    const s = store(w.t.db, QUEUED);
    const down = (await s.request("q-walker-p1")) as { requestId: string };
    const outage = makeWorker(w.t.db, s, { removeProviderUsers: async () => { throw new Error("provider unreachable"); } });
    assert.equal(await outage.w.drain(), 1);
    assert.deepEqual(await s.status(down.requestId), { status: "completed", delayed: false, signInRecord: "pending" });
    assert.equal((await w.q("SELECT 1 FROM pending_auth_user_deletions WHERE subject = 'sub-q-walker-p1'")).length, 1, "kept for the retry loop");

    const up = (await s.request("q-walker-p2")) as { requestId: string };
    const removed: string[] = [];
    const ok = makeWorker(w.t.db, s, { removeProviderUsers: async (subjects) => { removed.push(...subjects); return { removed: [...subjects], pending: [] }; } });
    assert.equal(await ok.w.drain(), 1);
    assert.deepEqual(removed, ["sub-q-walker-p2"]);
    assert.deepEqual(await s.status(up.requestId), { status: "completed", delayed: false, signInRecord: "removed" });
  } finally {
    await w.t.drop();
  }
});

test("sign-in during deletion: the account refuses sign-in, session issue and old tokens until it is gone", { skip: SKIP }, async () => {
  const w = await world("erq_signin");
  try {
    const who = "q-walker-s1g2";
    await history(w, [who]);
    const cfg = resolveIdentityConfig({ NODE_ENV: "test", IDENTITY_SESSION_PEPPER: "x".repeat(24), IDENTITY_OTP_PEPPER: "y".repeat(24), IDENTITY_AUTH_DOMAIN: "movenrun.test", IDENTITY_ALLOWED_CHAIN_IDS: "84532" }, { requireSecrets: true });
    assert.ok(cfg.ok);
    const services = createIdentityServices(createDrizzleStores(w.t.db), cfg.config);
    const before = await services.identity.authenticate({ provider: "supabase", providerSubject: `sub-${who}` });
    assert.equal(before.user.id, who);
    const issued = await services.sessions.issue({ userId: who, assuranceLevel: "aal2" });
    const s = store(w.t.db, QUEUED);
    assert.equal((await s.request(who)).status, "pending");
    const codeOf = async (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => (isIdentityError(e) ? e.code : String(e)));
    assert.equal(await codeOf(services.identity.authenticate({ provider: "supabase", providerSubject: `sub-${who}` })), "account_deletion_pending");
    assert.equal(await codeOf(services.sessions.issue({ userId: who, assuranceLevel: "aal2" })), "account_deletion_pending");
    assert.equal(await codeOf(services.sessions.verifyAccess(issued.accessToken)), "session_invalid");
    assert.notEqual(await codeOf(services.sessions.refresh(issued.refreshToken)), "ok");
    assert.equal((await w.q("SELECT 1 FROM auth_sessions WHERE user_id = $1", [who])).length, 0, "no session revived");
    const { w: worker } = makeWorker(w.t.db, s);
    assert.equal(await worker.drain(), 1);
    assert.deepEqual(await rowsNaming(w, who), []);
  } finally {
    await w.t.drop();
  }
});

test("fatal outcome: the job goes to needs_attention (visible, not lost); an operator requeue is audited and the next run completes it", { skip: SKIP }, async () => {
  const w = await world("erq_fatal");
  try {
    const who = "q-walker-f4t5";
    await history(w, [who]);
    const s = store(w.t.db, QUEUED);
    const { requestId } = (await s.request(who)) as { requestId: string };
    const broken = { eraseJob: async () => { throw Object.assign(new Error("check violation"), { code: "23514" }); } };
    const bad = makeWorker(w.t.db, broken as never);
    assert.equal(await bad.w.drain(), 0);
    assert.deepEqual(bad.events.map((e) => `${e.kind}:${"outcome" in e ? e.outcome : ""}`), ["needs_attention:fatal"]);
    const j = (await job(w, requestId))!;
    assert.equal(j.state, "needs_attention");
    assert.equal(j.user_id, who, "still names the account: not lost, not erased");
    assert.deepEqual(await s.status(requestId), { status: "pending", delayed: true, signInRecord: "pending" });
    const counts = await jobs.erasureJobCounts(w.t.db);
    assert.deepEqual({ ...counts, oldestOpenSeconds: typeof counts.oldestOpenSeconds }, { pending: 0, running: 0, needsAttention: 1, completed: 0, oldestOpenSeconds: "number" });
    const { w: worker } = makeWorker(w.t.db, s);
    assert.equal(await worker.drain(), 0, "needs_attention is not retried on its own");
    assert.equal(await jobs.requeueErasureJob(w.t.db, requestId, "ops-oncall", "fixed_constraint"), true);
    const [audit] = await w.q<{ user_id: string | null; subject_id: string; metadata: Record<string, string> }>(
      "SELECT user_id, subject_id, metadata FROM security_audit_events WHERE event_type = 'erasure_job_requeued'");
    assert.deepEqual({ ...audit }, { user_id: null, subject_id: requestId, metadata: { actor: "ops-oncall", reason: "fixed_constraint", previousOutcome: "fatal" } });
    assert.equal(await worker.drain(), 1);
    assert.equal(await jobs.requeueErasureJob(w.t.db, requestId, "ops-oncall", "again"), false, "only a needs_attention job can be requeued");
  } finally {
    await w.t.drop();
  }
});

test("gameplay off with 0011 present: requests erase synchronously, no job; an account left 'deleting' with an open job is erased by the sweep and its job completed", { skip: SKIP }, async () => {
  const w = await world("erq_flagoff");
  try {
    await history(w, ["q-walker-o1", "q-walker-o2"]);
    const sync = store(w.t.db);
    const out = await sync.request("q-walker-o1");
    assert.equal(out.status, "completed");
    assert.equal((out as { result: { users: number } }).result.users, 1);
    assert.equal((await w.q("SELECT 1 FROM gameplay_account_deletion_jobs")).length, 0);
    // Accepted while gameplay was on, then gameplay was switched off.
    const { requestId } = (await store(w.t.db, QUEUED).request("q-walker-o2")) as { requestId: string };
    assert.equal(await sync.sweepDeleting(), 1);
    assert.equal((await job(w, requestId))!.state, "completed");
    assert.deepEqual(await rowsNaming(w, "q-walker-o2"), []);
  } finally {
    await w.t.drop();
  }
});

test("no 0011 (committed 0000-0010 only): a queued store still erases synchronously and names no gameplay table beyond the catalogue probes", { skip: SKIP }, async () => {
  const w = await world("erq_no0011", false);
  try {
    await w.user("q-walker-n1");
    const seen: string[] = [];
    const proxied = new Proxy(w.t.db, {
      get(target, prop, receiver) {
        if (prop === "execute") return (q: { queryChunks?: unknown[] }) => { seen.push(JSON.stringify(q)); return target.execute(q as never); };
        if (prop === "transaction") {
          return (fn: (tx: unknown) => Promise<unknown>, cfg?: unknown) => target.transaction((tx) => fn(new Proxy(tx, {
            get(t, p, r) { if (p === "execute") return (q: unknown) => { seen.push(JSON.stringify(q)); return (t as unknown as Db).execute(q as never); }; return Reflect.get(t, p, r); },
          })), cfg as never);
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const out = await store(proxied as Db, QUEUED).request("q-walker-n1");
    assert.equal(out.status, "completed");
    const naming = seen.filter((q) => /gameplay_/.test(q));
    assert.ok(naming.length > 0 && naming.every((q) => /to_regclass/.test(q)), `only catalogue probes: ${naming.join(" | ")}`);
    assert.equal(await store(w.t.db, QUEUED).status?.(randomUUID()), null);
  } finally {
    await w.t.drop();
  }
});
