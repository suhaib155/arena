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
