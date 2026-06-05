# MovenRun — Mobile (MVP)

An AI movement-quest app (MVP slice). First-launch onboarding, pick a daily
movement quest, run a timer, finish it, earn XP toward levels and a daily
streak, then share your win.

> **MVP scope:** quests come from a local mock service (`src/services/questService.ts`,
> backed by `src/data/quests.ts`). No AI API calls, no auth, no wallet/blockchain,
> no Supabase/backend. Progress (XP, level, streak, history, onboarding) is stored
> locally on-device via AsyncStorage.

## Quest data: always go through `questService`

All quest access goes through **`src/services/questService.ts`** — screens never
import the raw quest arrays. This is the single seam where a future
**server-side, AI-generated** quest source will plug in (an alternate
`QuestService` implementation, prefetched at session start). Rules:

- Do **not** bypass `questService` when adding a new quest source.
- Future AI quests must be generated **server-side**; never ship AI provider keys
  in the mobile app.
- The current implementation is **mock/local only** and synchronous.

## Completed-today (anti-farming)

Each quest awards XP **at most once per local day**. The store records the quest
ids completed on the current local day (`getLocalDateKey()`), so:

- Home marks finished quests "Done today" and the daily card shows a done state.
- The Quest detail **Start** button becomes a disabled "Completed today" once a
  quest has been done that day.
- Replaying a quest is idempotent in the store (0 XP, no streak/history change) —
  a defense-in-depth guard even if the UI is bypassed.

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

CI runs this type-check automatically on every PR and on pushes to `main`
(`.github/workflows/mobile-checks.yml`).

> First launch shows the onboarding flow. To see it again, use **Reset progress**
> on the Profile tab (which clears stats) or clear the app's storage — note that
> Reset intentionally keeps you past onboarding.

## Test on your phone (GitHub Codespaces + Expo tunnel)

The dev server runs in the cloud (Codespaces), and your phone connects over an
Expo **tunnel** — no shared Wi‑Fi/LAN needed, no port forwarding.

### 1. Open a Codespace
- On the GitHub repo: **Code ▸ Codespaces ▸ Create codespace on `main`**.
- Wait for it to boot, then open the integrated terminal.

### 2. Install dependencies
```bash
cd movenrun
yarn install
```

### 3. Start the tunnel
```bash
yarn workspace @movenrun/mobile start --tunnel --clear
```
- `--tunnel` routes through Expo's tunnel (ngrok) so a phone on cellular or any
  network can reach the Codespace. This is the key flag for phone-only testing.
- `--clear` clears the Metro cache (use it whenever things look stale).
- **First run only:** Expo may prompt to install `@expo/ngrok` — accept it. To
  avoid the prompt you can pre-install it once: `yarn add -D @expo/ngrok` inside
  `movenrun/mobile`.
- Keep this terminal/tab open while testing. Press `r` to reload, `j` to open the
  debugger.

### 4. Open the project in Expo Go
After Metro starts it prints a QR code and an `exp://…` tunnel URL. Either:
- **Scan the QR code** — iPhone: Camera app; Android: the "Scan QR code" button in
  Expo Go, **or**
- In **Expo Go ▸ Enter URL manually**, paste the `exp://…` URL from the terminal.

### ⚠️ Expo Go version must match the SDK (this app is **SDK 51**)
Expo Go from the App Store / Play Store tracks the **latest** SDK and will refuse
to open an older project ("Project is incompatible with this version of Expo
Go"). This app is on **Expo SDK 51**, so use a **matching** runtime:

**Android**
- Install an Expo Go build for SDK 51 from Expo's downloads page:
  `https://expo.dev/go?sdkVersion=51&platform=android&device=true`
- Then scan the QR / open the `exp://…` URL in that Expo Go.

**iPhone**
- The App Store only offers the **latest** Expo Go (older versions can't be
  installed), so an SDK 51 project generally **won't open** in it. Options:
  1. Build an iOS **development build** and open the tunnel URL in it:
     `npx eas build --profile development --platform ios` (requires an Expo
     account; one‑time), then run the same `--tunnel` command and open it in the
     dev build.
  2. **Upgrade the app to the latest Expo SDK** so the App Store Expo Go can open
     it — tracked separately (see `docs/ROADMAP.md`); intentionally not part of
     this change.

> Android via a matching Expo Go is the fastest phone-only path on SDK 51. For
> iPhone-via-App-Store-Expo-Go, an SDK upgrade is required.

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
src/services/        questService — the quest access seam (mock today)
src/data/quests.ts   Mock quest catalogue (raw data only)
src/hooks/           useSessionStart — daily quest + completed-today session state
src/store/           Zustand game store (XP / streak / history / onboarding /
                     completed-today, persisted; selectors + hooks)
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
- The app targets **Expo SDK 51**, so the latest App Store / Play Store Expo Go
  may not open it. Use a matching Expo Go (Android) or a dev build (iPhone) — see
  "Test on your phone" above. A future SDK upgrade would let the latest Expo Go
  open it directly.
