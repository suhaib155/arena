# MovenRun — Mobile (MVP)

An AI movement-quest app (MVP slice). First-launch onboarding, pick a daily
movement quest, run a timer, finish it, earn XP toward levels and a daily
streak, then share your win.

> **MVP scope:** quests are served from local mock data (`src/data/quests.ts`).
> No AI API calls, no auth, no wallet/blockchain, no Supabase/backend. Progress
> (XP, level, streak, history, onboarding) is stored locally on-device via
> AsyncStorage.

## Stack

- Expo SDK 51 / React Native 0.74 / React 18
- Expo Router v3 (file-based routing in `app/`)
- TypeScript (strict)
- Zustand for state, persisted with AsyncStorage
- `expo-haptics` for tactile feedback; React Native `Share` for the share sheet

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

> First launch shows the onboarding flow. To see it again, use **Reset progress**
> on the Profile tab (which clears stats) or clear the app's storage — note that
> Reset intentionally keeps you past onboarding.

## Screens & flow

```
onboarding     First-launch intro carousel (3 slides) → Get started
(tabs)/index   Home — daily quest + list, level/XP, streak, "moved today" state
(tabs)/profile Profile — level, XP bar, streak, completed count, recent activity
quest/[id]     Quest detail — description, steps, reward → Start
active         Active quest — countdown timer, pause/resume, finish (haptics)
result         XP result — animated, level-up, streak, share card → Share / Done
```

Navigation: onboarding gates first launch (redirect happens after persisted
state hydrates, behind a branded splash). Tabs for Home/Profile; the quest flow
(`detail → active → result`) is a stack. Finishing pops back to Home.

## Project layout

```
app/                 Expo Router routes (incl. onboarding + root hydration gate)
src/components/       Reusable UI — Button, QuestCard, Badge, XPBar, StatCard,
                     Screen, SectionHeader, EmptyState, ShareCard
src/data/quests.ts   Mock quest catalogue + daily-quest picker
src/store/           Zustand game store (XP / streak / history / onboarding, persisted)
src/lib/             Leveling, date, and haptics helpers
src/theme.ts         Design tokens
_legacy/             Earlier GPS/blockchain mobile scaffold, parked out of the build
                     (see _legacy/README.md — do not delete without approval)
```

## Known limitations

- Quests are mock data; there is no AI generation or backend sync yet.
- Progress is local-only (AsyncStorage) and not synced across devices.
- The timer is a simple countdown — it does not use device motion/GPS sensors.
- The share card is a **mock**: it shares a text blurb (the on-screen card is not
  yet captured as an image).
- App icon/splash use Expo defaults (no custom art committed yet).
