/**
 * Repository interfaces — the persistence boundary the domain services depend
 * on. Every method is async so the same interface is satisfied by the
 * in-memory test implementation and the Drizzle/Postgres production one.
 *
 * The security-critical uniqueness invariants are enforced by BOTH the DB
 * (see identity.schema.ts) and these repositories, and a violation surfaces as
 * `UniqueConstraintError` so services can convert it into a deterministic,
 * non-attacker-helpful outcome instead of a generic failure — the same
 * race-condition-backstop pattern as RouteHashConflictError.
 */
import type {
  AuditEventRecord,
  AuthIdentityRecord,
  EmailOtpChallengeRecord,
  SessionRecord,
  UserRecord,
  WalletChallengeRecord,
  WalletRecord,
} from "./records.js";
import type {
  AssuranceLevel,
  AuditEventType,
  AuthProviderKind,
  ProvisioningState,
  SessionRevocationReason,
  SessionStatus,
  WalletOwnershipStatus,
  WalletType,
} from "../domain/types.js";

/** Which DB uniqueness invariant a write violated — the string matches the
 *  index name in identity.schema.ts for traceability. */
export type UniqueConstraint =
  | "auth_identities_provider_subject_active_unique"
  | "wallets_verified_address_unique"
  | "wallets_active_per_user_unique"
  | "wallets_embedded_per_user_provider_unique"
  | "auth_sessions_refresh_hash_unique"
  | "wallet_link_challenges_nonce_unique";

export class UniqueConstraintError extends Error {
  readonly constraint: UniqueConstraint;
  constructor(constraint: UniqueConstraint) {
    super(`unique constraint violated: ${constraint}`);
    this.name = "UniqueConstraintError";
    this.constraint = constraint;
  }
}

export interface UserRepository {
  create(input: { id: string; status?: "active" | "disabled" }): Promise<UserRecord>;
  findById(id: string): Promise<UserRecord | null>;
  /** Bumps securityVersion (invalidating existing sessions) and returns the new value. */
  bumpSecurityVersion(id: string): Promise<UserRecord | null>;
  disable(id: string): Promise<UserRecord | null>;
}

export interface CreateAuthIdentityInput {
  id: string;
  userId: string;
  provider: AuthProviderKind;
  providerSubject: string;
  normalizedEmail?: string | null;
  verificationStatus?: "unverified" | "verified";
  assuranceLevel?: AssuranceLevel;
}

export interface AuthIdentityRepository {
  /** Creates a new identity. Throws UniqueConstraintError
   *  (auth_identities_provider_subject_active_unique) if an ACTIVE identity
   *  already exists for (provider, providerSubject). */
  create(input: CreateAuthIdentityInput): Promise<AuthIdentityRecord>;
  findById(id: string): Promise<AuthIdentityRecord | null>;
  /** The single active identity for (provider, providerSubject), or null. */
  findActiveByProviderSubject(
    provider: AuthProviderKind,
    providerSubject: string
  ): Promise<AuthIdentityRecord | null>;
  /** All non-revoked identities for a user. */
  listActiveByUser(userId: string): Promise<AuthIdentityRecord[]>;
  markAuthenticated(id: string, at: Date): Promise<void>;
  revoke(id: string, at: Date): Promise<AuthIdentityRecord | null>;
}

export interface CreateWalletInput {
  id: string;
  userId: string;
  /** Omitted/null while an embedded wallet is still provisioning. */
  addressCanonical?: string | null;
  addressChecksum?: string | null;
  walletType: WalletType;
  sourceProvider: string;
  isEmbedded?: boolean;
  isActive?: boolean;
  ownershipStatus?: WalletOwnershipStatus;
  provisioningState?: ProvisioningState | null;
  providerWalletRef?: string | null;
  verifiedAt?: Date | null;
}

export interface WalletUpdatePatch {
  ownershipStatus?: WalletOwnershipStatus;
  isActive?: boolean;
  provisioningState?: ProvisioningState | null;
  providerWalletRef?: string | null;
  addressCanonical?: string;
  addressChecksum?: string | null;
  verifiedAt?: Date | null;
  revokedAt?: Date | null;
}

export interface WalletRepository {
  /** Throws UniqueConstraintError on any wallet uniqueness violation. */
  create(input: CreateWalletInput): Promise<WalletRecord>;
  findById(id: string): Promise<WalletRecord | null>;
  listByUser(userId: string): Promise<WalletRecord[]>;
  findActiveByUser(userId: string): Promise<WalletRecord | null>;
  /** Any wallet currently VERIFIED-owning this canonical address. */
  findVerifiedByAddress(addressCanonical: string): Promise<WalletRecord | null>;
  /** The non-revoked embedded wallet for (user, provider), or null. */
  findEmbeddedByUserProvider(userId: string, sourceProvider: string): Promise<WalletRecord | null>;
  update(id: string, patch: WalletUpdatePatch): Promise<WalletRecord | null>;
  /**
   * Atomically make `walletId` the sole active wallet for `userId`:
   * clears isActive on every other wallet of that user, sets it on this one.
   * Implemented in one transaction so the "at most one active" invariant holds
   * even under concurrency.
   */
  setActive(userId: string, walletId: string): Promise<WalletRecord | null>;
}

export interface CreateSessionInput {
  id: string;
  userId: string;
  familyId: string;
  assuranceLevel: AssuranceLevel;
  refreshTokenHash: string;
  securityVersion: number;
  expiresAt: Date;
  lastAuthenticatedAt: Date;
  deviceLabel?: string | null;
  userAgentHash?: string | null;
}

export interface SessionRepository {
  create(input: CreateSessionInput): Promise<SessionRecord>;
  findById(id: string): Promise<SessionRecord | null>;
  findByRefreshHash(refreshTokenHash: string): Promise<SessionRecord | null>;
  listActiveByUser(userId: string): Promise<SessionRecord[]>;
  markUsed(id: string, at: Date): Promise<void>;
  /**
   * Atomically transition an ACTIVE session to `rotated`. Returns the row ONLY
   * if THIS call performed the transition (compare-and-set on status='active');
   * returns null if the session was already rotated/revoked/absent. This is the
   * concurrency gate for refresh rotation — two parallel refreshes with the
   * same token cannot both win, because only one CAS succeeds.
   */
  markRotated(id: string, at: Date): Promise<SessionRecord | null>;
  revoke(id: string, reason: SessionRevocationReason, at: Date): Promise<SessionRecord | null>;
  /** Revokes every non-revoked session in a family (replay containment). */
  revokeFamily(familyId: string, reason: SessionRevocationReason, at: Date): Promise<number>;
  /** Revokes every non-revoked session for a user (revoke-all / security event). */
  revokeAllForUser(userId: string, reason: SessionRevocationReason, at: Date): Promise<number>;
  setStatus(id: string, status: SessionStatus): Promise<void>;
}

export interface CreateWalletChallengeInput {
  id: string;
  userId: string;
  sessionId?: string | null;
  action: WalletChallengeRecord["action"];
  domain: string;
  uri: string;
  chainId: number;
  nonce: string;
  expectedAddress?: string | null;
  notBefore: Date;
  expiresAt: Date;
}

export interface WalletChallengeRepository {
  create(input: CreateWalletChallengeInput): Promise<WalletChallengeRecord>;
  findByNonce(nonce: string): Promise<WalletChallengeRecord | null>;
  /**
   * Atomically consume: transition consumedAt from null → `at` for the given
   * nonce, returning the row ONLY if this call performed the transition.
   * A second call (replay) returns null even across process restarts, because
   * the authority is the store, not any process-local Map.
   */
  consume(nonce: string, at: Date): Promise<WalletChallengeRecord | null>;
}

export interface CreateOtpChallengeInput {
  id: string;
  normalizedEmail: string;
  purpose: string;
  codeHash: string;
  maxAttempts: number;
  requestSourceHash?: string | null;
  expiresAt: Date;
}

export interface OtpChallengeRepository {
  create(input: CreateOtpChallengeInput): Promise<EmailOtpChallengeRecord>;
  /** Most recent non-consumed, non-expired challenge for an email. */
  findActiveByEmail(normalizedEmail: string, now: Date): Promise<EmailOtpChallengeRecord | null>;
  incrementAttempts(id: string): Promise<EmailOtpChallengeRecord | null>;
  /** Atomically consume (single-use). Returns the row only if it transitioned. */
  consume(id: string, at: Date): Promise<EmailOtpChallengeRecord | null>;
}

export interface CreateAuditEventInput {
  id: string;
  userId?: string | null;
  eventType: AuditEventType;
  subjectId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface AuditEventRepository {
  /** Append-only insert. There is intentionally no update or delete. */
  append(input: CreateAuditEventInput): Promise<AuditEventRecord>;
  listByUser(userId: string, limit?: number): Promise<AuditEventRecord[]>;
}

/** The bundle of repositories a service layer needs. Kept together so wiring
 *  (both InMemory for tests and Drizzle for prod) is a single object. */
export interface IdentityStores {
  users: UserRepository;
  identities: AuthIdentityRepository;
  wallets: WalletRepository;
  sessions: SessionRepository;
  walletChallenges: WalletChallengeRepository;
  otpChallenges: OtpChallengeRepository;
  audit: AuditEventRepository;
  /**
   * Atomically create a brand-new user together with its first auth identity.
   * If the identity's (provider, providerSubject) is already actively claimed,
   * the WHOLE operation is rolled back (no orphan user is left behind) and a
   * UniqueConstraintError is thrown. Backed by a DB transaction in production
   * and an equivalent all-or-nothing critical section in memory — this is what
   * makes concurrent first-time callbacks converge on ONE user instead of
   * creating duplicates.
   */
  createUserWithIdentity(input: {
    userId: string;
    /** The identity's userId is `userId` above by definition, so it is omitted
     *  here rather than passed as a redundant (and ignorable) field. */
    identity: Omit<CreateAuthIdentityInput, "userId">;
  }): Promise<{ user: UserRecord; identity: AuthIdentityRecord }>;
}
