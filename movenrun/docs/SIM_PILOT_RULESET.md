# Simulation pilot ruleset `sim-pilot-1`

> **PILOT/SIMULATION ONLY — not final.** Nothing here is a decision. The values below are proposals that can be reversed. They exist so that one consistent configuration can run through the reference models and the owner can approve or change it as a whole, instead of answering 23 separate questions. Every number in the "finding" lines comes from synthetic players on a synthetic grid. None of it is a measurement of real people.

- Ruleset: `shared/src/sim/pilotRuleset.ts` (`SIM_PILOT_1`, `status: "SIMULATION_ONLY_NOT_PRODUCTION"`, holding rules version 9001, economy rules version 1 unchanged). The app, the backend and settlement import nothing from `shared/src/sim/`.
- Simulator: `shared/src/sim/simulate.ts`. It runs each day through the existing models in order: `applyLedger` → `holdingsAtDayClose` → `settleCreditsDay` → `clubSnapshot` / `clubContributions` / `districtControl` → `settleCreditsSeason` / `seasonLeaderboard`.
- Reproduce: `yarn workspace @movenrun/shared sim --seeds 1,2,3` runs the sweeps and prints the tables. `--pool --seeds 1` runs the 5,000-player context run, which takes about 2.5 minutes. Every number below is the mean over seeds 1, 2 and 3, with the min–max in brackets, unless it says otherwise.
- Source tags follow `docs/GAME_ECONOMY_V3.md`: **SOURCE §n** is quoted from the V3 source document, and **PILOT** is a proposal made here.

## What the simulation is

| | |
|---|---|
| City | A disc of radius 6 km, tiled with hexagonal logical units. The pilot unit edge is 201 m (919 units), which is the scale of H3 resolution 9. The grid is synthetic. H3 stays an internal index and nothing in it is shown to players. |
| Districts | 12 synthetic Voronoi polygons laid out in metres, versioned `sim-districts-v1`. They are the same polygons at every unit size. |
| Players | 368 in total: 200 casual (active 30% of days, 15–30 min walks from home), 100 regular (60%, 25–45 min), 40 heavy (90%, two 40–70 min sessions aimed at other people's ground), 8 colluders (one club that flip-trades its own ground), 4 club-switchers (2 "kingmakers" who move to whichever club their ground would make control a district, 2 "shields" who join the club attacking them), 8 route farmers (three 11-minute walks over the same three units every day), and 8 shade farmers (one club; big loops with sparse GPS fixes on even days, thin slivers on odd days). Casual and regular players each take one planned week away. These behaviours are assumptions, not data. |
| Season | 90 days (SOURCE §17). Each day: sessions are turned into pushes and applied to the ledger. 2% of the previous day's events are resent as retries and must all be skipped. Then come levels and D16, day close, credits (with D17 away rows), D14 condition decay for the next day, club switches, contributions and control. |
| Checks on every run | Every day settles and none is refused. On every day minted + returned = pool, credited + toll + burned = minted, toll paid = toll received, and the sum of the credit lines equals what was credited. The season settles. Retries skipped = retries sent. No event is rejected. **The owner rule holds: no walker pushes someone else's unit twice in one day** (0 violations, about 1,740 pushes refused by it each season). All 61 runs passed every check (20 cases × 3 seeds, plus the 5,000-player run). |

### What the simulator adds between model calls (none of this is in the models)

Level purchases (SOURCE §9: Camp needs 3 visits in 14 days and costs 2 day-shares; Holding needs 14 days held and costs 6). This level spend sits outside the models' books and is reported separately. Also added here: the D14 condition decay, the D16 level snapshot and restore, D17 choosing who gets an away row, D18 switch timing, D19 weights, and D23 immunity. D23 immunity drops a push before the ledger, judged on who held the unit at the start of the day.

## The finding that matters most, which is outside D2–D23

**At pilot density, ground churns. On average every held unit changes hands about twice a day: 217.6 flips per 100 held units per day (range 217.2–218.4).** A casual player's unit is taken 92.5 times per casual player per season, and only 24% of casual players still hold any ground at day 90 (range 19–26%). None of the decisions below moves casual day-90 retention by more than about 0.05, which is inside the spread between seeds. The causes are two things the owner has already kept:

- ASSUMPTION A9 with the source's numbers. A solid push is 100 and fresh ground is 100, so one walk flips undefended ground (SOURCE §4, §5).
- Density. Everyone's walks cross everyone else's ground.

The owner's 17 Oct rule (one push per walker per unit per day) only slows takeovers of ground with resistance. In the pilot only about 1% of held units are level 2 or higher at season end, because every flip resets the level.

| Context run (rules unchanged) | casual d90 | regular d90 | flips / 100 held / day |
|---|---|---|---|
| Pilot, 368 players | 0.24 (0.19–0.26) | 0.57 (0.51–0.60) | 217.6 |
| Half the population | 0.47 (0.42–0.52) | 0.79 (0.74–0.86) | 103.6 |
| No heavy attackers or switchers | 0.44 (0.40–0.48) | 0.84 (0.82–0.88) | 79.0 |
| 5,152 players in a 22.4 km city, same density, seed 1 | 0.20 | 0.48 | 237.2 |

This is reported for the owner to see, not decided here. The levers are A9, fortify (D9) and the unit size (D5, below).

**Follow-up:** `docs/SIM_CHURN_STUDY.md` compares those levers and more (a two-day challenge, flip and take caps, owner defence, fortify, 76 m units in 201 m zones, route farming) over three seeds with griefers and an attrition assumption, and proposes a combined `sim-pilot-2`. sim-pilot-1 and every number in this document are unchanged.

**A second finding, also outside the D list: credits are set by the ceilings, not by the pool.** With 368 players the season issued 235,449 of 9,000,000 credits (2.6%). With 5,152 players it issued 3,278,276 (36%). The pool binds only when about 5,000 or more players are active on the same day (100,000 ÷ 20 per player). Until then every active player earns the day ceiling, so credits follow active days and nothing else. Route farmers make two 11-minute walks a day, which meet the SOURCE §2 minimum of 10 minutes and 750 m, and they finish with the most credits: 1,350, the maximum possible for 90 days. Concentration is moderate: Gini 0.336 (0.334–0.338), top 10% of players hold 24.0% of credits. The minimum session and the effort floor are HYPOTHESIS values in SOURCE §2 and §17, and are worth recalibrating before the pilot.

## Recommended pilot ruleset (PILOT PROPOSALS)

| Id | Pilot value in `sim-pilot-1` | Key simulation number |
|---|---|---|
| D1 | Not set. The simulator numbers days 0–89 itself. | Not simulated |
| D2 | Shade = 25 × shape × sprawl. Sprawl thins in proportion past 12 enclosed units per stepped unit (SOURCE). Loops with a shape score below **0.35** are degenerate and claim no shade. | 286 sliver loops rejected per season. The ratio of 12 never came into play. |
| D3 | Not set (no masked units in the synthetic city) | Not simulated |
| D4 | Solid ground loses **3 strength per day** (shade 9, from SOURCE ×3). Stage floors **60 / 30 / 10**. | Decay rates from 2 to 8 per day change casual d90 only between 0.22 and 0.24 |
| D5 | Logical unit **201 m edge** (H3 resolution 9 scale, kept internal). A zone is a unit. | Casual d90: 0.08 at 531 m, 0.24 at 201 m, 0.52 at 76 m |
| D6–D13 | Not set (deeds, contests, kit, fortify, toll, valve, number format, wallets are outside this simulation) | Not simulated |
| D14 | Unpaid upkeep gives **one extra day of decay** to a share of the charged unvisited units equal to the unpaid share of the upkeep, rounded up. Units are taken **strongest first, then by unit id**. | 1 unit lost per season, against 4 when weakest go first and 5 when all units are hit |
| D15 | Ground held only as shade **does not pay upkeep** | Making shade pay raises units lost to unpaid upkeep from 1 to 42 |
| D16 | The new holder starts at level 1. The former holder's level snapshot is **restored if they reclaim within 14 days** (SOURCE). | 102 restores per season |
| D17 | Away days are **spent automatically** on any absent day while the player holds ground (14 per season, SOURCE) | Units decayed by unpaid upkeep: 80 (auto), 840 (player-selected), 2,390 (none) |
| D18 | **One club at a time**. Joining or leaving takes effect **the next day**. | Kingmaker district-days: 7.0 (next day) against 11.0 (same day) |
| D19 | Claimed 1, flipped 1, eroded 0.5, reinforced 0.25 (at most once per unit per 7 days). Each walker, unit and day counts once. Shade and pushes on club-mates' ground count 0. Refused pushes count 0. | Route farmer drops from 0.86× to 0.29× a regular player |
| D20 | Synthetic versioned polygons (`sim-districts-v1`, 12 districts), never derived from grid parent cells | Not simulated geographically |
| D21 | Shade weight **1/4** of solid. A club needs at least **1/3** of the district's held ground, and strictly more than any other club. | 5.6% of district-days controlled, 110 control changes per season |
| D22 | Club board ranks **`club_district_days`** from settled days. Equal scores share a rank and are listed by id. `player_credits` is not used as a ranking. | `player_credits` had 143 tied rows, with route farmers at the top |
| D23 | Pushes on a club-mate's ground **still erode it** (no immunity). Under D19 those pushes are worth nothing. | Immunity cut shield losses by only 6% and left casual retention at 0.24 |
| Owner rule | One push per walker per unit per day on someone else's ground. Enforced by the holding model, not a parameter. | 0 violations, about 1,740 refusals per season |

## Decision by decision

The sweeps change one decision at a time from the pilot. "Retention" is the share of casual players holding at least one unit at the close of day 30 / 60 / 90.

### D1 — session day and day close
- **Source:** §2 and §17, "Rewards settle once a day among the people who moved that day" (rule 7). DECISION NEEDED D1.
- **Compared:** nothing. The simulator gives each session a day index directly.
- **Cannot be simulated yet:** a later simulation needs timestamped sessions and time zones, including sessions that cross midnight.
- **Pilot value:** none. Stays open.

### D2 — shade shape and sprawl
- **Source:** §4, "Claim strength 25 × shape × sprawl (HYPOTHESIS)"; "shape: roundness of the loop; a circle is about 1, a thin sliver close to 0"; "sprawl: up to 12 enclosed cells per stepped cell at full strength; beyond that, shade thins in proportion".
- **Compared:** the pilot (sprawl 12 plus rejecting loops with shape below 0.35), sprawl with no rejection, and neither.
- **Partly simulated.** The simulator does not compute any geometry. Shape is an assumed score per synthetic loop type: 0.9 for a ring, 0.15 for a sliver. The sprawl factor is computed from counts of stepped and enclosed units. The roundness metric itself (for example 4πA/P² on the sealed polygon) needs the sealing engine's real loops. That is what a later simulation needs.
- **Exploits:** sparse-fix rings, where ASSUMPTION A1 leaves units with no verified fix un-stepped, and thin slivers.
- **Finding:**
  - At the pilot's 201 m units, "sprawl, no reject" and "neither" gave identical results. The largest enclosed-to-stepped ratio a synthetic loop can reach there is about 4.6 (a 70-minute sparse-fix ring: 8 stepped, 37 enclosed), so the SOURCE threshold of 12 never came into play. At 76 m units a sparse ring can pass 12 (about 20 stepped, 271 enclosed), so the threshold matters if units get smaller.
  - The shape cutoff rejected 286 (274–307) sliver loops per season, all of them shade farmers' slivers.
  - Shade is fragile with or without the cutoff. It decays at 9 per day from at most 22.5, so only 66 (54–83) units were held as shade at season end. Casual d90 was 0.24 with the cutoff and 0.20 without it, within noise.
  - Fairness: no effect on casual players.
- **Pilot value:** SOURCE formula, sprawl 12, minimum shape 0.35.

### D3 — masked areas
- **Source:** §4, masked cells are "unclaimable at any strength". DECISION NEEDED D3 (the data source).
- **Not simulated.** It needs a real map. The models already refuse pushes on masked units.
- **Pilot value:** none.

### D4 — decay rate and stage floors
- **Source:** §5, "Time drains strength daily from the last visit, through visible stages: held, at risk, contested, dormant, back on the map." The source gives no numbers. Shade decays "3× faster" (§4, HYPOTHESIS).
- **Compared:** decay of 2, 3, 5 and 8 per day, and stage floors 60/30/10 against 75/50/25.
- **Finding:**

  | Decay | Retention d30 / d60 / d90 | Flips / 100 held / day | Casual units lost to decay per player |
  |---|---|---|---|
  | 2 | 0.23 / 0.23 / 0.23 | 217.7 | 0.43 |
  | 3 (pilot) | 0.20 / 0.23 / 0.24 | 217.6 | 0.45 |
  | 5 | 0.20 / 0.23 / 0.23 | 216.8 | 0.51 |
  | 8 | 0.21 / 0.22 / 0.22 | 212.6 | 0.51 |

  - Decay hardly matters at this density. Ground changes hands by flips about 200 times as often as it runs out.
  - Stage floors are display only and change no mechanics. They do change what a casual player sees. With 60/30/10, casual-held units at season end were 45% held, 22% at risk, 17% contested and 16% dormant. With 75/50/25 the split was 33%, 29%, 15% and 24%.
- **Pilot value:** 3 per day. Solid ground then stays "held" for 14 days after a visit, reaches "at risk" (below 60) on day 14, "contested" (below 30) on day 24, "dormant" (below 10) on day 30, and is back on the map on day 34. Stage floors 60/30/10, so a casual player sees "held" more often.

### D5 — unit size and zone
- **Source:** "The source tolls and deeds *cells* but charges upkeep, levels and fortifies *zones*. It never defines a zone." The repo grid is H3 resolution 8 (531 m edge).
- **Compared:** unit edges of 531 m (169 units), 201 m (919) and 76 m (6,487) over the same city and players, with a zone equal to a unit. H3 stays internal, and the districts are the same geographic polygons at every size.
- **Finding:**

  | Unit edge | Retention d30 / d60 / d90 | Regular d90 | Flips / 100 held / day | Upkeep taken / paid in condition (credits) | Units decayed by unpaid upkeep |
  |---|---|---|---|---|---|
  | 531 m | 0.08 / 0.07 / 0.08 | 0.22 | 463.3 | 81 / 0 | 0 |
  | 201 m | 0.20 / 0.23 / 0.24 | 0.57 | 217.6 | 3,839 / 38 | 80 |
  | 76 m | 0.47 / 0.47 / 0.52 | 0.85 | 122.2 | 39,143 / 64,027 | 68,906 |

  - At resolution 8, a casual 20-minute walk touches about two units. Everyone overlaps, and only 8% of casual players hold ground.
  - Each step down in unit size doubles or triples casual retention (0.08, 0.24, 0.52).
  - At 76 m, with a zone equal to a unit, upkeep grows with zones^1.25 per player and swamps the 60% cap.
- **Pilot value:** 201 m (resolution 9 scale), zone = unit.
- **Next simulation needs:** zones made of several small units. The G3 model refuses a day with mixed levels inside one holder's zone, so this needs a per-zone level rule first.

### D6–D13 — deeds, contests, kit carry-over, fortify, toll basis, revenue valve, number format, wallets
- **Source:** §10–§13, §20, §21, §24–§26 (see `GAME_ECONOMY_V3.md`).
- **Not simulated.** No deeds exist in the synthetic season, so there is no toll, no contest and no level 4 or 5. There is no kit progression or fortify price, and nothing touches a wallet or a chain.
- The books check exercises the D12 micro-unit arithmetic: every day of every run balanced exactly.
- **Pilot values:** none. All stay open.

### D14 — what unpaid upkeep does to ground
- **Source:** §7 and §8: upkeep beyond the 60% cap "is paid in condition: those zones decay that day as if unpaid".
- **Compared:** no effect (the model today); one extra day of decay on a share of units, weakest first; the same, strongest first (pilot); one extra day on every unvisited unit. Only charged, unvisited, non-deeded units are eligible. With D15 that excludes shade-only units, and an away-protected day owes nothing. The order is deterministic (strength, then unit id), so each day's allocation can be recomputed and audited.
- **Finding:**

  | Mode | Retention d90 | Units given extra decay | Units lost to it |
  |---|---|---|---|
  | No effect | 0.25 | 0 | 0 |
  | Weakest first | 0.23 | 72 | 4 |
  | Strongest first (pilot) | 0.24 | 80 | 1 |
  | All unvisited | 0.22 | 171 | 5 |

  - With automatic away days, unpaid upkeep is rare: 38 credits paid in condition per season against 3,839 taken.
  - Exploit: if unpaid upkeep has no effect, it is free to hold more ground than you can pay for. Strongest-first takes the penalty out of strength that can absorb it.
- **Pilot value:** proportional, strongest first.

### D15 — does shade-only ground pay upkeep
- **Source:** §4 lists "map colour, area, leaderboards, district control" for shade, not upkeep.
- **Compared:** exempt (pilot) and paying.
- **Finding:**
  - Making shade pay raised upkeep taken from 3,839 to 9,313 credits, paid in condition from 38 to 1,212, units decayed by unpaid upkeep from 80 to 1,563, and units lost from 1 to 42. Shade farmers' upkeep went from 208 to 678 credits.
  - Gini fell from 0.336 to 0.323, because the extra upkeep falls mostly on the biggest holders.
  - Exemption does not make shade a hoard. It decays three times as fast and falls to anyone who steps on it: 66 shade units held at season end.
- **Pilot value:** exempt.

### D16 — levels on loss and reclaim
- **Source:** §9, "Losing a zone drops two levels; reclaiming within 14 days restores it."
- **Compared:** reset to level 1 with no restore (the model today); reset with a 14-day restore of the former holder's snapshot (pilot); "drop two" for the new holder with the restore.
- **Finding:**
  - The 14-day restore fired 102 (92–120) times per season. Without it, restores were 0, and retention did not change (0.23 against 0.24).
  - "Drop two" gave results identical to the pilot. Without deeds only levels 1–3 can be reached, and three minus two is one.
  - So the level-laundering exploit (handing levelled ground to a club-mate who keeps level − 2) could not occur. It needs levels 4 and 5, so deeds, in a later simulation.
  - Only about 1% of held units are level 2 or higher at season end.
- **Pilot value:** reset to 1, restore within 14 days.

### D17 — when away days are spent
- **Source:** §7, "Fourteen free away days per season (FIXED)". §9 adds level bonus away days.
- **Compared:** none used; automatic on every absent day while holding ground (pilot); player-selected. For player-selected, the player always uses one during a planned week away, and on other absent days with an assumed chance of remembering: 0.4 for casual, 0.7 regular, 0.9 others.
- **Not simulated:** level bonus away days. They are per zone in §9, but the model's away flag is per player.
- **Finding:**

  | Mode | Days used | Casual protected days per player | Upkeep paid in condition (credits) | Units decayed by it | Units lost to it |
  |---|---|---|---|---|---|
  | None | 0 | 0 | 1,025 | 2,390 | 94 |
  | Player-selected | 912 | 1.33 | 351 | 840 | 31 |
  | Automatic (pilot) | 1,423 | 3.00 | 38 | 80 | 1 |

  - Fairness: player-selected favours attentive players. Casual players got less than half the protection.
- **Pilot value:** automatic.

### D18 — club membership
- **Source:** §15 (clubs, district and city wars). DECISION NEEDED D18.
- **Compared:** a change that takes effect the next day (pilot) against the same day. In the same-day case a switcher chooses after seeing the day's standings.
- **Finding:**
  - Kingmaker district-days (days a district is controlled only because of a switcher's ground): 7.0 (3–15) for next day, 11.0 (5–21) for same day.
  - Club-mate pushes per day: 59.7 for next day, 64.7 for same day.
  - Switchers made about 181 switches a season either way. The rule removes the look-ahead, not the switching.
  - One club at a time is how every run was built. The G4 model reports two clubs on one day as a problem, and no run produced one.
- **Pilot value:** one club, effective the next day.

### D19 — what a contribution is worth
- **Source:** §15. The G4 model counts entries by outcome and kind, with no weights.
- **Compared:** naive (every ledger entry), changed ground only, and the pilot weights. The scores below are per active day, as a ratio to a regular player.
- **Finding:**

  | Scoring | Route farmer | Shade farmer | Colluder |
  |---|---|---|---|
  | Naive | 0.86 | 2.39 | 1.02 |
  | Changed only | 0.85 | 2.40 | 1.03 |
  | Pilot | 0.29 | 1.59 | 0.96 |

  - The shade farmers' remaining edge comes from solid stepping on 7–10 km loops, which is real walking.
  - Club-mate flip-trading earns nothing under the pilot weights.
- **Pilot value:**
  - Weights: claimed 1, flipped 1, eroded 0.5, reinforced 0.25.
  - A reinforcement counts again only after 7 days.
  - Each walker, unit and day counts once.
  - Shade counts 0. Club-mate pushes count 0. Refused pushes count 0.

### D20 — what a district is
- **Source:** §15, layered leaderboards ("block, suburb, city, country, world").
- **Not simulated geographically.** The simulator uses 12 synthetic Voronoi polygons in metres, versioned `sim-districts-v1`. A test checks they are the same at every unit size, so districts never come from the grid's parent cells.
- **Next simulation needs:** real administrative polygons, a stable id per version, the block-to-world hierarchy, and a rule for units cut by a boundary (for example, the unit's centre decides).
- **Pilot value:** versioned geographic polygons, never derived from the grid.

### D21 — district control
- **Source:** §4, solid and shade both count for district control, so shade must count for more than 0. DECISION NEEDED D21.
- **Compared:** shade weight (1/4, 1/2, 1) × minimum share (1/4, 1/3, 1/2), all evaluated on the same pilot runs.
- **Finding:**

  | Rule | District-days controlled | Control changes / season | Shade club district-days |
  |---|---|---|---|
  | Shade 1/4, min 1/4 | 17.2% | 300 | 20 |
  | Shade 1/4, min 1/3 (pilot) | 5.6% | 110 | 10 |
  | Shade 1/4, min 1/2 | 0.3% | 6 | 1 |
  | Shade 1, min 1/3 | 7.2% | 137 | 10 |

  - The shade weight barely matters. The shade club's control comes from its solid ground.
  - At 1/4, control changed about 25 times per district per season, which reads as noise. At 1/2 nobody ever controls anything.
  - In the 5,000-player context run, with 140 small clubs, no club controlled any district at 1/3. The share should be checked again against real club sizes.
- **Pilot value:** shade 1/4, minimum share 1/3.

### D22 — what a season board ranks
- **Source:** §15 layered leaderboards, and §17 seasons of 90 days.
- **Compared:** the G4 model's `player_credits`, `club_credits` and `club_district_days`, plus a club contributions board built from the D19 pilot scores with the model's `rankRows`. Every board uses settled days only (all 90 settled in every run).
- **Finding (seed 1):**
  - `player_credits` had 143 tied rows, and route farmers tied at the top with 1,350 credits each.
  - `club_credits` follows club size. In the 5,000-player run the 112-member colluding and shade clubs ranked 1st and 2nd.
  - `club_district_days`: the shade club ranked 3rd and the colluding club 12th, with 6 tied rows.
  - The contributions board ranked the shade club 3rd and the colluders 12th.
- **Pilot value:** `club_district_days`. Equal scores share a rank and are listed by id, which is deterministic.
- **Next model change:** a "settled verified contributions" metric in `seasonLeaderboard`, using the D19 weights, so the owner's preferred board needs no simulator code.

### D23 — club-mate erosion
- **Source:** §15. The holding model has no clubs, so today a push on a club-mate's ground erodes it.
- **Compared:** erosion (pilot) against friendly immunity, which drops the push before the ledger.
- **Finding:**
  - Immunity dropped 6,287 pushes a season and halved club-mate pushes, from 59.7 to 30.3 a day. The remainder are pushes on ground that changed hands earlier the same day, because the filter judges by the opening holder.
  - Colluder flips fell from 48.0 to 32.1 a day, and overall flips from 217.6 to 211.6 per 100 held units per day.
  - Shield switchers, who join the club attacking them, lost 6% fewer units under immunity (1,723 against 1,831 per player). That is the switching attack immunity opens up.
  - Casual retention did not change (0.24).
  - With D19 giving club-mate pushes no value, collusion under erosion earns nothing.
- **Pilot value:** erosion stays. No immunity.

## Limits of this simulation

- The behaviours, the city and the districts are synthetic. The routes are hex walks and rings, not GPS.
- There are no deeds, contests, fortifications, kit levels or masks.
- Levels 4 and 5 are unreachable.
- Immunity is judged on the opening holder of the day.
- Players do not quit when they lose ground, so "retention" here means holding ground, not playing.
- The run with 5,000 players was a single seed.
