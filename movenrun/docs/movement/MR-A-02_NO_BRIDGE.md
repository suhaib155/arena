# MR-A-02: no distance across an unobserved bridge

Evidence status: **LOCAL / SYNTHETIC only**. Generated tracks run through the real
shared and backend code. No phone has run this yet, and nothing here shows that a
phone can tell a vehicle apart from walking.

## Root cause (reproduced)

After `inspectFix` rejects a fix as `implausible_speed`, the capture loop keeps the
last accepted fix as its anchor. When the vehicle slows down far away, the next
fix is measured from that old anchor. Over the long elapsed time its average
speed looks plausible (under 12 m/s), so it is accepted. The straight line between
the two fixes then counted as on-foot distance on the phone and on the server.
The server never sees the rejected fixes, so it cannot rely on a client marker.

## Rule

`isUnobservedBridge(a, b)` in `shared/src/domain/measurement.ts` is a pure
function of two consecutive accepted fixes:

- if the gap is no longer than `maxFixAgeMs` (10 s), the pair is not a bridge
  and `inspectFix` judges it as before;
- if the gap is longer than `maxBridgeGapMs` (300 s), the pair is always a bridge;
- otherwise the pair is a bridge when the displacement minus both accuracy
  circles, divided by the gap, is above `maxBridgeSpeedMetersPerSecond` (2.5 m/s).
  Accuracy is capped at 40 m, and a missing accuracy counts as 40 m, so a
  claimed large uncertainty cannot explain a vehicle leg away.

`hasEvidenceBreak` now includes this rule. Distance (the phone preview through
`createCanonicalEvidence`, the server `distanceFor`), observed duration, map
drawing, traversal and the seal scanner all start a new stretch at a bridge. No
segment is credited or drawn across it. Explicit pauses and `breakBefore` behave
as before. The two plausibility gates (server `onFootQualityProblems`, and the
anomaly pass through `toValidatable`) use the new `hasExplicitBreak`. A bridge
therefore never excuses a pair from the speed checks: an over-speed pair still
rejects the session. The server applies the rule whether or not session metadata
is present. `mode` buys no leniency.

## Before and after, I02 (walk, 2 min at 15 m/s, walk; 300 m walked)

| | Before | After |
|---|---:|---:|
| Phone preview distance | 2,096 m | 264 m |
| XP from the app's `sessionXp` formula (wall-clock duration 335 s) | 143 | 33 |
| Server distance / observed duration | 2,096 m / 333 s, verified | 264 m / 180 s, verified |

About 36 m of true walking is lost. While the anchor was stale, the phone
dropped those fixes, and the server cannot recover them. XP still includes the
vehicle minutes, because the phone's duration is wall-clock time (MR-A-03,
mobile, out of scope).

## Known limits

- A pair under 10 s apart can still bridge up to 12 m/s × 10 s (120 m). Only
  `inspectFix` bounds it.
- Slow traffic under the walking bound with continuous fixes is still
  indistinguishable from walking (MR-A-07).
- A runner who loses signal for more than 10 s loses that gap's distance. This
  is the conservative choice.
- Seal rules version 1 now also breaks at a bridge shorter than its 200 m
  continuity limit.

Tests: `shared/src/domain/__tests__/noBridge.test.ts` and
`backend/src/movement/noBridge.test.ts` (I02, subway outage, pause and resume,
short phone sleep, stop and start, irregular sampling, slow walker at
0.4–0.5 m/s, runner, benign spike, legacy upload, gate regression, exactly-once
service).
