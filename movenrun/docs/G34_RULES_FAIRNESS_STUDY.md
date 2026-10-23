# G34 rule sets 1001 and 1002: group fairness by cohort

> **SIMULATION ONLY. Synthetic players.** Every number below comes from seeded synthetic walkers whose routes, timings, upload delays and links are behaviour assumptions written for this study. Nothing here is an observation of real players, and nothing is inferred about real retention, real behaviour or real fairness. No rule is ratified, changed or proposed here: 1001 and 1002 run exactly as they are in `backend/src/gameplay/rules.ts`, and the linked-account review is replayed as a candidate only. **No sanction is approved** by this study, and the server has none.

## What was run

`backend/src/gameplay/fairness.ts` extends the same-seed comparison of `compare.ts` (section 15.8 of `G34_SERVER_ARCHITECTURE.md`) with seven cohorts. Each seed generates one set of verified walks and feeds the same sessions, in server-receipt order, to every rule set:

- **1001** gets the resolution 8 cells the movement pipeline stores (`cellsForObservations`): A9 immediate flip, no take budget.
- **1002** gets its resolution 10 session path (`deriveSessionPath`, `verified-steps` v1): two-day challenge, 13 takes a day met in walk order, and the 20-hour second-push gap by server receipt (section 15.5).
- **1002 without the gap** is the same as 1002 without the gap. It appears only in the stress table (T5), to isolate the gap.

All three run through the server's own ledger step, `applyServerLedger`. All three also get the server guards that sit outside the rule sets:

- the per-walker daily unit budget of 300 (`DEFAULT_UNIT_BUDGET`), spent once per applied push, as the service spends it;
- day close: a session received after midnight plus the 2-hour grace of its day is refused (`day_closed`).

The ledger's own `stale_day` rejection applies unchanged. Credits are not simulated. The run is 28 days with 80 accounts per seed, over seeds 1 to 5. Each cell shows the mean over seeds, with the min–max across seeds in brackets.

**Season end** in this document means the end of the 28-day run, not a 90-day season.

### Cohorts (ASSUMPTION)

| Cohort | Accounts per seed | Behaviour |
|---|---|---|
| casual commuters | 24 | On 85% of weekdays: home to work in the morning and back in the evening, on the same L-shaped route of up to about 4 km each way. On 35% of weekend days: one short loop near home. 6 m GPS noise. |
| loop walkers | 16 | The same 350–700 m-radius loop round home on 75% of days. A second walk on 20% of those days. |
| long-distance walkers | 6 | A 1.8–3.5 km-radius loop (roughly 9–18 km) on 45% of days. On 30% of those days, a second loop of about 5 km. |
| household co-walkers (linked) | 16 (8 linked pairs) | Each pair shares a home and is active on 75% of days. On 70% of active days they walk together: the same route, starts within 3 minutes, and each phone records with its own noise and uploads on its own. On other days each walks alone (60%). The risk graph links each pair. |
| GPS gaps / late uploads | 10 | A loop on 70% of days, with 2–5 dropouts of 60–300 s per session and 10 m noise. 35% of sessions are uploaded 1–10 hours late (offline), so some reach the server after their day has closed. |
| hostile walkers | 4 | Every day, a long tour through six honest homes, plus the midnight straddle: the same short loop round an honest home at 23:24 and again at 00:03. Uploaded at once. (These are the attackers of `compare.ts`.) |
| GPS spoofers | 4 | Fabricated traces that pass verification: three tours through four honest homes a day, uploaded at once. Every night, the grace backdate: at about 01:00 they upload a session dated the previous day 23:20, then at once a session dated 00:05. |

Honest cohorts are the first five, 72 accounts. The co-walker pairs are the only linked accounts in the population.

### The review candidate (from the route-farming study, PR #123)

`review-flag-2plus` as #123 defines it:

- **Trigger:** a linked group in which two or more accounts walk together on 4 days in a trailing 14 opens a review. Walking together means starts within 20 minutes and route similarity of at least 0.8.
- **After the review:** a group the reviewer clears is exempt for 90 days.
- **Reviewer model:** #123's ASSUMPTION is that a reviewer wrongly upholds 5% of flags on real people who walk together. Each decision here is a seeded draw.

**Similarity.** Here it is the exact Jaccard similarity of the two sessions' zone sets: the stored cell under 1001, and the resolution 9 parent under 1002. #123 used a MinHash estimate over about 201 m parent zones.

**3+ variant.** `review-flag-3plus` never flags a pair. It is shown alongside.

**What a flag means here.** In #123 the review only ever affects credits. Credits are not simulated here, so a flag is reported as appeal burden: a review the household has to answer. It is not reported as a loss.

## Reproduce

```
cd movenrun/backend
node --import tsx scripts/fairness-study.ts 5 28
```

The output below is pasted verbatim from that command. The determinism tests are in `src/gameplay/fairness.test.ts`: same seed gives the same sessions and rows, and another seed differs. They are part of `npm test`.

## Generated tables

SIMULATION ONLY. Synthetic players. 5 seeds (1..5), 28 days, 80 accounts per seed. Mean over seeds, (min–max) across seeds.

#### T1. Headline: share of held area at the end, and turnover

| Cohort (accounts) | share of held area at end, 1001 | share of held area at end, 1002 | walkers holding ground at end, 1001 | walkers holding ground at end, 1002 | turnover (lost ÷ acquired), 1001 | turnover (lost ÷ acquired), 1002 |
|---|---|---|---|---|---|---|
| casual commuters (24) | 2.4% (0.0–5.7) | 13.8% (13.2–14.3) | 6% (0–13) | 99% (96–100) | 99% (98–99) | 46% (41–49) |
| loop walkers (16) | 4.7% (2.5–6.7) | 8.4% (7.6–9.2) | 19% (13–25) | 99% (94–100) | 98% (97–99) | 55% (52–60) |
| long-distance walkers (6) | 67.8% (65.3–71.2) | 59.5% (57.0–61.3) | 90% (83–100) | 100% | 88% (87–89) | 9% (7–11) |
| household co-walkers (linked) (16) | 3.7% (0.0–8.0) | 5.8% (4.7–6.6) | 14% (0–25) | 100% | 97% (96–98) | 64% (57–69) |
| GPS gaps / late uploads (10) | 4.6% (1.3–6.7) | 4.4% (3.4–5.8) | 22% (10–30) | 100% | 91% (88–93) | 53% (45–59) |
| hostile walkers (4) | 4.6% (2.9–5.7) | 3.1% (2.6–4.0) | 60% (50–75) | 100% | 96% (96–97) | 56% (52–64) |
| GPS spoofers (4) | 12.2% (8.0–15.6) | 5.1% (4.4–6.0) | 90% (75–100) | 100% | 95% (94–96) | 51% (44–55) |

#### T2. Honest (casual) ownership at the end of the run

| Honest cohorts together (72 accounts) | 1001 | 1002 |
|---|---|---|
| Share of held area at end | 83.2% (79.2–86.7) | 91.8% (90.0–92.8) |
| Honest walkers holding ground at end | 20% (17–24) | 99% (99–100) |
| Held area at end (km², unit areas differ) | 45.42 (41.29–50.88) | 42.58 (39.88–46.08) |
| Honest units flipped by hostile walkers or spoofers | 1624 (1479–1726) | 69 (60–74) |
| Honest units flipped by other honest walkers | 3737 (3554–3908) | 1268 (1180–1362) |
| Map flips per unit held at end | 118.55 (112.45–132.63) | 0.53 (0.50–0.55) |

#### T3. Attacks, flips and empty-ground acquisitions, per account over the run

| Cohort (accounts) | takes made, 1001 | takes made, 1002 | flips made, 1001 | flips made, 1002 | flips suffered, 1001 | flips suffered, 1002 | empty-ground claims, 1001 | empty-ground claims, 1002 |
|---|---|---|---|---|---|---|---|---|
| casual commuters (24) | 74.0 (67.3–81.8) | 187.3 (172.9–201.9) | 74.0 (67.3–81.8) | 17.4 (13.8–20.8) | 76.0 (68.8–83.9) | 15.6 (12.0–19.2) | 3.0 (2.4–3.3) | 16.2 (13.9–18.5) |
| loop walkers (16) | 66.4 (60.4–71.7) | 156.2 (138.9–177.2) | 66.4 (60.4–71.7) | 26.2 (24.6–27.9) | 67.8 (62.0–73.3) | 20.0 (18.5–21.5) | 3.1 (2.3–3.7) | 10.1 (9.2–11.4) |
| long-distance walkers (6) | 168.1 (143.7–188.5) | 162.1 (149.8–182.0) | 168.1 (143.7–188.5) | 11.3 (7.8–16.3) | 169.4 (144.5–186.8) | 29.3 (25.7–36.5) | 24.6 (21.7–27.3) | 334.3 (312.5–354.3) |
| household co-walkers (linked) (16) | 59.4 (57.0–63.8) | 233.6 (226.4–249.4) | 59.4 (57.0–63.8) | 24.5 (22.1–28.3) | 58.3 (56.1–62.5) | 19.8 (14.8–23.3) | 0.9 (0.6–1.4) | 6.5 (3.5–9.0) |
| GPS gaps / late uploads (10) | 53.2 (44.2–69.1) | 148.9 (124.8–162.7) | 53.2 (44.2–69.1) | 22.8 (19.4–26.7) | 50.3 (40.6–65.3) | 15.0 (14.1–16.4) | 2.1 (1.5–3.0) | 5.7 (3.2–7.8) |
| hostile walkers (4) | 368.1 (330.5–402.8) | 364.0 | 368.1 (330.5–402.8) | 14.8 (12.8–18.8) | 371.9 (333.8–407.8) | 33.9 (24.3–47.8) | 17.4 (14.3–20.8) | 45.4 (29.5–62.0) |
| GPS spoofers (4) | 486.8 (418.0–528.5) | 364.0 | 486.8 (418.0–528.5) | 14.9 (12.3–17.3) | 475.1 (408.8–510.8) | 42.5 (37.5–45.3) | 14.3 (13.3–15.5) | 67.8 (64.5–72.0) |

#### T4. Budgets: 13-take denials and 300-unit refusals

| Cohort (accounts) | take-budget denials / account, 1001 | take-budget denials / account, 1002 | active days at 13 takes, 1001 | active days at 13 takes, 1002 | 300-unit refusals / account, 1001 | 300-unit refusals / account, 1002 | active days at 300 units, 1001 | active days at 300 units, 1002 | most units in one walker-day, 1001 | most units in one walker-day, 1002 |
|---|---|---|---|---|---|---|---|---|---|---|
| casual commuters (24) | 0.0 | 96.0 (41.0–132.4) | 0% | 44% (33–54) | 0.0 | 0.0 | 0.0% | 0.0% | 14 (12–16) | 90 (80–97) |
| loop walkers (16) | 0.0 | 39.1 (11.5–85.4) | 0% | 27% (16–38) | 0.0 | 0.0 | 0.0% | 0.0% | 10 (8–12) | 65 (56–77) |
| long-distance walkers (6) | 0.0 | 1012.5 (822.7–1124.3) | 0% | 99% (99–100) | 0.0 | 0.0 | 0.0% | 0.0% | 30 (28–31) | 212 (205–228) |
| household co-walkers (linked) (16) | 0.0 | 147.3 (123.3–173.3) | 0% | 87% (77–91) | 0.0 | 0.0 | 0.0% | 0.0% | 6 (5–7) | 41 (38–45) |
| GPS gaps / late uploads (10) | 0.0 | 25.3 (1.6–45.5) | 0% | 26% (7–40) | 0.0 | 0.0 | 0.0% | 0.0% | 5 (4–7) | 34 (31–37) |
| hostile walkers (4) | 0.0 | 3466.5 (3185.5–3681.5) | 0% | 100% | 0.0 | 0.0 | 0.0% | 0.0% | 24 (22–27) | 209 (189–236) |
| GPS spoofers (4) | 0.0 | 6254.8 (5432.5–6529.3) | 0% | 100% | 0.0 | 75.1 (0.0–119.5) | 0.0% | 12.9% (0.0–21.4) | 45 (39–51) | 298 (292–300) |

#### T5. The 20-hour server-receipt gap (1002 without the gap vs 1002)

| Cohort (accounts) | flips under 20 h after the challenge opened (run total), 1002 without the gap | flips under 20 h after the challenge opened (run total), 1002 | second pushes held back by the gap (run total), 1002 without the gap | second pushes held back by the gap (run total), 1002 |
|---|---|---|---|---|
| casual commuters (24) | 26.2 (19.0–36.0) | 0.0 | 0.0 | 25.6 (17.0–34.0) |
| loop walkers (16) | 149.0 (103.0–172.0) | 0.0 | 0.0 | 144.6 (94.0–171.0) |
| long-distance walkers (6) | 0.0 | 0.0 | 0.0 | 0.0 |
| household co-walkers (linked) (16) | 96.8 (61.0–158.0) | 0.0 | 0.0 | 124.8 (66.0–207.0) |
| GPS gaps / late uploads (10) | 89.4 (44.0–140.0) | 0.0 | 0.0 | 90.8 (42.0–140.0) |
| hostile walkers (4) | 0.0 | 0.0 | 0.0 | 0.0 |
| GPS spoofers (4) | 2.0 (0.0–8.0) | 0.0 | 0.0 | 1.8 (0.0–7.0) |

#### T6. Daily activity (identical input for every rule set) and sessions that gained or kept ground

| Cohort (accounts) | accepted sessions per day, 1001 | accepted sessions per day, 1002 | refused at day close (run), 1001 | refused at day close (run), 1002 | sessions that claimed or reinforced, 1001 | sessions that claimed or reinforced, 1002 | pushes rejected as stale_day (run), 1001 | pushes rejected as stale_day (run), 1002 |
|---|---|---|---|---|---|---|---|---|
| casual commuters (24) | 31.5 (30.8–32.3) | 31.5 (30.8–32.3) | 0.0 | 0.0 | 7% (6–8) | 96% (95–98) | 0.0 | 0.0 |
| loop walkers (16) | 14.4 (13.9–14.9) | 14.4 (13.9–14.9) | 0.0 | 0.0 | 19% (17–22) | 98% (96–100) | 0.0 | 0.0 |
| long-distance walkers (6) | 3.5 (3.1–4.1) | 3.5 (3.1–4.1) | 0.0 | 0.0 | 70% (67–73) | 85% (79–91) | 0.0 | 0.0 |
| household co-walkers (linked) (16) | 10.7 (10.2–11.4) | 10.7 (10.2–11.4) | 0.0 | 0.0 | 5% (3–8) | 76% (67–81) | 0.0 | 0.0 |
| GPS gaps / late uploads (10) | 6.7 (6.2–7.0) | 6.7 (6.2–7.0) | 4.6 (2.0–8.0) | 4.6 (2.0–8.0) | 15% (10–25) | 94% (87–97) | 2.4 (0.0–8.0) | 3.6 (0.0–11.0) |
| hostile walkers (4) | 11.9 | 11.9 | 0.0 | 0.0 | 26% (23–28) | 43% (33–49) | 0.0 | 0.0 |
| GPS spoofers (4) | 19.7 | 19.7 | 0.0 | 0.0 | 23% (22–26) | 63% (53–69) | 97.6 (86.0–111.0) | 162.4 (138.0–202.0) |

#### T7. Co-walkers push each other's ground

| Household co-walkers (8 linked pairs) | 1001 | 1002 |
|---|---|---|
| Takes on the partner's ground, per account | 24.8 (22.1–27.5) | 62.4 (47.4–79.2) |
| Flips of the partner's ground, per account | 24.8 (22.1–27.5) | 10.9 (8.4–13.6) |
| Share of the cohort's takes that hit the partner | 42% (39–44) | 27% (21–35) |
| Take-budget denials per account (all causes) | 0.0 | 147.3 (123.3–173.3) |

#### T8. Appeal burden under the linked-account review candidate

| Review candidate (linked accounts walking together on 4 of 14 days) | 1001, 2+ accounts | 1002, 2+ accounts | 1001, 3+ accounts | 1002, 3+ accounts |
|---|---|---|---|---|
| Linked groups (all honest co-walker pairs) | 8 | 8 | 8 | 8 |
| Group-days walking together | 115.4 (105.0–129.0) | 116.6 (100.0–130.0) | 115.4 (105.0–129.0) | 116.6 (100.0–130.0) |
| Groups flagged | 8.0 | 8.0 | 0.0 | 0.0 |
| Co-walker accounts flagged | 100% | 100% | 0% | 0% |
| Accounts flagged in any other cohort | 0 | 0 | 0 | 0 |
| Reviews (appeals to answer) per 1,000 accounts | 100.0 | 100.0 | 0.0 | 0.0 |
| Day of first flag | 7.7 (7.1–8.4) | 7.8 (7.0–8.9) | – | – |
| Wrongly upheld (assumed 5% reviewer error, seeded) | 0.2 (0.0–1.0) | 0.2 (0.0–1.0) | 0.0 | 0.0 |

Unit area: 1001 0.7373 km² (resolution 8), 1002 0.0150 km² (resolution 10). Counts of units are not comparable across rule sets; shares are.

## Reading the tables

Each point names the table it rests on. Unit counts are not comparable across rule sets: a 1001 unit is 0.737 km² and a 1002 unit is 0.015 km². Compare shares and directions, not counts.

1. **Honest ownership at the end of the run.**
   - Under 1001, about 20% of honest walkers hold any ground at the end. Under 1002, 99% do (T2).
   - The casual cohorts gain most. Commuters go from 6% holding ground to 99%, loop walkers from 19% to 99%, co-walkers from 14% to 100% and gap walkers from 22% to 100% (T1).
   - Under 1001, 7% of commuter sessions and 5% of co-walker sessions claim or reinforce anything. Under 1002, 96% and 76% do (T6).
2. **Turnover.**
   - Under 1001, almost everything acquired is later lost: 88–99% turnover in every cohort (T1), and about 119 flips per unit held at the end (T2).
   - Under 1002, turnover is 9–64% and the map sees about 0.5 flips per held unit (T1, T2).
3. **Attacks.**
   - Hostile walkers and spoofers flip about 1,624 honest units under 1001 and about 69 under 1002 (T2).
   - Under 1002 every hostile and spoofer account is held to exactly 13 takes a day: 364 takes over 28 days (T3), with the cap reached on 100% of their active days (T4).
   - Most honest flips under 1002 come from other honest walkers, not attackers: about 1,268 against 69 (T2).
4. **Who 1002's levers cost.**
   - **Long-distance walkers.** They hold about 60% of the held area at the end under 1002 (68% under 1001), mostly from free empty-ground claims: about 334 claims per account (T1, T3). They reach the 13-take cap on 99% of their active days and are denied about 1,013 takes each over the run (T4).
   - **Casual walkers.** Commuters reach the take cap on 44% of their active days and loop walkers on 27% (T4). In this synthetic town, homes and routes overlap, so walkers push one another's ground.
5. **The 300-unit budget.**
   - Under 1001 no honest walker comes near it: at most 30 units in one day (T4).
   - Under 1002 the busiest honest walker-day is about 212 units (long-distance walkers), so the budget never refuses an honest push in these runs (T4).
   - Only spoofers reach it: three tours a day plus the backdated pair, refused on about 13% of their active days (T4).
   - A tighter budget does refuse long walks (`fairness.test.ts`, budget 40). That is a test, not a measured table, so no rate is claimed for it.
6. **The 20-hour gap.**
   - Without the gap, the flips that complete under 20 hours come almost entirely from honest cohorts: loop walkers 149, co-walkers 97, gap walkers 89 and commuters 26 per run. Spoofers have 2 and hostile walkers none (T5).
   - The attackers' straddles mostly fail for another reason: their daytime tours use up the 13 takes before the night sessions (T4, 100% of active days at the cap), and the spoofers' backdated sessions are often rejected as `stale_day` (T6).
   - With the gap, no flip completes under 20 hours. It holds back about 25–145 honest second pushes per cohort per run (T5).
   - So in this population the gap mainly delays honest challenges. That is its stated cost (section 15.5): a defender always gets 20 real hours.
7. **GPS gaps and late uploads.** Dropouts barely reduced access under 1002: 94% of gap walkers' sessions claim or reinforce, against 98% for loop walkers on similar loops (T6). Late uploads past day close are refused under both rule sets alike, about 4.6 sessions per run (T6).
8. **Co-walkers push each other.**
   - Two linked phones on one walk upload one after the other. The second uploader's pushes land on ground the first has just claimed.
   - Under 1001 each co-walker flips about 25 of the partner's units over the run, and 42% of the cohort's takes hit the partner (T7).
   - Under 1002 the challenge turns most of these into erosion: about 62 takes and 11 flips per account. But the takes spend the 13-take budget: co-walkers reach the cap on 87% of their active days (T4) and are denied about 147 takes each (T7).
   - Households pay a real territory cost under both rule sets, before any review.

## Which cohorts the review candidate would flag

Rows of T8:

- **Under `review-flag-2plus`, every co-walker pair is flagged**: 8 of 8 groups, 100% of linked accounts, under both 1001 and 1002.
  - The first flag comes on about day 8. That is 100 reviews per 1,000 accounts over 28 days.
  - All of these are honest households, so every flag is a false positive by construction.
  - At the assumed 5% reviewer error, about 0.2 groups per seed are wrongly upheld.
- **No account in any other cohort is flagged**, including the hostile walkers and spoofers. The rule only reads linked accounts, and none of them are linked.
  - A review of this kind does nothing against single-account attackers.
  - Its only effect on this population is appeal burden on honest co-walkers.
- **Under `review-flag-3plus`, nothing is flagged**, because pairs are exempt.
- The flag count is the same under 1001 and 1002. The rule reads walks, not holdings, and both zone sets match co-walkers at 0.8.

The review is a credit-side candidate from #123 that has not been adopted. This study approves no sanction, flag or credit change. Whether households that really walk together should be exempt, for example with a declared-household exemption, is the owner's decision.

## What this cannot tell us

- **Real retention and real behaviour are not inferred.** Activity is an input. Every cohort walks the same sessions under every rule set (T6, identical session counts), so no player reacts to being flipped, capped, refused or flagged. A real casual walker who keeps losing ground under 1001 might stop playing; this model cannot show that or its size.
- The cohort sizes, routes, overlap density, upload delays, GPS noise and link structure are assumptions. The town is 4 × 4 km with homes placed uniformly, which makes overlap (and so honest-on-honest takes) denser or sparser than a real city.
- The spoofer model is one strategy that passes verification. Real spoofing, and how much of it verification would stop, is not modelled.
- The reviewer error rate (5%) and the walking-together test come from #123's assumptions, with exact Jaccard similarity in place of MinHash. Real link quality and real appeal rates are unknown.
- Areas use H3 average cell areas. A resolution 8 cell counts whole however little of it was walked, so 1001 km² figures overstate walked ground.
- Credits, upkeep, clubs, districts, shade, deeds and masks are not exercised. Every push is solid on unmasked, undeeded ground.
- 28 days is not a 90-day season. Decay to the immediate-take line (about 24 days unvisited) only just starts to matter at the end of the run.

## Rule set identity

The study changes no rule logic, no config and no migration.

- 1001's config digest is still `d4199ec60958750007bfa8884c88aad1bf810aed6bd2a054abb5dc74ffe41cd6`. This is checked by `regression1001.test.ts`, which also replays the recorded 1001 stream fingerprint, and again by `fairness.test.ts` after a run.
- 1002's digest is checked unchanged before and after a run.
