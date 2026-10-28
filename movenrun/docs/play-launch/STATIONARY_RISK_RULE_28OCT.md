# Stationary-risk rule `stationary-risk/v1` (28 Oct)

Status: **proposal behind a versioned flag, OFF by default.** Live behaviour is unchanged until the owner decides to enable it (see "Owner decision needed").
Branch `fix/movement-stationary-risk`, based on `integration/android-qa0-28oct` at `5109d7bc9b7c30c22d6797ff1a7cdd683c868bf3`. Rejected #154 is not merged here, and neither is its 4x path-to-diameter rule.

All evidence on this page is **local and synthetic**. No real GPS, no device, no hosted service. The rates below hold only under the stated synthetic assumptions. They are not a claim that the rule catches every stationary upload, or that it can't be fooled: a scripted upload that looks coherent passes by construction.

## Problem

Track A fixture S03 is a phone left still for five minutes. It reports 6 m accuracy while its real error drifts about 15 m (multipath). The capture rule trusts the reported accuracy circles, so the drift is accepted step by step. On the base the result is 632 m, 53 XP and a server verdict of verified.

#154 added a single ratio rule: path longer than 4x the ground diameter within 2 min. That cut S03 to 109 m, but the session was still verified for 25 XP (20 seeds: median 186 m, max 310 m). The same ratio rejects honest laps of small loops, such as a 400 m track at 5.5 m/s. The owner directive (§4) rejects that FP/FN pair.

## Design

The rule lives in `backend/src/movement/domain/stationaryRisk.ts`. It is pure, server-side only, and runs on the uploaded accepted fixes. The client is unchanged and there is no UI change.

The route is split into continuous stretches. Any evidence break ends a stretch: an explicit pause, a `breakBefore` foreground gap, or an unobserved bridge. Each stretch is scanned with sliding windows of up to 180 s that contain at least 6 accepted segments. Each window gets several independent signals:

| Signal | What it measures | Movement looks like | Drift looks like |
|---|---|---|---|
| Heading coherence (best of three) | persistence = mean cos(turn); turning = \|mean sin(turn)\|; axis = concentration of bearings on one axis | keeps going forward, keeps turning one way (loop/track), or stays on one axis (line, out-and-back, shuttle) | none of the three |
| Reversals | share of turns sharper than 135°, counted only when heading coherence is low | rare, or deliberate (shuttle end) | about a third of turns |
| Temporal consistency: speed | CV of segment speed | steady pace | bursty |
| Temporal consistency: fix continuity | CV of the interval between accepted fixes | steady cadence | irregular: each acceptance is an error excursion |
| Stationary dwell / variance | radius of gyration of the window, allowed max(45 m, 2.5 x median reported accuracy) | (not used alone) | stays inside the error cloud |
| Progress | shift of the second-half centroid from the first-half centroid, allowed max(25 m, 2 x accuracy) | slow walking still progresses | centroid stays put |
| Reported accuracy | scales the dwell and progress allowances | honest poor accuracy gets more room | |

The four incoherence signals are each scaled to 0..1 and averaged. A window is **stationary-like** only when all three hold:

1. incoherence is at least 0.6;
2. the window is inside the dwell allowance;
3. the window has not progressed.

No single ratio decides the outcome. A coherent route inside a small envelope (a loop or track) passes. An incoherent route over a large envelope (an honest walk under multipath) also passes.

**Session verdict.** Take the metres of path covered by at least one stationary-like window. The verdict is `review` when those metres are at least 50 % of the path, or at least 500 m. Otherwise it is `eligible`. Routes too short to form a window are not assessed and stay `eligible`, because absence of evidence is not treated as evidence of drift.

**What `review` does (flag on).** The rule runs only after every existing check has passed, so it never replaces an earlier rejection.

- **Wire and storage:** the existing two-status contract carries the verdict as `status: "rejected"` and `distanceMeters: null`. There is exactly one public reason: `Movement XP needs review: much of this route looks like GPS drift around one spot (stationary-risk/v1)`.
- **On the phone:** current apps already settle that verdict as `not_eligible` and show it as needing review. The estimate is taken back.
- **What it never does:** no penalty, no trust score, no account flag. Nothing else on the account changes.
- **Transient result:** the measured path and aggregate signals are kept on `result.stationaryRisk`. It holds aggregates only, with no coordinates, and it is not stored.

**Known gap against the brief.** "Distance may still be recorded; eligibility is separate" is **not** delivered on the wire. The current contract (server `toPublicVerification`, client `decodeVerification`) fails closed on a rejected result that carries a distance, and it has no eligibility field. Delivering it needs:

- a protocol field (e.g. `xpEligibility: "eligible" | "review"`),
- a nullable storage column (a new migration, outside 0000-0010),
- and a client release that reads the field.

That is a separate owner decision, listed below.

## Flag

| Setting | Effect |
|---|---|
| `MOVEMENT_STATIONARY_RISK_RULE` unset, empty or `off` | today's behaviour (default) |
| `MOVEMENT_STATIONARY_RISK_RULE=stationary-risk/v1` | rule enforced as above |
| any other value | the API refuses to start the movement router (no silent guess either way) |

Tests and the rate script select the rule through the `stationaryRiskRule` dependency of `verifyMovement` / `MovementVerificationService`.

**How it would be enabled**, after owner approval:

1. Set the variable on the hosted API. This is a separately approved deployment; nothing on this branch touches hosting.
2. Redeploy.
3. Confirm with one synthetic S03-like upload from a test account.

The flag affects only new verifications. Stored verdicts are idempotent and are never re-evaluated. Disabling it means unsetting the variable.

## Synthetic assumptions

There are two independent generators. Both apply the real shared `inspectFix` to every delivered fix and model the 4 s / 5 m watch.

- **A. Real client pipeline.** This is the Track A research harness (untracked, `research/product-playability/synthetic-routes` with the and28 clock patch). It runs the real mobile lifecycle, acquisition, session clock and summary modules, then the real server path.
- **B. Committed corpus.** `backend/src/movement/testing/stationaryRiskCorpus.ts` plus `stationaryRiskRates.ts`, run with `node --import tsx src/movement/testing/stationaryRiskRates.ts 50` from `backend/`. It goes through the real `verifyMovement` with production anomaly rules, `GpsService` and `HexService`.

The error model is the same in both:

- **Error process:** AR(1) per axis per second.
- **Honest routes:** report accuracy at 2.5x their real one-axis error (8 m for 3.2 m, or 5 m for 2 m), with rho 0.8.
- **Low-accuracy routes:** report 12-35 m.
- **Stationary family:** reports less accuracy than its real error (overconfident multipath), rho 0.8-0.98, 2-20 min.
- **Stress family:** honest movement whose reported accuracy is overconfident (6 m for 15 m real error).

Stress is reported separately. The route is honest, but the measured distance is mostly drift (1.1-1.8 km uploaded for 0.84-1.5 km walked), so `review` is a defensible outcome there. It is still counted as honest-withheld, not hidden.

## FP / FN results

Definitions:

- **FP** = honest sessions that today's rule verifies but v1 withholds, divided by honest sessions that today's rule verifies.
- **FN** = stationary sessions that today's rule verifies and that are still XP-eligible under v1, divided by stationary sessions that today's rule verifies.

| Generator (50 seeds per family) | FP honest | FN stationary | Stress withheld |
|---|---|---|---|
| A. real client pipeline (32 honest families, 14 stationary) | **0.0 % (0/1558)** | **1.5 % (10/650)** | 56.7 % (85/150) |
| B. committed corpus (28 honest families, 13 stationary) | **0.0 % (0/1400)** | **0.8 % (5/650)** | 54.7 % (82/150) |

Every FN is a short drift spell of 120-180 s (279-566 m uploaded). Sessions of 5 min or more are always withheld. For comparison, rule off verifies **100 %** of the stationary family, at a median of 646 m for S03-like 300 s sessions.

### Per family (generator A, 50 seeds)

| Family | Verified, rule off (median/max m) | Verified, v1 | v1 review |
|---|---|---|---|
| still 300 s acc 6 / real 15 (S03) | 50 (646 / 798) | 0 | 50 |
| still 600 s acc 6 / 15, rho .95 / .98 | 50 / 50 (1265 / 633 median) | 0 / 0 | 50 / 50 |
| still 600 s acc 5/10, 8/12, 10/20, 15/25, 8/8 | 50 each | 0 each | 50 each |
| still 300 s acc 4/8, 3/6 | 50 each (279 / 385 median) | 0 | 50 |
| still 120 s / 180 s acc 6/15 | 48 / 50 | **6 / 4** | 42 / 46 |
| still 1200 s acc 6/15 | 50 (2566 median) | 0 | 50 |
| loops 100/200/300/400 m at walk 1.4, jog 2.8, run 4.0 (12 families) | 50 each | 50 each | 0 |
| 400 m track 5.5 m/s x4; walk x2; 5.5 m/s at acc 12 | 50 each | 50 each | 0 |
| stop/start walk (stops of 120 s and 60 s); track intervals with 90 s rests | 50 each | 50 each | 0 |
| slow walk 0.5 m/s 250 m; 0.8 m/s block | 50 each | 50 each | 0 |
| urban canyon acc 20 (line, block x3, real 12 m); 2 min at acc 35 mid-walk | 50 each | 50 each | 0 |
| loop 100 m at acc 12; loop 150 m jog at acc 10; figure-eight; out-and-back; shuttles 50 m / 20 m | 50 each (20 m shuttle: 10) | all | 0 |
| W04-like 220 m acc 15; I02-like bus leg; C01-like clock rollback | 48 / 50 / 50 | all | 0 |
| STRESS 600 m line walk under multipath | 50 | 50 | 0 |
| STRESS 200 m loop walk under multipath | 50 | 14 | 36 |
| STRESS walk with a 5 min multipath stop | 50 | 1 | 49 |

## Sensitivity (generator B, 50 seeds; one threshold varied at a time)

| Threshold | Values tried (v1 marked) | FP honest | FN stationary | Stress withheld |
|---|---|---|---|---|
| incoherenceThreshold | 0.45 / 0.5 / 0.55 / **0.6** / 0.65 / 0.7 / 0.75 | 0 % at every value | 0.5 / 0.6 / 0.8 / **0.8** / 0.8 / 1.5 / 2.6 % | 65 → **55** → 37 % |
| dwellRadiusMeters | 25 / 35 / **45** / 60 / 80 | 0 % | 1.2 / 0.8 / **0.8** / 0.8 / 0.8 % | 33 / 51 / **55** / 55 / 55 % |
| dwellAccuracyMultiple | 1.5 – 4 | 0 % | 0.8 % flat | 55 % flat |
| progressMeters | 15 / 20 / **25** / 35 / 50 / off | 0 % | 4.0 / 1.2 / **0.8** / 0.3 / 0.3 / 0.3 % | 45 / 51 / **55** / 57 / 58 / 58 % |
| reviewShare | 0.3 / 0.4 / **0.5** / 0.6 / 0.8 | 0 % | 0.6 / 0.8 / **0.8** / 0.9 / 2.0 % | ~55 % |
| reviewMeters | 250 / **500** / 1000 / off | 0 % | 0.8 / **0.8** / 0.9 / 0.9 % | 58 / **55** / 16 / 16 % |
| minWindowSegments | 4 / 5 / **6** / 8 / 10 | 0 % | 0.8 % up to 8, then 2.3 % | 55 % |
| windowMs | 90 / 120 / **180** / 240 / 300 s | 0 % | 6.2 / 0.6 / **0.8** / 0.9 / 1.1 % | 31 / 34 / **55** / 56 / 57 % |
| reversalDegrees | 110 / 120 / **135** / 150 | 0 % | 0.8 / 0.8 / **0.8** / 1.1 % | 56 / 55 / **55** / 51 % |

The thresholds are not knife-edge on this corpus. The **assumptions** matter much more:

| Assumption varied | Value | Result under v1 |
|---|---|---|
| honest real error / reported accuracy (corpus uses 0.4) | 0.6 / 0.8 / 1.0 / 1.5 | FP 0.4 % / **5.6 %** / 9.1 % / 23.1 % (of 1400) |
| honest loop smaller than the 100 m floor, walk 1.4 m/s | 75 m / 50 m / 30 m | FP 0 % / 28 % / 82 % |
| honest 50 m loop at 3 m/s | | FP 48 % |
| stationary error correlation (acc 6 / real 15, 600 s) | rho 0.5 / 0.7 / 0.99 | FN 0 % / 0 % / 16 % |

What the assumption sweep shows:

- **Accuracy ratio.** At ratios of 0.8 and above, the honest routes that get withheld are 100 m loops at walking pace, 100 m loops at acc 12, 50 m shuttles and slow walks, all seen through accuracy circles comparable to the loop or shuttle size.
- **Loop size.** Loops under about 75 m circumference are not reliably measurable at a 4 s cadence, under v1 or under today's rule.
- **Slow drift.** Very slow, highly correlated drift (rho 0.99) gets past v1 more often.

## Five fixtures: old rule vs v1 (generator A, real client modules, `realSessionClock`)

| Fixture | Truth | Client | Est. XP | Rule off (today) | stationary-risk/v1 |
|---|---|---|---|---|---|
| W04 220 m urban accuracy | 220 m | 216 m / 170 s | 25 | verified 216 m, settled 25 XP | **unchanged**: verified 216 m, 25 XP |
| I02 bus leg | 299 m on foot | 254 m / 348 s | 33 | verified 254 m, settled 25 XP | **unchanged** |
| C01 clock rollback | 500 m | 501 m / 370 s | 49 | verified 501 m, settled 48 XP | **unchanged** |
| C02 clock fast-forward | 150 m | 161 m / 120 s | 0 | not submitted (not saveable) | **unchanged** |
| S03 stationary 5 min | 0 m | 632 m / 307 s | 53 | **verified 632 m, settled 53 XP** | **rejected (needs review, stationary-risk/v1), settled 0 XP (not_eligible)**; duplicate upload idempotent |

For reference, #154's rule gave S03 109 m / 25 XP, verified.

## Tests

Fail-before evidence: `verification.ts`, `types.ts` and `productionRouter.ts` were reverted to the base and `stationaryRisk.ts` was removed. On that tree:

- `stationaryRisk.test.ts` tests 2 (S03 not XP-eligible under v1) and 3 (stationary family withheld) fail.
- `stationaryRiskRule.test.ts` fails to load.
- Tests 1, 4 and 5 pass on the base, which shows the default is unchanged.

After the change, all 10 pass.

| Suite | Count |
|---|---|
| Backend, full discovery (bash globstar `src/**/*.test.ts`, fresh DB, `--test-concurrency=1`) | 491 / 491, 0 skipped (base 481) |
| Backend, npm script under sh (known discovery gap: it misses `src/movement/*.test.ts`, including both new files) | 301 / 301 |
| Shared (npm script, and globstar) | 177 / 177 |
| Mobile (npm script) | 956 / 956 |

Typecheck is clean for backend (`tsconfig.json` and `tsconfig.api.json`), shared and mobile.

## Owner decision needed

1. **Enable?** Turn on `stationary-risk/v1` for the hosted API (`MOVEMENT_STATIONARY_RISK_RULE=stationary-risk/v1`), or keep it off until device data exists. The recommendation is to keep it off for the first QA0 phone build and collect anonymised aggregate signals first. Enabling it is a separately approved backend deployment.
2. **Accept the limits** at the brief's honest floor of 100 m loops, or ask for a different trade-off:
   - routes under about 75 m loops, or seen through accuracy comparable to the loop size, can be withheld;
   - honest walking under overconfident multipath is withheld on small loops;
   - short drift spells of 2-3 min are missed about 1 % of the time.
3. **Separate eligibility from distance.** Should `review` keep the measured distance on record and mark only XP as ineligible? That needs a protocol field, a new nullable column (a new migration, not 0000-0010) and a client release that reads it. Today the flag-on path uses the existing "rejected / not eligible" verdict.
4. **Device evidence.** Real Android reported-accuracy versus true-error ratios, beside buildings and in the open, are the assumption that moves FP the most (0.6 → 0.4 %, 0.8 → 5.6 %). Capture that data in the H-series handset script before any threshold is fixed.
