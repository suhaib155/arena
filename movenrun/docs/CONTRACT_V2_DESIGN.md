# MovenRun — Contract V2 Design

**Status:** V2 source + tests only. **V1 remains the only deployed suite on
Base Sepolia. V2 is NOT deployed anywhere.** Nothing in this document creates
or implies a live economy, and no mainnet deployment path exists for V2.

V2 lives in isolated files under `contracts/src/v2/` with explicit `*V2`
names. The V1 contracts, V1 tests, and the V1 deployment record
(`contracts/deployments/baseSepolia.json`, chainId 84532) are untouched.

> Note: this PR was specified to follow a "V1 characterization" PR that would
> add `docs/CONTRACT_V1_DISCREPANCIES.md`. That PR/document does not exist on
> `main` as of this writing; the V1 issue list below was derived by direct
> audit of the V1 sources plus `docs/CONTRACTS_AUDIT.md`. The existing V1 test
> suite (26 tests) is kept intact and passing as the de-facto
> characterization baseline.

---

## 1. V1 issue → V2 fix matrix

| # | V1 issue | Where in V1 | V2 fix |
|---|---|---|---|
| 1 | Ambiguous challenge lifecycle: per-hex struct existence + `resolved`/`challenger==0` logic allows confusing/overwritable states | `ZoneChallenge.declareChallenge` | Explicit `ChallengeState {None, Active, Resolved}`, global `nextChallengeId`, `challenges[challengeId]`, `activeChallengeId[hexId]` pointer; challenge IDs bound into signatures |
| 2 | Challenger win depends on the defender's voluntary `setApprovalForAll`; a defender can simply revoke approval and make resolution revert | `ZoneChallenge.resolveChallenge` → `zoneNFT.safeTransferFrom` | `ZoneNFTV2.resolveChallengeTransfer` (CHALLENGE_ROLE): approval-free, owner-verified, lock-scoped settlement + `setChallengeLock` freezing the deed during the battle |
| 3 | Personal-sign packed tuples: no domain separation, no deadline, cross-contract/cross-purpose collision potential (e.g. zone-mint vs declare vs score all sign `(chainId, uint64, address, uint256)`) | all oracle sigs | EIP-712 typed data everywhere; domain = name "MovenRun", version "2", chainId, verifying contract; every schema carries a deadline; nonces where applicable |
| 4 | Score signatures replayable across challenges on the same hex (only `(chainId, hexId, submitter, score)` is bound and marked used) | `ZoneChallenge.submitScore` | `Score` typed data binds challengeId + per-participant nonce + deadline |
| 5 | Season `mintingPaused` is reporting-only — nothing reads it; both mint paths keep working | `SeasonController.pauseMinting` / `isMintingAllowed` | `MoveTokenV2.setMintingPaused` + `ZoneNFTV2.setMintingPaused` (SEASON_ROLE); `SeasonControllerV2.pauseMinting()` pauses both, `startSeason()` unpauses both; both mint paths revert while paused |
| 6 | "Great Burn" is not a burn — it `transferFrom`s 10% of yields **to the treasury** | `SeasonController.greatBurn` | Real `burnFrom` (totalSupply decreases, treasury receives nothing), once per season, only after season end, season number + arrays + deadline in the signature, skipped amounts reported and never claimed as burned |
| 7 | Great Burn is replayable (same sig, no season binding to execution, callable during the season) | `SeasonController.greatBurn` | `greatBurnExecuted[season]` one-shot, `block.timestamp >= seasonEnd` required, duplicate hexes deduplicated per season |
| 8 | Reclaim leaks deed state: `lastActivity` and `accumulatedYield` survive into the next mint of the same hex | `ZoneNFT.reclaimDormant` | Clears ownership start, last activity, accumulated yield, dormant flag, and challenge lock; tested that a reminted hex inherits nothing |
| 9 | Stale gear: equipping checks ownership once; transferring/burning gear or deactivating a type keeps the multiplier forever | `GearNFT.equipGear`/`getUserMultiplier` | Live checks in `getUserMultiplier` (active type AND current balance > 0), explicit `unequipGear`, bounded per-item bps [10 000, 30 000], combined result capped at 3×; only active gear equippable |
| 10 | Duplicated multiplier truth: `MoveToken.gearMultiplier` mapping set by MINTER_ROLE independently of GearNFT | `MoveToken.setGearMultiplier` | Removed. `MoveTokenV2` reads `GearNFTV2.getUserMultiplier(user)` at mint time (admin-set address), clamped to [1×, 3×], fail-safe to 1× |
| 11 | All-or-nothing rewards: `_claimReward` pays only if treasury covers the full amount; `stake` timestamps make rate changes retroactive over unclaimed windows | `MoveVault._claimReward` | Checkpointed accounting (`accRewardPerToken`, per-user `rewardIndex`/`unpaidRewards`), global+user update before stake/unstake/claim/rate change, partial payment `min(pending, treasury)` with surviving remainder |
| 12 | Live-balance DAO: voting weight read at vote time (buy-vote-transfer-revote via another wallet), quorum from live `totalStaked`, executor is the DAO itself with no timelock | `MovenDAO` | OZ snapshot governance: `ERC20Votes` + `ERC20Permit` on the token (timestamp clock), `Governor` + `GovernorSettings` + `GovernorVotes` + `GovernorVotesQuorumFraction` + `GovernorTimelockControl` + `TimelockController` |
| 13 | V1 sigs could be valid on any deployment sharing the tuple layout | all | EIP-712 verifying-contract binding: a V2 signature is valid for exactly one contract instance on exactly one chain; V1-style signatures fail on V2 (tested) |

**Deliberately unchanged V1 behaviors** (same economics, carried into V2):
10 MOVE/km base rate, block-based halving each 2 600 000 blocks with a
0.01 MOVE floor, 200 MOVE/day cap (halving), 2% zone tax pull-payment,
1B MOVE max supply, 500/100/300/500 MOVE cost constants, 14-day challenges,
30-day cooldown, 90-day seasons, dormancy 180/210 days.

---

## 2. Contracts and roles

| Contract | Inherits | Purpose |
|---|---|---|
| `MoveTokenV2` | ERC20, ERC20Permit, ERC20Votes, AccessControl | $MOVE with snapshot votes (timestamp clock), oracle-gated route minting, halving, zone tax, season pause |
| `GPSOracleV2` | AccessControl, EIP712 | Verifies typed RouteProofs, forwards to `mintMOVE` |
| `ZoneNFTV2` | ERC721, AccessControl, EIP712 | Zone Deeds; typed mint sigs; challenge lock + settlement; dormancy/reclaim |
| `GearNFTV2` | ERC1155, ERC1155Burnable, AccessControl | Gear with live-ownership multipliers |
| `MoveVaultV2` | AccessControl, ReentrancyGuard | Staking with checkpointed rewards; POL; treasury |
| `ZoneChallengeV2` | AccessControl, ReentrancyGuard, EIP712 | Land-defence battles with explicit lifecycle |
| `SeasonControllerV2` | AccessControl, EIP712 | Seasons, dual mint pause, real Great Burn |
| `MovenGovernorV2` | OZ Governor stack | Snapshot governance |
| `TimelockController` | (OZ, deployed as-is) | 2-day execution delay; owns governed roles |

### Role / wiring table

| Role | On contract | Granted to | Grants ability to |
|---|---|---|---|
| `ORACLE_ROLE` | MoveTokenV2 | GPSOracleV2 | call `mintMOVE` |
| `SEASON_ROLE` | MoveTokenV2 | SeasonControllerV2 | `setMintingPaused`, `adjustEmissionRate`, `resetWeeklyStats` |
| `SEASON_ROLE` | ZoneNFTV2 | SeasonControllerV2 | `setMintingPaused` |
| `CHALLENGE_ROLE` | ZoneNFTV2 | ZoneChallengeV2 | `setChallengeLock`, `resolveChallengeTransfer` |
| `GOVERNOR_ROLE` | MoveTokenV2 | admin (V1 parity; can be moved to timelock) | `updateBaseRate` |
| `DAO_ROLE` | MoveVaultV2 | TimelockController (+ deployer until renounced) | `setRewardRate`, `withdrawTreasury` |
| `VAULT_ADMIN_ROLE` | MoveVaultV2 | deployer/admin | `addPOL` |
| `KEEPER_ROLE` | SeasonControllerV2 | deployer/admin | season lifecycle, `greatBurn`, `weeklyKeeperRun` |
| `GEAR_ADMIN_ROLE` | GearNFTV2 | deployer/admin | `addGearType`, `setGearActive` |
| `PROPOSER_ROLE` / `CANCELLER_ROLE` | TimelockController | MovenGovernorV2 | queue/cancel operations |
| `EXECUTOR_ROLE` | TimelockController | `address(0)` (open) | execute matured operations |
| Wiring | MoveTokenV2 | `zoneNFT`, `gearNFT` addresses (admin-set) | zone tax target; multiplier source |

---

## 3. Signature schemas (EIP-712)

Shared domain for every schema:
`{ name: "MovenRun", version: "2", chainId, verifyingContract }` — the
verifying contract differs per schema, so no signature is portable between
contracts, deployments, or chains. All V1 signatures were EIP-191
personal-sign and can never verify against these domains.

| Schema | Verifying contract | Typed fields |
|---|---|---|
| `RouteProof` | GPSOracleV2 | `address recipient, bytes32 routeHash, uint256 distanceMeters, uint64 hexId, uint256 deadline` |
| `ZoneMint` | ZoneNFTV2 | `uint64 hexId, address minter, uint256 mintCost, uint256 nonce, uint256 deadline` (nonce = `mintNonces[minter]`, consumed on use) |
| `ChallengeDeclaration` | ZoneChallengeV2 | `uint256 challengeId, uint64 hexId, address challenger, address defender, uint256 defenderBaseScore, uint256 deadline` (challengeId = `nextChallengeId` at signing) |
| `Score` | ZoneChallengeV2 | `uint256 challengeId, uint64 hexId, address submitter, uint256 score, uint256 nonce, uint256 deadline` (nonce = `scoreNonces[submitter]`, consumed on use) |
| `GreatBurn` | SeasonControllerV2 | `uint256 seasonNumber, uint64[] topHexIds, uint256[] yields, uint256 deadline` |

Replay protection per schema: RouteProof → `usedRoutes[routeHash]` in
MoveTokenV2; ZoneMint/Score → consumed per-signer nonces;
ChallengeDeclaration → challengeId consumption (`nextChallengeId` strictly
increases); GreatBurn → one execution per season.

**Backend note:** the deployed backend signer
(`backend/src/services/oracle.service.ts`) still signs V1 tuples for the
deployed V1 contracts — correct and unchanged. A V2 `signTypedData` signer is
required before any V2 deployment and is deliberately deferred with it; the
schemas above (mirrored in `contracts/test/v2/helpers.ts`) are the shared
test vectors for that work.

---

## 4. Challenge state machine

```
                    declareChallenge (id = nextChallengeId++)
   [no active challenge on hex]  ─────────────────────────────►  Active
      • zone minted                                              • activeChallengeId[hex] = id
      • challenger ≠ owner                                       • deed challenge-locked
      • challenger not on cooldown                               • declaration cost burned
      • valid ChallengeDeclaration sig

   Active ── submitScore (participants, typed sig, until end − 1h cutoff)
          ── activateStrongholdBoost (defender, ≤3 stacks, 24h expiry)
          ── requestTimeExtension (defender, once, +3 days)

   Active ── resolveChallenge (anyone, after challengeEnd) ──►  Resolved
      state := Resolved and activeChallengeId[hex] := 0 BEFORE settlement
      challenger wins → ZoneNFTV2.resolveChallengeTransfer(hex, defender, challenger)
      defender wins   → cooldown[challenger][hex] := now + 30d; unlock deed
```

Invariants (all tested):
1. ≤ 1 active challenge per hex (`activeChallengeId` guard).
2. An active challenge is never overwritten.
3. A resolved challenge can be followed by a new one (cooldown permitting);
   every instance has a fresh id.
4. Resolution executes exactly once; repeats revert (`not active`).
5. The active pointer is cleared on resolution.
6. All state transitions precede external transfer calls
   (checks-effects-interactions) and resolve/declare are `nonReentrant`.
7. While locked, the deed cannot move via owner transfer, approval, or
   operator; approvals granted during a lock cannot be exercised.
8. `resolveChallengeTransfer` requires CHALLENGE_ROLE + an existing lock +
   the expected owner, moves exactly the challenged token, and clears the
   lock — the challenge contract cannot move any other deed.

## 5. Season state machine

```
  [idle]/[ended] ── startSeason (KEEPER) ──► [active season N]
        seasonEnd := start + 90d; BOTH mint paths unpaused

  [active, last 14 days] ── pauseMinting (KEEPER) ──► [mint-paused]
        MoveTokenV2.mintingPaused := true  → mintMOVE reverts
        ZoneNFTV2.mintingPaused  := true  → mintZone reverts

  [after seasonEnd] ── endSeason (KEEPER, event only)
                   ── greatBurn (KEEPER, once per season)
                   ── startSeason → season N+1 (unpauses both)
```

## 6. Reward formulas (MoveVaultV2)

`rewardRatePerSecond` keeps its V1 meaning: **$MOVE-wei accrued per second
per 1e18 staked wei**.

```
Global (on every stake/unstake/claim/rate change, 1e18 precision):
    accRewardPerToken += rewardRatePerSecond * elapsedSeconds

Per user (same triggers):
    accrued            = user.amount * (accRewardPerToken − user.rewardIndex) / 1e18
    user.unpaidRewards += accrued
    user.rewardIndex    = accRewardPerToken

Claim:
    payableAmount       = min(user.unpaidRewards, treasuryBalance)
    user.unpaidRewards −= payableAmount   (remainder survives)
```

Properties: rate changes are never retroactive; stake increases earn nothing
historical; unstaking preserves accrued rewards; a dry treasury delays but
never destroys rewards; integer division rounds down (dust ≤ 1 wei per
checkpoint is never overpaid).

## 7. Great Burn semantics

```
burnAmount_i = yields[i] * GREAT_BURN_BPS / 10_000        (GREAT_BURN_BPS = 1_000 → 10%)
```

- Executed by KEEPER after `seasonEnd`, exactly once per season.
- `MoveTokenV2.burnFrom(owner_i, burnAmount_i)` — a **real burn**:
  `totalSupply` decreases by the burned total; the treasury balance does not
  increase from the burn.
- Owners must have approved SeasonControllerV2; insufficient
  allowance/balance skips that zone. `GreatBurn(season, totalBurned)` reports
  only what actually burned; `GreatBurnSkipped(season, skippedAmount,
  skippedZoneCount)` reports the rest — skipped amounts are never claimed as
  burned.
- Duplicate hexes: first occurrence wins, later ones are skipped
  (per-season `greatBurnProcessed` map). Unminted zones and zero-yield
  entries are skipped. `topHexIds.length == yields.length ≤ 100`.
- Signature binds season number, both arrays, and a deadline (see §3).

## 8. ZoneNFTV2 deed-instance rules

- **Accumulated yield follows the deed while it exists** — a transfer (sale
  or lost challenge) carries unwithdrawn yield to the new holder.
- **Loyalty is deed-instance age**: `ownershipStart` is set at mint and not
  reset by transfers. It measures how long the deed instance has existed,
  not how long the current owner has held it.
- **Reclaim destroys the deed instance and resets everything**: ownership
  start, last activity, accumulated yield, dormant flag, challenge lock. A
  reminted hex starts from zero (tested).
- A challenge-locked deed cannot be reclaimed; the challenge must settle
  first.

## 9. Governance parameters

| Parameter | Value | Where |
|---|---|---|
| Proposal threshold | 100 MOVE | GovernorSettings |
| Quorum | 10% of past total supply | GovernorVotesQuorumFraction(10) |
| Voting delay | 1 day (86 400 s) | GovernorSettings |
| Voting period | 7 days (604 800 s) | GovernorSettings |
| Execution delay | 2 days | TimelockController minDelay |
| Clock | `mode=timestamp` (`clock()` = block.timestamp) | MoveTokenV2 (ERC-6372) |

Timestamp-based clocks make the "day" values real seconds, not assumed block
counts. Voting requires delegation (standard ERC20Votes); voting power and
quorum snapshot at the proposal start.

**Deferred: V1's tier multipliers (1.5× stakers / 3× loyal zone owners).**
They are NOT implemented in V2. Live stake/loyalty reads are exactly the
non-snapshot-safe pattern V2 removes; making them safe requires checkpointed
stake and deed-age accounting (e.g. a custom `getPastVotes` composition),
which must be designed and tested on its own. Until then, governance is
1 token = 1 vote at the snapshot.

## 10. Deployment prerequisites (NOT executed in this PR)

Script: `contracts/scripts/deploy/baseSepoliaV2.ts`
(`yarn workspace @movenrun/contracts deploy:v2:sepolia`). It:

- asserts the provider chainId is exactly **84532** (Base Sepolia);
- requires `ADMIN_ADDRESS`, `ORACLE_ADDRESS`, `TREASURY_ADDRESS` env vars —
  no silent deployer fallback, zero addresses rejected;
- deploys the eight V2 contracts + TimelockController and wires every role
  in §2 (printing a full checklist; wiring steps that need a non-deployer
  admin are printed as PENDING actions rather than silently skipped);
- writes **only** `deployments/baseSepolia-v2.json` — never
  `baseSepolia.json`;
- has **no mainnet variant** and there is no `deploy:v2:mainnet` command.

Before any real testnet run: fund the deployer, set the three env addresses,
review the checklist output, have the admin execute any PENDING items, then
have the deployer renounce its bootstrap admin roles.

## 11. Migration limitations

- **No state migration.** V2 is a parallel deployment: V1 balances, deeds,
  challenges, stakes, and seasons do not carry over. Any migration
  (snapshot + airdrop, deed re-mint, etc.) is a separate design.
- **V1 stays deployed and authoritative** at the addresses in
  `docs/CONTRACTS_AUDIT.md`. Backend and mobile continue to target V1 only.
- The backend V2 signer (EIP-712) is deferred until a V2 deployment is
  actually planned (§3).
- V1 and V2 tokens are distinct assets; nothing in this PR mints, values, or
  promises either.

## 12. Test inventory

- V1 suite: 4 files, 26 tests — untouched, passing.
- V2 suite (`contracts/test/v2/`): 8 files (7 suites + shared helpers),
  146 tests — unit coverage per contract plus an end-to-end integration
  flow (route mint → gear → zone mint → tax → challenge → staking → season
  pause → Great Burn → governance execution through the timelock).
