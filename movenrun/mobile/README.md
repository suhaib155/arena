# MovenRun — Mobile (MVP)

An AI movement-quest app (MVP slice). Pick a daily movement quest, run a timer,
finish it, and earn XP toward levels and a daily streak.

> **MVP scope:** quests are served from local mock data (`src/data/quests.ts`).
> No AI API calls, no wallet/blockchain, no backend. Progress (XP, level, streak,
> history) is stored locally on-device via AsyncStorage.

## Stack

- Expo SDK 51 / React Native 0.74 / React 18
- Expo Router v3 (file-based routing in `app/`)
- TypeScript (strict)
- Zustand for state, persisted with AsyncStorage

## Run it

```bash
# from the repo root (yarn workspaces)
yarn install

# start the mobile app
yarn workspace @movenrun/mobile start
# then press "i" (iOS sim), "a" (Android emulator), or scan the QR with Expo Go
```

Type-check:

```bash
yarn workspace @movenrun/mobile lint   # tsc --noEmit
```

## Screens & flow

```
(tabs)/index   Home — daily quest + quest list, level/XP, streak
(tabs)/profile Profile — level, XP bar, streak, completed count, recent activity
quest/[id]     Quest detail — description, steps, reward → Start
active         Active quest — countdown timer, pause/resume, finish
result         XP result — XP gained, level-up, streak update → Done
```

Navigation: tabs for Home/Profile; the quest flow (`detail → active → result`)
is a stack. Finishing pops back to Home.

## Project layout

```
app/                 Expo Router routes
src/components/       Reusable UI (Button, QuestCard, Badge, XPBar, StatCard, Screen)
src/data/quests.ts   Mock quest catalogue + daily-quest picker
src/store/           Zustand game store (XP / streak / history, persisted)
src/lib/             Leveling + date helpers
src/theme.ts         Design tokens
_legacy/             Earlier GPS/blockchain mobile scaffold, parked out of the build
```

## Known limitations

- Quests are mock data; there is no AI generation or backend sync yet.
- Progress is local-only (AsyncStorage) and not synced across devices.
- The timer is a simple countdown — it does not use device motion/GPS sensors.
- App icon/splash use Expo defaults (no custom art committed yet).
