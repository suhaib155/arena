# GPS integrity fixture spec

All results here are SYNTHETIC and LOCAL. No real person walked any route.

## What the harness runs

`research/product-playability/synthetic-routes/` builds 30 routes from a seed,
then pushes each one through the real code, end to end:

1. **Sensor model** (`scenario.ts`). It makes one sample per second with GNSS
   time, system time, the true position, whether the walker is moving and on
   foot, and the reported fix. Error is correlated over time (AR(1), 0.8 by
   default), as real GPS error is. Disturbances cover no fixes, accuracy spikes,
   teleports, native speed, a system clock jump and missing accuracy. Events
   cover pause, resume, background, foreground, tracker error, process kill and
   finish.
2. **Client** (`clientPipeline.ts`). It replays what `app/move/session.tsx` and
   `app/move/summary.tsx` do with each fix, using the real modules: the OS
   cadence (4 s and 5 m once acquired), `createGpsAcquisition`, `inspectFix`,
   gap marking, the signal chip, `createSealPreview`, `evidenceDistance`,
   `isSaveable`, `sessionXp` and the submission builder.
   `tests/pipelineDrift.test.ts` pins the mirrored lines in both screens, so
   the replay breaks loudly if the screens change.
3. **Server** (`serverPipeline.ts`). It validates the wire body with
   `submitMovementSchema` and runs `MovementVerificationService` with the
   production dependencies: `GpsService.validateRoute`, `calculateDistance` and
   `HexService`. The repository is the backend's in-memory one. The backend's
   own tests stub the anomaly check, so this is the only place the production
   rules (for example `MIN_POINTS = 10`) run end to end.
4. **Checks** (`measure.ts`). Each fixture has expectations. Three global
   invariants apply to all of them: no movement XP when the walker moved less
   than 30 m; a duplicate upload is idempotent; a saveable moving session is
   submitted.

Every route starts at 0.5° N, 25.5° W, in the open Atlantic, so no fixture can
point at a real home. A test enforces this.

## Fixtures

Privacy class: **none** means no coordinates leave the device; **precise-ephemeral**
means coordinates exist only in memory and the session is not submitted;
**precise-uploaded** means the route would be sent to `/movement/verify`.

| Id | Category | Privacy | Scenario | Today |
|---|---|---|---|---|
| S01 | stationary | precise-ephemeral | Phone on a bench for 90 s | PASS |
| S02 | stationary | precise-ephemeral | Phone on a bench for 5 min | PASS |
| S03 | stationary | precise-ephemeral | 5 min still beside tall buildings; reports 6 m accuracy, real error drifts about 15 m | FAIL (MR-A-04) |
| W01 | walk | precise-ephemeral | Short 100 m walk | PASS |
| W02 | walk | precise-uploaded | 300 m, good sky | PASS |
| W03 | walk | precise-uploaded | 750 m block loop back to start | PASS |
| W04 | walk | precise-uploaded | Honest 220 m at 15 m city accuracy | FAIL (MR-A-01) |
| W05 | walk | precise-uploaded | Figure eight crossing its own trail | PASS |
| W06 | walk | precise-uploaded | Slow 150 m stroll over 6 min (accessibility pace) | FAIL (MR-A-01) |
| T01 | threshold | precise-uploaded | V3 boundary: 9 min 59 s at 1.25 m/s | PASS |
| T02 | threshold | precise-uploaded | Pause, walk 80 m while paused, resume | PASS |
| T03 | threshold | precise-uploaded | Wait 3 min at a crossing without pressing Pause | PASS |
| A01 | acquisition | precise-uploaded | Weak GPS (35 m) for 20 s, then good | PASS |
| A02 | acquisition | none | No fixes at all | PASS |
| A03 | acquisition | none | Permission denied | PASS |
| A04 | acquisition | none | Approximate location only | PASS |
| A05 | acquisition | none | Location services off | PASS |
| G01 | signal | precise-uploaded | Accuracy spikes to 60 m three times in 400 m | FAIL (MR-A-06) |
| G02 | signal | precise-uploaded | Accuracy missing for 30 s | PASS |
| G03 | signal | precise-uploaded | Provider drops out for 40 s | PASS |
| I01 | integrity | precise-uploaded | Position jumps 500 m for 8 s, then returns | PASS |
| I02 | integrity | precise-uploaded | 2 min at 15 m/s (car or bus) inside a walk | FAIL (MR-A-02) |
| I03 | social | precise-uploaded | Family co-walk, second walker 2 m to the side | PASS |
| I04 | integrity | precise-uploaded | 3 min in slow traffic at 10 m/s (under the 12 m/s cap) | FAIL (MR-A-07) |
| C01 | clock | precise-uploaded | System clock set back 1 h mid-walk | FAIL (MR-A-05) |
| C02 | clock | precise-ephemeral | System clock moved forward 1 h mid-walk | FAIL (MR-A-03) |
| L01 | lifecycle | precise-uploaded | App in background for 2 min (foreground-only tracking) | PASS |
| L02 | lifecycle | none | Process killed mid-walk | PASS |
| L03 | lifecycle | precise-uploaded | Pause, then Finish without resuming | PASS |
| D01 | calendar | precise-uploaded | Walk across 00:00 UTC | PASS |

Today: 22 PASS, 8 FAIL. Every FAIL is a `todo` in `tests/corpus.test.ts` with its
finding id, paired with a test that the defect still reproduces.

## Measurements (SYNTHETIC)

| Fixture | Truth m | Client m | XP on Save | Server |
|---|---:|---:|---:|---|
| S03 | 0 | 632 | 53 | verified, 632 m |
| W04 | 220 | 216 | 25 | rejected: "Too few GPS points: 7" |
| W06 | 150 | 146 | 27 | rejected: "Too few GPS points: 9" |
| G01 | 400 | 440 | 41 | verified, 440 m |
| I02 | 299 | 2,103 | 144 | verified, 2,103 m |
| I04 | 199 | 2,009 | 137 | verified, 2,009 m |
| C01 | 500 | 175 | 0 | not submitted; the chip stayed "good" for 200 s while every fix was dropped |
| C02 | 150 | 82 | 191 | rejected: "Too few GPS points: 5" (XP already banked) |

The full table for all 30 is in `synthetic-routes/corpus/measurements.md`.

## Failure triage

| Id | Finding | Root cause | Layer | Candidate | Status |
|---|---|---|---|---|---|
| MR-A-01 | Honest saveable walks are rejected by the server | `gps.service.ts` `MIN_POINTS = 10` predates the shared on-foot filter. The 5 m cadence plus the 2 m and accuracy floors leave a 220 m urban walk with 7 points | backend | P1: skip the legacy floor when the session carries metadata, since every point already passed `inspectFix`. The schema floor of 2 stays | PROPOSED; fixes W04 and W06 |
| MR-A-02 | A vehicle leg is credited as walking | After a speed rejection, `inspectFix` keeps the old anchor. When the walker slows down far away, the next fix is measured from the anchor in a straight line at a plausible average speed | shared | P2: after a speed rejection, the next accepted fix starts a new stretch (`breakBefore`), so no bridge is drawn or counted | PROPOSED; I02 2,103 m to 287 m |
| MR-A-03 | Clock jump changes Save eligibility and XP | `isSaveable` and `sessionXp` use `Date.now()` minus start | mobile | P3: duration from the first and last accepted fix timestamps | PROPOSED; C02 191 XP to 0 |
| MR-A-04 | A still phone with overconfident accuracy walks 632 m | The anchor trusts the reported accuracy circle; correlated error moves the fix more than 6 m at a time | shared | P5: 60 s drift guard (path at least 40 m but net under 25% of path). Cuts only to 456 m | Open. Needs device data before a design choice |
| MR-A-05 | Clock rollback silently drops every fix | Fixes stamped "in the future" are rejected as `future_fix`, which does not degrade the chip | mobile | P4: count `future_fix` towards the weak-signal state | PROPOSED; fixes C01 |
| MR-A-06 | Accuracy spikes add about 10% | Recovery after a 60 m spike re-anchors from a displaced fix | shared | None yet | Open |
| MR-A-07 | Slow vehicle under 12 m/s looks like a runner | No speed rule can separate 10 m/s traffic from a sprint | product | Accept as a known limit, or add an activity signal later | Known limit |

Before and after on the whole corpus (`synthetic-routes/corpus/candidates.md`):

| Applied | Fixtures failing |
|---|---:|
| none (today) | 8 |
| P1 | 6 |
| P2 | 7 |
| P3 | 7 |
| P4 | 7 |
| P5 | 8 |
| P1 to P5 together | 3 (S03, G01, I04) |

P1 to P4 change no passing fixture's verdict. P3 lowers XP by 1 to 8 on some
passing walks, because duration then runs from the first to the last accepted
fix instead of from the Start press to the Finish press.

## How to add a fixture

1. Add an entry to `synthetic-routes/fixtures.ts` with a new id, a seed, legs,
   disturbances and events, the expectations, and a privacy class.
2. Run `run-tests.sh`. Determinism, open-ocean placement and category coverage are checked automatically.
3. If it fails because of a real defect, set `knownDefect` with a finding id.
   The test becomes a `todo`, plus a check that the defect still reproduces.
4. Regenerate `corpus/measurements.md` with `report.ts --write`.

## CI

The suite needs no network or secrets and runs in about 5 seconds. A CI job can
call `research/product-playability/run-tests.sh` from `movenrun/` after `yarn install`.
Track A did not add a workflow, because the pack forbids editing deployment
workflows. Wiring it into CI is an integration decision.
