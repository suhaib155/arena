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

## Test on your Android phone (GitHub Codespaces + Expo tunnel)

The dev server runs in the cloud (Codespaces) and your phone connects over an
Expo **tunnel** — no shared Wi‑Fi/LAN and no port forwarding required. This is
the supported phone-only path for the current **Expo SDK 51** app.

### 1. Open the repo in a Codespace
- From the GitHub repo (mobile browser is fine): **Code ▸ Codespaces ▸ Create
  codespace on `main`**.
- When it finishes booting, open the integrated **terminal**.

### 2. Start the tunnel
Run, in the terminal:
```bash
cd movenrun
corepack enable
yarn install
yarn workspace @movenrun/mobile start --tunnel --clear
```
- `corepack enable` provisions the repo's pinned Yarn 4.
- `--tunnel` routes through Expo's tunnel (ngrok) so any phone, on any network,
  can reach the Codespace. **Always use `--tunnel`** here — LAN/localhost can't
  reach a cloud container.
- `--clear` clears the Metro cache.
- **If it prompts to install `@expo/ngrok`, answer `y` (yes).**

### 3. Install Expo Go for SDK 51 on Android
> ⚠️ Use the **SDK 51** Expo Go APK — **not** the latest Play Store Expo Go (the
> latest version can't open an SDK 51 project).
- Download/install the SDK 51 Android client from:
  `https://expo.dev/go?sdkVersion=51&platform=android&device=true`

### 4. Open the app in Expo Go
After Metro starts, the terminal prints a QR code and an `exp://…` tunnel URL.
- **Scan the QR** with Expo Go's "Scan QR code", **or**
- **Copy the `exp://…` link** and paste it into **Expo Go ▸ Enter URL manually**.
  - If you're reading the terminal on the *same* phone, scanning is awkward — just
    select/copy the `exp://…` text and paste it into the manual URL field.

### 5. Stop / restart Metro
- **Stop:** press **`Ctrl+C`** in the terminal.
- **Restart:** re-run `yarn workspace @movenrun/mobile start --tunnel --clear`.
- While running: press **`r`** to reload the app, **`?`** to list all keys.

### Common fixes
- **Clear Expo/Metro cache** — keep the `--clear` flag (or re-run the start
  command with it).
- **Restart the Codespace** — if the tunnel won't establish or the URL is stale.
- **Re-run `yarn install`** — if a module appears missing after pulling changes.
- **Use `--tunnel`, not LAN** — localhost/LAN cannot reach a cloud Codespace.
- **Confirm the SDK 51 Expo Go APK** — not the latest Play Store Expo Go; an SDK
  mismatch shows "Project is incompatible with this version of Expo Go".

### iPhone & SDK notes
- **iPhone** physical testing should use the **latest Expo SDK** (via the App
  Store Expo Go) or an **EAS development build** — to be set up later.
- An **Expo SDK upgrade** should be done in a **separate PR**, from an environment
  where `npx expo install --fix` and `npx expo-doctor` can run successfully and
  the result can be device-tested (see `docs/ROADMAP.md`).

## Build an installable Android APK (GitHub Actions + EAS)

Build a real, installable `.apk` in the cloud with **EAS Build** — **no Expo Go
required**. The build runs from a manual GitHub Actions workflow
(`.github/workflows/eas-apk-build.yml`) and authenticates with a single secret.

### One-time prerequisites
- **`EXPO_TOKEN` secret** — an Expo access token stored in **repo Settings ▸
  Secrets and variables ▸ Actions ▸ `EXPO_TOKEN`**. (Already done.) Never commit
  Expo tokens/passwords.
- **Link the EAS project once** — EAS needs a real project id. `app.json` currently
  has `extra.eas.projectId: "FILL_ME_IN"`. From `movenrun/mobile`, run
  `npx eas-cli@latest init` (or `eas init`) once on your machine while logged in;
  commit the resulting real `projectId`. Until this is set, the build will fail
  asking to configure the project.

### Run the build
1. Go to the **GitHub repo**.
2. Open the **Actions** tab.
3. Select the **EAS APK Build** workflow.
4. Click **Run workflow** (on `main`).
5. Wait for the job to print an **EAS build link** (in the step log).
6. Open the **EAS build page** from that link.
7. **Download the APK** when the build finishes.
8. **Transfer/open the APK** on your Android phone.
9. **Install and test** (allow "install from unknown sources" if prompted).
10. **No Expo Go is required** — this is a standalone app.

### Profiles (`eas.json`)
- **`preview`** → builds an **APK** (`buildType: apk`) for direct install. ← use this.
- **`production`** → builds an **AAB** (`buildType: app-bundle`) for the Play Store
  later.

> Security: the workflow uses **only** the `EXPO_TOKEN` GitHub Actions secret.
> Never commit Expo tokens, passwords, or `.env` files.

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
- The app targets **Expo SDK 51**. Phone testing uses the **SDK 51** Expo Go
  (Android) — see "Test on your Android phone" above. iPhone-via-App-Store Expo
  Go needs a later SDK upgrade (tracked separately).
