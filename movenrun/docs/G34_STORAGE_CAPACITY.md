# G3/G4 storage capacity: what 0011 costs, and how to keep it inside Supabase Free

**Status:** PROPOSAL. Nothing in this document is applied, scheduled or wired. Migration 0011 is still only a file in `backend/drizzle-proposed/`. No retention job, partition, tripwire or budget exists in the API. Every TTL below is a proposal for the owner to accept, change or reject.

**Measured against:** `drizzle-proposed/0011_gameplay_holdings.sql` as of `feat/g34-server-holdings` 685852b (14 tables, rule sets 1001 and 1002). An earlier pass measured c6dc208 (11 tables). The push ledger's cost per row was within 2% of the figures below for rule set 1001, so the earlier numbers are not repeated here.

**Quota:** this document assumes 500 MiB, which is Supabase Free's published database allowance. **The owner must confirm the real quota for this project in the Supabase dashboard** (Settings → Usage, database size). No upgrade is assumed or proposed. The live database was measured read-only on 18 Oct: about 11.8 MB used, 20 public tables, 11 migrations applied, 0 auth users. That 11.8 MB is the baseline in every projection.

## 1. Summary

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

None of this blocks a pilot. The day-index choice for the takers query and the settlement sort spill are worth fixing before scale. A partial index on `(unit_id, day) WHERE outcome IN ('eroded','flipped')` would serve the takers query, and a raised `work_mem` for the settlement transaction would stop the spills. These are suggestions for the 0011 author, not changes made here.

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

   Measured together: 187 bytes per row in place of about 528, and dropped partitions return space immediately. These are suggestions for the 0011 author, who is changing that file now. This branch does not edit it.
3. **Retention jobs** (owner-approved, not built): export and drop raw partitions older than 14 days, compact superseded snapshots, null cell lists, and prune routine audit rows after 30 days (X-25). All run in the existing maintenance loop and in bounded batches, like `pruneExpiredSessions`.
4. **Capacity tripwire and per-walker unit budget** (§8), before `MOVENRUN_GAMEPLAY_ENABLED` is ever set.
5. **Pilot size on Free:** at res 10 with rule set 1002 and everything above, about 1,000 players for one season or 670 over four seasons. Without changes, about 200 players for one season.

## 8. Capacity tripwire, backpressure and shutdown (design; pure functions only)

The pure function is `capacityTripwire()` in `backend/src/gameplay/capacity.ts`. Unit tests are in `capacity.test.ts`. **Nothing calls it.** Wiring it is an owner decision.

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
- `backend/src/gameplay/capacity.ts`: the projection model, retention policies, tripwire and unit budget. Pure; imported by nothing in the API.
- `backend/src/gameplay/capacity.test.ts`: the tests for them.
