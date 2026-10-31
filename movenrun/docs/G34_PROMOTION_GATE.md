# G3/G4 promotion gate: before 0011 leaves `drizzle-proposed/`

**Status: every row is NOT MET / OWNER.** This is a checklist, not an approval. Promoting 0011 (moving it into `backend/drizzle/` with a journal entry and checksum) and setting `MOVENRUN_GAMEPLAY_ENABLED=true` are separate owner decisions (G34_SERVER_ARCHITECTURE.md §14). Nothing in this document changes either.

**How to use it.** A row moves to MET only when the owner (or someone the owner names) records the evidence in the Evidence column, with a date. Any row NOT MET blocks promotion. If the code SHA changes, every row that depends on it goes back to NOT MET.

## Reference values (re-verified for this document)

The earlier values in this table (up `b87f2e2f…c2f8`, down `184fffa7…5fa7`) were stale: sealing v2 (#168) and the erasure job table (#183) changed both files after the gate was written. Current values and their history: G34_SERVER_ARCHITECTURE.md §18.

| Item | Value | How verified |
|---|---|---|
| Branch base this checklist was written against | `cb27318d6654bf0e730fb05e9d523e9d60c8ced1` (`feat/g34-server-holdings`); hash values re-verified at `d81867b` (31 Oct 2026) | `git log -1` |
| `backend/drizzle-proposed/0011_gameplay_holdings.sql` (revision 3, with sealing v2 and the erasure job table) | sha256 `0f3e5e182b46f348397f37d037e3eabcba174d8b38863bef2a02db446e907cfc` | `sha256sum` at `d81867b`; `promotionGateHashes.test.ts` fails if the file and this value differ |
| `backend/drizzle-proposed/0011_gameplay_holdings.down.sql` | sha256 `537a3ee146adbfc0249f1c4503fe1c8d27233e0f86b70e62e46efa884071dcfd` | `sha256sum` at `d81867b`; pinned by the same test |
| Drizzle journal | 0000–0010 only; 0011 not listed; `CHECKSUMS.sha256` untouched | file inspection |
| `MOVENRUN_GAMEPLAY_ENABLED` | off unless exactly `true`; default unchanged | `wiring.ts`, G34_SERVER_ARCHITECTURE.md §10 |

The commit that adds this document is not the promotion SHA. The SHA to promote is chosen and written below by the owner.

## Checklist

| # | Gate | What MET means | Status | Evidence (owner fills in) |
|---|---|---|---|---|
| 1 | Exact code SHA | One full 40-character commit SHA is named for staging; the backend suite, typecheck and the storage bench were re-run at that SHA with recorded counts | NOT MET / OWNER | |
| 2 | Migration file sha256 | At the named SHA, `drizzle/0011_gameplay_holdings.sql` hashes to the reviewed value (today `0f3e5e18…7cfc`; a changed file needs a new review and a new value), the down file to `537a3ee1…dcfd`, the journal lists 0011 once, `CHECKSUMS.sha256` matches, and `runtime.test.ts`'s migration count is 12 | NOT MET / OWNER | |
| 3 | DB size vs verified quota | The real database allowance is read from the provider dashboard (500 MiB is only ASSUMED). Current `pg_database_size` is recorded. Projected size for the approved cap and season count (G34_DATA_LIFECYCLE.md §4) is below the warn line (60%) of the **verified** quota | NOT MET / OWNER | |
| 4 | Logical backup + restore drill | A `pg_dump` (schema + data, including `gameplay_partitions` once it exists) is taken before promotion, stored off the database, encrypted, and **restored into a disposable local database**; row counts and the migration table match. Drill date and duration recorded. Free plan has no point-in-time restore | NOT MET / OWNER | |
| 5 | Shutdown / rollback method | Written and rehearsed: (a) app rollback = unset `MOVENRUN_GAMEPLAY_ENABLED`, restart, data kept; (b) `0011…down.sql` is destructive, owner-only, after a backup, in one transaction with removal of its `__drizzle_migrations` row. Who may run each, and how long (a) takes, recorded | NOT MET / OWNER | |
| 6 | Archive lifecycle | Retention TTLs accepted or changed (G34_DATA_LIFECYCLE.md §1); archive location, key custodian, key rotation, erasure-in-archive approach and legal-hold process decided (§2). Until then: **nothing is dropped**, and the pilot is sized for "keep everything". The dry run (§3) has been run against a local restore of the backup | NOT MET / OWNER | |
| 7 | Feature flags | Staging values written down: `MOVENRUN_GAMEPLAY_ENABLED` (stays unset until a separate go decision), `MOVENRUN_GAMEPLAY_SEASON_START_DAY`, `MOVENRUN_GAMEPLAY_RULES_VERSION` (unset = 1001; 1002 only if approved), `MOVENRUN_GAMEPLAY_UNIT_BUDGET` (default 300). Production unchanged | NOT MET / OWNER | |
| 8 | Capacity guard setting | `MOVENRUN_GAMEPLAY_CAPACITY_QUOTA_MIB` set to the **verified** quota (the guard is off without it); thresholds warn 60% / backpressure 75% / fail closed 85% (or owner values); fail-closed behaviour (503 `capacity_hard_stop`, reads and settlement continue) observed on staging with a low test quota; per-table autovacuum for `gameplay_unit_challenges` applied or explicitly declined (G34_DATA_LIFECYCLE.md §5) | NOT MET / OWNER | |
| 9 | RLS / default-deny check | On the target database after migrating: RLS enabled on every `gameplay_*` table and every partition; `pg_policies` has no gameplay row; `has_table_privilege` false for `anon` and `authenticated` on every privilege; no USAGE on schema `gameplay_partitions`; Data API calls with and without a JWT get 42501. Query output attached | NOT MET / OWNER | |
| 10 | Economic rule version | The rule set (1001 or 1002) and its `config_digest`, `holding_rules_version` and `economy_rules_version` (today 1) are approved in writing; credits remain off-chain game points (no token, balance or transfer) | NOT MET / OWNER | |
| 11 | Device / privacy outcomes | Handset QA for the build that will call gameplay is passed; privacy texts (data inventory, store data-safety form) describe gameplay data, its retention and erasure; no coordinates stored server-side (test asserts it); account deletion on the target database removes every gameplay row naming the person (test evidence attached) | NOT MET / OWNER | |
| 12 | Pilot cap and season | Player cap (planning: 200) and season length (planning: 90 days) decided; account admission cap configured to match | NOT MET / OWNER | |

## Not part of this gate

- Opening any Data API read path on gameplay tables (would be a new reviewed migration).
- Any liquid or on-chain reward.
- Building the archive writer, manifest table or retention executor (each is its own review once §6 is decided).
