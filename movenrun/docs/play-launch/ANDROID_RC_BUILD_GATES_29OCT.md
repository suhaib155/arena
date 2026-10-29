# Android Play v1 release candidate: audit and build gates (29 Oct 2026)

Branch `integration/android-play-v1-rc-29oct`, cut from
`integration/android-qa0-28oct` at `a2a3eec` (the #161 candidate). **No build
has run. Nothing here was checked on an APK, an AAB or a phone.** Every handset
row is NOT RUN. Running any command in section 4 is an owner action.

Play v1 is the Movement Game (D-01): no tokens, NFTs or balances; Google and
wallet signature sign-in (separate accounts, D-17); guest play; package
`io.movenrun.app`; 1,000-account cap (D-20). No Google Play developer account
exists (D-24), so every Play Console step below is **BLOCKED on X-01**.

## 1. What the candidate contains

| Since QA0 `15f7f87` | PR / commit | Ships in the app | Server side |
|---|---|---|---|
| Fail-closed sign-in return parsing | #140 `ddf646c` | yes | none |
| Metadata-aware minimum evidence for short walks (MR-A-01) | #145 `7bae381`, `897be7b` | shared module | `/movement/verify` anomaly pass |
| No distance across a rejected jump (MR-A-02) | #146 `27fadb5` | yes | yes |
| Session clock and fix-age health (MR-C) | #153 `804a544`, `714e04b` | yes | 5 min future-skew rejection |
| Estimated vs verified XP, isolated from #154 | `f188e4a` | store and summary logic | none |
| Deterministic test discovery | `ec02c0f` | none | CI |
| This branch: release-candidate movement-rule guard test, store listing correction, this file | see git log | test only | none |

Not in the candidate, by design: #154 (blanket 4x drift rule, rejected),
#166 (stationary-risk rule, open against the QA0 branch, not merged), every
gameplay branch, migration 0011 (the journal ends at 0010), website branches.

**API contract:** no route or request schema changed since `15f7f87`. Verdicts
did change: the hosted staging API runs an older backend without MR-A-01,
MR-A-02 or the skew check. Phone rows H-4(a) and H-6 against that API test the
old server rules (owner decision O-3).

## 2. Release-scope audit

| Check | Result | Evidence |
|---|---|---|
| Deferred features | `clubs`, `competition`, `deeds`, `wallets` all `false`, frozen object, no environment or profile override | `mobile/src/lib/releaseScope.ts`; `releaseScope.test.ts` |
| Rejected 4x stationary-drift rule | Absent from `mobile/app`, `mobile/src`, `shared/src`, `backend/src/movement` | `releaseCandidateMovementRules.test.ts`: passes here; fails on `fix/mr-c-stationary-drift` (3 source hits, 2 exports) |
| Stationary-risk/v1 (#166) | Not in this candidate. On its own branch it is server-only, selected by `MOVEMENT_STATIONARY_RISK_RULE`; unset or `off` is off; an unknown value refuses to start. The verify request carries no rule field, and no app source names the variable or rule id | `stationaryRisk.ts` `parseStationaryRiskRule` on #166; guard test above |
| Gameplay surfaces | No gameplay router in `backend/src/api/app.ts` (only `/identity`, `/movement`); no gameplay screens are reachable | `app.ts:88-93` |
| Dev-only paths | Demo route and timing diagnostics need `__DEV__`, which is false in a release bundle | `move/session.tsx:74`, `move/index.tsx:90,178` |
| Stray file | `mobile/40` is an empty file committed in `6c878e7`; nothing imports it | Owner decision O-6 |

**What ships, with defaults:**

| Name | Kind | Default when unset |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | EAS environment, public, in the bundle | No sign-in, no verification; guest play only |
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | EAS environment, public | Google button hidden; a secret-format key is refused |
| `EXPO_PUBLIC_WEB_URL` | EAS environment, public | `https://movenrun.xyz` |
| `GOOGLE_MAPS_ANDROID_API_KEY` | EAS environment, Sensitive, native manifest only | No key written; `extra.maps.androidConfigured=false`; the app says the map is unavailable |
| `RELEASE_FEATURES` | hard-coded | all `false` |
| `MOVEMENT_STATIONARY_RISK_RULE` | server environment (only once #166 merges) | off |

The guard test also fails if the app starts reading any other
`process.env` name.

## 3. Truthfulness review

No mobile copy was changed: no copy exception is approved yet (D-25, and every
row of #139 still waits for owner approval). Only the draft store listing,
which is a document, was corrected.

| # | Where | Issue | Proposed | UI exception needed |
|---|---|---|---|---|
| T1 | `docs/play-launch/STORE_LISTING.md` | "Standing still or ending a mission early earns nothing, so progress always means you moved" and "Daily missions that reward real movement with XP" were false: timed quests (Desk Reset, Breath Anchor) pay XP on a timer with no movement, and a still phone that overstates its accuracy (S03) still verifies while no stationary rule is on | **Changed** on this branch: timed missions pay on finishing the timer; movement XP is confirmed and can be withdrawn by a server check when signed in; ending early earns nothing | no (document) |
| T2 | `mobile/app/move/summary.tsx:488-496` | After Save the reward card shows "+N XP" with no "estimated" mark. It is the phone's estimate; the server verdict can lower it or take it back (MR-C). The four MR-C states are data only | Show "Estimated" beside the XP until a verdict, then "Verified" or "Not eligible" (strings in `MR-C_CLOCK_DRIFT_AND_XP_STATUS.md` §3) | yes |
| T3 | `mobile/app/(tabs)/index.tsx:103`, `mobile/src/lib/tasks.ts:205-213` | "XP today" sums history rows, which settlement never adjusts. Reproduced locally: estimate 53, rejected verdict, total XP 0, "XP today" still +53 | Logic fix (sum settled XP, or adjust the history row on settlement), with a failing-first test; no copy change | no (logic; needs review) |
| T4 | `mobile/src/lib/verifiedMovement.ts:202` | A rejected verdict reads "Needs review", but no one reviews it and there is no appeal | "Not eligible" (the MR-C proposed label) | yes |
| T5 | `mobile/src/lib/sealPreview.ts:132-133,149,218`; `mobile/app/move/session.tsx:693` | The phone seal preview uses sealing rules v1 (self-cross or a return within 150 m). The gameplay seal-v2 pilot (`feat/g34-server-holdings` `sealLoop.ts`, minimum area 2,000 m², no out-and-back or spur loops) would not honour many of these. "1 loop sealed" and "Sealed sections are banked" read as a claim the server will not make | Keep "loop closed" wording, drop "banked": "Loop closed. The trail ahead is open again." Before gameplay ships, the preview must run the server's rule | yes |
| T6 | `mobile/src/lib/verifiedMovement.ts:211` | "Server check: sealed" is the v1 server check; it does not mean the route can claim land | "Server check: loop closed (preview rules)" | yes |
| T7 | `mobile/app/move/summary.tsx:551,697`; `mobile/app/move/captured.tsx:120,215` | "Capture preview", "Save + preview capture", "Zone Captured" on a local preview that no server agrees to | "Explored", "Save session", "Zone explored" (local preview) | yes |
| T8 | `mobile/src/lib/moveReadiness.ts:103,119` | Denied and services-off copy offers "try a demo route"; the button exists only in development builds (QA0-12) | Drop the clause: "...Turn it on in Settings." | yes |
| T9 | `mobile/src/components/ShareCard.tsx:24`; `mobile/app/season-objectives.tsx:137` | "Move → Capture → Own", "Own your season." (#139 rows 1-2) | "Move → Explore → Progress", "Shape your season." | yes |
| T10 | `mobile/app/settings/technical.tsx:80,150,176`; `mobile/src/lib/networkView.ts:67,79,81`; `mobile/src/data/contractStatus.ts` | Technical info presents Base Sepolia contracts and the token contract (#139 rows 3-9 and extra finding 1) | #139 Option B: hide the row and the route behind the `wallets` flag | yes (navigation) |
| T11 | `mobile/src/lib/introFlow.ts:83` | Intro "Capture and defend" asserts live capture and defence | "Explore new ground" / "Your moves show up as a local preview of the places you have been." | yes |
| T12 | `mobile/app/legal.tsx:18` | "territory and Deed previews do not establish permanent ownership" implies temporary ownership and names Deeds, which v1 hides | "Your ground on the map is a personal preview on this device. It is not ownership of any place." | yes (legal text; owner review) |

No copy offers tokens, balances, purchase or payout in a reachable v1 screen
other than T10. `legal.tsx:18` and `settings/technical.tsx:170` deny them.

## 4. Signed-build gates (ordered; do not run without approval)

Commands are for the operator. This file runs nothing. Variable and key
**names** only; never paste a value into the repository or a chat.

### 4.1 Preconditions

| # | Gate | Owner | State |
|---|---|---|---|
| P1 | Choose the commit: the head of this branch (or a successor) whose `mobile-checks` run is green. Its app tree must equal `a2a3eec` plus test and document files only. Record the full SHA | owner | open |
| P2 | Clean tree: `git status --porcelain` empty; `git rev-parse HEAD` equals P1. GitHub's dispatch builds a branch head, so point a dedicated branch at that SHA and build that branch | owner | open |
| P3 | Version: `version` 1.0.0 in `app.json` (versionName); no `versionCode` in `app.json`; `appVersionSource: remote`. Preview builds reuse the current remote versionCode; production adds 1 (`autoIncrement`). Check the current value, without building, with `eas build:version:get -p android` | owner | open |
| P4 | Profile: **`preview`** (APK, internal, EAS environment `preview`) for the handset gate, because it installs by `adb` with no Play account. **`production`** (AAB) only after the merge (X-14) and only for Play upload, which is blocked on X-01 | owner | decided by `eas.json` |
| P5 | EAS environment `preview` holds `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, optionally `EXPO_PUBLIC_WEB_URL`, and `GOOGLE_MAPS_ANDROID_API_KEY` (Sensitive). Check the names in the Expo dashboard; never read the values here | owner (X-08) | not checked |
| P6 | Keystore: the EAS-managed Android upload keystore for `io.movenrun.app` (D-09). Created or viewed with `eas credentials -p android`; that uses no build. Copy its SHA-1 into the Maps key restriction (X-08) | owner | not checked |
| P7 | GitHub secret `EXPO_TOKEN` present and not revoked; for production, GitHub environment `play-release` with a required reviewer (X-09) | owner | not checked |
| P8 | Providers: Google, then wallet, enabled in Supabase project `movenrun` (X-05); the wallet page served at `movenrun.xyz` (X-21). Without them H-8 is BLOCKED; H-1 to H-7 and H-9 to H-12 can still run | owner | not done |
| P9 | Backend: decide which API the phone talks to (O-3) | owner | open |
| P10 | Quota: expo.dev Usage shows Free build allowance left and nothing queued. Budget: **3 Android builds** for this release: 1 preview APK (P11), 1 spare only after a fix commit, 1 production AAB after the merge. Every started build counts, including a failed one | owner | open |
| P11 | Written owner approval naming the exact SHA and profile (X-04) | owner | **not given** |

### 4.2 Commands (owner/operator only)

| Step | Command or action | Uses quota |
|---|---|---|
| C1 | From `movenrun/`: `yarn install --immutable`, then `yarn workspace @movenrun/mobile lint` and `yarn workspace @movenrun/mobile test` | no |
| C2 | From `movenrun/mobile`: `npx expo export --platform android` and `npx expo prebuild -p android --no-install` in a scratch copy; the manifest checks of `eas-production-aab.yml` (gates job) | no |
| C3 | `npx eas-cli@24.8.0 credentials -p android` to read the upload certificate fingerprints (P6) | no |
| C4 | GitHub, Actions, **EAS APK Build**, Run workflow on the P2 branch. It runs `eas-cli@24.8.0 build -p android --profile preview --non-interactive`. It does **not** run tests, so C1 must be green first | **1 build** |
| C5 | After the merge: Actions, **EAS Production AAB**, confirm `build`; the `play-release` reviewer approves. Runs lint, tests, Hermes export and the manifest check, then `build -p android --profile production` | **1 build** |
| C6 | Never: `eas submit`, `eas update`, a second run "to try again", or a local `eas build`. Play upload is a person in the Play Console, blocked on X-01 | n/a |

### 4.3 Verify the artefact (computer, no phone)

Run on the downloaded file; record build id, commit and versionCode.
Full command lines are in `X04_PREVIEW_BUILD_RUNBOOK.md` ("Static checks")
and `ANDROID_16KB_PAGE_SIZE.md`.

| Check | Tool (by name) | Expected |
|---|---|---|
| Built from P1 | EAS build page / `eas build:view` | commit equals P1, profile as P4 |
| applicationId, versions, SDKs | `aapt2 dump badging` (APK); `bundletool dump manifest` (AAB) | `io.movenrun.app`, versionName 1.0.0, versionCode as P3, minSdk 24, targetSdk 36 |
| Signing certificate | `apksigner verify --print-certs` (APK); `keytool -printcert -jarfile` (AAB) | SHA-256 / SHA-1 equal the upload certificate from C3. Record only "matches"; never paste the fingerprint into a public place |
| Permissions | `aapt2 dump xmltree --file AndroidManifest.xml` | fine and coarse location, `INTERNET`, `VIBRATE`, AndroidX's signature-level receiver permission; no background location, foreground service, overlay, storage, media or audio |
| No debug | same dump; `aapt2 dump badging` | no `application-debuggable`, `usesCleartextTraffic=false`, `allowBackup=false`, `dataExtractionRules` set |
| Components | same dump | only `.MainActivity` exported (plus AndroidX `ProfileInstallReceiver`); one `movenrun` scheme filter; no `LocationTaskService` |
| Hermes | `unzip -p` the bundle, first 8 bytes with `od` | Hermes bytecode magic, not JavaScript text |
| No secrets in the bundle | `node scripts/check-secrets.mjs` on the extracted bundle | pass |
| 16 KB | `zipalign -c -P 16`; `llvm-readelf -lW` on each 64-bit `.so` | `Verification successful`; every LOAD `0x4000` or more |
| Size | file size; for an AAB `bundletool get-size total` on device APKs | record it; investigate a jump of more than 20% over the QA0 estimate |

### 4.4 Handset gates H-1 to H-12

Rows are defined in `QA0_HANDSET_WORKSHEET.md` (branch
`docs/qa0-h1-h12-play-workbook`; it names `15f7f87`, so update its "Applies to"
row to the P1 SHA before the run). Evidence rules there apply: no
coordinates, addresses, tokens, codes, emails, wallet addresses or fingerprints.

| Row | Expected on this candidate | Evidence | Needs |
|---|---|---|---|
| H-1 Cold start, Hermes | `Status: ok` three times; no `RangeError`/`TextDecoder` fatal | three `am start -W` lines; empty grep | APK |
| H-2 Offline start and save | Starts offline; save pending, verified once after reconnect; pending XP marked estimate in data (UI shows plain "+N", T2) | screenshots; count before/after | APK, signed in (P8) |
| H-3 Stationary (mandatory) | about 0 m, under 25 m. With no stationary rule on, an overconfident still phone can still record distance (S03); record the number honestly | final distance; summary | outdoors |
| H-4 Short walk, pause, quest once | (a) verdict depends on the API chosen in O-3; (b) no bridge across the paused gap; (c) one quest award per day | summary screenshots | outdoors |
| H-5 Long walk (mandatory) | within about 10% of the measured route; stop not counted | measured vs reported metres | outdoors, signed in |
| H-6 Vehicle leg | vehicle stretch earns no walking distance on the phone (MR-A-02); server verdict per O-3 | reported vs walked | passenger only |
| H-7 Reduced and denied location | no background prompt; approximate-only counts nothing; note the "demo route" copy (T8) | per-state screenshots | APK |
| H-8 Google, then wallet | signed in; wallet prompt is a signature only | which return path happened | **BLOCKED until X-05 / X-21** |
| H-9 Malformed links | only `MainActivity` handles `movenrun://`; every forged link leaves the app signed out | `query-activities` component; signed-out screenshot | APK, `adb` |
| H-10 Pending and deletion | pending never shown as verified; deletion signs out and a re-sign-in is fresh | screenshots; owner's server-row check | P8 |
| H-11 Tiles, 200% text, TalkBack | real tiles (Maps SHA-1 from P6); no clipped Move/Finish/Back | screenshots, notes | X-08 |
| H-12 Manifest, backup, 16 KB | as 4.3; `backupnow` refused; transfer brings nothing | dump lines; `backupnow` line | APK, build-tools |

Blockers: a FAIL in H-1, H-3, H-5, H-9, H-10 (deletion) or H-12(b). NOT RUN
in H-3 or H-5 means the candidate is not phone-tested.

Play rows (internal test, Play App Signing SHA-1 on the Maps key, App bundle
explorer, Data safety, listing): **BLOCKED on X-01**.

## 5. Owner decisions

| ID | Decision |
|---|---|
| O-1 | Approve one preview APK from an exact SHA (P11, X-04), after P5 to P10 |
| O-2 | Approve or reject copy fixes T2, T4 to T12 as one narrow text-truth exception; T3 as a reviewed logic fix |
| O-3 | Which API the handset gate uses: hosted staging as it is (old movement rules; H-4(a) and H-6 then test the old server), or a separately approved backend deploy of this candidate's backend first. No Render action is taken by this work |
| O-4 | Whether #166 (stationary-risk, off by default) joins the candidate before the build; it changes no app code |
| O-5 | Accept the revised store listing bullets (T1) |
| O-6 | Remove the stray empty `mobile/40` file, or leave it |
