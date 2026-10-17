# G5–G7 economy research: Deeds, contracts, $MOVE and economic security

> **RESEARCH — SIMULATION_ONLY_NOT_PRODUCTION.** Nothing in this file is a decision, a token design, a price or legal advice. Nothing was deployed, signed, minted or sent to any chain. No RPC call, key, faucet or testnet was used. The V3 numbers are read from the reference model (`economyRulesFor(1)`) and are not changed. The pilot ruleset `sim-pilot-1` and the models in `shared/src/domain/` are not changed. Every number below comes from synthetic players on a synthetic grid.

- Model: `shared/src/sim/economyG5.ts` (deed eligibility, toll income, wash-trade screening, conversion options, emission and sink projection, Sybil break-even). Runs: `shared/src/sim/economyG5Report.ts`. Tests: `shared/src/sim/__tests__/economyG5.test.ts`.
- Input: the season simulator's new opt-in per-day trace (`SimOptions.trace`, `shared/src/sim/trace.ts`). The trace changes nothing the simulator computes. A test checks the fingerprint is identical with and without it, and that the trace's earned total and level spend equal the simulator's books.
- Reproduce: `yarn workspace @movenrun/shared sim:g5 --seeds 1,2,3` runs the pilot and no-attackers contexts (about 2 minutes). Add `--all-contexts` for the 76 m unit contexts, which take several minutes. Tables below are the mean over seeds 1–3 with min–max in brackets, unless marked "seed 1".
- Tags: **SOURCE §n** is quoted from `docs/GAME_ECONOMY_V3.md`, the repo's transcription of the owner's V3 PDF (rev 2, 31 Aug 2026), which remains the authority. **RESEARCH** marks a parameter or comparator introduced here.

## 0. Findings in one page

1. **Under the source's deed rule, no deed is ever issued in any simulated context.** The binding condition is "30 distinct verified people" (§12). Across 4 contexts and 3 seeds, the most counted crossers any unit had on the day it met tenure was 12. The cause is structural, not a tuning problem. Before a unit is deeded, every stepped-on crossing by another walker is a push, and with the source's numbers one push flips undefended ground (§4, §5, ASSUMPTION A9). Traffic on a unit and holding it work against each other. Shortening tenure alone does not help: with tenure 14, still no deeds.
2. **When the deed gate is loosened enough to open (comparator 7 days, 5 crossers over 3 days), route farmers take most deeds:** 6.0 of 7.3 in the pilot, and 19.0 of 23.7 in the no-attackers context. Repeating the same short loop every day is exactly the behaviour that holds a unit and keeps strangers crossing it.
3. **§21 ("liquid after first deed") concentrates liquidity almost completely.** With comparator deeds, the Gini of liquid holdings is 0.99 in every season. A route farmer ends season 4 with 1,354 liquid, against 3 for a casual player. Holdings overall stay at Gini 0.33, because locked balances are spread like credits.
4. **The Sybil economics of §21 hinge on the deed gate.** Direct farming never pays, because a free account is locked. Two routes stay open: the toll channel, and a mutual deed ring (fake accounts crossing each other's ground until every member holds a deed). The ring breaks even at about 0.015 cost units per token when one account-day costs 0.25. That is an order of magnitude below the toll channel (0.625). Independent per-account detection only makes the ring bigger: 31 members with no detection, 95 at 60%. It does not make the ring unprofitable. Only cluster-level detection, or the §21 legal fallback, closes it.
5. **The pool binds at roughly 14,000 registered players with the pilot's activity mix.** That is about 5,000 active on a day at the 20-credit ceiling. Below it, issuance follows active days, not the schedule. Under no conversion at the pilot size, the season mints 2.6% of its pool.
6. **The trace's sinks burn about 24% of what is minted: recharge and upkeep about 21%, level purchases about 3.6% (pilot, seed 1).** Without stock sinks, credit supply grows by 1/n each season (100%, 50%, 33%). The §22 season-end burn has no size in the source. With a 10% season-end burn plus 10% discretionary spend (RESEARCH values), burn reaches 73% of mint by season 4 and growth falls to 14%.
7. **The prototype contracts (`feat/v3-onchain-core`, c8262ec) have three high-severity trust issues** (section 8):
   - The settlement day is not bound to time, and the daily pool absorbs unused budget. Publishing the last day of a season can therefore mint that season's whole unissued budget at once.
   - Contests rest on a single signer for both declarations and every score.
   - Deed eligibility rests on a single signer, with only a per-wallet cap.

## 1. What the V3 source says

The quotes are from `docs/GAME_ECONOMY_V3.md`. Section numbers are the source's.

### 1.1 $MOVE (rules, supply, locked and liquid)

- **§1 rule 1:** "Only verified movement creates $MOVE. Not land, staking, spending or invites."
- **§1 rule 2:** "Never more than 1,000,000,000 $MOVE, with no function to raise it."
- **§1 rule 5:** "Land pays its holder out of a runner's own reward, never out of new supply."
- **§1 rule 8:** "Nothing bought earns anything."
- **§1 rule 11:** "Free players' rewards are never sellable, and never become sellable retroactively."
- **§1 rule 12:** "The route never goes on the blockchain: not raw GPS, not lists of map cells."
- **§17:** total supply 1,000,000,000 (FIXED). Player allocation 400M (FIXED). "Season pool: 9M in season 1, −10% each season, floor 2M" (FIXED). Daily pool in season 1 is 100,000 (FIXED). "trimmed → back to the season pool; never crosses a season" (FIXED).
- **§21:**
  - "A free player's session rewards are LOCKED: spendable in game, never transferable, never converted later."
  - "After a player's first deed, later session rewards are LIQUID. Everything earned before stays locked forever, **enforced in the token contract**, not the backend."
  - "Tolls received, sponsor prizes and market purchases are LIQUID."
  - "Revenue valve: liquid issuance in a period is capped at what the business earned; the excess mints locked and the shortfall is published."
  - "Legal fallback (one configuration line): deed holders' rewards also stay locked, and staking becomes the only route to a sellable token."
  - "Needs legal sign-off in each market before liquid earnings ship (§32 phase 3)."
- **§22:** "Recharge, upkeep, land levels, kit levels, fortify, rally beacons, deed claim fee, contest entry, gear and cosmetics, landmark auctions and a season-end burn. All burned. A burn destroys tokens and never frees room to issue more."
- **§24–§27:**
  - Session rewards, charges, tolls, deeds and contest settlement go on chain.
  - "Route, cells, GPS: **Never** (§27)."
  - The public chain carries "day totals and amounts only".
  - Never published: "live route, start point, regular schedule, crossing history".
- **§32:**
  - phase 1 is a credits-only pilot "with no transferable reward at all"
  - phase 2 is "Limited $MOVE (small verified group)"
  - phase 3 requires "legal sign-off before liquid earnings"
  - phase 4 is "external audit … store and legal sign-off"

### 1.2 Deeds and contests

- **§12 (deeds):**
  - tenure "21 consecutive days" (HYPOTHESIS)
  - traffic "30 distinct verified people across 10 different days" (HYPOTHESIS)
  - "No related cluster above 20%"
  - "Own and linked traffic: never counts; checked with a risk graph"
  - ground "Solid only" (FIXED)
  - "Per-city cap: a published share" (FIXED, value open)
  - "Claim fee: scales with traffic, burned; buys permanence, never income"
  - "A deed is created or transferred in its own transaction, never batched (§26)"
- **§5:** "Deeded cells never wear down and can only be taken by contest. They still collect the toll."
- **§4:** shade is "Deedable: Never (FIXED)" and "Collects toll: Never (FIXED)".
- **§13 (contests):**
  - "Declared with a disclosed, burned fee; the deed goes into escrow."
  - "72 hours' notice, then a 7-day window; the best 3 days count."
  - "Score = verified movement + capped club support + fixed 5–10% home advantage + fortification at most +15%."
  - "Attacker locked out of that deed for 30 days after a loss; a survivor gets 14 days of peace."
  - "anyone can trigger settlement."
- **§20 (toll):**
  - "toll = session reward × 2% × (deeded cells of others crossed ÷ distinct cells crossed)"
  - rate "FIXED and not governable"
  - "Own land and linked accounts' land are free."
  - "Every toll is a matched debit and credit in the same settlement; they sum to zero."

### 1.3 What the source leaves open (already in the D register)

- D6: per-city cap value, claim-fee curve, "related".
- D7: contest score.
- D10: toll basis.
- D11: revenue valve.
- D12: number format.
- D13: wallet and paymaster.

The source does not define how deed traffic is counted while crossings are also pushes (finding 1). It does not size the season-end burn, and it does not say whether a deed is a transferable token or a game record. "Market purchases are LIQUID" implies a market but does not specify it.

## 2. Off-chain deed model

### 2.1 What the model does

`deedEligibility(trace, rules, clusterOf)` replays the season's day closes:

- **Tenure.** A unit held as solid by the same holder at consecutive day closes builds tenure. A flip, or ending a day as shade, restarts it.
- **Traffic.** While tenure builds, every stepped-on crossing by another walker counts as traffic. Crossings by the holder or the holder's related cluster are excluded (§12).
- **Issuance.** A deed is issued on the first day all of these hold, unless a cap refuses it:
  - tenure ≥ `tenureDays`
  - counted distinct crossers ≥ `distinctCrossers`
  - counted traffic days ≥ `trafficDays`
  - no cluster above `maxClusterShare` of crossers
- **Caps.** The two cap readings are both modelled:
  - `cityCapShare`: the source's "published share", read city-wide
  - `perHolderCap`: the prototype contract's per-wallet count
- **After issuance.** Deeds persist once issued (§5).
- **Limit.** The trace was run without deeds, so the model measures who reaches the gate, not how play changes after it.

Default related clusters are the simulator's ground truth: the colluding club is one cluster and everyone else is their own. A real risk graph would be noisier in both directions.

`tollIncome` prices what each deed would have collected. Each crossing walker pays 2% of the day's reward × (1 ÷ distinct units it stepped on that day). Own and linked owners pay nothing. Every payment is a payer-to-owner pair, so the projection can book it as a matched debit and credit. The trace is per day, so this uses the day as the toll basis (the §18 reading of D10), not §20's per-session basis.

`washTradeFlags` screens transfers for four signals:
- related parties
- A→B→A within 30 days
- a cycle of up to 3 hops back to the seller
- a price above 5× the batch median

The flags are risk signals for review, never automatic penalties (§28: "no permanent ban follows one weak signal"). `washTradeCost` shows the economics. With the prototype marketplace's zero fee, wash trades cost only gas. With a burned transfer fee of f, printing n trades at price P costs n·f·P.

### 2.2 Results: deed reachability

| Context | Deed rule | Max tenure (days) | Units reaching tenure | Most crossers at tenure | Deeds | Deeds by profile |
|---|---|---|---|---|---|---|
| pilot (201 m units, 368 players) | **source §12** (21 d / 30 / 10 d) | 17 (12–19) | 0 | 0 | **0** | — |
| pilot | tenure 14 (comparator) | 17 (12–19) | 3 (0–5) | 6 (0–10) | 0 | — |
| pilot | 7 d / 5 / 3 d (comparator) | 13 (10–15) | 33 (31–35) | 11 (8–15) | 7.3 (7–8) | route_farmer 6.0, casual 0.7, regular 0.3, shade_farmer 0.3 |
| pilot | 7/5/3 + per-holder cap 1 | 14 (10–18) | 33 | 11 | 5.7 (5–6) | route_farmer 4.3 |
| no heavy attackers or switchers | **source §12** | 71 (60–90) | 41 (26–55) | 10 (9–12) | **0** | — |
| no attackers | traffic 10 / 5 d (comparator) | 71 | 41 | 10 | 1.3 (0–3) | route_farmer 1.3 |
| no attackers | 7/5/3 (comparator) | 54 (47–63) | 497 | 9 (8–11) | 23.7 (18–28) | route_farmer 19.0, casual 2.0, regular 1.3, shade_farmer 1.3 |
| no attackers | 7/5/3 + city cap 1% | 71 | 497 | 10 | 9.0 | route_farmer 8.3 |
| 76 m units (seed 1) | **source §12** | 28 | 6 | 10 | **0** | — |
| 76 m units, no attackers (seed 1) | **source §12** | 90 | 731 | 10 | **0** | — |
| 76 m units, no attackers (seed 1) | 7/5/3 (comparator) | 90 | 5,874 | 6 | 11 | route_farmer 10, casual 1 |

What this means:

- **The 30-crosser condition never comes close.** In the no-attackers context ground is held for up to 90 days, yet no unit gathers more than 12 counted crossers while held. A crossing pushes. Under the 17 Oct owner rule one push per walker per day still flips undefended fresh ground, so a crossed unit survives only if its holder retakes it before day close.
- **Smaller units do not fix it.** Smaller units raise tenure (D5), but the traffic on each unit falls. At 76 m units with no attackers, 731 units reach 21 days of tenure, and none has more than 10 crossers.
- **Route farmers are the first to reach a deed.** They hold three units, walk them every day, and are crossed by passers-by. This links to the earlier finding that they earn the day ceiling with two 11-minute walks (SIM_PILOT_RULESET.md).
- **A per-holder cap redistributes deeds; a city share limits the total.** With a per-holder cap of 1, route farmers fall from 6.0 to 4.3 deeds in the pilot, because the cap counts wallets. A unit test shows the same person with a second wallet gets both deeds under a per-holder cap but not under a city share.
- **Toll income is small.** With comparator deeds, the whole season's toll collected was 10.2 credits in the pilot and 37.9 in the no-attackers context. That is under 0.03% of issuance. Deeds matter far more through §21 liquidity than through tolls.

## 3. Credits-to-token conversion: the design space

| Option | Source status | Rule 11 (free rewards never sellable) | Who gets sellable value | Sybil exposure | Modelled as |
|---|---|---|---|---|---|
| **No conversion** (credits stay game credits) | Play V1 as approved; §32 phase 1 "no transferable reward at all" | Holds trivially | Nobody | None in money; in-game advantage only | `none` |
| **V3 §21 as written** | SOURCE | Holds for free players. After a first deed, later rewards are liquid. Tolls are liquid. | First deed holders | Deed gate (ring) and toll channel | `v3_source` (with optional valve) |
| **§21 legal fallback** | SOURCE ("one configuration line") | Holds; deed holders also locked; staking is the only route to a sellable token (staking not modelled) | Nobody from rewards | None from rewards. Staking would need its own analysis | `locked_only` |
| **Capped, haircut conversion** | RESEARCH comparator, not in source | Breaks it: free players' credits become sellable | Everyone, up to the cap | Direct farming, bounded by the cap | `capped_conversion` (0.5 tokens per credit, 300 credits a season) |
| **All rewards liquid** | RESEARCH comparator only | Breaks it | Everyone | Direct farming, unbounded | `liquid_all` |
| Time-vested conversion, sponsor-prize-only liquidity, in-game redemption only | Not modelled; listed for completeness | Depends on design | — | — | — |

### Results: emission and sinks

Results are over the pilot trace, replayed for 4 seasons. "~15k" is 40 copies of the 368-player pilot population. The flat-pool comparator replaces the source's schedule.

| Configuration | S1 minted (M) | S1 pool-binding days | S4 minted (M) | Allocation used after S4 | S4 burned ÷ minted | S4 supply growth | Gini (holdings) | Gini (liquid) |
|---|---|---|---|---|---|---|---|---|
| Play V1, no conversion, 368 players | 0.235 | 0 | 0.235 | 0.24% | 0.24 | 0.33 | 0.331 | — |
| No conversion, ~15k | 8.960 | 71 (68–73) | 6.561 | 7.73% | 0.24 | 0.27 | 0.332 | — |
| V3 §21, source deed rule, ~15k | 8.960 | 71 | 6.561 | 7.73% | 0.24 | 0.27 | 0.332 | — (no deeds, so nothing liquid) |
| V3 §21, comparator deeds 7/5/3, ~15k | 8.960 | 71 | 6.561 | 7.73% | 0.24 | 0.27 | 0.332 | **0.988** |
| … plus revenue valve at 1% of mint | same | | | | | | 0.332 | 0.988 (liquid halves, same holders) |
| §21 legal fallback, ~15k | same | | | | 0.24 | 0.27 | 0.332 | — |
| Capped conversion 0.5 / 300, ~15k | same | | | | 0.51 | 0.25 | 0.434 | 0.111 |
| All liquid (comparator), ~15k | same | | | | 0.24 | 0.27 | 0.332 | 0.332 |
| V3 §21, comparator deeds, ~15k, heavy sinks | same | | | | **0.73** | **0.14** | 0.334 | 0.988 |
| V3 §21, comparator deeds, growth 368 → 29k | 0.235 | 0 | 6.561 | 4.11% | 0.24 | 0.13 | 0.332 | 0.988 |
| Flat season-1 pool, growth 368 → 29k (comparator) | 0.235 | 0 | 9.000 | 5.14% | 0.24 | 0.16 | 0.332 | — |

Every row closed its books in every season and every seed (minted − burned = change in supply, exactly, in integer micro-units). No day minted more than its pool.

Liquid holdings per player at the end of season 4 (MOVE-equivalent, mean of 3 seeds):

| Configuration | casual | regular | heavy | route_farmer | shade_farmer |
|---|---|---|---|---|---|
| V3 §21, comparator deeds, ~15k | 3 | 3 | 0 | 1,354 | 71 |
| … valve 1% of mint | 1 | 1 | 0 | 664 | 29 |
| Capped conversion 0.5 / 300 | 420 | 598 | 600 | 600 | 600 |
| All liquid (comparator) | 842 | 1,850 | 3,760 | 3,095 | 2,259 |

What this means:

- **The valve changes how much is liquid, not who holds it.** A revenue valve (D11) set as a share of mint halves liquidity for the same holders. Concentration is a property of the first-deed switch.
- **Capped conversion shares liquidity evenly but breaks rule 11.** Liquid Gini is 0.11 and everyone reaches the cap. It does so by making free rewards sellable, and it opens direct Sybil farming (section 7). Its haircut is a sink, so burned ÷ minted rises to 0.51, and holdings Gini rises to 0.43 because casual players convert a larger share of their small balances.
- **The legal fallback is the only source option with no sellable reward and no deed-gate incentive.** It moves the question to staking, which the source names but does not specify.

## 4. Supply and emission schedule

- **The V3 schedule (§17, FIXED).** The season n pool is max(9M × 0.9^(n−1), 2M), limited by what is left of 400M. The pools are 9M, 8.1M, 7.29M and 6.561M in seasons 1–4. The floor is reached in season 16. The reference model confirms it releases exactly 400M over about 180 seasons, roughly 45 years at 90 days a season.
- **Who sets issuance.** The day ceiling (20) sets each player's reward until about 5,000 players are active on the same day (100,000 ÷ 20). With the pilot's activity mix, casual players active on 30% of days, that is about 14,000 registered players. The ~15k runs bind on 71 of 90 days in season 1. By season 4, every day binds because the pool has shrunk 27%.
- **A difference between the model and the contract.** The reference model's daily pool is fixed at season pool ÷ 90 (ASSUMPTION A3). The prototype contract's daily pool is (season budget − issued) ÷ days left, so unused budget rolls forward inside the season. Both readings fit §17's "back to the season pool", but they behave differently at low population. With the pilot's 2.6% utilisation, the contract's day-90 ceiling would be about 8.77M, against 100,000 in the model. Section 8, H1 shows why that matters when the day is not bound to time.
- **A flat pool (RESEARCH comparator) is not the source.** Keeping 9M every season raises season 4 minting from 6.56M to 9.0M at 29k players. It is shown only to size the effect of the −10% decay.

## 5. Sinks

| Sink (§22) | Modelled | Size |
|---|---|---|
| Recharge (§8) and upkeep (§7) | From the trace (the reference model's day close, under the 60% cap) | About 21% of mint (pilot, seed 1) |
| Land levels (§9) | From the trace (simulator purchases) | About 3.6% of mint in the pilot; 21% in the no-attackers context, where ground lasts long enough to level. Together with recharge and upkeep: 0.24 burned ÷ minted at every population |
| Deed claim fee (§12) | Parameter, in day-shares, burned on claim | 0 by default; 5 day-shares in "heavy sinks" (D6 curve open) |
| Gear, cosmetics, beacons, fortify, contest entry, auctions | One RESEARCH parameter: a share of each balance per season | 0 by default; 10% in "heavy sinks" |
| Season-end burn | RESEARCH parameter: a share of each locked balance | 0 by default; 10% in "heavy sinks" (the source gives no size) |

With stock sinks of rate s per season and a steady net issuance N, supply settles near N(1 − s) ÷ s. At 19% combined (10% then 10%), that is about 4.3 seasons of net issuance. Without stock sinks, supply grows without bound and its growth rate decays as 1/n. A §22 burn never frees issuance room: the projection's allocation-used column counts mint only.

## 6. Economic-security threat model

| Threat | Mechanism | Source control (§28 unless noted) | What this research measured | Residual risk / needed before G6 |
|---|---|---|---|---|
| **Sybil walkers** | Many accounts, real or spoofed, each earning the day ceiling | Locked rewards (§21), trust weight, passkeys, device and route risk graph, physical movement; V1 cap of 1,000 accounts | Direct farming never pays under §21 or the fallback. Once the pool binds, each Sybil's reward comes from honest players' share (shared pool, §17) | Pool dilution is a fairness loss even when nothing is sellable. Trust weight must work at signup scale. The cheapest fake profile copies route farming (20 credits a day with two 11-minute walks) |
| **GPS spoofing** | Fabricated or replayed location | Tamper checks, signed sensors (not built), GPS/sensor/map agreement, nothing created without the verifier's signature | Not simulated. Every Sybil route assumes spoofing works, at a cost per account-day | Signed sensors and the risk graph are prerequisites for any liquid reward. Their detection rate is the parameter the break-even tables depend on |
| **Collusion rings** | Accounts crossing each other's ground to manufacture deed traffic; club flip-trading | 30 distinct people over 10 days; related and own traffic excluded; no cluster above 20% (§12) | The mutual deed ring is the dominant monetisation route under §21 (section 7). Detecting accounts one by one only enlarges the ring. The ring must also cross and then retake ground the same day, because crossings push | Cluster-level detection, not per-account, is what the §12 risk graph must achieve. The crossing-as-push conflict (finding 1) must be settled first, or honest players never deed while coordinated rings can |
| **Wash trading of Deeds** | Trading a deed between one's own wallets to print a price history or move value | Not addressed in the source beyond "market purchases are LIQUID" | Screening model (related parties, round trips, cycles, outliers). The prototype marketplace charges no fee, so wash trades cost only gas | A burned transfer fee prices wash trading (n·f·P). Off-market ERC-721 transfers bypass any marketplace control |
| **Route farming** | Minimum-length repeated loops | Effort saturation and session minimum (§2, §17, HYPOTHESIS) | Route farmers earn the ceiling (SIM_PILOT_RULESET) and are first to deeds (this file) | Recalibrate the session minimum and effort floor (HYPOTHESIS values) before any deed or liquidity work |
| **Toll channel** | Undetected locked accounts crossing an operator's deeds; tolls are liquid (§21) | Linked land is free (§20) | Break-even 0.625 cost units per token at 0.25 per account-day, no detection | Bounded at 2% of locked issuance, but outside the revenue valve in the prototype contract (M4) |
| **Oracle and attestation trust** | The chain takes verification as input. Settlement, deed eligibility and contest scores are signed off chain | Short-lived, chain-bound signatures; independent reconciliation (§26) | Contract review: settlement has two signers, but deed eligibility and contests have one each, and settlement has no rate bound (H1–H3) | Two independent signers for every value-creating input; rate bounds; key ceremonies and rotation drills (§28 "signing key compromise") |
| **Treasury risk** | Concentrated holdings by the operator; revenue valve accounting; paymaster drain | Six paymaster controls (§25); revenue valve (§21); 400M player allocation fixed | Not modelled beyond issuance. The other 600M has no schedule in the source or the prototype ("simply unissued") | A published plan for the non-player 600M (or a statement that it stays unissued). The valve's revenue definition (D11) |
| **Regulatory classification** (stated neutrally) | — | §21 and §32: "legal sign-off in each market before liquid earnings ship" | Not assessed. No legal conclusion is drawn | Features regulators commonly examine (below) |

**Regulatory classification.** This is a list of features that regulators in various jurisdictions commonly examine. It is not an assessment, and it reaches no conclusion:

- whether holders expect a return from others' efforts (tolls are income from others' movement)
- transferability and secondary markets (deeds as ERC-721, a MOVE marketplace)
- redemption or cash-out paths
- links between issuance and company revenue (the valve)
- staking (the fallback's only sellable route)
- custody and money transmission (embedded wallets, D13)
- consumer protection and in-game currency rules
- tax reporting
- age limits
- app store policies on tokenised digital assets, which apply to the Android release

The source already requires sign-off per market. This research adds only that deeds combine income and transferability.

## 7. Sybil break-even (cost units per token)

A fake account copies the cheapest profile, earning 20 credits per active day with trust weight 1. "Never" means no price makes it pay. The ring needs 95% confidence that each member's deed passes, and pays over 90 days after the deed.

| Conversion | Cost per account-day | Detection | Direct farming | Mutual deed ring (members) | Toll channel |
|---|---|---|---|---|---|
| none | any | any | never | never | never |
| V3 §21 | 0.05 | 0 | never | 0.003 (31) | 0.125 |
| V3 §21 | 0.25 | 0 | never | 0.015 (31) | 0.625 |
| V3 §21 | 0.25 | 0.6 | never | 0.016 (95) | 1.563 |
| V3 §21 | 1 | 0.3 | never | 0.065 (51) | 3.571 |
| legal fallback | any | any | never | never | never |
| capped 0.5 / 300 | 0.25 | any | 0.150 | never | never |
| all liquid (comparator) | 0.25 | 0 | 0.013 | 0.015 (31) | 0.625 |

What this means:

- **The ring is as cheap as making everything liquid.** Under §21 the ring's break-even (0.015) is about the same as "all liquid" direct farming (0.013). Once a ring can manufacture deeds, §21's lock protects about as much as no lock at all. The ring's real cost is higher than modelled, because members must cross and then retake ground daily. The order of magnitude stands.
- **Capped conversion puts a hard ceiling on what each account can take.** Its break-even is 10× the ring's, and the cap bounds the loss per account.
- Full table: `yarn workspace @movenrun/shared sim:g5`.

## 8. Contract review: `feat/v3-onchain-core` (c8262ec)

Read-only review of `movenrun/contracts/src/v3/` and the deploy script. Nothing was compiled against a network, deployed or changed on that branch. "Severity" is the research reading for a future audit scope, not an audit result.

| # | Severity | Where | Issue |
|---|---|---|---|
| H1 | High | `MovenRunSettlement.publishSettlement`, `_dailyPool` | **The settlement day is not bound to time, and the daily pool absorbs unused budget.** `dayId` only has to increase. The pool is (season budget − issued) ÷ (days left in the season). One authorization for the last day of a season (for example day 90 straight after day 1) therefore has a ceiling of that season's whole unissued budget. Seasons may open back to back. A compromised or faulty signer pair, or a reconciliation job that signs what the settlement job hands it, could mint the remaining 400M in roughly one transaction per season. Only the guardian's pause stops it. §28 asks for "rate bounds". Directions: bind `dayId` to `block.timestamp` from a genesis time; cap each publication at the fixed season ÷ 90 (or a published multiple); add a minimum interval between publications. |
| H2 | High | `MovenRunContests` | **One `contestSigner` authorizes both declarations and every daily score.** Scores are bounded only by `uint128`. One compromised key can take any deed in about 10 days (72 h notice + 7 days), and no second check exists, unlike settlement. The declaration authorization does not bind the defender's address either, so a transfer just before declaration changes who is challenged. |
| H3 | High | `MovenRunDeedClaims.claim` | **One `eligibilitySigner` can create a deed for any well-formed resolution-8 cell in any configured city.** The only bound is the per-wallet city cap, which fresh wallets bypass. Deeds carry tolls (liquid) and, under §21, unlock liquid rewards, so this one key gates value. |
| M1 | Medium | `MovenRunDeed` concentration cap | **The cap is per holder, per city, counted in wallets.** The source says "Per-city cap: a published share" (§12), which reads as a city-wide limit. A per-wallet count does not bound one person with several wallets (shown by the unit test in section 2). |
| M2 | Medium | `MovenRunContests.settleContest` | **The 30-day lockout is per challenger address and covers every deed.** §13 locks the attacker "out of that deed". The contract is broader than the source and easy to bypass with a new wallet. |
| M3 | Medium | `MovenRunContests` | **`rulesVersion` is global, not snapshotted per contest.** A timelocked version change in the middle of a contest invalidates pending score authorizations, which influences contests in flight. If nobody relays scores, for example because the paymaster budget ran out, the defender wins 0–0 by the tie rule. |
| M4 | Medium | `MovenRunSettlement._validateAccounting`, `MovenRunRewards.finalizeDay` | **Toll credits are liquid and do not use the liquid issuance allowance (revenue valve).** A free player's locked reward therefore flows 2% to deed holders as liquid MOVE. This channel is outside the valve. The architecture document calls it an economic decision, and it bears on rule 11 and §21's valve. |
| M5 | Medium | `MovenRunRewards` leaves | **The locked/liquid split of each reward is whatever the off-chain Merkle leaf says.** The token enforces the lock only after the claim. §21's "everything earned before stays locked forever, enforced in the token contract" holds only as far as the signers build leaves correctly. |
| M6 | Medium | `MovenRunMarketplace` | **Stale listings revive.** A listing is not cleared when the deed leaves the seller. If the deed comes back while `setApprovalForAll` is still in place, the old price becomes buyable again. |
| M7 | Medium | `MovenRunDeed`, `MovenRunDeedClaims` | **Deeds are ordinary transferable ERC-721s, and the claim fee is burned from locked balance first.** Rewards earned under the lock can thus become a transferable asset sold off-market for anything. The marketplace's "locked MOVE can never pay for a deed" covers only its own path. This bears on rule 11. |
| M8 | Medium | `MovenRunDeed` token id | **A deed's token id is its H3 resolution-8 cell, held by a public wallet.** A deed proves at least 21 days of regular presence in a 0.74 km² cell, and transfers and tolls tie the wallet to the place. Compare §27 ("never published … regular schedule") and rule 12's intent. |
| L1 | Low | `MovenRunH3` | **Resolution 8 is hard-coded.** D5 is open, and the pilot ruleset proposes 201 m units (resolution 9 scale). |
| L2 | Low | `MovenRunTimelock`, `deployBaseSepolia.ts` | **Only a non-zero delay is required, so 1 second passes.** The safety of every "delayed administration" claim depends on a value no code enforces. |
| L3 | Low | `MovenRunRewards.claim` | **The leaves' sum is not checked against the day's totals on chain.** An over-committed tree makes the last claimants revert, first come first served. The reconciliation signer is the only check. |
| L4 | Low | `MovenRunDeed.configureCityConcentrationCap` | **The admin can set a city's cap to 0 or below current holdings.** That freezes transfers and marketplace sales into the city (timelocked). |
| L5 | Low | Settlement, claims, contests | **Authorization `expiry` has no upper bound on chain.** Long-lived signatures are prevented only by off-chain discipline. |
| Good | — | Suite | **What is already sound:** <ul><li>no proxy</li><li>the 1B cap is a constant</li><li>burns reduce supply but never `cumulativeMinted`</li><li>the bootstrap is finalized in the deploy script</li><li>the settlement and reconciliation signers must differ</li><li>claims are never paused</li><li>OpenZeppelin ECDSA rejects malleable signatures</li><li>deploy refuses any chain except Base Sepolia</li></ul> |

None of these were fixed. The branch is a prototype, and the spec (§31) says the deployed Base Sepolia contracts implement an older design.

## 9. Owner decisions this research raises (not decided)

These are numbered G5-1… so they do not collide with the D register. Each one is a question only.

| Id | Question | Why it comes up |
|---|---|---|
| G5-1 | **Deed traffic and pushes.** How should deed traffic be counted, given that a crossing is a push that flips undefended ground (A9 with the source's numbers)? For example: a candidacy period in which crossings count but do not flip, counting only crossings refused by the daily limit or defended, counting traffic in neighbouring units, or recalibrating the 30 / 10 HYPOTHESIS values. The 17 Oct one-push rule is preserved in every option. | Finding 1: no deed in any context |
| G5-2 | Should §21's "liquid after first deed" stay, or should the legal fallback (all locked; staking only) become the default for research? | Finding 3: liquid Gini 0.99; route farmers first |
| G5-3 | Should tolls received be liquid (§21), locked, or counted inside the revenue valve? | M4; the toll channel in section 7 |
| G5-4 | Per-city cap: a city-wide share (§12 text) or a per-holder count (prototype), and its value (D6) | M1; the unit test in section 2 |
| G5-5 | Is a deed a transferable token at all, or a non-transferable game record that collects tolls? | M7, wash trading, rule 11 |
| G5-6 | Deed privacy: may a deed name its cell publicly, or should it reference an opaque id or a coarser area? | M8, §27 |
| G5-7 | Contract trust model before any testnet rework: two independent signers for deed eligibility and contest scores, time-bound settlement days with a per-publication cap, a minimum timelock delay | H1–H3, L2 |
| G5-8 | Size of the §22 season-end burn and the target burn-to-mint ratio, if any | Section 5: 0.24 without stock sinks; supply grows without bound |
| G5-9 | Plan for the 600M outside the player allocation (stays unissued, or a schedule) | Treasury risk in section 6 |
| G5-10 | Recalibrating the session minimum and effort floor (§2, §17 HYPOTHESIS) before any deed or liquidity work | Route farmers top both credits and deeds |
| G5-11 | Scope and markets for the legal review the source requires before any liquid design work proceeds (§21, §32) | Section 6 |
| G5-12 | Should conversion options outside the source (capped or vested conversion) be researched further, or ruled out because they break rule 11? | Section 3 |

## 10. Limits

- **Deeds are counterfactual.** The trace was run without deeds: deeded ground would refuse pushes and change behaviour afterwards. The model measures who reaches the gate.
- **Clusters are ground truth.** Related clusters are the simulator's own, so a real risk graph would have false positives and negatives. Detection in the Sybil tables is per account and independent.
- **Toll basis.** Tolls use the day, not the session (D10), and assume walkers do not reroute to avoid them.
- **Projections replay one season's behaviour.** Players neither quit nor learn, and population growth is integer copies of the same population.
- **No market, no price, no demand.** "Cost units" only compare an attacker's costs with token value. They imply no currency or valuation.
- **Contract review only.** The contract review is a reading for audit scope, not an audit.
