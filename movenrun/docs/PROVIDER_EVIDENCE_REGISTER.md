# Provider evidence register — ADR-0011

Every material claim with its source, access date, category, confidence, and
caveat. Categories follow the ADR-0011 source policy. **Nothing in ADR-0011,
the decision matrix, or the integration plan relies on unregistered memory.**

Access date for all rows: **2026-07-19** unless noted.

## A. Verified evidence — official npm registry metadata

Source for all rows in this section: `https://registry.npmjs.org/<package>`
(official vendor-published package metadata; category 6 — official
repositories/release notes). Confidence: **High** for the metadata itself
(versions, publish dates, peer ranges, licenses); these rows say nothing
about capabilities beyond packaging. App baseline compared against:
Expo SDK ~51, react-native 0.74.1, react 18.2.0 (repo `mobile/package.json`).

| # | Vendor | Exact claim | Package | Status | Impact on MovenRun |
|---|---|---|---|---|---|
| A1 | Privy | Dedicated Expo SDK exists and is actively maintained: latest 0.70.3 published 2026-07-15; peers `react-native:*`, `react:*`; Apache-2.0 | `@privy-io/expo` | Explicit | Registry-verifiable part of hard gates 1–2 passes |
| A2 | Privy | Expo native-extensions package active: 0.0.12, 2026-07-02; peers incl. `expo:*` | `@privy-io/expo-native-extensions` | Explicit | Supports A1; native modules exist (custom dev build likely — Unverified, see B) |
| A3 | Privy | Server-side auth SDK exists: `@privy-io/server-auth` 1.32.5, 2025-09-17 | `@privy-io/server-auth` | Explicit | Partial signal for gate 6 (server-verifiable auth) |
| A4 | Dynamic | Client SDK very active: 4.92.4, 2026-07-16, MIT | `@dynamic-labs/client` | Explicit | Maintenance signal |
| A5 | Dynamic | RN extension active: 4.92.4, 2026-07-16; peers `react-native >=0.73.6`, `react >=18 <20` — **satisfied by app's RN 0.74.1 / React 18.2.0** | `@dynamic-labs/react-native-extension` | Explicit | Verified range-compatibility for gate 1 |
| A6 | Web3Auth | RN SDK maintained: 9.0.0, 2026-05-20; peers `react-native:*`, `react>=18`; ISC | `@web3auth/react-native-sdk` | Explicit | Gate 1 registry-part passes; least-recent of the active four |
| A7 | Web3Auth | Core web SDK active: `@web3auth/no-modal` 11.3.0, 2026-07-02 | `@web3auth/no-modal` | Explicit | Maintenance signal |
| A8 | Turnkey | RN SDK active BUT peers **`react-native ^0.76.5`** (1.5.24, 2026-07-16) — app pins 0.74.1, outside the range | `@turnkey/sdk-react-native` | Explicit | **Verified gate-1 FAIL at current baseline**; requires Expo upgrade (protected scope) |
| A9 | Turnkey | Server SDK active: 7.0.0, 2026-07-16 | `@turnkey/sdk-server` | Explicit | Partial gate-6 signal |
| A10 | Coinbase | CDP server SDK active: 1.53.0, 2026-07-16, MIT | `@coinbase/cdp-sdk` | Explicit | Partial gate-6 signal; server-side only |
| A11 | Coinbase | Only mobile package found is the EXTERNAL-wallet SDK, last published **2024-09-10** (stale ~22 months); no embedded-wallet RN SDK found under the official scope in these lookups | `@coinbase/wallet-mobile-sdk` | Explicit (absence: inferred from lookups performed) | Embedded-wallet mobile path Unverified-and-doubtful; gate 1 U |
| A12 | Magic | Dedicated RN/Expo package active: 34.8.1, 2026-07-08; peers `expo:*`, `react-native >=0.60`, `react >=17`; MIT | `@magic-sdk/react-native-expo` | Explicit | Registry-verifiable part of gates 1–2 passes |
| A13 | Magic | Core SDK active: `magic-sdk` 33.9.0, 2026-07-02 | `magic-sdk` | Explicit | Maintenance signal |

Caveat for A1–A13: npm metadata proves packaging and maintenance, not
documented behavior; peer ranges of `*` do not prove Expo SDK 51 support in
docs. Confidence on any capability conclusion drawn from these rows alone:
**Low** beyond maintenance/compatibility-range statements.

## B. Denied sources — the exact missing evidence

Category 1–5 sources attempted on 2026-07-19 and denied by this environment's
egress policy (proxy `connect_rejected` / HTTP 403 at CONNECT; verified in the
proxy relay log — timestamps 15:32:38–15:32:41 UTC). Per policy these were
reported, not routed around. These URLs are the unblock work list:

| # | Vendor | URL attempted | Would verify |
|---|---|---|---|
| B1 | Privy | https://docs.privy.io/basics/react-native/setup | Expo SDK support details (gates 1–2), auth methods, wallet APIs |
| B2 | Privy | https://www.privy.io/pricing | Gate 12 |
| B3 | Privy | https://status.privy.io | Operational transparency |
| B4 | Dynamic | https://docs.dynamic.xyz/react-native/introduction | Gates 1–8 details |
| B5 | Web3Auth | https://web3auth.io/docs/sdk/pnp/react-native | Gates 1–8 details, custody (MPC) model (gate 10) |
| B6 | Turnkey | https://docs.turnkey.com/embedded-wallets/overview | Gates 3–8, 10 (TEE custody) |
| B7 | Coinbase | https://docs.cdp.coinbase.com/embedded-wallets/welcome | Whether an embedded-wallet mobile path exists; gates 2–8 |
| B8 | Magic | https://magic.link/docs/home/welcome | Gates 3–8, 10 |

Also required at unblock (same denial class expected; to be fetched then):
each vendor's security/custody whitepaper, webhook-signature reference,
export/recovery documentation, terms & privacy, and status/incident history —
one register row per material claim, with conflicts resolved per the source
policy (prefer the more specific and recent technical source; lower
confidence; flag for vendor confirmation).

## C. Environment facts

| # | Claim | Source | Confidence |
|---|---|---|---|
| C1 | App baseline is Expo SDK ~51 / react-native 0.74.1 / react 18.2.0 | repo `movenrun/mobile/package.json` | High |
| C2 | Vendor doc/pricing/status hosts are egress-denied from this environment | proxy relay log, 2026-07-19 | High |
| C3 | registry.npmjs.org is reachable (allowlisted) | successful lookups A1–A13 | High |
