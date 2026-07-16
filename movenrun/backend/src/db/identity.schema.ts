/**
 * Identity & wallet persistence schema (see backend/src/identity/**).
 *
 * Re-exported from db/schema.ts so the single Drizzle client and drizzle-kit
 * pick these tables up alongside the existing route/zone/battle tables. Like
 * schema.ts this module imports ONLY drizzle + the local domain string-union
 * types — never `@movenrun/shared` — so it stays resolvable independent of any
 * package build step.
 *
 * Security-relevant invariants are enforced at the DB level, not just in
 * application code, so a bug or a second writer cannot violate them:
 *   - at most one ACTIVE auth identity per (provider, providerSubject);
 *   - an address can be VERIFIED-owned by at most one user at a time;
 *   - at most one active wallet per user;
 *   - at most one non-revoked embedded wallet per (user, sourceProvider);
 *   - refresh-credential hashes and challenge nonces are globally unique.
 * There is deliberately NO column anywhere for a private key, mnemonic, or
 * recovery secret (see ADR-0008).
 */
import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
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
} from "../identity/domain/types.js";

/** Canonical MovenRun user — the one permanent identity. Never deleted. */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  status: text("status").$type<UserStatus>().notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  disabledAt: timestamp("disabled_at"),
  // Bumped on a material security event (revoke-all, credential compromise).
  // Sessions carry the value they were minted at; a mismatch invalidates them.
  securityVersion: integer("security_version").notNull().default(0),
});

/** A linked authentication method. Multiple per user; the canonical identity
 *  is always users.id, never one of these rows. */
export const authIdentities = pgTable(
  "auth_identities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    provider: text("provider").$type<AuthProviderKind>().notNull(),
    // Provider-stable subject: OIDC `sub`, canonical Base address, or the
    // normalized email for email_otp. Never an email for google/base.
    providerSubject: text("provider_subject").notNull(),
    // Normalized verified email where the provider supplies one. Present but
    // NOT a merge key — see ADR-0001.
    normalizedEmail: text("normalized_email"),
    verificationStatus: text("verification_status")
      .$type<IdentityVerificationStatus>()
      .notNull()
      .default("unverified"),
    assuranceLevel: text("assurance_level").$type<AssuranceLevel>().notNull().default("aal1"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    lastAuthenticatedAt: timestamp("last_authenticated_at"),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => ({
    userIdx: index("auth_identities_user_idx").on(t.userId),
    // At most one ACTIVE identity per (provider, subject). Revoked rows keep
    // the audit trail without blocking a future re-link.
    activeProviderSubjectUnique: uniqueIndex("auth_identities_provider_subject_active_unique")
      .on(t.provider, t.providerSubject)
      .where(sql`${t.revokedAt} IS NULL`),
  })
);

/** A wallet linked to a user — embedded (provider-provisioned) or external
 *  (user-connected). No secret material is ever stored. */
export const wallets = pgTable(
  "wallets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    // Lowercase 0x-prefixed 40-hex — the uniqueness/dedup key. Nullable while
    // an embedded wallet is still being provisioned (state requested /
    // provisioning), before the provider has returned a public address.
    addressCanonical: text("address_canonical"),
    // EIP-55 checksummed presentation form (display only).
    addressChecksum: text("address_checksum"),
    walletType: text("wallet_type").$type<WalletType>().notNull(),
    sourceProvider: text("source_provider").notNull(),
    chainFamily: text("chain_family").$type<ChainFamily>().notNull().default("evm"),
    ownershipStatus: text("ownership_status")
      .$type<WalletOwnershipStatus>()
      .notNull()
      .default("unverified"),
    isEmbedded: boolean("is_embedded").notNull().default(false),
    isActive: boolean("is_active").notNull().default(false),
    provisioningState: text("provisioning_state").$type<ProvisioningState>(),
    // Opaque provider handle (e.g. embedded-wallet id). Contains NO secret.
    providerWalletRef: text("provider_wallet_ref"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    verifiedAt: timestamp("verified_at"),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => ({
    userIdx: index("wallets_user_idx").on(t.userId),
    addressIdx: index("wallets_address_idx").on(t.addressCanonical),
    // An address may be VERIFIED-owned by only one user at a time. Unverified
    // or revoked rows don't reserve it.
    verifiedAddressUnique: uniqueIndex("wallets_verified_address_unique")
      .on(t.addressCanonical)
      .where(sql`${t.ownershipStatus} = 'verified'`),
    // At most one active wallet per user.
    activeWalletUnique: uniqueIndex("wallets_active_per_user_unique")
      .on(t.userId)
      .where(sql`${t.isActive} = true`),
    // At most one non-revoked embedded wallet per (user, provider config).
    embeddedWalletUnique: uniqueIndex("wallets_embedded_per_user_provider_unique")
      .on(t.userId, t.sourceProvider)
      .where(sql`${t.isEmbedded} = true AND ${t.revokedAt} IS NULL`),
  })
);

/** A durable auth session (device). Refresh credential is stored only as a
 *  keyed hash; the plaintext is returned once and never persisted. */
export const authSessions = pgTable(
  "auth_sessions",
  {
    // Opaque session identifier (also the composite-token id half).
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    // Rotation lineage: all rotations of one login share a family id so a
    // detected replay can revoke the whole family.
    familyId: text("family_id").notNull(),
    assuranceLevel: text("assurance_level").$type<AssuranceLevel>().notNull().default("aal1"),
    status: text("status").$type<SessionStatus>().notNull().default("active"),
    // HMAC-SHA-256 of the refresh secret under the server pepper. Unique.
    refreshTokenHash: text("refresh_token_hash").notNull(),
    // Snapshot of users.securityVersion at issue time.
    securityVersion: integer("security_version").notNull().default(0),
    // Minimal device metadata — a human label and a hashed UA fingerprint.
    deviceLabel: text("device_label"),
    userAgentHash: text("user_agent_hash"),
    issuedAt: timestamp("issued_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    lastUsedAt: timestamp("last_used_at"),
    rotatedAt: timestamp("rotated_at"),
    revokedAt: timestamp("revoked_at"),
    revocationReason: text("revocation_reason").$type<SessionRevocationReason>(),
    lastAuthenticatedAt: timestamp("last_authenticated_at").defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index("auth_sessions_user_idx").on(t.userId),
    familyIdx: index("auth_sessions_family_idx").on(t.familyId),
    refreshHashUnique: uniqueIndex("auth_sessions_refresh_hash_unique").on(t.refreshTokenHash),
  })
);

/** A single-use, action/domain/chain-bound wallet-link (SIWE-style) challenge.
 *  The authority for replay protection is THIS TABLE (atomic consume), never a
 *  process-local Map. */
export const walletLinkChallenges = pgTable(
  "wallet_link_challenges",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    sessionId: text("session_id"),
    action: text("action").$type<WalletChallengeAction>().notNull(),
    domain: text("domain").notNull(),
    uri: text("uri").notNull(),
    chainId: integer("chain_id").notNull(),
    // Cryptographically strong single-use nonce.
    nonce: text("nonce").notNull(),
    // Expected signer when known (e.g. re-linking a specific address).
    expectedAddress: text("expected_address"),
    issuedAt: timestamp("issued_at").defaultNow().notNull(),
    notBefore: timestamp("not_before").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    consumedAt: timestamp("consumed_at"),
  },
  (t) => ({
    userIdx: index("wallet_link_challenges_user_idx").on(t.userId),
    nonceUnique: uniqueIndex("wallet_link_challenges_nonce_unique").on(t.nonce),
  })
);

/** Email OTP challenge. The code is stored only as a keyed hash. */
export const emailOtpChallenges = pgTable(
  "email_otp_challenges",
  {
    id: text("id").primaryKey(),
    normalizedEmail: text("normalized_email").notNull(),
    purpose: text("purpose").notNull(), // "auth" today; kept open for future flows
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull(),
    // Hashed request-source identifier for rate limiting — never a raw IP.
    requestSourceHash: text("request_source_hash"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    lastSentAt: timestamp("last_sent_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    consumedAt: timestamp("consumed_at"),
  },
  (t) => ({
    emailIdx: index("email_otp_challenges_email_idx").on(t.normalizedEmail),
  })
);

/** Immutable, append-only security audit trail. No raw tokens, signatures,
 *  OAuth assertions, seed phrases, or keys — only redacted scalar metadata. */
export const securityAuditEvents = pgTable(
  "security_audit_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id"),
    eventType: text("event_type").$type<AuditEventType>().notNull(),
    // Optional subject reference (e.g. a wallet id or session id) — never a
    // secret, never another user's PII.
    subjectId: text("subject_id"),
    // Redacted, safe-scalar-only context (see AuditService redaction).
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index("security_audit_events_user_idx").on(t.userId),
    typeIdx: index("security_audit_events_type_idx").on(t.eventType),
  })
);
