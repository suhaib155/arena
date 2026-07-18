# ADR-0002 — Authentication-provider abstraction

Status: Accepted · Scope: identity foundation

## Context

We need email OTP, Google OIDC, and Base Account auth, and want the freedom to
choose or change vendors without rewriting the domain. Vendor SDKs bring heavy
types and network coupling that must not leak into core logic.

## Decision

Define narrow production interfaces (`providers/types.ts`): `OidcAuthProvider`,
`EmailOtpDeliveryProvider`, `WalletOwnershipVerifier`,
`SmartAccountSignatureVerifier`, `EmbeddedWalletProvider`. Domain services
depend only on these interfaces; any concrete vendor SDK lives behind an adapter
that implements one of them, and no vendor type is allowed past that adapter.

- Email OTP verification is handled natively (hashed codes); only *delivery* is
  a provider side effect.
- This PR ships **no** concrete vendor adapter. It ships the interfaces, one
  real offline adapter (`EoaSignatureVerifier`), fail-closed
  `NotConfigured*` adapters, and deterministic test doubles used by tests only.
- Configuration is **fail-closed**: a half-configured provider (e.g. Google
  client id without secret) is a startup error in production, never a silent
  "sort of enabled" state.

## Consequences

- Provider selection is deferred until a real provider is approved and its
  secrets/config exist — "secure architecture over premature SDK coupling".
- Provider-dependent endpoints return `provider_not_configured` (503) instead of
  fabricating success, so there is no fake authentication path.
- A guard test asserts production modules never import test doubles.

## Evidence

`config.test.ts` (fail-closed provider validation), `securityControls.test.ts`
(import boundary), `router.test.ts` (google/base entry points return 503).
