# Game Economy V3: technical specification (proposal)

**Status:** PROPOSAL for owner review (G0). Nothing here is approved for build beyond the pure reference model listed in section 9.
**Source:** *MovenRun Game Economy V3, revision 2, 31 August 2026* ("Seal it or lose it"), the owner's PDF. Section numbers below (§1–§34) are the source's.
**Supersedes for spec purposes:** the V3 roadmap notes in draft PR #88. They were not used as input; where they disagree with the source, the source wins.

The source says this file is authoritative where the guide simplifies. That is only true once the owner approves it. Until then the PDF is the authority and this file is a proposal for how to build it.

## How to read the tags

| Tag | Meaning |
|---|---|
| **SOURCE §n** | Stated in the source. Copied, not reinterpreted. The source's own FIXED / HYPOTHESIS / TARGET / STRUCTURAL label from the limits register (§29) is kept where it has one. |
| **ASSUMPTION** | The source leaves a step open. A reasonable choice is made so that code can be written and tested. Each one is reversible and listed in section 8. |
| **DECISION NEEDED** | The choice changes gameplay, money, privacy or legal exposure. It needs the owner. Listed in section 8. |

HYPOTHESIS values in the source are calibration starting points "to be replaced by measurement". They are kept as stated, behind a rules version, so changing one never reinterprets a past session.

## 1. The twelve rules (SOURCE §1)

These are invariants. A feature that breaks one is wrong.

1. Only verified movement creates $MOVE. Not land, staking, spending or invites.
2. Never more than 1,000,000,000 $MOVE, with no function to raise it.
3. Nothing is claimed until it is sealed.
4. The toll is 2% of a session, once, in total, however many owners are crossed.
5. Land pays its holder out of a runner's own reward, never out of new supply.
6. A per-session ceiling and a per-day ceiling; the day ceiling is smaller than two sessions' worth.
7. Rewards settle once a day among the people who moved that day.
8. Nothing bought earns anything.
9. One recurring bill, the daily recharge: always a share of that day's reward, never flat, never payable with cash.
10. No cost may exceed the reward that created it. Every core loop completes without topping up.
11. Free players' rewards are never sellable, and never become sellable retroactively.
12. The route never goes on the blockchain: not raw GPS, not lists of map cells.

## 2. Sessions (SOURCE §2, §17, §28)

| Rule | Value | Tag |
|---|---|---|
| Minimum that counts | 10 minutes **and** 750 m | SOURCE §2, HYPOTHESIS |
| Pause merge window | Pauses within 30 minutes are the same session | SOURCE §2, HYPOTHESIS |
| Token-earning sessions per day | 2 (a third still takes ground, streak, XP, materials) | SOURCE §2, FIXED |
| Live sessions per device | 1; overlaps rejected | SOURCE §2 |
| Modes | Walking, running and cycling count; cycling on a separate map; no minimum speed | SOURCE §2 |
| Vehicle | Classified by cadence, acceleration, stop pattern, altitude; earns no walking territory | SOURCE §28 |
| Unscored session | Marked before start: no charge, no tokens, still takes ground, streak, materials | SOURCE §8 |
| Rules version | Every session records the rules version it was played under | SOURCE §30 |

Built today: the session model stamps a rules version and validates pauses (`shared/src/domain/session.ts`). Only one mode exists (`onFoot`); cycling is absent by design until its map exists. **DECISION NEEDED D1:** which day a session belongs to (start time, end time, and which time zone) and when "day close" happens.

## 3. Territory (SOURCE §3, §4, §5, §12, §13)

### 3.1 Sealing (SOURCE §3)

- Three ways to seal: finish within **150 m** of the start (HYPOTHESIS), finish on a cell you already hold, or cross your own live trail.
- An unsealed run still earns full tokens, XP, materials, contracts and streak. It only fails to claim ground.
- Trail cutting by another player is held back until simulated against an organised club.

Built: the sealing engine (`shared/src/domain/sealing.ts`) implements all three. "Finish on held ground" reports *unavailable* until a trusted held-cell set exists (G2).

### 3.2 Solid and shade (SOURCE §4)

| | Solid | Shade |
|---|---|---|
| What | Cells physically moved through | Cells the sealed loop enclosed but never entered |
| Claim strength | 100 (FIXED) | 25 × shape × sprawl (HYPOTHESIS) |
| Decay | Base rate | 3× faster (HYPOTHESIS) |
| Deedable | Yes | Never (FIXED) |
| Collects toll | Yes, once deeded | Never (FIXED) |
| Counts for map colour, area, leaderboards, district control | Yes | Yes |
| Taken by | Wearing it down, or a contest once deeded | Anyone who walks it, instantly, at full strength |

- shape: roundness of the loop; a circle is about 1, a thin sliver close to 0.
- sprawl: up to 12 enclosed cells per stepped cell at full strength; beyond that, shade thins in proportion.
- Masked cells (military sites, schools, hospitals, shelters, private land, known hazards) are unclaimable at any strength.

**ASSUMPTION A1 (from the reconciliation memo, not the source):** a cell inferred between GPS samples (`cellsAlongRoute`, G1) is **not** a stepped-on cell. It may be drawn and counted for analytics but never makes ground solid, never claims, defends, erodes or validates, and never counts toward a toll or deed traffic. Only cells containing a verified fix are "stepped on" until G2 defines more, with the gap, speed, timestamp and teleport checks the memo lists.

**DECISION NEEDED D2:** the shape metric (for example isoperimetric ratio 4πA/P²) and the exact sprawl thinning curve. The source gives intent, not formulas.

**DECISION NEEDED D3:** the masked-area data source and how it is kept current.

### 3.3 Holding (SOURCE §5)

- Each cell has strength 0–100 and exactly one holder.
- A walker's push is subtracted: 100 for solid, the shade value for shade. At 0 the cell flips to the walker, carrying the overflow. Fortification blunts the push.
- Time drains strength daily from the last visit, through visible stages: held, at risk, contested, dormant, back on the map.
- Revisiting resets strength to 100, free.
- Deeded cells never wear down and can only be taken by contest. They still collect the toll.

**DECISION NEEDED D4:** the base decay rate and the stage thresholds. The source names the stages but no numbers. (The repo's older constants `DORMANCY_DAYS = 180` and `RECLAIM_DAYS = 210` in `shared/src/constants/h3.ts` belong to the earlier design and are not V3.)

**DECISION NEEDED D5: cell versus zone.** The source tolls and deeds *cells* but charges upkeep, levels and fortifies *zones*. It never defines a zone. The repo's grid is H3 resolution 8 (edge about 531 m, area about 0.74 km²), which is large for "one deeded cell on a busy high street" (§20). Both the zone definition and the cell resolution need deciding before G2 stores holdings.

### 3.4 Deeds (SOURCE §12)

| Requirement | Setting | Tag |
|---|---|---|
| Tenure | 21 consecutive days | HYPOTHESIS |
| Traffic | 30 distinct verified people across 10 different days | HYPOTHESIS |
| Concentration | No related cluster above 20% | SOURCE |
| Own and linked traffic | Never counts; checked with a risk graph | SOURCE |
| Ground | Solid only | FIXED |
| Per-city cap | A published share | FIXED (value open) |
| Claim fee | Scales with traffic, burned; buys permanence, never income | SOURCE |

A deed is created or transferred in its own transaction, never batched (§26). **DECISION NEEDED D6:** the per-city cap value, the claim-fee curve, and the risk-graph definition of "related".

### 3.5 Contests (SOURCE §13)

- Declared with a disclosed, burned fee; the deed goes into escrow.
- 72 hours' notice, then a 7-day window; the best 3 days count.
- Score = verified movement + capped club support + fixed 5–10% home advantage (HYPOTHESIS) + fortification at most +15%. Nothing else.
- One support budget per person per contest, with diminishing returns.
- Attacker locked out of that deed for 30 days after a loss; a survivor gets 14 days of peace.
- Settled from escrow; anyone can trigger settlement.
- Fortification's +15% must be simulated against solo, small-club and large-club attackers; if it decides contests it goes down or to zero (§11).

**DECISION NEEDED D7:** the movement-score measure, the club-support curve, and the home-advantage value within 5–10%.

## 4. Progression and sinks (SOURCE §6–§11, §22)

### 4.1 The day-share (SOURCE §6)

A day-share is what the median active player earned that day, computed at settlement and published. Every price (upkeep, recharge, levels, kit, claim fees, contest entry) is quoted in day-shares and shown in tokens before commit.

**ASSUMPTION A2:** "active" means at least one scoring session that day; "earned" means the day reward after both ceilings and trust weight, before any charge; with an even count the lower middle is taken.

### 4.2 Upkeep (SOURCE §7)

`upkeep owed = 0.03 day-shares × zones_held^0.25` for each zone not visited that day (HYPOTHESIS), times the zone's level multiplier (§9). Fourteen free away days per season (FIXED). Taken automatically at settlement out of that day's reward.

### 4.3 Charge and recharge (SOURCE §8, §10)

- Kit charge 100%; each scoring session uses 50%. Charge is spent on credit and settled at day close.
- `recharge = charge used × kit rate × day reward`; kit rate 25/23/21/18/15% for kit levels 1–5 (HYPOTHESIS).
- No cash top-up, ever. An empty kit still plays and earns everything except tokens.
- Kit level never raises charge capacity.

### 4.4 The 60% ceiling (SOURCE §7, §8, §22)

Recharge plus upkeep together never take more than **60% of the day's reward** (FIXED). Upkeep beyond that is paid in condition: those zones decay that day as if unpaid. No debt, no negative balance. Meera's worked check (§18 step 10) excludes the toll from the 60%, so the toll is not an automatic charge.

### 4.5 Land levels (SOURCE §9)

| Lv | Name | Cost (day-shares) | Also requires | Decay resist | Erosion resist | Upkeep | Away days | Fort slots |
|---|---|---|---|---|---|---|---|---|
| 1 | Outpost | — | Claiming it | — | — | 1.00× | — | 1 |
| 2 | Camp | 2 | 3 visits in 14 days | +8% | +5% | 1.00× | +2 | 1 |
| 3 | Holding | 6 | 14 days held | +16% | +12% | 0.95× | +4 | 2 |
| 4 | Stronghold | 18 | 30 days held, deeded | +24% | +20% | 0.90× | +7 | 3 |
| 5 | Citadel | 45 | 90 days held, survived a contest | +30% | +28% | 0.85× | +10 | 3 + 1 permanent |

Caps (FIXED): decay resistance from level and fortification together at most +50%; erosion resistance at most +40%; a level adds nothing to a contest and 1.00× to toll income. Losing a zone drops two levels; reclaiming within 14 days restores it. Costs are burned.

### 4.6 Kit levels (SOURCE §10)

Starter 25% (—), Broken-in 23% (3), Trail 21% (9, unused charge carries over up to 50%), Distance 18% (22), Veteran 15% (50). Costs in day-shares, burned.

**DECISION NEEDED D8:** how Trail's carried-over charge interacts with "two scoring sessions a day" (FIXED). Carry-over could allow a third scoring session unless it is limited to charge, not scoring slots.

### 4.7 Fortify (SOURCE §11)

+30% decay resistance and −30% incoming erosion while active; up to 3 active per zone; each expires; burned whether you win or lose; at most +15% in a contest. **DECISION NEEDED D9:** price and duration (not in the source).

### 4.8 Engagement, clubs and seasons (SOURCE §14, §15)

Rally beacon, bounties, pincer, ghost, streak shields (never purchasable), the Atlas, a free-only season pass, reconquest, terrain and time. Clubs: three daily contracts, a self-set weekly goal of 2–7 days, 90-day seasons, district and city wars, layered leaderboards (block, suburb, city, country, world), landmark auctions with proceeds burned. Not shipping: area-weighted prize draws, a paid season track, cash top-up for charge, purchasable streak protection.

None of these create tokens. They are G4 and later; this spec records them so the territory model leaves room for them (club contributions, district control from solid plus shade).

## 5. Rewards and the toll (SOURCE §16–§21)

### 5.1 Supply and the daily pool (SOURCE §17, §29)

| What | Value | Tag |
|---|---|---|
| Total supply | 1,000,000,000 | FIXED |
| Player allocation | 400M | FIXED |
| Season | 90 days | SOURCE |
| Season pool | 9M in season 1, −10% each season, floor 2M | FIXED |
| Daily pool, season 1 | 100,000 | FIXED |

**ASSUMPTION A3:** a later season's daily pool is its season pool ÷ 90. The reference model confirms the source's arithmetic: the schedule releases exactly 400M over about 180 seasons.

### 5.2 A player's day (SOURCE §17)

```
effort       = clamp(√(minutes ÷ 40), 0.5, 1.0)                 HYPOTHESIS
day points   = Σ effort of the two best qualifying sessions × consistency
consistency  = ×1.00 … ×1.50 at six active days this week; a seventh adds nothing   FIXED
rate         = day pool ÷ everybody's day points
reward       = rate × day points, then trimmed by the ceilings
ceilings     = 12 per session, 20 per day (ratio 0.6)            HYPOTHESIS (ratio FIXED)
trust weight = 0 … 1; withheld weight stays in the pool          HYPOTHESIS
trimmed      → back to the season pool; never crosses a season   FIXED
```

- **ASSUMPTION A4:** consistency is linear, +0.10 per active day. The source fixes only the ends; Meera's fifth day at ×1.40 fits.
- **ASSUMPTION A5:** "best two" means best two by effort among qualifying sessions not marked unscored.
- **ASSUMPTION A6:** trust weight scales the reward after the pool split, so withheld weight returns to the pool rather than raising other players' rate. This is the reading of "the difference stays in the pool".
- **ASSUMPTION A7:** when the day ceiling trims, both scoring sessions are trimmed in proportion.

### 5.3 The toll (SOURCE §20)

```
toll       = session reward × 2% × (deeded cells of others crossed ÷ distinct cells crossed)
each owner = toll × owner's cells ÷ all tolled cells
```

- Rate 2.00%, once per session, FIXED and not governable.
- Own land and linked accounts' land are free. Laps count once per cell per session. Rounding remainders go to the runner. Shade never collects. Level, tier, fortification and spending have no effect on toll income.
- One owner's daily income is uncapped; the system total is bounded by the pool (180,000 in season 1, STRUCTURAL).
- Every toll is a matched debit and credit in the same settlement; they sum to zero.

**DECISION NEEDED D10: the toll basis.** §20 and rule 4 apply the toll to each *session's* reward. Meera's worked example (§18 step 6) applies it to her *day* total over "the 12 cells she crossed". The two agree only when the tolled session crossed exactly half the day's cells. The reference model follows §20 (per session).

**ASSUMPTION A8:** the toll is taken from the reward after ceilings and before recharge; recharge is computed on the pre-toll reward. Both follow Meera's working.

### 5.4 Locked and liquid (SOURCE §21)

- A free player's session rewards are LOCKED: spendable in game, never transferable, never converted later.
- After a player's first deed, later session rewards are LIQUID. Everything earned before stays locked forever, **enforced in the token contract**, not the backend.
- Tolls received, sponsor prizes and market purchases are LIQUID.
- Revenue valve: liquid issuance in a period is capped at what the business earned; the excess mints locked and the shortfall is published.
- Legal fallback (one configuration line): deed holders' rewards also stay locked, and staking becomes the only route to a sellable token.
- Needs legal sign-off in each market before liquid earnings ship (§32 phase 3).

**DECISION NEEDED D11:** the revenue-valve measurement period and what counts as "revenue".

### 5.5 Sinks (SOURCE §22)

Recharge, upkeep, land levels, kit levels, fortify, rally beacons, deed claim fee, contest entry, gear and cosmetics, landmark auctions and a season-end burn. All burned. A burn destroys tokens and never frees room to issue more. The deployed testnet contract's "burn" transfers to treasury and must be rebuilt.

## 6. Settlement and chain boundary (SOURCE §24–§27)

| Thing | On chain? | How |
|---|---|---|
| Session reward | Yes | In the daily settlement |
| Recharge, upkeep, levels, fortify, gear | Yes | Same settlement, with a receipt |
| Toll runner → owner | Yes | Matched debit and credit; sum to zero |
| Deed created or transferred | Yes, immediately | Its own transaction |
| Contest settlement | Yes, immediately | Its own transaction, out of escrow |
| XP, levels, streaks, badges, condition, materials | No | Game ledger |
| Route, cells, GPS | **Never** | §27 |

### 6.1 Settlement invariants (for the fuzz suite)

Derived from §17, §20, §22 and §26. The reference model's `dayBooksProblems` checks invariants 1–8 and the tests run it on scenarios of up to 40,000 players and on 300 seeded random days.

1. Minted ≤ daily pool.
2. Minted + returned to the season pool = daily pool, exactly.
3. Minted = credited to runners + tolls paid + burned, exactly.
4. Tolls paid = tolls received, exactly.
5. No credited amount is negative.
6. No session reward exceeds 12; no day reward exceeds 20.
7. No runner pays more than 2% of the day's reward in tolls.
8. Recharge + upkeep taken ≤ 60% of the day's reward.
9. A day settled under an unknown rules version fails closed.

Any violation halts settlement (§26). Settlement may pause new claims only, never withdrawals or transfers (§25, §29).

### 6.2 Authority boundary

- The phone previews; the server decides. Only server-verified sessions enter `settleDay`. The phone never declares cells, points or rewards (already the rule in `session.ts`).
- The off-chain half cannot create tokens. Only the settlement contract can, against that day's budget, with an authorised, expiring, chain-bound signature (§26).
- The algorithm is deterministic and versioned; an independent reconciliation job recomputes it.

**DECISION NEEDED D12:** the production number format. The reference model uses integer micro-MOVE with floors; the token has 18 decimals on chain. Settlement and reconciler must agree on one fixed-point representation and rounding order.

### 6.3 Wallet and gas (SOURCE §24, §25)

The source describes an email or phone plus passkey sign-up with an automatically created wallet, and a Base paymaster under six controls (allowlist, short-lived server signature, zero sponsorship until the first verified session settles, 10 actions per account per day, a global daily budget with a circuit breaker, no refund path). The way out is never sponsored-only.

The owner's 13 Oct decision for Play V1 (Google plus a wallet signature for sign-in only, no tokens) is unchanged by this. Embedded wallets and the paymaster are not built and not selected (§31); **DECISION NEEDED D13** when the economy phase begins.

### 6.4 Location data (SOURCE §27)

| Data | Where | How long | Who |
|---|---|---|---|
| Raw GPS and sensors | Encrypted, short-lived | 24–72 hours (TARGET) | Verification workers only |
| Fraud signals | Risk store, minimised | Reviewed | Fraud team, with an audit log |
| Game route | Private game ledger | Player chooses | Player and services they authorise |
| Sponsor analytics | Aggregated, thresholded | Campaign term | No individual path |
| Public chain | Day totals and amounts only | Permanent | Everyone |

Never published: live route, start point, regular schedule, crossing history. Start and end areas are blurred; public activity is delayed. Consents (location, fraud checks, marketing, sponsor analytics, public sharing) are separate and revocable.

The 24–72 hour raw-location target is not met today and is part of the X-25 retention decision.

## 7. Threat model (SOURCE §28, plus the reconciliation memo)

| Attack | Control in the source | Where it lives in the build |
|---|---|---|
| Fake GPS | Tamper checks, signed sensors, GPS/sensor/map agreement, one use per session, nothing created without the verifier's signature | Verification pipeline (built); signed sensors not built |
| Slow driving | Mode classification by cadence, acceleration, stops, altitude | Not built |
| Shaking the phone | Steps without displacement earn nothing | Partly (measurement) |
| Farming long runs | Effort saturates at 40 minutes; hard session ceiling | Reference model |
| Splitting one walk | 30-minute merge; 10 min and 750 m fresh; two score | Session model; merge not built |
| Never settling to dodge recharge | Charge on credit, carried forward | Not built |
| Many accounts | Locked rewards, trust weight, passkeys, device and route risk graph, physical movement | Not built (1,000-account cap in V1) |
| Paying each other tolls | Zero tokens created; related traffic excluded from deed metrics | Reference model excludes linked land |
| Ring-road toll lap | Shade never tolls or deeds | Spec; G2 |
| Manufactured deed traffic | 30 distinct people over 10 days; related and own traffic excluded | Not built |
| Buying the map | Rising upkeep, no level income, per-city cap, everything burned | Reference model (upkeep) |
| Club sweep | One support budget per person, diminishing returns, per-city limits | Not built |
| Griefing an owner | 30-day lockout, burned fee, 14 days of peace | Not built |
| Draining gas | Six paymaster controls | Not built |
| Signing key compromise | Hardware keys, per-job keys, short-lived signatures, rate bounds, rotation, circuit breaker; withdrawals never frozen | Not built |
| Interpolated ground (memo) | Inferred cells never claim, defend, toll or count traffic | ASSUMPTION A1; G2 must enforce |
| Route exposure through cell lists (memo, §27) | No cell list on chain or in public responses | G1 returns merged regions, never cell ids |

When the system is unsure (§28): *pending* keeps tokens and tolls reversible until final; *not eligible* gives a reason and never confiscates unrelated balances; an *appeal* is reviewed by a person and no permanent ban follows one weak signal.

## 8. Open items

### Assumptions (reversible; made so code can be tested)

| Id | Assumption |
|---|---|
| A1 | Interpolated cells are analytic only (from the reconciliation memo) |
| A2 | Day-share: median day reward among players with a scoring session, after ceilings and trust, before charges; lower middle |
| A3 | Later seasons' daily pool = season pool ÷ 90 |
| A4 | Consistency linear, +0.10 per active day |
| A5 | Best two sessions by effort, excluding sessions marked unscored |
| A6 | Trust weight applied after the pool split; withheld weight returns to the pool |
| A7 | Day ceiling trims both sessions in proportion |
| A8 | Toll on the post-ceiling session reward; recharge on the pre-toll day reward |
| A9 | A flip leaves the walker holding at the overflow, at least 1. With the source's numbers (push 100, strength 100) one stepped-on visit flips undefended fresh ground. **Owner decision 17 Oct:** the V3 numbers stay, and each walker can push a unit someone else holds at most once per day (a second push the same day is refused, whatever its kind; claiming and reinforcing are not limited, and a flip does not reset the day). Ground with any level or fortify resistance therefore takes one walker two or more days |

### Decisions needed from the owner

| Id | Decision |
|---|---|
| D1 | Session day attribution, time zone and day-close time |
| D2 | Shade shape metric and sprawl thinning formula |
| D3 | Masked-area data source |
| D4 | Base decay rate and decay stage thresholds |
| D5 | What a zone is, and the H3 resolution for cells |
| D6 | Per-city deed cap, claim-fee curve, "related account" definition |
| D7 | Contest movement score, club-support curve, home advantage value |
| D8 | Trail kit carry-over versus the two-session limit |
| D9 | Fortify price and duration |
| D10 | Toll basis: per session (§20) or per day (§18 example) |
| D11 | Revenue valve period and revenue definition |
| D12 | Production fixed-point format and rounding order |
| D13 | Embedded wallet and paymaster provider, when the economy phase starts |

## 9. What is built (truth table, 14 Oct 2026)

| Component | Status | Where |
|---|---|---|
| Session model with rules version and pauses | BUILT | `shared/src/domain/session.ts` |
| Sealing engine (three methods) | BUILT; "held ground" unavailable until G2 | `shared/src/domain/sealing.ts` |
| Canonical H3 grid | BUILT (resolution 8; see D5) | `shared/src/domain/h3.ts` |
| Map regions and owner coverage endpoint | IN REVIEW (draft #107) | G1 |
| Cells between samples | IN REVIEW, unwired, analytic only | G1 `route-cells` |
| Day reward, toll, day-close charges, books check | REFERENCE MODEL, tested, not wired, mints nothing | `shared/src/domain/economyV3.ts` (`@movenrun/shared/economy-v3`) |
| Holding arithmetic: claim, reinforce, erode, flip, decay, stages, deed and mask refusals, one push per walker per unit per day | REFERENCE MODEL, tested, not wired, stores nothing; D4 numbers are parameters, shade strength (D2) is an input, a unit is whatever D5 decides | `shared/src/domain/holding.ts` (`@movenrun/shared/holding`) |
| Holding ledger: a batch of a session's pushes applied to many units, sorted by day then event id, each event id applied once (a retried upload is skipped), stale-day and unknown-unit events rejected one by one, an append-only entry per applied push with previous and new holder and the rules version | REFERENCE MODEL, tested, not wired, stores nothing; same open parameters as the holding arithmetic | `shared/src/domain/holdingLedger.ts` (`@movenrun/shared/holdingLedger`) |
| Enclosed-area (shade) geometry, stored territory ledger | NOT BUILT | G2, after D2 and D5 |
| Deeds, contests, escrow | NOT BUILT | Later |
| Clubs, districts, seasons | NOT BUILT (preview only in the app) | G4 |
| Daily settlement, trust weight service | NOT BUILT | G3 |
| Locked/liquid in a token contract | NOT BUILT | Contracts; needs audit and approval |
| Embedded wallet, paymaster | NOT BUILT, no provider | D13 |
| Anything on Base mainnet | NOTHING | — |

The Base Sepolia contracts implement an older design (§31). So do the constants in `shared/src/constants/emission.ts` (halving schedule, a mint-time zone tax, 14-day challenges). They are left untouched; V3 code does not import them.

## 10. Build order (SOURCE §32)

0. **Simulation:** the daily budget holds, toll invariants balance, ceilings bite as §17 says, shade cannot be farmed, recharge is affordable at every population, upkeep deters hoarding, sessions cannot be split, contests are fair, fake-account economics under a shared pool.
1. **Credits-only pilot** (1,000–5,000 players): sealing, shade, erosion, levels, charge and daily settlement with no transferable reward at all.
2. **Limited $MOVE** (small verified group): books balance every day, appeals work, location deletion verifiably happens, tolls provably come from runner rewards, the paymaster holds under attack.
3. **Multiple cities** (10,000–25,000): geography partitions cleanly, club controls hold, market-manipulation tests pass, legal sign-off before liquid earnings.
4. **Full scale, then staking:** load test at 2× peak, external audit, incident drills, store and legal sign-off.

The reference model in section 9 is phase 0 tooling: it is the deterministic day algorithm a simulation drives. It creates no token and is not settlement.
