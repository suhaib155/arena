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

export interface AccountDeletionStore {
  /**
   * Erase everything held for `userId`. Idempotent: erasing an account that is
   * already gone succeeds with zero counts, so a retried request after a lost
   * response never reports a failure the person cannot act on.
   */
  erase(userId: string): Promise<ErasureResult>;
}

/** The exact confirmation the client must send; guards against a stray tap. */
export const ACCOUNT_DELETION_CONFIRMATION = "DELETE";

export function createDrizzleAccountDeletionStore(db: Db): AccountDeletionStore {
  return {
    async erase(userId) {
      return db.transaction(async (tx) => {
        // The gameplay erasure fence comes first, before the account row, in
        // the same order a day close takes it. A database without 0011 has no
        // fence and no gameplay relation.
        const present = await tx.execute(sql`SELECT to_regclass('public.gameplay_erasure_fence') IS NOT NULL AS ok`);
        const hasGameplay = Boolean((present.rows[0] as { ok?: boolean } | undefined)?.ok);
        if (hasGameplay) await erasureService(db).takeErasureFence(tx);

        // Lock the account row. Two deletion requests serialise on it, and a
        // session or identity insert for this user (its foreign-key check takes
        // a key-share lock) waits for the erase and then fails, so no new
        // sign-in can survive the deletion.
        const locked = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");

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
              .flatMap((row) => [row.email, row.provider === "email_otp" ? row.subject : null])
              .filter((value): value is string => typeof value === "string" && value.length > 0),
          ),
        ];

        const providerSubjects = [...new Set(emailRows.filter((row) => row.provider === "supabase").map((row) => row.subject))];
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
      });
    },
  };
}
