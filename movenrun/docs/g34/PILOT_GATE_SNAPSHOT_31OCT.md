# Territory pilot gate snapshot (D6), 31 Oct 2026

**Status: PASS as research on the development branch. BLOCKED for any live use.** Gameplay stays disabled, proposed migration 0011 stays unapplied on every hosted database, rule 1001 stays the default, 1002 stays off and 1003B (five hostile takes a day) stays a simulation setting only. Nothing here is an approval.

## Baseline

| Item | Value |
|---|---|
| Branch / head tested | `feat/g34-server-holdings` at `d81867b` |
| Merged work present on that one head | #168 sealing v2 (`224a49e`), #173 diff-write E2E, #176 restart receipt time, #180 fairness rerun, #181 lock order (`dfd3a08`), #183 erasure queue (`a1cbdbf`), #186 queue policy (`d81867b`). #183 and #186 were squash merges; their patch ids equal the PR heads' diffs |
| Strict suite at `d81867b` | typecheck clean; 711 tests, 711 pass, 0 skipped (unit 537, db 174), local PostgreSQL 16.15 |
| Strict suite with this change | typecheck clean; 717 tests, 717 pass, 0 skipped (unit 539, db 178) |
| 0011 sha256 at `d81867b` | up `0f3e5e18…7cfc`, down `537a3ee1…dcfd` (full values in G34_PROMOTION_GATE.md) |

## Matrix

| Gate row | Result | Evidence |
|---|---|---|
| 0011 schema and rollback | PASS (throwaway DB) | 0000–0010, then up, up again, down, up on a disposable local database: the down restores the 0000–0010 schema byte-identical (`pg_dump -s`), up after down equals the first up, re-running up changes nothing. Now also a CI assertion over the whole catalogue in `gameplay.pg.test.ts` (it failed when a mutated down left one index behind) |
| Journal and checksums | PASS | journal lists 0000–0010 only, `CHECKSUMS.sha256` verifies 11/11, no 0011 under `drizzle/`; pinned by `promotionGateHashes.test.ts` |
| Reviewed hash in the promotion gate | **FIXED (was wrong)** | The gate still named up `b87f2e2f…` and down `184fffa7…`; sealing v2 and the job table changed both files. Gate, lifecycle doc and architecture §18 now carry the current values, and the new test fails whenever a 0011 file and the gate differ |
| Unprivileged access | PASS (throwaway DB) | RLS on 23/23 gameplay tables; 0 table grants and 0 function EXECUTE for `anon`, `authenticated` or PUBLIC |
| Erasure rollback at every fail point | PASS (new) | `erasureFailPoints.pg.test.ts` fails the queued erasure at each of its 32 data-changing statements (fence, provider queue, movement, sessions, identities, audit, gameplay phase 2, erasure records, credit-line tombstones, job completion, user row, foreign-key cascades, audit insert), once with 40001 and once with a fatal code. After every failure the database is byte-identical outside the job row, the job is pending (or needs_attention) and still names the account, the account stays `deleting` with no session; the clean attempt then completes once, nothing names the walker and every day replays. A mutation that wrote one row outside the transaction failed at fail point 4 |
| Lease takeover budget | PASS (new) | a job whose worker dies after every claim is parked as `attempts_exhausted_lease` after the budget, writes nothing else, is not reclaimed on its own and completes after an audited requeue. This path had no test before |
| Pusher, closer and eraser together | PASS (new) | forced order, checked on `pg_stat_activity`: a push holds the victim's unit and waits on its ledger insert, the erasure waits on that unit row, the day close waits on the fence. All three finish on the first attempt, no 40P01, each day settles once and replays, no ledger row keeps the erased player number |
| Async deletion contract (202, signed out, status, lease, retry, purge after 720 h, audited requeue, 40 attempts / 5 min / 120 s) | PASS (existing, re-run) | `erasureQueue.pg.test.ts`, `erasureQueuePolicy.test.ts`, `erasureJobs.test.ts` at this head |
| Settlement exactly once under concurrency, bounded backoff | PASS (existing, re-run) | `settlementErasureRace.pg.test.ts`, `settlementHalt.pg.test.ts`, `settlementInvariants.pg.test.ts` |
| Gameplay off + 0000–0010 | PASS (existing, re-run) | `gameplayFlagOff.test.ts`; queue and purge on a database without 0011 touch only catalogue probes |
| Fairness and rule comparisons | NOT RUN (by design) | no code that changes outcomes was touched, so #180 stands; no new simulation |

## Still BLOCKED for a live pilot (owner)

1. Approval to promote 0011 at a named SHA, with the reviewed hashes above (promotion gate rows 1–2).
2. Verified database quota, a backup and a restore drill (rows 3–4).
3. Rule set and economy version approved in writing; 1003B is not ratified (row 10).
4. Gameplay flag, season start and pilot cap (rows 7, 12).
5. Handset QA and privacy texts for the build that would call gameplay (row 11).

Not evidence of hosted capacity: every result here is local and synthetic.
