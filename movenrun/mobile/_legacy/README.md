# `mobile/_legacy/` — Preserved GPS / Blockchain mobile scaffold

> ⚠️ **Do not delete this directory without explicit owner approval.** It is
> intentionally parked, not dead code. See `../../docs/ROADMAP.md`.

## What this contains

The earlier MovenRun mobile scaffold for the **GPS-based move-to-earn territory
protocol** (the original product direction). It was built around React
Navigation-style screens and Web3/GPS tooling:

```
_legacy/
  components/   TokenBalance, BattleCard, ZoneHex, MoveTracker
  hooks/        useGPS, useChain (Privy), useToken, useZone
  store/        Zustand store for tracking / wallet / zones / battles
  screens/      MapScreen, ZoneScreen, EarnScreen, BattleScreen, ProfileScreen
```

It depends on libraries that the MVP no longer ships: Privy wallet
(`@privy-io/expo`), `ethers`, `react-native-maps`, `h3-js`, `expo-location`,
`expo-task-manager`, and the `@movenrun/shared` workspace types (`Zone`,
`ZoneChallenge`, `GPSPoint`, …).

## Why it was moved out of the active app

The active mobile app pivoted to a simpler **AI movement-quest MVP** (Expo
Router file-based routing under `mobile/app/`, mock quest data, on-device XP /
streak). To get that MVP booting and type-checking cleanly:

- These files were moved from `mobile/src/` into `mobile/_legacy/`.
- `mobile/_legacy/` is **excluded** from the app's `tsconfig.json` and is **not**
  reachable by the Expo Router runtime (only `mobile/app/` defines routes), so it
  does not affect the MVP build.
- The MVP `package.json` was slimmed to MVP dependencies, so the legacy
  Web3/GPS dependencies above are **not currently installed**.

Nothing here was rewritten or deleted — it is the original code, relocated.

## How it could be reused later

This is the starting point for the future GPS / wallet / rewards module (see the
"Future possible integrations" section of `docs/ROADMAP.md`). To revive a piece:

1. Re-add the needed dependencies to `mobile/package.json` (and rebuild
   `@movenrun/shared` if you use its types).
2. Move the relevant file(s) back into `mobile/src/` (or a new feature folder)
   and remove the `_legacy` exclusion as needed.
3. Wire any screens into Expo Router by adding routes under `mobile/app/`.
4. Pair with the matching `contracts/` and `backend/` work for on-chain/oracle
   flows.

Good first candidates to revive: `hooks/useGPS.ts` (route tracking) and
`components/MoveTracker.tsx`.

## Status

Intentionally excluded from the current MVP build. Preserved as a future module.
