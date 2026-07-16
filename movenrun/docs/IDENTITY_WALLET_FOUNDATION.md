# MovenRun Identity & Wallet Foundation

This document is the map for the identity/session/wallet foundation added in the
`security-identity-wallet-foundation` PR. It is a **foundation**: explicit
invariants, deterministic offline tests, clean provider boundaries, and
fail-closed configuration — deliberately with **no production vendor wired**.

## What exists

- **Schema & migration** — `users`, `auth_identities`, `wallets`,
  `auth_sessions`, `wallet_link_challenges`, `email_otp_challenges`,
  `security_audit_events` (`backend/src/db/identity.schema.ts`,
  `backend/drizzle/0001_identity_wallet_foundation.sql`). Applied to an
  ephemeral PostgreSQL 16 cluster; all uniqueness/ownership constraints verified
  to reject duplicate states.
- **Repositories** — interfaces + in-memory (test/dev) + Drizzle/Postgres
  (production) implementations (`backend/src/identity/repositories/**`). The
  in-memory repos mirror every DB constraint so tests exercise the real
  backstops offline.
- **Domain services** — identity resolution/linking, sessions (issue/verify/
  rotate/replay/revoke), idempotent wallet provisioning, wallet linking +
  active-switch + revoke, email OTP, and an append-only redacting audit service
  (`backend/src/identity/services/**`).
- **Provider abstraction** — narrow interfaces + one offline EOA verifier +
  fail-closed adapters + test-only doubles (`backend/src/identity/providers/**`,
  `testDoubles/**`). A guard test forbids production imports of doubles.
- **HTTP surface** — an Express router mounted at `/identity`, strict validation
  (rejects secret-shaped input), stable public error codes, public response
  views that never leak secrets, and readiness separate from liveness
  (`backend/src/identity/http/**`). Provider-dependent flows fail closed.
- **API contract** — `backend/openapi/identity-v1.yaml`.
- **Mobile foundation** — secure-session abstraction (no AsyncStorage for
  tokens), typed API client (server-authoritative), a non-persisted auth store,
  and Account / Wallets / Security screens
  (`mobile/src/{lib,services,store}`, `mobile/app/account/**`).
- **Docs** — ADR-0001…0010 (`docs/adr/`), `docs/THREAT_MODEL.md`,
  `docs/SECURITY_CHECKLIST.md`.

## What is intentionally NOT here (follow-ups)

- No production vendor for Google OIDC, Base Account, email delivery, or the
  embedded-wallet provider — these flows fail closed until wired.
- No ERC-1271/6492 verifier (needs an RPC provider) — smart-account links fail
  closed until it exists.
- No blockchain call, transaction, deployment, paymaster, reward settlement, or
  GPS authority — out of scope and explicitly avoided.

## Backend type-check & test scope

The backend `tsconfig.json` type-checks the read-only blockchain module (pre-
existing) plus the entire identity module and the DB schema
(`src/identity/**`, `src/db/**`). The identity code imports nothing from the
bare `@movenrun/shared` specifier, so it type-checks cleanly and completely.
Legacy route/service files that import bare `@movenrun/shared` remain outside
type-check scope — a pre-existing gap documented in `tsconfig.json` and
`CONTRACTS_AUDIT.md`, not introduced here.

Tests are deterministic and offline (`node:test` + `tsx`): no Base, RPC, Google,
email, wallet provider, blockchain, or deployment endpoint is contacted.
