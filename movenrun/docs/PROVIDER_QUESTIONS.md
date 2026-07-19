# Provider questions — ADR-0011 (all candidates)

Classified **Blocking** (must be answered before selection), **Pre-production**
(before the feature ships), **Post-launch** (optimization). Blocking questions
are exactly the evidence denied to the current environment (register §B).

## Blocking — required to resolve ADR-0011

Per candidate (Privy, Dynamic, Web3Auth, Turnkey, Coinbase CDP, Magic):

1. **Custody (gate 10)**: exact key architecture (MPC/TEE/HSM/shares); can the
   provider or the developer sign without the user? Who holds recovery
   authority? Source: security/custody docs.
2. **Export (gate 4)**: is user-controlled export available on ALL plans, on
   mobile, in an isolated surface MovenRun never sees? Exact UX and format.
3. **Seed/key boundary (gate 5)**: does any integration path require MovenRun
   to receive, proxy, or display seed phrases or raw private keys? (Any "yes"
   disqualifies.)
4. **Server-verifiable auth (gate 6)**: exact token/JWKS/verification
   mechanism; canonical, stable provider subject for `(provider, subject)`.
5. **Webhooks (gate 7)**: signature scheme (raw-body HMAC? asymmetric?),
   timestamp/replay semantics, key rotation, event ids, retry/ordering,
   test fixtures — mappable onto the PR #51 verify-before-parse boundary?
6. **Base (gate 8)**: Base + Base Sepolia support; Base Account (smart
   account) compatibility; ERC-1271/6492 positions.
7. **Expo (gates 1–2)**: documented Expo SDK 51 support or minimum SDK/RN
   version; Expo Go vs custom dev build; native module list; deep-link
   requirements. Specifically:
   - **Turnkey**: is the verified `react-native ^0.76.5` peer requirement a
     hard floor (⇒ Expo upgrade PR required before selection is even
     testable)?
   - **Coinbase CDP**: does an embedded-wallet React Native/Expo SDK exist at
     all? (None found on the registry.)
8. **Pricing (gate 12)**: current MAU/wallet/transaction pricing, webhook
   limits, free tier, enterprise gates, minimum commitments.
9. **Lock-in (gate 11)**: contractual migration/export restrictions; hosted-UI
   dependence; can all identity/wallet state remain canonical in MovenRun
   Postgres?

## Pre-production (after selection, before enabling each feature)

1. Sandbox environment quality: deterministic test users, webhook test
   fixtures, replay simulation.
2. Rate limits and burst behavior for auth + wallet APIs; documented outage
   behavior and status/incident history.
3. Data-processing terms: residency, deletion SLAs, subprocessors; account
   deletion API for GDPR-class requests.
4. Recovery flows: what exactly happens on lost email / lost device / lost
   passkey per provider; does any path allow support-only takeover
   (ADR-0010 conflict)?
5. Provider-side session TTLs vs MovenRun session policy; token refresh
   semantics under app background/resume on iOS/Android.
6. Release cadence + deprecation policy for the RN/Expo SDKs; minimum
   supported app version strategy.
7. Webhook key rotation mechanics vs docs/KEY_ROTATION.md overlap windows.

## Post-launch optimization

1. Smart-account (4337) roadmap alignment for gasless Base badges (roadmap
   phase-gated; no paymaster work until its own ADR).
2. Multi-wallet UX improvements (import order, labels) within the one-active-
   wallet invariant.
3. Cost optimization: MAU tiering, webhook volume, wallet-at-rest pricing.
4. Regional expansion constraints and localization of provider-hosted
   surfaces.
