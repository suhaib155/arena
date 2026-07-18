/**
 * Repository record shapes — the domain-level view of each persisted row.
 *
 * These mirror the columns in db/identity.schema.ts but are declared
 * independently (no drizzle import) so services and the in-memory test repos
 * depend only on plain TypeScript, exactly like route.repository.ts's
 * RouteRecord. No record carries a private key, mnemonic, or recovery secret —
 * there is no such field anywhere in the system.
 */
import type {
  AssuranceLevel,
  AuditEventType,
  AuthProviderKind,
  ChainFamily,
  IdentityVerificationStatus,
  ProvisioningState,
  SessionRevocationReason,
  SessionStatus,
  UserStatus,
  WalletChallengeAction,
  WalletOwnershipStatus,
  WalletType,
} from "../domain/types.js";

export interface UserRecord {
  id: string;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
  disabledAt: Date | null;
  securityVersion: number;
}

export interface AuthIdentityRecord {
  id: string;
  userId: string;
  provider: AuthProviderKind;
  providerSubject: string;
  normalizedEmail: string | null;
  verificationStatus: IdentityVerificationStatus;
  assuranceLevel: AssuranceLevel;
  createdAt: Date;
  lastAuthenticatedAt: Date | null;
  revokedAt: Date | null;
}

export interface WalletRecord {
  id: string;
  userId: string;
  /** Null only while an embedded wallet is mid-provisioning; always set once
   *  the wallet has an address. */
  addressCanonical: string | null;
  addressChecksum: string | null;
  walletType: WalletType;
  sourceProvider: string;
  chainFamily: ChainFamily;
  ownershipStatus: WalletOwnershipStatus;
  isEmbedded: boolean;
  isActive: boolean;
  provisioningState: ProvisioningState | null;
  providerWalletRef: string | null;
  createdAt: Date;
  verifiedAt: Date | null;
  revokedAt: Date | null;
}

export interface SessionRecord {
  id: string;
  userId: string;
  familyId: string;
  assuranceLevel: AssuranceLevel;
  status: SessionStatus;
  /** Keyed hash of the refresh secret — NEVER the plaintext. */
  refreshTokenHash: string;
  securityVersion: number;
  deviceLabel: string | null;
  userAgentHash: string | null;
  issuedAt: Date;
  expiresAt: Date;
  lastUsedAt: Date | null;
  rotatedAt: Date | null;
  revokedAt: Date | null;
  revocationReason: SessionRevocationReason | null;
  lastAuthenticatedAt: Date;
}

export interface WalletChallengeRecord {
  id: string;
  userId: string;
  sessionId: string | null;
  action: WalletChallengeAction;
  domain: string;
  uri: string;
  chainId: number;
  nonce: string;
  expectedAddress: string | null;
  issuedAt: Date;
  notBefore: Date;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface EmailOtpChallengeRecord {
  id: string;
  normalizedEmail: string;
  purpose: string;
  /** Keyed hash of the OTP — NEVER the plaintext code. */
  codeHash: string;
  attempts: number;
  maxAttempts: number;
  requestSourceHash: string | null;
  createdAt: Date;
  lastSentAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface AuditEventRecord {
  id: string;
  userId: string | null;
  eventType: AuditEventType;
  subjectId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}
