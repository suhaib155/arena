# MovenRun — Claude Context

## Current direction — AI Movement Quest MVP
The **active app** is a lightweight **AI movement-quest** app: a daily movement
quest, a start → active timer → finish → XP-result flow, plus XP/levels and a
daily streak. It lives in `mobile/` (Expo SDK 51, React Native 0.74, **Expo
Router v3**, TypeScript, Zustand + AsyncStorage). Quests come from local mock
data (`mobile/src/data/quests.ts`).

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
