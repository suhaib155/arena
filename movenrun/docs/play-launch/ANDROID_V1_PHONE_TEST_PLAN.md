# Android Play v1: the one phone test plan (H-1 to H-12)

This is the single handset plan for the Play v1 candidate. It replaces three
overlapping drafts: the ten-row sheet in #132, the twelve-row sheet in #142
(`QA0_HANDSET_WORKSHEET.md` on those branches) and the table in section 4.4 of
`ANDROID_RC_BUILD_GATES_29OCT.md` (#177). Do not add another checklist. If a
row needs to change, change it here. The long-form detail still lives in
`HANDSET_TEST_SCRIPT.md` and `ANDROID_DEVICE_GATE_PLAN.md`; where they differ
from this file, fix this file.

**Every row is NOT RUN.** No APK, AAB or phone run exists. Unit tests and type
checks say nothing about Hermes, Maps signing, outdoor GPS, Android backup,
TalkBack or system link handling. A row that was not run on a handset is not a
pass.

## What each required scenario maps to

| Required scenario | Row |
|---|---|
| Outdoor stationary | H-3 |
| Small loop | H-4(a) |
| Screen lock | H-4(c) |
| Background stop | H-4(d) |
| 400 m track loop | H-5(a) |
| Honest slow walk | H-5(b) |
| Bus or vehicle segment | H-6(a) |
| Clock jump | H-6(b) |
| Offline retry | H-2(b), H-2(c) |
| Duplicate submission | H-2(d) |

## Applies to

| Item | Value |
|---|---|
| Candidate | Branch `feat/android-rc-truth-30oct`, or the integration head that replaces it. Record the full 40-character SHA in the run header |
| Build gate | One EAS preview APK needs the owner's written approval: `ANDROID_PREVIEW_APK_BUILD_REQUEST_30OCT.md`. Until an APK exists every row stays NOT RUN |
| Package | `io.movenrun.app` |
| Server | Record which API the phone talks to (owner decision O-3). The hosted staging API runs an older backend without MR-A-01, MR-A-02 or the future-skew check, so H-4, H-5 and H-6 verdicts then describe the old server, not this candidate's rules |
| Out of scope | Gameplay, territory economy, tokens, Play-installed behaviour (Play rows are blocked on X-01) |

## Mandatory rows and blockers

H-3 (stationary) and H-5 (track loop, slow walk, long walk) are mandatory. If
either is NOT RUN or FAIL, the candidate is not phone-tested, whatever the
other rows say. A FAIL in H-1, H-3, H-5, H-9, H-10 (deletion) or H-12(b) blocks
the candidate.

## Devices and tools

- A physical Android phone, Android 12 or later (14 or later preferred), with
  Google Play services and a test Google account. An emulator only where a row
  says so; then write "emulator".
- Slots: D1 lowest supported version (minSdk 24 expected, confirm in H-12);
  D2 Android 12 to 13 mid-range; D3 Android 15 or 16 Pixel for 16 KiB checks;
  D4 320 dp width or emulator for font checks. One device is enough for a first
  pass; say which.
- Outdoors with a GPS fix for H-3 to H-6. Start and end at least 200 m from any
  home.
- A computer with `adb`, a cable and, for H-12, `aapt2`, `zipalign` and
  `llvm-readelf` (build-tools 35 or later).
- A fresh unfunded test wallet. Never a main wallet. Never type a recovery
  phrase.
- Prefer a spare phone: H-12(b) can change the backup transport. Write down what
  you change and restore it.
- Never operate a vehicle while using the phone (H-6).

## Evidence rules

- No real GPS coordinates, place names, addresses or identifying map
  backgrounds. Crop or blur. A route line on a blank background is fine. No
  `adb logcat` lines containing coordinates.
- No tokens, codes, cookies, API keys, wallet codes, PKCE values, email or
  wallet addresses, account or session ids, device serials, Maps keys or
  fingerprints.
- Log evidence is one line copied exactly. If a line cannot be shown without an
  identifier, write what it said in words.
- Screenshots are cropped to the app, named by row (`H-4a-pass.png`), kept out
  of the repository, and listed by name in `EVIDENCE_REGISTER.md`.
- Fill the run header once, at the bottom.

## Which XP wording to expect (applies to every walking row)

The candidate says what kind of XP a number is. Check these on each saved walk
and record any mismatch:

| Moment | Summary screen shows | Home "XP today" tile |
|---|---|---|
| Before Save | "+N XP" with "Estimate, counts when saved" | unchanged |
| Saved, signed out | "Estimated on this phone" | "XP today (est.)" |
| Saved, signed in, no answer yet (offline, cold API) | "Estimated, waiting for the server check" | "XP today (est.)" |
| Server verified | "Verified" (XP may be lower than the estimate) | plain "XP today" once nothing is unsettled |
| Server declined | "Not eligible" and the estimate is taken back | the taken-back amount disappears from the total |

Saving is not server-verified earnings. XP in v1 is in-app progress with no cash
value and no payout.

---

## H-1 Cold install and cold start (Hermes). BLOCKER

Result: **NOT RUN**

| | |
|---|---|
| Preconditions | Fresh `adb install -r movenrun.apk`, never opened. `adb logcat -c` run |
| Steps | 1. `adb shell am force-stop io.movenrun.app`. 2. `adb shell am start -W -n io.movenrun.app/.MainActivity`; note `Status` and `TotalTime`. 3. Wait for the first screen. 4. `adb logcat -d -s ReactNativeJS:V AndroidRuntime:E \| grep -iE "RangeError\|Unknown encoding\|FATAL\|TextDecoder"`. 5. Walk the first run: Welcome, Terms, intro, Home. No location prompt before Move. 6. Open Territory. 7. Force-stop and repeat steps 2 to 4 twice more |
| Expected | `Status: ok` three times. Territory draws. The grep prints nothing (the #94 UTF-16LE regression). Intro step 2 says "Explore new ground"; the Territory intro says the ground is a personal preview, not ownership |
| Evidence | The three `Status: ok` and `TotalTime` lines; "no output" for the grep; one screenshot of the first screen |

Pass [ ]  Fail [ ]  Notes: ____________________  Tester/date: ______________

## H-2 Offline start, offline save, retry, duplicate submission

Result: **NOT RUN**

| | |
|---|---|
| Preconditions | Signed in once earlier for (b) to (d). Online at the start |
| Steps | **(a) Offline start.** Force-stop, airplane mode on, cold start, open Home, Territory and a map screen. **(b) Offline save.** With airplane mode on, finish a short saved walk while signed in. Note the pending state. Force-stop and reopen: still pending. **(c) Retry.** Airplane mode off. Wait, or use the retry. If the API is cold, allow about a minute. **(d) Duplicate submission.** Double-tap Save quickly. After (c), trigger the retry again, and background and reopen the app while it runs |
| Expected | (a) Starts, shows screens, no crash, no endless spinner; tiles may be missing. (b) Pending, never "verified"; the summary says the XP is estimated and waiting for the server check; Home reads "XP today (est.)". (c) Verified exactly once (count rises by one, not two) or a clear "took too long" message with usable buttons and the session still pending. (d) One saved session, one XP award, one verification; no second history row |
| Evidence | Screenshots of the offline start, the pending state, and the verified count before and after (identifier hidden). Time taken, in words |

Pass (a) [ ] (b) [ ] (c) [ ] (d) [ ]   Fail (a) [ ] (b) [ ] (c) [ ] (d) [ ]
Notes: ____________________

## H-3 Outdoor stationary. MANDATORY

Result: **NOT RUN**

| | |
|---|---|
| Preconditions | Precise location allowed. Outdoors, clear sky, GPS fix, phone held still. Repeat once near tall buildings if possible |
| Steps | 1. Start Free Run. 2. Stand still 60 to 90 s and watch distance. 3. Stay still 5 min in total, finish and save |
| Expected | Distance stays about 0 m and under 25 m in the worst case. Record the number honestly. The candidate has no stationary-drift rule and the server stationary rule is off, so a drifting phone may record distance (known case S03); that is evidence for the owner, not a pass or fail trick. Route line does not grow while still. No movement XP, streak or zone credit if the session recorded no route |
| Evidence | Screenshot at about 0 m (map cropped); summary; the final distance as a number, open sky and tall buildings separately |

Pass [ ]  Fail [ ]  Open sky m: ____  Tall buildings m: ____  Notes: ________

## H-4 Short walk, small loop, pause, screen lock, background stop, quest once

Result: **NOT RUN**

| | |
|---|---|
| Preconditions | Outdoors, precise location, a way to estimate distance |
| Steps | **(a) Small loop.** Free Run, walk a closed loop of about 100 to 300 m that crosses or returns to the start, finish and save. Watch the live loop line. **(b) Pause.** Walk about 50 m, pause, walk about 50 m paused, resume, walk about 50 m, finish. **(c) Screen lock.** Lock the screen for 2 minutes mid-walk, unlock, continue. **(d) Background stop.** Switch to another app for 2 minutes mid-walk, return. **(e) Quest once.** Finish a quest early (expect 0 XP). Complete one validly. Repeat it the same day. Force-stop, reopen, check XP |
| Expected | (a) Route follows the path; distance plausible. The live line says "loop closed" and the card is titled "Loop preview" with "This is a preview and nothing is claimed". No "sealed", "banked" or "capture" wording. The server verdict depends on the API (O-3); a very short urban walk may be rejected (MR-A-01): record it. (b) No bridge across the paused gap; total about 100 m, not 150 m. (c) and (d) A gap with no invented route and no distance across it; tracking stops in the background and there is no "Allow all the time" prompt. The summary says the full route could not be retained, if it says anything. (e) Early finish 0 XP; one award; no repeat award; XP unchanged after restart |
| Evidence | Summary screenshots (distance, time); your own estimate in words; XP before, after, after repeat |

Pass (a) [ ] (b) [ ] (c) [ ] (d) [ ] (e) [ ]   Fail (a) [ ] (b) [ ] (c) [ ] (d) [ ] (e) [ ]
Notes: ____________________

## H-5 400 m track loop, honest slow walk, long walk. MANDATORY

Result: **NOT RUN**

| | |
|---|---|
| Preconditions | Outdoors, charged phone, precise location, signed in. Start and end at least 200 m from home. Note battery % and temperature at the start |
| Steps | **(a) 400 m track loop.** Walk one standard 400 m lap (a running track or a measured block) at a steady pace, finish and save. Record the reported distance. **(b) Honest slow walk.** Walk 200 to 300 m at about 2 to 3 km/h with a deliberate slow pace (a stroll, or pushing a pram), finish and save. **(c) Long walk.** At least 1.5 km or 15 minutes, with one stretch between tall buildings and one deliberate 30 s stop. Note battery % and temperature at the end |
| Expected | (a) Reported distance within about 10% of 400 m; the lap closes and the preview says "loop closed". (b) A slow honest walk is not thrown away as stationary: distance counts, or the summary gives a plain reason. Record exactly what it did, because slow walking is the case the rejected 4x rule would have broken. (c) Within about 10% of the measured route; no teleport jumps or straight lines across blocks; the stop is not counted as movement; an honest verdict (verified, pending, not eligible) |
| Evidence | Summary screenshots (distance, time, verdict); route shape without map; the measured route length as a number; battery and temperature figures |

Pass (a) [ ] (b) [ ] (c) [ ]  Fail (a) [ ] (b) [ ] (c) [ ]
Measured m: ____  Reported m: ____  Battery used: ____  Notes: ________

## H-6 Bus or vehicle segment and clock jump

Result: **NOT RUN**

| | |
|---|---|
| Preconditions | As H-5, signed in. For (a) the tester rides a bus, tram or car as a passenger only |
| Steps | **(a) Vehicle.** Start Free Run on foot. Walk 100 m, board a vehicle, ride 1 to 2 km, get off, walk 100 m. Finish and save. Repeat once with a short ride of about 500 m. **(b) Clock jump.** Start a walk, then in Settings turn automatic time off and move the clock forward one hour, return to the app, continue 100 m, finish and save. Repeat with the clock moved back one hour. Restore automatic time afterward |
| Expected | (a) Vehicle-speed stretches earn no walking distance on the phone (MR-A-02); the server verdict follows the API in O-3. The session is not shown as a verified walk of the full distance. (b) The app uses its own monotonic session clock: duration and distance are not inflated or negative, and a skew greater than 5 minutes is refused by a server that has the check. Record what the summary said |
| Evidence | Summary screenshots; reported distance against walked distance, in words; the verdict text |

Pass (a) [ ] (b) [ ]  Fail (a) [ ] (b) [ ]  Notes: ____________________

## H-7 Reduced and denied location

Result: **NOT RUN**

| | |
|---|---|
| Preconditions | Fresh install or cleared permissions. Android 12 or later |
| Steps | 1. Move, deny once, press Start again. 2. Deny twice, return to Move: "Open Settings" works. 3. Grant approximate only. 4. Grant precise "Only this time". 5. With location services off, press Start |
| Expected | No background-location prompt ever. Denied and services-off copy says to turn location on in Settings and mentions no demo route (release builds have none). Approximate only: no distance is counted and a clear message appears. Precise: the session starts |
| Evidence | One screenshot per state; note any copy defect |

Pass [ ]  Fail [ ]  Notes: ____________________  Tester/date: ______________

## H-8 Google and wallet sign-in return

Result: **NOT RUN** (blocked until the owner turns the providers on, X-05; Google first, wallet only after a verified Google session)

| | |
|---|---|
| Preconditions | Providers enabled by the owner. Test Google account. Optional unfunded test wallet. Signed out |
| Steps | **(a) Google.** Continue with Google, pick the test account, confirm the return to `movenrun://auth/callback` lands signed in with no "unmatched route". Save one verified session. **(b) Wallet.** Continue with Wallet. Note whether the wallet returned to the app or the 12-character code was needed. Read the wallet prompt |
| Expected | (a) Signed in. (b) The prompt names movenrun.xyz and asks for a signature only: no transaction, approval, network switch or fee. Google and wallet make separate accounts |
| Evidence | Signed-in Account screenshot (identifiers hidden); which return path happened; wallet prompt with the address hidden. Never capture the code, a token or the address bar |

Pass (a) [ ] (b) [ ]  Fail (a) [ ] (b) [ ]  Blocked [ ]  Notes: ________

## H-9 Malformed callback and link parser

Result: **NOT RUN**

| | |
|---|---|
| Preconditions | Installed, signed out, no sign-in started. Dummy values only |
| Steps | 1. `adb shell cmd package query-activities --components -a android.intent.action.VIEW -d "movenrun://auth/callback"`. 2. `adb shell am start -W -a android.intent.action.VIEW -d "movenrun://auth/callback?code=x" io.movenrun.app`. 3. One at a time: no query; `?code=`; `?error=access_denied`; a 5,000-character `code`; `movenrun://auth/unknown`. 4. `adb shell am start -W -a android.intent.action.VIEW -d "movenrun://auth/wallet?code=AAAAAAAAAAAA" io.movenrun.app`. 5. After each, check the app state. 6. `adb logcat -d -s AndroidRuntime:E` for a crash |
| Expected | Only `io.movenrun.app/.MainActivity` handles the link. Every forged or malformed link opens the app and steps back, still signed out, no crash. A wallet code without this phone's verifier is refused. Report any crash or odd navigation against the `query-string` exception (DEP-EXC-2026-001) |
| Evidence | Component name from `query-activities`; the `Status: ok` lines; a signed-out screenshot afterwards |

Pass [ ]  Fail [ ]  Notes: ____________________  Tester/date: ______________

## H-10 Honest pending and account deletion

Result: **NOT RUN**

| | |
|---|---|
| Preconditions | Signed in test account with a saved session and one pending session left offline (as H-2) |
| Steps | 1. Look at the pending session on Profile and Summary. 2. Check XP, streak and "XP today" before and after it is verified or declined. 3. Sign out with a pending session: no queued route survives. 4. Account, Account security, Delete account, confirm. 5. Confirm signed out and local progress cleared. 6. Sign in again with the same account: fresh, 0 verified sessions. 7. Owner (not the tester): confirm server rows are gone with the read-only check in `ANDROID_DEVICE_GATE_PLAN.md`, and that `https://movenrun.xyz/account-deletion/` works without the app |
| Expected | Pending is labelled estimated and waiting, never verified. A declined session reads "Not eligible" and "XP today" drops by the taken-back amount. The deletion dialog and the success message say account data is deleted and that removal of the sign-in record is requested and may still be finishing; they do not say "permanently deleted". A re-sign-in creates a fresh account |
| Evidence | Screenshots of pending, the XP change, the deletion result and the fresh account (identifiers hidden); owner's yes or no on server rows |

Pass [ ]  Fail [ ]  Notes: ____________________  Tester/date: ______________

## H-11 Maps tiles, 200% text, TalkBack, reduced motion

Result: **NOT RUN**

| | |
|---|---|
| Preconditions | (a) Maps key restricted to `io.movenrun.app` plus the SHA-1 of the key that signed this APK (preview and Play SHA-1 differ; owner-confirmed). Phone online. (b) Font size and display size at the largest (about 200%); 320 dp width if possible |
| Steps | (a) Open Territory and a zone map; pan and zoom. (b) Walk welcome, Home, Move, Finish, Back, Summary at the largest sizes. TalkBack on: Home, Move, Profile; start, pause and finish a run by TalkBack only. Remove animations and finish a route. Restore settings |
| Expected | (a) Real Google tiles. Grey tiles with a Google logo mean a wrong or missing signing SHA-1: fail. (b) No clipped distance, task text or buttons; Move, Finish, Back reachable. Controls have spoken names. Record failures, do not hide them |
| Evidence | Map screenshot with the location blurred, no key or fingerprint; a screenshot at the largest font showing Move and Finish; notes on unlabelled controls |

Pass (a) [ ] (b) [ ]  Fail (a) [ ] (b) [ ]  Notes: ____________________

## H-12 Manifest, backup and transfer, 16 KiB

Result: **NOT RUN**

Detail: `ANDROID_16KB_PAGE_SIZE.md` and `ANDROID_DEVICE_GATE_PLAN.md` (backup and
transfer procedure). A backup failure is a privacy blocker. The exact commands
are repeated in `ANDROID_PREVIEW_APK_BUILD_REQUEST_30OCT.md` section 6.

| | |
|---|---|
| Preconditions | The APK, `aapt2`, `zipalign`, `llvm-readelf`; ideally a 16 KB Android 15+ image; for (b) a spare Android 12+ phone. Note the current backup transport so you can restore it |
| Steps | (a) Manifest: `aapt2 dump badging` and `aapt2 dump xmltree --file AndroidManifest.xml`. (b) Backup: `allowBackup` and `dataExtractionRules`, `adb shell bmgr backupnow io.movenrun.app`, `dumpsys backup`, emulated and real transfer to a second phone. (c) 16 KiB: `zipalign -v -c -P 16 4`, `llvm-readelf -lW` on each 64-bit `.so`, `getconf PAGE_SIZE` on the 16 KB image |
| Expected | (a) Fine and coarse location, INTERNET, VIBRATE only; no background location, foreground service, overlay, storage or audio; cleartext false; only `MainActivity` exported (plus AndroidX `ProfileInstallReceiver`); one `movenrun` scheme filter. (b) `allowBackup` false; `backupnow` says `Backup is not allowed`; after a real transfer the app opens signed out with no XP, streak, pending session or route (if the sideloaded app did not cross, mark Inconclusive). (c) `Verification successful`; every 64-bit library `0x4000` or larger; the app starts on the 16 KB image |
| Evidence | Manifest lines; permission list; exported components with reasons; the `backupnow` line; the last `zipalign` line; library names with alignment only |

Pass (a) [ ] (b) [ ] (c) [ ]  Fail (a) [ ] (b) [ ] (c) [ ]  Inconclusive (b) [ ]
Notes: ____________________

---

## Run header

| Field | Value |
|---|---|
| Phone model | |
| Android version | |
| Device slot (D1 to D4) | |
| Play services present | Yes [ ]  No [ ] |
| API used (O-3) | |
| EAS build id | |
| Built from commit (full SHA) | |
| APK SHA-256 | |
| Tester | |
| Date of run | |
| Rows passed / failed / not run | 0 / 0 / 12 |

Record results and evidence file names in `EVIDENCE_REGISTER.md`. A row that
was not run is not a pass. Play-installed rows (internal track, Play App
Signing SHA-1 on the Maps key, App bundle explorer) are blocked on X-01 and are
not part of this plan.

## Internal risk register link (not a Data safety answer)

One dependency advisory ships in the bundle: `GHSA-vcc3-ghjq-m6fr` via
`query-string@7.1.3` and `decode-uri-component`, a time-limited exception
(DEP-EXC-2026-001) until 21 Nov 2026 with reassessment by 14 Nov. H-9 exercises
the deep-link path its reachability analysis relies on. It is an internal
register item and must not be copied into any Play Data safety answer.
