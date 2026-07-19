# ADR-0011 — Auth / embedded-wallet provider selection

Status: **Blocked** (second resolution attempt, 2026-07-19 — partial evidence
gathered; hard gates remain unverifiable from this environment)
Scope: provider selection for authentication + embedded EVM wallets
Decision date: none (blocked) · Next review: at the next execution environment
with vendor-documentation egress, or 2026-08-19, whichever is earlier.

## Context

PR #50 established the identity/wallet foundation with every provider surface
fail-closed behind narrow interfaces; PR #51 added provider-neutral
configuration, secure mobile session storage, and replay-safe webhook
ingestion. This ADR selects the production vendor(s) for email/Google/Base
authentication and embedded EVM wallets — or records precisely why it cannot
yet.

A first attempt (PR #51) was Blocked with two denied doc fetches. This second
attempt (2026-07-19) gathered all evidence obtainable from the current
environment. Companion documents:

- `docs/PROVIDER_DECISION_MATRIX.md` — per-candidate hard-gate results.
- `docs/PROVIDER_EVIDENCE_REGISTER.md` — every claim, source, date, confidence.
- `docs/PROVIDER_INTEGRATION_SEQUENCE.md` — the implementation PR sequence.
- `docs/PROVIDER_QUESTIONS.md` — unresolved questions by severity.

## Candidates

Privy, Dynamic, Web3Auth, Turnkey, Coinbase CDP / Smart Wallet, Magic.
None screened out a priori; per-candidate status is in the decision matrix.

## What WAS verified (official npm registry metadata, accessed 2026-07-19)

registry.npmjs.org is the only official vendor-published channel reachable
from this environment. Vendor package metadata verifies SDK existence,
maintenance, and peer-dependency compatibility with the app (Expo SDK ~51,
react-native 0.74.1, react 18.2.0):

| Vendor | RN/Expo package | Latest | Published | RN/Expo peer range | Compatible with RN 0.74.1? |
|---|---|---|---|---|---|
| Privy | `@privy-io/expo` (+ `expo-native-extensions`) | 0.70.3 / 0.0.12 | 2026-07-15 / 2026-07-02 | `react-native: *`, `expo: *` | Range-compatible (docs unverified) |
| Dynamic | `@dynamic-labs/react-native-extension` | 4.92.4 | 2026-07-16 | `react-native >=0.73.6` | **Yes (verified range)** |
| Web3Auth | `@web3auth/react-native-sdk` | 9.0.0 | 2026-05-20 | `react-native: *` | Range-compatible (docs unverified) |
| Turnkey | `@turnkey/sdk-react-native` | 1.5.24 | 2026-07-16 | `react-native ^0.76.5` | **No — verified incompatibility** with the app's pinned RN 0.74.1 |
| Coinbase | `@coinbase/wallet-mobile-sdk` (external-wallet SDK; no embedded-wallet RN SDK found) | 1.1.2 | **2024-09-10 (stale ~22 months)** | `*` | Wrong capability; embedded-wallet RN path Unverified |
| Magic | `@magic-sdk/react-native-expo` | 34.8.1 | 2026-07-08 | `expo: *`, `react-native >=0.60` | Range-compatible (docs unverified) |

Server SDKs verified active: `@privy-io/server-auth` 1.32.5,
`@turnkey/sdk-server` 7.0.0 (2026-07-16), `@coinbase/cdp-sdk` 1.53.0
(2026-07-16), `magic-sdk` 33.9.0.

Consequences that are already decidable from verified evidence:

- **Turnkey**: hard gate 1/2 currently FAILS for this codebase — its RN SDK's
  peer range excludes RN 0.74.1. Selecting Turnkey would force an Expo SDK
  upgrade, which is protected scope (separate PR, device-tested). Not
  disqualified permanently; disqualified *at the current app baseline*.
- **Coinbase CDP**: no embedded-wallet React Native SDK was found under the
  official scope; the only mobile package is the external-wallet SDK, stale
  since 2024. Embedded-wallet mobile support is Unverified-and-doubtful
  pending documentation.
- **Privy, Dynamic, Magic, Web3Auth**: actively maintained RN/Expo SDKs
  (Dynamic and Privy published within days of the access date). These four
  clear the *registry-verifiable part* of hard gates 1–2.

## What could NOT be verified (and why)

Every vendor documentation, security, pricing, terms, and status host is
denied by this environment's egress policy — verified by proxy log
(`connect_rejected`) on 2026-07-19 for: docs.privy.io, www.privy.io,
docs.dynamic.xyz, web3auth.io, docs.turnkey.com, docs.cdp.coinbase.com,
magic.link, status.privy.io (full list + timestamps in the evidence
register). Without those sources, the following hard gates are **Unverified
for every candidate** and, per the source policy, cannot be inferred from
memory:

- gate 4 — user-controlled export / portability (and its mobile UX);
- gate 5 — no seed/raw-key ingestion requirement;
- gate 6 — server-verifiable authentication (mechanism + current details);
- gate 7 — authenticated webhooks (exact signature scheme, replay, rotation);
- gate 8 — Base / Base Account compatibility;
- gate 10 — custody model vs the non-custodial boundary (MPC/TEE/HSM,
  unilateral signing authority, recovery authority);
- gate 11 — migration/lock-in controls (export format, contractual terms);
- gate 12 — current pricing.

## Decision: Blocked

Hard-gate rule: a primary provider cannot be selected unless ALL gates are
verified. No candidate has verifiable gates 4–12 from this environment, so
**ADR-0011 remains Blocked**. The exact missing evidence is enumerated above
and in the decision matrix; the denied source URLs are recorded in the
evidence register so the unblock task is a pure evidence-collection exercise.

No weighted ranking is published: with the security/custody/export dimensions
Unverified for every candidate, any composite score would let mobile-SDK
freshness masquerade as a security judgment ("a marketing claim cannot
compensate for an unverified hard security boundary" — neither can a publish
date). The matrix document contains the scoring template plus the only
evidence-backed sub-scores (Mobile/Expo maintenance).

**Evaluation priority when unblocked** (an ordering of *effort*, not a
selection): Privy and Dynamic first (freshest verified RN/Expo activity, both
ship server SDKs), then Magic and Web3Auth, then Coinbase CDP (embedded-
wallet mobile path must be proven to exist), Turnkey last at the current app
baseline (verified RN-range incompatibility).

## Architecture constraints (binding on any future selection)

Unchanged from the foundation, and restated as selection conditions:
`users.id` stays canonical; `(provider, providerSubject)` stays the identity
key; no email-based merging; MovenRun-owned sessions, wallet metadata, and
ownership state in Postgres; one active wallet per user; no seed/private-key
import; export only through a provider-isolated handoff; vendor SDKs stay
behind the PR #50 adapter interfaces; fail-closed configuration; replay-safe
webhook ingestion with lease-token settlement; webhook allowlist stays empty
until concrete event semantics are implemented and reviewed.

## Models and lock-in controls (selection-independent, binding)

- **Identity model**: canonical identity, sessions, and audit live in MovenRun
  Postgres; the vendor holds only its own auth/key material. Vendor subjects
  are `(provider, providerSubject)` rows — re-keying to a new vendor is an
  additive migration, never a rewrite.
- **Wallet model**: MovenRun stores address + opaque provider reference only;
  no key material ever. One active wallet per user; provisioning stays
  idempotent through the PR #50 state machine.
- **Session model**: MovenRun-issued tokens remain the only client
  credentials; vendor tokens are verified server-side and minimized, never
  stored long-lived unless a verified requirement forces it.
- **Export/recovery model**: export happens only in the provider-isolated
  surface (ADR-0009); a vendor without an isolated export surface is
  disqualified (gate 4). Recovery authority must not allow support-only or
  vendor-unilateral takeover (ADR-0010, gate 10).
- **Webhook model**: vendor deliveries map onto the PR #51 verified-ingestion
  boundary (raw-body signature verification, unique event id, digest-mismatch
  anomaly, lease-token settlement); a vendor scheme incompatible with
  signature-before-parse is disqualified (gate 7).
- **Outage behavior**: all provider-dependent flows fail closed today and
  after selection; webhook redelivery + idempotent ingestion absorb outages;
  readiness reports disabled/unavailable honestly and never calls the vendor
  live.
- **Pricing**: unverifiable here (gate 12); to be recorded with source and
  date at unblock.

## Adversarial architecture review (provider-generic; re-run against the selected vendor)

| Risk | Likelihood | Impact | Mitigation | Detection | Recovery | Residual | Blocks selection? |
|---|---|---|---|---|---|---|---|
| Provider/developer unilateral signing | Unknown until custody docs verified | Critical (funds) | Gate 10 requires user-controlled keys; disqualify vendors with unilateral authority | Custody docs + pen-test evidence | Vendor change via adapter boundary | Vendor honesty | **Yes — unverified = blocked** |
| Provider account/dashboard/API-secret/webhook-key compromise | Med | High | Key rotation runbook (KEY_ROTATION.md), bounded webhook overlap, least-privilege API keys | webhook_rejected anomalies, audit | Rotate; gate off | Window before rotation | No (operational) |
| Provider outage/shutdown/bankruptcy | Low-Med | High | Fail-closed flows; canonical state in Postgres; export requirement (gate 4); adapter boundary | Readiness + webhook silence | Migrate via export path | Migration lead time | No if gate 4 verified |
| Export unavailable/plan-gated/unsafe on mobile | Unknown | High | Gate 4 verification incl. mobile UX + plan tier | Doc + sandbox verification | Disqualify vendor | — | **Yes — unverified = blocked** |
| Identity/wallet provider mismatch (split stack) | Med (if combination) | Med | Combination rule: single provider preferred; clean ownership split documented | Integration tests | Collapse to one vendor | Complexity | No |
| Duplicate identities / wallet orphaning | Low | Med | `(provider, providerSubject)` uniqueness; idempotent provisioning (PR #50) | DB constraints | Re-link flow | — | No |
| Recovery takeover (incl. email/Google account takeover) | Med | High | Step-up + final-method protection (PR #50); vendor recovery-authority verification (gate 10) | Audit trail | Revoke-all | Email-only-factor users | No (existing controls) |
| Base Account signature ambiguity / ERC-1271/6492 gaps | Unknown | Med | Gate 8; verifier split already fail-closed | Link-flow tests | Keep smart-account link disabled | — | Yes for Base-auth scope |
| Expo native-module incompatibility | Verified for Turnkey; unknown for others' native layers | High | npm peer-range check (done); doc + device build verification when unblocked | CI + device builds | Vendor change / Expo upgrade PR | Expo upgrade is protected scope | Yes at current baseline (Turnkey) |
| SDK abandonment | Low (Privy/Dynamic/Magic active; Coinbase mobile-sdk stale) | Med | Publish-recency monitoring (register) | npm metadata | Vendor change | — | No |
| Vendor user-ID migration | Med | Med | Canonical `users.id` + provider-subject mapping rows | — | Re-key mapping | — | No |
| Webhook replay/ordering | Low | Med | PR #51 ingestion: unique event id, digest-mismatch anomaly, lease tokens | Audit | Redelivery | External side effects of future handlers | No |
| Pricing shock / rate-limit exhaustion | Unknown | Med | Gate 12; contract review | Billing monitoring | Vendor change | — | Yes — unverified = blocked |
| Regional restrictions / terms changes / forced custodial behavior | Unknown | High | Gate 10/11 incl. terms review; rollback triggers below | Terms monitoring | Migration plan | — | Yes — unverified = blocked |

## Conditions before implementation (when a selection is eventually Accepted)

1. All 12 hard gates verified with official sources logged in the register.
2. Sandbox proof: auth round-trip, wallet provisioning, export handoff, and
   webhook signature verification against the vendor's test environment.
3. Expo SDK 51 device build (or an explicit, separately-approved Expo upgrade
   PR if the vendor requires newer RN).
4. Threat model + security checklist updated for the vendor's concrete trust
   boundaries; webhook allowlist populated only per reviewed event semantics.
5. Pricing/terms reviewed and recorded; rollback triggers below adopted.

**Rollback triggers** (post-selection): vendor announces custody-model change
incompatible with the non-custodial boundary; export capability removed or
plan-gated; RN/Expo SDK abandoned (>6 months without maintenance while a
breaking platform change is pending); terms change restricting migration;
material unremediated security incident.

## Unresolved questions

See `docs/PROVIDER_QUESTIONS.md` (classified blocking / pre-production /
post-launch). The blocking set is exactly the denied-source evidence above.
