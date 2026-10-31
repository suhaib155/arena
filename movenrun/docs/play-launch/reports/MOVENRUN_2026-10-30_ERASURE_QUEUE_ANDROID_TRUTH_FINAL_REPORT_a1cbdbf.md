# MovenRun 30 Oct 2026: erasure queue, Android truth fixes, staging retry

Final SHA on the gameplay line: `a1cbdbf` (`feat/g34-server-holdings`). Android line: `02d8ca9` (`integration/android-qa0-28oct`). Deploy branch `deploy/render-free-staging` unchanged at `efd381b`.

## 1. Executive outcomes
- X-33 consumed: one security-only staging deployment of `efd381b` is live (Render `dep-dbi94de1egvs73f8ns5g`, live 2026-10-30 12:49:57Z, as reported by the Render tooling). No second deploy was made.
- Durable asynchronous account-deletion queue built, independently reviewed, one MEDIUM finding fixed, merged as #183 (proposed migration only; gameplay stays off).
- Android text-truth corrections merged as #182. No EAS build, no Play publication.
- DEP-EXC-2026-001 amendment text, staging smoke-test plan and platform health runbook written (docs only).
- Vercel read-only inventory done; nothing disconnected or deleted.
- Not done: hosted smoke tests (outbound HTTP from this environment returns 403), so staging behaviour after the retry is unverified by HTTP.

## 2. PR and branch manifest
| Item | State |
|---|---|
| #178 platform readiness docs and DEP-EXC reassessment | merged 79b223b (android line) |
| #180 ledger1003 fix and fairness rerun | merged 752fba7 (g34) |
| #181 settlement/erasure lock order | merged dfd3a08 (g34) |
| #182 Android truth corrections | merged 02d8ca9 (android line) |
| #183 async deletion queue | merged a1cbdbf (g34), CI green, reviewer verdict approve after one required change |
| #162 security staging candidate | head 0faf652 untouched |
| #179 | draft, on hold (would change #162 head) |
| Board branch `security/a10-single-use-google-exchange` | this report, smoke plan, DEP-EXC amendment, runbook |

## 3. Erasure: before and after (local, synthetic, 200 players, 24 erasers, 12 pushers, 1 closer, pool 40, 10 s client timeout, 3 repeats)
| Run | initiation p50 / p99 | completion p50 / p99 | completed | over 10 s | outstanding |
|---|---|---|---|---|---|
| base, synchronous | 5.8-7.0 s / ~10 s | 4.7-5.4 s / ~10 s | 126-143 of 200 | 49-63 | 57-74 |
| new, queued | 22-29 ms / 68-93 ms | 30.3-30.6 s / 55-57 s | 200 of 200 | 0 | 0 |
| steady 4/s, base | 7612 ms / 10093 ms | 4468 ms / 10158 ms | 120 | 73 | 80 |
| steady 4/s, queued | 4 ms / 26 ms | 18.0 s / 66.1 s | 200 | 0 | 0 |
The reviewer's independent rerun matched (acceptance p50 23 ms, p95 116 ms, p99 147 ms, max 149 ms on that machine). These are local figures, not hosted limits. Every settled day passed verification; settlement was never halted; no table named an erased player.

## 4. Deletion queue semantics
Accept in a short transaction (no gameplay lock, FOR NO KEY UPDATE on the account row): account marked deleting, sessions ended, one job written, answer 202 pending with an opaque id. Lease-based worker (SKIP LOCKED, 3 s lock limits, jittered backoff 2 s to 5 min, 40 attempts), job completes inside the erasure transaction and drops the user id. Exhausted jobs go to needs_attention; operator requeue is audited. Sign-in, issue and refresh return 409 while deleting. Gameplay off: synchronous with a 5 s limit and typed 503 deletion_busy. Table exists only in `backend/drizzle-proposed` (0011); `drizzle/` and checksums unchanged. Details: `backend/docs/G34_ERASURE_QUEUE.md`.

## 5. Android truth matrix
Fixed in #182: task XP logic, summary XP card, provisional seal preview, capture/ownership wording, Technical info row hidden, territory intro and completion summary copy. Still open: local territory vocabulary rename, stray empty file `mobile/40`, mobile wording for 202/409/503 on deletion (security.tsx line 191 shows "permanently deleted" on any 2xx), store listing wording. Documents: `ANDROID_V1_PHONE_TEST_PLAN.md`, `ANDROID_PREVIEW_APK_BUILD_REQUEST_30OCT.md`, pilot checklist, RC truth audit (on the android line).

## 6. Staging, Render, Supabase
Render `srv-db7a49dg1s2s739nleog`: deployment `dep-dbi94de1egvs73f8ns5g` at `efd381b`, live 2026-10-30 12:49:57Z; rollback target `dep-db9m51qjnfac73cqh6eg` (2192de6). Earlier attempt `dep-dbhn0cugekts73bn7hig` failed while Supabase was paused. Supabase `tavxmwuwkeynbnzfwove`: db, auth, pooler ACTIVE_HEALTHY at the check; rest and realtime reported UNHEALTHY; migrations 0000-0010 applied, 0011 not. Hosted HTTP smoke tests NOT RUN: see `STAGING_SMOKE_TEST_PLAN_30OCT.md`.

## 7. Vercel inventory
Read-only inventory completed; five projects build on every push and the Hobby cap of 100 deployments a day is hit at times (bot "failed" comments on PRs are cap or configuration noise). Production deployment untouched. Cleanup order: `VERCEL_BUDGET_CLEANUP_PLAN_29OCT.md`. Nothing disconnected.

## 8. DEP exception
Owner approved DEP-EXC-2026-001 until 21 Nov 2026, reassessment by 14 Nov, no automatic extension. Amendment text: `DEP_EXC_2026_001_AMENDMENT_30OCT.md`, sign-off field left blank (NOT SIGNED).

## 9. Gameplay rules
1001 remains default; 1002 disabled; 1003B at 5 takes/day is a simulation preference only. Rerun after the #176 fix: 1003B hostile flips per active day 4.71 to 2.38 at 5/day and 3.31 to 1.89 at 3/day (synthetic, five seeds). No further runs this round because nothing would change the recommendation.

## 10. Storage and performance risks
Erasure throughput unchanged (about 300 ms each behind the fence, backlog of 200 takes about 1 minute). Pre-existing push-versus-erasure deadlock cycles remain (workers retry). Completed job rows have no retention limit yet. Status shows the provider stage at completion only. Free-tier Supabase pause risk and Render cold start are in the health runbook.

## 11. Blocked or refused
Hosted HTTP checks (403 from the environment; not worked around). Production SQL reads (auto-mode guard). No force-push, no amend, no deploy beyond X-33, no 0011 in `drizzle/`, no gameplay flag, no provider toggles, no EAS, no Play.

## 12. Top three owner steps
1. Run the hosted smoke tests in `STAGING_SMOKE_TEST_PLAN_30OCT.md` (or approve other tooling) and fill the READY sheet.
2. Decide Android build approval (X-04) and which API the build targets, then provide the branch for the preview build.
3. Decide the deletion-queue gates: retention of completed jobs, requeue authority, SLO and retry policy, and the website/app deletion wording before gameplay is ever enabled; sign the DEP-EXC amendment.

## 13. Next packet
Hosted verification result, then retargeting #179 only after real verification. Mobile deletion wording for 202/409/503 once UI changes are permitted. Territory vocabulary rename. Optional extra 1003B 5/day stability runs.
