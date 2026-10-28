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

## 3. Estimated versus verified XP

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

## Android QA0 integration (`integration/android-qa0-28oct`)

This branch carries MR-A-01, MR-A-02, the clock-integrity change and the
estimated-versus-verified XP change. It does **not** carry the stationary-drift
rule (phone scatter guard and the server's path-versus-diameter check); a
replacement stationary-risk rule is a separate piece of work.

Five fixtures through the real modules (shared measurement and seal preview,
`mobile/src/lib/sessionClock.ts`, `fixHealth.ts`, `movementXp.ts`, and the
backend `MovementVerificationService` with the production anomaly detector);
the `session.tsx` fix callback and the Save decision are mirrored by the
Track A harness. Synthetic data, canonical seeds.

| Fixture | Truth m | Client m / s | Estimated XP | Server | XP after verdict |
|---|---:|---|---:|---|---:|
| W04 urban walk | 220 | 216 / 170 | 25 | verified, 216 m | 25 |
| I02 vehicle leg | 299 | 254 / 348 | 33 | verified, 254 m / 176 s | 25 |
| C01 clock -1 h | 500 | 501 / 370 | 49 | verified, 501 m | 48 |
| C02 clock +1 h | 150 | 161 / 120 | 0 | not submitted (not saveable) | 0 |
| S03 still, overconfident | 0 | 632 / 307 | 53 | verified, 632 m | 53 |

S03 is the known open case: without a stationary-risk rule a still phone that
overstates its accuracy records 632 m and the server verifies it, so 53 XP is
banked and stays after the verdict. Duplicate uploads of every submitted
fixture were answered idempotently (no second record).
