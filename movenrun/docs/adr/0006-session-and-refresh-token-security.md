# ADR-0006 — Session and refresh-token security

Status: Accepted · Scope: sessions

## Context

Sessions must be secure against theft and replay across multiple backend
replicas and process restarts, with short-lived access and rotating refresh
credentials, and no plaintext credential ever persisted.

## Decision

- **Refresh token**: composite `<sessionId>.<secret>`. Only the HMAC-SHA-256 of
  `<secret>` under a server pepper is persisted (`auth_sessions.refreshTokenHash`,
  unique). The plaintext is returned once and never stored.
- **Access token**: opaque, stateless, short-lived HMAC over
  `sessionId|expiry|securityVersion`. Verification recomputes the HMAC
  (constant-time) **and** re-checks the live session (active, unrevoked,
  unexpired) and that `securityVersion` still matches the user's — so a
  security-version bump or a revoke invalidates outstanding access tokens
  immediately.
- **Rotation + reuse detection**: each refresh rotates the session
  (`active → rotated`) and mints a fresh session in the same **family**.
  Presenting a rotated/revoked refresh token is a replay: the whole family is
  revoked (fail closed) and a `refresh_replay_detected` audit event is written.
- The authority is the database, not a process-local `Map`, so all of the above
  holds across replicas and restarts.
- `securityVersion` on `users` is bumped on revoke-all and material security
  events; sessions carry the value they were minted at.

## Consequences

- Stolen access tokens expire quickly and die instantly on revoke/security bump.
- A stolen-then-replayed refresh token triggers family revocation, containing
  the blast radius and signaling the anomaly.
- No plaintext bearer/refresh token is ever at rest.

## Evidence

`session.service.test.ts` (expiry, rotation, replay→family revocation, revoked
rejection, security-version invalidation, revoke-all, recent-auth, no-plaintext
persistence).
