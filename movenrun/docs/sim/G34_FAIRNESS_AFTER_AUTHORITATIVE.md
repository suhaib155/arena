# Same-seed fairness study after authoritative pushes (#152)

> **SYNTHETIC SIMULATION. HYPOTHESIS, credits-only.** Every number below comes from seeded synthetic walkers whose routes, timings, links and attacks are behaviour assumptions written for experiment 1003. None of it is an observation of real players, and nothing is inferred about real retention, cheating or behaviour. **V3 source rules are not superseded by any experiment, and rule set 1001 stays the default** (config digest `d4199ec60958750007bfa8884c88aad1bf810aed6bd2a054abb5dc74ffe41cd6`, unchanged). 1002 and 1003B are not registered, flag stays off, adopting any of them is the owner's decision.

Base: `010d56f` (#152, authoritative push, no interpolated Solid cells), merged with `38e7251` (#149, the 1003 take-budget experiment). Merge was clean, no conflicts.

## What changed since #149

#149 measured 1002 blocking 56.1% of honest walker-days, 1003B at 5/day blocking 13.1% (4.70 hostile flips per hostile active day) and at 3/day 23.8% (3.29). Those runs were made when the 1002 session-path rule still pushed inferred (interpolated) units. #152 sets `pushInterpolated: false`: a unit inferred between two accepted fixes stays in the stored path for display and analysis, but never claims, erodes, takes or defends.

This study re-runs the same five seeds, 90 days, 126 accounts per seed, with the same harness and the same route fixtures, under four rule sets: 1001, 1002, 1003B at 5/day and 1003B at 3/day. Every rule set in a scenario receives exactly the same sessions in server-receipt order.

**Control.** The `before` scenario switches the inferred pushes back on in the same code. It reproduces the #149 figures exactly (1002 56.07%, B5 13.11%, B3 23.83% of honest walker-days; 1.055 / 4.705 / 3.294 hostile flips per active day, to the digit of `docs/sim/1003/sensitivity/summary.csv`). So every before/after difference below is caused by the push switch alone, and nothing else drifted.

**Real versus inferred units, counted explicitly** (mean per seed, sum over the 90 days):

| Units | Before | After |
|---|---|---|
| Real units pushed (hold an accepted fix), 1002/1003B | 416,335 | 416,335 |
| Inferred units pushed, 1002/1003B | **4,483** | **0** |
| Inferred units stored, display only | 4,483 | 4,483 |
| Resolution 8 cells pushed, 1001 (always a cell holding a fix) | 56,617 real, 0 inferred | same |

Inferred pushes were 1.1% of 1002 pushes at the main fix density, so the honest answer is that #152 barely moves any fairness number here. It matters with sparser GPS (sensitivity below), and it matters as a safety rule: the stored inferred units are now provably display-only (`inferred pushed = 0` is asserted by `afterAuthoritative.test.ts`).

## Before (#149 behaviour) to after (#152), mean ±sd across 5 seeds

SYNTHETIC SIMULATION. Each cell is `before → after`.

| Metric (before #152 → after #152) | 1001 | 1002 | 1003B 5/day | 1003B 3/day |
|---|---|---|---|---|
| Real units pushed, run total (mean/seed) | 56617 ±1628 → 56617 ±1628 | 416335 ±10409 → 416335 ±10409 | 416335 ±10409 → 416335 ±10409 | 416335 ±10409 → 416335 ±10409 |
| Inferred units pushed, run total | 0 → 0 | 4483 ±504 → 0 | 4483 ±504 → 0 | 4483 ±504 → 0 |
| Inferred units stored, display only | 0 → 0 | 4483 ±504 → 4483 ±504 | 4483 ±504 → 4483 ±504 | 4483 ±504 → 4483 ±504 |
| Honest walker-days blocked by caps | 0.0% → 0.0% | 56.1% ±3.9 → 55.5% ±3.9 | 13.1% ±0.9 → 12.8% ±0.9 | 23.8% ±1.1 → 23.7% ±1.1 |
| Honest pushes on others' ground blocked | 0.0% → 0.0% | 50.8% ±1.4 → 50.3% ±1.4 | 2.8% ±0.3 → 2.7% ±0.3 | 5.1% ±0.4 → 5.1% ±0.3 |
| Hostile flips per hostile active day | 13.81 ±0.63 → 13.81 ±0.63 | 1.06 ±0.04 → 1.07 ±0.04 | 4.70 ±0.12 → 4.71 ±0.12 | 3.29 ±0.11 → 3.31 ±0.11 |
| Honest flips per honest active day | 3.92 ±0.07 → 3.92 ±0.07 | 1.03 ±0.03 → 1.02 ±0.03 | 2.22 ±0.08 → 2.21 ±0.08 | 1.88 ±0.07 → 1.87 ±0.07 |
| Map-wide confirmed flips per calendar day | 458.7 ±11.5 → 458.7 ±11.5 | 89.2 ±2.6 → 89.3 ±2.5 | 219.7 ±3.8 → 219.2 ±3.7 | 176.8 ±3.7 → 176.7 ±3.3 |
| Hostile flips of honest ground, run total | 6262 ±208 → 6262 ±208 | 723 ±37 → 729 ±45 | 3161 ±103 → 3155 ±98 | 2252 ±77 → 2252 ±71 |
| Empty land at day 14 (share of touched units) | 20.8% ±2.0 → 20.8% ±2.0 | 0.0% → 0.0% | 0.0% → 0.0% | 0.0% → 0.0% |
| Empty land at day 90 | 26.6% ±4.4 → 26.6% ±4.4 | 18.0% ±2.7 → 18.1% ±2.7 | 17.1% ±2.5 → 17.2% ±2.5 | 17.2% ±2.5 → 17.2% ±2.5 |
| Heat: flips per touched unit | 373.95 ±29.44 → 373.95 ±29.44 | 1.93 ±0.18 → 1.93 ±0.18 | 4.75 ±0.48 → 4.74 ±0.48 | 3.82 ±0.40 → 3.82 ±0.40 |
| Competition: units flipped twice or more | 72.7% ±8.4 → 72.7% ±8.4 | 26.7% ±3.2 → 26.8% ±3.1 | 47.7% ±5.9 → 47.6% ±5.8 | 46.1% ±5.7 → 46.1% ±5.7 |
| Top 10% accounts' share of held area, day 90 | 89.2% ±5.9 → 89.2% ±5.9 | 64.9% ±2.6 → 64.8% ±2.6 | 67.0% ±2.2 → 67.1% ±2.2 | 66.9% ±2.4 → 66.8% ±2.4 |
| Honest walkers holding ground, day 14 | 17.1% ±2.3 → 17.1% ±2.3 | 84.0% ±1.7 → 84.6% ±2.1 | 83.6% ±3.0 → 84.0% ±3.2 | 85.9% ±2.9 → 85.9% ±2.5 |
| Honest walkers holding ground, day 90 | 14.5% ±4.4 → 14.5% ±4.4 | 86.1% ±2.5 → 85.7% ±2.5 | 83.6% ±2.2 → 84.2% ±2.5 | 86.9% ±2.0 → 86.7% ±1.8 |
| Honest-held units at day 14 still held by same walker at day 90 | 36.5% ±7.3 → 36.5% ±7.3 | 47.3% ±2.9 → 47.1% ±2.9 | 39.7% ±3.2 → 39.6% ±3.2 | 40.7% ±2.8 → 40.7% ±2.9 |
| CPU proxy: push events per accepted session | 4.6 ±0.1 → 4.6 ±0.1 | 34.4 ±0.9 → 34.0 ±0.9 | 34.4 ±0.9 → 34.0 ±0.9 | 34.4 ±0.9 → 34.0 ±0.9 |
| Storage proxy: ledger rows per accepted session | 4.6 ±0.1 → 4.6 ±0.1 | 34.2 ±0.9 → 33.9 ±0.9 | 34.3 ±0.9 → 33.9 ±0.9 | 34.3 ±0.9 → 33.9 ±0.9 |
| Storage proxy: stored path units per accepted session | 4.6 ±0.1 → 4.6 ±0.1 | 34.4 ±0.9 → 34.4 ±0.9 | 34.4 ±0.9 → 34.4 ±0.9 | 34.4 ±0.9 → 34.4 ±0.9 |
| Storage proxy: unit rows at day 90 | 111 ±10 → 111 ±10 | 4199 ±419 → 4195 ±417 | 4199 ±419 → 4195 ±417 | 4199 ±419 → 4195 ±417 |
| Storage proxy: open challenge marks at day 90 | 0 → 0 | 599 ±29 → 603 ±36 | 2408 ±120 → 2384 ±109 | 2410 ±151 → 2397 ±140 |
| Appeal-worthy: honest accounts with a blocked day | 0.0% → 0.0% | 87.8% ±1.7 → 87.0% ±1.9 | 89.1% ±3.3 → 88.6% ±3.0 | 93.7% ±0.5 → 93.0% ±0.9 |
| Appeal-worthy: honest blocked walker-days per 1,000 honest active days | 0 → 0 | 561 ±39 → 555 ±39 | 131 ±9 → 128 ±9 | 238 ±11 → 237 ±11 |
| Review flags per 1,000 honest accounts (no sanction) | 104.8 → 104.8 | 104.8 → 104.8 | 104.8 → 104.8 | 104.8 → 104.8 |

Reading it:

- **Blocked honest walker-days** moved by 0.1 to 0.6 percentage points (1002 56.1 to 55.5, B5 13.1 to 12.8, B3 23.8 to 23.7). All of that is within the seed spread (sd 0.9 to 3.9).
- **Hostile flipping per day** is unchanged to two decimals within noise. Authoritative-only pushes do not make 1003B safer against a tour of honest homes: a hostile walker physically steps on the ground, so none of its pushes were inferred.
- **Storage and CPU proxies** fall about 1% for 1002/1003B (34.4 to 34.0 push events per session). The stored path is unchanged, so path storage does not fall.
- **Empty land and heat.** Empty land at day 14 is 0.0% for every 1002/1003 rule set because nothing has decayed to unheld in 14 days; at day 90 it is 17 to 18% against 26.6% for 1001. 1003B heats the map more than 1002 (4.7 and 3.8 flips per touched unit at 5 and 3/day, against 1.9: 2.5x and 2.0x).
- **Retention** (synthetic): the share of honest walkers holding ground at day 14 and day 90 is 84 to 87% under 1002/1003B against 17% and 14.5% under 1001 (1001's cells are 0.737 km² and almost all are held by a few top walkers). Per-unit continuity is lower: only about 40% (B) or 47% (1002) of honest-held units at day 14 are still held by the same walker at day 90, because honest walkers flip each other.
- **Appeal-worthy denials.** Every honest blocked walker-day is counted as appealable (an assumption). 1002 blocks 555 per 1,000 honest active days, 1003B5 128, 1003B3 237. Over 90 days 87 to 93% of honest accounts meet at least one block: low per-day rates still reach almost everyone. Linked-account review flags are an appeal burden only (104.8 per 1,000 honest accounts under the 2+ candidate, identical for every rule set because it reads walks, not holdings). **No sanction is implied or proposed, and none may rest on shared routes or proximity alone.**

## Cohorts, after #152

SYNTHETIC SIMULATION. Same seeds. Spoofers and hostile players are fabricated or adversarial by construction; a "blocked" day for them is not an appeal.

| Cohort | Metric | 1001 | 1002 | 1003B 5/day | 1003B 3/day |
|---|---|---|---|---|---|
| Casual commuters | walker-days blocked | 0.0% | 48.1% ±6.7 | 8.5% ±2.1 | 18.1% ±3.9 |
| Casual commuters | flips per active day | 3.93 ±0.39 | 0.95 ±0.09 | 1.64 ±0.15 | 1.32 ±0.10 |
| Casual commuters | holding at day 14 | 2% ±4 | 100% | 98% ±2 | 100% |
| Casual commuters | holding at day 90 | 1% ±2 | 100% | 98% ±2 | 100% |
| Small loops | walker-days blocked | 0.0% | 22.8% ±7.4 | 15.9% ±2.4 | 27.4% ±3.3 |
| Small loops | flips per active day | 2.88 ±0.39 | 1.16 ±0.07 | 1.99 ±0.16 | 1.50 ±0.10 |
| Small loops | holding at day 14 | 20% ±10 | 100% | 100% | 100% |
| Small loops | holding at day 90 | 11% ±8 | 100% | 100% | 100% |
| Long-distance walkers | walker-days blocked | 0.0% | 99.8% ±0.2 | 24.5% ±5.0 | 40.5% ±4.7 |
| Long-distance walkers | flips per active day | 13.05 ±0.76 | 1.64 ±0.25 | 10.02 ±0.91 | 9.57 ±0.89 |
| Long-distance walkers | holding at day 14 | 87% ±7 | 100% | 100% | 100% |
| Long-distance walkers | holding at day 90 | 93% ±9 | 100% | 100% | 100% |
| Households | walker-days blocked | 0.0% | 83.3% ±5.1 | 13.8% ±1.7 | 27.1% ±1.8 |
| Households | flips per active day | 3.10 ±0.11 | 1.19 ±0.18 | 1.96 ±0.15 | 1.67 ±0.11 |
| Households | holding at day 14 | 15% ±3 | 95% ±5 | 92% ±5 | 94% ±6 |
| Households | holding at day 90 | 9% ±8 | 95% ±5 | 92% ±7 | 95% ±5 |
| Spoofers | walker-days blocked | 0.0% | 100.0% | 98.8% ±0.2 | 98.9% |
| Spoofers | flips per active day | 18.18 ±0.66 | 0.79 ±0.07 | 5.24 ±0.17 | 3.74 ±0.15 |
| Spoofers | holding at day 14 | 50% ±31 | 100% | 100% | 100% |
| Spoofers | holding at day 90 | 65% ±29 | 100% | 100% | 100% |
| Hostile takeover players | walker-days blocked | 0.0% | 100.0% | 98.9% | 98.9% |
| Hostile takeover players | flips per active day | 13.69 ±0.46 | 0.81 ±0.07 | 4.56 ±0.11 | 3.19 ±0.11 |
| Hostile takeover players | holding at day 14 | 65% ±14 | 100% | 100% | 100% |
| Hostile takeover players | holding at day 90 | 40% ±29 | 100% | 100% | 100% |

Observations: long-distance walkers are the cohort every budget hurts (1002 blocks 99.8% of their days; 1003B 24.5% at 5/day and 40.5% at 3/day). Commuters and small-loop walkers are blocked on 8 to 28% of days under 1003B. Hostile players are blocked on 99% of their days under every cap rule and still flip 3.2 to 5.2 units per active day under 1003B, against 0.8 under 1002.

## Sensitivity (three assumptions)

SYNTHETIC SIMULATION. 5 seeds each. Mean ±sd.

| Scenario | Metric | 1002 | 1003B 5/day | 1003B 3/day |
|---|---|---|---|---|
| Main (after) | inferred units stored | 4483 ±504 | 4483 ±504 | 4483 ±504 |
| Main (after) | honest walker-days blocked | 55.5% ±3.9 | 12.8% ±0.9 | 23.7% ±1.1 |
| Main (after) | hostile flips per active day | 1.07 ±0.04 | 4.71 ±0.12 | 3.31 ±0.11 |
| Main (after) | honest holding at day 90 | 85.7% ±2.5 | 84.2% ±2.5 | 86.7% ±1.8 |
| Main (after) | honest accounts with a blocked day | 87.0% ±1.9 | 88.6% ±3.0 | 93.0% ±0.9 |
| Fix every ~30 s | inferred units stored | 18219 ±808 | 18219 ±808 | 18219 ±808 |
| Fix every ~30 s | honest walker-days blocked | 50.6% ±3.4 | 10.9% ±0.7 | 21.1% ±1.3 |
| Fix every ~30 s | hostile flips per active day | 1.14 ±0.04 | 4.77 ±0.12 | 3.38 ±0.11 |
| Fix every ~30 s | honest holding at day 90 | 85.3% ±1.6 | 84.8% ±2.7 | 86.1% ±2.3 |
| Fix every ~30 s | honest accounts with a blocked day | 81.0% ±5.7 | 84.6% ±2.9 | 92.0% ±0.5 |
| Fix every ~60 s | inferred units stored | 46659 ±1500 | 46659 ±1500 | 46659 ±1500 |
| Fix every ~60 s | honest walker-days blocked | 45.6% ±3.7 | 8.5% ±0.6 | 17.4% ±1.2 |
| Fix every ~60 s | hostile flips per active day | 1.25 ±0.02 | 4.86 ±0.13 | 3.49 ±0.12 |
| Fix every ~60 s | honest holding at day 90 | 87.0% ±1.4 | 85.5% ±2.4 | 86.3% ±2.6 |
| Fix every ~60 s | honest accounts with a blocked day | 78.3% ±5.6 | 77.9% ±4.6 | 89.5% ±1.6 |
| Distance-heavy mix | inferred units stored | 5564 ±310 | 5564 ±310 | 5564 ±310 |
| Distance-heavy mix | honest walker-days blocked | 62.0% ±2.2 | 15.3% ±0.9 | 27.1% ±0.7 |
| Distance-heavy mix | hostile flips per active day | 1.14 ±0.07 | 4.59 ±0.07 | 3.17 ±0.06 |
| Distance-heavy mix | honest holding at day 90 | 86.2% ±1.3 | 85.4% ±3.2 | 87.2% ±2.2 |
| Distance-heavy mix | honest accounts with a blocked day | 88.7% ±1.3 | 90.1% ±2.3 | 93.1% ±1.1 |
| 2x hostile players | inferred units stored | 5844 ±604 | 5844 ±604 | 5844 ±604 |
| 2x hostile players | honest walker-days blocked | 56.8% ±3.8 | 14.3% ±1.1 | 26.3% ±1.3 |
| 2x hostile players | hostile flips per active day | 1.02 ±0.08 | 4.39 ±0.07 | 3.02 ±0.06 |
| 2x hostile players | honest holding at day 90 | 85.5% ±2.4 | 84.4% ±3.3 | 86.3% ±2.2 |
| 2x hostile players | honest accounts with a blocked day | 88.0% ±0.9 | 90.3% ±1.8 | 93.1% ±0.8 |

1. **GPS fix interval** (route unchanged, every 3rd or 6th fix kept). Inferred units stored rise from 4.5k to 18k and 47k per seed (12% of stored path units at 60 s), all non-pushing. Fewer pushes mean fewer cap hits: B5 blocks 12.8% of honest days at about 10 s, 10.9% at 30 s and 8.5% at 60 s. **Sparse GPS lowers the denial rate but also under-credits walkers**; it is not a fairness improvement, and hostile flips per day rise slightly (3.31 to 3.49 for B3) plausibly because sparser fixes put fewer pushes against the cap in a tour. This is the assumption that matters most to the #152 change.
2. **Distance-heavy mix** (runners and long-distance walkers doubled). B5 blocked days 15.3%, B3 27.1%, 1002 62.0%. Direction is the same; 1003B3's cost to honest walkers grows with the distance share.
3. **Twice the hostile players.** Honest blocked days rise a little (B5 14.3%, B3 26.3%) and hostile flips per active day fall (4.39 and 3.02) plausibly because a more crowded map leaves fewer unheld targets per hostile walker (not tested). Total hostile flips of honest ground rise 53% (B5, 3161 to 4841).

Scenarios 2 and 3 change the population draw (the pseudo-random stream shifts), so they are not route-identical to the main scenario. Scenario 1 is.

## Assumptions

- All cohort behaviour (counts, schedules, speeds, 10 s fixes at 6 m noise, attack tours, linked groups) is the one of `docs/G34_1003_EXPERIMENT.md`, unchanged. Seeds 1 to 5, 90 days, 126 accounts per seed.
- Event classes, budgets, the 20-hour second-push gap, the 300-unit capacity guard, day close at midnight plus 2 hours and the one-push-per-walker-unit-day rule are as in #149. Credits are not simulated.
- Budget sizes of 5 and 3 per day are simulation parameters. 1003B counts deliberate return pushes only.
- Retention is "holding at least one unit not decayed to unheld at the start of day 14 / at the end of day 90", and "same walker still holds a unit held at day 14". It is a holding measure, not a measure of players returning.
- Empty land is the share of units touched at least once that are unheld after decay.
- Heat is confirmed flips per touched unit; competition is the share of touched units that changed hands at least twice.
- CPU proxy is push events handed to the ledger step per accepted session. Storage proxies are ledger rows, unit rows, stored path units and open challenge marks. No bytes, no wall-clock time and no vacuum state are modelled.
- Appeal-worthy means an honest walker-day with a budget refusal or weakening. That treats every such day as a candidate appeal, which overstates real appeals and ignores that most players would not file one.
- The transit cohort's bus leg passes verification here (vehicle exclusion is not modelled), as in #149. Spoofer traces are dense 10 s fixes. A real spoofer could choose sparse fixes; that is not simulated.
- No sanction in this study rests on shared routes or proximity. The linked-account review is a candidate that creates appeal burden and is not approved for any use.

## Numbers that are not comparable

- **1001 against 1002/1003B for any unit count or share of area.** A 1001 unit averages 0.737 km² (resolution 8) and a 1002/1003 unit 0.015 km² (resolution 10). Heat per unit (374 against 2 to 5), empty land, top 10% share, retention and continuity differ largely because of the unit size. Compare 1001 to the others only for per-walker-day rates, and even then 1001 has no cap.
- **The "before" and "after" columns for 1001** are identical by construction: 1001 never used the session path.
- **Hostile "blocked" days** (99% under every cap) are caps working as designed and are not an appeal burden; do not add them to appeal-worthy totals.
- **Scenarios 2 and 3 against main**: different population draws.
- **Sparse-GPS scenario against main**: fewer pushes by construction; lower blocked rates there are not better fairness.
- **Retention and continuity** are holding measures of synthetic accounts that never quit; they say nothing about real churn.
- **#149 and this study agree to the digit only because the `before` control uses the same code.** Anyone comparing with a different build of 1002 would also have to account for the in-place 1002 digest change (`d9f35588` to `92e8e3cb`).
- **Seed spread**: five seeds. Differences smaller than one sd (most before/after differences here) should be read as no change.

## Owner decision for 1003B: 3 or 5 per day

This is an owner decision; nothing here ratifies a value.

| | 5/day | 3/day |
|---|---|---|
| Honest walker-days blocked | 12.8% | 23.7% |
| Honest accounts with at least one blocked day (90 d) | 88.6% | 93.0% |
| Long-distance walker-days blocked | 24.5% | 40.5% |
| Hostile flips per hostile active day | 4.71 | 3.31 |
| Hostile flips of honest ground per seed | 3155 | 2252 |
| Honest walkers holding ground at day 90 | 84.2% | 86.7% |

If a 1003 budget is piloted at all, 5/day costs honest walkers roughly half the blocked days, while 3/day removes about 29% of hostile flips of honest ground. Neither comes near 1002's attack resistance (1.07 per day), and 1002 itself is not acceptable as a silent default (55.5% of honest walker-days blocked). The budget size is a weak lever against a tour of honest homes: moving from 5 to 3 buys 1.4 flips per hostile day for 11 points of honest blocking. This study leans to **5/day** as the lower-harm value if the owner wants a 1003B pilot, paired with a non-budget control on repeated targeting of the same honest ground (not simulated here). The sensitivity shows the ordering holds across all three assumptions. 1001 remains the default.

## Reproduce

```
cd movenrun/backend
for s in before after thin3 thin6 distance2 hostile2; do node --import tsx scripts/fairness-after-authoritative.ts $s 5 90; done
```

Writes `docs/sim/after-authoritative/<scenario>.csv` (mean, sd, min, max, pooled numerator and denominator for each metric and rule set). Tests: `backend/src/gameplay/afterAuthoritative.test.ts`.

> **Note, 29 October 2026.** The 1002 figures in this document and in the committed CSVs under `docs/sim/after-authoritative` and `docs/sim/1003` were produced by code that predates the fix to the receipt time of a restarted challenge. A re-run with the fix changes 1002 rows only (for example blocked honest pushes 41000 / 81012 become 41003 / 81015 on 2 seeds x 30 days); 1001 and 1003 rows are identical. The 1002 figures have not been regenerated and differ slightly from a fresh run. No CSV was edited. `backend/src/gameplay/experiments/ledger1003.ts` (around lines 106 and 115) still keeps a stale opening time for restarted challenges; that is tracked separately and affects the simulation only.
