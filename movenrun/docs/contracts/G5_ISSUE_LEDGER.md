# G5 contract issue ledger (28 Oct 2026)

**Status: RESEARCH / PROPOSED. Not audited. Not deployed. No chain action of any kind.**
No contract was deployed, no transaction was signed or broadcast, no faucet, mint, allowance,
market, payout or wallet action was taken, and no public RPC was contacted. Every result below
comes from Hardhat's in-process network (chain id 31337) with Hardhat's built-in test accounts.
A green Hardhat run is not an audit and is not evidence of financial readiness. Nothing here
makes any claim about the value of MOVE, deeds or any return.

Scope: the research copies in `movenrun/shared/contract-proofs/g5-ledger/patched/` (draft
patches over the pinned prototype `c8262ec`, `movenrun/contracts/src/v3`), plus the legacy
`src/SeasonController.sol` at the same commit for `greatBurn`. The pinned prototype itself and
`feat/v3-onchain-core` are not modified.

Base: `research/g5-deed-void-valve-hardening` at `355b8f5` (see `DEED_VOID_LIFECYCLE.md`).

## 1. How to run, compiler, counts

```
G5_PORTED_SUITE=1 G5_MODE=patched bash movenrun/shared/contract-proofs/g5-ledger/run.sh   # ported suite + hardening + ledger
bash movenrun/shared/contract-proofs/g5-ledger/run.sh                                     # original-mode issue proofs
G5_MODE=patched bash movenrun/shared/contract-proofs/g5-ledger/run.sh                     # patched regression proofs only
```

Compiler actually used: **solcjs 0.8.26** from `node_modules/solc` (optimizer on, 200 runs, evm
target cancun). The contracts pin `pragma solidity 0.8.24`; the scratch copy relaxes it to
`^0.8.24` so no compiler is downloaded. A deployment build would have to use the pinned 0.8.24
native compiler and re-run everything; that has not been done.

| Run | 355b8f5 (before) | this branch (after) | skipped |
|---|---|---|---|
| Patched, ported suite (`G5_PORTED_SUITE=1 G5_MODE=patched`) | 152 passing | **170 passing**, 0 failing | 0 |
| Original mode (issues reproduce on unmodified source) | 43 passing | 43 passing | 0 |
| Patched, regression proofs only | 17 passing | 17 passing | 0 |

The 105 ported original compatibility tests (`suite-port/01`–`05`) are unchanged and pass.
Two earlier research tests were edited, both named and explained in section 6.

Before-fix evidence: with this branch's tests and the `355b8f5` contracts, 8 tests fail
(A4, FIXED E6, E7, G3, G4, G5, G6 for the missing rolling-window and counter views; FIXED I-03a
because a halted valve still accepted toll credits). At `355b8f5`, E6 asserted the boundary
counterexample (4.38M liquid issued within about three hours against a 3M epoch cap).

## 2. Counter release on deed void (implemented in the patched prototype)

Every claim spends several counters. They protect different things, so a void releases them
differently. "Released" means the counter goes back down.

| Counter | Protects | FAULT void | ADMINISTRATIVE void | Holder relinquish | Reverted claim |
|---|---|---|---|---|---|
| Attestation nonce | replay of one signed attestation | never | never | never | not spent |
| Per-city daily count | rate of attempts per city per UTC day | never | never | never | not spent |
| Per-(city, cluster) count | anti-Sybil quota per risk cluster | never | **once per (city, cluster)**, after a 7-day cooldown | never | not spent |
| Lifetime ceiling (`totalClaims - voidedClaims`) | total live or final claims | **released** | **released** | never | not spent |
| `totalClaims` (claim id, attempts) | monotonic id | never | never | never | not spent |
| Claim fee | burned | never refunded | never refunded | never | not spent |
| Evidence commitment for (city, cluster) | reuse of evidence found faulty | **nullified** | not nullified | no | n/a |
| Holder and city-wide deed counts (on the deed) | concentration | released (deed burned) | released | released | not spent |

What changed in this branch:

- **Lifetime ceiling counts claims that were not voided.** Before, every voided claim kept its
  ceiling slot for good, so a ring whose claims were voided as fraud could permanently use up
  the ceiling, locking out honest claimants (G3). `totalClaims` still never decreases and is
  still the claim id; `voidedClaims` and `effectiveClaims()` are new views.
- **FAULT-void evidence nullifier.** A FAULT void marks `keccak256(cityId, clusterId,
  evidenceHash)` as used, so the same evidence cannot back another claim even where the
  cluster cap allows more than one (G4). An appeal (`reclassifyFaultVoid`, timelock, within 30
  days) lifts it. It is scoped to the (city, cluster) so that a different claimant can still
  claim a freed cell (N1 regression test). The signers choose the evidence id, so this is
  defence in depth against replayed evidence, not protection against colluding signers.
  **Known limitation (open, owner design choice):** the key is shared, not per claim. Where the
  cluster cap allows two live claims with the same evidence under different nonces, and both
  are FAULT-voided, appealing only one deletes the shared key and so also frees the evidence of
  the claim that was not appealed. The appeal also lifts the key when no cluster slot is
  restored. Closing this needs a per-claim nullifier or a use count; no test covers the case yet.

Kept from `355b8f5`: one-time cluster restoration on administrative void, 7-day reclaim
cooldown, appeal window, hook callable only by the deed contract, no administrative reach over
a final deed.

Why not refund on every void, a reversal window that re-mints, or a contest-pending state:
see `DEED_VOID_LIFECYCLE.md` section 2 (options A, C, F). Releasing the lifetime ceiling on void
gives a ring nothing back: its nonce, daily slot, cluster slot and fee stay spent.

### Proofs (`suite-port/08-issue-ledger.port.test.ts`, section G)

| Property | Test |
|---|---|
| Claim retry: a reverted claim spends no nonce or counter; the same attestation succeeds later; a successful one never repeats | G1 |
| A legitimately used daily slot is not returned by a void of either class; the next day opens | G2 |
| Voided fraud does not use up the lifetime ceiling; live + final claims never exceed it; ring clusters stay spent | G3 |
| FAULT void nullifies evidence per (city, cluster); admin void does not; appeal lifts it | G4 |
| Adversarial cycling, deterministic PRNG, 3 seeds x 90 steps of claim / fault void / admin void / relinquish / replay / time jumps over 6 clusters and 4 wallets: after every step live deeds per cluster ≤ cap (1), mints per cluster ≤ cap + its one restoration, `clusterClaimCount` ≤ cap, chain `totalDeeds` = model, `effectiveClaims` ≤ ceiling, daily count ≤ limit; every replay reverts `AttestationAlreadyUsed`. The run is checked to be non-vacuous (restorations happened; `ClusterCapReached`, `ClusterReclaimCoolingDown`, `CityDailyClaimLimitReached` and `TotalClaimCeilingReached` all refused attempts) | G5 |
| An honest claimant voided administratively is not bricked by a ring filling the city's daily slots throughout the cooldown | G6 |
| Earlier: no free retry after FAULT void, cooldown, loop exhaustion, replay, appeal, relinquish | 07 D1–D6 |

Residual (policy, open): a VOIDER acting with a ring can turn one administrative void into one
extra claim slot per (city, cluster) after 7 days (D3). A second operator-error void on the
same (city, cluster) leaves it exhausted; only a FAULT void can be appealed. Both are owner
decisions, not code defects.

## 3. Issue ledger

Severity is a research threat rating for this prototype (Critical / High / Medium / Low), not
an audit finding. "Fixed in prototype" means only that the research copy now enforces the
invariant under the listed tests.

| ID | Issue | Severity | Counterexample test(s) | Scope | Expected invariant | Status |
|---|---|---|---|---|---|---|
| I-01 | Valve epoch boundary: withheld closed days spent just before and just after a calendar-epoch boundary issue up to 2x the epoch cap within hours | High | 355b8f5 E6 (counterexample); now **FIXED E6**, **E7** (07) | `MovenRunSettlement` | Liquid movement rewards published in any 30-day interval ≤ `LIQUID_EPOCH_CAP` | **Fixed in prototype**: rolling window of 31 wall-clock day buckets checked on every liquid publication (`RollingLiquidCapExceeded`) |
| I-02 | Persistent 400M liquid allowance: one timelock action opens the whole allocation and it never lapses | Critical (original) | valve.proof V1 (original mode); **FIXED I-02**; 07 E1, E3; 06 A1, A5 | `MovenRunSettlement` | Standing allowance ≤ one epoch cap; lapses at epoch end; budget monotonic | **Fixed in prototype** (epoch cap and expiry from 355b8f5; I-02 adds the multi-epoch check) |
| I-03a | Liquid toll credits still issued while the valve is halted | High | **FIXED I-03a** | `MovenRunSettlement` | A halted valve issues no new liquid reward of any kind; locked days continue | **Fixed in prototype** (halt refuses `tollCredits > 0`) |
| I-03b | Liquid toll credits issued with a zero allowance (valve shut, not halted); no setting makes tolls locked | High | **OPEN-ISSUE I-03b**; 06 B1–B3; valve V3 | `MovenRunSettlement`, `MovenRunRewards` | An all-locked configuration exists that issues no liquid at all, without stopping locked rewards | **Open**: needs a policy choice (all-locked global fallback, or liquid eligibility on toll leaves). Not a small fix |
| I-04 | Legacy `greatBurn` calls `transferFrom(owner, daoTreasury, …)` and reports the amount as burned | Medium (legacy contract; supply misreported) | **OPEN-ISSUE I-04** (unmodified legacy source with minimal stand-ins in `legacy-harness/`) | legacy `src/SeasonController.sol` | A function and event named burn reduce total supply by exactly the reported amount | **Open**: legacy contract is outside the v3 set; recommended: exclude from any deployment, or use a real burn and rename the event; add a supply-conservation test |
| I-05a | Timelock accepts a 1-second delay | High (original L2) | ledger L2 (original mode); 07 E5; 06 C5 | `MovenRunTimelock` | Delay ≥ a floor, at deploy and on update | **Fixed in prototype** (floor 1 hour, from 355b8f5) |
| I-05b | The floor is 1 hour (to keep the original fixture), not the proposed 48 hours | Medium | **OPEN-ISSUE I-05b** | `MovenRunTimelock` | Production floor ≥ 48 hours | **Open**: needs the fixture's time base moved; separate follow-up |
| I-06a | One admin key rotates both eligibility signers | High | 07 F1, F2; 06 C4 | `MovenRunDeedClaims` | No single role can add an eligibility signer | **Fixed in prototype** (independent, expiring, single-use approval, from 355b8f5) |
| I-06b | The timelock alone replaces both settlement signers (settlement and reconciliation), which together set every day's issuance | High | **OPEN-ISSUE I-06b** | `MovenRunSettlement` | Replacing either settlement key needs an independent approval | **Open**: same pattern as I-06a would apply; not done here to keep one root cause per change |
| I-06c | The timelock alone replaces both contest score keys | High | **OPEN-ISSUE I-06c** | `MovenRunContests` | Replacing either contest key needs an independent approval | **Open** |
| I-06d | If the signer-approver role and the timelock proposer are the same party, that party swaps both eligibility signers and mints | High (deployment) | **OPEN-ISSUE I-06d** | deployment configuration | Approver and proposer held by separate parties; verified at deploy | **Open**: deployment invariant, not enforceable in code alone |
| I-07 | Contest declarations are single-signed: one contest key escrows a defender's final deed and reserves the challenger's city slot | High | **OPEN-ISSUE I-07**; 06 C7 | `MovenRunContests` | Declarations need the same two distinct keys as scores, and the rules version is bound across contracts | **Open**: needs a `declareContest` ABI change (co-signature), which changes the original compatibility helper; not a small fix |
| I-08 | Locked-only rewards pay the claim fee; the deed becomes freely transferable once final (locked-to-transferable path) | High (policy, legal) | **OPEN-ISSUE I-08**; ledger M7; valve V4 | `MovenRunToken`, `MovenRunDeedClaims`, `MovenRunDeed` | Value earned as locked cannot become a transferable asset unless the chosen liquidity model allows it | **Open**: depends on the model in section 4 |
| I-09 | Deed ids are bare H3 resolution-8 cells: the public token id gives the location to within about half a kilometre | Medium (privacy) | **OPEN-ISSUE I-09**; ledger M8/L1 | `MovenRunDeed`, events, marketplace | A public id does not reveal a home-scale location | **Open**: research in section 5 |
| C-01 | Voided fraud permanently uses up the lifetime claim ceiling, locking out honest claimants | Medium (permanent liveness) | **G3** | `MovenRunDeedClaims` | Ceiling counts live or final claims only | **Fixed in prototype** |
| C-02 | Evidence found faulty can back another claim in the same cluster with a new nonce | Low (signer-bounded) | **G4** | `MovenRunDeedClaims` | FAULT-voided evidence is unusable for that (city, cluster) until appeal | **Fixed in prototype** |
| C-03 | Voider plus ring: one extra slot per (city, cluster) via an administrative void | Low (bounded) | 07 D3, G5 | `MovenRunDeedClaims` | Lifetime mints per cluster ≤ cap + 1 | **Open (accepted bound, owner decision)** |

Side effects of the I-01 fix, for the owner: (1) with 31 day buckets, steady nominal days of
100,000 MOVE cannot all be liquid (about 96,800 per day fits under a 3M cap); the cap value is a
hypothesis and can be recalibrated; (2) each liquid publication reads 31 storage slots; (3) the
calendar epoch cap and expiry stay, so both limits apply.

## 4. Locked for everyone vs carefully bounded optional liquidity (research only)

No model below promises any value, price, yield or return. Each needs legal and compliance
review and an independent security review before any product statement is made about it.

| Aspect | A. Locked for everyone | B. Bounded optional liquidity |
|---|---|---|
| What players hold | Locked balance only; usable inside the game; not transferable | Locked by default; a capped, time-limited liquid share where the valve is open |
| Toll credits (I-03b) | Must also be locked: needs the all-locked fallback, which does not exist yet | Liquid tolls count against the same valve, or are locked |
| Deed fees from locked balance (I-08) | Deeds bought with locked balance must stay non-transferable, or fees must not create transferable items | Fees for transferable deeds paid only from liquid balance; locked balance buys non-transferable items only |
| Valve | Permanently zero; halt is the default state | Epoch cap, rolling window (I-01), expiry, halt; still not tied to revenue |
| Main risks | Players may still create off-chain markets for accounts; the leak paths above must be closed first | Every liquid path is a regulatory and abuse surface; ring farming (C-03, D3) turns into transferable value |
| Contract work still needed | All-locked fallback for tolls; non-transferable deed class or liquid-only fees | Revenue or reserve linkage (not designed), per-recipient caps, toll eligibility, audit of every liquid path |
| Reversibility | Can later move to B through governance (after review) | Hard to return to A once liquid assets exist |

Research conclusion: A is the smaller attack and compliance surface, but it is **not reachable
by configuration today** because of I-03b and I-08. B needs every open item in section 3
closed, and more, before it could be considered.

## 5. Deed-ID H3 privacy (research only)

Today the deed's token id is the resolution-8 H3 cell (about 0.7 km² area). Anyone can map a
holder's address to a neighbourhood, and a holder whose ground is near home reveals it. Options
for the owner, none implemented:

- **Coarse public id**: public id is the resolution-5 or -6 parent plus a counter; the exact
  cell stays off chain. Weakens on-chain uniqueness checks, which then rely on the signers.
- **Commitment id**: id = hash(cell, salt) with the salt held by the holder and the service;
  uniqueness is kept, location is hidden until revealed. Contest and city derivation then need
  a proof of the cell inside the city region without revealing it (Merkle proof over salted
  leaves, or a zero-knowledge proof, both larger work).
- **Delayed or opt-in reveal**: deeds near sensitive places (home, school) are refused by the
  attestation policy; this is an off-chain rule and needs its own review.

Whatever is chosen, events (`DeedClaimed`, `Transfer`, marketplace listings) and indexers must be
checked too: changing only the token id is not enough.

## 6. Test changes outside the new file

- `07 E6` was a counterexample (passed while the boundary issue was open). It is rewritten as
  `FIXED E6`, which runs the same attack and asserts the rolling window refuses it. `E7` is new.
- `06 A4` (BOUNDED): the scenario now also bounds each day's liquid by
  `rollingLiquidRemaining()`. This is a test adjustment for the new rule; the assertions are
  unchanged.
- `run.sh`: in ported mode, copies the unmodified legacy `SeasonController.sol`, the files it
  imports and `legacy-harness/GreatBurnProbe.sol` (stand-ins for the token, zone lookup and
  oracle operator) into `src/v3/legacy-probe` of the scratch copy, for I-04 only.
- `patches/MovenRunDeedClaims.patch` and `patches/MovenRunSettlement.patch` rebuilt
  against `c8262ec`.

## 7. Minimum independent audit requirements

Before any deployment, signature, faucet, mint, allowance, market, payout, wallet import or
mainnet step, at minimum:

1. An independent smart-contract audit by a firm with no involvement in this code, covering all
   nine v3 contracts and the G5 patches together, with every Critical and High finding fixed
   and re-reviewed, and the report published.
2. Build reproduced with the pinned compiler (0.8.24 native, not solcjs 0.8.26), with the full
   ported suite, hardening and ledger tests re-run on that build.
3. Property-based or formal checks of the invariants in sections 2 and 3: issuance conservation
   (gross = locked + liquid + tolls + burn), the rolling liquid bound, the counter release
   model (G5 extended to unbounded sequences), no administrative reach over final deeds.
4. A role and key review: every role holder named, approver separate from timelock proposer
   (I-06d), settlement and contest key replacement behind independent approval (I-06b, I-06c),
   48-hour timelock floor (I-05b), loss and compromise procedures for each key.
5. Closure or explicit owner acceptance of every open item above (I-03b, I-04, I-05b, I-06b,
   I-06c, I-06d, I-07, I-08, I-09, C-03), each recorded with a decision owner.
6. Legal and compliance sign-off on the chosen liquidity model (section 4) and on the privacy
   design (section 5) before any product claim.
7. Testnet rehearsal only after items 1 to 6, under a separate written authorization.
