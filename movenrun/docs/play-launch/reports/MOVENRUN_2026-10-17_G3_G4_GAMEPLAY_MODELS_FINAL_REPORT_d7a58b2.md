# MovenRun 17 Oct 2026: G3 and G4 gameplay reference models

## Completed
- G3, draft #118 at 493b3fa on #117: zones held at day close from the
  holding ledger, day credits through the V3 settlement and its books check,
  season totals. Reproduces §17 (season pools 9M, 8.1M), §18 (Meera) and §19
  (Dan). Shared 210/210 (E-67).
- G4, draft #119 at d7a58b2 on #118: club membership per day, contributions
  from ledger entries, district control from holdings at day close, season
  leaderboard from settled days only (empty when nothing settled, never
  seeded; ties share a rank). Shared 223/223 (E-68).
- Both are pure shared models: no backend wiring, database, UI or chain.
  One push per walker per unit per day is unchanged.

## Open decisions (owner)
No value was invented; each is a required input or not applied.
- Existing: D2 shade shape, D4 decay numbers, D5 zone size.
- G3: D14 effect of "paid in condition", D15 shade-only ground and upkeep,
  D16 two-level loss and 14-day restore (G2 currently resets to level 1),
  D17 when free away days are spent.
- G4: D18 club membership limits and timing, D19 contribution weight,
  D20 what a district is and the leaderboard layers, D21 control rule
  (shade weight, minimum share), D22 leaderboard metric and tie order,
  D23 whether pushing a club-mate's ground erodes it.

## Live state and risks
Unchanged: staging at 2192de6, Pages 404, apex 200, `www` 308. Vercel free
plan reached 100 deployments per day at 12:43 UTC; previews fail for about
24 hours, GitHub checks unaffected. The PR stack #114 → #117 → #118 → #119
must be reviewed in order.

## Owner-only
Two-network check; X-05 approval and the choice of sign-in client for its
checks; decisions D1–D23.

## Next packet
QA0 and #115 device-gate preparation; G5 needs D-decisions before useful
work.
