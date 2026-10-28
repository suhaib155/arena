# G34 HOT-friendly challenge writes versus targeted autovacuum, and the day-14 benchmark reproduced

**Status: MEASUREMENT AND PROPOSAL. No runtime behaviour changed; nothing is activated.**
- Branch `bench/g34-hot-autovacuum`, built on the merged storage lifecycle base (`feat/g34-server-holdings` at 6429a30). Only bench scripts and this document are added. `service.ts`, `rules.ts` and settlement code are untouched. The HOT-friendly and diff-only write paths exist **only inside `backend/scripts/gameplay-challenge-burst.ts`** (bench code), so there is no runtime flag to switch and none that can default on.
- Migration 0011 stays in `backend/drizzle-proposed/`; the drizzle journal (0000-0010) is untouched. No hosted call of any kind was made.
- Evidence labels used below: **LOCAL POSTGRES VERIFIED** = measured on a throwaway local PostgreSQL 16.15 cluster that was created for the run (own data directory, own port, nothing else writing to it) and dropped afterwards; **SIMULATION ONLY** = a model or extrapolation from those measurements.
- **Physical quota is unknown.** 500 MiB is the planning assumption (Supabase Free's published allowance). The owner must confirm the project's real quota and current usage in the provider dashboard. Every percentage below is of that assumed 500 MiB.
- **Never run VACUUM FULL on hosted production.** Every "after VACUUM FULL" figure is a diagnostic on a throwaway local database, to show how much of a table is reclaimable space. Hosted guidance in this document is plain VACUUM and autovacuum tuning only (section 5).

## 1. Summary

1. **Both earlier day-14 figures are reproduced, and neither is a forecast.** The same 1,000-player, 14-day, rule-set-1002 workload gives 0011 totals from **54.5 MiB to 250 MiB** depending only on how often autovacuum wakes (`autovacuum_naptime` 1 s to 300 s or off). 116.8 MiB sits between the 30 s and 45 s settings (111.0 and 121.9 MiB); 146.9 MiB sits between the bench-as-is 60 s run (141.7) and 60 s runs with no bench-side VACUUM (152.6 to 162.2). Repeating one setting (60 s) three times gave 152.6, 157.7 and 162.2 MiB. The table that moves is `gameplay_unit_challenges`; every other 0011 table is the same to within about 1 MiB in all runs (section 3).
2. **Cause.** The bench applies 14 days of sessions in about two minutes, so autovacuum with the default 60 s naptime gets about two turns; each session deletes and re-inserts the touched units' challenge rows (about 164 rows per session at 1,000 players), leaving about 2.05 million dead tuples against 23,000 live rows. Dead space only gets reused once a vacuum has run. At walking pace autovacuum gets ~1,440 turns a day, which is why the compressed bench over-states this table (it also over-stated it in the original reports).
3. **Targeted per-table autovacuum and HOT-friendly writes attack different things.** Under a compressed 24 h the table stays at 3 to 5 MiB with any variant when autovacuum is scaled to the compression; what separates the variants is **WAL, CPU and lock time**, not storage. Per-table autovacuum settings do not reduce WAL or CPU (WAL +5% against baseline in the paced run). Writing only what changed (diff-only) cut WAL by 57% (paced) to 73% (saturated) and raised saturated throughput 1.7x; updating unchanged rows in place with fillfactor 80 cut WAL by 34% to 44% with 98% HOT updates, but still writes every row, so its gain is smaller. (Section 4.)
4. **No retries, no deadlocks, no lock timeouts** occurred in any variant at 8 or 16 clients; lock-wait time was shorter for the variants that write less.
5. **Recommendation (OWNER DECISION, not made here):** (a) per-table autovacuum for `gameplay_unit_challenges` in the promotion runbook, because the 60 s default lags a burst; (b) review a diff-only challenge write as a separate service change, measured with `gameplay-challenge-burst.ts` before and after; the in-place variant is a weaker option; (c) keep `fillfactor` at default unless in-place updates are adopted. Section 5 has the hosted-safe procedure.

## 2. Method

- **Harness.** `backend/scripts/gameplay-storage-bench.ts` (from the merged lifecycle work) drives the real `GameplayService` with synthetic players, applies the committed migrations 0000-0010 and the proposed 0011 revision 3, and measures sizes. Changes here: a `--profile matrix --scenario-json` mode, a pre-VACUUM statistics capture (dead tuples, HOT updates, autovacuum counts, sizes of every table including day partitions), and a `noMidVacuum` option that skips the bench's own database-wide VACUUM on day 2 (the "retries" probe), so that autovacuum alone governs the day-14 reading.
- **Cluster.** `backend/scripts/gameplay-bench-cluster.sh` creates a throwaway cluster on 127.0.0.1 (trust auth, own port). `gameplay-bench-matrix.sh` restarts it with each run's settings, runs one scenario, and keeps the server log with `log_autovacuum_min_duration=0`. WAL is read from the cluster's LSN, so it is only meaningful because nothing else writes to the cluster. Each scenario creates its own database and drops it afterwards.
- **Hardware.** 4 vCPU shared host with other jobs running (load average 3 to 9), 16 GiB RAM, PostgreSQL 16.15, `shared_buffers` 256 MB, default WAL and checkpoint settings. Wall-clock figures are noisy because of that; byte, WAL and row counts are not.
- **What "differing autovacuum timings" means.** Cluster-level `autovacuum_naptime` (1 s, 15 s, 20 s, 30 s, 45 s, 60 s, 90 s, 120 s, 300 s), autovacuum off, `autovacuum_vacuum_cost_delay` 0 and 20 ms, and with or without the bench's own VACUUM on day 2 and VACUUM ANALYZE at day 7.
- **Disaggregation.** Heap = main fork; Indexes; TOAST (with its index); FSM/VM = the free-space and visibility map forks (total minus the others); dead tuples = `n_dead_tup` summed over a table's partitions just before the measurement VACUUM, with an estimated byte share (heap x dead / (live + dead)); WAL = cluster LSN difference over the daily writes and settlements (the bench's measurement VACUUMs excluded); temp = `pg_stat_database.temp_bytes` (settlement sort spill) which was **0 in every run**.
- **Scaling.** 200, 500, 1,000 and 5,000 players were all run for the full 14 days (nothing scaled down). Hostile accounts: 0, 2 and 10% at 200 and 500 players, 2% at 1,000; **10% at 1,000 and any hostile run at 5,000 were not run** (each hostile account is 20 sessions a day of 500 units; the 500-player 10% run already took 577 s of 14 days compressed). One versus four seasons is a model (section 3.4), not a measurement: four seasons is 360 days.
- **Synthetic burst (task 2).** `gameplay-challenge-burst.ts`: the real 0011 schema, 20,000 units, 5,000 of them contested (about 25,000 live challenge rows, the size the 1,000-player bench reaches), 31 units a batch (calibrated: 200-player bench, 2,544 sessions, 31 units and about 36 rewritten challenge rows a session), 30% of batches in a 400-unit hot area, units locked in sorted order with `SELECT ... FOR UPDATE`, `lock_timeout` 2 s, up to 8 retries. Every variant sees the same seeded trace. Batch cost covers the unit lock, the unit update and the challenge writes (not the push ledger), so absolute WAL is lower than a full session; differences between variants are attributable to the challenge write path. Variants: `baseline` = today's delete-then-insert; `targeted-av` = baseline + `autovacuum_vacuum_scale_factor 0, threshold 200, cost_delay 0, analyze_scale_factor 0.05` on the table; `inplace-ffNN` = UPDATE rows that stay open (only non-indexed columns in SET, so heap-only is possible), DELETE closed, INSERT new, with fillfactor 100 or 80; `diff-ffNN` = write nothing for unchanged rows; `-av` adds the targeted settings.
- **Compression.** Paced runs: one day of 5,000 players (4,500 sessions) over 15 minutes on a 24-slot diurnal curve (96x). PostgreSQL's real naptime of 60 s corresponds to 0.6 s at that compression, so the 1 s setting is the faithful one and the `nap60` runs show what happens if the burst is compressed but autovacuum is not. Saturation runs push 20,000 batches as fast as 8 or 16 clients can.
- **CPU.** Client backend CPU is read from `/proc` for the burst's own connections; autovacuum CPU is summed from the cluster log. Background-writer CPU was not reliably measurable (processes restart between runs) and is shown n/m. These are the only CPU figures; there is no whole-host CPU claim.



## 3. Day-14 benchmark reproduction (task 1)

### 3.0 Prior results and what was reproduced

| Prior result | Where | Reproduced here | Explanation |
|---|---|---|---|
| 0011 total 146.9 MiB at 1,000 players, day 14 (WAL 978 MiB, 40.4 MiB after VACUUM FULL) | storage capacity doc section 14 | 141.7 MiB (a1, bench as is, 60 s), 152.6 / 157.7 / 162.2 MiB (60 s, no bench VACUUM); WAL 979 to 994 MiB; VACUUM FULL 40.4 MiB | Bloat of `gameplay_unit_challenges` after 2 autovacuum turns |
| 116.8 MiB (Track B local re-run; same WAL and VACUUM FULL size) | Track B report | 111.0 MiB (30 s), 121.9 MiB (45 s), 108.3 MiB (a17: bench as is, 60 s, repeat 2) | Autovacuum happened to run more often relative to the load; run-to-run spread at one setting is about 20 MiB |
| 40.4 MiB after VACUUM FULL, WAL ~978 MiB | both | 40.4 MiB in every run; WAL 979 to 1,003 MiB in every run | These do not depend on autovacuum timing, so they replicate exactly |

Neither bloated figure is exact; both are samples from a distribution set by autovacuum timing. **Do not use either as a forecast.** The planning number for storage should be built from the table's live size (about 3.7 MiB compact per 1,000 players) times a bloat factor that depends on the vacuum regime actually configured (section 3.4).



### 3.1 Autovacuum timing, 1,000 players. Same workload, different autovacuum timing (1,000 players, 14 days, rule set 1002, res 10, dense, 0% hostile)

LOCAL POSTGRES VERIFIED. MiB. "0011 after VACUUM" is the bench's own measurement (a VACUUM ANALYZE just before it, as in the original runs). "0011 before VACUUM" is the same tables read just before that VACUUM. Challenges = `gameplay_unit_challenges` (heap + indexes + TOAST) before the VACUUM.

| Run | Wall s | 0011 before VACUUM | 0011 after VACUUM | Challenges before VACUUM | Challenge dead tuples | Autovacuum runs on challenges | Autovacuum CPU s (all tables) | WAL MiB | Temp MiB | Database MiB | 0011 after VACUUM FULL (diagnostic) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| a1-asis-default | 137 | 141.6 | 141.7 | 99.5 | 911,044 | 2 | 0.03 | 979 | 0.0 | 161.2 | 40.4 |
| a2-av-60s | 127 | 162.0 | 162.2 | 120.2 | 757,106 | 2 | 0.26 | 994 | 0.0 | 181.9 | 40.4 |
| a3-av-15s | 134 | 83.4 | 83.2 | 41.4 | 52,379 | 9 | 0.36 | 995 | 0.0 | 102.7 | 40.4 |
| a4-av-1s | 131 | 56.8 | 56.8 | 14.2 | 0 | 83 | 0.52 | 1002 | 0.0 | 76.4 | 40.5 |
| a5-av-off | 140 | 249.8 | 250.2 | 208.0 | 2,054,111 | 0 | 0.00 | 979 | 0.0 | 269.5 | 40.5 |
| a6-av-1s-cost0 | 124 | 59.8 | 59.9 | 17.1 | 0 | 75 | 0.51 | 1000 | 0.0 | 79.5 | 40.4 |
| a7-nap20s | 132 | 89.5 | 89.6 | 47.5 | 117,255 | 6 | 0.36 | 992 | 0.0 | 109.3 | 40.4 |
| a8-nap30s | 133 | 111.0 | 111.0 | 69.1 | 128,341 | 4 | 0.39 | 995 | 0.0 | 130.7 | 40.4 |
| a9-nap45s | 132 | 121.7 | 121.9 | 80.1 | 679,794 | 2 | 0.30 | 990 | 0.0 | 141.4 | 40.4 |
| a10-nap60s-rep2 | 132 | 157.6 | 157.7 | 115.6 | 89,044 | 2 | 0.43 | 994 | 0.0 | 177.3 | 40.4 |
| a11-nap60s-rep3 | 136 | 152.5 | 152.6 | 110.5 | 169,439 | 2 | 0.44 | 994 | 0.0 | 172.3 | 40.4 |
| a12-nap90s | 136 | 184.6 | 184.7 | 142.6 | 696,918 | 1 | 0.31 | 990 | 0.0 | 204.4 | 40.4 |
| a13-nap120s | 145 | 226.9 | 227.1 | 184.9 | 305,904 | 1 | 0.45 | 995 | 0.0 | 246.7 | 40.4 |
| a14-nap300s | 149 | 250.0 | 250.4 | 208.1 | 2,059,318 | 0 | 0.00 | 980 | 0.0 | 269.7 | 40.4 |
| a15-nap60s-cost20ms | 168 | 133.0 | 133.1 | 91.1 | 475,020 | 2 | 0.41 | 990 | 0.0 | 152.8 | 40.4 |
| a16-asis-nap30s | 193 | 86.4 | 85.7 | 44.5 | 85,955 | 6 | 0.36 | 992 | 0.0 | 105.2 | 40.4 |
| a17-asis-nap60s-rep2 | 151 | 108.3 | 108.3 | 66.3 | 459,481 | 2 | 0.22 | 984 | 0.0 | 127.8 | 40.4 |


### 3.2 Disaggregation by autovacuum setting. Where the bytes are, per autovacuum setting (1,000 players)

LOCAL POSTGRES VERIFIED. MiB, all 0011 tables, read just before the measurement VACUUM. Dead-tuple bytes are an ESTIMATE (heap x dead / (live + dead)). "FSM/VM" is the free-space and visibility map forks. WAL is the cluster's WAL from the daily writes and settlements. Temp is the settlement sort spill.

| Run | Players / hostile accts | Heap | Indexes | TOAST | FSM/VM | Total | of which challenges heap+idx | Dead tuples (rows) | Dead bytes (est.) | movement_verifications | WAL MiB | Temp MiB | Worst settlement ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a1-asis-default | 1000 / 0 | 106.1 | 33.9 | 0.2 | 1.3 | 141.6 | 99.4 | 914,650 | 82.2 | 7.9 | 979 | 0.0 | 238 |
| a2-av-60s | 1000 / 0 | 126.1 | 34.4 | 0.2 | 1.2 | 162.0 | 120.2 | 760,021 | 101.7 | 7.9 | 994 | 0.0 | 237 |
| a3-av-15s | 1000 / 0 | 54.7 | 27.2 | 0.2 | 1.3 | 83.4 | 41.4 | 54,043 | 23.1 | 7.9 | 995 | 0.0 | 240 |
| a4-av-1s | 1000 / 0 | 31.7 | 23.6 | 0.2 | 1.3 | 56.8 | 14.2 | 2,946 | 0.3 | 7.9 | 1002 | 0.0 | 261 |
| a5-av-off | 1000 / 0 | 207.7 | 40.9 | 0.2 | 1.0 | 249.8 | 208.0 | 2,062,449 | 184.0 | 7.9 | 979 | 0.0 | 214 |
| a6-av-1s-cost0 | 1000 / 0 | 34.4 | 23.9 | 0.2 | 1.3 | 59.8 | 17.0 | 1,861 | 0.3 | 7.9 | 1000 | 0.0 | 241 |
| a7-nap20s | 1000 / 0 | 59.8 | 28.2 | 0.2 | 1.3 | 89.5 | 47.4 | 119,549 | 32.1 | 7.9 | 992 | 0.0 | 245 |
| a8-nap30s | 1000 / 0 | 79.0 | 30.5 | 0.2 | 1.3 | 111.0 | 69.1 | 129,662 | 48.9 | 7.9 | 995 | 0.0 | 249 |
| a9-nap45s | 1000 / 0 | 88.9 | 31.3 | 0.2 | 1.2 | 121.7 | 80.0 | 682,479 | 65.3 | 7.9 | 990 | 0.0 | 266 |
| a10-nap60s-rep2 | 1000 / 0 | 119.0 | 37.1 | 0.2 | 1.3 | 157.6 | 115.6 | 90,141 | 79.7 | 7.9 | 994 | 0.0 | 201 |
| a11-nap60s-rep3 | 1000 / 0 | 115.1 | 35.9 | 0.2 | 1.3 | 152.5 | 110.5 | 171,005 | 85.1 | 7.9 | 994 | 0.0 | 251 |
| a12-nap90s | 1000 / 0 | 146.1 | 37.0 | 0.2 | 1.2 | 184.6 | 142.5 | 699,415 | 120.3 | 7.9 | 990 | 0.0 | 264 |
| a13-nap120s | 1000 / 0 | 185.8 | 39.6 | 0.2 | 1.3 | 226.9 | 184.9 | 307,638 | 154.7 | 7.9 | 995 | 0.0 | 239 |
| a14-nap300s | 1000 / 0 | 207.8 | 41.0 | 0.2 | 1.0 | 250.0 | 208.0 | 2,067,768 | 184.1 | 7.9 | 980 | 0.0 | 224 |
| a15-nap60s-cost20ms | 1000 / 0 | 97.8 | 33.8 | 0.2 | 1.2 | 133.0 | 91.1 | 477,199 | 72.4 | 7.9 | 990 | 0.0 | 324 |
| a16-asis-nap30s | 1000 / 0 | 56.8 | 28.0 | 0.2 | 1.4 | 86.4 | 44.5 | 87,382 | 27.8 | 7.9 | 992 | 0.0 | 485 |
| a17-asis-nap60s-rep2 | 1000 / 0 | 76.6 | 30.1 | 0.2 | 1.3 | 108.3 | 66.2 | 461,723 | 52.5 | 7.9 | 984 | 0.0 | 237 |


### 3.2b Per table (stock 60 s run). Per table, run a2-av-60s (before VACUUM)

| Table | Rows | Heap | Indexes | TOAST | Total | Dead tuples | Autovacuum runs | Inserts | Updates | HOT updates | Deletes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| gameplay_unit_challenges | 23,055 | 103.98 | 16.17 | 0.01 | 120.22 | 757,106 | 2 | 2,076,532 | 0 | 0 | 2,054,007 |
| gameplay_push_events | 111,899 | 8.62 | 10.95 | 0.00 | 19.97 | 0 | 11 | 111,313 | 0 | 0 | 0 |
| gameplay_session_paths | 12,667 | 4.62 | 1.02 | 0.01 | 5.67 | 0 | 2 | 12,667 | 0 | 0 | 0 |
| gameplay_applied_sessions | 12,667 | 2.49 | 2.30 | 0.01 | 4.83 | 0 | 2 | 12,601 | 0 | 0 | 0 |
| gameplay_walker_days | 8,441 | 2.02 | 0.56 | 0.13 | 3.12 | 436 | 11 | 8,399 | 12,601 | 12,263 | 3 |
| gameplay_credit_lines | 9,635 | 1.30 | 1.47 | 0.01 | 2.81 | 0 | 2 | 9,635 | 0 | 0 | 0 |
| gameplay_unit_day_states | 15,104 | 1.05 | 0.95 | 0.00 | 2.03 | 1,837 | 2 | 15,101 | 101,740 | 98,759 | 0 |
| gameplay_player_day_proofs | 8,441 | 0.75 | 0.34 | 0.01 | 1.13 | 0 | 2 | 8,441 | 0 | 0 | 0 |
| gameplay_club_days | 1,400 | 0.51 | 0.07 | 0.01 | 0.61 | 0 | 0 | 1,400 | 0 | 0 | 0 |
| gameplay_units | 1,232 | 0.27 | 0.12 | 0.01 | 0.43 | 642 | 2 | 1,232 | 116,841 | 114,266 | 0 |
| gameplay_players | 1,000 | 0.16 | 0.13 | 0.01 | 0.32 | 0 | 0 | 1,000 | 0 | 0 | 0 |
| gameplay_club_memberships | 701 | 0.10 | 0.17 | 0.01 | 0.30 | 0 | 0 | 701 | 0 | 0 | 0 |
| gameplay_unit_districts | 2,238 | 0.13 | 0.09 | 0.01 | 0.26 | 0 | 1 | 2,238 | 0 | 0 | 0 |
| gameplay_district_days | 42 | 0.07 | 0.02 | 0.01 | 0.12 | 0 | 0 | 42 | 0 | 0 | 0 |
| gameplay_day_rules | 14 | 0.05 | 0.03 | 0.01 | 0.11 | 0 | 0 | 14 | 0 | 0 | 0 |
| gameplay_clubs | 100 | 0.02 | 0.03 | 0.01 | 0.08 | 0 | 0 | 100 | 0 | 0 | 0 |
| gameplay_day_settlements | 14 | 0.01 | 0.03 | 0.01 | 0.05 | 0 | 0 | 14 | 0 | 0 | 0 |


### 3.3 Players by hostile share. Players by hostile share (14 days, cluster autovacuum defaults, no bench-side VACUUM before day 14)

LOCAL POSTGRES VERIFIED. Hostile accounts each run 20 sessions a day of 500 units (a 300-unit daily budget applies). MiB.

| Run | Players | Hostile accounts | Sessions (normal + hostile) | 0011 before VACUUM | 0011 after VACUUM | Challenges before VACUUM | 0011 after VACUUM FULL (diagnostic) | Database MiB | WAL MiB | Wall s |
|---|---|---|---|---|---|---|---|---|---|---|
| c200-h0 | 200 | 0 | 2,544 + 0 | 20.6 | 20.8 | 6.9 | 11.5 | 33.6 | 72 | 49 |
| c200-h2 | 200 | 4 | 2,487 + 1,120 | 24.2 | 24.5 | 8.0 | 14.0 | 38.2 | 108 | 67 |
| c200-h10 | 200 | 20 | 2,487 + 5,600 | 36.0 | 35.8 | 8.9 | 24.4 | 53.5 | 275 | 145 |
| c500-h0 | 500 | 0 | 6,313 + 0 | 60.2 | 60.4 | 35.9 | 22.6 | 76.0 | 292 | 111 |
| c500-h2 | 500 | 10 | 6,264 + 2,800 | 53.8 | 54.0 | 23.3 | 28.9 | 71.7 | 390 | 172 |
| c500-h10 | 500 | 50 | 6,337 + 14,000 | 75.4 | 75.6 | 17.9 | 55.2 | 102.7 | 942 | 577 |
| c1000-h2 | 1,000 | 20 | 12,434 + 5,600 | 97.3 | 97.4 | 43.1 | 52.9 | 121.5 | 1213 | 439 |
| c5000-h0 | 5,000 | 0 | 63,248 + 0 | 521.8 | 521.8 | 344.8 | 181.8 | 574.1 | 22523 | 1183 |


### 3.3b Disaggregation of the grid. Disaggregation per grid run

LOCAL POSTGRES VERIFIED. MiB, all 0011 tables, read just before the measurement VACUUM. Dead-tuple bytes are an ESTIMATE (heap x dead / (live + dead)). "FSM/VM" is the free-space and visibility map forks. WAL is the cluster's WAL from the daily writes and settlements. Temp is the settlement sort spill.

| Run | Players / hostile accts | Heap | Indexes | TOAST | FSM/VM | Total | of which challenges heap+idx | Dead tuples (rows) | Dead bytes (est.) | movement_verifications | WAL MiB | Temp MiB | Worst settlement ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| c200-h0 | 200 / 0 | 11.8 | 7.5 | 0.2 | 1.1 | 20.6 | 6.9 | 58,082 | 5.3 | 1.6 | 72 | 0.0 | 93 |
| c200-h2 | 200 / 4 | 15.1 | 7.8 | 0.2 | 1.1 | 24.2 | 8.0 | 78,519 | 6.5 | 2.6 | 108 | 0.0 | 126 |
| c200-h10 | 200 / 20 | 25.0 | 9.5 | 0.2 | 1.2 | 36.0 | 8.9 | 1 | 0.0 | 6.4 | 275 | 0.0 | 299 |
| c500-h0 | 500 / 0 | 42.4 | 16.4 | 0.2 | 1.2 | 60.2 | 35.9 | 140,835 | 28.2 | 4.0 | 292 | 0.0 | 461 |
| c500-h2 | 500 / 10 | 36.6 | 15.8 | 0.2 | 1.1 | 53.8 | 23.2 | 190,184 | 17.7 | 6.2 | 390 | 0.0 | 267 |
| c500-h10 | 500 / 50 | 55.6 | 18.4 | 0.2 | 1.2 | 75.4 | 17.9 | 39,384 | 10.5 | 15.6 | 942 | 0.0 | 965 |
| c1000-h2 | 1000 / 20 | 67.0 | 28.8 | 0.2 | 1.3 | 97.3 | 43.0 | 8,062 | 7.8 | 12.2 | 1213 | 0.0 | 439 |
| c5000-h0 | 5000 / 0 | 382.1 | 138.0 | 0.3 | 1.4 | 521.8 | 344.7 | 1,101,283 | 259.7 | 38.2 | 22523 | 0.0 | 834 |


### 3.4 One versus four seasons (SIMULATION ONLY)

The seasons dimension is not measured: 4 seasons are 360 days and the retention that bounds the raw window is not implemented. The table below re-runs the existing model (`lifecycleCapacity.ts`) with this study's measured challenge-table sizes and non-challenge block as inputs. It is a linear projection with the planning TTLs and reserved auth and audit headroom, and it counts hostile accounts as hostile for the whole horizon. Compare it with the directly measured 14-day values above, which are lower because they hold no auth/audit reservation, no durable growth beyond 14 days, and no snapshot headroom.



### 3.4b Projection table. One versus four seasons, projected (SIMULATION ONLY)

SIMULATION ONLY. Linear projection by `lifecycleCapacity.ts` (planning TTLs: 14-day raw, 120-day proofs and summaries, 90-day season), with the challenge-table size and the non-challenge 0011 block replaced by this study's measured 1,000-player values. Hostile accounts are assumed active for the whole horizon. Quota 500 MiB is an ASSUMPTION (owner to confirm); thresholds warn 60% / backpressure 75% / hard stop 85%. Cells: MiB (percent of 500, level).

Measured non-challenge 0011 block at 1,000 players, after VACUUM: 42.0 MiB (model default 42.2).

| Players | Seasons | Hostile | kept up (targeted autovacuum, 1 s naptime) | cluster defaults (60 s naptime) | autovacuum off (upper bound) |
|---|---|---|---|---|---|
| 200 | 1 | 0% | 67 (13%, ok) | 87 (17%, ok) | 105 (21%, ok) |
| 200 | 1 | 2% | 86 (17%, ok) | 107 (21%, ok) | 124 (25%, ok) |
| 200 | 1 | 10% | 164 (33%, ok) | 185 (37%, ok) | 202 (40%, ok) |
| 200 | 4 | 0% | 86 (17%, ok) | 106 (21%, ok) | 124 (25%, ok) |
| 200 | 4 | 2% | 106 (21%, ok) | 127 (25%, ok) | 144 (29%, ok) |
| 200 | 4 | 10% | 188 (38%, ok) | 209 (42%, ok) | 227 (45%, ok) |
| 500 | 1 | 0% | 147 (29%, ok) | 199 (40%, ok) | 243 (49%, ok) |
| 500 | 1 | 2% | 196 (39%, ok) | 248 (50%, ok) | 291 (58%, ok) |
| 500 | 1 | 10% | 391 (78%, backpressure) | 443 (89%, fail_closed) | 487 (97%, fail_closed) |
| 500 | 4 | 0% | 195 (39%, ok) | 246 (49%, ok) | 290 (58%, ok) |
| 500 | 4 | 2% | 246 (49%, ok) | 298 (60%, ok) | 342 (68%, warn) |
| 500 | 4 | 10% | 452 (90%, fail_closed) | 503 (101%, fail_closed) | 547 (109%, fail_closed) |
| 1,000 | 1 | 0% | 281 (56%, ok) | 385 (77%, backpressure) | 472 (94%, fail_closed) |
| 1,000 | 1 | 2% | 379 (76%, backpressure) | 482 (96%, fail_closed) | 570 (114%, fail_closed) |
| 1,000 | 1 | 10% | 770 (154%, fail_closed) | 873 (175%, fail_closed) | 961 (192%, fail_closed) |
| 1,000 | 4 | 0% | 377 (75%, backpressure) | 480 (96%, fail_closed) | 567 (113%, fail_closed) |
| 1,000 | 4 | 2% | 479 (96%, fail_closed) | 583 (117%, fail_closed) | 670 (134%, fail_closed) |
| 1,000 | 4 | 10% | 891 (178%, fail_closed) | 994 (199%, fail_closed) | 1,082 (216%, fail_closed) |
| 5,000 | 1 | 0% | 1,356 (271%, fail_closed) | 1,872 (374%, fail_closed) | 2,311 (462%, fail_closed) |
| 5,000 | 1 | 2% | 1,844 (369%, fail_closed) | 2,360 (472%, fail_closed) | 2,799 (560%, fail_closed) |
| 5,000 | 1 | 10% | 3,798 (760%, fail_closed) | 4,314 (863%, fail_closed) | 4,753 (951%, fail_closed) |
| 5,000 | 4 | 0% | 1,831 (366%, fail_closed) | 2,347 (469%, fail_closed) | 2,786 (557%, fail_closed) |
| 5,000 | 4 | 2% | 2,346 (469%, fail_closed) | 2,861 (572%, fail_closed) | 3,300 (660%, fail_closed) |
| 5,000 | 4 | 10% | 4,403 (881%, fail_closed) | 4,919 (984%, fail_closed) | 5,358 (1,072%, fail_closed) |


### 3.5 Reading the tables

- Run labels: `a1` bench as is (day-2 VACUUM and day-7 VACUUM ANALYZE), 60 s naptime; `a2`, `a10`, `a11` 60 s without the bench VACUUM (three samples of the same setting); `a3` 15 s; `a4` 1 s; `a5` autovacuum off; `a6` 1 s with `autovacuum_vacuum_cost_delay` 0; `a7` 20 s; `a8` 30 s; `a9` 45 s; `a12` 90 s; `a13` 120 s; `a14` 300 s; `a15` 60 s with cost delay 20 ms; `a16` bench as is at 30 s; `a17` bench as is at 60 s, second sample. Grid runs `cNNN-hP`: players, hostile percent, cluster default 60 s naptime, no bench VACUUM before day 14.
- The first pass of this study (before per-partition statistics were added) gave the same pattern for the same settings: 0011 after VACUUM 125.6 (a1), 132.5 (a2), 80.4 (a3), 55.7 (a4), 250.3 (a5), 54.5 MiB (a6). Compared with the second pass (141.7, 162.2, 83.2, 56.8, 250.2, 59.9) that is a further run-to-run spread of up to 30 MiB at the 60 s setting, and almost none at the extremes (autovacuum off, or 1 s).
- "0011 before VACUUM" and "after VACUUM" differ by under 0.5 MiB: a plain VACUUM does not shrink files; it only lets dead space be reused. That is why the day-14 number depends on what autovacuum did earlier, not on the measurement VACUUM.
- Per-table autovacuum findings (A3): every append-only table had no dead tuples; `gameplay_units`, `gameplay_unit_day_states` and `gameplay_walker_days` update mostly HOT (97%+ of their updates), so they stay small without tuning; only `gameplay_unit_challenges` is a problem table.
- 5,000 players, 14 days (c5000-h0, **measured, not extrapolated**): 521.8 MiB for the 0011 tables at cluster defaults (344.7 MiB of it challenges, 181.8 MiB after VACUUM FULL), WAL 22.5 GiB, database 574 MiB. That is above the assumed 500 MiB quota in the bloated case on its own, and 5,000 players is above the planned 200-player pilot cap by 25x.



## 4. HOT-friendly in-place updates versus targeted autovacuum (task 3 of the brief, "item 3")

All figures: LOCAL POSTGRES VERIFIED, one throwaway cluster per run, same seeded trace for every variant. Tables follow the findings.

**Findings.**
- **Storage.** With autovacuum running at the scaled rate (1 s), every variant ends at 3.1 to 4.2 MiB for about 26,000 live rows in the paced day, so storage is not what separates them. Without that (`nap60` = compressed load, default naptime) baseline and targeted settings both reach 5.2 MiB, with 47% of the file free but unreclaimed. In the saturation burst, where nothing can keep up, **baseline grew to 19.0 MiB (87% free space), per-table autovacuum limited that to 11.9 MiB**, and every variant that writes fewer dead tuples stayed at 4.4 to 5.2 MiB with no autovacuum help. After VACUUM FULL (local diagnostic only) all variants are 2.6 to 3.4 MiB; fillfactor 80 costs about 0.4 MiB (15%) of compact size.
- **WAL (bytes written).** Baseline 115 MiB paced and 505 MiB saturated. Targeted autovacuum 121 and 490 MiB: no reduction (autovacuum adds a little WAL itself). In-place HOT, fillfactor 80: 76 and 282 MiB (-34% and -44%); HOT updates were 98% to 100% of updates, and index writes for the unchanged key columns are skipped, but each unchanged row still gets a new tuple version. Diff-only: 49 and 137 MiB (-57% and -73%).
- **Throughput.** Paced runs are arrival-limited (5 batches/s), so only latency differs, slightly (p99 17 ms baseline, 11 to 15 diff and in-place). Saturated, 8 clients: baseline 682 batches/s, targeted 733, in-place 797 to 846 (+17% to +24%), diff-only 1,137 to 1,243 (+67% to +82%). 16 clients: baseline 804, targeted 832, in-place 951, diff 1,270.
- **Locks, retries.** Zero lock timeouts, zero deadlocks, zero give-ups in every run, because units are always locked in sorted order. Time spent waiting for the unit locks (p95 of the lock phase) at 16 clients: baseline 24 ms, targeted 22, in-place 20, diff 13; batch p99 latency 86, 71, 60 and 42 ms. A shorter transaction holds the shared unit locks for less time, which is the only concurrency effect measured; it is a latency and queueing effect, not a correctness one. A different workload (longer transactions, a hot unit) could produce lock timeouts; none occurred here.
- **CPU (client backends, whole run).** Paced: baseline 10.7 s, targeted 11.1, in-place 9.4 to 11.1, diff 7.5. Saturated 8 clients: baseline 50.2 s, targeted 47.9, in-place 42.6 to 44.2, diff 25.6 to 26.1. Autovacuum CPU on this table was at most 0.3 s of CPU per run even at 500 vacuum runs, so autovacuum itself is cheap here; the extra CPU is the delete/insert and index maintenance.
- **Combination.** Diff-only plus fillfactor 80 plus targeted settings is not meaningfully better than diff-only alone at this scale; the targeted settings matter when the write path is the unchanged baseline.
- **What in-place does not fix.** An UPDATE still leaves a dead tuple (HOT or not), closed challenges are still deletes, and the primary key and walker index are still touched by inserts and deletes. In-place updating unchanged rows is the weakest of the three code options; it exists here because it was the option asked for.
- **Trigger cost.** `gameplay_check_challenge` fires on every challenge UPDATE as well as INSERT (it reads `gameplay_units`); the in-place variant therefore adds one trigger call per kept row. That cost is inside the CPU figures above.

### 4.1 Compressed 24 h, paced (one day of 5,000 players in 15 minutes, diurnal curve)

LOCAL POSTGRES VERIFIED. 4,500 batches, 8 clients, 96x compression. Runs ending `-nap60` use the cluster default `autovacuum_naptime` of 60 s; the others use 1 s, which is the compression-scaled equivalent. Each run is its own throwaway cluster and database; the host was shared with other work, so wall-clock figures are noisy and CPU seconds are the steadier number.

| Run | Clients | Batches | Wall s | Batches/s | Latency p50 / p95 / p99 ms | Lock phase p95 ms | Lock-wait samples (of N) | Peak waiters | Retries (lock timeout / deadlock / other) | Gave up | Table end MiB | Table peak MiB | After plain VACUUM MiB | After VACUUM FULL MiB (diagnostic) | Dead tuples | Free space % | HOT updates / updates | Autovacuum runs (DB view / log) | WAL MiB | WAL records | Full-page images | CPU s clients / bg / autovac |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| p-baseline-nap60 | 8 | 4,500 | 900 | 5.0 | 5 / 9 / 18 | 1 | 0 of 8,843 | 0 | 0 / 0 / 0 | 0 | 5.16 | 5.16 | 5.16 | 2.60 | 199 | 46.94 | 0 / 0 | 14 / 14 | 112.3 | 1,365,396 | 3,784 | 11.4 / 0.6 / 0.04 |
| p-baseline | 8 | 4,500 | 900 | 5.0 | 4 / 10 / 17 | 1 | 0 of 8,857 | 0 | 0 / 0 / 0 | 0 | 3.84 | 3.84 | 3.84 | 2.60 | 2,320 | 12.36 | 0 / 0 | 36 / 36 | 114.9 | 1,395,391 | 3,476 | 10.7 / 0.9 / 0.00 |
| p-diff-ff80-av | 8 | 4,500 | 900 | 5.0 | 4 / 8 / 12 | 1 | 0 of 8,847 | 0 | 0 / 0 / 0 | 0 | 3.13 | 3.13 | 3.13 | 2.99 | 63 | 21.86 | 0 / 0 | 37 / 38 | 49.7 | 445,874 | 3,263 | 7.6 / n/m / 0.00 |
| p-diff-ff80 | 8 | 4,500 | 900 | 5.0 | 4 / 8 / 11 | 1 | 0 of 8,847 | 0 | 0 / 0 / 0 | 0 | 4.15 | 4.15 | 4.15 | 2.99 | 2,582 | 30.13 | 0 / 0 | 1 / 1 | 49.0 | 428,789 | 3,361 | 7.5 / n/m / 0.00 |
| p-inplace-ff80-av | 8 | 4,500 | 900 | 5.0 | 5 / 10 / 13 | 1 | 0 of 8,848 | 0 | 0 / 0 / 0 | 0 | 3.23 | 3.23 | 3.23 | 2.99 | 97 | 20.39 | 179,422 / 184,929 | 461 / 462 | 83.6 | 953,374 | 3,418 | 11.1 / n/m / 0.00 |
| p-inplace-ff80-nap60 | 8 | 4,500 | 900 | 5.0 | 5 / 9 / 15 | 1 | 0 of 8,843 | 0 | 0 / 0 / 0 | 0 | 4.02 | 4.02 | 4.02 | 2.99 | 5,027 | 27.2 | 181,467 / 184,929 | 5 / 5 | 74.3 | 816,534 | 3,549 | 10.5 / 0.6 / 0.00 |
| p-inplace-ff80 | 8 | 4,500 | 900 | 5.0 | 4 / 9 / 15 | 1 | 0 of 8,857 | 0 | 0 / 0 / 0 | 0 | 3.96 | 3.96 | 3.96 | 2.99 | 4,384 | 27.72 | 181,026 / 184,929 | 7 / 7 | 75.6 | 834,528 | 3,436 | 9.4 / 0.9 / 0.00 |
| p-targeted-av-nap60 | 8 | 4,500 | 900 | 5.0 | 5 / 9 / 15 | 1 | 0 of 8,845 | 0 | 0 / 0 / 0 | 0 | 5.17 | 5.17 | 5.16 | 2.60 | 199 | 47.38 | 0 / 0 | 15 / 15 | 112.3 | 1,366,356 | 3,774 | 11.4 / 0.6 / 0.02 |
| p-targeted-av | 8 | 4,500 | 900 | 5.0 | 4 / 10 / 16 | 1 | 0 of 8,857 | 0 | 0 / 0 / 0 | 0 | 3.47 | 3.47 | 3.47 | 2.60 | 143 | 2.92 | 0 / 0 | 501 / 502 | 120.7 | 1,478,348 | 3,380 | 11.1 / 1.2 / 0.00 |


### 4.2 Saturation burst, 8 clients (20,000 batches as fast as the clients go; naptime 1 s)

LOCAL POSTGRES VERIFIED. About four days of a 5,000-player pilot in a minute. Not a forecast of any real load; it shows how each write path behaves when writers queue on shared units.

| Run | Clients | Batches | Wall s | Batches/s | Latency p50 / p95 / p99 ms | Lock phase p95 ms | Lock-wait samples (of N) | Peak waiters | Retries (lock timeout / deadlock / other) | Gave up | Table end MiB | Table peak MiB | After plain VACUUM MiB | After VACUUM FULL MiB (diagnostic) | Dead tuples | Free space % | HOT updates / updates | Autovacuum runs (DB view / log) | WAL MiB | WAL records | Full-page images | CPU s clients / bg / autovac |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| s8-baseline | 8 | 20,000 | 29 | 682.3 | 10 / 21 / 55 | 7 | 107 of 284 | 3 | 0 / 0 / 0 | 0 | 19.02 | 19.02 | 19.02 | 2.93 | 0 | 87.08 | 0 / 0 | 25 / 25 | 505.0 | 7,191,628 | 1,624 | 50.2 / 0.2 / 0.27 |
| s8-diff-ff100 | 8 | 20,000 | 18 | 1136.7 | 6 / 14 / 20 | 4 | 62 of 172 | 3 | 0 / 0 / 0 | 0 | 4.36 | 4.36 | 4.36 | 2.91 | 2,949 | 12.28 | 0 / 0 | 6 / 6 | 138.0 | 1,661,193 | 1,624 | 26.1 / 0.1 / 0.01 |
| s8-diff-ff80-av | 8 | 20,000 | 16 | 1242.5 | 6 / 13 / 17 | 4 | 64 of 157 | 4 | 0 / 0 / 0 | 0 | 4.55 | 4.55 | 4.55 | 3.36 | 0 | 29.76 | 0 / 0 | 16 / 17 | 135.1 | 1,664,114 | 1,631 | 25.6 / 0.1 / 0.00 |
| s8-diff-ff80 | 8 | 20,000 | 17 | 1207.2 | 6 / 13 / 18 | 4 | 42 of 162 | 2 | 0 / 0 / 0 | 0 | 5.16 | 5.16 | 5.16 | 3.36 | 3,694 | 29.67 | 0 / 0 | 6 / 6 | 137.4 | 1,640,325 | 1,671 | 25.9 / 0.0 / 0.02 |
| s8-inplace-ff100 | 8 | 20,000 | 25 | 796.6 | 9 / 19 / 28 | 6 | 95 of 244 | 3 | 0 / 0 / 0 | 0 | 4.40 | 4.40 | 4.40 | 2.92 | 1,115 | 14.6 | 902,420 / 965,298 | 22 / 22 | 292.4 | 3,907,904 | 1,624 | 44.2 / 0.1 / 0.01 |
| s8-inplace-ff80-av | 8 | 20,000 | 25 | 806.1 | 9 / 19 / 29 | 6 | 99 of 241 | 4 | 0 / 0 / 0 | 0 | 4.64 | 4.64 | 4.64 | 3.34 | 0 | 30.81 | 1,004,271 / 1,009,733 | 24 / 24 | 276.5 | 3,808,866 | 1,671 | 42.6 / 0.1 / 0.00 |
| s8-inplace-ff80 | 8 | 20,000 | 24 | 846.4 | 8 / 18 / 27 | 6 | 89 of 231 | 3 | 0 / 0 / 0 | 0 | 4.84 | 4.84 | 4.84 | 3.38 | 0 | 33.67 | 1,036,937 / 1,042,237 | 21 / 21 | 281.8 | 3,868,829 | 1,671 | 43.2 / n/m / 0.01 |
| s8-targeted-av | 8 | 20,000 | 27 | 733.1 | 10 / 19 / 27 | 7 | 90 of 264 | 3 | 0 / 0 / 0 | 0 | 11.89 | 11.65 | 11.89 | 2.92 | 0 | 78.05 | 0 / 0 | 25 / 25 | 490.5 | 6,983,392 | 1,624 | 47.9 / 0.1 / 0.23 |


### 4.3 Saturation burst, 16 clients

LOCAL POSTGRES VERIFIED. Same trace as B2 with twice the writers.

| Run | Clients | Batches | Wall s | Batches/s | Latency p50 / p95 / p99 ms | Lock phase p95 ms | Lock-wait samples (of N) | Peak waiters | Retries (lock timeout / deadlock / other) | Gave up | Table end MiB | Table peak MiB | After plain VACUUM MiB | After VACUUM FULL MiB (diagnostic) | Dead tuples | Free space % | HOT updates / updates | Autovacuum runs (DB view / log) | WAL MiB | WAL records | Full-page images | CPU s clients / bg / autovac |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| s16-baseline | 16 | 20,000 | 25 | 803.7 | 16 / 44 / 86 | 24 | 216 of 237 | 10 | 0 / 0 / 0 | 0 | 8.68 | 8.68 | 8.44 | 2.95 | 5,760 | 59.94 | 0 / 0 | 24 / 24 | 504.0 | 7,039,836 | 1,624 | 50.0 / 0.1 / 0.27 |
| s16-diff-ff80 | 16 | 20,000 | 16 | 1270.2 | 11 / 26 / 42 | 13 | 127 of 151 | 9 | 0 / 0 / 0 | 0 | 5.03 | 5.03 | 5.03 | 3.37 | 114 | 35.24 | 0 / 0 | 7 / 7 | 137.5 | 1,635,982 | 1,671 | 26.6 / 0.0 / 0.02 |
| s16-inplace-ff80 | 16 | 20,000 | 21 | 951.2 | 14 / 36 / 60 | 20 | 185 of 203 | 10 | 0 / 0 / 0 | 0 | 5.19 | 5.19 | 5.19 | 3.34 | 0 | 40.57 | 972,263 / 983,625 | 18 / 18 | 273.2 | 3,704,521 | 1,671 | 42.1 / n/m / 0.01 |
| s16-targeted-av | 16 | 20,000 | 24 | 832.0 | 16 / 40 / 71 | 22 | 200 of 229 | 9 | 0 / 0 / 0 | 0 | 8.48 | 8.48 | 8.26 | 2.91 | 0 | 65.6 | 0 / 0 | 24 / 24 | 486.2 | 6,726,005 | 1,624 | 48.4 / 0.1 / 0.22 |



## 5. Hosted-safe guidance (plain VACUUM and autovacuum only)

- **Never VACUUM FULL on hosted production** (it takes an exclusive lock and needs free disk of about the table's size). It appears in this document only as a local diagnostic.
- Per-table settings for `gameplay_unit_challenges` (reversible with `ALTER TABLE ... RESET`): `autovacuum_vacuum_scale_factor = 0`, `autovacuum_vacuum_threshold = 200`, `autovacuum_vacuum_cost_delay = 0`, `autovacuum_analyze_scale_factor = 0.05`. Whether the hosted plan lets the table owner set them is an **owner check**; the cluster-level `autovacuum_naptime` is not ours to change on a managed plan. This study's `nap60` rows show why the table setting alone cannot help if the launcher is not waking: a threshold only triggers when autovacuum looks.
- Watch dead tuples and size of the table (`pg_stat_user_tables`, `pg_total_relation_size`), alert at a multiple of live size, and rely on the capacity guard's table growth alarm. A plain VACUUM never returns space to the operating system except a free tail, so a table that bloated once keeps its size for the quota; prevention is the only hosted-safe control.
- The diff-only write path would need a service change, a deterministic equivalence test (same final rows as delete-and-insert), and a review of `opened_received_at` handling (kept rows keep their receipt time today). That is outside this task and is not made.

## 6. Limits and what was not done

- Single machine, shared with other jobs; wall-clock and throughput numbers are indicative, byte/WAL/row counts are exact for the runs. One sample per setting except 60 s (four samples of the stock regime, and two bench-as-is samples). No confidence intervals are claimed.
- The burst is synthetic and calibrated to the 200-player bench; it exercises the challenge table, the unit lock and unit update only, not the whole push pipeline. CPU is client-backend CPU, not whole-host.
- 10% hostile at 1,000 players and every hostile run at 5,000 players were not run (runtime); 1 versus 4 seasons is modelled (SIMULATION ONLY), as are all quota percentages (assumed 500 MiB).
- Compressed time: autovacuum behaviour at 96x compression is an approximation of a real day; the naptime scaled setting is an equivalence argument, not a measurement of production.
- No hosted database, Supabase, or network service was used. Throwaway databases and clusters were removed after the runs.

## 7. Contradictions with earlier reports

- The lifecycle doc's churn study concluded the per-table autovacuum row was "inconclusive" because the bench was too fast. Confirmed here, and refined: the same per-table setting did nothing at a 60 s naptime and works at 1 s (`p-targeted-av`: 501 autovacuum runs, 2.9% free space, 143 dead tuples).
- The data lifecycle doc's "kept up" table size of 2.4x compact (about 8.9 MiB per 1,000 players) is lower than this study's kept-up measurements at 1 s naptime (11.7 to 17.1 MiB per 1,000 players, 3 to 4.5x compact). Use 3 to 4.5x for planning.
- Track B said 146.9 MiB was not replicated and attributed it to autovacuum timing; that attribution is confirmed and quantified here.

## 8. Reproduce

All local; none touches a hosted service.

```
export BENCH_PG_DIR=/tmp/pgb BENCH_PG_PORT=55432
backend/scripts/gameplay-bench-cluster.sh init
# plan.tsv: label <TAB> postgres settings <TAB> one partial scenario as JSON
backend/scripts/gameplay-bench-matrix.sh plan.tsv out/          # day-14 matrix
# burst plan: label <TAB> settings <TAB> burst arguments
backend/scripts/gameplay-challenge-burst-matrix.sh burst.tsv out/
node --import tsx backend/scripts/gameplay-hot-autovac-report.ts --a out/A --c out/C --b out/B
backend/scripts/gameplay-bench-cluster.sh destroy
```
Scenario example: `{"name":"c500-h2","players":500,"noMidVacuum":true,"hostile":{"accounts":10,"sessionsPerDay":20,"units":500}}`. Burst example: `--variant diff-ff80 --pace-seconds 900` (paced, 4,500 batches) or `--variant baseline --sessions 20000 --clients 16` (saturation).


## 9. Diff-only challenge writes in the service, changed kept rows, and recomputed capacity (28 Oct)

**Status: opt-in, default unchanged.** `GameplayServiceDeps.challengeWrites` (`"delete-insert"` | `"diff"`, default `DEFAULT_CHALLENGE_WRITE_MODE = "delete-insert"`, the live behaviour). Nothing selects `"diff"` in production wiring. Migration 0011 and `drizzle/` are untouched.

### 9.1 What the review found, and the fix

The service re-inserts every kept challenge with `holding_rules_version = hv` and keeps `opened_received_at` (service.ts, `writeChallenges`). The section 4 "diff" variant skipped kept rows blindly, so it never modelled a kept row whose value changes. Reproduced here: with a rules rollover in the burst, the blind variant leaves **11,581 to 11,588 rows with the old stamp** (and 0 for delete-insert and for the comparing variant). The service's `diff` mode therefore does: DELETE rows of the touched units that are no longer open; UPDATE a kept row only when `first_day`, `holding_rules_version` or `opened_received_at` differs (`IS DISTINCT FROM`); INSERT rows not yet present. All three run inside the batch transaction after the `FOR UPDATE` lock on the touched `gameplay_units` rows, so the CAS/ordering protocol is unchanged. The challenge trigger still fires for every inserted or updated row.

### 9.2 Correctness evidence (LOCAL POSTGRES VERIFIED)

`src/gameplay/challengeDiff.pg.test.ts`: 120 randomized batches (seeded), each run both ways from the same state with the table compared row for row: 91 batches with a rules-version change, 115 first_day changes, 73 receipt-time changes, 759 kept rows (211 untouched, 548 rewritten), 326 closed, 378 opened. Identical contents after every batch; unchanged kept rows keep their tuple (same `xmin`), changed ones are rewritten, rows of untouched units are never written. Also: a kept row with equal first_day but an old rules version is restamped; an empty open list closes only the touched units' rows; the default is delete-insert and a bad mode is refused. Mutation check: comparing only `first_day` fails the randomized test at batch 8 and the restamp test. With the default temporarily flipped to `diff`, all 69 other gameplay PostgreSQL tests (owner-clash, 40P01 and 40001 retries, partition races, flag-off 404, replay, settlement) passed; the one failure was the assertion that the default is delete-insert.

### 9.3 Burst, 1,200 batches, 8 clients (the reviewer's scale)

Raw JSON in `diff-writes-results/small/`. Scenario s1: kept rows unchanged. s2: 10% of kept rows change first_day and the rules version moves 1002 to 1003 half-way. Throwaway cluster, `autovacuum_naptime` as stated. A 1,200-batch run lasts about 2 s, so autovacuum rarely runs: these runs show write volume, not steady-state size.

| Autovacuum state | Scenario | Variant | Table MiB | Dead | Updates / HOT | Autovacuum runs | WAL MiB | Stale rows |
|---|---|---|---|---|---|---|---|---|
| off | s1 | delete-insert | 6.56 | 28,190 | 0 | 0 | 29.9 | 0 |
| off | s1 | diff (compare) | 2.76 | 1,121 | 0 | 0 | 13.9 | 0 |
| off | s2 | delete-insert | 6.52 | 27,842 | 0 | 0 | 29.9 | 0 |
| off | s2 | blind skip | 2.75 | 1,762 | 0 | 0 | 14.0 | **11,581** |
| off | s2 | diff (compare) | 3.59 | 5,048 | 6,050 / 3,080 | 0 | 17.6 | 0 |
| naptime 60 s | s1 | delete-insert | 6.60 | 27,030 | 0 | 0 | 30.3 | 0 |
| naptime 60 s | s1 | diff (compare) | 2.75 | 1,002 | 0 | 0 | 14.0 | 0 |
| naptime 60 s | s2 | delete-insert | 6.54 | 21,647 | 0 | 0 | 30.0 | 0 |
| naptime 60 s | s2 | diff (compare) | 3.59 | 10,341 | 14,803 / 9,142 | 0 | 17.5 | 0 |
| naptime 1 s | s1 | delete-insert | 6.02 | 1,390 | 0 | 1 | 30.6 | 0 |
| naptime 1 s | s1 | diff (compare) | 2.75 | 1,002 | 0 | 0 | 14.1 | 0 |
| naptime 1 s | s2 | delete-insert | 5.48 | 0 | 0 | 2 | 31.2 | 0 |
| naptime 1 s | s2 | diff (compare) | 3.63 | 0 | 10,283 / 5,553 | 1 | 18.4 | 0 |

No retries, deadlocks or lock timeouts in any run. The comparing diff writes 15,4xx updates in s2 (the rollover restamps every kept row of the touched units once; that is the cost of correctness) and is HOT for 52 to 62% of them at fillfactor 100.

Larger run (20,000 batches, 8 clients, s2; `diff-writes-results/large/`):

| Autovacuum state | Variant | Table MiB (peak) | Dead | Updates / HOT | Autovacuum runs | WAL MiB | Client CPU s |
|---|---|---|---|---|---|---|---|
| naptime 60 s | delete-insert | 45.64 | 468,980 | 0 | 1 | 478.4 | 48.1 |
| naptime 60 s | diff (compare) | 6.06 | 13,980 | 126,752 / 124,852 | 1 | 148.3 | 36.2 |
| naptime 1 s | delete-insert | 12.84 (15.27) | 0 | 0 | 24 | 488.7 | 48.6 |
| naptime 1 s | diff (compare) | 4.27 | 167 | 124,612 / 116,301 | 9 | 160.6 | 39.5 |

Even with every kept row restamped once and 10% changing a day on every batch (a deliberately pessimistic change rate; the service does not change `first_day` of a kept challenge today), the comparing diff cut WAL by 68% and the table by 67 to 87%. At zero change (s1) it is the 57% to 73% WAL cut of section 4. Fillfactor, targeted autovacuum and in-place variants are not repeated.

### 9.4 Recomputed peak DB + WAL + reserve (SIMULATION ONLY)

`backend/scripts/gameplay-challenge-capacity.ts` (full output in `diff-writes-results/capacity.md`). Assumptions, all stated in the script: the quota is **500 MiB as an assumption only (the real Supabase quota is UNKNOWN)**; ordinary players (0% hostile; hostile cases are in 3.4b); 300 unique units a day; 14-day detail + 120-day compact proofs; 90-day season; warn 60% / backpressure 75% / stop 85% of the assumed quota; non-challenge block from `lifecycleCapacity.ts` (including its auth/audit reserve). Challenge table per 1,000 players at the stated autovacuum state: kept-up 14.2 MiB, stock 60 s 120 MiB (the compressed-bench worst case, section 3.1; in real time autovacuum gets about 1,440 turns a day, so this is a delayed-vacuum bound), autovacuum off 14.9 MiB a day growing without bound. Diff-mode sizes scale those by the measured burst ratios (0.33 at 1 s, 0.13 at 60 s, 0.08 of tuple versions for off; the last is an extrapolation). WAL: 70.7 MiB per 1,000 players a day delete-insert (990 MiB over 14 days), peak day = 2x average (assumption) and one peak day on disk; diff saves 14.9 MiB a day per 1,000 (burst-derived, a lower bound). "Reserve" is the 15% above the stop line; the last column is the quota needed to stay under it. Whether hosted WAL counts against the quota is UNKNOWN, so it is added to be safe.

Total MiB = DB + peak-day WAL (percent of 500; level):

| Players | Seasons | Kept-up: delete-insert | Kept-up: diff | Stock 60 s: delete-insert | Stock 60 s: diff | Autovacuum off: delete-insert | Autovacuum off: diff |
|---|---|---|---|---|---|---|---|
| 200 | 1 | 94 (19%, ok) | 86 (17%, ok) | 115 (23%, ok) | 89 (18%, ok) | 359 (72%, warn) | 107 (21%, ok) |
| 200 | 4 | 113 (23%, ok) | 105 (21%, ok) | 134 (27%, ok) | 108 (22%, ok) | 1,180 (236%, stop) | 191 (38%, ok) |
| 500 | 1 | 216 (43%, ok) | 197 (39%, ok) | 269 (54%, ok) | 202 (40%, ok) | 878 (176%, stop) | 248 (50%, ok) |
| 500 | 4 | 264 (53%, ok) | 244 (49%, ok) | 317 (63%, warn) | 250 (50%, ok) | 2,931 (586%, stop) | 457 (91%, stop) |
| 1,000 | 1 | 420 (84%, backpressure) | 381 (76%, backpressure) | 526 (105%, stop) | 392 (78%, backpressure) | 1,743 (349%, stop) | 484 (97%, stop) |
| 1,000 | 4 | 515 (103%, stop) | 476 (95%, stop) | 621 (124%, stop) | 487 (97%, stop) | 5,850 (1,170%, stop) | 902 (180%, stop) |
| 5,000 | 1 | 2,050 (410%, stop) | 1,853 (371%, stop) | 2,579 (516%, stop) | 1,909 (382%, stop) | 8,664 (1,733%, stop) | 2,367 (473%, stop) |
| 5,000 | 4 | 2,525 (505%, stop) | 2,328 (466%, stop) | 3,054 (611%, stop) | 2,384 (477%, stop) | 29,197 (5,839%, stop) | 4,456 (891%, stop) |

Reading: the pilot cap of 200 fits under the warning line in every autovacuum state that has vacuum running, with or without diff; diff matters most when vacuum lags (stock 60 s: 1,000 players, 1 season goes from stop to backpressure) and bounds growth when vacuum is blocked. Above 500 players the assumed quota is exceeded by the non-challenge tables and the peak-day WAL regardless of write mode; do not publish a player-cap claim without naming the workload and vacuum state. Hosted guidance remains plain VACUUM and autovacuum tuning; never VACUUM FULL on hosted production (the "after VACUUM FULL" column elsewhere is a local diagnostic).

### 9.5 Limits

Single shared 4-vCPU host; 1,200-batch runs are about 2 s and do not exercise autovacuum steady state. The change rate and rollover are synthetic. The burst models the challenge table and unit update only, not the whole push pipeline, and its per-batch row count (about 54) is below the 164 rows per session the 1,000-player bench shows, so the WAL saving in 9.4 is a lower bound. Capacity numbers are a projection, not a measurement; no hosted service was contacted.
