/**
 * Account deletion — the user's right to erase their MovenRun account.
 *
 * Google Play requires that an app which lets people create an account also
 * lets them delete it, in the app and from a public web page. This module is
 * the server half of both paths: the in-app action calls it directly with the
 * signed-in session, and a request made through the web page is completed by
 * the same action once the person signs in with the account's email.
 *
 * What is erased, in one transaction, for the account's user id:
 *  - verified movement sessions (distance, duration, traversed cells);
 *  - every sign-in session and refresh credential (all devices sign out);
 *  - sign-in methods, including the stored email address;
 *  - pending email codes for those addresses;
 *  - wallet rows and wallet-link challenges (none exist in Play v1, but any
 *    left by an earlier preview build go too);
 *  - the account's security audit history;
 *  - gameplay (only where the proposed migration 0011 exists, whatever the
 *    feature flag says): every row naming the person; each settled credit
 *    line of theirs is replaced by a random per-day tombstone and each
 *    settled day they touched gets a hash-chained erasure record, so closed
 *    books still reconcile (docs/G34_ERASURE_TOMBSTONES.md);
 *  - the user row itself;
 *  - the Supabase Auth user behind "Continue with Google" / "Continue with
 *    Wallet": queued in the same transaction and removed at the provider right
 *    after commit, then retried until the provider confirms. The two systems
 *    cannot share one transaction, so the queue is what makes this reliable.
 *
 * What is kept: one `account_deleted` audit event with no user id, no email
 * and no metadata, so operators can count deletions without being able to say
 * whose they were. Nothing else survives. Backups age out on the hosting
 * provider's retention schedule (see docs/play-launch/DATA_INVENTORY.md).
 *
 * Deliberately not a soft delete. A `disabled` flag would keep the email and
 * the movement history, which is exactly what the person asked us to remove.
 *
 * Two ways in (docs/G34_ERASURE_QUEUE.md):
 *  - synchronous (gameplay off, or no 0011): `erase` runs the whole
 *    transaction during the request. Every lock wait is bounded
 *    (lock_timeout); when the budget runs out, or the transaction loses to a
 *    serialization failure or deadlock, nothing was written and the caller
 *    gets ErasureBusyError (HTTP 503 `deletion_busy`, Retry-After).
 *  - queued (gameplay on and the proposed job table present): `request`
 *    commits a short acceptance transaction (the account is marked
 *    "deleting", every session ends, the security version is bumped and one
 *    job row is written; it takes no gameplay lock) and returns the job id.
 *    The erasure worker runs `eraseJob` later, with retries, and completes
 *    the job in the erasure transaction itself. Until then the API says
 *    "pending", never "deleted".
 */
import { eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Db } from "../db/client.js";
import {
  authIdentities,
  authSessions,
  emailOtpChallenges,
  pendingAuthUserDeletions,
  securityAuditEvents,
  users,
  walletLinkChallenges,
  wallets,
} from "../db/identity.schema.js";
import { movementVerifications } from "../db/movement.schema.js";
import { GameplayService, type ErasurePlan } from "../gameplay/service.js";
import { PILOT_PROPOSAL } from "../gameplay/rules.js";
import {
  TRANSIENT_ERASURE_CLASSES,
  classifyErasureError,
  completeOpenErasureJobs,
  erasureJobStatus,
  erasureJobsPresent,
  holdErasureLease,
  insertErasureJob,
  openErasureJob,
  type ClaimedErasureJob,
  type ErasureAttemptClass,
} from "../gameplay/erasureJobs.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * The gameplay service used only for erasure. Erasure replays each day under
 * the rule set that day is pinned to, so the season start configured here
 * is never read.
 */
function erasureService(db: Db): GameplayService {
  return new GameplayService({ db, rules: { ...PILOT_PROPOSAL, holding: { ...PILOT_PROPOSAL.holding }, seasonOneStartDay: 0 } });
}

/** Rows removed per table. Counts only; never contents. */
export interface ErasureCounts {
  users: number;
  identities: number;
  sessions: number;
  otpChallenges: number;
  wallets: number;
  walletChallenges: number;
  auditEvents: number;
  movementSessions: number;
}

export interface ErasureResult extends ErasureCounts {
  /** Supabase user ids queued for removal at the provider. Never returned to clients. */
  providerSubjects: string[];
}

/** What a deletion request led to. */
export type DeletionRequestOutcome =
  /** Erased during the request (synchronous path, or the account was already gone). */
  | { status: "completed"; result: ErasureResult }
  /** Accepted and durably queued: signed out, cannot sign in, erasure not finished yet. */
  | { status: "pending"; requestId: string };

/** What a status lookup may tell the holder of a request id. Nothing about the account. */
export interface DeletionStatus {
  status: "pending" | "completed";
  /** An attempt failed and is being retried, or an operator is needed (needs_attention); still pending, not lost. */
  delayed: boolean;
  /** The provider sign-in record: only known once the data erasure finished. */
  signInRecord: "pending" | "removed" | "none";
}

export interface AccountDeletionStore {
  /**
   * Erase everything held for `userId`, now, in one transaction. Idempotent:
   * erasing an account that is already gone succeeds with zero counts, so a
   * retried request after a lost response never reports a failure the person
   * cannot act on. Throws ErasureBusyError when it could not finish within
   * its lock budget (nothing written).
   */
  erase(userId: string): Promise<ErasureResult>;
  /** Accept a deletion: queued when the store has a queue, otherwise `erase`. */
  request?(userId: string): Promise<DeletionRequestOutcome>;
  /** Status of a queued request by its opaque id; null when unknown. */
  status?(requestId: string): Promise<DeletionStatus | null>;
}

/** The exact confirmation the client must send; guards against a stray tap. */
export const ACCOUNT_DELETION_CONFIRMATION = "DELETE";

/**
 * The deletion could not run within its time budget: a lock was not granted
 * in time, a statement timed out, or the transaction lost to a concurrent
 * one. Its transaction rolled back, so nothing was erased and nothing was
 * scheduled; the request may be repeated.
 */
export class ErasureBusyError extends Error {
  constructor(readonly reason: ErasureAttemptClass) {
    super(`account deletion busy: ${reason}`);
    this.name = "ErasureBusyError";
  }
}

export interface AccountDeletionOptions {
  /**
   * Accept deletions as durable jobs (only where the proposed job table
   * exists; otherwise the request is erased synchronously). Wired only when
   * gameplay is enabled. `onAccepted` runs after the acceptance committed
   * (the API starts the worker).
   */
  queue?: { onAccepted?: () => void } | null;
  /** Lock budget of the synchronous erasure, per lock wait (default 5 s). */
  lockTimeoutMs?: number;
  /** Lock budget of the acceptance transaction, per lock wait (default 2 s). */
  acceptLockTimeoutMs?: number;
}

const ms = (v: number) => sql.raw(`'${Math.max(1, Math.floor(v))}ms'`);

function busyOrRethrow(err: unknown): never {
  const cls = classifyErasureError(err);
  if (TRANSIENT_ERASURE_CLASSES.has(cls)) throw new ErasureBusyError(cls);
  throw err;
}

/**
 * The whole erasure in one transaction. Lock order: the gameplay erasure
 * fence (when 0011 exists), the account row, then (for a queued job) the
 * job row; every lock wait is bounded by `lockTimeoutMs`.
 */
async function eraseInTx(db: Db, tx: Tx, userId: string, lockTimeoutMs: number, job?: ClaimedErasureJob): Promise<ErasureResult> {
  await tx.execute(sql`SET LOCAL lock_timeout = ${ms(lockTimeoutMs)}`);
  // The gameplay erasure fence comes first, before the account row, in
  // the same order a day close takes it. A database without 0011 has no
  // fence, no job table and no gameplay relation.
  const present = await tx.execute(sql`
    SELECT to_regclass('public.gameplay_erasure_fence') IS NOT NULL AS ok,
           to_regclass('public.gameplay_account_deletion_jobs') IS NOT NULL AS jobs`);
  const row = present.rows[0] as { ok?: boolean; jobs?: boolean } | undefined;
  const hasGameplay = Boolean(row?.ok);
  const hasJobs = Boolean(row?.jobs);
  if (hasGameplay) await erasureService(db).takeErasureFence(tx);

  // Lock the account row. Two deletion requests serialise on it, and a
  // session or identity insert for this user (its foreign-key check takes
  // a key-share lock) waits for the erase and then fails, so no new
  // sign-in can survive the deletion.
  const locked = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
  // A queued job: still ours? (Another worker may have taken it over after
  // our lease expired; then this attempt must not erase or complete.)
  if (job) {
    if (!hasJobs) throw new Error("erasure job without the job table");
    await holdErasureLease(tx, job);
  }

  // Gameplay erasure, phase 1, before anything is deleted.
  let gameplay: ErasurePlan | null = null;
  if (locked.length && hasGameplay) gameplay = await erasureService(db).eraseBegin(tx, userId);

  const emailRows = await tx
    .select({ subject: authIdentities.providerSubject, email: authIdentities.normalizedEmail, provider: authIdentities.provider })
    .from(authIdentities)
    .where(eq(authIdentities.userId, userId));
  const emails = [
    ...new Set(
      emailRows
        .flatMap((r) => [r.email, r.provider === "email_otp" ? r.subject : null])
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  ];

  const providerSubjects = [...new Set(emailRows.filter((r) => r.provider === "supabase").map((r) => r.subject))];
  if (providerSubjects.length) {
    await tx.insert(pendingAuthUserDeletions).values(providerSubjects.map((subject) => ({ subject }))).onConflictDoNothing();
  }

  const movementSessions = await tx.delete(movementVerifications).where(eq(movementVerifications.userId, userId)).returning({ id: movementVerifications.id });
  const sessions = await tx.delete(authSessions).where(eq(authSessions.userId, userId)).returning({ id: authSessions.id });
  const walletChallenges = await tx.delete(walletLinkChallenges).where(eq(walletLinkChallenges.userId, userId)).returning({ id: walletLinkChallenges.id });
  const walletRows = await tx.delete(wallets).where(eq(wallets.userId, userId)).returning({ id: wallets.id });
  const identities = await tx.delete(authIdentities).where(eq(authIdentities.userId, userId)).returning({ id: authIdentities.id });
  const otpChallenges = emails.length
    ? await tx.delete(emailOtpChallenges).where(inArray(emailOtpChallenges.normalizedEmail, emails)).returning({ id: emailOtpChallenges.id })
    : [];
  const auditEvents = await tx.delete(securityAuditEvents).where(eq(securityAuditEvents.userId, userId)).returning({ id: securityAuditEvents.id });
  // Phase 2: the person's sessions are gone; erase and tombstone their
  // gameplay rows before the user row (which they would otherwise block).
  if (gameplay) await erasureService(db).eraseComplete(tx, gameplay);
  // Any open erasure job of this account completes in this transaction and
  // forgets the user id (its foreign key would otherwise block the delete).
  if (hasJobs) await completeOpenErasureJobs(tx, userId, providerSubjects.length ? "queued" : "none");
  const userRows = locked.length
    ? await tx.delete(users).where(eq(users.id, userId)).returning({ id: users.id })
    : [];

  if (userRows.length) {
    await tx.insert(securityAuditEvents).values({
      id: randomUUID(),
      userId: null,
      eventType: "account_deleted",
      subjectId: null,
      metadata: null,
    });
  }

  return {
    users: userRows.length,
    identities: identities.length,
    sessions: sessions.length,
    otpChallenges: otpChallenges.length,
    wallets: walletRows.length,
    walletChallenges: walletChallenges.length,
    auditEvents: auditEvents.length,
    movementSessions: movementSessions.length,
    providerSubjects,
  };
}

const ZERO: ErasureResult = { users: 0, identities: 0, sessions: 0, otpChallenges: 0, wallets: 0, walletChallenges: 0, auditEvents: 0, movementSessions: 0, providerSubjects: [] };

export interface DrizzleAccountDeletionStore extends Required<AccountDeletionStore> {
  /** One worker attempt at a claimed job. Throws on failure (classified by the worker). */
  eraseJob(job: ClaimedErasureJob, lockTimeoutMs: number): Promise<ErasureResult>;
  /**
   * Accounts marked "deleting" whose erasure is not queued (gameplay was
   * switched off, or the job table rolled back): erase them synchronously.
   * Returns how many were erased. Used only when the queue is not wired.
   */
  sweepDeleting(limit?: number): Promise<number>;
}

export function createDrizzleAccountDeletionStore(db: Db, options: AccountDeletionOptions = {}): DrizzleAccountDeletionStore {
  const lockTimeoutMs = options.lockTimeoutMs ?? 5_000;
  const acceptLockTimeoutMs = options.acceptLockTimeoutMs ?? 2_000;

  const erase = async (userId: string): Promise<ErasureResult> => {
    try {
      return await db.transaction((tx) => eraseInTx(db, tx, userId, lockTimeoutMs));
    } catch (err) {
      busyOrRethrow(err);
    }
  };

  return {
    erase,

    async eraseJob(job, jobLockTimeoutMs) {
      return db.transaction((tx) => eraseInTx(db, tx, job.userId, jobLockTimeoutMs, job));
    },

    async request(userId) {
      if (!options.queue) return { status: "completed", result: await erase(userId) };
      let accepted: DeletionRequestOutcome | "sync";
      try {
        accepted = await db.transaction(async (tx): Promise<DeletionRequestOutcome | "sync"> => {
          await tx.execute(sql`SET LOCAL lock_timeout = ${ms(acceptLockTimeoutMs)}`);
          if (!(await erasureJobsPresent(tx))) return "sync";
          // A repeated request finds the job already accepted.
          const open = await openErasureJob(tx, userId);
          if (open) return { status: "pending", requestId: open };
          // No gameplay lock here (no fence): only the account row, briefly.
          const locked = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
          if (!locked.length) return { status: "completed", result: { ...ZERO } };
          const again = await openErasureJob(tx, userId);
          if (again) return { status: "pending", requestId: again };
          const requestId = await insertErasureJob(tx, userId);
          // Signed out everywhere, now: every session goes, outstanding access
          // tokens die with the security version, and "deleting" refuses any
          // new sign-in or refresh until the erasure removes the account.
          await tx.update(users)
            .set({ status: "deleting", securityVersion: sql`${users.securityVersion} + 1`, disabledAt: sql`now()`, updatedAt: sql`now()` })
            .where(eq(users.id, userId));
          await tx.delete(authSessions).where(eq(authSessions.userId, userId));
          return { status: "pending", requestId };
        });
      } catch (err) {
        busyOrRethrow(err);
      }
      if (accepted === "sync") return { status: "completed", result: await erase(userId) };
      if (accepted.status === "pending") {
        try { options.queue.onAccepted?.(); } catch { /* the maintenance loop picks the job up anyway */ }
      }
      return accepted;
    },

    async status(requestId) {
      if (!(await erasureJobsPresent(db))) return null;
      const job = await erasureJobStatus(db, requestId);
      if (!job) return null;
      if (job.state === "completed") {
        return { status: "completed", delayed: false, signInRecord: job.providerStage === "removed" ? "removed" : job.providerStage === "queued" ? "pending" : "none" };
      }
      // Delayed: an attempt already failed (a running job counts its current attempt).
      const failedAttempts = job.state === "running" ? job.attempts - 1 : job.attempts;
      return { status: "pending", delayed: job.state === "needs_attention" || failedAttempts > 0, signInRecord: "pending" };
    },

    async sweepDeleting(limit = 20) {
      const due = await db.select({ id: users.id }).from(users).where(eq(users.status, "deleting")).orderBy(users.updatedAt).limit(limit);
      let erased = 0;
      for (const { id } of due) {
        try {
          erased += (await erase(id)).users;
        } catch (err) {
          if (!(err instanceof ErasureBusyError)) throw err;
        }
      }
      return erased;
    },
  };
}
