/**
 * Durable account erasure jobs (docs/G34_ERASURE_QUEUE.md).
 *
 * The table `gameplay_erasure_jobs` belongs to the PROPOSED migration 0011
 * (drizzle-proposed/), like the erasure fence it works with. Every function
 * here is reached only after `erasureJobsPresent` found the table, so a
 * database without 0011 is never asked about it.
 *
 * A job row holds an opaque job id, the account's user id (cleared when the
 * job completes), timestamps from the database clock, an attempt count, a
 * lease and a reason code. Never an email, address, token, route or error
 * message.
 *
 * States: pending -> running (leased) -> completed, or back to pending with a
 * later next_attempt_at after a transient failure, or needs_attention after a
 * fatal failure or when the attempt budget is spent. An operator puts a
 * needs_attention job back to pending with `requeueErasureJob`, which writes
 * an audit event in the same transaction.
 */
import { sql, type SQL } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Db } from "../db/client.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Exec = Db | Tx;

async function rows<T = Record<string, unknown>>(exec: Exec, query: SQL): Promise<T[]> {
  return (await exec.execute(query)).rows as T[];
}

/** How one erasure attempt ended, when it did not complete. Reason codes only. */
export type ErasureAttemptClass =
  | "lock_timeout" // 55P03: a lock was not granted within the lock budget; nothing was written
  | "serialization" // 40001
  | "deadlock" // 40P01
  | "statement_timeout" // 57014: a statement ran past statement_timeout; the transaction rolled back
  | "connection" // the connection failed or none could be had; the transaction did not commit
  | "lease_lost" // another worker holds the job now (this lease expired); this attempt rolled back
  | "fatal"; // anything else: not retried automatically

/** Retried with backoff. Everything else (fatal) goes to needs_attention at once. */
export const TRANSIENT_ERASURE_CLASSES: ReadonlySet<ErasureAttemptClass> = new Set([
  "lock_timeout", "serialization", "deadlock", "statement_timeout", "connection",
]);

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  return typeof code === "string" ? code : undefined;
}

/** Another worker took over the job (its lease had expired). */
export class ErasureLeaseLostError extends Error {
  constructor() {
    super("erasure job lease lost");
    this.name = "ErasureLeaseLostError";
  }
}

export function classifyErasureError(err: unknown): ErasureAttemptClass {
  if (err instanceof ErasureLeaseLostError) return "lease_lost";
  const code = pgCode(err);
  if (code === "55P03") return "lock_timeout";
  if (code === "40001") return "serialization";
  if (code === "40P01") return "deadlock";
  if (code === "57014") return "statement_timeout";
  if (code && (/^08/.test(code) || code === "57P01" || code === "57P02" || code === "57P03" || code === "53300")) return "connection";
  if (code === "ECONNRESET" || code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "EPIPE") return "connection";
  const message = err instanceof Error ? err.message : "";
  // node-postgres pool and client errors carry no code.
  if (/timeout exceeded when trying to connect|Connection terminated|Query read timeout/i.test(message)) return "connection";
  return "fatal";
}

/**
 * Retry policy of an erasure job. Before attempt n+1 (n >= 1 attempts made)
 * the job waits `c/2 + floor(random * c/2)` ms with c = min(maxDelayMs,
 * baseDelayMs * 2^(n-1)) (capped exponential, "equal" jitter so two retries
 * are never back to back), on the database clock. After `maxAttempts`
 * attempts, or at once on a fatal outcome, it goes to needs_attention.
 * lockTimeoutMs bounds every lock wait inside an attempt (SET LOCAL
 * lock_timeout); leaseMs is how long a claimed job stays with its worker
 * before another may take it over (crash recovery).
 */
export interface ErasureRetryPolicy {
  baseDelayMs: number;
  maxDelayMs: number;
  maxAttempts: number;
  leaseMs: number;
  lockTimeoutMs: number;
}

/**
 * About 2 s doubling to 5 min, 40 attempts: under continuous transient
 * failure the budget lasts roughly two to three hours before an operator is
 * needed. Not a promise of completion time; see the runbook.
 */
export const DEFAULT_ERASURE_RETRY: ErasureRetryPolicy = {
  baseDelayMs: 2_000,
  maxDelayMs: 300_000,
  maxAttempts: 40,
  leaseMs: 120_000,
  lockTimeoutMs: 3_000,
};

export function checkErasureRetryPolicy(p: ErasureRetryPolicy): ErasureRetryPolicy {
  const whole = (v: number, min: number, max: number) => Number.isInteger(v) && v >= min && v <= max;
  if (!whole(p.baseDelayMs, 1, 3_600_000) || !whole(p.maxDelayMs, p.baseDelayMs, 86_400_000) || !whole(p.maxAttempts, 1, 1_000)
    || !whole(p.leaseMs, 100, 3_600_000) || !whole(p.lockTimeoutMs, 1, 60_000)) {
    throw new Error("erasure retry policy: whole milliseconds, 1 <= base <= max delay, 1 to 1000 attempts, lease 100 ms to 1 h, lock timeout 1 ms to 60 s");
  }
  return p;
}

/** The wait before the next attempt after `attempts` attempts, for a jitter draw in [0, 1). */
export function erasureBackoffMs(policy: ErasureRetryPolicy, attempts: number, random: number): number {
  const r = Number.isFinite(random) ? Math.min(Math.max(random, 0), 1) : 0;
  const cap = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.min(30, Math.max(0, attempts - 1)));
  const half = Math.floor(cap / 2);
  return Math.min(cap, half + Math.floor(r * (cap - half)));
}

/** True when the proposed 0011 job table exists. A catalog lookup, not a query of the table. */
export async function erasureJobsPresent(exec: Exec): Promise<boolean> {
  const [r] = await rows<{ ok: boolean }>(exec, sql`SELECT to_regclass('public.gameplay_erasure_jobs') IS NOT NULL AS ok`);
  return Boolean(r?.ok);
}

export interface ClaimedErasureJob {
  id: string;
  userId: string;
  attempts: number;
  leaseToken: string;
}

/** The open job of an account, if any. */
export async function openErasureJob(exec: Exec, userId: string): Promise<string | null> {
  const [r] = await rows<{ id: string }>(exec, sql`
    SELECT id::text AS id FROM gameplay_erasure_jobs WHERE user_id = ${userId} AND state <> 'completed'`);
  return r?.id ?? null;
}

/** Write a new pending job for an account the caller holds locked. Returns the job id. */
export async function insertErasureJob(tx: Tx, userId: string): Promise<string> {
  const id = randomUUID();
  await tx.execute(sql`
    INSERT INTO gameplay_erasure_jobs (id, user_id, state) VALUES (${id}::uuid, ${userId}, 'pending')`);
  return id;
}

/**
 * Claim the oldest due job: a pending job whose next attempt is due, or a
 * running job whose lease has expired (its worker died or stalled). One
 * statement; SKIP LOCKED, so concurrent workers never take the same row.
 */
export async function claimErasureJob(db: Db, leaseMs: number): Promise<ClaimedErasureJob | null> {
  const token = randomUUID();
  const [r] = await rows<{ id: string; user_id: string; attempts: number }>(db, sql`
    UPDATE gameplay_erasure_jobs j
       SET state = 'running', lease_token = ${token}::uuid,
           lease_expires_at = now() + make_interval(secs => ${leaseMs}::float8 / 1000),
           attempts = j.attempts + 1
     WHERE j.id = (
       SELECT id FROM gameplay_erasure_jobs
        WHERE (state = 'pending' AND next_attempt_at <= now()) OR (state = 'running' AND lease_expires_at <= now())
        ORDER BY next_attempt_at, requested_at
        LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING j.id::text AS id, j.user_id, j.attempts`);
  return r ? { id: r.id, userId: r.user_id, attempts: Number(r.attempts), leaseToken: token } : null;
}

/** Inside the erasure transaction: lock the job row and check this worker still holds its lease. */
export async function holdErasureLease(tx: Tx, job: ClaimedErasureJob): Promise<void> {
  const [r] = await rows(tx, sql`
    SELECT 1 FROM gameplay_erasure_jobs WHERE id = ${job.id}::uuid AND state = 'running' AND lease_token = ${job.leaseToken}::uuid FOR UPDATE`);
  if (!r) throw new ErasureLeaseLostError();
}

/**
 * Inside the erasure transaction, before the user row is deleted: complete
 * every open job of the account (normally one) and clear its user id, so
 * the job is completed exactly when the account is gone.
 */
export async function completeOpenErasureJobs(tx: Tx, userId: string, providerStage: "none" | "queued"): Promise<number> {
  const done = await rows(tx, sql`
    UPDATE gameplay_erasure_jobs
       SET state = 'completed', user_id = NULL, completed_at = now(), lease_token = NULL, lease_expires_at = NULL,
           attention_at = NULL, last_outcome = 'completed', provider_stage = ${providerStage}
     WHERE user_id = ${userId} AND state <> 'completed' RETURNING id`);
  return done.length;
}

/** After commit: the provider confirmed removal of the sign-in record. */
export async function markProviderRemoved(db: Db, jobId: string): Promise<void> {
  await db.execute(sql`UPDATE gameplay_erasure_jobs SET provider_stage = 'removed' WHERE id = ${jobId}::uuid AND state = 'completed'`);
}

/**
 * After a failed attempt (its transaction rolled back): back to pending with
 * the next attempt scheduled, or needs_attention. Only while this worker
 * still holds the lease; returns the new state, or null when it did not.
 */
export async function releaseErasureJob(
  db: Db, job: ClaimedErasureJob, outcome: ErasureAttemptClass, policy: ErasureRetryPolicy, random: number,
): Promise<"pending" | "needs_attention" | null> {
  const attention = !TRANSIENT_ERASURE_CLASSES.has(outcome) || job.attempts >= policy.maxAttempts;
  const waitMs = attention ? 0 : erasureBackoffMs(policy, job.attempts, random);
  const reason = attention && TRANSIENT_ERASURE_CLASSES.has(outcome) ? `attempts_exhausted_${outcome}` : outcome;
  const [r] = await rows<{ state: "pending" | "needs_attention" }>(db, sql`
    UPDATE gameplay_erasure_jobs
       SET state = ${attention ? "needs_attention" : "pending"},
           next_attempt_at = now() + make_interval(secs => ${waitMs}::float8 / 1000),
           lease_token = NULL, lease_expires_at = NULL, last_outcome = ${reason},
           attention_at = ${attention ? sql`now()` : sql`NULL`}
     WHERE id = ${job.id}::uuid AND state = 'running' AND lease_token = ${job.leaseToken}::uuid
    RETURNING state`);
  return r?.state ?? null;
}

/** A job that came back from too many expired leases goes to needs_attention instead of running again. */
export async function parkErasureJob(db: Db, job: ClaimedErasureJob, reason: string): Promise<void> {
  await db.execute(sql`
    UPDATE gameplay_erasure_jobs
       SET state = 'needs_attention', lease_token = NULL, lease_expires_at = NULL, last_outcome = ${reason}, attention_at = now()
     WHERE id = ${job.id}::uuid AND state = 'running' AND lease_token = ${job.leaseToken}::uuid`);
}

export interface ErasureJobStatusRow {
  state: "pending" | "running" | "completed" | "needs_attention";
  attempts: number;
  providerStage: "none" | "queued" | "removed" | null;
  requestedAt: Date;
  completedAt: Date | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function erasureJobStatus(exec: Exec, jobId: string): Promise<ErasureJobStatusRow | null> {
  if (!UUID_RE.test(jobId)) return null;
  const [r] = await rows<{ state: ErasureJobStatusRow["state"]; attempts: number; provider_stage: ErasureJobStatusRow["providerStage"]; requested_at: Date; completed_at: Date | null }>(exec, sql`
    SELECT state, attempts, provider_stage, requested_at, completed_at FROM gameplay_erasure_jobs WHERE id = ${jobId}::uuid`);
  if (!r) return null;
  return { state: r.state, attempts: Number(r.attempts), providerStage: r.provider_stage, requestedAt: new Date(r.requested_at), completedAt: r.completed_at ? new Date(r.completed_at) : null };
}

/** Counts for operators: by state, plus the age of the oldest open job. No ids. */
export async function erasureJobCounts(exec: Exec): Promise<{ pending: number; running: number; needsAttention: number; completed: number; oldestOpenSeconds: number | null }> {
  const [r] = await rows<{ pending: number; running: number; attention: number; completed: number; oldest: number | null }>(exec, sql`
    SELECT count(*) FILTER (WHERE state = 'pending')::int AS pending,
           count(*) FILTER (WHERE state = 'running')::int AS running,
           count(*) FILTER (WHERE state = 'needs_attention')::int AS attention,
           count(*) FILTER (WHERE state = 'completed')::int AS completed,
           extract(epoch FROM now() - min(requested_at) FILTER (WHERE state <> 'completed'))::float8 AS oldest
      FROM gameplay_erasure_jobs`);
  return {
    pending: Number(r?.pending ?? 0), running: Number(r?.running ?? 0), needsAttention: Number(r?.attention ?? 0),
    completed: Number(r?.completed ?? 0), oldestOpenSeconds: r?.oldest === null || r?.oldest === undefined ? null : Number(r.oldest),
  };
}

const ACTOR_RE = /^[a-z0-9][a-z0-9_.-]{1,62}$/;
const REASON_RE = /^[a-z0-9_]{1,40}$/;

/**
 * Operator recovery: put a needs_attention job back to pending, due now,
 * with a fresh attempt budget, and record who did it and why (a role label
 * and a reason code, no free text) in security_audit_events in the same
 * transaction. Nothing is erased here; the worker does that on its next run.
 * Returns false when the job is not in needs_attention.
 */
export async function requeueErasureJob(db: Db, jobId: string, actor: string, reason: string): Promise<boolean> {
  if (!UUID_RE.test(jobId)) throw new Error("job id must be a uuid");
  if (!ACTOR_RE.test(actor)) throw new Error("actor must be a role label (lowercase letters, digits, . _ -)");
  if (!REASON_RE.test(reason)) throw new Error("reason must be a reason code (lowercase letters, digits, _)");
  return db.transaction(async (tx) => {
    const [r] = await rows<{ last_outcome: string | null }>(tx, sql`
      SELECT last_outcome FROM gameplay_erasure_jobs WHERE id = ${jobId}::uuid AND state = 'needs_attention' FOR UPDATE`);
    if (r) {
      await tx.execute(sql`
        UPDATE gameplay_erasure_jobs
           SET state = 'pending', attempts = 0, next_attempt_at = now(), attention_at = NULL, last_outcome = 'requeued'
         WHERE id = ${jobId}::uuid`);
    }
    if (!r) return false;
    await tx.execute(sql`
      INSERT INTO security_audit_events (id, user_id, event_type, subject_id, metadata)
      VALUES (${randomUUID()}, NULL, 'erasure_job_requeued', ${jobId},
              ${JSON.stringify({ actor, reason, previousOutcome: r.last_outcome })}::jsonb)`);
    return true;
  });
}
