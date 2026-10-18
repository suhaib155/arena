# X-04: the one free preview APK, step by step

**APPROVAL: starting the build uses one build from the Expo Free plan's
monthly allowance.** Everything before step 5 is free and uses no quota.
Nothing here needs a payment method, a paid plan or a Google Play account.
Background and account details: `LIVE_SETUP_OPERATOR_GUIDE.md` "Free EAS
readiness".

## The QA0 candidate (18 Oct 2026)

**No build has run.** Nothing below was checked on an APK or a phone.

Branch `preview/android-qa0-candidate`, opened against
`release/android-v1-cxfdbd` (991ac6a). It is one merge commit, **57f268d**,
plus docs-only commits after it:

| Input | Commit | What it brings | In the candidate |
|---|---|---|---|
| `deploy/render-free-staging` (base of the branch) | 2192de6 | The backend Render staging serves now: single-use Google exchange (#112, migration 0010), `amr`-only sign-in time, X-24 security fixes (#111), and everything on the release branch | Yes, as the base. `backend/`, `shared/` and `render.yaml` are byte-identical to 2192de6 |
| PR #115 `privacy/a2-android-backup-off` | 1c3caab | `allowBackup=false`, data extraction rules, cleartext off, `LocationTaskService` removed, `expo-clipboard` dropped, manifest and 16 KB tests, QA0 docs | Yes, merged (`--no-ff`). `mobile/` and `shared/` are byte-identical to 1c3caab |
| `feat/android-hermes-h3-runtime-fix` (#94) | 83a7e8a | h3-js startup fix on Hermes | Already an ancestor of the release branch; nothing to merge |
| `release/android-v1-cxfdbd` | 991ac6a | Google and wallet sign-in in the app | Ancestor of both inputs |

Excluded: every G2 to G7 branch (gameplay stays off; no migration 0011 in
the tree, the journal ends at 0010), website branches (`web/a5`, `web/a09`).
The `website/` folder in this branch is the staging copy, **not** the live
site (61d30bb); nothing here deploys it. The only conflict was
`EVIDENCE_REGISTER.md` (both sides added rows; both kept). `yarn.lock` merged
without conflict and `yarn install --immutable` accepts it, so no lockfile
was regenerated.

**API contract, app against 2192de6** (read from code): the app calls
`POST /identity/auth/google/complete {accessToken, deviceLabel?}`,
`POST /identity/auth/wallet/exchange {code, codeVerifier, deviceLabel?}`,
`POST /identity/account/delete {confirm: "DELETE"}`, `/identity/auth/refresh`,
`/identity/me`, `/identity/sessions`, `/identity/session/revoke*`. Each route
and schema exists in `backend/src/identity/http/router.ts` and
`validation.ts` on 2192de6 (`.strict()` schemas; the app sends no extra
field). The single-use exchange needs a fresh Supabase session: the app runs
a new PKCE sign-in on every tap and forwards the token at once
(`mobile/src/services/signInProviders.ts`), so a retry never reuses a spent
session. The wallet page on the live site (61d30bb `website/js/sign-in-page.js`)
accepts `?app=android&challenge=<43 chars>` and returns
`movenrun://auth/wallet?code=…`, which is what the app builds and parses
(`mobile/src/lib/signInMethods.ts`).

**Local results on 57f268d (CODE TESTED LOCALLY, not a build):**

| Check | Result |
|---|---|
| `yarn install --immutable` | Pass (lockfile unchanged) |
| Mobile `yarn test` / `tsc --noEmit` | 931/931 / pass |
| Shared `yarn test` / `tsc` | 156/156 / pass |
| Backend `typecheck`, `build`, `test:api`, `test` (local PostgreSQL 16, own cluster) | pass, pass, 21/21, 427/427 |
| `expo prebuild -p android --no-install --clean`, offline, scratch copy, no Maps key in the shell | Manifest as listed under "Prebuild manifest" below: `allowBackup="false"`, rules exclude all nine domains from cloud backup and device transfer, `usesCleartextTraffic="false"`, `LocationTaskService` removed, only `.MainActivity` exported, `applicationId`/`namespace` `io.movenrun.app`, minSdk 24 / target 36 / compile 36, `hermesEnabled=true`, `newArchEnabled=false` |
| Library manifests of the 21 autolinked native modules | Only expo-file-system's and expo-sharing's file providers (`exported="false"`), expo-location's service (removed), and permissions the app manifest strips. No clipboard provider (expo-clipboard is not installed) |
| 16 KB, package inspection (not build proof) | Re-read from Maven Central: fbjni 0.7.0 (`libfbjni`, `libc++_shared`), Fresco 3.6.0 (`libimagepipeline`, `libnative-filters`, `libnative-imagetranscoder`, `libgifimage`, `libstatic-webp`), arm64-v8a and x86_64: every LOAD `0x4000`. The 12 Expo local-maven AARs contain no `.so`. `react-android` and `hermes-android` 0.81.5 redirect to `repo.reactnative.dev`, which this workspace cannot reach: still "expected yes", not read. No 4 KB-aligned 64-bit library found |
| `yarn npm audit --environment production --recursive` (mobile) | 78 advisories in 21 packages (1 critical, 47 high, 26 moderate, 4 low). All but one are build-time tools (Expo CLI, Metro, Babel, plist/xmldom, node-gyp, undici, postcss, js-yaml, brace-expansion, react-devtools-core's shell-quote). The one that ships in the JS bundle: `decode-uri-component` 0.2.2 via `query-string` 7.1.3 (expo-router / React Navigation link parsing), moderate DoS on malformed percent-encoding (advisory: `<=0.4.2`). Not changed here (no dependency changes in QA0); owner decision R-QA0-A |

### Gates before the one free build

| Gate | State |
|---|---|
| G-A: PR for this branch shows a green `mobile-checks` run on the head commit | Pending (after the push) |
| G-B: X-05 done (Google provider and Web3 wallet enabled in Supabase, live sign-in verified on the website) | NOT DONE |
| G-C: X-08 Maps key restricted (steps below) | NOT DONE (owner) |
| G-D: EAS `preview` environment has the five variable names set | NOT CHECKED (owner; values never read here) |
| G-E: `EXPO_TOKEN` GitHub secret present; expo.dev Usage shows quota; nothing queued | NOT CHECKED (owner) |
| G-F: Owner's written approval for one build from this exact commit | NOT GIVEN |

### Maps key restriction (X-08), owner steps

1. From `movenrun/mobile`: `npx eas-cli@24.8.0 credentials -p android` →
   profile `preview` → Keystore → set up a new one (EAS keeps it; no quota).
   Copy the **SHA-1** fingerprint it shows.
2. Google Cloud Console → the MovenRun project → APIs & Services →
   Credentials → the Android Maps key → Edit.
3. Application restrictions: **Android apps** → Add → package name
   `io.movenrun.app`, SHA-1 from step 1 → Done.
4. API restrictions: **Restrict key** → tick only **Maps SDK for Android** →
   Save. (Changes can take a few minutes.)
5. Put the key value in Expo → project → Environment variables → `preview`
   as `GOOGLE_MAPS_ANDROID_API_KEY`, visibility Sensitive. Never in the repo
   or a chat.
6. Later, for Play: add the **Play app signing** SHA-1 (Play Console → Test
   and release → App integrity) to the same restriction.

### The one-build request (text for the owner to approve)

> Approve one EAS Free preview build: GitHub Actions → **EAS APK Build** →
> branch `preview/android-qa0-candidate` at commit `<head SHA from the PR,
> green mobile-checks>`, profile `preview` (APK, internal distribution, EAS
> environment `preview`). Uses one build of the monthly Free allowance;
> a failed build also counts and is not re-run without a fix and a new
> approval. Preconditions G-A to G-E above are met. No Play upload, no
> production profile, no merge.

### Handset checklist for that APK (all NOT RUN)

| # | Check | Script reference | State |
|---|---|---|---|
| H-1 | Cold start: Hermes bytecode in the bundle, three cold starts reach the first screen | Q0-1a–d, f; script step 1 | NOT RUN |
| H-2 | Hermes/H3: the Territory tab builds H3 cells with no `RangeError`/`TextDecoder` fatal in logcat (#94 fix) | Q0-1e | NOT RUN |
| H-3 | GPS route: foreground session records on real map tiles, tracking stops in the background, no "Allow all the time" | Q0-2; script steps 3–8 | NOT RUN |
| H-4 | Continue with Google (PKCE) against staging, then a second sign-in; after a 20-minute idle API | Q0-3; steps 15a, 15b, 15g | NOT RUN |
| H-5 | Continue with Wallet: return by `movenrun://auth/wallet`, by typed code, and after the app was killed; foreign challenge warning | Q0-4; steps 15c, 15d, 15f, 15h | NOT RUN |
| H-6 | Account deletion in the app (wallet and Google accounts) and on the web | Q0-5; steps 15e, 16 | NOT RUN |
| H-7 | Backup exclusion: a backup and restore brings back no app data | Q0-6 | NOT RUN |
| H-8 | Device transfer exclusion | Q0-6 (transfer part) | NOT RUN |
| H-9 | Offline session: save in airplane mode shows pending, verified once when the network returns; kill and relaunch resurrects no route | Steps 13, 14 | NOT RUN |
| H-10 | Permissions on the installed app: location fine/coarse only, no background, no cleartext, no clipboard provider, forged `movenrun://` links do nothing; deny and approximate-only paths | Q0-7a–e; steps 3, 4 | NOT RUN |

## What the build is (checked 17 Oct 2026 on `privacy/a2-android-backup-off`)

| Item | Value | Where |
|---|---|---|
| Profile | `preview`: `buildType: apk`, `distribution: internal`, `environment: preview` | `mobile/eas.json` |
| Package | `io.movenrun.app` | `mobile/app.json` |
| Version | `1.0.0`; `versionCode` from EAS (`appVersionSource: remote`), starts at 1, preview does not increment | `eas.json`, `easReleaseConfig.test.ts` |
| JS engine | Hermes (no `jsEngine` override; prebuild writes `hermesEnabled=true`) | `android16kPageSize.test.ts` |
| Architecture | Old architecture (`newArchEnabled: false`) | `androidRuntimePolicy.test.ts` |
| Target / compile SDK | 36 / 36, min 24 | `androidTargetSdk.test.ts` |
| Manifest | Fine and coarse location only (plus `INTERNET`, `VIBRATE`); backup and transfer off; cleartext off; no background location service | `androidBackupPolicy.test.ts`, `androidManifestHardening.test.ts`, `androidPrebuildManifest.test.ts` |
| CLI | `eas-cli@24.8.0`, pinned in `.github/workflows/eas-apk-build.yml` | |

**Variable names** (Expo → project → Environment variables → **preview**).
Values are the owner's; none go in the repository.

| Name | Needed for | Visibility |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | Every signed-in call (`https://…`, the Render API) | Plain text (it is inside the app anyway) |
| `EXPO_PUBLIC_SUPABASE_URL` | Continue with Google (`https://<ref>.supabase.co`) | Plain text |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Continue with Google. Publishable key only; a `sb_secret_` key is refused by the app | Plain text or Sensitive |
| `EXPO_PUBLIC_WEB_URL` | Optional: wallet sign-in page; defaults to `https://movenrun.xyz` | Plain text |
| `GOOGLE_MAPS_ANDROID_API_KEY` | Map tiles; without it the app says the map is unavailable | Sensitive |

Without the Supabase pair the Google button is hidden; without the API URL
sign-in cannot finish. Q0-3 to Q0-5 need all of them. Q0-1, Q0-2 and Q0-6 do
not.

## Versions, read from the repository (18 Oct)

`yarn.lock` and the installed packages agree: Expo SDK `expo@54.0.36`,
React Native `0.81.5`, `expo-location@19.0.8`, `react-native-maps@1.20.1`,
`expo-router@6.0.24`. There is no `expo-build-properties`, so the Android
levels come from React Native's version catalog
(`node_modules/react-native/gradle/libs.versions.toml`, used through
`expoAutolinking.useExpoVersionCatalog()` in the prebuild
`settings.gradle`): **minSdk 24, targetSdk 36, compileSdk 36**, build tools
36.0.0, NDK 27.1.12297006, AGP 8.11.0, Kotlin 2.1.20, Gradle wrapper 8.14.3.
Play's target API page (support.google.com/googleplay/android-developer/answer/11926878,
read 18 Oct) requires API 36 for new apps and updates from 31 Aug 2026;
target 36 meets it.

## Prebuild manifest (18 Oct)

`npx expo prebuild --platform android --no-install --clean` in a scratch
copy (none of its output is committed; the repo has no `android/`).
`app/src/main/AndroidManifest.xml`:

- `<application>`: `allowBackup="false"`,
  `dataExtractionRules="@xml/data_extraction_rules"` (all nine domains
  excluded from `cloud-backup` and `device-transfer`),
  `usesCleartextTraffic="false"`; no `fullBackupContent`, no
  `networkSecurityConfig`, no `debuggable`.
- Permissions kept: `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`,
  `INTERNET`, `VIBRATE`. Removed (`tools:node="remove"`): background
  location, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`,
  `SYSTEM_ALERT_WINDOW`, external storage read and write, `READ_MEDIA_IMAGES`,
  `RECORD_AUDIO`.
- Components: `.MainActivity` only (`exported="true"`, `singleTask`);
  expo-location's `LocationTaskService` carries `tools:node="remove"`. No
  receiver or provider of the app's own.
- Intent filters: `MAIN`/`LAUNCHER`, and `VIEW` + `DEFAULT` + `BROWSABLE`
  with `scheme="movenrun"` (no host, no `autoVerify`, no http or https).
  This is the sign-in return and the **F-06** surface: any installed app may
  declare `movenrun://` too and can receive a return the browser hands off.
  Unchanged here; the fix is X-23 (verified App Link), an owner decision.
- `<queries>`: one intent, `VIEW` + `BROWSABLE` + `https`.
- The debug manifest sets `usesCleartextTraffic="true"` with
  `tools:replace` for Metro; release builds do not use it.

`androidPrebuildManifest.test.ts` runs the same plugin chain offline (as
`expo config --type introspect` does) and pins all of the above.

Library manifests in `node_modules` add, at merge time: expo-file-system's
`FileSystemFileProvider` and expo-sharing's `SharingFileProvider` (both
`exported="false"`), `<queries>` for `OPEN_DOCUMENT_TREE`, `SEND */*` and
Custom Tabs, and expo-file-system's storage permissions, which the removals
above strip. `androidManifestHardening.test.ts` fails if any of them gains an
exported component or a cleartext switch.

**Only the real Gradle build can prove** (no Android SDK here, so no
`processReleaseManifest`): the merged manifest including Maven AARs (Google
Play services for Maps, AndroidX startup and profile installer, which brings
`ProfileInstallReceiver`, exported but guarded by `DUMP`); that the
`tools:node="remove"` entries took effect; the final permission list,
including AndroidX's signature-level
`DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`; `targetSdkVersion` in the APK;
the Maps `API_KEY` meta-data; 16 KB alignment of the native libraries. The
`aapt2` lines below and Q0-7 on the phone cover these.

## The single Free-tier preview build (plan, not started)

| Item | Value |
|---|---|
| Commit | The head of `preview/android-qa0-candidate` (app code = 57f268d) that its PR shows with a green `mobile-checks` run. `privacy/a2-android-backup-off` has the same `mobile/` tree, but its backend predates the live #112 exchange, so only the candidate's CI tests the app and the served API together. One commit, recorded before the run |
| Profile | `preview` (`apk`, `internal`, EAS environment `preview`), through GitHub Actions **EAS APK Build** (`eas-cli@24.8.0 build -p android --profile preview --non-interactive`) |
| Variables (names only, EAS `preview` environment) | `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `EXPO_PUBLIC_WEB_URL` (optional), `GOOGLE_MAPS_ANDROID_API_KEY` |
| GitHub secret | `EXPO_TOKEN`, owner-created; never used outside that workflow |
| Prerequisite X-08 | The Maps key is restricted to Android apps, package `io.movenrun.app` with the SHA-1 of the EAS preview keystore (step 4), and to the Maps SDK for Android API. Without the SHA-1 the APK shows grey tiles and step 7 of the handset script fails |
| Also before the run | X-05, X-06, X-07, X-21 done (`ANDROID_DEVICE_GATE_PLAN.md` preconditions); expo.dev → Usage shows quota left; no other build queued |
| Quota | One build. A failed build also counts; fix in a commit before any second run |
| After the build | The static `aapt2`/`zipalign` checks below, then the handset operator runs `HANDSET_TEST_SCRIPT.md` steps 1–20 and the QA0 checks Q0-1 to Q0-5, Q0-7, then Q0-6 last, on that APK |

What the handset operator proves on this APK: Hermes cold start (Q0-1);
foreground-only location, no "Allow all the time", tracking stops in the
background (Q0-2, steps 3–8); Google sign-in and repeat (Q0-3, 15a–15b);
wallet sign-in by return or code (Q0-4, 15c–15f); deletion (Q0-5, 15e, 16);
the F-06 warning on a sign-in the app did not start (15h) and which apps
answer `movenrun://` (Q0-7c, QA-04 input for X-23); forged callback links do
nothing (Q0-7d, e); no cleartext, no background service, no clipboard
provider on the installed app (Q0-7a, b); backup and transfer excluded
(Q0-6). Evidence rules from the device gate plan apply.

## Steps

1. **Pick the commit.** The branch head you want on the phone. Its
   `mobile-checks` run (job "Mobile type-check": type-check, tests, Hermes
   export) must be green. The APK workflow does not run the tests.
2. **Expo account and project (free).** Sign in at expo.dev; the project with
   id `73abbcb8-9466-4e52-b912-e2812e170abc` must be listed under your
   account. If not, see the operator guide (a new `eas init` changes one line
   of `app.json`, which needs a review).
3. **Variables.** Set the names above in the **preview** environment.
4. **Signing key and Maps SHA-1 (no quota).** From `movenrun/mobile`:
   `npx eas-cli@24.8.0 login`, then `npx eas-cli@24.8.0 credentials -p
   android` → `preview` → set up a new keystore (EAS keeps it). Copy the
   **SHA-1** and add it, with package `io.movenrun.app`, to the Maps key's
   Android restriction in Google Cloud Console. Skip and step 5 still makes
   one (the build creates the keystore in non-interactive mode), but then the
   first APK shows no map tiles until the restriction is updated.
5. **`EXPO_TOKEN`.** expo.dev → Account settings → Access tokens → create;
   GitHub → repository → Settings → Secrets and variables → Actions →
   `EXPO_TOKEN`. Check an existing one is not revoked.
6. **Start the build (uses quota).** GitHub → Actions → **EAS APK Build** →
   Run workflow → choose the branch from step 1 → Run. The job prints the
   Expo build page. The Free queue can take a while; do not start a second
   run while one is queued.
7. **If it fails:** open the Expo build log, read the first error, and fix it
   in a commit before any re-run. Every started build counts, failed or not.
8. **Download** the APK from the build page (Install / Download). Rename it
   `movenrun.apk`. Note the **build id**, the **commit** and the **versionCode**.

## Static checks on the APK (computer, no phone)

```bash
# Hermes bytecode (Q0-1a): expect c61f bc03 c103 191f
unzip -p movenrun.apk assets/index.android.bundle | head -c 8 | od -An -tx1

# Package, version, SDKs
aapt2 dump badging movenrun.apk | head -3

# Merged manifest: backup, transfer, cleartext, permissions, components
aapt2 dump xmltree movenrun.apk --file AndroidManifest.xml \
  | grep -E "allowBackup|dataExtractionRules|usesCleartextTraffic|uses-permission|exported|LocationTaskService|ClipboardFileProvider" -A1

# No secrets in the bundle (from movenrun/)
mkdir -p /tmp/apk && unzip -o -q movenrun.apk assets/index.android.bundle -d /tmp/apk
node scripts/check-secrets.mjs /tmp/apk

# 16 KB (R-04 on the APK)
zipalign -v -c -P 16 4 movenrun.apk | tail -1
```

Expected: Hermes magic; `package: name='io.movenrun.app'`, `versionName='1.0.0'`,
`targetSdkVersion:'36'`; `allowBackup` false, `dataExtractionRules` set,
`usesCleartextTraffic` false; permissions only `ACCESS_FINE_LOCATION`,
`ACCESS_COARSE_LOCATION`, `INTERNET`, `VIBRATE` (and AndroidX's
`DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, which is signature-level and
harmless); `exported` true only on `MainActivity` (and AndroidX's
`ProfileInstallReceiver`, which requires the `DUMP` permission); no
`LocationTaskService`, no `ClipboardFileProvider`; the secrets check passes;
`Verification successful`. The `od` line must show the magic bytes; the
readelf loop is in `ANDROID_16KB_PAGE_SIZE.md`.

## On the phone

`HANDSET_TEST_SCRIPT.md` and the QA0 checks in `ANDROID_DEVICE_GATE_PLAN.md`
on the same APK: Q0-1 Hermes/H3 cold start, Q0-2 GPS and background, Q0-3
Google, Q0-4 wallet (needs X-21 on the apex), Q0-5 deletion, Q0-7 manifest on
the installed app, Q0-6 backup and transfer last. Evidence rules there apply
(no coordinates, emails, wallet addresses, codes).

Record in `EVIDENCE_REGISTER.md`: build id, commit, versionCode, phone model,
Android version, PASS or FAIL per check, and where the evidence files are
kept (outside the repository).

## Quota plan for the month

One preview APK for the device gate, one spare for a fix, one production AAB
after the merge (X-14, X-09). Check expo.dev → Usage before step 6.
