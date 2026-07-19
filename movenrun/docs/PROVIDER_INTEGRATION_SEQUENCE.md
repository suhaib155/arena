# Provider integration sequence — post-ADR-0011 implementation plan

Executable only after ADR-0011 reaches `Accepted` / `Accepted with
conditions`. One PR per stage; every stage keeps the PR #50/#51 invariants
(canonical `users.id`, `(provider, providerSubject)` keys, fail-closed config,
adapter isolation, replay-safe webhooks with lease-token settlement, empty
allowlist until stage 7, no seed/private-key ingestion ever). Every stage
ships with: focused tests, a feature flag that can only *disable* (never
bypass verification), a rollback that is config-only, and an explicit
deployment prerequisite.

## PR-A — Provider adapter + configuration (no user-visible feature)

- **Scope**: vendor server SDK behind the PR #50 interfaces; provider name
  added to `PROVIDER_NAMES`; strict config (API base URL, client id, secret,
  issuer/audience, redirect origins) wired through `providerConfig.ts`;
  sandbox smoke test (offline-mocked in CI; sandbox verified manually).
- **Exclusions**: no auth flow enabled; no wallet call; no webhook allowlist.
- **Security boundary**: SDK types confined to the adapter module; secrets
  env-only; fail-closed on partial config (already enforced).
- **Tests**: adapter unit tests with recorded fixtures; config matrix;
  production-import guard extended to any new test doubles.
- **Rollback**: set provider name back to `disabled`.
- **Flag**: none beyond provider name (which only mounts fail-closed
  surfaces).
- **Deploy prerequisite**: vendor account + sandbox keys provisioned outside
  the repo; secrets in the deployment environment only.

## PR-B — Email OTP via provider delivery

- **Scope**: `EmailOtpDeliveryProvider` adapter (delivery only — codes remain
  MovenRun-hashed, attempt-capped, single-use per PR #50); enable
  `/auth/email/*`.
- **Exclusions**: Google, Base, wallets.
- **Boundary**: OTP never appears in logs/audit; provider sees address + code
  only at send time.
- **Tests**: existing OTP suite + adapter fixture tests; enumeration-safety
  re-run. **Rollback**: unset delivery adapter → begin() fails closed (503).
- **Flag**: `IDENTITY_FEATURE_EMAIL_OTP` (mount-only). **Prereq**: sender
  domain + deliverability review.

## PR-C — Google authentication

- **Scope**: OIDC adapter (PKCE, state, nonce, exact redirect origins,
  issuer/audience validation per PR #50 architecture); enable
  `/auth/google/*`; mobile redirect handling using the validated deep-link
  scheme.
- **Exclusions**: account-merge behavior changes (none — `(provider,subject)`
  only).
- **Boundary**: provider tokens minimized, never persisted long-lived.
- **Tests**: callback replay, state/nonce mismatch, redirect-origin
  mismatch, email-collision no-merge. **Rollback**: flag off → 503.
- **Flag**: `IDENTITY_FEATURE_GOOGLE`. **Prereq**: OAuth client registered;
  redirect origins configured exactly.

## PR-D — Base Account authentication

- **Scope**: SIWE flow over the existing challenge store (server-built
  message, single-use nonce, domain/chain binding); ERC-1271/6492 verifier
  with a read-only RPC dependency **explicitly reviewed as the first RPC
  dependency in the identity stack**.
- **Exclusions**: transactions, paymasters, rewards.
- **Boundary**: RPC endpoint read-only + allowlisted; verifier fail-closed on
  RPC unavailability.
- **Tests**: existing challenge matrix + 1271/6492 fixtures. **Rollback**:
  flag off; smart-account links revert to fail-closed.
- **Flag**: `IDENTITY_FEATURE_BASE_AUTH`. **Prereq**: RPC provider decision
  (separate, smaller ADR), Base Sepolia only.

## PR-E — Embedded-wallet provisioning

- **Scope**: `EmbeddedWalletProvider` adapter; enable synchronous provisioning
  in the orchestrator (PR #50 idempotent state machine unchanged).
- **Exclusions**: export; external wallets.
- **Boundary**: provider returns address + opaque ref only; the PR #50
  schema has no secret column to fill.
- **Tests**: provisioning suite against adapter fixtures incl. replay/races.
- **Rollback**: `IDENTITY_EMBEDDED_WALLET_ENABLED=false` → wallets stay
  `requested`, observable. **Prereq**: custody verification (gate 10) signed
  off in the ADR.

## PR-F — Export handoff

- **Scope**: `beginExport` handoff (provider-isolated surface), step-up gate
  already enforced; mobile screen replaces the placeholder with the real
  handoff.
- **Exclusions**: any secret display in MovenRun surfaces (permanent).
- **Boundary**: ADR-0009 unchanged — MovenRun never sees the secret.
- **Tests**: step-up enforcement, audit events, handoff-ref expiry.
- **Rollback**: flag off → placeholder returns. **Flag**:
  `IDENTITY_FEATURE_EXPORT`. **Prereq**: export UX verified on-device on both
  platforms.

## PR-G — Webhook allowlist + handlers

- **Scope**: map vendor's signature scheme onto the PR #51 verifier (or a
  thin adapter); populate the allowlist with reviewed event types; handlers
  that call domain services only, keyed by provider event id (idempotent by
  construction — lease-token settlement already enforced).
- **Exclusions**: any handler that writes outside domain services.
- **Boundary**: raw-body verification before parse (unchanged); digest-
  mismatch anomaly (unchanged).
- **Tests**: per-event-type handler tests + wrong-user rejection + replay.
- **Rollback**: `IDENTITY_FEATURE_WEBHOOKS=false` (fail-closed 503; provider
  redelivery recovers after re-enable). **Prereq**: signing scheme + retry
  semantics verified in the register.

## PR-H — External-wallet linking UX

- **Scope**: mobile connect flow driving the existing challenge API
  (WalletConnect-class protocol choice is its own mini-ADR).
- **Exclusions**: seed/key input (permanent).
- **Tests**: existing linking matrix through the app client. **Rollback**:
  UI flag off; API already gated. **Prereq**: PR-D verifier for
  smart-account links.

## PR-I — Abuse + monitoring controls

- **Scope**: edge/network-source OTP rate limiting (the deferred
  multidimensional control), webhook rejection-rate alerting, audit-event
  dashboards, pricing/limit monitors.
- **Rollback**: monitors only; no user-facing behavior. **Prereq**: hosting
  decision for the edge layer.
