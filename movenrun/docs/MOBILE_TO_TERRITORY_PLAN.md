# Mobile → Territory: how the APK shell evolves

This document explains how the **current APK shell** grows into the **territory
economy** described in `docs/ROADMAP.md`. It is a sequencing plan, not a
commitment to ship everything at once. Each step is its own branch + PR.

> **Mental model:** the quest/profile screens are scaffolding. We don't throw
> them away — we reuse the session flow, XP/state plumbing, and the
> `questService` seam, and bend them toward **Move → Capture → Defend → Own.**

---

## Where we are today

`mobile/` (Expo SDK 51, Expo Router v3) is a **quest/profile shell**:

- Daily quest + quest list (`mobile/src/services/questService.ts` over mock data).
- `start → active timer → finish → XP result` session flow
  (`mobile/app/active.tsx`, `mobile/app/result.tsx`, `mobile/app/quest/`).
- XP / level / streak in a Zustand + AsyncStorage store.
- Profile/streak screen under `mobile/app/(tabs)/`.

There is also a **parked** GPS/blockchain scaffold in `mobile/_legacy/` (maps, H3
overlay, `useGPS`, wallet, token/zone/battle UI). It is a **reference** for the
steps below — **do not edit it in place**; lift patterns from it into new active
code when the time comes.

---

## The evolution path

### Step 0 — (this PR) Realign docs
Document the real direction so we stop drifting toward a generic quest app.
No app behavior changes.

### Step 1 — GPS session screen
Replace the abstract "quest timer" with a **real movement session**.

- Add a GPS session screen that records the user's route while moving (reuse the
  `start → active → finish` flow that already exists).
- Reference `mobile/_legacy/hooks/useGPS.ts` for the tracking pattern.
- Output: a recorded route (array of coordinates + distance + duration).
- Still **local only.** No backend, no chain, no tokens.

### Step 2 — Route summary
Turn a finished session into a **route summary** (reuse the `result.tsx` pattern).

- Show distance, duration, pace, and the path on a simple map/preview.
- Award XP for the session (the existing XP/streak store already does this).
- Still local only.

### Step 3 — H3 tile simulation
Introduce the **map/territory** concept without any economy.

- Convert a recorded route into the **H3 hexes** it passed through
  (resolution 8 — see `shared/src/constants/h3.ts`).
- Render those tiles on the map. This is the visual foundation of the territory.
- Pure client-side simulation; no ownership yet.

### Step 4 — Capture / defend UI
Add the **Move → Capture → Defend** loop as simulated state.

- "Capture" common tiles the user moved through; show captured vs. uncaptured.
- Introduce **Locked MOVE** + XP as **in-app credits only** (offchain).
- Add a basic **defence** concept (a tile can be contested) — UI/state only,
  mirroring the `ZoneChallenge` model conceptually.
- **No liquid rewards, no real tokens, no wallet.** (This is Phase 1 in the
  roadmap.)

### Step 5 — Connect backend / contracts (later)
Only once the simulated loop is proven and density exists (Phase 2):

- Wire a **mock or local backend** first, then the real `backend/` GPS/zones/
  battles endpoints.
- Add **read-only testnet** integration: show owned **Zone Deeds** (`ZoneNFT`)
  and `ZoneChallenge` state from **Base Sepolia** (see `docs/CONTRACTS_AUDIT.md`).
- Simulate the **Locked / Liquid MOVE split** on testnet values.
- Wallet connection, real claims, and mainnet economics come **after** this, in
  Phase 3 — never before GPS verification + density.

---

## Guardrails for every step

- Each step must serve **Move → Capture → Defend → Own**. Generic quest/step
  features that don't are out of scope.
- **No liquid rewards, real token emissions, or claims** before Phase 1 density
  and reliable GPS verification.
- **No wallet, no AI APIs, no Supabase** until the relevant phase explicitly
  calls for them.
- Don't edit `mobile/_legacy/` in place — reuse its patterns in new code.
- Keep the existing **EAS APK pipeline** working so every step stays installable.
