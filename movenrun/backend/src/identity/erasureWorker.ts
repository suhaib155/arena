/**
 * The account erasure worker (docs/G34_ERASURE_QUEUE.md). Wired only when
 * gameplay is enabled, where accepted deletions are queued in the proposed
 * job table.
 *
 * Each run claims due jobs one at a time (a lease; SKIP LOCKED, so several
 * API instances can run it at once) and attempts the full erasure in one
 * transaction with every lock wait bounded. A completed attempt completes
 * the job in that same transaction. A failed attempt rolled back whole and
 * is classified: transient (lock timeout, serialization failure, deadlock,
 * statement timeout, connection) goes back to pending with capped,
 * jittered exponential backoff on the database clock; fatal, or the attempt
 * budget spent, goes to needs_attention for an operator. A worker that dies
 * mid-attempt leaves a running job whose lease expires; the next run takes
 * it over, and the dead worker's transaction never committed.
 *
 * Logs carry counts and reason codes only: no user id, email, address,
 * token or error message.
 */
import type { Db } from "../db/client.js";
import {
  DEFAULT_ERASURE_RETRY,
  checkErasureRetryPolicy,
  claimErasureJob,
  classifyErasureError,
  markProviderRemoved,
  parkErasureJob,
  releaseErasureJob,
  type ClaimedErasureJob,
  type ErasureAttemptClass,
  type ErasureRetryPolicy,
} from "../gameplay/erasureJobs.js";
import type { DrizzleAccountDeletionStore, ErasureResult } from "./accountDeletion.js";

export type ErasureWorkerEvent =
  | { kind: "completed"; jobId: string; attempts: number; providerStage: "none" | "queued" | "removed" }
  | { kind: "retry" | "needs_attention"; jobId: string; attempts: number; outcome: ErasureAttemptClass | string }
  | { kind: "lease_lost"; jobId: string; attempts: number };

export interface ErasureWorkerDeps {
  db: Db;
  store: Pick<DrizzleAccountDeletionStore, "eraseJob">;
  /** Removes provider sign-in records after commit; failures stay queued for the existing retry loop. */
  removeProviderUsers?: (subjects: readonly string[]) => Promise<{ removed: string[]; pending: string[] }>;
  policy?: Partial<ErasureRetryPolicy>;
  /** Jitter source in [0, 1) (default Math.random). */
  random?: () => number;
  /** Wall clock for the per-run budget only (default Date.now); job timing uses the database clock. */
  now?: () => number;
  log?: Pick<Console, "info" | "warn">;
  /** Test and benchmark hook; receives ids and codes only. */
  onEvent?: (event: ErasureWorkerEvent) => void;
}

export interface ErasureWorker {
  /** Work through due jobs until none is due, `maxJobs` were attempted or `budgetMs` passed. Returns jobs completed. */
  drain(opts?: { maxJobs?: number; budgetMs?: number }): Promise<number>;
  /** Start a drain in the background unless one is running (after a request is accepted). */
  kick(): void;
  /** Resolves when the background drain started by kick() has finished. */
  idle(): Promise<void>;
  readonly policy: ErasureRetryPolicy;
}

export function createErasureWorker(deps: ErasureWorkerDeps): ErasureWorker {
  const policy = checkErasureRetryPolicy({ ...DEFAULT_ERASURE_RETRY, ...deps.policy });
  const random = deps.random ?? Math.random;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? console;
  const emit = (e: ErasureWorkerEvent) => { try { deps.onEvent?.(e); } catch { /* never let a hook break the worker */ } };
  let running: Promise<number> | null = null;

  const attempt = async (job: ClaimedErasureJob): Promise<boolean> => {
    // A job that keeps coming back from expired leases (its worker died
    // each time) is parked rather than run forever.
    if (job.attempts > policy.maxAttempts) {
      await parkErasureJob(deps.db, job, "attempts_exhausted_lease");
      emit({ kind: "needs_attention", jobId: job.id, attempts: job.attempts, outcome: "attempts_exhausted_lease" });
      log.warn("Account erasure: a job needs attention (attempts_exhausted_lease)");
      return false;
    }
    let result: ErasureResult;
    try {
      result = await deps.store.eraseJob(job, policy.lockTimeoutMs);
    } catch (err) {
      const outcome = classifyErasureError(err);
      if (outcome === "lease_lost") {
        emit({ kind: "lease_lost", jobId: job.id, attempts: job.attempts });
        return false;
      }
      const state = await releaseErasureJob(deps.db, job, outcome, policy, random()).catch(() => null);
      if (state === "needs_attention") {
        emit({ kind: "needs_attention", jobId: job.id, attempts: job.attempts, outcome });
        log.warn(`Account erasure: a job needs attention (${outcome})`);
      } else if (state === "pending") {
        emit({ kind: "retry", jobId: job.id, attempts: job.attempts, outcome });
      }
      // state null: the lease was lost meanwhile, or the database was unreachable;
      // the lease expires and the job is taken over. Nothing was committed.
      return false;
    }
    let providerStage: "none" | "queued" | "removed" = result.providerSubjects.length ? "queued" : "none";
    if (result.providerSubjects.length && deps.removeProviderUsers) {
      try {
        const out = await deps.removeProviderUsers(result.providerSubjects);
        if (out.pending.length === 0) {
          await markProviderRemoved(deps.db, job.id);
          providerStage = "removed";
        }
      } catch {
        // Provider outage: the subjects stay in pending_auth_user_deletions
        // and the sign-in maintenance task retries them.
      }
    }
    emit({ kind: "completed", jobId: job.id, attempts: job.attempts, providerStage });
    return true;
  };

  const drain = async (opts: { maxJobs?: number; budgetMs?: number } = {}): Promise<number> => {
    const maxJobs = opts.maxJobs ?? 50;
    const budgetMs = opts.budgetMs ?? 45_000;
    const started = now();
    let tried = 0;
    let completed = 0;
    while (tried < maxJobs && now() - started < budgetMs) {
      const job = await claimErasureJob(deps.db, policy.leaseMs);
      if (!job) break;
      tried += 1;
      if (await attempt(job)) completed += 1;
    }
    return completed;
  };

  let again = false;
  const start = () => {
    running = drain()
      .catch(() => {
        log.warn("Account erasure: worker run failed; the next run retries");
        return 0;
      })
      .finally(() => {
        running = null;
        // A request accepted while this run was finishing is not left for the next tick.
        if (again) { again = false; start(); }
      });
  };
  const worker: ErasureWorker = {
    policy,
    drain,
    kick() {
      if (running) { again = true; return; }
      start();
    },
    async idle() {
      while (running) await running;
    },
  };
  return worker;
}
