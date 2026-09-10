# MovenRun V3 — Onchain Architecture

Developer documentation for the MovenRun V3 contract suite under
`movenrun/contracts/src/v3/`.

This suite is independent of the earlier MovenRun contracts in `movenrun/contracts/src/`.
It imports nothing from them, and nothing in it depends on their behaviour. Those contracts
remain in the repository as engineering reference only.

---

## 1. Trust boundaries

The suite has four distinct trust boundaries.

**The chain is authoritative for**: token supply and the lifetime issuance cap, the
locked/liquid classification of every balance, which day has been settled and with what
aggregate totals, which account may claim which reward, deed ownership, contest escrow and
contest outcome, and every administrative delay.

**MovenRun signers are authoritative for**: whether a day's movement was verified, what each
account earned, whether ground is solid, whether a claimant has already earned eligibility,
and what a contest participant scored on a given day. These statements enter the chain only
as EIP-712 signed authorizations that are chain-bound, contract-bound, expiring and
single-use.

**The delayed administrator is authoritative for**: adjustable hypotheses only. It cannot
raise the supply cap, change the toll rate, change the automatic-charge ceiling, change any
contest timing or cooldown, seize a deed, move a player balance, or block a claim.

**Nobody is authoritative for**: reversing a published settlement, reclassifying locked
balance as liquid, restoring issuance capacity that burning destroyed, or preventing an
already-escrowed contest from settling.

## 2. Why movement verification stays offchain

Verifying that a person moved through the physical world is not a computation a chain can
perform. It requires raw sensor data, device attestation, anti-spoofing heuristics, a
relationship graph between accounts, and models that change as adversaries change. Putting
any of that onchain would publish the exact data MovenRun must not publish, and would freeze
detection logic that has to stay adaptive.

The chain therefore takes verification as an input, not a computation, and constrains what
that input is allowed to do: it can never mint beyond the cap, never mint beyond the day's
derived pool, never mint beyond the lifetime player allocation, never publish a day twice,
and never act on one signature alone.

## 3. What is committed onchain

Per settlement day, the chain stores aggregate values and one Merkle root:

- rules version, season identifier, day identifier
- Merkle root committing to per-account amounts
- gross movement issuance
- locked claim total
- liquid movement claim total
- toll credit total
- automatic burn total
- the toll base the toll was computed against
- participant count
- publication timestamp

That is the complete record. No latitude, longitude, GPS sample, route point, start point,
end point, ordered crossed-cell array or movement path is accepted as a parameter, written
to storage, or emitted in an event by `MovenRunSettlement` or `MovenRunRewards`.

Per-account amounts are not published at all. They exist in an offchain Merkle tree whose
root is the only commitment onchain, and an account reveals only its own leaf when it claims.

A deed's single H3 resolution-8 cell identifier is public, because the deed is that public
asset. That is the only geographic value anywhere in the suite.

Explicitly not onchain anywhere: experience points, player levels, streaks, badges,
materials, common-ground strength, shade strength, daily movement scoring internals, the
risk graph, and the related-account graph.

## 4. Token: the locked and liquid model

`MovenRunToken` is a single ERC-20 named `MovenRun MOVE`, symbol `MOVE`, 18 decimals, with
ERC-2612 permit. There is one token and two balance states.

`MAX_LIFETIME_MINTED` is `1,000,000,000 MOVE`. The mint guard uses `cumulativeMinted`, a
counter that only ever increases, rather than `totalSupply`. Burning reduces `totalSupply`
and never reduces `cumulativeMinted`, so destroyed MOVE does not reopen issuance capacity.
No function, role, timelock proposal or proxy path can raise the cap; there is no proxy.

Locked balance is part of the same ERC-20 balance. `liquidBalanceOf(account)` is
`balanceOf(account) - lockedBalanceOf(account)`. The `_update` hook rejects any ordinary
transfer that would move more than the liquid portion, so the rule is enforced by the token
and not by any backend.

Locked balance leaves an account in exactly one way: it is burned. There is no unlock
function, no administrative reclassification and no path by which becoming deed-qualified
later makes previously locked MOVE liquid.

Burns consume locked balance before liquid balance. This is an implementation policy, not an
economic promise: it preserves transferable liquidity and can never increase the
transferable portion of a balance. `burn` acts on the caller's own balance.  `burnFrom` is
restricted to registered MovenRun fee sinks and still spends an allowance the holder granted,
so no counterparty can destroy a balance unilaterally.

The token has no administrative seizure, no blacklist, no fee on transfer and no hidden
transfer tax.

Settlement and rewards wiring is performed once by the deployer through `configureCore` and
sealed permanently by `finalizeBootstrap`, which sets `bootstrapFrozen` and clears the
bootstrapper. After that there is no path that replaces either address.

Note on scope: `MAX_LIFETIME_MINTED` is the lifetime ceiling for the token as a whole, while
the only issuance path implemented in V3 is the movement settlement path, itself bounded by
the 400,000,000 MOVE player allocation. The remaining capacity is simply unissued in V3.

## 5. Daily settlement flow

`MovenRunSettlement` is the sole issuance path.

**Season schedule.** Seasons are 90 settlement days. Season 1 has a 9,000,000 MOVE budget.
Each later season's schedule value is 90% of the previous one, floored at 2,000,000 MOVE.
Every season's usable budget is then clamped by the remaining lifetime player allocation, so
the schedule is derived from what is left and cannot drift past 400,000,000 MOVE. Seasons
open strictly in sequence, so the decay chain cannot be skipped.

**Daily pool.** For a day at index `i` inside its season, the pool is
`(seasonBudget - seasonIssued) / (90 - i + 1)`. Season 1 day 1 is therefore exactly
100,000 MOVE. Budget a day does not use stays in the season and is redistributed across the
days that season has left. Nothing crosses a season boundary; a new season's budget is
derived independently at the moment it opens.

**Dual authorization.** Publication requires two EIP-712 signatures over the identical
settlement hash: one from the settlement signer and one from the independent reconciliation
signer. The two addresses can never be the same, at construction or after any rotation. The
authorization carries a nonce and an expiry, and the EIP-712 domain binds it to this chain
and this contract, so it cannot be replayed. Anyone may relay a fully authorized settlement;
the relayer influences nothing.

**Accounting identity.** Enforced on every publication:

```
grossIssuance == lockedClaims + liquidMovementClaims + tollCredits + automaticBurn
```

**Ceilings.** `tollCredits` may not exceed 2% of the committed toll base; the rate is the
constant `TOLL_RATE_BPS = 200` and is not governable. `automaticBurn` may not exceed 60% of
the day's gross reward. `grossIssuance` may not exceed the day's derived pool, the season
budget, or the remaining lifetime player allocation.

**Liquid issuance allowance.** Newly created liquid movement rewards are bounded by an
explicit onchain allowance that starts at zero and can only be raised through the timelock.
Until MovenRun deliberately opens capacity, a settlement carrying liquid movement claims
reverts. The guardian may lower the allowance as a safety action but can never raise it.

**Finalization.** The gross amount consumes player allocation, the token mints the gross into
the rewards reserve and immediately burns the automatic charge from it — a real burn of
issued supply, not a transfer to a treasury — and the remainder funds `MovenRunRewards` for
that day. A day identifier must strictly advance and a published day is never overwritten.

**Rules version.** An authorization must declare the rules version currently accepted. A
published record keeps the version it settled under, so a later rules change cannot
retroactively reinterpret a finalized day.

## 6. Reward claims

`MovenRunRewards` holds each day's funded reserve and releases it against Merkle proofs.

A leaf is a domain-separated hash over the chain id, the rewards contract address, the day
identifier, a leaf index, the account, the locked amount and the liquid amount, hashed twice
so an internal node can never be presented as a leaf. A claimed bitmap keyed by day and leaf
index prevents double claiming. Per-day claim totals can never exceed the finalized locked
and liquid allocations for that day.

Claims are pull-based, so one account's inaction cannot strand another account's reward.
Anyone may relay a claim, and the reward always goes to the account committed in the leaf.

The contract has no administrator, no pause, no withdrawal path and no expiry. Once a day is
finalized, that allocation belongs to the accounts in its root, and pausing new settlement
publication does not affect it.

## 7. Toll accounting

Toll applies to deeded solid ground. Shade never receives a toll. The rate is exactly 2.00%
of the session reward weighted by deed coverage, the total for a session is never above 2%
regardless of how many owners were crossed, repeated laps over the same deed count once, and
a runner cannot pay themselves or a related account. Those rules are enforced offchain where
the coverage data lives; the chain enforces the aggregate ceiling and the zero-sum property.

Toll is zero-sum inside the gross issuance rather than an additional mint: the accounting
identity above places `tollCredits` inside `grossIssuance`, so every owner credit is matched
by a runner-side debit inside the same settlement. No extra MOVE is created for it, which is
why toll credits do not consume the liquid issuance allowance.

The chain publishes the aggregate toll credit total and the toll base separately, so the
zero-sum property remains auditable, and publishes no route or ordered crossing sequence.

Implementation decision worth reviewing before mainnet: the reward leaf carries one locked
amount and one liquid amount, and the contract funds the day's liquid allocation as
`liquidMovementClaims + tollCredits`. Toll credits are therefore liquid-classified. The
separately committed aggregates mean this choice is visible onchain and auditable; moving
toll credits into the locked bucket instead would be an economic decision, not a structural
one.

## 8. Deed eligibility

A deed is permanent ownership of one eligible solid H3 resolution-8 cell. The ERC-721 token
id is the canonical H3 cell identifier itself, so one cell can carry at most one deed. There
is no public mint, no burn path and no reward accrual inside the token.

A deed cannot be bought from MovenRun. `MovenRunDeedClaims` is the only contract permitted to
create one, and it requires a signed eligibility attestation covering the claimant, the cell,
the city, whether the ground is solid, tenure, distinct verified crossers, distinct traffic
days, the related-account exclusion result, an exact fee quote, the rules version, a nonce
and an expiry. The attestation is chain-bound and contract-bound through its EIP-712 domain,
single-use through its nonce, and rejected once expired or presented by the wrong claimant.
Ground that is not solid is rejected, so shade can never become a deed.

The three numeric thresholds are hypotheses, not economic law. They start at 21 days tenure,
30 distinct crossers and 10 traffic days, are readable onchain, and can be adjusted only
through the timelock, which emits the change.

Every city must have an explicitly configured concentration cap before any deed can be
claimed in it. There is no default: an unconfigured city rejects claims.

The claim fee comes from the signed quote. The caller supplies `maxFee` and a quote above it
reverts, so a transaction can never charge more than the caller accepted. The fee is burned
through the token, locked balance first.

The structural H3 check in `MovenRunH3` is a fail-closed pre-filter. It proves a value is
shaped like a canonical resolution-8 cell index — reserved bit, cell mode, unused mode bits,
resolution, base cell range, per-digit ranges, and the deleted K-axis subsequence under a
pentagon base cell. It cannot prove the cell is solid or earned; those come only from the
attestation. A value it rejects can never become a deed, and a value it accepts still has to
clear every attestation check.

Its logic was checked against `h3-js` reference vectors: the resolution-8 cells covering
Bengaluru, New York, Berlin and both sides of the antimeridian; the canonical cell under
every one of the twelve pentagon base cells; the deleted K-axis subsequence under each of
those pentagons; wrong-resolution, malformed and out-of-range indexes; and a sweep of four
thousand real resolution-8 cells worldwide. It agreed with `h3-js` on every case. That check
compared the algorithm, not the compiled contract, so it should be repeated as a Solidity
test against the same vectors before the suite carries value.

## 9. Contest escrow

`MovenRunContests` holds one contest per deed at a time. An active contest can never be
overwritten: a declaration against a deed that already carries one reverts.

Declaration requires a signed, single-use, expiring authorization naming the challenger, the
deed and the defender's fortification contribution, which is bounded at 1,500 basis points.
The entry fee is burned. The deed moves into escrow immediately, using a privileged transfer
path on the deed contract that does not consult ERC-721 approval, so a defender cannot block
a valid contest by withholding it. The contest records the original defender.

Notice is exactly 72 hours. The scoring window is exactly 7 days. The best 3 daily scores
count for each side. Each daily score arrives as an authorization bound to that exact
contest, participant and scoring day, expiring and single-use, so a score can never be
replayed onto another contest, day or participant. Scores are deterministic integers; no
route detail crosses the boundary. There are no paid score boosts and no paid extensions.

At settlement the defender's total is scaled by the current-holder home advantage, which is
configurable only within 500 to 1,000 basis points, plus the fortification contribution
snapshotted at declaration. The challenger wins only on a strictly higher total; a tie leaves
the deed with the current holder.

Settlement is callable by anybody once the window closes. The loser cannot refuse, delay or
veto it, and no approval from the losing side is involved in moving the deed out of escrow.
A losing challenger serves a 30-day cooldown; a surviving deed enjoys a 14-day peace period.
After those elapse the deed can be contested again — a contest is never "challenge once
forever".

## 10. Marketplace

`MovenRunMarketplace` is secondary-only: it moves deeds that already exist between holders
and never sells an initial deed. Fixed-price listings in MOVE are sufficient for this
version.

A seller must hold the deed to list it and can cancel at any time. A purchase pays the seller
directly in the same call, so the contract never holds a deed and never holds proceeds. There
is no protocol fee. Because payment is an ordinary MOVE transfer, the token's own rules apply
and locked MOVE can never buy a deed.

A listing whose deed has since moved fails closed, which covers both an ordinary transfer by
the seller and a deed that has entered contest escrow: escrow makes the contests contract the
holder, so the former owner's listing is no longer live. Purchases are reentrancy-guarded and
apply their state changes before any external call. There is no administrator, no seizure
path and no pause, so voluntary transfers remain available while claims or settlements are
paused.

## 11. Roles and the timelock

Deployment configures distinct addresses for the delayed administrator, the guardian, the
settlement signer, the independent reconciliation signer, the deed eligibility signer, and
the contest score signer. The deploy script refuses a configuration where the settlement
signer equals the reconciliation signer, refuses to make the deployer the administrator, and
by default refuses any other reuse among those addresses.

`MovenRunTimelock` extends the audited `TimelockController` with a nonzero delay requirement.
It is deployed with the multisignature administrator as its only proposer and executor and
with the optional admin slot set to the zero address, so it administers itself.

`DEFAULT_ADMIN_ROLE` on every contract is granted to the timelock in the constructor and
never to the deployer. The deployer holds only a narrow bootstrapper capability that exists
to perform the one-time wiring and clears itself when that wiring is finalized. Every role
change emits an event.

The timelock governs adjustable parameters only: eligibility thresholds, city concentration
caps, the home advantage within its fixed bounds, signer rotation, the rules version, the
liquid issuance allowance, and unpausing. It cannot reach the fixed constants, which are
compile-time constants in their own contracts: the 1,000,000,000 MOVE lifetime cap, the
400,000,000 MOVE player allocation, the 2% toll rate, the 60% automatic-charge ceiling, the
72-hour notice, the 7-day scoring window, and the 30-day and 14-day cooldowns.

## 12. Pause guarantees

The guardian may pause exactly three things: new settlement publication, new deed claims, and
new contest declarations. Unpausing requires the timelock.

The guardian cannot mint, transfer player funds, seize a deed, block a withdrawal, block a
reward claim, or block settlement of an active contest.

Pausing can never trap an already-earned balance or an already-escrowed deed:

- ERC-20 liquid transfers have no pause path anywhere in the token.
- `MovenRunRewards` has no pause and no administrator at all, so claims for already-finalized
  days always remain available.
- Voluntary deed transfers are unaffected while a deed is not in contest escrow; the
  marketplace has no pause.
- `settleContest` has no pause, so an escrowed deed always reaches a settleable state.

## 13. Deployment and verification

Deployment is Base Sepolia only. `scripts/v3/deployBaseSepolia.ts` hard-checks chain id
84532 and refuses every other chain. It validates the role addresses and their separation,
deploys in dependency order, performs the one-time wiring, finalizes and freezes the token
configuration, publishes the registry record, asserts that the deployer retains no privileged
role, and only then writes the manifest and the per-contract verification commands. It never
reads or logs a private key.

Deployment order:

1. `MovenRunTimelock`
2. `MovenRunToken`
3. `MovenRunRewards`
4. `MovenRunSettlement`
5. `MovenRunDeed`
6. `MovenRunDeedClaims`
7. `MovenRunContests`
8. `MovenRunMarketplace`
9. `MovenRunRegistry`

`scripts/v3/checkDeployment.ts` then reads chain state and fails if any invariant is wrong.
It performs no writes.

`MovenRunRegistry` records the suite version, chain id and every contract address as an
append-only history. A new version never rewrites a historical one, and the record can be
frozen permanently. It holds no business logic and takes no custody.

Manual source verification is documented separately in `V3_MANUAL_VERIFICATION.md`.
