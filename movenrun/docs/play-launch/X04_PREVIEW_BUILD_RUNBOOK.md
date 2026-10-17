# X-04: the one free preview APK, step by step

**APPROVAL: starting the build uses one build from the Expo Free plan's
monthly allowance.** Everything before step 5 is free and uses no quota.
Nothing here needs a payment method, a paid plan or a Google Play account.
Background and account details: `LIVE_SETUP_OPERATOR_GUIDE.md` "Free EAS
readiness".

## What the build is (checked 17 Oct 2026 on `privacy/a2-android-backup-off`)

| Item | Value | Where |
|---|---|---|
| Profile | `preview`: `buildType: apk`, `distribution: internal`, `environment: preview` | `mobile/eas.json` |
| Package | `io.movenrun.app` | `mobile/app.json` |
| Version | `1.0.0`; `versionCode` from EAS (`appVersionSource: remote`), starts at 1, preview does not increment | `eas.json`, `easReleaseConfig.test.ts` |
| JS engine | Hermes (no `jsEngine` override; prebuild writes `hermesEnabled=true`) | `android16kPageSize.test.ts` |
| Architecture | Old architecture (`newArchEnabled: false`) | `androidRuntimePolicy.test.ts` |
| Target / compile SDK | 36 / 36, min 24 | `androidTargetSdk.test.ts` |
| Manifest | Fine and coarse location only (plus `INTERNET`, `VIBRATE`); backup and transfer off; cleartext off; no background location service | `androidBackupPolicy.test.ts`, `androidManifestHardening.test.ts` |
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
