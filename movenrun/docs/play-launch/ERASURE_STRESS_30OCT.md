# Account erasure under live gameplay load: before and after the queue (30 Oct 2026)

**LOCAL, SYNTHETIC, NOT A CAPACITY FIGURE.** One throwaway PostgreSQL 16 cluster on a shared 4-CPU machine
(`scripts/gameplay-bench-cluster.sh`, port 55433, shared_buffers 256 MB, max_connections 200, autovacuum on,
deadlock_timeout 1 s, log_lock_waits on). Synthetic users, cells and sessions; no provider, no hosted database, no
flag, no applied migration was touched. The proposed 0011 was applied only to throwaway databases. These numbers do
not predict hosted latency or throughput. No real user deletion is involved.

Script: `backend/scripts/gameplay-erasure-stress.ts` (new). Every repeat runs on a fresh clone of one seeded template.

| setting | value |
|---|---|
| code, before | `dfd3a08` (feat/g34-server-holdings with #181), harness copied in unchanged |
| code, after | `9f58432` (this branch) |
| world | 200 players, seed 29, days D..D+5, D..D+2 settled, 1,111 seeded sessions (as the 29 Oct bench) |
| erasure requests | 200 (each player once, seeded order), 24 concurrent client loops |
| load | 12 pusher loops applying new verified sessions for players not yet asked to be deleted; 1 closer calling `settleDueDays` every 500 ms; the game day advances every 4 s of wall time |
| pool | max 40, statement_timeout 10 s, query_timeout 10 s, connect timeout 5 s (production client limits; production pool size is 10) |
| client timeout | 10 s: a request whose initiation took longer counts as a client timeout even if the server finished |
| sync path | `store.erase` during the request (before: no lock budget; after: lock_timeout 5 s, typed 503) |
| async path | `store.request` (acceptance + job), 1 in-process worker kicked after each acceptance and every 1 s, drained while the load keeps running (cap 300 s) |
| arrivals | burst (each loop asks as soon as it is free) for three repeats; one extra repeat each with steady arrivals, one request every 250 ms |

## Results

Initiation = time until the request returned. Completion = request to database erasure committed (sync: same as
initiation when it succeeded). HTTP mapping: before, every non-typed error is a 500; after, transient failures are 503
`deletion_busy` and an accepted job is 202. "Outstanding" = requests not erased when the requests ended -> at the end.

| run | initiation ms p50/p90/p95/p99/max | completion ms p50/p90/p95/p99/max | completed | client > 10 s | HTTP 200/202/503/500 | outstanding | job retries | lock-wait backend-s / log waits > 1 s | deadlocks / 40001 / 57014 (server log) | days settled during run |
|---|---|---|---|---|---|---|---|---|---|---|
| before sync r1 | 6147 / 10004 / 10007 / 10747 / 11104 | 5306 / 8383 / 9199 / 10238 / 11104 | 141 | 53 | 141 / 0 / 0 / 59 | 59 -> 59 | - | 1732 / 557 | 90 / 0 / 47 | 11 |
| before sync r2 | 7046 / 10002 / 10003 / 10008 / 12013 | 5409 / 8856 / 9312 / 9600 / 12013 | 126 | 63 | 126 / 0 / 0 / 74 | 74 -> 74 | - | 1900 / 774 | 103 / 0 / 61 | 17 |
| before sync r3 | 5760 / 10002 / 10003 / 10007 / 10355 | 4664 / 8083 / 9292 / 10039 / 10355 | 143 | 49 | 143 / 0 / 0 / 57 | 57 -> 57 | - | 1617 / 673 | 108 / 0 / 47 | 15 |
| after sync r1 | 7350 / 10003 / 10006 / 10073 / 11020 | 4972 / 9160 / 9892 / 10306 / 11020 | 117 | 61 | 117 / 0 / 83 / 0 | 83 -> 83 | - | 1898 / 753 | 133 / 0 / 60 | 18 |
| after sync r2 | 6006 / 10002 / 10005 / 10019 / 11044 | 5286 / 8848 / 9529 / 10169 / 11044 | 145 | 46 | 145 / 0 / 55 / 0 | 55 -> 55 | - | 1688 / 704 | 143 / 0 / 43 | 16 |
| after sync r3 | 5686 / 10003 / 10004 / 10066 / 10201 | 5223 / 8935 / 9639 / 10151 / 10201 | 139 | 51 | 139 / 0 / 61 / 0 | 61 -> 61 | - | 1670 / 745 | 130 / 0 / 48 | 15 |
| after async r1 | 29 / 75 / 83 / 93 / 97 | 30594 / 52881 / 54575 / 56693 / 60943 | 200 | 0 | 0 / 200 / 0 / 0 | 200 -> 0 | 14 (deadlock) | 35 / 0 | 14 / 1 / 0 | 18 |
| after async r2 | 23 / 59 / 70 / 84 / 95 | 30420 / 53353 / 55237 / 57369 / 59983 | 200 | 0 | 0 / 200 / 0 / 0 | 200 -> 0 | 14 (deadlock) | 35 / 0 | 14 / 0 / 0 | 18 |
| after async r3 | 22 / 48 / 65 / 68 / 72 | 30337 / 51429 / 54286 / 55402 / 55635 | 200 | 0 | 0 / 200 / 0 / 0 | 200 -> 0 | 13 (deadlock) | 32 / 0 | 13 / 0 / 0 | 16 |
| before sync, steady 4/s | 7612 / 10004 / 10007 / 10093 / 10170 | 4468 / 9126 / 9530 / 10158 / 10170 | 120 | 73 | 120 / 0 / 0 / 80 | 80 -> 80 | - | 1919 / 844 | 241 / 0 / 70 | 18 |
| after async, steady 4/s | 4 / 11 / 15 / 26 / 32 | 17995 / 44209 / 56307 / 66116 / 68765 | 200 | 0 | 0 / 200 / 0 / 0 | 89 -> 0 | 20 (deadlock) | 631 / 127 | 269 / 0 / 0 | 29 |

Failure detail. Before: 57014 statement timeout 12-17, 40P01 deadlock 10-13, client query timeout ("Query read
timeout", no SQL code) 30-49 per run, all as raw 500s. After, sync: the same failures, now typed (`busy:connection`
29-42, `busy:statement_timeout` 10-19, `busy:deadlock` 8-9, `busy:lock_timeout` 3-17), all 503 with nothing written.
After, async: every request accepted; the only failed attempts were 13-20 deadlocks per run, each retried and completed;
no job reached needs_attention. In every run of every mode: `verifyDay` passed for every settled day, settlement was
never halted, and no gameplay, identity, session, movement or audit row named an erased player.

Every run of every mode settled days during the run (11-29). The closer's own raw `40P01` (5-26 per run, both before
and after) comes from `ensurePartitions` in `settleDueDays`, which is not retried (a known limit since 29 Oct); the
next run settles the day.

### Completion over time

Steady arrivals, one request every 250 ms (above the about 3.3 erasures per second one worker sustains here), 10 s
buckets by request time:

| requested in | before: requested / erased / p50 / max ms | after: requested / erased / p50 / max ms |
|---|---|---|
| 0-10 s | 41 / 28 / 1507 / 10170 | 40 / 40 / 5686 / 25574 |
| 10-20 s | 33 / 20 / 4009 / 9969 | 41 / 41 / 11971 / 38513 |
| 20-30 s | 30 / 13 / 3910 / 9342 | 39 / 39 / 17841 / 68765 |
| 30-40 s | 39 / 22 / 3290 / 7881 | 41 / 41 / 23879 / 65582 |
| 40-50 s | 29 / 15 / 5782 / 10093 | 39 / 39 / 41555 / 61777 |
| 50-60 s | 28 / 22 / 5827 / 9826 | (all 200 asked by 50 s) |

Queue depth, after, steady run: open jobs grew to 87 at 50 s while requests arrived and pushers held unit rows, then
fell at about 1.6 per second to 0 at 105 s. Burst run r1: 200 open at 0.3 s, falling linearly to 0 at 61 s (8 to 10
completions per 2 s).

## What this shows, and what it does not

- **Old failure (before):** under this load 28-40% of synchronous erasure requests failed (57-74 of 200 per burst run,
  80 in the steady run) and 25-37% exceeded the 10 s client budget; failures were raw 500s, the account stayed fully
  active, and nothing remembered the request. This is the 29 Oct finding reproduced (24-28% timeouts there, with a
  different harness that was not committed), on the exact base SHA.
- **Typed timeout alone (after, sync):** the same share of failures (27-42%), now honest (503, Retry-After, nothing
  written). It is a safety backstop, not a fix; with gameplay on the sync path is not used.
- **Queue (after, async):** 0 of 800 requests failed. Acceptance latency on this machine: burst runs p50 22-29 ms, p99 68-93 ms, max 97 ms; steady
  run p99 26 ms. An independent rerun on the same machine measured p50 23 ms, p95 116 ms, p99 147 ms, max 149 ms. These
  are local figures, not a hosted latency bound. 800 of 800 erasures
  completed while day close kept settling; no request was lost. The price is completion latency: erasures still run
  one at a time behind the fence (about 300 ms each), so completion time grows with the backlog (p50 18-31 s, max 69 s
  here). Throughput did not improve and is not claimed to.
- **Not a like-for-like load in the burst runs:** in async burst runs all 200 players were asked within 0.3 s, so
  pushers had almost no one left to push for (15 pushes vs 4,470-8,702 before). The steady runs keep pushing for 50 s
  (3,587 vs 3,859 pushes) and are the fairer comparison; the conclusion is the same.
- **Deadlocks** (log `deadlock detected`, 13-269 per run in every mode, before and after) are the pre-existing cycle
  between a push holding unit rows and an erasure holding the user row (`G34_ERASURE_QUEUE.md` section 4), plus
  partition creation. The queue retries its side; it does not remove the cycle. No new 40001 storm: 0-1 per run.
- Synthetic, local, one machine, 3 repeats (1 for steady); concurrency outcomes vary run to run.

```
bash scripts/gameplay-bench-cluster.sh init   # BENCH_PG_DIR=/tmp/movenrun-pgbench-erq BENCH_PG_PORT=55433
bash scripts/gameplay-bench-cluster.sh start "autovacuum=on;deadlock_timeout=1s;log_lock_waits=on;max_connections=200;log_min_messages=warning"
MOVENRUN_BENCH_DATABASE_URL=postgres://bench@127.0.0.1:55433/postgres \
  node --import tsx scripts/gameplay-erasure-stress.ts --mode sync|async --repeats 3 [--interval-ms 250] \
  --server-log /tmp/movenrun-pgbench-erq/server.log --out out.json
```
