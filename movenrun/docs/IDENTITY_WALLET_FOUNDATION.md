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

## PR #51 — provider decision, secure storage, webhook security

Added on top of the foundation (real authentication and real wallet
provisioning remain **disabled**):

- **Provider decision** — ADR-0011, status **Blocked** (egress-restricted
  evidence); only provider-neutral infrastructure ships.
- **Strict provider config** — `identity/providerConfig.ts`: fail-closed
  validation of provider identity, URLs (https-only, no debug/tunnel hosts in
  production), exact redirect origins (no wildcards), deep-link schemes,
  webhook signing keys (current + bounded previous-key overlap), and feature
  gates that can never bypass verification.
- **Webhook boundary** — `identity/webhooks/**`: raw-bytes HMAC verification
  (timestamped, key-versioned, timing-safe) before parsing; durable replay-safe
  `provider_events` persistence (migration `0002`); idempotent processing state
  machine with atomic claim/lease and an explicit (currently empty) allowlist.
  Production route fails closed (503) while no provider/key is configured.
- **Durable secure mobile sessions** — ADR-0012: platform-free core +
  `expo-secure-store` keystore adapter, versioned key, fail-closed lifecycle,
  no AsyncStorage/persisted-Zustand credentials, test-only in-memory backend
  guarded against production import. Sign-out everywhere now calls
  `/session/revoke-all` server-side before clearing locally.
- **Readiness** — `/identity/ready` fails closed (503) when Postgres is
  unreachable and reports disabled features as disabled.
- **Operations** — `docs/KEY_ROTATION.md` (rotation, incident, rollback,
  outage behavior).

## PR #53 — session & device management

Provider-independent session/device management on top of the existing session
model. Nothing here requires (or touches) a provider decision.

- **Session inventory** — `GET /identity/sessions` returns the caller's
  sessions as public summaries: `id`, `isCurrent`, `deviceLabel`, `status`
  (`active` | `revoked` | `expired`), `assuranceLevel`, `issuedAt`,
  `expiresAt`, `lastUsedAt`, `revokedAt`. Excluded by construction (the
  summary is a dedicated mapping in `http/publicViews.ts`, never a raw
  repository record): `userId`, `familyId`, `refreshTokenHash`,
  `securityVersion`, `userAgentHash`, `revocationReason`, and all token
  material. `isCurrent` derives from the verified bearer's session — never
  client input. `expired` is computed from server time, so an unswept row is
  never shown as active past its expiry.
  - **Ordering**: current session first; other active sessions by most recent
    use (fallback: issue time); recently ended sessions last by most recent
    relevant timestamp. Rotated rows (internal refresh-chain links) never
    appear.
  - **Retention/cap**: settled sessions older than 7 days are omitted
    (`INVENTORY_RETENTION_DAYS`); the response is capped at 20 sessions
    (`INVENTORY_MAX_SESSIONS`). No unbounded history.
  - **Public ID**: the session UUID is reused as the public handle. This is
    safe because it is random (not sequential, nothing derivable from it) and
    useless without the owner's bearer: every session endpoint scopes the id
    to the authenticated user inside the query itself.
- **Per-session revoke** — `POST /identity/sessions/:id/revoke`. Ownership and
  the state transition are one conditional UPDATE
  (`id AND userId AND revoked_at IS NULL`), so foreign and nonexistent ids are
  indistinguishable (same 404 body — no existence oracle), the current session
  is refused with 409 (use `/session/revoke` for self sign-out), repeats on an
  already-settled owned session succeed idempotently, and concurrent attempts
  produce exactly one transition.
- **Revoke others** — `POST /identity/session/revoke-others`: one atomic
  UPDATE revokes every non-revoked session except the caller's; returns a
  count only. The caller's access AND refresh tokens stay valid (no
  `securityVersion` bump). Idempotent. Existing `/session/revoke` and
  `/session/revoke-all` are unchanged; the three routes are disjoint by path.
- **Refresh/revocation race guard** — refresh re-reads its old session after
  minting the replacement; if a revocation (revoke-one, revoke-others,
  revoke-all, replay-triggered family revoke) landed in the rotate→issue
  window, the freshly minted session is revoked with its family and the
  refresh fails closed with `session_invalid`. Combined with sweeps keyed on
  `revoked_at IS NULL` (which cover rotated chain links too), no interleaving
  leaves a logically revoked family usable — proven against real Postgres.
- **Device label** — clients may send a bounded label at login
  (`deviceLabel` on email-complete). The mobile app only ever sends a coarse
  platform label ("iPhone" / "Android device" / "MovenRun mobile") derived
  from `Platform.OS` — no hardware ids, advertising ids, vendor ids, device
  names, fingerprinting, or new permissions. The server sanitizes
  (whitespace-collapse, control characters rejected, 64-char max,
  `domain/deviceLabel.ts`) and falls back to the generic label; the label is
  display-only, never used for authorization, never audited. The UI
  re-sanitizes before display (defense in depth). Labels persist across
  refresh rotation (carried into the successor session).
- **Mobile UX** — the Account Security screen shows the current-session card
  (never revocable in place), other devices (each with a confirmed revoke),
  recently ended sessions, "Sign out other devices" (keeps this device;
  SecureStore untouched), and "Sign out everywhere" (revoke-all; SecureStore
  and runtime state cleared, navigation returns to the account entry). Lists
  re-fetch after every server-confirmed action — no optimistic deletion; a
  401 that survives the single refresh retry clears local auth and signs out.
  Session actions are deduplicated while one is in flight; the list reloads
  on app resume and by pull-to-refresh.
- **Residual risks** — a revoked session's access token can be replayed only
  within its ≤10-minute TTL *if* verification were ever done offline (it is
  not: `verifyAccess` re-checks the live row, so revocation is immediate);
  the inventory shows coarse metadata only, so a user may not be able to tell
  two same-platform devices apart (accepted: privacy over precision); device
  labels are self-reported by clients and are therefore untrusted display
  hints, never evidence.

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
