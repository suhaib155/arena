# MovenRun — Contract V1 Discrepancy Report

**Status:** Characterization & documentation only. **No Solidity source, no
deployment addresses, and no deployment records were changed by this report or
its test suite.** The deployed Base Sepolia V1 (see
`docs/CONTRACTS_AUDIT.md` and `contracts/deployments/baseSepolia.json`) remains
authoritative and untouched.

This document records concrete lifecycle / economic / governance discrepancies
in the **currently deployed V1 contracts**, each backed by a *passing*
characterization test that proves the real behavior — including behavior that
is unsafe. The tests live in
[`contracts/test/v1-characterization/`](../contracts/test/v1-characterization)
and every test is named with **"V1 characterization"** / **"known discrepancy"**
so the proven behavior is never mistaken for an approved invariant.

Because the deployed contracts are immutable, every logic-level fix below
implies **new V2 contracts + redeployment + a state/ownership migration** — it
cannot be patched in place. The recommended follow-up is a separate,
**isolated** V2 contract set (see the end of this document); this PR does not
begin that work.

> ⚠️ These are proven properties of the deployed bytecode, **not** an approved
> design. Do not build product flows that depend on any behavior below.

---

## Severity summary

| # | Discrepancy | Severity | Deployed V1 affected | Fix needs redeploy/migration |
|---|---|---|---|---|
| 1 | Active challenge can be overwritten | **Critical** | Yes | Yes (V2) |
| 3 | Settlement depends on the losing defender's approval | **Critical** | Yes | Yes (V2) |
| 16 | `deploy:mainnet` runs the Base Sepolia script | **Critical** | No (tooling/process) | ✅ Fixed — repo script fix, no redeploy (see `chore(contracts): add deterministic CI and disable unsafe mainnet deployment`) |
| 2 | No new challenge after a resolved challenge | High | Yes | Yes (V2) |
| 4 | Deed transferable during an active challenge | High | Yes | Yes (V2) |
| 5 | Declaration-signature replay surface | High | Yes | Yes (V2) |
| 6 | Score-signature lifecycle collision | High | Yes | Yes (V2) |
| 7 | Season mint pause is not enforced | High | Yes | Yes (V2) |
| 8 | Great Burn is a treasury transfer, not a burn | High | Yes | Yes (V2) |
| 9 | Great Burn signed payload is replayable | High | Yes | Yes (V2) |
| 10 | Dormant reclaim leaks yield/activity state | Medium | Yes | Yes (V2) |
| 11 | Gear multiplier survives transferring away all gear | Medium | Yes | Yes (V2) |
| 12 | Vault reward is all-or-nothing (treasury starvation) | Medium | Yes | Yes (V2) |
| 13 | Reward-rate changes apply retroactively | Medium | Yes | Yes (V2) |
| 14 | DAO votes on live transferable balances (no snapshot) | Medium | Yes | Yes (V2) |
| 15 | MovenDAO lacks `DAO_ROLE` on MoveVault (as deployed) | Medium | Yes | No — role grant, or clarified V2 wiring |

Test totals: **17 characterization tests** across issues #1–#16, all passing,
alongside the **26** pre-existing contract tests (43 total). Issue #16's
unsafe command has since been removed by
`chore(contracts): add deterministic CI and disable unsafe mainnet
deployment`, which adds **6** further static tooling tests
(`test/tooling/deploymentCommands.test.ts`) guarding the fix going forward —
**49** contract tests total as of that change. (The characterization suite
for issue #16 was originally 3 tests / 18 total; a later revision trimmed it
to 2 tests / 17 total after removing genuine duplication with the tooling
suite above — see `docs/CONTRACTS_AUDIT.md`'s "Revision" note.)

---

## 1. Active challenge overwrite — **Critical**

- **Current behavior.** `ZoneChallenge.declareChallenge` gates with
  `require(!challenges[hexId].resolved || challenges[hexId].challenger == address(0), ...)`.
  For an **active** (unresolved) challenge, `!resolved` is `true`, so a second
  declaration passes and clobbers the live challenge (new challenger, reset
  timers). The first challenger's already-burned `DECLARATION_COST` (100 $MOVE)
  is lost.
- **Test.** `01-challenge-lifecycle.char.test.ts` — "known discrepancy #1".
- **Impact.** Any active challenge can be griefed/hijacked; declaration costs
  are burned with no protection; challenge state is not integrity-protected.
- **Deployed V1 affected.** Yes.
- **Required V2 invariant.** `state == None || state == Resolved` — an active
  challenge must **never** be overwritten.
- **Migration/redeploy.** Yes (V2 contract).

## 2. No new challenge after a resolved challenge — High

- **Current behavior.** Once `resolved == true` (and `challenger != address(0)`,
  always true post-resolution), `!resolved || challenger == 0` is `false`, so a
  later `declareChallenge` for the same hex reverts
  `"ZoneChallenge: challenge already active"`. A hex is permanently locked from
  future challenges after its first resolution.
- **Test.** `01-challenge-lifecycle.char.test.ts` — "known discrepancy #2".
- **Impact.** A zone can be challenged exactly once, ever. The intended
  cooldown-gated re-challenge economy does not function.
- **Deployed V1 affected.** Yes.
- **Required V2 behavior.** A resolved challenge can be followed by a new
  challenge after applicable cooldown rules.
- **Migration/redeploy.** Yes (V2 contract).

## 3. Defender approval settlement dependency — **Critical**

- **Current behavior.** `resolveChallenge` settles a challenger win via
  `zoneNFT.safeTransferFrom(defender, challenger, hexId)`, called by the
  `ZoneChallenge` contract. That transfer only succeeds if the **defender**
  previously `setApprovalForAll(zoneChallenge, true)`. A numerically-winning
  challenger cannot take the deed unless the losing defender voluntarily
  approved the transfer. The existing passing suites
  (`integration.test.ts`, `ZoneChallenge.test.ts`) only settle a challenger win
  because they include that explicit approval.
- **Test.** `01-challenge-lifecycle.char.test.ts` — "known discrepancy #3"
  (proves the revert without approval **and** success with approval; the
  revert is OZ `ERC721InsufficientApproval`).
- **Impact.** The defender can guarantee they never lose by simply never
  approving. Core "Defend → Own" settlement is unsound.
- **Deployed V1 affected.** Yes.
- **Required V2 invariant.** A valid resolved challenge must settle without
  voluntary approval from the losing defender (deed escrow at declaration, or a
  contract-held operator/custody model).
- **Migration/redeploy.** Yes (V2 contract).

## 4. Transfer during an active challenge — High

- **Current behavior.** `ZoneNFT` does not override `_update`/`transferFrom` to
  lock a challenged deed. While a challenge is active, the defender can
  `transferFrom` the deed to a fresh address; the challenge still references the
  old defender and is stranded.
- **Test.** `01-challenge-lifecycle.char.test.ts` — "known discrepancy #4".
- **Impact.** A defender can dodge a losing challenge by moving the deed
  mid-challenge; interacts with #1/#3 to fully break settlement integrity.
- **Deployed V1 affected.** Yes.
- **Required V2 rule.** The deed must be challenge-locked or escrowed while an
  active challenge exists.
- **Migration/redeploy.** Yes (V2 contract).

## 5. Declaration-signature replay surface — High

- **Current behavior.** The declaration signature is
  `keccak256(abi.encodePacked(block.chainid, hexId, zoneNFT.zoneOwner(hexId), defenderBaseScore))`.
  It does **not** bind the challenger, a challenge instance id, a deadline, a
  nonce, or the verifying-contract address (only indirectly the chain via
  `block.chainid`). There is no `usedDeclarationSigs` mapping, so the same
  signature bytes are replayable by any caller for the same hex/owner/score.
- **Test.** `01-challenge-lifecycle.char.test.ts` — "known discrepancy #5"
  (reconstructs the payload, proves recovery, and replays the identical
  signature from a second challenger).
- **Impact.** Declaration authorization is not caller/instance-scoped;
  combined with #1, a replayed signature can hijack challenges.
- **Deployed V1 affected.** Yes.
- **Required V2 invariant.** Declaration signatures must bind challenger,
  challenge instance, deadline, nonce, and verifying contract.
- **Migration/redeploy.** Yes (V2 contract).

## 6. Score-signature lifecycle collision — High

- **Current behavior.** Score signatures are tracked in a **global**
  `usedScoreSigs[keccak256(chainId, hexId, submitter, score)]` with no
  challenge-instance component. The same logical (hex, submitter, score) can be
  used only once ever; if the resolved-hex lock (#2) were ever relaxed to allow
  re-challenges, the "used" state would leak across challenge instances.
- **Test.** `01-challenge-lifecycle.char.test.ts` — "known discrepancy #6"
  (asserts the exact global key is marked used and that reuse reverts
  `"ZoneChallenge: sig reused"`).
- **Impact.** Score authorization is not instance-scoped; cross-challenge
  lifecycle collisions.
- **Deployed V1 affected.** Yes.
- **Required V2 invariant.** Score signatures must be bound to a specific
  challenge instance.
- **Migration/redeploy.** Yes (V2 contract).

## 7. Season mint pause is not enforced — High

- **Current behavior.** `SeasonController.pauseMinting()` sets
  `mintingPaused = true` and `isMintingAllowed()` returns `false`, but **no
  minting path consults it**: `MoveToken.mintMOVE` (route rewards, via
  `GPSOracle`) and `ZoneNFT.mintZone` (deeds) both succeed unchanged after a
  pause.
- **Test.** `02-season-emissions.char.test.ts` — "known discrepancy #7" (after
  `pauseMinting()`, asserts `isMintingAllowed() == false`, then proves route
  MOVE minting **and** zone minting still succeed).
- **Impact.** The pause is purely advisory; end-of-season emission controls do
  not actually gate anything.
- **Deployed V1 affected.** Yes.
- **Ambiguity for V2 to define.** Whether the pause must cover (a) MOVE route
  minting, (b) Zone Deed minting, or (c) both — then actually enforce it in the
  minting paths.
- **Migration/redeploy.** Yes (V2 contracts wiring the enforcement).

## 8. Great Burn is a treasury transfer, not a burn — High

- **Current behavior.** `SeasonController.greatBurn` computes
  `burnAmount = yield * GREAT_BURN_PCT / 10_000` (`GREAT_BURN_PCT = 1_000` ⇒
  **10%**) and executes `moveToken.transferFrom(owner, daoTreasury, burnAmount)`
  — a transfer to the treasury. **Total supply is unchanged**; no ERC-20 burn
  happens.
- **Test.** `02-season-emissions.char.test.ts` — "known discrepancy #8"
  (asserts `totalSupply` unchanged, treasury balance `+burnAmount`, owner
  balance `-burnAmount`, and `burnAmount == yield / 10`).
- **Impact.** The advertised deflationary "Great Burn" sink does not reduce
  supply; it redirects value to the treasury. Tokenomics/`docs/TOKENOMICS.md`
  claims must be reconciled.
- **Deployed V1 affected.** Yes.
- **Required V2 invariant.** "Great Burn" must be a real burn (or be renamed to
  a treasury sweep) with defined, documented tokenomics.
- **Migration/redeploy.** Yes (V2 contract).

## 9. Great Burn replay — High

- **Current behavior.** The `greatBurn` oracle payload is
  `keccak256(abi.encode(chainId, seasonNumber, topHexIds, yields))`. There is no
  `usedGreatBurnSigs` mapping and no per-season finalized flag, so the **same
  signed payload can be executed repeatedly** within a season while owners have
  balance + allowance — each execution moves another 10% to the treasury.
- **Test.** `02-season-emissions.char.test.ts` — "known discrepancy #9"
  (executes the identical `(payload, signature)` twice; treasury receives
  `2 × burnAmount`).
- **Impact.** A season's burn/transfer can be multiplied by re-submitting the
  same authorized payload.
- **Deployed V1 affected.** Yes (mitigated operationally only by the fact that
  `greatBurn` is `KEEPER_ROLE`-gated).
- **Required V2 invariant.** One finalization per season, or one use per signed
  payload (nonce / finalized flag).
- **Migration/redeploy.** Yes (V2 contract).

## 10. Dormant reclaim state leakage — Medium

- **Current behavior.** `ZoneNFT.reclaimDormant` `delete`s only `ownershipStart`
  and `isDormant`. It does **not** clear `lastActivity` or `accumulatedYield`,
  and `mintZone` never resets `accumulatedYield`. So accumulated yield survives
  the burn, and the next minter of the same hex inherits and can `withdrawYield`
  the previous owner's yield.
- **Test.** `03-zone-gear-state.char.test.ts` — "known discrepancy #10"
  (accumulates real zone-tax yield, reclaims, asserts `ownershipStart`/`isDormant`
  cleared but `lastActivity`/`accumulatedYield` leaked, then re-mints to a new
  owner who withdraws the leaked yield).
- **Impact.** Value and history survive a burn into a later re-mint; a new
  minter can claim a previous owner's accrued yield.
- **Deployed V1 affected.** Yes.
- **Required V2 invariant.** `reclaimDormant` must fully clear per-zone state
  (`ownershipStart`, `lastActivity`, `accumulatedYield`, dormant).
- **Migration/redeploy.** Yes (V2 contract).

## 11. Equipped gear after transfer — Medium

- **Current behavior.** `GearNFT.getUserMultiplier` reads only
  `equippedGear[user][slot]` and the gear's `multiplierBps`; it never re-checks
  `balanceOf`. A user can equip gear, transfer away every copy, and keep the
  full multiplier.
- **Test.** `03-zone-gear-state.char.test.ts` — "known discrepancy #11"
  (equips a 1.5× gear, transfers all copies away, asserts `getUserMultiplier`
  still returns `1.5e18` with zero balance).
- **Impact.** Multiplier can be "rented"/duplicated by passing gear between
  wallets; emission-multiplier integrity is broken.
- **Deployed V1 affected.** Yes.
- **Required V2 invariant.** Only currently held (and active) gear may
  contribute to the multiplier.
- **Migration/redeploy.** Yes (V2 contract).

## 12. MoveVault treasury starvation (all-or-nothing) — Medium

- **Current behavior.** `_claimReward` only pays when
  `reward > 0 && treasuryBalance >= reward`. If the pending reward exceeds the
  treasury, **nothing** is paid, the claim timestamp is **not** advanced, and
  the debt keeps compounding — a permanently under-funded treasury strands all
  rewards.
- **Test.** `04-vault-dao.char.test.ts` — "known discrepancy #12" (pending >
  treasury ⇒ claim pays 0, treasury untouched, pending strictly grows after
  more time).
- **Impact.** No partial payment; rewards can be indefinitely unclaimable.
- **Deployed V1 affected.** Yes.
- **Required V2 invariant.** Partial payment or explicit unpaid-reward
  accounting.
- **Migration/redeploy.** Yes (V2 contract).

## 13. Reward-rate retroactivity — Medium

- **Current behavior.** `setRewardRate` sets `rewardRatePerSecond` with no
  checkpoint. `_claimReward`/`pendingReward` compute
  `amount * rewardRatePerSecond * (now - lastRewardClaim)`, so a rate change
  re-prices the **entire** interval since the last claim.
- **Test.** `04-vault-dao.char.test.ts` — "known discrepancy #13" (stakes at
  rate 0, elapses 1000s at rate 0 with 0 pending, raises the rate, and shows
  pending immediately reflects the whole interval at the new rate).
- **Impact.** Rate changes rewrite historical accrual for every staker.
- **Deployed V1 affected.** Yes.
- **Required V2 invariant.** Rate changes must be checkpointed and must not
  rewrite historical accrual.
- **Migration/redeploy.** Yes (V2 contract).

## 14. DAO transferable-balance voting — Medium

- **Current behavior.** `_votingWeight` reads live `moveToken.balanceOf(voter)`
  plus live stake at vote time — no snapshot. The same tokens can vote from
  wallet A, be transferred to wallet B, and vote again. `execute` reads quorum
  live from `moveVault.totalStaked()` at execution time (also un-snapshotted).
- **Test.** `04-vault-dao.char.test.ts` — "known discrepancy #14" (A votes,
  transfers all tokens to B, B votes; `forVotes == 2 × amount`; with
  `totalStaked == 0` the quorum is 0 and the double-counted proposal executes,
  actually changing `baseRate`).
- **Impact.** Vote weight is trivially duplicated by transferring tokens
  between wallets; quorum is not snapshotted either.
- **Deployed V1 affected.** Yes.
- **Required V2 invariant.** Vote weight from a snapshot at proposal creation;
  quorum from a snapshotted stake total.
- **Migration/redeploy.** Yes (V2 contract).

## 15. DAO ↔ MoveVault role wiring — Medium

- **Current behavior.** The deploy script (`scripts/deploy/baseSepolia.ts`)
  grants MoveToken roles to `MovenDAO` but never calls
  `moveVault.grantRole(DAO_ROLE, movenDAO)`. As deployed, `MovenDAO` does **not**
  hold `MoveVault.DAO_ROLE`, so DAO-scoped vault functions (`setRewardRate`,
  `withdrawTreasury`) are unreachable by the DAO — a governance proposal
  targeting them bubbles up as `"MovenDAO: execution failed"`.
- **Test.** `04-vault-dao.char.test.ts` — "known discrepancy #15" (asserts
  `hasRole(DAO_ROLE, movenDAO) == false`; impersonates the DAO address and shows
  `setRewardRate`/`withdrawTreasury` revert with
  `AccessControlUnauthorizedAccount`).
- **Impact.** The DAO cannot govern the vault it is meant to control.
- **Deployed V1 affected.** Yes.
- **Required V2 decision.** V2 deployment wiring must decide and document
  whether `MovenDAO` should hold `MoveVault.DAO_ROLE`. **This PR does not change
  roles.** (Note: unlike the logic issues, this specific gap is correctable on
  the existing deployment via a role grant if the admin decides that is the
  intended wiring — no redeploy strictly required.)
- **Migration/redeploy.** No — a role grant on the existing deployment, or a
  clarified V2 wiring; deliberately not done here.

## 16. Mainnet deployment-script mismatch — **Critical** — ✅ FIXED (tooling only)

> **Status update (`chore(contracts): add deterministic CI and disable unsafe
> mainnet deployment`):** the unsafe `deploy:mainnet` command has been
> **removed** from `contracts/package.json`, with no replacement mainnet
> command added. Mainnet deployment remains intentionally unsupported until a
> dedicated, reviewed, chain-asserting mainnet deployment design exists. This
> was a **repository/tooling fix only** — it required no contract
> redeployment, changed no contract address, and left
> `deployments/baseSepolia.json` byte-identical. The original defect is
> preserved below as historical evidence; the current-state invariant (no
> mainnet command exists) is now guarded going forward by
> `test/tooling/deploymentCommands.test.ts`, independent of this historical
> characterization test.

- **Historical behavior (fixed).** `package.json`'s `deploy:mainnet` ran
  `hardhat run scripts/deploy/baseSepolia.ts --network baseMainnet`. The script
  hardcodes `network: "baseSepolia"`, `chainId: 84532`, and always writes
  `deployments/baseSepolia.json`. A "mainnet" deploy would therefore have
  emitted testnet-labelled metadata (and overwritten the testnet record).
- **Historical characterization test.** `05-deploy-script.char.test.ts` — its
  first assertion was updated (not removed) to reflect that `deploy:mainnet` no
  longer exists, since the full contract suite must stay green after the fix.
  It was later trimmed from 3 to 2 tests: the current-state facts it
  duplicated (no command targets `baseMainnet`, the exact Sepolia `--network`
  flag) are now asserted solely by `test/tooling/deploymentCommands.test.ts`
  below, and this file keeps only the regression guard plus the one
  historical root-cause fact (the script's own hardcoded
  network/chainId/output-file metadata) not covered elsewhere. **No
  deployment was run** in the original characterization or either fix.
- **Current-state safety test.** `test/tooling/deploymentCommands.test.ts` — 6
  static, non-network assertions: no `deploy:mainnet` script; no package
  command invokes `baseSepolia.ts` with `--network baseMainnet`; the
  remaining Base Sepolia command uses only `--network baseSepolia`; the script
  writes only `deployments/baseSepolia.json`; its recorded chain ID is
  `84532`; and no command/script combination can produce a
  `baseSepolia`-labelled artifact while connected to Base mainnet.
- **Impact (historical).** A mainnet deploy would have been silently
  mislabeled/mis-chained and could have clobbered the authoritative testnet
  deployment record. High blast radius if it had ever been executed — it never
  was.
- **Deployed V1 affected.** No — the currently deployed Base Sepolia addresses
  were never affected; this was always a repo/process risk for a
  *hypothetical future* mainnet deploy, not a defect in the deployed contracts.
- **Required V2 fix — now moot for V1 tooling.** A real, separate mainnet
  deploy script writing network-correct metadata (e.g. `base.json`), and/or a
  guard that refuses to run when the connected `chainId` ≠ the script's
  expected chain, remains the right design **if and when mainnet deployment is
  actually planned**. No such script exists yet, and none is added by the
  tooling fix — the unsafe command was deleted, not replaced.
- **Migration/redeploy.** No — this was a repository script fix; no contract
  redeployment was required or performed.

---

## Recommended next PR

`fix(contracts): add isolated v2 territory economy contracts` — a **new,
isolated** V2 contract set (leaving the deployed V1 source and
`deployments/baseSepolia.json` untouched) that encodes the V2 invariants above,
with a migration/redeploy plan for the state and deed ownership held by V1.
