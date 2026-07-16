/**
 * Identity & wallet domain enums and value types.
 *
 * This module is the vocabulary shared by the schema, repositories, services,
 * and HTTP layer. It imports NOTHING (not even `@movenrun/shared`) so it stays
 * resolvable by `tsc` independent of any package build step (mirrors the
 * deliberate isolation of route.repository.ts) and can be imported freely by
 * both production code and offline tests.
 *
 * All string-union values are the exact tokens persisted to Postgres (see
 * src/db/identity.schema.ts) and returned in public API responses — treat them
 * as a stable wire contract, not internal labels.
 */

/** Canonical MovenRun user lifecycle. A user is NEVER deleted; it is disabled. */
export type UserStatus = "active" | "disabled";

/** Authentication providers MovenRun understands. These identify a *login
 *  method*, never a separate MovenRun profile — the canonical identity is
 *  always `users.id`. */
export type AuthProviderKind = "email_otp" | "google" | "base_account";
export const AUTH_PROVIDER_KINDS: readonly AuthProviderKind[] = [
  "email_otp",
  "google",
  "base_account",
] as const;

/** Verification state of a linked auth identity. */
export type IdentityVerificationStatus = "unverified" | "verified";

/**
 * NIST-800-63-flavoured assurance levels, ordered. Higher = stronger recent
 * proof of control. Sensitive actions (identity linking, final login-method
 * removal, wallet export authorization) require a minimum level AND recency.
 */
export type AssuranceLevel = "aal1" | "aal2" | "aal3";
export const ASSURANCE_ORDER: Record<AssuranceLevel, number> = {
  aal1: 1,
  aal2: 2,
  aal3: 3,
};

/** Wallet categories MovenRun tracks. Embedded wallets are provisioned by the
 *  embedded-wallet provider; external wallets are connected by the user.
 *  Declared const-tuple-first so zod schemas (http/validation.ts) can consume
 *  the tuple directly and stay in lockstep with the type. */
export const WALLET_TYPES = [
  "embedded_eoa",
  "base_smart_account",
  "external_eoa",
  "external_smart_account",
] as const;
export type WalletType = (typeof WALLET_TYPES)[number];

/** Only EVM is modelled today; the column exists so a future non-EVM chain
 *  family is an additive migration, not a schema rewrite. */
export type ChainFamily = "evm";

/** Ownership/trust state of a wallet row. `revoked` preserves history. */
export type WalletOwnershipStatus = "unverified" | "verified" | "revoked";

/**
 * Lifecycle of an embedded-wallet provisioning attempt. The state machine is
 * strictly forward except `failed_transient -> provisioning` (safe retry).
 *   requested -> provisioning -> active
 *   provisioning -> failed_transient -> provisioning (retry)
 *   provisioning -> failed_terminal (observable, recoverable by support flow)
 */
export type ProvisioningState =
  | "requested"
  | "provisioning"
  | "active"
  | "failed_transient"
  | "failed_terminal";

/** Session lifecycle. `rotated` marks a refresh credential that has been
 *  superseded — presenting it again is refresh replay. */
export type SessionStatus = "active" | "rotated" | "revoked";

/** Why a session (or family) was revoked — audit/debugging only, never
 *  attacker-helpful in public responses. */
export type SessionRevocationReason =
  | "user_logout"
  | "revoke_all"
  | "refresh_replay"
  | "security_version_bump"
  | "identity_removed";

/** Actions a wallet-link challenge may authorize. A challenge is bound to
 *  exactly one action so a signature for one purpose cannot be replayed for
 *  another. Const-tuple-first for the same zod-schema reason as WALLET_TYPES. */
export const WALLET_CHALLENGE_ACTIONS = [
  "link_external_wallet",
  "base_account_login",
] as const;
export type WalletChallengeAction = (typeof WALLET_CHALLENGE_ACTIONS)[number];

/** Immutable audit event categories (see security_audit_events). */
export type AuditEventType =
  | "signup"
  | "login"
  | "login_failed"
  | "identity_linked"
  | "identity_unlinked"
  | "wallet_provisioning_requested"
  | "wallet_provisioning_completed"
  | "wallet_provisioning_failed"
  | "wallet_linked"
  | "wallet_unlinked"
  | "active_wallet_changed"
  | "session_issued"
  | "session_refreshed"
  | "session_revoked"
  | "refresh_replay_detected"
  | "recovery_method_changed"
  | "wallet_export_initiated"
  | "wallet_export_completed"
  | "wallet_export_aborted"
  | "security_policy_denied";

export const AUDIT_EVENT_TYPES: readonly AuditEventType[] = [
  "signup",
  "login",
  "login_failed",
  "identity_linked",
  "identity_unlinked",
  "wallet_provisioning_requested",
  "wallet_provisioning_completed",
  "wallet_provisioning_failed",
  "wallet_linked",
  "wallet_unlinked",
  "active_wallet_changed",
  "session_issued",
  "session_refreshed",
  "session_revoked",
  "refresh_replay_detected",
  "recovery_method_changed",
  "wallet_export_initiated",
  "wallet_export_completed",
  "wallet_export_aborted",
  "security_policy_denied",
] as const;
