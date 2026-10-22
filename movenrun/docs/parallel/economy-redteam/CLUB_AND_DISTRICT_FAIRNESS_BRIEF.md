# Club and district fairness brief (G4 reference model)

Status: research only. D18 to D23 remain owner decisions. The G4 model is a tested reference model, not wired to the API, app or database; the app's clubs are a preview. Nothing here is a live claim. HOSTED PROOF: none.
Districts in every experiment are synthetic (id prefixes or integer-grid stripes). No real district, suburb or city geometry is used or implied; D20 (what a district is) is open and is not invented here.
Code: `movenrun/research/economy-redteam/clubs/` (seeds and synthetic parameters in `manifest.json`; sweep outputs in `out/`).
Tests: `node --import tsx --test 'research/economy-redteam/clubs/**/*.test.ts'` from `movenrun/` (20 tests, pass). Regenerate tables: `node --import tsx research/economy-redteam/clubs/run.ts`.
Tiers: VERIFIED CODE (read at base cb27318, `shared/src/domain/clubsDistricts.ts`), SYNTHETIC EXPERIMENT (our sweeps, 20 seeds, 95% t-intervals across seeds), OWNER DECISION (D18 to D23 are listed as open in `docs/GAME_ECONOMY_V3.md`), PILOT ASSUMPTION (proposals of mine).

## 1. What the model does (VERIFIED CODE)

- `clubSnapshot`: membership spans `[fromDay, toDay)`; a walker in two clubs on one day is a problem (D18), not a split.
- `districtControl`: per district, solid and shade units weighted by `shadeWeight`; a club controls only if it is strictly ahead of every other club and holds at least `minShare` of ALL held ground in the district, unclubbed holders included. Exact ties control nothing. Any problem in holdings, snapshot or rule returns no districts at all.
- `seasonLeaderboard`: settled days only, refuses on any refused, repeated, foreign-season or over-length day; no settled day gives an empty board that states its coverage. Ties share a rank and are listed by id.
- D18 has no "next-day rule" in the code: the caller passes spans. Next-day behaviour is a caller policy; we modelled it as `fromDay = requestDay + 1`.

## 2. Findings

Hypotheses were written into the manifest before running. Two were not supported as stated; this is reported below.

**F1. Capture advantage of dense clubs: dispersal is the penalty, not density the bonus (hypothesis H1 partly falsified).** World: 20 synthetic districts of 40 units, clubs of 40, 20, 10, 5 and 3 members plus 100 unclubbed walkers, 4 units each.
- Two clubs with identical members and identical ground (40 units): the dense club controls its district, the club spread over ten districts controls none (test). The unclubbed neighbours' ground in the denominator is enough.
- Seeded sweep (95% intervals per cell are in `out/capture_sweep.csv`; for example the 40-member club at 0.5 is 16.3% [14.8, 17.7], at 0.2 it is 2.0% [0.4, 3.6]), minShare 1/2, shade 1/4, 25% of units shade (share of districts controlled, mean over 20 seeds; ground share in brackets):

| Club (members) | Concentration 0.2 | 0.5 | 0.9 |
|---|---|---|---|
| 40 | 2.0% (23%) | 16.3% (24%) | 20.0% (27%) |
| 20 | 0% (12%) | 6.8% (12%) | 10.0% (13%) |
| 10 | 0% (6%) | 2.7% (6%) | 5.0% (7%) |
| 5 | 0% | 0% | 1.7% |
| 3 | 0% | 0% | 0% |

Our hypothesis that dense clubs would win a larger district share than their ground share was not supported: with the share rule, district share stays below ground share for every club here. What is supported: a club with the same ground but low concentration wins nothing, and small clubs win nothing even at full concentration. Size and concentration both gate control. At concentration 0.2 the largest club controls 2% of districts with 23% of the ground.

**F2. Most of the map controlled by nobody (H2 supported; per-cell intervals in `out/capture_sweep.csv`, 20 seeds).** With shade 1/4: share of districts that end below_share is 96% (concentration 0.2), 69% (0.5), 41% (0.9) at minShare 1/2. Total share controlled: minShare 1/3 gives 22%, 36%, 43%; 1/2 gives 2%, 26%, 37%; 2/3 gives 0%, 7%, 34% (summed over clubs, concentration 0.2, 0.5, 0.9). Unclubbed walkers dilute control by construction (test: 5 clubbed units against 5 unclubbed controls; against 6 does not). A low-density or solo-heavy city will show a map with almost no controlled districts. Whether that is desirable is D21.

**F3. Shade weight 1/4 against 1/3 hardly matters in a random mix (H3, arithmetic confirmed).** Exactly: four shade units tie one solid at 1/4, three at 1/3 (tests, including the boundary on both sides). In the seeded sweep (25% shade), total controlled share differs by under 1 point between 1/4 and 1/3. It matters only to a club that is mostly shade: 12 enclosed units are worth 3 solid-equivalents at 1/4 and 4 at 1/3. If shade is cheaper to obtain than stepping on ground, 1/3 gives a shade-heavy club 33% more weight than 1/4. This depends on D15 and on how cheap shade is, which this model does not set.

**F4. Club switching and hopping (H4 supported).** A walker alternating clubs daily over 30 days flips a contested district's controller on 29 days under an immediate rule and 28 days under a next-day rule; a next-day rule only delays. With a 7-day per-walker switch cooldown on top, 4 flips (`out/hopping.json`). The same applies to credits: `club_credits` attributes each day's credits to the club the member was in that day, so a hopper can bring a day's credits to the club that needs them. Recommendation for D18: at most one club at a time; next-day effect so no one switches after seeing a day close; plus a switch cooldown (7 days proposed) and, optionally, new-member ground counting for control only after a settle-in period (PILOT ASSUMPTION). A gap day between clubs makes the walker's ground unclubbed that day (test).

**F5. Hazard: one bad membership row blanks district control for everyone (documented as a failing-by-design test, H5).** `districtControl` returns no districts if the snapshot has any problem (`clubsDistricts.ts:338`). A single walker in two clubs on one day (a join racing a leave) removes control for every district, including districts in which that walker holds nothing (test `documents hazard`). Patch recommendation, not applied: the membership service enforces one open span per walker; the caller excludes only the offending walker for the day and reports it, rather than blanking the day.

**F6. District boundary cases.** A club one unit ahead in a stripe loses control when a rival takes one boundary unit (test). Moving the boundary by one column, with no one moving, changes who controls (test). Control is therefore sensitive to where lines are drawn and to who holds a few units on them. A throwing or empty `districtOf` refuses the whole day (reported, not guessed). Hazard: leaderboard `club_district_days` recomputes control from the `districtOf` the caller supplies at read time; a redrawn map would rewrite past seasons' results (test). Recommendation: store each day's `DistrictControlResult` with a `districtMapVersion` at settlement and never recompute history. No real boundary is proposed.

**F7. Equal-score ties.** District ties control nothing (good: no hidden favourite). Leaderboard ties share a rank but are listed by id, so cutting a board at the top two of three tied rows keeps the alphabetically earlier ids (test). Recommendation: when a prize, badge or display cut-off sits inside a tie, keep every row with the cut-off rank (`topWithTies`), or break ties by a stated, fair rule chosen by the owner (D22).

**F8. New-club fairness.** Raw `club_credits` ranks by size: with equal per-member credits a 20-member club scores over five times a 3-member club (test); per-capita scores are within 1% of each other (test). A 3-member club wins no districts even at concentration 0.9 in the sweep. A new club can only control ground nobody else holds. Proposal: offer a per-active-member board and a size band (for example 1 to 5, 6 to 20, 21 plus) as the default view for clubs; keep district control as it is.

**F9. Leaderboards from settled activity only (VERIFIED CODE, tested).** No settled day gives an empty board with `throughDay: null`; a refused day, a repeated day, or a day from another season refuses the whole board; days in any order give the same board. A board is never live and never seeded.

**F10. `settleCreditsDay` is deterministic and balanced, but not idempotent when the participant set changes.** Re-running a settled day with a player removed reassigns that player's share to the others (a transfer relative to what was paid: 3.75M to 7.5M micro for the one remaining player in the test; the pool total is unchanged, so this is expected pool arithmetic, not a mint). Corrections must be line withdrawals, never re-settlement. Proposal (consistent with B6): withdraw the removed player's line and return it to the season pool or burn it; leave every other settled line untouched; a board shows the corrected rank by re-reading lines, not by re-running the day. No correction may create credit.

## 3. Aggregation thresholds for public boards (PILOT ASSUMPTION, `publishBoard` in `clubs/harness.ts`)

- Club and district rows are shown only if at least k = 5 distinct active contributors fed them in the period; smaller groups are merged into one "other" line. If exactly one row would be hidden, the smallest shown row joins it, so a total minus the shown rows never isolates one small group (complementary suppression; tested with k = 5).
- Player rows only for players who opted in to a display alias, and only on layers where the cohort is at least 20 (city and above); block and suburb layers show club and district aggregates only, never individuals.
- Boards update on settled boundaries (daily at the earliest, weekly proposed) and never show deltas smaller than one settled day, so repeated snapshots cannot difference out one person.
- No row exposes route, time of day, unit id or home area. k = 5 and 20 are proposals to be tested with a real cohort, not recommendations from data.

## 4. Appeal windows and seasonal reset (PILOT ASSUMPTION, `boardPhase`, tested)

Season = 90 days (SOURCE via `EconomyRules.seasonDays`). Proposed phases: provisional while the season runs; appeal_open for 14 days after season end; final after. Appeals during provisional and appeal_open correct individual lines only (F10); after final nothing changes. A day belongs to one season; a day from another season refuses the board (test). The model does not reset clubs: a membership spanning the reset stays valid in the new season (test). Whether clubs, district control and club identity reset, and whether the appeal window is 14 days, are owner decisions.

## 5. Priority tests for the private credits-only prototype

1. Membership service rejects a second open span and never lets one bad row blank a day (F5).
2. One-club-at-a-time with next-day effect and a switch cooldown; test a 30-day hopper (F4).
3. District map versioning: stored control result per day, never recomputed (F6).
4. Boundary sensitivity report: units needed to change each district's controller, shown to the owner before D20 and D21 are fixed (F6).
5. Share of districts with no controller under realistic density (F2); decide minShare against that, not intuition.
6. Tie handling at every cut-off (F7).
7. Corrections never re-settle (F10); any correction is a withdrawal or burn with a test that no other line changes (F10).
8. k-threshold publishing and complementary suppression on real counts, before any public board (section 3).
9. Per-capita and size-band boards for new clubs (F8).
10. Shade weight sensitivity once D15 and shade acquisition cost are fixed (F3).

## 6. Open owner decisions

D18 (clubs at once; effective date; cooldown), D19 (what a contribution is worth; we did not weigh it), D20 (what a district is; synthetic here), D21 (shadeWeight and minShare; findings above give the trade, not an answer), D22 (what a board ranks; tie-break; size-banding), D23 (pushing a club-mate's ground; counted, not decided). Also: appeal window length, season reset scope, k thresholds.

Not modelled: contribution weights, club-mate erosion, club identity abuse (renaming, merging, splitting to dodge thresholds), coordinated multi-club behaviour, real geography, real density, and any behaviour of real players.
