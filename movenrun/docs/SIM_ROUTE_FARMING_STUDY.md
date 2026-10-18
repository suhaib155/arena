# Route-farming study

> **SIMULATION. Synthetic populations, not real users. Nothing here is final.** Every number comes from synthetic accounts on a synthetic grid with assumed behaviour. Every rule is a named, versioned, simulation-only config that can be reversed. No V3 source constant or default is changed: the minimum session is still SOURCE §2's 10 minutes and 750 m, and economy rules version 1, `sim-pilot-1` and `sim-pilot-2` are unchanged (their fingerprints `30d570be`, `e7214e5`, `e0073617` still reproduce). The final threshold, and whether to adopt any rule, is the owner's decision.

- Code: `shared/src/sim/routeCredit.ts` (the fingerprint, the rules, `settleRouteDay`) and `shared/src/sim/routeFarmingStudy.ts` (populations, the season run, tables). Tests: `shared/src/sim/__tests__/routeFarming.test.ts`.
- Reproduce: `yarn workspace @movenrun/shared sim --route-farming --seeds 1,2,3,4,5`. It takes about 3 minutes. `--json out.json` writes every run.
- Every number is the mean over seeds 1–5, with the min–max in brackets where the seeds differ.
- Tags: **SOURCE §n** (V3 source), **PILOT** (proposed here), **ASSUMPTION** (synthetic behaviour, not a rule).

## The question and the owner's guidance

`SIM_PILOT_RULESET.md` found route farmers finishing with the most credits, and `sim-pilot-1` carried a candidate `repeat-route-unscored-3`. The churn study left route farming as an open owner decision. The owner's guidance for this study:

- **Do not raise the minimum session duration or distance.** Honest people repeat routes: commutes, accessible loops, laps.
- **Count verified movement; throttle only exploitable reward.** A rule may change credits. It must not invalidate the GPS proof, XP, streaks, achievements or territory movement.
- No retroactive revocation of credits.

## What a rule may touch

A rule's only output is a credit amount per session. `settleRouteDay` settles the day through the V3 reference model (`settleDay`, unchanged), then applies the rule to the session rewards. Everything withheld goes back to the season pool, the way V3 treats withheld trust weight ("the difference stays in the pool", ASSUMPTION A6). The sessions themselves (minutes, metres, stepped units) go on to the holding ledger, XP, streaks and achievements unchanged. Tests check this for every rule:

- Territory: the holding ledger (`applyLedger`, sim-pilot-2 holding rules, 76 m units) gives identical final states and identical claimed / reinforced / eroded / flipped counts.
- XP, streaks and achievements are identical. These are simulator tallies, because the reference models have no XP (ASSUMPTION): 1 XP per verified minute, the active-day streak, and achievements at 10/50/100/250 km and 7- and 30-day streaks.
- A rule only acts on the day being settled. A 10-day run and the first 10 days of a 20-day run settle the same credits, so nothing earlier is ever revoked.
- Books: every day, credited + returned = pool, and the rule never credits more than V3 minted.

## The route fingerprint (privacy)

Comparators 3–5 never see a raw trajectory. Each session is reduced to a **coarse private route fingerprint**: a 32-slot MinHash signature over the **set** of coarse parent zones its stepped units fall in. A zone is 201 m, about the H3 resolution 9 scale, using the same coarse hexes as the churn study's D5 zones. They are close to H3 parents but are not H3 parents.

- It keeps no order, no timestamps, no GPS points, no unit or zone ids, and no direction. A route and its reverse look the same.
- It is salted per season (`sim-season-1`), so signatures cannot be compared across seasons or looked up from a known place.
- Two sessions "match" when their estimated Jaccard similarity is at least 0.8 (PILOT; 0.6 is shown too). Signatures are deleted after 14 days (PILOT).
- At 201 m, GPS jitter of 10–35 m rarely changes the zone set, so a jittered repeat still matches. This is deliberate.

Comparator 2 is the exception. As defined in sim-pilot-1, it compares **exact stepped units**, so it must keep each walker's unit sets for the last three qualifying days. That is more location data than the fingerprint, and it is one of that rule's costs.

## The comparators

All of them run on the same seeds, accounts, routes, GPS noise, trust weights and pool.

| # | Rule (name, version 1) | What it does |
|---|---|---|
| 1 | `sim-route-baseline` | No repeat-route adjustment. This is V3 as it stands. |
| 2 | `sim-route-repeat-route-unscored-3` | The sim-pilot-1 candidate. A session is settled **unscored** (SOURCE §8: no tokens, still ground, streak and XP) when every unit it stepped on was stepped on, by the same walker, on each of their 3 previous qualifying days. Qualifying days are days with a session that meets §2's minimum. The churn study used calendar days; for walkers active every day the two readings are the same. Because the session is unscored *before* settlement, V3 may score a third session in its place. |
| 3 | `sim-route-taper-{14,10,6}` | **Gradually decreasing marginal credits** on highly repeated routes. Suppose a scoring session matches *n* of the same walker's scoring sessions in the trailing 7 days, today included. If *n* is below the free threshold (14, 10 or 6), it earns its V3 reward. Above it, it earns the reward × max(0.25, 1 − 0.15 × (n + 1 − threshold)). It never reaches zero and is never unscored. |
| 4 | `sim-route-identical-daily-bound` | **A bound on identical daily sessions.** One walker's matching sessions on one day together earn at most V3's session ceiling (12 credits), trimmed in proportion. Every session still counts for streaks and achievements. |
| 5 | `sim-route-linked-identical-as-one` (and `-0.6`) | Accounts linked to each other in the risk graph (V3's `linkedPlayerIds`) may have matching sessions on one day. Together, those sessions earn what the best-paid of them earned for that route alone, split in proportion. **A single account is never changed.** This rule was added to the four requested because the results below point to it. |

## Populations (ASSUMPTION)

Accounts per seed: 195 in all. Each population has the same trust weight under every rule. The trust weight is 1, except for spoofers (0.5), which stands for imperfect risk signals.

| Population | Accounts | Behaviour |
|---|---|---|
| commuter | 30 | Weekdays (92%): there and back on the same L-shaped street route, 1.8–3.2 km each way, 80 m/min. Weekends (35%): one random 0.9 km-radius loop. |
| rural | 20 | Sparse road network. One out-and-back on the only road, 4–6 km, 85% of days. 80% of walks go the main direction, 20% the other way. GPS noise 8 m. |
| low_mobility | 20 | The same ~800 m loop round the block at 60 m/min (13–14 min). It meets §2. Twice a day on 72% of days, once on 18%. |
| laps_runner | 20 | Eleven laps of a 400 m track, 4.4 km at 200 m/min. 75% of weekdays, 50% of weekends. One run in five is a road loop instead. |
| park_walker | 25 | Random 2–4 km loops inside the same park, 70% of days, sometimes twice. |
| gps_jitter | 20 | The same dog-walk loop every day, but with 35 m GPS noise, so the stepped units differ a little each time. |
| household | 20 (10 linked pairs) | Two real people whose accounts are linked. On 70% of days they walk together, and each records the same walk with their own noise. On 30% of days they walk apart. 60% of days. |
| route_farmer | 15 | The minimum qualifying loop (780 m, 10.8 min) three times a day, 98% of days. |
| spoofer | 10 | A replayed trace, three times a day, every day. Half replay it exactly. Half shift each replay by up to 80 m and add 10 m noise to dodge exact matching. Trust weight 0.5. |
| colluder | 15 (5 linked triples) | One walker carries three linked phones. Two varied loops a day, 90% of days, each phone with its own GPS noise. |

Two pool regimes: **launch** uses V3's season-one daily pool (100,000 credits). With 195 accounts, every scoring session hits the 12 / 20 ceilings, as in every earlier study. **Binding** scales the pool to 8 credits per account per day, as if far more players shared it, so the pool split and the trust weight bite.

## Results: launch pool (V3's pool, ceilings bind)

### Summary

"Honest penalised" is the share of all 155 honest accounts that earn at least 1% less over the season than under the baseline. "Advantage" is season credits per *physical walker* ÷ credits per honest walker. A colluder's three phones count as one walker.

| # | Rule | Honest penalised | Farmer advantage × | Spoofer advantage × | Colluder advantage × (per walker) | Territory unchanged | XP / streak / achievements unchanged | Books |
|---|---|---|---|---|---|---|---|---|
| 1 | baseline | 0.0% | 1.73 (1.71–1.74) | 1.44 (1.24–1.59) | 4.75 (4.70–4.83) | yes | yes | ok |
| 2 | repeat-route-unscored-3 | **65.0% (63.2%–67.7%)** | 0.64 (0.53–0.74) | 0.90 (0.68–1.11) | 6.24 (6.15–6.29) | yes | yes | ok |
| 3 | taper-14 | 0.0% | 1.73 (1.71–1.74) | 1.44 (1.24–1.59) | 4.75 (4.70–4.83) | yes | yes | ok |
| 3 | taper-10 | 13.3% (10.3%–14.8%) | 1.13 (1.00–1.18) | 1.05 (0.92–1.26) | 4.91 (4.86–4.98) | yes | yes | ok |
| 3 | taper-6 | 49.9% (47.7%–52.9%) | 0.79 (0.64–0.89) | 0.92 (0.75–1.18) | 6.04 (5.98–6.14) | yes | yes | ok |
| 4 | identical-daily-bound | 49.4% (48.4%–51.0%) | 1.32 (1.26–1.35) | 1.21 (1.07–1.42) | 5.66 (5.59–5.73) | yes | yes | ok |
| 5 | linked-identical-as-one | 12.9% (households only) | 1.77 (1.76–1.79) | 1.48 (1.27–1.64) | **1.74 (1.71–1.78)** | yes | yes | ok |
| 5 | linked-identical-as-one-0.6 | 12.9% (households only) | 1.78 (1.76–1.79) | 1.49 (1.27–1.64) | 1.65 (1.64–1.67) | yes | yes | ok |

### Credits earned, % of baseline, by population

| # | Rule | commuter | rural | low_mobility | laps_runner | park_walker | gps_jitter | household | route_farmer | spoofer | colluder |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | repeat-route-unscored-3 | 73% (68–77) | 95% (94–96) | **32% (26–42)** | 66% (62–70) | 100% | 96% (95–98) | 100% | 28% (23–33) | 47% (37–54) | 100% |
| 3 | taper-14 | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | 100% |
| 3 | taper-10 | 100% | 100% | 83% (82–85) | 100% | 100% | 100% (99–100) | 100% | 63% (56–66) | 70% (63–76) | 100% |
| 3 | taper-6 | 65% (64–67) | 99% | 44% (41–51) | 100% | 100% | 86% (84–87) | 100% | 36% (30–40) | 50% (42–58) | 100% |
| 4 | identical-daily-bound | 65% (64–66) | 100% | 68% (67–70) | 100% | 99% | 88% (87–89) | 100% | 64% (61–65) | 70% (66–74) | 99% (99–100) |
| 5 | linked-identical-as-one | 100% | 100% | 100% | 100% | 100% | 100% | 67% (66–69) | 100% | 100% | **36% (35–36)** |
| 5 | linked-identical-as-one-0.6 | 100% | 100% | 100% | 100% | 100% | 100% | 64% (63–66) | 100% | 100% | 34% (34) |

Baseline season credits per account: commuter 1,307 (1,297–1,315), rural 915 (898–937), low_mobility 1,499 (1,490–1,516), laps_runner 735 (717–748), park_walker 852 (838–870), gps_jitter 1,105 (1,091–1,128), household 637 (617–655), route_farmer 1,764 (1,756–1,773), spoofer 1,476 (1,260–1,620), colluder 1,618 (1,596–1,640) per account, which is 4,854 per walker.

### Honest accounts penalised (at least 1% below baseline), by population

| # | Rule | commuter | rural | low_mobility | laps_runner | park_walker | gps_jitter | household |
|---|---|---|---|---|---|---|---|---|
| 2 | repeat-route-unscored-3 | 90% (83–97) | 89% (80–100) | 100% | 100% | 0% | 80% (70–95) | 0% |
| 3 | taper-14 | 0% | 0% | 0% | 0% | 0% | 0% | 0% |
| 3 | taper-10 | 0% | 0% | 93% (80–100) | 0% | 0% | 10% (0–20) | 0% |
| 3 | taper-6 | 100% | 46% (35–55) | 100% | 6% (0–15) | 0% | 85% (80–90) | 0% |
| 4 | identical-daily-bound | 100% | 0% | 100% | 0% | 26% (20–36) | 100% | 0% |
| 5 | linked-identical-as-one | 0% | 0% | 0% | 0% | 0% | 0% | 100% |

Comparator 2 settled as unscored 80% of farmer sessions. It also unscored 70% of low-mobility sessions, 34% of laps sessions and 29% of commuter sessions. Only 47% of spoofer sessions were unscored, because the evading half never matches exactly. Under comparator 2, the 35 m-jitter walkers earn 96%, so exact matching is decided by GPS noise, not by behaviour.

## Results: binding pool (8 credits per account per day)

| # | Rule | Honest penalised | Farmer advantage × | Spoofer advantage × | Colluder advantage × (per walker) |
|---|---|---|---|---|---|
| 1 | baseline | 0.0% | 1.28 (1.27–1.29) | 0.58 (0.50–0.63) | 6.15 (6.07–6.28) |
| 2 | repeat-route-unscored-3 | 32.4% (29.7%–34.2%) | 0.44 (0.36–0.50) | 0.36 (0.28–0.45) | 7.30 (7.24–7.37) |
| 3 | taper-10 | 13.3% (10.3%–14.8%) | 0.83 (0.74–0.87) | 0.42 (0.37–0.50) | 6.31 (6.24–6.43) |
| 3 | taper-6 | 50.5% (47.7%–53.5%) | 0.58 (0.47–0.65) | 0.37 (0.31–0.47) | 7.79 (7.73–7.91) |
| 4 | identical-daily-bound | 42.6% (40.6%–45.8%) | 1.36 (1.35–1.37) | 0.62 (0.53–0.68) | 6.52 (6.44–6.67) |
| 5 | linked-identical-as-one | 12.9% (households only) | 1.31 (1.30–1.32) | 0.60 (0.51–0.65) | **2.24 (2.20–2.31)** |

Under comparator 2 with a binding pool, unscored sessions drop out of the day's points, so everyone else's share of the pool rises. Park walkers get +33%, households +34%, and colluders +19%. The rule moves credits from repeat walkers to everyone else. It does not only remove the farmers' credits. Comparator 4's bound is V3's session ceiling, so it does almost nothing once sessions earn less than the ceiling: route farmers keep 100%. Taper-14 is identical to the baseline in both regimes and is left out of this table.

## What the numbers say

1. **Repetition does not separate farmers from honest people.** The low-mobility user's two loops round the block meet the §2 minimum, just as the farmer's do. Over a season the low-mobility user earns 1,499 credits against the farmer's 1,764, and 44.3 credits per verified hour against the farmer's 37.0. Every per-account repetition rule cuts the two together. `repeat-route-unscored-3` leaves farmers with 28% and low-mobility users with 32%. Taper-10 leaves farmers with 63% and low-mobility users with 83%. The identical-daily bound leaves farmers with 64%, low-mobility users with 68% and commuters with 65%, because there and back is one route to a fingerprint that has no direction.
2. **`repeat-route-unscored-3` should be dropped.** It penalises 65% of honest accounts: every laps runner and low-mobility walker, 90% of commuters and 89% of rural walkers. An 80 m shift dodges it, so half the spoofers kept earning. It needs exact unit sets, which is more location data than the other rules keep. Under a binding pool it also passes the removed credits on to other players, colluders included (+19%).
3. **V3 already bounds repetition by one account.** At most two sessions a day score (SOURCE §17), within the 12 and 20 ceilings. So a taper that spares two matching sessions a day (taper-14) never fires, for farmers or anyone else. The farmers' remaining 1.73× comes from walking every day with two qualifying sessions. That is also what a dedicated honest walker does, so it is not something a route can show.
4. **The only reward that comes from the route itself is several accounts on one walk.** One person carrying three linked phones earns 4.75× an honest walker, or 6.15× when the pool binds. `linked-identical-as-one` takes that to 1.74× (2.24× binding). The remainder is one walker's daily diligence, as in point 3. It changes no single-account population at all: 0% penalised across commuters, rural, low-mobility, laps, park and jitter walkers. Its only false positives are linked accounts that really do walk together. The household pairs lose 33% (31–34%), on the assumption that they walk together 70% of the time and the risk graph links them. Similarity 0.6 adds almost nothing beyond 0.8.
5. **Spoofing is not a route problem, and the trust weight does not act while ceilings bind.** Under ASSUMPTION A6, the trust weight scales a session's share of the pool *before* the session ceiling. At launch scale that share is far above 12 credits, so a 0.5 trust weight withheld nothing: spoofers kept 1.44×. Once the pool binds, they fall to 0.58×. Route rules catch spoofers only as far as the spoofers repeat themselves, and the evading half shows how easily that is avoided. Spoofing belongs to provenance and the risk graph, not to the route rule.
6. **No rule touched territory, XP, streaks or achievements**, in any seed or either regime. Every day's books balanced, and no earlier day's credits changed.

## Recommendation (PILOT; the owner decides)

**The simplest rule the evidence supports is `sim-route-linked-identical-as-one`, plus no per-account repeat rule.**

- **Single accounts: no repeat-route credit rule.** Every per-account rule tested costs honest repeat walkers about as much as it costs farmers. V3's two scoring sessions and the 12/20 ceilings are already the per-account bound. Drop the `repeat-route-unscored-3` candidate.
- **Linked accounts: "linked accounts' matching sessions on the same day earn as one account."** It is one sentence. It never changes a single account, never unscores, and needs only the salted parent-zone fingerprint. It removes the one route-based multiplier the study found.
- **Owner decisions:**
  1. Whether to adopt it at all.
  2. The match threshold: 0.8 is proposed, and 0.6 behaves almost the same.
  3. What links two accounts. Do households who really walk together count? If they do, they lose about a third of their credits on shared walks. If the owner wants them exempt, a declared-household exemption is the obvious variant, but it is not simulated here.
  4. Fingerprint retention: 14 days is proposed. The linked rule itself needs only the same day.
- **A separate question this study raises, not a route rule:** under A6 the trust weight cannot reduce a spoofer's credits while the ceilings bind. Whether the trust weight should apply after the ceilings is a V3 reading (A6) for the owner. It is not changed here.
- The rule applies from the day it is adopted. It never revokes credits already settled.

## Limits

- The populations, their routes, their activity and the household and colluder link structure are assumptions. Real repeat rates and real GPS noise will differ. The false-positive rates here describe these synthetic walkers, not real ones.
- Routes are polylines on a synthetic hex grid with Gaussian GPS noise. There are no real road networks, no H3 cells and no real GPS traces.
- XP, streaks and achievements are simulator tallies. Credits are V3's `settleDay` with no tolls, upkeep or kit charge, and with kit level 1.
- The season simulator (`simulate.ts`) is not wired to these rules. Spending credits on levels could change ground indirectly, and that is out of scope here.
- Thresholds were compared at a few settings: free repeats 14/10/6 and similarities 0.8/0.6. A finer sweep should wait for real session data.

## Second round: less punitive alternatives and the A6 trust order

> **SIMULATION ONLY.** Synthetic populations with assumed behaviour, an assumed risk-graph link structure and an assumed reviewer. This is not fraud-detection proof. Nothing here is adopted. The rule candidate below is a proposal for the owner to decide.

The owner's constraints for this round:
- The minimum qualifying session stays at SOURCE §2's 10 minutes and 750 m (tests assert `minSessionMinutes = 10` and `minSessionMeters = 750`).
- Repeated daily routes stay fully valid for territory, XP, streaks and achievements. A rule may only change the session's share of the credits pool.
- Commuters, repeated exercise loops and short accessible loops must be protected.

Every first-round table above still reproduces exactly. The new populations are added after the first-round ones under new keys, so the first-round accounts and draws are unchanged. A diff of `sim --route-farming` output before and after this change is empty.

- Reproduce: `yarn workspace @movenrun/shared sim --route-alternatives --seeds 1,2,3,4,5,6,7,8,9,10` (about 18 minutes; `--territory` also runs the holding ledger; `--json out.json` writes every run).
- Numbers are **mean ± 95% confidence half-width [min–max] over 10 seeds**. The seed is the unit of replication, with a Student t interval on 9 degrees of freedom. A missing ± means every seed gave the same value. The interval covers seed-to-seed variation of *this synthetic model* only. It says nothing about how well the model matches real players.

### Populations added (ASSUMPTION)

The second-round population is the first round's 195 accounts plus 68 more, 263 in all. Honest accounts are grouped the way the owner asked:

| Group | Populations |
|---|---|
| commuters | commuter |
| loop walkers | laps_runner, park_walker, gps_jitter, **exercise_loop** (the same ~3 km neighbourhood loop on 80% of days, twice on one day in four) |
| accessible loops | low_mobility, **accessible_loop** (a step-free 760–800 m loop at 55 m/min, wheelchair or limited mobility; 1–3 times a day on 90% of days, just over §2's minimum) |
| households | household (linked pairs), **family** (linked trios that walk together on 60% of days; on other days each may walk the usual loop alone at their own time) |
| rural | rural |

There is one new exploit population: **colluder_pair**, one walker carrying two linked phones (5 pairs). This is the gap that any household allowance of two leaves open.

Every session now also carries a start minute, which comes from its own random stream so earlier draws are unchanged. A group planned together shares a start, with ±3 minutes per phone. Only the "walking together" cluster rules read it.

### Variants

All of these are `sim-route-*`, version 1, simulation only and frozen. All of them change credits only.

| # | Variant | Rule |
|---|---|---|
| 3 | `taper-10` / `taper-12` / `taper-14` | The first round's per-account taper, with a high free-repeat threshold N per week. |
| A | `soft-ceiling-100w` | **Diminishing returns only above a per-account soft ceiling.** The first 100 credits in a rolling 7 days are paid in full. Anything above is paid at 50%. There is no route test, and it keeps no location data (amounts only). |
| 5 | `linked-identical-as-one` | The first round's recommendation: linked accounts' matching sessions on one day earn as one. |
| B | `cluster-together-k1/k2/k3` | **Cluster-level cap.** Linked accounts whose sessions match (similarity ≥ 0.8) *and start within 20 minutes* form a cluster. The **household allowance** k sets how many co-walkers keep full credits. A larger cluster earns what its k best-paid accounts earned, trimmed in proportion. A single account is never changed. |
| C | `review-flag-2plus` / `-3plus` | **Appealable review flags instead of automatic penalties.** A linked group with more than 1 (or 2) accounts walking together on 4 days in 14 opens a review. Credits are untouched while the review is open. If a reviewer upholds it, the group's clusters earn as one from 3 days after the flag. Nothing already settled changes. A group the reviewer clears is not flagged again for 90 days. Without that exemption a real household is re-reviewed every 14 days, so the 5% reviewer error compounds. In a 2-seed trial run without the exemption, 28.9% of household and family accounts were penalised, against 7.4% with it. |
| T | `trust-after-ceiling` and spoofer trust 0.25 / 0.75 | The A6 order (below). |
| ★ | `candidate-review2-trust-after` | C with 2+ accounts, plus trust after the ceilings. |
| ★ | `candidate-review3-trust-after` | The same, but pairs are never flagged. |
| ★ | `k2-review3-trust-after` | Automatic household allowance 2, plus review for 3+, plus trust after the ceilings. |

**Reviewer model (ASSUMPTION, not measured):** a reviewer upholds 90% of flags on a group that really is one walker carrying several phones. They wrongly uphold 5% of flags on real people walking together. Each decision is seeded and deterministic.

### Results: launch pool (V3's pool, ceilings bind)

"Penalised" means earning at least 1% less over the season than the baseline does. "×" is season credits per *physical walker* ÷ credits per honest walker. In this population, honest walkers average more than in round one, so the baseline multipliers differ slightly from the first-round table.

| # | Variant | Honest penalised | Commuters | Loop walkers | Accessible loops | Households penalised | Household credits vs baseline | Colluder trio × | Colluder pair × | Spoofer × | Farmer × | Honest flagged | Colluders upheld | Reviews / 1,000 accounts |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | baseline | 0.0% | 0% | 0% | 0% | 0% | 100% | 4.68 ± 0.06 | 3.13 ± 0.03 | 1.41 ± 0.11 | 1.70 ± 0.01 | 0% | – | 0 |
| 3 | taper-10 | 19.5% ± 0.5 | 0% | 4.5% ± 1.2 | **94.5% ± 2.9** | 0% | 100% | 4.92 ± 0.06 | 3.29 ± 0.03 | 1.09 ± 0.11 | 1.11 ± 0.05 | 0% | – | 0 |
| 3 | taper-12 | 15.3% ± 0.7 | 0% | 0% | **81.3% ± 3.7** | 0% | 100% | 4.73 ± 0.06 | 3.16 ± 0.03 | 1.27 ± 0.11 | 1.47 ± 0.02 | 0% | – | 0 |
| 3 | taper-14 | 0.0% | 0% | 0% | 0% | 0% | 100% | 4.68 ± 0.06 | 3.13 ± 0.03 | 1.41 ± 0.11 | 1.70 ± 0.01 | 0% | – | 0 |
| A | soft-ceiling-100w | **47.5% ± 1.1** | **100%** | 36.6% ± 2.7 | **100%** | 0% | 100% | 4.02 ± 0.03 | 2.68 ± 0.01 | 1.13 ± 0.09 | 1.39 ± 0.00 | 0% | – | 0 |
| 5 | linked-identical-as-one | 17.8% ± 0.0 | 0% | 0% | 0% | **100%** | 57.8% ± 1.1 | 1.75 ± 0.03 | 1.71 ± 0.02 | 1.48 ± 0.12 | 1.79 ± 0.01 | 0% | – | 0 |
| B | cluster-together-k1 | 17.8% ± 0.0 | 0% | 0% | 0% | **100%** | 62.9% ± 1.1 | 1.73 ± 0.03 | 1.70 ± 0.02 | 1.47 ± 0.11 | 1.78 ± 0.01 | 0% | – | 0 |
| B | cluster-together-k2 | 8.5% | 0% | 0% | 0% | 47.4% (all families) | 90.8% ± 0.6 | 3.25 ± 0.05 | **3.17 ± 0.03** | 1.42 ± 0.11 | 1.72 ± 0.01 | 0% | – | 0 |
| B | cluster-together-k3 | 0.0% | 0% | 0% | 0% | 0% | 100% | 4.68 ± 0.06 | 3.13 ± 0.03 | 1.41 ± 0.11 | 1.70 ± 0.01 | 0% | – | 0 |
| C | review-flag-2plus | 1.3% ± 0.8 | 0% | 0% | 0% | 7.4% ± 4.3 | 97.6% ± 1.6 | 2.11 ± 0.21 | 1.91 ± 0.20 | 1.41 ± 0.11 | 1.71 ± 0.01 | 17.8% | 90% ± 8 | 98.9 |
| C | review-flag-3plus | 0.4% ± 0.7 | 0% | 0% | 0% | 2.4% ± 3.8 | 99.1% ± 1.5 | 2.11 ± 0.21 | **3.14 ± 0.03** | 1.41 ± 0.11 | 1.71 ± 0.00 | 8.5% | 55% ± 4 | 41.8 |
| T | trust-after-ceiling | 0.0% | 0% | 0% | 0% | 0% | 100% | 4.68 ± 0.06 | 3.13 ± 0.03 | **0.70 ± 0.05** | 1.70 ± 0.01 | 0% | – | 0 |
| ★ | **candidate-review2-trust-after** | **1.3% ± 0.8** [0–3.8%] | **0%** | **0%** | **0%** | 7.4% ± 4.3 [0–21%] | 97.6% ± 1.6 | **2.11 ± 0.21** | **1.91 ± 0.20** | **0.71 ± 0.06** | 1.71 ± 0.01 | 17.8% | 90% ± 8 | 98.9 |
| ★ | candidate-review3-trust-after | 0.4% ± 0.7 | 0% | 0% | 0% | 2.4% ± 3.8 | 99.1% ± 1.5 | 2.11 ± 0.21 | 3.14 ± 0.03 | 0.71 ± 0.05 | 1.71 ± 0.00 | 8.5% | 55% ± 4 | 41.8 |
| ★ | k2-review3-trust-after | 8.5% | 0% | 0% | 0% | 47.4% | 90.3% ± 1.0 | 1.91 ± 0.11 | 3.17 ± 0.03 | 0.71 ± 0.06 | 1.72 ± 0.00 | 8.5% | 55% ± 4 | 41.8 |

In every variant and every seed, in both regimes, movement (XP, streaks, achievements) was identical to the baseline. Every day's books closed exactly: `dayBooksProblems` came back empty, credited + returned = pool, no session was paid more than V3 minted for it, and no session or day went over its ceiling. Territory is checked by the tests (identical holding-ledger states for every second-round rule in both regimes). The 10-seed CLI run leaves the ledger off for speed.

Per population (launch, % of baseline credits):
- taper-10 leaves `low_mobility` at 82% and `accessible_loop` at 83%.
- taper-12 leaves them at 96% and 97%, and farmers at 86%.
- soft-ceiling-100w leaves commuters at 94%, `low_mobility` and `accessible_loop` at 85%, and farmers at 77%.
- Under linked-as-one, families keep 48% and households 67%. Under k2, families keep 81% and households 100%.

### Results: binding pool (8 credits per account per day)

| # | Variant | Honest penalised | Households vs baseline | Colluder trio × | Colluder pair × | Spoofer × | Farmer × |
|---|---|---|---|---|---|---|---|
| 1 | baseline | 0.0% | 100% | 6.29 ± 0.10 | 4.22 ± 0.05 | 0.59 ± 0.04 | 1.30 ± 0.01 |
| 3 | taper-12 | 15.4% ± 0.7 | 100% | 6.34 ± 0.10 | 4.25 ± 0.05 | 0.53 ± 0.04 | 1.12 ± 0.02 |
| A | soft-ceiling-100w | 2.0% ± 0.9 (commuters 14% ± 6) | 100% | 5.76 ± 0.07 | 3.86 ± 0.03 | 0.59 ± 0.04 | 1.30 ± 0.01 |
| B | cluster-together-k2 | 8.5% | 91.0% ± 0.6 | 4.36 ± 0.08 | 4.26 ± 0.05 | 0.59 ± 0.04 | 1.31 ± 0.01 |
| C | review-flag-2plus | 1.3% ± 0.8 | 97.6% ± 1.6 | 2.82 ± 0.29 | 2.56 ± 0.27 | 0.59 ± 0.04 | 1.31 ± 0.01 |
| T | trust-after-ceiling | 0.0% | 100% | 6.29 ± 0.10 | 4.22 ± 0.05 | 0.59 ± 0.04 | 1.30 ± 0.01 |
| ★ | candidate-review2-trust-after | 1.3% ± 0.8 | 97.6% ± 1.6 | 2.82 ± 0.29 | 2.56 ± 0.27 | 0.59 ± 0.04 | 1.31 ± 0.01 |

In the binding regime the two trust orders give identical results, as expected: no ceiling binds, so the order cannot matter. In the "spoofer trust 0.75" sensitivity run, spoofers show 150% of baseline because the baseline weight is 0.5. That row is a sensitivity run, not a penalty.

### What the numbers say

1. **A per-account taper cannot be made safe for accessible loops.**
   - Taper-14 (N = 14 a week) never fires, because V3 scores at most two sessions a day (§17), so it protects everyone and catches no one.
   - Taper-12 already penalises 81% of accessible-loop walkers (to 96–97% of their credits) in order to take farmers to 86%.
   - The farmer and the wheelchair-loop walker do the same thing: two qualifying short loops a day. A route-repeat signal cannot tell them apart.
2. **A soft ceiling is worse than a taper.** At the launch pool it penalises every commuter and every accessible-loop walker, and 47.5% of honest accounts overall. It only reaches colluders at 4.02×. A soft ceiling punishes diligence, not exploitation.
3. **Walking together within a time window spares people on the same route at different times.** It does not separate households from colluders, because both really do walk together. k1 recovers about 5 points for families compared with linked-as-one (62.9% vs 57.8%). Each household allowance k trades household loss against the multiplier left open:
   - k = 2 spares all pairs but leaves a two-phone colluder untouched at 3.17×.
   - k = 3 spares everyone and catches no one.
4. **Review flags remove most of the honest cost of a cluster rule.** With the 90%/5% reviewer assumption:
   - review-flag-2plus cuts honest penalties from 17.8% (linked-as-one) to 1.3% ± 0.8. Those are real households and families whose review was wrongly upheld, and they keep 97.6% overall.
   - It still takes colluder trios from 4.68× to 2.11× and pairs from 3.13× to 1.91×.
   - The price is reviewer work: about 99 reviews per 1,000 accounts per season in this population. That number depends almost entirely on how many linked groups really walk together.
   - The residual multiplier comes from the days before a review takes effect and from the 10% of colluder flags the assumed reviewer does not uphold.
5. **Under A6 as the reference model reads it, the trust weight does nothing at launch scale.** With trust applied *before* the 12 / 20 ceilings:
   - a spoofer at trust 0.5 keeps 1.41×, and even trust 0.25 keeps 1.41×;
   - applied *after* the ceilings, trust 0.5 gives 0.70×, 0.25 gives 0.35× and 0.75 gives 1.06×;
   - it changes no honest account (all honest trust is 1), and the withheld credits return to the season pool;
   - once the pool binds, the two orders are identical.
   So "after the ceiling" is the reading under which the trust weight works at every pool size. The V3 reference model (`settleDay`) is **not changed**. The order is a switch in the simulation layer (`trustOrder` on a route ruleset), and the owner decides how to read A6.
6. **Nothing touched movement.** Every variant left XP, streaks, achievements and territory unchanged, every day's books closed exactly, and no settled day ever changed.

### Trust checks: privacy-respecting, appealable, auditable (PROPOSAL)

The simulation sets trust weights and reviewer accuracy by assumption. It shows what a trust weight *would do* if one existed. It shows nothing about how well any real signal detects spoofing. Each signal below needs its own real-data validation before it sets a weight.

- **Signals.** Each is reduced to a coarse verdict or a count, never a raw stream.
  - The platform integrity verdict: Play Integrity pass or fail, kept as the verdict only, not the token.
  - The OS mock-location flag.
  - Physical plausibility of the verified session: speed and acceleration limits, step cadence against GPS speed as one summary ratio, and gaps.
  - Replay similarity: the same salted parent-zone fingerprint used by the route rules, compared within one account only.
  - Linked-account structure: a hashed install or device identifier shared across accounts, and repeated co-walking at the same time. Only the salted fingerprint and a 15-minute start bucket are used.
  - No contacts, no advertising IDs, no raw GPS beyond what `docs/LOCATION_DATA.md` already allows.
- **Retention.**
  - Route fingerprints: 14 days (unchanged).
  - Co-walking hits: the 14-day review window.
  - An open review's case file: reason codes, the counts that triggered it and the hashes of the evidence it relies on. It is kept for the review plus the 30-day appeal period. An upheld case is kept until season end plus 30 days, then deleted. A cleared case keeps only "cleared, date" for the 90-day exemption.
- **Who reviews.**
  - A trained operator who is not on the growth team. Upholding needs a second person (two-person rule) when the outcome cuts credits.
  - Reviewers see reason codes, counts and fingerprint similarity scores, never a raw trace or a zone list, unless the player chooses to share a trace in an appeal.
- **Appeal.**
  - The player is told the reason code, the effect ("linked accounts on the same walk earn as one, from day d") and how to appeal within 30 days.
  - A different reviewer handles the appeal. A successful appeal restores the allowance from the next settlement and exempts the group. Credits are never clawed back in either direction: outcomes are prospective only, as the tests require.
- **Audit.**
  - An append-only log of each flag, decision, reviewer pseudonym, reason code and effective day. `RouteCreditState.reviews` is the simulation's version of this log.
  - A monthly sample of upheld and cleared cases is re-reviewed blind to measure the real false-uphold rate, which replaces the 5% assumption.
  - The trust-weight distribution by population is reported, without identities, to the owner.
- **Never automatic.** No trust signal unscores a session or touches movement, territory, XP, streaks or achievements. A weight below 1 only lowers that account's share of the credits pool, and only after the ceilings.

### Rule candidate (NOT APPROVED; owner decision)

**`sim-route-candidate-review2-trust-after`:**

1. **No per-account route rule.** Commuters, repeated exercise loops and short accessible loops are never touched, and V3's two scoring sessions and its 12 / 20 ceilings remain the per-account bound.
2. **Linked accounts that walk together are reviewed, not cut.** Two or more linked accounts may submit near-identical sessions (fingerprint similarity ≥ 0.8) starting within 20 minutes of each other on 4 days in 14. That opens an appealable review, with no credit change while it is open. If the review is upheld, their shared walks earn as one account from 3 days later. A cleared group is exempt for 90 days.
3. **The trust weight applies after the ceilings.**

In this synthetic model, at the launch pool, it penalises **1.3% ± 0.8** of honest accounts (0% of commuters, loop walkers and accessible-loop walkers; 7.4% of household and family accounts, through wrongly upheld reviews). It takes colluder trios from 4.68× to **2.11×**, colluder pairs from 3.13× to **1.91×** and spoofers from 1.41× to **0.71×**. Route farmers stay at 1.71×, which is a diligent walker's two scoring sessions a day: farmers are bounded by V3, not by a route rule. Movement, territory and the books are untouched.

Owner decisions:
- whether to adopt it at all;
- 2+ or 3+ (3+ halves the review load but leaves two-phone colluders at 3.14×);
- the flag thresholds (4 days in 14, 20 minutes, similarity 0.8), the review delay and the exemption;
- what counts as a link;
- the reading of A6;
- reviewer staffing.

### Real data needed to validate it

- How often real linked households and families walk together at the same time, by household size. This drives both the false-flag rate and the review load.
- The precision and recall of the real risk-graph links: shared install, shared payment or shared device against declared households.
- The real reviewer uphold rate on confirmed multi-phone cases, and the real false-uphold rate on genuine households, from blind re-review. These replace the 90% / 5% assumption.
- Review handling time and the appeal rate per review, to size staffing.
- Real repeat-route and session-count distributions for commuters, exercise loops and accessible loops, including wheelchair users, from opt-in pilot data. These confirm that "no per-account rule" is still right.
- Real GPS noise by device class and environment. It sets the 0.8 similarity and the 20-minute window.
- The distribution of integrity verdicts and plausibility ratios among confirmed-honest and confirmed-spoofed sessions, before any trust weight below 1 is applied to anyone.
- The real population mix and pool regime at launch. Whether ceilings bind decides whether the trust order matters.

The churn study's 81% casual-hold figure for sim-pilot-2 (`SIM_CHURN_STUDY.md`) is **synthetic with attrition assumptions**. It is not real-world retention evidence, and nothing in this section relies on it.
