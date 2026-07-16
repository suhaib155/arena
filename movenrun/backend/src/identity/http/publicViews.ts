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
