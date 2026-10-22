# Source to implementation gap matrix (Track B, B1)

**Base:** `cb27318`. **Source:** MovenRun Game Economy V3, revision 2, 31 August 2026 (cited as V3 §N; text not committed).
**Machine-readable companion:** `SOURCE_RULE_CATALOGUE.json` (79 entries, stable ids). **Checks:** `research/economy-redteam/catalogue/` (worked-example rows in `out/worked_examples.json` and `.csv`).

```
node --import tsx --test 'research/economy-redteam/catalogue/**/*.test.ts'     # 21 tests
node --import tsx research/economy-redteam/catalogue/run.ts                     # writes out/
```

Evidence tiers: SOURCE, OWNER DECISION, PILOT ASSUMPTION, VERIFIED CODE (file:line at `cb27318`, or a test here), SYNTHETIC EXPERIMENT. There is no HOSTED PROOF: nothing here was observed on a live system. The checks use no random draws.

## Two flags first

- **No token exists.** No V3 token is deployed, issued, listed or saleable (V3 §1, §31). The gameplay server at this base settles off-chain **credits** behind a flag that is off by default. Credits are not $MOVE in any state, locked or liquid.
- **400M is an allocation horizon, not supply.** "400 million over about 180 seasons, about 44 years" (V3 §17, §29) is the source's release schedule for the player allocation. It is not circulating supply, a valuation or a forecast. Ceiling trims are never issued, so issuance can only fall below it.

## Hypotheses stated before the checks were run

- H1: every worked figure in the source reproduces from its own stated inputs at the precision it prints.
- H2: the reference model reproduces Meera's (§18) and Dan's (§19) printed figures at printed precision from the source's literal inputs.

Result: H1 holds step by step from the printed intermediates, and fails in eight rows when computed exactly or cross-checked (below). H2 fails in seven rows. Every failure is explained by rounding of intermediates or by the toll-basis question (D10). None shows an arithmetic defect in the code.

## Matrix

"Ratify?" means the owner has to decide or ratify something before the rule can be called settled. Line references are at `cb27318`.

| Id | Source rule | Class (V3 §29) | Code | Tests | Mismatch | Resolution | Ratify? |
|---|---|---|---|---|---|---|---|
| SRC-SUPPLY-CAP | 1,000,000,000 cap, no raise (§1, §17) | FIXED | none in V3 model; older-design `contracts/src/MoveToken.sol:17` | contracts (older design) | none | invariant for any future contract | no |
| SRC-PLAYER-ALLOCATION | 400M over ~180 seasons (~44 y) | FIXED | `economyV3.ts:87,123-136` | economyV3, catalogue | none (179.27 seasons, 44.2 y) | always label as an allocation horizon | no |
| SRC-SEASON-POOL | 9M, −10%/season, floor 2M | FIXED | `economyV3.ts:83-85,123-136` | economyV3, catalogue | none | — | no |
| SRC-DAILY-POOL-S1 | 100,000/day in season one | FIXED | `economyV3.ts:82,142-144` | economyV3 | later seasons = pool ÷ 90 is assumption A3 | ratify A3 | yes |
| SRC-CEIL-SESSION / DAY | 12 per session / 20 per day | HYPOTHESIS | `economyV3.ts:95-96,388-398` | economyV3 | none | — | no |
| SRC-CEIL-RATIO | 0.6, one session never maxes a day | FIXED | implied by two constants | catalogue | FIXED ratio over two HYPOTHESIS values; nothing ties them | validate the ratio per rules version | yes |
| SRC-CEIL-ORDER | "trimmed by the two ceilings" (order unstated) | unlabelled | `economyV3.ts:388-398` (A7) | catalogue | order changes totals: [10,10]=20 vs [12,6.67]=18.67 | ratify A7 | yes |
| SRC-TRIM-RETURN | trims go back to the season pool and spread over its remaining days | FIXED | `economyV3.ts:459`; `holdingSettlement.ts:315,359` | holdingSettlement | counted as returned, never re-spread | owner names the spreading rule | yes |
| SRC-LIQUID-VALVE | liquid issuance capped at revenue | FIXED | none | none | not built | D11, legal sign-off | yes |
| SRC-LOCKED-LIQUID-FIRST-DEED | pre-deed rewards locked for ever, in the token contract | unlabelled | none | none | not built | keep out of the pilot | yes |
| SRC-SESSION-MIN | 10 min and 750 m | HYPOTHESIS | `economyV3.ts:88-89,149-151` | economyV3 | none | — | no |
| SRC-SESSION-MERGE | pauses under 30 min merge | HYPOTHESIS | none | none | not built | build in the pipeline | no |
| SRC-SCORING-SESSIONS | 2 score a day | FIXED | `economyV3.ts:189-197` | economyV3 | none | — | no |
| SRC-UNSCORED-MARK | mark a session unscored before start | unlabelled | model `economyV3.ts:177-178,192`; server never sets it (`service.ts:985`) | economyV3 | not wired | carry the flag from the session | no |
| SRC-CONSISTENCY | ×1.00 to ×1.50 at six days | FIXED | `economyV3.ts:165-172`; rolling 7 days `service.ts:955-958,991-993` | economyV3 | linear (A4); "week" read as a rolling 7 days | ratify A4 and the week | yes |
| SRC-TRUST-WEIGHT | 0 to 1, withheld stays in pool | HYPOTHESIS | `economyV3.ts:385-392`; pilot 1 for all `rules.ts:242` | economyV3 | no trust service | build before locked tokens | no |
| SRC-DAY-SHARE | median active player's earnings | unlabelled | `economyV3.ts:400-407` (A2) | economyV3, catalogue | none (2.50 reproduced) | ratify A2 | yes |
| SRC-RECHARGE-RATE / BASE | charge used × kit rate × day reward, on gross | HYPOTHESIS / unlabelled | `economyV3.ts:99,291,426-434` | economyV3, catalogue | none: gross before toll, as §18 step 8 | — | no |
| SRC-AUTO-CHARGE-CAP | recharge + upkeep ≤ 60%; toll excluded | FIXED | `economyV3.ts:295-302,481-482` | economyV3, catalogue | "paid in condition" changes no strength (D14) | decide D14 | yes |
| SRC-SEAL | nothing claimed until sealed; 150 m / own ground / own trail | HYPOTHESIS (rule 3 itself unlabelled) | engine `sealing.ts:94,114,612-615`; server `service.ts:380,404-411` | sealing | **the server pushes every verified session's units as claims without reading the seal result**, under 1001 and 1002 | gate pushes on the server's seal result, or record this as a pilot deviation | yes |
| SRC-SOLID-STRENGTH | stepped cells claim at 100 | FIXED | `holding.ts:30-32,158-164` | holding | 1002 pushes interpolated units as solid | see Rule 1002 deviations | yes |
| SRC-SHADE-* | shade 25 × shape × sprawl; sprawl 12; decay ×3; never deeds or tolls | HYPOTHESIS / FIXED | `holding.ts:33-34,170,248-255,335` | holding | shade not built (D2) | decide D2 | yes |
| SRC-MASKED | restricted areas never claimable | FIXED | `holding.ts:226,334` | holding | no mask data (D3) | decide D3 | yes |
| SRC-HOLDING-PUSH-FLIP | at 0 the cell flips, carrying the overflow | unlabelled | `holding.ts:259-274` | holding | exact-zero overflow kept at 1 (A9) | ratify A9 | yes |
| SRC-UPKEEP | 0.03 day-shares × zones^0.25 per unvisited zone | HYPOTHESIS | `economyV3.ts:100-102,249-260` | economyV3, catalogue | §7 16-zone row prints 1.00 for 0.96 | treat formula as authoritative | yes |
| SRC-AWAY-DAYS | 14 free away days a season | FIXED | model flag `economyV3.ts:253,257`; server never sets it (`service.ts:987-995`) | economyV3 | not available in the pilot server | decide D17 and wire it | yes |
| SRC-LAND-LEVELS / LOSE-ZONE | 5 levels; loss drops two, restore in 14 days | HYPOTHESIS / FIXED | `holding.ts:45-47,180,271` | holding | loss resets to level 1, no restore | decide D16 | yes |
| SRC-FORTIFY | +30%, 3 slots, expires, ≤ +15% in contest | FIXED | one boolean `holding.ts:39-41,106` | holding | no slots or expiry (D9) | decide D9 | yes |
| SRC-DEED-* | 21 days; 30 people / 10 days; 20% cluster; per-city cap | HYPOTHESIS / FIXED | none | none | not built; FIXED city cap has no value | decide D6 | yes |
| SRC-CONTEST | 72 h, 7 days best 3, 5-10%, 30 d / 14 d | FIXED (home advantage HYPOTHESIS) | none | none | not built | decide D7 | yes |
| SRC-TOLL-RATE | 2% of a session, once, in total | FIXED · NOT GOVERNABLE | `economyV3.ts:97,215-240,414-425` | economyV3, catalogue | §18 applies it per day, §20 per session (D10) | owner decides D10 | yes |
| SRC-TOLL-SPLIT / NO-SURCHARGE | split by deeded cells; never above 2% | FIXED / unlabelled | `economyV3.ts:222-239,480` | economyV3, catalogue | none | — | no |
| SRC-TOLL-EXCLUSIONS | own and linked free; laps once; remainder to runner; shade never | FIXED | `economyV3.ts:222-239,413` | economyV3, catalogue | no linked-account source in pilot | needed before deeds | no |
| SRC-TOLL-SEASON-BOUND | 180,000 in season one | STRUCTURAL | implied `economyV3.ts:480` | catalogue | none | — | no |
| SRC-TOLL-OWNER-UNCAPPED | no cap per owner | DELIBERATE | `economyV3.ts:409-447` | — | none | — | no |
| SRC-BURN-REAL | sinks destroy; never re-issued | unlabelled | credits only `economyV3.ts:458`; older contract `_burn` `MoveToken.sol:121-130` | economyV3 | deployed bytecode not inspected (§22 says it transfers to treasury) | contract lane compares offline | no |
| SRC-DAILY-SETTLEMENT | once a day, halts if books fail | unlabelled | `holdingSettlement.ts:245-301`; `rules.ts:56-61,409-412` | holdingSettlement | UTC day of last fix (D1) | decide D1 | yes |
| SRC-RAW-LOCATION-RETENTION | raw GPS 24-72 h | TARGET | none | none | res10 cell paths kept 14 days (proposal) | decide derived-path retention | yes |
| SRC-LABEL-CREDITS-VS-TOKEN | phase 1 credits, $MOVE is one token | unlabelled | `holdingSettlement.ts:14-19`; `economyV3.ts:26-29,34`; `0011…sql:553,557` | — | token words (MOVE, minted, burned) on credits | name pilot columns in credit terms | no |

### Not in the source: pilot rule set and owner-decision values

| Id | Value | Where it comes from | Code | Ratify? |
|---|---|---|---|---|
| PILOT-TAKE-BUDGET-13 | 13 takes per walker per day, in walk order | sim-pilot-2 (5 × 201/76) | `rules.ts:147-174,268`; `policy.ts:138-141` | yes |
| PILOT-UNIT-BUDGET-300 | 300 units per walker per day | storage capacity guard | `capacity.ts:433`; `service.ts:47-50,262` | yes |
| PILOT-SECOND-PUSH-GAP-20H | 20 h by server receipt | 1002 day-boundary guard | `rules.ts:121-139,266`; `policy.ts:220` | yes |
| PILOT-CHALLENGE-WINDOW | window 3, floor 50, immediate below 30 | sim-pilot-2 | `holding.ts:71-87,282-316`; `rules.ts:262,265` | yes |
| PILOT-RES10-UNITS-RES9-ZONES | res10 units in res9 zones, per-holder split | sim-pilot-2; 1001 uses the stored res8 cell | `rules.ts:194-213,269-273,384-391` | yes (D5) |
| PILOT-RES10-INTERPOLATION | interpolated units push as solid | 1002 path rule | `path.ts:64-74,170-178`; `service.ts:404-411,497-505` | yes |
| PILOT-ONE-PUSH-PER-WALKER-UNIT-DAY | 1 hostile push per walker, unit and day | **owner decision 17 Oct (A9)**, not source | `holding.ts:244-246`; `0011…sql:283` | no (already decided) |
| PILOT-SOLID-DECAY | 3 per day | sim-pilot-1 (D4) | `rules.ts:229,259` | yes |
| PILOT-STAGE-FLOORS | 60 / 30 / 10 | sim-pilot-1 (D4) | `rules.ts:231,261` | yes |
| PILOT-RETENTION-14-120 | raw 14 days, proofs 120 days | storage study, proposal only | `capacity.ts:129-140` | yes |
| PILOT-PLAYER-CAP-200 | ≤ 200 players, one season | storage forecast | none | yes (source phase 1 says 1,000-5,000) |
| PILOT-DAY-ATTRIBUTION-UTC | UTC day of last fix, 2 h grace | D1 proposal | `rules.ts:55-61,236-237` | yes |
| PILOT-SHADE-NOT-HELD | shade-only ground pays no upkeep | D15 proposal | `rules.ts:72-73,238` | yes |

## Worked examples: source against code

| Figure | Source prints | Exact from source inputs | Code (`settleCreditsDay`, source population) | Agrees at printed precision? |
|---|---|---|---|---|
| Day-share (§18) | 2.50 | 2.50 | 2.50 | yes |
| Meera gross (§18 step 4) | 3.68 | 3.689 | 3.689 | no (source multiplies rounded 1.667 × 2.21) |
| Meera toll (§18 step 6) | 0.02 (0.0184, day basis) | 0.0092 (§20 per session, evening crossed 12) | 0.0092 (12-cell evening); 0.0184 only if the evening crossed 6 | no (D10) |
| Ravi / Sam (§18 step 7) | 0.012 / 0.006 | — | 0.0061 / 0.0031 (12-cell evening) | no (D10) |
| Recharge (§18 step 8) | 0.92 | 0.922 | 0.922 | yes, and both use the gross reward before the toll |
| Upkeep (§18 step 9) | 0.47 | 0.4695 | 0.4695 | yes |
| 60% check (§18 step 10) | 38% | 37.8% | 37.7% | yes, toll excluded in both |
| Credited (§18 step 11) | 2.27 | 2.279 (day toll) / 2.288 (session toll) | 2.288 (12-cell) / 2.279 (6-cell) | no (rounded intermediates) |
| Dan upkeep owed (§19) | 3.02 day-shares, 7.55 | 3.0179, 7.5446 | 7.5446, all paid in condition | 3.02 yes; 7.55 no |
| §7 16 zones, all unvisited | 1.00 / 7.0 a week | 0.96 / 6.72 | 0.96 | no |
| §7 30 zones, per week | 14.8 | 14.74 | — | no (7 × rounded 2.11) |
| §20 toll table rows | 0.00 / 19.73 / 19.60 / 0.10 / 0.05 | same | same | yes |
| §17 2.37 vs 1.00 | 2.37, 1.00 | 2.372, 1.00 | effort × consistency reproduces | yes |
| §17 12/20 | 0.6 | 0.6 | constants | yes |
| §17 schedule | 400M, ~180 seasons, ~44 years | 400M, 179.27 seasons (15 above the floor), 44.2 years | 400M over 180 seasons, the last partial | yes |
| §20 season-one toll bound | 180,000 | 9M × 2% | implied by the per-day 2% check | yes |

Season count: the model releases the 400M in 179.27 seasons (180 counting the last, partial season), against the source's "roughly 180"; the two agree.

Rounding and remainders, checked in code: each owner's share is floored and the remainder stays with the runner (`economyV3.ts:232-239`); a 20,000.02-micro toll split three ways pays 19,998 and leaves 2.02 with the runner. Recharge is on the gross day reward before the toll, as in §18 step 8. The per-session ceiling applies before the day ceiling (A7).

## Source internal inconsistencies

1. **Toll basis (§18 against §20 and rule 4).** §20 defines the toll on "your session reward". §18 step 6 applies it to Meera's whole day (3.68 × 2% × 25%), although it says her *evening* loop crossed the deeded cells. On the §20 reading the evening session alone (1.84) pays 0.0092, half the printed figure. The two agree only if the tolled session's deeded share is twice the day's. The repo's own settlement test makes them agree by giving the evening session 6 cells, not 12. Open as D10.
2. **§7 table, 16-zone row.** The formula gives 0.96 day-shares a day and 6.72 a week; the table prints 1.00 and 7.0 and calls it the break-even. The 30-zone weekly figure (14.8) is 7 × the rounded 2.11; exact is 14.74.
3. **Rounded intermediates in the worked days.** Meera's gross is printed 3.68 (from 1.667 × 2.21); exact is 3.689, and the net is 2.28-2.29, not 2.27. Dan's 7.55 multiplies the rounded 3.02; exact is 7.5446.
4. **The §20 toll table uses a 20.00 session,** which the §17 per-session ceiling of 12 cannot produce. The percentages are right; the session figure is illustrative.
5. **Ravi's deed against his upkeep (§20).** 0.45 day-shares is "comfortably more than ten times the upkeep on his three zones" only if at most one of the three goes unvisited. With all three unvisited the upkeep is 0.118 day-shares and the ratio is 3.8.
6. **2.37 against 1.00 (§17)** compares one day at the sixth active day with one weekly run. Over a week, under linear consistency, the ratio is about 11.9. The claim "well over a factor of two" holds either way.
7. **FIXED ratio over HYPOTHESIS ceilings (§29).** The 0.6 ratio is FIXED while both 12 and 20 are HYPOTHESIS, so either ceiling can only be recalibrated together with the other.
8. **FIXED with no value (§29).** "Deeds per person per city: capped, FIXED" has no number anywhere in the source (§12 says "published share").
9. **Trimmed amounts (§17).** "Spreads across the season's remaining days" is not given a formula, while the daily pool is quoted as a fixed 100,000.

## Rule 1002 deviations from source

Rule set 1001 stays the default. Rule set 1002 is an unratified, not-live alternative, approved only for pilot development and comparison (docs/G34_SERVER_ARCHITECTURE.md §15).

1. **Two-day challenge against §5's immediate flip.** §5: when strength hits zero "the cell flips to them". Under 1002 a first push that would reach zero leaves the unit at 50 (or lower if it was lower) and records a challenge. The same walker flips it only with a second push on a later day within the 3-day window, unless the holder stepped on it in between. Ground under 30 and stepped-on shade still fall at once. **Deviation; needs formal ratification, change or drop.**
2. **20-hour second-push gap.** On top of the challenge, the completing push must be received at least 20 hours after the opening one, by server receipt. This delays the flip further and has no source basis. It is a guard against completing a challenge across midnight in minutes. **Deviation; ratify with item 1 or drop.**
3. **One hostile push per walker, unit and day.** This is an owner decision (A9, 17 October), not a source rule, and applies to 1001 and 1002 alike. It is a limit on top of §5. It does not authorise any extra hostile push after a flip: a walker who flips a unit and loses it back the same day is refused a second push (verified: `owner rule A9` test). The 13-a-day take budget is a further, separate limit with no source basis.
4. **Res10 route interpolation against "cells you stepped on".** §3 and §4 make stepped cells solid and enclosed cells shade; assumption A1 says a cell inferred between fixes is not stepped on and never claims, defends, erodes or counts traffic. Under 1002 (`pushInterpolated: true`) units crossed by the straight segment between two accepted fixes are pushed with kind `solid`, so they claim, erode, flip, defend by visit and count as upkeep visits. The toll alone reads stepped units only. Any future deed-traffic count built on the ledger would inherit interpolated ground unless it excludes it. **Flagged for formal owner ratification and integrity testing; not resolved here.**
5. **Units and zones (D5).** Res10 units in res9 zones, split per holder, are a pilot proposal. The source tolls and deeds cells and charges upkeep per zone but defines neither.

Not specific to 1002 but found here: **the server does not enforce "nothing is claimed until sealed" (rule 3).** Under both rule sets `applySession` pushes every unit of any verified session and never reads the session's seal result (`service.ts:380,404-411`).

## Labelling: credits and the token

The source has one fungible token, $MOVE, in a locked or liquid state on one ledger (§16, §21). Phase 1 (§32) is credits only, with no transferable reward. At this base the settlement module and the API call the pilot's units credits. The reference model and the proposed tables still use token words for them: `MICRO_PER_MOVE` and "micro-MOVE" (`economyV3.ts:26-29,34`), and `minted_micro`/`burned_micro` columns (`0011_gameplay_holdings.sql:553,557`). This is not a functional defect. A reader of an export could still take credits for $MOVE. Recommendation: name pilot columns and exports in credit terms, or annotate them, and keep "$MOVE" for the token.

## Owner decisions this matrix asks for

D10 toll basis; A7 ceiling order; the trimmed-pool spreading rule; ratify, change or drop 1002's two-day challenge and 20-hour gap (§5 deviation); res10 interpolation as solid (A1 departure); seal enforcement on the server (rule 3); D14 paid in condition; D17 away days; D16 levels on loss; A2, A3 and A4; the 200-player cap against the source's 1,000-5,000 phase 1.

## What was not done

Nothing ran against a database, a chain or a live API. Deployed contract bytecode was not inspected. Sealing, shade, deeds, contests, fortify slots and the liquid valve are unbuilt, so they are catalogued from the source and from the absence of code, not tested.
