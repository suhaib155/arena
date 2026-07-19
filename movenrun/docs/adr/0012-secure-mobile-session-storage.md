# ADR-0012 — Durable secure mobile session storage

Status: Accepted · Scope: mobile session credentials (PR #51)

## Context

PR #50 shipped a deliberately in-memory session store (tokens never touched
disk; every restart required re-authentication). PR #51 makes sessions durable
without weakening the boundary.

## Decision

Session tokens persist ONLY in the OS keystore/keychain via
**expo-secure-store** (Android Keystore / iOS Keychain), behind a two-layer
design:

- **Platform-free core** (`mobile/src/lib/secureSession.ts`): the
  `SecureSessionStore` interface (save/load/clear), a namespaced+versioned key
  (`movenrun.session.v1`), structural validation (exactly the four token
  fields — any extra field is rejected), expiry enforcement, malformed-data
  deletion, and fail-closed rules. Unit-tested offline (13 tests).
- **Keystore adapter** (`secureSessionExpo.ts`): the only module touching the
  native API; installed once at app startup (`app/_layout.tsx`).

Fail-closed rules:
- read failure / storage unavailable → treated as **no session** (deny; user
  re-authenticates) — never a guess, never a fallback;
- write failure → **propagates** (a failed persist is never silent);
- clear failure → **propagates** (a failed credential wipe is never silent;
  the UI surfaces it while still dropping in-app state);
- malformed or expired stored data → deleted, never returned;
- the store registry **throws until an adapter is installed** — there is no
  code path that silently degrades to insecure storage;
- the in-memory backend is TEST-ONLY (`secureSession.testBackend.ts`) and a
  guard test fails if any production module imports it.

Persisted material is the minimum: access token, refresh token, and their two
expiries. No profile, wallet state, permissions, audit data, seed phrase,
private key, recovery secret, or provider token. The server stays
authoritative for everything else. Sign-out clears the store even when the
revoke API call fails; "sign out everywhere" calls `/session/revoke-all`
server-side (bumping the security version → all devices' tokens die) and then
clears locally. Nothing auth-related is ever written to AsyncStorage or
persisted Zustand (guard-tested).

## Upgrade behavior

The prior production state was in-memory only, so **no migration exists or is
needed**: there is no legacy AsyncStorage credential key, no persisted Zustand
credential, and no plaintext migration path (verified by the source-tree guard
test). Existing installs simply re-authenticate once, after which sessions are
durable. The storage key is versioned; any future format change bumps
`movenrun.session.vN` with an explicit documented migration — old-version data
is treated as malformed and deleted.

## Residual risk

- A rooted/jailbroken device weakens keystore guarantees — mitigated by short
  access-token TTLs, server-side revocation, and security-version invalidation
  (threat model §Secure-store extraction).
- expo-secure-store values are limited (~2 KB) — the four token fields are far
  below that.

## Evidence

`mobile/src/lib/__tests__/secureSession.test.ts` (round trip, clear, malformed
deletion, expired deletion, unavailable/write/clear failure, restart restore,
sign-out and revoke-all clearing, no-fallback registry, production-import
guard, AsyncStorage/persist guard) — run by CI (`mobile-checks.yml`).
