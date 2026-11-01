# Android Play v1: the one phone test plan (H-1 to H-12), phone only

This is the single handset plan for the Play v1 candidate. It replaces the
earlier version of this file (which needed a computer with `adb`), the sheets
in #132 and #142 and section 4.4 of `ANDROID_RC_BUILD_GATES_29OCT.md`. Do not
add another checklist; change this file.

**Every row is NOT RUN.** No APK exists. Unit tests, type checks and the CI
release build say nothing about a real phone, outdoor GPS, signed Maps tiles
or TalkBack. A row that was not run on a handset is not a pass.

**Phone only.** Everything here is done with one Android phone and its
browser. No computer, cable, `adb` or terminal. The checks that used to need a
computer (manifest, permissions, backup flag, 16 KB alignment, Hermes,
signing) now run in GitHub Actions against the actual APK: see section B.

## A. Which build this sheet applies to

| Item | Value |
|---|---|
| Approved build SHA | `ac8d87bed55f4dae0b9152ed21fa8cc29b8050f9` (one EAS `preview` APK, conditional on the EAS prerequisites; owner approval of 30 Oct) |
| Integration head after this change | Recorded in the merge commit of the PR that changed this file. A build from that head needs a **new** owner approval naming it; the `ac8d87b` approval does not move |
| Difference between the two for the tester | K-1 below: on `ac8d87b` a guest save wrongly reads "waiting for the server check"; on the new head it reads "Estimated on this phone" |
| **The `ac8d87b` APK cannot pass the gate** | Its merged manifest still carries `USE_BIOMETRIC` and `USE_FINGERPRINT` (pulled in by `expo-secure-store`; the app never uses them). The gate now forbids both, so an APK built from `ac8d87b` FAILs row A5 and must not be installed under this plan. No deviation is accepted. The owner action is a **fresh approval of one EAS preview build from the integration head**, naming that SHA; until then the EAS build stays held |
| Package | `io.movenrun.app` |
| Server | `https://movenrun-staging-api.onrender.com` (Render, live deploy at `efd381b`). That backend does **not** have MR-A-01 (short-walk evidence), MR-A-02 (no distance across a vehicle jump) or the 5-minute future-skew refusal. Server verdicts in H-4(a), H-5(b) and H-6 are therefore **BLOCKED**; record only what the phone shows |
| Out of scope | Territory, Deeds, tokens, clubs, competition, wallet transactions, Play-installed behaviour |

Mandatory: H-3 and H-5. A FAIL in H-1, H-3, H-5, H-7, H-10 or H-12 blocks the
candidate.

## B. Before installing: the cloud artifact gate must be PASS

Nobody installs an APK until GitHub Actions has inspected that exact file.

1. Someone with repository access pushes a branch named
   `artifact-check/<build id>` that adds
   `movenrun/mobile/release/artifact-gate-request.json` containing
   `{"buildId": "<EAS build id>"}`. Claude can do this from a cloud session.
2. The `android-artifact-gate` workflow reads the build's metadata with the
   pinned EAS CLI (read-only, no new build), downloads the APK and checks rows
   A1 to A19: package, versionCode, target SDK 36, min SDK, permission
   allowlist (no background location, foreground service, overlay, storage,
   media, audio or camera), `allowBackup=false`, data extraction rules,
   cleartext off, not debuggable, only `MainActivity` and the AndroidX profile
   receiver exported, only the `movenrun` scheme, Hermes bytecode, 64-bit
   libraries, 16 KB ELF and zip alignment, a server-secret scan, size, Maps key
   present, and the signing certificate (yes or no only).
3. The job is green only on PASS. BLOCKED (for example, no expected signing
   digest stored yet) is red, and so is FAIL. The report is in the job summary
   and the `android-artifact-gate-eas-preview` artifact; it never contains the
   Maps key, the download link or a certificate fingerprint.
4. The report must name the same git commit as section A. If it names another
   commit, stop: that is not the approved build.

The same gate already runs on every pull request that touches native config,
against an APK the runner builds itself without EAS (debug key, no Maps key).
That proves the packaging of the source, not the EAS file.

## C. Installing on the phone

1. Open the EAS internal-distribution link for the build on the phone (from
   the Expo dashboard or the build log; it may ask for the Expo sign-in). Tap
   **Install** and download the APK.
2. Android asks to allow installs from the browser: allow it for this one
   install, then turn the permission off again in Settings > Apps > (browser)
   > Install unknown apps.
3. Play Protect may warn about an unknown developer: this is expected for an
   internal APK. Do not install any APK from another source.

## D. Evidence rules

- Screenshots only, cropped to the app. No real coordinates, street names,
  addresses or recognisable map backgrounds: crop or blur the map. A route line
  on a blank background is fine.
- Never capture tokens, codes, email or wallet addresses, account ids, the
  Maps key or the browser address bar during sign-in.
- Name screenshots by row (`H-4a-pass.png`), keep them out of the repository,
  and list them by name in `EVIDENCE_REGISTER.md`.
- Write numbers you observed. If a value was not observed, write "not seen".

## E. Which XP wording to expect on every saved walk

| Moment | Summary shows | Home "XP today" tile |
|---|---|---|
| Before Save | "+N XP" and "Estimate, counts when saved" | unchanged |
| Saved as a guest | "Estimated on this phone" (on `ac8d87b`: wrongly "waiting for the server check", K-1) | "XP today (est.)" |
| Saved signed in, no answer yet | "Estimated, waiting for the server check" | "XP today (est.)" |
| Server verified | "Verified" (may be lower than the estimate) | plain "XP today" once nothing is unsettled |
| Server declined | "Not eligible"; the estimate is taken back | total drops by that amount |

XP is in-app progress with no cash value and no payout.

---

## H-1 Install and cold start. BLOCKER

Result: **NOT RUN**

| | |
|---|---|
| Steps | 1. Install (section C). 2. Open the app; time it with a stopwatch to the first screen. 3. Walk the first run: Welcome, Terms, intro, Home. 4. Open Territory. 5. Swipe the app away from Recents and reopen. Repeat twice |
| Expected | Opens three times without "MovenRun keeps stopping". No location prompt before Move. Territory draws. Intro step 2 says "Explore new ground"; the Territory intro says the ground is a personal preview, not ownership. (The Hermes crash class from #94 is also covered by row A12 of the gate) |
| Evidence | Screenshot of the first screen; the three start times in seconds |

## H-2 Offline start, offline save, retry, duplicate taps

Result: **NOT RUN**

| | |
|---|---|
| Preconditions | Signed in once earlier (blocked until Google sign-in is enabled, X-05; guest-only parts (a) and (d) can run now) |
| Steps | (a) Airplane mode on, open the app, open Home, Territory and Move. (b) Signed in, airplane mode on, finish and save a short walk; swipe the app away and reopen. (c) Airplane mode off; wait up to a minute (the staging API sleeps when idle). (d) Double-tap Save quickly; then background and reopen while it runs |
| Expected | (a) No crash or endless spinner; map tiles may be missing. (b) Pending, never "Verified"; XP reads "waiting for the server check". (c) Verified or declined exactly once, or a clear "took too long" message with the session still pending. (d) One saved session, one XP award, one history row |
| Evidence | Screenshots of each state |

## H-3 Outdoor stationary. MANDATORY

Result: **NOT RUN**

| | |
|---|---|
| Steps | Precise location allowed, outdoors, phone held still. Start Free Run; stand still 60 to 90 s watching distance; stay still 5 minutes in all; finish and save. Repeat once near tall buildings if possible |
| Expected | Distance stays near 0 m. The candidate has no stationary-drift filter and the server rule is off, so a drifting phone may show some metres (known case S03): record the number honestly, it is evidence for the owner. No movement XP, streak or ground if no route was recorded |
| Evidence | Summary screenshot (map cropped); final distance open sky ____ m, tall buildings ____ m |

## H-4 Small loop, pause, screen lock, background, quest once

Result: **NOT RUN**

| | |
|---|---|
| Steps | (a) Walk a closed loop of 100 to 300 m back to the start; save. (b) Walk ~50 m, Pause, walk ~50 m, Resume, walk ~50 m, finish. (c) Lock the screen 2 minutes mid-walk. (d) Switch to another app 2 minutes mid-walk. (e) Finish a timed quest early (0 XP); complete one; repeat it the same day; swipe away and reopen |
| Expected | (a) Route follows the path; "Loop preview", "nothing is claimed"; no "sealed", "banked" or "capture" wording. Server verdict: **BLOCKED** (staging lacks MR-A-01; a short walk may be declined). (b) Total ~100 m, no line across the paused stretch. (c)(d) A gap with no invented route or distance; no "Allow all the time" prompt ever. (e) Early finish 0 XP; one award; no repeat award; XP unchanged after reopening |
| Evidence | Summary screenshots; your own distance estimate in words |

## H-5 400 m loop, slow walk, long walk. MANDATORY

Result: **NOT RUN**

| | |
|---|---|
| Steps | Start and end at least 200 m from home. (a) One 400 m track lap or measured block; save. (b) 200 to 300 m at a deliberate slow stroll; save. (c) At least 1.5 km or 15 minutes, with one stretch between tall buildings and one 30 s stop. Note battery % at start and end |
| Expected | (a) Within ~10% of 400 m; loop closes. (b) The slow walk is not thrown away as stationary (this is the case the rejected 4x rule would have broken). Server verdict for short routes: **BLOCKED** (MR-A-01 absent on staging). (c) Within ~10%; no straight lines across blocks; the stop adds nothing |
| Evidence | Summary screenshots; measured ____ m, reported ____ m; battery used ____ % |

## H-6 Vehicle segment and clock change

Result: **NOT RUN** (server part **BLOCKED**)

| | |
|---|---|
| Steps | (a) As a passenger only: walk 100 m, ride 1 to 2 km, walk 100 m; save. (b) Mid-walk, Settings > System > Date & time: turn automatic time off, move the clock forward 1 hour, return, walk 100 m, save. Repeat moving it back. Turn automatic time back on |
| Expected | (a) The ride earns no walking distance on the phone. The server verdict is **BLOCKED** (MR-A-02 absent on staging). (b) Duration and distance are not inflated or negative (the app times with its own monotonic clock). Also note whether distance stopped growing after the change: the phone rejects fixes stamped later than its session clock (audit note, needs this row) |
| Evidence | Summary screenshots; reported vs walked distance in words |

## H-7 Denied, approximate and switched-off location. BLOCKER

Result: **NOT RUN**

| | |
|---|---|
| Steps | 1. Move, deny once, press Start again. 2. Deny twice; "Open Settings" works. 3. Grant approximate only. 4. Grant precise "Only this time". 5. Location services off, press Start. 6. With the start blocked by step 2 or 5, tap "Open Settings", fix it, return with the Back gesture. 7. Mid-walk, pull down quick settings, turn Location off for 30 s, back on, walk 100 m, finish |
| Expected | No background-location prompt ever. Denied and off states say how to fix it in Settings and mention no demo route. Approximate only: no distance and a clear message. Precise: the session starts. On a build that contains K-2's fix: step 6 starts or retries by itself on return, and the Start Move screen no longer says permission is needed; step 7 shows "Location is off" within about 10 s, distance resumes after it is back on, and the summary shows a missing section. On `7409559`: step 6 needs Retry (or leaving and re-entering Start Move), and step 7 shows only a weak-signal chip; record what happens |
| Evidence | One screenshot per state |

## H-8 Google and wallet sign-in

Result: **BLOCKED** until the owner enables the providers (X-05)

| | |
|---|---|
| Steps | (a) Continue with Google, pick a test account, return to the app signed in; save one session. (b) Continue with Wallet with an unfunded test wallet |
| Expected | (a) Signed in with no "unmatched route". (b) The wallet asks for a signature naming movenrun.xyz only: no transaction, approval, network switch or fee. Google and wallet make separate accounts |
| Evidence | Signed-in Account screen with identifiers hidden; the wallet prompt with the address hidden |

## H-9 Sign-in return robustness

Result: **NOT RUN**

| | |
|---|---|
| Steps | 1. Start Google sign-in and press Back in the browser instead of choosing an account. 2. Start it again, then switch away to Home and reopen MovenRun from Recents. 3. While signed out, open Account |
| Expected | The app returns signed out with no crash, no blank screen and no endless spinner; sign-in can be started again |
| Not possible phone only | Forged and malformed `movenrun://` links (no query, empty code, 5,000-character code, unknown path, forged wallet code) need a link launcher. They are covered at source by the callback tests, and the gate's A10/A11 rows pin that only `MainActivity` handles the one `movenrun` scheme. Record "covered at source, not run on device" |

## H-10 Pending state and account deletion. BLOCKER

Result: **NOT RUN** (needs a signed-in account, so it waits on X-05)

| | |
|---|---|
| Steps | 1. With one pending session (as H-2), view Profile and Summary. 2. Watch XP and "XP today" before and after it settles. 3. Sign out with a session pending. 4. Account > Account security > Delete account; confirm. 5. Sign in again with the same account. 6. Open `https://movenrun.xyz/account-deletion/` in the phone browser |
| Expected | Pending reads estimated and waiting, never verified. Signing out leaves no queued route. The deletion wording says the request was received and removal of the sign-in record may still be finishing; it never says "permanently deleted". A new sign-in starts fresh. The website page works without the app |
| Evidence | Screenshots with identifiers hidden |

## H-11 Map tiles, largest text, TalkBack

Result: **NOT RUN**

| | |
|---|---|
| Steps | (a) Online, open Territory and a map; pan and zoom. (b) Settings > Display: font size and display size to the largest; walk Welcome, Home, Move, Finish, Back, Summary. (c) TalkBack on: start, pause and finish a session by TalkBack only. Restore settings afterwards |
| Expected | (a) Real Google tiles. Grey tiles with a Google logo mean the Maps key is not restricted to this APK's signing certificate: FAIL (owner fixes it in Google Cloud). (b) Nothing clipped; Move, Finish and Back reachable. (c) Every control has a spoken name |
| Evidence | Map screenshot with location blurred; one screenshot at the largest font |

## H-12 Backup off, data does not travel. BLOCKER

Result: **NOT RUN**

| | |
|---|---|
| Steps | The manifest half (`allowBackup=false`, data extraction rules, permissions, exported components, 16 KB) is rows A5 to A15 of the cloud gate and must already be PASS. On the phone: Settings > Apps > MovenRun > Permissions shows Location only (no "Allow all the time" option offered), plus Notifications if Android lists it by default. If a second Android phone is available: set it up from this phone's backup and open MovenRun there if it was transferred |
| Expected | Only location among the sensitive permissions. On a transferred phone the app opens signed out with no XP, streak, pending session or route; if the app did not transfer, write "Inconclusive" |
| Evidence | Screenshot of the permission page |

---

## Known issues found in the 1 Nov audit (not launch-blocking)

| Id | Found at | Status |
|---|---|---|
| K-1 | A guest save (and a capacity-limited route) read "waiting for the server check" although nothing is sent | Fixed on the integration head by `willRequestServerCheck`; present on `ac8d87b`. Accepted side effect: a signed-in user whose account restore failed at launch (auth status unknown, tokens kept) is now saved locally only. Before, that save was sent once with the stored token but never retried durably, so the only loss is the case where the server came back before Save was tapped. Same rule as K-3 |
| K-2 | Location interruptions did not recover: returning from Settings left Start Move saying permission was needed (focus does not change on return); a location toggle switched off mid-walk showed only a weak-signal chip and the route bridged the dark span; a watch that failed mid-session was never restarted | Fixed after `7409559` (not in that build): foreground return re-checks and retries, a silent toggle is detected and opens a gap with a route break, and a dead watch restarts on return or via "Retry GPS". Check in H-7 steps 6 and 7 |
| K-5 | Revoking location in Android Settings while a session is running makes Android end the app process; the unsaved session is lost | Android behaviour, not app code. Accepted for v1; the H-7 step 7 toggle is the recoverable case |
| K-3 | Signed in but the account could not be restored at launch (offline cold start): a save in that state is local only and is not queued for the server check | Open; after K-1 it is labelled "Estimated on this phone", which is truthful |
| K-4 | Fixes stamped later than the phone's session clock are rejected as future-dated with no tolerance; a phone whose clock lags GNSS time could stop counting distance | Unverified; H-6(b) records it |

## Run header

| Field | Value |
|---|---|
| Phone model / Android version | |
| EAS build id | |
| Built from commit (from the gate report) | |
| Gate report run link (must be PASS) | |
| API used | staging (`efd381b`) |
| Tester / date | |
| Rows passed / failed / blocked / not run | 0 / 0 / 1 / 11 |
