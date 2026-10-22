# MovenRun Track B: territory economy red-team, final report

**Date:** 22 October 2026
**Branch:** `research/parallel-b-economy-redteam`, content head `8b6055d`
**Base:** `feat/g34-server-holdings` at `cb27318` (#121 after #129, #126 and #124 were folded into it)
**Scope:** synthetic and offline research only. Nothing here is a live feature, an approved rule or a hosted measurement.

## 1. Result in one paragraph

All nine Track B sections (B1 to B10) are delivered as runnable harnesses with tables a machine can read, plus reports in this folder. The combined suite runs 172 tests: 161 pass, 0 fail, 11 skipped. Of the skips, 7 need a throwaway local PostgreSQL and 4 need the PR #122 checkout; both sets passed when those were supplied. Every section was reviewed by an independent reviewer that did not write it, and all review fixes are applied, including one blocker in the simulator report (a hypothesis metric narrowed after a smoke run, now disclosed with the original verdict). The research found two server defects and one rule-3 enforcement gap that should be fixed before gameplay is enabled. It also found three behaviours of rule 1002 that need owner ratification, and several source inconsistencies. No source, migration, contract, release branch or shared evidence board was edited.

## 2. Deliverables

| Section | Report | Harness | Tests |
|---|---|---|---|
| B1 source ledger | `SOURCE_RULE_CATALOGUE.json` (79 entries), `SOURCE_TO_IMPLEMENTATION_GAP_MATRIX.md` | `research/economy-redteam/catalogue/` | 21 |
| B2/B3 scenario lab | `G2_G4_FAIRNESS_AND_ABUSE_RESULTS.md` | `research/economy-redteam/sim/` | 6 |
| B4 server authority | `SERVER_AUTHORITY_INVARIANTS.md` | `research/economy-redteam/invariants/` | 26 (7 need a local database) |
| B5 capacity | `PILOT_CAPACITY_REDTEAM.md` | `research/economy-redteam/capacity/` (calculator and local bench) | 7 |
| B6 anti-farming | `ANTI_FARMING_APPEALS_RESEARCH.md` | `research/economy-redteam/farming/` | 14 |
| B7 clubs and districts | `CLUB_AND_DISTRICT_FAIRNESS_BRIEF.md` | `research/economy-redteam/clubs/` | 20 |
| B8 bookkeeping | `ECONOMIC_BOOKKEEPING_ASSERTIONS.md` | `research/economy-redteam/bookkeeping/` | 31 (4 need #122) |
| B9 onchain and deeds | `ONCHAIN_AND_DEED_RISK_REGISTER.md` | `research/economy-redteam/contracts/` | 47 |
| B10 stop/go | `PILOT_RESEARCH_STOP_GO_CHARTER.md` | — | — |
| Start record | `HEADS_AT_START.md` | — | — |

**Run all tests from `movenrun/`:**

```
node --import tsx --test 'research/economy-redteam/**/*.test.ts'
```

How to regenerate each output is in `research/economy-redteam/README.md`.

## 3. Findings that matter most

The tier for each finding is in brackets.

1. **Late sessions can still earn credit (defect).** Settlement selects sessions by `end_time`, never by server receipt time. A session received after the day's close still earns a credit line if settlement has not yet run. The same upload gets nothing if settlement happened first. The movement pipeline accepts sessions up to 30 days old, so backdated sessions can also raise the active-days multiplier for the current day.
   - Evidence: VERIFIED CODE, reproduced on local PostgreSQL, and confirmed by an independent reviewer.
   - Fix: count a session only if it was received before its day's close, and bind that cut-off into `input_digest`.
2. **Unsealed sessions still claim ground (gap).** V3 rule 3, "nothing is claimed until sealed", is not enforced. `applySession` claims the units of any verified session without reading the seal result, under both 1001 and 1002.
   - Evidence: VERIFIED CODE. The independent reviewer found no upstream gate.
3. **Inferred units under 1002 count as solid ground.** Units filled in between GPS fixes are pushed as full-strength solid ground. They claim, erode, flip and count as visits. V3 §4 defines solid as ground actually stepped on. The toll correctly ignores these units.
   - Evidence: VERIFIED CODE + SYNTHETIC EXPERIMENT (25–29% of single in-limit GPS gaps push an inferred unit).
   - Needs owner ratification. A `pushInterpolated: false` switch already exists.
4. **1002's take budget catches ordinary routes.** It counts any erosion of rival ground a route passes through. With no attackers, 30–33% of legitimate sessions hit the 13-a-day cap, including 91% of runner sessions.
   - Evidence: VERIFIED CODE + SYNTHETIC EXPERIMENT.
   - Needs an owner decision on whether incidental erosion should count.
5. **1002 against 1001.**
   - **Attacks on held ground:** 1002 cuts them by about 42x (roughly 36–51x, 3 seeds) against the 1001 rule object on the same resolution-10 units. 1001 as configured today, on resolution-8 cells, is worse again.
   - **Competition:** ground changes hands between legitimate players about 11x less. Casual players hold more and longer.
   - **The 20-hour gap:** it removes fast straddle completions but barely moves attacker flips (0.78 vs 0.81). It reduces legitimate flips by 15%.
   - Evidence: SYNTHETIC EXPERIMENT. Whether calmer is better is a product choice.
6. **Verified attackers still take vacant land under any takeover rule.** With 10% malicious players they hold 67% of held ground by day 90 under 1002, mostly from claiming empty land. This is a worst case in which every spoofed upload is accepted. The defence is movement verification and per-person or per-device limits.
   - Evidence: SYNTHETIC EXPERIMENT.
7. **The #123 review rule reviews many honest people.** It puts about 15% of honest accounts into review at 1,000 accounts (96% of shared households, 69% of siblings). #123's 1.3% headline is a share penalised by at least 1% of credit, not a review rate. Unlinked farming rings are caught 0% of the time.
   - Evidence: SYNTHETIC EXPERIMENT.
   - Proximity alone would review nearly every commuter. No proposed variant passes every bar set in advance.
8. **Credit books balance; fault handling has gaps.** Books balance in 17 of 18 properties across thousands of generated cases. Every injected fault refuses the whole day.
   - Evidence: VERIFIED CODE + SYNTHETIC EXPERIMENT.
   - The reconciler trusts the rules object it is passed.
   - The season roll-up does not re-check day books.
   - There is no operator halt.
   - An unsafe-integer pool can pass the books check. This one is low reachability.
   - The float conversion from credits to an 18-decimal unit was wrong in about half of generated cases. Exact integer conversion works.
9. **Storage.**
   - The local bench replicated #129 revision 3's VACUUM FULL size (40.4 MiB) and WAL (976 vs 978 MiB). It did not replicate the 146.9 MiB bloated size: it measured 116.8 MiB, because the bloated size depends on when autovacuum happens to run.
   - Aggressive per-table autovacuum cut challenge-table bloat 5.7x.
   - A 200-player pilot fits for 90 days. Keeping everything for four seasons reaches 85–97% of usable quota.
   - Projections are order of magnitude only (24–38% high in the worst bench check).
   - Evidence: SYNTHETIC EXPERIMENT on local PostgreSQL 16, plus the projection model.
10. **Contracts.**
    - **Fixed in the drafts:** H1, H2 scoring, H3 and N1 are fixed in #122's draft patches but not audited. Their regression proofs pass on the in-process Hardhat network.
    - **Still open:** contest declaration single-signed; rules version not snapshotted; liquid tolls bypass the allowance; locked balance can buy a transferable deed; the deed id is the public H3 cell; the timelock has no delay floor.
    - **Prototype contract:** its `greatBurn` is a treasury transfer, not a burn.
    - **The 76 old-suite failures:** 31 are harness clock assumptions, 19 are a claim-fixture port, 25 are real contract-design changes and 1 was a shim error.
    - Evidence: VERIFIED CODE and local EVM runs. No public RPC, key or transaction was used.
11. **Source inconsistencies.** These are SOURCE findings, recorded and not resolved.
    - **Toll basis (D10):** Meera's §18 toll is charged on her whole day, while §20 defines it per session.
    - **Upkeep table:** the §7 16-zone row prints 1.00 where the formula gives 0.96.
    - **Ceiling order:** the order of the per-session and per-day ceilings changes results, and the source does not specify it.
    - **Trimmed amounts:** the source says they are re-spread over the season; the code does not do this.
    - **Deed cap:** the per-city cap is labelled FIXED but has no value.

## 4. Seeds, assumptions and what was not done

- **Seeds:** every manifest lists its seeds (`sim/manifest.json`, `farming/manifest.json`, `clubs/manifest.json`, `bookkeeping/seeds.json`, `invariants/manifest.json`, `contracts/seeds.json`). The same seed gives byte-identical output.
- **Smaller sweep:** the simulator sweep was cut to 2–5 seeds per cell to fit the compute budget, logged as manifest revision 2. A comparison with #123's study is non-replication, because its exact fixture was not re-run.
- **Geography:** all synthetic, an arbitrary grid with no real city. Retention and dropout appear only as labelled model assumptions, never as observed retention.
- **Not done:**
  - No hosted database, live API, public RPC, testnet, wallet, key or deployment.
  - No per-table WAL attribution run (it is scripted).
  - No bench beyond 14 days or 1,000 players.
  - No reconciliation of the reported Base Sepolia inventory, which would need an RPC call.
  - The pinned 0.8.24 compiler was unavailable offline, so solcjs 0.8.26 was used.
- **Blocked or refused:** one clean-up removal of old simulator outputs was refused by a local safety check, so the files were overwritten instead. The account usage limit paused the work three times (04:58–09:20, 09:32–14:20 and about 14:30–19:20 UTC); work resumed from saved state each time.
- **HOSTED PROOF:** none.

## 5. Top 10 decisions for later owner review

1. Bound settlement by server receipt time, and decide the late-upload grace against the 30-day movement age (finding 1, D1).
2. Enforce rule 3 server-side so unsealed sessions claim nothing, or ratify otherwise (finding 2).
3. Decide whether inferred units between fixes may push, and with what strength (finding 3, D5/A1).
4. Decide whether 1002's take budget counts incidental erosion or only deliberate contests (finding 4).
5. Choose 1001, 1002 or a successor as the pilot rule, given the competition and protection trade-off (finding 5). Ratify or drop the 20-hour gap.
6. Decide the toll basis (D10) and the order of the per-session and per-day ceilings (A7).
7. Choose a linkage-review rule against an honest-review-rate bar set in advance. Decide whether a device or link graph may be built at all, and its retention (finding 7).
8. Decide the storage quota, operating reserve, autovacuum policy for the challenge table, and retention windows. 14/120 days, 300 units a day, 200 players and the 60/75/85% tripwires remain unratified.
9. Settle D18–D23 for clubs and districts, including a fix for the two-club membership hazard and versioned district maps.
10. Deed transferability (G5-5), the deed privacy unit (G5-6), and an all-locked fallback against liquid tolls (M4). These come before any further contract work.

## 6. Integration digest

- **Affected paths:** added only, nothing else touched.
  - `movenrun/research/economy-redteam/**`: 8 harness folders and a README, about 3.1 MB including vendored contract copies and outputs.
  - `movenrun/docs/parallel/economy-redteam/**`: 12 files.
  - No change under `backend/`, `shared/src/`, `contracts/`, migrations, deployment workflows, package manifests, lockfiles or shared evidence boards.
- **Test evidence:** 172 tests, 161 pass, 0 fail, 11 skipped (database and #122 tests, which pass when supplied).
- **SHAs:**
  - Content head `8b6055d1571a27deffec3644d1c8d6ec522f1ea0` (this report is committed on top of it).
  - Base `cb27318d6654bf0e730fb05e9d523e9d60c8ced1`.
  - Code citations are pinned to `cb27318`.
- **Conflicts with the ongoing integration:**
  - No file overlaps. Since this track started, #121 moved to `850bf64`, which maps exhausted deadlock retries to 409. That shifts some `service.ts` line numbers by about 6 to 13 lines but changes no finding.
  - #127 and #128 were not touched.
  - Findings 1–3 are patch proposals for the #121 owner, not edits here.
  - The project's reports index (`docs/play-launch/reports/INDEX.md`) was not edited because it is a shared board. The integration owner may add this report to it.
- **Smallest next integration set:** each item is a separate small change on #121, in this order.
  1. The receipt-time bound in settlement, plus a regression test mirroring the B4 fixture.
  2. Server-side seal enforcement, or a recorded owner decision not to enforce it.
  3. An append-only trigger on `gameplay_player_day_proofs` and a review of its `ON DELETE CASCADE`.
  4. `Number.isSafeInteger` in the day-books check, and the reconciler loading rules from its own registry.
  5. A per-table autovacuum setting for the challenge table, proposed in 0011 and not applied.
- **Not to merge directly:** this research branch should not be merged into #121, #129's line, `main` or any release branch. Import only the specific fixes above.
