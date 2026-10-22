# Pilot research stop/go charter, G0 to G7 (proposal)

**Status:** research proposal from Track B, 22 October 2026. It activates nothing. Every stage below needs its own written owner sign-off, and none is implied by passing tests, green CI or this document.

**Standing labels:**
- Rule 1001 (immediate flip) stays the source default.
- Rule 1002 (two-day challenge, 20-hour server-receipt gap, 13 takes a day, res10 units in res9 zones) is an unratified alternative. It is approved only for pilot development and comparison.
- V3 revision 2 source mechanics keep their own labels (FIXED, HYPOTHESIS and so on, §29).
- Testnet transaction counts, synthetic results and fabricated traction never justify a launch.

## Evidence classes used here

| Class | Meaning |
|---|---|
| SOURCE | The owner's V3 revision 2 document says it |
| OWNER DECISION | A recorded decision, D-number or dated note |
| PILOT ASSUMPTION | A proposal value, for example 13 takes a day or a 200-player pilot |
| VERIFIED CODE | Read in code at `cb27318` and/or proven by a local test |
| SYNTHETIC EXPERIMENT | Output of this track's seeded simulations |
| HOSTED PROOF | A live observation. Track B has none |

## Blocking findings that apply to every stage from G2 on

These come from this track's deliverables. Each one has a local reproduction. None has been fixed in the source, because fixing it belongs to the integration owner.

| # | Finding | Evidence | Where |
|---|---|---|---|
| F1 | Settlement credits sessions the server received after the day's close, if settlement has not yet run. Sessions are selected by `end_time`, not receipt time, and the movement pipeline accepts sessions up to 30 days old, so results depend on timing and backdating is possible | VERIFIED CODE, reproduced on local PostgreSQL | `SERVER_AUTHORITY_INVARIANTS.md` |
| F2 | The server does not apply V3 rule 3, "nothing is claimed until sealed". `applySession` claims the units of any verified session without reading its seal result | VERIFIED CODE | `SOURCE_TO_IMPLEMENTATION_GAP_MATRIX.md` |
| F3 | Under 1002, units inferred between GPS fixes are pushed as full-strength solid ground. They claim, erode, flip and count as visits. V3 §4 says solid ground is ground actually stepped on. The toll correctly ignores these units. Owner ratification is needed | VERIFIED CODE, SYNTHETIC EXPERIMENT (25–29% of single in-limit gaps push an inferred unit) | B1, B4 |
| F4 | Player-day proofs detect an edited or reordered row. They do not bind the player or the day, are unkeyed and unchained, and nothing stops a plain UPDATE | VERIFIED CODE | B4 |
| F5 | No player cap exists, and the storage guard is off unless a quota variable is set | VERIFIED CODE | B4, B5 |
| F6 | The reference reconciler trusts the rules object it is given. The season roll-up does not re-check day books. There is no operator halt. The reference ledger model has no closed-day watermark, although the server enforces one (`day_closed`) | VERIFIED CODE | `ECONOMIC_BOOKKEEPING_ASSERTIONS.md` |
| F8 | Under 1002, the 13-a-day take budget counts any erosion of rival ground a route passes through. With no attackers at all, 30–33% of legitimate sessions hit it, including 91% of runner sessions | VERIFIED CODE (`rules.ts:147-174`) + SYNTHETIC EXPERIMENT | `G2_G4_FAIRNESS_AND_ABUSE_RESULTS.md` |
| F9 | 1002 cuts attacks on held ground by about 42x against the same rule object on res10 units (roughly 36–51x, 3 seeds). Attackers who are accepted as verified still take most vacant land: 67% of held ground at day 90 with 10% malicious players. The takeover rule cannot fix this; movement verification and per-person limits must | SYNTHETIC EXPERIMENT (worst case: every spoofed upload accepted) | B2/B3 |
| F7 | The toll basis is ambiguous between the session (§20) and the day (§18 example). The code follows §20. This is open decision D10 | SOURCE + VERIFIED CODE | B1, B8 |

## Stages

### G0 / G1: authoritative route, cell and map correctness

- **Entry:** F2 and F3 decided by the owner. The decision is recorded as a rules version, not a silent edit.
- **Metrics:**
  - verified-to-rejected ratio on synthetic and recorded fixtures;
  - share of pushed units that are stepped versus inferred;
  - zero claims from unsealed sessions, if rule 3 is ratified.
- **Quota:** no players. Fixture and simulation only.
- **Kill switch / rollback:** not applicable; nothing is live.
- **Data minimisation:** fixtures are synthetic. Any recorded traces are owner-supplied and stored outside the repository.
- **Owner sign-off:** the rule 3 enforcement point, inferred-unit semantics (D5/A1) and the res10/res9 unit choice.

### G2: controlled local holding simulation

- **Entry:** G0/G1 accepted.
- **Entry:** F1 fixed, so sessions count only if received before the day's close, with the cut-off bound into the input digest.
- **Entry:** the 1001 versus 1002 comparison is re-run on the patched rules with this track's harness, using the same seeds.
- **Metrics (from `G2_G4_FAIRNESS_AND_ABUSE_RESULTS.md`):**
  - attacker flips per 100 held units;
  - casual day-90 holding;
  - new-joiner holding at day 1, 7 and 30;
  - take-cap denials for legitimate long routes;
  - "valid walk, nothing claimed" rate;
  - Gini and HHI of holdings.
- **Thresholds:** stated in that file's manifest before running.
- **Quota:** synthetic only.
- **Kill switch:** not applicable.
- **Abuse incidence:** measured at 0, 2 and 10% malicious share.
- **Owner sign-off:** 1001 or 1002 (or a successor) as the pilot rule. This is a ratification, not a default change.

### G3: credits-only transaction books and replay/settlement

- **Entry:** F4, F6 and F7 closed.
  - Proofs bound to player and day, keyed or chained, and append-only.
  - The reconciler loads its rules from its own registry.
  - The season roll-up re-verifies day books.
  - An explicit operator halt for new settlement only, never withdrawals (V3 §29).
  - D10 decided.
- **Metrics:**
  - every day's books balance;
  - refusal-on-failure is total, with no partial lines;
  - replay of any day from proofs is byte-identical.
- **Quota:** a disposable local or staging database only, until a separate hosted-migration approval (0011 stays unapplied).
- **Rollback:** a day that fails reconciliation is not settled, and no approximate transfer is made.
- **Data minimisation:** zone ids in credit lines never reach any public output (rule 12).
- **Owner sign-off:** the hosted migration, retention (see `PILOT_CAPACITY_REDTEAM.md`, nothing ratified) and the storage quota.

### G4: private invite-only clubs and districts

- **Entry:** G3 accepted, and D18 to D23 decided.
- **Entry:** fix the two-club membership hazard, where one overlapping membership blanks all district control.
- **Entry:** district maps versioned, so past results are never recomputed with new geometry.
- **Entry:** leaderboard cut-offs never split a tie silently.
- **Entry:** corrections never made by re-settling a day.
- **Metrics:**
  - share of districts with a controller;
  - club-hopping flips per contested district;
  - leaderboard rows suppressed by the k-threshold.
- **Quota:** invite-only and below any approved player cap. F5 must be closed first, so the cap is enforced rather than nominal.
- **Privacy:** boards show only settled, aggregated activity (k ≥ 5 proposed). No routes, schedules or start points.
- **Kill switch:** board and club features each flag-off independently.
- **Anti-farming:** the review rule is chosen against an honest-review-rate threshold set in advance. The #123 4-of-14 rule reviews about 15% of honest accounts (96% of shared households) in synthetic runs. Proximity alone never opens a case. No auto-ban. An overturn mints and claws back nothing.
- **Owner sign-off:** D18–D23, whether the linkage graph may be built at all and its retention, and the appeal window.

### G5: notional Deed eligibility stress tests

- **Entry:** G4 accepted.
- **Entry:** owner decisions on G5-5 (transferability) and G5-6 (the privacy unit; the deed id is currently the public H3 cell, M8).
- **Metrics:** Sybil-ring break-even, the related-cluster 20% concentration rule (V3 §12), 30 distinct people over 10 days, and owner and linked traffic never counting.
- **Quota:** simulation only. No deed exists anywhere.
- **Owner sign-off:** the related-account definition (D6) and the per-city cap value. The source labels the cap FIXED but gives no number.

### G6: token-equivalent accounting tests with zero issuance

- **Entry:** G5 accepted, and the off-chain credit books proven at G3.
- **Metrics:**
  - 1 billion cap and 400M allocation conservation over at least 400 simulated seasons;
  - locked never liquid retroactively;
  - burns reduce supply, never a treasury transfer;
  - exact bigint micro-to-18-decimal conversion (the float path was wrong in about half of the generated cases).
- **Quota:** zero issuance, no contract and no chain.
- **Owner sign-off:** the revenue valve design (D11) and the all-locked fallback (M4: liquid tolls bypass the allowance today in the draft contracts).

### G7: independently audited chain architecture research only

- **Entry:** every NO-GO in `ONCHAIN_AND_DEED_RISK_REGISTER.md` cleared.
- **Entry:** an external security audit on the pinned compiler.
- **Entry:** independent economic and legal reviews (the escalation packet in that register).
- **Entry:** reconciliation of the reported Base Sepolia inventory by a read-only procedure run by the owner.
- **Quota:** no mainnet, no deployment and no transaction under this charter.
- **Owner sign-off:** every item. No real-value step is authorised by research.

## What "stop" means at any stage

- Any invariant failure in the books, an unexplained claim after a valid walk, an honest review rate above the stated threshold, or a privacy leak of route-level data stops the stage.
- After a stop, the stage returns to the previous accepted stage.
- No data is deleted to make a metric pass, and no live retention, limit, quota, auth provider or database role is changed by research.
