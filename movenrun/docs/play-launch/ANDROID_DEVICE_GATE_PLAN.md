# Android device gate plan (due 24 Oct 2026)

QA planning only. No app change is made for it (D-25). The gate proves, on a
real phone and the exact preview APK, that Google sign-in, wallet sign-in,
deletion and the free host behave as the local tests say. Steps are in
`HANDSET_TEST_SCRIPT.md`; this file says when, with what, and what counts as
a pass.

## Preconditions (all owner, in order)

1. X-06, X-07, X-05 (with the X-07b hook proof) and X-21 passed
   (`LIVE_SETUP_OPERATOR_GUIDE.md`).
2. X-08 build settings, then X-04 preview APK built from the commit under test.
   Record the EAS build id and the commit. What the free EAS plan needs and
   what one build costs in quota: `LIVE_SETUP_OPERATOR_GUIDE.md`, "Free EAS
   readiness".
3. The phone: Android 12 or later (Android 14+ preferred), Google Play
   services, a Google account, and **at least one** of MetaMask, Coinbase
   Wallet or Trust Wallet with a fresh test wallet (no funds; never your main
   wallet, never type a recovery phrase anywhere for this test).
4. Outdoors with GPS for steps 5–8.
5. For the QA0 checks: a computer with `adb`, a USB cable, and for Q0-6e a
   second Android 12+ phone that can be reset (or the Play install later).

## Schedule

| Day | Work |
|---|---|
| By 20 Oct | X-06 → X-07 → X-05 → X-21 done; X-08; X-04 APK built |
| 21–22 Oct | Steps 1–14 (movement) and 15a–15b (Google) |
| 22–23 Oct | Steps 15c–15h (wallet, deletion, cold start, F-06 check) with each wallet available; two-account check |
| 21–23 Oct | QA0 checks Q0-1 (first, on install) to Q0-5 alongside the steps above; Q0-6 last |
| 24 Oct | Decision: PASS, or `WALLET_LOGIN_BLOCKED` (D-19) |

If the live setup slips, the gate slips with it; it cannot be passed with a
stand-in.

## Pass rules

| Area | Pass | Fail → |
|---|---|---|
| Google (15a, 15b, 16) | Signs in, same account on repeat, deletion removes it | STOP: release blocker, fix before anything else |
| Wallet (15c–15f) | With at least one wallet app: signs in by the automatic return **or** the typed code; deletion works; no transaction, network switch or approval is ever requested | `WALLET_LOGIN_BLOCKED`: owner decides Google-only v1 (the `SIGN_IN_METHODS` switch, already built and tested) or a deferral |
| Any request beyond one `personal_sign` | Never happens | STOP: security blocker |
| Cold start (15g) | Signs in within about a minute, or a clear retry message with working buttons | Record; acceptable on the free host only if the retry works |
| F-06 check (15h) | The warning shows on a sign-in the app did not start | STOP until the copy is visible |
| QA-04 (record only) | Per wallet: did the browser hand `movenrun://` back to the app? | Input to the X-23 App Link decision |
| Capacity (QA-02) | Two accounts each see only their own sessions; deleting one leaves the other intact | STOP |
| Backup and transfer (A2) | The installed APK's merged manifest has `allowBackup="false"` and `dataExtractionRules`; `adb shell bmgr backupnow io.movenrun.app` backs nothing up; after a phone-to-phone transfer (Android 12+) the app opens signed out with no unsent session | STOP: privacy blocker |
| Hermes start (Q0-1) | Hermes bundle; three cold starts reach the first screen; no `RangeError` or fatal in logcat; Territory draws | STOP: release blocker (#94 regression) |
| Location (Q0-2) | No "Allow all the time" option; tracking stops when backgrounded and the summary says so; no invented route | STOP: privacy blocker |
| Manifest (Q0-7) | No cleartext, no background location service, no clipboard provider; only `MainActivity` handles `movenrun://`; forged callback links sign nobody in and do not crash | STOP: security blocker |
| 16 KB (R-04 on the APK) | `zipalign -c -P 16` passes; every 64-bit `.so` has LOAD align `0x4000` (`ANDROID_16KB_PAGE_SIZE.md`) | STOP before the production AAB: note the library |

A step not run is not a pass. Any crash is a fail.

## QA0 device checks

Seven checks that close QA0 on the preview APK. Each reuses the handset script
steps where they exist and adds what the script does not prove. Run them on
the same phone and APK as the script, in order Q0-1 to Q0-5, then Q0-7, with Q0-6 last (it ends with a
reset or transfer). Tools: a computer with `adb` (Android platform-tools) and
USB debugging on (Settings → About phone → tap Build number seven times →
Developer options → USB debugging). `aapt2` (Android build-tools) only for
Q0-6a; any machine with the SDK has it.

**Evidence rules for every check.** No coordinates, no map with a street or
place name you could be found at, no email address, no wallet address, no
one-time code, no QR or token in any screenshot, recording, log or note. Crop
or blur the Google account chooser and the wallet header. Never paste
`dumpsys location` output (it holds your last positions); record only yes/no.
Logcat excerpts go through the filter given and are read before they are
saved. Store files outside the repository; `EVIDENCE_REGISTER.md` gets the
result line and where the file is kept.

### Q0-1 Hermes cold start (the #94 proof)

`docs/HERMES_H3_COMPATIBILITY.md`: a green build is not proof that h3-js
initialises under Hermes; only a cold launch of this exact APK is.

| # | Step | Expected |
|---|---|---|
| a | On the computer: `unzip -p movenrun.apk assets/index.android.bundle \| head -c 8 \| xxd` | `c61f bc03 c103 191f` (Hermes bytecode magic). Anything else: the APK is not a Hermes build; stop |
| b | `adb install -r movenrun.apk`, then `adb shell am force-stop io.movenrun.app` and `adb logcat -c` | Installs |
| c | `adb shell am start -W -n io.movenrun.app/.MainActivity` | `Status: ok`; note `TotalTime` (ms) |
| d | Wait for the first screen, then `adb logcat -d -s ReactNativeJS:V AndroidRuntime:E \| grep -iE "RangeError\|Unknown encoding\|FATAL\|TextDecoder"` | No output |
| e | Open the Territory tab (it builds H3 cells), then repeat step d | No output; the tab draws, no red screen |
| f | Swipe the app away, `adb shell am force-stop io.movenrun.app`, repeat c–d twice more | Three cold starts, no crash |

Evidence: the `xxd` line, the three `TotalTime` values, the empty grep result
(as a screenshot of the terminal), and a recording of one cold start to the
first screen. Pass closes the "unproven on a device" note on #94.

### Q0-2 GPS permission flow and background behaviour

Handset steps 3–8 cover deny, approximate and precise. Add:

| # | Step | Expected |
|---|---|---|
| a | Settings → Apps → MovenRun → Permissions → Location | The options are "Allow only while using the app", "Ask every time" and "Don't allow". There is **no** "Allow all the time" |
| b | `adb shell dumpsys package io.movenrun.app \| grep -E "permission.(ACCESS_\|FOREGROUND\|SYSTEM_ALERT)"` | Fine and coarse location only. No `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION` or `SYSTEM_ALERT_WINDOW` |
| c | Choose "Ask every time", start a Free Run | The system asks; "Only this time" starts the session |
| d | During an active session, walk, press Home and keep walking about 2 min, then return | While away: the location indicator in the status bar goes off within a few seconds and no MovenRun notification appears. Back in the app: the session resumes; the route shows a break, not a straight line across the time away |
| e | Finish | The summary says "Location tracking was interrupted once — about N min of this route wasn't recorded." and the distance does not include the time away |
| f | Turn location off in Quick Settings, then tap Start | A clear message that location is off, with a way to retry or open settings; no crash. Then, during a session, turn it off and on again: no crash, distance does not grow while it is off, no straight line is invented |
| g | Settings → MovenRun → Location → Don't allow while the app is open, return to the app | No crash; the next Start asks again or explains how to turn it on |

Evidence: screenshots of a, e (crop the map out, keep the notice and the
distance) and f; the grep result for b; a note that the indicator went off in
d (yes/no). No route image with a recognisable place.

### Q0-3 Google sign-in through the system browser (PKCE)

Handset steps 15a, 15b and 15g. Add:

| # | Step | Expected |
|---|---|---|
| a | Continue with Google | A Chrome Custom Tab opens over the app (a browser bar showing the site's address, not a page drawn inside the app) and lands on Google's account chooser |
| b | Close the tab with ✕ before choosing an account | Back in the app, still signed out, no error page, no "unmatched route", the buttons work |
| c | Continue with Google again and pick an account | Signed in; Profile → Account shows the verified-session count |
| d | Press Back from the Google page instead of choosing | Same as b |
| e | Sign out, then airplane mode on, Continue with Google | A plain network error; no endless spinner; works once the network is back |

Evidence: screenshots of a (account list blurred), b and c (count visible, no
email). Note the time from tap to signed in.

### Q0-4 Wallet sign-in through the apex `/sign-in/` page

**Precondition:** X-21 is done and `https://movenrun.xyz/sign-in/` answers
200 **without** a redirect to `www` (today it redirects, E-49; the API refuses
calls from `www`). Check from a computer:
`curl -sI https://movenrun.xyz/sign-in/ | head -1` shows `200`.

Handset steps 15c–15f and 15h. Add:

| # | Step | Expected |
|---|---|---|
| a | Continue with Wallet → your wallet app | The wallet's own browser opens `movenrun.xyz/sign-in/` (the address shows the apex, not `www.`) |
| b | Read the signing request | One plain-text message to sign (`personal_sign`) naming `movenrun.xyz` and saying it is not a transaction. Never a transaction, a network switch, a token approval or a typed-data permit |
| c | Sign | The page hands back to MovenRun (automatic return) or shows a 12-character code. Record which, per wallet app |
| d | Start again, wait more than 5 minutes after the code appears, then type it | Refused with a plain message, no crash; starting again from Continue with Wallet works |
| e | Type a wrong code once, then the right one | The wrong one is refused; the right one signs in (the verifier is kept until the code is spent) |

Evidence: screenshots of a and b with the wallet address and balance cropped
(keep the domain and the message text), and of the signed-in Account screen.
Record the wallet app name and version and whether the return was automatic.
Never the code, never the address beyond its first and last four characters.

### Q0-5 Account deletion

Handset steps 15e and 16. Add:

| # | Step | Expected |
|---|---|---|
| a | Before deleting: note the verified-session count | |
| b | Profile → Account → Account security → Delete account; cancel the dialog | Nothing deleted, still signed in |
| c | Delete for real | Signed out; local progress cleared; Home shows a fresh start |
| d | Kill and relaunch the app | Still signed out; no old route, XP or pending session comes back |
| e | Sign in again with the same Google account or wallet | A new account with 0 verified sessions |
| f | Second account: delete on the web at `movenrun.xyz/account-deletion/` while the phone is signed in, then use the app | The phone is signed out on its next request |

Evidence: screenshots of the dialog, the signed-out state after c and d, and
the 0-session Account screen after e.

### Q0-7 Manifest hardening on the installed app

Static checks are in `X04_PREVIEW_BUILD_RUNBOOK.md`; this confirms the phone
sees the same thing.

| # | Step | Expected |
|---|---|---|
| a | `adb shell dumpsys package io.movenrun.app \| grep -E "^ *(pkgFlags\|flags\|privateFlags)="` | No `USES_CLEARTEXT_TRAFFIC` and no `ALLOW_BACKUP` in any line. If the Android version does not print cleartext as a flag, the `aapt2` line from the runbook (`usesCleartextTraffic` false) is the proof |
| b | `adb shell dumpsys package io.movenrun.app \| grep -E "LocationTaskService\|ClipboardFileProvider"` | No output |
| c | `adb shell cmd package query-activities --components -a android.intent.action.VIEW -d "movenrun://auth/callback"` | Only `io.movenrun.app/.MainActivity` |
| d | `adb shell am start -W -a android.intent.action.VIEW -d "movenrun://auth/wallet?code=AAAAAAAAAAAA" io.movenrun.app` while signed out and with no wallet sign-in started | The app opens, shows "Finishing wallet sign-in…" briefly, returns, still signed out; no crash (a code without this phone's verifier is refused) |
| e | `adb shell am start -W -a android.intent.action.VIEW -d "movenrun://auth/callback?code=x" io.movenrun.app` | The app opens and steps back; still signed out; no crash |

Evidence: the empty outputs of a and b, the component line of c, and a note
for d and e (yes/no). No codes from a real sign-in.

### Q0-6 Backup and transfer exclusion (A2)

See the procedure below. Pass rule: the A2 row in the pass rules table.

## Backup and transfer procedure (A2)

Use a test phone or an emulator with Google Play, not your everyday phone if
you can avoid it: step c may switch the backup transport. Write down what you
change and put it back in step g.

**a. The APK's merged manifest** (on the computer):

```bash
aapt2 dump xmltree movenrun.apk --file AndroidManifest.xml | grep -E "allowBackup|dataExtractionRules"
```

Expected: `android:allowBackup` is false (`0x0`) and
`android:dataExtractionRules` points at an `@xml/` resource. Dump that file
(`aapt2 dump xmltree movenrun.apk --file res/xml/data_extraction_rules.xml`):
a `cloud-backup` and a `device-transfer` section, each with nine `exclude`
entries (root, file, database, sharedpref, external and the four `device_`
domains) and no `include`.

**b. What the phone thinks:**

```bash
adb shell dumpsys package io.movenrun.app | grep -E "^ *(pkgFlags|flags)="
```

Expected: no `ALLOW_BACKUP` in the flags.

**c. Cloud backup:**

```bash
adb shell bmgr enabled                 # note the answer; must be "enabled" to test
adb shell bmgr list transports         # note the starred (current) transport
adb shell bmgr backupnow io.movenrun.app
adb shell dumpsys backup | grep -i movenrun
```

Expected: `backupnow` reports `Package io.movenrun.app with result: Backup is
not allowed` (or nothing backed up for the package); `dumpsys backup` does not
list `io.movenrun.app` among packages backed up or pending. If backup is
disabled, `adb shell bmgr enable true` for the test only.

**d. Emulated device transfer (Android 12+, no second phone):**

```bash
adb shell bmgr transport com.android.localtransport/.LocalTransport
adb shell settings put secure backup_local_transport_parameters 'is_device_transfer=true'
adb shell bmgr backupnow io.movenrun.app
```

Expected: `Backup is not allowed`, or success with nothing included (the
rules exclude every domain). Record the exact result line.

**e. Real phone-to-phone transfer (Android 12+), the decisive check:**

1. Source phone: install the APK, sign in, and leave one **unsent** session:
   airplane mode on, finish and save a short session (handset step 14), so a
   pending verification sits on the phone. Leave airplane mode on.
2. Target phone: new or factory reset. In setup, choose copy apps and data
   from the source phone (cable or wireless).
3. On the target: if MovenRun came across, open it. If it did not (a
   sideloaded APK is often skipped), install the same APK and open it.

Expected: welcome or Terms screen, signed out, no XP, no streak, no pending
session, no old route. Record whether the app itself was carried over: if it
was not, the data check is inconclusive and is repeated on the Play
internal-test install (X-12), where the app is restored from Play.

**f. Optional, Google One:** on the source phone, Settings → Google → Backup →
Back up now; then the backup's app data list should not include MovenRun.

**g. Put the phone back:** `adb shell settings delete secure
backup_local_transport_parameters`, `adb shell bmgr transport <the transport
noted in c>`, and `adb shell bmgr enable false` if it was disabled before.

Evidence: the `aapt2` lines from a, the flags line from b, the `backupnow` and
`dumpsys backup` result lines from c and d (they hold no personal data; read
them before saving), and a screenshot of the target phone's first MovenRun
screen from e. Android versions of both phones.

## What to record (in `EVIDENCE_REGISTER.md`)

Phone model, Android version, wallet app and version, EAS build id, commit,
PASS/FAIL per step and per QA0 check, and a screenshot or short recording
for 15a, 15c, 15d, 15e and 15h plus the evidence each QA0 check names. Never record wallet addresses beyond the first and last four
characters, emails, or codes.

## Afterwards

PASS → X-14 (merge decision), X-09 (production AAB), then Play once X-01b is
done: X-11, X-12 (re-run steps 15a–17 on the Play install, App bundle
explorer for 64-bit and 16 KB).
