# ADR-0007 — Wallet linking and active-wallet switching

Status: Accepted · Scope: wallet linking

## Context

Users link external wallets by proving control via a signed challenge, choose an
active wallet, and revoke wallets — all without duplicate ownership, replay, or
losing a usable active wallet.

## Decision

- **Challenge**: a `wallet_link_challenges` row binds user, session, action,
  domain, URI, chain id, a strong single-use nonce, expected address, and a
  validity window (issued/not-before/expires).
- **Server-authoritative message**: the EIP-4361 message is rebuilt from the
  stored challenge at verify time and never parsed from client input, so a
  signature is valid only for the exact action/domain/chain/nonce issued. The
  caller's declared `(domain, uri, chainId, action)` must also match, making
  wrong-domain/uri/chain/action explicit rejects.
- **Replay-safe consume**: consumption is an atomic `consumedAt: null → now`
  transition in the store (conditional `UPDATE ... RETURNING`). A replay — even
  after a restart or on another replica — returns zero rows and is rejected.
- **Duplicate ownership**: a verified wallet address may belong to only one user
  (`wallets_verified_address_unique`). A second user linking it is rejected; the
  same user re-linking is idempotent.
- **Active switch**: `setActive` is transactional (clear others, set target) so
  the `wallets_active_per_user_unique` invariant holds under concurrency.
- **Safe fallback**: revoking the active wallet falls back to another verified
  wallet when one exists, so the user is never left active-less unnecessarily.
- **Pending-op policy hook**: a `WalletChangePolicy` boundary can block active
  switch/revoke while a sensitive operation is pending → `wallet_operation_locked`.

## Consequences

- Address case is normalized to a lowercase canonical form everywhere, so
  `0xAbC…` and `0xabc…` can never be treated as two wallets.
- Switching the active wallet is purely a pointer change — it moves no rewards
  or ownership, and the UI states this explicitly.

## Evidence

`walletLink.service.test.ts` (14 cases: EOA/smart-account link, wrong
domain/uri/chain/action, expired, consumed replay, replay-after-restart,
normalization, duplicate ownership, concurrency, active transactionality,
fallback, policy denial).
