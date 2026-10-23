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
sleeps or the app is suspended depends on the platform. If it stops, the session
under-counts (never over-counts) that span. This must be measured on hardware
(H-sheet); JavaScript monotonicity does not settle it.

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
