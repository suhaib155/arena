/**
 * Postgres-backed repository implementations (production wiring).
 *
 * Each mirrors the corresponding in-memory repository's semantics in SQL, and
 * translates a Postgres unique-violation (SQLSTATE 23505) on a known index
 * into the typed UniqueConstraintError the services already handle — the same
 * pattern as DrizzleRouteRepository/RouteHashConflictError.
 *
 * The security-critical atomic operations are done in the DB, not in process:
 *  - challenge / OTP consume is a conditional `UPDATE ... WHERE consumed_at IS
 *    NULL RETURNING *`, so a replay across replicas or after a restart returns
 *    zero rows;
 *  - "set sole active wallet" and "create user + first identity" run inside a
 *    transaction so their invariants hold under concurrency.
 */
import { and, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "../../../db/client.js";
import {
  authIdentities,
  authSessions,
  emailOtpChallenges,
  securityAuditEvents,
  users,
  walletLinkChallenges,
  wallets,
} from "../../../db/identity.schema.js";
import {
  UniqueConstraintError,
  type AuditEventRepository,
  type AuthIdentityRepository,
  type CreateAuditEventInput,
  type CreateAuthIdentityInput,
  type CreateOtpChallengeInput,
  type CreateSessionInput,
  type CreateWalletChallengeInput,
  type CreateWalletInput,
  type IdentityStores,
  type OtpChallengeRepository,
  type SessionRepository,
  type UniqueConstraint,
  type UserRepository,
  type WalletChallengeRepository,
  type WalletRepository,
  type WalletUpdatePatch,
} from "../interfaces.js";
import type {
  AuditEventRecord,
  AuthIdentityRecord,
  EmailOtpChallengeRecord,
  SessionRecord,
  UserRecord,
  WalletChallengeRecord,
  WalletRecord,
} from "../records.js";
import type { SessionRevocationReason, SessionStatus } from "../../domain/types.js";

const KNOWN_CONSTRAINTS: UniqueConstraint[] = [
  "auth_identities_provider_subject_active_unique",
  "wallets_verified_address_unique",
  "wallets_active_per_user_unique",
  "wallets_embedded_per_user_provider_unique",
  "auth_sessions_refresh_hash_unique",
  "wallet_link_challenges_nonce_unique",
];

/** Map a pg unique-violation to our typed error, or return null if it isn't
 *  one we model. Unique-index violations surface the index name in
 *  `err.constraint`; we also scan `err.detail` as a fallback. */
function mapUniqueViolation(err: unknown): UniqueConstraintError | null {
  const e = err as { code?: string; constraint?: string; detail?: string };
  if (e?.code !== "23505") return null;
  const named = KNOWN_CONSTRAINTS.find((c) => c === e.constraint);
  if (named) return new UniqueConstraintError(named);
  const inDetail = KNOWN_CONSTRAINTS.find((c) => typeof e.detail === "string" && e.detail.includes(c));
  if (inDetail) return new UniqueConstraintError(inDetail);
  return null;
}

function rethrowUnique(err: unknown): never {
  const mapped = mapUniqueViolation(err);
  if (mapped) throw mapped;
  throw err;
}

// ---- mappers -------------------------------------------------------------

const toUser = (r: typeof users.$inferSelect): UserRecord => ({ ...r });
const toIdentity = (r: typeof authIdentities.$inferSelect): AuthIdentityRecord => ({ ...r });
const toWallet = (r: typeof wallets.$inferSelect): WalletRecord => ({ ...r });
const toSession = (r: typeof authSessions.$inferSelect): SessionRecord => ({ ...r });
const toChallenge = (r: typeof walletLinkChallenges.$inferSelect): WalletChallengeRecord => ({ ...r });
const toOtp = (r: typeof emailOtpChallenges.$inferSelect): EmailOtpChallengeRecord => ({ ...r });
const toAudit = (r: typeof securityAuditEvents.$inferSelect): AuditEventRecord => ({
  ...r,
  metadata: (r.metadata as Record<string, unknown> | null) ?? null,
});

// ---- repositories --------------------------------------------------------

export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db: Db) {}
  async create(input: { id: string; status?: "active" | "disabled" }): Promise<UserRecord> {
    const [row] = await this.db.insert(users).values({ id: input.id, status: input.status ?? "active" }).returning();
    return toUser(row);
  }
  async findById(id: string): Promise<UserRecord | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ? toUser(row) : null;
  }
  async bumpSecurityVersion(id: string): Promise<UserRecord | null> {
    // Atomic in-database increment — a read-then-write here could coalesce two
    // concurrent bumps across replicas into one.
    const [row] = await this.db
      .update(users)
      .set({ securityVersion: sql`${users.securityVersion} + 1`, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return row ? toUser(row) : null;
  }
  async disable(id: string): Promise<UserRecord | null> {
    const now = new Date();
    const [row] = await this.db
      .update(users)
      .set({ status: "disabled", disabledAt: now, updatedAt: now })
      .where(eq(users.id, id))
      .returning();
    return row ? toUser(row) : null;
  }
}

export class DrizzleAuthIdentityRepository implements AuthIdentityRepository {
  constructor(private readonly db: Db) {}
  async create(input: CreateAuthIdentityInput): Promise<AuthIdentityRecord> {
    try {
      const [row] = await this.db
        .insert(authIdentities)
        .values({
          id: input.id,
          userId: input.userId,
          provider: input.provider,
          providerSubject: input.providerSubject,
          normalizedEmail: input.normalizedEmail ?? null,
          verificationStatus: input.verificationStatus ?? "unverified",
          assuranceLevel: input.assuranceLevel ?? "aal1",
        })
        .returning();
      return toIdentity(row);
    } catch (err) {
      rethrowUnique(err);
    }
  }
  async findById(id: string): Promise<AuthIdentityRecord | null> {
    const [row] = await this.db.select().from(authIdentities).where(eq(authIdentities.id, id)).limit(1);
    return row ? toIdentity(row) : null;
  }
  async findActiveByProviderSubject(
    provider: CreateAuthIdentityInput["provider"],
    providerSubject: string
  ): Promise<AuthIdentityRecord | null> {
    const [row] = await this.db
      .select()
      .from(authIdentities)
      .where(
        and(
          eq(authIdentities.provider, provider),
          eq(authIdentities.providerSubject, providerSubject),
          isNull(authIdentities.revokedAt)
        )
      )
      .limit(1);
    return row ? toIdentity(row) : null;
  }
  async listActiveByUser(userId: string): Promise<AuthIdentityRecord[]> {
    const rows = await this.db
      .select()
      .from(authIdentities)
      .where(and(eq(authIdentities.userId, userId), isNull(authIdentities.revokedAt)));
    return rows.map(toIdentity);
  }
  async markAuthenticated(id: string, at: Date): Promise<void> {
    await this.db.update(authIdentities).set({ lastAuthenticatedAt: at }).where(eq(authIdentities.id, id));
  }
  async revoke(id: string, at: Date): Promise<AuthIdentityRecord | null> {
    const [row] = await this.db
      .update(authIdentities)
      .set({ revokedAt: at })
      .where(eq(authIdentities.id, id))
      .returning();
    return row ? toIdentity(row) : null;
  }
}

export class DrizzleWalletRepository implements WalletRepository {
  constructor(private readonly db: Db) {}
  async create(input: CreateWalletInput): Promise<WalletRecord> {
    try {
      const [row] = await this.db
        .insert(wallets)
        .values({
          id: input.id,
          userId: input.userId,
          addressCanonical: input.addressCanonical ?? null,
          addressChecksum: input.addressChecksum ?? null,
          walletType: input.walletType,
          sourceProvider: input.sourceProvider,
          ownershipStatus: input.ownershipStatus ?? "unverified",
          isEmbedded: input.isEmbedded ?? false,
          isActive: input.isActive ?? false,
          provisioningState: input.provisioningState ?? null,
          providerWalletRef: input.providerWalletRef ?? null,
          verifiedAt: input.verifiedAt ?? null,
        })
        .returning();
      return toWallet(row);
    } catch (err) {
      rethrowUnique(err);
    }
  }
  async findById(id: string): Promise<WalletRecord | null> {
    const [row] = await this.db.select().from(wallets).where(eq(wallets.id, id)).limit(1);
    return row ? toWallet(row) : null;
  }
  async listByUser(userId: string): Promise<WalletRecord[]> {
    const rows = await this.db.select().from(wallets).where(eq(wallets.userId, userId));
    return rows.map(toWallet);
  }
  async findActiveByUser(userId: string): Promise<WalletRecord | null> {
    const [row] = await this.db
      .select()
      .from(wallets)
      .where(and(eq(wallets.userId, userId), eq(wallets.isActive, true)))
      .limit(1);
    return row ? toWallet(row) : null;
  }
  async findVerifiedByAddress(addressCanonical: string): Promise<WalletRecord | null> {
    const [row] = await this.db
      .select()
      .from(wallets)
      .where(and(eq(wallets.addressCanonical, addressCanonical), eq(wallets.ownershipStatus, "verified")))
      .limit(1);
    return row ? toWallet(row) : null;
  }
  async findEmbeddedByUserProvider(userId: string, sourceProvider: string): Promise<WalletRecord | null> {
    const [row] = await this.db
      .select()
      .from(wallets)
      .where(
        and(
          eq(wallets.userId, userId),
          eq(wallets.sourceProvider, sourceProvider),
          eq(wallets.isEmbedded, true),
          isNull(wallets.revokedAt)
        )
      )
      .limit(1);
    return row ? toWallet(row) : null;
  }
  async update(id: string, patch: WalletUpdatePatch): Promise<WalletRecord | null> {
    try {
      const [row] = await this.db.update(wallets).set({ ...patch }).where(eq(wallets.id, id)).returning();
      return row ? toWallet(row) : null;
    } catch (err) {
      rethrowUnique(err);
    }
  }
  async setActive(userId: string, walletId: string): Promise<WalletRecord | null> {
    return this.db.transaction(async (tx) => {
      const [target] = await tx.select().from(wallets).where(eq(wallets.id, walletId)).limit(1);
      if (!target || target.userId !== userId) return null;
      await tx
        .update(wallets)
        .set({ isActive: false })
        .where(and(eq(wallets.userId, userId), ne(wallets.id, walletId)));
      const [row] = await tx.update(wallets).set({ isActive: true }).where(eq(wallets.id, walletId)).returning();
      return row ? toWallet(row) : null;
    });
  }
}

export class DrizzleSessionRepository implements SessionRepository {
  constructor(private readonly db: Db) {}
  async create(input: CreateSessionInput): Promise<SessionRecord> {
    try {
      const [row] = await this.db
        .insert(authSessions)
        .values({
          id: input.id,
          userId: input.userId,
          familyId: input.familyId,
          assuranceLevel: input.assuranceLevel,
          refreshTokenHash: input.refreshTokenHash,
          securityVersion: input.securityVersion,
          expiresAt: input.expiresAt,
          lastAuthenticatedAt: input.lastAuthenticatedAt,
          deviceLabel: input.deviceLabel ?? null,
          userAgentHash: input.userAgentHash ?? null,
        })
        .returning();
      return toSession(row);
    } catch (err) {
      rethrowUnique(err);
    }
  }
  async findById(id: string): Promise<SessionRecord | null> {
    const [row] = await this.db.select().from(authSessions).where(eq(authSessions.id, id)).limit(1);
    return row ? toSession(row) : null;
  }
  async findByRefreshHash(refreshTokenHash: string): Promise<SessionRecord | null> {
    const [row] = await this.db
      .select()
      .from(authSessions)
      .where(eq(authSessions.refreshTokenHash, refreshTokenHash))
      .limit(1);
    return row ? toSession(row) : null;
  }
  async listActiveByUser(userId: string): Promise<SessionRecord[]> {
    const rows = await this.db
      .select()
      .from(authSessions)
      .where(and(eq(authSessions.userId, userId), eq(authSessions.status, "active"), isNull(authSessions.revokedAt)));
    return rows.map(toSession);
  }
  async markUsed(id: string, at: Date): Promise<void> {
    await this.db.update(authSessions).set({ lastUsedAt: at }).where(eq(authSessions.id, id));
  }
  async markRotated(id: string, at: Date): Promise<SessionRecord | null> {
    const [row] = await this.db
      .update(authSessions)
      .set({ status: "rotated", rotatedAt: at })
      .where(eq(authSessions.id, id))
      .returning();
    return row ? toSession(row) : null;
  }
  async revoke(id: string, reason: SessionRevocationReason, at: Date): Promise<SessionRecord | null> {
    const [row] = await this.db
      .update(authSessions)
      .set({ status: "revoked", revokedAt: at, revocationReason: reason })
      .where(and(eq(authSessions.id, id), isNull(authSessions.revokedAt)))
      .returning();
    if (row) return toSession(row);
    return this.findById(id);
  }
  async revokeFamily(familyId: string, reason: SessionRevocationReason, at: Date): Promise<number> {
    const rows = await this.db
      .update(authSessions)
      .set({ status: "revoked", revokedAt: at, revocationReason: reason })
      .where(and(eq(authSessions.familyId, familyId), isNull(authSessions.revokedAt)))
      .returning();
    return rows.length;
  }
  async revokeAllForUser(userId: string, reason: SessionRevocationReason, at: Date): Promise<number> {
    const rows = await this.db
      .update(authSessions)
      .set({ status: "revoked", revokedAt: at, revocationReason: reason })
      .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)))
      .returning();
    return rows.length;
  }
  async setStatus(id: string, status: SessionStatus): Promise<void> {
    await this.db.update(authSessions).set({ status }).where(eq(authSessions.id, id));
  }
}

export class DrizzleWalletChallengeRepository implements WalletChallengeRepository {
  constructor(private readonly db: Db) {}
  async create(input: CreateWalletChallengeInput): Promise<WalletChallengeRecord> {
    try {
      const [row] = await this.db
        .insert(walletLinkChallenges)
        .values({
          id: input.id,
          userId: input.userId,
          sessionId: input.sessionId ?? null,
          action: input.action,
          domain: input.domain,
          uri: input.uri,
          chainId: input.chainId,
          nonce: input.nonce,
          expectedAddress: input.expectedAddress ?? null,
          notBefore: input.notBefore,
          expiresAt: input.expiresAt,
        })
        .returning();
      return toChallenge(row);
    } catch (err) {
      rethrowUnique(err);
    }
  }
  async findByNonce(nonce: string): Promise<WalletChallengeRecord | null> {
    const [row] = await this.db
      .select()
      .from(walletLinkChallenges)
      .where(eq(walletLinkChallenges.nonce, nonce))
      .limit(1);
    return row ? toChallenge(row) : null;
  }
  async consume(nonce: string, at: Date): Promise<WalletChallengeRecord | null> {
    const [row] = await this.db
      .update(walletLinkChallenges)
      .set({ consumedAt: at })
      .where(and(eq(walletLinkChallenges.nonce, nonce), isNull(walletLinkChallenges.consumedAt)))
      .returning();
    return row ? toChallenge(row) : null;
  }
}

export class DrizzleOtpChallengeRepository implements OtpChallengeRepository {
  constructor(private readonly db: Db) {}
  async create(input: CreateOtpChallengeInput): Promise<EmailOtpChallengeRecord> {
    const [row] = await this.db
      .insert(emailOtpChallenges)
      .values({
        id: input.id,
        normalizedEmail: input.normalizedEmail,
        purpose: input.purpose,
        codeHash: input.codeHash,
        maxAttempts: input.maxAttempts,
        requestSourceHash: input.requestSourceHash ?? null,
        expiresAt: input.expiresAt,
      })
      .returning();
    return toOtp(row);
  }
  async findActiveByEmail(normalizedEmail: string, now: Date): Promise<EmailOtpChallengeRecord | null> {
    const [row] = await this.db
      .select()
      .from(emailOtpChallenges)
      .where(
        and(
          eq(emailOtpChallenges.normalizedEmail, normalizedEmail),
          isNull(emailOtpChallenges.consumedAt),
          gt(emailOtpChallenges.expiresAt, now)
        )
      )
      .orderBy(desc(emailOtpChallenges.createdAt))
      .limit(1);
    return row ? toOtp(row) : null;
  }
  async incrementAttempts(id: string): Promise<EmailOtpChallengeRecord | null> {
    // Atomic in-database increment — the attempt cap is a brute-force control,
    // so a read-then-write race across replicas must not lose increments.
    const [row] = await this.db
      .update(emailOtpChallenges)
      .set({ attempts: sql`${emailOtpChallenges.attempts} + 1` })
      .where(eq(emailOtpChallenges.id, id))
      .returning();
    return row ? toOtp(row) : null;
  }
  async consume(id: string, at: Date): Promise<EmailOtpChallengeRecord | null> {
    const [row] = await this.db
      .update(emailOtpChallenges)
      .set({ consumedAt: at })
      .where(and(eq(emailOtpChallenges.id, id), isNull(emailOtpChallenges.consumedAt)))
      .returning();
    return row ? toOtp(row) : null;
  }
}

export class DrizzleAuditEventRepository implements AuditEventRepository {
  constructor(private readonly db: Db) {}
  async append(input: CreateAuditEventInput): Promise<AuditEventRecord> {
    const [row] = await this.db
      .insert(securityAuditEvents)
      .values({
        id: input.id,
        userId: input.userId ?? null,
        eventType: input.eventType,
        subjectId: input.subjectId ?? null,
        metadata: input.metadata ?? null,
      })
      .returning();
    return toAudit(row);
  }
  async listByUser(userId: string, limit = 100): Promise<AuditEventRecord[]> {
    const rows = await this.db
      .select()
      .from(securityAuditEvents)
      .where(eq(securityAuditEvents.userId, userId))
      .orderBy(desc(securityAuditEvents.createdAt))
      .limit(limit);
    return rows.map(toAudit);
  }
}

/** Production store bundle. `createUserWithIdentity` runs in a transaction so a
 *  duplicate identity rolls the whole insert back (no orphan user). */
export function createDrizzleStores(db: Db): IdentityStores {
  const users_ = new DrizzleUserRepository(db);
  const identities = new DrizzleAuthIdentityRepository(db);
  return {
    users: users_,
    identities,
    wallets: new DrizzleWalletRepository(db),
    sessions: new DrizzleSessionRepository(db),
    walletChallenges: new DrizzleWalletChallengeRepository(db),
    otpChallenges: new DrizzleOtpChallengeRepository(db),
    audit: new DrizzleAuditEventRepository(db),
    async createUserWithIdentity({ userId, identity }) {
      return db.transaction(async (tx) => {
        const [userRow] = await tx.insert(users).values({ id: userId, status: "active" }).returning();
        try {
          const [idRow] = await tx
            .insert(authIdentities)
            .values({
              id: identity.id,
              userId,
              provider: identity.provider,
              providerSubject: identity.providerSubject,
              normalizedEmail: identity.normalizedEmail ?? null,
              verificationStatus: identity.verificationStatus ?? "unverified",
              assuranceLevel: identity.assuranceLevel ?? "aal1",
            })
            .returning();
          return { user: toUser(userRow), identity: toIdentity(idRow) };
        } catch (err) {
          rethrowUnique(err); // rolls back the whole transaction
        }
      });
    },
  };
}
