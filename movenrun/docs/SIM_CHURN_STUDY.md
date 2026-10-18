# Territory churn study and `sim-pilot-2`

> **PILOT/SIMULATION ONLY. Nothing here is final.** Every number comes from synthetic players on a synthetic grid. Every variant is a named, reversible simulation config. `sim-pilot-1` has not changed: its three published fingerprints (`30d570be`, `e7214e5`, `e0073617`) and all of its numbers in `SIM_PILOT_RULESET.md` reproduce exactly. No V3 economy number is changed. Where a proposal departs from V3 *text*, it says so below.

- Code: `shared/src/sim/churnStudy.ts` (variants and tables), `shared/src/sim/pilotRuleset.ts` (`ChurnRule`, `SIM_PILOT_2`), `shared/src/sim/simulate.ts` (the levers), and `shared/src/domain/holding.ts` (`TakeoverRule`, an optional field of `HoldingRules`). When `takeover` is absent, the holding model is A9 exactly as before. Tests show the default writes no new fields and gives identical ledgers.
- Reproduce: `yarn workspace @movenrun/shared sim --churn --seeds 1,2,3`. It takes about 10 minutes. The 76 m runs take 25–50 s each.
- Every number is the mean over seeds 1, 2 and 3, with the min–max in brackets where the seeds differ.
- Tags: **SOURCE §n** (V3 source), **PILOT** (proposed here), **ASSUMPTION** (synthetic behaviour, not a rule).

## The question

`SIM_PILOT_RULESET.md` found that held ground changes hands about twice a day (217.6 flips per 100 held units per day). Only 24% of casual players still held any ground at day 90. The owner asked to compare these:

- an immediate takeover against a challenge over two distinct days
- daily ownership-flip caps
- owner defence and fortification
- smaller units grouped into larger upkeep zones
- retention of casual, regular and heavy players
- resistance to griefing, collusion and route farming

The comparison had to keep the owner's 17 Oct rule (one push per walker per unit per day) and end in one balanced, credits-only pilot proposal.

## How the study is run

| | |
|---|---|
| Population (ASSUMPTION) | The default 368 synthetic players plus **8 griefers**: 2 sessions a day of 30–50 min, aimed at other people's ground, never tending their own. Same city, districts and seeds as sim-pilot-1. |
| Attrition (ASSUMPTION) | A player who has held ground, holds none at day close, and lost ground to another walker within 7 days stops playing for the season. The chance is 5% a day for casual players, 3% for regular and 1% for heavy. Without this, players never quit and "retention" could only mean holding ground. Every row uses the same assumption, so it changes levels, not the order of the rows. |
| Retention measures | *Hold* is the share of a profile's players who hold at least one unit at the close of day 30, 60 or 90. *Playing* is the share who have not quit. |
| Churn measures | *Flips* are takeovers of another holder's unit, per 100 held units per day. A unit flipped twice in a day counts twice. *Turnover* is the share of held units that end the day with a different holder, or none, than they started it with. |
| Exploit measures | **Griefer gain:** hectares griefers take per active day, and hectares of casual and regular ground they take per honest player per season. Hectares make 201 m and 76 m units comparable. **Colluder gain:** a colluder's units held at season end ÷ a regular player's, plus flip-trades per day. **Route farming:** route farmers' share of all net credits. There are 8 farmers, 2.2% of players. |
| Checks on every run | One push per walker per unit per day: **0 violations in every one of the 42 runs** (14 configurations × 3 seeds). The books also balance in every run: every day settles; minted + returned = pool; credited + toll + burned = minted; tolls match; season issued + returned = pool; every retry skipped; no event rejected. |

## The levers (each a named variant of sim-pilot-1)

| Variant | What changes | Where it lives |
|---|---|---|
| `two-day-challenge` | **A9 alternative.** A push that would flip someone else's unit does so only if the same walker pushed it on an earlier day within **3 days**, and the holder has not stepped on it since. Otherwise the unit drops to **50** ("at risk", which the holder can see) and the push is recorded as that walker's challenge. Each walker has their own challenge, so a club-mate cannot squat a challenge slot. A holder's visit clears every challenge. Ground below **30** (unvisited for about 24 days) still falls at once. Stepped-on shade still falls at once (SOURCE §4). The numbers are unchanged: push 100, strength 100, overflow at least 1. | `holding.ts` `TakeoverRule.challenge` (option, default off) |
| `unit-flip-cap-1` | A unit changes hands at most once a day. A later push erodes it to no lower than 1. | `holding.ts` `TakeoverRule.maxFlipsPerUnitPerDay` |
| `walker-take-cap-5` | **Daily take cap.** Each walker pushes at most 5 distinct units held by someone else a day, judged on the day's opening holder. Further pushes on other people's ground are refused before the ledger. Claiming and reinforcing are not limited. | simulator (`ChurnRule.walkerTakeCap`) |
| `home-defence-2d` | **Owner defence.** A zone its holder stepped on within 2 days counts as fortified: −30% erosion and decay (SOURCE §11), within the §9 caps. It is free. | simulator |
| `fortify-1ds-7d` | **D9 fortify.** A holder who steps on a zone they visited on 2 days in 7 buys a fortification: 1 day-share, 7 days (PILOT price and duration), burned outside the models' books. | simulator |
| `zones-76m-in-201m` | **D5.** Units are 76 m (H3 resolution 10 scale). Each belongs to the 201 m zone (resolution 9 scale) its centre falls in: 6,487 units in 973 zones. Upkeep, visits, levels (one level per holder and zone, priced per zone as in SOURCE §9), the D16 restore and the D14 condition decay all work per zone. | simulator, plus `zoneOf` in the G3 model (already a parameter) |
| `repeat-route-unscored-3` | **Route farming (outside V3).** A session whose stepped units were all stepped on by the same walker on each of the 3 previous days earns no credits (settled as unscored). It still moves ground. | simulator |

## Results

### Churn and holding

| Variant | Flips / 100 held / day | Turnover / 100 held / day | Casual hold d30 / d60 / d90 | Regular hold d30 / d60 / d90 | Heavy hold d30 / d60 / d90 | Level ≥ 2 at end |
|---|---|---|---|---|---|---|
| immediate (sim-pilot-1) | 195.2 (193.3–197.4) | 81.9 | 0.11 / 0.04 / 0.02 | 0.38 / 0.29 / 0.22 | 0.95 / 0.95 / 0.92 | 0.009 |
| two-day-challenge | 59.9 (59.7–60.1) | 50.1 | 0.18 / 0.09 / 0.07 | 0.52 / 0.44 / 0.42 | 1.00 / 1.00 / 0.99 | 0.032 |
| unit-flip-cap-1 | 80.6 (79.9–81.2) | 88.2 | 0.12 / 0.07 / 0.02 | 0.40 / 0.28 / 0.25 | 0.92 / 0.93 / 0.92 | 0.007 |
| walker-take-cap-5 | 68.3 (67.5–69.6) | 48.3 | 0.26 / 0.19 / 0.11 | 0.68 / 0.61 / 0.61 | 0.95 / 0.97 / 0.97 | 0.069 |
| home-defence-2d | 176.2 (174.4–178.2) | 75.8 | 0.11 / 0.05 / 0.02 | 0.35 / 0.28 / 0.24 | 0.98 / 0.97 / 0.96 | 0.016 |
| challenge + home-defence-2d | 63.3 (63.0–63.5) | 49.4 | 0.16 / 0.11 / 0.06 | 0.57 / 0.42 / 0.41 | 0.99 / 1.00 / 1.00 | 0.031 |
| fortify-1ds-7d | 188.1 (186.0–190.2) | 80.2 | 0.11 / 0.04 / 0.02 | 0.38 / 0.30 / 0.26 | 0.95 / 0.94 / 0.93 | 0.006 |
| challenge + fortify-1ds-7d | 61.4 (61.0–61.7) | 50.2 | 0.18 / 0.10 / 0.06 | 0.58 / 0.44 / 0.42 | 1.00 / 1.00 / 1.00 | 0.011 |
| zones-76m-in-201m | 116.9 (116.7–117.0) | 68.1 | 0.28 / 0.17 / 0.11 | 0.73 / 0.63 / 0.62 | 1.00 / 1.00 / 1.00 | 0.125 |
| repeat-route-unscored-3 | 194.9 (193.1–197.1) | 82.0 | 0.10 / 0.04 / 0.03 | 0.36 / 0.26 / 0.24 | 0.97 / 0.96 / 0.96 | 0.006 |
| challenge + take-cap-5 (201 m) | 13.4 (13.2–13.5) | 13.5 | 0.50 / 0.38 / 0.27 | 0.87 / 0.84 / 0.82 | 0.98 / 0.97 / 0.97 | 0.204 |
| **sim-pilot-2** | **9.0 (8.8–9.1)** | **9.4** | **0.93 / 0.86 / 0.81** | **1.00 / 1.00 / 1.00** | **1.00 / 1.00 / 1.00** | **0.419** |

### Retention, exploits, credits and checks

| Variant | Playing d90 casual / regular / heavy | Griefer ha / active day | Honest ha lost to griefers / player | Heavy + griefer share of held ground | Colluder hold × | Colluder flips / day | Route-farmer credit share | Gini | Issued / pool | Violations | Books |
|---|---|---|---|---|---|---|---|---|---|---|---|
| immediate (sim-pilot-1) | 0.07 / 0.36 / 0.97 | 159.5 | 64.1 | 0.73 | 3.61 | 47.2 | 0.079 | 0.560 | 2.04% | 0 | ok |
| two-day-challenge | 0.14 / 0.53 / 0.99 | 42.8 | 20.1 | 0.65 | 2.13 | 14.1 | 0.081 | 0.504 | 2.18% | 0 | ok |
| unit-flip-cap-1 | 0.10 / 0.38 / 0.96 | 65.1 | 26.9 | 0.70 | 3.50 | 18.6 | 0.075 | 0.548 | 2.09% | 0 | ok |
| walker-take-cap-5 | 0.19 / 0.67 / 0.98 | 47.4 | 46.7 | 0.41 | 1.23 | 26.4 | 0.076 | 0.510 | 2.25% | 0 | ok |
| home-defence-2d | 0.06 / 0.35 / 1.00 | 144.3 | 56.3 | 0.72 | 2.62 | 43.0 | 0.081 | 0.559 | 2.04% | 0 | ok |
| challenge + home-defence-2d | 0.13 / 0.51 / 1.00 | 45.3 | 21.3 | 0.67 | 2.10 | 15.3 | 0.081 | 0.501 | 2.18% | 0 | ok |
| fortify-1ds-7d | 0.06 / 0.38 / 0.95 | 156.4 | 62.5 | 0.71 | 3.13 | 46.1 | 0.080 | 0.561 | 2.02% | 0 | ok |
| challenge + fortify-1ds-7d | 0.14 / 0.55 / 1.00 | 43.3 | 20.5 | 0.65 | 2.07 | 14.7 | 0.080 | 0.502 | 2.20% | 0 | ok |
| zones-76m-in-201m | 0.17 / 0.68 / 1.00 | 52.9 | 26.6 | 0.69 | 1.38 | 130.9 | 0.086 | 0.465 | 2.28% | 0 | ok |
| repeat-route-unscored-3 | 0.06 / 0.36 / 0.97 | 160.2 | 62.9 | 0.71 | 3.55 | 47.4 | **0.003** | 0.565 | 1.87% | 0 | ok |
| challenge + take-cap-5 (201 m) | 0.41 / 0.87 / 0.97 | 6.3 | 7.7 | 0.28 | 1.09 | 6.8 | 0.069 | 0.429 | 2.49% | 0 | ok |
| **sim-pilot-2** | **0.85 / 1.00 / 1.00** | **4.6** | **4.9** | **0.29** | **1.05** | 20.8 | 0.082 | **0.290** | 2.72% | 0 | ok |

### Detail

| Variant | One-push refusals | Take-cap refusals | Level-ups | Level spend | Fortify buys / spend | Upkeep taken / in condition | Casual units lost to flips / player | Shield units lost / player |
|---|---|---|---|---|---|---|---|---|
| immediate (sim-pilot-1) | 1,612 | 0 | 320 | 11,960 | 0 | 7,987 / 596 | 36.8 | 1,813 |
| two-day-challenge | 6,601 | 0 | 692 | 24,531 | 0 | 21,862 / 6,743 | 12.4 | 540 |
| walker-take-cap-5 | 175 | 163,671 | 1,028 | 39,139 | 0 | 18,049 / 3,653 | 35.9 | 399 |
| fortify-1ds-7d | 1,787 | 0 | 158 | 5,691 | 6,874 / 117,273 | 8,544 / 717 | 35.2 | 1,771 |
| zones-76m-in-201m | 10,165 | 0 | 1,644 | 55,995 | 0 | 37,194 / 53,784 | 109.6 (76 m units) | 7,691 (76 m units) |
| challenge + take-cap-5 (201 m) | 3,066 | 172,103 | 1,977 | 64,435 | 0 | 22,803 / 9,625 | 10.4 | 55 |
| sim-pilot-2 | 4,755 | 1,033,405 | 3,145 | 96,619 | 0 | 64,375 / 109,305 | 37.0 (76 m units) | 404 (76 m units) |

Credits in this table are whole credits.

### Continuity: default population, no griefers, no attrition (the setting of `SIM_PILOT_RULESET.md`)

| Ruleset | Flips / 100 held / day | Casual hold d30 / d60 / d90 | Regular hold d90 | Level ≥ 2 at end | Gini | Route-farmer credit share | Issued / pool | Fingerprints |
|---|---|---|---|---|---|---|---|---|
| sim-pilot-1 | 217.6 (217.2–218.4) | 0.20 / 0.23 / 0.24 | 0.57 | 0.009 | 0.336 | 0.058 | 2.62% | `30d570be`, `e7214e5`, `e0073617` (unchanged) |
| sim-pilot-2 | 8.8 (8.7–8.9) | 0.95 / 0.92 / 0.94 | 0.99 | 0.440 | 0.261 | 0.083 | 2.62% | `399de87a`, `ffa02280`, `267ae3c6` |

## What the numbers say

1. **No single lever is enough.** On its own, the best lever leaves casual d90 holding at 0.11 (take cap or zones) against 0.02. Churn comes from three things together. One visit flips undefended ground (A9). Heavy walkers and griefers have unlimited reach. And everyone's walks overlap on 201 m units: about 2.5 units per player.
2. **The two-day challenge is the strongest A9 alternative.** It cuts flips by 69% (195 to 60) and griefer gain by 73% (160 to 43 ha a day). It cuts colluder flip-trading by 70% and shield losses by 70%, with no new sinks. It does not help casual players much alone (0.07 at d90). A 30%-active player can neither defend nor retake ground that needs two visits within three days.
3. **The take cap fixes reach, the challenge fixes pace, and together they compound.** At 201 m, challenge + take cap 5 gives 13.4 flips per 100 held per day, casual d90 holding 0.27, casual playing 0.41, regular d90 holding 0.82, and griefer gain 6.3 ha a day (−96%). The heavy and griefer share of held ground falls from 0.73 to 0.28, and Gini from 0.560 to 0.429.
4. **The unit flip cap is a weak cap.** It stops ping-pong within a day: turnover is unchanged (88 against 82), while flips fall to 81. The ground still changes hands every day. A cap on the walker (reach) works better than a cap on the unit.
5. **Owner defence and fortify barely move churn.** Owner defence takes flips from 195 to 176. Fortify takes them to 188 and burns about 117,000 credits a season. The reason: −30% erosion turns one visit into two, but heavy walkers and griefers hit most units twice anyway. Under the challenge, the holder's visit already defends, and neither adds anything measurable. Fortify also *lowers* the level ≥ 2 share, because the spend competes with level purchases. A free owner defence is not needed. D9 fortify can stay a contest (§13) mechanic, which is how the source frames it.
6. **Small units in larger upkeep zones are the density fix.** At 76 m with 201 m zones, regular d90 holding rises from 0.22 to 0.62 and the level ≥ 2 share from 0.009 to 0.125. Zones remove the upkeep blow-up the first study found at 76 m when a zone was a unit: 39,143 taken against 64,027 in condition before; 37,194 against 53,784 now, *with* griefers and 20 more players. Smaller units also mean more of them per walk, so the take cap is set per unit and scaled by edge length (5 × 201/76 ≈ 13).
7. **Collusion.** Under sim-pilot-2, colluders hold 1.05 times what a regular player holds (3.61 under sim-pilot-1). Their flip-trades (20.8 a day, on 76 m units) earn nothing under the D19 weights, and the challenge makes each trade take two days.
8. **Route farming is a credits problem, and no territory lever touches it.** Route farmers' share of credits stays at 0.07–0.09 (3–4 times their share of players) under every territory variant, because credits are set by the ceilings and the farmers meet SOURCE §2's 10 min / 750 m. The repeat-route rule cuts their share to 0.003 with no false positives among the synthetic honest players. Those players' routes are random, though, so a real habitual walker (same dog walk every day) would be unscored from day 4. That false-positive rate cannot be measured synthetically, so the rule is **not** in sim-pilot-2.
9. **Sustainability.** Every run issues 1.9–2.7% of the 9,000,000 season pool. Under sim-pilot-2 more players keep playing, so it issues 2.72%. The pool binds only at about 5,000 players active on the same day (see the first study). Burned sinks rise with holding: levels go from 11,960 to 96,619, and upkeep taken from 7,987 to 64,375. That is the source's design (rising upkeep, everything burned) working as intended, and no one goes negative.

## Proposal: `sim-pilot-2` (PILOT, credits only)

| Parameter | sim-pilot-1 | sim-pilot-2 | Tag / reference |
|---|---|---|---|
| Push / fresh strength | 100 / 100 | 100 / 100 | SOURCE §4, §5 (unchanged) |
| One push per walker per unit per day | yes | yes | Owner decision 17 Oct (unchanged) |
| What a push that reaches 0 does | Flips at once at the overflow, at least 1 (A9) | Flips only on the walker's second day within 3 days with no holder visit between. Otherwise it leaves 50 and a challenge. Under 30 it falls at once. Stepped-on shade falls at once. | PILOT alternative to A9; departs from §5 text (see below) |
| Daily take cap per walker | none | 13 units of other people's ground (about 1.7 km of walk across them at 76 m) | PILOT, a new rule |
| Unit edge (D5) | 201 m, zone = unit | 76 m units in 201 m zones | PILOT D5 |
| Levels (§9) | per unit | per holder and zone, priced per zone | SOURCE costs; per-zone rule PILOT |
| D14 unpaid upkeep | strongest unit first | strongest zone first, every unit in it | PILOT D14 (same rule, per zone) |
| D16 restore | per unit, 14 days | per zone, 14 days | SOURCE 14 days; per-zone PILOT |
| Decay, stages (D4) | 3 a day; 60/30/10 | unchanged; the challenge floor 50 is "at risk" and the immediate line 30 is the contested floor | PILOT D4 (unchanged) |
| Fortify (D9), owner defence | not simulated | off (studied; no measurable effect under the challenge) | D9 stays open |
| Route-farming credit rule | none | none (owner decision below) | — |
| D2, D15, D17–D23, economy rules version 1 | as sim-pilot-1 | unchanged | — |
| Holding rules version | 9001 | 9002 | so entries never mix |

**Where it departs from V3, explicitly:**

- **SOURCE §5, "At 0 the cell flips to the walker".** Under sim-pilot-2, reaching 0 on held ground flips only on the walker's second distinct day. No V3 number changes: push 100, strength 100, the A9 overflow. What changes is *when* the flip happens. This replaces ASSUMPTION A9's reading, which is not in the source, and needs the owner's approval because it changes the source's wording.
- **No V3 rule matches the take cap.** It is a new limit on one walker's reach. It sits alongside the owner's per-unit rule.
- **D5 was open, so this is not a departure.** It moves from sim-pilot-1's 201 m proposal to 76 m units and 201 m zones. The repository grid is still H3 resolution 8, which neither pilot uses.

## Decisions for the owner

1. **Takeover pace (A9, SOURCE §5 wording):** approve the two-day challenge (window 3, floor 50, immediate below 30) for the pilot, or keep the immediate flip.
2. **Daily take cap:** approve a per-walker cap on pushes against other people's ground, and its value (13 units a day at 76 m). The cost: about 1.0 million pushes a season by heavy walkers and griefers are refused. The game must show this clearly, for example "you can contest 13 rivals' units a day".
3. **D5:** approve 76 m units (resolution 10 scale) grouped into 201 m zones (resolution 9 scale), with one level per holder and zone. That needs a later G3 change: a per-zone level in the settlement input, instead of the simulator's normalisation.
4. **Route farming (credits):** choose between recalibrating SOURCE §2's minimum session (HYPOTHESIS), a repeat-route rule (works on synthetic farmers; false positives unknown until real routes exist), or accepting the farmers' 3–4× credit share while the pool does not bind. Follow-up: `SIM_ROUTE_FARMING_STUDY.md` compares route credit rules against honest repeat walkers; the owner has ruled out raising the minimum session.
5. **D9 fortify:** keep it as a contest mechanic (§13) only, without a churn role. The study found none.

Not decisions: the griefer behaviour and the attrition rate are synthetic assumptions. They only scale the comparison.

## Limits

- The take cap and the D23 immunity are judged on the day's opening holder. A server would judge them in the ledger.
- Fortify and owner defence set the model's `fortified` flag between days. Decay since a unit's last change is computed with the current flag.
- Zones are the coarse hex each unit's centre falls in, close to H3 aperture 7 but not H3 parents.
- Synthetic honest routes are random, so the repeat-route false-positive rate (0.000) is understated.
- Contests, deeds and levels 4 and 5 are still outside the simulation.
- The challenge window, floor and immediate line, and the cap value, were each compared at one or two settings. A finer sweep should follow once real session data exists.
