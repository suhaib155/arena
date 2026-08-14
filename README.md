# MovenRun

**Move → Capture → Defend → Own.**

MovenRun is a GPS-driven territory game for the real world. You walk, run, or
cycle; the ground you cover becomes map territory you capture, defend, and — in
the designed end state — own as an on-chain **Zone Deed** on [Base](https://base.org).

This repository is the MovenRun monorepo: the mobile app, the API and workers,
the Solidity contract suite, the shared type/constant layer, the marketing site,
and the documentation portal.

[![mobile-checks](https://github.com/suhaib155/arena/actions/workflows/mobile-checks.yml/badge.svg)](https://github.com/suhaib155/arena/actions/workflows/mobile-checks.yml)
[![backend-checks](https://github.com/suhaib155/arena/actions/workflows/backend-checks.yml/badge.svg)](https://github.com/suhaib155/arena/actions/workflows/backend-checks.yml)
[![contracts-checks](https://github.com/suhaib155/arena/actions/workflows/contracts-checks.yml/badge.svg)](https://github.com/suhaib155/arena/actions/workflows/contracts-checks.yml)

---

## Status: development-stage

MovenRun is under active development. Nothing in this repository is a launched
product, and no part of it moves real money.

| Area | What is true today |
| --- | --- |
| Mobile app | Runs on Android via Expo Go and as an EAS-built APK. Real foreground GPS sessions, on-device territory simulation, account sign-in against the identity API. Everything economic is a clearly labelled preview. |
| Territory | Simulated **on-device** on a local ~300 m hex lattice. Real H3 indexing (resolution 8) is defined in `shared/` but not yet wired into the app. |
| Backend | Express API + BullMQ workers + Drizzle/Postgres schema, with an identity/wallet foundation and a **read-only** Base client. No hosting or deployment configuration is committed here — it runs locally. |
| Contracts | Eight Solidity contracts, compiled and tested in CI, **deployed to Base Sepolia (testnet) only**. No mainnet deployment exists. |
| $MOVE token | **Does not exist as a tradable asset.** `MoveToken` is a testnet ERC-20. "Locked MOVE" in the app is an in-app progress display derived from XP — not a balance, not a payout, not redeemable. |
| Zone Deeds | Preview UI only. `ZoneNFT` exists on testnet, but no minting flow ships in the app and the showroom is educational. |
| Wallets | The app performs **no signing, no transfers, and no chain writes**. The network screen displays public testnet addresses read-only. |

Guardrail we hold ourselves to: **no liquid reward economy ships** before
(1) reliable GPS verification, (2) real tile/city density, and (3) genuine
sponsor or land demand. See [`movenrun/docs/ROADMAP.md`](movenrun/docs/ROADMAP.md).

---

## Repository structure

Everything ships from the `movenrun/` Yarn workspaces root; only CI lives above
it. (The repository is named `arena` for historical reasons — the product is
MovenRun.)

```
.
├── .github/workflows/          CI: mobile, backend, contracts checks + EAS APK build
├── CONTRIBUTING.md             Working agreement, branch/PR rules, local checks
├── SECURITY.md                 How to report a vulnerability; what is never committed
└── movenrun/                   Yarn 4 workspaces root (yarn.lock lives here)
    ├── package.json            Workspace definitions + repo-wide scripts
    ├── CLAUDE.md               Context file for AI coding sessions
    ├── docs/                   Engineering + product documentation (Markdown)
    │   ├── ROADMAP.md          Canonical product scope — read before scope decisions
    │   ├── ARCHITECTURE.md     Contract interaction diagram + oracle flow
    │   ├── TOKENOMICS.md       Emission schedule, caps, burn sinks
    │   ├── CONTRACTS_AUDIT.md  On-chain asset audit + Base Sepolia deployment record
    │   ├── CONTRACT_V1_DISCREPANCIES.md
    │   ├── IDENTITY_WALLET_FOUNDATION.md
    │   ├── SECURITY_CHECKLIST.md, THREAT_MODEL.md, KEY_ROTATION.md
    │   ├── MOBILE_TO_TERRITORY_PLAN.md
    │   ├── PROVIDER_*.md       Auth/wallet provider evaluation (decision open)
    │   └── adr/                Architecture Decision Records 0001–0013
    ├── shared/                 @movenrun/shared — types + constants (H3, emission, addresses)
    ├── contracts/              @movenrun/contracts — Hardhat + Solidity + deployment records
    ├── backend/                @movenrun/backend — Express API, workers, Drizzle, identity
    ├── mobile/                 @movenrun/mobile — Expo React Native app
    └── website/                Static landing page + documentation portal (no build step)
```

### `shared/` — the common vocabulary

TypeScript types and constants both the backend and contracts tooling depend on:
H3 resolution and dormancy thresholds (`constants/h3.ts`), the emission schedule
and challenge costs (`constants/emission.ts`), the deployed contract address
registry (`constants/contracts.ts`), and the zone/token/GPS types.

### `contracts/` — the on-chain layer

Hardhat + Solidity (OpenZeppelin 5), deployed to **Base Sepolia** only. Addresses
and transaction hashes are recorded in `contracts/deployments/baseSepolia.json`
and mirrored into `shared/src/constants/contracts.ts`.

| Contract | Standard | Purpose |
| --- | --- | --- |
| `MoveToken` | ERC-20 | $MOVE. 1B supply cap, oracle-gated minting, halving emission. |
| `GPSOracle` | — | Verifies backend-signed GPS route proofs; gates every movement-derived mint. |
| `ZoneNFT` | ERC-721 | The Zone Deed. `tokenId` = H3 hex id, 2% zone tax, dormancy/reclaim. |
| `GearNFT` | ERC-1155 | Gear items with stat multipliers. |
| `ZoneChallenge` | — | 14-day land-defence battles over owned zones. |
| `SeasonController` | — | 90-day seasons, weekly keeper run, Great Burn. |
| `MoveVault` | — | Staking, protocol-owned liquidity, treasury. |
| `MovenDAO` | — | Three-tier governance. |

CI compiles the suite and runs the full test directory — unit, integration, V1
characterization, and deployment-command safety tests — on every touching PR.
No deployment ever runs in CI: there is no deployer key, RPC secret, or
Basescan key in the workflows.

### `backend/` — API, workers, identity

Node 20 + Express 4 + TypeScript (ESM), Zod-validated config, Helmet security
headers, an explicit CORS allowlist that fails closed in production, and layered
rate limits.

- **Domain routes** — `/gps`, `/zones`, `/battles`, `/users`, backed by
  hex (h3-js), route, GPS, oracle, and token services.
- **Identity & wallet foundation** — `/identity`: email-OTP authentication,
  session/refresh-token lifecycle, wallet linking and active-wallet switching,
  provider-neutral wallet provisioning, replay-safe webhook ingestion with HMAC
  verification, and an audit trail. Public response views are built so internal
  fields and secrets cannot leak. Spec: `backend/openapi/identity-v1.yaml`.
- **Blockchain module** (`src/blockchain/`) — **read-only**. RPC URL from env,
  no signer, no wallet, no writes.
- **Workers** — BullMQ: `gps.worker.ts` (route validation) and
  `keeper.worker.ts` (season/keeper cadence).
- **Persistence** — Drizzle ORM against Postgres, with committed migrations
  under `backend/drizzle/`.

Design notes live in `docs/IDENTITY_WALLET_FOUNDATION.md`, the ADRs, and
`docs/SECURITY_CHECKLIST.md` (control → implementation → test mapping).

### `mobile/` — the app

Expo SDK 51 / React Native 0.74 / Expo Router v3 / TypeScript (strict), Zustand
state persisted to AsyncStorage, tokens held in `expo-secure-store`, movement
tracked with `expo-location` (foreground only).

Account-first onboarding (email OTP, or an explicit local-only beta path),
GPS movement sessions with signal-quality and route-trust review, on-device zone
capture/defend/fortify with deterministic decay, clubs and city districts,
collections and season objectives, a route passport and shareable route proof,
a Zone Deed preview showroom, and a read-only Base Sepolia network status
screen. Full detail and the run/build instructions:
[`movenrun/mobile/README.md`](movenrun/mobile/README.md).

Honesty rules the app enforces in code: demo routes are never saved or
rewarded, previews are labelled as previews, no raw GPS ever leaves the device,
and "Locked MOVE" is always shown as in-app progress rather than a payout.

`mobile/_legacy/` holds the earlier GPS/blockchain scaffold, parked out of the
build as reference material.

### `website/` — landing page + docs portal

Static HTML/CSS/JS with no build step and no JS dependencies: a scroll-driven
marketing page plus a self-contained documentation portal (product, technology,
roadmap, glossary, FAQ, risk factors, legal, and a printable whitepaper) with
client-side search and original SVG diagrams. Deployed on Vercel with
`movenrun/website` as the project root. See
[`movenrun/website/README.md`](movenrun/website/README.md).

---

## Getting started

**Prerequisites:** Node.js 20, Corepack (ships with Node), Git. Postgres and
Redis only if you run the backend or its workers.

```bash
git clone https://github.com/suhaib155/arena.git
cd arena/movenrun
corepack enable          # provisions the pinned Yarn 4.9.1
yarn install
```

The package manager is pinned by `package.json` → `packageManager`, and
`scripts/verify-package-manager.mjs` fails the build if the running Yarn does not
match. Use Yarn 4 — not npm, not pnpm, not Yarn 1.

### Common commands

All commands run from `movenrun/`.

| Task | Command |
| --- | --- |
| Start the app (Expo) | `yarn workspace @movenrun/mobile start` |
| Start the app for a phone on another network | `yarn workspace @movenrun/mobile start --tunnel --clear` |
| Type-check the app | `yarn workspace @movenrun/mobile lint` |
| Test the app (offline node tests) | `yarn workspace @movenrun/mobile test` |
| Run the API in watch mode | `yarn workspace @movenrun/backend dev` |
| Type-check the API | `yarn workspace @movenrun/backend typecheck` |
| Test the API | `yarn workspace @movenrun/backend test` |
| Compile contracts | `yarn workspace @movenrun/contracts compile` |
| Test contracts | `yarn workspace @movenrun/contracts test` |
| Compile + test contracts | `yarn verify:contracts` |
| Serve the website | `cd website && python3 -m http.server 8080` |

Backend and contracts each ship a `.env.example`. Copy it to `.env` and fill in
your own values; `.env` files are git-ignored and must never be committed.

### Android APK

`.github/workflows/eas-apk-build.yml` builds an installable APK through EAS
Build (preview profile), triggered manually from the Actions tab. It uses
exactly one GitHub Actions secret, `EXPO_TOKEN`, and no others. Step-by-step
instructions are in [`movenrun/mobile/README.md`](movenrun/mobile/README.md).

---

## Continuous integration

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `mobile-checks` | every PR, pushes to `main` | Type-check + offline tests for the app |
| `backend-checks` | PRs touching backend/shared/deployments | Type-check + tests for the API |
| `contracts-checks` | PRs touching contracts/shared | Compile + full Hardhat test suite |
| `eas-apk-build` | manual (`workflow_dispatch`) | Android APK via EAS Build |

Every workflow installs with `yarn install --immutable`, runs with
`permissions: contents: read`, and never pushes, comments, or publishes. Only
the APK workflow uses a secret.

---

## Documentation

- **Product scope** — [`docs/ROADMAP.md`](movenrun/docs/ROADMAP.md): the
  territory economy, the current state, and Phases 1–3.
- **Architecture** — [`docs/ARCHITECTURE.md`](movenrun/docs/ARCHITECTURE.md) and
  [`docs/TOKENOMICS.md`](movenrun/docs/TOKENOMICS.md).
- **On-chain assets** —
  [`docs/CONTRACTS_AUDIT.md`](movenrun/docs/CONTRACTS_AUDIT.md) and
  [`docs/CONTRACT_V1_DISCREPANCIES.md`](movenrun/docs/CONTRACT_V1_DISCREPANCIES.md).
- **Identity & wallets** —
  [`docs/IDENTITY_WALLET_FOUNDATION.md`](movenrun/docs/IDENTITY_WALLET_FOUNDATION.md)
  plus [ADRs 0001–0013](movenrun/docs/adr/).
- **Security** — [`docs/THREAT_MODEL.md`](movenrun/docs/THREAT_MODEL.md),
  [`docs/SECURITY_CHECKLIST.md`](movenrun/docs/SECURITY_CHECKLIST.md),
  [`docs/KEY_ROTATION.md`](movenrun/docs/KEY_ROTATION.md).
- **Public docs portal** — `movenrun/website/docs/` (product, technology,
  roadmap, glossary, FAQ, risks, legal, whitepaper).

---

## Security and privacy posture

- **No secrets in the repository.** No `.env` files, private keys, API tokens, or
  credentials are committed, and none are printed by CI. The only CI secret is
  `EXPO_TOKEN`.
- **Non-custodial by design.** The backend never holds a user seed phrase,
  private key, or recovery secret (ADR-0008).
- **Location data stays on the device.** The app tracks GPS in the foreground
  only, during an explicit session; raw points and route paths are not uploaded.
- **Fail-closed defaults.** Production startup rejects a missing or wildcard CORS
  allowlist; provider surfaces refuse to run on incomplete configuration; webhook
  ingestion verifies signatures on raw bytes before parsing.
- **Testnet only.** The deployed contracts are on Base Sepolia. Their addresses
  are public testnet information and are committed deliberately.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

---

## Contributing

Work happens on feature branches and pull requests — never directly on `main`.
See [CONTRIBUTING.md](CONTRIBUTING.md) for the working agreement, local checks,
commit conventions, and the rules around contracts and dependencies.

---

## Disclaimers

MovenRun is a development-stage product. This repository and its documentation
describe intended design and are forward-looking: features, parameters, and
timing may change, and described functionality may not yet exist.

Nothing here is financial, investment, legal, or tax advice, an offer or
solicitation, or a promise of profit, income, or return of any kind. Zone Deeds
and territory are in-game digital assets — not real-world land, real estate, or
any legal property right. MovenRun is a game that encourages movement; it is not
a medical service and gives no medical advice. Move only where it is safe and
legal to do so.

© 2026 MovenRun. All rights reserved.
