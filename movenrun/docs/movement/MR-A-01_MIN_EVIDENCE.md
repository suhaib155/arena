# MR-A-01: metadata-aware minimum evidence for short walks

Status: **accepted** (backend + shared only; no screen changes). Base `15f7f87`.

## Runtime decision path (traced from code, not from the research mirrors)

1. Phone: `app/move/session.tsx` passes every raw fix through shared `inspectFix`
   against the last *accepted* fix. Only accepted fixes are submitted
   (`mobile/src/lib/movementVerification.ts` `toSubmission`), with session metadata.
2. `POST /movement/verify`: zod schema (`http/validation.ts`, min 2 points),
   then `MovementVerificationService.submit` → `verifyMovement`
   (`movement/domain/verification.ts`):
   structural checks (window, future/age, metadata, ordering) → anomaly pass
   (`detectAnomalies`) → on-foot quality (re-runs `inspectFix` on every
   submitted pair when metadata is present) → distance/duration/H3/sealing → row
   in `movement_verifications`.
3. The anomaly pass is `GpsService.validateRoute(toValidatable(observation))`.
   **That is where the legacy floor lived: `MIN_POINTS = 10`**
   (`backend/src/services/gps.service.ts`). It applied to every submission.
4. XP is not server-side. The phone banks a local XP preview at Save
   (`sessionXp`, min 25); the server verdict changes the verified-movement record
   only.

Why honest short walks fail: the on-foot rule only accepts a fix whose accuracy
circle is disjoint from the previous accepted one, so at 15 m city accuracy
accepted fixes are >30 m apart and a 220 m walk yields 7 points.

## Policy

- **No session metadata (legacy):** unchanged. Ten-point floor
  (`LEGACY_MIN_POINTS`). Without provenance nothing shows the points were
  filtered by the on-foot rule.
- **With metadata, ≥ 10 points:** unchanged.
- **With metadata, < 10 points:** the count is replaced by
  `shortRouteEvidenceProblems` (`shared/src/domain/evidence.ts`), applied in
  `detectMovementAnomalies` (`backend/src/movement/http/productionRouter.ts`).
  All must hold:
  - ≥ 5 accepted fixes and ≥ 4 continuous segments (segments across a pause or
    foreground break do not count);
  - every reported accuracy between 1 m and 25 m (25 m is the app's own
    usable-signal ceiling; < 1 m is not a phone GNSS estimate);
  - ≥ 30 s of continuous observed time;
  - furthest fix from the start ≥ max(40 m, 3 × worst accuracy) (drift guard).
  The domain still re-checks every pair with `inspectFix` (monotonic time,
  speed ≤ 12 m/s, disjoint circles, accuracy ≤ 40 m).

None of these depend on pace: walking slower only adds fixes and time. This
policy decides whether a route is saved as verified movement. It is **not**
V3's proposed 10-minute / 750 m economic eligibility, which remains separate
and unimplemented here.

## Before / after (synthetic, rebuilt through runtime code)

| Fixture | Accepted fixes | Before | After | Local XP |
|---|---|---|---|---|
| W04 honest 220 m, 15 m accuracy | 7 | rejected, "Too few GPS points: 7", distance null | verified, 207 m, 154 s | 25, unchanged (not server-side) |
| W06u slow 150 m at 0.42 m/s, 15 m accuracy | 6 | rejected | verified, 164 m | unchanged |
| W06 slow 150 m, 8 m accuracy | 10 | verified 153 m | verified 153 m | unchanged |
| W04 points without metadata | 7 | rejected | rejected | — |

Track A reported W06 at 9 points; this rebuild produces 10, so W06 passed
already. W06u (same pace, city accuracy) is the slow walker the floor blocked.

## Still fails closed (tests in `backend/src/movement/minimumEvidence.test.ts`)

Legacy 7-point route; zero-accuracy copy of W04; W04 geometry with 1 s
timestamps; duplicated or reversed timestamps; unfiltered dense array; S01/S02
stationary phones; drift hopping between accuracy circles within 15 m; repeated
identical fixes; W04 at 30 m accuracy; one fix at 30 m; four fixes; 5 fixes in
20 s; future-dated session; points outside the session window; a 5-fix route
split by a pause. One endpoint test drives the express router and checks stored
rows.

## Tradeoffs

- **False negatives reduced:** honest short or slow walks at ordinary city
  accuracy now verify.
- **False positives:** a careful fabricator who emits 5 to 9 plausible,
  accuracy-consistent points can pass. That was already true at 10 points (ten
  fabricated points cost no more than seven), so the floor was never a defence
  against deliberate fabrication; it only blocked honest walkers. Attestation
  and server-side cross-session checks are the real defences.
- **Remaining false negatives:** a short walk at > 25 m accuracy or shorter
  than about 40 m of extent with fewer than 10 fixes is still rejected. That is
  weak evidence, and the player can walk further.

## Not covered (separate root causes)

- **Overlapping sessions:** the backend has no cross-session overlap check on
  this base (only overlapping pauses inside one session are rejected). The
  floor never provided one. Needs its own fix.
- **Legacy zero distance:** a legacy (no-metadata) submission of ≥ 10 identical
  fixes is not rejected by any check reviewed here. Unchanged by this work.
- Clock jumps inflating duration (MR-A-03 / §6), stationary drift with ≥ 10
  fixes (MR-A-04, S03), vehicle legs (MR-A-02).

## Privacy

No new data is collected, stored or returned. Rejection reasons are counts and
thresholds, with no coordinates.
