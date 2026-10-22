# On-chain and Deed risk register (research, Track B9)

Status: research input for the owner and for an independent auditor. It is not an audit, not legal advice, and not a decision.

**Read this first.**

- This is not a Play V1 dependency. Play V1 does not need any contract, token, Deed or chain.
- Nothing is deployed to mainnet. No token is live or saleable.
- Any Base Sepolia contract inventory in earlier reports (eight V1 contracts in `contracts/deployments/baseSepolia.json` at the base commit, nine V3-suite contracts in other reports) is a **reported prototype inventory**. It has not been reconciled onchain by us, and no address in it is treated as a production right. We called no RPC.
- Rule 1001 is the default ruleset. 1002 and every Deed or liquid design here are unratified proposals.

Evidence tiers used below: SOURCE (V3 text), VERIFIED CODE (we read the Solidity and/or a test we ran proves it), SYNTHETIC EXPERIMENT (our model, seeded), PILOT ASSUMPTION, OWNER DECISION, HOSTED PROOF (none exists).

## 1. What was run, and what it can and cannot show

Commands (all from the `movenrun` directory, offline, in-process Hardhat network only, chain id 31337, no accounts, no URLs, no `.env` read, no RPC variable set; `reverify.sh` refuses to start if one is set, and a test asserts the config has no `url`/`accounts`):

| Run | Command | Result |
|---|---|---|
| Offline model and static checks | `node --import tsx --test 'research/economy-redteam/contracts/**/*.test.ts'` | 45 pass, 0 fail |
| Prototype commit c8262ec, issue proofs | `MODE=original bash research/economy-redteam/contracts/reverify.sh` | 43 passing (each reported issue reproduces) |
| Same commit with the draft patches, own suite + regression proofs | `MODE=patched BRANCH_SUITE=1 bash .../reverify.sh` | 46 passing, 76 failing (29 branch + 17 regression pass; the 76 are the old-suite failures, section 5) |
| Patched, clock shim | `MODE=patched BRANCH_SUITE=1 TIME_SHIM=1 bash .../reverify.sh` | 31 of the 76 now pass |
| Patched, clock shim plus claim-ABI port | `... TIME_SHIM=1 PORT_SHIM=1 ...` | 50 of the 76 pass, 26 remain (classified in section 5) |

- The compiler is the solcjs 0.8.26 build already in `node_modules`; nothing was downloaded. The contracts pin 0.8.24, so the **auditor must use the pinned compiler**. We expect no behavioural difference, but we did not prove it.
- Inputs are vendored read-only copies with SHA-256 sums: `contracts/vendored-122/` (draft patched Solidity, patches, the three proof files, Hardhat config) and `contracts/vendored-c8262ec/` (the nine unpatched V3 contracts). A test fails if any byte changes. The original contracts and the contract-proof line were not modified.
- Logs of the three EVM runs are in `contracts/out/`.
- The V1 contracts of this checkout (`contracts/src/*.sol`, eight contracts) were read statically. The base commit has no V3 Solidity; V3 sources come only from the pinned commit c8262ec.
- What this does not show: behaviour of the real signing services, key custody, the risk-graph job, deployed bytecode, onchain state, gas, or any property not listed. **HOSTED PROOF: none.**

Two corrections to the brief's wording, for the record. "Nine contracts on Base Sepolia" cannot be confirmed here: the checked-in manifest lists eight V1 contracts (deployer address and timestamp 2026-05-27 are in it), and the V3 manifest in the pinned commit is only an example file. The nine are the V3 suite (Token, Settlement, Rewards, Deed, DeedClaims, Contests, Marketplace, Registry, Timelock). Which, if any, are on chain is **unreconciled**.

## 2. Status of the previously reported findings (re-verified)

| Id | Reported severity | Prototype c8262ec | Draft patch (unaudited) | Our verdict |
|---|---|---|---|---|
| H1 settlement day not bound to time | High | Reproduces (day 90 straight after day 1 mints the season; 180 publications exhaust 400M with no time passing). VERIFIED CODE + EVM | Fixed for rate: clock-bound days, 2x per-publication ceiling, 7-day authorization lifetime, forfeiture event. Regression passes. Our model agrees | **Fixed in draft, not audited.** Residuals R-01 |
| H2 one contest signer decides all scores | High | Reproduces (seven one-sided scores move the deed) | Single-sided scoring disabled; both sides of a day posted under two distinct keys; days bound to the calendar; daily score ceiling; fail-closed until a co-signer is set | **Fixed for scoring in draft.** Declaration is still single-signed (H2b) and rules version is not snapshotted per contest (M3). Residuals R-04 |
| H2b declaration does not bind defender | Low | Reproduces | Not fixed | **Open** |
| H3 / M1 one eligibility signer; cap per wallet and per signer-chosen city label | High | Reproduces (three wallets, or one wallet with two labels) | Threshold attestation (floor 2), city derived from cell via Merkle root, per-cluster cap, city-wide cap, daily claim limit, lifetime ceiling | **Fixed in structure in draft.** `clusterId` is still attested off chain, so cluster quality is not fixed. Residuals R-05, R-06 |
| N1 deeds cannot be revoked | Medium | Reproduces (no burn/revoke; cell squatted forever) | 7-day pending window, void by a voider role, no admin revoke after the window, holder `relinquish` | **Fixed in draft.** New privileged role and N1/M6 interaction. Residuals R-07 |
| M4 tolls liquid outside the allowance | Medium | Reproduces | Not fixed | **Open** (R-03) |
| M7 locked balance buys a transferable deed | Medium | Reproduces | Not fixed | **Open** (R-09) |
| M8 token id is the public H3 cell | Medium | Reproduces | Not fixed (`tokenId = uint256(h3CellId)` still) | **Open** (R-10) |

A static test (`static-solidity.test.ts`) pins each of these statements to the Solidity text, so a later edit that changes the answer fails the suite.

## 3. Prioritised register

Priority order is by irreversibility times exposure, not by who finds it easiest. Every NO-GO condition below blocks the stated stage; all of them block any real-value step. "Local test status" says what we ran. Every row's independent audit need is **external audit required** unless it says otherwise, and every row is **unaudited**.

### P0: cannot be undone, or breaks a source rule

**R-01 Emission valve exposure (400M player allocation, H1 and the revenue valve)**
- Threat actor: holder of both settlement keys, a shared pipeline feeding both, or an honest bug emitting a far-future day id.
- Precondition (prototype): two valid signatures for one authorization. The allowance (valve) is raised by a timelocked action with no link to revenue and it never expires (valve proofs V1, V2).
- Source deviation: V3 §17 (one tap, fixed pool), rule 2 and rule 7 (rewards settle once a day among people who moved), §21 (liquid issuance capped at what the business earned).
- Impact: lifetime allocation consumed with no time passing; skipped days lost; locked balances inflated (which pay for deeds, see R-09).
- Design remediation: clock-bound day ids with a settlement lag; per-publication ceiling; explicit rule for late days; a real revenue valve (attested per-period revenue by two signers, allowance per period equals a published share, expires at period end, compiled per-period ceiling); the valve stays shut by default.
- Independent audit need: yes, invariant fuzzing (issued <= nominal x closed days) and a review of the off-chain two-signer independence.
- Test approach: model (done), EVM regression (done), property test over timestamps (to do).
- Local test status: prototype reproduces (EVM, 3 tests). Draft patch holds (EVM, 4 tests). Model: 400M in about 180 publications at time zero without the binding; refused with it; with the binding and 2x ceiling the worst ratio of issued to nominal-times-days is at most 1.0 for greedy skip-then-publish strategies and the ceiling keeps one publication to at most 2/90 of a season (SYNTHETIC EXPERIMENT, seeds in `seeds.json`).
- Residual risk after the patch: an attacker with both keys cannot accelerate emission, but can still misallocate it (publish the latest closed day only and forfeit earlier days; direct the locked balances anywhere in the Merkle root). The valve itself is not fixed: no revenue link, no expiry.
- NO-GO: any mint path that is not clock-bound and per-publication bounded; any valve that is not period-expiring and revenue-attested; any raise of the allowance above zero before the economic and legal reviews in section 6.

**R-02 Single signer and oracle concentration; no independent key custody**
- Threat actor: compromise or coercion of one eligibility key, one contest key, or one pipeline that feeds "two" signers.
- Precondition: prototype claims and score submissions take one signature. In V1 one `oracleOperator` signs every route and one admin controls the contracts. The V3 source itself says the V1 set is controlled by one key with no timelock.
- Source deviation: V3 §29/§31 statements that privileged actions are role-gated and timelocked; "oracle can sign, can never move anyone's money" (glossary).
- Design remediation: threshold attestations everywhere (floor 2, distinct code paths, hosts, operators and custodians); role separation (guardian can only pause new things; timelock changes parameters; signers attest; reconciliation verifies); signer roster and rotation log published; draft patch gives threshold 2 for claims and 2 keys for scores.
- Independent audit need: on-chain scope plus the off-chain signing scope, which is the real trust boundary.
- Test approach: static (done), EVM (done in patch regressions), key-compromise drills (operational, none run).
- Local test status: static assertions pass; the model shows one compromised key defeats a one-signer path and not a two-of-two path, and that a shared pipeline defeats two-of-two (SYNTHETIC).
- Residual risk: two keys from one pipeline are one key. Declarations remain single-signed. Settlement already uses two keys but the contracts cannot see whether they are independent.
- NO-GO: any value-bearing path whose authorization comes from fewer than two demonstrably independent signers; any signer that is an operator-held hot key.

**R-03 Liquid toll leakage while issuance is off (M4)**
- Threat actor: any account named in the Merkle tree; a mis-built tree; a deed holder; an operator relying on "all locked" as a legal fallback.
- Precondition: none. At zero allowance the toll bucket still pays 2% of the signed toll base as liquid, and nothing onchain ties a toll leaf to a deed holder.
- Source deviation: V3 §21 (liquid is a state of an already capped issuance, valve is the ceiling), rule 11 (free players' rewards never sellable), §21 fallback ("one line of configuration").
- Impact: the all-locked fallback cannot be set by configuration (valve proof V3). Upper bound: 2% of 400M = 8M MOVE-equivalent over the full allocation (SYNTHETIC arithmetic, exact in the model).
- Design remediation: tolls counted inside the allowance, or locked, or liquid only to the day's verified holders with an onchain holder binding; an explicit onchain switch for the legal fallback (own timelock, own test).
- Local test status: EVM reproduces in both builds (prototype and draft patch); model confirms 2% of gross; static test pins the unchanged lines.
- Residual risk: owner decision (G5-3) not made.
- NO-GO: any build where a non-zero liquid amount can be created while the valve is shut and the fallback is selected.

**R-04 Contest scoring abuse (H2, H2b, M2, M3)**
- Threat actor: contest signer; a club that can influence the score pipeline; a defender or challenger gaming timing.
- Precondition: score authorizations are signer-chosen numbers. Onchain bounds are only `uint128` (prototype) or a daily ceiling (patch). Nothing onchain checks that a score equals verified movement.
- Source deviation: V3 §13/§14 (score is verified movement plus capped club support plus a fixed bonus, "nothing else is in the formula"; one club support budget per person with diminishing returns).
- Club boost: the contracts contain no club term at all. Capped, diminishing club support exists only in the signer's off-chain policy, so a boost abuse is an off-chain scoring failure that the chain would faithfully record.
- Design remediation: both sides posted together, two keys, calendar-bound days, daily ceiling (draft); add a score ceiling derived from the settled movement record; snapshot the rules version per contest; bind the defender and fortification in the declaration; per-deed cooldown plus a risk-graph lockout off chain; publish the score formula inputs (aggregated) per contest.
- Test approach: EVM (done for the patch), plus an off-chain simulation against solo, small-club and large-club attackers (V3 requires it; cross-reference Track B7).
- Local test status: draft patch regressions pass; old-suite scoring tests (13) fail by design because single-sided scoring was removed.
- Residual risk: a signer pair that is colluding or fed the same wrong data still decides who gets a deed. The tie rule favours the defender.
- NO-GO: contests that move an asset of value where scores are not derivable from independently settled movement.

### P1: serious, fixable by design

**R-05 Deed Sybil rings (H3, M1 follow-up)**
- Threat actor: one operator running k linked accounts that cross each other's cells.
- Precondition: the off-chain gate (21 days tenure, 30 distinct crossers over 10 days, concentration limit, own traffic excluded) is satisfiable by coordinated rings and not by honest play in the churn study (another track's finding: honest play reached 0 deeds in every simulated context; a coordinated ring needs distinct crossers + 1 = 31 accounts). Loosening makes it worse: at 7/5/3 a ring of six takes six deeds.
- Source deviation: V3 §12 (no cluster above 20% of a unit's crossers) exists on chain only as a signed boolean.
- Design remediation: threshold signers, per-cluster and city-wide caps, daily claim limit, challenge window, non-transferable first release (G5-5) so the cluster cap counts holdings; cluster detection measured on real pilot data before any loosening.
- Local test status: draft regressions pass (3-wallet ring under one cluster id gets 1 deed). The contract line's own ring simulation (not rerun here) reports, with detection d = 0 and k = 31, 25 deeds with the patch; with d = 0.3 and k = 60, 2.4 instead of 20.8.
- Residual risk: the cap is only as good as the detection rate; with partial detection the 20% rule can admit more ring cells. Cluster cap counts claims, so transferability lets a ring regroup after the window.
- NO-GO: any Deed path before cluster detection has a measured precision and recall on real movement data (gate 3 in section 6), and before transferability is decided.

**R-06 City binding, caps and the freeze (L4, L1)**
- Threat actor: signer labelling; a timelock action setting a cap below current holdings.
- Prototype: `cityId` is whatever the attestation says; a cap of 0 freezes every transfer and contest in the city.
- Remediation: city derived from cell by committed Merkle root (draft); caps bind only new acquisitions; resolution as an immutable constructor value once D5 is decided.
- Local test status: patch regressions pass for city binding; L4 not patched (static note only).
- Residual risk: the region root itself is a signer-committed artifact.
- NO-GO: a cap change that can block a holder from leaving.

**R-07 Wrong deed is permanent (N1) and the voider role**
- Remediation in draft: pending window of 7 days (no transfer, no sale, no contest escrow, no toll); void by a voider role during the window only; no revoke afterwards (seizure risk); holder may relinquish.
- Residual: the voider is a censorship lever for 7 days and needs its own custody, public log and appeal path. A voided and reclaimed cell can revive a stale marketplace listing (M6) unless M6 is fixed together.
- Local test status: draft regressions pass.
- NO-GO: any deed that can be sold or earn before its window closes, or any post-window administrative revoke without a published governed procedure.

**R-08 Missing or weak timelock (L2)**
- Prototype: the constructor refuses only a zero delay; `updateDelay` is self-governed with no floor; a 1-second delay deploys (EVM, L2). The V1 set has no timelock contract at all (static).
- Remediation: immutable floor (the contract line suggests at least 48 h, an owner value) in constructor, `updateDelay` and deploy script, plus a post-deploy role check; no address holds two roles; bounds compiled in for value parameters.
- Local test status: static pin of the unfixed constructor; EVM L2 reproduces.
- NO-GO: a timelock with no enforced floor, or any value-bearing admin action outside it.

**R-09 Locked rewards buy a transferable asset (M7) and wash trading**
- Threat actor: any farmer with locked balance; a ring recycling deeds.
- Source deviation: rule 11 (free players' rewards never become sellable), §21.
- Precondition: claim fee burns locked balance first, and the deed is a plain ERC-721.
- Remediation: owner decision G5-5. Non-transferable for any first release, or fee from liquid only plus a non-transferable period.
- Local test status: EVM reproduces; static pin.
- NO-GO: any transferable asset purchasable with locked balance unless the owner and counsel have explicitly decided so in writing.

**R-10 Holder privacy: location on chain (M8; V3 rule 12, §26/§27)**
- Threat actor: any chain observer, sponsors, data brokers.
- Precondition: the deed id is the resolution-8 H3 cell (about 0.74 km2). A deed proves 21+ days of regular presence there, tied to a public wallet, with public transfers, tolls and contests.
- Positive finding (VERIFIED CODE): no contract stores or accepts raw route data, GPS or cell lists; the only location datum is the deed cell.
- Remediation: opaque salted token id, or a coarser public area (the patch already uses a resolution-5 region only for city binding), or delayed publication; events must not carry holder-location pairs finer than the published privacy unit; data protection impact assessment.
- Local test status: static pin that the id is still the cell in both builds. It cannot be recalled once minted.
- NO-GO: minting any deed whose public id reveals a cell finer than the owner-approved privacy unit.

### P2: boundaries and hygiene

**R-11 Approvals and allowances**
- Facts (VERIFIED CODE, static and branch tests): locked balance cannot move even through an approved spender; `burnFrom` needs FEE_BURNER_ROLE and consumes the holder's allowance first; the role is granted once at construction and administered by the timelock; the token supports permit (approvals by signature).
- Risks: an unlimited approval to a fee sink lets the sink burn up to that amount; a later timelocked grant of the role to a new contract is a new spender; the marketplace needs a standing `setApprovalForAll` (M6).
- Remediation: exact-amount approvals in client flows; expiring permits; any new burner role grant is a published timelocked action; marketplace listings bound to a transfer counter.
- Audit need: yes. NO-GO: wallet flows that request unlimited approvals without a clear spender and amount display.

**R-12 Delayed day-close commitments**
- Prototype: a day can be published at any later time; nothing bounds the lag. The patch allows publication at or after the close, forfeits skipped days permanently, and still has no maximum lag or late-day window.
- Risks: a stale or delayed pipeline loses honest players' days; a malicious publication of the newest closed day forfeits all earlier days; claims depend on a root that appears late.
- Remediation: a published settlement lag with an explicit late-day window, a rule for who may publish a missed day, and monitoring that alarms before forfeiture.
- Local test status: model shows `DayNotAdvancing` after a later day; EVM covers forfeiture event. No late-day test exists.
- NO-GO: a launch where a missed publication can silently destroy earned rewards.

**R-13 Replay across seasons, chains and contracts**
- Facts: V3 contracts use EIP-712 domains (name, version, chain id, verifying contract); reward leaves hash `block.chainid` and the rewards address; nonces are single-use; the registry checks chain id (VERIFIED CODE, static; the prior ledger found no replay issue). V1 oracle payloads include `block.chainid`; V1 `greatBurn` has no nonce and no per-season finalized flag, so the same signed payload can be executed again (documented defect 9, static pin).
- Residuals: the draft patch changes type hashes but keeps domain version "3"; it must bump before any release. Contest declarations and scores share one nonce namespace. Rules version is global, not per contest (M3).
- Local test status: model shows digests differ across chain, contract and version, and that the V1 payload has no freshness field.
- NO-GO: a release that reuses a domain version after a type hash change.

**R-14 Mint, burn and cap invariants (V3 §22, rule 2)**
- V3 token: lifetime cap is a constant, checked against cumulative minted, which no path decrements; burn is a real `_burn`; only the settlement contract mints (VERIFIED CODE, static, plus branch tests for the cap, burn and locked-first behaviour).
- V1: `SeasonController.greatBurn` is a transfer to the DAO treasury and calls itself a burn; `MoveToken` checks the cap against `totalSupply()`, so burns reopen issuance (discrepancy 8 and a new observation here: model shows total ever minted exceeding 1B after burns; the V3 cap design avoids it).
- Remediation: V3 design is correct on these points; V1 cannot be patched in place (immutable) and is outside Play V1.
- NO-GO: any build where a "burn" is not a supply-reducing burn, or where burns free issuance room.

**R-15 Asset loss on incompatible upgrade**
- Facts: no proxy, delegatecall, selfdestruct or upgrade function exists in V3 or V1 (static). A new version is a new deployment; core wiring is one-time. No contract has a migration or export path for deeds or balances (static).
- Risks: a successor suite cannot read or honour old deeds, locked balances or unclaimed reward days; pausing the old suite must not trap claims (the prototype does this well: rewards claims have no pause and no admin).
- Remediation: versioned registry with code hashes, per-version audit, an explicit opt-in audited migration contract if ever needed, a published sunset in which claims and exits keep working, and no snapshot-and-forget.
- NO-GO: deploying a successor with value-bearing holders and no tested migration or exit path.

**R-16 Other prototype rows still open (for completeness):** M5 (locked/liquid split of each leaf is off chain), M6 (stale listing revival), L3 (leaves not summed on chain), L5 (expiry ceiling, fixed in the settlement draft only; claim and contest drafts keep their own checks, see ledger). They are carried forward from the contract-proof line's ledger unchanged; we did not re-derive them.

## 4. What the local tests are

| File | Purpose |
|---|---|
| `contracts/static-solidity.test.ts` | 29 tests over Solidity text: burn is `_burn`, cap uses cumulative minted, V1 defects documented, signer counts, timelock floor, upgrade and migration absence, domain versions, privacy of the deed id. Tests that document a defect are named "documents defect" and assert that the defect is present. |
| `contracts/invariant-model.test.ts`, `model.ts`, `seeds.json` | 13 tests: emission and valve model, cap models, replay digests, quorum model, determinism. SYNTHETIC. |
| `contracts/harness-offline.test.ts` | Asserts the scripts contain no network client, no env read, no download step, and that the Hardhat config has no url or accounts. |
| `contracts/reverify.sh`, `port-shim.py` | EVM re-verification and the harness experiments in section 5. Offline only; they need the repo's installed `node_modules`. |
| `contracts/out/` | Run logs and `old-suite-classification.json`. |

## 5. The "76 old-suite tests failing on the patched line"

Where reported: the contract-proof line's issue ledger, section 7 ("What the patches do not fix, or introduce"): the branch's own `test/v3` suite with the patches applied runs 29 passing and 76 failing; "75 of the 76 revert with `DayNotYetClosed` because the fixtures publish day 1 at deploy time, and the rest use the single-signer ABIs. Porting that suite ... is a follow-up task, not done here."

We reproduced exactly 29/76 and then separated causes by experiment (details in `contracts/out/old-suite-classification.json`):

| Class | Count | What it means |
|---|---|---|
| Harness assumption, cleared by advancing the chain clock past the day-close before building a settlement | 31 (28 settlement/rewards tests plus 3 that never touch claims) | The fixture publishes day 1 at deploy. The intended contract change is real (days are time-bound) but these assertions still hold once the harness respects it. This also unmasked 11 tests whose expected error was hidden behind `DayNotYetClosed`; all 11 then pass. |
| Harness assumption, cleared by porting the claim fixture to threshold attestations, a second signer, a region root and city-wide caps, and waiting out the pending window | 19 | The contract ABI changed (conceptual) but the assertions survive a faithful port. |
| Conceptual contract change: scoring | 14 (13 use `submitScore`, now disabled; 1 hits the one-day grace before settlement) | Scores are posted for both sides of a day under two keys. The old tests describe a different design. They need rewriting, not shimming. |
| Conceptual contract change: new cluster cap | 9 | A holder claiming a second deed is now stopped by the per-cluster cap (default 1) before the per-holder cap. A fixture that raises the cluster cap through the timelock would show whether the per-holder assertions still hold; we did not do this. |
| Conceptual: old single-signer claim ABI | 2 | Tests call the disabled `claim`. They must be rewritten to the threshold path. |
| Harness defect in our own shim | 1 | The shim built a region proof for a wrong-resolution cell. Not a contract issue. |

Honest limits: the clock shim is crude (it can mask timing assertions), the claim shim skips the pending window (the regression proofs cover that), and two regression proofs fail under the shims by construction. **What is needed to finish this:** a ported fixture that deploys with a genesis in the past, a helper that posts both-sides scores, a rewrite of the 25 conceptual tests against the new rules, and an owner decision on the draft's parameters (cluster cap, 2x ceiling, 7-day window), because the tests encode those choices.

## 6. Real-money escalation packet

Nothing below is approved, scheduled or promised. These are the reviews that must exist, in writing, before any real-value step (a token anyone can hold or sell, liquid balances, a transferable Deed, a marketplace, or conversion). We do not claim any has happened.

| # | Review | Reviewer | Evidence required before proceeding |
|---|---|---|---|
| 1 | Independent smart-contract audit | A firm independent of the contract and signing-service authors | Pinned compiler 0.8.24, bytecode matched to source, manual line review, invariant fuzzing of R-01 to R-15 properties, every High and Medium closed and re-audited, public report |
| 2 | Off-chain signing and key-custody review | Independent security reviewer | Proof that "two signers" means two code paths, hosts, operators and custodians; HSM/KMS custody; rotation and compromise drill; settlement lag and late-day procedure |
| 3 | Economic review | Independent economist/mechanism reviewer | Valve and revenue link, toll channel sizing, issuance schedule, ring and wash-trading study rerun with a measured detection rate from a real pilot, burn-sink sizing |
| 4 | Anti-Sybil validation on real movement | Pilot data owner plus independent reviewer | Cluster detection precision and recall measured on real movement; false-positive appeal flow (cross-reference Track B6) |
| 5 | Privacy review and data protection impact assessment | Data protection counsel | What every event and storage slot discloses; decision on the deed id (R-10); sponsor analytics thresholds |
| 6 | Legal review per market and per feature | Qualified counsel in each target market | Questions are listed in the contract-proof line's ledger section 5 (token classification, liquid-after-deed gate, custody via wallets and paymaster, contests as prize competitions, marketplace obligations, app-store policy for Android). We draw no legal conclusion and invent no approval |
| 7 | Owner decisions recorded | Owner | At least G5-2 (liquid design or all-locked fallback), G5-3 (tolls), G5-5 (transferability), G5-6 (privacy), G5-7 (trust model), G5-9 (the unissued 600M) |
| 8 | Operations readiness | Operator | Incident and appeal process for voids and contests, public disclosure of supply, unissued 600M and admin powers, signer roster, bug bounty before any mainnet step |

Stage rule we recommend (a research proposal, not a decision): chain work stays at "independently audited architecture research only" until items 1 to 8 are each evidenced; before that, any token-equivalent accounting stays off chain with zero issuance.

## 7. Open owner decisions

1. G5-5: Deeds transferable or not (largest irreversibility, and the root of R-05, R-09).
2. G5-6: Deed privacy unit (R-10; cannot be recalled after minting).
3. G5-2 and G5-3: Liquid after the first deed or all-locked fallback as the default, and where tolls sit (R-03).
4. Revenue valve: whether to build it at all before real revenue exists.
5. Timelock floor value, challenge-window length, cluster cap and the 2x ceiling (parameters encoded in the draft patch).
6. Whether to reconcile the reported Base Sepolia inventory onchain (needs a read-only reconciliation procedure and a person to run it; we did not and will not call a public RPC from this research).
