# ADR-0011 — Auth / embedded-wallet provider selection

Status: **Blocked** (provider-neutral infrastructure shipped) · Scope: PR #51

## Context

PR #50 established the identity/wallet foundation with every provider surface
fail-closed behind narrow interfaces (`OidcAuthProvider`,
`EmbeddedWalletProvider`, `EmailOtpDeliveryProvider`,
`SmartAccountSignatureVerifier`). The next step is choosing the production
vendor(s) for email/Google/Base authentication and embedded EVM wallets.

## Decision criteria

Email auth · Google auth · Base Account compatibility · embedded EVM wallets ·
React Native / Expo (SDK 51) support · user-controlled wallet export · webhook
signing · multi-wallet support · smart-account (ERC-4337/1271/6492)
compatibility · account recovery · reliability track record · privacy/data
handling · pricing · migration/export capability · vendor lock-in · test
environment quality · mobile and server SDK maturity.

## Candidates considered

| Candidate | Profile (as known to the team) |
|---|---|
| **Privy** | Email/social auth + embedded EVM wallets, RN/Expo SDK, user export flow, signed webhooks (Svix-style), smart-account integrations |
| **Dynamic** | Wallet-first auth + embedded wallets, multi-wallet emphasis, RN support, webhooks |
| **Web3Auth** | MPC key infrastructure, social logins, RN SDK, export via key reconstruction |
| **Turnkey** | Wallet infrastructure (TEE-based key mgmt), strong API/webhook posture; auth is bring-your-own |
| **Coinbase CDP / Smart Wallet** | Base-native alignment, smart accounts, embedded wallet APIs; Base Account synergy |
| **Magic** | Email-first auth + wallets, mature SDKs |

## Decision: Blocked

A responsible selection requires verifying, against **current official
documentation**: Expo SDK 51 compatibility matrices, webhook signing schemes
and key-rotation support, export-flow isolation guarantees, pricing, and data-
processing terms. This work was performed in a sandboxed environment whose
egress policy blocks the vendors' documentation hosts (verified: HTTP 403 from
the policy proxy for docs.privy.io and docs.dynamic.xyz on 2026-07-17). The
table above therefore reflects team knowledge, **not** live-verified evidence —
insufficient for a production security decision.

Per the PR #51 brief, the decision is recorded as **Blocked** and this PR ships
only **provider-neutral infrastructure**, all of which is required regardless
of the vendor chosen:

- strict provider-neutral configuration (`identity/providerConfig.ts`) —
  unknown providers rejected, `disabled` is the only valid mode today;
- a real, generic timestamped-HMAC webhook verifier with key rotation
  (`identity/webhooks/hmacVerifier.ts`);
- durable, replay-safe provider-event persistence + idempotent processing
  (`provider_events`, `identity/webhooks/**`);
- durable secure mobile session storage (`expo-secure-store`, ADR-0012).

## Selection consequences to resolve when unblocked

- **Tradeoffs**: Base-native alignment (Coinbase) vs auth breadth (Privy/
  Dynamic) vs key-management specialization (Turnkey/Web3Auth); single-vendor
  convenience vs split auth/wallet vendors.
- **Lock-in controls**: all vendor SDK types stay behind the PR #50 adapters;
  provider identity keys are `(provider, providerSubject)` rows, so re-keying
  to a new vendor is an additive migration; wallet export capability is a hard
  requirement precisely to keep users portable.
- **Data ownership**: canonical identity (users, wallets, sessions, audit)
  lives in MovenRun Postgres; the provider holds only its own auth/key
  material.
- **Secret handling**: provider API secrets enter only via validated env
  config; never logged, never echoed in errors (tested).
- **Outage behavior**: provider-dependent flows already fail closed
  (`provider_not_configured`); with a vendor wired, outages degrade to the
  same closed state and readiness reports the dependency honestly.
- **Wallet-export boundary**: unchanged from ADR-0009 — export happens in the
  provider's isolated surface; MovenRun never sees the secret. A vendor
  without an isolated export surface is disqualified.
- **Residual risk**: until selection, no real login/wallet exists — that is
  the intended fail-closed state, not a gap.

## Evidence

`providerConfig.test.ts` (unknown provider rejected, disabled mode valid),
webhook verifier/event tests, and the blocked-fetch record above.
