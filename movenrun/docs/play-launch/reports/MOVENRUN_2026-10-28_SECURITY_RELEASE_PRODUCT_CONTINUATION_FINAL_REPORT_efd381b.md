# MovenRun 28 Oct 2026: security release candidate and product continuation

Scope: the 28 Oct continuation directive (security staging candidate, test discovery, movement and Android candidate, gameplay off, contracts research, website and operations). Work ran 28 Oct 15:40Z to 29 Oct 02:11Z.

Nothing was deployed, built, signed, published or enabled. Specifically:
- `main`, the Android release branch, `deploy/render-free-staging` and Vercel production are unchanged.
- No hosted SQL was run and 0011 is still unapplied. The gameplay flag and sign-in providers are unchanged.
- There was no EAS build, Play upload or onchain action.

Every merge went into a non-deploying feature branch, after an independent review and green CI.

Evidence grades: **CI** = CI verified at the exact head; **LOCAL/PG** = local Node 22 and PostgreSQL 16 on a fresh database per run; **SYNTH** = synthetic simulation; **PREPARED** = built but not applied; **OWNER** = needs the owner; **UNKNOWN** = not checked.

## A. Executive status and go/no-go

| Track | Status | Go/no-go |
|---|---|---|
| Security staging candidate | `integration/security-staging-preflight-28oct`, code `efd381bb6fc9e3be0229859d26ddee59cdbd410d`, head `0faf652` (doc only). Draft #162 against `deploy/render-free-staging`. CI green. Independent review accepted, and its notes are fixed. | **NO-GO until X-30.** The two legacy variable names must be confirmed absent, then the owner approves the exact SHA. Not deployed. |
| Play v1 | Copy truth (#159) and the deletion comment (#160) are reviewed, as drafts. Play account, providers, APK and phone tests are all owner gates. | **NO-GO** (owner gates X-01, X-04, X-05, X-08, X-10). |
| QA0 Android candidate | `integration/android-qa0-28oct` `5109d7b` (#161) combines #140, #145, #146, #153 and #155's own commit. #154 is excluded. The stationary-risk rule is #166, off by default. | **Source candidate ready.** No APK until X-04 and X-08. S03 still verifies while the rule stays off. |
| Gameplay pilot | `feat/g34-server-holdings` @ 224a49e: authoritative units, settlement invariants, fairness rerun, diff-only writes, erasure tombstones and dual-review resume, sealing v2. Flag off, 0011 unapplied. | **NO-GO.** Needs owner policy (retention, quota, thresholds) and exact 0011 approval. |

## B. Branches and PRs

| PR | Branch @ head | Base | State | Tests (grade) |
|---|---|---|---|---|
| #162 | integration/security-staging-preflight-28oct @ 0faf652 (code efd381b) | deploy/render-free-staging 2192de6 | Draft, **do not merge** | Backend 486/0/0 `--strict`, test:api 20/0/0 (LOCAL/PG); CI runs 40764349297, 40764349298, 40764349310 green (CI) |
| #159 | fix/v1-truthful-claims-copy @ 00eee3e | preview/android-qa0-candidate 15f7f87 | Draft (UI-freeze exception) | Mobile 936/936; new test fails 5/5 on base (LOCAL) |
| #160 | website/pending-deletion-followup @ 16a78cd | website/truthful-pending-deletion 1a9431d | Draft (merge after the #148 code) | Identity 205 pass, 1 skip (LOCAL) |
| #161 | integration/android-qa0-28oct @ 5109d7b | preview/android-qa0-candidate 15f7f87 | Draft | Shared 177, mobile 956, backend 481, 0 skip (LOCAL/PG) |
| #166 | fix/movement-stationary-risk @ 6523288 | integration/android-qa0-28oct 5109d7b | Draft (owner review) | Backend 491/491, shared 177, mobile 956 (LOCAL/PG); CI runs 40766243832, 40766243839 green (CI) |
| #163 | research/g5-issue-ledger-28oct @ 5088c0c | research/g5-deed-void-valve-hardening 355b8f5 | Draft, research only | Hardhat in-process 170/0/0 (LOCAL) |
| #164 | sim/g34-fairness-after-authoritative @ 702ce44 | feat/g34-server-holdings | **Merged** as 4c63acb | 624/624 (LOCAL/PG); CI 40766204444 green |
| #165 | fix/g34-challenge-diff-writes @ 0d8530f | feat/g34-server-holdings | **Merged** as 2930273 | 621/621 (LOCAL/PG); CI 40765657829 green |
| #167 | fix/g34-settlement-erasure-tombstones @ 1a5d86e | feat/g34-server-holdings | **Merged** as c7bcf25 | 641/641 c=1 and 625/625 parallel (LOCAL/PG); CI 40802448555 green |
| #168 | fix/g34-sealing-v2-topology @ e89d1a0 | feat/g34-server-holdings | Merged (224a49e), CI green on e89d1a0 (runs 40804354697, 40804354701) | 660/660 c=1, 518/518 parallel, test:api 21/21 (LOCAL/PG) |
| — | ci/test-discovery @ 28c3555 (review fix) | 2192de6 | Folded into #162 | 443/443 `--strict` with DB (LOCAL/PG) |

Earlier on 28 Oct, #150, #151, #152, #156, #157, #149 and #158 were merged into `feat/g34-server-holdings`, as merge commits in stack order.

**Failures found and fixed this round:**
- CI on #167 failed one test with a deadlock (40P01). Account deletion locked the user row before the erasure fence, while a day close held the fence and needed that row. Commit 1a5d86e takes the fence first. An independent reviewer accepted the change, and CI went green.
- One local run showed 20 failures caused by a stale test database owned by another role. This was an environment problem, and a clean rerun passed.

Environment: Node v22.22.0 and PostgreSQL 16, with a fresh database per run. `MOVENRUN_TEST_DATABASE_URL` points at the local database only. The API was built before the DB suites ran.

## C. Before → after regressions (local and CI only; nothing hosted or on a handset)

| Area | Before | After | Grade |
|---|---|---|---|
| Legacy JWT secret name set (even empty) | API starts | API refuses to start; no value is printed | LOCAL/PG, CI (#162) |
| Key-set outage | Stale keys keep signing people in | 503 `provider_unavailable` with Retry-After 10; forged tokens 401 | LOCAL/PG, CI (#162) |
| Identity refusals | 429, 413 and 400 could be cached | `Cache-Control: no-store` before the limiter | LOCAL/PG, CI (#162) |
| Deletion queue | Races under overlapping workers | Exactly one effective delete (memory and PG) | LOCAL/PG (#162) |
| S03 phone left still | 632 m, verified, 53 XP | Rule off: unchanged. `stationary-risk/v1`: review, 0 XP | LOCAL/SYNTH (#166) |
| Honest fixtures W04, I02, C01 | verified | unchanged with the rule on or off | LOCAL (#161, #166) |
| Out-and-back, spur, knot, gap loop | 13 of 14 abuse fixtures seal | 0 of 14 seal; 20/20 fair fixtures still seal | LOCAL/SYNTH (#168) |
| Lollipop (stick plus loop) | Whole session claimable | Only cells on or inside the loop | LOCAL/PG (#168) |
| Account deletion with settled days | Replay broke (`closed_day_replay_mismatch`), or rows were left | Tombstones; erased days verify through the erasure summary; raw delete fails closed | LOCAL/PG, CI (#167) |
| Settlement resume | One operator | Request with fresh proof plus two distinct approvers, DB-enforced, 24 h expiry | LOCAL/PG, CI (#167) |
| Challenge writes | Delete and re-insert | Optional diff mode compares first_day and rules_version (default unchanged) | LOCAL/PG, CI (#165) |

## D. Test discovery

- **Cause:** npm runs scripts with `/bin/sh` (dash), where `**` matches one level only. On 2192de6 the backend `test` script ran 37 of 45 files and missed 8 files (126 tests; 121 net of a double count):
  - `identity/{config,providerConfig,securityControls}`;
  - `movement/{h3Canonical,movementVerification,sealing,sessionEndToEnd,sessionMetadata}`.
- **Fix:** `scripts/run-tests.mjs`.
  - It walks the tree in sorted order and splits files into unit and db categories.
  - It sets per-test and whole-run timeouts, and lists every skip.
  - `--strict` fails on any skip, and the db phase runs one file at a time.
  - A failure prints its block with DB credentials redacted.
- **Counts:**
  - 45 files / 443 tests with a DB under `--strict`, all passing.
  - Without a DB: 415 pass, 28 skipped and listed.
- **CI:** `backend-checks.yml` gets two jobs:
  - a fast job, `test:unit --strict`, with no database;
  - the DB job, `test --strict`, after the API build.
- **Where it lives:** in the security candidate (#162) only.
  - **Required follow-up:** port the runner into `feat/g34-server-holdings` and the Android candidate.
  - Yarn 4's own shell expands `**` recursively, so CI on those branches already found 625 tests on #167, the same as bash globstar. The gap shows up in local `npm test` runs (499 on the same tree). Their parallel file runs also surfaced the deadlock above.
- **Not verified offline:** yarn argument pass-through for `--strict`. CI on #162 ran the jobs successfully.

## E. X-30 and staging release

- **X-30 status: UNKNOWN / OWNER REQUIRED.**
  - The Render environment API returns values, so it was not used.
  - No name-only metadata route was available, so nothing was read.
  - Reply format: `X-30 clear: both variable names absent` or `X-30 blocked: one or both names present`.
- **Candidate:** code `efd381bb6fc9e3be0229859d26ddee59cdbd410d`.
  - Diff against `2192de6`: 22 files, +2092/−123.
  - `drizzle/` is byte-identical, `CHECKSUMS.sha256` is OK for 0000–0010, and the journal is unchanged.
- **Release package:** `STAGING_SECURITY_CANDIDATE_28OCT.md`. It holds the deploy steps, health, ready and CORS smoke tests, JWKS and malformed-token checks, and stop criteria.
- **Rollback:** app deployment `dep-db9m51qjnfac73cqh6eg` (2192de6) only. No migration rollback.
- **Live state:** the current deploy ID is UNKNOWN. The hosted re-check was not repeated this round.
- **Before any approved release:** re-check the names immediately beforehand, because an empty legacy variable stops the new API from starting.

## F. 0011, flag and gameplay evidence

- **Applied chain:** 0000–0010 are byte-identical, the journal is unchanged, and checksums are OK.
- **0011** stays in `backend/drizzle-proposed/`.
  - Hashes after #168: up 709ff82ab51d2cc6f1800488f3859aaebcd6916bf11052a8bf64877e1fa72951, down 276cd12bea47e5514b187bbba9b65d0c8fa1560a3363009293e2d12107c5b2f3.
  - Superseded hashes: #167 bad2e6ce…/bfdc1d68…, earlier e3f355a9…/c134da41….
- **Flag:** `MOVENRUN_GAMEPLAY_ENABLED` defaults off, and the flag-off 404 tests pass.
- **RLS** is on for every 0011 table, with no grants to anon or authenticated.
- **Day settlement:** the cutoff and input digest are stored, and late uploads are refused. Erasure racing day close is tested; after the lock-order fix it settles once and reconciles.
- **Seal (#168):** only accepted fixes count, nothing inferred feeds the check, and it needs both the old seal and the new check.
  - Thresholds: area ≥ 2,000 m², retrace ≤ 0.2, width ≥ max(20 m, 2u). These are hypotheses.
  - A work budget fails closed.
- **Erasure (#167):**
  - Tombstones with random ids per line.
  - A per-day summary with no sequence, identity or time column.
  - Unit timestamps truncated to the day.
- **Replay:** non-erased days still detect tampering. Erased days get digest, invariant, count and proof checks, but no fresh-settlement comparison.
- **Rule digests:**
  - 1001 is the default. Its no-seal digest is still `d4199ec6…`; with the seal key it is `ff372572…3bb2`.
  - 1002 is `92e8e3cb…`, or `18a565fa…42a5` with the seal key.
  - The regression fingerprint for 1001 is unchanged.

## G. Drift decision (S03)

#154's 4× ratio is not adopted. #166 adds `stationary-risk/v1`, which is off by default.

**How it works:**
- Windows of up to 180 s, never crossing a pause.
- A window counts as stationary-like only if it is incoherent, contained within max(45 m, 2.5× accuracy) and not progressing.
- The session goes to review at 50% of the path or 500 m.

**Results (SYNTH):**
- S03: review, 0 XP. W04, I02 and C01 are unchanged.
- Corpus: FP 0/1400, FN 5/650 (reproducible from committed code). Client-pipeline harness: FP 0/1558, FN 10/650 (harness not committed).
- FP rises to 5.6% if real error is 0.8× the reported accuracy.
- Loops under about 75 m and slow drift fail.

**Known bypass:** client-sent pause markers can split every window. The rule targets honest drift, not a malicious client.

**Owner questions:** when to enable it, whether XP eligibility should be separate from distance, which limits to accept, and handset accuracy data first.

## H. Rules and fairness (SYNTH, #164)

Same-seed rerun after authoritative units, measured as honest walker-days blocked:

| Rule | Before | After |
|---|---|---|
| 1002 | 56.07% | 55.47% |
| 1003B at 5/day | 13.11% | 12.81% |
| 1003B at 3/day | 23.83% | 23.68% |

- Inferred pushes go from 4,483 to 0 per seed. Every change is within seed spread.
- 1002 stays unacceptable as a silent default, and 1001 remains the default.
- Five synthetic seeds cannot settle 3 vs 5 per day; that is an owner decision.
- No sanction is based on shared routes.
- Source deviations are not rewritten; they stay in the D-register (#157).

## I. Cost, storage and retention (LOCAL/PG projections)

Assumptions for the table: a 500 MiB quota (the real quota is UNKNOWN), autovacuum naptime 1 s, peak day twice the average, 0% hostile players.

| Players | delete-insert (1 / 4 seasons) | diff (1 / 4 seasons) |
|---|---|---|
| 200 | 19% / 23% | 17% / 21% |
| 500 | 43% / 53% | 39% / 49% |
| 1000 | 84% / 103% | 76% / 95% |
| 5000 | 410% / 505% | 371% / 466% |

- **Diff-only writes, 20,000 batches:** WAL falls from 478 to 148 MiB (60 s naptime).
- **Autovacuum timing alone** moves the same workload between 54.5 and 250 MiB (#158). Do not publish a player cap from one run. VACUUM FULL is never recommended.
- **Retention:** the erasure retention proposal is season plus 30 days. Retention, backup and legal-hold policy is OWNER.

## J. Website, Play, Android and host

- **Website:** production is still `dpl_ABCfgjsFiJ4DHtRnrLPCc8npLAuD` (61d30bb), last verified live 18 Oct; not re-checked this round (UNKNOWN since then). The deletion and privacy pages already say pending; #160 aligns the backend comment.
- **Vercel daily deployment cap:** `api-deployments-free-per-day` was hit again on 28 Oct around 20:42Z, across all five projects. Every push spawned about 5 preview builds, about 30 or more this round. Previews are not CI.
- **Not done this round:** X-29 cleanup and #128 helper verification. Both stay owner-gated.
- **Play:** account (X-01), declarations and the closed-test rules are not checked this round. Recheck them at action time.
- **Android:** source candidate only. No APK and no handset run (H-1..H-12 NOT RUN). DEP-EXC-2026-001 expires 21 Nov; reachability was not re-tested this round (X-32).
- **Render staging:** last known at 2192de6, deploy ID UNKNOWN. Not contacted this round.

## K. Blockers, gates and no-bypass record

- **Not attempted:**
  - any deploy;
  - a merge to `main`, the release branch or the deploy branch;
  - hosted SQL;
  - 0011 promotion;
  - the flag, provider, key, quota or env changes;
  - EAS or Play actions;
  - onchain actions;
  - account creation or spending.
- **X-30:** not read through the Render environment API, because it returns values. Left UNKNOWN.
- **CI logs:** the direct log download host was refused by the egress proxy, so the CI failure on #167 was read through the GitHub tool instead. This is the same data from the same source, not a bypass.
- **Usage limits** paused work twice (about 16:06Z to 20:30Z and about 21:06Z to 01:30Z). Every stopped worker was resumed. Nothing was restarted from scratch or duplicated.
- **Secrets and personal data:** no secret values, personal data or real GPS data appear in any commit, PR or report. Commits are authored suhaib155 with no trailers.

## L. Owner actions in priority order, and the next prompt

1. **X-30:** check Render `movenrun-staging-api` for the two variable names only, and reply in the format in E. If clear, approve or decline one staging deploy of `efd381bb6fc9e3be0229859d26ddee59cdbd410d` (rollback `dep-db9m51qjnfac73cqh6eg`).
2. **UI-freeze copy exceptions:**
   - #159's 11 strings;
   - "Pending verification" and "Not eligible" next to "+N XP" (#161 caveat);
   - the remaining audit rows.
3. **Stationary-risk (#166):** enable timing, separating XP from distance, accepting the limits, and handset accuracy data.
4. **Gameplay decisions:**
   - sealing thresholds and the sidewalk vs short-loop trade-off (#168);
   - 1003B 3 vs 5 per day;
   - erasure retention and signed summaries;
   - resume approver count and mapping labels to people;
   - TRUNCATE guard;
   - the club score of erased members;
   - the G5 shared-nullifier design.
5. **X-32:** decide DEP-EXC-2026-001 by 21 Nov.
6. **X-29 and the Vercel plan:** decide whether to disconnect the duplicate projects, given the daily cap.
7. **Other gates:** X-01, X-05, X-08, X-04, X-10, and the real quota and retention policy before 0011.

**Next autonomous prompt:**
- port `run-tests.mjs` to `feat/g34-server-holdings` and the Android candidate;
- add a committed end-to-end diff-mode push test;
- commit the client-pipeline drift harness;
- add the refuse-to-start router test;
- bring the phone's seal preview into line with sealing v2 (needs a UI exception);
- measure erasure cost at 200 players;
- re-test DEP-EXC reachability;
- verify #128 with one controlled preview once the Vercel cap resets.
