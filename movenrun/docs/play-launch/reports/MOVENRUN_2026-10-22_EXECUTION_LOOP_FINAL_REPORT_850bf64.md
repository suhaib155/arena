# MovenRun execution loop, 22 Oct 2026

Code reference: `feat/g34-server-holdings` at 850bf64. Board: `security/a10-single-use-google-exchange`. Evidence E-92 to E-99.

## 1. Executive checkpoint

- All eight workstreams ran. Two merges were made, both into `feat/g34-server-holdings` only: #129 and #130. Nothing reached `main`, a release branch or a deploy branch.
- Five new draft PRs are open (#131–#135). Every new branch was reviewed by someone other than its author, and all review notes are fixed.
- Nothing live changed:
  - auth providers are still OFF;
  - migration 0011 is still proposed and unapplied;
  - the gameplay flag is off;
  - no build, deployment, purchase, signature or chain transaction took place.
- The work paused twice on a usage limit (about 05:00–09:20 and 09:30–14:20 UTC) and resumed from saved state each time.

## 2. Changes by PR and SHA

| PR | Branch → base | Head | State | What |
|---|---|---|---|---|
| #129 | integration/g34-0011-1002-unapplied → feat/g34-server-holdings | merge cb27318 | MERGED | 0011 revision 3 (storage revision 2 + 1002 session paths) plus the 1002 fixes. Adds a flag-off 404 test and deterministic 42P07/40P01 retry tests |
| #130 | fix/gameplay-deadlock-409 → feat/g34-server-holdings | merge 850bf64 | MERGED | Exhausted 40P01/40001 retries return 409 `concurrent_push_retry`, not 500 |
| #127 | — | 384150e | draft | Retitled to its five-row scope; footer removed |
| #128 | ops/vercel-ignore-build | 49c9fe9 | draft, CI green | Ignored-build script moved out of the public folder |
| #131 | docs/decode-uri-exception-22oct → preview/android-qa0-candidate | 713a1c0 | draft | Dependency exception DEP-EXC-2026-001 |
| #132 | docs/qa0-handset-worksheet → preview/android-qa0-candidate | 53d1f6f | draft | Handset worksheet H-1..H-10 |
| #133 | research/g5-g7-economy-suite-port → research/g5-g7-economy | 1b383fd | draft | Original v3 suite ported to the draft patches |
| #134 | sim/g34-1001-1002-fairness → feat/g34-server-holdings | d4206fd | draft | Same-seed fairness study |
| #135 | feat/g34-storage-lifecycle → feat/g34-server-holdings | 8db2715 | draft | Lifecycle matrix, archive design, TTL dry run, capacity model, promotion gate |

GitHub closed #124 and #126 as merged when #129 landed, because their heads are ancestors of it. Their branches are kept.

## 3. #129 outcome

#129 was merged under the directive's condition, after both required tests were added (d440f3a):
- a flag-off HTTP 404 test;
- a deterministic 42P07/40P01 retry test.

The 0011 sha256 values are unchanged: b87f2e2f… for the migration and 184fffa7… for the down file. 0011 remains outside the applied Drizzle chain.

## 4. Tests and security

- The full backend suite on a clean local database passed 415/415 after #130. The storage branch passed 426/426, its extra 11 tests being new.
- The fairness branch ran 380 pass with 0 fail. Its 39 PostgreSQL tests were skipped in that run, which had no database URL set.
- The contract suite port ran 138 pass, 0 fail, 0 pending on local Hardhat.
- #130 removes a raw 500 that appeared after exhausted deadlock retries.
- The retention dry run accepts local hosts only:
  - it refuses `host=`, `hostaddr=` and `service=` overrides, and `PGHOST`, `PGHOSTADDR` or `PGSERVICE` pointing elsewhere;
  - it runs READ ONLY and always rolls back;
  - it accepts only SELECT or WITH statements;
  - partition drops are always reported as blocked.
- New contract findings (research only):
  - voiding a deed does not release the cluster, daily or lifetime claim counters;
  - one timelocked action can open the full 400M, and the allowance never expires;
  - with the valve shut, up to 2% of each day's gross is still paid out as liquid MOVE;
  - the timelock still accepts a 1-second delay;
  - one admin key can swap both eligibility signers.

## 5. Storage and economy (SIMULATION ONLY)

The table gives the most players that stay under 85% of an assumed 500 MiB quota, for 1 season / 4 seasons:

| Churn | Ordinary | 2% hostile | 10% hostile |
|---|---|---|---|
| Vacuum keeps up | 1,581 / 1,158 | 1,150 / 898 | 550 / 473 |
| Bloat as measured | 1,156 / 912 | 907 / 743 | 487 / 426 |

- **Player count:** at 200 players the peak is 206 MiB. 5,000 players fails closed in every profile.
- **Vacuum:** one plain VACUUM a day keeps the challenge table at 2.20 MiB, against 5.95 MiB without it. VACUUM FULL is never a routine hosted operation.
- **Promotion gate:** all 12 rows are NOT MET / OWNER.
- **Fairness, 1001 vs 1002:**
  - attacker flips of honest ground fall from about 1,624 to about 69;
  - commuters holding ground rise from 6% to 99%;
  - the 13-take cap binds long-distance walkers on 99% of their active days;
  - the co-walk review candidate flags all 8 honest co-walker pairs and no attacker, so it is not fit as a sanction rule;
  - the 1001 digest is unchanged.

## 6. Android exception

DEP-EXC-2026-001 covers GHSA-vcc3-ghjq-m6fr (decode-uri-component). It expires on 21 Nov 2026, and the owner's sign-off is still pending. It does not appear in the Play Data safety answers. The handset worksheet H-1..H-10 is ready for the first device session.

## 7. Vercel strategy

Vercel's native skip does not apply, because the website is not a workspace. The script now lives in `movenrun/ops/vercel/`, outside the folder Vercel serves. It fails open, and `VERCEL_FORCE_BUILD` overrides it. The owner needs to do two things:
- set the dashboard command `sh ../ops/vercel/ignored-build.sh || exit 1`;
- disconnect Git for `arena`, `arena-pchb` and `arena-qg9n`, and hold `arena-vv61` until it is confirmed unused.

## 8. Cost and privacy

- No spend.
- No plan change.
- No EAS build.
- No hosted database access.
- No production SQL.
- No credentials, routes or location paths appear in any file, log or PR.
- Commits are authored by suhaib155 with no trailers, and the session footers were stripped from every PR body.

## 9. Live state

Last verified on 18 Oct (E-86 to E-91); none of it was re-checked in this run. Evidence grade: P (prior evidence), unchanged because this run made no live change.
- Render staging: live at 2192de6.
- Website: production dpl_ABCfgjsFiJ4DHtRnrLPCc8npLAuD (61d30bb).
- Supabase: Google and wallet OFF, 0 users, hook cap 1000 total / 50 an hour.

## 10. Denied or blocked actions

- `yarn install` was refused by the proxy with a 403. Workers reused existing `node_modules`, which are untracked and not committed.
- The local PostgreSQL cluster stopped twice on its own and was restarted locally.
- The worker usage limit paused work twice.
- No integration refused a write or publication.

## 11. Owner-only actions

| # | Action | Where |
|---|---|---|
| 1 | Enable Google sign-in, then wallet (X-05; X-07b follows) | Supabase dashboard, `X05_PROVIDER_ENABLEMENT_PREFLIGHT.md` |
| 2 | Decide the Supabase quota and a binding retention, backup and erasure policy before any 0011 promotion (gate rows in `G34_PROMOTION_GATE.md`, #135) | Decision |
| 3 | Provide an EAS Maps key and approve one specific preview build (X-08, X-04) | EAS |
| 4 | Create the Play account and run device testing with the handset worksheet (X-01, X-10) | Play Console, phone |
| 5 | Set the #128 dashboard command and disconnect the three unused Vercel projects (X-29) | Vercel |
| 6 | Sign off or reject DEP-EXC-2026-001 (#131) | PR review |

## 12. Next safe work

- Merge #134 and #135 into `feat/g34-server-holdings` after a final look. Both are reviewed and touch no runtime path.
- Measure in-place (HOT) challenge writes. This needs a scoped service change behind the flag.
- Patch the deed-void counter release in the G5 draft patches.
- Keep watching drafts #127, #128 and #131–#135.

## 13. Next handoff prompt

> Continue MovenRun from the 22 Oct report (`reports/MOVENRUN_2026-10-22_EXECUTION_LOOP_FINAL_REPORT_850bf64.md`). The feature stack head is `feat/g34-server-holdings` at 850bf64. Drafts #127, #128 and #131–#135 are open, and all are reviewed.
>
> Gates are unchanged:
> - no merge into main, release or deploy branches;
> - no change to auth providers;
> - 0011 stays unapplied and the flag stays off;
> - no EAS build, Play upload, signature or chain transaction;
> - no spend;
> - production SQL is aggregate-only.
>
> Next steps:
> 1. Merge #134 and #135 into the feature stack if CI is green.
> 2. Patch the deed-void counter release in the G5 drafts, with a regression proof.
> 3. Scope a flag-gated HOT write experiment for challenge rows, local only.
> 4. Act on any owner action from the table above as it lands.
