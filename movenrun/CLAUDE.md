# MovenRun — Claude Context

## Strategic direction — the territory economy (read this first)
MovenRun is a **Base-native, GPS-driven territory economy.** The core loop is:

> **Move → Capture → Defend → Own.**

You move through the real world, **capture** H3 hex map tiles, **defend** them,
and — for committed players — **own** them as **Zone Deed NFTs** that can later
earn a **capped** share of the economy. Free users capture common tiles and earn
**XP + Locked MOVE** (non-liquid in-app credits); Deed holders may *later* earn
**capped Liquid MOVE**. Plus land defence, clubs, leaderboards, sponsor zones,
and Base-native city wars / gasless badges.

**This is the real product.** `docs/ROADMAP.md` is the canonical scope doc —
**read it before any product-scope decision.** See also
`docs/CONTRACTS_AUDIT.md` (on-chain assets) and
`docs/MOBILE_TO_TERRITORY_PLAN.md` (how the app gets there).

> ⚠️ **Hard guardrail:** **no liquid reward economy** ships before (1) reliable
> GPS verification, (2) real tile/city density (Phase 1), and (3) genuine
> sponsor/land demand.

## The quest APK is NOT the final product
The app currently in `mobile/` (Expo SDK 51, RN 0.74, Expo Router v3, TS,
Zustand + AsyncStorage) is a **mobile shell**: local mock quests, a
`start → active timer → finish → XP result` flow, XP/levels/streak, and a working
**EAS APK build pipeline**. It exists to prove out build/release and on-device
state — **not** to be the product. We evolve it toward the territory loop; we do
not invest in it as a generic quest/step app.

Quest data goes through `mobile/src/services/questService.ts` (mock data in
`mobile/src/data/quests.ts`) — that service seam is the place to later swap in a
GPS/territory data source. Each quest awards XP at most once per local day.

### Do NOT (unless a roadmap phase explicitly calls for it):
- Add **AI quest features / AI APIs / AI provider keys** — they don't serve the
  territory map loop.
- Add **wallet connection**, **token rewards**, or **liquid MOVE** before GPS
  verification + Phase 1 density.
- Add **Supabase** or other new backend wiring from the app.
- Add **new dependencies** or **payments** casually.
- Build generic quest/step-counter features that don't advance
  **Move → Capture → Defend → Own**.

## Existing assets are important — do not delete or overwrite
The territory economy is **already substantially built**. Treat these as assets:

- **Deployed contracts.** The contract suite is **deployed to Base Sepolia**
  (addresses + tx hashes in `docs/CONTRACTS_AUDIT.md`). **Always audit before
  changing any contract; never re-deploy or overwrite contract code casually.**
- `contracts/`, `backend/`, `shared/`, and `mobile/_legacy/` are **preserved, not
  dead.** **Do not delete them** without explicit owner approval.
- Preserve product ideas by writing them into `docs/ROADMAP.md`, never by
  deleting code.

## Monorepo Layout
- `shared/` — TS types + constants for the territory economy (H3, emission,
  contract address registry, zone/token/gps types).
- `contracts/` — Hardhat + Solidity smart contracts (**deployed to Base
  Sepolia** — see `docs/CONTRACTS_AUDIT.md`).
- `backend/` — Express API + BullMQ workers + Drizzle ORM (GPS, zones, battles,
  hex/oracle/token services).
- `mobile/` — Expo React Native app (currently the quest **shell**).
  - `mobile/app/` — active Expo Router routes (the shell).
  - `mobile/src/` — active shell components, data, store, theme, helpers.
  - `mobile/_legacy/` — **parked** GPS/blockchain mobile scaffold (maps, H3
    overlay, GPS tracking, wallet, zone/battle UI). Reference for the territory
    build; **do not delete or edit in place**.

## Reference docs
- `docs/ROADMAP.md` — **canonical product scope**: the territory economy, current
  shell vs. real direction, and Phases 1–3. Read before scope decisions.
- `docs/CONTRACTS_AUDIT.md` — on-chain assets: contracts, deployed Base Sepolia
  addresses, branch divergence, and the safe next integration step.
- `docs/MOBILE_TO_TERRITORY_PLAN.md` — how the quest shell evolves into the
  territory map loop.
- `docs/ARCHITECTURE.md` — contract interaction diagram and oracle flow.
- `docs/TOKENOMICS.md` — emission schedule and burn sink details.
- `mobile/README.md` — how to run the app.

## Working agreement
- Always work through **feature branches and pull requests** (never commit
  straight to `main`).
- **Audit before changing contracts**; treat the Base Sepolia deployment as a
  production asset.
- Every feature must serve **Move → Capture → Defend → Own**.
- Package manager is **yarn workspaces**.
- App is on **Expo SDK 51**; phone-test via the SDK 51 Android Expo Go + tunnel
  (`mobile/README.md`). Any Expo SDK upgrade is a **separate PR** done where
  `expo install --fix` / `expo-doctor` can run and be device-tested — never an
  unverified bump.
- For installable **Android APK** builds, use the **EAS GitHub Actions workflow**
  (`.github/workflows/eas-apk-build.yml`, preview profile). It authenticates with
  the **`EXPO_TOKEN`** GitHub Actions secret only. Never ask for the Expo
  password, and never commit `EXPO_TOKEN`, Expo tokens, or `.env` files.
  The EAS project must be **linked first** (`eas init` writes a real
  `extra.eas.projectId` into `app.json`); the workflow fails fast on the
  `FILL_ME_IN` placeholder. Never fabricate a `projectId`.
  EAS remote builders may start with **Yarn 1** but the repo pins **Yarn 4**
  (`packageManager`), so an **`eas-build-pre-install": "corepack enable"`** hook
  (in both `movenrun/package.json` and `movenrun/mobile/package.json`) enables
  Corepack before the remote `yarn install`. Keep `nodeLinker: node-modules` in
  `movenrun/.yarnrc.yml`. Don't change `packageManager`.
