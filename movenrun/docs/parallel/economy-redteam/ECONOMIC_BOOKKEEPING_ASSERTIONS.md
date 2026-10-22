# Economic bookkeeping assertions (Track B, B8)

Status: research. Nothing here issues, converts or transfers anything. The models tested are the reference G0 day settlement (`shared/src/domain/economyV3.ts`), the G3 off-chain credits path (`holdingLedger.ts`, `holdingSettlement.ts`), and, on the token-equivalent side, PR #122's research models (`shared/src/sim/contractLedger.ts`, `economyG5.ts`) read from a read-only checkout. Code citations are at base `cb27318`. Rule 1001 stays the default; nothing here depends on 1002.

## 1. How to run

```
cd movenrun
node --import tsx --test 'research/economy-redteam/bookkeeping/**/*.test.ts'
# with the #122 side (otherwise its 4 tests are skipped, not failed):
BOOKKEEPING_WT122=/path/to/pr122/movenrun node --import tsx --test 'research/economy-redteam/bookkeeping/**/*.test.ts'
# full matrix to out/properties.json and out/properties.csv:
node --import tsx research/economy-redteam/bookkeeping/run.ts
```

Result at time of writing: 31 tests, 31 pass, 0 fail, about 8 s (27 pass and 4 skipped without the #122 checkout). 31 tests pass; P11 is a failing property, asserted by the BK-D1 fixture (its generic test is titled as a known failure). Two runs of `run.ts` give byte-identical `out/properties.json`, and a test checks that the same seed gives identical output while a different seed does not.

Harness: our own mulberry32 generator (`lib/prng.ts`), no property-testing dependency. Seeds and case counts are in `seeds.json` (version 1). Oracles in `lib/oracle.ts` were written from the source constraints, not copied from `dayBooksProblems`: the toll is recomputed exactly in bigint, the returned amount is rebuilt from its parts, and every amount must be a non-negative safe integer. All ids in the generated cases are synthetic labels.

Hypotheses, fixed before running: every listed invariant holds on every generated case. Where a function gets input that breaks an invariant, the correct behaviour is to refuse the whole day (throw, or return `refused` / a non-empty problem list). It must never return books that are approximate or partial. Any other outcome counts as a defect.

## 2. Off-chain credits and the notional token are kept apart

| Layer | What it is | Locked/liquid | Tested by |
|---|---|---|---|
| G0/G3 credits | Off-chain integer micro-credits; `CreditLine` has no transferable, liquid, wallet or token field (P18) | Not applicable: nothing is transferable | P01–P18 |
| Notional token (#122 `economyG5`) | SIMULATION ONLY projection of locked/liquid balances under conversion policies | Only the §21 rule: liquid only after the holder's first deed, tolls received are liquid | G02–G05 |
| 18-decimal unit | `lib/units.ts`, a reference converter written for this harness; **no product code converts micro to wei today** | None | P17 |
| Legacy contracts (`contracts/src`) | Prototype inventory, read statically, never executed or deployed | n/a | BK-D5 |

No exchange, price or liquidity unlock is modelled.

## 3. Invariant matrix

Tier key: SOURCE = the V3 PDF says it; VERIFIED CODE = a test drives the real function; SYNTHETIC = generated cases with seeds. Every result row is VERIFIED CODE + SYNTHETIC unless it says otherwise.

| Invariant | Source | Function under test | Property / test (cases, seed) | Result |
|---|---|---|---|---|
| INV-CAP-01 400M allocation released exactly; ≤ 1bn | V3 §17, rule 2 | `seasonPoolMicro` | P09 (2,000, 80109) | pass. Pools stop after season 180. Daily flooring leaves 3,460 micro never issued across all seasons, which is conservative |
| INV-CAP-02 season issuance ≤ season pool; 91 days refused | V3 §17 | `settleCreditsSeason` | P09, P14 | pass |
| INV-CAP-03 1bn representable (micro is a safe JS integer, 9× headroom; wei < 2^256) | rule 2 | `lib/units.ts` | P17 (5,000, 80117) | pass. Headroom is only 9×, so aggregate sums need bigint |
| INV-POOL-01 minted ≤ daily pool | V3 §17 | `settleDay` | P01 (3,000, 80101) | pass |
| INV-POOL-02 minted + returned = pool | V3 §17 | `settleDay` | P01, P02 | pass |
| INV-POOL-03 day pool = season's daily pool | V3 §17 | `settleCreditsDay` | P10 | pass for days the function produces; see BK-D3 for days it does not |
| INV-RET-01 returned = split dust + trust withheld + session trim + day trim, each ≥ 0 | V3 §17 | `settleDay` | P02 (3,000, 80102) | pass. Split dust ≤ 36 micro per day |
| INV-MINT-01 minted = credited + tolls + burned | V3 §26 | `settleDay`, `dayBooksProblems` | P01 | pass |
| INV-TOLL-01 Σ tolls paid = Σ received | V3 §20, §26 | `settleDay` | P01 | pass. Per owner, the exact bigint recomputation has 0 divergences |
| INV-TOLL-02 toll ≤ 2% of one session, never multiplied by owner count | rule 4, §20 | `sessionToll` | P03 (5,000), P05 (2,000; n = 1, 2, 50, 51, 1000) | pass. Many owners never pay more than one owner of the same cells; the largest rounding gap is 998 micro at n = 1000 |
| INV-TOLL-03 rounding remainder stays with the runner | V3 §20 | `sessionToll`, `settleDay` | P01, P03 | pass. Shares equal the exact per-owner floor in all cases |
| INV-TOLL-04 own and linked land never tolled | V3 §20 | `sessionToll`, `settleDay` | P06 (3,000, 80106) | pass. Own land counts as undeeded |
| INV-PATH-01 laps, repeats and order do not change the toll | V3 §20 | `sessionToll` | P04 (3,000, 80104) | pass |
| INV-CEIL-01/02 session ≤ 12, day ≤ 20 | V3 §17 (HYPOTHESIS values) | `settleDay` | P01 | pass |
| INV-SESS-01/03 two best qualifying sessions, ties to the earlier one; a worse third session changes nothing | V3 §17, §8 | `scoringSessionIndices` | P07 (5,000, 80107) | pass |
| INV-ONCE-01 deterministic and order-free; retried ledger batch is a no-op | V3 rule 7, §26 | `settleCreditsDay`, `applyLedger` | P13 (1,000, 80113) | pass |
| INV-ONCE-02 a day summed twice is refused | rule 7 | `settleCreditsSeason` | P13, P15 | pass, but only within one call (BK-D3) |
| INV-COST-01 automatic charges ≤ 60% of the day's reward | V3 §8, §22 | `dayCloseCharges` via `settleDay` | P01 | pass |
| INV-COST-02 costs (toll + charges) ≤ reward | rule 10 | `settleDay` | P01, P08 | pass |
| INV-NEG-01 no negative credited, net or season balance | V3 §7, §8 | `settleDay`, `settleCreditsDay`, season | P01, P10, P14 | pass |
| INV-BURN-01 burns reduce supply: Σ net credits = minted − burned; no treasury line exists | V3 §22 | `settleDay`, `settleCreditsDay`, season | P01, P10, P14 | pass off-chain. The legacy contract fails this (BK-D5) |
| INV-ZERO-01 zero-reward day: nothing minted or burned, pool returned whole, upkeep paid in condition | V3 §19 | `settleDay` | P08 (2,000, 80108) | pass |
| INV-REFUSE-01 any fault refuses the whole day, with no partial lines | V3 §26 | `holdingsAtDayClose` + `settleCreditsDay` | P10 (3,000, 80110): 12 fault kinds, all refused, about 120 each; 1,538 clean days settled | pass |
| INV-INT-01 hostile numeric input is refused or yields balanced, safe-integer books | V3 §26 | `settleDay` + `dayBooksProblems` | P11 (3,500, 80111) | **FAIL**: documented as BK-D1 |
| INV-VER-01 unknown economy version, holding-rule mismatch and mixed-version season are refused | V3 §30 | `economyRulesFor`, `settleCreditsDay`, season | P12 (1,000, 80112) | pass. A forged rules object is a separate case (BK-D2) |
| INV-MISS-01 a season with missing days sums only the days settled | V3 §17 | `settleCreditsSeason` | P14 (1,000, 80114) | pass. Pools of unsettled days are reported nowhere (BK-G2) |
| INV-LATE-01 stale pushes rejected; a settled day is never re-summed | V3 rule 7, §28 | `applyLedger`, season | P15 (1,000, 80115) | pass. The reference model has no watermark (P15: all 1,000 late pushes accepted by `applyLedger`, a reference-model property); the server enforces it with `day_closed` (VERIFIED CODE, BK-G1) |
| INV-HALT-01 a halted (refused) day stops the season sum | V3 §26 | `settleCreditsSeason` | P16 (1,000, 80116) | pass. No explicit operator halt exists (BK-G3) |
| INV-WEI-01/02 micro↔wei exact; sub-micro dust and unsafe numbers refused; day identities hold in wei | rule 2, §26 | `lib/units.ts` over `settleDay` books | P17 | pass. The float path (`micro × 1e12`) was wrong in 2,456 of 5,000 cases, so it must not be used |
| INV-GPS-01 no route or cell ids in the books | rule 12, §26–27 | `settleCreditsDay` output | P18 (1,000, 80118) | pass for books and amounts. 813 of 1,000 days have `CreditLine.unvisitedZoneIds`, which are holder zone ids and must be dropped from anything published (BK-G4) |
| INV-LOCK-01 credits carry no liquid or transferable state | rule 11, §21 | `CreditLine` shape | P18 | pass |
| Token side: budgets = 400M ≤ 1bn and agree with economyV3 within 1 micro | V3 §17 | #122 `seasonBudgets` | G01 | pass (needs the #122 checkout) |
| Token side: toll ≤ 2% per payer-day; owner never pays self | V3 §20 | #122 `tollIncome` | G02 (1,000, 80202) | pass. Its basis is the day, not the session |
| Token side: books balance, burns reduce supply, pool respected, cumulative ≤ 400M | V3 §17, §22 | #122 `projectEconomy` | G02–G05 (420 seasons at 100,000 copies) | pass |
| Token side: locked never becomes liquid retroactively | rule 11, §21 | #122 `projectEconomy` | G02 | pass. Liquid ≤ post-first-deed earnings + tolls; liquid is 0 under `locked_only`/`none` and with no deeds |
| Token side: issuance bounded by verified movement and time | rule 1, §26 | #122 `prototypeDailyPool` | H1 fixture | **documents defect**: one day-90 publication takes the whole season budget, and the full 400M can go in 0 wall-clock days (prototype contract model) |

## 4. Defects and gaps (source is not patched here)

BK-D1 to BK-D5, BK-G1 and #122 H1 have green fixtures in `bookkeeping.test.ts` or `g5.test.ts`, named "documents defect: …" or "documents gap: …". BK-G2 to BK-G4 are described in prose only.

**BK-D1. Unsafe integers pass the reconciler (low reachability).** *[VERIFIED CODE + SYNTHETIC EXPERIMENT]* `settleDay` checks `Number.isInteger(poolMicro)` (economyV3.ts:368), not `isSafeInteger`. A pool of 2^62, 2^53 or `Number.MAX_VALUE` settles. `dayBooksProblems` (economyV3.ts:468–484) compares floats, so `minted + returned === pool` can hold while `returned` is not the exact difference: at `MAX_VALUE`, the minted amount disappears into rounding. P11 also finds a `zonesHeld` of about 1.8e308 giving a non-safe `upkeepPaidInConditionMicro`. Through `settleCreditsDay` the pool comes from the rules, so this cannot be reached there today. *Patch:* require `Number.isSafeInteger` for every micro input and output in `settleDay` and `dayBooksProblems`, bound `zonesHeld`, and do the reconciler sums in bigint.

**BK-D2. The reconciler trusts the rules object it is handed (medium, by design today).** *[VERIFIED CODE]* `settleDay` and `dayBooksProblems` take `rules` as an argument. A forged object that keeps `rulesVersion: 1` but sets `tollBasisPoints: 500` settles a 5% toll, and the reconciler passes it when given the same object. It refuses the day when it uses `economyRulesFor(1)`. *Patch:* an independent reconciler loads rules from its own registry by version and asserts the FIXED values (200 bp, 6000 bp, two sessions); `dayBooksProblems` should accept a version number, not an object.

**BK-D3. The season sum does not re-check its days (medium).** *[VERIFIED CODE]* `settleCreditsSeason` (holdingSettlement.ts:328–365) accepts any object with `status: "settled"`. A day with its pool doubled and a line inflated by 1,000 units is summed, so season balances no longer equal issued minus burned. A day index of 400 in a 90-day season is also accepted. Duplicates are caught only within a single call. *Patch:* re-run `dayBooksProblems` with registry rules on each day; check `poolMicro === dailyPoolMicro(season)`, `Σ line.net === minted − burned` and `0 ≤ day < seasonDays`; persist a settled-day key so a second call cannot sum the same day again.

**BK-D4. Non-finite inputs give NaN or Infinity at function level (low).** *[VERIFIED CODE]* `sessionToll` with a NaN reward returns `paidMicro: NaN`, and with Infinity it returns Infinity (the guard at economyV3.ts:231 is `<= 0`). `dayCloseCharges` with a NaN day-share returns NaN upkeep. An invalid `kitLevel` inside `settleDay` produces NaN books that are refused only by coincidence, because NaN fails the equality check. These do not occur via `settleCreditsDay`. *Patch:* throw `RangeError` on any non-finite or negative amount and on any unknown kit or land level.

**BK-D5. The legacy "burn" is a treasury transfer, and it is partial (prototype contract, read statically and never executed).** *[VERIFIED CODE (static read only) + SOURCE §22]* `SeasonController.greatBurn` calls `transferFrom(owner, daoTreasury, burnAmount)` inside `try … catch {}` (SeasonController.sol:101). Supply does not fall, and failed transfers are skipped while the rest proceed, which leaves partial books. V3 §22 itself says this must be rebuilt. *Patch:* a real `_burn`, and atomic all-or-nothing. B9 owns the contract register.

**#122 H1 (prototype settlement model).** *[VERIFIED CODE, on #122's research model]* `prototypeDailyPool(budget, 0, 90)` equals the whole budget, and `prototypeFastestExhaustion` mints 400M in 0 wall-clock days. This confirms #122's finding at the model level. Issuance is not limited to verified movement or elapsed days.

**BK-G1. No closed-day watermark in the reference ledger (reference model only).** *[VERIFIED CODE]* Pure `applyLedger` accepts a push dated a day that may already be settled when the unit has not been touched since. All 1,000 such pushes were accepted in P15; this is a property of the reference model only. The server enforces the watermark: `applyBatch` takes a shared advisory lock for the day and throws `day_closed` (409) once the day has a settlement row or is past the last closed day (backend/src/gameplay/service.ts:525). The pg tests cover this (gameplayRules.pg.test.ts:306, 318; gameplay.pg.test.ts:522). In the reference model, no credits move retroactively, because settled days are immutable and re-summing is refused. *Recommendation:* mirror the server rule in the reference model with a `closedThroughDay` input, so that model and server cannot drift.

**BK-G2. Unsettled day pools are not reported.** *[VERIFIED CODE + SYNTHETIC EXPERIMENT]* The season result reports `returned` only for settled days. Across P14, 131.2M units of unsettled pools appear in no figure. The source's "spreads across the season's remaining days" is not modelled, because daily pools are static (ASSUMPTION in economyV3.ts:138–144). *Patch:* report `unsettledPoolMicro = seasonPool − Σ day pools`.

**BK-G3. No explicit emergency halt.** *[VERIFIED CODE]* The G0/G3 models have no operator halt input. A halt exists only as reconciler refusal, which P16 shows propagates correctly. *Patch, for owner decision:* a halt flag that makes `settleCreditsDay` refuse.

**BK-G4. Credit lines carry zone ids.** *[VERIFIED CODE + SOURCE rule 12]* `CreditLine.unvisitedZoneIds` is needed for D14. It must not go into any published or committed settlement (rule 12, §27). Any commitment format should be built from amounts only.

**Not a defect, noted.** *[VERIFIED CODE]* Session inputs (`CreditsPlayerInput.sessions`) are not tied to ledger entries or stamped with a rules version, so "issuance only from verified movement" depends on the caller. Infinite minutes and meters are accepted as maximum effort (P11, books balanced). Upstream session verification has to reject them.

## 5. Refusal behaviour

- `settleCreditsDay` refused every one of the 12 injected fault kinds: mixed levels in a zone, entry rules version, unit without a zone, unknown economy version, holdings day mismatch, bad kit, trust out of range, duplicate player, bad season, unit under the wrong key, unit dated in the future, bad active days. Each refusal returned problems only, with no `lines` and no `settlement` (P10).
- `settleCreditsSeason` refused every season containing a refused (halted) day, a duplicate day, another rules version or 91 days. A refusal carries no totals (P09, P13, P14, P16).
- `applyLedger` rejects stale, duplicate and malformed events without writing to the ledger (P13, P15).
- Gaps in refusal: BK-D1, BK-D2, BK-D3 and BK-D4 above. In each of these, books are produced and not refused.

## 6. Source worked examples

- **Dan (V3 §19)** reproduces from the stated inputs: 40 Camp zones unvisited, no reward, day-share 2.50. Upkeep owed is 7.55 and all of it is paid in condition.
- **Meera (V3 §18)**: recharge 0.92, upkeep 0.47 and credited 2.27 reproduce from the stated day reward of 3.68 and day-share of 2.50. The source's 3.68 itself comes from rounded intermediates; exact arithmetic gives about 3.689. **The toll reproduces only on the day basis.** The source computes 3.68 × 2% × 3/12 on the day total. The model follows §20, which bases the toll on the session (evening session reward 1.84). The result then depends on how many of the 12 cells the evening loop crossed, and the source does not say: 6 cells gives 0.0184 (matches), 12 cells gives 0.0092, 3 cells gives 0.0368. This is decision D10. Per-owner floors give 0.018399, with 1 micro left with Meera, as §20 says it should be.

## 7. Limitations

- Synthetic cases only, with no hosted proof. Populations per case are small (≤ 60 players). The 40,000-player Meera day is already covered by the repository's own test.
- The oracles partly re-derive points with the same `effort` and `consistencyMultiplier` functions, so P02's decomposition is not independent of those two formulas.
- D4, D5, D14 and D15 values in the harness are placeholders (`HARNESS_HOLDING_RULES`, zone = id prefix), not proposals.
- The #122 side runs only when `BOOKKEEPING_WT122` points at a checkout. Its traces are synthetic, in #122's shape. Toll income there uses the day basis.
- Legacy Solidity was read as text and never compiled or run. The 18-decimal converter belongs to this harness, not the product.

## 8. Open owner decisions raised

D10 (toll basis: session or day); where the independent reconciler gets its rules (BK-D2); whether the reference model should mirror the server's `day_closed` watermark (BK-G1; the server already enforces it); an explicit halt control (BK-G3); whether trimmed amounts are redistributed across the season's remaining days (BK-G2).
