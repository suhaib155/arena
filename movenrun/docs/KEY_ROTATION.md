# Key rotation & identity operations runbook

Operational reference for the secrets introduced by the identity foundation
(PR #50) and the provider/webhook layer (PR #51). Real authentication and real
wallet provisioning remain **disabled** (ADR-0011); these procedures apply now
to the webhook boundary and, once a provider is wired, unchanged to it.

## Webhook signing keys (supported now)

Config: `IDENTITY_WEBHOOK_CURRENT_KEY_ID/_SECRET`,
`IDENTITY_WEBHOOK_PREVIOUS_KEY_ID/_SECRET`, `IDENTITY_WEBHOOK_PREVIOUS_EXPIRES_AT`,
`IDENTITY_WEBHOOK_MAX_SKEW_SECONDS`.

Rotation procedure:
1. Generate the new secret (≥32 chars, CSPRNG) with a NEW key id.
2. Deploy with: new key as CURRENT, old key as PREVIOUS with
   `PREVIOUS_EXPIRES_AT` set to now + the overlap window.
3. Update the sender (provider dashboard) to sign with the new key.
4. After the overlap expires, remove the PREVIOUS_* values.

Policy:
- **Overlap duration**: 24 h default; never exceed 7 days
  (**maximum old-key age**). Config validation rejects a previous key without
  a bounded expiry — unlimited historical keys are impossible.
- Deliveries signed with the expired previous key are rejected
  (`expired_key`) and audited (`webhook_rejected`).
- Record a `key_rotation_activated` audit event when rotation deploys.

## Access-token signing / refresh-hash pepper (`IDENTITY_SESSION_PEPPER`)

Rotating the pepper invalidates ALL outstanding access tokens (MAC mismatch)
and refresh tokens (hash mismatch) at once — every user re-authenticates.
This is the intended **emergency revocation** switch for suspected pepper
compromise. There is deliberately no dual-pepper overlap: sessions are cheap
to re-establish, and overlap would double the verification surface. For
non-emergency hygiene, rotate during a low-traffic window and announce a
forced re-login.

## OTP pepper (`IDENTITY_OTP_PEPPER`)

Rotation invalidates in-flight OTP codes (hash mismatch → `verification_failed`,
attempt caps still enforced). Blast radius is one OTP TTL (≤5 min); rotate
freely.

## Provider API secret (once a provider is wired)

Standard two-step: create the new secret provider-side, deploy config, revoke
the old one provider-side. MovenRun stores it only in env config (validated
≥32 chars, never logged/echoed).

## Incident procedure (suspected key compromise)

1. Webhook key: rotate immediately with a MINIMAL overlap (minutes), or set
   `IDENTITY_FEATURE_WEBHOOKS=false` to fail the boundary closed while
   rotating. Events missed during closure are recovered by provider redelivery
   (idempotent ingestion absorbs duplicates).
2. Session pepper: rotate → global logout (see above) + review
   `security_audit_events` for anomalous sessions.
3. Always: record the incident, the rotation audit event, and verify
   `/identity/ready` afterwards.

## Rollback

Config-only in every case: restore the previous env values and redeploy.
Webhook rollback re-accepts the old key only if it is re-listed as CURRENT
(the expiry bound still applies to PREVIOUS).

## Readiness during rotation

An incomplete rotation (e.g. webhook gate on, key missing/short; previous key
without expiry) is INVALID configuration: production startup fails closed
(process exit), and a running instance's `/identity/ready` keeps reporting the
last valid state of its immutable config. Disabled features are reported as
`disabled`, never healthy. Readiness also fails (503) when Postgres is
unreachable. No secret ever appears in readiness output or config errors.

## Provider outage behavior (documented for the future integration)

Provider-dependent flows fail closed (`provider_not_configured` /
`provisioning_failed` 503) — sign-in and wallet surfaces degrade to explicit
unavailability, never fake success. Webhook redelivery + idempotent ingestion
recover the event stream after an outage. Readiness intentionally performs NO
live external provider call (unbounded latency and cascading false negatives);
provider health is observed through webhook rejection/audit rates instead.

## Audit requirements

Every rotation and every rejected webhook writes an audit event
(`key_rotation_activated`, `webhook_rejected` with reason class). Never logged:
raw tokens, signatures, webhook bodies, peppers, provider secrets, seed
phrases, private keys, recovery secrets.
