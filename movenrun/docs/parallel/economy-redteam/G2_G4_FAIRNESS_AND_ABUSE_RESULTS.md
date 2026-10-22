# G2–G4 fairness and abuse results: rule 1001 vs 1002 in an independent scenario lab

Track B, sections B2 (scenario simulator) and B3 (fairness and first-order game health). Research only. Rule set 1001 is the default; 1002 is an unratified, not-live, credits-only pilot proposal. Nothing here changes either, and no number here is an observation of real players.

**Evidence tiers used below:** SOURCE (V3 revision 2), PILOT ASSUMPTION (1002's values), VERIFIED CODE (base `cb27318`), SYNTHETIC EXPERIMENT (this lab, seeds given), MODEL ASSUMPTION (retention model, kept in its own section). There is no HOSTED PROOF: no live system was observed.

## 1. Summary

| # | Finding | Tier |
|---|---|---|
| 1 | Under identical synthetic players and routes, 1002 cuts attacker flips of held ground from 33.2 (the 1001 rule object on the resolution 10 path, lab variant R1001-res10) to 0.78 per 100 held units per day (10% malicious, 200 players, 90 days): about 42x fewer (roughly 36–51x from the 95% intervals; 3 seeds). 1001 as configured by default (resolution 8 stored cells) is far worse again: 207. | SYNTHETIC EXPERIMENT |
| 2 | That cut does **not** make attackers small. At 10% malicious they still hold 67% [66, 69] of all held ground at day 90 under 1002 (77% under 1001 on the same units). 71% of what they acquire under 1002 is vacant ground claimed, not ground taken. 1002 moves abuse from taking to claiming; it does not stop accounts that upload far more (spoofed, replayed, sybil) ground than a person walks. | SYNTHETIC EXPERIMENT |
| 3 | The 20 h server-receipt gap removes every challenge completed in under 20 h on ground above the immediate-take line (0 in all runs vs about 2,070 per 90-day run without it at 10% malicious, counting all walkers). Its effect on aggregate attacker flips is small (0.78 vs 0.81); its cost is borne mostly by legitimate players: legit-vs-legit flips drop 15% (135 to 115 per day, 0% malicious). | SYNTHETIC EXPERIMENT |
| 4 | The 13/day take budget is hit by legitimate players routinely in this synthetic city: 30–33% of legit sessions at medium density with no attackers at all, 91% of runner sessions, 25% of commuter sessions. It counts every erosion of someone else's ground, including ground a walker just passes through. Denials cluster at 06–08 and 17–19 local time (commute and run hours). | SYNTHETIC EXPERIMENT, VERIFIED CODE (`TakeBudget` counts `eroded` and `flipped`, rules.ts:147–174, policy.ts:185) |
| 5 | Under 1002 legit-vs-legit ground changes hands about 11 times less than under the same units with immediate flip (115 vs 1,310 per day, 0% malicious). Casual players keep ground (casual day-90 holding 0.81 vs 0.60) and calendar-day uptime rises (0.59 vs 0.37). Whether that is "fair" or "noncompetitive" is a product question the simulation cannot settle. | SYNTHETIC EXPERIMENT |
| 6 | Players who walk together (households, co-walkers, clubs) keep eroding each other's units: 343 challenge erosions and 53 flips per 100 shared sessions under 1002 (867 flips under immediate flip). Club members see a zero-gain session 43% of the time under 1002 vs 0.5% under immediate flip on the same units. | SYNTHETIC EXPERIMENT |
| 7 | An illustrative co-presence review heuristic flags 24–32 legitimate account pairs per 1,000 players per month, mostly households and clubs, about 380–480 staff minutes per 1,000 players per month at an assumed 15 minutes each. It caught 3 of 9 linked malicious pairs. Do not auto-punish co-walking. | SYNTHETIC EXPERIMENT, MODEL ASSUMPTION (heuristic) |
| 8 | New joiners hold less on day 1 under 1002 (0.53–0.76 of joiners who had walked) than under immediate flip on the same units (0.83–0.97), because occupied ground cannot be taken on the first visit. By day 30 the order reverses (0.90 vs 0.72–0.85). | SYNTHETIC EXPERIMENT |
| 9 | Walk order vs unit-id order for the take budget changes almost nothing in aggregate (0.784 vs 0.783 attacker flips per 100 held per day). Pushing interpolated units vs stepped units only changes little at a 10 s fix interval (0.785 vs 0.783). | SYNTHETIC EXPERIMENT |
| 10 | No invariant violation in 36 audited 90-day runs (3 seeds x 12 variants, 200 players, 10% malicious) and the test fixture: no inconsistent unit, no second hostile push per walker/unit/day, no take or unit budget exceeded. | SYNTHETIC EXPERIMENT, VERIFIED CODE (server ledger used unchanged) |

Pre-registered hypotheses: 7 of 14 pass (6 pass: H1, H3, H7, H10, H13, H14; and H2 passes only on the metric narrowed after the smoke run, it fails under its original wording), 7 fail (H4, H5, H6, H8, H9, H11, H12). See section 5.

## 2. What was built

`movenrun/research/economy-redteam/sim/`, separate from `shared/src/sim/simulate.ts` (nothing imported from there):

| File | Role |
|---|---|
| `manifest.json` | Versioned manifest: synthetic geography, clock, seeds, the 12 variants, the 6 stages, omitted combinations and why, every behaviour assumption, and the 14 hypotheses with thresholds (written before the sweep; revision log inside). |
| `prng.ts` | mulberry32 and named sub-streams (FNV-1a), so every draw is seeded and independent of other streams. |
| `world.ts` | Synthetic plane around an arbitrary origin in open ocean (0.5, −30.5): urban disc sized by density, a 600 m central business district, four rural villages. Routes become GPS-like fixes (about 4 m noise, 10 s or 25 s fix interval) and then units through the server's own `deriveSessionPath` (path.ts) with `VERIFIED_STEPS_V1`, and `cellsForObservations` for the resolution 8 stored cells. Each route also has a gapped copy (no fixes for 3–6 min, so those units are neither stepped nor interpolated: not pushed). |
| `population.ts` | Open-loop synthetic participants and sessions (cohorts below), upload delays, retries, second-device copies, a DST-like clock change, night walkers. |
| `variants.ts` | The 12 variants. R1001 and R1002 are `PILOT_PROPOSAL` and `SIM_PILOT_2_PROPOSAL` by reference; the rest spread one of them and change only the named fields. |
| `engine.ts` | Feeds each session, in server receipt order, to the server's pure ledger step `applyServerLedger` (policy.ts) with the variant's holding rules, take budget, walk order, second-push gap and the 300/day unit budget (`DEFAULT_UNIT_BUDGET`, capacity.ts). Adds what the service does around it: D1 day of the last fix (`dayOf`), day close at midnight plus 2 h grace (`lastClosedDay`), session-level retry skipping, and all measurements. |
| `run.ts` | CLI. Runs stages and writes `out/rows_<stage>.csv` (one row per cell, seed and variant), `out/cohorts_<stage>.csv`, `out/hours_<stage>.csv` and `out/summary.csv` (mean and 95% interval across seeds, one wide row per cell and variant). |
| `lab.test.ts` | Six tests: determinism, unchanged rule objects, variant well-formedness, invariants, straddle protection, statistics helpers. |

Commands, from `movenrun/`:

```
node --import tsx --test 'research/economy-redteam/sim/**/*.test.ts'      # 6 pass, 0 fail, about 6 s
node --import tsx research/economy-redteam/sim/run.ts                     # full staged sweep, about 25 min on 4 cores when stages run in parallel
node --import tsx research/economy-redteam/sim/run.ts --stage A-core      # one stage
node --import tsx research/economy-redteam/sim/run.ts --summarize-only    # rebuild out/summary.csv
```

Outputs in `out/` total about 750 KB.

### 2.1 Fidelity choices

- **Server code, not a re-implementation (VERIFIED CODE).** Holding arithmetic, the two-day challenge (`TakeoverRule`), one hostile push per walker/unit/day, the take budget, walk order and the 20 h gap all run inside `applyServerLedger` and `applyPush`. The lab passes the same inputs the service builds (`service.ts` 585–653): the walker's takes and units used that day, walk-order positions for path units, server receipt times. Unit state is passed per session as the subset of touched units, as the service does after locking.
- **Same inputs for every variant.** Participants, routes and receipt times depend only on the seed and the scenario; each scenario's session list gets a hash (`inputHash` column) and is fed unchanged to every variant.
- **R1001 is shown twice.** `R1001` is 1001 exactly as configured (resolution 8 stored cells, about 0.74 km² each, unit-id order). `R1001-res10` gives the unchanged 1001 rule object the same resolution 10 path as 1002, to separate the takeover rule from the unit size. Comparisons of rules use `R1001-res10` vs `R1002`; `R1001` shows what today's default would do. Area columns are in km² so the two unit sizes compare.
- **Not modelled:** land levels (every unit is level 1, unfortified, so an `eroded` outcome always means a blocked flip), deeds, masking, away protection, upkeep, credits, shade (sealed loops), adaptive behaviour, real dropout, movement verification (every upload is accepted, so spoofed and replayed sessions succeed by assumption: a worst case for the takeover rules, not a statement about the verifier).

### 2.2 Synthetic participants (behaviour ASSUMPTIONS)

Legit cohorts (share of legit players): commuter 18% (weekday home–CBD–home), recreational 14% (4/week loops), casual 24% (about 2.5/week), enthusiast 9% (daily, sometimes twice), accessibility-constrained 5% (0.8 m/s, 120–250 m loops), runner 8% (3 m/s, 8–14 km loops), household 10% (2–3 members sharing a home, walking together), co-walker pairs 4%, club 4% (groups of 8, weekly group walk), centre lunch walkers 4% (CBD loops, natural collisions). 20% of legit players join on a random later day. 5% are night walkers whose walks can straddle midnight. Half the players run a +60 min local clock that switches to +0 on day 20.

Malicious mix (of the malicious share): opportunist 40% (daily tour through 4–6 legit homes, plus a 23:21/00:03 midnight straddle on one home every two days), ring 20% (4 accounts splitting a daily tour, plus straddles), sybil 15% (3 linked accounts on one device splitting one walk), replay 10% (each session re-sent, re-sent under a new id, and resubmitted as the next day's walk), spoofer 15% (three fabricated 7-stop tours a day at running pace, never walked).

Timing noise (legit uploads): 85% within 5 min, 10% 10–90 min late, 4% 2–10 h late (offline), 2% retried with the same id, 3% also uploaded from a second device. 8% of sessions have a GPS gap; 30% of devices record a fix every 25 s instead of 10 s.

### 2.3 Staged design: what ran and what did not

| Stage | Population | Days | Malicious | Density | Noise | Variants | Seeds |
|---|---|---|---|---|---|---|---|
| A-core | 200 | 90 | 0, 2%, 10% | med | on | all 12 | 101, 202, 303 |
| B-density | 200 | 90 | 2% | low, high | on | 1001, 1001-res10, 1002, nogap, b5, b20 | 3 |
| C-horizon | 100 | 1, 7, 30, 180 (two seasons) | 2% | med | on | 1001, 1001-res10, 1002, nogap, win2 | 3 |
| D-scale | 1000 | 30 | 2%, 10% | med | on | 1001, 1001-res10, 1002, nogap | 101, 202 |
| E-small | 25 | 90 | 0, 10% | med | on | all 12 | 101–505 (5) |
| F-noise-off | 100 | 30 | 2% | med | off | 1001, 1002, nogap | 3 |

Omitted (reasons in the manifest): the full factorial (about 4,300 cells x seeds), A-core at 100 players, five seeds outside E-small, 1000 players beyond 30 days or with all variants, horizons below 90 days at 200+ players, the unit-budget counterfactuals outside A-core/E-small, levels/fortify/deeds/masks/upkeep/credits/shade, adaptive behaviour, and any replication of #123.

**Seeds and intervals.** Three seeds in most stages, two at 1,000 players, five at 25. Intervals are 95% Student-t intervals across seeds, so with three seeds they are wide (t = 4.30) and a fraction's interval can cross 0 or 1. They show spread, not certainty. Intervals are not clipped to [0, 1], so a fraction's bound can read below 0 or above 1.

**Non-replication.** PR #123's churn study uses `shared/src/sim` with its own 368-player world. Its exact fixture was not re-run here. Nothing below is a replication of its numbers; where the directions agree that is a non-replication agreement only.

**Manifest revisions (honest log).** Version 1 held the hypotheses and a larger stage plan. Before the sweep, version 2 cut the stage plan to fit the compute budget. One development smoke run (seed 101, 100 and 200 players, 10% malicious) had been run to check run time and correctness. After seeing that smoke run's output, the H2 metric was narrowed to exclude ground decayed below 1002's immediate-take line, which the rule hands over at once by design; those flips have their own column. The original H2 metric fails (section 5). Seed 101, used in the smoke run, is also in the sweep; a robustness check on seeds 202 and 303 only is in section 5. The other thresholds were not changed.

## 3. Results

All tables: mean [95% interval] across seeds, SYNTHETIC EXPERIMENT. "Legit" means non-malicious synthetic players.

### 3.1 Attack and abuse (A-core, 200 players, 90 days, 10% malicious)

| Variant | Attacker flips / 100 held / day | Attacker share of held ground, day 90 | Share of attacker acquisitions that were vacant claims | Straddle completions < 20 h | Legit holding any ground, day 90 |
|---|---|---|---|---|---|
| R1001 (res 8) | 207 [190, 225] | 0.87 [0.85, 0.89] | 0.08 | 0 | 0.11 [0.09, 0.12] |
| R1001-res10 | 33.2 [31.3, 35.2] | 0.77 [0.75, 0.80] | 0.18 | 0 | 0.69 [0.66, 0.72] |
| R1002 | 0.78 [0.69, 0.88] | 0.67 [0.66, 0.69] | 0.71 | 0 | 0.90 [0.85, 0.94] |
| R1002-nogap | 0.81 [0.69, 0.94] | 0.67 [0.66, 0.69] | 0.70 | 2071 [1929, 2214] | 0.89 [0.86, 0.92] |
| R1002-gap24 | 0.58 [0.46, 0.70] | 0.66 [0.65, 0.68] | 0.77 | 0 | 0.90 [0.86, 0.93] |
| R1002-win2 | 0.79 [0.70, 0.88] | 0.68 [0.67, 0.69] | 0.71 | 0 | 0.90 [0.83, 0.97] |
| R1002-b5 | 0.31 [0.27, 0.35] | 0.66 [0.65, 0.68] | 0.86 | 0 | 0.94 [0.89, 1.00] |
| R1002-b20 | 1.14 [0.97, 1.30] | 0.69 [0.67, 0.70] | 0.63 | 0 | 0.86 [0.79, 0.93] |
| R1002-unitorder | 0.78 [0.76, 0.81] | 0.67 [0.66, 0.68] | 0.71 | 0 | 0.90 [0.82, 0.98] |
| R1002-stepped | 0.79 [0.69, 0.88] | 0.68 [0.67, 0.69] | 0.71 | 0 | 0.90 [0.85, 0.95] |
| R1002-ub150 | 0.97 [0.93, 1.01] | 0.60 [0.58, 0.63] | 0.64 | 0 | 0.90 [0.85, 0.95] |
| R1002-ub450 | 0.72 [0.64, 0.80] | 0.70 [0.69, 0.71] | 0.72 | 0 | 0.90 [0.84, 0.95] |

Straddle completions count every walker, legitimate ones included (an evening walk and the next morning's walk are a natural straddle). Ground decayed below strength 30 still falls at once under 1002 (7 [4, 10] such fast flips per run).

**Abuse benefit per unit of cost** (2% / 10% malicious):

| Variant | Flips of legit ground per physically walked attacker-hour | Per attacker device, 90 days | Attacker-held km²·days per device |
|---|---|---|---|
| R1001 (res 8) | 1.60 / 0.96 | 1304 / 598 | 2543 / 979 |
| R1001-res10 | 8.36 / 6.15 | 6832 / 3842 | 743 / 444 |
| R1002 | 0.29 / 0.28 | 240 / 175 | 633 / 417 |
| R1002-gap24 | 0.21 / 0.20 | 168 / 125 | 625 / 412 |
| R1002-b5 | 0.12 / 0.11 | 96 / 68 | 628 / 414 |

Flips per hour and per device fall about 22–28x under 1002, but **ground held per attacker device barely moves** (743 to 633 km²·days at 2%). The holding comes from claiming vacant land with uploads no person walked (spoofers, replays, sybil splits), which no takeover rule addresses. At 2% malicious, attackers still hold 38% of held ground at day 90 under 1002 (27.6 of 72.3 km²). This is the case the assignment warns about: attackers who lose the fight for occupied ground but dominate vacant land. The defence has to be movement verification, account linking and per-device/per-person budgets, not the takeover rule. The 300/day unit budget refused about 359,000 malicious pushes per 10%-malicious run in every res10 variant; at 150/day the attacker share falls to 0.60 [0.58, 0.63] without any legit unit-budget denials at 300 or 450.

### 3.2 Competition, contested ground and co-walking (A-core, 0% malicious)

| Variant | Legit-vs-legit flips / day | Share of legit-ever-held units contested by another legit player | Flips / 100 shared walks | Challenge erosions / 100 shared walks | Casual holding at day 90 (from the 10% malicious cell, not 0%) | Calendar-day uptime (legit) |
|---|---|---|---|---|---|---|
| R1001 (res 8) | 298 [283, 312] | 0.74 | 113 | 0 | 0.07 (10% mal.) | 0.15 |
| R1001-res10 | 1310 [1164, 1455] | 0.63 | 867 | 0 | 0.60 (10% mal.) | 0.37 [0.29, 0.45] |
| R1002 | 115 [113, 117] | 0.60 | 53 | 343 | 0.81 (10% mal.) | 0.59 [0.53, 0.66] |
| R1002-nogap | 135 [131, 139] | 0.60 | 66 | 349 | 0.80 (10% mal.) | 0.58 |
| R1002-gap24 | 93 [90, 96] | 0.60 | 41 | 347 | 0.87 (10% mal.) | 0.61 |
| R1002-win2 | 106 [103, 109] | 0.60 | 47 | 344 | 0.83 (10% mal.) | 0.60 |
| R1002-b5 | 57 [55, 60] | 0.52 | 27 | 174 | 0.92 (10% mal.) | 0.70 |
| R1002-b20 | 139 [138, 140] | 0.61 | 65 | 404 | 0.75 (10% mal.) | 0.56 |

Won, lost and empty-earned area per legit player, 90 days, 10% malicious (km²):

| Variant | Low intensity: won / lost / empty | High intensity (> 6 sessions a week): won / lost / empty |
|---|---|---|
| R1001-res10 | 3.31 / 3.17 / 0.41 | 17.0 / 18.7 / 3.15 |
| R1002 | 0.33 / 0.32 / 0.04 | 1.29 / 1.21 / 0.26 |
| R1002-b5 | 0.21 / 0.19 / 0.04 | 0.62 / 0.55 / 0.27 |

Two readings, without assuming player preference:

- **Stability.** Under 1002 a casual player's ground mostly survives (uptime 0.59 vs 0.37), and the share of legit players holding anything at day 90 is higher (0.90 vs 0.69). If the product wants "your patch stays yours if you keep walking it", 1002 delivers more of it.
- **Tension.** Ground changes hands an order of magnitude less (115 vs 1,310 legit-vs-legit flips per day). Most of 1002's pushes on rivals' ground end as a challenge erosion that the player sees as nothing gained. Combined with the 5/day budget, churn falls a further half. A game where casuals hold their ground nearly forever and rivals rarely gain may be calm rather than competitive. The lab cannot say which the players prefer; it shows the trade is large.

Co-walking: people walking the same loop together keep pushing each other's units. Under immediate flip the second uploader takes the first one's ground at once (867 flips per 100 shared walks); under 1002 they erode each other to the floor and complete the takeover on the next shared walk (343 erosions and 53 flips per 100). Neither is a good experience for a household; neither rule has a notion of "walked together".

### 3.3 Take cap, unit cap and inexplicable failures

Legit sessions with at least one push refused by the take budget, A-core 2% malicious, by cohort (R1002 unless named):

| Cohort | Take-cap session rate | Takes refused per capped session | With budget 20 | Zero-gain sessions, R1002 | Zero-gain, R1001-res10 |
|---|---|---|---|---|---|
| commuter | 0.25 | 7.1 | 0.10 | 0.016 | 0.009 |
| recreational | 0.39 | 4.9 | 0.09 | 0.031 | 0.003 |
| casual | 0.06 | 2.0 | 0.00 | 0.140 | 0.007 |
| enthusiast | 0.33 | 7.6 | 0.14 | 0.024 | 0.003 |
| accessibility | 0.00 | 0 | 0.00 | 0.083 | 0.000 |
| runner | 0.91 | 29.3 | 0.79 | 0.015 | 0.009 |
| household | 0.43 | 4.9 | 0.09 | 0.226 | 0.006 |
| co-walker | 0.56 | 6.7 | 0.22 | 0.247 | 0.003 |
| club | 0.48 | 9.5 | 0.26 | 0.427 | 0.005 |
| centre lunch | 0.25 | 2.0 | 0.00 | 0.315 | 0.000 |

Take-cap denials by local start hour (R1002, mean pushes per 90-day run): 06h 6,665; 07h 8,112; 08h 2,119; 17h 3,236; 18h 8,409; 19h 6,370; every other hour below 2,000. Unit-cap (300/day) denials of legit players: none at 300 or 450 in A-core; only the 150 counterfactual produced any (900 pushes in total across its runs, runners).

Session-level failure rates, all legit sessions:

| Cell | Variant | Zero-gain (nothing claimed, kept or taken) | Unexplained denial (take cap, unit cap, stale day or day closed) | Challenge-only (only erosions) | Day closed (late upload) |
|---|---|---|---|---|---|
| A-core 0% | R1001 | 0.104 | 0.005 | 0 | 0.005 |
| A-core 0% | R1001-res10 | 0.005 | 0.005 | 0 | 0.005 |
| A-core 0% | R1002 | 0.071 | 0.305 | 0.060 | 0.005 |
| A-core 0% | R1002-b20 | 0.077 | 0.138 | 0.069 | 0.005 |
| B high density | R1002 | 0.185 | n/a | n/a | n/a |
| F noise off | R1002 | 0.062 | 0.271 | n/a | 0.000 |

Readings:

- **The 13/day cap routinely surprises long-route legitimate players** in this synthetic city: 91% of runner sessions and a quarter to a half of commuter, household, club and enthusiast sessions. With noise off (F) the rate is the same, so it is the cap, not timing. In the low-density city it is 25% overall and 74% for runners; in the high-density city 39% and 92%. The cap counts erosion of any rival unit a route crosses, so a runner whose loop passes 40 neighbours' units spends the budget in the first kilometre. Budget 20 halves the overall rate but leaves 79% of runner sessions capped.
- **Late uploads lose whole sessions.** About 0.5% of legit sessions arrive after the day closes (midnight plus 2 h) and are refused whole (`day_closed`, service.ts:524–525). Late sessions also meet `stale_day` rejections on units another walker already moved to the next day (6–54 per run). These are silent losses after a valid walk. The D1 attribution itself rarely surprises (0.0–0.2% of sessions land on a different day from the walker's local calendar day, DST-like change included).
- **1001 at resolution 8** gives 10–15% zero-gain sessions: big cells already pushed today (one-push rule) after someone else flipped them.

### 3.4 Concentration, urban and rural, accessibility, households, new joiners

A-core, 2% malicious unless noted:

| Variant | Gini of legit holdings (day 90) | HHI, all holders (0–10,000) | District HHI (res 7, weighted) | Rural / urban holding ratio | Accessibility holding at day 90 | Household holding at day 90 |
|---|---|---|---|---|---|---|
| R1001 (res 8) | 0.87 [0.80, 0.95] | 1412 | 5747 | 3.23 | 0.20 | 0.09 |
| R1001-res10 | 0.67 [0.60, 0.73] | 680 | 2696 | 1.22 | 0.83 | 0.70 |
| R1002 | 0.57 [0.51, 0.64] | 440 | 2448 | 1.05 | 0.90 | 0.91 |
| R1002-b5 | 0.56 | 427 | 2449 | 1.03 | 0.97 | 0.86 |

Density (B-density, R1002): rural/urban ratio 0.98 [0.83, 1.13] in the low-density city and 1.50 [1.38, 1.63] in the high-density city, where urban players crowd each other and casual day-90 holding is only 0.57 (vs 0.99 at low density). Gini rises from 0.54 to 0.72 from low to high density.

New joiners who had walked at least once (A-core):

| Variant | Malicious | Holding at join + 1 day | + 7 days | + 30 days |
|---|---|---|---|---|
| R1001 (res 8) | 10% | 0.13 | 0.13 | 0.09 |
| R1001-res10 | 10% | 0.83 [0.65, 1.0] | 0.76 | 0.72 |
| R1002 | 10% | 0.76 [0.55, 0.98] | 0.83 | 0.90 |
| R1002 | 2% | 0.53 [0.42, 0.64] | 0.82 | 0.90 |
| R1002-gap24 | 2% | 0.48 | 0.79 | 0.92 |

Under 1002 a newcomer walking ground that is already held cannot take it on the first visit; they hold something only if their walk reached vacant ground. After a week they catch up and by day 30 they do better than under immediate flip.

Horizons and seasons (C-horizon, 100 players, 2% malicious, R1002): attacker share of held ground 0.25 at day 1, 0.19 at day 7, 0.34 at day 30, 0.38 at day 180; season 1 mean 0.33, season 2 mean 0.37. Legit holding at the end 0.55 / 0.88 / 0.92 / 0.94. Ground persists across the season boundary in this model. Scale (D-scale, 1,000 players, 30 days, R1002): attacker share 0.48 at 2% and 0.70 at 10%; legit take-cap session rate 0.53, runners 0.95. The direction of every 200-player result holds at 1,000.

### 3.5 Review flags (illustrative heuristic, variant-independent)

| Cell | Legit pairs flagged / 1,000 players / month | of which household/co-walker/club members | Shared-device flags | Malicious linked pairs caught / present | Staff minutes / 1,000 / month (15 min a flag) |
|---|---|---|---|---|---|
| A-core 0% | 31.7 [24.5, 38.8] | 19 per run | 1 | 0 / 0 | 475 |
| A-core 2% | 25.6 [20.8, 30.3] | 15 | 0.3 | 0 / 0 | 383 |
| A-core 10% | 24.4 [11.8, 37.1] | 15 | 0 | 3.3 / 9 | 450 |

The heuristic is not a server feature; it shows that "same place, same time, same route" signals land mostly on legitimate households and clubs, and that sybils who split a walk evade it. Any real review must treat co-walking as normal, never auto-punish it, and rely on device and account signals that this lab models only crudely.

### 3.6 Retention model (MODEL ASSUMPTION, not gameplay output, not observed retention)

Post hoc only; the model never changes who plays. Daily dropout hazard 0.4%, times (1 + 3 x share of the player's ground lost that day), plus 0.5 points on a day with an inexplicable failure. Modelled 90-day survival of legit players (A-core): 0% malicious R1001-res10 0.51, R1002 0.65, R1002-b5 0.61; 10% malicious R1001-res10 0.51, R1002 0.63. Casual players: 0.57–0.58 vs 0.69–0.70. The ordering follows directly from the assumed loss sensitivity: lower churn of ground means lower modelled hazard, offset by take-cap "failures" (which is why b5 models lower than 1002). Change the coefficients and the ordering can change. It is a sensitivity aid, not evidence.

## 4. Rule-understanding UX requirements

From the results above, if 1002 or anything like it is piloted:

1. **Name the take budget as an allowance, not a failure.** "You can contest 13 rivals' units a day. Today: 13 of 13 used; rival ground you passed after that was not contested." Show it before a long run, in the run summary, and on the map. Never show a walk as "failed" because the budget ran out; most capped runners still claimed and kept ground.
2. **Explain that passing through counts.** The budget is spent by any erosion of rival ground on the route, in walk order. A runner needs to know that the first kilometres through a dense neighbourhood use it up.
3. **Show challenges as progress.** A first push on someone's ground leaves it "challenged" (at 50) until the same walker returns on a later day, at least 20 h later by server receipt, within the window. The summary must say "challenged 9 units; return from tomorrow 07:40 to take them" with the earliest time, because "next day" is not enough under the gap.
4. **Tell late uploaders before they lose a day.** A session received after midnight plus 2 h is refused whole. The app should upload eagerly, warn when a walk is near the cut-off, and explain the refusal in words when it happens.
5. **Make walking together safe.** Players walking together should not erode or take each other's ground. That needs a rule (an opt-in group walk, or household linking), not only messaging; until then, warn group walkers.
6. **Never present a stepped-vs-inferred difference silently.** With 10 s fixes, interpolated units changed little here, but with sparse fixes or gaps players will see ground they "walked" not counted. The run summary should show gaps.
7. **Show why a newcomer did not get ground on day 1.** Under 1002 a first walk over occupied ground produces only challenges.

## 5. Hypotheses: pass or fail against the pre-registered thresholds

| Id | Test (from manifest, unchanged) | Result | Verdict |
|---|---|---|---|
| H1 | Attacker flips per 100 held per day, A-core 200/10%: R1002 <= 0.5 x R1001-res10 | 0.78 vs 16.6 threshold | PASS |
| H2 | Straddle completions: R1002 = 0 every run; nogap > 0 every malicious run | Narrowed metric (ground at or above the immediate line): 0 in all A-core runs; nogap > 0 in every run. Original wording (all completions under 20 h): R1002 has 1 to 8 decayed-ground flips in every A-core run | PASS under the metric narrowed after the smoke run; original wording FAILS (1 to 8 decayed-ground flips per R1002 run, by design). The nogap count includes legit walkers |
| H3 | Casual day-90 holding, A-core 200/10%: R1002 >= 0.6 and >= R1001-res10 | 0.81 [0.55, 1.07] vs 0.60 | PASS on means; interval wide |
| H4 | Attacker share of held ground, A-core 200/10%: R1002 <= 0.20 | 0.67 [0.66, 0.69] | FAIL |
| H5 | Take-cap session rate, A-core 200/2%: R1002 runners <= 0.05, all legit <= 0.01 | 0.91 and 0.33 | FAIL |
| H6 | Every variant: zero-gain <= 0.02 and unexplained denial <= 0.03 | R1001 zero-gain 0.10–0.15; R1002 unexplained 0.31–0.36; only R1001-res10 passes | FAIL |
| H7 | Joint-walk flips per 100 shared walks, A-core 0%: R1002 <= 0.1 x R1001-res10 | 52.5 vs 86.7 threshold | PASS (but 343 erosions per 100) |
| H8 | False-positive flags <= 5 per 1,000 per month | 24–32 | FAIL |
| H9 | New joiners, A-core 200/10%, every variant: >= 0.8 at +1 and >= 0.7 at +7 | R1002 0.76 at +1; R1001 0.13 | FAIL (R1001-res10 passes) |
| H10 | Gini legit, A-core 200/2%: R1002 <= 0.8 and <= R1001-res10 + 0.05 | 0.57 vs 0.67 | PASS |
| H11 | Legit-vs-legit flips, A-core 0%: R1002 >= 0.25 x R1001-res10 | 115 vs 327 threshold (ratio 0.09) | FAIL |
| H12 | Rural/urban holding ratio, B-density, R1002, in [0.8, 1.25] | low 0.98, high 1.50 | FAIL (high density) |
| H13 | Unit-id vs walk order: relative difference < 10% | 0.1% | PASS |
| H14 | Invariant violations = 0 | 0 in 36 audited runs and all test runs | PASS (see note) |

Robustness without the smoke-run seed (A-core, seeds 202 and 303 only, from `out/rows_A-core.csv`): H1 R1002 0.78 (0.82, 0.74) vs R1001-res10 33.0 (33.7, 32.4), still PASS; H2 narrowed metric R1002 0 and 0, nogap 2,067–2,117, still PASS (original wording still FAILS: 3–8 decayed-ground flips); H4 attacker share 0.67 (0.68, 0.67), still FAIL.

Note on H14: the sweep runs with auditing off for speed, so the `invariantViolations` column in `rows_*.csv` is 0 by construction. The evidence is the audited run (A-core 200 players, 10% malicious, 90 days, seeds 101/202/303, all 12 variants) and the test fixture, both auditing after every session.

## 6. Limitations

- **Synthetic everything.** Geography is a generated plane in open ocean; routes are polygons and grid paths, not streets. Densities, cohort shares, frequencies and upload delays are assumptions. Absolute rates (for example, the 30% take-cap rate) depend on them heavily; directions and ratios between variants on identical inputs are the robust part.
- **Open-loop behaviour.** Nobody reacts to losing ground, attackers do not read the map, nobody quits. Real attackers would adapt to whatever rule is chosen; real players might avoid rivals' streets once they learn the cap.
- **No verification.** Spoofed and replayed sessions always succeed. Attacker holdings are therefore an upper bound under a verifier that catches nothing.
- **Fixed route cells.** A route's units are derived once from one noisy trace; repeat walks produce identical cells, so real GPS variation (more cells touched, more incidental erosion) is not modelled.
- **Unit budget and order inputs** are reproduced from the service's code path by reading it; the service's database transaction, locking and concurrency are not exercised.
- **Seeds.** Three seeds give wide intervals. Some differences discussed (for example nogap vs 1002 on attacker flips) are inside the intervals; the text says so where it matters.
- **Season boundary.** Holdings persist across it; if the owner decides on a season reset, season-2 numbers change.
- **Retention.** Section 3.6 is a model with invented coefficients. It is not retention.

## 7. Decisions this informs (owner)

1. Whether a take budget should count incidental erosion of ground merely passed through, or only deliberate contests (for example, pushes on units the walker has challenged before). As counted today it caps most long legitimate routes.
2. Whether the default should move off resolution 8 stored cells (R1001 as configured): it scores worst on attacks, concentration, new joiners and zero-gain sessions in every cell.
3. How much ground change between legitimate players is wanted (1,310 vs 115 flips per day here), which decides between immediate flip, 1002, and the gap and budget variants.
4. A group-walk or household rule, so co-walkers stop eroding each other.
5. Per-device and per-person limits and movement verification as the real defence against vacant-land domination; no takeover rule tested here addresses it.
6. Whether interpolated units should push at all (1002 does; V3 says inferred data is not stepped ground). At 10 s fixes the difference was small here; it needs ratification, not a simulator choice.
