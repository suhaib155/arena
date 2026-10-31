# MovenRun milestone pack, 29 to 30 Oct 2026: consolidated report

Staging-readiness and gameplay-integrity line. Gameplay stays disabled, migration 0011 stays unapplied, providers untouched, no Render or deploy-branch action (X-33 still not granted), no force-push, no onchain or paid action.

## 1. Branch heads (exact)

| Line | Head | What landed |
|---|---|---|
| feat/g34-server-holdings | dfd3a08ece5a41d6b75e1de618c35a3c034f8bc2 | #181 settlement and erasure lock order; earlier #180, #175, #174, #173, #176 |
| integration/android-qa0-28oct | 79b223b6eae2e774419b4d6c269c15a7538b9322 | #178 platform readiness; earlier #177 (2d63305) |
| security/a10-single-use-google-exchange (board) | this commit | records only |
| integration/security-staging-preflight-28oct | 0faf652 (unchanged) | #162 candidate not moved |
| deploy/render-free-staging | efd381b (unchanged) | not redeployed |

Merge commits: #173 ae57d22, #174 ae7710b, #175 4ee9d4a, #176 d98b5ef, #177 2d63305, #178 79b223b, #180 752fba7, #181 dfd3a08.

## 2. Milestones

1. **Gameplay concurrency (#181, merged).** Root cause of the exhausted settlement retries: lock order. A day close took its snapshot and advisory lock before the erasure fence, so a concurrent erasure forced repeated 40001 failures. The fix takes the fence table lock first. Exhaustion is the typed `settlement_retry_exhausted`; backoff is bounded; a failed final attempt writes nothing. Retry counts were not raised and locking was not weakened.
   - Tests: `settlementErasureRace.pg.test.ts`, 5 tests; 4 of 5 fail on the base, all pass after; removing only the lock line fails the root-cause test. Mutations (raw error, retry-everything, no total-time cap, partial write) are each caught. Removing the delay cap is not detected (never reached under defaults).
   - Strict suite 683 of 683, 0 skipped, typecheck clean. CI green on 722a115.
   - Independent Opus review: accept with notes; no deadlock added (deadlock counter delta 0 in 150 s and 120 s stress); on base about 2,500 raw 40001 and no live settlement. Doc notes applied in 722a115.
   - **Open finding:** in a synthetic stress (24 erasers, 12 pushers, production 10 s timeouts) 24-28% of erasures time out with the fix (0 on base, because base never settled a day). Erasures serialise on the fence and verify every settled day they touched. Decision before gameplay is enabled: erasure retry, async queue, or lock_timeout with a typed error.
   - Low findings: an idempotent settleDay on an already settled day takes the fence lock before its early return; closes saw 43 raw 57014 not typed as exhaustion; pre-existing erasure versus push 40P01 and unretried ensurePartitions.
2. **Game integrity (#180, merged).** Sealing v2 re-exercised against 28 Oct: identical cell for cell (all 20 fair fixtures seal at sigma 0 and 5, 0 of 14 abuse fixtures seal at sigma 0; sidewalk leakage 25% and 50% at sigma 5). The 1003 simulation bug (stale opening time on a restarted challenge) was fixed to match `policy.ts` after #176, with a test that fails before and passes after.
   - 1001 and 1002 unchanged beyond noise. 1003B hostile flips per active day fall from 4.71 to 2.38 at 5/day and from 3.31 to 1.89 at 3/day (material); honest holding at day 90 is noise. Moving from 5/day to 3/day now buys about 0.5 hostile flips per day instead of 1.4 for about 10 points more honest blocking. Owner decision, nothing ratified; synthetic data, five seeds.
   - Backend strict suite 679 of 679. Independent review: merge; the fixed CSV was reproduced byte for byte. Nits: a count of "16 of 196" should read 17; the soft path (rule set 1003C) could keep a stale time in principle (no published number affected).
3. **Android / Play v1 (#177 merged earlier, #178 merged).** Release-candidate guard test against the rejected 4x stationary rule, EAS build and handset gates document, store listing correction. No build was run, no quota used, nothing published.
4. **Platform readiness (#178 merged, #179 held).**
   - DEP-EXC-2026-001: package present, call not reachable (expo-router replaces React Navigation's path parser; no https link filters; `query-string` never imported). Recommendation: amend the exception, keep 21 Nov, re-check by 14 Nov, renew at most once to 21 Dec. Owner sign-off still blank. Reachability test: 8 cases.
   - Vercel cleanup plan (no deletions, production deployment dpl_ABCfgjsFiJ4DHtRnrLPCc8npLAuD never touched). Dashboard facts are UNVERIFIED (no Vercel read tool).
   - #179 (Google sign-in acceptance tests and owner script B1 to B13) is a draft ON HOLD against the #162 candidate branch: merging would change #162's reviewed head.

## 3. Actual hosted status

- Render staging still serves dep-db9m51qjnfac73cqh6eg (commit 2192de6, the rollback target). The failed deploy dep-dbhn0cugekts73bn7hig of efd381b did not run migrations. Deploy branch is at efd381b. Nothing was redeployed. No hosted smoke test was run (the remote shell returns 403 and was not worked around).
- Supabase was ACTIVE_HEALTHY with 11 of 11 hashes at the last check; the project can pause on the free tier.
- Vercel Hobby daily deployment cap is exhausted at times; five projects build on every push. Its failures on PRs are not code failures.
- Gameplay flag off, 0011 unapplied, providers off.

## 4. Owner decisions remaining

- X-33: a new single-deployment Render authorization.
- X-04: approve one preview APK from an exact SHA.
- Android: narrow text-truth exception for T2 and T4 to T12, T3 as a reviewed logic fix; handset API (staging as it is, or a separately approved RC backend deploy); whether #166 joins the RC; revised store listing wording; remove the stray empty file `mobile/40`.
- DEP-EXC amend and sign-off; Vercel read-only inventory and cleanup order.
- Erasure under load: retry, async queue, or lock_timeout with typed error (new, from #181).
- 3 or 5 hostile flips per day: now a weaker case for 3 (new numbers above); X-31 (a) to (f) gameplay decisions; X-32 dependency exception.
- Open earlier: X-05, X-08, X-09, X-21, X-01; #179 retarget after #162 lands or explicit acceptance of a new head.

## 5. Notes on process

Separate worktrees, additive commits only, independent reviews before each merge, merges only into non-deployment development branches. PR bodies had a server-added footer removed after creation.
