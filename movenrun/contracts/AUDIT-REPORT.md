# MovenRun Smart Contract Security Audit

**Scope:** `movenrun/contracts/src/*.sol` (8 contracts, ~1,030 LOC)
**Date:** 2026-07-09
**Target chain:** Base / Base Sepolia
**Methodology:** ethskills `audit` package (evm-audit-skills checklists) + Pashov `solidity-auditor` skill. Domains applied: general, precision-math, erc20, erc721, signatures, governance, access-control, dos, oracles, staking.

Contracts reviewed: `MoveToken.sol`, `MoveVault.sol`, `GPSOracle.sol`, `ZoneNFT.sol`, `ZoneChallenge.sol`, `SeasonController.sol`, `MovenDAO.sol`, `GearNFT.sol`.

> Severity definitions (from evm-audit-master): **Critical** = direct loss of funds, no preconditions · **High** = loss of funds under conditions, or permanent DoS · **Medium** = degraded behavior, trust-model violation, incorrect accounting, or owner-only fund loss · **Low** = best-practice / latent bug · **Info** = no security impact.

## Summary

| # | Severity | Contract | Issue |
|---|----------|----------|-------|
| H-1 | High | ZoneChallenge | Zone becomes permanently unchallengeable after the first challenge resolves |
| H-2 | High | MovenDAO | Voting weight uses live balances → double-vote by transferring tokens between wallets |
| H-3 | High | ZoneChallenge | Winning challenge reverts unless defender pre-approved the contract; challenger's stake is lost |
| M-1 | Medium | ZoneNFT | Reclaimed zone keeps `accumulatedYield`; re-minter steals prior owner's yield / funds otherwise locked |
| M-2 | Medium | MovenDAO | Quorum measured against `totalStaked` but votes counted from balances → quorum mismatch |
| M-3 | Medium | ZoneChallenge | Stronghold boost (24h) almost always expires before resolution (14+ days) → burned funds have no effect |
| M-4 | Medium | ZoneChallenge | `submitScore` signature not bound to a challenge round → replayable across future challenges of the same hex |
| L-1 | Low | GPSOracle | Route signatures have no expiry/deadline |
| L-2 | Low | MoveVault | Unpaid reward accrual window silently reset on `stake()` |
| L-3 | Low | * | Single-EOA admin, no 2-step ownership transfer across all contracts |
| I-1 | Info | GearNFT/MoveToken | GearNFT multiplier never wired into minting; `gearMultiplier` set separately |
| I-2 | Info | ZoneNFT | `LOYALTY_TIER1` constant unused; 30-day tier never applied |
| I-3 | Info | SeasonController | `greatBurn` transfers to treasury, does not burn (misnamed) |

---

## H-1 — Zone is permanently unchallengeable after the first resolved challenge
**Severity:** High
**Category:** dos / state-machine
**Location:** `ZoneChallenge.declareChallenge()` L74-77, `resolveChallenge()` L164

**Description:** `declareChallenge` guards re-entry with:

```solidity
require(
    !challenges[hexId].resolved || challenges[hexId].challenger == address(0),
    "ZoneChallenge: challenge already active"
);
```

`resolveChallenge` sets `c.resolved = true` and never clears the `Challenge` struct. After any challenge on a hex resolves, `challenges[hexId].resolved == true` **and** `challenger != address(0)`, so both sides of the `||` are false and every future `declareChallenge` for that hex reverts.

**Proof of Concept:**
1. Alice owns hex `H`. Bob declares, the challenge runs and `resolveChallenge(H)` sets `resolved = true`.
2. Carol later tries `declareChallenge(H)` → `!true || (bob != 0)` = `false || false` = revert.
3. The zone can never be challenged again, breaking the core "Defend → Own" loop permanently. If a challenger *won*, the captured zone can never be recaptured either.

**Recommendation:** Reset the challenge slot on resolution so a fresh challenge can start:

```solidity
function resolveChallenge(uint64 hexId) external nonReentrant {
    Challenge storage c = challenges[hexId];
    require(!c.resolved, "already resolved");
    require(block.timestamp >= c.challengeEnd, "window not closed");
    // ... compute winner, transfer ...
    delete challenges[hexId]; // clears resolved/challenger so the hex is challengeable again
}
```
(Emit results before `delete`, and set cooldowns in a separate mapping as it already is.)

---

## H-2 — Governance double-voting via wallet-to-wallet token transfer
**Severity:** High
**Category:** governance
**Location:** `MovenDAO.vote()` L87-99, `_votingWeight()` L134-140

**Description:** Voting weight is read live from `balanceOf(voter) + staked` at vote time. There is no snapshot, checkpoint, or token lock during the 7-day voting window. `hasVoted` is tracked per address, not per token. A holder can vote, transfer the balance portion to a fresh address, and vote again — multiplying effective voting power by the number of wallets they cycle through.

**Proof of Concept:**
1. Attacker holds `X` liquid $MOVE in wallet A. `vote(id, true)` credits `X`.
2. Transfer `X` to wallet B. `hasVoted[id][B]` is false. `vote(id, true)` credits another `X`.
3. Repeat across N wallets → `forVotes` inflated to `N·X` from a single stack of `X` tokens. Combined with the low proposal bar (100 $MOVE) and arbitrary `p.target.call(p.callData)` in `execute`, this is a governance takeover primitive.

**Recommendation:** Use a snapshot of voting power at proposal creation (OpenZeppelin `ERC20Votes` / `Governor` with `getPastVotes`), or escrow/lock voting tokens for the voting period. Do not derive weight from transferable live balances.

---

## H-3 — Winning challenge is unresolvable unless the defender pre-approved the contract
**Severity:** High
**Category:** access-control / dos
**Location:** `ZoneChallenge.resolveChallenge()` L179

**Description:** On a challenger win, resolution calls `zoneNFT.safeTransferFrom(defender, challenger, hexId)`. `ZoneChallenge` is neither the token owner nor auto-approved — `ZoneNFT.setChallengeContract` only stores the address, it grants no operator approval. The tests confirm the transfer only works because the defender manually runs `setApprovalForAll(challengeAddr, true)` (see `ZoneChallenge.test.ts:82`, `integration.test.ts:220`). In production a defender has every incentive **not** to approve.

**Proof of Concept:**
1. Bob burns `DECLARATION_COST` (100 $MOVE) in `declareChallenge` and beats Alice's score.
2. Alice never approved `ZoneChallenge` for her ZONE NFT.
3. `resolveChallenge` hits `safeTransferFrom` → ERC721 `ERC721InsufficientApproval` revert. The call reverts every time, `resolved` is never set, the zone never transfers, and Bob's 100 $MOVE is gone with no recourse. A rational defender makes every challenge unwinnable.

**Recommendation:** Do not rely on the losing party's approval. Give `ZoneNFT` a privileged transfer path the challenge contract can call (e.g. an `adminTransfer(hexId, to)` restricted to `challengeContract`), or have `ZoneNFT` custody staked zones during an active challenge. Alternatively, escrow the deed in the challenge contract when a challenge is declared.

---

## M-1 — Reclaimed zone retains `accumulatedYield`; re-minter drains it and stuck funds otherwise lost
**Severity:** Medium
**Category:** erc721 / accounting
**Location:** `ZoneNFT.reclaimDormant()` L106-113, `withdrawYield()` L115-122

**Description:** `reclaimDormant` burns the NFT and deletes `ownershipStart` and `isDormant`, but leaves `accumulatedYield[hexId]` and `lastActivity[hexId]` intact. The yield tokens were already minted to the `ZoneNFT` contract (via `MoveToken.mintMOVE` → `_mint(zoneNFT, zoneTax)`), so they physically remain in the contract.

**Proof of Concept:**
- *Funds lost:* Original owner's unclaimed yield is orphaned after reclaim (no owner can call `withdrawYield`).
- *Theft on re-mint:* Because `isDormant` is cleared, the hex can be minted again. The new minter pays only `mintCost`, then calls `withdrawYield(hexId)` and receives the **previous** owner's `accumulatedYield` — tokens they never earned.

**Recommendation:** Zero the yield accounting on reclaim, forwarding any residual to the treasury or original owner:

```solidity
function reclaimDormant(uint64 hexId) external {
    require(isDormant[hexId], "not dormant");
    require(block.timestamp - lastActivity[hexId] > RECLAIM_PERIOD, "not elapsed");
    _burn(uint256(hexId));
    delete ownershipStart[hexId];
    delete isDormant[hexId];
    delete lastActivity[hexId];
    delete accumulatedYield[hexId]; // + sweep residual tokens to treasury
    emit ZoneReclaimed(hexId);
}
```

---

## M-2 — Quorum denominator (`totalStaked`) mismatches the vote numerator (balances)
**Severity:** Medium
**Category:** governance
**Location:** `MovenDAO.execute()` L107-108, `_votingWeight()` L134-140

**Description:** `_votingWeight` counts `staked + balance` (mostly liquid balances), but `execute` computes quorum as `totalStaked * QUORUM_BPS / 10_000` — only 10% of *staked* supply. Votes come from a much larger base (all circulating balances) than the quorum is scaled against, so quorum is trivially satisfied and provides no meaningful participation threshold. If staking participation is low, a tiny amount of `forVotes` clears quorum.

**Recommendation:** Scale quorum against the same base used for weight (e.g. a snapshot of `totalSupply`, or restrict voting weight to staked balances only so numerator and denominator agree).

---

## M-3 — Stronghold boost expires long before resolution, wasting burned $MOVE
**Severity:** Medium
**Category:** economic / logic
**Location:** `ZoneChallenge.activateStrongholdBoost()` L131-143, `resolveChallenge()` L169

**Description:** `activateStrongholdBoost` charges `STRONGHOLD_COST` (300 $MOVE) and sets `strongholdBoostExpiry = block.timestamp + 24 hours`. But the boost is only applied if `block.timestamp < c.strongholdBoostExpiry` **at resolution**, and resolution can only run after `challengeEnd` (≥ 14 days from declaration, extendable by 3 more). Unless the defender activates within the final 24h and the window is not extended, the boost is expired at resolve time and the defender's 300–900 $MOVE burn buys nothing.

**Recommendation:** Make the boost a persistent property of the challenge (e.g. accumulate a boost percentage that applies at resolution regardless of a wall-clock expiry), or validate/anchor the expiry to `challengeEnd` so buyers know it will count. If a short-lived boost is intended, document and enforce that it must be re-activated near the deadline.

---

## M-4 — `submitScore` signatures are not bound to a specific challenge round
**Severity:** Medium
**Category:** signatures / replay
**Location:** `ZoneChallenge.submitScore()` L116

**Description:** The signed payload is `keccak256(chainId, hexId, msg.sender, score)`. It carries no challenge id, `challengeStart`, or nonce. `usedScoreSigs` only prevents reusing the *exact same* signature. Once H-1 is fixed and a hex can host multiple challenges over time, a participant can replay a previously oracle-signed high score into a later challenge on the same hex without the oracle re-issuing it. (Today H-1 masks this by allowing only one challenge per hex.)

**Recommendation:** Include a per-challenge discriminator in the signed message — e.g. `c.challengeStart` or a monotonically increasing `challengeNonce[hexId]` — so a signature is valid only for the round it was issued for.

---

## L-1 — Route signatures lack an expiry
**Severity:** Low
**Location:** `GPSOracle.submitRoute()` L50

`keccak256(chainId, to, routeHash, distanceMeters, hexId)` has no deadline. `usedRoutes` prevents replay of a given route, so impact is limited, but a signed route can be held and submitted arbitrarily far in the future. Add a `deadline` field to the signed payload and `require(block.timestamp <= deadline)`.

## L-2 — Unpaid reward accrual reset on `stake()`
**Severity:** Low
**Location:** `MoveVault.stake()` L52-53, `_claimReward()` L71-82

`_claimReward` intentionally leaves `lastRewardClaim` unadvanced when the treasury can't pay, preserving the accrual window. But `stake()` then unconditionally sets `stakes.lastRewardClaim = block.timestamp`, discarding that pending accrual. A staker who stakes more while the treasury is dry silently forfeits previously accrued rewards. Compute and carry the pending reward, or only reset the timestamp when nothing is owed.

## L-3 — Single-EOA admin, no two-step ownership
**Severity:** Low
Every contract grants `DEFAULT_ADMIN_ROLE` (and companion admin roles) to `msg.sender` at deployment with no `Ownable2Step`-style handover. Key powers (roles, reward rate, oracle operator, arbitrary DAO `call`) concentrate in one key. Use a multisig/timelock for admin roles and a two-step transfer to avoid fat-finger loss of control.

## I-1 — Gear multiplier is not wired into minting
`GearNFT.getUserMultiplier` is never read by `MoveToken.mintMOVE`; minting uses `gearMultiplier[to]`, a mapping set manually by a `MINTER_ROLE` holder via `setGearMultiplier`. Equipping gear has no on-chain minting effect today. Confirm this is intended (off-chain relay sets it) or wire `GearNFT` in directly.

## I-2 — `LOYALTY_TIER1` unused
`ZoneNFT.getLoyaltyMultiplier` checks tiers 2–4 only; ownership under 90 days always returns `100`. The declared `LOYALTY_TIER1 = 30 days` constant is dead. Either apply a tier-1 bonus or remove the constant.

## I-3 — `greatBurn` does not burn
`SeasonController.greatBurn` transfers `burnAmount` to `daoTreasury` via `transferFrom`, it does not reduce supply. The name and `GreatBurn` event are misleading. Rename, or actually call `burnFrom` if a supply reduction is intended.

---

## Notes on non-issues verified
- **Precision/overflow in `MoveToken.mintMOVE`:** `distanceMeters·rate·mult` peaks around `3e42`, far below `uint256` max; division is last. No overflow or round-to-zero at expected inputs. `MAX_DISTANCE_METERS` bounds the input. ✅
- **Signature malleability / replay in mint path:** OZ `ECDSA.recover` rejects malleable `s`; `usedRoutes`/`usedMintSigs`/`usedScoreSigs` and `chainId` in every payload prevent cross-chain and exact-sig replay. ✅
- **Reentrancy:** `$MOVE` is a standard OZ ERC20 (no hooks); state-changing external-call functions carry `nonReentrant`. No reentrancy path found. ✅
- **`SeasonController.greatBurn` DoS:** per-owner `try/catch` correctly prevents one un-approved owner from bricking the batch. ✅

*This report is an AI-assisted audit and is not a substitute for a formal engagement. LLM audit output is non-deterministic; re-running the skills may surface additional findings.*
