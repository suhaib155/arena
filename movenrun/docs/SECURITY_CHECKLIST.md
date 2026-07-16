# Identity & Wallet — Security Checklist

Maps each requirement → implementation → test/evidence → remaining risk →
future production-provider dependency. "Follow-up" means the control exists as
an interface/gate and fails closed until a provider is wired.

| # | Requirement | Implementation | Test / evidence | Remaining risk | Provider dependency |
|---|---|---|---|---|---|
| 1 | Canonical MovenRun identity | `IdentityService`, `users`/`auth_identities`, active-unique `(provider, subject)` | `identity.service.test.ts`, migration constraint check | — | none |
| 2 | No silent merge by email | resolution keyed by `(provider, subject)` only | `identity.service.test.ts` (no-silent-merge) | — | none |
| 3 | Idempotent + concurrency-safe signup | `authenticate` + atomic `createUserWithIdentity` | `identity.service.test.ts` (repeat/concurrent) | — | none |
| 4 | One auto embedded wallet, no duplicates | provisioning state machine + `wallets_embedded_per_user_provider_unique` | `walletProvisioning.service.test.ts`, PG constraint | — | embedded-wallet provider (follow-up) |
| 5 | Active-set-once, at most one active | `setActive` txn + `wallets_active_per_user_unique` | `walletLink`/`walletProvisioning` tests, PG | — | none |
| 6 | Short-lived access tokens | stateless HMAC access token + live checks | `session.service.test.ts` (expiry) | theft within TTL | none |
| 7 | Refresh rotation + reuse detection | family rotation, replay → family revoke | `session.service.test.ts` (replay) | — | none |
| 8 | Security-version invalidation | `securityVersion` bound into tokens/sessions | `session.service.test.ts` | — | none |
| 9 | No plaintext token persisted | HMAC refresh hash only; access token stateless | `session.service.test.ts` (no-plaintext) | — | none |
| 10 | Replay authority is shared store | DB-atomic consume; no process-local Map | `walletLink`/`securityControls` (restart, shared store) | — | none |
| 11 | Wallet-link challenge binding | domain/URI/chain/action/nonce/window, server-built msg | `walletLink.service.test.ts` (4 negative cases) | — | none |
| 12 | Single-use atomic consume | conditional `UPDATE ... WHERE consumed_at IS NULL` | `walletLink`, PG smoke | — | none |
| 13 | EOA + smart-account verification | `EoaSignatureVerifier` + `SmartAccountSignatureVerifier` | `walletLink.service.test.ts` | — | ERC-1271/6492 verifier (follow-up, needs RPC) |
| 14 | Duplicate ownership rejected | `wallets_verified_address_unique` | `walletLink.service.test.ts`, PG | — | none |
| 15 | Address canonicalization | `canonicalizeAddress` + lowercase CHECK | `walletLink` (normalization), PG CHECK | — | none |
| 16 | Active-wallet fallback after revoke | `revokeWallet` fallback logic | `walletLink.service.test.ts` (fallback) | — | none |
| 17 | Pending-op policy hook | `WalletChangePolicy` gate | `walletLink.service.test.ts` (policy denial) | policy source unpopulated | settlement subsystem (follow-up) |
| 18 | Link only from authed + recent session | `linkIdentity` + `assertRecentAuth` | `identity.service.test.ts` (recent-auth) | — | none |
| 19 | Reject identity owned by another user | link-flow ownership check | `identity.service.test.ts` | — | none |
| 20 | Protect final login method | `unlinkIdentity` refusal | `identity.service.test.ts` (final-method) | — | none |
| 21 | Removal = material security event | unlink revokes all sessions | `identity.service.test.ts` | — | none |
| 22 | Email OTP: hashed, single-use, capped, throttled | `EmailOtpService` | `emailOtp.service.test.ts` | distributed guessing → edge rate-limit | email delivery provider (follow-up) |
| 23 | No user enumeration | uniform responses/errors | `emailOtp`/`securityControls` | timing (constant-time used) | none |
| 24 | Immutable, redacted audit trail | `AuditService` append-only + redaction | `securityControls.test.ts` | direct-log call sites (review) | none |
| 25 | No seed phrase / private key anywhere | no column; strict schemas; `assertNoSecretShapedInput`; no local keygen | `securityControls`, `router.test.ts` | off-platform phishing (education) | none |
| 26 | Provider-isolated export, no secret exposed | `/wallets/export/begin` step-up + fail-closed | `router.test.ts` (export) | — | embedded-wallet export surface (follow-up) |
| 27 | Fail-closed configuration | `resolveIdentityConfig` (peppers, partial-provider) | `config.test.ts` | — | none |
| 28 | No production import of test doubles | dir separation + guard test | `securityControls.test.ts` (import boundary) | — | none |
| 29 | Public responses hide secrets/internal fields | `publicViews.ts` | `router.test.ts` (no hash/version fields) | — | none |
| 30 | Mobile: secrets only in secure store | `secureSession.ts` (no AsyncStorage), no persisted tokens | mobile typecheck; ADR-0006/0008 | in-memory default (non-persistent) until keystore wired | `expo-secure-store` adapter (follow-up) |
| 31 | Migrations apply + reject duplicate states | `0001_identity_wallet_foundation.sql` | applied to ephemeral PG 16; constraint checks | snapshot not regenerated (drizzle-kit bug) | none |
