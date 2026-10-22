# Anti-farming and appeals: linked-account review, re-evaluated

Status: research only. Nothing here is a live feature, a ruling, or a launch claim. Rule set 1001 is the default; nothing below changes it.
Code and data: `movenrun/research/economy-redteam/farming/` (seeds in `manifest.json`, outputs in `out/`).
Run the tests: `node --import tsx --test 'research/economy-redteam/farming/**/*.test.ts'` from `movenrun/`. Regenerate tables: `node --import tsx research/economy-redteam/farming/run.ts`.

Evidence tiers used: SOURCE, OWNER DECISION, PILOT ASSUMPTION, VERIFIED CODE, SYNTHETIC EXPERIMENT, HOSTED PROOF. There is no HOSTED PROOF anywhere in this document. Every number below is a SYNTHETIC EXPERIMENT on pseudonymous accounts (`a0001` style); no real wallet, device, residence or route is involved.

## 1. What was proposed in #123, and what it measured

The #123 study (read-only worktree, not in this base) proposes: a linked group walking together on 4 of 14 days opens a review; credits stay untouched while it is open; only an upheld review applies a one-walker allowance, from 3 days after the flag, never to settled days; a cleared group is exempt for 90 days. Constants: `shared/src/sim/routeCredit.ts:195` (`flagDays: 4, windowDays: 14, reviewDelayDays: 3, clearedExemptDays: 90`). Results are in `docs/SIM_ROUTE_FARMING_STUDY.md` of that worktree (PILOT ASSUMPTION populations, 10 seeds).

Reported there: honest accounts penalised 1.3% (+/-0.8) for `review-flag-2plus`, 0% for commuters and loop walkers, "no commute/loop denial", and, in the same table, 17.8% of honest accounts flagged and about 99 reviews per 1,000 accounts per season.

The 1.3% is the share of honest accounts whose review was wrongly upheld, on an assumed reviewer (upholds 5% of honest groups, 90% of true rings). It is not the share of honest people put into a review. The second figure, 17.8%, is the one that matters for friction, privacy and staffing, and the headline hides it. This is the main re-evaluation finding.

## 2. My own test

SYNTHETIC EXPERIMENT. Design, all in `farming/sim.ts`:

- Populations of about 100, 200 and 1,000 accounts, 90 simulated days, rolling 14-day window, 30 seeds per cell (seed list in `manifest.json`). Intervals are 95% Student-t across seeds; they describe model variance only, not fit to real behaviour.
- Honest cohorts: solo walkers, commute corridors, night-shift timezones, dense parks, public-transit riders (same route and time, unlinked), GPS-drift neighbours (route fingerprints mis-matched 15% of days), siblings (linked pairs), shared households (triples), guide plus trainees (groups of 5), popular organised walks (groups of 25, two fixed days a week), one-off group events (groups of 30).
- Rings (8% of accounts, 3 phones each, one walker): linked, unlinked, linked but staggered in time, linked but phones carried apart.
- Link edges (the only thing the rule may use) are drawn per pair with assumed probabilities in the manifest (for example 0.7 for siblings, 0.8 households, 0.03 for two members of a large organised walk, 0.002 as a false link between strangers on shared infrastructure, 0.6 for a linked ring). These are assumptions. The study shows what the rule does given a link graph; it does not show how good any real linkage signal is.
- Reviewer: carried over from #123 (upholds 5% honest, 90% rings). Assumed, not measured.
- Hypotheses and the pass bar were written into `manifest.json` before the first results: honest review rate no more than 2% at N=1,000, no stranger cohort above 1%, linked-ring detection at least 80%.
- Variants: V0 is the #123 rule (4 of 14). V1 raises it to 8 of 14. V2 adds a "tight trace" feature (the co-walk day counts only if the two traces agree to within a few metres; assumed per-relation probabilities in the manifest). V3 is 6 of 14 plus the tight trace. V2s is V2 with honest co-walkers assumed twice as tight (sensitivity).

### Headline (N=1,000; mean and 95% interval over 30 seeds)

| Variant | Honest accounts put into review | Honest wrongly upheld | Linked-family cohorts put into review | Stranger cohorts put into review |
|---|---|---|---|---|
| V0 #123 rule, 4 of 14 | 15.4% [15.1, 15.7] | 0.77% [0.55, 0.99] | 58.6% [57.4, 59.8] | 0.28% |
| V1 8 of 14 | 11.4% [11.2, 11.7] | 0.54% | 43.4% | 0.23% |
| V2 4 of 14 + tight trace | 2.1% [1.9, 2.4] | 0.10% | 8.1% | 0.00% |
| V3 6 of 14 + tight trace | 0.06% [0.03, 0.10] | 0.00% | 0.25% | 0.00% |
| V2s (honest twice as tight) | 9.1% [8.8, 9.3] | 0.41% | 34.9% | 0.00% |

At N=100 and 200 the V0 honest review rate is 11.2% and 13.7%. The wrongly-upheld rate at N=1,000 (0.77%) is the same order as #123's 1.3%, so I reproduce their number; the review rate is what they did not headline. Full per-cohort tables: `farming/out/cohorts.csv`, `farming/out/headline.csv`.

### False-positive review rate per cohort (V0, N=1,000)

| Cohort | Put into review | Wrongly upheld |
|---|---|---|
| solo, dense parks, GPS-drift neighbours, group events | 0.0% | 0.0% |
| public-transit riders | 0.2% | 0.0% |
| night-shift | 0.7% | 0.0% |
| commute corridors | 1.1% [0.7, 1.5] | 0.05% |
| organised popular walks | 32.5% [29.5, 35.4] | 0.65% |
| guide plus trainees | 44.4% [40.2, 48.7] | 3.0% |
| siblings | 69.4% [66.5, 72.3] | 3.1% |
| shared households | 95.8% [94.8, 96.9] | 5.3% |

Reading: strangers are almost never reviewed, only because the rule never uses proximity; the few commuters and night-shift workers who are reviewed are those with a false link edge to another corridor user. Hypothesis F2 (every stranger cohort below 1%) fails narrowly for commute corridors (1.1%). Every cohort of people who really do know each other is reviewed at high rates: nearly every household and most sibling pairs. The rule is a household and club review, not a farming detector.

### Detection of rings

| Ring type | V0 | V2 (tight trace) | V3 | Median days to first review (V0) |
|---|---|---|---|---|
| linked | 85.2% [82.0, 88.4] | 85.2% | 85.2% | 3.2 |
| unlinked | 0.0% | 0.0% | 0.0% | n/a |
| linked, staggered start times | 0.7% | 0.7% | 0.0% | n/a |
| linked, phones carried apart | 82.0% [77.2, 86.9] | 72.8% | 21.1% | 3.2 (V0), 33.8 (V2) |

(N=1,000; at N=100 and 200 linked-ring detection is 95.6% and 87.8% with wide intervals, since there are only 3 ring accounts per seed in one cell.)

- Detection is capped by link coverage, not by the threshold: a three-phone ring is invisible to the rule if none of its pairs is linked, which at the assumed 0.6 per pair happens for about 6% of rings and partly covers a third phone.
- Unlinked rings are never reviewed. That is by design and by test (`proximity alone is never evidence`). It is also the largest hole: the rule cannot see a ring whose phones share no device link.
- Staggering starts by 25 to 40 minutes defeats the 15-minute bucket completely. A ring that spaces its phones defeats the tight-trace feature (V3: 21%).
- Pass bar result, stated before the run: V0 fails (15.4% against 2%). V2 narrowly fails (2.1% against 2%, interval 1.9 to 2.4). V3 passes the honest bar (0.06%) but fails the ring bar for spaced rings. No variant passes everything; if honest co-walkers are twice as tight as assumed (V2s), V2 stops being a fix (9.1%). The tight-trace feature rests on an assumption that nothing here validates, so it is a candidate to collect real evidence on, not a recommendation.

### What a proximity-only rule would have done (counterfactual, never to be used)

Same data, but any two accounts at the same route and start time count. Share of accounts that would be put into review: commute corridors 100%, night-shift 100%, public transit 97%, organised walks 96%, GPS-drift neighbours 0%, dense parks 0%, solo 0%. Commuters, shift workers and transit riders would all be reviewed. This is why proximity alone is not evidence, and the test suite enforces it.

## 3. Privacy burden of building the signal

PILOT ASSUMPTION for design; SYNTHETIC EXPERIMENT for counts (per 1,000 accounts, N=1,000 cell).

What the rule needs that the app does not already keep:

1. A link graph: edges between pseudonymous accounts derived from a shared hashed install or device identifier, shared recovery contact hash, or invitation chain. About 142 edges per 1,000 accounts in this synthetic population, 1.1 of them false (strangers). Edges must be retained as long as the rule is wanted (proposed 90 days, renewable only by fresh evidence). This is the large cost: the signal is a persistent record of who is connected to whom.
2. Co-walk records, only for linked pairs: day, 15-minute start bucket, a salted route-fingerprint match flag and optionally a tight-trace flag. About 800 live records per 1,000 accounts at a 14-day retention. No coordinates, no trace.
3. A case file: reason codes, counts, record hashes.

Minimisation that the numbers support: check co-walks only for pairs that are already linked, and discard everything else immediately. A stored proximity graph would hold about 5,200 live pair records per 1,000 accounts (6.5 times more), and each record would tie together strangers who happen to be on the same bus, corridor or shift. At an assumed 40 bytes a record the byte difference is small (about 32 KB against 210 KB per 1,000 accounts); the cost is the number of people tied to others, not storage.

Retention table (also `RETENTION` in `farming/dueProcess.ts`): link edge 90 days; co-walk record 14 days; open case file until season end plus 30 days; cleared case "cleared, date" only; decision log (case id, reviewer pseudonym, reason code, effective day) 365 days. Raw GPS traces are never an input, are not shown to reviewers, and a player may choose to attach one to an appeal, in which case it is destroyed at the decision plus 30 days. Raw signals (shared-identifier hashes used to create the edge) are destroyed when the edge expires; derived counts survive only inside the case file.

## 4. Mechanisms, kept apart

| Mechanism | What it does | Touches location or links? | Honest cost | Weakness | In my numbers |
|---|---|---|---|---|---|
| Scoring-only diminishing returns | Lowers credit per extra session or per extra linked account automatically | Needs link graph for the linked variant | Hits real households unless there is a household allowance (#123 measured 17.8% honest penalised for linked-as-one) | Automatic, cannot be appealed before it bites | not simulated here; relied on #123 |
| Human review queue | A person decides about a linked group after a count threshold | Link graph plus co-walk counts | Review for 15% of honest accounts at V0, 2% at V2 | Staff time; cannot see unlinked rings | simulated |
| Slow trust accumulation | New accounts earn at a weight that ramps up | Neither | Slows real new players | A patient ring waits too | arithmetic: linear 28-day ramp gives a fresh account 85% of full weight averaged over 90 days; 14-day ramp 93%; 56-day ramp 69% |
| Identity assurance | Raises the cost of each extra account | Identity, not location | Excludes people without ID; privacy cost | Shifts the problem to ID fraud | not simulated |
| Challenge opportunities | Occasional prompt only the person can answer (re-walk a short loop, answer a prompt) | Little | Interrupts real players | Outsourceable | not simulated |
| Cooldowns | Pace a repeated action | None | Low | Does not stop parallel accounts | not simulated |
| Account rate limits | Cap new accounts per device or recovery contact per month | Device hash | Blocks shared family devices unless allowed | Only slows a ring | not simulated |

Only the human review queue and the slow-trust arithmetic were measured. The other rows are design comparisons, not findings.

## 5. Manual review staff-minutes per 1,000 participants

Per-case time is an ASSUMPTION; no reviewer has ever timed one. First review 10 minutes (range 5 to 25). Appeal of an upheld case: assumed 50% appeal (range 25% to 80%) at 20 minutes (range 10 to 40) by a second reviewer. Cases are connected groups of flagged linked accounts. Season (90 days) workload per 1,000 participants, N=1,000, honest groups only (rings excluded; at 8% ring prevalence in the synthetic mix, add roughly 12 cases per 1,000):

| Variant | Honest cases per 1,000 | Staff-minutes per 1,000 (low / mid / high) |
|---|---|---|
| V0 #123 rule | 56.9 | 291 / 597 / 1,511 (about 5 / 10 / 25 hours) |
| V1 8 of 14 | 43.1 | 220 / 450 / 1,140 |
| V2 tight trace | 9.3 | 48 / 98 / 248 |
| V3 | 0.3 | 2 / 3 / 8 |

At N=100 the V0 mid estimate is 417 minutes per 1,000 participants; at N=200 it is 550. All of these depend almost entirely on how many linked people walk together, which is exactly what is unknown. The unit to measure first is real minutes per case.

## 6. Due-process flow (proposal)

Implemented as pure, tested functions in `farming/dueProcess.ts`:

1. A case may open only with a link edge and at least the threshold of co-walk days in the window. Proximity alone is refused (test). A group cleared in the last 90 days is not reopened.
2. Opening a case changes nothing: no credit change, no XP change, no restriction. Credits settle as normal while it is open. Stale cases expire after 21 days with no effect.
3. A reviewer who is not on the growth team sees reason codes and counts only (`LINKED_ACCOUNTS`, `REPEATED_SAME_TIME_SAME_ROUTE`, counts, record hashes), never a route, a zone or another person's name. A decision that reduces credits needs a second person.
4. Outcomes: clear (exemption 90 days) or uphold. Upholding applies only a shared daily allowance for the linked group, starting 3 days after the decision; no settled day is touched.
5. The player can ask for a second look within 30 days; a different reviewer decides. An overturn restores the allowance from the next settlement and exempts the group. It mints nothing, claws back nothing, and re-settles nothing.
6. Operator correction of a false positive is prospective and cannot mint credit. See `docs/parallel/economy-redteam/CLUB_AND_DISTRICT_FAIRNESS_BRIEF.md` for the repo-side finding that re-settling a day redistributes the fixed day pool to the other players, which is why corrections must never be done by re-settlement.
7. Never auto-ban. Never freeze verified XP, streaks or achievements. Never label a co-walker. A decision log keeps case id, reviewer pseudonym, reason code, effective day; a monthly blind re-review sample replaces the 5% reviewer assumption with a measured rate.

Safe notification wording (tested against a forbidden-word list that includes cheat, fraud, ban, farming, partner, household, friend):

- Open: "A routine check on linked accounts. Some accounts that are connected to yours were active together often over the last two weeks. This is an automatic prompt for a person to take a look. Nothing about your account has changed, and your XP, streaks and past credits are not affected. You can add context if you like."
- Upheld: "Update on a check. After a person looked, connected accounts that are active together will share one daily allowance from a set date. Your XP, streaks and past credits are not affected. You can ask for a different person to look again within 30 days."
- Cleared and expired wording are in `notificationFor`.

## 7. Conclusions and what to do

1. Do not cite 1.3% as the cost of the rule. Cite two numbers: honest accounts put into review (15% under the #123 rule in this model, 17.8% in theirs) and wrongly upheld (about 1%). SYNTHETIC EXPERIMENT.
2. The rule reviews real households, siblings, guides and organised walks at 30% to 96%. It is cheap in penalties and expensive in friction, privacy and staff time. SYNTHETIC EXPERIMENT.
3. It cannot see unlinked rings or time-staggered rings. If the owner's concern is organised farming, linkage is not enough; this study does not show what is. SYNTHETIC EXPERIMENT.
4. A second feature that separates a person carrying phones from real co-walkers would cut the review rate sharply in this model, but the feature's separation is assumed. Collect it (as a coarse flag) in the private prototype before any rule depends on it, and test with consenting testers. PILOT ASSUMPTION.
5. Keep the rule off. If a pilot is run, run it in shadow mode first (count would-be cases, open none), and publish the review rate with the penalty rate.
6. Owner decisions: acceptable honest review rate; whether the link graph may be built at all; retention periods; who the reviewers are; per-case minutes (measure).

Not simulated: reviewer fatigue and error drift; adversaries who adapt to the thresholds; real link-signal quality; real behaviour of any cohort; weekly seasonality beyond a weekday flag; multi-ring coordination; interaction with the toll or holding economy. Sample sizes at N=100 give wide intervals.
