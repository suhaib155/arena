# Pilot capacity red-team (B5)

Status: research. Nothing here is applied, enabled or measured on a hosted service. Evidence tiers: **MEASURED** (local bench, this folder), **REPORTED** (docs/G34_STORAGE_CAPACITY.md, not re-measured), **PROJECTED** (calculator), **ASSUMED** (stated, unverified). No hosted proof exists for any figure. Mapping to the brief's tiers: MEASURED = SYNTHETIC EXPERIMENT (local bench), PROJECTED = model output, ASSUMED = PILOT ASSUMPTION. Per-key tier tags are in `params.v1.json`.

Files: `research/economy-redteam/capacity/` holds `calculator.ts`, `params.v1.json` (versioned inputs), `run.ts` (CLI), `calculator.test.ts`, `bench/` (cluster driver, sampler, summary; not in the default test run) and `out/` (`projection.csv`, `backlog.csv`, `measured*.csv`, `optimistic/`, raw bench JSON for 1,000 players).

Reproduce: `node --import tsx research/economy-redteam/capacity/run.ts` (projection); `bench/run-matrix.sh` (about 25 minutes; creates and deletes a throwaway PostgreSQL 16 cluster in a temp directory; the driver validates its arguments before touching anything and refuses any database host other than 127.0.0.1).

## 1. Re-check of the reported revision 3 figures (1,000 players, 14 days, rule 1002 res 10)

Bench: the committed bench `backend/scripts/gameplay-storage-bench.ts --profile integration`, read-only, run on a fresh cluster (fsync off, `max_wal_size` 64 GB) with default autovacuum and with aggressive autovacuum (naptime 5 s, scale factor 0.02, cost delay 0, cost limit 4000). Single run per cell, so no variance is claimed.

| Figure | Reported (#129 rev 3) | Fresh, default autovacuum | Verdict |
|---|---|---|---|
| Ledger rows / sessions | 111,920 / 12,666 | 111,918 / 12,666 | replicated |
| After VACUUM FULL, 0011 tables | 40.38 MiB | 40.41 MiB | replicated |
| WAL | 977.7 MiB | 975.9 MiB | replicated (aggressive: 989.7) |
| 0011 total after VACUUM ANALYZE | 146.86 MiB | 116.76 MiB (gameplay tables) | **not replicated** (20% lower) |
| Challenge table | 104.7 MiB | 74.9 MiB | not replicated; same direction, size depends on how many autovacuum passes landed (3 here) |
| Database | 166.4 MiB | 136.3 MiB | not replicated; the 30 MiB gap equals the challenge-table gap |
| Worst settlement / temp | 254 ms / 0 | 472 ms / 0 | temp replicated; time not comparable (shared machine) |

Reading: logical content and WAL replicate to within 0.2%. The bloat size is a timing result, not a constant: the bench pushes 14 days in minutes, so how much dead space accumulates depends on when autovacuum runs. The 146.9 MiB figure is one draw from a wide range, not a stable property. The 200 and 500 player runs show the same scaling (table 6.0 and 25.1 MiB under default autovacuum).

Bloat versus autovacuum (MEASURED, challenge table total MiB; live rows about 4.8k / 11.6k / 22.8k):

| Players | Default | Aggressive | After VACUUM FULL (all gameplay tables) |
|---|---|---|---|
| 200 | 6.02 | 2.60 | 11.48 |
| 500 | 25.08 | 8.10 | 22.57 |
| 1,000 | 74.88 | 13.13 | 40.41 (aggressive: 40.43) |

Aggressive settings cut the churn bloat 5.7x at 1,000 players and the database from 136.3 to 74.6 MiB, at the cost of 46 autovacuum passes on that table instead of 3 (hot-path CPU on a shared free-tier instance is not measured). WAL is unchanged by autovacuum settings (about +1.4%). VACUUM FULL is a reference only: it takes an exclusive lock, rewrites the table and temporarily needs the free space, and it is not a capacity strategy.

Churn driver (MEASURED): at 1,000 players the challenge table received 2.06M inserts and 2.04M deletes for 22.8k live rows and 111.9k ledger rows, 18.4 inserts per ledger row. That ratio rose with density (3.9 at 200, 9.4 at 500 players in the same 2 km area), so it is a property of the bench geography, not of the rule alone. Rule 1001 (immediate flip, no challenges) has no such table churn by construction (VERIFIED CODE: rules.ts `takeover: immediate`), but no 1001 run exists on revision 3 and its figures below are projected from per-row costs only. The `gameplay_units` table takes one update per ledger row, 98% of them HOT (no index write). Partition drop of one day freed 1.38 MiB at 1,000 players instantly (MEASURED, bench `dropRoute`); a row DELETE of the same day followed by VACUUM freed 0 bytes to the filesystem (MEASURED, `deleteRoute`).

Not done: per-relation WAL attribution (pg_waldump) was scripted (`WAL_ATTR=1`) but not run, so "challenge churn dominates WAL" is supported only by the fit below, not by direct attribution. WAL fits, per ledger row and per challenge insert, 1,441 B and 395 B (least squares through the 200 and 1,000 runs; predicts the 500 run within 1.5%).

## 2. Calculator and what it assumes

Parameters (`params.v1.json`; tier tags are in the file): 60% of players active per day, 1.5 sessions per active day (ASSUMED, bench values), 8.84 accepted ledger rows per session under 1002 and 4.9 under 1001 (1002 MEASURED, 1001 ASSUMED), challenge inserts 0.01845 per ledger row per player (MEASURED, dense area; density sensitivity below), distinct units per player 30 (res 10) or 3 (res 8) (ASSUMED; the bench dense area gave 1.2, the earlier sparse run 142), hostile accounts stopped after 14 days at 20 sessions a day and 300 accepted rows a day (ASSUMED upper bound = unit budget), usable quota = 80% of nominal after an operational reserve (ASSUMED) plus an 11.8 MiB baseline (REPORTED), nominal quota 500 MiB (ASSUMED until the owner reads the dashboard). Bloat is the high-water mark of dead challenge tuples: churn per day times a "burst" of 3.5 days (default autovacuum) or 1.0 (aggressive), calibrated on the bench and therefore at bench speed, which is faster than people walk. `params.v1-optimistic.json` shows the opposite bound: a quarter of the density and one tenth of the burst.

Fit check (PROJECTED against MEASURED): 1,000 players, 14 days, no abuse, keep all: projected 169 MiB total against 136.3 MiB measured (pessimistic by 24% because bloat is priced at the 3.5-day mean); 200 players projected 30 MiB against 32.5 measured (7% low). Against all six runs the model is within about 25% of the four default-autovacuum and aggressive runs at 200 and 500 players (500 players: 68 projected against 64.9 measured, 51 against 48.1 aggressive), 24% high for the default 1,000-player run and about 38% high for the aggressive one (103 against 74.6). Treat it as order of magnitude, unvalidated outside the benched range (no bench exceeded 14 days, 1,000 players or 0% abuse).

### Projection (PROJECTED, rule 1002, MiB, percent of **usable** quota, default / aggressive autovacuum)

| Players | Lifetime | Abuse | Keep all | Raw 14 d + 120 d proofs |
|---|---|---|---|---|
| 200 | 14 d | 0% | 30 (7%) / 27 (7%) | 30 / 27 |
| 200 | 90 d | 0% | 99 (25%) / 96 (24%) | 43 (11%) / 41 (10%) |
| 200 | 4 seasons | 0% | 342 (85%) / 339 (85%) | 63 (16%) / 60 (15%) |
| 200 | 4 seasons | 10% | 387 (97%) / 374 (94%) | 100 (25%) / 87 (22%) |
| 1,000 | 14 d | 0% | 169 (42%) / 103 (26%) | 169 / 103 |
| 1,000 | 90 d | 0% | 482 (121%) / 416 (104%) | 233 (58%) / 167 (42%) |
| 1,000 | 4 seasons | 0% | 1,577 (394%) / 1,510 (378%) | 312 (78%) / 245 (61%) |
| 1,000 | 14 d | 10% | 676 (169%) / 358 (90%) | 638 (160%) / 320 (80%) |
| 1,000 | 4 seasons | 10% | 2,083 (521%) / 1,766 (441%) | 778 (195%) / 461 (115%) |

Optimistic bound (`out/optimistic/`), 1,000 players, 4 seasons, 0% abuse: 1,486 keep-all, 221 with 14/120 retention. The spread between the two parameter files, not either number, is the honest result: at 1,000 players the answer to "does it fit" depends on the density of play and on autovacuum behaviour that no local bench can fix.

Findings from the grid (all PROJECTED): 200 players fit every retention choice for a 90-day lifetime; keep-all does not survive four seasons at 500 players or more (rule 1001 keep-all: 515 MiB, 129% of usable, at 500 players over 360 days); 10% hostile accounts at 1,000 players is the largest single driver (hostile challenge churn alone adds about 350 MiB of bloat under default autovacuum: `bloat_default_bytes` is 445 MiB at 10% abuse against 93 MiB at 0% in the rule 1002, 1,000 player, 14 day rows of `out/projection.csv`), which makes the per-walker unit budget and the take budget load-bearing, not cosmetic; the usable-quota line (80% of nominal) is crossed well before the nominal one in every large case.

Settlement temp is 0 in every scenario (entries per day stay under the 16 MiB work_mem sort, MEASURED 0 temp bytes in all six runs; PROJECTED even at 10% abuse). The risk that remains is a long sleep, below.

### Sleeping free instance and settlement backlog (`out/backlog.csv`)

A free web instance that sleeps misses day closes. On wake, settlement runs at most `maxDaysPerRun` (31, VERIFIED CODE rules.ts:245, service.ts:831-845) days per call. At 1,000 players a day costs about 0.48 s of settlement (MEASURED worst day 472 ms), so a 31-day backlog takes about 15 s in one run and a 45-day backlog needs two runs (21 s), generating about 2.1 GB of WAL for 31 days of missed settlement work in one burst (PROJECTED: this is the ledger and challenge WAL of the days being caught up, not extra). A catch-up burst is therefore a WAL and request-timeout problem before it is a table-size problem. The idle timeout and cold-start time of the provider are ASSUMED unverified and must be read from the provider's current page; the sampler and bench say nothing about them. A request that triggers catch-up must not share a timeout with user traffic.

## 3. Retention decision matrix (nothing ratified)

The values 14/120 days, 300 units a day, a 200-player pilot and 60/75/85% tripwires are PROVISIONAL proposals from docs/G34_STORAGE_CAPACITY.md. This matrix does not adopt them; it shows what each choice buys and costs.

| Alternative | Space (1,000 players, 4 seasons, default autovac, MiB, PROJECTED) | Historical proof | Appeals | Security forensics | Deletion requests | Backups |
|---|---|---|---|---|---|---|
| Keep all | 1,577 (over any free quota) | Full replay forever | Any age | Full | Row deletes plus bloat; erasure is expensive in a large table | Large, all personal-linked rows in every backup |
| Raw 7 d + 60 d proofs | 261 | Replay only for 7 days; later by proof plus archive | 7 days of raw evidence; a 30-day appeal window then relies on proof and archive | Weak after 7 days | Raw rows gone fast; proofs hold pseudonymous numbers | Smallest |
| Raw 14 d + 120 d proofs (proposed) | 312 | Raw replay 14 days, proof 120 days | Fits only if the appeal window is at most 14 days; a 30-day post-season appeal is answered from proofs | Short | As above | Small |
| Raw 30 d + 180 d proofs | 394 | Raw replay a month | Covers a 30-day appeal | Better | Longer retention of pseudonymous rows | Moderate |
| Partition TTL with an owner-held encrypted archive | Same as the row above plus archive storage outside the quota | Full replay from the archive, verified by the stored digests | Any age, if the key survives | Full for archived days | Erasure must also reach the archive: either pseudonymous numbers are accepted as non-personal (a legal call, not an engineering one) or archives are re-encrypted per season and the key destroyed | Archive is itself a backup; key loss is total loss; the free-tier database has no point-in-time restore |

Method notes: raw partition drop returns space immediately and leaves no dead tuples (MEASURED); DELETE does not return space to the filesystem (MEASURED), so only partitioned tables can honour a hard TTL. Tables that stay row-deleted (applied sessions are partitioned only by convention, day states, proofs) need aggressive per-table autovacuum or they plateau at their high-water mark. A session-row delete cascades to its receipt (G34 doc), so session TTL must run after the ledger TTL. Legally authorized deletion, legal hold and appeal duration are owner and counsel decisions; nothing in this folder deletes anything and no cleanup script is provided.

Other points the owner needs before relying on a number:
- A nominal database allowance is not usable quota. Assume the dashboard lags, a migration or restore needs working space, and WAL plus vacuum need headroom; the calculator holds back 20% (ASSUMED, to be set by the owner), and every "fits" statement above is against that usable figure.
- Tripwires at 60/75/85% are only meaningful if the guard sees real growth in time. At 1,000 players the 10%-abuse case grows by roughly 16 MiB a day of tables and indexes during the 14 hostile days (PROJECTED, about 230 MiB versus 67 MiB) plus bloat, so an 85% line can be crossed within a day or two of a hostile start, before an owner reads an alert. The percentages should be derived from growth per day and response time, not fixed.
- The 300-unit budget bounds accepted rows (and so ledger and challenge churn) per hostile account; the calculator treats it as an upper bound on rows. Whether a lower budget is safe for honest walkers belongs to the walking-distance study, not to storage.
- A 200-player pilot fits with margin for lifetimes up to 90 days or with a raw-partition TTL; four-season keep-all reaches 85-97% of usable quota at 200 players (rule 1002, 0-10% abuse); 1,000 does not under 10% abuse or default autovacuum on 1002. The player cap should come from the abuse rate the owner is willing to be exposed to, not from the average case.

## 4. Open owner decisions

1. Real database quota and the operational reserve to hold back.
2. Autovacuum policy for `gameplay_unit_challenges` (per-table settings, or in-place updates instead of delete and insert, which is a code change not made here), and whether free-host CPU can carry it.
3. Retention windows, archive custody, and how pseudonymous archives are treated for erasure.
4. Appeal window length (decides whether 14 raw days is enough).
5. Pilot cap, tied to a tolerated hostile share rather than average load.
6. Rule 1001 versus 1002 for the pilot: 1001 has no challenge churn but was never benched on revision 3.

## 5. Limits of this work

Single local run per cell, no variance estimate. One synthetic geography (dense 2 km), 14 days, rule 1002 only. fsync off. No read-load benchmark was run (read paths are reported under 1 ms to 24 ms in the G34 document, not re-measured). No hosted service, no real users and no network were involved.
