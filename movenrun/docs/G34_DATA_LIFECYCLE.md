# G3/G4 data lifecycle: retention matrix, encrypted archives, dry run, capacity and churn

**Status: PROPOSAL / OWNER DECISION throughout. Nothing here is live policy, and nothing here is activated.**
- Migration 0011 stays in `backend/drizzle-proposed/` (revision 3; its reviewed sha256 values are kept in one place, `G34_PROMOTION_GATE.md`, and pinned by `promotionGateHashes.test.ts`). It is not in the drizzle journal and is applied to no hosted database.
- `MOVENRUN_GAMEPLAY_ENABLED` is unchanged: gameplay stays off unless it is exactly `true`.
- No retention job, archive writer, manifest table, export or partition drop exists. The only new executable piece is a **dry-run evaluator** that counts and never changes anything (section 3).
- Capacity figures are **SIMULATION ONLY** (local PostgreSQL 16.15, synthetic players). The 500 MiB quota is **ASSUMED** (Supabase Free's published allowance) until the owner confirms the real one.

**Planning assumptions used everywhere below (NOT live policy):**

| Assumption | Value | Where it comes from |
|---|---|---|
| Detailed push and session-path records (raw window) | 14 days after the game day | G34_STORAGE_CAPACITY.md §12 |
| Compact proofs (player-day proofs) | 120 days | season (90) + 30-day appeal |
| Source season | 90 days | rules (season length) |
| Pilot cap | 200 players | G34_STORAGE_CAPACITY.md §13 |
| Routine / security audit | 30 / 180 days; anonymous `account_deleted` kept | X-25 proposal |

Related: `G34_STORAGE_CAPACITY.md` (measurements, §12 retention design, §14 revision 3 numbers), `G34_SERVER_ARCHITECTURE.md` (tables, erasure, rollback), `G34_PROMOTION_GATE.md` (what must be true before 0011 is promoted).

## 1. Schema lifecycle matrix

One row for each of the 17 tables 0011 creates, then the existing tables gameplay depends on. **Every cell is a PROPOSAL / OWNER DECISION.**

**Legend.**
- *Sensitivity:* **P** personal (names a player, directly or through `player_no`); **P-loc** personal and location-derived (H3 cells tied to a player); **A** aggregate, no player id; **S** server configuration; **Sec** security record.
- *Owner:* the project owner is the data owner for every row. "API" means the API's table-owner role is the only writer (default deny for `anon` and `authenticated`, 0011 revision 3).
- *Size:* "200 @ d14" is measured at 200 players, 14 days, rule set 1002, res 10, dense area (churn study run, section 5); "bound" is the planning bound at the 200-player cap for one 90-day season under the TTLs proposed here.
- *Erase:* what happens when `accountDeletion.ts` deletes the user (cascade through `users` or `gameplay_players`).
- *Archive enc.:* only tables marked "yes" would ever be archived (section 2); all others are never exported.

### 1.1 The 17 tables of 0011

| Table | Sensitivity | Owner | Purpose | Size (200 @ d14 → bound at 200, 1 season) | Proposed TTL | Erase on account deletion | Settlement proof / replay need | Appeal window | Legal hold | Archive enc. | Safe failure behaviour |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `gameplay_push_events` (day partitions) | P-loc | API | Append-only accepted pushes: holders before/after, strengths, source | 6.0 MiB → ~6 MiB steady (14 day partitions) | 14 days, then export + verify + `DROP` the day partition | Cascade via `walker_no`; holder numbers set NULL | **Yes**: day replay needs raw rows; after the drop, the archive plus player-day proof | Raw rows inside 14 d; archive up to 120 d | Hold skips the drop | yes | No archive verified → no drop. Missing partition → push fails, writes nothing |
| `gameplay_walker_days` (day partitions) | P-loc (`visit_units`) | API | Take / unit-budget counters, refusal counters, refused-visit sample | 1.7 MiB → ~1.7 MiB steady | 14 days, same drop as the ledger | Cascade | Refusal counts feed proofs; `visit_units` feeds settlement visits | Same as ledger | Same | yes | Same as ledger. **Flag:** fraud review may want the counters (not `visit_units`) for 120 d: ~5 MiB at 200 players |
| `gameplay_player_day_proofs` | P (pseudonymous) | API | sha256 of the walker's accepted rows + counts; proves an archive unaltered | 0.28 MiB → ≤ 2.4 MiB | 120 days, row delete by day in batches | Cascade | **Yes**: the only evidence after the raw window | Covers season + 30 d | Hold skips the delete | no (stays in DB) | Delete never runs before the archive it proves expires |
| `gameplay_applied_sessions` | P | API | Idempotency receipts | 1.0 MiB → ~1 MiB steady | 14 days; a later retry gets 409 `day_closed` | Cascade (user, movement row) | No (settled day is closed) | n/a | Hold skips | no | Missing receipt → `day_closed`, never a second apply |
| `gameplay_session_paths` | P-loc | API | 1002 res-10 path from verified fixes (units + interpolation bits) | 1.2 MiB → ~1.2 MiB steady | 14 days after the session's day | Cascade via movement row | Only until the day is applied and settled | Raw 14 d only | Hold skips | no (re-derivable only while fixes exist: they never do server-side) | Missing path → `session_path_unavailable`, nothing written |
| `gameplay_unit_day_states` | P (`holder_no`) | API | End-of-day unit snapshots | 1.6 MiB → ~2 MiB (latest per unit + 14 d) | Superseded rows deleted after 14 d; latest per unit kept | Holder set NULL, unit reset to unheld | **Yes**: settlement input (latest on or before the day) | Kept latest | Hold skips | no | Compaction never deletes the latest row per unit or any row after the last settled day |
| `gameplay_units` | P (`holder_id`) | API | Current state of each unit | 0.4 MiB → bounded by play area | Current only, no TTL | Holder NULL, reset to unheld, challenges deleted | Current state | n/a | n/a | no | n/a |
| `gameplay_unit_challenges` | P | API | Open two-day challenges with server receipt time | 6.0 MiB bloated / 0.8 compact → 2.0 kept up (section 5) | Current only, no TTL | Cascade (challenger); deleted with the unit's holder | 1002 second-push gap | n/a | n/a | no | Churn needs vacuum; size bounded by live rows only if vacuum keeps up |
| `gameplay_players` | P (link user ↔ number) | API | Pseudonym table | 0.16 MiB → ≤ cap | Life of the account | **Deleted**: severs `player_no` from the person; numbers never reused | Key for proofs and archives | n/a | n/a | **never exported** | n/a |
| `gameplay_day_rules` | S | API | Rule set each day is pinned to | 0.11 → ~0.4 MiB/season | Kept (season record) | n/a | **Yes**: replay needs the pinned config | Forever | n/a | no | Immutable (trigger) |
| `gameplay_day_settlements` | A (problems text may name players) | API | Day header, books, `input_digest` | 0.08 → ~0.2 MiB/season | Kept | Header stays (totals only) | **Yes**: `input_digest` anchors every replay | Forever | n/a | no | Final once settled (trigger) |
| `gameplay_credit_lines` | P | API | Per-player settled off-chain credits | 0.77 → ~5 MiB/season | Kept for the season record | Tombstoned: player replaced by a random per-line id, amounts kept (`G34_ERASURE_TOMBSTONES.md`) | Result of settlement | Forever while the account exists | Hold has no effect (not deleted) | no | Final except erasure. **Flag:** if credits ever gain monetary value, accounting duties (years) would apply here and conflict with erasure |
| `gameplay_clubs` | A (`created_by` P) | API | Clubs | 0.08 MiB | Kept | `created_by` NULL | Club aggregates | n/a | n/a | no | n/a |
| `gameplay_club_memberships` | P | API | Membership spans | 0.11 MiB | Kept | Cascade | Settlement input (club snapshot) | Forever | n/a | no | n/a |
| `gameplay_unit_districts` | S (no personal data) | Operator | D20 district map | 0.26 MiB → area-bound (~8 MiB at 1,000 km² res 10) | Kept, versioned | n/a | Settlement input | n/a | n/a | no | Empty map → every unit "no district" |
| `gameplay_club_days` | A | API | Club day aggregates | 0.17 → ~1.1 MiB/season | Kept | Club cascade only | Result | Forever | n/a | no | Skipped under backpressure (`clubs_status = 'skipped'`) |
| `gameplay_district_days` | A | API | District standings | 0.09 → ~0.6 MiB/season | Kept | Controller club NULL | Result | Forever | n/a | no | Same |

### 1.2 Existing tables gameplay depends on

| Table | Sensitivity | Owner | Purpose | Size | Proposed TTL | Erase | Proof / replay need | Appeal | Legal hold | Archive enc. | Safe failure |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `movement_verifications` summary (0003–0005) | P | API | Verified session: distance, duration, confidence, seal | 453 B/row; ~9 MiB at 200 players for 120 d | **120 days** (season + 30). Must be ≥ raw TTL: deleting it **cascades** to receipts and session paths | Deleted by account deletion | 7-day active-day window at settlement | Season + 30 d | Hold skips | no | Validation refuses a summary TTL shorter than the raw TTL (dry run, section 3) |
| `movement_verifications.traversed_hex_ids` | P-loc | API | Res-8 cells of the session | ~22 B/cell | 14 days, then set NULL | Deleted with the row | Not after settlement | Raw 14 d | Hold skips | no | Null-out is an UPDATE; leaves reusable free space only |
| `security_audit_events` | Sec | API | Security trail | 268 B/row; ~5.5 MiB at 200 players (30 d of `session_refreshed`) | X-25: `session_refreshed` 30 d; security events 180 d | Account's rows deleted | n/a | Fraud / abuse investigations may need 180 d | Hold skips | no | Pruning in bounded batches, like `pruneExpiredSessions` |
| Account deletion records: anonymous `account_deleted` audit rows | A (no user id, email or metadata) | API | Count deletions; show the duty was met | ~270 B per deletion | Kept (proposal) | It *is* the deletion record | n/a | n/a | n/a | no | Never names a person |
| `pending_auth_user_deletions` (0007) | P (provider subject) | API | Queue to delete the Supabase Auth user after commit | Transient | Until the provider confirms, then removed | It is part of erasure | n/a | n/a | n/a | no | Retried until confirmed; a stuck row is an operator alert, never a silent drop |

### 1.3 Where the planning TTLs may be too short (bounded exceptions to decide)

- **90-day season vs 14-day raw window.** Settlement runs within a 2-hour grace and reads only 7 days of sessions, so 14 days of raw rows covers settlement. A dispute raised *late in the season about an early day* cannot be answered from raw rows; it needs the archive (up to 120 days) or the player-day proof.
- **Appeals (season + 30 days).** Per-day proofs at 120 days cover the earliest day of a season up to season end + 30. If the owner sets the appeal window to start at season end for *every* day, proofs and archives for day 1 must live 90 + 30 = 120 days (as proposed); a longer appeal window lengthens both linearly (~0.08 KiB per active player-day for proofs).
- **Fraud review.** Detecting hostile accounts after the fact needs units-used and refusal counters. The proof row keeps the totals for 120 days. Keeping `gameplay_walker_days` counters (without `visit_units`) for 120 days would cost about 5 MiB at 200 players; this is an owner option, not proposed by default.
- **Accounting.** Credits are off-chain game points. Settled credit lines and day headers are kept for the season record anyway. If credits ever convert to anything of value, accounting retention (often years) would apply to credit lines, and erasure would have to keep anonymised totals (the header already does).
- **Deletion duties.** The anonymous `account_deleted` row is kept indefinitely; `pending_auth_user_deletions` lives until the provider confirms. Archives cannot be edited per person: erasure inside archives is bounded by the archive expiry (section 2.5).
- **Movement summary vs cascade.** The summary must outlive receipts and session paths, because deleting it cascades to them. 120 days is proposed; if the season length grows, the summary TTL must grow with it.

## 2. Encrypted archive design (DESIGN ONLY; nothing built, nothing ships archives)

### 2.1 Scope

Only the raw day partitions (`gameplay_push_events_d<day>`, `gameplay_walker_days_d<day>`) would be archived, after their day is settled and before they are dropped. Rows carry integer `player_no` and bigint H3 units only: no user id, email, coordinate or `gameplay_players` link. Format: `COPY (SELECT … ORDER BY seq) TO STDOUT WITH (FORMAT csv, HEADER)`, gzip, then `age` encryption (G34_STORAGE_CAPACITY.md §12.2). Estimated ~0.15 MB per day at 1,000 players after gzip.

### 2.2 Role separation

| Role | Can | Cannot |
|---|---|---|
| API server (table owner today) | Write and read live gameplay tables | Read archives, hold any archive key, drop partitions as part of retention |
| Archive writer (owner-run job; proposed read-only DB role `gameplay_archiver`) | `SELECT` settled partitions; insert manifest rows; encrypt to the **public** recipient(s) | Decrypt (no private key); `DROP`, `DELETE`, `UPDATE` anything |
| Retention executor (owner, separate login) | `DROP` a partition whose manifest row is verified and not on hold | Decrypt archives; write archives |
| Key custodian (owner; optional named second person) | Hold the `age` private keys offline; decrypt for a documented purpose | Run the writer or the executor in the same session |
| Restorer (owner) | Load a decrypted archive into a disposable **local** database, apply the erasure list, replay `settleDay` | Load an archive back into production `public` |

No one role can both make an archive unreadable and drop the only live copy. The executor's drop requires a manifest row that the writer verified, and the writer cannot drop.

### 2.3 Key custody and rotation

- **Keys.** `age` X25519. One *archive key* per season, plus one long-lived *escrow key*. Every archive is encrypted to both recipients (age supports several).
- **Custody.** Private keys are never in Render, Supabase, Vercel, the repository, CI or the API environment. The season key lives in the owner's password manager; the escrow key on offline media in a separate place. Who else holds a copy is an OWNER DECISION. Losing both loses every archive.
- **Rotation.** A new season key at each season start (or sooner on suspicion). The writer is reconfigured with the new public key; old archives are not re-encrypted. A season key is destroyed once every archive encrypted to it has expired (≤ 120 days after the season's last day) and no legal hold names it: this *crypto-shreds* any copy that escaped deletion.
- **Compromise.** If a private key may be exposed: rotate, re-encrypt the affected archives to the new key from a verified decryption, destroy the old key, and record the event (reason code only) in the manifest.

### 2.4 Bounded access

- Decryption only for: an appeal inside its window, a legal hold, a restore drill, or a reconciliation the owner records. Each use writes a manifest access row (date, purpose code, archive id; no personal data).
- Decrypt on an offline or local machine into a disposable PostgreSQL; delete the plaintext and the database when done. Never upload plaintext.
- Archives are never public: no public bucket or repository. Location options (owner's disk + off-site copy, or a private storage bucket holding ciphertext only) are in G34_STORAGE_CAPACITY.md §12.2.

### 2.5 Erasure inside archives

1. Archives are pseudonymous: `player_no` only. Deleting the account deletes the `gameplay_players` row, so nothing in the database maps that number back to a person, and numbers are never reused.
2. The manifest keeps an **erasure list**: `player_no` values erased after each archive was written. Every restore drops those rows first, before any query or replay.
3. Archives expire at 120 days and the season key is destroyed after the last one expires, so erasure is complete within a known bound (≤ 120 days after the day, plus the key-destruction step).
4. If the owner's legal advice says pseudonymous rows plus a bounded expiry are not enough, the stronger option is a monthly *re-cut*: the key custodian decrypts the affected archives locally, removes erased players' rows, re-encrypts, updates the manifest hashes, and destroys the old files. Cost is small (≈ 0.15 MB per day-file); it needs the private key and so is an owner action. OWNER DECISION.
5. A legal hold can delay expiry. A hold must name a reason code and an end condition; erased players' rows remain excluded on every restore during the hold.

### 2.6 Manifest and order before any drop (unchanged from G34_STORAGE_CAPACITY.md §12.4)

Settled → exported → verified (row count, plaintext sha256 and the proof roll-up compared with the partition; ciphertext re-downloaded and hashed) → manifest row written → partition dropped, never while `hold` is set. The dry run (section 3) reports every partition as blocked by `no_verified_archive` because none of this exists.

## 3. Dry-run TTL / partition-drop evaluator

`backend/scripts/gameplay-retention-dryrun.ts` (logic in `backend/src/gameplay/retentionDryRun.ts`, tests in `retentionDryRun.test.ts`).

```
MOVENRUN_RETENTION_DRYRUN_DATABASE_URL=postgres://user@127.0.0.1:5432/db \
  node --import tsx scripts/gameplay-retention-dryrun.ts --as-of-day <day> \
    [--raw-days 14] [--proof-days 120] [--session-path-days 14] [--cell-list-days 14] \
    [--movement-summary-days 120] [--audit-routine-days 30] [--audit-security-days 180] \
    [--hold-days d1,d2] [--json]
```

**What it reports** (counts and sizes only): day partitions of the ledger and walker days past the raw window, with rows and bytes a drop would return; player-day proofs, receipts, session paths and superseded unit day states past their TTL; movement cell lists that would be set NULL; movement summaries that would be deleted, and how many receipts that would cascade to; audit rows past the X-25 proposal. Each finding is *eligible* or carries blockers: `day_not_settled`, `legal_hold`, `no_verified_archive` (always, for drops), `x25_owner_decision` (audit).

**What it can never do:**
- **Local only.** A URL whose host is not `localhost`, `127.0.0.1`, `::1` or a Unix socket is refused before any connection (the bench's rule; also refuses `host=`/`hostaddr=`/`service=` overrides). The URL comes from the environment, never an argument.
- **Read-only transaction.** `BEGIN`, then `SET TRANSACTION READ ONLY`, then a check that `transaction_read_only` is `on`; always ends with `ROLLBACK`, also on success. PostgreSQL then refuses any write with SQLSTATE 25006 (tested).
- **No destructive SQL.** Every statement passes a guard that only lets `SELECT`/`WITH` through and refuses DROP, DELETE, TRUNCATE, UPDATE, INSERT, ALTER, VACUUM, COPY, `FOR UPDATE`, `nextval` and more, and any second statement. Values are bound parameters; the only interpolated identifiers are partition names from the catalog that match `^(gameplay_push_events|gameplay_walker_days)_d[0-9]+$`.
- **Policy couplings.** It refuses a movement-summary TTL shorter than the raw or session-path TTL (the cascade) and a proof TTL shorter than the raw TTL.

**Tests** (`node --import tsx --test src/gameplay/retentionDryRun.test.ts`, included in `npm test`): non-local URLs refused (hosted Supabase hosts, private IPs, `localhost.example.com`, host overrides); the CLI exits 2 on a non-local URL without attempting a connection; the guard refuses every destructive form; a recording fake client sees `BEGIN`, `SET TRANSACTION READ ONLY` … `ROLLBACK` and no DROP/DELETE/TRUNCATE; on real PostgreSQL 16 the evaluator lists 52 old partitions as blocked, leaves all 62 in place, and a `DELETE` inside its transaction fails with 25006; without 0011 the gameplay tables are reported absent and nothing is created.

**Validation at this commit:** backend typecheck clean; `npm test` with `MOVENRUN_TEST_DATABASE_URL` set to a local PostgreSQL 16.15: 426 tests, 426 pass, 0 fail, 0 skipped (8 of them in `retentionDryRun.test.ts`, 3 in `lifecycleCapacity.test.ts`).

**Local example** (1-player bench database, kept and then dropped; `--raw-days 7`, one held day): 12 partitions reported, all blocked by `no_verified_archive`; 30 superseded snapshot rows eligible, 9 blocked by `legal_hold`; partition count unchanged afterwards.

## 4. Capacity model (SIMULATION ONLY)

`backend/src/gameplay/lifecycleCapacity.ts`, printed by `node --import tsx scripts/gameplay-capacity-model.ts` (no database). Tests: `lifecycleCapacity.test.ts`.

**Inputs.** The measured day-14 revision 3 run at 1,000 players (G34_STORAGE_CAPACITY.md §14): 0011 total 146.9 MiB, of which `gameplay_unit_challenges` 104.7 MiB; 40.4 MiB after VACUUM FULL; movement_verifications 7.87 MiB; WAL 978 MiB. Everything in 0011 except the challenge table (42.2 MiB per 1,000 players) is treated as the steady 14-day block, which double-counts 14 days of durable rows (conservative). Durable growth per player-day: credit lines and day aggregates 315 B (§11.5), proofs 83 B, movement summaries 410 B. Snapshots 14 MiB and auth + audit 125 MiB per 1,000 players are **reserved headroom** (§11.5: auth sessions 37 days, audit 30 days, 6 refreshes per active day). Indexes are inside every measured figure. Hostile accounts: 20 sessions × 500 units a day with the 300-unit budget = 0.30 MiB per account-day inside the raw window (gameplay 0.15, movement rows 0.08, session paths 0.08) plus 20 summaries a day after it; **assumed hostile for the whole horizon**, harsher than §11.5's 14 days. Two churn regimes for the challenge table: *kept up* (compact × 2.4, the measured ratio with frequent plain VACUUM, section 5) and *bench bloat* (104.7 MiB per 1,000, as measured).

**Tripwires** on the ASSUMED 500 MiB: warn 60% (300 MiB), backpressure 75% (375 MiB), fail closed 85% (425 MiB); same as `capacity.ts` `DEFAULT_THRESHOLDS`.

MiB (% of 500, tripwire level), challenge churn kept up by vacuum:

| Players | Seasons | ordinary | 2% hostile | 10% hostile |
|---|---|---|---|---|
| 200 | 1 | 65 (13%, ok) | 84 (17%, ok) | 163 (33%, ok) |
| 200 | 4 | 84 (17%, ok) | 105 (21%, ok) | 187 (37%, ok) |
| 500 | 1 | 143 (29%, ok) | 192 (38%, ok) | 387 (77%, backpressure) |
| 500 | 4 | 191 (38%, ok) | 242 (48%, ok) | 448 (90%, fail_closed) |
| 1,000 | 1 | 273 (55%, ok) | 371 (74%, warn) | 762 (152%, fail_closed) |
| 1,000 | 4 | 369 (74%, warn) | 471 (94%, fail_closed) | 883 (177%, fail_closed) |
| 5,000 | 1 | 1,316 (263%, fail_closed) | 1,804 (361%, fail_closed) | 3,758 (752%, fail_closed) |
| 5,000 | 4 | 1,791 (358%, fail_closed) | 2,306 (461%, fail_closed) | 4,363 (873%, fail_closed) |

MiB (% of 500, tripwire level), challenge churn at measured bench bloat:

| Players | Seasons | ordinary | 2% hostile | 10% hostile |
|---|---|---|---|---|
| 200 | 1 | 84 (17%, ok) | 104 (21%, ok) | 182 (36%, ok) |
| 200 | 4 | 103 (21%, ok) | 124 (25%, ok) | 206 (41%, ok) |
| 500 | 1 | 191 (38%, ok) | 240 (48%, ok) | 435 (87%, fail_closed) |
| 500 | 4 | 239 (48%, ok) | 290 (58%, ok) | 496 (99%, fail_closed) |
| 1,000 | 1 | 369 (74%, warn) | 467 (93%, fail_closed) | 858 (172%, fail_closed) |
| 1,000 | 4 | 464 (93%, fail_closed) | 567 (113%, fail_closed) | 979 (196%, fail_closed) |
| 5,000 | 1 | 1,795 (359%, fail_closed) | 2,283 (457%, fail_closed) | 4,237 (847%, fail_closed) |
| 5,000 | 4 | 2,270 (454%, fail_closed) | 2,785 (557%, fail_closed) | 4,842 (968%, fail_closed) |

**Most players strictly under the 85% hard stop of 500 MiB:**

| Churn | 1 season, ordinary | 1 season, 2% hostile | 1 season, 10% hostile | 4 seasons, ordinary | 4 seasons, 2% hostile | 4 seasons, 10% hostile |
|---|---|---|---|---|---|---|
| kept up by vacuum | 1,581 | 1,150 | 550 | 1,158 | 898 | 473 |
| measured bench bloat | 1,156 | 907 | 487 | 912 | 743 | 426 |

**85% hard-stop sensitivity** (most players under the line; churn kept up; ordinary / 2% / 10% hostile):

| Case | 1 season | 4 seasons |
|---|---|---|
| 85% of 500 MiB, inputs as measured | 1,581 / 1,150 / 550 | 1,158 / 898 / 473 |
| 80% of 500 MiB | 1,485 / 1,080 / 516 | 1,088 / 844 / 444 |
| 90% of 500 MiB | 1,677 / 1,220 / 583 | 1,228 / 953 / 502 |
| 85% of 400 MiB (smaller real quota) | 1,255 / 913 / 436 | 919 / 713 / 376 |
| per-player costs +25% | 1,265 / 920 / 440 | 926 / 719 / 378 |
| per-player costs +50% | 1,054 / 766 / 366 | 772 / 599 / 315 |
| per-player costs −25% | 2,108 / 1,533 / 733 | 1,544 / 1,198 / 631 |

**Where the bytes go**, 1,000 ordinary players, 4 seasons, churn kept up (368.5 MiB): auth + audit reserve 125.0, durable season record 108.0, 14-day raw block 42.2, movement summaries 41.4, snapshots 14.0, fixed baseline 12.8, challenges 8.9, movement 14-day block 7.9, proofs 8.4.

**Reading it.**
- The 200-player pilot cap is **ok** (below warn) in every profile, both churn regimes and 1 or 4 seasons: at most 206 MiB (41%).
- 10% hostile is the profile that breaks first: 500 players reach backpressure in one season and fail closed over four. The unit budget and the capacity guard are what keep that bounded; retention does not.
- 5,000 players do not fit the assumed allowance in any profile.
- The hard stop is a line, not a target: the 25 MiB reserve and the 15% margin exist for settlement, erasure and retention deletes (G34_STORAGE_CAPACITY.md §8).
- **WAL is not in these totals.** §14 measured 978 MiB of WAL at 1,000 players over 14 days, most of it challenge churn. WAL does not count toward `pg_database_size`, but on a hosted plan it uses disk and backup bandwidth; it is an owner question for the provider.

**VACUUM FULL is never a routine hosted operation.** It takes an ACCESS EXCLUSIVE lock, rewrites the whole table, needs free disk for a second copy, and writes WAL for all of it. The "after VACUUM FULL" figures above and in G34_STORAGE_CAPACITY.md are measurements of the compact floor, not a plan. Space goes back to the quota only by dropping partitions; row deletes and plain VACUUM make space reusable inside the table.

## 5. Churn options for `gameplay_unit_challenges`

**The pattern today.** Every batch deletes all open challenges of the units it touched and re-inserts the ones the model leaves open (`service.ts`), unchanged rows included. Each re-written row leaves one dead tuple, and the table's file grows to the high-water mark of live + dead rows between vacuums.

**Measured** (bench profile `churn`; local PostgreSQL 16.15; the same 200 synthetic players and walks, 14 days, 2,544 sessions; sizes before any measurement VACUUM unless noted; SIMULATION ONLY):

| Variant (bench-side only; service unchanged) | Plain VACUUMs of the table | Table at day 14 | Peak | Live rows | After VACUUM FULL | Database at day 14 | WAL (cluster) |
|---|---|---|---|---|---|---|---|
| Default (autovacuum, cluster defaults) | 0 | 5.95 MiB | 5.95 | 4,787 | 0.83 | 32.5 MiB | 71.4 MiB |
| Per-table autovacuum (`scale_factor 0`, `threshold 200`, `cost_delay 0`) | 0 by the bench; autovacuum did not get a turn | 6.00 MiB | 6.00 | 4,853 | 0.84 | 32.4 MiB | 71.5 MiB |
| Plain VACUUM once a day | 14 | 2.20 MiB | 2.33 | 4,713 | 0.81 | 28.7 MiB | 72.3 MiB |
| Plain VACUUM every 50 sessions | 43 | 1.95 MiB | 1.95 | 4,750 | 0.81 | 28.4 MiB | 72.7 MiB |

- The bench compresses 14 days into about 56 seconds, and `autovacuum_naptime` is 1 minute, so the per-table autovacuum row is **inconclusive**, not a negative result. The two manual-VACUUM rows stand in for an autovacuum that keeps up at walking pace (about 180 sessions a day here). That is what the model's *kept up* regime uses (1.95 / 0.81 ≈ 2.4 × compact).
- Without vacuum, dead tuples reached 46,020 against about 4,800 live rows (9.6 : 1).
- WAL is the same in every variant (71–73 MiB): vacuum does not reduce the WAL the churn writes; it slightly adds to it.

**Option A: per-table autovacuum settings** (runbook change, no code). Proposed starting point: `autovacuum_vacuum_scale_factor = 0`, `autovacuum_vacuum_threshold = 200–1000`, `autovacuum_vacuum_cost_delay = 0` (or low).
- *Fixes:* keeps the file near 2–3 × its live size by reusing dead space; no code change; reversible with `ALTER TABLE … RESET`.
- *Does not fix:* the dead tuples are still created (one per re-written row), so WAL volume, index churn and vacuum I/O stay; file space already taken is not returned to the quota (only VACUUM FULL would, and it is not routine). On Supabase, per-table storage parameters need the table owner; whether the plan allows them is an owner check.

**Option B: in-place or diff-only writes** (service code change; **NOT MEASURED**, because this task changes no service code).
- *HOT-friendly in-place update:* update the rows that stay open instead of delete-and-insert. If no indexed column changes and the page has room (lower `fillfactor`, e.g. 70–80), PostgreSQL can do a heap-only (HOT) update and skip index writes; HOT chains are pruned on page access without VACUUM.
- *Diff-only:* touch only challenges that actually opened or closed; unchanged rows are not written at all. This removes most of the churn at its source.
- *Does not fix:* an UPDATE still leaves a dead tuple version (HOT or not); closed challenges are still deletes that leave dead tuples; VACUUM is still needed, and the primary key `(unit, walker_id)` and the walker index still change on inserts and deletes. Lower `fillfactor` makes the table bigger when compact. The expected effect (fewer dead tuples per batch, lower WAL) is plausible but unmeasured.

**Recommendation (OWNER DECISION):** Option A in the promotion runbook before any pilot, with the guard's growth alarm watching the table; Option B as a later, separately reviewed code change, measured with this bench profile first.

**Re-run:** `MOVENRUN_BENCH_DATABASE_URL=<local URL> node --import tsx scripts/gameplay-storage-bench.ts --profile churn --out churn.json --markdown churn.md` (about 4 minutes; local PostgreSQL only).
