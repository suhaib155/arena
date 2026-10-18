# G5 contract issue ledger: `feat/v3-onchain-core`

> **RESEARCH — not an audit, not a decision, not legal advice.** This ledger turns the preliminary findings in [G5_G7_ECONOMY_RESEARCH.md §8](G5_G7_ECONOMY_RESEARCH.md#8-contract-review-featv3-onchain-core-c8262ec) into one row per issue, with a proof for each. Nothing was deployed, signed for real or sent to any chain. No RPC URL, faucet, testnet or private key was used. The proofs ran on Hardhat's in-process network with its built-in test accounts. Every row's audit owner is **external audit required**: a passing proof here shows that an issue exists. It does not show that the contracts are otherwise safe.

- **Reviewed commit:** `origin/feat/v3-onchain-core` at `c8262ecda89d9a2a11f045074ddf2be5d652af56` (c8262ec). Source was read with `git show`; the branch was not checked out and not changed. Line numbers below are for that commit.
- **EVM proofs:** `shared/contract-proofs/g5-ledger/ledger.proof.ts` (18 tests, all pass). Run them with `yarn workspace @movenrun/shared proofs:g5`. The script extracts `movenrun/contracts` at the pinned commit into a temporary directory with `git archive`, then runs the branch's own fixture (`test/v3/helpers.ts`, which deploys the suite the way the deploy script does). It compiles with the solcjs 0.8.26 build already in `node_modules`, so nothing is downloaded. To allow that, it relaxes `pragma solidity 0.8.24` to `^0.8.24` in the scratch copy and changes no other contract text. Hardhat config: in-process network only (chain id 31337), no accounts, no URLs.
- **Arithmetic model:** `shared/src/sim/contractLedger.ts` with `shared/src/sim/__tests__/contractLedger.test.ts`. It mirrors the settlement schedule and pool, sizes H1, and compares remediations. It is part of the shared suite.

## 1. Summary after verification

| Id | Preliminary | Ledger | Outcome |
|---|---|---|---|
| H1 | High | **High** | Confirmed and sized. All 400M can be minted in 180 publications with no time passing. Corrected: liquid extraction on that path is bounded (allowance + 2% tolls). The irreversible harm is exhausting the allocation, inflating locked balances, and losing the skipped days for good |
| H2 | High | **High** | Confirmed. Extended: `scoringDay` is not bound to the clock. The sub-point "declaration does not bind the defender" is **downgraded** and split out as H2b (Low) |
| H2b | (part of H2) | **Low** | Real, but the defender is read from `ownerOf` at declaration and escrow follows the deed. The only effect is that a signed fortification value may describe the previous holder |
| H3 | High | **High** | Confirmed. Extended: `cityId` is chosen by the signer and not derived from the cell, so the cap can be bypassed even by **one** wallet. The §12 "no related cluster above 20%" rule exists on chain only as a signed boolean |
| N1 | new | **Medium** | No burn, revoke or challenge window for deeds. A deed minted from a wrong attestation is permanent and squats its cell forever |
| M1 | Medium | **Medium** | Confirmed (folded into the H3 proofs) |
| M2 | Medium | **Low** (downgraded) | The deviation from the source is real, but every declaration needs the contest signer, which is the control that actually applies. The on-chain cooldown is a secondary, per-address control |
| M3 | Medium | **Low** (downgraded) | Needs a timelocked admin action that is visible in advance, and the signer can re-sign under the new version. What remains: the version is not snapshotted per contest |
| M4 | Medium | **Medium** | Confirmed. Extended: nothing on chain checks that a toll recipient holds a deed. The architecture doc (§7) states that tolls sitting outside the allowance is deliberate, which makes it an economics decision, not a bug |
| M5 | Medium | **Medium** | Confirmed, wording corrected. The per-day locked and liquid buckets are bounded on chain. Only the per-account split inside them is enforced off chain alone |
| M6 | Medium | **Medium** | Confirmed with a real purchase at the stale price |
| M7 | Medium | **Medium** | Confirmed. Locked-only MOVE pays for a deed, and the deed then moves to another wallet with no MOVE involved |
| M8 | Medium | **Medium** | Confirmed (privacy) |
| L1 | Low | **Low** | Confirmed. A resolution-9 cell is refused |
| L2 | Low | **Low** | Confirmed. `minDelay = 1` deploys, and the deploy script also only refuses 0 |
| L3 | Low | **Low** | Confirmed. The later claimant reverts |
| L4 | Low | **Low** (impact corrected) | Broader than first stated. A cap of 0 freezes *every* transfer and sale of deeds already in the city, and every contest there, not only transfers into it |
| L5 | Low | **Low** | Confirmed. An expiry in 2100 is accepted |

Nothing reviewed showed a reentrancy, signature-malleability, cross-chain replay or cross-contract replay issue (see §2.19).

## 2. Ledger rows

Format per row: **where** (contract, function, lines at c8262ec), **prerequisites**, **impact**, **proof**, **remediation options**, **invariant**, **test to add**, **audit owner**.

### 2.1 H1 — settlement day not bound to time; the pool absorbs the unissued budget (High)

- **Where:** `MovenRunSettlement.publishSettlement` (L199–285). The day check (L209–211) requires only `dayId > lastSettledDay`. `_dailyPool` (L361–365) returns `(seasonBudget − seasonIssued) ÷ (90 − dayIndex + 1)`. `_openSeason` (L334–357) opens seasons strictly in order, but with no time condition.
- **Prerequisites:** valid signatures from both the settlement signer and the reconciliation signer for one authorization. That happens if either both keys are compromised, or one pipeline feeds both (a reconciliation job that signs whatever the settlement job hands it), or there is an honest bug that emits a far-future `dayId`.
- **Impact:**
  - One call for day 90 of a season mints that season's whole unissued budget. Seasons can follow one another in back-to-back transactions.
  - The model counts 180 publications to exhaust the 400M player allocation (15 decaying seasons, then 2M floor seasons), with zero wall-clock time.
  - **Corrected:** the liquid part of that mint is bounded by `liquidIssuanceAllowance` (zero by default) plus 2% of `tollBase` (M4). The rest lands as locked balances in whatever accounts the Merkle root names.
  - The harm that cannot be undone is therefore the following:
    - the lifetime allocation is consumed, and `cumulativeMinted` never falls
    - locked balances inflate; they can buy deeds (M7) and pay contest fees
    - every skipped day can never be published, because of `DayNotAdvancing`, so honest players lose those days' rewards permanently
- **Proof:**
  - EVM, `H1` block (three tests):
    - day 1, then day 90 in the same block range, mints the full season budget
    - day 180 follows at once; day 2 is then refused
    - with zero allowance, the only liquid output is the 2% toll bucket
  - Model, `contractLedger.test.ts`: 180 publications, 400M, 0 days.
- **Remediation options** (combinations, not alternatives):
  1. Bind `dayId` to `block.timestamp` from an immutable genesis: `dayId ≤ (now − genesis) ÷ 1 day`, plus a settlement lag.
  2. Cap each publication at `k × seasonBudget ÷ 90`, with `k` a published constant (for example 1–2).
  3. A minimum interval between publications.
  4. Treat skipped days explicitly: either allow late publication of a missed day within a window, or forfeit them on the record.

  The model shows that (2) alone does not bound the rate: every day id can still be used at once. (1) is what bounds it.
- **Invariant:** for every t, `lifetimeMovementIssued(t) ≤ k × Σ (seasonBudget ÷ 90)` over the days elapsed since genesis. No publication's `dayId` is later than the current wall-clock day.
- **Test to add:** a property test over random publication sequences and timestamps, asserting the invariant. A regression test that day 90 straight after day 1 reverts. A test that a missed day is handled as the chosen option says.
- **Audit owner:** external audit required.

### 2.2 H2 — one contest signer decides declarations and every score (High)

- **Where:** `MovenRunContests.contestSigner` (L108). `declareContest` (L232–291) checks the declaration signature at L248. `submitScore` (L342–387) checks the score signature at L352, bounds `score` only by `uint128` (L358), and checks only that `scoringDay < 7` (L355), with no link to the calendar day. `settleContest` (L412–439) gives ties to the defender (L424).
- **Prerequisites:** the contest signer's key, or the score pipeline behind it. No second signer and no on-chain bound exist.
- **Impact:**
  - The signer can declare against any deed, sign any score for the challenger, and simply not sign the defender's. The deed then moves 72 h + 7 days later, and nothing the defender does on chain can stop it.
  - All seven scoring days can be relayed in the first minute of the window.
  - Deeds carry liquid tolls, so this one key decides who receives a liquid income stream.
- **Proof:** EVM, `H2`. Seven scores of 1 for the challenger and none for the defender: the deed moves to the challenger.
- **Remediation options:**
  1. Two independent signers for scores, as settlement already has.
  2. A per-day score ceiling derived from the settlement record (a contest score cannot exceed that participant's verified movement for the day).
  3. Bind `scoringDay` to `scoringStart + day × 1 day` and accept it only after that day closes.
  4. Publish both sides' scores together per day, and refuse a day on which only one side's score is posted, so that withholding one side cannot win.
  5. A challenge window before settlement (see §3.4).
- **Invariant:** a contest outcome is a function of scores that were each authorized by two independent keys, are bounded by settled movement, and are bound to their calendar day.
- **Test to add:** one compromised key cannot change an outcome. A score posted before its day closes reverts. One-sided score days are handled under the chosen rule.
- **Audit owner:** external audit required.

### 2.3 H2b — declaration authorization does not bind the defender (Low; downgraded from part of H2)

- **Where:** `DECLARATION_AUTHORIZATION_TYPEHASH` (L50–53) has no `defender` field. The defender is read at L270.
- **Prerequisites:** the holder transfers the deed between the signer issuing the authorization and its use.
- **Impact:**
  - Escrow follows the current owner, so the contest still targets the right token. Only `fortificationBps`, which is signed for the old context, may be wrong.
  - Griefing exists, but is weak: a holder can transfer the deed to the challenger to make the declaration revert (`ChallengerIsHolder`), and doing so gives the deed away.
  - Preliminary H2 overstated this point.
- **Proof:** EVM, `H2` second test. After the transfer, the contest records the new holder.
- **Remediation:** add `defender` (and `fortificationBps` provenance) to the signed struct, or have the contract read fortification at declaration time.
- **Invariant:** every signed contest parameter refers to the holder recorded in the contest.
- **Test to add:** a declaration signed for holder A reverts once B holds the deed.
- **Audit owner:** external audit required.

### 2.4 H3 / M1 — one eligibility signer; the cap is per wallet and per signer-chosen city label (High)

- **Where:** `MovenRunDeedClaims.claim` (L147–205). The single signature check is at L161. The remaining checks (L165–175) compare *signed* numbers against thresholds, so they are self-attested by that same signer. The cap check is at L180–184. `cityId` is taken from the attestation and passed to `deed.mintDeed` at L196. `MovenRunDeed.mintDeed` (L121–141) checks only that the cell is structurally valid (L127). `_occupyHolderSlot` (L278–287) counts per `(holder, cityId)`.
- **Prerequisites:** the eligibility signer's key or its pipeline, plus any number of fresh wallets. **New:** a single wallet suffices if the signer labels cells in one place with different `cityId`s.
- **Impact:**
  - The signer can mint a deed for any valid resolution-8 cell, to anyone.
  - The per-holder city cap bounds wallets, not people, and it binds only to a city *label* the signer chooses (the contract does not know which city a cell is in).
  - §12's "no related cluster above 20%" and "own and linked traffic never counts" exist on chain only as the signed boolean `relatedTrafficExcluded`.
  - The impact is permanent (N1).
- **Proof:** EVM, `H3 / M1`:
  - three fresh wallets take three deeds in a city capped at 1
  - one wallet takes two deeds, with cap 1 per label, by using two labels for neighbouring cells
  - the deed ABI has no `burn` or `revoke`
- **Remediation options:**
  1. Two independent eligibility signers, with distinct pipelines.
  2. Bind `cityId` to the cell on chain: a committed mapping from H3 parent cell to city, with a Merkle proof at claim time.
  3. A city-wide cap (the §12 reading), in addition to the per-holder cap.
  4. A rate limit on mints per city per day.
  5. A challenge window before the deed becomes transferable (§3.4).
  6. Publish an aggregate risk-graph attestation commitment per claim (a hash of the cluster evidence), so the claim can be audited later.
- **Invariant:**
  - No deed exists without two independent attestations.
  - The city of a deed is a function of its cell.
  - For every city, the deeds held by any one risk-graph cluster stay within the published share.
- **Test to add:** a claim with one signature reverts. A claim with a mismatched city reverts. The city-wide cap binds across wallets. The daily mint rate limit binds.
- **Audit owner:** external audit required.

### 2.5 N1 — deeds cannot be revoked; no challenge window (Medium, new)

- **Where:** `MovenRunDeed` has no burn path (header L13, "no burn path"). `mintDeed` (L121–141) makes the deed transferable at once, and `DeedAlreadyExists` (L130) means a cell can hold only one deed, ever.
- **Prerequisites:** any wrong attestation: compromise, a pipeline bug, or fraud found later.
- **Impact:** the error is permanent. The deed collects tolls from the moment it is minted, and it can be sold before anyone notices.
- **Proof:** EVM, `H3 / M1` third test (the ABI has no burn or revoke). Reasoning: `_ownerOf(tokenId) != 0` blocks any re-mint of the cell.
- **Remediation options:**
  1. A pending state: minted but non-transferable and earning no toll for a challenge window (for example 7–14 days), during which a second key or governance can void it.
  2. A narrowly scoped, timelocked revoke for deeds found to be fraudulent, with an event, a reason code and a public appeal path.
  3. A requirement that a deed changing hands in its first N days carry a fresh attestation.

  Any revoke power is itself a centralisation and seizure risk. That is a governance decision (G5-7, G5-5).
- **Invariant:** no deed can be transferred, or earn a toll, before its challenge window closes.
- **Test to add:** a transfer inside the window reverts; a void inside the window clears the cell; after the window, no void path exists (or only the chosen governed one).
- **Audit owner:** external audit required.

### 2.6 M2 — the contest cooldown is per challenger address and covers every deed (Low; downgraded)

- **Where:** `settleContest` L432 writes `challengerCooldownUntil[challenger]`, and `declareContest` checks it at L263–264. §13 says "locked out of *that deed*".
- **Prerequisites:** a lost contest.
- **Impact:**
  - An address is locked out of every deed, which is broader than the source and therefore a fairness deviation.
  - A fresh wallet is not locked out at all. However, every declaration needs the contest signer's authorization for that exact challenger, so the control that matters is off chain either way.
  - Downgraded because the on-chain value is a secondary control.
- **Proof:** EVM, `M2`. After losing on deed A, the address is refused on deed B, and a fresh address is accepted.
- **Remediation:** key the cooldown by `(challenger, tokenId)`. Enforce the per-person lockout in the signer's policy, against the risk graph.
- **Invariant:** a lost contest blocks the same person, not merely the same address, from the same deed for 30 days, and from no other deed.
- **Test to add:** per-deed cooldown; a declaration for a related wallet is refused by the signing policy (off-chain test).
- **Audit owner:** external audit required.

### 2.7 M3 — `rulesVersion` is global, not per contest (Low; downgraded)

- **Where:** `submitScore` L346–348 compares against the current `rulesVersion`. `setRulesVersion` is at L532–535. The `Contest` struct (L81–92) stores no version.
- **Prerequisites:** a timelocked version change scheduled during a contest. It is visible for the whole delay.
- **Impact:**
  - Score authorizations already signed under the old version revert. The signer can re-sign under the new one.
  - If nobody relays (for example, the paymaster budget is exhausted), the tie rule gives the defender a 0–0 win.
  - Downgraded because it needs a public, delayed admin action, and the signer can recover.
- **Proof:** EVM, `M3`. The old-version score reverts after the change, and settlement leaves the deed with the defender.
- **Remediation:** snapshot `rulesVersion` into `Contest` at declaration, and accept scores for that version.
- **Invariant:** a contest is scored under exactly one rules version, fixed at declaration.
- **Test to add:** a version change mid-contest does not affect scores for open contests.
- **Audit owner:** external audit required.

### 2.8 M4 — toll credits are liquid and outside the liquid issuance allowance (Medium)

- **Where:** `publishSettlement` L240–245 checks only `liquidMovementClaims` against the allowance. L277–282 then funds the liquid bucket with `liquidMovementClaims + tollCredits`. `_validateAccounting` (L304–325) caps tolls at 2% of a signed `tollBase`. `MovenRunRewards.claim` (L106–140) pays liquid to any account in the tree. The architecture doc §7 says this is deliberate.
- **Prerequisites:** none beyond normal operation. The bucket exists even at zero allowance.
- **Impact:**
  - Up to 2% of each day's gross issuance becomes liquid without the revenue valve.
  - **New:** nothing on chain ties a toll leaf to a deed holder. In the proof, an account with no deed claims the toll bucket.
  - Under §21, this is the channel through which locked free-player movement turns into liquid income for others.
- **Proof:** EVM, `M4 / M5`, at zero allowance. Model: `maxLiquidPerSettlement(0, 9M) = 180k`.
- **Remediation options:**
  1. Count tolls inside the allowance.
  2. Classify tolls as locked.
  3. Keep them liquid, but commit a per-deed toll sub-root and require the leaf's account to be `ownerOf` that deed on the day.

  Choosing among these is G5-3.
- **Invariant:** liquid issuance per day ≤ the allowance consumed that day, under whichever definition the owner chooses. If tolls stay liquid, they reach only deed holders of that day.
- **Test to add:** liquid toll at zero allowance reverts (options 1 and 2), or a toll leaf for a non-holder reverts (option 3).
- **Audit owner:** external audit required.

### 2.9 M5 — the locked/liquid split of each leaf is off chain (Medium; wording corrected)

- **Where:** `MovenRunRewards.claim` (L106–140) uses the leaf's `lockedAmount` and `liquidAmount`, and checks only the day's bucket totals (L125–126).
- **Prerequisites:** a wrong or malicious tree from the settlement pipeline, with valid dual signatures over its root.
- **Impact:**
  - **Corrected:** the aggregate per bucket is bounded on chain, and the liquid bucket is bounded by the allowance plus tolls.
  - Inside the liquid bucket, the tree decides *who* receives liquid. A free player's pre-deed earnings can therefore be marked liquid without any on-chain check. That breaks §21's "everything earned before stays locked forever, enforced in the token contract" for whatever share of the bucket is misassigned.
- **Proof:** EVM, `M4 / M5`. An arbitrary account receives a liquid leaf.
- **Remediation options:**
  1. Make the token, not the leaf, decide liquidity: an on-chain "liquid-eligible" flag set only by a deed-holding event (with N1's challenge window), so that a leaf can carry an amount but not a class.
  2. Have the reconciliation signer independently recompute the per-account classification and sign the tree, not only the totals.
- **Invariant:** no account without an eligible deed on the day receives liquid movement rewards for that day.
- **Test to add:** a liquid leaf for a non-eligible account reverts.
- **Audit owner:** external audit required.

### 2.10 M6 — stale listings revive (Medium)

- **Where:** `MovenRunMarketplace.list` (L52–65) and `buy` (L80–95). The stale check at L87 compares only the current owner with `listing.seller`. Nothing clears a listing on transfer.
- **Prerequisites:** the seller keeps `setApprovalForAll(marketplace, true)`, and the deed leaves the seller and comes back. That happens through an ordinary transfer, or through contest escrow when the defender wins.
- **Impact:** the old price becomes buyable without the seller re-confirming it.
- **Proof:** EVM, `M6`. Listed at 5, sent away, the listing goes dead; sent back, the listing is live again and is bought at 5.
- **Remediation options:**
  1. Store a per-token transfer counter on the deed (incremented in `_update`), record it in the listing, and require it to match in `buy`.
  2. Give listings an expiry.
  3. Have the deed notify the marketplace to clear listings.
- **Invariant:** a listing is buyable only if the deed has not changed hands since it was listed.
- **Test to add:** the M6 proof reverses (buy reverts with `ListingStale`).
- **Audit owner:** external audit required.

### 2.11 M7 — locked rewards buy a transferable asset (Medium; economics and legal decision)

- **Where:** `MovenRunDeedClaims.claim` L192–194 calls `burnFrom`. `MovenRunToken.burnFrom` (L179–182) leads to `_burnLockedFirst` (L186–196). `MovenRunDeed` is a standard ERC-721: `_update` (L249–274) applies only the cap. Contest entry fees burn locked balance first in the same way (`MovenRunContests` L284–286).
- **Prerequisites:** any locked balance, plus a deed attestation.
- **Impact:**
  - Locked MOVE that cannot be transferred is converted into a deed that can, and the deed can then be sold off-market for anything.
  - The marketplace's "locked MOVE can never pay for a deed" covers only its own path.
  - This is a **conversion path from free-player credits to a sellable asset**. Whether it exists is not a contract-engineering question (see §3.10).
- **Proof:** EVM, `M7`. A locked-only balance pays the fee in full; the deed then moves to another wallet by `transferFrom`.
- **Remediation options:** decide G5-5 first.
  - If deeds stay transferable: require the fee from the liquid balance only, or a non-transferable period after the claim.
  - If deeds are game records: make the ERC-721 non-transferable, with only contest movement allowed.
- **Invariant:** no sequence of calls turns a locked balance into a transferable asset, unless the owner has explicitly decided such a path exists.
- **Test to add:** a locked-only claimant cannot obtain a transferable deed (under the chosen design).
- **Audit owner:** external audit required; counsel review (§5).

### 2.12 M8 — the deed token id is the public H3 cell (Medium, privacy)

- **Where:** `MovenRunDeed.mintDeed` L129 (`tokenId = uint256(h3CellId)`). `h3CellIdOf` is at L360–362. `MovenRunH3` fixes resolution 8.
- **Prerequisites:** none. The data is public by construction.
- **Impact:**
  - A deed proves at least 21 days of regular presence in a 0.74 km² cell.
  - Transfers, tolls and contests tie a public wallet to that place.
  - This is in tension with §27's "never published: regular schedule", and with the intent of rule 12.
- **Proof:** EVM, `M8 / L1`, `h3CellIdOf(tokenId) == cell`.
- **Remediation options:**
  1. Opaque token ids (a salted commitment to the cell), with the cell revealed only to the holder's client.
  2. A coarser public area.
  3. A delay before a deed is shown publicly.

  Choosing is G5-6.
- **Invariant:** no on-chain value links a wallet to a location finer than the published privacy unit.
- **Test to add:** the token id carries no H3 bits recoverable without the salt.
- **Audit owner:** external audit required; privacy review.

### 2.13 L1 — resolution 8 is hard-coded (Low)

- **Where:** `MovenRunH3.TARGET_RESOLUTION = 8` (L25), checked at L61.
- **Impact:** D5 is open, and the pilot ruleset proposes units around 201 m (resolution-9 scale), which this library would refuse.
- **Proof:** EVM, `M8 / L1`: a resolution-9 cell reverts with `InvalidH3Cell`.
- **Remediation:** settle D5 first, then make the resolution an immutable constructor value.
- **Invariant:** the deed resolution equals the published game unit.
- **Test to add:** parameterised resolution tests.
- **Audit owner:** external audit required.

### 2.14 L2 — the timelock accepts any non-zero delay (Low)

- **Where:** `MovenRunTimelock` constructor (L25–32): only `minDelay == 0` reverts (L31). `scripts/v3/deployBaseSepolia.ts` refuses only 0.
- **Impact:** every claim of "delayed administration" holds only as far as a value that no code enforces.
- **Proof:** EVM, `L2`: `minDelay = 1` deploys.
- **Remediation:** an immutable floor (for example ≥ 48 h, a G5-7 value) in the constructor and in the deploy script, plus a post-deploy check.
- **Invariant:** `getMinDelay() ≥ MIN_DELAY_FLOOR`, always (`updateDelay` is self-governed, so it needs the same floor).
- **Test to add:** construction below the floor reverts; `updateDelay` below the floor reverts.
- **Audit owner:** external audit required.

### 2.15 L3 — leaves are not summed on chain (Low)

- **Where:** `MovenRunRewards.claim` L125–126 refuses the claim that crosses the bucket total. Nothing checks the tree as a whole.
- **Impact:** with an over-committed tree, claims are first come, first served, and the last claimants revert.
- **Proof:** EVM, `L3`: 60 + 60 against a bucket of 100, and the second claim reverts.
- **Remediation:** the reconciliation signer recomputes the leaf sum. Optionally, publish a leaf count and sum as a second commitment.
- **Invariant:** the sum of leaves equals the day's bucket totals.
- **Test to add:** an off-chain tree-builder test refuses an over-committed tree.
- **Audit owner:** external audit required.

### 2.16 L4 — a city cap of 0 freezes the city (Low; impact corrected)

- **Where:** `MovenRunDeed.configureCityConcentrationCap` (L151–159) accepts any value. `_occupyHolderSlot` (L278–287) checks the *receiver*. `reserveCitySlot` (L165–181) applies the same cap.
- **Impact:**
  - **Corrected:** a cap at 0, or below current holdings, does more than block transfers into the city. No existing holder can sell or send a deed (every receiver fails the check), and no contest can be declared there.
  - It is timelocked, but it acts as a de facto freeze of user assets that no pause role is meant to have.
- **Proof:** EVM, `L4`: a transfer reverts and a declaration reverts.
- **Remediation:** forbid lowering a cap below 1 (or below the configured floor). Or apply a lowered cap only to new acquisitions, never in a way that blocks a holder from leaving.
- **Invariant:** a holder can always transfer a deed to a receiver with spare capacity, and some cap value always leaves capacity.
- **Test to add:** lowering the cap never blocks a transfer to a fresh wallet.
- **Audit owner:** external audit required.

### 2.17 L5 — authorization expiry has no upper bound (Low)

- **Where:**
  - `MovenRunSettlement` L205
  - `MovenRunDeedClaims` L153
  - `MovenRunContests` L238 and L345

  Each checks only `block.timestamp > expiry`.
- **Impact:** long-lived signatures are prevented only by off-chain discipline. Combined with a key leak, old authorizations stay usable until their nonce is consumed.
- **Proof:** EVM, `L5`: a settlement authorization valid until 2100 is accepted.
- **Remediation:** on chain, `expiry ≤ block.timestamp + MAX_AUTH_TTL` (minutes to hours). An optional `notBefore`.
- **Invariant:** no authorization is accepted more than `MAX_AUTH_TTL` before its expiry.
- **Test to add:** a far-future expiry reverts.
- **Audit owner:** external audit required.

### 2.18 What holds up (checked, no finding)

- **No proxy.** The 1B lifetime cap is a constant. Burns never reduce `cumulativeMinted` (`settlementIssue` L119–135).
- **Settlement signers must differ** (constructor L180; rotation L446–459). Bootstrap is finalized once.
- **Claims and settlement of user value are never paused:**
  - `MovenRunRewards` has no pause and no admin
  - the marketplace has no pause
  - contests in flight always settle (L412)

  Pauses block only new publications, new claims and new declarations.
- **The deploy script refuses every chain except Base Sepolia.**

### 2.19 Reentrancy, replay, chain id, nonces (checked)

- **Reentrancy:**
  - `DeedClaims.claim`, `Contests.declareContest`/`settleContest` and `Marketplace.buy` are `nonReentrant`.
  - State is written before external calls: nonce used before the fee burn and mint; listing deleted before payment.
  - `_safeMint` and `safeTransferFrom` call back to the receiver only after the effects.
  - `Rewards.claim` has no guard, but it sets the bitmap before the transfers, and MOVE is a hook-less ERC-20.
- **Replay:**
  - Every authorization uses an EIP-712 domain with the chain id and the verifying contract. OpenZeppelin rebuilds the separator on a fork.
  - Nonces are single use, with one namespace per contract. Contests share the namespace between declarations and scores, which is safe because the signer chooses the nonces.
  - Reward leaves include `block.chainid` and the rewards address, and they are double-hashed.
- **Signature form:** OpenZeppelin ECDSA rejects high-s and malformed signatures.
- **Signer rotation:** this immediately invalidates the old key's unused authorizations, because recovery must equal the current signer. No revocation list is needed.

## 3. Safeguard design for any future Deed path

This section sets requirements for any future design. It decides nothing, and it does not presume that deeds will exist (G5-5). Every layer assumes the others can fail.

### 3.1 Independent distinct visitors

- "Distinct" must mean distinct *people* under the risk graph, not distinct accounts. Count only visitors who pass device integrity and who are outside the claimant's cluster (§3.2).
- Count only **independently verified movement**: sessions whose evidence passed the sealing and route-evidence checks on their own, not crossings inferred from the claimant's own sessions.
- Require a spread of visitors over time and over approach routes, so that a handful of repeated loops cannot satisfy it.
- The research doc's finding 1 must be settled first (G5-1). The rule must not make honest deeds impossible while coordinated rings can still meet it.

### 3.2 Related-wallet and route-cluster signals

- **Inputs:**
  - shared devices, payment instruments and funding sources
  - wallets created or funded together
  - shared session start areas and times
  - co-movement (the same route shape at the same time)
  - mutual crossing graphs
  - mutual deed and toll flows
  - marketplace counterparties
- **Clusters, not accounts:** the research doc's Sybil tables show that independent per-account detection only *enlarges* a ring. The gate must act on clusters:
  - no cluster above the §12 20% share of a unit's counted traffic
  - no cluster above the per-city share of deeds
  - flagged clusters' traffic counted as zero, not discounted
- **Commitments:** publish a hash of the cluster evidence with each attestation, so a later audit can check it without the chain storing personal data.

### 3.3 Signer key management

- **Two independent signers for every value-creating input:** settlement, deed eligibility and contest scores. "Independent" means different code paths, a different operator role, different hosts and different key custody. A reconciliation job that signs whatever it is handed counts as one signer.
- **Custody:** keys in an HSM or KMS, never in environment files. Signing services expose "verify and sign", not "sign arbitrary".
- **Per-purpose keys:** scoped per contract and per type, with no reuse across settlement, claims and contests.
- **Operations:** a documented rotation drill and an emergency rotation path through the timelock (with the delay still applying), with compromise playbooks as `KEY_ROTATION.md` sets out.
- **Rate-limited signing on both sides:**
  - the signing service refuses more than N attestations per city per day
  - the contract enforces the same limits (§3.6)

### 3.4 Challenge window

- A deed starts as **pending**: it cannot be transferred, earns no toll and cannot be contested, for a fixed window (for example 7–14 days, HYPOTHESIS).
- During the window, a second key, or a governed process, can void it with a reason code. After the window, the deed is final.
- The same pattern applies to contest outcomes: settlement only after a short dispute window in which a second key may void a score day.
- The window must not delay rewards that have already been earned (§3.8).

### 3.5 Expiry and nonces

- On-chain `expiry ≤ now + MAX_AUTH_TTL` (L5), plus `notBefore`.
- Nonces per signer, single use, as today. Optionally, sequential per-claimant nonces, so that an older attestation is void once a newer one is issued.
- Authorizations bound to the defender and holder (H2b) and to the contest's rules version (M3).

### 3.6 Per-city cap and rate limits

- **A city-wide cap** (a published share of the city's deedable units, D6), in addition to the per-holder cap.
- **City bound to cell on chain** (H3 remediation 2).
- **Mint rate limit:** at most N new deeds per city per day, and at most M per cluster per season, enforced by the contract.
- **The cap can only bind new acquisitions.** It must never block a holder from leaving (L4).

### 3.7 Governance separation

- **Distinct roles:**
  - *Guardian* can only pause new issuance and new claims.
  - *Timelock* changes parameters, with a floor delay (L2).
  - *Signers* attest.
  - *Auditors / reconciliation* verify.

  No address holds two of these roles. The deploy script and a post-deploy check enforce it.
- **Bounds:** parameters that bear on value (thresholds, caps, allowance) change only through the timelock, and within published bounds that are compiled in.
- **Independent oversight:** a published operator and signer roster, and change logs for every signer rotation and parameter change.

### 3.8 Pausability that does not trap valid withdrawals

- **Pause new things only:** new settlements, new claims and new declarations.
- **Never pause:**
  - claims of rewards already finalized
  - settlement of contests already in escrow
  - transfers out of a city by existing holders
- Keep the prototype's good property that `MovenRunRewards` has no pause and no admin. Remove the L4 freeze.
- **Unpausing** goes through the timelock. Pausing is immediate.

### 3.9 Reentrancy, replay and chain id

- Keep `nonReentrant` on every external entry point that moves assets, and checks-effects-interactions ordering throughout.
- Keep EIP-712 domains with the chain id and the verifying contract, and include the chain id in Merkle leaves.
- Give every new contract its own domain name and version, and never reuse a type hash across contracts.

### 3.10 Free-player credits never silently become sellable

- **Today, free-player movement earns off-chain game credits** (`holdingSettlement.ts`). They are not transferable and have no token.
- **Any path that turns those credits, or the locked MOVE they might later map to, into something sellable is a separate economics and legal decision.** That includes paying a deed fee with locked balance (M7), liquid tolls received by deed holders (M4), misclassified leaves (M5), and transferable deeds (G5-5). The decision belongs to the owner and counsel. It must not arrive as a side effect of a parameter change, a contract upgrade, a fee curve or a marketplace feature.
- **Engineering consequence:** any such path must be explicit in code (a named function with its own role and timelock), off by default, and covered by a test that fails if locked value can reach a transferable asset some other way.
- **No cheaper remedy:** a cheaper deed price, a lower claim fee, a shorter tenure or looser traffic eligibility does **not** remedy any finding here. Each one lowers the cost of a mutual deed ring or a wash-trading loop (the research doc's §7 Sybil tables), and so worsens the exposure it seems to ease. Eligibility can be recalibrated only together with cluster-level detection (§3.2), never instead of it.

## 4. Owner decision matrix (G5-1 … G5-12)

Status for every row: **not yet decided**. The rankings are research readings that help with sequencing. They are not recommendations to decide one way.

- **Irreversibility:**
  - 5 = it cannot be undone once anything ships on chain
  - 1 = it is a parameter that can change freely
- **Sybil exposure:** how much the wrong choice enlarges the ring, wash or toll channels.
  - 5 = it enlarges them most

| Id | Question | Options | Recommended research direction | Irreversibility | Sybil exposure | Status |
|---|---|---|---|---|---|---|
| G5-1 | How deed traffic is counted, given that a crossing pushes undefended ground | (a) a candidacy period in which crossings count but do not flip; (b) count only refused or defended crossings; (c) count neighbour traffic; (d) recalibrate 30 / 10 | Simulate (a)–(c) **with cluster detection on** and measure honest deeds against ring deeds. Never loosen without detection | 3 | 5 | not yet decided |
| G5-2 | Keep §21's "liquid after first deed", or make the legal fallback (all locked, staking only) the research default | keep §21; fallback default; defer | Make the fallback the research default until G5-11 and cluster detection exist. Finding 3 (liquid Gini 0.99) and the ring break-even argue for it | 4 | 5 | not yet decided |
| G5-3 | Tolls received: liquid, locked, or inside the valve | liquid (§21); locked; inside the allowance; liquid only to the day's verified holders | Model all three against the toll channel. If tolls stay liquid, require on-chain holder binding (M4 option 3) | 3 | 4 | not yet decided |
| G5-4 | Per-city cap: city-wide share or per-holder count, and its value (D6) | city-wide; per-holder; both | Both, with the city bound to the cell on chain. Measure the cluster share at the chosen value | 3 | 4 | not yet decided |
| G5-5 | Is a deed a transferable token, or a non-transferable game record that collects tolls | transferable ERC-721; non-transferable (soulbound) with contest movement only; transferable after a long lock | Research non-transferable first. Transferability is the root of M7 and of wash trading, and it is hard to withdraw once holders exist | **5** | 5 | not yet decided |
| G5-6 | Deed privacy: public cell, opaque id or coarser area | public H3; salted commitment; coarser parent; delayed publication | Opaque id or a coarser area. A public cell id cannot be recalled once minted | **5** | 2 | not yet decided |
| G5-7 | Contract trust model before any testnet rework | two signers everywhere; time-bound days with a per-publication cap; timelock floor; challenge window; expiry ceiling | Adopt as the research baseline. Write the invariants in §2 as tests before any contract work | 4 | 4 | not yet decided |
| G5-8 | Size of the §22 season-end burn and any target burn-to-mint ratio | none; a fixed share; a target ratio | Simulate with the trace. Note that a burn never frees issuance room | 2 | 1 | not yet decided |
| G5-9 | Plan for the 600M outside the player allocation | stays unissued (stated publicly); a published schedule | A public statement in either case. An unstated reserve is a treasury and regulatory question | 4 | 1 | not yet decided |
| G5-10 | Recalibrate the session minimum and effort floor before deed or liquidity work | recalibrate; keep | Recalibrate first. Route farmers top both credits and deeds | 2 | 4 | not yet decided |
| G5-11 | Scope and markets of the legal review required before liquid design | per market; per feature; both | Per market and per feature, using §5's questions, before any liquid or transferable design proceeds | 3 | 2 | not yet decided |
| G5-12 | Research capped or vested conversion further, or rule it out as breaking rule 11 | research; rule out | Owner call on rule 11 first. If researched, model the cap as a per-cluster bound, not per account | 4 | 3 | not yet decided |

**Top three by irreversibility:**

1. **G5-5, deed transferability.** Once transferable deeds exist and trade, making them non-transferable takes value from holders.
2. **G5-6, deed privacy.** A public cell id on a public chain cannot be unpublished.
3. **G5-2, §21 liquidity** (tied with G5-7, G5-9 and G5-12). Once liquid balances exist, they cannot be re-locked.

G5-7 matters as much in practice: contracts deployed without it cannot have it added without a migration.

## 5. Regulatory-disclosure model: questions for counsel

The following are questions only. This document draws no legal conclusion. The source already requires sign-off in each market before liquid earnings ship (§21, §32).

**Tokens ($MOVE)**

1. In each target market, does a token that is earned by movement, partly locked and partly liquid, fall under securities, commodities, e-money, payment-instrument or virtual-asset rules? Does the answer change between "all locked" (fallback), "liquid after first deed" (§21) and any capped conversion?
2. Does the revenue valve, where issuance capacity is tied to company revenue, create an expectation of profit from the company's efforts?
3. Do embedded wallets and the paymaster make the operator a custodian, money transmitter or virtual-asset service provider?
4. What disclosures (supply, schedule, the unissued 600M, burn rules, admin powers, signer trust) must be published, where, and before which milestone?
5. How is earning, burning, claiming and receiving tolls taxed and reported for users, and what does the operator have to report?

**Collectibles (Deeds, gear, cosmetics)**

1. Is a transferable deed that collects income from other people's movement treated differently from a non-transferable game record that does the same? What about a collectible with no income at all?
2. Does a marketplace with no fee, settled in a token, bring obligations as a trading venue, broker or marketplace?
3. Do app-store policies on tokenised digital assets and in-app purchases constrain which of these may ship on Android and iOS, and in which markets?
4. What age limits, consumer-protection rules (refunds, cooling-off) and unfair-terms rules apply to burned fees and to irreversible deed loss in contests?

**Sponsor revenue**

1. If sponsor revenue feeds the revenue valve or sponsor prizes are paid as liquid tokens, does that change how the token or the prizes are classified?
2. What advertising-disclosure and data-protection rules govern sponsor analytics (aggregated and thresholded under §27), and what consent model do they require?
3. Do sponsored challenges count as promotions under local rules (registration, terms, winner verification)?

**Contests**

1. Are contests with a burned entry fee and a transferable prize (a deed) prize competitions, games of skill, or gambling, in each market? Does the answer change if the fee is paid from locked balance, from liquid balance, or not at all?
2. Does the home advantage or fortification change the skill-or-chance analysis?
3. What dispute, appeal and record-keeping duties apply when an operator-signed score decides who receives an asset?
4. Do anti-fraud measures (the risk graph, cluster exclusion) trigger automated-decision or profiling rules, and what notice and appeal must users get?

## 6. Limits

- This is a ledger for audit scope, not an audit. Passing proofs show that the listed behaviour exists. They show nothing about behaviour not tested.
- The proofs compile with solcjs 0.8.26 instead of the pinned 0.8.24, using the branch's own fixture. No behavioural difference between the two is expected for this code, but an audit must use the pinned compiler.
- Remediation options are directions, not designs. None was implemented or tested against the contracts.
