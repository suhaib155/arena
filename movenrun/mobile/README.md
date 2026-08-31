# MovenRun — Mobile

The app. Sign in, open Home, and do what today's board asks: move, run a warmup
quest, defend ground you already hold. Movement earns XP toward levels and a
daily streak, and captures zones on your local territory map.

> **Current scope:** territory, zones and clubs are an on-device simulation —
> quests come from a local mock service (`src/services/questService.ts`) and
> progress lives in AsyncStorage. Accounts and sessions are real: email OTP
> against the backend, with tokens in `expo-secure-store` (never in Zustand or
> AsyncStorage). No wallet connection and no liquid token economy.

## Home is a task board

Everything the app asks of you is one noun — a **task** — and one pure function
builds today's list:

```ts
const board = buildTodayBoard({ movedToday, atRiskZoneCount, zonesOwned, … });
// → { focus, tasks, doneCount, totalCount, progressLabel, progress, allDone }
```

`focus` is the single spotlight task and owns the screen's only primary button;
`tasks` is the rest of the checklist and never repeats the spotlight. Tasks come
in three flavours, and the distinction is the whole design:

| Flavour | Tasks | Behaviour |
| --- | --- | --- |
| Daily | `move`, `quest` | Always on the board; reset each local day |
| Conditional | `resume`, `defend` | Present only while the condition holds, and outrank everything when they are |
| Milestone | `capture`, `club` | Present until achieved, then gone for good |

All of it is in `src/lib/tasks.ts` with its rules pinned in
`src/lib/__tests__/tasks.test.ts`. Home renders the result and decides nothing.

## Design system — Daylight Cartography

Bright Morning White light mode, soft white cards with layered shadows, hex-zone
identity, and the territory accents (Base Blue / Pulse Green / Deed Violet /
Heat Coral / MOVE Gold), shared with the marketing site in `movenrun/website/`.

Tokens live in **`src/theme.ts`** — `palette`, semantic `colors`, `zoneColors`,
`gradients`, `spacing`, `radius`, `shadows` + `glow()`, the `type` scale, and
`motion` timing. Never hardcode a hex value in a screen.

Four rules are enforced by `src/lib/__tests__/designSystem.test.ts`, because
each one had already been broken by hand at least once:

- **Corner radius is optical, not absolute.** `iconTile(size)` for functional
  icons, `avatar(size)` for identity and illustration. A fixed 16px radius reads
  as a circle at 24px and a square at 48px — which is exactly how the same
  control ended up round on one screen and square on the next.
- **Anything that floats above the page is a card**, and uses `radius.lg`,
  `radius.xl` or `radius.pill`. `<Card>` owns the three surfaces — `standard`,
  `hero`, `flat` — so cards can't drift apart again. One `hero` per screen at
  most: the thing the screen is about.
- **A selection outline never resizes what it outlines.** `selectionRing()`
  always reserves its border and changes only the colour.
- **Every tappable surface answers a touch** — `pressFade()` on a plain
  `Pressable`, or `ScalePress`, which springs instead. Never both.

Motion uses core `Animated` only (`ScalePress`, `FadeSlideIn`, `CountUpText`) —
no animation libraries. The hex motif (`Hexagon`) is plain Views, no SVG.

**Locked MOVE is a display preview only** (`src/lib/lockedMove.ts`): a value
derived from XP, always labeled "preview · in-app progress, not a payout". No
balance is stored and no earning is implied.

**Fonts follow-up:** the `type` scale targets Sora (display), Plus Jakarta Sans
(body) and Space Grotesk (numeric) with platform-sans fallbacks today. A future
PR should add `expo-font` + the matching `@expo-google-fonts/*` packages and set
`fontFamily` in `src/theme.ts` once the build is device-verified.

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

- The board marks today's quest task done, and the quest library shows a done
  state on every quest already completed this day.
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
(`.github/workflows/eas-apk-build.yml`) and authenticates with a single secret
(`EXPO_TOKEN`, already configured in repo Settings ▸ Secrets and variables ▸
Actions). **Never commit Expo tokens, passwords, or `.env` files.**

Do the three steps in order.

### Step A — Link the EAS project once (required first)
EAS needs a real project id. `app.json` ships with a placeholder
(`extra.eas.projectId: "FILL_ME_IN"`), and the workflow **fails fast** until it's
replaced. Link it once from your machine:

```bash
cd movenrun/mobile          # Windows example: cd E:\MovenRun\arena\movenrun\mobile
npx eas-cli@latest login    # or: eas login
npx eas-cli@latest init     # or: eas init
```

`eas init` creates/links the project under your Expo account and writes the real
`extra.eas.projectId` into `app.json`. **Commit that one-line `app.json` change**
(a small commit/PR). It's a one-time step. Only the `projectId` is committed —
never your token/password.

> Why isn't this automated in CI? Linking creates/owns a project under *your*
> Expo account and the id must live in `app.json`. The workflow intentionally
> does **not** auto-create projects or mutate committed config — it just checks
> that the project is linked and fails with instructions if not.

### Step B — Merge the workflow to `main`
Merge this PR so `.github/workflows/eas-apk-build.yml` is on `main` (manual
`workflow_dispatch` workflows are launched from the default branch).

### Step C — Run the build (produces the APK)
1. Go to the **GitHub repo** → **Actions** tab.
2. Select the **EAS APK Build** workflow.
3. Click **Run workflow** (on `main`).
4. Wait for the job to print an **EAS build link** (in the step log).
5. Open the **EAS build page** from that link.
6. **Download the APK** when the build finishes.
7. **Transfer/open the APK** on your Android phone.
8. **Install and test** (allow "install from unknown sources" if prompted).
9. **No Expo Go is required** — this is a standalone app.

### Profiles (`eas.json`)
- **`preview`** → builds an **APK** (`buildType: apk`) for direct install. ← use this.
- **`production`** → builds an **AAB** (`buildType: app-bundle`) for the Play Store
  later.

### Corepack on the EAS remote builder
The EAS remote builder may start with **Yarn 1** (global), but this repo pins
**Yarn 4** via `packageManager` (`yarn@4.9.1`). Yarn 1 refuses to run install for
a Yarn-4 project and tells you to enable **Corepack**. EAS installs from the
workspace root (`.../build/movenrun`), so without Corepack the remote
`yarn install` fails.

Fix: an **`eas-build-pre-install`** hook runs `corepack enable` before EAS
installs dependencies. It's defined in **both** `movenrun/package.json` (the
workspace root EAS installs from) and `movenrun/mobile/package.json` (the build
target), so Corepack is enabled regardless of which one EAS reads. Combined with
`nodeLinker: node-modules` (in `movenrun/.yarnrc.yml`), Yarn 4 then installs
cleanly on EAS.

> Security: the workflow uses **only** the `EXPO_TOKEN` GitHub Actions secret.
> Never commit Expo tokens, passwords, or `.env` files.

## First run and navigation

```
opening        Branded startup while persisted state hydrates
welcome        Account choice — email OTP sign-in / create account
onboarding     Redirect only; the real intro lives in `opening`
(tabs)/index   Home — today's task board
(tabs)/clubs   Clubs — city ranking and your club
(tabs)/profile Profile — stats, and the directory of every other screen
move/*         The movement session: start → session → summary → captured
quest/[id]     Quest detail → active timer → XP result
quests         The warmup quest library
territory/*    Local territory map and alerts
```

The bottom bar carries the five destinations that matter — Home, Territory,
**Move**, Clubs, Profile — with Move as the elevated centre action. Everything
else is reachable from the Profile directory, so Home never has to be a menu.

## Project layout

```
app/            Expo Router routes. One file = one screen. No business logic.
src/
  components/   Presentational only. Card, TaskRow, TaskHero, StatTrio, Button,
                Screen, SectionHeader, NavRow, ScalePress, EmptyState, …
  lib/          Pure functions. No React, no I/O — every decision lives here.
                tasks.ts (the board), shape.ts (geometry), territory.ts,
                leveling.ts, secureSession.ts, date.ts, haptics.ts, …
  services/     Everything that talks to the outside world:
                identityApi (auth), questService (the quest seam), moveTracker
  store/        Zustand. useGameStore (progress) and useAuthStore (session).
  data/         Raw mock catalogues — quests, clubs. Data only, no logic.
  theme.ts      Design tokens, and the re-export point for shape.ts
_legacy/        Parked GPS/blockchain scaffold, out of the build
                (see _legacy/README.md — do not delete without approval)
```

**The rule that keeps this readable:** a screen never decides anything. It calls
one function from `lib/`, gets a plain object back, and renders it. That is why
the whole suite runs on plain Node in about four seconds with no simulator —
and why `lib/` must never import from `react-native` at runtime. (Type-only
imports are fine; they're erased. `theme.ts` imports `Platform` as a *value*,
which is why the shape rules live in `lib/shape.ts` instead.)

```bash
yarn workspace @movenrun/mobile lint   # tsc --noEmit
yarn workspace @movenrun/mobile test   # node --test
```

## Quest data: always go through `questService`

All quest access goes through **`src/services/questService.ts`** — screens never
import the raw arrays. This is the single seam where a future server-side quest
source plugs in. Don't bypass it, and never ship AI provider keys in the app.

## Known limitations

- Territory, zones and clubs are a **local simulation** — no sync, no ownership
  beyond this device.
- Quests are mock data.
- Movement recovery isn't implemented: a finished route lives in memory only
  during the summary flow, so the board's `resume` task never fires yet.
- The timer is a countdown — it does not read motion or GPS sensors.
- The share card shares a text blurb; the on-screen card isn't captured as an
  image yet.
- App icon and splash are Expo defaults.
- Targets **Expo SDK 51**; phone testing uses the SDK 51 Expo Go on Android
  (below). iPhone via App Store Expo Go needs a later SDK upgrade.
