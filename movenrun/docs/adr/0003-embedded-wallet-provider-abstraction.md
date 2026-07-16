# ADR-0003 — Embedded-wallet-provider abstraction

Status: Accepted · Scope: wallet foundation

## Context

Every new user should get a user-controlled EVM wallet automatically, without
MovenRun ever holding key material. The wallet is created by a specialized
embedded-wallet provider (e.g. an MPC/TEE key-management service). We must not
couple to a specific vendor prematurely.

## Decision

Introduce `EmbeddedWalletProvider` (`providers/types.ts`) with two methods:

- `provision({ userId, idempotencyKey })` → returns only a **public address** and
  an **opaque provider reference** (`providerWalletRef`). Never a key or seed.
  It must be safe to call more than once for the same idempotency key (a replay
  returns the same wallet).
- `beginExport({ userId, walletProviderRef })` → returns only a short-lived
  handoff reference for the provider's isolated export surface (ADR-0009).

Transient vs terminal failures are typed (`EmbeddedWalletTransientError` /
`EmbeddedWalletTerminalError`) so orchestration can distinguish "retry later"
from "needs recovery".

## Consequences

- MovenRun stores no secret material for embedded wallets — only the address and
  an opaque reference (see `wallets` schema: no key/mnemonic column exists).
- No vendor is wired in this PR; `WalletProvisioningService.provision` fails
  closed (`provider_not_configured`) when no adapter is present, leaving the
  provisioning row observably in `requested`.
- Swapping providers later is an adapter change, not a domain change.

## Evidence

`walletProvisioning.service.test.ts` (no secret persisted; fail-closed;
idempotent replay).
