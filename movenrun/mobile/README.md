# MovenRun — Mobile

The MovenRun app: account-first onboarding, real GPS movement sessions, on-device
territory capture and defence, clubs and city districts, progression, and
clearly-labelled previews of the ownership layer that is still being built.

> **What is real vs. previewed — read this first.**
>
> **Real:** foreground GPS tracking (`expo-location`) during an explicit session;
> distance, duration, and route drawn on-device; XP, levels, streaks, and history
> persisted locally (AsyncStorage); email-OTP sign-in against the MovenRun
> identity API with tokens held in `expo-secure-store`; a local-only beta path
> for playing without an account.
>
> **Simulated on-device:** territory. Routes are quantized onto a local ~300 m
> hex lattice (`src/lib/zones.ts`) — *not* real H3 yet — and capture / defend /
> fortify / decay run as deterministic local math (`src/lib/territory.ts`).
> Clubs, rivals, districts, city wars, sponsor zones, and event zones are seeded
> local previews with no server and no location inference.
>
> **Preview only, never functional:** Locked MOVE (`src/lib/lockedMove.ts`) is a
> figure derived from XP, always labelled as in-app progress and not a payout.
> Zone Deeds are an educational showroom. The network screen shows public Base
> Sepolia addresses read-only.
>
> **Not in the app at all:** wallet signing, token transfers, on-chain writes, RPC
> calls, background location, raw-GPS upload, and AI provider keys.

## Design system — Daylight Cartography

The UI follows the **Daylight Cartography** design language shared with the
marketing site (`movenrun/website/`): bright Morning White light mode, soft
white cards with layered shadows, hex-zone identity, and the territory accents
(Base Blue / Pulse Green / Deed Violet / Heat Coral / MOVE Gold).

- All tokens live in **`src/theme.ts`**: `palette`, semantic `colors`,
  `zoneColors`, `gradients`, `spacing`, `radius`, `shadows` + `glow()`,
  the `type` scale, and `motion` timing. Never hardcode hex values in screens.
- Motion uses core `Animated` only (`ScalePress`, `FadeSlideIn`,
  `CountUpText`) — no animation libraries.
- The hex motif (`Hexagon`, `TerritoryPreview`, `RouteCanvas`) is plain Views —
  no SVG or native map dependency. The Home territory card is explicitly a
  **non-functional preview** ("Territory map coming next"); the browsable map
  lives at `app/territory/map.tsx` and renders the local zone lattice.
- **Locked MOVE is a display preview only** (`src/lib/lockedMove.ts`): a value
  derived from XP, always labeled "preview · in-app progress, not a payout".
  No balance is stored and no earning is implied.
- **Fonts follow-up:** the `type` scale targets Sora (display), Plus Jakarta
  Sans (body) and Space Grotesk (numeric) with platform-sans fallbacks today.
  A future PR should add `expo-font` + `@expo-google-fonts/sora`,
  `@expo-google-fonts/plus-jakarta-sans`, `@expo-google-fonts/space-grotesk`
  and set `fontFamily` in `src/theme.ts` once the build is device-verified.

## Data seams

Screens never import raw data arrays. Each data family goes through one module,
so a local mock can be swapped for a server source without touching a screen.

- **`src/services/questService.ts`** — all quest access. Mock/local and
  synchronous today; a server-side implementation would plug in behind the same
  interface, prefetched at session start (`@/hooks/useSessionStart`). Do not
  bypass it when adding a quest source.
- **`src/services/identityApi.ts`** — the only caller of the identity/wallet API.
  The server is authoritative; the client only attaches the bearer token, refreshes
  once on a 401, and surfaces the server's stable error codes. It never generates
  a wallet and never accepts a seed phrase or private key.
- **`src/services/moveTracker.ts`** — GPS (`expo-location` foreground watch) and
  the labelled demo tracker behind one interface.
- **`src/lib/*View.ts` / `src/lib/*.ts`** — pure selectors and rules (territory
  decay, clubs, collections, deeds, network, recap, objectives). They take plain
  data and return plain data, which is what makes them testable offline.

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
- `expo-secure-store` for auth tokens — secrets never touch AsyncStorage
- `expo-location` for foreground-only movement tracking
- `expo-haptics` for tactile feedback; React Native `Share` for the share sheet
- No map, SVG, animation, or analytics libraries — motion is core `Animated`

## Run it

```bash
# from the repo root (yarn workspaces)
yarn install

# start the mobile app
yarn workspace @movenrun/mobile start
# then press "i" (iOS sim), "a" (Android emulator), or scan the QR with Expo Go
```

Type-check and test:

```bash
yarn workspace @movenrun/mobile lint   # tsc --noEmit
yarn workspace @movenrun/mobile test   # offline node tests for the pure modules
```

CI runs both automatically on every PR and on pushes to `main`
(`.github/workflows/mobile-checks.yml`). The tests need no device, no network,
and no native modules — that is why the rules they cover live in pure modules
under `src/lib/`.

Signing in requires the identity API. Point the app at it with the
`EXPO_PUBLIC_API_URL` environment variable; when it is unset, auth calls fail
fast with a clear message instead of hitting a wrong host. Without a backend,
use the **explore the local beta** path on the welcome screen.

> First launch shows account choice, then the intro. To see first run again, use
> **Reset progress** on the Profile tab (which clears stats) or clear the app's
> storage — note that Reset intentionally keeps you past first run.

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

### Step A — EAS project linking (already done)
EAS needs a real project id in `app.json` (`extra.eas.projectId`), and the
workflow **fails fast** on the `FILL_ME_IN` placeholder. This repository is
already linked, so there is nothing to do here.

If you ever need to re-link the project to a different Expo account:

```bash
cd movenrun/mobile
npx eas-cli@latest login    # or: eas login
npx eas-cli@latest init     # or: eas init
```

`eas init` writes the real `extra.eas.projectId` into `app.json`. Commit that
one-line change. Only the `projectId` is committed — never your token or
password.

> Why isn't this automated in CI? Linking creates/owns a project under *your*
> Expo account and the id must live in `app.json`. The workflow intentionally
> does **not** auto-create projects or mutate committed config — it just checks
> that the project is linked and fails with instructions if not.

### Step B — Run the build (produces the APK)
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

## Screens & flow

**First run** — account first, then the intro, then the app.

```
welcome            Account choice: continue with email, or explore the local beta
opening            The canonical three-step introduction
account/index      Account hub — email one-time-code sign in, account state
account/security   Linked sign-in methods, sessions and devices
account/wallets    Linked wallets (embedded vs. external), read-only
onboarding         Compatibility redirect for old deep links only
```

Startup routing is decided by pure functions (`lib/firstRun.ts`,
`lib/startupDecision.ts`) after persisted state hydrates, behind a branded
splash — so the decision is testable off-device and a storage failure never
silently signs a user out.

**Core loop** — move, then see what the movement did.

```
(tabs)/index       Home — mission, territory alerts, recap, questline, zones
move/index         Move — readiness (permission, signal), start a session
move/session       Live session — GPS or clearly-labelled demo route, on-device
move/summary       Session summary — distance, time, trust review, save or discard
move/captured      What the route captured — zones touched this session
territory/map      Local territory overview — every captured zone and its state
territory/alerts   Zones that need defending, derived from local decay
zone/[id]          Zone detail — control, defense, defend / fortify
route/passport     Route Signal Passport — GPS-quality trend over time
route/proof        Shareable route proof — scalars only, no path, no coordinates
route/review-history  Past route-trust reviews
```

**Progression, social and previews.**

```
(tabs)/clubs       Clubs — local club catalogue, ranking, your club
(tabs)/profile     Profile — level, XP, streak, identity/status, settings
quest/[id]         Quest detail → active → result (XP, level-up, streak)
questline          The guided local-beta questline
collections        Zone collections and badges
season-objectives  Weekly local objectives
weekly-recap       Read-only recap of recent movement and territory
district-mastery   Long-term local district progress
city-districts     Local district previews
city-war           Local city-war board
club-territory     Your club's local territory picture
crew-missions      Local crew missions
rivals             Local rival ghosts (no real players, no location inference)
event-zones        Event zone previews
sponsor-zones      Sponsor zone previews
deed-showroom      Zone Deed showroom — educational preview, nothing mintable
network/status     Base Sepolia contract status — read-only public addresses
```

Everything in the third group is derived from local state by pure selectors and
labelled in the UI as a local preview.

## Project layout

```
app/                  Expo Router routes (see "Screens & flow" above)
src/components/       Reusable UI — Button, Badge, XPBar, StatCard, Screen,
                      ZoneCard, ZoneSheet, RouteCanvas, MovenTabBar, ShareCard…
src/services/         questService (quest seam), identityApi (auth/wallet API),
                      moveTracker (GPS + demo), moveSession (in-memory hand-off)
src/data/             Seed data only — quests, clubs, contractStatus mirror
src/hooks/            useAppBootstrap, useSessionStart, useReducedMotion
src/store/            Zustand stores — useGameStore (XP / streak / zones /
                      history, persisted) and useAuthStore (session lifecycle)
src/lib/              Pure rules and selectors: territory decay, zone lattice,
                      geo, route trust, first-run/startup decisions, secure
                      session core, and the *View presentation modules
src/lib/__tests__/    Offline node tests for those pure modules
src/theme.ts          Design tokens
_legacy/              Earlier GPS/blockchain mobile scaffold, parked out of the
                      build (see _legacy/README.md — do not delete without approval)
```

## Known limitations

- **Territory is not real H3 yet.** Zones come from a local ~300 m lattice
  (`src/lib/zones.ts`); proper `h3-js` indexing at the resolution defined in
  `shared/` lands with the live territory map.
- **Nothing syncs except identity.** Progress, zones, clubs, and collections are
  on-device (AsyncStorage) and do not move between devices. Only authentication
  talks to a server.
- **Clubs, rivals, districts, city wars, sponsor and event zones are seeded local
  previews** — no other players, no server, no location inference.
- **The ownership layer is a preview.** No wallet signing, no minting, no
  transfers, no RPC calls. Locked MOVE is an XP-derived display figure.
- **Tracking is foreground-only.** Leaving the app or locking the screen stops
  the session; there is no background location or task manager.
- The share card shares a text blurb — the on-screen card is not yet captured as
  an image.
- App icon/splash use Expo defaults (no custom art committed yet).
- The app targets **Expo SDK 51**. Phone testing uses the **SDK 51** Expo Go
  (Android) — see "Test on your Android phone" above. iPhone-via-App-Store Expo
  Go needs a later SDK upgrade (tracked separately).
