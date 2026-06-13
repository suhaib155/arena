# MovenRun — Roadmap

This document is the **canonical product-scope source** for MovenRun. It exists so
that `CLAUDE.md` can stay short and so future sessions do not drift away from the
real product.

> **Read this before making any product-scope decision.** If a change does not
> serve the territory economy loop below, it is almost certainly out of scope.

---

## 0. The real product in one line

**MovenRun is a Base-native, GPS-driven territory economy.**

> **Core loop: Move → Capture → Defend → Own.**

You move through the real world, capture map territory (H3 hex zones), defend it
against other players, and — for committed players — *own* it as a Zone Deed NFT
that can later earn a capped share of the economy.

This is **not** a generic quest/step-counter app. The quest screens currently in
the APK are a **mobile shell** used to prove out the build/release pipeline, not
the product.

---

## A. Current state — APK-running mobile shell

What actually ships and runs today:

- A **running Android APK** (Expo SDK 51, React Native 0.74, Expo Router v3,
  TypeScript, Zustand + AsyncStorage).
- **Local mock quests** — a daily quest + browsable list, served through a
  service seam (`mobile/src/services/questService.ts`, backed by
  `mobile/src/data/quests.ts`).
- A **start → active timer → finish → XP result** flow.
- **XP, levels, and a daily streak**, persisted on-device, with
  once-per-local-day anti-farming.
- A **profile/streak** screen.
- An **EAS APK build pipeline** (GitHub Actions, preview profile, authenticated
  via the `EXPO_TOKEN` secret).

**Status:** this is a *shell*. It validates that we can build, sign, and install
an APK and that the on-device state/XP plumbing works. It does **not** implement
the territory economy. Treat it as the scaffold we evolve, not the destination.

---

## B. Real product direction — the territory economy

The full product MovenRun is building toward:

- **Move → Capture → Defend → Own** as the core loop.
- **Real-world GPS movement** as the only way to act on the map.
- **H3 territory map** — the world is tiled into H3 hexes (resolution 8,
  ~0.74 km² each; see `shared/src/constants/h3.ts`).
- **Common tiles** — free users capture common zones by moving through them.
- **XP + Locked MOVE** — free users earn XP and **Locked MOVE** (a non-liquid,
  in-app credit), never liquid tokens.
- **Zone Deed NFTs** — committed ("Deed") users own zones as on-chain deeds
  (the `ZoneNFT` contract).
- **Deed holder economy** — Deed holders may *later* earn **capped Liquid MOVE**
  (a share of activity in their zone), gated behind real density and demand.
- **Land defence** — owned zones can be challenged and must be defended
  (the `ZoneChallenge` 14-day battle system).
- **Sponsor zones** — sponsors can back specific zones/areas.
- **Clubs & leaderboards** — social teams, streak and zone rankings, city wars.
- **Base-native growth** — gasless badges, city wars, on-chain identity, all on
  Base / Base Sepolia.

**Hard guardrail:** **no liquid reward economy** ships before we have (1) reliable
GPS verification, (2) real city/tile density, and (3) genuine sponsor/land
demand. Locked MOVE and capped Liquid MOVE are deliberately separated for this
reason.

---

## C. Phase 1 — Free Map Beta

Goal: prove the **Move → Capture** half of the loop with zero real-money risk.

- **GPS route tracking** — capture real walk/run/cycle routes on device.
- **H3 / common-tile capture simulation** — convert a route into the H3 hexes it
  passed through; let free users "capture" common tiles.
- **XP and Locked MOVE as offchain / in-app credits only** — stored locally or in
  a mock backend.
- **No liquid rewards. No real token emissions. No real earning/claims.**
- **No mainnet, no wallet requirement** for the basic capture loop.
- **Local or mock backend first** — do not wire real infrastructure yet.

Exit criteria: routes reliably map to tiles, capture feels good, density data
starts accumulating.

---

## D. Phase 2 — Deed Testnet

Goal: prove the **Defend → Own** half of the loop against **testnet** contracts.

- **Connect existing deployed / testnet contracts** where available (the
  Base Sepolia deployment — see `docs/CONTRACTS_AUDIT.md`). ✅ A **read-only**
  backend client now exists (`backend/src/blockchain/`): RPC-via-env, no signer/
  wallet/writes, no new dependency. Next app step:
  `feat(mobile): add read-only Base Sepolia contract status preview`.
- **Show owned deeds** — read `ZoneNFT` ownership for the connected user.
- **Simulate land defence** — surface the `ZoneChallenge` battle flow.
- **Simulate the Locked / Liquid MOVE reward split** — UI and math only, on
  testnet values.
- **No mainnet economics.** Nothing here moves real value.

Exit criteria: a user can see a deed, see a challenge, and understand the
reward-split model — all on testnet.

---

## E. Phase 3 — Mainnet City Launch

Goal: launch the real economy in a first city, only once Phases 1–2 are proven.

- **Real Zone Deeds** minted on Base mainnet.
- **Capped reward pools** — capped Liquid MOVE emissions, bounded by the
  tokenomics in `docs/TOKENOMICS.md`.
- **First sponsors** — paid sponsor zones.
- **Premium tools** — paid features for committed players / Deed holders.
- **Marketplace fees** — deed trading and associated fees.

Exit criteria for *entering* this phase: GPS verification is reliable, at least
one city has real tile density, and there is real sponsor/land demand.

---

## Repo assets that already exist

These back the territory economy and **must not be deleted**:

- `contracts/` — Hardhat + Solidity: `MoveToken`, `GPSOracle`, `ZoneNFT`,
  `GearNFT`, `ZoneChallenge`, `SeasonController`, `MoveVault`, `MovenDAO`.
  **Already deployed to Base Sepolia**; the deployed source, the deployment
  record (`contracts/deployments/baseSepolia.json`), and the populated
  `shared/src/constants/contracts.ts` address registry are all on `main` — see
  `docs/CONTRACTS_AUDIT.md`.
- `backend/` — Express API + BullMQ workers + Drizzle ORM: GPS, zones, battles,
  hex/oracle/token services.
- `shared/` — shared types + constants: H3 resolution, emission schedule,
  contract address registry, zone/token/gps types.
- `mobile/_legacy/` — the earlier GPS/blockchain mobile scaffold (maps, H3
  overlay, GPS tracking, wallet, token/zone/battle UI). Parked, not dead. See
  `mobile/_legacy/README.md`.
- `docs/ARCHITECTURE.md`, `docs/TOKENOMICS.md` — contract/oracle flow and
  emission/burn details.
- `docs/CONTRACTS_AUDIT.md`, `docs/MOBILE_TO_TERRITORY_PLAN.md` — the audit and
  the shell→territory evolution plan.

### Legacy technical decisions (still valid)

- **MoveToken** — ERC-20 $MOVE, 1B supply, oracle-gated minting, halving.
- **ZoneNFT** — ERC-721, tokenId = H3 hex ID, 2% zone tax, dormancy system.
  This is the **Zone Deed**.
- **GearNFT** — ERC-1155, gear with stat multipliers.
- **ZoneChallenge** — 14-day battle / land-defence system.
- **SeasonController** — 90-day seasons, Great Burn, Keeper.
- **MoveVault** — staking, protocol-owned liquidity, treasury.
- **MovenDAO** — 3-tier governance.
- **H3 resolution 8** hexagons, Base chain.

---

## Working agreement

- Always work through **feature branches and pull requests** (never commit
  straight to `main`).
- **Audit before changing contracts.** Treat deployed contracts as production
  assets (see `docs/CONTRACTS_AUDIT.md`).
- Every new feature must serve **Move → Capture → Defend → Own**. If it doesn't,
  it's out of scope.
- **No liquid rewards before Phase 1 density + GPS verification.**
- Preserve legacy work by moving ideas into this roadmap — never by deleting
  `mobile/_legacy/`, `contracts/`, `backend/`, or `shared/`.
- Package manager is **yarn workspaces**; the app is on **Expo SDK 51**. Any SDK
  upgrade is its own device-tested PR. APKs build via the EAS GitHub Actions
  workflow.
