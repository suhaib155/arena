# MR-C: clock integrity, acquisition health, stationary drift, XP status

LOCAL / SYNTHETIC evidence only. Every number below comes from seeded synthetic
routes (the Track A corpus harness and the unit tests named here), not from a
phone. No hardware result is claimed; the H-sheet device runs are still
required, in particular for suspend/resume and for real stationary GPS.

Base: `integration/mr-a-01-02` at `814ad74` (already contains MR-A-01 short-route
evidence and MR-A-02 no-bridge handling).

## 1. Clock integrity (C02, C01)

Root cause: the capture path measured everything with `Date.now()`. Active
duration (and with it Save eligibility and local XP), fix age (`inspectFix`
`receivedAt`) and the lifecycle stamps sent to the server all moved when the
phone clock moved.

Change:

- `mobile/src/lib/sessionClock.ts`: the wall clock is read once when the session
  starts (bounded absolute anchor); every later reading is
  `anchor + monotonic elapsed` (`performance.now()`). A wall-clock change after
  Start no longer changes duration, fix age or lifecycle timestamps. Without a
  monotonic source it falls back to a wall clock clamped to never run backwards.
- `mobile/app/move/session.tsx`: logic only (no layout, style or copy change):
  every `Date.now()` in the capture path reads the session clock.
- Backend `structuralRejections`: a session lifecycle that starts or finishes
  more than `MAX_FUTURE_SKEW_MS` (5 min) after the server received it is
  rejected (receipt ordering). Server duration was, and stays, observation
  coverage, never the lifecycle span.

Not solved by this: whether `performance.now()` keeps counting while the device
sleeps or the app is suspended depends on the platform; JavaScript
monotonicity does not settle it, and **hardware testing is required** (H-sheet:
lock the screen mid-walk for at least one minute, unlock, keep walking, and
check that distance keeps growing and the saved duration matches a stopwatch).
If the source stops in deep sleep, the session clock falls behind real time and
every later GNSS-stamped fix would look future-dated, freezing the route for
the rest of the walk. Mitigation: background/foreground marks give the clock a
catch-up budget (wall advance minus monotonic advance while away), spent only
when a delivered fix is ahead of the session clock and never past that fix's
time. A wall clock moved forward while the app was away therefore reaches the
session only as far as fix time confirms. If a platform stamps fixes from the
system clock rather than satellite time, that bound is the wall-clock jump
itself (the pre-change behaviour, for background spells only); the server's
receipt check and coverage-based duration, and the estimated-XP settlement,
still apply. Both properties (sleep behaviour, fix time source) are hardware
questions.

## 2. Acquisition health (C01)

Root cause: the chip changed only when a fix arrived and only for
`weak_accuracy` / `stale_fix`, so a stream of `future_fix` rejections, or no
fixes at all, left it saying usable.

Change: `mobile/src/lib/fixHealth.ts`. The signal is usable only while the newest
healthy fix (accepted, or rejected only as `within_uncertainty`, i.e. a current
and well-bounded position that did not move) is younger than 20 s on the session
clock. The screen re-reads it every 2 s while capturing, so a frozen watch
degrades with no callback. `weak_accuracy` / `stale_fix` still degrade at once.
Pause/resume and background/foreground re-arm the window. A perfectly still
phone whose OS delivers no fix degrades after 20 s; the app has not heard a
current position, so it says so.

No new copy: the chip keeps its existing words (`Weak signal`).

## 3. Stationary drift (S03)

Root cause: `inspectFix` accepts a fix once it clears both *reported* accuracy
circles. A phone that reports 6 m while its real error wanders ~15 m clears them
every few fixes while standing still.

Change (shared `evidence.ts`, never invents distance, only withholds):

- Phone, `createStationaryDriftGuard`: the receiver's own scatter (residual RMS
  of the last 8 delivered fixes about a constant-velocity track) grounds the
  accuracy. The disjoint-circle test uses `max(reported, 2 x scatter)` per fix.
  A withheld fix takes the existing rejected path as `within_uncertainty`.
- Server, `stationaryDriftProblems` in on-foot quality: within one continuous
  stretch and a 2-minute window, path > 4 x diameter rejects the route ("Route
  wanders in place like stationary GPS drift"). It needs only uploaded points,
  so it also covers older or modified clients. The phone does not apply it:
  at ratios tight enough to matter (1.5) it cut honest laps of a 25 m-radius
  loop to 41 % while the scatter check alone already did most of the work.

Measured (synthetic, 20 seeds each, accuracy 6 m, correlation 0.95, 5 min still):

| True error sigma | Before: median / max m | After: median / max m | Local XP banked after |
|---|---:|---:|---:|
| 4 m | 27 / 70 | 0 / 18 | 3 of 20 |
| 6 m | 108 / 177 | 40 / 109 | 16 of 20 |
| 10 m | 286 / 362 | 91 / 204 | 20 of 20 |
| 15 m (S03) | 628 / 765 | 186 / 310 | 20 of 20 |
| 20 m | 1006 / 1249 | 248 / 402 | 20 of 20 |

Residual stationary false-positive threshold: when a still phone's real error
exceeds its reported accuracy (overconfident by about 1x or more) the phone
still accumulates phantom distance, roughly 6 to 12 times the true sigma over
five minutes. Because a five-minute session is saveable by duration, any such
residual route still banks the 25 XP floor locally. That XP is *estimated* (see
section 4) and the server is the authority; an unguarded upload of the same
stillness (632 m) is now rejected by the server.

Nonpassable cases (honest movement that loses): the server wander rule is
speed-blind, so the narrowest loop an honest player can lap for two minutes is
about 30 x their speed in m/s, in metres across. Pinned on clean synthetic
loops in `shared` `stationaryDrift.test.ts`: walking (1.4 m/s) fails a 40 m
loop and passes 50 m; jogging (2.5 m/s) fails 60 m and passes 80 m; running
(3.5 m/s) fails 100 m and passes 130 m. A 400 m running track passes up to
about 5 m/s and fails at 5.5 m/s (sub-3:05/km pace, scratch probe). A failure
rejects the whole session, not just the loop, and reverses its estimated XP
(section 4); a long honest walk that includes two minutes of pacing on one spot
is exposed in the same way. The rule cannot simply scale with speed: the S03
phantom path itself runs at about 2 m/s. The scatter
guard trims straight and curved walks by 0 to 6 % (W05 figure-eight: 0.94 of
the unguarded distance on average). Honest walks measured: W02 0.99, W03 1.00,
W04 0.98, W06 0.98, T03 0.99 of truth (20-seed mean).

## 4. Estimated versus verified XP

Root cause: Save banked XP from the phone's own measurement as final; the server
verdict was recorded beside it and never affected it.

Change (`mobile/src/lib/movementXp.ts`, store actions, no backend API change):

- Save banks the XP as an **estimate** and records it once per
  `clientSessionId` (`recordMovementXpEstimate`).
- The server verdict settles it once (`settleMovementXp`, called from the
  summary's submission and from the retry hook). Verified: verified XP =
  `min(estimate, XP from the server's own distance and duration)`; any excess is
  taken back from `totalXp`. Rejected: the whole estimate is taken back; history
  and streak stay. A settled entry never settles again, so retries and duplicate
  responses cannot reverse or verify twice.
- No verdict (offline, timeout, 5xx, signed out): the estimate stands.
- `recordMovementVerification` is unchanged and still awards nothing.

States (data only; the frozen UI does not render them). Proposed strings:

| State | Meaning | Proposed label |
|---|---|---|
| `saved_locally` | Saved; no verification attempted | `Saved locally` |
| `pending_verification` | Sent or queued, no verdict; estimate stands | `Pending verification` |
| `verified` | Server verified; verified XP banked | `Verified` |
| `not_eligible` | Server declined; estimate taken back | `Not eligible` |

A pending answer with a permanent cause (`invalid_request`, `not_found`) stays
`pending_verification`: only a server verdict reverses XP.

## Before / after (Track A harness, canonical seeds)

Before = `814ad74`; after = this stack. Server column uses the production
anomaly detector (`detectMovementAnomalies`); the Track A harness's own server
stub predates MR-A-01 and reported "Too few GPS points" for W04 and C02. With
the production detector, C02 at the base was **verified** by the server.
Silent = seconds of rejected fixes while the chip said usable.

| Fixture | Truth m | Before: client m / s / local XP / silent / server | After: client m / s / local XP / silent / server |
|---|---:|---|---|
| W04 urban walk | 220 | 216 / 170 / 25 / 0 / verified | 216 / 170 / 25 / 0 / verified |
| I02 vehicle leg | 299 | 254 / 348 / 33 / 140 / verified | 240 / 348 / 32 / 16 / verified |
| C01 clock -1 h | 500 | 175 / 0 / 0 / 200 / not submitted | 501 / 370 / 49 / 0 / verified |
| C02 clock +1 h | 150 | 82 / 3720 / 191 / 0 / verified | 161 / 120 / 0 / 0 / not submitted |
| S03 still, overconfident | 0 | 632 / 307 / 53 / 0 / verified | 109 / 307 / 25 / 0 / verified |

Notes: C01 no longer drops fixes, so the fixture's "chip degrades" expectation
is not exercised; the chip degrading on genuinely dropped or missing fixes is
covered by `clockIntegrity.test.ts`. S03 is **not 0 m**: 109 m and the 25 XP
floor remain on the canonical seed, verified by the server (the residual is
below the server's wander threshold). An older client's 632 m upload is now
rejected. All local XP in this table is now an estimate, settled by the verdict.
