# QA0 physical-handset worksheet (H-1 to H-10)

A fill-in sheet for the person holding the phone. It condenses the checks in
`HANDSET_TEST_SCRIPT.md` and `ANDROID_DEVICE_GATE_PLAN.md` (Q0-1 to Q0-7) into
ten rows. Those two files stay the detailed source; where this sheet and they
differ, they win and this sheet gets fixed.

## Applies to

| Item | Value |
|---|---|
| Candidate | Branch `preview/android-qa0-candidate`, source SHA **15f7f87** |
| Build | **No build has been made.** Nothing in this sheet has been run. A build needs separate owner approval and EAS setup first (gates G-A to G-F in `X04_PREVIEW_BUILD_RUNBOOK.md`). Until an APK exists, every row stays blank |
| Build under test | EAS build id: ______________________  built from commit: ______________ (must be 15f7f87; any other commit means this sheet does not apply) |
| Package | `io.movenrun.app` |

**Unit tests do not replace handset sign-off.** The mobile test suite and
type checks run on a computer. They say nothing about Hermes on a real phone,
Google Maps signing, GPS behaviour outdoors, Android backup, TalkBack or link
handling by the system. A row that was not run on a handset is not a pass.

## Device requirements

- A physical Android phone, Android 12 or later (Android 14 or later preferred),
  with Google Play services and a Google account. Not an emulator, except
  where a row says an emulator is acceptable.
- Outdoors with a GPS fix for H-3 to H-5.
- A computer with `adb` (Android platform-tools), a USB cable, and for H-9
  `aapt2`, and for H-10 the NDK `llvm-readelf` and `zipalign` (build-tools 35
  or later).
- For H-8: a second Android 12+ phone that can be reset, or the Play
  internal-test install later (see `ANDROID_DEVICE_GATE_PLAN.md`, Q0-6e).
- A test Google account and a fresh test wallet with no funds. Never your main
  wallet. Never type a recovery phrase anywhere for this test.
- Prefer a spare phone. H-8 may switch the backup transport; write down what
  you change and restore it.

## Evidence rules (apply to every row)

- Never capture real GPS coordinates. Blur or crop the map, latitude and
  longitude readouts, and any address bar or place name that shows where you
  are. A route line without a map background is fine. Do not paste `adb
  logcat` lines that contain coordinates.
- Never capture tokens, codes, cookies, API keys or account identifiers:
  access or refresh tokens, the 12-character wallet code, the PKCE challenge
  or verifier, email addresses, wallet addresses, account or session ids,
  device serial numbers, Maps keys. Redact before saving, or retake.
- Log evidence is one line, copied exactly, with anything above removed:
  for example a `Status: ok` line, a `TotalTime` number, a `result: Backup is
  not allowed` line. If a line cannot be shown without an identifier, write
  what it said in words instead.
- Screenshots: crop to the app. Name the file with the row id, for example
  `H-4-pass.png`. Keep the files out of the repository; record file names in
  `EVIDENCE_REGISTER.md`.
- Fill in the phone model, Android version and build id once per run, in the
  header table at the bottom.

## Rows

### H-1 Cold boot with Hermes

| | |
|---|---|
| Preconditions | App freshly installed (`adb install -r movenrun.apk`), never opened. `adb logcat -c` run. Phone connected by USB |
| Steps | 1. `adb shell am force-stop io.movenrun.app`. 2. `adb shell am start -W -n io.movenrun.app/.MainActivity`; note `Status` and `TotalTime`. 3. Wait for the first screen. 4. `adb logcat -d -s ReactNativeJS:V AndroidRuntime:E \| grep -iE "RangeError\|Unknown encoding\|FATAL\|TextDecoder"`. 5. Open Territory. 6. Swipe the app away, force-stop, and repeat steps 2 to 4 twice more |
| Expected | `Status: ok` each time. Splash, then the welcome screen. Territory draws. The grep prints nothing. Three cold starts, no crash. Release blocker if this fails (the #94 regression) |
| Evidence | The `Status: ok` line with `TotalTime` for each start; the empty grep result (write "no output"); one screenshot of the first screen |

Pass [ ]  Fail [ ]   Notes: ______________________________
Tester: ____________________  Date: ____________________

### H-2 Maps tiles load with the correct signing key

| | |
|---|---|
| Preconditions | X-08 done: the Android Maps key is restricted to `io.movenrun.app` plus the SHA-1 of the key that signed this APK (for the preview APK, the EAS keystore SHA-1; for a Play install, the Play App Signing SHA-1). The phone is online |
| Steps | 1. Open Territory and a zone map. 2. Pan and zoom. 3. Compare with the key's configured SHA-1 (owner confirms, you do not need to see the key) |
| Expected | Real Google map tiles with streets and labels. Grey tiles with a Google logo mean the signing SHA-1 is missing from the key or the key is restricted wrongly. That is a fail, not a cosmetic issue |
| Evidence | Screenshot of the map with the location cropped or blurred so no place is identifiable. Do not capture the key or its fingerprint |

Pass [ ]  Fail [ ]   Notes: ______________________________
Tester: ____________________  Date: ____________________

### H-3 Standing still produces no false distance

| | |
|---|---|
| Preconditions | Location permission allowed, precise. Outdoors with a clear sky, GPS fix shown. Phone held still, not walking |
| Steps | 1. Start Free Run. 2. Stand still 60 to 90 seconds and watch distance. 3. Stand still 5 minutes in total, finish and save |
| Expected | Distance stays about 0 m. The route line does not grow. No movement XP, no streak, no defence credit after saving |
| Evidence | Screenshot of the session screen showing distance at about 0 m (map cropped); screenshot of the summary showing no XP |

Pass [ ]  Fail [ ]   Notes: ______________________________
Tester: ____________________  Date: ____________________

### H-4 A real walk of 100 to 300 m

| | |
|---|---|
| Preconditions | Outdoors, precise location allowed. You can measure the walk roughly (steps counted, or a known path) |
| Steps | 1. Start Free Run. 2. Walk 100 to 300 m along real streets or paths at a normal pace. 3. Finish and save |
| Expected | The route grows along the path you walked, on real map tiles. Reported distance is plausible against your estimate (give or take GPS error). The session summary appears. No jumps or straight lines across blocks |
| Evidence | Screenshot of the summary with distance and time. If the route is shown, crop it so the map and street names are not visible. Your own estimate of the distance, in words |

Pass [ ]  Fail [ ]   Notes: ______________________________
Tester: ____________________  Date: ____________________

### H-5 Pause and resume

| | |
|---|---|
| Preconditions | As H-4 |
| Steps | 1. Start a run and walk about 50 m. 2. Pause. 3. Walk about 50 m while paused. 4. Resume and walk about 50 m more. 5. Finish |
| Expected | No straight bridge across the paused gap. The paused 50 m is not counted. Total is about 100 m, not 150 m. Background behaviour: with the screen off or the app backgrounded, the app says tracking stops, and no route is invented (no "Allow all the time" option exists) |
| Evidence | Screenshot of the summary distance; a line in words stating the two walked and one paused distances. Crop the map |

Pass [ ]  Fail [ ]   Notes: ______________________________
Tester: ____________________  Date: ____________________

### H-6 Quest award exactly once

| | |
|---|---|
| Preconditions | Signed in or signed out as the quest requires. Today's quests not yet completed. Note the XP before |
| Steps | 1. Start a quest and finish it early: confirm 0 XP. 2. Start the same quest and complete it validly. 3. Note XP. 4. Repeat the same quest the same day. 5. Force-stop and reopen the app; check XP again |
| Expected | Early finish gives 0 XP. The valid completion awards XP once. The repeat the same day awards none. The XP total does not change after a restart |
| Evidence | Screenshots of the XP total before, after the valid completion, and after the repeat. Hide any account name or id |

Pass [ ]  Fail [ ]   Notes: ______________________________
Tester: ____________________  Date: ____________________

### H-7 Offline, then retry

| | |
|---|---|
| Preconditions | Signed in. Online at the start. A short session ready to record |
| Steps | 1. Turn airplane mode on. 2. Finish and save a short session. 3. Note the pending state. 4. Force-stop and reopen the app: the session is still pending. 5. Turn airplane mode off and wait, or use the retry action |
| Expected | Offline: the session shows as pending, with no crash and no endless spinner. After the network returns: it is verified once, not twice (Profile, Account, verified-session count rises by one). The API may be asleep: allow about a minute, and expect either success or a clear "took too long" message with buttons usable again |
| Evidence | Screenshot of the pending state; screenshot of the verified count before and after (hide the account identifier). Note the time taken in words |

Pass [ ]  Fail [ ]   Notes: ______________________________
Tester: ____________________  Date: ____________________

### H-8 Account creation and deletion

| | |
|---|---|
| Preconditions | A test Google account on the phone. Optionally a test wallet app (MetaMask, Coinbase Wallet or Trust Wallet). A saved verified session exists after sign-in |
| Steps | 1. Continue with Google, pick the test account; confirm you return to the app signed in with no "unmatched route" screen. 2. Save one verified session. 3. Account security, Delete account, confirm. 4. Sign in again with the same Google account. 5. Optional: repeat with Continue with Wallet and record whether the wallet returned to the app or the 12-character code was needed |
| Expected | Sign-in returns to the app signed in. Deletion succeeds, signs the phone out and clears local progress. Signing in again creates a fresh account with 0 verified sessions. The wallet message names movenrun.xyz and says it is not a transaction; no transaction or approval is requested |
| Evidence | Screenshot of the signed-in Account screen and of the post-deletion fresh account (identifiers hidden); a note of which wallet return path happened. Never capture the 12-character code, a token or the browser address bar |

Pass [ ]  Fail [ ]   Notes: ______________________________
Tester: ____________________  Date: ____________________

### H-9 Backup and device transfer are off

Detail and pass rules: `ANDROID_DEVICE_GATE_PLAN.md`, "Backup and transfer
procedure (A2)". A privacy blocker if it fails.

| | |
|---|---|
| Preconditions | Installed APK, signed in, one unsent session left on the phone (airplane mode on, short session saved). Prefer a spare phone or an emulator with Google Play. Note the current backup transport and `bmgr enabled` value so you can restore them |
| Steps | 1. `aapt2 dump xmltree movenrun.apk --file AndroidManifest.xml \| grep -E "allowBackup\|dataExtractionRules"`. 2. `adb shell dumpsys package io.movenrun.app \| grep -E "^ *(pkgFlags\|flags)="`. 3. `adb shell bmgr enabled`, `adb shell bmgr list transports`, `adb shell bmgr backupnow io.movenrun.app`, `adb shell dumpsys backup \| grep -i movenrun`. 4. Emulated transfer (Android 12+): `adb shell bmgr transport com.android.localtransport/.LocalTransport`, `adb shell settings put secure backup_local_transport_parameters 'is_device_transfer=true'`, `adb shell bmgr backupnow io.movenrun.app`. 5. Real transfer to a second Android 12+ phone through setup (the decisive check). 6. Restore the transport and settings you changed. 7. Optional: the legacy `adb backup -f out.ab io.movenrun.app`, then check the file holds no app data (a header only) |
| Expected | `allowBackup` is false and `dataExtractionRules` points at an `@xml/` resource. No `ALLOW_BACKUP` flag. `backupnow` says `Backup is not allowed` (or backs up nothing); `dumpsys backup` does not list the package. After a real transfer the app opens signed out, with no XP, no streak, no pending session and no old route. If the app itself was not carried over (sideloaded APKs often are skipped), the data check is inconclusive and is repeated on the Play internal-test install |
| Evidence | The manifest grep lines; the `backupnow` result line; one line stating whether the app came across in the transfer and a screenshot of the signed-out welcome screen on the target |

Pass [ ]  Fail [ ]   Inconclusive (repeat on Play install) [ ]   Notes: ______________________________
Tester: ____________________  Date: ____________________

### H-10 Accessibility, 16 KiB page size and deep-link interception

This row has three parts; each needs its own box. Part (a) needs only the
phone. Part (b) needs the APK and a computer. Part (c) needs `adb`.

**(a) TalkBack and font scale**

| | |
|---|---|
| Preconditions | TalkBack available. Settings, Display, font size at the largest, and display size at the largest |
| Steps | 1. With the largest font and display size, walk through welcome, Home, Move, Finish and Back. 2. Turn TalkBack on and swipe through Home, Move and Profile. 3. Start a run and finish it using TalkBack only. 4. Turn on reduced motion (remove animations) and repeat one screen. 5. Return the settings to normal |
| Expected | No clipped call-to-action buttons; Move, Finish and Back are reachable. Buttons and controls have spoken labels that make sense; focus order is logical; nothing essential is only shown by colour or motion |
| Evidence | Screenshot at the largest font showing Move and Finish; written notes of any control TalkBack reads as "button" with no name or skips |

Pass [ ]  Fail [ ]   Notes: ______________________________

**(b) 16 KiB page size and native libraries** (detail: `ANDROID_16KB_PAGE_SIZE.md`, "Verifying a built APK or AAB")

| | |
|---|---|
| Preconditions | The APK file. `zipalign` and `llvm-readelf` on the computer. Ideally an Android 15+ emulator with the "16 KB page size" system image |
| Steps | 1. `zipalign -v -c -P 16 4 movenrun.apk \| tail -1`. 2. Unzip `lib/*` and for every `arm64-v8a` and `x86_64` library run `llvm-readelf -lW <so> \| awk '/LOAD/{print $NF}' \| sort -u`. 3. On the 16 KB emulator, `adb shell getconf PAGE_SIZE` prints `16384`; install the APK and repeat H-1 |
| Expected | `Verification successful`. Every 64-bit library shows only `0x4000` or larger; any `0x1000` or `0x2000` is a fail (write down the library). The 32-bit libraries stay 4 KB and that is expected. On the 16 KB emulator the app starts and shows its first screen. The libraries `libreactnative.so` and `libhermes.so` were only "expected yes" before this check: record their results explicitly |
| Evidence | The `zipalign` last line; a list of library names with their alignment only; `16384` from `getconf` |

Pass [ ]  Fail [ ]   Notes: ______________________________

**(c) Deep-link interception of `movenrun://auth/callback`**

| | |
|---|---|
| Preconditions | App installed, signed out, no sign-in started. A second app that could claim the scheme is not required; the check is that only MovenRun handles it |
| Steps | 1. `adb shell cmd package query-activities --components -a android.intent.action.VIEW -d "movenrun://auth/callback"`. 2. `adb shell am start -W -a android.intent.action.VIEW -d "movenrun://auth/callback?code=x" io.movenrun.app`. 3. `adb shell am start -W -a android.intent.action.VIEW -d "movenrun://auth/wallet?code=AAAAAAAAAAAA" io.movenrun.app`. 4. Check the app state after each. 5. Check `adb logcat -d -s AndroidRuntime:E` for a crash |
| Expected | Only `io.movenrun.app/.MainActivity` handles the link. A forged callback opens the app and steps back; still signed out; no crash. A wallet code without this phone's verifier is refused, the app may briefly show "Finishing wallet sign-in…", then returns, still signed out. Nobody is signed in by a link the app did not start |
| Evidence | The `query-activities` output (component name only); the `Status: ok` lines; one screenshot showing the signed-out state afterwards. Use only the dummy codes shown above, never a real code |

Pass [ ]  Fail [ ]   Notes: ______________________________

Overall H-10: Pass [ ]  Fail [ ]
Tester: ____________________  Date: ____________________

## Run header

| Field | Value |
|---|---|
| Phone model | |
| Android version | |
| Play services present | Yes [ ]  No [ ] |
| EAS build id | |
| Built from commit | |
| Tester name | |
| Date of run | |
| Summary: rows passed / failed / not run | |

Record the results and the evidence file names in `EVIDENCE_REGISTER.md`. A
row that was not run is not a pass. A fail in H-1, H-8 (deletion), H-9 or
H-10(c) is a blocker for the preview build (see the pass rules in
`ANDROID_DEVICE_GATE_PLAN.md`).

## Internal risk register link (not a Data safety answer)

One dependency advisory ships in the JavaScript bundle of this candidate:
`decode-uri-component` 0.2.2 through `query-string` 7.1.3. It is recorded as
provisional exception DEP-EXC-2026-001 in
`movenrun/docs/security/DEPENDENCY_EXCEPTIONS.md` on branch
`docs/decode-uri-exception-22oct` (not yet on this candidate branch). The
register is an internal risk register only. It is not part of, and must not be
copied into, any Play Data safety answer. The owner decision on it is pending.
H-10(c) exercises the deep-link path that the exception's reachability
analysis relies on; a crash or unexpected navigation there should be reported
against that exception.
