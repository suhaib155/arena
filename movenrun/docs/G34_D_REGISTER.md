# G3/G4 decision register: source ambiguities with worked cases

This register extends the existing D-list in `GAME_ECONOMY_V3.md` §8 and `G34_SERVER_ARCHITECTURE.md` §12. Ids D1–D23 keep their meaning, and D24–D27 are new. Each entry has four parts:

- what the V3 source says;
- what the code does today;
- worked cases under each reading;
- what the owner has to decide.

Nothing here changes a rule. The code's current reading stays until the owner decides. Amounts are off-chain credits: 1 = 1,000,000 micro. The cases were recomputed with `shared/src/domain/economyV3.ts` where the code implements the reading, and by hand otherwise; hand results are marked *(hand)*.

## D10: toll basis, per session or per day

- **Source.** §20 and rule 4 apply 2% to each *session's* reward, times the share of the route that is on other people's deeds. Meera's example (§18 step 6) applies it to her *day* total over "the 12 cells she crossed".
- **Code.** Per session (`sessionToll`, called once per scoring session). No deeds exist yet, so no toll is ever charged.

**Worked cases.** Meera's day reward is 3.68: two sessions of 1.84 each. Her day crossed 12 distinct cells, 3 of them on others' deeds (Ravi 2, Sam 1), all crossed in the evening session.

| Evening session crossed | Per session (code) | Per day (§18 example) |
|---|---|---|
| 6 cells (3 deeded) | 0.018399 (Ravi 0.012266, Sam 0.006133; 1 micro stays with Meera) | 0.0184 |
| 12 cells (3 deeded) | 0.009199 | 0.0184 |
| 3 cells (all deeded) | 0.036799 | 0.0184 |

A further case:

- **Both sessions cross the same deeded cell:**
  - per session, the owner is paid twice (once per session);
  - per day, the owner is paid once, on the day total.
- **Bound:** under either reading the toll is at most 2% of the day reward. That is 0.40 at the 20 ceiling.

**Decide.** Choose the per-session or the per-day basis, and if the day basis, say what "cells she crossed" means across two sessions.

## D24: upkeep at 16 zones, formula 0.96 against the printed 1.00

- **Source.** §7 formula: 0.03 day-shares × zones^0.25 per unvisited zone. The §7 table prints 1.00 day-shares a day (7.0 a week) at 16 zones and calls that the break-even.
- **Code.** The formula: 16 zones, all unvisited, Camp level gives 0.96 day-shares a day (0.06 per zone). The upkeep table test accepts 1.0 within 0.05, so the printed row passes by tolerance.

**Worked cases**, with a day-share of 2.50:

| Reading | Per day | Per week |
|---|---|---|
| Formula (code) | 0.96 × 2.50 = 2.40 | 6.72 day-shares = 16.80 |
| Printed row | 1.00 × 2.50 = 2.50 | 7.00 day-shares = 17.50 |

- Either way, the 60% charge cap usually binds first. Owed 2.40 against a day reward of 3.00 means the cap is 1.80 minus recharge. Any rest is paid in condition (D14).
- The 30-zone weekly figure (14.8) is 7 × the rounded 2.11. The exact value is 14.74.

**Decide.** Is the formula authoritative (and the table row a rounding), or the printed break-even (which would change the exponent or the base)?

## D25: ceiling order (trust, session ceiling, day ceiling)

- **Source.** §17 says the reward is "trimmed by the two ceilings" and that trust weight is 0–1, "the difference stays in the pool". It does not give the order.
- **Code** (A6, A7):
  1. the pool split;
  2. × trust;
  3. the session ceiling (12);
  4. the day ceiling (20), trimming the sessions in proportion with floors.

**Worked cases.** Both sessions before ceilings are 15 and 9:

| Order | Trust 1 | Trust 0.8 |
|---|---|---|
| Code: trust → session → day | [12, 9] = 21 → [11.428571, 8.571428] = 19.999999 | [12, 7.2] = 19.2 |
| Session → day → trust *(hand)* | 19.999999 | 16.0 |
| Day (proportional) → session *(hand)* | 24 → [12.5, 7.5] → [12, 7.5] = 19.5 | [12, 7.2] = 19.2 *(hand)* |

Everything trimmed returns to the season pool (see D26).

**Decide.** Ratify A6 and A7, or choose another order. A6 is what decides how much a trust-weighted player loses.

## D26: trimmed-pool redistribution

- **Source.** §17: trimmed amounts go "back to the season pool; never cross a season". It also says they "spread across the season's remaining days". Separately, the daily pool is quoted as a fixed 100,000 in season 1.
- **Code.** The daily pool is static: season pool ÷ 90 (A3). Returned amounts are recorded per day (`returned_micro`) and are never re-issued. `settleCreditsSeason` now reports `unsettledPoolMicro` for days that were never settled.

**Worked case.** On day 1 of season 1, two players reach their ceilings (12 + 12) and 99,976 is returned.

| Reading | Day 2 pool | Season total issued at most |
|---|---|---|
| Static (code) | 100,000 | 9,000,000 minus everything returned (nothing returned is re-issued) |
| Spread over the remaining 89 days *(hand)* | 100,000 + floor(99,976 ÷ 89 in micro) = 101,123.325842 (62 micro of the 99,976 cannot be spread evenly) | 9,000,000 exactly, less the final day's undistributable remainder |

Under the spread reading, the last day's returned amount has no later day, so it is lost or burned. The source does not say which.

**Decide.**

- Static or spread.
- If spread: the rounding rule, what happens to the last day's remainder, and whether a refused day's pool spreads too.

## D27 (D6, numeric part): the city Deed cap

- **Source.** §12 calls the per-city cap FIXED, as "a published share", with no number. It does not say whether the cap is per holder or a total for the city.
- **Code.** Not built. A `deeded` column exists, and nothing can create a deed.

**Worked cases** *(hand)*, for a city of 5,000 deedable solid cells:

| Reading | Share 1% | Share 2% | Share 5% |
|---|---|---|---|
| Per holder (each holder at most) | 50 deeds | 100 | 250 |
| Total for the city (all holders together) | 50 deeds | 100 | 250 |

With the per-holder reading, related accounts (the D6 risk graph) must be pooled, or the cap is split across sock puppets. With the total reading, first come first served needs an ordering rule.

**Decide.**

- The number.
- Per holder or total.
- How "city" is bounded (the D20 layer).
- Whether related accounts share one cap.

## D18–D23: clubs and districts

| Id | Source | Code today (server, 0011 unapplied) | Worked case | Decide |
|---|---|---|---|---|
| D18 membership | §15: clubs exist. Count and timing open | One open membership per walker, held by a unique partial index (`gameplay_club_memberships_one_open`). Joining or leaving takes effect the next day (`clubChangeDelayDays`). A second club gets 409 `already_in_club`. A membership that never took effect is deleted on leave | Ana leaves club A on day 10 and joins B on day 10. She counts for A on day 10 and for B from day 11. Two overlapping spans on one day refuse that club day (model problem) | How many clubs at once, and the switching delay |
| D19 contribution worth | §15: no tokens from clubs | Counted unweighted by outcome and kind. Totals are stored per club and day. The simulation used claimed 1, flipped 1, eroded 0.5, reinforced 0.25 | A member with 3 claims, 2 flips, 4 erosions and 8 reinforces scores 17 unweighted, and 3 + 2 + 2 + 2 = 9 under the simulation weights | The weights, and whether club-mate pushes count |
| D20 districts | §15 layers: block, suburb, city, country, world | `gameplay_unit_districts` (unit, district, `districts_version`), loaded by an operator and empty until then. A held unit with no district refuses the club and district day. The version is bound into the day's input digest | A map update from v1 to v2 between days 30 and 31: day 30 stays settled under v1, and day 31 reads v2. A replay of day 30 after the update reports a mismatch (the input changed) | Polygon source, versioning and the layers |
| D21 control | §4: solid and shade both count | Shade 1/4, a minimum share of 1/3 of the district's held weight, and a strict lead. A tie controls nothing | District held weight 30. Club A has 8 solid + 8 shade = 10. Club B has 9 solid = 9. A has 10/30 = 1/3 and leads, so A controls. If B gains 1 solid, the clubs tie at 10 and nobody controls | Shade weight, minimum share, tie rule |
| D22 board | §15: layered leaderboards | Built from settled days only (now re-verified, see `G34_SERVER_ARCHITECTURE.md` §17). Equal scores share a rank and are listed by id. Player rows are anonymous except the caller's own (`self`). Nothing is seeded | Two clubs with 12 district-days each are both rank 1, listed by club id | Metric and tie-break |
| D23 club-mate erosion | Not in source | Erodes: the holding model has no clubs. Contributions count such pushes separately | Ben pushes clubmate Ana's 60-strength unit: it erodes as any other walker's push would, and the push is not counted as a contribution | Immunity or not |

**Current state against the packet's club checks (item 6).** Documented here only; no club code was changed.

- **One active club.** Enforced by the database (a unique partial index) and the service. Tested in `gameplay.pg.test.ts`.
- **Switching race.** `joinInTx` locks the open row `FOR UPDATE`, and the unique index refuses a second open row. Two concurrent joins to different clubs are **not** tested on their own. **Gap:** add a concurrent join test.
- **Consent.** Joining is the walker's own authenticated request, and nobody can add another person. There is no invite or accept flow, and no recorded consent text. **Gap**, before any public club.
- **Aggregation privacy.**
  - Club days store member counts and totals, never per member.
  - The board anonymises players, and problem text never leaves the server.
  - **Gap:** small clubs (one or two members) make the totals personal. No minimum-size suppression exists.
- **Versioned district maps.** The version is stored per unit and bound into the input digest. **Gap:** there is no loader and no polygon source (D20). Until then every club and district day is refused.
- **Season reset.**
  - The season board covers one season's settled days.
  - Memberships and holdings carry across seasons; nothing resets them.
  - **Gap:** the source says 90-day seasons, but whether clubs or district control reset at a season boundary is not decided and not modelled.
- **No seeded leaderboards or inferred ownership.**
  - The board has no rows until days settle.
  - District control is computed from held ground only.
  - Nothing infers ownership from GPS proximity.
