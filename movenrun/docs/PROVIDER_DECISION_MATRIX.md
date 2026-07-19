# Provider decision matrix — ADR-0011 (status: Blocked)

Snapshot date: 2026-07-19. Legend: **V** = verified from an official source
(see `PROVIDER_EVIDENCE_REGISTER.md`), **U** = Unverified (official source
denied by the execution environment's egress policy — never inferred),
**F** = verified FAIL at the current app baseline (Expo SDK ~51 /
react-native 0.74.1 / react 18.2.0).

## Hard gates by candidate

| # | Hard gate | Privy | Dynamic | Web3Auth | Turnkey | Coinbase CDP | Magic |
|---|---|---|---|---|---|---|---|
| 1 | Current React Native support | **V** (`@privy-io/expo` 0.70.3, 2026-07-15) | **V** (`@dynamic-labs/react-native-extension` 4.92.4, 2026-07-16) | **V** (`@web3auth/react-native-sdk` 9.0.0, 2026-05-20) | **F** — peer `react-native ^0.76.5` excludes app's 0.74.1 | **U** — no embedded-wallet RN SDK found; `wallet-mobile-sdk` is external-wallet, stale 2024-09 | **V** (`@magic-sdk/react-native-expo` 34.8.1, 2026-07-08) |
| 2 | Credible Expo integration path | V-partial (dedicated expo packages; docs U) | V-partial (RN range fits; Expo docs U) | U (RN peer `*`; Expo path U) | **F** at current baseline | U | V-partial (dedicated expo package; docs U) |
| 3 | Embedded EVM wallets | U | U | U | U | U | U |
| 4 | User-controlled export / portability | U | U | U | U | U | U |
| 5 | No seed/raw-key ingestion required of MovenRun | U | U | U | U | U | U |
| 6 | Server-verifiable authentication | V-partial (`@privy-io/server-auth` active) | U (server pkg not confirmed in lookups) | U | V-partial (`@turnkey/sdk-server` active) | V-partial (`@coinbase/cdp-sdk` active) | V-partial (`magic-sdk` server-usable; details U) |
| 7 | Authenticated webhooks | U | U | U | U | U | U |
| 8 | Base / Base Account compatibility | U | U | U | U | U (expected strong; **not inferred**) | U |
| 9 | Canonical identity stays in MovenRun Postgres | **V by construction** — PR #50 architecture holds for any vendor kept behind the adapters | V | V | V | V | V |
| 10 | No custodial authority incompatible with the boundary | U | U | U | U | U | U |
| 11 | Migration / lock-in controls | U (architecture-side controls V; contractual side U) | same | same | same | same | same |
| 12 | Acceptable current pricing | U | U | U | U | U | U |

**Gate verdict**: no candidate has all 12 gates verified ⇒ selection blocked.
Turnkey additionally carries a verified gate-1 FAIL at the current app
baseline; Coinbase CDP's embedded-wallet mobile path could not be shown to
exist from registry evidence.

## Weighted matrix (template — deliberately not scored to a ranking)

Weights: Security/non-custodial 25 · Mobile/Expo 20 · Auth coverage 15 ·
Wallet/Base 15 · Export/portability 10 · Webhooks/backend 5 · Operational 5 ·
Pricing 5. Scores 0–5 with separate capability, confidence, and risk
adjustment.

Only the Mobile/Expo dimension has evidence sufficient for honest sub-scores
(capability from verified package state; confidence reflects that docs remain
unverified):

| Candidate | Mobile/Expo capability (0–5) | Confidence | Basis |
|---|---|---|---|
| Privy | 4 | Medium | Dedicated, active Expo packages (published 2026-07-15/02); Apache-2.0; docs U |
| Dynamic | 4 | Medium | Active RN extension (2026-07-16); verified RN-range fit; docs U |
| Magic | 3 | Medium | Active Expo package (2026-07-08); broad ranges; docs U |
| Web3Auth | 3 | Low-Med | Maintained (2026-05-20) but less current; Expo path U |
| Coinbase CDP | 1 | Medium | No embedded-wallet RN SDK found; mobile pkg stale + wrong capability |
| Turnkey | 0 at current baseline | High | Verified peer-range incompatibility (RN ^0.76.5 vs 0.74.1) |

All other dimensions: **not scored** — with custody, export, webhooks, Base,
and pricing Unverified for every candidate, a composite ranking would let SDK
freshness masquerade as a security judgment. The full matrix is filled in at
unblock, one evidence-register row per cell.

## Strengths / weaknesses / unverified claims (registry-evidence only)

- **Privy** — Strengths: freshest dedicated Expo SDK; active server-auth
  package. Weaknesses: none registry-visible. Unverified: everything on
  gates 3–8, 10–12.
- **Dynamic** — Strengths: very active; verified RN-range fit; MIT client.
  Weaknesses: server-side package not confirmed in the lookups performed.
  Unverified: gates 3–8, 10–12.
- **Web3Auth** — Strengths: maintained major-version RN SDK. Weaknesses:
  least-recent publish among the active four; Expo-specific path unconfirmed.
  Unverified: gates 3–8, 10–12.
- **Turnkey** — Strengths: very active RN + server SDKs. Weaknesses:
  **verified RN 0.76.5+ requirement — unusable without an Expo upgrade PR
  (protected scope)**. Unverified: gates 3–8, 10–12.
- **Coinbase CDP** — Strengths: active server SDK; presumptive Base alignment
  (**not inferred into gate 8**). Weaknesses: embedded-wallet mobile SDK not
  found; only mobile package is stale and external-wallet-oriented.
  Unverified: gates 2–8, 10–12.
- **Magic** — Strengths: active dedicated Expo package. Weaknesses: none
  registry-visible. Unverified: gates 3–8, 10–12.

## Recommendation

Selection **Blocked**. When documentation egress is available, evaluate in
this effort order: Privy, Dynamic → Magic, Web3Auth → Coinbase CDP (first
prove the embedded-wallet mobile path exists) → Turnkey (only alongside an
approved Expo-upgrade decision). This ordering allocates evaluation effort
and is **not** a selection.
