# Android QA0 device matrix

Every check here is **NOT RUN**. Track A had no phone and built no APK, so there
is no device result to report. This is the protocol for whoever runs QA0 on a
signed release build of `io.movenrun.app`. Do not use an EAS build quota to run
it without the owner's approval.

## Devices

| Slot | Profile | Why |
|---|---|---|
| D1 | The build's minSdk (expected Android 7.0, API 24; confirm with QA0-02), 2 to 3 GB RAM | The lowest supported version; slow storage and GPS |
| D2 | Android 12 to 13 mid-range (for example Samsung A-series) | Most common class; approximate-location toggle; aggressive battery saver |
| D3 | Android 15 or 16 Pixel | Current platform; 16 KB page size checks; predictive back |
| D4 | Any device with 320 dp width, or an emulator set that way | Large-font and narrow-layout checks |

## Build checks (once per APK or AAB)

| Id | Check | How | Pass when | Result |
|---|---|---|---|---|
| QA0-01 | h3-js starts under Hermes | Cold start the signed release build | No `RangeError: Unknown encoding: utf-16le` in `adb logcat`; Home renders. The repo's `h3HermesRuntime.test.ts` covers this locally, but only a signed build proves it | NOT RUN |
| QA0-02 | SDK levels | `aapt2 dump badging` on the APK | minSdk and targetSdk match the release plan. The repo sets neither, so they come from Expo SDK 54's defaults (expected 24 and 36, not verified here) | NOT RUN |
| QA0-03 | 16 KB page alignment | `zipalign -c -P 16 -v 4 app.apk` and check every `.so` | All native libraries aligned to 16 KB | NOT RUN |
| QA0-04 | Merged manifest | `aapt2 dump xmltree --file AndroidManifest.xml` | Only coarse and fine location; no background location, foreground service, `LocationTaskService`, overlay or storage permissions; `usesCleartextTraffic="false"` | NOT RUN |
| QA0-05 | Backup off | Same dump | `allowBackup="false"`, and the data-extraction rules from `withNoBackupTransfer` exclude app data from device transfer | NOT RUN |
| QA0-06 | Deep-link scheme | Same dump | One intent filter for the `movenrun` scheme plus the launcher. No http(s) app links or other schemes. In-app, only `auth/callback` and `auth/wallet` act on a deep link's parameters | NOT RUN |
| QA0-07 | Maps key restriction | Google Cloud console, read only | Key restricted to Android apps with package `io.movenrun.app` and the release SHA-1 (Play App Signing key if used). Map tiles load on the device | NOT RUN |
| QA0-08 | Exported components | Same manifest dump | Only the main activity is exported. Any other exported activity, service, receiver or provider is listed with its reason | NOT RUN |
| QA0-09 | Preview and Play keys differ | Compare the upload key, the Play App Signing key and the preview build's key | Each has its own SHA-1, and the Maps key lists only the ones that should load tiles | NOT RUN |

## Device checks (each device)

| Id | Check | Steps | Pass when | Result |
|---|---|---|---|---|
| QA0-10 | First run | Fresh install, open | Welcome, Terms checkbox, then intro, then Home. No location prompt before Move | NOT RUN |
| QA0-11 | Permission flow | Move, Allow Location, "Only this time" | Session starts; no background prompt ever | NOT RUN |
| QA0-12 | Denied | Deny twice, return to Move | "Open Settings" opens app settings. Note whether the copy still mentions a demo route (known defect) | NOT RUN |
| QA0-13 | Approximate only | Grant approximate location (Android 12+) | No distance is counted; a clear message, not a silent stall | NOT RUN |
| QA0-14 | Services off | Turn location off, press Start | "Open Settings" path, no crash | NOT RUN |
| QA0-15 | First walk | Walk 300 m outdoors, Finish, Save | Distance within 10% of a measured path; Save offered; XP shown | NOT RUN |
| QA0-16 | Short urban walk | 220 m between tall buildings, signed in | Record the server verdict. Today's code is expected to reject it with "Too few GPS points" (MR-A-01) | NOT RUN |
| QA0-17 | Standing still | 5 min still near tall buildings | Distance should stay under 25 m. Record the value (MR-A-04 needs this data) | NOT RUN |
| QA0-18 | Screen off | Lock the phone for 2 min mid-walk | Record whether fixes continue. Expect a gap, since tracking is foreground only | NOT RUN |
| QA0-19 | Background | Switch apps for 2 min | Gap shown; no straight line across it | NOT RUN |
| QA0-20 | Process kill | Swipe the app away mid-walk | Next launch: record what the user sees. Today nothing tells them the walk was lost | NOT RUN |
| QA0-21 | Rotation | Rotate during a session and on Summary | No reset, no lost session | NOT RUN |
| QA0-22 | Back navigation | Hardware and predictive back in session, summary and account | Session shows the discard dialog; no route left in a blank state | NOT RUN |
| QA0-23 | Google sign-in return | Continue with Google (only once the owner turns the provider on) | Browser returns to `movenrun://auth/callback` with PKCE and lands signed in | BLOCKED (provider OFF per the launch ledger; not checked by this track) |
| QA0-24 | Wallet sign-in return | Continue with Wallet (same condition) | Returns to `movenrun://auth/wallet` and lands signed in | BLOCKED (provider OFF per the launch ledger; not checked by this track) |
| QA0-25 | Slow backend | Save while the backend is cold (free tier sleeps) | "Submitting" then "Verified" within the 20 s timeout, or "Pending" with a retry later | NOT RUN |
| QA0-26 | Offline save | Airplane mode, Save, then reconnect | Pending, then verified after reconnecting | NOT RUN |
| QA0-27 | Battery | 30 min session, screen on, full brightness | Record battery percentage used and device temperature | NOT RUN |
| QA0-28 | Memory | 60 min session | `adb shell dumpsys meminfo io.movenrun.app` at 0, 30 and 60 min; no steady growth | NOT RUN |
| QA0-29 | TalkBack | Move, Pause, weak signal, Finish | Each state change is spoken. Expected to fail today (S2-3) | NOT RUN |
| QA0-30 | Largest font and display size | D4, Home and Summary | No clipped distance or task text. Expected to fail today (S2-6) | NOT RUN |
| QA0-31 | Remove animations | Finish a route that creates a preview zone | No burst animation. Expected to fail today (S2-5) | NOT RUN |
| QA0-32 | Sunlight | Full brightness outdoors, Summary and Route History | Faint grey text readable. Expected to fail today (S2-4) | NOT RUN |
| QA0-33 | Account deletion | Signed-in test account, Account security, Delete | Signed out, local progress reset, server rows gone (owner runs the SQL check) | NOT RUN |
| QA0-34 | Low storage | Fill the device to under 200 MB free, then walk and Save | Save works or fails with a clear message; no crash, no half-written queue | NOT RUN |
| QA0-35 | Inbound share | Share a link or image to MovenRun from another app | The app is not offered as a share target, or ignores the intent safely | NOT RUN |
| QA0-36 | Local cache after sign-out | Sign in, save a walk while offline, sign out, inspect with `run-as` on a debuggable copy only | No queued route remains after sign-out (tested locally in `verificationStates.test.ts`) | NOT RUN |

## Deep links

The app uses the `movenrun://` custom scheme for the Google and wallet returns.
Any app can register the same scheme, so the return must be useless to an
interceptor. The Google return uses PKCE (`signInProviders.ts`): the code is
worthless without the verifier the app holds. The wallet return carries a
one-time code that only the app's verifier can spend (a backend test covers
this). QA0-23 and QA0-24 confirm both on a device. HTTPS App Links would remove
the interception risk, but they need a hosted `assetlinks.json` with the release
certificate and an authorised release exception. That is out of scope for QA0.

## Evidence recipe

For each check, record: device slot, Android version, build version code, the
result word, and at most one screenshot. Then:

1. `adb logcat -d > raw.txt` on the tester's machine.
2. Redact before sharing, from the `movenrun/` folder: `node --import tsx research/product-playability/tools/redactLog.ts < raw.txt > redacted.txt`.
3. Check `redacted.txt` by eye for any place name, then share only that file.
4. Walks start and end at least 200 m from any home (see MAP_PRIVACY_THREAT_MODEL.md).

Never label a check PASS from an emulator when it says "device". Use the
emulator only for D4 layout checks and mark them as emulator.
