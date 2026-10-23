# Deed void lifecycle, valve hardening and signer roles

**Status: RESEARCH / PROPOSED. Unaudited. Nothing here is deployed, signed or broadcast.**
These are draft changes to the research copies in
`movenrun/shared/contract-proofs/g5-ledger/patched/`. The pinned prototype source
(`c8262ec`, `movenrun/contracts/src/v3`) and `feat/v3-onchain-core` are not modified. Every
test runs on Hardhat's in-process network only. A passing test is not an audit, and it does
not make this a safe financial system.

Run: `G5_PORTED_SUITE=1 G5_MODE=patched bash movenrun/shared/contract-proofs/g5-ledger/run.sh`

## 1. Problem

In the G5 draft (#122/#133), when a pending deed is voided:

- `MovenRunDeed` burns the deed. City, holder and total counters stay exact.
- `MovenRunDeedClaims` keeps the per-(city, cluster) count, the per-city daily count, the
  lifetime count and the attestation nonce spent.

With `maxDeedsPerCluster = 1`, a claimant whose deed was voided through operator error (a
wrong region map, a signer bug or a misapplied rule) is locked out of that city for good,
and nothing in the policy says this should happen. Simply refunding every counter on void
causes the opposite problem: claim, void, claim again at once, repeated, gets round the
scarcity controls (daily limit, cluster cap and lifetime ceiling).

## 2. Options compared

| Option | Honest user after operator-error void | Reclaim loop | Replay | Admin power added | Complexity |
|---|---|---|---|---|---|
| A. Refund all counters on every void | restored at once | **open**: claim/void/claim repeats without limit inside the daily limit | nonce still prevents same attestation | none | low |
| B. No refund, ever (draft #122) | **bricked** for that city (cluster cap 1) | closed | closed | none | none |
| C. Bounded reversal window (void can be undone and the deed re-minted to the old holder within N days) | deed restored | closed if undo is admin-only | needs a re-mint path that bypasses claim checks | **adds a mint path outside claims** | high |
| D. One-time refund only for an irrevocable administrative void, plus reclaim cooldown | restored once, after cooldown | closed: one restoration per (city, cluster), daily and lifetime stay spent | nonce stays spent | voider chooses the class inside the 7-day window only | moderate |
| E. Consumed nullifier over `evidenceHash` (a void burns the evidence; a reclaim needs new evidence) | depends on whether fresh evidence can be issued | closed for identical evidence only | stronger than nonce | none | low, but the signers mint the evidence id, so it is only as strong as they are |
| F. Contest-pending state (void first moves the deed to a frozen "contested" state, decided later) | fair hearing | closed | closed | **extends admin reach past the 7-day window** (seizure risk) | high |

**Chosen for the patched prototype: D, plus a bounded appeal that changes only the
classification (a narrow form of C that never re-mints).** E and F are documented and
left out. E would also break the existing compatibility tests that reclaim a freed cell
with the same evidence id. F would weaken the N1 rule that a final deed is beyond any
administrative revoke.

## 3. State machine (implemented)

States of one claim record (`MovenRunDeedClaims.claimRecord[claimId]`, with
`claimId = totalClaims`, which never decreases):

```
                      claimWithThreshold (2-of-n, nonce consumed, fee burned,
                      cluster/daily/lifetime counters +1)
   (none) ───────────────────────────────────────────────▶ LIVE  (deed PENDING for 7 days)
                                                            │
     ┌──────────────────────────────────────────────────────┼───────────────────────────────┐
     │ voidPendingDeed (VOIDER, inside window)               │ voidPendingDeedAdministrative │ window elapses
     ▼                                                       ▼ (VOIDER, inside window)       ▼
  VOIDED_FAULT ── reclassifyFaultVoid ──▶ (same as admin)  ADMIN void:                       FINAL deed
  counters stay spent   (timelock, once,                   first for (city,cluster)?          only holder
     │                   ≤ 30 days)                          yes → VOIDED_ADMIN_RESTORED      relinquish();
     │ 30 days pass                                               cluster count −1,           no refund,
     ▼                                                            reclaim allowed after       no admin revoke
  VOIDED_FAULT (final)                                            +7 days cooldown
                                                             no  → VOIDED_ADMIN_NOT_RESTORED
                                                                  (counters stay spent)
```

Not restored by any path: the per-city daily count, the lifetime claim ceiling, the
attestation nonce and the burned claim fee. A pending deed relinquished by its holder
restores nothing. Deeds are never reinstated: an appeal restores claim capacity only.

Mechanics: `MovenRunDeed._voidPending` burns, emits `DeedVoided` (unchanged) and
`DeedVoidClassified`, then calls `IMovenRunDeedVoidHook(claimsContract).onDeedVoided`.
`onDeedVoided` accepts calls from the deed contract only. The hook is skipped when the
wired claims address has no code, which can only happen in a fixture.

## 4. Invariants and the tests that prove them (`suite-port/07-hardening.port.test.ts`)

| Invariant | Test |
|---|---|
| A FAULT void restores nothing; the same cluster cannot reclaim, even 60 days later | D1 |
| An honest cluster voided administratively is not bricked; it reclaims only after the 7-day cooldown; daily and lifetime counters stay spent | D2 |
| No reclaim loop: claim, admin void, reclaim, admin void leaves the cluster exhausted; live deeds never exceed the cluster cap; lifetime issuance per cluster ≤ cap + 1 | D3 |
| Replay: the voided attestation cannot be resubmitted; only the deed can call the hook; a final deed cannot be voided in either class | D4 |
| Appeal: timelock only, once, within 30 days, capacity only | D5 |
| Relinquish restores nothing; a reclaimed cell's record is independent of the old one | D6 |

**Residual risk:** a VOIDER and a ring acting together can turn one administrative void into
one extra claim slot per (city, cluster), after a 7-day wait and only with fresh 2-of-n
signatures. This is bounded by D3, but it is still a policy choice for the owner.

## 5. Time-locked valve (`MovenRunSettlement`, all values hypothetical)

| Control | Implementation | Test |
|---|---|---|
| Epoch cap | `raiseLiquidIssuanceAllowance` reverts `EpochReleaseCapExceeded` above `LIQUID_EPOCH_CAP` = 3,000,000 MOVE per `VALVE_EPOCH` = 30 days (counted from genesis) | E1, 06 A1/A4 |
| Monotonic budget | `epochLiquidRaised[epoch]` and `lifetimeLiquidAuthorized` only grow; guardian reduction, halt and lapse never return headroom; lifetime ≤ 400M | E2 |
| Approval expiry | allowance raised in epoch *e* reads as 0 from epoch *e+1* and cannot be drawn | E3, 06 A5 |
| Emergency halt | `haltValve` (guardian or timelock) zeroes the allowance and refuses raises, including one already queued in the timelock, and liquid publication; locked rewards continue; only the timelock can call `resumeValve`, and the allowance restarts at zero | E4 |
| Minimum timelock delay | `MovenRunTimelock.MIN_DELAY_FLOOR` = 1 hour, enforced in the constructor and in `updateDelay`, so a 1-second delay is refused | E5, 06 C5 |

The floor is 1 hour only so that the unmodified original fixture (`TIMELOCK_DELAY = 3600`)
still runs. **The proposed production floor is 48 hours.** Raising the floor means shifting
the fixture's time base, which is a separate follow-up. The valve is still not tied to
revenue.

## 6. Signer roles (`MovenRunDeedClaims`)

Adding an eligibility signer, through `setEligibilitySignerRegistered(x, true)` or a rotation
with `setEligibilitySigner(x)`, now needs a prior approval from `SIGNER_APPROVER_ROLE`. The
approval is single-use and expires after 7 days. That role is its own admin
(`_setRoleAdmin(R, R)`), so the timelock cannot grant it to itself. To keep the constructor
unchanged it starts with the guardian; a real deployment would hand it to a separate
security council. Removing a signer needs no approval. A removal can only make claims fail,
never let them through. Tests: F1 and F2, plus 06 C4 (rewritten from FINDING to FIXED).

## 7. Open items (documented, not fixed here)

- **Liquid toll escape** (06 B1–B3, valve V3/M4): tolls are issued liquid even with the valve
  shut, and no setting turns this off. The options are an all-locked global fallback or
  enforcing liquid eligibility on toll leaves. Owner decision.
- **Locked earned balance buys transferable deeds** (V4/M7): locked-to-liquid leak through deed fees.
- **`greatBurn` to treasury** (confirmed at `c8262ec`: legacy `src/SeasonController.sol`
  `greatBurn` calls `moveToken.transferFrom(owner, daoTreasury, burnAmount)` and reports the
  amount as `totalBurned`). Supply is not destroyed, so the name and the event overstate what
  happens. This is in the legacy contract, not v3. A conservation test and a rename or real
  burn are still to do.
- Contest declarations are still single-signed (H2b). The rules version is not bound
  across contracts.
- Deed ids are bare H3 cells (location privacy). No change here.

## 8. Fixture adjustments vs economic-semantic changes

**Fixture adjustments** (test scaffolding only; contract economics untouched by them):
- `portHelpers.deploySuite` and `regression.proof.ts` `patchedSuite`: the guardian approves
  the co-signer before the timelock registers it.
- 06 C3: approval before registering a third signer.
- 06 A2/A3/A6: raise `LIQUID_EPOCH_CAP` instead of 400M (A2 raises inside day 60's epoch).

**Economic and authority semantic changes** (new contract behaviour):
- Void classes; one-time cluster restoration with cooldown; appeal reclassification.
- Valve epoch cap, monotonic budget, epoch-bound expiry, halt and resume.
- Timelock delay floor.
- Signer-addition approval role.
- 06 A1, A4, A5, C4 and C5 used to assert the gaps (FINDING). They now assert the fixes
  (FIXED or BOUNDED).

None of the 105 ported original compatibility tests (files 01–05) was edited in this change.
