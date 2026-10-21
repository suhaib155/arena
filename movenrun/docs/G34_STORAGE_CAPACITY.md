# G3/G4 storage capacity: what 0011 costs, and how to keep it inside Supabase Free

**Status: REVIEWED, UNAPPLIED (schema); CODE TESTED LOCALLY (service); SIMULATION ONLY (bench and projections).**
- Migration 0011 is still only a file in `backend/drizzle-proposed/`. It is applied nowhere hosted, and the drizzle journal (0000–0010) does not list it.
- Revision 2 of 0011 now uses day partitions, a compact ledger, refusal counters and player-day proofs (§11).
- The push path enforces a per-walker daily unit budget and can take a capacity guard that fails closed. Both run only with `MOVENRUN_GAMEPLAY_ENABLED=true`, which stays off, and the guard is also off unless a quota is configured.
- **No retention job, archive, export or partition drop exists.** Retention (§12) is an owner decision and is not enforced.

**Measured against:**
- §§1–9: 0011 revision 1 as of `feat/g34-server-holdings` 685852b (14 tables, rule sets 1001 and 1002). These sections are kept as the record of why the layout changed.
- §11: revision 2 against revision 1 at 1541a01, same harness, seeds and synthetic players.

**Quota:** this document assumes 500 MiB, which is Supabase Free's published database allowance. **The owner must confirm the real quota for this project in the Supabase dashboard** (Settings → Usage, database size). No upgrade is assumed or proposed. The live database was measured read-only on 18 Oct: about 11.8 MB used, 20 public tables, 11 migrations applied, 0 auth users. That 11.8 MB is the baseline in every projection.

## 1. Summary

**Revision 2 (§11), rule set 1002, res 10, everything in the database counted:**
- 1,000 players, 14 days, measured:
  - database 127.8 MiB, against 317.4 MiB for revision 1;
  - ledger 19.5 MiB, against 196.1 MiB;
  - 112,134 ledger rows against 389,395, because refusals are counters now;
  - 179 B per ledger row, against 528.
- Hostile, twice the earlier load (10 accounts × 20 sessions × 500 units for 7 days): 23.8 MiB with the unit budget, 30.2 MiB without it, against 384 MiB for revision 1.
- Players under 85% of 500 MiB, for 1 season / 4 seasons:
  - (a) keep everything: 746 / 195 (revision 1: 232 / 57);
  - (b) 14-day raw partitions and 120-day proofs on revision 1: 916 / 623;
  - (c) the same retention with the compact ledger, measured on revision 2: **1,611 / 904**, and 1,224 / 765 with 2% hostile accounts.
- **Go/no-go for a capped staging pilot: NO-GO** until the owner decisions in §13 are made and an exact SHA is authorized.

The points below are the revision 1 findings that motivated revision 2.

- **The old estimate was too low.** G34_SERVER_ARCHITECTURE.md §13 assumed about 250 bytes per push row with its indexes. Measured on PostgreSQL 16, a push row costs **526–611 bytes**: about 320 bytes of heap and 200–290 bytes of indexes. The cost per row stays flat from 11,000 to 558,000 rows. Rule set 1002 rows are cheaper (526–555 bytes) than 1001 rows (600–611 bytes), because its refused pushes stay out of the partial one-push index.
- **0011 as written does not fit at the proposed granularity.** Rule set 1002 (res 10 units, res 9 zones), 1,000 players, one 90-day season, everything kept: about **1.9 GiB, 384% of 500 MiB**. With everything kept, the hard-stop line (85%) is reached at about 206 players for one season and 51 players over four seasons. At res 8 (what the movement pipeline stores today) the line is about 620 players for one season.
- **Most of the ledger is refusals.** Under 1002, 70–71% of push rows in a dense area are `refused_take_budget` or `refused_daily_limit`. These are pushes that change nothing. In a sparse area the share is 43%. Under hostile load it is 97%.
- **Hostile load is the real risk.** One account applying 20 sessions a day at the 500-unit cap writes about 10,000 rows, which is 5 MiB a day. The take budget does not limit rows: it turns takes into recorded refusals. The write rate limit alone (20 writes a minute) would allow more than 3 GiB a day per account. A per-walker daily **unit** budget is needed (§6).
- **Recommendation:** keep the raw ledger for 14 days in day partitions, export each partition to an owner-held archive, then drop it. Keep a per-player-day proof for 120 days. Compact superseded snapshots and session cell lists after 14 days. Use the compact ledger layout (§4.A). Add a capacity tripwire with a per-walker unit budget. With all of these, rule set 1002 stays under the hard stop up to about **1,070 players for one season and 670 over four seasons**. 1,000 players for one season comes to about 401 MiB, 80% of quota.

## 2. Method

**Harness:** `backend/scripts/gameplay-storage-bench.ts` (`yarn workspace @movenrun/backend bench:gameplay-storage --profile full`).

- It runs only against a local, disposable PostgreSQL. It refuses any URL whose host is not `localhost`, `127.0.0.1`, `::1` or a Unix socket, before connecting. Each scenario creates its own database and drops it. Nothing here connected to a hosted service.
- **The schema is read at run time.** The bench applies the committed chain from `drizzle/meta/_journal.json` (0000–0010), then the proposed 0011 file. It finds every relation 0011 creates by comparing the catalog before and after. A table added to 0011 later is measured without editing the script. It is flagged as "unmodelled" in the report until `capacity.ts` prices it.
- **Rows are written by the real `GameplayService`:** `createClub`, `joinClub`, `applySession` and `settleDueDays`. The bytes measured are the bytes the service writes. Only the verified `movement_verifications` rows are inserted directly, shaped as the movement pipeline writes them (all provenance and seal columns filled).
- **Synthetic players.** Each player has a home in the play area: a 2 km radius ("dense") or 12 km ("sparse"). Each active day (60% of players) they make 1.5 sessions. Each session is a 1.5–4.5 km walk with heading drift, sampled every 10 m. Cells are those that contain a fix, deduplicated in first-touch order, as `cellsForObservations` does. There is a district map for the whole area (district = res 6 parent) and one club per ten players, which 70% of players join. Hostile accounts apply 20 sessions a day over the same 500-cell block.
- **Rule sets** come from `rules.ts` `RULESETS`. Res 8 and res 9 run under 1001 (cells stored as given). Res 10 runs under 1002 (two-day challenge, 13 takes a day, res 9 zones). One res 10 comparison runs under 1001.
- **Measured at checkpoints after `VACUUM ANALYZE`:** `pg_relation_size` (heap), `pg_indexes_size`, TOAST (`pg_total_relation_size` of the toast relation), `pg_total_relation_size`, exact `count(*)`, dead tuples and `pg_database_size`. The last checkpoint is also measured after `VACUUM FULL`. "Marginal bytes per row" subtracts the empty table's size, so small tables are not inflated by their first pages.
- **Query plans** come from `auto_explain` (`log_analyze`, `log_buffers`) on a connection the service uses. They are the statements the service actually sends, with its real parameters, at 558,000 push rows.
- **Retries:** 50 applies of already-applied sessions in every scenario.
- **Alternatives** (§4) are measured on scratch copies of the same rows in a `bench_alt` schema.

**Environment:** PostgreSQL 16.15, 8 kB blocks (same as Supabase), in a throwaway cluster under `/tmp`. The session scratch directory is not readable by the `postgres` user, so the cluster could not live there. `fsync` was off, which does not change table sizes. Sizes are byte-for-byte what PostgreSQL stores. Supabase adds its own schemas (auth, storage, extensions), and those are in the 11.8 MB baseline.

**Run:** seven scenarios (`--profile full`), about 12 minutes in total. The local empty chain (0000–0010) is 9.1 MiB. Empty 0011 adds 352 KiB (14 tables, 31 indexes).

## 3. Measurements

### 3.1 Push ledger, bytes per row at several row counts

Marginal bytes per row after `VACUUM ANALYZE` (heap / indexes in brackets):

| Scenario (rule set) | Units per session (mean, p95) | Day 5–10 | Day 20 | Day 30 | After VACUUM FULL |
|---|---|---|---|---|---|
| res 8 dense, 250 players (1001) | 4.9, 7 | 607 at 11,291 rows | 611 at 22,338 | 609 at 33,174 (317 / 293) | 545 |
| res 9 dense, 250 (1001) | 11.9, 18 | 603 at 26,321 | 599 at 53,599 | 602 at 81,004 (315 / 287) | 535 |
| res 10 dense, 250 (1002) | 30.8, 45 | 535 at 70,578 | 536 at 137,468 | 535 at 206,162 (320 / 215) | 482 |
| res 10 sparse, 250 (1002) | 32.0, 46 | 540 at 70,906 | 552 at 144,957 | 555 at 214,992 (310 / 245) | 495 |
| res 10 dense, 250 (1001) | 30.8, 45 | | | 602 at 206,162 (315 / 286) | 534 |
| res 10 dense, 1,000 (1002) | 30.8, 45 | 527 at 137,426; 527 at 277,937 | 528 at 557,771 (320 / 207) | | 477 |
| res 10 hostile, 100 + 5 (1002) | 500 for hostile sessions | | | 526 at 368,629 (day 7) | 458 |

At 557,771 rows the push ledger's indexes take 108 MiB in total. The primary key on the text `event_id` (`mv:<uuid>:<cell>`) is the largest: 41 MiB, 78 bytes a row, for an id that is derivable from `(source_session_id, unit_id)`. Next are the one-push partial unique index (13 MiB), the `seq` unique (12 MiB) and four secondary indexes (4–5 MiB each).

### 3.2 Every 0011 table (res 10, 1002, dense 250 players, day 30; sparse in brackets)

| Table | Rows | Marginal bytes per row | After VACUUM FULL | Grows with |
|---|---|---|---|---|
| gameplay_push_events | 206,162 (214,992) | 535 (555) | 482 (495) | every traversed unit of every session |
| gameplay_unit_day_states | 23,198 (115,523) | 203 (184) | 166 (165) | unit × day changed: 0.11 per push dense, 0.54 sparse |
| gameplay_units | 1,194 (35,581) | 343 (198) | 199 (166) | distinct units ever pushed |
| gameplay_unit_challenges | 4,362 (14,754) | 3,014 (402) | 173 (170) | open challenges (current state; churns) |
| gameplay_walker_days | 4,513 | 196 | 163 | active walker × day |
| gameplay_applied_sessions | 6,695 | 601 | 545 | session (the `outcomes` jsonb is most of it) |
| gameplay_credit_lines | 6,921 | 311 | 279 | active player × settled day |
| gameplay_day_settlements | 30 | 1,911 | 819 | day |
| gameplay_day_rules | 30 | 4,096 | 1,911 | day (pinned config jsonb) |
| gameplay_club_days | 750 | 492 | 437 | club × day |
| gameplay_district_days | 90 (775) | 1,274 (1,205) | 910 | district × day |
| gameplay_unit_districts | 2,238 (41,962) | 121 (115) | 106 | play-area cells (operator-loaded) |
| gameplay_clubs, gameplay_club_memberships | 25, 187 | small | | clubs, members |
| movement_verifications (0003; not 0011) | 6,695 | 1,187 | 1,116 | session: 453 bytes plus **22 bytes per traversed cell** |

Existing auth and audit tables (0001), measured with 20,000 synthetic refresh rows each:

| Table | Bytes per row | Today's retention |
|---|---|---|
| security_audit_events (`session_refreshed`) | 266–273 | kept until account deletion (X-25 undecided) |
| auth_sessions (one rotated row per refresh) | 623–632 | pruned 7 days after the 30-day expiry, so about 37 days |

**Churn bloat.** In the dense runs `gameplay_unit_challenges` reached 3,014–6,993 bytes per live row, against 173 after `VACUUM FULL`. Challenges are inserted and deleted on every push, so the table's high-water mark is set by churn, not by live rows. The bench applies sessions far faster than real players do, so autovacuum lags more here than it would in production. Still, it is the table to give per-table autovacuum settings (§8). `gameplay_units` shows the same effect, smaller (343 against 199).

### 3.3 What a database actually grows by

| Scenario | Empty | End | Growth per day |
|---|---|---|---|
| res 8 dense, 250, 30 days | 9.1 MiB | 41.4 MiB | 1.1 MiB |
| res 9 dense, 250, 30 days | 9.1 | 71.5 | 2.1 |
| res 10 dense, 250, 30 days (1002) | 9.1 | 148.1 | 4.6 |
| res 10 sparse, 250, 30 days (1002) | 9.1 | 177.3 | 5.6 |
| res 10 dense, 250, 30 days (1001) | 9.1 | 160.4 | 5.0 |
| res 10 dense, 1,000, 20 days (1002) | 9.3 | 414.4 | **20.3** |
| res 10, 100 players + 5 hostile, 7 days | 9.1 | 203.3 | **27.7** (hostile about 25) |

### 3.4 Outcomes: how much of the ledger changes anything

| Scenario | Rows | Refused (`take_budget` + `daily_limit`) | Share |
|---|---|---|---|
| res 10 dense, 250 (1002) | 206,162 | 141,793 + 1,759 | 70% |
| res 10 dense, 1,000 (1002) | 557,771 | 392,232 + 5,050 | 71% |
| res 10 sparse, 250 (1002) | 214,992 | 91,578 + 751 | 43% |
| res 10 hostile (1002) | 368,629 | 347,787 + 8,073 | 97% |
| res 10 dense, 250 (1001) | 206,162 | 0 + 496 | 0.2% |

Rule set 1002 is a little cheaper per row than 1001. But in the same dense area it writes the same number of rows (206,162, because the walks are identical), and most of them are refusals.

### 3.5 Retries

In every scenario, 50 applies of already-applied sessions returned `replayed: true`. Total gameplay rows and bytes were unchanged, for example 76,152 rows and 50,618,368 bytes before and after at 1,000 players. **Normal retries cost no storage.** A retried upload of the same movement session is also deduplicated upstream by `(user_id, client_session_id)`.

### 3.6 Hot queries (auto_explain, res 10, 1002, 1,000 players, 558,000 push rows)

| Path | Total | Notes |
|---|---|---|
| `applySession` (34 units, new) | 95 ms | **60 ms is one query**: today's takers per unit (`unit_id = ANY(…) AND day = $ AND outcome IN ('eroded','flipped')`). The planner picks `gameplay_push_events_day_idx` and reads all of the day's rows, then filters. Its cost grows with each day's ledger. Everything else is under 7 ms. The deferred take-budget trigger costs 3 index lookups per take (about 0.03 ms) |
| `applySession` (replay) | under 0.1 ms | two index lookups, no writes |
| `settleDay` | 338 ms | The day's entries sort **spills to disk** (28,815 rows, 6.5 MB, external merge), and so does the 7-day session window sort (4.6 MB). The `DISTINCT ON` over **all** unit day states is a seq scan plus sort of every row ever written (19,711 here, 37 ms), so it grows with history. Snapshot compaction (§4.D) bounds it |
| `myHoldings`, `myCredits`, `clubDay`, `districtsDay` | under 1 ms each | index scans |
| `leaderboard` (player credits) | 24 ms | reads every credit line of the season (grows with players × days; fine at pilot scale) |

None of this blocks a pilot. Revision 2 addresses both (§11.3): the partial takers index on day partitions, and `SET LOCAL work_mem` (16 MiB) for the settlement transaction.

## 4. Alternatives, measured on the same rows

All at res 10, 1002, 1,000 players, 557,771 push rows, unless noted.

| Alternative | Measured | Effect |
|---|---|---|
| **A. Compact ledger.** H3 cell as `bigint`, players and sessions as integer surrogates, outcome as `smallint`, event id derived from `(session_no, unit)` instead of stored as text, BRIN on day. Same uniqueness: `(session, unit)` PK, `seq` unique, one-push partial unique on `(walker, unit, day)`, plus `(unit, day)` | **187 bytes per row** (93 heap, 94 indexes) against 477 compact / 528 steady | 2.6–2.8× smaller. A schema change to 0011 (not made here) |
| **B. Coarse proof per push** (day, unit, 16-byte event digest, outcome, strength before → after; no player ids; BRIN) | 68–71 bytes per row | Keeps per-event transitions without identities. Still grows with pushes: 1,000 players at res 10 is about 2.5 MiB a day |
| **C. Day digest** (sha256 over the day's canonical entries in `seq` order) | one row per day, under 100 bytes marginal | `gameplay_day_settlements.input_digest` already covers the settlement inputs |
| **C2. Player-day proof** (day, player, push count, gained, refused, sha256 of the player's events and transitions) | 114–123 bytes per row, one per active player-day | 1,000 players at 60% active is about 70 KiB a day, whatever the resolution |
| **D. Snapshot compaction** (drop unit day states superseded by a later state of the same unit on or before the last settled day) | 94% superseded dense (18,460 of 19,711), 69% sparse (79,942 of 115,523) | Also bounds settlement's `DISTINCT ON` scan |
| **E. Partition the ledger by day range** (10-day ranges here) | Same bytes per row (553, indexes built before load). **Dropping the oldest partition freed 147 MiB of `pg_database_size` at once.** An empty partition with its indexes is 56 KiB | The only option here that gives space back to the quota without `VACUUM FULL`. A row `DELETE` leaves free space PostgreSQL reuses but does not return |
| **F. Null `traversed_hex_ids` after the TTL** (movement_verifications) | 453 bytes per row without cells against 1,131 with them (22 bytes per cell) | Removes the coarse trail and 60% of the row |
| **G. Record refusals as counts, not rows** (not built) | 43–71% of 1002 rows are refusals (§3.4); `gameplay_applied_sessions.outcomes` already counts them per session | Halves the ledger or better. Replay of state is unaffected (a refusal changes nothing), but it changes what an event-level dispute can show, so it is the owner's and the 0011 author's call |

### Independent replay and disputes, under each option

- `settleDay` is a pure function of the stored states, entries, sessions, memberships and district map. Its `input_digest` (sha256 of those canonical inputs) is stored with every settled day and is durable.
- **While raw rows are in the database** (the raw TTL), anyone can replay a day from the database alone and compare it with the header and `input_digest`.
- **After the TTL**, replay needs the archived raw partition. The proposal is to export it to an owner-held compressed file before the drop (`COPY … TO` or `pg_dump --table`). The durable `input_digest` and the per-player-day digest prove the archive was not altered. Without an archive, old days can be verified only at proof level.
- **A dispute or appeal** inside the window is answered from raw rows. After it, the answer comes from the player-day proof (counts and digest) plus the archive. That is why the window (proposed 30 days of appeal after the season) must be decided before anything is deleted.
- Settled credit lines, day headers, club and district days are never deleted (§5). Seasons and boards stay readable for good.

## 5. Data classes: proposed TTL and deletion behaviour

PROPOSALS for the owner. "Raw TTL" is 14 days after the day, during which disputes are checked against raw rows.

| Data class | Where | Today (0000–0011) | Proposed | Deletion behaviour |
|---|---|---|---|---|
| Raw location (coordinates) | Never on the server. Device retry queue only (`LOCATION_DATA.md`) | Not stored server-side; device queue 7 days | **None kept after verification**: keep it so, and add a test that no coordinate column exists in 0011 (none does today) | n/a |
| Route summaries (distance, duration, confidence, seal) | movement_verifications | Kept forever | Kept for the season plus 30 days; this is the active-day input to settlement (D1, 7-day window) | Row delete after that. **Note:** deleting a session row cascades to its push events and applied session (`ON DELETE CASCADE`). Any session TTL must run after the ledger's, or it silently removes the ledger |
| Route cells (`traversed_hex_ids`) | movement_verifications | Kept forever | Raw TTL (14 days), then set to NULL | Row update; leaves reusable free space |
| Push events (raw ledger) | gameplay_push_events | Kept forever (append-only trigger) | Raw TTL in day partitions; export, then `DROP` the partition | DDL drop by the owner role only. Row triggers do not fire on a drop, so the append-only guarantee becomes "only the owner role can drop a whole, exported, settled partition". Needs an approved retention policy |
| Proofs | new table (not built) | n/a | One player-day proof per active player-day, kept for the season plus 30 days (120 days), then dropped by season partition | DDL drop |
| Applied-session receipts | gameplay_applied_sessions | Kept forever | Raw TTL. After it, a retried apply gets 409 `day_closed` instead of the stored receipt | Row delete |
| Take counters | gameplay_walker_days | Kept forever | Raw TTL (only the day itself needs them) | Row delete |
| Snapshots | gameplay_unit_day_states | Kept forever | Latest state per unit kept; superseded rows deleted after the raw TTL | Row delete; bounds settlement's scan |
| Current state | gameplay_units, gameplay_unit_challenges | Current only | Current only (no TTL); tune autovacuum for the challenge churn | Erasure only |
| Counters and settled aggregates | day settlements, day rules, credit lines, club and district days, clubs, memberships | Kept forever | **Kept forever** (small; the season record) | Erasure cascades as today |
| PII and security events | security_audit_events, auth_sessions | Audit kept until account deletion; auth sessions about 37 days | X-25 proposal: routine (`session_refreshed`) 30 days, security events 180 days, `account_deleted` kept | Row delete in batches (as the existing session pruning does) |
| Shareable geography | gameplay_unit_districts, public aggregates | Kept | Kept, versioned (`districts_version`); no personal data | Replaced by version |

## 6. Projections

Model: `backend/src/gameplay/capacity.ts` `projectStorage`, priced with the measured bytes per row from the res 10 dense 1,000-player run (rule set 1002), the res 9 run and the res 8 run.

**Assumptions:**
- 60% of players are active on a day, with 1.5 sessions each, and units per session as measured (4.9 at res 8, 11.9 at res 9, 30.8 at res 10).
- The day-state ratio is the highest measured (0.54 per push, sparse) for every resolution, which is conservative.
- Distinct units grow with players at the measured sparse spread (142 res 10 units per player, scaled by cell area), bounded by a 1,000 km² play area.
- The district map covers the whole area. There are 6 token refreshes per active day.
- Current-state tables are priced compact × 1.5 for churn.
- **Hostile:** 1% of players at 20 sessions × 500 units a day for 14 days before someone stops it.
- **Heavy:** 3 sessions a day, 80% active.

All figures include the 11.8 MiB live baseline. Percentages are of 500 MiB. The bench prints the full grid; the rows below are a subset.

**0011 as written (keep everything):**

| Unit | Players | 1 season | 2 seasons | 3 seasons | 4 seasons |
|---|---|---|---|---|---|
| res 8 | 50 | 49 (10%) | 82 (16%) | 115 (23%) | 147 (29%) |
| res 8 | 250 | 181 (36%) | 328 (66%) | 475 (95%) | 623 (125%) |
| res 8 | 1,000 | 672 (134%) | 1,250 (250%) | 1,828 (366%) | 2,405 (481%) |
| res 8 | 5,000 | 3,287 (657%) | 6,161 | 9,034 | 11,908 (2382%) |
| res 9 | 50 | 72 (14%) | 126 (25%) | 180 (36%) | 234 (47%) |
| res 9 | 250 | 281 (56%) | 526 (105%) | 771 (154%) | 1,015 (203%) |
| res 9 | 1,000 | 1,059 (212%) | 2,020 | 2,981 | 3,943 (789%) |
| res 9 | 5,000 | 5,197 (1039%) | 9,980 | 14,762 | 19,544 (3909%) |
| res 10 (1002) | 50 | 126 (25%) | 221 (44%) | 317 (63%) | 412 (82%) |
| res 10 (1002) | 250 | 507 (101%) | 958 (192%) | 1,409 (282%) | 1,861 (372%) |
| res 10 (1002) | 1,000 | 1,918 (384%) | 3,703 | 5,488 | 7,273 (1455%) |
| res 10 (1002) | 5,000 | 9,375 (1875%) | 18,272 | 27,170 | 36,068 (7214%) |
| res 10, sparse | 1,000 | 1,992 (398%) | 3,857 | 5,723 | 7,588 (1518%) |
| res 10, rule set 1001 | 1,000 | 2,257 (451%) | 4,389 | 6,521 | 8,653 (1731%) |
| res 10, heavy | 1,000 | 4,768 (954%) | 9,367 | 13,965 | 18,564 (3713%) |
| res 10 + 1% hostile | 1,000 | 2,812 (562%) | 4,597 | 6,382 | 8,167 (1633%) |

**Recommended: 14-day ledger partitions, player-day proofs, compaction, compact ledger:**

| Unit | Players | 1 season | 2 seasons | 3 seasons | 4 seasons |
|---|---|---|---|---|---|
| res 8 | 250 | 76 (15%) | 95 (19%) | 113 (23%) | 131 (26%) |
| res 8 | 1,000 | 254 (51%) | 316 (63%) | 376 (75%) | 435 (87%) |
| res 9 | 250 | 90 (18%) | 110 (22%) | 130 (26%) | 151 (30%) |
| res 9 | 1,000 | 291 (58%) | 355 (71%) | 417 (83%) | 479 (96%) |
| res 10 (1002) | 50 | 51 (10%) | 60 (12%) | 69 (14%) | 79 (16%) |
| res 10 (1002) | 250 | 132 (26%) | 152 (30%) | 172 (34%) | 192 (38%) |
| res 10 (1002) | 1,000 | 401 (80%) | 464 (93%) | 524 (105%) | 585 (117%) |
| res 10 (1002) | 5,000 | 1,713 (343%) | 2,000 | 2,276 | 2,553 (511%) |
| res 10, sparse | 1,000 | 394 (79%) | 455 (91%) | 514 (103%) | 573 (115%) |
| res 10, heavy | 1,000 | 745 (149%) | 872 (174%) | 996 (199%) | 1,120 (224%) |
| res 10 + 1% hostile | 1,000 | 688 (138%) | 750 (150%) | 811 (162%) | 872 (174%) |

**Most players under the hard stop (85% of 500 MiB):**

| Unit | Keep everything: 1 season / 4 seasons | TTL 45 d + per-push proof | 14 d partitions + player-day proof | Same + compact ledger |
|---|---|---|---|---|
| res 8 | 622 / 166 | 915 / 569 | 1,570 / 920 | 1,727 / 974 |
| res 9 | 388 / 98 | 582 / 365 | 1,245 / 774 | 1,510 / 874 |
| res 10 (1002) | 206 / 51 | 306 / 193 | 774 / 539 | 1,072 / 674 |

**Reading the tables:**
- With retention, what remains over several seasons is mostly durable, small-per-row history: credit lines, session summaries (453 bytes each, kept for the season plus 30 days), 30 days of audit and 37 days of auth sessions.
- Hostile load matters even under retention. Fourteen days of 1% abuse adds about 290 MiB at 1,000 players, because the abuse sits inside the raw window. **Retention does not replace the budget and the tripwire.**
- A 5,000-player pilot does not fit Supabase Free at any resolution with this design. At that size the decision is a smaller pilot or a different plan; no upgrade is assumed here.

## 7. Recommendation

1. **Before 0011 is promoted, decide the retention policy.** Use §5, or change it. The append-only trigger and the cascade from `movement_verifications` both depend on it.
2. **Change 0011's ledger shape** before any data exists, while it is still free to change:
   - Partition `gameplay_push_events` by day range. The primary key becomes `(…, day)`.
   - Derive the event id instead of storing text.
   - Store H3 cells as `bigint` and players as integer surrogates.
   - Optionally, record refusals as counts.

   Measured together: 187 bytes per row in place of about 528, and dropped partitions return space immediately. **Done in revision 2** (§11): 179 bytes per row measured.
3. **Retention jobs** (owner-approved, not built): export and drop raw partitions older than 14 days, compact superseded snapshots, null cell lists, and prune routine audit rows after 30 days (X-25). All run in the existing maintenance loop and in bounded batches, like `pruneExpiredSessions`.
4. **Capacity tripwire and per-walker unit budget** (§8), before `MOVENRUN_GAMEPLAY_ENABLED` is ever set.
5. **Pilot size on Free:** at res 10 with rule set 1002 and everything above, about 1,000 players for one season or 670 over four seasons. Without changes, about 200 players for one season.

## 8. Capacity tripwire, backpressure and shutdown (design; pure functions only)

The pure function is `capacityTripwire()` in `backend/src/gameplay/capacity.ts`. Unit tests are in `capacity.test.ts`. **Revision 2 wires it** as an injectable `CapacityGuard` (`createCapacityGuard`). It is off unless `MOVENRUN_GAMEPLAY_CAPACITY_QUOTA_MIB` is set, and it runs only with the gameplay flag on (§11.6). The quota value is an owner decision.

**Input:** `pg_database_size(current_database())` (one cheap catalog read; the server would take it in the maintenance loop every 15 minutes) and the trailing daily growth.

| Level | Line (of the confirmed quota) | At 500 MiB | What the push path does |
|---|---|---|---|
| ok | under 60% | under 300 MiB | normal |
| warn | 60%, or the next line is less than 14 days away at current growth | 300 MiB | alert the owner (log line plus health flag); nothing refused |
| backpressure | 75%, or the hard stop is less than 14 days away | 375 MiB | each walker's daily unit budget shrinks linearly from 100% to 25%; new players' first apply waits; club and district day writes may be skipped (`clubs_status = 'skipped'`); settlement continues |
| hard stop | 85%, or quota minus a 25 MiB reserve, whichever is lower; or the hard stop is less than 7 days away while in backpressure; or the size is unreadable or the config invalid (fails closed) | 425 MiB | `applySession` returns 503 `capacity_hard_stop` and writes nothing. Settlement of days already played, account erasure, retention deletes and all reads continue |

**Where the thresholds come from:**
- The **25 MiB reserve** covers 14 days of settlement at 1,000 players (about 0.3 MiB a day of credit lines, headers and club days, measured), retention and erasure deletes (they need WAL, not table space), and a small-table `VACUUM FULL`. Above the reserve, the 15% margin is room for one day of the worst measured growth (20 MiB a day at 1,000 res 10 players) plus slack, so the line cannot be crossed between two checks.
- At the recommended design and 250 players (about 1.5 MiB a day), warn to hard stop is more than 80 days. At 0011 as written with 1,000 res 10 players (20 MiB a day), the growth rule raises warn on day 1.

**Per-walker daily unit budget** (`remainingPushBudget`): units a walker may push in a day, base × the tripwire factor. The suggested base is 300 units a day: heavy normal play measured about 93 (3 × 31), and the p95 session is 45. A push past the budget is not written at all. That differs from `refused_take_budget`, which is written. It bounds an abusive account at about 0.15 MiB a day, against about 5 MiB a day today.

**Feature-flag shutdown:** the existing `MOVENRUN_GAMEPLAY_ENABLED` is the manual kill switch. Unsetting it unmounts every route and the maintenance task, and data stays (G34_SERVER_ARCHITECTURE.md §11). The hard stop is the automatic, narrower version of the same thing: pushes only.

## 9. 0011 schema-review packet

### 9.1 Current against proposed

| | 0000–0010 (live) | With 0011 (685852b) |
|---|---|---|
| Public tables | 20 (measured live, and locally) | 34 (+14 `gameplay_*`) |
| Indexes added | — | 31: 30 on the new tables plus `movement_verifications_verified_end_time_idx` on an existing table |
| Functions | — | +8 (`gameplay_current_player_id` SECURITY DEFINER, `reset_erased_holder`, `push_events_append_only`, `check_day_lines`, `settlements_final`, `day_rules_final`, `check_take_budget`, `check_challenge`) |
| Triggers | — | +9, including 2 deferred constraint triggers (day lines add up; take budget) |
| RLS | on for every public table | on for all 14 new tables (the test asserts every public table) |
| Policies | none open to Data API roles | 9 `SELECT` policies for `authenticated`: own rows (units, push events, applied sessions, credit lines, memberships) and public aggregates (settled day headers, clubs, club days, district days). No write policy for anyone |
| Grants | closed | `REVOKE ALL` from PUBLIC, `anon` and `authenticated` on all 14. Column-level `SELECT` to `authenticated` on 9. Nothing for `anon`. `unit_day_states`, `unit_districts`, `day_rules`, `walker_days` and `unit_challenges` are server-only |
| Empty size | 9.1 MiB locally (11.8 MB live) | +352 KiB |

### 9.2 Compatibility with 0000–0010

- Additive: no existing column changes.
- One index is added to `movement_verifications`.
- New foreign keys point at `users(id)` (cascade, or set NULL with the reset trigger) and at `movement_verifications(id)` (**cascade**).
- Existing account deletion keeps working and removes every gameplay row naming the person. The 0011 tests cover this.
- **Coupling to watch:** any future deletion of `movement_verifications` rows (a session TTL) deletes the matching push events and applied sessions through the cascade, and the append-only trigger allows it. A session TTL must be designed together with the ledger's.

### 9.3 Forward path

1. Owner approves the retention policy and the tripwire.
2. The 0011 author applies the ledger-shape changes (§7.2) while 0011 is unapplied.
3. Re-run this bench (`--profile full`). It reads 0011 at run time.
4. Promote 0011 into `drizzle/` with its journal entry and checksum (G34_SERVER_ARCHITECTURE.md "Going live").
5. Back up, then deploy.

### 9.4 App rollback, recovery and destructive removal

- **App rollback = keep schema and data.** Unset `MOVENRUN_GAMEPLAY_ENABLED`, restart. Routes and the maintenance task disappear, every gameplay row stays, and the API runs on 0000–0011 unchanged. This is the rollback for any application problem.
- **`0011_gameplay_holdings.down.sql` destroys gameplay records.** It drops all 14 tables (holdings, the push ledger, settled credits, clubs, rule pins, counters, challenges), the 8 functions and the added index. It is **owner-only**, run in one transaction with an explicit decision, and never part of a deploy or an automatic rollback. If 0011 was promoted, it must also remove its `drizzle.__drizzle_migrations` row in the same transaction.
- **Backup and recovery decision needed.** Supabase Free has no point-in-time restore. Before promoting 0011, and before any down migration or partition drop, the owner must decide how gameplay data is backed up: a `pg_dump --table='gameplay_*'` kept off the database, plus the partition exports of §5, and who holds them. Undecided today.

### 9.5 Flag-off proof

With the flag unset no gameplay query runs, so 0011's tables neither grow nor are read. The architecture document's tests check this on the real `createApiApp`: every `/gameplay/*` path gets the API's 404 and no maintenance task is registered. Storage with the flag off is therefore the empty schema, +352 KiB.

### 9.6 Worst case

**Unbounded today:**
- Per account, the write limit allows about 14,400 applies a day at up to 500 units each. At the measured 526 bytes per row, that is about 3.5 GiB a day: the quota would fill in hours.
- Measured at a realistic abuse rate (20 sessions a day), it is 5 MiB a day per account.
- With the per-walker unit budget (300 units a day) and the hard stop, the worst case is about 0.15 MiB a day per account. Total growth stops at 425 MiB, with 75 MiB left for settlement, erasure and recovery.

## 10. Files and how to re-run

- `backend/scripts/gameplay-storage-bench.ts`: the harness (`yarn workspace @movenrun/backend bench:gameplay-storage`, with `MOVENRUN_BENCH_DATABASE_URL` set to a local superuser URL).
  - `--profile quick` runs one small scenario in about 5 seconds; `--profile full` runs all seven in about 12 minutes.
  - `--out` writes JSON and `--markdown` writes the full report with every plan.
  - `--from <json>` re-projects saved measurements without touching a database.
- `backend/src/gameplay/capacity.ts`: the projection model, retention policies, tripwire, unit budget, the guard and its environment parsing. The service and `wiring.ts` use the guard and the budget only with the gameplay flag on.
- `--profile capacity` runs the revision 2 study. `--service-root <old checkout>/movenrun/backend` measures another checkout's service and 0011 with the same harness, and `--baseline <json>` adds the old-versus-new tables (§11).
- `backend/src/gameplay/capacity.test.ts`: the tests for them.

## 11. Revision 2: compact, day-partitioned 0011 (measured against revision 1)

**SIMULATION ONLY:** local PostgreSQL 16.15, synthetic players. Both shapes ran with one harness: `--profile capacity`. Revision 1 was measured with `--service-root` pointing at a checkout of 1541a01. Rule set 1002, res 10, dense 2 km area, 60% active, 1.5 sessions per active day, 30.7 units per session (p95 45). The 14-day runs are 100, 200, 500 and 1,000 players. The hostile runs use 100 players plus 10 accounts × 20 sessions × 500 units a day for 7 days, which is twice the first study's 5 accounts. They ran with the 300-unit budget and with no budget.

### 11.1 What changed (the full column changelog is in the 0011 header)

| | Revision 1 (1541a01) | Revision 2 |
|---|---|---|
| Ledger key | `event_id text` PK (`mv:<uuid>:<cell>`), `seq` identity unique | `(source_no, unit, day)` PK, derived; `seq` from a sequence (no index) |
| Unit | `unit_id text` (15 chars) | `unit bigint` (H3 index; canonical lowercase only; CHECK cell mode) |
| Players in ledger and snapshots | `walker_id`, `previous_holder_id`, `new_holder_id` text | `walker_no`, `previous_holder_no`, `new_holder_no` integer (`gameplay_players`, cascades from `users`) |
| Outcome, push kind | text, text | `outcome smallint` 1–4; `shade_strength smallint` (0 = stepped on) |
| Refusals | one row each (70% of 1002 rows) | counters on `gameplay_walker_days` plus at most 1,000 refused units (one per zone) for upkeep |
| Partitioning | none | `push_events`, `walker_days` by day, in schema `gameplay_partitions`, created ahead by `gameplay_ensure_day_partitions` |
| Proof | none | `gameplay_player_day_proofs`: sha256 of the walker's accepted rows in `seq` order plus a refusal line, written at settlement |
| Receipts | `outcomes jsonb` | `outcome_counts int[8]`, `rejected_by_reason jsonb` (NULL when empty) |
| Unit budget, guard | none | 300 verified units per walker per day (configurable), guard fails closed (§11.6) |
| Tables, indexes (empty) | 14, 31, 352 KiB | 16, 34, 336 KiB; plus 40 KiB per day for the two partitions |

The API is unchanged for 1001 and 1002: the same outcomes, counts, replay results, holdings, credits and boards. The local tests check this. One storage tightening: a unit that is not a canonical H3 cell now gets 422 `unit_resolution_mismatch`. The movement pipeline only ever produces H3 cells.

### 11.2 Measured, scenario by scenario (database after VACUUM ANALYZE, every table counted)

| Scenario | Shape | Pushes (normal / hostile) | Ledger rows | Ledger MiB | All 0011 MiB | movement_verifications MiB | Database MiB | Settle temp MiB (worst day) | Settle ms (worst day) |
|---|---|---|---|---|---|---|---|---|---|
| 100 players, 14 d | rev 1 | 39,928 / 0 | 39,928 | 20.8 | 27.5 | 1.5 | 38.4 | 0 | 57 |
| | rev 2 | 39,928 / 0 | 13,150 | 4.1 | 11.4 | 1.5 | 23.6 | 0 | 63 |
| 200 players, 14 d | rev 1 | 78,591 / 0 | 78,591 | 40.2 | 52.7 | 2.9 | 65.2 | 0 | 91 |
| | rev 2 | 78,591 / 0 | 24,040 | 5.7 | 18.7 | 2.9 | 32.7 | 0 | 96 |
| 500 players, 14 d | rev 1 | 193,710 / 0 | 193,710 | 98.1 | 137.0 | 7.3 | 154.0 | 0 | 206 |
| | rev 2 | 193,710 / 0 | 57,376 | 11.0 | 50.0 | 7.3 | 68.7 | 0 | 184 |
| 1,000 players, 14 d | rev 1 | 389,354 / 0 | 389,395 | 196.1 | 293.0 | 14.4 | 317.4 | **11.0** | 461 |
| | rev 2 | 389,354 / 0 | 112,134 | 19.5 | 101.8 | 14.4 | 127.8 | 0 | 252 |
| 100 + 10 hostile, 7 d | rev 1 | 19,973 / 700,000 | 719,973 | 361.0 | 369.7 | 5.2 | 384.3 | **23.1** | 1,104 |
| | rev 2, budget 300 | 19,973 / 21,000 (679,000 rejected `unit_budget`) | 8,202 | 2.3 | 8.5 | 5.3 | 23.8 | 0 | 388 |
| | rev 2, no budget | 19,973 / 700,000 | 20,256 | 3.8 | 14.8 | 5.2 | 30.2 | 0 | 376 |

- **Bytes per row at 1,000 players.** These have the 40 KiB per day of empty partitions taken out.
  - Ledger: 179, against 528 in revision 1 (same as the 187 estimate from the scratch copy).
  - Walker day: 355, against 186; the refused-visit sample is most of the difference.
  - Player-day proof: 138.
  - Applied session: 396, against 585.
  - Unit day state: 143, against 226.
- **After VACUUM FULL**, at 1,000 players: 57 MiB against 216 MiB.
- **Accepted share.** 28.8% of normal pushes (the rest are refusals, now counters). For hostile accounts it is 6.5%.
- **Unit budget.** The hostile accounts were held to exactly 300 processed units a day each: 10 × 300 × 7 = 21,000. The movement pipeline still stored their sessions and cell lists (5.3 MiB), because the budget sits in gameplay, after movement.
- **Retries.** 50 replays changed no rows or bytes in either shape.
- **Churn, still open.** In both shapes `gameplay_unit_challenges` reached 66–80 MiB for about 12,000 live rows, against 1.9 MiB after VACUUM FULL. The bench pushes far faster than people walk, so autovacuum lags. The projection prices the table compact × 1.5. Per-table autovacuum settings for this table belong in the owner-approved runbook (§8, §13).

### 11.3 Hot paths, takers lookup, settlement spill (1,000 players, last day)

auto_explain totals, revision 1 → revision 2:
- `applySession` (new session): 60.5 → 12.5 ms.
- `settleDay`: 164.7 → 74.3 ms.
- Replays, `myHoldings`, `myCredits`, `clubDay` and `districtsDay`: under 0.2 ms in both.
- Leaderboards: about 5 ms in both.

**"Who took this unit today"** (`EXPLAIN ANALYZE`, 500 of the day's most-pushed units):

| Query | Revision 1 | Revision 2 |
|---|---|---|
| Batch takers lookup (the one `applySession` sends) | Index scan on `push_events_day_idx`, 1,145 buffers, 4.07 ms. With the full `(unit_id, day)` index replaced by a partial one on takes (in a rolled-back transaction), the planner still picks the day index: 1,145 buffers, 3.90 ms | Only the day's partition is scanned (seq scan of `…_d<day>`, 86 buffers, 2.0 ms). Pruning does the work the day index did |
| One unit, takes only | — | Bitmap scan on the partition's partial `(unit, day) WHERE outcome IN (3,4)` index, 26 buffers, 0.06 ms |
| One unit, all accepted pushes (a dispute) | day index, 2.8 ms | seq scan of one day partition, 75 buffers, 0.33 ms |
| Index size | full `(unit_id, day)` 3.1 MiB over the ledger; partial on takes 1.3 MiB | partial takers index 104 KiB per day partition; PK 336 KiB; one-push unique 256 KiB |

**Settlement sort spill.**
- Revision 1 at the default `work_mem` (4 MiB) wrote temp files on its worst days: 11.0 MiB at 1,000 players and 23.1 MiB under hostile load. Two settlement statements spilled to disk (external merge).
- Revision 2 sets `SET LOCAL work_mem = 16 MiB` for the settlement transaction. Its rows are also smaller, because refusals are not rows. It wrote **0 bytes** of temp files on every day of every scenario (`pg_stat_database.temp_bytes` before and after each settlement).
- The two changes were not measured separately.

### 11.4 Reclaiming a day: partition drop against DELETE, and erasure

| 1,000 players, one day of ledger | Revision 1 (no partitions; scratch copy) | Revision 2 |
|---|---|---|
| Rows in the day | 26,490 | 7,653 |
| DELETE + VACUUM | 26 ms + 42 ms; **0 bytes returned** (space stays with the table for reuse) | 7 ms + 10 ms; 0 bytes returned (same test on an unpartitioned copy) |
| VACUUM FULL (exclusive lock, whole table rewritten) | 2.46 s, 32.8 MiB returned | 0.20 s, 5.0 MiB returned |
| `DROP` the day's partitions (ledger and walker days) | n/a | **23 ms, 1.4 MiB returned at once**, no dead tuples, no VACUUM, no lock on other days |

**Erasure** used the real account-deletion store, on the player with most sessions:
- 1,000 players: 180 ms (revision 1) against 47 ms (revision 2).
- Hostile run: 1.5 s against 19 ms.
- In both shapes it removed the player's ledger rows, in every partition in revision 2.

### 11.5 Projections (SIMULATION ONLY)

The model is `capacity.ts` `projectStorage`, priced from the 1,000-player runs above. It counts everything:
- the 0011 tables;
- `movement_verifications` rows, with the cell lists separately;
- `auth_sessions` (37-day life);
- `security_audit_events`;
- the 11.8 MiB live baseline.

Inputs:
- distinct units and open challenges grow with players at the highest measured per-player rate;
- 6 token refreshes per active day;
- a 1,000 km² area;
- 2% hostile: 2% of accounts × 20 sessions × 500 units a day for 14 days, which is twice the first study's 1%;
- revision 2 applies the 300-unit budget; revision 1 has none.

Policies:
- (a) keeps everything.
- (b) is the proposed retention: raw ledger and walker days 14 days in dropped partitions, player-day proofs 120 days, receipts 14 days, superseded snapshots compacted after 14 days, cell lists nulled after 14 days, routine audit 30 days (X-25).
- (c) is (b) with the compact ledger. For revision 1 this is the scratch-copy estimate. For revision 2 it is what was measured, so revision 2's (b) and (c) are the same row.

MiB (% of 500 MiB):

| Policy | Players | 1 season | 4 seasons | 1 season + 2% hostile | 4 seasons + 2% hostile |
|---|---|---|---|---|---|
| (a) rev 1, keep everything | 100 / 200 / 500 / 1,000 | 201 (40%) / 370 (74%) / 879 (176%) / 1,726 (345%) | 705 (141%) / 1,356 / 3,310 / 6,566 (1313%) | 360 (72%) / 690 / 1,677 / 3,323 (665%) | 864 / 1,675 / 4,108 / 8,163 (1633%) |
| (b) rev 1, proposed retention | 100 / 200 / 500 / 1,000 | 74 (15%) / 117 (23%) / 246 (49%) / 461 (92%) | 113 (23%) / 173 (35%) / 351 (70%) / 649 (130%) | 223 (45%) / 414 (83%) / 989 / 1,947 (389%) | 262 / 470 (94%) / 1,094 / 2,135 (427%) |
| (c) rev 1 + compact ledger (estimate) | 100 / 200 / 500 / 1,000 | 62 (12%) / 92 (18%) / 183 (37%) / 335 (67%) | 100 (20%) / 147 (29%) / 288 (58%) / 523 (105%) | 119 (24%) / 207 (41%) / 471 (94%) / 911 (182%) | 158 / 263 / 577 (115%) / 1,100 (220%) |
| (a) rev 2, keep everything | 100 / 200 / 500 / 1,000 | 86 (17%) / 138 (28%) / 296 (59%) / 558 (112%) | 249 (50%) / 433 (87%) / 983 (197%) / 1,901 (380%) | 92 (18%) / 152 (30%) / 330 (66%) / 627 (125%) | 256 / 447 (89%) / 1,018 / 1,971 (394%) |
| **(b) = (c) rev 2, proposed retention (measured)** | 100 / 200 / 500 / 1,000 | **55 (11%) / 79 (16%) / 153 (31%) / 275 (55%)** | **93 (19%) / 135 (27%) / 258 (52%) / 464 (93%)** | 62 (12%) / 94 (19%) / 191 (38%) / 352 (70%) | 101 (20%) / 150 (30%) / 297 (59%) / 541 (108%) |

**Most players under 85% of 500 MiB:**

| Policy | 1 season | 4 seasons | 1 season + 2% hostile | 4 seasons + 2% hostile |
|---|---|---|---|---|
| (a) rev 1, keep everything | 232 | 57 | 124 | 44 |
| (b) rev 1, proposed retention | 916 | 623 | 224 | 174 |
| (c) rev 1 + compact ledger (estimate) | 1,296 | 790 | 442 | 361 |
| (a) rev 2, keep everything | 746 | 195 | 660 | 188 |
| **(b) = (c) rev 2, proposed retention** | **1,611** | **904** | **1,224** | **765** |

**Where the bytes go**, revision 2, (b), at 1,000 players over 4 seasons (464 MiB):

| Class | MiB |
|---|---|
| Movement session rows, kept in the model | 151 |
| Auth sessions and audit | 125 |
| Settled credit lines and day aggregates | 108 |
| Ledger | 20 |
| Snapshots | 14 |
| District map | 10 |
| Proofs | 9.5 |

So the next lever is not the ledger. It is the movement-summary TTL and X-25. Both are owner decisions.

**Archive size (estimate, not measured).** About 8,000 accepted ledger rows a day at 1,000 players. As CSV with integers that is about 0.5 MB, and roughly 0.15 MB after gzip. 120 days of archives is about 20 MB.

### 11.6 Unit budget and capacity guard (CODE TESTED LOCALLY)

- **Unit budget.**
  - The budget is 300 verified units per walker per day (`MOVENRUN_GAMEPLAY_UNIT_BUDGET`, at least 1; a malformed value stops the API from starting).
  - It is counted on the server in `gameplay_walker_days.units_used`, under the walker-day row lock, and is spent per processed push, accepted or refused.
  - It is separate from the 13-take budget.
  - A push past it is rejected as `unit_budget` and nothing is written. A retry of the source is a replay, so nothing is double-counted.
  - Tested: with a budget of 5, ten parallel sessions of one walker spend exactly 5.
- **Capacity guard.**
  - `createCapacityGuard` reads `pg_database_size` at most once a minute and keeps 24 h of samples, extrapolating growth only after an hour of history. It feeds `capacityTripwire`.
  - It is on only when `MOVENRUN_GAMEPLAY_CAPACITY_QUOTA_MIB` is set (at least 50). Under backpressure the unit budget is scaled by the tripwire factor.
  - It fails closed. A hard stop, an unreadable size, a guard that throws or an invalid factor makes `applySession` answer **503 `capacity_hard_stop`** and write nothing.
  - Reads, replays and settlement continue.
  - Tested with a mock guard and with the real guard.
- **Flag off.** Nothing above runs, and no 0011 SQL is sent. Tested against a database without 0011: every gameplay route is 404, no gameplay relation exists, and `xact_rollback` is unchanged.
## 12. Retention design (OWNER DECISION; nothing here is enforced)

**Status: PROPOSAL.** No retention job, archive, export, drop or delete exists. Revision 2 only makes retention *possible* without bloat: the ledger and the walker-day counters are day partitions, and a day can be dropped whole. Every TTL below needs the owner's decision. Until then, everything is kept, and the capacity guard and the unit budget are the only limits.

### 12.1 Per-table purpose and proposed TTL

"Day" means the game day the row belongs to. "Raw window" means 14 days after the day: disputes are checked against raw rows during it.

| Table | Purpose | Proposed TTL | How it goes |
|---|---|---|---|
| `gameplay_push_events` (day partitions) | Raw accepted pushes: holder before and after, strengths, source | 14 days, then archive (12.2) and drop the partition | `DROP TABLE gameplay_partitions.gameplay_push_events_d<day>` after the export is verified |
| `gameplay_walker_days` (day partitions) | Takes, verified units, refusal counters and the refused-visit sample (at most 1,000 units) | 14 days (only the day itself needs them; the proof keeps the totals) | Same drop, same day |
| `gameplay_player_day_proofs` | sha256 of the walker's accepted rows in `seq` order, plus counts: proves an archive was not altered | 120 days (season plus 30-day appeal) | Row delete by day, in batches |
| `gameplay_applied_sessions` | Receipts: a retried apply returns the stored result | 14 days. After that a retry gets 409 `day_closed` | Row delete |
| `gameplay_unit_day_states` | End-of-day snapshots | The latest per unit is kept; superseded rows are deleted after 14 days | Row delete (bounds settlement's `DISTINCT ON`) |
| `gameplay_units`, `gameplay_unit_challenges` | Current state | No TTL (current only) | Erasure only |
| `gameplay_players` | user ↔ integer number | Lives as long as the account | Cascades from `users` on erasure |
| Settlements, credit lines, day rules, club days, district days, clubs, memberships | The season record | Kept | Erasure cascades as today |
| `gameplay_unit_districts` | Operator-loaded district map, no personal data | Kept, versioned | Replaced by version |
| `movement_verifications` summary row | Verified session (distance, duration, confidence, seal) | Season plus 30 days. **It must outlive the ledger's raw window**: deleting it cascades to its applied-session receipt | Row delete |
| `movement_verifications.traversed_hex_ids` | Route cells | 14 days, then set to NULL | Row update |
| `security_audit_events` | Security trail | **X-25 matrix (proposal only):** `session_refreshed` 30 days, security rows 180 days, anonymous `account_deleted` kept | Row delete in batches |
| `auth_sessions` | Refresh tokens | Already pruned 7 days after the 30-day expiry (about 37 days). Unchanged | Existing pruning |

Projection (b) in §11 uses exactly these TTLs.

### 12.2 Archive: format, encryption, keys, location, cost

- **Format.** One file per day and table: `COPY (SELECT … ORDER BY seq) TO STDOUT WITH (FORMAT csv, HEADER)`. It has integer player numbers and bigint units only, with no user ids, no e-mail and no coordinates. It is compressed with gzip. The size estimate is in §11.5.
- **Encryption.** `age` (free, open source) to an X25519 recipient. The server or job holds only the **public** key. It can write archives but cannot read them.
- **Key ownership.** The private key belongs to the owner. It is kept offline (a password manager plus a paper or USB copy), never in Render, Supabase, Vercel, the repository or CI. The owner must decide who else, if anyone, holds a copy. If the key is lost, every archive is lost.
- **Location (free only).** Two options, for the owner to choose:
  1. the owner's own disk, plus one off-site copy;
  2. a private Supabase Storage bucket on the existing project (the Free plan includes 1 GB of storage). The data stays with the same vendor, but it is ciphertext there.

  Paid object stores, and stores that need a card on file, are out of scope. A public repository or bucket is never allowed.
- **Cost.** $0 at pilot scale. The owner must confirm the Storage allowance on the dashboard before relying on it.
- **Who runs it.** An owner-run script on the owner's machine, with read access to the database. It is not built, and it is not part of the API.

### 12.3 User deletion

- **Active database.** Account deletion (`accountDeletion.ts`) deletes the user. That cascades:
  - to `gameplay_players`, and through it to the player's ledger rows in every partition, walker days and proofs;
  - to the player's receipts, credit lines and memberships.

  Holder columns that pointed at the player become NULL. The tests cover this on revision 2. The bench measured it with the real store (§11.4).
- **Archives.** An encrypted file cannot be edited one person at a time. Proposal:
  1. Archives name players only by `player_no`. Once the `gameplay_players` row is deleted, nothing in the database links that number back to a person, and numbers are never reused.
  2. The manifest keeps an **erasure list**: the player numbers erased after each archive was written. Every restore drops those rows before anything else.
  3. Archives expire at 120 days, so erasure in archives is complete within a known bound.

  Whether pseudonymous rows plus a bounded expiry meet the owner's legal obligations is a legal question for the owner. It is not answered here.

### 12.4 Manifest, restore and appeal, legal hold

- **Manifest** (proposed table, not built). One row per archived day and table, holding:
  - row count, sha256 of the plain stream and sha256 of the encrypted file;
  - the `age` recipient's fingerprint and the location;
  - the settlement's `input_digest` and a roll-up of that day's player-day proofs;
  - a `verified_at` time, a `dropped_at` time and a `hold` flag.

  It contains no personal data.
- **Order before a drop:**
  1. The day is settled.
  2. The export is written.
  3. It is checked. The row count, the plain sha256 and the proof roll-up are computed from the stream before it is encrypted, and compared with the partition. The file is then downloaded again and its encrypted sha256 compared. The job cannot decrypt, because it holds only the public key, so the owner test-decrypts a sample on a schedule.
  4. The manifest row is written.
  5. Only then is the partition dropped, and never while `hold` is set.
- **Restore or appeal.**
  1. The owner decrypts the file locally.
  2. The owner checks it against the manifest and the 120-day proofs.
  3. The owner loads it into a disposable local database, never back into production `public`, and applies the erasure list.
  4. The owner replays `settleDay` for that day against the stored `input_digest`.

  The appeal window is proposed as the season plus 30 days. After the archive expires, an appeal can be checked only against the settled credit lines.
- **Legal hold.** The owner sets `hold` on a range of days with a reason code (no personal data in it). Drops and archive expiry skip held days. Lifting a hold is also an owner action.

### 12.5 No location data on public surfaces

- No coordinate is stored server-side. A test asserts that 0011 has no coordinate column.
- Units are H3 cells derived from verified movement. They are personal data when tied to a player, so:
  - the `authenticated` role reads only its own units and receipts;
  - `anon` gets nothing;
  - the partitions are in a schema with no USAGE grant, and RLS is enabled on each one.
- Public surfaces (settled day headers, club days, district days, the leaderboard) carry credits and district aggregates, never cells, routes or a player's units.
- Archives and the bench output are never published.
- **Owner decision:** whether a district with very few active players should be hidden from public aggregates (a minimum count).

## 13. Go/no-go: capped, credits-only staging pilot

**NO-GO today.** The storage numbers would allow a small pilot. Revision 2 with the proposed retention stays under 85% of 500 MiB up to about 1,600 players for one season, 900 over four seasons, and 765 with 2% hostile accounts over four seasons. A 100–200 player pilot uses 11–30% of the quota. Even with everything kept, 100 players for one season is 17%.

The blockers are decisions and authorization, not bytes. Each needs the owner:

1. **The real quota.** Confirm the project's database allowance on the Supabase dashboard. Every percentage here assumes 500 MiB.
2. **Retention (§12).**
   - Accept or change the TTLs.
   - Decide the archive location and who holds the `age` private key.
   - Set the appeal window and the legal-hold process.
   - Decide whether pseudonymous archives with a 120-day expiry are acceptable for erasure.
   - Until this is decided, nothing is dropped, so a pilot must be sized for "keep everything", row (a).
3. **X-25.** Decide security log retention (30/180 days proposed). Auth and audit are about a quarter of the four-season total.
4. **Capacity settings.**
   - The unit budget: 300 by default.
   - The guard quota (`MOVENRUN_GAMEPLAY_CAPACITY_QUOTA_MIB`). Without it the guard is off.
   - Per-table autovacuum for `gameplay_unit_challenges` (§11.2 churn).
5. **Backup.** Free has no point-in-time restore. Decide on a `pg_dump` of `gameplay_*` and `gameplay_partitions` before 0011 is promoted.
6. **Pilot cap.** Set the player cap and season length. ≤ 200 players and one season is the measured comfortable range.
7. **An exact SHA authorized for staging.**
   - Promote 0011 into `drizzle/` with its journal entry.
   - Update the migration count in `runtime.test.ts`.
   - Re-run this bench and the backend suite at that SHA.
   - Back up first.
   - Set `MOVENRUN_GAMEPLAY_ENABLED=true` on staging only.

   None of this is done or proposed for a specific commit here.

Once 1–7 are decided and a SHA is authorized, the measurements support **go for a capped pilot: credits only, ≤ 200 players, one season, guard on, budget 300**. That is a forecast from local simulation, not a live measurement.
