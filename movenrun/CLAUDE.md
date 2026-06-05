# MovenRun — Claude Context

## Current direction — AI Movement Quest MVP
The **active app** is a lightweight **AI movement-quest** app: a daily movement
quest, a start → active timer → finish → XP-result flow, plus XP/levels and a
daily streak. It lives in `mobile/` (Expo SDK 51, React Native 0.74, **Expo
Router v3**, TypeScript, Zustand + AsyncStorage).

**Quest data goes through `mobile/src/services/questService.ts`** (backed by mock
data in `mobile/src/data/quests.ts`) — screens never import raw quest arrays.
This is the seam for future **server-side, AI-generated** quests; do not bypass
it, and never put AI provider keys in the app. Each quest awards XP at most once
per local day (completed-today anti-farming).

The full product plan — both this MVP and the preserved legacy direction — is in
**`docs/ROADMAP.md`**. Read it before making product-scope decisions.

### Until the basic app is stable, do NOT add:
- Real AI API calls or any AI provider keys in the app.
- Wallet / blockchain / token logic.
- Supabase or other backend wiring from the mobile app.
- Payments.

Keep the MVP simple and working first.

## Preserved legacy direction — GPS / Blockchain / Move-to-Earn
The original concept (GPS move-to-earn territory protocol on Base chain: H3 hex
zones, $MOVE token, Zone NFTs, 14-day battles, Chainlink oracle) is **preserved,
not abandoned**. Its details and future integration plan live in
`docs/ROADMAP.md`. The earlier mobile code is parked in **`mobile/_legacy/`**
(see `mobile/_legacy/README.md`); contracts/backend/shared work remains in
`contracts/`, `backend/`, `shared/`.

> ⚠️ **Do not delete the legacy code** (`mobile/_legacy/`, or the GPS/blockchain
> work in `contracts/` / `backend/`) unless the owner explicitly requests it.
> Preserve old product ideas by moving them into `docs/ROADMAP.md`, never by
> deleting them.

## Monorepo Layout
- `shared/` — TypeScript types and constants used by all packages (legacy/Web3).
- `contracts/` — Hardhat + Solidity smart contracts (legacy/Web3).
- `backend/` — Express API + BullMQ workers + Drizzle ORM (legacy/Web3).
- `mobile/` — Expo React Native app.
  - `mobile/app/` — **active** Expo Router routes (the AI movement-quest MVP).
  - `mobile/src/` — **active** MVP components, data, store, theme, helpers.
  - `mobile/_legacy/` — **parked** GPS/blockchain mobile scaffold (excluded from
    the MVP build; do not delete).

## Reference docs
- `docs/ROADMAP.md` — active vs. legacy direction and future integrations.
- `docs/ARCHITECTURE.md` — legacy contract interaction diagram and oracle flow.
- `docs/TOKENOMICS.md` — legacy emission schedule and burn sink details.
- `mobile/README.md` — how to run the MVP app.

## Working agreement
- Always work through **feature branches and pull requests** (never commit
  straight to `main`).
- Keep the MVP simple and working before adding future integrations.
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
