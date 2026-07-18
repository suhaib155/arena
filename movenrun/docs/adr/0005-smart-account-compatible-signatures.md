# ADR-0005 — Smart-account-compatible signatures

Status: Accepted · Scope: wallet linking / Base Account auth

## Context

Base Accounts and other ERC-4337 smart-contract wallets do not necessarily
produce a recoverable secp256k1 signature. Assuming `ethers.verifyMessage`
covers all wallets would silently reject legitimate smart-account users or,
worse, mis-handle verification.

## Decision

Split signature verification into two interfaces:

- `WalletOwnershipVerifier` (kind `eoa`) — plain EIP-191/personal_sign recovery.
  Shipped as `EoaSignatureVerifier`, a pure offline adapter (no RPC, no keys).
- `SmartAccountSignatureVerifier` (kind `smart_account`) — ERC-1271 (deployed)
  and ERC-6492 (undeployed/counterfactual) verification. A real implementation
  needs an RPC provider, so it is **not wired** in this PR;
  `NotConfiguredSmartAccountVerifier` fail-closes (always invalid) until it is.

`WalletLinkService` routes `external_smart_account` / `base_smart_account`
through the smart-account verifier and everything else through the EOA verifier.

## Consequences

- Contract wallets have a first-class, correct verification path from day one of
  the schema/flow, even though the concrete verifier lands later.
- Until the ERC-1271/6492 verifier is wired, smart-account links fail closed
  rather than succeed through an unverified path.

## Evidence

`walletLink.service.test.ts` (smart-account path via a verifier double; the
fail-closed default rejecting a smart-account signature).
