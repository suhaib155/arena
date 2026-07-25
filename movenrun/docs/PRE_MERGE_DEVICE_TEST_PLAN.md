# Pre-Merge Device Test Plan — Real Map & Territory Capture

Branch under test: `claude/new-session-oi4cnk`
Base: `main`
Status: **NOT READY TO MERGE** — see `PRE_MERGE_GATES.md`.

> **Nothing in this plan has been executed.** Every "Actual result" field is
> empty because no physical device was available to the automated audit. No
> claim of native, background, battery or rendering behaviour anywhere in this
> repository has been verified on hardware.

---

## Before you start

### Build prerequisites

| Item | Value |
|---|---|
| Build type | **Native development build.** Expo Go cannot run MapLibre or background location. |
| Android | `eas build --profile development --platform android` |
| iOS | `eas build --profile development --platform ios` |
| Required env | `EXPO_PUBLIC_MAP_STYLE_URL` (real provider), `EXPO_PUBLIC_API_BASE_URL` |
| Backend | API (`yarn dev`) **and** GPS worker (`yarn worker:gps`) both running, Redis reachable by both |
| Database | A **disposable/staging** Postgres with migrations `0000`–`0003` applied. Never production. |

### Known-broken behaviour to expect

Four defects were found by static and runtime audit and are **not yet fixed**.
Tests that exercise them are expected to fail; they are listed here so a tester
does not waste time diagnosing them:

| ID | Affects | Expected failure |
|---|---|---|
| **D1** | Realtime (`A-13`, `I-13`) | SSE delivers nothing. Broadcaster lives in the worker process; subscribers live in the API process. |
| **D2** | Map ownership colour (`A-14`, `I-14`) | Your own zones render as **rival lavender**, not mint. Client sends no identity header. |
| **D3** | Map at wide zoom (`A-15`) | Owned territory can be **invisible** when zoomed out. Feature cap is applied to candidate cells before the query. |
| **D4** | Recentre control (`A-16`, `I-16`) | The "Recentre on my location" button does nothing useful. |

Record them as **FAIL** with a reference to the defect ID rather than as new bugs.

### Device matrix (minimum)

- Android: one recent Pixel/AOSP-like device **and** one aggressive-OEM device
  (Xiaomi / Samsung / Huawei / OnePlus) — background behaviour differs sharply.
- Android: one small screen (≤ 5.5", or 360 dp width) for layout tests.
- iOS: one device on the current major iOS version.
- At least one device with **display size and font size set to maximum**.

### How to fill this in

For every test: complete **Actual result**, tick **Pass/Fail**, attach a
**screenshot or screen recording**, and add **Notes**. A test with no evidence
attached counts as not run.

---

# ANDROID

## A-1 — App icon and adaptive icon mask

- **Prerequisites:** Development build installed; launcher set to circular *and*
  then squircle icon shape.
- **Steps:**
  1. Install the build and open the launcher drawer.
  2. Inspect the MovenRun icon under circular, squircle and rounded-square masks.
  3. Long-press for the app-info popup and check the icon there too.
- **Expected result:** A MovenRun-branded icon, correctly inset inside the mask
  with no clipping of any glyph.
  > ⚠️ **Known gap:** `app.json` declares **no `icon` and no
  > `adaptiveIcon.foregroundImage`** — only `backgroundColor: "#F8FAF7"`. There
  > is no `assets/` directory. The build will ship the **default Expo icon**.
  > This is pre-existing (unchanged by this branch) but is a release blocker.
- **Actual result:**
- **Pass / Fail:**
- **Screenshot / recording:**
- **Notes:**

## A-2 — Splash screen and transition

- **Prerequisites:** App fully closed (swiped from recents).
- **Steps:**
  1. Cold-start the app. Record the screen from launch to first interactive frame.
  2. Repeat after force-stopping from system settings.
  3. Repeat with the app backgrounded for 10 minutes, then resumed.
- **Expected result:** Splash background `#F8FAF7`, then the branded
  `SplashView` (hexagon + "MovenRun" + "Move → Capture → Defend → Own"), then
  the app. No white flash, no black frame, no visible jump between the native
  splash and the JS splash.
  > ⚠️ **Known gap:** `splash` declares no `image`, so the native splash is a
  > flat colour only. Pre-existing.
- **Actual result:**
- **Pass / Fail:**
- **Screenshot / recording:**
- **Notes:**

## A-3 — Map loads with a production-intended style

- **Prerequisites:** `EXPO_PUBLIC_MAP_STYLE_URL` set to a real provider; device online.
- **Steps:**
  1. Open Territory → **Real map**.
  2. Wait for the map to settle. Pan and zoom.
  3. Confirm the "Development map style" banner is **absent**.
  4. Check the attribution control is visible and legible.
- **Expected result:** Real street detail renders. Attribution visible (licence
  requirement). No dev banner. No "Real map needs a native build" panel.
- **Actual result:**
- **Pass / Fail:**
- **Screenshot / recording:**
- **Notes:**

## A-4 — Map failure and fallback states

- **Prerequisites:** Ability to set an invalid style URL and to disable networking.
- **Steps:**
  1. Build with `EXPO_PUBLIC_MAP_STYLE_URL` **unset** → open the real map.
  2. Build with a deliberately wrong style URL → open the real map.
  3. With a valid build, enable airplane mode → open the real map.
  4. Install on a device **without** the dev client (Expo Go) → open the real map.
- **Expected result:** (1) dev-style banner shown; (2) "Map couldn't load" banner
  naming the style URL; (3) map degrades without crashing, previously loaded
  territory stays visible; (4) "Real map needs a native build" panel with a
  working "Open the local territory board" fallback — **no crash**.
- **Actual result:**
- **Pass / Fail:**
- **Screenshot / recording:**
- **Notes:**

## A-5 — Location permission progression

- **Prerequisites:** App freshly installed, all permissions revoked.
- **Steps:**
  1. Start a run. Observe the foreground permission prompt.
  2. **Deny** it. Confirm the run refuses to start and says why.
  3. Start again, **Allow while using the app**.
  4. Observe the background ("Allow all the time") request.
  5. **Deny** background. Confirm the run still starts (foreground-only).
  6. Grant background from Settings → App → Permissions → Location → Allow all the time.
- **Expected result:** Foreground denial blocks the run with a clear message.
  Background denial **downgrades** to foreground-only and never blocks. Prompts
  appear in the right order (Android 11+ will not show "Allow all the time"
  in-app; it must be granted from Settings).
- **Actual result:**
- **Pass / Fail:**
- **Screenshot / recording:**
- **Notes:**

## A-6 — Foreground service notification

- **Prerequisites:** Background location granted.
- **Steps:**
  1. Start a run. Pull down the notification shade.
  2. Confirm the notification text, colour and that it is non-dismissable.
  3. Finish the run. Confirm the notification disappears **immediately**.
  4. Force-quit mid-run. Confirm the notification does not survive as an orphan.
- **Expected result:** "MovenRun is recording your run" while recording only.
  No orphaned notification after finish or force-quit.
- **Actual result:**
- **Pass / Fail:**
- **Screenshot / recording:**
- **Notes:**

## A-7 — Recording with the screen locked

- **Prerequisites:** Background permission granted; battery optimisation disabled for the app.
- **Steps:**
  1. Start a run outdoors. Lock the screen.
  2. Walk a known route for **at least 15 minutes**.
  3. Unlock. Compare recorded distance against a reference (another tracker or a measured route).
- **Expected result:** Route continues while locked. Distance within ~5% of
  reference. No gap longer than ~1 minute.
- **Actual result:**
- **Pass / Fail:**
- **Screenshot / recording:**
- **Notes:**

## A-8 — OEM background restriction

- **Prerequisites:** An aggressive-OEM device with default battery settings (Xiaomi/Samsung/Huawei/OnePlus).
- **Steps:**
  1. Leave battery optimisation **enabled** (the default a real user has).
  2. Start a run, lock the screen, walk 20 minutes.
  3. Record any gaps; note the OEM and OS version.
  4. Repeat with the app allowlisted from battery optimisation.
- **Expected result:** Document actual behaviour. Gaps are expected on some
  OEMs — the requirement is that the app **survives** them (no crash, no lost
  session) and that the gap is visible in the summary, not silently smoothed over.
- **Actual result:**
- **Pass / Fail:**
- **Screenshot / recording:**
- **Notes:**

## A-9 — Pause and resume

- **Prerequisites:** Run in progress.
- **Steps:**
  1. Start a run, walk 3 minutes, **Pause**.
  2. Walk 3 more minutes while paused, then **Resume**.
  3. Walk 3 minutes, finish.
  4. Check the timer excludes the paused window and the route has no segment across it.
- **Expected result:** Paused time excluded from duration. No route drawn during
  the pause. Location updates actually stop while paused (check the notification).
- **Actual result:**
- **Pass / Fail:**
- **Screenshot / recording:**
- **Notes:**

## A-10 — Interrupted-session restore

- **Prerequisites:** Run in progress with at least 200 recorded samples (≈ 5 min).
- **Steps:**
  1. Start a run, walk until well past the first persisted chunk.
  2. Force-stop the app from system settings (simulates an OS kill).
  3. Reopen the app.
- **Expected result:** The interrupted session is offered/restored with the
  route drawn from persisted chunks. Nothing crashes. A session with no
  persisted chunks is discarded rather than restored empty.
- **Actual result:**
- **Pass / Fail:**
- **Screenshot / recording:**
- **Notes:**

## A-11 — Valid closed-loop run (end to end)

- **Prerequisites:** Backend API **and** GPS worker running; staging DB.
- **Steps:**
  1. Run/walk a real closed loop meeting every threshold: **≥ 800 m, ≥ 5 min,
     back within 50 m of the start, enclosing ≥ 10 000 m²**, no self-crossing.
  2. Finish. Read the run summary.
  3. Wait for server verification; open the capture result.
  4. Open the real map and find the captured zones.
- **Expected result:** Summary shows "Loop closed" and an enclosed area, marked
  *pending server verification*. Server confirms and awards ≥ 1 zone. Zones
  appear on the map.
  > ⚠️ Expect **D2**: captured zones will render as *rival* lavender, not mint.
- **Actual result:**
- **Pass / Fail:**
- **Screenshot / recording:**
- **Notes:**

## A-12 — Invalid / open route is rejected

- **Prerequisites:** As A-11.
- **Steps:**
  1. Run 400 m in a straight line and stop (open route, under distance).
  2. Finish and read the summary, then the capture result.
  3. Repeat with a valid-length loop deliberately walked in a figure-of-eight.
- **Expected result:** Summary lists the specific unmet requirements. Server
  returns `captureEligible: false` with reasons (`loopNotClosed`,
  `insufficientDistance`, `selfIntersectingRoute`). **No territory awarded.**
- **Actual result:**
- **Pass / Fail:**
- **Screenshot / recording:**
- **Notes:**

## A-13 — Realtime territory updates

- **Prerequisites:** Two devices/accounts, or one device plus a scripted capture.
- **Steps:**
  1. Device A opens the real map over an area.
  2. Device B (or a script) captures a cell in that area.
  3. Observe device A without panning or reopening.
- **Expected result (as designed):** The cell updates within seconds.
  > ⚠️ **Expect FAIL — defect D1.** The broadcaster runs in the worker process;
  > SSE subscribers live in the API process. Nothing will be delivered.
- **Actual result:**
- **Pass / Fail:**
- **Screenshot / recording:**
- **Notes:**

## A-14 — Ownership colour correctness

- **Prerequisites:** At least one zone captured by the signed-in account.
- **Steps:**
  1. Open the real map over your own captured zones.
  2. Compare the fill colour against the legend.
- **Expected result (as designed):** Your zones read **mint ("Yours")**.
  > ⚠️ **Expect FAIL — defect D2.** No identity header is sent, so the backend
  > labels every owned cell `rival`.
- **Actual result:**
- **Pass / Fail:**
- **Screenshot / recording:**
- **Notes:**

## A-15 — Map at wide zoom

- **Prerequisites:** Several captured zones spread over a city.
- **Steps:**
  1. Open the real map, zoom **out** to the widest level the app allows (zoom 10).
  2. Compare visible territory against what you know exists.
  3. Zoom back in and confirm the zones reappear.
- **Expected result (as designed):** Territory remains visible, or is honestly
  reported as partial.
  > ⚠️ **Expect FAIL — defect D3.** Owned cells can vanish entirely at wide
  > zoom while `meta.truncated` is true.
- **Actual result:**
- **Pass / Fail:**
- **Screenshot / recording:**
- **Notes:**

## A-16 — Map controls (recentre, legend, selection)

- **Steps:**
  1. Tap the legend toggle. Confirm it shows/hides and the a11y state changes.
  2. Tap **Recentre on my location** after panning far away.
  3. Tap a territory polygon; confirm the selection panel and "Zone details".
  4. Tap empty map; confirm selection clears.
  5. Enable TalkBack and traverse every map control.
- **Expected result (as designed):** Recentre returns the camera to the user's
  blue dot. All icon-only controls announce a correct label under TalkBack.
  > ⚠️ **Expect FAIL — defect D4.** Recentre moves the camera to the *viewport
  > centre* (a visual no-op) and does nothing at all before the first fetch. Its
  > TalkBack label "Recentre on my location" is therefore inaccurate.
- **Actual result:**
- **Pass / Fail:**
- **Screenshot / recording:**
- **Notes:**

## A-17 — Poor GPS conditions

- **Steps:**
  1. Start a run indoors / in an urban canyon / underground car park.
  2. Observe the GPS quality indicator during the run.
  3. Finish and read the summary and the server result.
- **Expected result:** Quality indicator reflects degradation. Server either
  accepts with damped rewards or rejects with `poorGpsAccuracy` — never a
  silent partial award, and never a crash.
- **Actual result:**
- **Pass / Fail:**
- **Screenshot / recording:**
- **Notes:**

## A-18 — Offline map and API

- **Steps:**
  1. Load the real map with territory visible.
  2. Enable airplane mode. Pan slightly.
  3. Open a zone detail screen. Start and finish a run.
  4. Restore connectivity.
- **Expected result:** Previously loaded territory **stays visible**; an error
  banner appears; the map does not blank. Zone detail shows a retry. A run
  records offline and uploads on reconnect.
- **Actual result:**
- **Pass / Fail:**
- **Screenshot / recording:**
- **Notes:**

## A-19 — Battery observation

- **Steps:**
  1. Charge to 100%, note the level.
  2. Record a **60-minute** run with the screen locked and the map closed.
  3. Note the level, then check Settings → Battery for MovenRun's share.
  4. Repeat with the real map open for the whole hour.
- **Expected result:** Record actual figures. Locked-screen recording should be
  materially cheaper than map-open. Establish a baseline; there is no pass
  threshold yet.
- **Actual result:**
- **Pass / Fail:**
- **Screenshot / recording:**
- **Notes:**

## A-20 — Profile ring

- **Steps:**
  1. Open Profile at a level with partial XP progress.
  2. Inspect the circular element around the avatar.
  3. Gain XP and re-check whether the circle changes.
- **Expected result:** *Product decision required.*
  > ⚠️ **Known gap:** the circular element (`avatarRing`) is a **static
  > decorative border** — a full-circle 3 px stroke. It is **not** a progress
  > ring and never changes with XP. Progress is shown by the separate linear
  > `XPBar`. There is no SVG library in the project, so an arc ring is not
  > currently possible. Confirm whether "Profile ring renders correctly" means
  > the decorative ring (passes) or a real progress arc (not implemented).
- **Actual result:**
- **Pass / Fail:**
- **Screenshot / recording:**
- **Notes:**

## A-21 — Navigation controls and Pause/Finish reachability

- **Steps:**
  1. During an active run, confirm **Pause** and **Finish** are both fully
     visible and tappable without scrolling.
  2. Repeat with system font size at maximum and display size at maximum.
  3. Repeat on the smallest device in the matrix.
  4. Confirm hardware Back during a run prompts rather than discarding silently.
  5. Traverse the bottom tab bar with TalkBack.
- **Expected result:** Controls always reachable (≥ 58 dp targets), never
  clipped, never behind the gesture bar. Back is intercepted. Every tab
  announces its label.
- **Actual result:**
- **Pass / Fail:**
- **Screenshot / recording:**
- **Notes:**

## A-22 — Small-screen and large-font layout sweep

- **Steps:** On the smallest device with maximum font and display size, visit:
  Home, Territory board, **Real map**, **Zone detail**, **Portfolio**,
  **Defence**, Move session, Move summary, Clubs, Profile.
- **Expected result:** No clipped text, no overlapping elements, no content
  under the status bar or gesture bar, no horizontal overflow. Territory
  quick-links scroll rather than truncate.
- **Actual result:**
- **Pass / Fail:**
- **Screenshot / recording:**
- **Notes:**

## A-23 — Blank-state check on new screens

- **Steps:**
  1. Clear app storage. Open **Portfolio** and **Defence** immediately at cold start.
- **Expected result (as designed):** A loading or empty state.
  > ⚠️ **Known gap:** both screens render `null` while the store hydrates, so a
  > completely **blank screen** with no header content is shown briefly. The
  > existing territory board shows a skeleton instead. Confirm how long the
  > blank frame lasts on a slow device.
- **Actual result:**
- **Pass / Fail:**
- **Screenshot / recording:**
- **Notes:**

---

# iOS

## I-1 — App icon

- **Steps:** Install, inspect the home-screen icon, Settings icon, and Spotlight result.
- **Expected result:** MovenRun-branded icon at every size.
  > ⚠️ **Known gap:** no `icon` is configured — the default Expo icon ships. Pre-existing.
- **Actual result:** / **Pass / Fail:** / **Screenshot:** / **Notes:**

## I-2 — Splash and transition

- **Steps:** Cold start, recording the screen; repeat after a 10-minute background.
- **Expected result:** `#F8FAF7` splash → branded `SplashView` → app, with no white or black flash.
  > ⚠️ **Known gap:** no splash `image` configured. Pre-existing.
- **Actual result:** / **Pass / Fail:** / **Screenshot:** / **Notes:**

## I-3 — Map loads with a production-intended style

- **Steps:** As A-3.
- **Expected result:** Real street detail, attribution visible, no dev banner.
- **Actual result:** / **Pass / Fail:** / **Screenshot:** / **Notes:**

## I-4 — When-in-use permission

- **Prerequisites:** Fresh install.
- **Steps:** Start a run; observe the prompt; deny; retry; allow "While Using the App".
- **Expected result:** Denial blocks the run with a clear reason. The purpose
  string shown matches `locationWhenInUsePermission` in `app.json`.
- **Actual result:** / **Pass / Fail:** / **Screenshot:** / **Notes:**

## I-5 — Always permission

- **Steps:**
  1. With when-in-use granted, start a run and background the app.
  2. Observe the deferred "Change to Always Allow?" system prompt.
  3. Grant Always; confirm from Settings → Privacy → Location Services.
- **Expected result:** Always is requested only **after** when-in-use is granted.
  Purpose string matches `locationAlwaysAndWhenInUsePermission`. Denial
  downgrades to foreground-only rather than blocking.
- **Actual result:** / **Pass / Fail:** / **Screenshot:** / **Notes:**

## I-6 — Background location indicator

- **Steps:** Start a run, background the app, observe the status bar; finish and re-check.
- **Expected result:** Blue location indicator visible **only** while recording;
  clears immediately on finish (`showsBackgroundLocationIndicator: true`).
- **Actual result:** / **Pass / Fail:** / **Screenshot:** / **Notes:**

## I-7 — Recording with the screen locked

- **Steps:** As A-7. Additionally leave the device locked and stationary for 5
  minutes mid-run to probe for iOS suspension.
- **Expected result:** Recording continues; `activityType: Fitness` prevents the
  significant-location-change downgrade. Distance within ~5% of reference.
- **Actual result:** / **Pass / Fail:** / **Screenshot:** / **Notes:**

## I-8 — Pause and resume

- **Steps:** As A-9.
- **Expected result:** As A-9; additionally the blue indicator clears while paused.
- **Actual result:** / **Pass / Fail:** / **Screenshot:** / **Notes:**

## I-9 — Interrupted-session restore

- **Steps:** Start a run past the first chunk; kill the app from the app switcher; reopen.
  If possible, also force a memory-pressure termination by opening several heavy apps.
- **Expected result:** Session restored from persisted chunks. If the OS
  relaunched the app in the background for a location batch, samples from that
  window are present (this is what module-scope `defineTask` exists for).
- **Actual result:** / **Pass / Fail:** / **Screenshot:** / **Notes:**

## I-10 — Valid closed-loop run

- **Steps:** As A-11.
- **Expected result:** As A-11. Expect **D2** on colour.
- **Actual result:** / **Pass / Fail:** / **Screenshot:** / **Notes:**

## I-11 — Invalid / open route rejected

- **Steps:** As A-12.
- **Expected result:** As A-12.
- **Actual result:** / **Pass / Fail:** / **Screenshot:** / **Notes:**

## I-12 — Poor GPS conditions

- **Steps:** As A-17.
- **Expected result:** As A-17.
- **Actual result:** / **Pass / Fail:** / **Screenshot:** / **Notes:**

## I-13 — Realtime territory updates

- **Steps:** As A-13.
- **Expected result:** **Expect FAIL — defect D1.**
- **Actual result:** / **Pass / Fail:** / **Screenshot:** / **Notes:**

## I-14 — Ownership colour correctness

- **Steps:** As A-14.
- **Expected result:** **Expect FAIL — defect D2.**
- **Actual result:** / **Pass / Fail:** / **Screenshot:** / **Notes:**

## I-15 — Offline map and API

- **Steps:** As A-18.
- **Expected result:** As A-18.
- **Actual result:** / **Pass / Fail:** / **Screenshot:** / **Notes:**

## I-16 — Map controls and VoiceOver

- **Steps:** As A-16, using **VoiceOver**. Traverse every icon-only control on
  the map, the selection panel and the zone detail screen.
- **Expected result:** Every control announces an accurate label.
  > ⚠️ **Expect FAIL — defect D4** (recentre label is inaccurate and the control
  > is ineffective).
- **Actual result:** / **Pass / Fail:** / **Screenshot:** / **Notes:**

## I-17 — Battery observation

- **Steps:** As A-19.
- **Expected result:** Record actual figures; establish a baseline.
- **Actual result:** / **Pass / Fail:** / **Screenshot:** / **Notes:**

## I-18 — Profile ring

- **Steps:** As A-20.
- **Expected result:** Product decision required — see A-20.
- **Actual result:** / **Pass / Fail:** / **Screenshot:** / **Notes:**

## I-19 — Navigation controls and Pause/Finish reachability

- **Steps:** As A-21, using the iOS swipe-back gesture in place of hardware Back.
- **Expected result:** Pause and Finish always reachable. Swipe-back is disabled
  on the session/summary/captured screens (`gestureEnabled: false`).
- **Actual result:** / **Pass / Fail:** / **Screenshot:** / **Notes:**

## I-20 — Safe-area layout (notch, Dynamic Island, home indicator)

- **Prerequisites:** A notched / Dynamic Island device, and one without if available.
- **Steps:** With **Larger Text** at maximum, visit Home, Territory board, Real
  map, Zone detail, Portfolio, Defence, Move session, Move summary, Profile.
  Check both portrait orientations and rotate to confirm the app stays portrait.
- **Expected result:** No content under the Dynamic Island or the home
  indicator. The map's floating controls clear the safe area. No clipped text.
- **Actual result:** / **Pass / Fail:** / **Screenshot:** / **Notes:**

## I-21 — Blank-state check on new screens

- **Steps:** As A-23.
- **Expected result:** As A-23 — expect a brief blank frame.
- **Actual result:** / **Pass / Fail:** / **Screenshot:** / **Notes:**

---

## Sign-off

| Role | Name | Date | Android result | iOS result |
|---|---|---|---|---|
| Tester | | | | |
| Reviewer | | | | |

**This plan is complete only when every test above has an Actual result, a
Pass/Fail, and attached evidence.**
