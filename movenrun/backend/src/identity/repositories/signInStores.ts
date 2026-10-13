/**
 * Storage for Supabase-backed sign-in: wallet sign-in challenges and auth
 * users still to be removed at the provider. In-memory for tests, Drizzle in
 * production; both give the same single-use guarantee.
 */
import { and, asc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { pendingAuthUserDeletions, walletSignInChallenges } from "../../db/identity.schema.js";

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

export interface PendingAuthDeletionStore {
  add(subjects: readonly string[]): Promise<void>;
  remove(subject: string): Promise<void>;
  /** Oldest first, skipping any tried within `retryAfter`. */
  due(now: Date, retryAfterMs: number, limit: number): Promise<string[]>;
  markAttempt(subject: string, at: Date): Promise<void>;
}

export interface SignInStores {
  walletChallenges: WalletSignInChallengeStore;
  pendingAuthDeletions: PendingAuthDeletionStore;
}

export function createInMemorySignInStores(): SignInStores {
  const challenges = new Map<string, WalletSignInChallenge>();
  const pending = new Map<string, { requestedAt: number; lastAttemptAt: number | null }>();
  let seq = 0;
  return {
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
      async add(subjects) {
        for (const s of subjects) if (!pending.has(s)) pending.set(s, { requestedAt: seq++, lastAttemptAt: null });
      },
      async remove(subject) {
        pending.delete(subject);
      },
      async due(now, retryAfterMs, limit) {
        return [...pending.entries()]
          .filter(([, p]) => p.lastAttemptAt === null || now.getTime() - p.lastAttemptAt >= retryAfterMs)
          .sort((a, b) => a[1].requestedAt - b[1].requestedAt)
          .slice(0, limit)
          .map(([s]) => s);
      },
      async markAttempt(subject, at) {
        const p = pending.get(subject);
        if (p) p.lastAttemptAt = at.getTime();
      },
    },
  };
}

export function createDrizzleSignInStores(db: Db): SignInStores {
  return {
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
      async add(subjects) {
        if (subjects.length === 0) return;
        await db.insert(pendingAuthUserDeletions).values(subjects.map((subject) => ({ subject }))).onConflictDoNothing();
      },
      async remove(subject) {
        await db.delete(pendingAuthUserDeletions).where(eq(pendingAuthUserDeletions.subject, subject));
      },
      async due(now, retryAfterMs, limit) {
        const cutoff = new Date(now.getTime() - retryAfterMs);
        const rows = await db
          .select({ subject: pendingAuthUserDeletions.subject })
          .from(pendingAuthUserDeletions)
          .where(sql`${pendingAuthUserDeletions.lastAttemptAt} is null or ${pendingAuthUserDeletions.lastAttemptAt} <= ${cutoff}`)
          .orderBy(asc(pendingAuthUserDeletions.requestedAt))
          .limit(limit);
        return rows.map((r) => r.subject);
      },
      async markAttempt(subject, at) {
        await db
          .update(pendingAuthUserDeletions)
          .set({ attempts: sql`${pendingAuthUserDeletions.attempts} + 1`, lastAttemptAt: at })
          .where(eq(pendingAuthUserDeletions.subject, subject));
      },
    },
  };
}
