# Android binary acceptance: what the inspector checks and how to run it

Checkpoint: 22 October 2026
Source heads: #125 preview/android-qa0-candidate 15f7f87 (Android facts); #112 2326aa6 (this worktree); live API 2192de6; live website 61d30bb.
Claim classes: SOURCE VERIFIED / LOCAL TEST CONFIRMED / REVIEWER REPORTED / OWNER-PROVIDER GATED / NOT RUN / UNKNOWN.

**Nothing in this document was run against a real artifact.** No APK or AAB has been built from #125 (NOT RUN). The script was exercised only on synthetic zips and a hand-written manifest fixture (LOCAL TEST CONFIRMED, see section 7). aapt2, apkanalyzer, bundletool, zipalign and apksigner were absent in the authoring container, so those code paths have never executed (NOT RUN). Expect to adjust the manifest parser the first time it meets real aapt2 output; it fails safe (a manifest it cannot parse gives NOT RUN, never PASS).

## 1. Script

`research/play-assurance/tools/android-artifact-acceptance.sh` (bash). Read-only on an existing owner-supplied APK or AAB. It never builds, never uploads, never calls the network, writes only to a private temp directory it deletes, and prints certificate digests only (no key material).

```
bash research/play-assurance/tools/android-artifact-acceptance.sh /path/to/app.apk
bash research/play-assurance/tools/android-artifact-acceptance.sh /path/to/app.aab
bash research/play-assurance/tools/android-artifact-acceptance.sh --self-test
```

Exit codes: 0 every check ran and passed; 1 any FAIL; 2 artifact missing (`NOT RUN / ARTIFACT MISSING`); 3 any check NOT RUN; 4 only `--self-test`, discipline broken. A missing tool prints `NOT RUN / TOOL MISSING: <tool>` for each affected check and the overall result can never be PASS. FAIL outranks NOT RUN (exit 1 even if some checks did not run).

## 2. Checks and why

| Check | Pass rule | Why | Source basis |
|---|---|---|---|
| package | `io.movenrun.app` | Maps key, App Link and Play listing are bound to it | app.json:21 @ 15f7f87 (SOURCE VERIFIED) |
| versionCode | printed | EAS remote counter; no value in app.json | eas.json:3-4,16; app.json:5,20-42 |
| targetSdk | >= 36 | Play requires API 36 for new apps/updates from 31 Aug 2026 | OFFICIAL_SOURCES section 6 |
| compileSdk | >= 36 | Not set in repo; resolved at build (RN 0.81.5 catalog); androidTargetSdk.test.ts never run | ANDROID_FACTS section 1 |
| minSdk | printed | Compare with device plan (Android 12+) | ANDROID_DEVICE_GATE_PLAN.md |
| permissions | within allowed set; FAIL on any forbidden | Foreground-only location, no background/overlay/audio/storage | app.json:28-41 |
| allowBackup | `false` | Precise route queue sits unencrypted in AsyncStorage | app.json:22; withNoBackupTransfer.js |
| usesCleartextTraffic | `false` | Set by config plugin, not app.json | withAndroidHardening.js:25-29 |
| dataExtractionRules | attribute present | Android 12+ backup/transfer exclusion | withNoBackupTransfer.js:19-39 |
| exported components | each exported one has an intent-filter; all listed | Unfiltered exported component is an attack surface; app.json has no explicit intentFilters so the real list is UNKNOWN until inspected | ANDROID_FACTS section 1 |
| custom scheme | `movenrun` in an intent-filter `<data>` | Google and wallet return links | app.json:7 |
| ABI | `arm64-v8a` present | Play 64-bit requirement | |
| 16 KB | every 64-bit `lib/*/*.so` LOAD align >= 2**14 (`llvm-objdump -p`, fallback `readelf -lW`) | Play 16 KB page rule for API 35+ apps; deadline text says 1 Feb 2027 (changing guidance) | OFFICIAL_SOURCES section 5 (retrieved 2026-10-22) |
| zipalign | `zipalign -c -P 16 -v 4` says Verification successful | Uncompressed .so alignment inside the zip | same |
| signing | SHA-1 and SHA-256 printed | Both go on the restricted Maps key (section 4) | |
| Hermes | `assets/index.android.bundle` starts `c6 1f bc 03 c1 03 19 1f` | Confirms bytecode, so the h3-js patch matters (section 5) | |

Allowed permissions: ACCESS_COARSE_LOCATION, ACCESS_FINE_LOCATION (app.json:28-31), INTERNET (fetch-based networking; not declared in app.json, UNKNOWN until the manifest is read). Provisional Expo/RN-normal extras, none confirmed by source: ACCESS_NETWORK_STATE (RN/Expo networking), VIBRATE (expo-haptics), `io.movenrun.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` (AndroidX). Any other permission FAILs; the owner reviews it and either removes it or extends the list in the script with a reason. Forbidden (FAIL): ACCESS_BACKGROUND_LOCATION, FOREGROUND_SERVICE, FOREGROUND_SERVICE_LOCATION, SYSTEM_ALERT_WINDOW, RECORD_AUDIO, READ_EXTERNAL_STORAGE, WRITE_EXTERNAL_STORAGE, READ_MEDIA_IMAGES (the last three plus FOREGROUND_SERVICE are in app.json blockedPermissions:32-41).

Deliberate choices: only 64-bit ABIs (arm64-v8a, x86_64) gate the 16 KB check, because the Play rule is for 64-bit devices (OFFICIAL_SOURCES section 5); 32-bit misalignment is printed as information. For an AAB the script derives a universal APK locally with bundletool and runs the APK checks on it (labelled in the output); the signing check on an AAB uses `keytool -printcert -jarfile` (upload-key certificate), not apksigner. A bundletool universal APK is not the Play-delivered binary: repeat the ABI/16 KB check in Play Console's App bundle explorer after upload (X-12).

## 3. Owner run commands

Tools (all local, no upload): Android SDK build-tools 35.0.0 or newer for `aapt2`, `zipalign` (with `-P`), `apksigner`; cmdline-tools for `apkanalyzer`; `bundletool` jar from https://github.com/google/bundletool/releases (set `BUNDLETOOL_JAR=/path/bundletool.jar`; needs `java`); `llvm-objdump` from the NDK or LLVM; `unzip`. Set `ANDROID_HOME` so the script finds build-tools. URLs are pointers; version availability not re-verified.

```
# preview APK from EAS (download the file yourself)
bash research/play-assurance/tools/android-artifact-acceptance.sh ~/Downloads/movenrun-preview.apk

# production AAB
BUNDLETOOL_JAR=~/tools/bundletool.jar bash research/play-assurance/tools/android-artifact-acceptance.sh ~/Downloads/movenrun.aab

# to hand-check an AAB yourself (writes locally, never uploads)
java -jar bundletool.jar build-apks --bundle=movenrun.aab --output=movenrun.apks --mode=universal
unzip -p movenrun.apks universal.apk > universal.apk
```

Save the full output next to the build id and commit in EVIDENCE_REGISTER.md. A non-zero exit is not a pass.

## 4. Maps signing chain (OWNER-PROVIDER GATED)

Grey map tiles mean a signing certificate is missing from the Maps key (HANDSET step 17). The key is injected at build from `GOOGLE_MAPS_ANDROID_API_KEY` (app.config.js:38,47-65).

| Build | Signer | SHA-1 comes from | Status |
|---|---|---|---|
| Preview APK (EAS, internal) | EAS-managed keystore; whether preview and production share one keystore is UNKNOWN | the script's `signing` line, or `eas credentials` | NOT RUN |
| Play-installed build | Play App Signing key (Google re-signs) | Play Console > Release > Setup > App signing > "App signing key certificate" SHA-1 | no Play account yet |
| Upload key (AAB) | EAS upload keystore | the script's keytool line; not the one devices see | NOT RUN |

Both the preview-keystore SHA-1 and the Play App Signing SHA-1 must be on the restricted key (Android apps, package `io.movenrun.app`). The upload-key SHA-1 alone is wrong for Play-installed builds (Android App Links docs say the local fingerprint "will usually not match", OFFICIAL_SOURCES section 10). The script prints digests only; compare them by eye or by pasting into the Cloud Console.

## 5. h3-js 4.5.0 Hermes patch check

Patch `.yarn/patches/h3-js-npm-4.5.0-64ee667011.patch` replaces `new TextDecoder("utf-16le")` (Hermes cannot build it) in the browser/es/cjs dist files (ANDROID_FACTS section 4, SOURCE VERIFIED). Local state: installed `node_modules/h3-js` 4.5.0 has 0 occurrences of `utf-16le` in `dist/h3-js.js` and `dist/browser/h3-js.js` (LOCAL, grep 2026-10-22). Whether the EAS build applies the patch is UNKNOWN (not built). The shipped bundle is Hermes bytecode, so grep cannot see it: the script's Hermes check only proves bytecode; the proof of h3 is on the phone (a zone/map screen that computes cells without a crash, HANDSET steps 5-7) plus the existing `h3HermesRuntime.test.ts` (NOT RUN). Optional pre-build check: `grep -c utf-16le node_modules/h3-js/dist/browser/h3-js.js` on the EAS build machine's install must print 0.

## 6. Device and OS matrix (owner; all NOT RUN)

| Axis | Minimum | What to look for |
|---|---|---|
| Android 16 (API 36) | one phone or emulator | target-level behaviour: edge-to-edge, back gesture, permission dialogs |
| Android 15 | one phone | same |
| 16 KB page size | a 16 KB device or an emulator image with 16 KB pages (Android Studio, Android 15+) | cold start, map, h3 cell computation; `adb shell getconf PAGE_SIZE` prints 16384 |
| Low-end | 2-3 GB RAM phone, small screen, largest font | no clipped CTAs (HANDSET 18), no crash |
| Permission denial | deny location; choose approximate only; revoke while running | HANDSET 3-4; clear explanation, no crash, no fabricated route |
| Slow or offline network | airplane mode during save; throttled link; API idle 20 min | HANDSET 14 and 15g; pending then verified once; never an endless spinner |
| Battery saver | on, during a 10-minute session | foreground-only watch may be throttled; record behaviour, no background claim is made |

## 7. Self-test and evidence

`--self-test` builds a synthetic zip (not an APK) in a temp directory, hides the build tools, and asserts: tool-missing prints `NOT RUN / TOOL MISSING`, FAIL beats NOT RUN, the ABI and Hermes checks FAIL on the fake, NOT RUN forces exit 3, and the manifest parser reads a hand-written aapt2-style fixture (the fixture is not real aapt2 output). It exits 3 when discipline holds and can never exit 0. `research/play-assurance/tests/androidAcceptanceScript.test.ts` runs the script with no argument, a missing path and `--self-test` (3 tests pass, LOCAL TEST CONFIRMED). A separate smoke test on a synthetic APK holding a system `.so` showed the ELF check FAIL at align 4096 and the Hermes check PASS on the magic bytes (LOCAL, ad hoc, not committed).

## 8. Mapping to the handset gates

HANDSET_TEST_SCRIPT.md numbers steps 1-20, 15a-15h; it does not define labels H-1 to H-10 (LAUNCH_GATES_SOURCE_OF_TRUTH.md:18,37 uses that name for the whole script). Mapping of this script's results is therefore by step, and the H-1..H-10 numbering is UNKNOWN until the owner fixes it.

| Script result | Feeds | Does not replace |
|---|---|---|
| package, versionCode, signing digests | X-04 build record; Maps SHA list; step 17 | a phone run |
| permissions, allowBackup, dataExtractionRules | Data safety and policy declarations (PLAY_DECLARATION_DRAFTS.md) | steps 3-4 permission behaviour |
| targetSdk, ABI, 16 KB, zipalign | X-12 App bundle explorer re-check | the 16 KB device run (section 6) |
| Hermes, h3 patch | steps 5-8 map and cell behaviour | the on-device run |
| scheme `movenrun`, exported components | steps 15a, 15d, 15f, 15h | QA-04 (does the wallet browser hand the link back) |

Deep link and F-06: the app owns the custom scheme, so any app or page can fire `movenrun://auth/wallet?code=...`; AUTH_SECURITY_REVIEW.md F-06 records this as residual (RFC 8252 section 8.6) with an App Link as the later fix (X-23). The script lists the intent-filters so the owner can confirm no `https` filter or extra scheme exists and that none claims `autoVerify` without `assetlinks.json`. Step 15h stays a phone check.

A script PASS is a precondition, not a gate pass. A step not run is not a pass.

## Integration digest
- Affected paths: `research/play-assurance/tools/android-artifact-acceptance.sh`, `research/play-assurance/tests/androidAcceptanceScript.test.ts`, this file. No change to #125/#127/#128/#129.
- Evidence: 3/3 script tests pass (LOCAL TEST CONFIRMED); real-tool paths NOT RUN; facts @ 15f7f87.
- Conflicts: none known. Proposed patch text only: if #125 adds `expo-build-properties`, update the targetSdk note in section 2.
- Next decisions (max 3): (1) owner builds one preview APK and runs the script; (2) fix the H-1..H-10 numbering; (3) decide whether the extra permissions in section 2 are accepted.
