/**
 * In-memory repository implementations.
 *
 * Used by tests and available for local dev without Postgres — NEVER in
 * production (production wires the Drizzle implementations; see http/wiring.ts).
 * Each repo enforces the SAME uniqueness invariants as the DB constraints in
 * identity.schema.ts, so tests exercise the real race-condition backstops and
 * the "constraints reject duplicate states" behavior offline — the same
 * convention as InMemoryRouteRepository mirroring routes_route_hash_unique.
 *
 * JavaScript's single-threaded execution makes each individual method
 * atomic with respect to other awaited calls, which is exactly what the
 * "atomic consume" / "set sole active" invariants require.
 */
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
  type OwnedRevokeOutcome,
  type SessionRepository,
  type UserRepository,
  type WalletChallengeRepository,
  type WalletRepository,
  type WalletUpdatePatch,
} from "./interfaces.js";
import type {
  AuditEventRecord,
  AuthIdentityRecord,
  EmailOtpChallengeRecord,
  SessionRecord,
  UserRecord,
  WalletChallengeRecord,
  WalletRecord,
} from "./records.js";
import type { SessionRevocationReason, SessionStatus } from "../domain/types.js";

const clone = <T>(v: T): T => (v == null ? v : (structuredClone(v) as T));

export class InMemoryUserRepository implements UserRepository {
  private rows = new Map<string, UserRecord>();
  constructor(protected readonly now: () => Date = () => new Date()) {}


  async create(input: { id: string; status?: "active" | "disabled" }): Promise<UserRecord> {
    const now = this.now();
    const rec: UserRecord = {
      id: input.id,
      status: input.status ?? "active",
      createdAt: now,
      updatedAt: now,
      disabledAt: null,
      securityVersion: 0,
    };
    this.rows.set(rec.id, rec);
    return clone(rec);
  }
  async findById(id: string): Promise<UserRecord | null> {
    const r = this.rows.get(id);
    return r ? clone(r) : null;
  }
  async bumpSecurityVersion(id: string): Promise<UserRecord | null> {
    const r = this.rows.get(id);
    if (!r) return null;
    r.securityVersion += 1;
    r.updatedAt = this.now();
    return clone(r);
  }
  async disable(id: string): Promise<UserRecord | null> {
    const r = this.rows.get(id);
    if (!r) return null;
    r.status = "disabled";
    r.disabledAt = this.now();
    r.updatedAt = this.now();
    return clone(r);
  }
  /** Rollback-only removal for the atomic createUserWithIdentity path. Users
   *  are never deleted through the public API — this undoes an uncommitted
   *  insert whose paired identity insert lost a uniqueness race. */
  _removeForRollback(id: string): void {
    this.rows.delete(id);
  }
}

export class InMemoryAuthIdentityRepository implements AuthIdentityRepository {
  private rows = new Map<string, AuthIdentityRecord>();
  constructor(protected readonly now: () => Date = () => new Date()) {}


  async create(input: CreateAuthIdentityInput): Promise<AuthIdentityRecord> {
    for (const r of this.rows.values()) {
      if (
        r.revokedAt === null &&
        r.provider === input.provider &&
        r.providerSubject === input.providerSubject
      ) {
        throw new UniqueConstraintError("auth_identities_provider_subject_active_unique");
      }
    }
    const now = this.now();
    const rec: AuthIdentityRecord = {
      id: input.id,
      userId: input.userId,
      provider: input.provider,
      providerSubject: input.providerSubject,
      normalizedEmail: input.normalizedEmail ?? null,
      verificationStatus: input.verificationStatus ?? "unverified",
      assuranceLevel: input.assuranceLevel ?? "aal1",
      createdAt: now,
      lastAuthenticatedAt: null,
      revokedAt: null,
    };
    this.rows.set(rec.id, rec);
    return clone(rec);
  }
  async findById(id: string): Promise<AuthIdentityRecord | null> {
    const r = this.rows.get(id);
    return r ? clone(r) : null;
  }
  async findActiveByProviderSubject(
    provider: AuthIdentityRecord["provider"],
    providerSubject: string
  ): Promise<AuthIdentityRecord | null> {
    for (const r of this.rows.values()) {
      if (r.revokedAt === null && r.provider === provider && r.providerSubject === providerSubject) {
        return clone(r);
      }
    }
    return null;
  }
  async listActiveByUser(userId: string): Promise<AuthIdentityRecord[]> {
    return [...this.rows.values()].filter((r) => r.userId === userId && r.revokedAt === null).map(clone);
  }
  async markAuthenticated(id: string, at: Date): Promise<void> {
    const r = this.rows.get(id);
    if (r) r.lastAuthenticatedAt = at;
  }
  async revoke(id: string, at: Date): Promise<AuthIdentityRecord | null> {
    const r = this.rows.get(id);
    if (!r) return null;
    r.revokedAt = at;
    return clone(r);
  }
}

export class InMemoryWalletRepository implements WalletRepository {
  private rows = new Map<string, WalletRecord>();
  constructor(protected readonly now: () => Date = () => new Date()) {}


  private assertInvariants(candidate: WalletRecord, excludeId: string): void {
    for (const r of this.rows.values()) {
      if (r.id === excludeId) continue;
      if (
        candidate.ownershipStatus === "verified" &&
        candidate.addressCanonical !== null &&
        r.ownershipStatus === "verified" &&
        r.addressCanonical === candidate.addressCanonical
      ) {
        throw new UniqueConstraintError("wallets_verified_address_unique");
      }
      if (candidate.isActive && r.isActive && r.userId === candidate.userId) {
        throw new UniqueConstraintError("wallets_active_per_user_unique");
      }
      if (
        candidate.isEmbedded &&
        candidate.revokedAt === null &&
        r.isEmbedded &&
        r.revokedAt === null &&
        r.userId === candidate.userId &&
        r.sourceProvider === candidate.sourceProvider
      ) {
        throw new UniqueConstraintError("wallets_embedded_per_user_provider_unique");
      }
    }
  }

  async create(input: CreateWalletInput): Promise<WalletRecord> {
    const now = this.now();
    const rec: WalletRecord = {
      id: input.id,
      userId: input.userId,
      addressCanonical: input.addressCanonical ?? null,
      addressChecksum: input.addressChecksum ?? null,
      walletType: input.walletType,
      sourceProvider: input.sourceProvider,
      chainFamily: "evm",
      ownershipStatus: input.ownershipStatus ?? "unverified",
      isEmbedded: input.isEmbedded ?? false,
      isActive: input.isActive ?? false,
      provisioningState: input.provisioningState ?? null,
      providerWalletRef: input.providerWalletRef ?? null,
      createdAt: now,
      verifiedAt: input.verifiedAt ?? null,
      revokedAt: null,
    };
    this.assertInvariants(rec, "");
    this.rows.set(rec.id, rec);
    return clone(rec);
  }
  async findById(id: string): Promise<WalletRecord | null> {
    const r = this.rows.get(id);
    return r ? clone(r) : null;
  }
  async listByUser(userId: string): Promise<WalletRecord[]> {
    return [...this.rows.values()].filter((r) => r.userId === userId).map(clone);
  }
  async findActiveByUser(userId: string): Promise<WalletRecord | null> {
    for (const r of this.rows.values()) if (r.userId === userId && r.isActive) return clone(r);
    return null;
  }
  async findVerifiedByAddress(addressCanonical: string): Promise<WalletRecord | null> {
    for (const r of this.rows.values())
      if (r.addressCanonical === addressCanonical && r.ownershipStatus === "verified") return clone(r);
    return null;
  }
  async findEmbeddedByUserProvider(userId: string, sourceProvider: string): Promise<WalletRecord | null> {
    for (const r of this.rows.values())
      if (r.userId === userId && r.sourceProvider === sourceProvider && r.isEmbedded && r.revokedAt === null)
        return clone(r);
    return null;
  }
  async update(id: string, patch: WalletUpdatePatch): Promise<WalletRecord | null> {
    const r = this.rows.get(id);
    if (!r) return null;
    const candidate: WalletRecord = { ...r, ...patch };
    this.assertInvariants(candidate, id);
    Object.assign(r, patch);
    return clone(r);
  }
  async setActive(userId: string, walletId: string): Promise<WalletRecord | null> {
    const target = this.rows.get(walletId);
    if (!target || target.userId !== userId) return null;
    // Atomic: clear all others for this user, then set the target.
    for (const r of this.rows.values()) if (r.userId === userId && r.id !== walletId) r.isActive = false;
    target.isActive = true;
    return clone(target);
  }
}

export class InMemorySessionRepository implements SessionRepository {
  private rows = new Map<string, SessionRecord>();
  constructor(protected readonly now: () => Date = () => new Date()) {}


  async create(input: CreateSessionInput): Promise<SessionRecord> {
    for (const r of this.rows.values())
      if (r.refreshTokenHash === input.refreshTokenHash)
        throw new UniqueConstraintError("auth_sessions_refresh_hash_unique");
    const now = this.now();
    const rec: SessionRecord = {
      id: input.id,
      userId: input.userId,
      familyId: input.familyId,
      assuranceLevel: input.assuranceLevel,
      status: "active",
      refreshTokenHash: input.refreshTokenHash,
      securityVersion: input.securityVersion,
      deviceLabel: input.deviceLabel ?? null,
      userAgentHash: input.userAgentHash ?? null,
      issuedAt: now,
      expiresAt: input.expiresAt,
      lastUsedAt: null,
      rotatedAt: null,
      revokedAt: null,
      revocationReason: null,
      lastAuthenticatedAt: input.lastAuthenticatedAt,
    };
    this.rows.set(rec.id, rec);
    return clone(rec);
  }
  async findById(id: string): Promise<SessionRecord | null> {
    const r = this.rows.get(id);
    return r ? clone(r) : null;
  }
  async findByRefreshHash(refreshTokenHash: string): Promise<SessionRecord | null> {
    for (const r of this.rows.values()) if (r.refreshTokenHash === refreshTokenHash) return clone(r);
    return null;
  }
  async listActiveByUser(userId: string): Promise<SessionRecord[]> {
    return [...this.rows.values()]
      .filter((r) => r.userId === userId && r.status === "active" && r.revokedAt === null)
      .map(clone);
  }
  async listByUser(userId: string, limit: number): Promise<SessionRecord[]> {
    return [...this.rows.values()]
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime() || (a.id < b.id ? -1 : 1))
      .slice(0, limit)
      .map(clone);
  }
  async revokeOwned(
    sessionId: string,
    userId: string,
    reason: SessionRevocationReason,
    at: Date
  ): Promise<OwnedRevokeOutcome> {
    const r = this.rows.get(sessionId);
    // Ownership inside the "WHERE clause": a foreign row is indistinguishable
    // from a missing one — never a transition, never an existence signal.
    if (!r || r.userId !== userId) return "not_found";
    if (r.revokedAt !== null) return "already_settled";
    r.revokedAt = at;
    r.revocationReason = reason;
    r.status = "revoked";
    return "revoked";
  }
  async revokeAllExcept(
    userId: string,
    keepSessionId: string,
    reason: SessionRevocationReason,
    at: Date
  ): Promise<number> {
    let n = 0;
    for (const r of this.rows.values()) {
      if (r.userId === userId && r.id !== keepSessionId && r.revokedAt === null) {
        r.revokedAt = at;
        r.revocationReason = reason;
        r.status = "revoked";
        n++;
      }
    }
    return n;
  }
  async markUsed(id: string, at: Date): Promise<void> {
    const r = this.rows.get(id);
    if (r) r.lastUsedAt = at;
  }
  async markRotated(id: string, at: Date): Promise<SessionRecord | null> {
    const r = this.rows.get(id);
    // Compare-and-set on status='active' — mirrors the DB's conditional UPDATE
    // so only one of two concurrent refreshes transitions the session.
    if (!r || r.status !== "active") return null;
    r.status = "rotated";
    r.rotatedAt = at;
    return clone(r);
  }
  async revoke(id: string, reason: SessionRevocationReason, at: Date): Promise<SessionRecord | null> {
    const r = this.rows.get(id);
    if (!r) return null;
    if (r.revokedAt === null) {
      r.revokedAt = at;
      r.revocationReason = reason;
      r.status = "revoked";
    }
    return clone(r);
  }
  async revokeFamily(familyId: string, reason: SessionRevocationReason, at: Date): Promise<number> {
    let n = 0;
    for (const r of this.rows.values()) {
      if (r.familyId === familyId && r.revokedAt === null) {
        r.revokedAt = at;
        r.revocationReason = reason;
        r.status = "revoked";
        n++;
      }
    }
    return n;
  }
  async revokeAllForUser(userId: string, reason: SessionRevocationReason, at: Date): Promise<number> {
    let n = 0;
    for (const r of this.rows.values()) {
      if (r.userId === userId && r.revokedAt === null) {
        r.revokedAt = at;
        r.revocationReason = reason;
        r.status = "revoked";
        n++;
      }
    }
    return n;
  }
  async setStatus(id: string, status: SessionStatus): Promise<void> {
    const r = this.rows.get(id);
    if (r) r.status = status;
  }
}

export class InMemoryWalletChallengeRepository implements WalletChallengeRepository {
  private rows = new Map<string, WalletChallengeRecord>();
  constructor(protected readonly now: () => Date = () => new Date()) {}


  async create(input: CreateWalletChallengeInput): Promise<WalletChallengeRecord> {
    for (const r of this.rows.values())
      if (r.nonce === input.nonce)
        throw new UniqueConstraintError("wallet_link_challenges_nonce_unique");
    const now = this.now();
    const rec: WalletChallengeRecord = {
      id: input.id,
      userId: input.userId,
      sessionId: input.sessionId ?? null,
      action: input.action,
      domain: input.domain,
      uri: input.uri,
      chainId: input.chainId,
      nonce: input.nonce,
      expectedAddress: input.expectedAddress ?? null,
      issuedAt: now,
      notBefore: input.notBefore,
      expiresAt: input.expiresAt,
      consumedAt: null,
    };
    this.rows.set(rec.id, rec);
    return clone(rec);
  }
  async findByNonce(nonce: string): Promise<WalletChallengeRecord | null> {
    for (const r of this.rows.values()) if (r.nonce === nonce) return clone(r);
    return null;
  }
  async consume(nonce: string, at: Date): Promise<WalletChallengeRecord | null> {
    for (const r of this.rows.values()) {
      if (r.nonce === nonce) {
        if (r.consumedAt !== null) return null; // already consumed → replay
        r.consumedAt = at;
        return clone(r);
      }
    }
    return null;
  }
}

export class InMemoryOtpChallengeRepository implements OtpChallengeRepository {
  private rows = new Map<string, EmailOtpChallengeRecord>();
  constructor(protected readonly now: () => Date = () => new Date()) {}


  async create(input: CreateOtpChallengeInput): Promise<EmailOtpChallengeRecord> {
    const now = this.now();
    const rec: EmailOtpChallengeRecord = {
      id: input.id,
      normalizedEmail: input.normalizedEmail,
      purpose: input.purpose,
      codeHash: input.codeHash,
      attempts: 0,
      maxAttempts: input.maxAttempts,
      requestSourceHash: input.requestSourceHash ?? null,
      createdAt: now,
      lastSentAt: now,
      expiresAt: input.expiresAt,
      consumedAt: null,
    };
    this.rows.set(rec.id, rec);
    return clone(rec);
  }
  async findActiveByEmail(normalizedEmail: string, now: Date): Promise<EmailOtpChallengeRecord | null> {
    let latest: EmailOtpChallengeRecord | null = null;
    for (const r of this.rows.values()) {
      if (
        r.normalizedEmail === normalizedEmail &&
        r.consumedAt === null &&
        r.expiresAt.getTime() > now.getTime()
      ) {
        if (!latest || r.createdAt.getTime() > latest.createdAt.getTime()) latest = r;
      }
    }
    return latest ? clone(latest) : null;
  }
  async incrementAttempts(id: string): Promise<EmailOtpChallengeRecord | null> {
    const r = this.rows.get(id);
    if (!r) return null;
    r.attempts += 1;
    return clone(r);
  }
  async consume(id: string, at: Date): Promise<EmailOtpChallengeRecord | null> {
    const r = this.rows.get(id);
    if (!r || r.consumedAt !== null) return null;
    r.consumedAt = at;
    return clone(r);
  }
}

export class InMemoryAuditEventRepository implements AuditEventRepository {
  private rows: AuditEventRecord[] = [];
  constructor(protected readonly now: () => Date = () => new Date()) {}


  async append(input: CreateAuditEventInput): Promise<AuditEventRecord> {
    const rec: AuditEventRecord = {
      id: input.id,
      userId: input.userId ?? null,
      eventType: input.eventType,
      subjectId: input.subjectId ?? null,
      metadata: input.metadata ?? null,
      createdAt: this.now(),
    };
    this.rows.push(rec);
    return clone(rec);
  }
  async listByUser(userId: string, limit = 100): Promise<AuditEventRecord[]> {
    return this.rows
      .filter((r) => r.userId === userId)
      .slice(-limit)
      .reverse()
      .map(clone);
  }
}

/** Build a full in-memory store bundle — the standard test/dev wiring. An
 *  optional clock keeps every persisted timestamp consistent with the caller's
 *  clock (production Postgres stamps DB-side, which is likewise consistent with
 *  the service clock). */
export function createInMemoryStores(now: () => Date = () => new Date()): IdentityStores {
  const users = new InMemoryUserRepository(now);
  const identities = new InMemoryAuthIdentityRepository(now);
  return {
    users,
    identities,
    wallets: new InMemoryWalletRepository(now),
    sessions: new InMemorySessionRepository(now),
    walletChallenges: new InMemoryWalletChallengeRepository(now),
    otpChallenges: new InMemoryOtpChallengeRepository(now),
    audit: new InMemoryAuditEventRepository(now),
    async ping() {
      // In-memory stores are always reachable.
    },
    async createUserWithIdentity({ userId, identity }) {
      // All-or-nothing: create the user, then claim the identity. If the
      // identity's active (provider, subject) is already taken, roll the user
      // back so no orphan remains and rethrow so the caller re-resolves to the
      // existing user. In single-threaded JS the identity uniqueness check and
      // insert inside identities.create() run without an interleaving await, so
      // two concurrent callers cannot both succeed.
      const user = await users.create({ id: userId });
      try {
        const created = await identities.create({ ...identity, userId });
        return { user, identity: created };
      } catch (err) {
        if (err instanceof UniqueConstraintError) users._removeForRollback(userId);
        throw err;
      }
    },
  };
}
