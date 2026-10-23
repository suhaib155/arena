# QA0 physical-handset worksheet (H-1 to H-12)

A fill-in sheet for the person holding the phone. It replaces the earlier
ten-row sheet (H-1 to H-10, draft #132) with one twelve-row set that also
covers the Track A device matrix (`ANDROID_QA0_DEVICE_MATRIX.md`, QA0-01 to
QA0-36 on `research/parallel-a-product-playability`). The detailed sources are
`HANDSET_TEST_SCRIPT.md` and `ANDROID_DEVICE_GATE_PLAN.md`; where this sheet
and they differ, they win and this sheet gets fixed.

**Every result below starts as NOT RUN.** Nothing in this sheet has been
executed. No build exists. A row that was not run on a handset is not a pass.

## Applies to

| Item | Value |
|---|---|
| Candidate | Branch `preview/android-qa0-candidate`, source SHA **15f7f87** (#125) |
| Build gate | One EAS preview APK needs separate owner approval and the setup gates in `X04_PREVIEW_BUILD_RUNBOOK.md`. Until an APK exists every row stays NOT RUN |
| Build under test | EAS build id: ______________  built from commit: ______________ (must be 15f7f87; any other commit means this sheet does not apply) |
| Package | `io.movenrun.app` |

Unit tests and type checks run on a computer. They say nothing about Hermes on
a real phone, Maps signing, outdoor GPS, Android backup, TalkBack or system
link handling.

## Mandatory rows

**H-3 (physical stationary) and H-5 (longer run or city walk) are mandatory.**
If either is NOT RUN or FAIL, the candidate is not phone-tested, whatever the
other rows say. They are the only rows that exercise the movement-truth rules
(no false distance while still, plausible distance over a real route) on real
GPS.

## Crosswalk to older numbering

| This sheet | Old #132 sheet | Track A matrix | Track C section 2a (differs) |
|---|---|---|---|
| H-1 | H-1 | QA0-01, 10 | H-1 |
| H-2 | H-7 | QA0-25, 26 | H-7 |
| H-3 | H-3 | QA0-17 | H-3 |
| H-4 | H-4, H-5, H-6 | QA0-15, 16, 19 | H-4, H-5, H-6 |
| H-5 | none | QA0-15, 18, 20, 27 | none |
| H-6 | none | none | none |
| H-7 | none | QA0-11 to 14 | none |
| H-8 | H-8 (sign-in) | QA0-23, 24 | H-8 |
| H-9 | H-10(c) | QA0-06, 35 | H-12 |
| H-10 | H-8 (deletion), H-7 | QA0-25, 33, 36 | H-7, H-8 |
| H-11 | H-2, H-10(a) | QA0-07, 29 to 32 | H-2, H-10 |
| H-12 | H-9, H-10(b) | QA0-02 to 06, 08, 09 | H-9, H-11 |

Track C section 2a numbers H-9 as backup and H-12 as deep links; this sheet
does not. Cite rows by the number in this sheet and say "QA0 worksheet" so
the two schemes are not mixed.

## Devices and tools

- A physical Android phone, Android 12 or later (14 or later preferred), with
  Google Play services and a Google account. An emulator only where a row says
  so, and then mark the result "emulator".
- Track A device slots: D1 lowest supported version (minSdk expected 24,
  confirm in H-12), 2 to 3 GB RAM; D2 Android 12 to 13 mid-range; D3 Android
  15 or 16 Pixel (16 KiB checks); D4 320 dp width or emulator for font checks.
  Record the slot beside each result. One device is enough for a first pass;
  say which.
- Outdoors with a GPS fix for H-3 to H-6. Walks start and end at least 200 m
  from any home.
- A computer with `adb`, a USB cable, and for H-12 `aapt2`, `zipalign` and
  `llvm-readelf` (build-tools 35 or later).
- A test Google account and a fresh unfunded test wallet. Never a main wallet.
  Never type a recovery phrase.
- Prefer a spare phone. H-12(b) may change the backup transport; write down
  what you change and restore it.

## Evidence rules (every row)

- Never capture real GPS coordinates, place names, addresses or a map
  background that identifies a place. Crop or blur. A route line on a blank
  background is fine. Do not paste `adb logcat` lines containing coordinates.
- Never capture tokens, codes, cookies, API keys, the 12-character wallet
  code, PKCE values, email addresses, wallet addresses, account or session
  ids, device serials, or Maps keys or fingerprints.
- Log evidence is one line copied exactly, with anything above removed. If a
  line cannot be shown without an identifier, write what it said in words.
- Redact a full log with the tool in the Track A recipe before sharing, and
  read the output for place names.
- Screenshots: crop to the app, name by row (`H-4-pass.png`), keep out of the
  repository, list names in `EVIDENCE_REGISTER.md`.
- Fill the phone model, Android version, device slot and build id once in the
  run header at the bottom.

---

## H-1 Cold install and cold start (Hermes) — BLOCKER

Result: **NOT RUN**

| | |
|---|---|
| Preconditions | Fresh `adb install -r movenrun.apk`, never opened. `adb logcat -c` run. USB connected |
| Steps | 1. `adb shell am force-stop io.movenrun.app`. 2. `adb shell am start -W -n io.movenrun.app/.MainActivity`; note `Status`, `TotalTime`. 3. Wait for the first screen. 4. `adb logcat -d -s ReactNativeJS:V AndroidRuntime:E \| grep -iE "RangeError\|Unknown encoding\|FATAL\|TextDecoder"`. 5. Walk the first run: Welcome, Terms checkbox, intro, Home. Confirm no location prompt appears before Move. 6. Open Territory. 7. Swipe the app away, force-stop, repeat steps 2 to 4 twice more |
| Expected | `Status: ok` three times. Splash, welcome, Home, Territory draws. The grep prints nothing (the #94 UTF-16LE regression). No location prompt before Move. Release blocker if it fails |
| Evidence | The three `Status: ok` / `TotalTime` lines; "no output" for the grep; one screenshot of the first screen |

Pass [ ]  Fail [ ]  Notes: ____________________  Tester/date: ______________

## H-2 Offline startup and offline save, then retry

Result: **NOT RUN**

| | |
|---|---|
| Preconditions | Signed in once earlier (or signed out for part a). Online at the start |
| Steps | **(a) Offline startup.** 1. Force-stop. 2. Airplane mode on. 3. Cold start. 4. Open Home, Territory and a map screen. **(b) Offline save.** 5. With airplane mode still on, finish a short saved session while signed in. 6. Note the pending state. 7. Force-stop and reopen: still pending. 8. Airplane mode off; wait, or use retry. 9. If the API is cold, allow about a minute |
| Expected | (a) The app starts, shows its screens, no crash, no endless spinner; map tiles may be missing but the screen does not break. (b) Pending, not "verified". After the network returns, verified exactly once (verified count rises by one, not two). Cold API: success or a clear "took too long" message with buttons usable and the session still pending. Pending never shows earned XP |
| Evidence | Screenshot of the offline start; of the pending state; of the verified count before and after (identifier hidden). Time taken, in words |

Pass (a) [ ] Fail (a) [ ]   Pass (b) [ ] Fail (b) [ ]  Notes: ______________

## H-3 Physical stationary — MANDATORY

Result: **NOT RUN**

| | |
|---|---|
| Preconditions | Precise location allowed. Outdoors, clear sky, GPS fix. Phone held still. Repeat once near tall buildings if possible (Track A QA0-17) |
| Steps | 1. Start Free Run. 2. Stand still 60 to 90 s and watch distance. 3. Stay still 5 min in total, finish and save |
| Expected | Distance stays about 0 m and under 25 m in the worst case; record the number. Route line does not grow. No movement XP, streak or defence credit after saving |
| Evidence | Screenshot of the session screen at about 0 m (map cropped); summary showing no XP; the final distance as a number |

Pass [ ]  Fail [ ]  Open sky m: ____  Tall buildings m: ____  Notes: ________

## H-4 Short walk, pause and resume, quest once

Result: **NOT RUN**

| | |
|---|---|
| Preconditions | Outdoors, precise location, a way to estimate distance |
| Steps | **(a) Short walk.** 1. Free Run, walk 100 to 300 m at a normal pace, finish and save. Note the server verdict if signed in (Track A expects a very short urban walk to be rejected today, MR-A-01; record what happens). **(b) Pause.** 2. Start, walk about 50 m, pause, walk about 50 m paused, resume, walk about 50 m, finish. 3. Lock the screen for 2 min mid-walk, then switch apps for 2 min, and note the gaps. **(c) Quest once.** 4. Finish a quest early (expect 0 XP). 5. Complete one validly. 6. Repeat it the same day. 7. Force-stop, reopen, check XP |
| Expected | (a) Route follows the path on real tiles; distance plausible; no jumps or straight lines across blocks. (b) No bridge across the paused gap; total about 100 m, not 150 m; screen-off and backgrounding show a gap with no invented route (foreground-only, no "Allow all the time"). (c) Early finish 0 XP; one award; no repeat award; XP unchanged after restart |
| Evidence | Summary screenshots (distance, time) with map cropped; your own estimate in words; XP before, after, after repeat (account hidden) |

Pass (a) [ ] (b) [ ] (c) [ ]   Fail (a) [ ] (b) [ ] (c) [ ]  Notes: ________

## H-5 Longer run or city walk — MANDATORY

Result: **NOT RUN**

| | |
|---|---|
| Preconditions | Outdoors, fully charged phone, precise location, signed in. Route of at least 1.5 km or 15 minutes, with at least one stretch between tall buildings. Start and end at least 200 m from home. Note battery % and temperature at start |
| Steps | 1. Free Run for the full route at a steady pace, screen on. 2. Include one deliberate 30 s stop. 3. Finish and save. 4. Note battery % and temperature at the end. 5. Optional: `adb shell dumpsys meminfo io.movenrun.app` at the start, midway and end (Track A QA0-28 is a 60 min test; do it only if the route is that long). 6. Optional: swipe the app away mid-walk on a separate short run and record what the next launch shows (QA0-20) |
| Expected | Distance within about 10% of a measured or mapped route. No teleport jumps, no straight lines across blocks, stop not counted as movement. Honest verdict on the summary (verified, pending or rejected with a reason). Battery use and temperature recorded, no steady memory growth, no crash |
| Evidence | Summary screenshot (distance, time, verdict); route shape without map; the measured route length as a number; battery and temperature figures; memory lines if taken |

Pass [ ]  Fail [ ]  Measured m: ____  Reported m: ____  Battery used: ____  Notes: ________

## H-6 Bus or vehicle contamination

Result: **NOT RUN**

| | |
|---|---|
| Preconditions | As H-5, signed in. The tester rides a bus, tram or car as a passenger only. Never operate a vehicle while using the phone |
| Steps | 1. Start Free Run on foot. 2. Walk 100 m, board a vehicle, ride 1 to 2 km, get off, walk 100 m. 3. Finish and save. 4. Repeat once with a short ride of about 500 m |
| Expected | Vehicle-speed segments earn no walking distance or XP (packet section 5, MR-A-02). The summary says so or marks the session unverified or rejected with a reason. The walking parts are not silently lost without explanation. Not recorded as a verified walk of the full distance |
| Evidence | Summary screenshots; the reported distance against the walked distance, in words; the verdict text |

Pass [ ]  Fail [ ]  Notes: ____________________  Tester/date: ______________

## H-7 Reduced and denied location

Result: **NOT RUN**

| | |
|---|---|
| Preconditions | Fresh install or cleared permissions. Android 12+ |
| Steps | 1. Move, deny once, press Start again. 2. Deny twice, return to Move: "Open Settings" works. 3. Grant approximate only (Android 12+ toggle). 4. Grant precise "Only this time". 5. With location services off, press Start. 6. Note whether any copy still mentions a demo route (known defect QA0-12) |
| Expected | No background-location prompt ever. Denied: clear message and working Open Settings. Approximate only: no distance is counted and a clear message appears, not a silent stall. Services off: Open Settings path, no crash. Precise: session starts |
| Evidence | One screenshot per state; written note of any copy defect |

Pass [ ]  Fail [ ]  Notes: ____________________  Tester/date: ______________

## H-8 Google and Ethereum sign-in return

Result: **NOT RUN** (blocked until the owner turns the providers on; see `X05_OWNER_STEPS_SHORT.md`. Google first, wallet only after a verified Google session)

| | |
|---|---|
| Preconditions | Providers enabled by the owner. Test Google account. Optional unfunded test wallet app. Signed out |
| Steps | **(a) Google.** 1. Continue with Google, pick the test account. 2. Confirm the browser returns to `movenrun://auth/callback` and the app lands signed in with no "unmatched route". 3. Save one verified session. **(b) Ethereum.** 4. Continue with Wallet. 5. Note whether the wallet returned to the app or the 12-character code was needed. 6. Read the wallet prompt |
| Expected | (a) Signed in. (b) The prompt names movenrun.xyz and asks for a signature only: no transaction, approval, network switch or fee. Signed in. Google and wallet make separate accounts (manual linking off) |
| Evidence | Signed-in Account screenshot (identifiers hidden); which return path happened; a screenshot of the wallet prompt with the address hidden. Never capture the code, a token or the address bar |

Pass (a) [ ] (b) [ ]   Fail (a) [ ] (b) [ ]   Blocked [ ]  Notes: ________

## H-9 Malformed callback and deep-link interception

Result: **NOT RUN**

| | |
|---|---|
| Preconditions | Installed, signed out, no sign-in started. Use only the dummy values below |
| Steps | 1. `adb shell cmd package query-activities --components -a android.intent.action.VIEW -d "movenrun://auth/callback"`. 2. `adb shell am start -W -a android.intent.action.VIEW -d "movenrun://auth/callback?code=x" io.movenrun.app`. 3. Malformed variants, one at a time: no query; `?code=`; `?error=access_denied`; a 5,000-character `code`; `movenrun://auth/unknown`. 4. `adb shell am start -W -a android.intent.action.VIEW -d "movenrun://auth/wallet?code=AAAAAAAAAAAA" io.movenrun.app`. 5. After each, check the app state. 6. `adb logcat -d -s AndroidRuntime:E` for a crash. 7. Share a link or image to MovenRun from another app (QA0-35) |
| Expected | Only `io.movenrun.app/.MainActivity` handles the link. Every forged or malformed link opens the app and steps back, still signed out, no crash, no stack trace on screen. A wallet code without this phone's verifier is refused. Nobody is signed in by a link the app did not start. App is not offered as a share target or ignores it safely. Report any crash or odd navigation against the #131 exception (`query-string` path) |
| Evidence | Component name from `query-activities`; the `Status: ok` lines; a screenshot of the signed-out state afterwards |

Pass [ ]  Fail [ ]  Notes: ____________________  Tester/date: ______________

## H-10 Honest pending and account deletion

Result: **NOT RUN**

| | |
|---|---|
| Preconditions | Signed in test account with at least one saved session, one pending session left offline (as H-2), and a cold API where possible |
| Steps | 1. Look at the pending session on Profile and Summary. 2. Check XP, streak and zones before and after it is verified. 3. Save while the API is cold if possible. 4. Sign out with a pending session: confirm no queued route survives (QA0-36). 5. Profile, Account, Account security, Delete account, confirm. 6. Confirm signed out and local progress cleared. 7. Sign in again with the same account: fresh, 0 verified sessions. 8. Owner (not the tester): confirm server rows are gone with the read-only check in `ANDROID_DEVICE_GATE_PLAN.md`, and that `https://movenrun.xyz/account-deletion/` works without the app |
| Expected | Pending is labelled pending and never shown as earned XP; pending never silently becomes earned XP without a verified response. Error messages are categorised (offline, took too long, rejected, signed out), not one generic line. Deletion signs out, clears local progress, and a re-sign-in creates a fresh account. Low storage (QA0-34): save works or fails clearly, never half-written |
| Evidence | Screenshots of pending, XP unchanged, the deletion result and the fresh account (identifiers hidden); the time a cold API took, in words; owner's yes/no on server rows |

Pass [ ]  Fail [ ]  Notes: ____________________  Tester/date: ______________

## H-11 Maps tiles, 200% text, TalkBack, reduced motion

Result: **NOT RUN**

| | |
|---|---|
| Preconditions | **(a)** Maps key restricted to `io.movenrun.app` plus the SHA-1 of the key that signed this APK (owner-confirmed; preview and Play SHA-1 differ). Phone online. **(b)** Settings, Display: font size and display size at the largest (about 200%). 320 dp width if possible |
| Steps | **(a)** 1. Open Territory and a zone map. 2. Pan and zoom. **(b)** 3. Walk welcome, Home, Move, Finish, Back, Summary at the largest sizes. 4. TalkBack on: Home, Move, Profile; start, pause and finish a run by TalkBack only; weak-signal state. 5. Remove animations and finish a route that makes a preview zone. 6. Outdoors at full brightness, read Summary and Route History. 7. Restore settings |
| Expected | (a) Real Google tiles with streets and labels. Grey tiles with a Google logo means a wrong or missing signing SHA-1: fail. (b) No clipped distance, task text or buttons; Move, Finish, Back reachable. Controls have spoken names; state changes are spoken (Track A expects fails today, S2-3 to S2-6: record them, do not hide them). No burst animation with animations removed |
| Evidence | Map screenshot, location blurred, no key or fingerprint; screenshot at the largest font showing Move and Finish; written notes of unlabelled or skipped controls |

Pass (a) [ ] (b) [ ]   Fail (a) [ ] (b) [ ]  Notes: ____________________

## H-12 Native manifest, exported components, 16 KiB libraries, backup and restore refusal

Result: **NOT RUN**

Detail: `ANDROID_16KB_PAGE_SIZE.md` ("Verifying a built APK or AAB") and
`ANDROID_DEVICE_GATE_PLAN.md` ("Backup and transfer procedure (A2)").
A backup failure is a privacy blocker.

| | |
|---|---|
| Preconditions | The APK, `aapt2`, `zipalign`, `llvm-readelf`; ideally a 16 KB Android 15+ emulator image; for (b) a spare or second Android 12+ phone. Note the current backup transport and `bmgr enabled` so you can restore them |
| Steps | **(a) Manifest.** 1. `aapt2 dump badging movenrun.apk` for package, minSdk, targetSdk (expect 24 and 36 from Expo SDK 54 defaults; unconfirmed). 2. `aapt2 dump xmltree movenrun.apk --file AndroidManifest.xml`: list uses-permission (expect only coarse and fine location, plus INTERNET and VIBRATE), `usesCleartextTraffic`, every `exported="true"` component, and intent filters. **(b) Backup.** 3. Same dump `\| grep -E "allowBackup\|dataExtractionRules"`. 4. `adb shell dumpsys package io.movenrun.app \| grep -E "^ *(pkgFlags\|flags)="`. 5. `adb shell bmgr backupnow io.movenrun.app` and `adb shell dumpsys backup \| grep -i movenrun`. 6. Emulated transfer: local transport with `is_device_transfer=true`, then `backupnow`. 7. Real transfer to a second phone, then open the app. 8. Restore the transport and settings. **(c) 16 KiB.** 9. `zipalign -v -c -P 16 4 movenrun.apk \| tail -1`. 10. For each 64-bit `.so`: `llvm-readelf -lW <so> \| awk '/LOAD/{print $NF}' \| sort -u`. 11. On the 16 KB image: `adb shell getconf PAGE_SIZE` is `16384`; install and repeat H-1 |
| Expected | (a) No background location, foreground service, `LocationTaskService`, overlay, storage or audio permission; cleartext false; only `MainActivity` exported (plus AndroidX `ProfileInstallReceiver`, system-only); one `movenrun` scheme filter, no http(s) app links. (b) `allowBackup` false and `dataExtractionRules` pointing at an `@xml/` resource; no `ALLOW_BACKUP` flag; `backupnow` says `Backup is not allowed`; package absent from `dumpsys backup`; after a real transfer the app opens signed out with no XP, streak, pending session or route (if the sideloaded app was not carried over, mark Inconclusive and repeat on the Play internal install). (c) `Verification successful`; every 64-bit library `0x4000` or larger (name any `0x1000` or `0x2000`); `libreactnative.so` and `libhermes.so` recorded explicitly; app starts on the 16 KB image |
| Evidence | Manifest lines; permission list; exported component list with reasons; `backupnow` result line; one line on whether the app crossed in the transfer plus the signed-out screenshot; last `zipalign` line; library names with alignment only; `16384` |

Pass (a) [ ] (b) [ ] (c) [ ]   Fail (a) [ ] (b) [ ] (c) [ ]   Inconclusive (b) [ ]
Notes: ____________________  Tester/date: ______________

---

## Run header

| Field | Value |
|---|---|
| Phone model | |
| Android version | |
| Device slot (D1 to D4) | |
| Play services present | Yes [ ]  No [ ] |
| EAS build id | |
| Built from commit | |
| Tester name | |
| Date of run | |
| Rows passed / failed / not run | 0 / 0 / 12 |

Blockers for the preview build: a fail in H-1, H-3, H-5, H-9, H-10 (deletion)
or H-12(b). A NOT RUN in H-3 or H-5 also stops the candidate being called
phone-tested.

Record results and evidence file names in `EVIDENCE_REGISTER.md`. A row that
was not run is not a pass.

## Internal risk register link (not a Data safety answer)

One dependency advisory ships in the bundle of this candidate:
`GHSA-vcc3-ghjq-m6fr` via `query-string@7.1.3` and `decode-uri-component`
(#131), a time-limited exception with proposed expiry 21 Nov 2026. A reachable
dependency is not an exploited path. H-9 exercises the deep-link path that its
reachability analysis relies on. It is an internal register item and must not
be copied into any Play Data safety answer.
