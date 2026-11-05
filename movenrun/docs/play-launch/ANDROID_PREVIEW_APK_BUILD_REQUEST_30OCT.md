# Approved-build request: one Android preview APK (30 Oct 2026)

**Status: NOT APPROVED. NOT RUN.** Nothing here was run. No EAS, Play, Expo or
other hosted service was called to write it. Approving this request is an owner
action; until then the answer to "is there a build" is no, and every handset row
in `ANDROID_V1_PHONE_TEST_PLAN.md` stays NOT RUN.

## 1. The request (text for the owner to approve or refuse)

> Approve exactly one EAS preview build for MovenRun:
>
> - **Source:** repository `suhaib155/arena`, commit `<FULL 40-CHARACTER SHA>`
>   (section 2), on a dedicated branch pointing at that commit.
> - **Workflow:** GitHub Actions, **EAS APK Build** (`eas-apk-build.yml`),
>   Run workflow on that branch. It runs
>   `eas-cli@24.8.0 build -p android --profile preview --non-interactive`.
> - **Profile:** `preview` (APK, internal distribution, EAS environment
>   `preview`). Not `production`. No AAB.
> - **Quota:** 1 build from the Expo plan's monthly allowance (section 4).
> - **Not included:** Play upload, `eas submit`, `eas update`, a second run,
>   billing, any production profile, any backend or Render deploy.
>
> Approved by: ____________  Date: ____________  Commit as approved: ____________

## 2. The exact commit

The candidate is the head of the Android integration line after the
independent review of branch `feat/android-rc-truth-30oct` and its merge. The
owner (or the coordinator) fills the SHA only after all of these hold:

| Check | How |
|---|---|
| The commit is the head of the dedicated build branch | `git rev-parse HEAD` equals the SHA in section 1; `git status --porcelain` is empty |
| Strict CI is green on that exact commit | `mobile-checks`, the backend checks and the shared checks, one run each on the SHA |
| The app tree is the reviewed one | `git diff --stat 745cfef..<SHA> -- movenrun/mobile movenrun/shared movenrun/backend` shows nothing, or only changes the reviewer listed. `745cfef` is the last commit that changed app source on this branch; later commits on it are documents |
| Excluded work is absent | No #154 drift rule, no #166 stationary-risk code in `mobile/`, no gameplay branch, no migration 0011 (the journal ends at 0010), no website branch: `releaseCandidateMovementRules.test.ts` passes |
| Version | `app.json` version `1.0.0`; `eas.json` `appVersionSource: remote`; preview reuses the current remote versionCode (it does not increment). `eas build:version:get -p android` reads it; that is a hosted read and needs an Expo login |

The EAS workflow builds a branch head and takes no SHA input. "At an exact SHA"
therefore means: create a branch whose head is that commit, and dispatch the
workflow on it. The workflow does not run tests, so CI must already be green.

## 3. Environment variable NAMES (never values)

Set in Expo, project, Environment variables, environment **preview**. The app
reads exactly these names (the guard test fails on any other `process.env`
read). Check names in the dashboard; never read, paste or commit a value.

| Name | Needed for | Visibility | If missing |
|---|---|---|---|
| `EXPO_PUBLIC_API_URL` | Every signed-in call | plain text | No sign-in, no verification; guest play only |
| `EXPO_PUBLIC_SUPABASE_URL` | Continue with Google | plain text | Google button hidden |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Continue with Google (publishable key only; a secret-format key is refused) | plain text or Sensitive | Google button hidden |
| `EXPO_PUBLIC_WEB_URL` | Wallet sign-in page; optional | plain text | Defaults to the apex domain |
| `GOOGLE_MAPS_ANDROID_API_KEY` | Native Maps key, written to the manifest at build time | Sensitive | No key; `extra.maps.androidConfigured=false`; the app says the map is unavailable |

GitHub secret name `EXPO_TOKEN` must exist (the workflow stops if it is empty).
The server-only stationary-risk variable is not an app variable and must not be
set in EAS; no app source names it.

## 4. Quota, cost and rollback

| Item | Statement |
|---|---|
| Expected quota use | One Android build in the Expo Free plan's monthly allowance. Assume a failed or cancelled build also counts (Expo billing rules were not verified here). Check expo.dev Usage before dispatch: allowance left, nothing queued |
| Budget for this release | 3 Android builds in total: this preview APK, 1 spare only after a fix commit and a fresh approval, 1 production AAB after merge and a separate approval |
| Cost | No payment method, paid plan or billing change. If the allowance is exhausted the build waits or is refused; do not upgrade a plan to proceed |
| If the build fails | Do not re-run. Record the build id and failure line. Fix on a new commit, get review and CI, then ask for a new approval naming the new SHA. Nothing is deployed by a build, so there is nothing to roll back in production |
| If the build succeeds but a gate fails | The APK is a test artifact only. Delete it from the phone; no store, no users. Fixes follow the same new-commit, new-approval path |
| Rollback of the dedicated branch | Delete the dedicated build branch after the run; the integration branch is untouched |

## 5. Preconditions the owner confirms before dispatch

| # | Gate | State |
|---|---|---|
| P1 | The SHA in section 1 and the checks in section 2 | open |
| P2 | Expo Usage shows allowance left and nothing queued | not checked |
| P3 | The five names in section 3 exist in environment `preview` | not checked |
| P4 | Maps key restriction holds the SHA-1 below | not checked |
| P5 | `EXPO_TOKEN` is present and not revoked | not checked |
| P6 | Which API the phone uses (decision O-3): hosted staging (old movement rules) or a separately approved backend deploy first. No Render action is part of this request | open |
| P7 | Providers (Google, wallet) enabled in Supabase (X-05) if H-8 is to run; otherwise H-8 stays BLOCKED and the rest run | not done |

### Maps key certificate SHA-1 sources (names and places, no values)

The Android Maps key is restricted to package `io.movenrun.app` plus signing
certificate SHA-1 fingerprints. Two different certificates matter:

| Certificate | Where the fingerprint comes from | Needed for |
|---|---|---|
| Preview APK signer: the EAS-managed Android keystore for `io.movenrun.app` | `npx eas-cli@24.8.0 credentials -p android`, view-only. Do not generate a new keystore unless the owner decided to; viewing needs an Expo login and uses no build | H-11(a) on this APK |
| Play App Signing key | Play Console, Test and release, App integrity. Does not exist until a Play developer account does (X-01) | Any Play-installed build |

Both must be on the same key before a Play-installed build shows tiles. Whether
the preview and production profiles share one keystore is not verified here;
read it in `eas credentials` rather than assuming. Never paste a fingerprint
into a public place; record "present" or "matches".

## 6. Acceptance commands on the downloaded artifact

Run on the computer first, then on the phone. Record build id, commit and
versionCode. These are the same checks as H-1, H-9 and H-12.

```bash
# Checksum (record the SHA-256; compare with what the EAS page offers, if any)
sha256sum movenrun.apk

# Built from the approved commit: EAS build page, or
npx eas-cli@24.8.0 build:view <build id>        # commit equals section 1, profile preview

# Package, version, SDK levels
aapt2 dump badging movenrun.apk | head -3
# expect io.movenrun.app, versionName 1.0.0, minSdk 24, targetSdk 36

# Hermes bytecode in the bundle (expect: c6 1f bc 03 c1 03 19 1f)
unzip -p movenrun.apk assets/index.android.bundle | head -c 8 | od -An -tx1

# Signer
apksigner verify --print-certs movenrun.apk     # record "matches"; do not publish

# Manifest: backup, transfer, cleartext, permissions, exported components
aapt2 dump xmltree movenrun.apk --file AndroidManifest.xml \
  | grep -E "allowBackup|dataExtractionRules|usesCleartextTraffic|uses-permission|exported|LocationTaskService" -A1
aapt2 dump xmltree movenrun.apk --file res/xml/data_extraction_rules.xml

# No secrets in the bundle (from movenrun/)
mkdir -p scratch && unzip -o -q movenrun.apk assets/index.android.bundle -d scratch
node scripts/check-secrets.mjs scratch

# 16 KiB: zip alignment and every 64-bit library
zipalign -v -c -P 16 4 movenrun.apk | tail -1          # Verification successful
mkdir apk && unzip -q movenrun.apk 'lib/*' -d apk
for so in apk/lib/arm64-v8a/*.so apk/lib/x86_64/*.so; do
  printf '%s ' "$so"; llvm-readelf -lW "$so" | awk '/LOAD/{print $NF}' | sort -u | tr '\n' ' '; echo
done                                                    # only 0x4000 or larger

# Hermes cold boot on the phone, three times (H-1)
adb install -r movenrun.apk
adb logcat -c
adb shell am force-stop io.movenrun.app
adb shell am start -W -n io.movenrun.app/.MainActivity     # Status: ok
adb logcat -d -s ReactNativeJS:V AndroidRuntime:E | grep -iE "RangeError|Unknown encoding|FATAL|TextDecoder"   # no output

# Link parser (H-9): only MainActivity handles the scheme
adb shell cmd package query-activities --components -a android.intent.action.VIEW -d "movenrun://auth/callback"
adb shell am start -W -a android.intent.action.VIEW -d "movenrun://auth/callback?code=x" io.movenrun.app   # app opens, still signed out

# Backup and transfer (H-12b)
aapt2 dump xmltree movenrun.apk --file AndroidManifest.xml | grep -E "allowBackup|dataExtractionRules"
adb shell dumpsys package io.movenrun.app | grep -E "^ *(pkgFlags|flags)="      # no ALLOW_BACKUP
adb shell bmgr backupnow io.movenrun.app                                         # Backup is not allowed
adb shell dumpsys backup | grep -i movenrun                                      # absent
# then the real phone-to-phone transfer in ANDROID_DEVICE_GATE_PLAN.md (e): signed out, no XP, no pending route

# Size: record the file size; investigate a jump of more than 20% over the QA0 estimate
ls -l movenrun.apk
```

Expected permission list: fine and coarse location, `INTERNET`, `VIBRATE`, plus
AndroidX's signature-level receiver permission. No background location,
foreground service, overlay, storage, media or audio.

## 7. Outcome fields (filled after, never before)

| Field | Value |
|---|---|
| EAS build id | NOT RUN |
| Built from commit | NOT RUN |
| versionCode | NOT RUN |
| APK SHA-256 | NOT RUN |
| Static checks (section 6, computer) | NOT RUN |
| Handset rows H-1 to H-12 | NOT RUN |
