/**
 * Storage for Supabase-backed sign-in: wallet sign-in challenges and auth
 * users still to be removed at the provider. In-memory for tests, Drizzle in
 * production; both give the same single-use guarantee.
 */
import { and, asc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { googleSignInExchanges, pendingAuthUserDeletions, walletSignInChallenges, walletSignInHandoffs } from "../../db/identity.schema.js";

export interface WalletSignInChallenge {
  nonce: string;
  address: string;
  message: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface WalletSignInChallengeStore {
  create(input: { nonce: string; address: string; message: string; expiresAt: Date }): Promise<void>;
  find(nonce: string): Promise<WalletSignInChallenge | null>;
  /** Marks the challenge used. Returns false if it was already used or has expired. */
  consume(nonce: string, at: Date): Promise<boolean>;
  purgeExpired(before: Date): Promise<number>;
}

/**
 * A queued provider deletion is owned by whoever holds its lease. There is no
 * status column: `last_attempt_at` in the future means "in flight until then",
 * in the past means "last tried then", and `attempts` (bumped by every claim)
 * is the owner's token, so only the claimer can finish or release the row.
 * Terminal states (deleted at the provider, already gone, or superseded by a
 * newer sign-in) all retire the row, which is idempotent.
 */
export interface PendingAuthDeletionClaim {
  /** The owner's token: the row's `attempts` after this claim. */
  token: number;
  requestedAt: Date;
}

export interface PendingDeletionStats {
  pending: number;
  /** Rows requested longer ago than the overdue threshold. */
  overdue: number;
  inFlight: number;
}

export interface PendingAuthDeletionStore {
  /** Queues subjects requested at `at` (the database clock when omitted). An already queued subject is left as it is. */
  add(subjects: readonly string[], at?: Date): Promise<void>;
  /**
   * Due rows: never tried first, then the longest waiting, skipping any in
   * flight or still backing off (`retryAfterMs` doubled per attempt, capped at
   * PENDING_DELETION_MAX_BACKOFF_MS).
   */
  due(now: Date, retryAfterMs: number, limit: number): Promise<string[]>;
  /**
   * Takes the row for `leaseMs`, in one conditional write: of concurrent
   * claimers at most one succeeds. Refused while another owner's lease is
   * live, and, when `retryAfterMs` is given, while the row is backing off.
   */
  claim(subject: string, now: Date, opts: { leaseMs: number; retryAfterMs?: number }): Promise<PendingAuthDeletionClaim | null>;
  /** Retires the row if `token` still owns it. */
  finish(subject: string, token: number): Promise<boolean>;
  /** Ends the lease after a failed attempt at `at` if `token` still owns it; the back-off counts from `at`. */
  release(subject: string, token: number, at: Date): Promise<void>;
  /**
   * A sign-in takes the subject over. In one transaction: no row → "none";
   * a row in flight → "busy" (the provider user may be going right now);
   * otherwise the row is retired → "adopted".
   */
  adopt(subject: string, now: Date): Promise<"none" | "busy" | "adopted">;
  /** Counts only, never subjects. */
  stats(now: Date, overdueMs: number): Promise<PendingDeletionStats>;
}

/** Longest wait between two attempts at one provider deletion. */
export const PENDING_DELETION_MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;
export const pendingDeletionBackoffMs = (attempts: number, retryAfterMs: number) =>
  Math.min(retryAfterMs * 2 ** Math.min(Math.max(attempts - 1, 0), 30), PENDING_DELETION_MAX_BACKOFF_MS);

export interface WalletSignInHandoffStore {
  create(input: { codeHash: string; codeChallenge: string; subject: string; expiresAt: Date }): Promise<void>;
  /** Spends the code when the challenge matches and it is unused and unexpired. Returns its subject, or null. */
  consume(codeHash: string, codeChallenge: string, at: Date): Promise<string | null>;
  /** Removes codes that expired unused before `now` and returns their subjects. */
  takeExpired(now: Date, limit: number): Promise<string[]>;
  /** Removes spent codes older than `before`. */
  purgeConsumed(before: Date): Promise<number>;
  /** Whether the subject still has a live code, or one that was spent (its sign-in went ahead). */
  inUse(subject: string, now: Date): Promise<boolean>;
}

export interface GoogleExchangeStore {
  /** Whether the Supabase session was already exchanged. */
  exchanged(sessionId: string): Promise<boolean>;
  /** Records the Supabase session as exchanged, kept until `keepUntil`. Returns false if it already was. */
  claim(sessionId: string, keepUntil: Date): Promise<boolean>;
  /** Removes at most `limit` records kept until before `before`. */
  purgeExpired(before: Date, limit: number): Promise<number>;
}

export interface SignInStores {
  googleExchanges: GoogleExchangeStore;
  walletChallenges: WalletSignInChallengeStore;
  pendingAuthDeletions: PendingAuthDeletionStore;
  walletHandoffs: WalletSignInHandoffStore;
}

export function createInMemorySignInStores(): SignInStores {
  const challenges = new Map<string, WalletSignInChallenge>();
  const pending = new Map<string, { requestedAt: number; seq: number; attempts: number; lastAttemptAt: number | null }>();
  const handoffs = new Map<string, { codeChallenge: string; subject: string; expiresAt: Date; consumedAt: Date | null }>();
  const exchanged = new Map<string, Date>();
  let seq = 0;
  return {
    googleExchanges: {
      async exchanged(sessionId) {
        return exchanged.has(sessionId);
      },
      async claim(sessionId, keepUntil) {
        if (exchanged.has(sessionId)) return false;
        exchanged.set(sessionId, keepUntil);
        return true;
      },
      async purgeExpired(before, limit) {
        let n = 0;
        for (const [k, at] of exchanged) {
          if (n >= limit) break;
          if (at.getTime() < before.getTime()) { exchanged.delete(k); n += 1; }
        }
        return n;
      },
    },
    walletChallenges: {
      async create(input) {
        if (challenges.has(input.nonce)) throw new Error("duplicate nonce");
        challenges.set(input.nonce, { ...input, consumedAt: null });
      },
      async find(nonce) {
        const c = challenges.get(nonce);
        return c ? { ...c } : null;
      },
      async consume(nonce, at) {
        const c = challenges.get(nonce);
        if (!c || c.consumedAt !== null || c.expiresAt.getTime() <= at.getTime()) return false;
        c.consumedAt = at;
        return true;
      },
      async purgeExpired(before) {
        let n = 0;
        for (const [k, c] of challenges) if (c.expiresAt.getTime() < before.getTime()) { challenges.delete(k); n += 1; }
        return n;
      },
    },
    pendingAuthDeletions: {
      async add(subjects, at) {
        for (const s of subjects) if (!pending.has(s)) pending.set(s, { requestedAt: at?.getTime() ?? Date.now(), seq: seq++, attempts: 0, lastAttemptAt: null });
      },
      async due(now, retryAfterMs, limit) {
        const t = now.getTime();
        return [...pending.entries()]
          .filter(([, p]) => p.lastAttemptAt === null || p.lastAttemptAt + pendingDeletionBackoffMs(p.attempts, retryAfterMs) <= t)
          .sort((a, b) => (a[1].lastAttemptAt ?? -Infinity) - (b[1].lastAttemptAt ?? -Infinity) || a[1].requestedAt - b[1].requestedAt || a[1].seq - b[1].seq)
          .slice(0, limit)
          .map(([s]) => s);
      },
      async claim(subject, now, opts) {
        const p = pending.get(subject);
        const t = now.getTime();
        if (!p || (p.lastAttemptAt !== null && p.lastAttemptAt > t)) return null;
        if (opts.retryAfterMs !== undefined && p.lastAttemptAt !== null && p.lastAttemptAt + pendingDeletionBackoffMs(p.attempts, opts.retryAfterMs) > t) return null;
        p.attempts += 1;
        p.lastAttemptAt = t + opts.leaseMs;
        return { token: p.attempts, requestedAt: new Date(p.requestedAt) };
      },
      async finish(subject, token) {
        const p = pending.get(subject);
        if (!p || p.attempts !== token) return false;
        pending.delete(subject);
        return true;
      },
      async release(subject, token, at) {
        const p = pending.get(subject);
        if (p && p.attempts === token) p.lastAttemptAt = at.getTime();
      },
      async adopt(subject, now) {
        const p = pending.get(subject);
        if (!p) return "none";
        if (p.lastAttemptAt !== null && p.lastAttemptAt > now.getTime()) return "busy";
        pending.delete(subject);
        return "adopted";
      },
      async stats(now, overdueMs) {
        const t = now.getTime();
        let overdue = 0;
        let inFlight = 0;
        for (const p of pending.values()) {
          if (p.requestedAt <= t - overdueMs) overdue += 1;
          if (p.lastAttemptAt !== null && p.lastAttemptAt > t) inFlight += 1;
        }
        return { pending: pending.size, overdue, inFlight };
      },
    },
    walletHandoffs: {
      async create(input) {
        if (handoffs.has(input.codeHash)) throw new Error("duplicate code");
        handoffs.set(input.codeHash, { codeChallenge: input.codeChallenge, subject: input.subject, expiresAt: input.expiresAt, consumedAt: null });
      },
      async consume(codeHash, codeChallenge, at) {
        const h = handoffs.get(codeHash);
        if (!h || h.consumedAt !== null || h.codeChallenge !== codeChallenge || h.expiresAt.getTime() <= at.getTime()) return null;
        h.consumedAt = at;
        return h.subject;
      },
      async takeExpired(now, limit) {
        const out: string[] = [];
        for (const [k, h] of handoffs) {
          if (out.length >= limit) break;
          if (h.consumedAt === null && h.expiresAt.getTime() <= now.getTime()) { handoffs.delete(k); out.push(h.subject); }
        }
        return out;
      },
      async purgeConsumed(before) {
        let n = 0;
        for (const [k, h] of handoffs) if (h.consumedAt !== null && h.consumedAt.getTime() < before.getTime()) { handoffs.delete(k); n += 1; }
        return n;
      },
      async inUse(subject, now) {
        for (const h of handoffs.values()) {
          if (h.subject === subject && (h.consumedAt !== null || h.expiresAt.getTime() > now.getTime())) return true;
        }
        return false;
      },
    },
  };
}

/** Timestamps are stored without a zone, in UTC, as Drizzle writes them. */
const iso = (at: Date) => at.toISOString();

/** The back-off after the row's attempts, as an SQL interval (see `pendingDeletionBackoffMs`). */
const backoffSql = (retryAfterMs: number) =>
  sql`(least(${retryAfterMs}::float8 * power(2, least(greatest(${pendingAuthUserDeletions.attempts} - 1, 0), 30)), ${PENDING_DELETION_MAX_BACKOFF_MS}::float8) * interval '1 millisecond')`;

export function createDrizzleSignInStores(db: Db): SignInStores {
  return {
    googleExchanges: {
      async exchanged(sessionId) {
        const [row] = await db.select({ sessionId: googleSignInExchanges.sessionId }).from(googleSignInExchanges)
          .where(eq(googleSignInExchanges.sessionId, sessionId)).limit(1);
        return row !== undefined;
      },
      async claim(sessionId, keepUntil) {
        // The primary key decides: of two concurrent exchanges, one inserts.
        const rows = await db.insert(googleSignInExchanges).values({ sessionId, expiresAt: keepUntil })
          .onConflictDoNothing().returning({ sessionId: googleSignInExchanges.sessionId });
        return rows.length === 1;
      },
      async purgeExpired(before, limit) {
        // Bounded, so a wake after a long sleep never turns one sign-in into a long delete.
        const due = db.select({ sessionId: googleSignInExchanges.sessionId }).from(googleSignInExchanges)
          .where(lt(googleSignInExchanges.expiresAt, before)).limit(limit);
        const rows = await db.delete(googleSignInExchanges).where(inArray(googleSignInExchanges.sessionId, due))
          .returning({ sessionId: googleSignInExchanges.sessionId });
        return rows.length;
      },
    },
    walletChallenges: {
      async create(input) {
        await db.insert(walletSignInChallenges).values(input);
      },
      async find(nonce) {
        const [row] = await db.select().from(walletSignInChallenges).where(eq(walletSignInChallenges.nonce, nonce)).limit(1);
        return row ? { nonce: row.nonce, address: row.address, message: row.message, expiresAt: row.expiresAt, consumedAt: row.consumedAt } : null;
      },
      async consume(nonce, at) {
        // One conditional update: of two concurrent completions only one row transitions.
        const rows = await db
          .update(walletSignInChallenges)
          .set({ consumedAt: at })
          .where(and(eq(walletSignInChallenges.nonce, nonce), isNull(walletSignInChallenges.consumedAt), gt(walletSignInChallenges.expiresAt, at)))
          .returning({ nonce: walletSignInChallenges.nonce });
        return rows.length === 1;
      },
      async purgeExpired(before) {
        const rows = await db.delete(walletSignInChallenges).where(lt(walletSignInChallenges.expiresAt, before)).returning({ nonce: walletSignInChallenges.nonce });
        return rows.length;
      },
    },
    pendingAuthDeletions: {
      async add(subjects, at) {
        if (subjects.length === 0) return;
        await db.insert(pendingAuthUserDeletions).values(subjects.map((subject) => (at ? { subject, requestedAt: at } : { subject }))).onConflictDoNothing();
      },
      async due(now, retryAfterMs, limit) {
        const t = pendingAuthUserDeletions;
        const rows = await db
          .select({ subject: t.subject })
          .from(t)
          .where(sql`${t.lastAttemptAt} is null or ${t.lastAttemptAt} + ${backoffSql(retryAfterMs)} <= ${iso(now)}`)
          .orderBy(sql`${t.lastAttemptAt} asc nulls first`, asc(t.requestedAt), asc(t.subject))
          .limit(limit);
        return rows.map((r) => r.subject);
      },
      async claim(subject, now, opts) {
        const t = pendingAuthUserDeletions;
        // One conditional update: Postgres re-checks the condition on the row's
        // latest version after any concurrent claim commits, so only one wins.
        const backingOff = opts.retryAfterMs === undefined
          ? sql`false`
          : sql`${t.lastAttemptAt} + ${backoffSql(opts.retryAfterMs)} > ${iso(now)}`;
        const rows = await db
          .update(t)
          .set({ attempts: sql`${t.attempts} + 1`, lastAttemptAt: new Date(now.getTime() + opts.leaseMs) })
          .where(and(eq(t.subject, subject), sql`(${t.lastAttemptAt} is null or (${t.lastAttemptAt} <= ${iso(now)} and not (${backingOff})))`))
          .returning({ token: t.attempts, requestedAt: t.requestedAt });
        return rows[0] ?? null;
      },
      async finish(subject, token) {
        const t = pendingAuthUserDeletions;
        const rows = await db.delete(t).where(and(eq(t.subject, subject), eq(t.attempts, token))).returning({ subject: t.subject });
        return rows.length === 1;
      },
      async release(subject, token, at) {
        const t = pendingAuthUserDeletions;
        await db.update(t).set({ lastAttemptAt: at }).where(and(eq(t.subject, subject), eq(t.attempts, token)));
      },
      async adopt(subject, now) {
        const t = pendingAuthUserDeletions;
        return db.transaction(async (tx) => {
          // The row lock waits for a claim in progress and then reads its result.
          const [row] = await tx.select({ lastAttemptAt: t.lastAttemptAt }).from(t).where(eq(t.subject, subject)).for("update");
          if (!row) return "none" as const;
          if (row.lastAttemptAt && row.lastAttemptAt.getTime() > now.getTime()) return "busy" as const;
          await tx.delete(t).where(eq(t.subject, subject));
          return "adopted" as const;
        });
      },
      async stats(now, overdueMs) {
        const t = pendingAuthUserDeletions;
        const [row] = await db
          .select({
            pending: sql<number>`count(*)::int`,
            overdue: sql<number>`(count(*) filter (where ${t.requestedAt} <= ${iso(new Date(now.getTime() - overdueMs))}))::int`,
            inFlight: sql<number>`(count(*) filter (where ${t.lastAttemptAt} > ${iso(now)}))::int`,
          })
          .from(t);
        return { pending: row?.pending ?? 0, overdue: row?.overdue ?? 0, inFlight: row?.inFlight ?? 0 };
      },
    },
    walletHandoffs: {
      async create(input) {
        await db.insert(walletSignInHandoffs).values(input);
      },
      async consume(codeHash, codeChallenge, at) {
        // One conditional update: a code is spent at most once, and only with the right verifier.
        const rows = await db
          .update(walletSignInHandoffs)
          .set({ consumedAt: at })
          .where(and(
            eq(walletSignInHandoffs.codeHash, codeHash),
            eq(walletSignInHandoffs.codeChallenge, codeChallenge),
            isNull(walletSignInHandoffs.consumedAt),
            gt(walletSignInHandoffs.expiresAt, at),
          ))
          .returning({ subject: walletSignInHandoffs.subject });
        return rows[0]?.subject ?? null;
      },
      async takeExpired(now, limit) {
        const rows = await db.execute<{ subject: string }>(sql`
          delete from ${walletSignInHandoffs}
          where ${walletSignInHandoffs.codeHash} in (
            select ${walletSignInHandoffs.codeHash} from ${walletSignInHandoffs}
            where ${walletSignInHandoffs.consumedAt} is null and ${walletSignInHandoffs.expiresAt} <= ${now}
            order by ${walletSignInHandoffs.expiresAt} limit ${limit}
          )
          returning ${walletSignInHandoffs.subject} as subject`);
        return rows.rows.map((r) => r.subject);
      },
      async purgeConsumed(before) {
        const rows = await db
          .delete(walletSignInHandoffs)
          .where(lt(walletSignInHandoffs.consumedAt, before))
          .returning({ codeHash: walletSignInHandoffs.codeHash });
        return rows.length;
      },
      async inUse(subject, now) {
        const [row] = await db
          .select({ codeHash: walletSignInHandoffs.codeHash })
          .from(walletSignInHandoffs)
          .where(and(
            eq(walletSignInHandoffs.subject, subject),
            sql`(${walletSignInHandoffs.consumedAt} is not null or ${walletSignInHandoffs.expiresAt} > ${now})`,
          ))
          .limit(1);
        return Boolean(row);
      },
    },
  };
}
