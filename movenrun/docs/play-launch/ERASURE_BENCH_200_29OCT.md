# Gameplay account-erasure benchmark, 200 players (29 Oct 2026)

**LOCAL, SINGLE RUN, NOT A CAPACITY FIGURE.** One throwaway PostgreSQL 16.15 cluster on this machine (shared CPU, small
shared_buffers, nothing else tuned), one run per rule set, one seed. The numbers say how the erasure code behaves on a
small seeded world; they do not predict hosted latency, throughput or limits. Nothing here touched a hosted database,
a flag, a provider or an applied migration. The proposed migration 0011 (revision 3) was applied only to the
throwaway local databases.

Script: `backend/scripts/gameplay-erasure-bench.ts` (reuses the chain loader of `src/gameplay/pgTestDb.ts`; the cluster
helper is `scripts/gameplay-bench-cluster.sh`). Erasure goes through the real `createDrizzleAccountDeletionStore`.

```
bash scripts/gameplay-bench-cluster.sh init
bash scripts/gameplay-bench-cluster.sh start "autovacuum=off;deadlock_timeout=1s;log_lock_waits=on;track_counts=on;log_min_messages=warning"
MOVENRUN_BENCH_DATABASE_URL=postgres://bench@127.0.0.1:55432/postgres \
  node --import tsx scripts/gameplay-erasure-bench.ts --rules 1001|1002 --out bench.json
```

## What was seeded

200 synthetic users (`erasebench-walker-NNN`), seed 29, 6 simulated days (D .. D+5), written through the real
`GameplayService` (`applySession`, `createClub`, `joinClub`, `settleDay`) and the real erasure store. The user, auth
identity and `movement_verifications` rows (and, under rule 1002, the session-path rows) are inserted directly by SQL;
sessions, ledger, challenges, settlement, clubs and erasure go through the real service/store.
34 players are "heavy" (about 95% active, 2 sessions a day, 6 to 12 cells), the rest are active 35 to 75% of days
(1 to 2 sessions, 2 to 7 cells). Each player has a 30-cell home zone; 20% of visits go to a shared 40/60-cell hotspot, so
cells are contested. 10 clubs, 124 memberships. Days D .. D+2 are settled; D+3 .. D+5 are closed but unsettled (so
erasure meets both the tombstone path and the plain-delete path, and the concurrent phase has real settlement to run).

Two rule sets, because only 1002 writes challenges and session paths:

| | 1001 (default, immediate takeover) | 1002 (two-day challenge, resolution-10 paths) |
|---|---|---|
| sessions applied | 1,111 | 1,123 |
| ledger rows (push events) | 6,919 | 6,509 |
| open challenges | 0 (rule has none) | 1,193 |
| session paths | 0 | 1,123 |
| credit lines (3 settled days) | 395 | 464 |
| units / unit-day states | 468 / 2,420 | 629 / 2,931 |

Rule 1002 was used only as a seeded rule set in a local database; it is not enabled anywhere.

## Phases

Every phase runs on a fresh `CREATE DATABASE ... TEMPLATE` clone of the same seeded template, after a `CHECKPOINT`.
Targets: `single` = the player with most applied sessions; `seq10` = 10 players spread across the activity ranking, one
after another; `seq200` = all players one after another; `conc10` = 10 other players erased at once (10 parallel
connections) while `settleDay` runs for the three unsettled days, all started in the same tick; `settle-only` = the
same settlement with no erasures (the control for conc10's WAL).

## Results: wall time per erasure (ms)

| phase | rules | n | p50 | p95 | max | phase wall |
|---|---|---|---|---|---|---|
| single (heaviest player) | 1001 | 1 | 184 | 184 | 184 | 184 ms |
| single | 1002 | 1 | 275 | 275 | 275 | 275 ms |
| seq10 | 1001 | 10 | 136 | 163 | 163 | 1.36 s |
| seq10 | 1002 | 10 | 154 | 205 | 205 | 1.54 s |
| seq200 | 1001 | 200 | 77 | 129 | 174 | 15.9 s |
| seq200 | 1002 | 200 | 79 | 154 | 187 | 17.0 s |
| conc10 + settlement | 1001 | 10 | 818 | 1,656 | 1,656 | 1.72 s |
| conc10 + settlement | 1002 | 10 | 929 | 1,633 | 1,633 | 1.71 s |

With n = 1 or 10 the percentiles are just order statistics of very few samples. Concurrent erasures serialise on the
single `gameplay_erasure_fence` row (every erasure UPDATEs it first), which is the design; per-erasure latency in
conc10 is queueing behind that row plus the settlement transaction, so it is far above the sequential figure while the
phase wall time is about the same as 10 sequential erasures.

## Results: rows changed per table (net, row count after minus before)

Rows erased by account deletion, by table, for the whole 200 (negative = deleted). The tombstone and fence rows are
described below. `gameplay_credit_lines` is unchanged in count because each line is rewritten in place to a random
tombstone (395 / 464 UPDATEs), never deleted.

| table | seeded 1001 / 1002 | single 1001 / 1002 | seq10 1001 / 1002 | seq200 1001 / 1002 |
|---|---|---|---|---|
| users, auth_identities | 200 | -1 | -10 | -200 |
| movement_verifications | 1,111 / 1,123 | -12 / -12 | -61 / -62 | -1,111 / -1,123 |
| gameplay_applied_sessions | 1,111 / 1,123 | -12 / -12 | -61 / -62 | -1,111 / -1,123 |
| gameplay_session_paths | 0 / 1,123 | 0 / -12 | 0 / -62 | 0 / -1,123 |
| gameplay_push_events | 6,919 / 6,509 | -103 / -108 | -418 / -365 | -6,919 / -6,509 |
| gameplay_unit_challenges | 0 / 1,193 | 0 / -29 | 0 / -108 | 0 / -1,193 |
| gameplay_walker_days | 745 / 753 | -6 / -6 | -38 / -40 | -745 / -753 |
| gameplay_player_day_proofs | 378 / 379 | -3 / -3 | -22 / -19 | -378 / -379 |
| gameplay_players | 197 / 198 | -1 | -10 | -197 / -198 |
| gameplay_club_memberships | 124 | -1 | -7 | -124 |
| gameplay_credit_lines | 395 / 464 | 0 (3 rewritten) | 0 | 0 (all rewritten) |
| gameplay_erasure_days | 0 | +3 | +3 | +3 |
| pending_auth_user_deletions | 0 | +1 | +10 | +200 |
| security_audit_events (`account_deleted`) | 0 | +1 | +10 | +200 |

The store's own `ErasureResult` counts agreed with the movement-session and user counts above (seq200: 200 users,
200 identities, 1,111 / 1,123 movement sessions). Shared rows other players depend on (`gameplay_units`,
`gameplay_unit_day_states`, `gameplay_clubs`) keep their counts and are updated in place (for example 2,420
unit-day-state UPDATEs under 1001 in seq200), because erasure re-derives the holder-linked fields.

## Results: tombstones and fences after erasing all 200 (seq200)

Remaining on purpose, and nothing else naming an erased id (a LIKE scan over every `gameplay_*` table and partition for
the erased user ids found zero hits in every phase, for the ids erased in that phase):

- `gameplay_erasure_days`: 3 rows (one per settled day), hash-chained, `tombstones` summing to 395 (1001) / 464 (1002),
  equal to the number of credit lines.
- `gameplay_credit_lines`: all 395 / 464 lines now carry a random `tombstone_id` and no `player_id`.
- `gameplay_erasure_fence`: 1 row, `erasures = 200`.
- `security_audit_events`: 200 `account_deleted` events with no user id; `pending_auth_user_deletions`: 200 provider
  deletions queued (nothing was sent anywhere; the bench never calls a provider).
- Integrity after erasing everyone: `verifyDay` passes for all 3 settled days in every phase. After conc10, all 6 days
  verify (the settlement that ran concurrently was completed). `settlementStatus` shows not halted in every phase.

## Results: WAL (cluster-wide LSN difference)

`pg_current_wal_lsn()` before and after the phase on the whole cluster, after a `CHECKPOINT`, so it includes
anything else the cluster wrote in that window (nothing else was running, autovacuum off) and includes full-page
images for the first touch of each page after the checkpoint. It is not per-table or per-erasure WAL.

| phase | rules | WAL bytes |
|---|---|---|
| single | 1001 / 1002 | 1,092,752 / 1,553,360 |
| seq10 | 1001 / 1002 | 2,300,200 / 2,592,112 |
| seq200 | 1001 / 1002 | 5,938,816 / 7,096,680 |
| settlement only (control) | 1001 / 1002 | 443,400 / 497,312 |
| conc10 + settlement | 1001 / 1002 | 2,662,560 / 3,024,408 |

Roughly: a lone first erasure costs about 1 to 1.5 MB (mostly full-page images), 200 sequential cost about 6 to 7 MB
total (about 30 to 35 KB each on average). conc10 minus the settlement control is about 2.2 to 2.5 MB, comparable to seq10.

## Results: dead tuples (deltas from pg_stat_user_tables, no resets)

Autovacuum was off, so dead tuples are the garbage produced (no reclaim), summed over all tables with partitions folded
into their parent. Deltas = after minus before, taken after the writing backends exited so pending stats were flushed.
`n_dead_tup` is a gauge that HOT pruning can lower on its own, so the DELETE/UPDATE counters are the firmer figure.

| phase | rules | n_tup_del | n_tup_upd | n_tup_ins | n_dead_tup delta |
|---|---|---|---|---|---|
| single | 1001 / 1002 | 140 / 186 | 115 / 346 | 5 / 5 | 255 / 532 |
| seq10 | 1001 / 1002 | 637 / 755 | 518 / 760 | 23 / 23 | 1,056 / 1,375 |
| seq200 | 1001 / 1002 | 10,985 / 12,925 | 8,326 / 11,093 | 403 / 403 | 15,505 / 18,166 |
| conc10 + settlement | 1001 / 1002 | 608 / 778 | 530 / 787 | 761 / 867 | 1,127 / 1,378 |

Largest dead-tuple producers in seq200 (1001): `gameplay_push_events` 8,101 (6,919 deletes plus 4,346 updates, some
HOT), `gameplay_unit_day_states` 2,417, `gameplay_applied_sessions` and `movement_verifications` 1,111 each,
`gameplay_walker_days` 745. `gameplay_erasure_fence` shows 34 dead for 200 updates (HOT pruning), so the single hot row
does not accumulate bloat on its own in this run.

## Deadlocks and serialisation failures

- Deadlocks: 0 in every phase of both runs. `pg_stat_database.deadlocks` delta was 0 per clone, and the server log has
  no `deadlock detected` / `40P01`. No erasure returned an error in any phase (200/200 and 10/10 succeeded).
- Serialisation failures (40001) are expected by design (the fence makes a day close that overlapped an erasure fail
  and retry): 5 to 6 per run in the server log, all in conc10. `settleDay` retries 5 times with no backoff. The reported runs are one per rule set. In
  the review re-run, `settleDay` exhausted its five no-backoff retries on D+3 under 1001 and saw only a single 40001 on
  D+4 under 1002 (the original run saw the reverse), so exhaustion is possible under either rule set and the day it
  hits varies. When it exhausted, `40001` reached the caller after about 1.3 to 1.5 s; a plain retry afterwards settled
  it, and `verifyDay` passed for all days. So the maintenance loop will see occasional `40001` errors from a day close during a burst of
  erasures and must simply try again next tick (it does, as `settleDueDays` re-selects unsettled days); worth knowing
  when reading logs. This is one observation each, not a rate.

## After the fence-order fix (re-run, 29 Oct)

Cause of the 40001s above: the day close took its advisory day lock (a query, which fixes a SERIALIZABLE snapshot)
before the fence row `FOR SHARE`. Every erasure that committed while the close waited on the fence aborted it ("could
not serialize access due to concurrent update", logged on `SELECT 1 FROM gameplay_erasure_fence FOR SHARE` in a base
re-run, five times, then the raw 40001 reached the caller on D+3 under 1001). The close now takes
`LOCK TABLE gameplay_erasure_fence IN SHARE MODE` before any query, so its snapshot is taken after the erasures ahead of
it have committed, and remaining contention is retried with bounded, jittered backoff and a typed
`settlement_retry_exhausted` outcome (`docs/G34_ERASURE_TOMBSTONES.md` section 1.5).

Re-run on the same kind of throwaway local cluster, same seed, one run per rule set:

| | 1001 | 1002 |
|---|---|---|
| 40001 in the server log | 0 | 0 |
| 40P01 / `pg_stat_database.deadlocks` delta | 0 / 0 | 0 / 0 |
| conc10 settlement, all three days settled in the burst | yes | yes |
| conc10 phase wall | 1.71 s | 2.64 s |
| conc10 per-erasure p50 / max | 874 / 1,649 ms | 1,292 / 2,526 ms |
| erasure errors | 0 / 10 | 0 / 10 |
| verifyDay after conc10 | all 6 days pass | all 6 days pass |
| halted | no | no |

The close now waits for the erasures queued ahead of it instead of failing and retrying, so one day's close in conc10
took 1.1 to 1.6 s (the queue), and the follow-up "next tick" pass found nothing left to settle. One run each, not a rate;
the deterministic evidence is `backend/src/gameplay/settlementErasureRace.pg.test.ts`.

Note: an independent re-run on a throwaway cluster matched (0 40001, 0 40P01, all 6 days verify, not halted), with conc10 wall 1.64 / 1.96 s against the 1.71 / 2.64 s stated above.

## Caveats

- Local, one machine, one run per rule set; concurrency outcomes (who wins the fence, whether the settlement exhausts
  retries) vary run to run.
- 200 players and 6 days of history: per-erasure cost here scales with that player's rows, and with the table sizes only
  weakly; it says nothing about 5,000 players or a full season.
- Autovacuum off, so dead tuples are not reclaimed and do not show autovacuum's cost or its effect on latency.
- WAL is cluster-wide, with full-page images after a checkpoint; a warm production cluster will differ.
- Synthetic walkers on a synthetic grid with a simple activity model; movement sealing uses the test fixture, not real routes.
- Template-cloned databases start with empty statistics counters, which is why deltas, not absolutes, are reported.
- Provider deletion (Supabase Auth) is only queued; it is not exercised.
