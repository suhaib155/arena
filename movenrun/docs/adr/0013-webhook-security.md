# ADR-0013 — Provider webhook verification and event ingestion

Status: Accepted · Scope: webhook boundary (PR #51)

## Context

Every serious embedded-wallet/auth provider delivers state changes via signed
webhooks. Webhook ingestion is an unauthenticated, internet-facing surface that
can forge identity/wallet state transitions if mishandled — it needs its own
verification, replay, and idempotency architecture before any provider is
wired.

## Decision

**Verification** (`identity/webhooks/hmacVerifier.ts` behind
`ProviderWebhookVerifier`):
- signature is verified over the EXACT raw request bytes BEFORE any parsing
  (the route uses `express.raw` with a 256 KB limit and is mounted ahead of —
  and excluded from — the app-wide JSON parser);
- timestamped HMAC-SHA-256 (Stripe/Svix-style) with a domain-separation
  context (`movenrun.webhook.v1`), timing-safe comparison, bounded clock skew
  (default 300 s, stale AND future rejected);
- key-version pinning: current key + optional previous key accepted only until
  its configured expiry (bounded rotation overlap; unlimited historical keys
  are rejected at config time);
- rejection carries a coarse reason class for audit (`webhook_rejected`) and a
  stable 401/400 to the caller — raw signatures and bodies are never logged.

**Fail-closed default**: with no provider selected (ADR-0011 Blocked) and no
signing key configured, the production route answers a stable 503
`provider_not_configured`. There is no fake verifier, no debug bypass, and no
feature flag that can skip verification (the webhook gate refuses to enable
without a full-length key — tested).

**Persistence** (`provider_events`, migration `0002`): verified events are
stored with a unique `(provider, provider_event_id)` — the DB is the replay/
idempotency authority across replicas and restarts. Only a SHA-256 payload
digest plus minimal normalized envelope fields are stored — never the raw
payload, tokens, keys, or any secret. Provider identity fields are immutable
after insert (no store method updates them; tested). Duplicate deliveries
return idempotent success (200) so providers stop retrying.

**Processing** (`ProviderEventService`): explicit state machine
`received → processing → processed | retryable_failure | terminal_failure |
ignored`. Claiming is an atomic compare-and-set with a lease (exactly one
processor wins; expired leases are safely reclaimable), retries are bounded
(attempt cap → terminal), terminal states refuse further transitions, and the
event-type allowlist is explicit — unknown types are durably stored, marked
`ignored`, and audited. Handlers must call the existing domain services, so a
webhook can never bypass ownership/uniqueness invariants, persist secret
material, or attach a wallet to the wrong user (tested against the domain
layer). The production handler registry is **empty** until ADR-0011 selects a
provider: this PR deliberately stops at verified ingestion + durable
idempotent storage.

## Evidence

`hmacVerifier.test.ts` (14-case negative matrix), `eventService.test.ts`
(state machine, claim, bounded retry, lease recovery, immutability, wrong-user
rejection), `router.test.ts` (raw body, disabled 503, duplicate idempotency,
oversized 413, content-type 415), and real-PostgreSQL concurrency evidence
(200 racing ingests → one insert; 160 racing claims → one winner).
