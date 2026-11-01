# Sealing v2: a territory seal that requires enclosed ground (28 Oct 2026)

Status: implemented on `fix/g34-sealing-v2-topology`. Gameplay flag stays off and proposed 0011 is still unapplied. **Every threshold below is a pilot hypothesis. None is V3 law, and owner acceptance is pending.**

## 1. The loophole

V3 rule 3 says nothing is claimed until the route seals. #151 enforced this by requiring the movement pipeline's own seal summary (`sealed`, `seal_methods`, `seal_event_count`). That summary comes from the shared sealing engine at sealing rules version 1, which says "sealed" in three situations:

- **Return to start:** the route finishes within 150 m of its first fix. An out-and-back along one street therefore seals.
- **Self-cross:** any strict crossing of two segments. One GPS knot in a straight walk therefore seals.
- **Long jumps drawn as segments:** a jump under the 200 m continuity break counts as a segment. A loop can therefore be closed across a stretch nobody observed.

The engine stays correct for the phone's live preview. It is the wrong gate for claiming land.

## 2. The criterion: `server-enclosed-loop` v2 with loop rule `enclosed-loop` v1

The code is in `backend/src/gameplay/sealLoop.ts`, wired through `rules.ts` (`TerritorySealV2`, `TERRITORY_SEAL_V2_PILOT`, `sealProblem`). Inputs are the accepted fixes only.

1. **Observed steps only (the gap rule).** The line between two consecutive accepted fixes counts as evidence only when all of these hold:
   - no `breakBefore` and no pause;
   - at most **50 m**;
   - at most **120 s**;
   - at most **12 m/s**.

   Every other step is a gap, and a gap is never walked. No candidate loop may contain one, whatever its length, so v1's "under 200 m counts as walked" no longer applies to claiming. The 50 m figure is the tracker's own ceiling: it samples every 4 s or 5 m and the on-foot policy caps speed at 12 m/s, which gives at most about 48 m.
2. **Candidate loops from accepted fixes, inside one observed stretch.** There are two kinds:
   - **Self-crossing:** a strict crossing of two observed steps. The crossing point lies on both observed steps.
   - **Near pass:** a later fix that comes back within **50 m** of an earlier one. The closing edge is never longer than one observed step. For each fix, both the latest such return and the first such return are tried.

   "Come home" is the near pass from the first fix to the last fix. Nothing is interpolated, snapped or completed.
3. **The candidate loop must enclose ground.** The loop is simplified with Douglas-Peucker at `max(10 m, u)`, where `u` is the median reported accuracy of the loop's fixes, capped at 40 m. A missing accuracy counts as 40 m. The loop passes when all three hold:
   - **Area:** the signed shoelace area is at least **2,000 m²**. Because the area is signed, the lobes of a figure-eight cancel and each lobe has to qualify on its own.
   - **Retraced share:** at most **0.2**. Retraced length is loop length that runs within `max(25 m, 3u)` of another part of the same loop, heading within 45° of the opposite direction. This catches out-and-backs, spurs and the two sidewalks of one street.
   - **Effective width:** `2·area/perimeter` is at least `max(20 m, 2u)`. A square of side s has width s/2, and a strip of width w has just under w.

   Before a candidate is measured:
   - **Stick pairing and trim.** A near pass is first slid to the nearest point of the route around it, so a pass along a stick pairs each fix with its opposite. The pair is then walked back while the route runs along itself (within the retrace distance for the session's median accuracy). The walk-back is memoised per fix, so a stick of any length costs one pass, not one per fix.
   - **Spur cutting.** Ring edges longer than the spur radius `max(25 m, 3u)` get points at most that far apart (these points are never claimable). Wherever the ring runs out and back along itself (two points that stay within the radius while the path between them grows past twice the radius), the out-and-back part is removed. A long stick in front of a loop, a dead-end detour and the stretch of an out-and-back are spurs; what remains is the loop.

   Candidates are measured smallest first. A candidate whose fixes are all claimable already is skipped (a Fenwick tree makes this test logarithmic), so on repeated laps one lap qualifies and every longer ring over the same fixes is skipped. Every candidate is measured, within the work budget below. When none qualifies, the session is not territory-sealed, so the rule fails closed.

   **Work budget.** `maxWorkUnits` = **4,000,000** elementary steps (distance tests, segment tests, ring points handled), counted across candidate search, trimming, spur cutting and measuring. The retrace test and the crossing search use a spatial grid; the crossing search tests at most the 64 latest steps per grid cell (a crossing with an older pass also crosses or nears a later one, which makes a smaller loop). When the budget runs out before any loop qualifies, the answer is no, with reason `work_budget_exceeded`. Loops already found stand. Measured on the test machine, a 10,000-point session takes 110–330 ms at the budget (section 3b).
4. **The gate needs both seals.** A session claims only when:
   - the v1 seal summary is present and consistent, as before; and
   - the territory seal is present, carries loop rule version 1 and is `enclosed`.

   Either one alone is not enough. A mid-route near pass that v1 never sealed claims nothing.
5. **Claim scope (`claim: "loop-units"`, an owner-changeable hypothesis).** A qualifying session claims only its units that are among the server's **claimable cells**: the cells of fixes on a qualifying loop (after its spurs are cut) or strictly inside one, plus the cells along observed steps between two such fixes (filled every 5 m, or the session path's own step under 1002). The stick, retraced spurs, and anything across a gap claim nothing. A lollipop with a 2 km stick and one 100x100 m block claims the block's units only. The alternative, `claim: "session-units"`, claims every unit of a qualifying session; it is the reviewed loophole (a long stick plus one small block claimed the whole stick) and is not the default. Changing the scope changes the rule set digest.

   The claimable cells are computed at verification at the rule set's unit resolution (1001: resolution 8, the stored cells; 1002: resolution 10, the session path's resolution), stored with the territory seal and intersected with the session's units when the session is applied, keeping the session's order. A row whose claim resolution differs from the rule set's unit resolution is refused (`territory_claim_resolution_mismatch`). At most 20,000 claimable cells are stored; more fails closed as `work_budget_exceeded`.

Error codes are `territory_seal_missing`, `territory_seal_version_unsupported`, `seal_not_enclosed` and `territory_claim_resolution_mismatch`. The existing codes still apply: `seal_missing`, `session_not_sealed`, `seal_inconsistent` and `seal_rules_version_unsupported`.

**Movement XP is independent.** An unsealed or unenclosed session is still a verified movement session. Its distance, duration and v1 seal summary are unchanged, so it can earn verified movement XP. It cannot claim land.

**Storage and privacy.** Five nullable columns on `movement_verifications`, all proposed in 0011:

- `territory_seal_version`
- `territory_sealed`
- `territory_seal_reason`
- `territory_claim_units` (bigint[] of H3 cells)
- `territory_claim_resolution`

They are written in the verification's own transaction, and only when gameplay is enabled with a v2 rule set. A CHECK constraint keeps them consistent (claimable cells present, 1 to 20,000 of them, exactly when the territory seal is true), and a trigger makes all five write-once. The first three hold a reason code only. The claimable cells are cells of the same accepted fixes the row's `traversed_hex_ids` (1001) or the stored session path (1002) already locate, at the same resolution: no new kind of location, and no area, coordinate or polygon. With the flag off, nothing is computed and nothing outside 0000–0010 is touched.

## 3. Fixture acceptance

This table is the output of `node --import tsx scripts/seal-v2-fairness.ts 20` (backend).

- **Fixtures:** synthetic only, defined in `src/gameplay/sealLoopFixtures.ts`.
- **Walking model:** one fix every 14 m and 10 s.
- **Noise:** AR(1) per-axis error with standard deviation sigma and rho 0.9. Each fix reports accuracy `max(5, 1.5·sigma)`.
- **Sampling:** 20 seeds per noisy cell.
- **Columns:** "fair?" is the intended answer, and "owner" marks a boundary case for the owner to decide. "v1 seals" is the pre-change gate.

| fixture | fair? | v1 seals | v2 reason (sigma 0) | area m2 | width m | retraced | v2 s=0 | v2 s=5 | v2 s=10 | v2 s=15 | v2 s=25 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| park oval 1.5 km (600x360 m) | yes | yes | enclosed | 165162 | 217 | 0.00 | 100% | 100% | 100% | 100% | 70% |
| park irregular loop 1.2 km | yes | yes | enclosed | 103000 | 170 | 0.00 | 100% | 100% | 100% | 100% | 90% |
| park lake path 2.9 km (1200x600 m) | yes | yes | enclosed | 552787 | 382 | 0.00 | 100% | 100% | 100% | 100% | 65% |
| street block 80x80 m (320 m) | yes | yes | enclosed | 6400 | 40 | 0.00 | 100% | 100% | 100% | 5% | 0% |
| street block 100x150 m (500 m) | yes | yes | enclosed | 15000 | 60 | 0.00 | 100% | 100% | 100% | 90% | 0% |
| street block 60x250 m (620 m) | yes | yes | enclosed | 15000 | 48 | 0.00 | 100% | 100% | 100% | 35% | 0% |
| street block 200x200 m (800 m) | yes | yes | enclosed | 40000 | 100 | 0.00 | 100% | 100% | 100% | 100% | 45% |
| three blocks, L-shaped (1.2 km) | yes | yes | enclosed | 67500 | 112 | 0.00 | 100% | 100% | 100% | 100% | 55% |
| short loop 150 m (37.5 m square) | owner | yes | loop_too_small | 1406 | 19 | 0.00 | 0% | 0% | 0% | 0% | 0% |
| short loop 200 m (50 m square) | yes | yes | enclosed | 2500 | 25 | 0.00 | 100% | 100% | 10% | 0% | 0% |
| short loop 250 m | yes | yes | enclosed | 3906 | 31 | 0.00 | 100% | 100% | 45% | 0% | 0% |
| short loop 300 m | yes | yes | enclosed | 5625 | 38 | 0.00 | 100% | 100% | 95% | 0% | 0% |
| short loop 400 m | yes | yes | enclosed | 10000 | 50 | 0.00 | 100% | 100% | 100% | 65% | 0% |
| short loop 300 m circle | yes | yes | enclosed | 6424 | 44 | 0.00 | 100% | 100% | 100% | 5% | 0% |
| loop 200x200, stops 40 m short of start | yes | yes | enclosed | 40000 | 100 | 0.00 | 100% | 90% | 85% | 60% | 25% |
| loop 200x200, stops 80 m short of start | owner | yes | no_closed_loop | - | - | - | 0% | 0% | 0% | 15% | 10% |
| lollipop: 300 m stick, 100x100 head | yes | yes | enclosed | 10000 | 50 | 0.00 | 100% | 100% | 100% | 35% | 0% |
| lollipop: 800 m stick, 150x150 head | yes | yes | enclosed | 22500 | 75 | 0.00 | 100% | 100% | 100% | 100% | 0% |
| figure eight 1200x600 m | yes | yes | enclosed | 235172 | 258 | 0.00 | 100% | 100% | 100% | 100% | 100% |
| figure eight 60x30 m | no | yes | loop_too_small | 419 | 11 | - | 0% | 0% | 0% | 0% | 0% |
| out-and-back 1 km, one street | no | yes | no_closed_loop | - | - | - | 0% | 0% | 0% | 0% | 0% |
| out-and-back 2.5 km, one street | no | yes | no_closed_loop | - | - | - | 0% | 0% | 0% | 0% | 0% |
| out-and-back 400 m, one street | no | yes | no_closed_loop | - | - | - | 0% | 0% | 0% | 0% | 0% |
| sidewalks 10 m apart, 500 m | no | yes | loop_too_small | 174 | 6 | - | 0% | 5% | 5% | 0% | 0% |
| sidewalks 15 m apart, 500 m | no | yes | loop_too_small | 260 | 8 | - | 0% | 5% | 5% | 5% | 0% |
| sidewalks 20 m apart, 500 m | no | yes | loop_too_small | 347 | 9 | - | 0% | 25% | 5% | 5% | 0% |
| sidewalks 20 m apart, 1.5 km | no | yes | loop_too_small | 350 | 9 | - | 0% | 50% | 15% | 5% | 0% |
| boulevard 30 m wide, 500 m | owner | yes | enclosed | 15000 | 28 | 0.00 | 100% | 90% | 10% | 5% | 0% |
| 1 km straight with a 6 m knot | no | yes | no_closed_loop | - | - | - | 0% | 0% | 0% | 0% | 0% |
| 1 km straight with a 12 m loop | no | no | no_closed_loop | - | - | - | 0% | 0% | 0% | 0% | 0% |
| straight 600 m, 40 m spur, back to start | no | yes | no_closed_loop | - | - | - | 0% | 0% | 0% | 0% | 0% |
| spoof: 190x400 loop, top side a 190 m jump in 20 s | no | yes | no_closed_loop | - | - | - | 0% | 0% | 0% | 0% | 0% |
| spoof: 400 m U, 150 m declared break home | no | yes | no_closed_loop | - | - | - | 0% | 0% | 0% | 0% | 0% |
| spoof: 300x150 loop, 150 m side a 3 min gap | no | yes | no_closed_loop | - | - | - | 0% | 0% | 0% | 0% | 0% |
| honest: block 200x200, 40 m dropout | yes | yes | enclosed | 40000 | 100 | 0.00 | 100% | 100% | 100% | 95% | 35% |
| honest: block 200x200, 70 m dropout | owner | yes | no_closed_loop | - | - | - | 0% | 0% | 0% | 0% | 0% |
| block 100x150 inside one res8 cell | yes | yes | enclosed | 15000 | 60 | 0.00 | 100% | 100% | 100% | 80% | 0% |
| block 100x150 across a res8 boundary | yes | yes | enclosed | 15000 | 60 | 0.00 | 100% | 100% | 100% | 80% | 0% |

The regression tests that pin these results are in `src/gameplay/sealLoop.test.ts` and `src/gameplay/sealLoopScale.test.ts` (pure) and `src/gameplay/sealGate.pg.test.ts` (PostgreSQL, through the real pipeline).

Changes from the first measurement (c75e140), caused by spur cutting and by measuring every candidate instead of the largest 400:

- The lollipops now measure as their head alone (area exactly the head, retraced share 0.00, width 50 and 75 m instead of 44 and 63 m). Acceptance at high noise moved both ways (300 m stick at sigma 15: 35%, was 90%; 800 m stick: unchanged at sigma 15).
- Most acceptance at sigma 15 and 25 dropped by 5–25 points for small and medium loops.
- **Parallel-sidewalk leakage went up** (sigma 5: 5–50%, was 0–30%), because more sub-rings are measured and one noisy stretch can pass. Claim scope limits what a leak claims: in the 20-seed runs a leaking sidewalk walk claimed the units of 16 to 94 of its 217 fixes (one run 216), and of 22 to 74 of 75 on the 500 m walks.

### 3b. Scale and timing (`sealLoopScale.test.ts`)

Long lollipops (the reviewed bug: retraced stick rings used up the old 400-candidate cap, so a long stick never sealed):

| route | before (c75e140) | after |
|---|---|---|
| 100x100 m block after a 3 km stick | `loop_retraced` after 400 candidates | `enclosed`, 1 candidate, about 20,000 work units; only head fixes claimable |
| 100x100 m block after an 8 km stick | `loop_retraced` | `enclosed`, about 45,000 work units; head only |
| 50x50 m block after a 20 km stick, 5 m accuracy | `loop_retraced` | `enclosed`, as the block alone (about 110,000 work units) |
| same, 15 m accuracy | `loop_retraced` | not sealed, as the block alone (the thresholds decide, not a cap) |

Noisy variants (sigma 5 and 10, four seeds each) of the 3 km and 8 km lollipops all seal, and every claimable fix lies on or in the head.

Worst-case-ish 10,000-point sessions, single run on the test machine (Node 22). The stated bound in the test is 2,000 ms per evaluation; c75e140 took 5,482 ms on the first case.

| session (10,000 fixes) | time | work | answer |
|---|---|---|---|
| dense random direction, 5 m steps in a 150 m box | 299 ms | 4,000,000 (budget) | enclosed |
| dense random direction, 14 m steps in a 300 m box | 331 ms | budget | enclosed |
| heading random walk, 5 m steps in a 400 m box | 247 ms | budget | enclosed |
| heading random walk, 14 m steps in a 1 km box | 184 ms | budget | enclosed |
| back and forth 72 times on one 140 m line, 1 m steps | 113 ms | budget | `work_budget_exceeded` (no) |
| lawnmower, 30 m rows | 173 ms | budget | enclosed |
| 50 laps of a 1 km park, 5 m steps | 195 ms | budget | enclosed (9,998 of 10,001 fixes claimable) |
| 140 laps, 14 m steps, sigma 5 / 10 | 309 / 264 ms | budget | enclosed |

Laps were a second scale problem found while fixing the first: with largest-first ordering, a 10,000-fix lap session spent the whole budget on multi-lap rings and failed closed. Smallest-first ordering fixed it.

## 4. Sensitivity

Each row moves one threshold and keeps the rest at enclosed-loop v1. Fair, abuse and owner are the mean acceptance over the fixtures in each group:

- **Fair:** 20 fixtures that should seal.
- **Abuse:** 14 fixtures that should not.
- **Owner:** 4 boundary cases (150 m loop, stopping 80 m short, a 30 m boulevard, a 70 m dropout).

| threshold | value | fair s=0 | abuse s=0 | owner s=0 | fair s=10 | abuse s=10 | owner s=10 |
|---|---|---|---|---|---|---|---|
| minAreaM2 | 1000 | 100% | 0% | 25% | 92% | 2% | 3% |
| minAreaM2 | 1500 | 100% | 0% | 25% | 92% | 2% | 3% |
| minAreaM2 | 2000 (v1) | 100% | 0% | 25% | 92% | 2% | 3% |
| minAreaM2 | 3000 | 95% | 0% | 25% | 92% | 2% | 3% |
| minAreaM2 | 5000 | 90% | 0% | 25% | 87% | 2% | 3% |
| minWidthMeters | 8 | 100% | 0% | 25% | 92% | 2% | 3% |
| minWidthMeters | 12 | 100% | 0% | 25% | 92% | 2% | 3% |
| minWidthMeters | 15 | 100% | 0% | 25% | 92% | 2% | 3% |
| minWidthMeters | 20 (v1) | 100% | 0% | 25% | 92% | 2% | 3% |
| minWidthMeters | 25 | 95% | 0% | 25% | 92% | 2% | 3% |
| maxRetracedShare | 0.3 | 100% | 0% | 25% | 92% | 3% | 3% |
| maxRetracedShare | 0.4 | 100% | 0% | 25% | 92% | 4% | 3% |
| maxRetracedShare | 0.5 | 100% | 0% | 25% | 92% | 4% | 3% |
| maxRetracedShare | 0.7 | 100% | 0% | 25% | 92% | 4% | 5% |
| maxRetracedShare | 1 | 100% | 0% | 25% | 92% | 4% | 6% |
| retraceMeters | 0 | 100% | 0% | 25% | 92% | 2% | 3% |
| retraceMeters | 10 | 100% | 0% | 25% | 92% | 2% | 3% |
| retraceMeters | 15 | 100% | 0% | 25% | 92% | 2% | 3% |
| retraceMeters | 20 | 100% | 0% | 25% | 92% | 2% | 3% |
| retraceMeters | 30 | 100% | 0% | 0% | 92% | 2% | 3% |
| maxClosureMeters | 0 | 95% | 0% | 25% | 26% | 0% | 0% |
| maxClosureMeters | 25 | 95% | 0% | 25% | 79% | 1% | 1% |
| maxClosureMeters | 50 (v1) | 100% | 0% | 25% | 92% | 2% | 3% |
| maxStepMeters | 30 | 90% | 0% | 25% | 77% | 1% | 3% |
| maxStepMeters | 50 (v1) | 100% | 0% | 25% | 92% | 2% | 3% |
| maxStepMeters | 100 | 100% | 0% | 50% | 92% | 2% | 28% |
| maxStepMeters | 200 | 100% | 7% | 50% | 92% | 9% | 28% |
| simplifyMeters | 0 | 100% | 0% | 25% | 92% | 2% | 3% |
| simplifyMeters | 5 | 100% | 0% | 25% | 92% | 2% | 3% |
| simplifyMeters | 10 (v1) | 100% | 0% | 25% | 92% | 2% | 3% |
| simplifyMeters | 20 | 100% | 0% | 25% | 90% | 3% | 4% |
| widthPerAccuracy | 0 | 100% | 0% | 25% | 95% | 2% | 4% |
| widthPerAccuracy | 1 | 100% | 0% | 25% | 95% | 2% | 4% |
| widthPerAccuracy | 1.5 | 100% | 0% | 25% | 95% | 2% | 4% |
| widthPerAccuracy | 2 (v1) | 100% | 0% | 25% | 92% | 2% | 3% |
| widthPerAccuracy | 3 | 100% | 0% | 25% | 74% | 0% | 1% |
| retracePerAccuracy | 0 | 100% | 0% | 25% | 93% | 5% | 16% |
| retracePerAccuracy | 1 | 100% | 0% | 25% | 93% | 5% | 16% |
| retracePerAccuracy | 2 | 100% | 0% | 25% | 93% | 5% | 15% |
| retracePerAccuracy | 3 (v1) | 100% | 0% | 25% | 92% | 2% | 3% |
| simplifyPerAccuracy | 0 | 100% | 0% | 25% | 91% | 2% | 3% |
| simplifyPerAccuracy | 0.5 | 100% | 0% | 25% | 91% | 2% | 3% |
| simplifyPerAccuracy | 1 (v1) | 100% | 0% | 25% | 92% | 2% | 3% |
| simplifyPerAccuracy | 2 | 100% | 0% | 25% | 88% | 3% | 4% |

Reading the tables:

- **Without GPS error, every loophole is closed.**
  - The out-and-backs, the knot, the spur, the small figure-eight and all three spoofed gaps are at 0% at every noise level.
  - All of them except the 12 m loop sealed under v1.
- **The remaining abuse leakage is parallel sidewalks at sigma 5:** 5–50%, with 5 m of error reported as 8 m. It falls to 5–15% at sigma 10 and to 0–5% from sigma 15. Two sidewalks 10–20 m apart, recorded with a few metres of error, contain stretches that are geometrically a 20–25 m strip, so this is largely a GPS limit. Under claim scope a leak claims only the stretch that passed (typically 13–45% of the walk's fixes), not the whole street.
- **Thin but genuine loops seal at the threshold.** Outside the fixture table (20 seeds each): a 26x500 m rectangle seals 100% at sigma 0 and 70% at sigma 5; a 22x500 m one 0% at sigma 0 but 60% at sigma 5. A lawnmower sweep with 30 m rows seals 100% at sigma 0 and 5 (35% at sigma 10); with 20 m rows, 0% at sigma 0 but **95% at sigma 5**. These are loops by geometry at or near the 20 m width threshold, and noise pushes the narrower ones over it. Whether such shapes should claim is an owner decision; claim scope keeps the claim to the strip's own units.
- **`retracePerAccuracy` was chosen at 3 from this table.** Compared with 2, it cuts abuse at sigma 10 from 5% to 2%, at no fair cost.
- **`widthPerAccuracy` 3 would close most of the leakage** (abuse at sigma 10: 0%), but fair acceptance at sigma 10 falls from 92% to 74%.
- **The fairness cost falls on small loops with poor GPS:**
  - At 5 m accuracy (sigma 0 and 5), every loop of 200 m perimeter or more seals.
  - At 15 m accuracy (sigma 10) a loop needs about 300 m of perimeter.
  - At 22 m accuracy (sigma 15) it needs about 400 m.
  - At 38 m accuracy (sigma 25) only large loops seal.
- **The 150 m loop (37.5 m square) never seals.** Its area of 1,406 m² is under 2,000 m², and its width of 19 m is under 20 m. Moving either threshold alone does not admit it. Admitting it needs `minAreaM2` of 1,400 or less and `minWidthMeters` of 18 or less.
- **The closing edge matters most.**
  - With `maxClosureMeters` 0, so that only self-crossings count, fair acceptance at sigma 10 falls to 26%: honest walkers stop near their door without crossing their own line.
  - At 25 m it is 79%.
- **The observed step matters next.**
  - `maxStepMeters` 100 lets the honest 70 m dropout seal (owner group 50%).
  - At 200 m, v1's continuity break, the spoofed-gap fixtures come back (abuse 7–9%).
  - At 30 m, honest fair acceptance falls (77% at sigma 10).
- **H3 has no effect on the verdict.** The same block seals identically inside one resolution 8 cell and across three. Claims are the stepped units that are also claimable cells (section 2, item 5).

## 5. Gap rule decision

A step counts as observed when it is at most 50 m, at most 120 s, at most 12 m/s, and has no break or pause. A loop may cross no unobserved step.

The 40 m dropout in the honest block fixture is under 50 m, so the block still seals. The 70 m dropout is over 50 m, so the block does not seal. That is the honest-walker cost of never treating an unobserved stretch as walked. The walker can still close the loop by walking it again.

## 6. Identity, migration and compatibility

**Rule set digests changed.** Both rule sets now name `territorySeal: TERRITORY_SEAL_V2_PILOT` (loop rule with `maxWorkUnits`, and `claim: "loop-units"`). This in-place edit is allowed only because 0011 is unapplied and no day has ever been pinned.

| Rule set | Digest before sealing v2 | First sealing v2 (c75e140) | Now |
|---|---|---|---|
| 1001 | `d4199ec60958750007bfa8884c88aad1bf810aed6bd2a054abb5dc74ffe41cd6` | `9222df56287d481afd39c0b4296af4f89b8ae0327f4616c3fd1ba43c6da3fb7d` | `ff372572d7b754ad6c6dde3dbcc7535f7f62e13e94e718f8424eb0b1e0923bb2` |
| 1002 | `92e8e3cb12ac1f2cc07aeca2a9d50b9424182951a69de2fb8cd91c79cf27b788` | `bc36241ca2f38be8a0ff92d8f9b7ac2d9f834f6c0bc1b4319b1e0398633d4532` | `18a565faa49f00ab506848568101f8c82331928d271fb71d7230e384414442a5` |

Without the `territorySeal` key, both configs are byte-identical to before. The 1001 PostgreSQL regression still matches the state recorded on 685852b once that one key is removed from the pinned day rules, and the test asserts this.

**Proposed 0011 changed (unapplied).** It now adds the five columns, the CHECK constraint (reason codes including `work_budget_exceeded`; claimable cells exactly when sealed) and the write-once trigger. The rollback drops them. Applied migrations 0000–0010 and the journal are untouched. The sha256 values are listed in `G34_SERVER_ARCHITECTURE.md` under "Sealing v2".

**Fixture tests changed.** Direct row writes in tests carry a territory seal that the real `evaluateSealLoop` computed (`sealFixtures.ts`). The interpolation test's sparse walk now seals on a dense square, because 120 m steps are gaps under v2. The storage bench writes `enclosed` rows.

**Not changed:**

- The phone's live seal preview, which uses sealing rules version 1. It can show "sealed" for a route that will not claim, and the app copy should say so before any pilot.
- `finish_on_held_ground`, which is still unavailable server-side.

## 7. Owner decisions pending

1. Accept or replace each pilot hypothesis:
   - observed step 50 m / 120 s;
   - closing edge 50 m;
   - area 2,000 m²;
   - width `max(20 m, 2u)`;
   - retrace `max(25 m, 3u)` with share 0.2;
   - simplification `max(10 m, u)`.
2. Short loops: whether a 150 m loop (about 1,400 m², 19 m wide) should claim. If so, set `minAreaM2` to 1,400 or less and `minWidthMeters` to 18 or less, then re-measure the sidewalk fixtures.
3. GPS quality: whether to accept residual sidewalk leakage (5–50% at sigma 5, 5–15% at sigma 10; current, each leak claiming only the stretch that passed), or move `widthPerAccuracy` to 3 (74% fair acceptance at sigma 10). The same choice covers thin rectangles and lawnmower sweeps near the 20 m width (section 4).
4. Claim scope: `loop-units` (current: only units on or inside a qualifying loop claim) or `session-units` (every unit of a qualifying session). Also whether interior fixes should claim (current: yes) and the 4,000,000-unit work budget (about 100–330 ms on the test machine; an honest session that exceeds it claims nothing).
5. Whether the app must tell walkers that a v1 "sealed" preview is not a claimable loop, or whether the phone preview should adopt the same rule.
6. Real-route calibration: these are synthetic fixtures. Before any pilot, replay opt-in, consented, anonymised pilot routes, or the owner's own walks, and revise the numbers. Any change is a new loop rule version.
