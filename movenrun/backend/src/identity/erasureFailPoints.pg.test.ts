/**
 * Account erasure fail points on real PostgreSQL (docs/G34_ERASURE_QUEUE.md).
 *
 * The queued erasure is one transaction of many statements (fence, account
 * row, job lease, gameplay phase 1, identity rows, gameplay phase 2 and its
 * tombstones, job completion, user row, audit row). These tests fail it at
 * EVERY data-changing statement in turn, with a transient code and with a
 * fatal one, and check after each failure that:
 *  - nothing the attempt wrote survived (every table, every partition, the
 *    fence: byte-for-byte the state before the attempt, the job row aside);
 *  - the job is where the policy says (pending with backoff, or
 *    needs_attention) and still names the account;
 *  - the account is still "deleting", so it stays signed out;
 *  - once the fault is gone the same job completes exactly once, nothing
 *    names the walker and every closed day still replays.
 * Plus the lease-takeover budget: a job whose worker keeps dying is parked
 * in needs_attention rather than taken over forever.
 *
 * The fault is a statement-level trigger on every table that raises when a
 * non-transactional counter (a sequence) reaches K, so each fail point is
 * hit deterministically. Throwaway database only. Skipped, loudly, without
 * MOVENRUN_TEST_DATABASE_URL.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { gridDisk, latLngToCell } from "h3-js";
import type { Db } from "../db/client.js";
import { DAY_MS, PILOT_PROPOSAL, dayCloseMs, type GameplayRules } from "../gameplay/rules.js";
import { GameplayService } from "../gameplay/service.js";
import { SEALED_LOOP, SEAL_COLUMNS, sealLiteral } from "../gameplay/sealFixtures.js";
import { createTestDb, type TestDb } from "../gameplay/pgTestDb.js";
import * as jobs from "../gameplay/erasureJobs.js";
import { createDrizzleAccountDeletionStore, type DrizzleAccountDeletionStore } from "./accountDeletion.js";
import { createErasureWorker, type ErasureWorkerEvent, type ErasureWorkerDeps } from "./erasureWorker.js";

const DATABASE_URL = process.env.MOVENRUN_TEST_DATABASE_URL;
const SKIP = DATABASE_URL ? false : "MOVENRUN_TEST_DATABASE_URL is not set — account erasure fail points on PostgreSQL were NOT verified";

const D = Math.floor(Date.UTC(2026, 9, 1) / DAY_MS);
const RULES: GameplayRules = { ...PILOT_PROPOSAL, holding: { ...PILOT_PROPOSAL.holding }, seasonOneStartDay: D };
const at = (day: number, hour: number) => day * DAY_MS + Math.round(hour * 3_600_000);
const C = gridDisk(latLngToCell(51.5007, -0.1246, 8), 2).sort();
const QUEUED = { queue: { onAccepted: () => undefined } };
const FAST = { baseDelayMs: 20, maxDelayMs: 40, maxAttempts: 5, leaseMs: 60_000, lockTimeoutMs: 2_000 };
const WHO = "q-walker-fp01";

interface World {
  t: TestDb;
  clock: { ms: number };
  svc: GameplayService;
  q<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<T[]>;
}

async function world(prefix: string): Promise<World> {
  const t = await createTestDb(DATABASE_URL!, prefix, { gameplay: true });
  const clock = { ms: at(D, 9) };
  const svc = new GameplayService({ db: t.db, rules: RULES, now: () => clock.ms });
  return { t, clock, svc, async q(text, values = []) { return (await t.pool.query(text, values)).rows; } };
}

/** A verified movement session, received a minute after it ended. Not applied. */
async function upload(w: World, userId: string, sid: string, endMs: number, units: string[]): Promise<void> {
  await w.q(
    `INSERT INTO movement_verifications (id, user_id, client_session_id, status, distance_meters, duration_seconds, traversed_hex_ids, start_time, end_time, created_at, ${SEAL_COLUMNS})
     VALUES ($1, $2, $3, 'verified', 3000, 1800, $4, $5, $6, (to_timestamp($7::float8 / 1000) AT TIME ZONE current_setting('TimeZone')), ${sealLiteral(SEALED_LOOP, units)})`,
    [randomUUID(), userId, sid, units, endMs - 1_800_000, endMs, endMs + 60_000]);
}

/**
 * The victim and two other walkers: two settled days the victim has credit
 * on (so erasure writes tombstones and erasure records), one closed unsettled
 * day, a live session and a pending provider subject.
 */
async function seed(w: World): Promise<void> {
  const user = async (id: string) => {
    await w.q("INSERT INTO users (id) VALUES ($1)", [id]);
    await w.q("INSERT INTO auth_identities (id, user_id, provider, provider_subject, normalized_email) VALUES ($1, $2, 'supabase', $3, $4)",
      [randomUUID(), id, `prv-${id.slice(-4)}`, `${id.slice(-4)}@example.invalid`]);
  };
  const walk = async (userId: string, sid: string, endMs: number, units: string[]) => {
    await upload(w, userId, sid, endMs, units);
    const keep = w.clock.ms;
    w.clock.ms = endMs + 120_000;
    try { await w.svc.applySession(userId, sid); } finally { w.clock.ms = keep; }
  };
  for (const u of ["q-ana-fp02", "q-ben-fp03", WHO]) await user(u);
  await walk("q-ana-fp02", "a1", at(D, 8), [C[0]!, C[1]!]);
  await walk(WHO, "v1", at(D, 8.5), [C[2]!, C[1]!]);
  await walk("q-ben-fp03", "b1", at(D + 1, 8), [C[0]!]);
  await walk(WHO, "v2", at(D + 1, 9), [C[3]!, C[2]!]);
  w.clock.ms = dayCloseMs(RULES, D + 1) + 60_000;
  await w.svc.settleDay(D);
  await w.svc.settleDay(D + 1);
  await walk(WHO, "v3", at(D + 2, 9), [C[4]!]);
  await walk("q-ben-fp03", "b2", at(D + 2, 8), [C[3]!]);
  w.clock.ms = dayCloseMs(RULES, D + 2) + 60_000;
  await w.q("INSERT INTO security_audit_events (id, user_id, event_type, subject_id, metadata) VALUES ($1, $2, 'login', NULL, NULL)", [randomUUID(), WHO]);
}

/** Every base table (public and the day partitions), the job table aside. */
async function tables(w: World): Promise<string[]> {
  return (await w.q<{ t: string }>(`
    SELECT format('%I.%I', n.nspname, c.relname) AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'r' AND n.nspname IN ('public', 'gameplay_partitions') AND c.relname NOT IN ('gameplay_account_deletion_jobs', 'test_fault_config')
     ORDER BY 1`)).map((r) => r.t);
}

/**
 * Content digest of every table. Operator requeue audit rows are left out:
 * they are written by the test's recovery step, not by an erasure attempt.
 */
async function snapshot(w: World): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const t of await tables(w)) {
    const filter = t === "public.security_audit_events" ? "WHERE x.event_type <> 'erasure_job_requeued'" : "";
    const [r] = await w.q<{ d: string | null; n: number }>(`SELECT md5(string_agg(x::text, '|' ORDER BY x::text)) AS d, count(*)::int AS n FROM ${t} x ${filter}`);
    out.set(t, `${r!.n}:${r!.d ?? ""}`);
  }
  return out;
}

function changed(a: Map<string, string>, b: Map<string, string>): string[] {
  const keys = new Set([...a.keys(), ...b.keys()]);
  return [...keys].filter((k) => a.get(k) !== b.get(k)).sort();
}

/**
 * A statement-level trigger on every table (job table included): each
 * data-changing statement takes the next value of a sequence, which a
 * rollback does not undo, and the statement numbered K raises `code`.
 */
async function armFaults(w: World): Promise<void> {
  await w.q(`
    CREATE SEQUENCE IF NOT EXISTS public.test_fault_counter;
    CREATE TABLE IF NOT EXISTS public.test_fault_config (k bigint NOT NULL, code text NOT NULL);
    CREATE OR REPLACE FUNCTION public.test_fault() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE cfg record; n bigint;
    BEGIN
      SELECT k, code INTO cfg FROM public.test_fault_config LIMIT 1;
      IF NOT FOUND THEN RETURN NULL; END IF;
      n := nextval('public.test_fault_counter');
      IF n = cfg.k THEN
        RAISE EXCEPTION 'injected fault at statement % (% on %)', n, TG_OP, TG_TABLE_NAME USING ERRCODE = cfg.code;
      END IF;
      RETURN NULL;
    END $$;`);
  for (const t of [...(await tables(w)), "public.gameplay_account_deletion_jobs"]) {
    await w.q(`CREATE TRIGGER test_fault BEFORE INSERT OR UPDATE OR DELETE ON ${t} FOR EACH STATEMENT EXECUTE FUNCTION public.test_fault()`);
  }
}

/** Fail statement K (counted from the claim) with `code`; null disarms. */
async function setFault(w: World, k: number | null, code = "40001"): Promise<void> {
  await w.q("DELETE FROM public.test_fault_config");
  await w.q("SELECT setval('public.test_fault_counter', 1, false)");
  if (k !== null) await w.q("INSERT INTO public.test_fault_config (k, code) VALUES ($1, $2)", [k, code]);
}

async function faultsFired(w: World): Promise<number> {
  const [r] = await w.q<{ n: string }>("SELECT last_value::text AS n, is_called FROM public.test_fault_counter");
  return Number(r!.n);
}

function makeWorker(db: Db, s: DrizzleAccountDeletionStore, extra: Partial<ErasureWorkerDeps> = {}) {
  const events: ErasureWorkerEvent[] = [];
  const w = createErasureWorker({ db, store: s, policy: FAST, random: () => 0.5, log: { info: () => undefined, warn: () => undefined }, onEvent: (e) => events.push(e), ...extra });
  return { w, events };
}

async function jobRow(w: World, id: string) {
  const [r] = await w.q<{ state: string; user_id: string | null; attempts: number; last_outcome: string | null }>(
    "SELECT state, user_id, attempts, last_outcome FROM gameplay_account_deletion_jobs WHERE id = $1", [id]);
  return r!;
}

async function rowsNaming(w: World, text: string): Promise<string[]> {
  const hits: string[] = [];
  for (const t of [...(await tables(w)), "public.gameplay_account_deletion_jobs"]) {
    const [n] = await w.q<{ n: number }>(`SELECT count(*)::int AS n FROM ${t} x WHERE x::text LIKE '%' || $1 || '%'`, [text]);
    if (n!.n > 0) hits.push(t);
  }
  return hits;
}

/**
 * Walk K = 2, 3, ... (statement 1 is the worker's claim) until an attempt
 * completes with the fault armed past its last statement. Every K below that
 * is a fail point inside the erasure transaction.
 */
async function sweep(code: string, outcome: "retry" | "needs_attention") {
  const w = await world(`erfp_${outcome === "retry" ? "tr" : "fa"}`);
  try {
    await seed(w);
    const s = createDrizzleAccountDeletionStore(w.t.db, QUEUED);
    const accepted = await s.request(WHO);
    assert.equal(accepted.status, "pending");
    const requestId = (accepted as { requestId: string }).requestId;
    await armFaults(w);
    const before = await snapshot(w);
    // A large attempt budget, so the transient sweep is never cut short by it.
    // The store as the worker sees it, keeping only the injected fault's
    // label (statement number, operation, table) for the report.
    let lastFault = "";
    const seen = {
      eraseJob: (job: jobs.ClaimedErasureJob, ms: number) => s.eraseJob(job, ms).catch((err: unknown) => {
        lastFault = err instanceof Error ? err.message : "";
        throw err;
      }),
    };
    const { w: worker, events } = makeWorker(w.t.db, seen as unknown as DrizzleAccountDeletionStore, { policy: { ...FAST, maxAttempts: 1_000 } });
    let points = 0;
    const trace: string[] = [];
    for (let k = 2; ; k += 1) {
      assert.ok(k < 400, "the erasure ends within 400 statements");
      events.length = 0;
      await setFault(w, k, code);
      const done = await worker.drain({ maxJobs: 1 });
      const fired = await faultsFired(w);
      if (done === 1) {
        // The attempt ran to the end: K lay past its last statement.
        assert.ok(fired < k, `completed only when the fault was never reached (k=${k}, statements=${fired})`);
        break;
      }
      points += 1;
      trace.push(lastFault.replace(/^injected fault at statement /, ""));
      assert.deepEqual(events.map((e) => `${e.kind}:${"outcome" in e ? e.outcome : ""}`),
        [`${outcome}:${outcome === "retry" ? "serialization" : "fatal"}`], `fail point ${k}`);
      const after = await snapshot(w);
      assert.deepEqual(changed(before, after), [], `fail point ${k}: the failed attempt left no trace outside the job row`);
      const j = await jobRow(w, requestId);
      assert.equal(j.state, outcome === "retry" ? "pending" : "needs_attention", `fail point ${k}`);
      assert.equal(j.user_id, WHO, `fail point ${k}: the open job still names the account`);
      const [u] = await w.q<{ status: string }>("SELECT status FROM users WHERE id = $1", [WHO]);
      assert.equal(u?.status, "deleting", `fail point ${k}: the account stays signed out`);
      assert.equal((await w.q("SELECT 1 FROM auth_sessions WHERE user_id = $1", [WHO])).length, 0, `fail point ${k}: no session came back`);
      // Recovery: the next attempt is due now.
      await setFault(w, null);
      if (outcome === "retry") {
        await w.q("UPDATE gameplay_account_deletion_jobs SET next_attempt_at = now() WHERE id = $1", [requestId]);
      } else {
        assert.equal(await jobs.requeueErasureJob(w.t.db, requestId, "ops-test", "fault_cleared"), true);
      }
    }
    assert.ok(points >= 15, `the erasure was failed at each of its statements (${points} fail points)`);
    // The sweep reached every stage of the transaction, not only its start.
    for (const stage of ["UPDATE on gameplay_erasure_fence", "INSERT on pending_auth_user_deletions", "DELETE on auth_identities",
      "INSERT on gameplay_erasure_days", "UPDATE on gameplay_credit_lines", "UPDATE on gameplay_account_deletion_jobs", "DELETE on users",
      "INSERT on security_audit_events"]) {
      assert.ok(trace.some((t) => t.includes(`(${stage})`)), `a fault was injected at ${stage}`);
    }
    const j = await jobRow(w, requestId);
    assert.equal(j.state, "completed");
    assert.equal(j.user_id, null);
    await setFault(w, null);
    assert.deepEqual(await rowsNaming(w, WHO), [], "nothing names the walker after the completing attempt");
    assert.equal((await w.q("SELECT 1 FROM security_audit_events WHERE event_type = 'account_deleted'")).length, 1, "one completion, however many failed attempts");
    assert.equal((await w.q("SELECT 1 FROM pending_auth_user_deletions WHERE subject = $1", [`prv-${WHO.slice(-4)}`])).length, 1);
    const [fence] = await w.q<{ erasures: string }>("SELECT erasures::text FROM gameplay_erasure_fence");
    assert.equal(fence!.erasures, "1", "the fence counts the one committed erasure only");
    for (const d of [D, D + 1]) await w.svc.verifyDay(d);
    await w.svc.settleDay(D + 2);
    await w.svc.verifyDay(D + 2);
    assert.equal((await w.svc.settlementStatus()).halted, false);
    if (process.env.ERFP_REPORT) console.log(`erfp ${code}: ${points} fail points; trace ${JSON.stringify(trace)}`);
    return points;
  } finally {
    await w.t.drop();
  }
}

test("transient fault at every statement of a queued erasure: each attempt rolls back whole, the job is rescheduled, and the clean attempt completes once", { skip: SKIP }, async () => {
  const points = await sweep("40001", "retry");
  assert.ok(points > 0);
});

test("fatal fault at every statement of a queued erasure: nothing is written, the job waits in needs_attention naming the account, and a requeue completes it once", { skip: SKIP }, async () => {
  const points = await sweep("XX000", "needs_attention");
  assert.ok(points > 0);
});

test("lease takeover budget: a job whose worker dies after every claim is parked in needs_attention after the attempt budget, not taken over forever", { skip: SKIP }, async () => {
  const w = await world("erfp_lease");
  try {
    await seed(w);
    const s = createDrizzleAccountDeletionStore(w.t.db, QUEUED);
    const { requestId } = (await s.request(WHO)) as { requestId: string };
    const before = await snapshot(w);
    // FAST allows 5 attempts. Five claims whose workers "die" (never attempt):
    for (let i = 1; i <= FAST.maxAttempts; i += 1) {
      const c = await jobs.claimErasureJob(w.t.db, 60_000);
      assert.ok(c, `claim ${i}`);
      assert.equal(c!.attempts, i);
      await w.q("UPDATE gameplay_account_deletion_jobs SET lease_expires_at = now() - interval '1 second' WHERE id = $1", [requestId]);
    }
    const { w: worker, events } = makeWorker(w.t.db, s);
    assert.equal(await worker.drain(), 0);
    assert.deepEqual(events.map((e) => `${e.kind}:${"outcome" in e ? e.outcome : ""}`), ["needs_attention:attempts_exhausted_lease"]);
    const j = await jobRow(w, requestId);
    assert.deepEqual({ ...j }, { state: "needs_attention", user_id: WHO, attempts: FAST.maxAttempts + 1, last_outcome: "attempts_exhausted_lease" });
    assert.deepEqual(changed(before, await snapshot(w)), [], "parking writes nothing outside the job row");
    assert.equal(await worker.drain(), 0, "a parked job is not claimed again on its own");
    assert.deepEqual(await s.status(requestId), { status: "pending", delayed: true, signInRecord: "pending" });
    assert.equal(await jobs.requeueErasureJob(w.t.db, requestId, "ops-test", "worker_fixed"), true);
    assert.equal(await worker.drain(), 1);
    assert.deepEqual(await rowsNaming(w, WHO), []);
  } finally {
    await w.t.drop();
  }
});

async function lockWaiters(w: World, n: number, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [r] = await w.q<{ n: number }>("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'");
    if (r!.n >= n) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${n} lock waiter(s), have ${r!.n}`);
    await new Promise((res) => setTimeout(res, 5));
  }
}

test("pusher, closer and eraser at once (forced order): a push holding the victim's unit, the erasure waiting on it and a day close waiting on the fence all finish; nothing names the victim, each day settles once, no deadlock", { skip: SKIP }, async () => {
  const w = await world("erfp_race3");
  const held: { release(): Promise<void> }[] = [];
  try {
    await seed(w);
    // Today is D + 3. The victim holds C[4] (their D + 2 walk); Ana walks it today.
    const today = D + 3;
    const end = dayCloseMs(RULES, D + 2) + 30_000;
    await upload(w, "q-ana-fp02", "a-race", end, [C[4]!]);
    w.clock.ms = end + 120_000;
    const [{ holder }] = (await w.q<{ holder: string | null }>("SELECT holder_id AS holder FROM gameplay_units WHERE unit = (SELECT territory_claim_units[1] FROM movement_verifications WHERE client_session_id = 'v3')")) as [{ holder: string | null }];
    assert.equal(holder, WHO, "the victim holds the unit Ana is about to walk");
    const [{ n: dl0 }] = (await w.q<{ n: string }>("SELECT deadlocks::text AS n FROM pg_stat_database WHERE datname = current_database()")) as [{ n: string }];

    const s = createDrizzleAccountDeletionStore(w.t.db, QUEUED);
    const { requestId } = (await s.request(WHO)) as { requestId: string };

    // 1. A test transaction blocks ledger inserts, so Ana's push stops after it
    //    has locked her units (the victim's C[4] among them) and before it commits.
    const gate = await w.t.pool.connect();
    await gate.query("BEGIN");
    await gate.query("LOCK TABLE gameplay_push_events IN SHARE MODE");
    held.push({ async release() { await gate.query("COMMIT"); gate.release(); } });
    const push = w.svc.applySession("q-ana-fp02", "a-race");
    await lockWaiters(w, 1);
    // 2. The erasure: fence, account row, phase 1, then it waits for the unit row Ana holds.
    const { w: worker, events } = makeWorker(w.t.db, s, { policy: { ...FAST, lockTimeoutMs: 20_000 } });
    const erase = worker.drain({ maxJobs: 1 });
    await lockWaiters(w, 2);
    // 3. The close of D + 2 waits for the fence the erasure holds.
    const close = w.svc.settleDay(D + 2);
    await lockWaiters(w, 3);
    // The three waits are the ones intended: the push on the ledger insert,
    // the erasure on the unit row the push holds, the close on the fence.
    const waits = (await w.q<{ q: string }>("SELECT left(regexp_replace(query, '\\s+', ' ', 'g'), 60) AS q FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' ORDER BY query_start")).map((r) => r.q);
    if (process.env.ERFP_REPORT) console.log(`erfp waits ${JSON.stringify(waits)}`);
    assert.equal(waits.length, 3);
    assert.ok(/insert into "?gameplay_push_events/i.test(waits[0]!), `push waits on its ledger insert: ${waits[0]}`);
    assert.ok(/UPDATE gameplay_units SET holder_id = NULL/i.test(waits[1]!), `erasure waits on the unit row: ${waits[1]}`);
    assert.ok(/LOCK TABLE gameplay_erasure_fence/i.test(waits[2]!), `close waits on the fence: ${waits[2]}`);
    // 4. Let the push go: it commits, then the erasure, then the close.
    await held.pop()!.release();
    const [pushed, erased, closed] = await Promise.all([push, erase, close]);

    assert.equal(erased, 1, `the erasure completed: ${JSON.stringify(events)}`);
    assert.deepEqual(events.map((e) => e.kind), ["completed"], "first attempt, no retry");
    assert.equal(pushed.day, today);
    assert.ok(pushed.applied + pushed.skipped + pushed.rejected > 0, "the push ran");
    assert.equal(closed.day, D + 2);
    const [{ n: dl1 }] = (await w.q<{ n: string }>("SELECT deadlocks::text AS n FROM pg_stat_database WHERE datname = current_database()")) as [{ n: string }];
    assert.equal(dl1, dl0, "no 40P01");
    assert.deepEqual(await rowsNaming(w, WHO), [], "no row names the victim, including rows the push wrote while the erasure waited");
    const [orphans] = await w.q<{ n: number }>(`SELECT count(*)::int AS n FROM gameplay_push_events e
      WHERE (e.previous_holder_no IS NOT NULL AND NOT EXISTS (SELECT 1 FROM gameplay_players p WHERE p.player_no = e.previous_holder_no))
         OR (e.new_holder_no IS NOT NULL AND NOT EXISTS (SELECT 1 FROM gameplay_players p WHERE p.player_no = e.new_holder_no))`);
    assert.equal(orphans!.n, 0, "no ledger row keeps the erased player's number");
    for (const d of [D, D + 1, D + 2]) {
      assert.equal((await w.q("SELECT 1 FROM gameplay_day_settlements WHERE day = $1", [d])).length, 1, `day ${d - D} settled once`);
      await w.svc.verifyDay(d);
    }
    assert.equal((await jobRow(w, requestId)).state, "completed");
    // Today closes without the victim and replays.
    w.clock.ms = dayCloseMs(RULES, today) + 60_000;
    await w.svc.settleDay(today);
    await w.svc.verifyDay(today);
    assert.equal((await w.svc.settlementStatus()).halted, false);
  } finally {
    for (const h of held) await h.release().catch(() => undefined);
    await w.t.drop();
  }
});
