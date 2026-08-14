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

## The app today: Free Map Beta (Phase 1) — the economy is NOT live
The app in `mobile/` (Expo SDK 51, RN 0.74, Expo Router v3, TS, Zustand +
AsyncStorage, `expo-secure-store`, `expo-location`) implements the **Move →
Capture** half of the loop for real, and previews the rest:

- **Real:** account-first first run (email OTP against the identity API, plus a
  local-beta path), foreground GPS sessions with trust/signal review, XP levels
  and streaks, and an **EAS APK build pipeline**.
- **Simulated on-device:** territory. Routes quantize onto a local ~300 m hex
  lattice (`mobile/src/lib/zones.ts`) — **not real H3 yet** — with capture/
  defend/fortify/decay in `mobile/src/lib/territory.ts`. Clubs, rivals,
  districts, city wars, sponsor/event zones are seeded local previews.
- **Preview only:** Locked MOVE (XP-derived display figure), the Zone Deed
  showroom, and a read-only Base Sepolia contract status screen.
- **Absent by design:** wallet signing, minting, transfers, chain writes, RPC
  calls from the app, background location, raw-GPS upload.

Rules that keep this honest and must not be weakened: demo routes never award
progress or save territory; anything simulated is labelled in the UI, not just in
comments; gameplay rules live in pure modules under `mobile/src/lib/` so they are
testable offline.

Quest data goes through `mobile/src/services/questService.ts` (mock data in
`mobile/src/data/quests.ts`). Each quest awards XP at most once per local day.

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
  hex/oracle/token services) plus the identity/wallet foundation and a
  **read-only** Base client.
- `mobile/` — Expo React Native app (the Free Map Beta).
  - `mobile/app/` — active Expo Router routes.
  - `mobile/src/` — components, services, stores, theme, and the pure rule
    modules in `src/lib/` (with offline tests in `src/lib/__tests__/`).
  - `mobile/_legacy/` — **parked** GPS/blockchain mobile scaffold (maps, H3
    overlay, GPS tracking, wallet, zone/battle UI). Reference for the territory
    build; **do not delete or edit in place**.
- `website/` — static landing page + documentation portal (no build step).

## Reference docs
- `docs/ROADMAP.md` — **canonical product scope**: the territory economy, the
  current Free Map Beta state, and Phases 1–3. Read before scope decisions.
- `docs/CONTRACTS_AUDIT.md` — on-chain assets: contracts, deployed Base Sepolia
  addresses, branch divergence, and the safe next integration step.
- `docs/MOBILE_TO_TERRITORY_PLAN.md` — how the app evolves into the full
  territory map loop.
- `docs/ARCHITECTURE.md` — contract interaction diagram and oracle flow.
- `docs/TOKENOMICS.md` — emission schedule and burn sink details.
- `docs/IDENTITY_WALLET_FOUNDATION.md` + `docs/adr/` — identity/wallet design.
- `mobile/README.md` — what the app actually is, how to run and build it.
- Repo-level: `README.md`, `CONTRIBUTING.md`, `SECURITY.md` at the repo root.

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
