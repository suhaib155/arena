# G34 experiment 1003: take-budget reform, compared with 1001 and 1002

> **SIMULATION ONLY. HYPOTHESIS, credits-only.** Every number here comes from seeded synthetic walkers whose routes, timings, links and attacks are behaviour assumptions written for this experiment. Nothing is an observation of real players, and nothing is inferred about real retention or behaviour. **1001 stays the default rule set** and its config digest is still `d4199ec60958750007bfa8884c88aad1bf810aed6bd2a054abb5dc74ffe41cd6`, which `experiment1003.test.ts` asserts. 1002 and the 1003 variants are hypotheses for a credits-only pilot. They do not replace any SOURCE rule. 1003 is not registered in `RULESETS`, and no server code reads it. Adopting any rule is the owner's decision.

## What was run

Packet section 10 asks for the take budget to stop charging casual walkers for incidental movement. This experiment separates push events into classes and tests budgets that count only some of them.

Each seed builds one population and one set of verified sessions. Every rule set gets exactly those sessions, in server-receipt order:

- **1001** plays on resolution 8 stored cells: A9 immediate flip, no take budget.
- **1002** plays on the resolution 10 session path: two-day challenge, 20-hour second-push gap, and 13 takes a day (`takes-v1`, which counts every erosion and every flip).
- **1003 A/B/C/C0** are 1002 by spread (`src/gameplay/experiments/rules1003.ts`), with 1002's own budget switched off and a 1003 budget put in its place. The holding arithmetic, challenge, gap, units and path are all 1002's.

All rule sets run through the server's own ledger step, `applyServerLedger`. The 1003 variants call it one event at a time (`experiments/ledger1003.ts`) and then apply their budget to the result. All rule sets also share these guards:

- the 300-unit daily capacity guard;
- day close at midnight plus a 2-hour grace;
- the owner's fixed one-push rule: one hostile push per walker, per unit, per day.

The one-push rule is applied by the holding model before any budget. It never counts against a budget. A test checks this for every variant, with budget left and with the budget used up.

**Reproduce** (about 4 minutes per set):

```
cd movenrun/backend
node --import tsx scripts/experiment-1003.ts 5 90                                   # main set -> docs/sim/1003/
node --import tsx scripts/experiment-1003.ts 5 90 ../docs/sim/1003/sensitivity sensitivity
```

The run covers seeds 1 to 5, 90 days, and 126 accounts per seed. Each cell shows the mean, ± the sample standard deviation across seeds, and the min–max in brackets. The day-90 metrics are read at the end of the run, which is day 90.

## Event classes

Each push is classified on the unit as it stands that day, after decay:

| Class | Definition |
|---|---|
| empty-ground claim | Nobody holds the unit (outcome `claimed`). |
| defense | The walker already holds it (`reinforced`). |
| pass-through erosion | Someone else holds it. The walker has no open challenge on it from an earlier day in the window, and it does not change hands. This is first contact. |
| contested takeover | Someone else holds it, and the walker is returning to their own challenge from an earlier day in the window. This is a deliberate second push. It did not flip, because the 20-hour gap or a budget held it back. |
| confirmed flip | The unit changes hands. A flip is marked *deliberate* when it completes the walker's own challenge. Otherwise it fell at first contact (ground below the immediate-take line of 30). |
| economic reward | A derived count, not a holding outcome: claims plus confirmed flips, the events a credit rule could pay. **Credits are not simulated.** |

## Variants

The budget is 13 a day in every main variant, the same number as 1002, so the comparison isolates *what* is counted. The incidental and soft strengths are 25: a quarter of a solid push, the same value as the SOURCE §4 shade ceiling. These are simulation parameters. The exact values are in `docs/sim/1003/units.csv`.

| Label | Counts against the budget | Past the budget |
|---|---|---|
| 1003A | confirmed flips only | refused, nothing changes, the challenge stays open |
| 1003B | deliberate return pushes only (contested or flipped); first-contact flips and erosion are free | refused, nothing changes |
| 1003C | deliberate returns and every confirmed flip; **plus** reduced-strength incidental erosion (a first contact takes off at most 25 instead of dropping to the challenge floor of 50; it still opens the challenge) | **soft**: the push applies at strength 25 and can never flip |
| 1003C0 | C without the optional soft budget: reduced incidental erosion alone | – |
| sensitivity | A5, B5, B3, C5: the same counting with 5 or 3 a day | as the parent variant |

## Populations (ASSUMPTION)

All counts are accounts per seed.

| Cohort | Accounts | Behaviour |
|---|---|---|
| commuters | 24 | On 85% of weekdays: an L-shaped walk home to work and back. On 35% of weekends: a short loop. |
| runners | 8 | A 6–12 km loop at 3 m/s on 55% of days. |
| loop walkers | 16 | Their own 350–700 m loop on 75% of days, sometimes twice. |
| long-distance walkers | 6 | A 1.8–3.5 km-radius loop on 45% of days. |
| households (linked pairs) | 16 | Active 75% of days. Together on 70% of those days, starting within 4 minutes. |
| siblings (linked trios) | 9 | Active 70% of days. All three together on 50% of those days. |
| shared public routes | 12 | Unrelated, unlinked walkers on one of two public routes (a park loop or a canal out-and-back) at their own times, 60% of days. |
| public transit riders | 8 | Walk to a stop, ride a bus leg at 8 m/s, walk to work, and the reverse in the evening. ASSUMPTION: the bus leg passes verification. §5 vehicle exclusion is not modelled. |
| location drift | 6 | A phone on an office desk: 30–90 minutes of about 15 m random wander on 80% of weekdays. |
| two-device duplicates (linked) | 8 | Four people, each carrying two phones on two accounts. Every walk is recorded twice, with starts within 10 s. Counted as neither honest nor adversarial. |
| malicious walkers | 4 | A tour through six honest homes, the **same targets the next day**, plus a midnight straddle. |
| GPS spoofers | 4 | Three fabricated tours of four homes, each repeated the next day, plus the grace backdate across midnight. |
| collusion ring (unlinked) | 5 | Each walks a shared base loop daily, trading it among themselves, plus a tour of four honest homes repeated the next day. |

"Honest" means the first nine cohorts: 105 accounts. "Adversary" means malicious walkers, spoofers and the ring: 13 accounts.

The review candidate is the one from #123 (`review-flag-2plus` and the 3+ variant, replayed exactly as in `fairness.ts`), generalised to groups of any size. It reads only linked accounts. **Linkage is never an automatic sanction.** Here a flag is only an appeal burden. The #123 rule is not approved for deployment or for automatic sanctions.

## Data files (`docs/sim/1003/`, and the same set under `sensitivity/`)

- `seeds.csv`: each seed, the population PRNG seed (`seed XOR 0x1003`), days, accounts and total sessions.
- `units.csv`: each rule set's unit kind, resolution, average unit area, zone, takeover, gap, budget counting, size, mode and strengths.
- `per_seed_cohort.csv`: raw counts per seed, rule set and cohort. Every numerator and denominator below can be rebuilt from it.
- `per_seed_map.csv`: map-level counts per seed: held units, top-10% share, adversary-on-honest flips, load proxies, and review flags by linked cohort.
- `summary.csv`: each metric's mean, sd, min, max, n, numerator sum, denominator sum and denominator definition.

**Unit areas differ.** A 1001 unit averages 0.737 km² and a 1002 or 1003 unit 0.015 km². Unit counts are comparable only between 1002 and the 1003 variants. Against 1001, compare shares.

## Main table

SIMULATION ONLY. Synthetic players. 5 seeds (1, 2, 3, 4, 5), 90 days, 126 accounts per seed. Mean ±sample sd (min–max) across seeds.

| Metric (denominator) | 1001 | 1002 | 1003A | 1003B | 1003C | 1003C0 |
|---|---|---|---|---|---|---|
| blocked pushes on others' ground (honest pushes on ground another walker held (pass-through + contested + flips + hard refusals)) | 0.0% | 50.8% ±1.4 (49.6–52.7) | 0.7% ±0.2 (0.5–0.9) | 0.3% ±0.1 (0.2–0.5) | 0.8% ±0.2 (0.6–1.0) | 0.0% |
| walker-days with a blocked push (honest active walker-days) | 0.0% | 56.1% ±3.9 (51.5–61.7) | 3.0% ±0.5 (2.2–3.7) | 1.6% ±0.3 (1.2–2.1) | 3.6% ±0.5 (2.9–4.4) | 0.0% |
| walker-days with a blocked push: commuters (commuter active walker-days) | 0.0% | 49.1% ±6.6 (39.6–55.9) | 0.5% ±0.2 (0.3–0.7) | 0.5% ±0.2 (0.2–0.7) | 0.7% ±0.4 (0.2–1.3) | 0.0% |
| walker-days with a blocked push: runners (runner active walker-days) | 0.0% | 99.3% ±0.6 (98.7–100.0) | 5.1% ±0.9 (4.4–6.6) | 1.5% ±0.6 (0.8–2.4) | 10.9% ±1.7 (9.9–13.9) | 0.0% |
| walker-days with a blocked push: long-distance walkers (long active walker-days) | 0.0% | 99.8% ±0.2 (99.6–100.0) | 31.2% ±7.8 (17.9–36.7) | 2.4% ±0.7 (1.7–3.2) | 36.2% ±6.0 (26.0–40.7) | 0.0% |
| walker-days with a blocked push: shared public routes (shared active walker-days) | 0.0% | 76.2% ±34.6 (14.4–93.9) | 5.2% ±3.3 (0.6–8.1) | 5.4% ±3.5 (0.6–8.5) | 5.0% ±3.5 (0.2–8.1) | 0.0% |
| walker-days with a blocked push: households (linked pairs) (household active walker-days) | 0.0% | 83.6% ±5.2 (77.5–91.3) | 1.5% ±0.5 (0.9–2.2) | 1.6% ±0.4 (1.2–2.2) | 1.6% ±0.4 (1.0–2.1) | 0.0% |
| walker-days with a blocked push: public transit riders (transit active walker-days) | 0.0% | 19.0% ±11.7 (1.1–30.9) | 0.1% ±0.1 (0.0–0.2) | 0.1% ±0.1 (0.0–0.2) | 0.0% ±0.1 (0.0–0.2) | 0.0% |
| sessions that claimed or defended (honest accepted sessions) | 10.7% ±0.9 (9.7–11.8) | 83.2% ±1.4 (82.4–85.6) | 75.7% ±1.1 (74.5–77.5) | 76.2% ±1.1 (75.0–77.9) | 76.8% ±1.1 (75.3–78.3) | 67.2% ±1.2 (66.0–68.7) |
| false reviews (2+ candidate) per 1,000 honest accounts (honest accounts) | 104.8 | 104.8 | 104.8 | 104.8 | 104.8 | 104.8 |
| false reviews (3+ candidate) per 1,000 honest accounts (honest accounts) | 28.6 | 28.6 | 28.6 | 28.6 | 28.6 | 28.6 |
| duplicate-device groups flagged (2+) (duplicate groups) | 100% | 100% | 100% | 100% | 100% | 100% |
| adversary flips of honest ground (run total (count)) | 6262 ±208 (5910–6442) | 723 ±37 (689–785) | 6054 ±232 (5823–6313) | 5745 ±185 (5575–5947) | 6151 ±205 (5908–6401) | 8557 ±430 (7848–9008) |
| attack area flipped from honest walkers, km² (run total; flips × unit area) | 4617.145 ±153.471 (4357.606–4749.864) | 10.879 ±0.555 (10.368–11.812) | 91.095 ±3.487 (87.622–94.995) | 86.451 ±2.778 (83.890–89.487) | 92.560 ±3.078 (88.901–96.319) | 128.758 ±6.468 (118.093–135.548) |
| honest flips of honest ground (run total (count)) | 16670 ±456 (16011–17254) | 5075 ±250 (4808–5432) | 9093 ±578 (8752–10114) | 9723 ±640 (9343–10862) | 10697 ±401 (10357–11381) | 7671 ±614 (7135–8709) |
| adversary share of held area at end (units held at end) | 10.7% ±6.0 (4.4–19.8) | 6.1% ±1.3 (4.4–7.5) | 11.7% ±1.1 (10.7–13.0) | 11.8% ±1.2 (10.7–13.1) | 11.0% ±1.0 (9.9–12.4) | 17.0% ±1.7 (15.7–19.6) |
| adversary share of empty-ground claims (all claims) | 30.0% ±3.0 (26.5–34.2) | 7.7% ±0.6 (7.0–8.6) | 6.9% ±0.5 (6.4–7.5) | 6.9% ±0.5 (6.3–7.5) | 27.8% ±2.4 (25.0–30.0) | 7.0% ±0.5 (6.4–7.6) |
| honest empty-ground claims per active walker-day (honest active walker-days) | 0.17 ±0.02 (0.14–0.19) | 0.90 ±0.09 (0.78–1.00) | 0.86 ±0.09 (0.73–0.96) | 0.85 ±0.10 (0.71–0.95) | 1.15 ±0.10 (1.02–1.25) | 0.83 ±0.09 (0.70–0.93) |
| honest share of held area at end (day-N control) (units held at end) | 88.2% ±6.3 (79.0–95.6) | 91.3% ±1.4 (89.2–92.7) | 86.3% ±1.3 (84.2–87.4) | 86.3% ±1.2 (84.5–87.3) | 87.1% ±1.0 (85.8–88.4) | 81.5% ±1.5 (79.9–83.1) |
| honest walkers holding ground at end (honest accounts) | 14.5% ±4.4 (10.5–21.9) | 86.1% ±2.5 (81.9–88.6) | 80.2% ±2.2 (77.1–82.9) | 80.0% ±2.1 (77.1–82.9) | 78.9% ±2.5 (76.2–82.9) | 72.0% ±5.2 (66.7–79.0) |
| top 10% of accounts' share of held area at end (units held at end) | 89.2% ±5.9 (79.4–94.3) | 64.9% ±2.6 (62.2–68.1) | 66.8% ±2.2 (64.2–69.8) | 67.1% ±2.4 (64.2–70.2) | 67.3% ±2.4 (64.5–70.4) | 69.1% ±3.1 (64.9–72.4) |
| adversary flips per adversary active day (adversary active walker-days) | 13.81 ±0.63 (13.03–14.75) | 1.06 ±0.04 (1.02–1.11) | 10.89 ±0.15 (10.71–11.07) | 10.01 ±0.15 (9.85–10.15) | 10.04 ±0.11 (9.86–10.13) | 21.34 ±0.47 (20.81–22.08) |
| adversary credit-eligible events per active day (adversary active walker-days) | 14.18 ±0.63 (13.39–15.12) | 1.44 ±0.03 (1.40–1.48) | 11.22 ±0.17 (11.02–11.42) | 10.33 ±0.16 (10.14–10.51) | 12.34 ±0.21 (12.11–12.59) | 21.66 ±0.48 (21.14–22.43) |
| ring flips per ring active day (ring active walker-days) | 10.41 ±0.77 (9.47–11.59) | 1.49 ±0.08 (1.41–1.58) | 8.27 ±0.34 (7.86–8.64) | 8.32 ±0.32 (7.92–8.66) | 9.33 ±0.27 (8.95–9.61) | 10.06 ±0.57 (9.38–10.67) |
| honest credit-eligible events per active day (honest active walker-days) | 4.09 ±0.07 (4.00–4.17) | 1.93 ±0.10 (1.80–2.07) | 3.45 ±0.14 (3.31–3.65) | 3.49 ±0.14 (3.36–3.70) | 4.12 ±0.13 (3.98–4.29) | 3.56 ±0.16 (3.39–3.79) |
| honest pushes on others: pass-through share (honest pushes on others) | 0.0% | 42.9% ±1.4 (41.0–44.3) | 87.5% ±0.4 (86.8–87.7) | 87.5% ±0.4 (86.8–87.8) | 86.0% ±0.3 (85.6–86.2) | 88.2% ±0.3 (87.6–88.5) |
| honest pushes on others: contested share (honest pushes on others) | 0.0% | 1.4% ±0.0 (1.3–1.4) | 0.2% ±0.0 (0.1–0.2) | 0.1% ±0.0 (0.1–0.2) | 0.6% ±0.1 (0.4–0.7) | 0.1% ±0.0 (0.1–0.2) |
| honest pushes on others: confirmed-flip share (honest pushes on others) | 100.0% | 4.9% ±0.2 (4.8–5.1) | 11.7% ±0.3 (11.4–12.2) | 12.0% ±0.3 (11.8–12.5) | 13.4% ±0.1 (13.3–13.6) | 11.6% ±0.3 (11.4–12.2) |
| one-push rule refusals (independent of budget) (run total (count)) | 12212 ±839 (11149–13291) | 16504 ±1309 (14375–17494) | 31759 ±2220 (29418–34149) | 31311 ±2174 (28927–33626) | 33404 ±2250 (31044–35846) | 35499 ±2507 (32604–38365) |
| unit-capacity (300) refusals (run total (count)) | 0 | 1348 ±256 (937–1564) | 1341 ±256 (927–1556) | 1344 ±256 (932–1557) | 1337 ±258 (920–1554) | 1337 ±258 (920–1554) |
| load: ledger rows per accepted session (accepted sessions) | 4.6 ±0.1 (4.4–4.7) | 34.2 ±0.9 (33.0–35.3) | 34.2 ±0.9 (33.0–35.3) | 34.2 ±0.9 (33.0–35.3) | 34.2 ±0.9 (33.0–35.3) | 34.2 ±0.9 (33.0–35.3) |
| load: unit rows at end (count) | 111 ±10 (98–125) | 4199 ±419 (3645–4756) | 4199 ±419 (3645–4756) | 4199 ±419 (3645–4756) | 4199 ±419 (3645–4756) | 4199 ±419 (3645–4756) |
| load: open challenge marks at end (count) | 0 | 599 ±29 (568–633) | 2327 ±102 (2226–2465) | 2331 ±103 (2222–2462) | 2059 ±129 (1919–2206) | 2064 ±132 (1922–2202) |

## Budget-size sensitivity (same seeds)

SIMULATION ONLY. Synthetic players. 5 seeds (1, 2, 3, 4, 5), 90 days, 126 accounts per seed. Mean ±sample sd (min–max) across seeds.

| Metric (denominator) | 1002 | 1003B | 1003A5 | 1003B5 | 1003B3 | 1003C5 |
|---|---|---|---|---|---|---|
| blocked pushes on others' ground (honest pushes on ground another walker held (pass-through + contested + flips + hard refusals)) | 50.8% ±1.4 (49.6–52.7) | 0.3% ±0.1 (0.2–0.5) | 5.0% ±0.6 (4.3–5.7) | 2.8% ±0.3 (2.4–3.3) | 5.1% ±0.4 (4.6–5.6) | 5.5% ±0.4 (5.1–6.0) |
| walker-days with a blocked push (honest active walker-days) | 56.1% ±3.9 (51.5–61.7) | 1.6% ±0.3 (1.2–2.1) | 18.1% ±1.1 (16.6–19.7) | 13.1% ±0.9 (12.1–14.2) | 23.8% ±1.1 (22.7–25.1) | 22.0% ±0.7 (21.2–23.1) |
| walker-days with a blocked push: commuters (commuter active walker-days) | 49.1% ±6.6 (39.6–55.9) | 0.5% ±0.2 (0.2–0.7) | 9.1% ±2.1 (6.4–11.4) | 8.5% ±2.1 (5.4–10.5) | 17.7% ±3.8 (12.0–21.4) | 13.1% ±2.4 (9.6–16.2) |
| walker-days with a blocked push: runners (runner active walker-days) | 99.3% ±0.6 (98.7–100.0) | 1.5% ±0.6 (0.8–2.4) | 55.1% ±6.1 (46.7–62.5) | 24.1% ±2.7 (21.2–28.1) | 42.1% ±3.3 (38.6–45.7) | 69.2% ±2.4 (65.7–71.7) |
| walker-days with a blocked push: long-distance walkers (long active walker-days) | 99.8% ±0.2 (99.6–100.0) | 2.4% ±0.7 (1.7–3.2) | 83.0% ±4.7 (74.9–86.8) | 24.7% ±5.0 (19.1–30.0) | 40.5% ±4.7 (34.5–45.5) | 88.6% ±4.6 (80.4–91.3) |
| walker-days with a blocked push: shared public routes (shared active walker-days) | 76.2% ±34.6 (14.4–93.9) | 5.4% ±3.5 (0.6–8.5) | 19.5% ±6.4 (9.9–24.0) | 20.0% ±6.5 (10.1–25.1) | 30.3% ±7.7 (18.2–36.7) | 21.4% ±7.0 (11.5–28.6) |
| walker-days with a blocked push: households (linked pairs) (household active walker-days) | 83.6% ±5.2 (77.5–91.3) | 1.6% ±0.4 (1.2–2.2) | 16.0% ±1.8 (14.9–19.0) | 13.8% ±1.4 (12.1–16.1) | 27.3% ±1.7 (25.7–29.9) | 21.6% ±1.1 (20.5–22.9) |
| walker-days with a blocked push: public transit riders (transit active walker-days) | 19.0% ±11.7 (1.1–30.9) | 0.1% ±0.1 (0.0–0.2) | 4.7% ±2.0 (2.5–7.8) | 4.7% ±1.8 (2.7–7.3) | 11.0% ±3.4 (6.8–14.0) | 6.8% ±3.1 (3.9–11.9) |
| sessions that claimed or defended (honest accepted sessions) | 83.2% ±1.4 (82.4–85.6) | 76.2% ±1.1 (75.0–77.9) | 81.8% ±1.3 (81.0–84.0) | 81.5% ±1.1 (80.7–83.4) | 83.8% ±1.1 (82.7–85.5) | 81.5% ±0.9 (80.4–82.7) |
| false reviews (2+ candidate) per 1,000 honest accounts (honest accounts) | 104.8 | 104.8 | 104.8 | 104.8 | 104.8 | 104.8 |
| false reviews (3+ candidate) per 1,000 honest accounts (honest accounts) | 28.6 | 28.6 | 28.6 | 28.6 | 28.6 | 28.6 |
| duplicate-device groups flagged (2+) (duplicate groups) | 100% | 100% | 100% | 100% | 100% | 100% |
| adversary flips of honest ground (run total (count)) | 723 ±37 (689–785) | 5745 ±185 (5575–5947) | 3283 ±105 (3184–3407) | 3161 ±103 (3026–3280) | 2252 ±77 (2134–2330) | 2884 ±100 (2790–3023) |
| attack area flipped from honest walkers, km² (run total; flips × unit area) | 10.879 ±0.555 (10.368–11.812) | 86.451 ±2.778 (83.890–89.487) | 49.407 ±1.585 (47.911–51.267) | 47.568 ±1.550 (45.534–49.356) | 33.884 ±1.164 (32.111–35.061) | 43.394 ±1.508 (41.983–45.489) |
| honest flips of honest ground (run total (count)) | 5075 ±250 (4808–5432) | 9723 ±640 (9343–10862) | 7781 ±305 (7414–8080) | 9571 ±390 (9242–10247) | 8461 ±341 (8132–9024) | 9165 ±266 (8778–9507) |
| adversary share of held area at end (units held at end) | 6.1% ±1.3 (4.4–7.5) | 11.8% ±1.2 (10.7–13.1) | 7.6% ±0.9 (6.6–8.5) | 7.9% ±0.7 (7.0–8.6) | 7.0% ±0.6 (6.1–7.7) | 8.4% ±0.9 (7.3–9.4) |
| adversary share of empty-ground claims (all claims) | 7.7% ±0.6 (7.0–8.6) | 6.9% ±0.5 (6.3–7.5) | 7.0% ±0.5 (6.3–7.5) | 6.9% ±0.5 (6.3–7.5) | 6.9% ±0.5 (6.3–7.5) | 31.4% ±2.3 (29.0–34.5) |
| honest empty-ground claims per active walker-day (honest active walker-days) | 0.90 ±0.09 (0.78–1.00) | 0.85 ±0.10 (0.71–0.95) | 0.94 ±0.09 (0.82–1.02) | 0.85 ±0.10 (0.71–0.95) | 0.85 ±0.10 (0.72–0.95) | 1.53 ±0.10 (1.42–1.61) |
| honest share of held area at end (day-N control) (units held at end) | 91.3% ±1.4 (89.2–92.7) | 86.3% ±1.2 (84.5–87.3) | 89.9% ±1.2 (88.1–91.1) | 89.8% ±1.1 (88.4–91.1) | 90.7% ±0.9 (89.8–91.9) | 89.2% ±1.0 (88.1–90.7) |
| honest walkers holding ground at end (honest accounts) | 86.1% ±2.5 (81.9–88.6) | 80.0% ±2.1 (77.1–82.9) | 84.2% ±2.3 (81.0–86.7) | 83.6% ±2.2 (80.0–85.7) | 86.9% ±2.0 (83.8–88.6) | 82.1% ±2.1 (80.0–84.8) |
| top 10% of accounts' share of held area at end (units held at end) | 64.9% ±2.6 (62.2–68.1) | 67.1% ±2.4 (64.2–70.2) | 65.3% ±2.3 (63.1–68.7) | 67.0% ±2.2 (64.9–70.4) | 66.9% ±2.4 (64.8–70.5) | 66.4% ±2.6 (63.8–69.5) |
| adversary flips per adversary active day (adversary active walker-days) | 1.06 ±0.04 (1.02–1.11) | 10.01 ±0.15 (9.85–10.15) | 4.73 ±0.04 (4.69–4.78) | 4.70 ±0.12 (4.50–4.82) | 3.29 ±0.11 (3.10–3.40) | 4.23 ±0.03 (4.18–4.26) |
| adversary credit-eligible events per active day (adversary active walker-days) | 1.44 ±0.03 (1.40–1.48) | 10.33 ±0.16 (10.14–10.51) | 5.10 ±0.06 (5.04–5.18) | 5.03 ±0.12 (4.83–5.14) | 3.62 ±0.11 (3.43–3.71) | 7.88 ±0.25 (7.68–8.15) |
| ring flips per ring active day (ring active walker-days) | 1.49 ±0.08 (1.41–1.58) | 8.32 ±0.32 (7.92–8.66) | 4.42 ±0.10 (4.31–4.53) | 4.40 ±0.13 (4.26–4.57) | 3.05 ±0.09 (2.91–3.16) | 4.74 ±0.06 (4.66–4.82) |
| honest credit-eligible events per active day (honest active walker-days) | 1.93 ±0.10 (1.80–2.07) | 3.49 ±0.14 (3.36–3.70) | 2.88 ±0.12 (2.75–3.01) | 3.07 ±0.11 (2.95–3.21) | 2.73 ±0.10 (2.63–2.86) | 3.83 ±0.12 (3.70–3.95) |
| honest pushes on others: pass-through share (honest pushes on others) | 42.9% ±1.4 (41.0–44.3) | 87.5% ±0.4 (86.8–87.8) | 85.7% ±0.6 (84.8–86.5) | 86.6% ±0.5 (85.9–87.2) | 85.8% ±0.6 (85.1–86.5) | 86.1% ±0.3 (85.8–86.6) |
| honest pushes on others: contested share (honest pushes on others) | 1.4% ±0.0 (1.3–1.4) | 0.1% ±0.0 (0.1–0.2) | 0.2% ±0.0 (0.1–0.2) | 0.1% ±0.0 (0.1–0.1) | 0.1% ±0.0 (0.1–0.1) | 3.1% ±0.2 (2.8–3.4) |
| honest pushes on others: confirmed-flip share (honest pushes on others) | 4.9% ±0.2 (4.8–5.1) | 12.0% ±0.3 (11.8–12.5) | 9.2% ±0.2 (9.0–9.4) | 10.5% ±0.2 (10.3–10.8) | 9.0% ±0.2 (8.8–9.3) | 10.8% ±0.2 (10.6–11.0) |
| one-push rule refusals (independent of budget) (run total (count)) | 16504 ±1309 (14375–17494) | 31311 ±2174 (28927–33626) | 28522 ±2051 (26068–30638) | 28361 ±2037 (25854–30452) | 26981 ±2052 (24387–29127) | 32273 ±2241 (29855–34641) |
| unit-capacity (300) refusals (run total (count)) | 1348 ±256 (937–1564) | 1344 ±256 (932–1557) | 1367 ±254 (959–1586) | 1375 ±253 (968–1597) | 1384 ±254 (978–1614) | 1337 ±258 (920–1554) |
| load: ledger rows per accepted session (accepted sessions) | 34.2 ±0.9 (33.0–35.3) | 34.2 ±0.9 (33.0–35.3) | 34.3 ±0.9 (33.0–35.3) | 34.3 ±0.9 (33.0–35.3) | 34.3 ±0.9 (33.0–35.3) | 34.2 ±0.9 (33.0–35.3) |
| load: unit rows at end (count) | 4199 ±419 (3645–4756) | 4199 ±419 (3645–4756) | 4199 ±419 (3645–4756) | 4199 ±419 (3645–4756) | 4199 ±419 (3645–4756) | 4199 ±419 (3645–4756) |
| load: open challenge marks at end (count) | 599 ±29 (568–633) | 2331 ±103 (2222–2462) | 2353 ±114 (2179–2467) | 2408 ±120 (2218–2502) | 2410 ±151 (2173–2541) | 1876 ±112 (1725–2002) |

## Reading the tables

1. **1002's budget mostly charges honest walkers for incidental movement.**
   - Under 1002, 56% of honest active walker-days hit the 13-take cap. That rises to 99% for runners, 99.8% for long-distance walkers, 84% for households and 76% for walkers on shared public routes.
   - 43% of honest pushes on others' ground are first-contact erosion, and 1002 counts every one of them.
   - Separating the event classes removes almost all of this. Under 1003A, B and C, between 1.6% and 3.6% of honest walker-days are ever blocked.
2. **The same separation removes most of 1002's attack resistance.**
   - Adversaries flip about 10–11 honest units per active day under 1003A, B and C at 13 a day, against 1.06 under 1002 and 13.8 under 1001. Over the run that is about 5,700–6,200 honest units, against 723 under 1002.
   - Under 1002, an attacker's 13 takes run out on the first erosions of a tour. Under 1003 those erosions are free. The attacker returns the next day (20+ hours later), completes the challenges, and is limited only by the 13 counted events, which barely binds.
   - Reduced incidental erosion alone (1003C0, no budget) is the worst of all: 21 adversary flips per active day.
3. **What is counted matters more than how many.**
   - At the same size, deliberate-contest counting (B) blocks honest walkers far less than flip counting (A). At 5 a day, B blocks 13% of honest walker-days against A's 18%, and 25% of long-distance walker-days against A's 83%. Adversaries get the same 4.7 flips per active day under both.
   - The reason is that honest long walks flip a lot of long-unvisited ground at first contact. A counts those flips; B does not.
   - B at 3 a day holds adversaries to 3.3 flips per active day and blocks 24% of honest walker-days. 1002 blocks 56%.
4. **C's soft budget leaks empty ground to attackers.** Under C and C5, adversaries make 28–31% of all empty-ground claims, against about 7% under every other variant.
   - Softened pushes grind honest units down towards 1.
   - Those units then decay back onto the map.
   - The attackers pass by daily and claim them.
   - As designed, the soft mode turns blocked takes into deferred claims.
5. **Honest-on-honest churn rises.** Honest walkers flip each other about 1.5–2× as often under 1003 as under 1002: 7,700–10,700 against 5,100 per run. At the end, 80% of honest walkers hold ground, against 86% under 1002. 1001 is far worse on every churn measure: 14.5% of honest walkers hold ground at the end.
6. **Reviews do not depend on the budget.** The #123 candidate reads walks, not holdings, so it gives the same answer under every rule set:
   - The 2+ rule flags every household and sibling group: 11 groups, or 104.8 reviews per 1,000 honest accounts. All of them are false by construction.
   - The 3+ rule flags only the sibling trios: 28.6 per 1,000.
   - It flags 100% of the two-device duplicates.
   - It never flags the unlinked collusion ring.
   - Linkage remains an appeal burden on honest groups and misses the coordinated attacker. **No sanction is implied or approved.**
7. **Load proxy.**
   - Ledger rows per accepted session (34.2) and unit rows at the end (about 4,200 per seed) are identical for 1002 and every 1003 variant, because the same pushes are written.
   - Open challenge marks at the end are 3–4× 1002's: about 2,300 against 600 per seed, because first-contact erosion is no longer refused. That is small.
   - 1003 needs no new table. The daily counter counts a different class, and that class is decided from unit state the ledger already locks.
   - 1001 writes far fewer rows (4.6 per session) because its units are 49× larger.
8. **The one-push rule is untouched.** It refuses 16,500 pushes per run under 1002 and 27,000–35,500 under 1003. The count is larger under 1003 because more honest ground stays held by others to be pushed again. It never consumes a budget.

## Candidate recommendation (SIMULATION ONLY, hypothesis, credits-only)

- **Drop 1003A, 1003C and 1003C0.**
  - A still charges long walkers for flips of decayed ground at first contact.
  - C's soft budget hands empty ground to attackers.
  - C0 has no attack limit.
- **Carry forward 1003B (count only deliberate return pushes on one's own open challenge) with a small daily budget of 3 to 5.** Keep 1002's challenge, 20-hour gap, units and the fixed one-push rule unchanged. On these synthetic seeds:
  - At 5 a day it blocks 13% of honest walker-days (1002: 56%) and holds adversaries to 4.7 flips per active day (1002: 1.06; 1001: 13.8).
  - At 3 a day the figures are 24% and 3.3.
- **No 1003 variant matches 1002's attack resistance.** Choosing between fewer blocked honest walks and more attacker flips is an economic rule decision, so it goes to the owner. This experiment does not make it. 1001 stays the default.
- **Next experiments** (not run here):
  - In B, count first-contact flips of long-unvisited ground as a separate small class.
  - Cap credit-eligible reward events (credits only) independently of territory. Adversary reward events track their flips almost one-for-one.
  - Rerun with the §5 vehicle-segment exclusion and the receipt-cutoff work once those land.

## What this cannot tell us

- No player reacts. Activity is an input, identical under every rule set, so nothing here measures retention.
- The town (4 × 4 km, uniform homes), the cohort sizes, the attack strategies and the GPS models are assumptions. A real attacker would adapt to whichever counting rule ships. The repeat-next-day tour used here is the obvious adaptation to the challenge rule.
- The bus leg is assumed to pass verification. The drift sessions are assumed to verify. The §5 vehicle exclusion and the §7 receipt cutoff are other workers' areas and are not modelled.
- Spread is across 5 seeds of one population model, so it reflects seed variability only, not model uncertainty.
- The review candidate's 5% reviewer error and its walking-together test come from #123's assumptions.
- Credits, upkeep, clubs, shade, deeds and masks are not exercised.
- Code: `backend/src/gameplay/experiments/` (`rules1003.ts`, `ledger1003.ts`, `population1003.ts`, `harness1003.ts`), the script `backend/scripts/experiment-1003.ts`, and the tests in `backend/src/gameplay/experiment1003.test.ts`.
  - `fairness.ts` gains only exports and an optional trace speed. The 1001 vs 1002 study output is byte-identical with and without the change.
  - No rule set, migration, `rules.ts`, `service.ts` or settlement code changed.

> **Note, 29 October 2026.** The 1002 figures in this document and in the committed CSVs under `docs/sim/1003` and `docs/sim/after-authoritative` were produced by code that predates the fix to the receipt time of a restarted challenge. A re-run with the fix changes 1002 rows only (for example blocked honest pushes 41000 / 81012 become 41003 / 81015 on 2 seeds x 30 days); 1001 and 1003 rows are identical. The 1002 figures have not been regenerated and differ slightly from a fresh run. No CSV was edited. `backend/src/gameplay/experiments/ledger1003.ts` (around lines 106 and 115) still keeps a stale opening time for restarted challenges; that is tracked separately and affects the simulation only.
