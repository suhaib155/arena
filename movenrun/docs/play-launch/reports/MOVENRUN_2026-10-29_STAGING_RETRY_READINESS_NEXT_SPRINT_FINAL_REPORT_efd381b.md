# MovenRun report, 29 October 2026

Code commit under release review: `efd381bb6fc9e3be0229859d26ddee59cdbd410d` (PR #162, still a draft, not merged).

## 1. Owner decisions received

- **X-30 cleared.** The owner checked the full Render environment list for `movenrun-staging-api` by names only (no values seen) and confirmed both variable names are absent. It is not a blocker any more.
- **One staging deployment approved** for the code commit above, subject to an exact SHA and diff check, zero applied migration changes, required checks passing and a verified rollback to `dep-db9m51qjnfac73cqh6eg`. The approval excludes gameplay, migration 0011, provider toggles, Play and production.
- **After the failed attempt** the owner restored Supabase and asked for: deploy branch left at `efd381bb`, no retry, read-only health and migration-history checks, a readiness report and a new single-deployment authorization before any further Render action.

## 2. Candidate and checks

- Release candidate: #162, head `0faf652`, code `efd381b`. Required checks passed before the deploy attempt. The strict test runner (`scripts/run-tests.mjs`, fails on any skip) is on this branch.
- Migration integrity: Drizzle 0000 to 0010 applied, 11 rows in `drizzle.__drizzle_migrations`, every hash equal to `CHECKSUMS.sha256`. Re-verified after Supabase came back (11 of 11).
- Migration 0011 stays unapplied in `backend/drizzle-proposed/`. Hashes: up `709ff82a…2951`, down `276cd12b…2b3`.

## 3. Release outcome, literally

- The deploy branch `deploy/render-free-staging` was fast-forwarded from `2192de6` to `efd381b` (no force). #162 itself was not merged.
- Render deployment `dep-dbhn0cugekts73bn7hig` built successfully, then **failed** at `db:migrate` with `tenant/user not found`. Cause: the Supabase project had been paused (Free tier), not the code. No migration ran.
- The previous deployment `dep-db9m51qjnfac73cqh6eg` (commit `2192de6`) stayed live and is the rollback target.
- The approved deployment was used once. **No retry has been made.** A new authorization is needed.
- Hosted smoke tests were not run: the remote shell used for outside HTTP checks returned 403 and was not worked around. The owner's smoke commands are in `STAGING_SECURITY_CANDIDATE_28OCT.md` on the #162 branch.
- Current state: Supabase ACTIVE_HEALTHY, branch at `efd381b`, rollback target live.

## 4. Pull requests this period

| PR | State | What |
|---|---|---|
| #169 | merged | Strict test discovery on the Android QA0 line |
| #170 | merged | Strict test discovery on the gameplay line (75 files, 660 tests, 0 skipped) |
| #171 | merged | Test that every gameplay entry point is off with the flag unset |
| #172 | merged | Stationary-risk harness (synthetic only) into #166 |
| #173 | draft | Diff-write end-to-end test; review fixes still to do |

## 5. Android QA0

Strict runner on the QA0 line (51 files, 499 tests, 0 skipped). Stationary-risk harness merged into #166; its figures are synthetic and are not real-world accuracy claims. Mobile UI remains frozen.

## 6. Gameplay

- Flag-off proof merged (#171): nine gameplay routes return 404 with the flag unset, source scan of `app.ts` allows only listed prefixes, only the exact string `true` enables gameplay, nothing reads 0011.
- **Restart bug confirmed** (found while building #173): a challenge restarted late on a day keeps the old receipt time, so a push just after midnight flips it as if open for days. The spec (`G34_SERVER_ARCHITECTURE.md` lines 321, 328, 399) says the time is written when the challenge opens. Reproduced in both write modes. A small fix exists (about 7 added lines in `policy.ts` and `service.ts`) and is not applied. It changes rule set 1002 behaviour without changing its digest; 1001 is unaffected. Owner decision X-34.
- Two review notes on #173: the runner does not print todo tests, and the benchmark's counter reset is swallowed on a permission error so its dead-tuple figure is wrong.
- Unrelated flake seen twice: `zonesMintAuthBinding.test.ts` "rejects a bad signature" (6 of 6 pass alone). Not yet investigated.

## 7. Economy and contracts

No change this period. Research items (#147, #163) wait on X-31.

## 8. Operations

- Supabase Free pauses on inactivity. A paused project makes `db:migrate` fail on start. Keep it active before any deploy.
- Vercel preview comments show errors because the daily cap is used up; they are noise, production is unaffected.
- Remaining safe items: erasure benchmark at 200 players, reachability re-test for DEP-EXC-2026-001 (expires 21 Nov), sealing v2 re-exercise, 1003 fairness rerun, X-29 Vercel check (needs quota).

## 9. Owner actions register

| Item | Need |
|---|---|
| X-30 | Cleared by the owner. Closed. |
| X-33 | New single-deployment authorization for the retry (exact commit `efd381b`, same conditions) |
| X-34 | Restart bug: apply as a source-correctness fix and document it (recommended), or version it as a new rule set |
| X-31 | Gameplay decisions (a) to (f), unchanged |
| X-32 | Dependency exception DEP-EXC-2026-001, expires 21 Nov, unchanged |

## 10. Next-iteration packet

1. On a new authorization: check Supabase health, branch at `efd381b`, rollback target live; trigger exactly one deploy; read status and logs; hand over smoke commands.
2. Finish #173 (runner prints todo, benchmark counters, WAL note), then merge.
3. After X-34, a separate scoped PR for the restart fix.
4. Investigate the zones flake.
5. Erasure benchmark, reachability test, sealing v2, 1003 rerun.
