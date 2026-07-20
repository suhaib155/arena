/**
 * Public response shapes. The API deliberately exposes ONLY non-sensitive
 * fields: no refresh-token hash, no security version, no device fingerprint, no
 * internal audit metadata, and never any wallet secret (there is none). This is
 * the enforcement point for "public responses must never expose ...".
 */
import type { AuthIdentityRecord, SessionRecord, UserRecord, WalletRecord } from "../repositories/records.js";

export interface PublicUser {
  id: string;
  status: string;
  createdAt: string;
}
export function toPublicUser(u: UserRecord): PublicUser {
  return { id: u.id, status: u.status, createdAt: u.createdAt.toISOString() };
}

export interface PublicIdentity {
  id: string;
  provider: string;
  verificationStatus: string;
  assuranceLevel: string;
  createdAt: string;
}
export function toPublicIdentity(i: AuthIdentityRecord): PublicIdentity {
  return {
    id: i.id,
    provider: i.provider,
    verificationStatus: i.verificationStatus,
    assuranceLevel: i.assuranceLevel,
    createdAt: i.createdAt.toISOString(),
  };
}

export interface PublicWallet {
  id: string;
  address: string | null;
  addressChecksum: string | null;
  walletType: string;
  sourceProvider: string;
  chainFamily: string;
  ownershipStatus: string;
  isEmbedded: boolean;
  isActive: boolean;
  provisioningState: string | null;
  createdAt: string;
}
export function toPublicWallet(w: WalletRecord): PublicWallet {
  return {
    id: w.id,
    address: w.addressChecksum ?? w.addressCanonical,
    addressChecksum: w.addressChecksum,
    walletType: w.walletType,
    sourceProvider: w.sourceProvider,
    chainFamily: w.chainFamily,
    ownershipStatus: w.ownershipStatus,
    isEmbedded: w.isEmbedded,
    isActive: w.isActive,
    provisioningState: w.provisioningState,
    createdAt: w.createdAt.toISOString(),
  };
}

export interface PublicSession {
  id: string;
  assuranceLevel: string;
  issuedAt: string;
  expiresAt: string;
}
export function toPublicSession(s: SessionRecord): PublicSession {
  return {
    id: s.id,
    assuranceLevel: s.assuranceLevel,
    issuedAt: s.issuedAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
  };
}

/** Coarse, user-facing session status. `expired` is computed from
 *  server-authoritative time — a stale persisted "active" is never shown as
 *  active past its expiry. Internal states (`rotated`) are never exposed;
 *  rotated rows are filtered out before this mapping runs. */
export type PublicSessionStatus = "active" | "revoked" | "expired";

/** Fallback when no (valid) client-supplied label exists. */
export const GENERIC_DEVICE_LABEL = "MovenRun mobile";

/**
 * Privacy-preserving session summary for the session-inventory API.
 * Deliberately EXCLUDES: userId, familyId, refreshTokenHash, securityVersion,
 * userAgentHash, revocationReason (mapped to the coarse status only), and any
 * token material. The `id` is the session UUID — safe as a public handle
 * because it is 122-bit CSPRNG-random (never sequential), and every endpoint
 * that accepts it re-checks ownership against the authenticated bearer, so
 * knowing an id grants nothing.
 */
export interface PublicSessionSummary {
  id: string;
  isCurrent: boolean;
  deviceLabel: string;
  status: PublicSessionStatus;
  assuranceLevel: string;
  issuedAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export function toPublicSessionSummary(
  s: SessionRecord,
  currentSessionId: string,
  now: Date
): PublicSessionSummary {
  const status: PublicSessionStatus =
    s.revokedAt !== null ? "revoked" : s.expiresAt.getTime() <= now.getTime() ? "expired" : "active";
  return {
    id: s.id,
    isCurrent: s.id === currentSessionId,
    deviceLabel: s.deviceLabel ?? GENERIC_DEVICE_LABEL,
    status,
    assuranceLevel: s.assuranceLevel,
    issuedAt: s.issuedAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    lastUsedAt: s.lastUsedAt ? s.lastUsedAt.toISOString() : null,
    revokedAt: s.revokedAt ? s.revokedAt.toISOString() : null,
  };
}
