# ADR-0008 — Non-custodial seed phrase / private-key boundary

Status: Accepted · Scope: whole system (hard invariant)

## Context

The single most dangerous thing a wallet-adjacent product can do is touch user
secret material. MovenRun must be, and must provably remain, non-custodial.

## Decision

MovenRun **never** accepts, transmits, validates, parses, logs, stores, imports,
caches, or persists a seed phrase or raw private key. Concretely:

- **No schema column** anywhere for a private key, mnemonic, or recovery secret
  (`security_audit_events`, `wallets`, and every other table).
- **No input** for a mnemonic or private key: request schemas are `.strict()`
  (unknown fields rejected), and `assertNoSecretShapedInput` additionally
  rejects any body whose key name matches a secret pattern or whose value looks
  like a BIP-39 phrase or a 32-byte hex key.
- **No local key generation** in application code (backend or mobile). Embedded
  wallets are created by the provider; the app never runs a key generator.
- **No secret in logs/telemetry**: the audit service redacts secret-shaped keys
  and non-scalar values before persisting.
- **Mobile**: session tokens live only in a secure-store abstraction (OS
  keychain in production), never in AsyncStorage or persisted Zustand; there is
  no seed/private-key input anywhere in the UI.

Revealing/exporting the embedded wallet's recovery secret is possible **only**
through the provider's isolated export surface (ADR-0009), never through
MovenRun.

## Consequences

- A compromised MovenRun server or database cannot leak wallet secrets, because
  it never had them.
- Support cannot move user funds (ADR-0010).

## Evidence

`securityControls.test.ts` (no secret column in executable schemas; audit
redaction), `http/validation.ts` + `router.test.ts` (mnemonic field and
private-key-shaped input rejected), mobile `secureSession.ts` (no AsyncStorage
for tokens; no seed/key API).
