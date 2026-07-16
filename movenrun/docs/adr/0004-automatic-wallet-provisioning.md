# ADR-0004 — Automatic wallet provisioning

Status: Accepted · Scope: wallet foundation

## Context

First-time signup must create exactly one default embedded wallet, and this must
survive retries, provider webhook replays, concurrent requests, API restarts,
and worker retries without ever creating duplicate default wallets.

## Decision

Model provisioning as a two-phase, idempotent state machine on the `wallets`
row (`provisioningState`): `requested → provisioning → active`, with
`provisioning → failed_transient → provisioning` (safe retry) and
`provisioning → failed_terminal` (observable, support-recoverable).

- `request()` records intent as a single wallet row. The DB constraint
  `wallets_embedded_per_user_provider_unique` (partial unique on
  `(userId, sourceProvider)` where embedded and not revoked) is the backstop:
  concurrent/replayed requests converge on one row.
- `provision()` drives the provider call. It is idempotent: an already-`active`
  row short-circuits, and a provider replay (same idempotency key → same
  address) leaves the row unchanged.
- The wallet becomes the user's active wallet **exactly once** — only when the
  user has no active wallet yet.
- The address column is nullable during `requested`/`provisioning` (before the
  provider returns an address); it is always set for `active`/external wallets.

## Consequences

- No duplicate default wallets under any retry/replay/concurrency scenario.
- Terminal failures are visible and recoverable rather than silently swallowed.
- Signup never blocks on provisioning: sign-in succeeds even if provisioning is
  pending or failed; the wallet state is observable via the API.

## Evidence

`walletProvisioning.service.test.ts` (created-exactly-once, concurrency,
transient retry, terminal observability, provider replay, active-set-once) and
the Postgres constraint validation.
