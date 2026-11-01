# Fairness study rerun after the restart receipt-time correction (29 Oct 2026)

> **SYNTHETIC SIMULATION. HYPOTHESIS, credits-only.** Seeded synthetic walkers; nothing here observes real players. Five seeds cannot settle an owner decision. Rule set 1001 stays the default, 1002 stays disabled, 1003B is not registered, gameplay stays off.

## What changed

- **Base:** `feat/g34-server-holdings` at `4ee9d4a`, which includes the #176 correction (a restarted challenge takes the receipt time of the session that restarted it, in both write modes) and sealing v2.
- **Harness, seeds and parameters:** as in `G34_FAIRNESS_AFTER_AUTHORITATIVE.md`: seeds 1 to 5, 90 days, 126 accounts per seed, scenarios `after`, `before` (control), `thin3`, `thin6`, `distance2`, `hostile2`.
- **Simulation bug found and fixed here.** `experiments/ledger1003.ts` kept the first receipt time of a challenge even after the challenge restarted, so the 20-hour second-push gap was measured from a stale time and a returning walker passed it at once. `policy.ts` (the server) records a new time when the walker had no challenge or the challenge's first day changed. The ledger now takes the policy's answer. Pinned by `experiment1003.test.ts` ("a restarted challenge takes the new session's receipt time ...", failing before, passing after, receipts one second before, at and after midnight). The soft path cannot restart a challenge (it only handles deliberate returns inside the window), so only the normal path was affected.
- **Two reruns of the same code line, so the effects separate:**
  - `stale-1003-opening/`: the base as it stands, simulation bug still present (commit `dcbafc2`).
  - `fixed/`: after the simulation fix (commit `d5a10d1`).
  - The committed CSVs in `after-authoritative/` were not edited.

## Result in one paragraph

Against the committed CSVs, the base with the stale 1003 simulation changes only 1002 rows (16 of 196 in the main scenario, all inside noise, for example honest walker-days blocked 55.47% to 55.48%), as the 29 Oct note predicted; 1001 and 1003 rows are identical. The simulation fix then changes 1003B only, and it is **material for hostile outcomes**: hostile flips per hostile active day fall from 4.71 to 2.38 (5/day) and from 3.31 to 1.89 (3/day), and hostile flips of honest ground roughly halve. Previously reported 1003B hostile numbers were inflated by the stale opening time. 1001 and 1002 are not affected by the fix.

## Table (main scenario `after`, mean over 5 seeds)

Material means a change from the committed value larger than both the committed seed sd and 1 percentage point (for percentages) or 5% of the value (for rates and counts). Everything else is noise. The sd is shown for the committed run.

| Metric | Rules | Committed | Rerun, stale 1003 | Rerun, 1003 fixed | Verdict |
|---|---|---|---|---|---|
| honest walker-days blocked | 1002 | 55.47% (sd 3.92%) | 55.48% | 55.48% | noise |
| honest walker-days blocked | 1003B5 | 12.81% (sd 0.88%) | 12.81% | 12.08% | noise |
| honest walker-days blocked | 1003B3 | 23.68% (sd 1.12%) | 23.68% | 21.94% | **MATERIAL** |
| honest pushes on others' ground blocked | 1002 | 50.27% (sd 1.41%) | 50.27% | 50.27% | noise |
| honest pushes on others' ground blocked | 1003B5 | 2.75% (sd 0.30%) | 2.75% | 2.83% | noise |
| honest pushes on others' ground blocked | 1003B3 | 5.10% (sd 0.34%) | 5.10% | 4.98% | noise |
| hostile flips / hostile active day | 1002 | 1.07 (sd 0.04) | 1.07 | 1.07 | noise |
| hostile flips / hostile active day | 1003B5 | 4.71 (sd 0.12) | 4.71 | 2.38 | **MATERIAL** |
| hostile flips / hostile active day | 1003B3 | 3.31 (sd 0.11) | 3.31 | 1.89 | **MATERIAL** |
| honest flips / honest active day | 1002 | 1.02 (sd 0.03) | 1.02 | 1.02 | noise |
| honest flips / honest active day | 1003B5 | 2.21 (sd 0.08) | 2.21 | 1.82 | **MATERIAL** |
| honest flips / honest active day | 1003B3 | 1.87 (sd 0.07) | 1.87 | 1.59 | **MATERIAL** |
| hostile flips of honest ground (total) | 1002 | 729.20 (sd 44.81) | 730.20 | 730.20 | noise |
| hostile flips of honest ground (total) | 1003B5 | 3155.20 (sd 97.60) | 3155.20 | 1553.00 | **MATERIAL** |
| hostile flips of honest ground (total) | 1003B3 | 2252.20 (sd 70.83) | 2252.20 | 1232.20 | **MATERIAL** |
| honest holding at day 90 | 1002 | 85.71% (sd 2.52%) | 85.71% | 85.71% | identical |
| honest holding at day 90 | 1003B5 | 84.19% (sd 2.48%) | 84.19% | 84.38% | noise |
| honest holding at day 90 | 1003B3 | 86.67% (sd 1.78%) | 86.67% | 85.71% | noise |
| honest-held units kept day 14 to 90 | 1002 | 47.07% (sd 2.93%) | 47.04% | 47.04% | noise |
| honest-held units kept day 14 to 90 | 1003B5 | 39.65% (sd 3.22%) | 39.65% | 41.24% | noise |
| honest-held units kept day 14 to 90 | 1003B3 | 40.65% (sd 2.94%) | 40.65% | 41.60% | noise |
| honest accounts with a blocked day | 1002 | 87.05% (sd 1.86%) | 87.05% | 87.05% | identical |
| honest accounts with a blocked day | 1003B5 | 88.57% (sd 3.01%) | 88.57% | 86.10% | noise |
| honest accounts with a blocked day | 1003B3 | 92.95% (sd 0.85%) | 92.95% | 91.62% | **MATERIAL** |
| flips per touched unit | 1002 | 1.93 (sd 0.18) | 1.93 | 1.93 | noise |
| flips per touched unit | 1003B5 | 4.74 (sd 0.48) | 4.74 | 3.49 | **MATERIAL** |

1001 rows are identical in all three columns (blocked 0.0%, 13.81 hostile flips per active day, 6262 hostile flips of honest ground).

## Material changes

1. **1003B hostile flips per hostile active day:** 4.71 to 2.38 (5/day), 3.31 to 1.89 (3/day), against 1.07 for 1002. Holds in every scenario: thin3 4.77 to 2.46 and 3.38 to 1.97; thin6 4.86 to 2.58 and 3.49 to 2.10; distance2 4.59 to 2.32 and 3.17 to 1.79; hostile2 4.39 to 2.11 and 3.02 to 1.61.
2. **1003B hostile flips of honest ground (total per seed):** 3155 to 1553 (5/day) and 2252 to 1232 (3/day).
3. **1003B honest flips per honest active day:** 2.21 to 1.82 and 1.87 to 1.59; flips per touched unit 4.74 to 3.49 and 3.82 to 2.99. The map is less heated; honest walkers lose fewer flips as well.
4. **1003B 3/day honest walker-days blocked:** 23.68% to 21.94% (material by the rule above; 5/day moved 12.81% to 12.08%, noise), and honest accounts with a blocked day for 3/day 92.95% to 91.62%.
5. **Cohorts (1003B, from the CSVs):** spoofers' flips per active day 5.24 to 2.01 (5/day) and 3.74 to 1.78 (3/day); hostile takeover players 4.56 to 1.20 and 3.19 to 1.18; commuters 1.64 to 1.23 and small-loop walkers 1.99 to 1.28 at 5/day (their blocked share also falls by 3 to 4 points). Long-distance walkers are unchanged (flips per day 10.02 to 10.11; blocked 24.5% to 23.4%).

**Not material:** every 1002 row; honest holding at day 90 and unit continuity (inside sd); honest pushes on others' ground blocked; 1001.

## Effect on the 3-or-5 decision (owner decision, nothing ratified)

| 1003B | 5/day | 3/day |
|---|---|---|
| Honest walker-days blocked | 12.1% (was 12.8) | 21.9% (was 23.7) |
| Hostile flips per hostile active day | 2.38 (was 4.71) | 1.89 (was 3.31) |
| Hostile flips of honest ground per seed | 1553 (was 3155) | 1232 (was 2252) |

The earlier reading that 3/day buys 1.4 hostile flips per day for 11 points of honest blocking becomes 0.5 flips per day for 10 points. The gap between the two budgets on hostile outcomes is much smaller, so the case for 3/day weakened and the case for 5/day, if a pilot is wanted at all, strengthened. 1003B at 5/day still lets a hostile walker flip about 2.2 times as much as 1002 does (2.38 against 1.07).

## Caveats

- Synthetic walkers, scripted attack tours, 10 s fixes at 6 m noise; spoofers and hostile players are by construction. Credits are not simulated.
- Five seeds. The stale-versus-fixed 1003B difference is far outside the seed sd, but absolute levels are not a forecast.
- The fix concerns how the simulation reads the 20-hour gap after a challenge restart. It does not change any server code, rule set digest, or 1001/1002.
- The `before` control (inferred pushes on) shows the same pattern; its CSVs are in both folders.
- Scenarios `distance2` and `hostile2` draw different populations from `after`, as before.

## Sealing v2 re-exercise on the same base (unchanged)

`scripts/seal-v2-fairness.ts 20` reproduces the fixture table of `docs/g34/SEALING_V2_28OCT.md` cell for cell (38 fixtures, sigma 0, 5, 10, 15, 25): all 20 fair fixtures seal at sigma 0 and 5, none of the 14 abuse fixtures seals at sigma 0, parallel sidewalks 20 m apart leak 25% (500 m) and 50% (1.5 km) at sigma 5, and the sensitivity table matches (fair 92%, abuse 2%, owner 3% at sigma 10). `sealLoop.test.ts` and `sealLoopScale.test.ts` (17 tests: long lollipops, noisy 5 m and 10 m seeds, lawnmower, work budget) and `sealGate.pg.test.ts` (10 tests, throwaway local database) pass. No difference was found. The six pending owner decisions in section 7 of that document are all still open; the D-register (D10, D18 to D27) holds no sealing decision.

## Reproduce

```
cd movenrun/backend
for s in after before thin3 thin6 distance2 hostile2; do node --import tsx scripts/fairness-after-authoritative.ts $s 5 90 ../docs/sim/after-restart-fix/fixed; done
```

`stale-1003-opening/` is the same command at commit `dcbafc2`. Test: `backend/src/gameplay/experiment1003.test.ts`.
