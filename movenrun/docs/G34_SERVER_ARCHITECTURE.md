# G3/G4 server architecture: holdings, settlement, clubs, districts, leaderboards

**Status:** PREPARATION, in draft review. Nothing here is live. The gameplay routes are not mounted unless `MOVENRUN_GAMEPLAY_ENABLED=true`, and the migration they need (`backend/drizzle-proposed/0011_gameplay_holdings.sql`) is written and tested on a local PostgreSQL only. It is not applied to staging or to any other live database, and it is not in the migration journal that the staging start command runs.

**Scope:** server-authoritative storage and HTTP access for the shared reference models: holding (`shared/src/domain/holding.ts`), the push ledger (`holdingLedger.ts`), day settlement (`holdingSettlement.ts`) and clubs, districts and leaderboards (`clubsDistricts.ts`). The rules stay in those models. The server loads state, runs them, and stores what they return. Credits are off-chain game points: no token, balance, wallet, transfer or chain.

**Rule sets:** the server runs one versioned, immutable rule set. 1001 (`server-pilot-proposal-1`, A9 immediate flip) is the default. 1002 (`server-sim-pilot-2-proposal`) carries the three churn levers of `sim-pilot-2` (`SIM_CHURN_STUDY.md`) as an explicitly optional SIMULATION-PILOT PROPOSAL. It is approved by the owner only for pilot development and comparison, not as V3 source rules, and it is selected only by naming it (`MOVENRUN_GAMEPLAY_RULES_VERSION=1002`) while the feature flag is on. See section 15.

**Out of scope:** multiplayer activation, shade derivation (D2), deeds and contests, levels purchase, fortify, any map drawing (the app's map stays geographic; H3 is an internal index and never appears in a player-facing response from these routes).

## 1. Where the code sits

| Piece | Path |
|---|---|
| Proposed migration and rollback | `backend/drizzle-proposed/0011_gameplay_holdings.sql`, `0011_gameplay_holdings.down.sql` |
| Proposed 1002 addendum (session paths), to fold into 0011 | `backend/drizzle-proposed/1002_session_paths.sql`, `1002_session_paths.down.sql` (section 15.9) |
| 1002 session path: resolution 10 units from verified fixes | `backend/src/gameplay/path.ts`, written by the movement pipeline (`movement/http/productionRouter.ts`, `movement/repositories/drizzle/store.ts`) only when 1002 runs |
| 1002 zone partitions | `backend/src/gameplay/zones.ts` |
| Same-seed comparison of 1001 and 1002 (SIMULATION ONLY) | `backend/src/gameplay/compare.ts`, `backend/scripts/compare-rulesets.ts` |
| Pilot rules (every open value, named by decision), the rule set registry (1001, 1002), takeover policy, take budget and unit/zone rule | `backend/src/gameplay/rules.ts` |
| Server ledger step: the shared ledger one event at a time, plus the take budget | `backend/src/gameplay/policy.ts` |
| Service: apply, settle, clubs, reads | `backend/src/gameplay/service.ts` |
| HTTP routes | `backend/src/gameplay/router.ts` |
| Production wiring (flag, maintenance task) | `backend/src/gameplay/wiring.ts`, called from `backend/src/api/app.ts` |
| Tests | `rules.test.ts`, `policy.test.ts`, `rules1002.test.ts`, `path.test.ts`, `compare.test.ts` and `regression1001.test.ts` (no database), `gameplay.pg.test.ts`, `gameplayRules.pg.test.ts`, `gameplay1002.pg.test.ts` and `regression1001.pg.test.ts` (real PostgreSQL 16, each in its own throwaway database) |

**Shared rule types.** `origin/feat/sim-churn-study` (#123, ba7519f) is merged into this branch with a normal merge commit. It adds the optional `HoldingRules.takeover` (`TakeoverRule`) to `shared/src/domain/holding.ts`, plus the churn simulator. The server reuses `TakeoverRule` and the shared `applyPush` for the two-day challenge. It imports nothing from `shared/src/sim/`. The only conflict was one row of the status table in `GAME_ECONOMY_V3.md`, and both rows were kept.

**Base.** The G-stack (#114 → #117 → #118 → #119 → #120) branched from `feat/g0-economy-v3` and carries the backend as it was before #112. That backend has no migration 0010 and none of the A-10 exchange changes, so the live chain's next number (0011) and the live auth path were not on it. This branch is `feat/sim-pilot-ruleset` (#120, e6cfe42) with `security/a10-single-use-google-exchange` (#112, 2d24d0f) merged in. Its backend and shared code are identical to 2192de6, the commit live on staging. The merge had no conflicts: the G-stack changes only `shared/` and docs, and #112 changes only `backend/`, website and docs. The PR is based on #120, so the diff shows #112's changes as well until #112 lands. The gameplay work is the commits after the merge.

## 2. Authority boundary

- The phone never names a unit, a push, an outcome, a strength or a credit. `POST /gameplay/sessions/:sessionId/apply` takes an empty body (strict: any field is a 400). The server finds the caller's own verified movement session by `(user from the bearer token, client session id)` and derives one stepped-on push per traversed unit.
- Under 1001, traversed units are the cells that contain a verified fix (`HexService.getHexIdsForPoints`), never cells inferred between fixes (assumption A1). Under 1002 they are the session path derived from the verified fixes (section 15.7), which adds units on walked segments between accepted fixes; that departs from A1 and is listed as an owner decision. Shade (enclosed ground) needs D2 and is not derived. The model and the store support it, through the server-only `applyPushes`, which has no route.
- Settlement has no route. It runs in the API's maintenance loop.
- The user always comes from `SessionService.verifyAccess`, the same check `/movement` uses, never from a body or a path.

## 3. Tables

All tables are new and prefixed `gameplay_`. Every reference to a user either cascades or is set to NULL (section 9).

| Table | Key | Holds | Notable constraints |
|---|---|---|---|
| `gameplay_units` | `unit_id` | Current state of each unit: holder, strength, ground, deeded, masked, level, fortified, `as_of_day`, `version` | `unitProblems()` as CHECKs: held ⇔ strength > 0, masked ⇒ unheld, deeded ⇒ solid and held, shade ≤ 25 |
| `gameplay_unit_day_states` | `(unit_id, day)` | Each unit as it stood at the end of each day it changed | Same CHECKs. Day close reads the latest row on or before the day being settled, so a late settlement is never confused by later pushes |
| `gameplay_push_events` | `event_id`, plus `seq` identity | The append-only ledger: one row per applied push, refusals included, with previous and new holder, strengths, push kind, rules version and source session | **Partial unique index `(walker_id, unit_id, day) WHERE outcome IN ('eroded','flipped')`**. Append-only trigger |
| `gameplay_applied_sessions` | `movement_verification_id` | One row per movement session turned into pushes, with its result counts | Idempotency record for the apply route |
| `gameplay_day_settlements` | `day` | One header per closed day: season, status (settled or refused), rules versions, the books, `players`, problems, club status, `input_digest` (sha256 of the canonical inputs) | Books CHECK (section 6.1 invariants 1 to 4). Deferred constraint trigger: the lines add up to the header at commit. Final once settled |
| `gameplay_credit_lines` | `(day, player_id)` | Per-player credits for a settled day | `net = earned − toll paid − recharge − upkeep taken + toll received`, all ≥ 0. Final, except erasure |
| `gameplay_clubs` | `club_id` (client-chosen) | Name, creator | Name unique (case-insensitive) |
| `gameplay_club_memberships` | `id` | Spans `[from_day, to_day)` | One open membership per walker (partial unique index) |
| `gameplay_unit_districts` | `unit_id` | D20 map: unit → district, with a version | Loaded by an operator from geographic polygons. Empty until D20 |
| `gameplay_club_days` | `(day, club_id)` | Member count, contribution totals by outcome and kind, club credits | No per-member data |
| `gameplay_district_days` | `(day, district_id)` | Status, controller, held weight, club tallies | Controller only when status is `controlled` |
| `gameplay_day_rules` | `day` | The rule set the day runs under: version, ruleset name, takeover policy, take budget, unit/zone rule, the full config and its sha256 | Pinned by the day's first push (or its settlement) and immutable (trigger). Push events, unit day states, walker days and the settlement header all have a foreign key to `(day, holding_rules_version)` here |
| `gameplay_walker_days` | `(walker_id, day)` | Takes used by a walker on a day | Locked by every batch of that walker for that day. Deferred constraint trigger on `gameplay_push_events`: at commit a walker's take rows that day equal the counter and do not exceed the day's `take_budget` |
| `gameplay_unit_challenges` | `(unit_id, walker_id)` | Open two-day challenges: challenger and the day the challenge opened | Written under the unit's row lock. Trigger: only on held ground, never by its holder, never from a later day than the unit |

One index is added to an existing table, `movement_verifications (end_time) WHERE status = 'verified'`, for day attribution at close. It is dropped by the rollback.

## 4. Idempotency

| Write | Key | Replay behaviour |
|---|---|---|
| Apply a session | `(user_id, client_session_id)` finds the movement row, and `gameplay_applied_sessions` is keyed by its id. The movement row is locked `FOR UPDATE` first, so concurrent applies of one session serialise | 201 the first time, then 200 with the stored result and `replayed: true`. Tested: five concurrent applies → one applied, four replays, events counted once |
| Each push | `event_id = mv:<movement id>:<unit id>`, the primary key: one immutable id per source session and unit. Ids already stored are passed to the ledger as applied, so the model skips them. Budget refusals are stored too (`refused_take_budget`), so a retry skips them as well | Skipped, never counted twice, never spends the budget twice. Tested: one session applied 30 times at once (applied once), a server batch retried 30 times at once (3 applied, 87 skipped) |
| Settle a day | `day`, the primary key, under an exclusive advisory lock | Returns the stored summary with `created: false`. Tested: three concurrent settlements → one created |
| Create a club | Client-chosen `club_id` | Same creator and name → 200, no change; anyone else → 409 `club_id_taken` |
| Join or leave | The open-membership row, locked | Joining your own club again or leaving with no club changes nothing |

## 5. Concurrency

- **Lock order.** Every batch takes the same locks in the same order: (1) the movement row `FOR UPDATE` (apply only), (2) the day's shared advisory lock `(MRGP, day)`, (3) only when the day has no pinned rule set yet, the season's advisory lock `(MRGS, season)`, (4) the walker-day counters by walker id, (5) the units by unit id. Settlement takes the day's exclusive lock, then (only to pin an unpinned day) the season lock. Nobody waits for a day lock while holding the season lock, and nobody takes the season lock while holding counter or unit locks, so no two transactions can deadlock.
- **The budget.** The walker-day row is locked `FOR UPDATE` before the walker's units. Two sessions of one walker therefore never both spend the last take, whichever units they cross. Tested: 30 sessions of one walker, each on a different unit someone else holds, applied at once give exactly 13 takes and 17 `refused_take_budget`. The counter reads 13.
- **Pushes on a unit.** A batch inserts any missing unit rows (`ON CONFLICT DO NOTHING`) and then locks all its units with `SELECT … ORDER BY unit_id FOR UPDATE`. Every batch locks in the same order, so two batches cannot deadlock. The day's existing pushers and the already-applied event ids are read after the locks are held, so a batch that waited sees everything the batch before it committed. The model then runs on exactly the state that will be written. Tested: ten walkers push one unit at once. The stored ledger is a single chain, each push starting where the previous one left the unit (by `seq`), and the unit row equals the last event.
- **Pushes against day close.** A push takes `pg_advisory_xact_lock_shared(MRGP, day)`. Settlement takes the exclusive `pg_advisory_xact_lock(MRGP, day)` and runs `SERIALIZABLE`, retrying serialization failures up to four times. A day is never settled while a push for it is in flight. After its close, any push for it gets 409 `day_closed`.
- **Fail-safe.** If the application ever disagreed with the database, the one-push index or the event primary key would raise `23505`. The whole batch then rolls back and the client gets 409 `concurrent_push_retry`. A retry is always safe: every write is keyed (section 4).
- **One season, one rule set.** A new day is pinned only after checking, under the season lock, that no other day of the season is pinned to another version or config. Otherwise the push or settlement fails with 409 `season_rules_changed`. Tested: 1001 pushing into a 1002 season, and 20 pushes under each rule set racing to pin the first two days of a new season (one version wins the season; every push of the other gets `season_rules_changed` or `rules_version_mismatch`).
- **Tested under load (1002, section 15).** One walker on three devices: 30 overlapping sessions each applied twice at once, then retried: 13 takes, every unit pushed once, 30 applied sessions. Thirty challengers on one unit at once, then all thirty again 22 hours later at once: one ledger chain, exactly one flip, 29 new challenges.

## 6. Day close on Render Free (no paid cron)

- **D1 (pilot proposal):** a session belongs to the UTC day of its last verified fix. Day `d` closes at midnight plus a 2-hour grace for late uploads. Season 1 starts on `MOVENRUN_GAMEPLAY_SEASON_START_DAY` (a day index). It has no default: with the flag on and no start day, the API refuses to start.
- The existing maintenance loop (`api/maintenance.ts`) gets a "gameplay day close" task, every 15 minutes, only when the flag is on. It runs shortly after every start, after requests and once a minute while awake. A free instance that slept therefore catches up on wake: `settleDueDays` settles every closed, unsettled day since season 1 began, oldest first, at most 31 per run. Days with no activity still settle: holders owe upkeep and the pool returns to the season.
- The task needs nothing paid. If the owner wants day close to happen even when nobody uses the app, a scheduled GitHub Actions workflow that requests `/health` once an hour (free for public repositories, within the free minutes otherwise) wakes the instance. It is not added here.
- Each day: load the unit day states, the day's ledger entries, and verified sessions from the day and the six days before (for consistency). Then `holdingsAtDayClose` → `settleCreditsDay` → `clubSnapshot`, `clubContributions`, `districtControl`. Store the header, lines and aggregates in the same transaction. A day the models refuse is stored as `refused` with its problems (server-only column), and no lines are written. Club and district aggregates are stored only when the credits settled and the club models report no problem.

## 7. Access control

- **Server role.** The API connects as the table owner and is the only writer. RLS is enabled (not forced) on every new table, so the owner is unaffected, as for 0000–0010.
- **anon.** Supabase grants new `public` tables to `anon` and `authenticated` by default. 0011 revokes everything from `anon`, `authenticated` and `PUBLIC` on every new table and on its functions. `anon` gets nothing back. Tested with `has_table_privilege` for every privilege on every table.
- **authenticated (Supabase JWT through the Data API).** It gets `SELECT` only, column by column, plus policies:
  - own rows: units it holds, its push events, applied sessions, credit lines and memberships. The player is resolved by `gameplay_current_player_id()`: the `sub` claim → `auth_identities` (provider `supabase`, not revoked) → `user_id`. A request with no claims resolves to nobody and sees nothing;
  - public aggregates for any signed-in player: settled day headers (without `problems`, `input_digest` or rules columns), club names, club days and district days.
  - `gameplay_day_rules`, `gameplay_walker_days` and `gameplay_unit_challenges` get no grant and no policy at all: server only, like the unit day states.
  - No `INSERT`, `UPDATE` or `DELETE` grant or policy exists for any role. Tested: inserts, updates, deletes, ungranted columns and the server-only tables all fail with `42501` for `authenticated`.
- **The routes** expose no unit ids and no other player's id. Holdings are counts by stage. A player board shows rank, score and whether the row is yours. Club and district responses carry club ids and tallies only. A refused board reports how many problems it had, not their text.

Opening the Data API read path at all (the `authenticated` grants) is a change from 0000–0010, where every table is closed to it. The API serves the same reads. Whether to keep the grants is listed under "Going live".

## 8. The one-push rule in the database

The owner's 17 Oct rule says a walker may push a unit that someone else holds at most once per day. Claiming and reinforcing are not limited, and a flip does not reset the day.

- In the model, `applyPush` refuses a second push from a walker already in `pushedBy` for that day (`refused_daily_limit`). The server rebuilds `pushedBy` from the ledger (eroded or flipped rows for the unit and day) after locking the unit.
- In the database, a push that acts on someone else's ground always records `eroded` or `flipped`. A push past the take budget (1002) records `refused_take_budget`, which changes nothing and does not use the day's push. The partial unique index `gameplay_push_events_one_push_per_walker_unit_day` on `(walker_id, unit_id, day) WHERE outcome IN ('eroded','flipped')` makes a second such row impossible, whatever the application does. Tested: a forged second `eroded` row fails on that index (`23505`), and the same scenario through the service ends in `refused_daily_limit`.
- The ledger is append-only (trigger). An update or delete fails with `23001` unless it is erasure (section 9).

## 9. Account deletion

The existing account deletion (`identity/accountDeletion.ts`) deletes the user's movement sessions and then the user row. 0011 keeps that working without code changes, and none of it depends on the gameplay tables existing:

- the push events of a deleted session or walker cascade away. The append-only trigger allows a delete only when the walker or the source session is gone;
- other players' events naming the person as previous or new holder have those ids set to NULL. The trigger allows that one update only when the named user is gone;
- held units and unit day states have the holder set to NULL. A trigger puts the unit back on the map exactly as the model's `unheld()` does (strength 0, solid, level 1, not fortified, not deeded), so the CHECKs hold;
- credit lines, applied sessions and memberships cascade. Club creator is set to NULL. Settled day headers stay: they hold totals only. After an erasure, a day's remaining lines can sum to less than its header. The header is the record of what was settled.

Tested: erasing a player who holds ground, has pushes and credit lines, and appears as previous holder in others' events succeeds and leaves no gameplay row naming them.

## 10. Feature flag and routes

`MOVENRUN_GAMEPLAY_ENABLED` must be exactly `true`. Anything else (unset, `1`, `TRUE`) leaves gameplay off: no router, no JSON parser and no maintenance task, and no query touches a gameplay table. Every `/gameplay/*` path is then the API's 404, and the API runs against a database without 0011. Tested on the real `createApiApp`: flag unset gives 404 on every gameplay path, flag on gives 401 without a bearer, and flag on without a season start refuses to start.

| Route | Auth | Body | Result |
|---|---|---|---|
| `POST /gameplay/sessions/:sessionId/apply` | Bearer, write limit | `{}` strict | Counts by outcome and rejection reason; 201 or 200 with `replayed` |
| `POST /gameplay/clubs` | Bearer, write limit | `{ clubId, name }` strict | Club created and joined from the next day (D18) |
| `POST /gameplay/clubs/:clubId/join` | Bearer, write limit | `{}` | Membership from the next day |
| `POST /gameplay/clubs/leave` | Bearer, write limit | `{}` | Membership ends at the next day (removed if it never started) |
| `GET /gameplay/me/holdings` | Bearer | — | Own units held today by stage, solid and shade counts |
| `GET /gameplay/me/credits?season=N` | Bearer | — | Own settled credit lines, labelled `off_chain_credits` |
| `GET /gameplay/clubs/:clubId/days/:day` | Bearer | — | Club aggregate for a settled day |
| `GET /gameplay/districts/days/:day` | Bearer | — | District standings for a settled day |
| `GET /gameplay/leaderboards/:season?metric=` | Bearer | — | `seasonLeaderboard` over settled days. Metric defaults to the D22 pilot value |

Errors are `{ "error": "<code>" }`: `session_not_found`, `session_not_verified`, `session_in_future`, `season_not_started`, `day_closed`, `too_many_units`, `unit_resolution_mismatch`, `session_path_unavailable`, `session_path_version_mismatch`, `rules_version_mismatch`, `season_rules_changed`, `unit_rules_version_mismatch`, `concurrent_push_retry`, `club_id_taken`, `club_name_taken`, `already_in_club`, `club_not_found`, `invalid_request`, `not_found`. Day close can also stop with `unknown_rules_version` or `rules_config_mismatch` (no route; the maintenance run logs it and settles nothing from that day on).

The apply result counts outcomes, including `refused_take_budget`. The gameplay routes are unchanged, and no new route exists.

## 11. Rollback

| Situation | Action |
|---|---|
| Code only (flag on, problem found) | Unset `MOVENRUN_GAMEPLAY_ENABLED` and restart. Routes and the task disappear and data stays. |
| Bad settled day | Settled days are final by design. Fix forward in a new rules version; never edit a header. A refused header may be deleted (the trigger allows it), and the next maintenance run settles that day again. |
| Remove the schema | If the 1002 addendum was applied, run `1002_session_paths.down.sql` first. Run `0011_gameplay_holdings.down.sql` in one transaction (and, if 0011 was promoted into `drizzle/`, delete its row from `drizzle.__drizzle_migrations` in the same transaction). **This is not a harmless rollback.** It permanently destroys every gameplay record: holdings, the append-only ledger, settled days and credit lines, the rule set pinned to each day, take counters, open challenges and clubs. Settled days are final by design, and after this they cannot be replayed or reconciled. Running it is its own owner decision, after a `pg_dump`. It leaves 0000–0010 untouched. Tested: up → down gives exactly the 0000–0010 tables and no gameplay functions, and up again works. |
| Restore | Supabase Free has no point-in-time restore. Take a `pg_dump` of the `gameplay_*` tables before any rollback that matters. |

## 12. Open decisions D1–D23

**Source rule** is quoted or summarised from the V3 source as recorded in `GAME_ECONOMY_V3.md`. **Simulated pilot value** is `sim-pilot-1` (`SIM_PILOT_RULESET.md`), synthetic players only. **In the server code** says what this branch does. **Needs owner decision** is what has to be approved before go-live. Nothing in the last two columns is approved.

| Id | Topic | Source rule | Simulated pilot value | In the server code | Needs owner decision |
|---|---|---|---|---|---|
| D1 | Session day, time zone, day close | Rule 7: rewards settle once a day among the people who moved that day. No day boundary given | Not simulated (the simulator numbers days itself) | UTC day of the last verified fix. Close at midnight + 2 h grace. Season 1 start from env, required. Consistency counts a rolling 7 days | Yes: time zone or offset, grace, season start date, and "this week" (rolling vs calendar) |
| D2 | Shade shape and sprawl | §4: 25 × shape × sprawl; sprawl thins past 12 enclosed per stepped cell | Shape below 0.35 claims nothing; sprawl 12 | Not derived. The store accepts shade pushes (1–25) from server code only | Yes: the shape metric, before any shade is derived |
| D3 | Masked areas | §4: military, schools, hospitals, shelters, private land, hazards are never held | Not set | `masked` column, enforced (masked ⇒ unheld). No data source | Yes: data source and update process |
| D4 | Decay rate, stage floors | §5 names the stages, no numbers; shade decays 3× (HYPOTHESIS) | 3/day, floors 60/30/10 | Same, holding rules version 1001 | Yes |
| D5 | Unit and zone | §3: tolls and deeds per cell, upkeep per zone; zone undefined | sim-pilot-1: 201 m unit, zone = unit. sim-pilot-2: 76 m units (resolution 10 scale) in 201 m zones (resolution 9 scale) | 1001: unit = the stored cell (resolution 8 today), zone = unit. 1002: unit = an H3 resolution 10 cell from the session path derived from verified fixes (section 15.7), zone = its resolution 9 parent split into one partition per holder (`per-holder-min-level-v1`, section 15.3) | Yes: resolution, zone grouping, the partition rule, and whether interpolated units push (section 15.7) |
| D6 | Deed cap, claim fee, related accounts | §12 | Not set | Not built (`deeded` column only; no deed can be created) | Later, with deeds |
| D7 | Contest score, support curve, home advantage | §13 | Not set | Not built | Later, with contests |
| D8 | Trail kit carry-over vs two sessions | §10, §17 | Not set | Kit level 1 for everyone, no carry-over | Later, with kit purchases |
| D9 | Fortify price and duration | §11: +30% / −30%, ≤ 3 per zone | Not set | `fortified` column; nothing sets it | Yes, if fortify is in the pilot (G2 churn study) |
| D10 | Toll basis | §20 per session vs §18 example per day | Not set | Per session (the model's §20 reading); no deeds, so no toll is ever charged | Before deeds |
| D11 | Revenue valve | §21 | Not set | Not applicable (credits only) | Before any liquid reward |
| D12 | Fixed-point format | §26 | Model's integer micro-units | Integer micro-units in `bigint` columns | Before any chain settlement |
| D13 | Wallet and paymaster | §24, §25 | Not set | Not applicable | Economy phase |
| D14 | Unpaid upkeep "paid in condition" | §7, §8: those zones decay that day as if unpaid | One extra decay day, proportional, strongest first | Reported and stored (`upkeep_in_condition_micro`); no strength changed | Yes |
| D15 | Shade-only ground pays upkeep | §4 lists map, area, leaderboards, district control, not upkeep | Exempt | Exempt (`shadeCountsAsHeld: false`) | Yes |
| D16 | Levels on loss and reclaim | §9: drop two levels; reclaim within 14 days restores | New holder level 1; restore within 14 days | Model behaviour: lost ground resets to level 1; no restore | Yes |
| D17 | When away days are spent | §7: 14 free away days per season (FIXED) | Automatic | Not applied: nobody is away-protected | Yes |
| D18 | Club membership | §15: clubs exist; count and timing open | One club, next day | One open membership (database), changes take effect next day | Yes |
| D19 | Contribution worth | §15: no tokens from clubs | Weights 1 / 1 / 0.5 / 0.25, shade and club-mate pushes 0 | Counted, unweighted (model); totals stored per club and day | Yes |
| D20 | What a district is | §15: block, suburb, city, country, world layers | Synthetic versioned polygons | `gameplay_unit_districts`, loaded by an operator from versioned geographic polygons; empty until then, which refuses club and district days | Yes: the polygons and their source |
| D21 | District control | §4: solid and shade both count | Shade 1/4, minimum share 1/3, strict lead | Same | Yes |
| D22 | Season board metric, ties | §15: layered leaderboards | `club_district_days`; ties share a rank, listed by id | Default `club_district_days`; all three metrics readable; player rows anonymous | Yes |
| D23 | Club-mate erosion | Not in source | Erodes (no immunity) | Erodes (model) | Yes |
| A9 / rule | One push per walker per unit per day | Owner decision 17 Oct | Enforced | Enforced by the model and by a unique index, under both rule sets | Decided |
| A9 / takeover | What a push that reaches 0 on someone else's ground does | §5: "at 0 the cell flips to the walker"; the immediate reading is ASSUMPTION A9 | sim-pilot-1: immediate. sim-pilot-2: two-day challenge, window 3, floor 50, immediate below 30 | 1001: immediate (default). 1002: two-day challenge (section 15.1) | Yes: approve the two-day challenge for a pilot, or keep the immediate flip |
| Take budget | Pushes per walker per day on other people's ground | Not in source | sim-pilot-2: 13 a day at 76 m (judged on the day's opening holder) | 1001: none. 1002: 13 takes a day, judged in the ledger (section 15.2) | Yes: whether to have one, its value, and what the app says about it |

Values the server adds that are not D-items, all PILOT PROPOSALS: trust weight 1 for everyone (§17, no trust service), kit level 1, at most 500 units per session, at most 31 days settled per maintenance run.

## 13. Free-tier footprint

Supabase Free allows 500 MB of database. A rough sizing: each push row is about 250 bytes with its indexes, and each unit day state about 150. At 1,000 players with 1.5 sessions a day crossing about 6 resolution-8 cells, that is roughly 9,000 pushes and up to 9,000 day states a day, about 3–4 MB a day, or 300 MB over a 90-day season. At resolution 9 it is about 2.5× more. A retention rule for settled ledger rows and superseded day states is needed before a pilot of that size. It belongs with the X-25 data-retention decision. No pruning is implemented: it would need an exception in the append-only trigger, and that should be approved first.

## 14. Going live (each step needs owner approval)

1. Approve the D-values above, or change them, as a server ruleset. Any change to the V3 economy numbers would be a new economy rules version, never an edit.
2. Decide the retention rule for settled ledger rows and day states (section 13), and whether to keep the `authenticated` Data API read grants (section 7) or serve reads through the API only.
3. Promote the migration. Move `0011_gameplay_holdings.sql` into `backend/drizzle/`, add its journal entry and checksum, update `runtime.test.ts`'s migration count to 12, review, merge, and move `deploy/render-free-staging` to the approved commit. Taking a backup first is part of the same approval.
4. Load the D20 district map for the pilot area.
5. Set `MOVENRUN_GAMEPLAY_SEASON_START_DAY`, choose the rule set (`MOVENRUN_GAMEPLAY_RULES_VERSION`: unset is 1001; 1002 is the sim-pilot-2 proposal; it also needs the session-path addendum applied with 0011, and only sessions verified while it runs can be applied under it), and then set `MOVENRUN_GAMEPLAY_ENABLED=true` on staging. This step activates multiplayer gameplay and is its own approval.
6. Wire the app. The mobile UI is frozen; the app keeps showing territory as an on-device preview until this is approved.
7. Run an independent reconciliation of the first settled days. Recompute each day from the stored inputs and compare it with `input_digest` and the header.

## 15. Versioned rule sets and the sim-pilot-2 churn levers

**V3 §5 deviation (needs owner ratification).** SOURCE §5 says "at 0 the cell flips to the walker". 1002's two-day challenge does not flip at 0 on a first push, and its 20-hour gap delays the flip further. That is a deviation from the V3 source, approved only for pilot development and comparison. 1002 is not the default and is not enabled anywhere; 1001 (A9 immediate flip) stays the default. Ratifying, changing or dropping 1002 is the owner's decision, and the final V3 economy is not changed by any of this.

**1002 is still a draft.** No day has ever been pinned to 1002 anywhere (0011 is unapplied), so its config was extended in place with the parameters below (its digest changed). 1001's config and digest are unchanged and are checked against values recorded before this work (`regression1001.test.ts`, `regression1001.pg.test.ts`). Once any day is pinned to 1002, it can only change by a new version.

Each rule below has one of three labels:

- **SOURCE**: stated in the V3 source (`GAME_ECONOMY_V3.md`) or decided by the owner.
- **HYPOTHESIS**: stated in the source, but marked there as a hypothesis or an assumption.
- **SIMULATION-PILOT PROPOSAL**: proposed from synthetic players. The `sim-pilot-2` levers are approved by the owner for pilot development and comparison only, not as final V3 source rules.

| Rule | Label | 1001 (default) | 1002 (optional) |
|---|---|---|---|
| Push 100, fresh strength 100 | SOURCE §4, §5 | yes | yes |
| One push per walker per unit per calendar day on someone else's ground; own and empty ground exempt | SOURCE (owner decision A9, 17 Oct) | model + unique index | model + unique index |
| A push reaching 0 flips at once, at the overflow, at least 1 | HYPOTHESIS (ASSUMPTION A9 reading of §5) | yes | only below 30, on shade, or on the challenger's second day |
| Two-day challenge, window 3 days, floor 50, immediate below 30 | SIMULATION-PILOT PROPOSAL | no | yes (policy version 2) |
| The second push at least 20 hours after the first, by server receipt (`min-elapsed-server-receipt`) | SIMULATION-PILOT PROPOSAL | no | yes (section 15.5) |
| 13 takes per walker per day, met in walk order (`walk-order-v1`) | SIMULATION-PILOT PROPOSAL | no | yes (section 15.2) |
| Resolution 10 units in resolution 9 zones; mixed zone `each-holder-holds-zone`, split per holder (`per-holder-min-level-v1`) | SIMULATION-PILOT PROPOSAL (D5 is open) | no (stored cell, zone = unit) | yes (section 15.3) |
| Units from the session path derived from verified fixes (`verified-steps` v1), stepped and interpolated | SIMULATION-PILOT PROPOSAL (departs from A1) | no (stored cells) | yes (section 15.7) |
| Stepped-on shade falls at once | SOURCE §4 | yes | yes |
| Masked units never held; deeded units immune | SOURCE §4, §12 | yes | yes |
| Decay 3 a day, floors 60/30/10 | SIMULATION-PILOT PROPOSAL (D4); shade ×3 HYPOTHESIS §4 | yes | yes |
| Day = UTC day of the last verified fix, close at midnight + 2 h | SIMULATION-PILOT PROPOSAL (D1, section 6) | yes (unnamed, so its recorded config is unchanged) | yes, unchanged, named `d1-last-verified-fix` v1 |
| Economy rules version 1 (every credit number) | SOURCE §17–22 | yes | yes, unchanged |

### 15.1 Takeover policy

`TakeoverPolicy` in `rules.ts` is `immediate` (1001) or `two-day-challenge` (1002). The arithmetic is the shared model's (`applyPush` with `TakeoverRule.challenge`). The server only selects it. For a push by walker `w` on day `d` on a unit someone else holds, decayed to `d` with strength `s`, and the effective push `e`:

1. **First push.** If `w` has no open challenge on the unit, a push with `e ≥ s` does not flip. It leaves the unit at 50 (or at `s` if lower) and opens `w`'s challenge, dated `d`. A push with `e < s` erodes as usual and also opens the challenge.
2. **Second push.** A push on a later day `d2` with `1 ≤ d2 − d ≤ 3`, while the challenge is open, flips at the A9 overflow. A flip clears every challenge on the unit.
3. **Window expiry.** A challenge older than 3 days does not count. A push on day `d + 4` opens a new challenge instead. Tested at the boundary: `d + 3` flips and `d + 4` does not.
4. **Holder defence.** The holder's stepped-on push restores 100 and clears every challenge. A shade refresh by the holder does not clear them.
5. **Several challengers.** Each walker has their own challenge. Nobody can complete someone else's, and a club-mate cannot occupy a challenge slot. Tested with 30 challengers at once: 30 challenges, one ledger chain, then one of them flips on the next day and the other 29 challenges end.
6. **Decay between days.** A challenged unit decays from 50 at 3 a day. Inside the window it stays above the immediate-take line (50 − 3 × 3 = 41). `rulesetProblems` refuses any rule set where it would not. Ground below 30 (about 24 days unvisited) and stepped-on shade fall to anyone at once, under both policies.
7. **Masked and deeded units.** They are never claimable or immune, exactly as before. A push on them is `refused_masked` or `refused_deeded`, opens no challenge and spends no take.
8. **The one-push rule.** A second push on the same unit on the same day is `refused_daily_limit` under both policies. A challenge push records `eroded`, so the unique index covers it.

### 15.2 Take budget (13)

**Counting definition (`takes-v1`).** A walker's takes on a day are the pushes the server applies, in ledger order, whose outcome is `eroded` or `flipped`. These are pushes on a unit that another walker holds at that moment, after decay to the day:

- **What counts:** challenge pushes, which record `eroded`, and flips. Stepped-on and shade pushes on someone else's ground both count. So do pushes on a club-mate's ground (D23: club-mates erode). Under the one-push rule each take is a different unit, so 13 takes are 13 distinct units of other people's ground.
- **What never counts:** claiming empty ground (including ground that has decayed to 0), reinforcing or refreshing your own ground (stepped on or shade), refusals (`refused_masked`, `refused_deeded`, `refused_daily_limit`, `refused_take_budget`), skipped duplicates and rejected events.
- **Ownership is judged at the push, not at the start of the day.** Once a walker flips a unit it is theirs. Their later pushes on it that day reinforce and are free.
- **Past the budget.** A take is stored as `refused_take_budget`: no strength, holder or challenge changes. It does not use the one-push slot. A stepped-on refusal still counts as a visit to that zone for the walker's own upkeep, as the model's other refusals do. Club contributions leave these rows out.
- **Which pushes win (`order: "walk-order-v1"`).** Within one session, events meet the budget in walk order: the session path's first-touch order, which has no ties within one path. Events without a walk position (server batches from `applyPushes`) come after, in event id order. Pushes are also stored in that order (`seq`), so the ledger replays the same way. Across sessions, the first committed session wins. Tested: of 20 units walked in the reverse of their id order, the first 13 walked are taken (pure and on PostgreSQL); under the previous unit-id order the first 13 ids were taken.
- **Server authority.** The day is the server's D1 day of the session. The count comes from the ledger and the `gameplay_walker_days` counter, in the same transaction as the pushes. The budget is the day's pinned `take_budget`. The client sends neither a day nor a count. The routes still take an empty body.
- **The database guarantee.** A deferred constraint trigger checks at commit that a walker's take rows that day equal the counter and do not exceed the budget. Tested: a forged 14th take is refused (`23514`) with and without a forged counter.

### 15.3 Units and zones (D5)

Under 1002 a unit must be an H3 resolution 10 cell (about 76 m edge) and its zone is `cellToParent(unit, 9)` (about 201 m). The mapping is deterministic. A session with any cell that is not resolution 10 is refused whole (`unit_resolution_mismatch`). H3 is an internal index only: no route returns a cell, and nothing player-facing draws a hexagon.

**Mixed-holder zones.** A zone whose units have more than one holder never gets a single holder, majority or otherwise. The named, switchable candidate (`mixedHolderZone`) is:

- **`each-holder-holds-zone`** (1002's candidate, SIMULATION-PILOT PROPOSAL): every walker holding at least one unit of the zone holds the zone. Each pays its upkeep once at their level, and visits it by stepping on any of its units. This is what the shared `holdingsAtDayClose` already does with a `zoneOf`. Tested: one holder with 5 units and another with 1 both hold the zone.
- **`unit-is-zone`** (the switch): per-unit upkeep, as 1001.

**Partitions (`partition: "per-holder-min-level-v1"`, `zones.ts`).** A mixed zone is split into one partition per holder: the units of the zone that walker holds at day close (decayed first; shade left out while D15 says it does not count).

- **Upkeep:** each partition is one held zone of its holder and pays that zone's upkeep once. A unit is in exactly one partition.
- **Level:** the partition's level is the lowest level among its units. Today every unit is level 1 (no level purchase exists), so no number changes. The shared model alone refuses the whole day when one holder's units in a zone have two levels; the partition level replaces that refusal.
- **Visits and away days:** a partition is visited when its holder stepped on any unit of the zone that day (the shared model's rule). Away-day protection (D17, not built) would cover a holder's own partitions only.
- **Upgrades** (level purchase, fortify; not built) would act on the buyer's partition only.
- **Invariants at day close** (`partitionProblems`): every counted unit is in exactly one partition and its holder is the partition's; the model's held zones are exactly the partitions (no zone without a unit, none counted twice); each credit line's `zones_held` equals its partitions and the lines' total equals the partition count. Any breach refuses the day.
- **Nothing leaks:** partitions, zones and units are internal. Tested on PostgreSQL: a zone held by two walkers with one unit at level 2 settles, each holder holds it once, and the holdings, credits and board responses of one holder contain no other walker's id and no H3 index.

**Open decision D5. Alternatives, none built:**

- **Majority holder only:** the largest holder holds the zone and pays its upkeep. Rejected as a default because it silently drops the minority holders' ground from upkeep and levels.
- **Pro-rata upkeep:** each holder pays the zone's upkeep times their share of its units. This needs fractional zones in `economyV3.ts`.
- **Plurality controller with tenants:** one holder pays and the others pay nothing until they lead.
- **Per-holder sub-zones with one level each:** this is the candidate, plus a rule for D16 levels when a holder's units in one zone differ. Today every unit is level 1 because no level purchase exists. A holder with mixed levels in one zone refuses the day, as the shared model already does.

### 15.4 Versions, pinning and no silent migration

- `RULESETS` lists the versions this build knows: 1001 and 1002. The simulator's 9001 and 9002 are refused as server versions. An unknown or malformed `MOVENRUN_GAMEPLAY_RULES_VERSION` stops the API from starting.
- The first push of a day pins that day's rule set in `gameplay_day_rules`: the version and the full config with its sha256. A day without pushes is pinned by its settlement. Push events, unit day states, walker counters and the settlement header carry the version and have a foreign key to the pin. A row under any other version cannot be stored.
- **Fails closed:**
  - a push or settlement that would pin a new day of a season whose other days are pinned to another version or config (`season_rules_changed`, section 5);
  - a push on a day pinned to another version, or to the same number with another config (`rules_version_mismatch`);
  - a push on held ground last written under another version (`unit_rules_version_mismatch`). Unheld ground carries no rule state and is adopted;
  - a day pinned to a version this build does not know (`unknown_rules_version`) or whose config differs (`rules_config_mismatch`). It is not settled, and the day-close run stops there;
  - a day whose held ground was recorded under another version. The day is stored as refused, naming the units.
- Switching rule sets therefore needs a new season or an explicit, recorded migration of held ground. The season guard enforces the first; the second is not built, and either is an owner decision.
- Tested on PostgreSQL: each of these cases, plus a full replay of the stored ledger in commit order through the same code. The replay gives every stored outcome, every unit row, every open challenge and every counter.

### 15.5 Day attribution, clocks and uploads, and the day-boundary guard

The day is D1's, unchanged and now named in 1002 (`dayAttribution: d1-last-verified-fix` v1): the UTC day of the session's last verified fix, and day `d` takes uploads until midnight plus 2 hours. Server time is authoritative:

- A session dated after the server's current day is refused (`session_in_future`). This covers a device clock that is ahead.
- A session for a closed day is refused (`day_closed`). This covers a device clock far behind and long offline sessions uploaded days later.
- A late upload inside the grace counts for its own day, but cannot rewrite a unit already pushed on the next day (`stale_day`, rejected).
- Within a day, the order is commit order, not walk time.

**The exploit.** Under D1 alone a challenge completes in about 30 minutes: a push at 23:50 and another at 00:20 are two calendar days (tested before this change: it flipped). A session backdated inside the 2-hour grace does the same between 00:00 and 02:00. For players far from UTC the boundary falls in the middle of their day (16:00 or 17:00 in California), so the straddle needs no late night at all.

**Options compared.**

| Option | Closes the straddle? | Honest player cost | Trust needed | Verdict |
|---|---|---|---|---|
| UTC day (D1 alone) | No: 30 minutes across midnight | None | Server clock | The current rule; kept for day attribution |
| Local city day | No: the straddle moves to local midnight | None | A trusted time zone: the device's is the client's word, and one derived from the unit needs time-zone polygons the server does not have | Rejected |
| Session end day / grace changes | No: they move the boundary, not remove it; a shorter grace hurts offline uploads | Late uploads refused | Server clock | Rejected |
| Minimum elapsed time by device timestamps | Only for honest clients: fix times are the device's word and can be backdated or forged forward | None | The device | Rejected |
| **Minimum elapsed time by server receipt (recommended, built)** | Yes, as a real-time guarantee: the flip cannot land until 20 hours after the server first received the challenge, whatever the device says | A walker whose first walk was uploaded late (offline) may need one more day inside the window | Server clock only | **1002** |

**The rule (`takeover.secondPush`, `min-elapsed-server-receipt` v1, 20 hours).** The push that would complete a challenge flips only if the server received its session at least 20 hours after it received the session that opened the challenge. Received means `movement_verifications.created_at`, the server's clock when it verified the upload. The opening time is read from the ledger: the challenger's `eroded` push on the unit on the challenge's first day (unique under the one-push index) and its source session. A server batch (`applyPushes`) uses its own time, and an opening time that cannot be found is treated as too recent (fail closed). A push that is too early erodes, no lower than the floor, and keeps the original challenge and its first day; it does not restart it. Both pushes must still be on two distinct D1 days within the 3-day window, and ground below 30 and stepped-on shade still fall at once. 20 hours means a walker who comes back at the same time the next day is never caught by it, and a defender always has 20 real hours to answer.

What it guarantees and what it does not: a modified client can still forge fix times, and could even record the second walk early and upload it later; what it cannot do is make the flip land sooner than 20 hours of server time after the challenge became visible. That window, in which the holder's visit clears the challenge, is the point of the challenge.

**Tested** (pure, `rules1002.test.ts`, and PostgreSQL, `gameplay1002.pg.test.ts` and `gameplayRules.pg.test.ts`):

- midnight straddle (23:50 then 00:20): erodes, the challenge keeps its first day; back 20 hours or more after the first upload, it flips;
- the boundary: 19 h 59 min erodes, 20 h exactly flips; too early on day 2, then day 3 inside the window flips; day 4 opens a new challenge;
- DST and time-zone changes: the guard reads only server receipt deltas, so a European DST night (25 Oct 2026) and any device time zone change nothing;
- clock skew: a device clock ahead is refused by server time (`session_in_future`); device timestamps never enter the gap;
- long offline uploads: the gap runs from when the server received the first walk, so a walk uploaded at 01:30 the next morning shortens the following day's chance, and a second walk held back and uploaded later flips only 20 hours after the first upload;
- out-of-order uploads: unchanged `stale_day` behaviour, and a replay of the stored ledger with the stored receipt times gives every stored outcome.

**Residual risks (open decisions):** the 20-hour value itself; whether to show players when their challenge can complete (the app is frozen); and that a walker with honest but delayed uploads can lose a day.

### 15.6 Open decisions added here

| Id | Decision | Server today |
|---|---|---|
| A9 / takeover | Two-day challenge for the pilot, or the immediate flip | 1001 immediate (default); 1002 challenge |
| Budget | Whether there is a daily take budget, its value (13 at 76 m) and how the app explains it | 1002 only, `takes-v1` as defined above, met in walk order |
| D5 | Unit resolution, zone resolution, mixed-holder rule (alternatives above) | 1002: res 10 in res 9, `each-holder-holds-zone`, split `per-holder-min-level-v1` |
| D5 / pipeline | Whether 1002's units come from the stored session path, and whether interpolated units push (A1) | 1002: `verified-steps` v1, interpolated units push; the toll reads stepped units only (section 15.7) |
| Session path retention | Prune a session's stored path once its day is settled (the ledger then holds its pushes) | Not built (section 15.9) |
| Midnight straddle | The second-push gap and its value | 1002: 20 hours by server receipt (section 15.5) |
| Rule changes | A new season or an explicit migration of held ground when the rule set changes | Mid-season change fails closed (`season_rules_changed`); a recorded migration is not built |
| V3 §5 | Ratify, change or drop 1002's deviation from "at 0 the cell flips" | 1002 optional, not the default, not enabled |


### 15.7 The session path: resolution 10 units from verified fixes (D5 / pipeline)

**The mismatch.** The movement pipeline stores the resolution 8 cells that contain a fix (`traversed_hex_ids`), and raw fixes are never stored. A resolution 10 unit cannot be recovered from a resolution 8 cell, so 1002 refused every real session (`unit_resolution_mismatch`). The pipeline's own column, its response and 1001 are unchanged.

**The fix (`units.source: session-path`, `verified-steps` v1, `path.ts`).** When gameplay is enabled with a rule set that needs it (1002), the movement verification derives the session's path in the same request, from the very fixes it has just accepted, and stores it in the same transaction as the verification row (`gameplay_session_paths`, section 15.9). A verification and its path are written together or not at all; a retry of a stored session never rewrites it, whatever points it carries. The client never sends a cell. With gameplay off, or under 1001, nothing is derived and no gameplay table is touched (tested on a database without 0011).

- **Stepped units:** contain an accepted fix (A1). **Interpolated units:** lie on the straight segment between two consecutive accepted fixes, sampled every 8 m. A segment is walked only when the pipeline's own continuity holds: no break or pause between the fixes, at most 200 m (the sealing continuity break, sealing rules version 1), at most 12 m/s (the on-foot policy) and at most 120 s (PILOT PROPOSAL). Anything else adds only its two ends. A unit first interpolated and later stepped on is stepped.
- **Walk order:** first touch, which the budget uses (section 15.2).
- **Bounded:** at most 500 units (`maxUnitsPerSession`), the rest dropped in walk order and the row marked truncated.
- **Pushes:** 1002 pushes stepped and interpolated units (`pushInterpolated: true`). That departs from A1, and is the owner's decision; `false` pushes stepped units only. The toll's crossed cells (economy V3 §20, "never interpolated") are the stepped units only (tested with a deeded unit: crossing it interpolated costs no toll, stepped costs one).
- **Apply fails closed:** a session with no stored path (verified while gameplay was off, or before this existed) gets 409 `session_path_unavailable`; a path under another path version or resolution gets 409 `session_path_version_mismatch`.
- **Privacy:** the path is resolution 10 cells in first-touch order. That is the granularity the 1002 push ledger already stores per push, and the same ordering `traversed_hex_ids` keeps at resolution 8. No coordinate, timestamp or per-unit time is stored. The row cascades with its verification, which account deletion removes (tested).

**Measured on the route fixtures** (CODE TESTED LOCALLY, `path.test.ts`; the shapes of the canonical-evidence fixtures and the verification fixture, with accepted fixes every 5.3, 25 and 40 m; truth = the drawn route walked every metre):

| Fixture | Res 8 cells (pipeline) | Res 10 units on the route | Recall, stepped only @5.3 / 25 / 40 m | Recall, stepped + interpolated @5.3 / 25 / 40 m | Units off the route | Res 10 units whose res 8 parent is not a stored cell | Fixes whose res 10 cell's res 8 parent is not their res 8 cell |
|---|---|---|---|---|---|---|---|
| urban corners | 3 | 28 | 1.000 / 1.000 / 1.000 | 1.000 / 1.000 / 1.000 | 0 | 0 | 1.7–2.7% |
| square | 4 | 33 | 1.000 / 0.970 / 0.970 | 1.000 / 1.000 / 1.000 | 0 | 0 | 0% |
| figure eight | 5 | 31 | 1.000 / 1.000 / 1.000 | 1.000 / 1.000 / 1.000 | 0 | 0 | 8.0% |
| multiple loops | 4 | 38 | 1.000 / 1.000 / 0.974 | 1.000 / 1.000 / 1.000 | 0 | 0 | 2.4–3.1% |
| out and back | 4 | 26 | 0.962 / 0.962 / 0.885 | 0.962 / 1.000 / 1.000 | 0 | 1 | 7.0–8.0% |
| verification fixture | 2 | 3 | 1.000 | 1.000 | 0 | 0 | 0% |

Every resolution 8 cell the pipeline stored lies under some unit of the path. The drift columns come from H3 itself: a resolution 10 cell's resolution 8 parent is not always the resolution 8 cell of the same point (children do not nest exactly), for up to 8% of fixes here. 1002 never mixes the two: its units and zones are resolution 10 cells and their `cellToParent(…, 9)`, deterministically.

**Storage** (local PostgreSQL 16): a 27-unit path's `unit_ids` is 240 bytes as `bigint[]` against 564 as `text[]`; a 45-unit row with its primary key is about 525 bytes. At 1,000 players and 1.5 sessions a day that is about 0.8 MB a day, or about 71 MB over a 90-day season if never pruned, and about 2.4 MB if each path were pruned once its day settles (a retention decision, not built).

### 15.8 Same-seed comparison of 1001 and 1002 (SIMULATION ONLY)

`compare.ts` feeds both rule sets the same synthetic verified walks: 40 casual walkers (a loop near home on about 60% of days, half the time the same route) and 4 attackers (a long daytime tour through six casual homes plus the midnight straddle round one home), 14 days, 3 seeds. 1001 gets the resolution 8 cells the pipeline stores; 1002 gets the session path. Both run through `applyServerLedger` with their own rules. Synthetic behaviour assumptions only: nothing here is evidence about real players, real retention or real fairness. Areas use the H3 average cell area (0.737 km² at resolution 8, 0.0150 km² at resolution 10), so a resolution 8 cell counts whole however little of it was walked; compare directions, not exact areas.

| Mean of 3 seeds | 1001 | 1002 without the gap | 1002 |
|---|---|---|---|
| Area attackers flipped from others (km², summed) | 529.6 | 0.54 | 0.48 |
| Casual area lost to attackers' flips (km², summed) | 266.4 | 0.35 | 0.31 |
| Attacker flips completed within 20 h of their challenge | 0 (no challenge) | 4.7 | 0 |
| Area attackers hold at the end (km²) | 2.9 | 4.4 | 4.6 |
| Casual walkers holding any ground at the end (of 40) | 16.7 | 40 | 40 |
| Casual sessions that claimed or reinforced something | 119 of 343 | 332 of 343 | 333 of 343 |
| Pushes refused by the budget: casual / attacker | 0 / 0 | 1,165 / 5,558 | 1,179 / 5,530 |

Reading it: under 1001 the attackers' long routes flip whole resolution 8 cells, and casual walkers keep losing them. Under 1002 attackers take almost nothing from others, the gap removes the straddle flips, and every casual walker keeps some ground. Two costs show: attackers still hold more empty ground at the end (claims are free, so a long walk claims a lot of unheld resolution 10 units), and casual walkers also meet the budget (about 3.4 refused takes per casual session in this dense synthetic town, where homes overlap). Both are owner questions (claim limits, the budget's value), not settled by synthetic players. Reproduce: `node --import tsx scripts/compare-rulesets.ts 3` in `backend/`.

### 15.9 Schema notes for 0011

The 0011 SQL is being reworked separately for storage. Nothing in it was edited here. The code above works with the current 0011 columns, plus one new table in a separate proposed addendum:

- **New table `gameplay_session_paths`** (`drizzle-proposed/1002_session_paths.sql`, with its rollback): `movement_verification_id` (primary key, references `movement_verifications` on delete cascade), `path_version smallint`, `resolution smallint`, `unit_ids bigint[]` (H3 as 8-byte integers, walk order, at most 500), `interpolated varbit` (one bit a unit), `skipped_segments`, `truncated`, `created_at`. RLS on; nothing granted to `anon`, `authenticated` or `PUBLIC`. Needs 0011 only for ordering; fold it into 0011 when 0011 is final. It is applied by the local tests only.
- **Challenge opening time.** The 20-hour gap reads the opening time by joining `gameplay_unit_challenges` to the challenger's `eroded` row in `gameplay_push_events` on the challenge's first day and its `source_session_id` → `movement_verifications.created_at` (or the event's own `created_at` for a server batch). If the storage rework drops `gameplay_push_events.created_at` or `source_session_id`, or partitions the ledger so that join gets expensive, add `opened_received_at timestamptz NOT NULL` (or an epoch-seconds `integer`) to `gameplay_unit_challenges` instead, written when the challenge opens; `policy.ts` already takes the value as an input.
- **Walk order** needs no column: it is the order of `unit_ids`, and pushes are stored in it (`seq`).
- **Season guard** uses the existing `gameplay_day_rules.season`; an index on `(season)` would help if a season ever had many pinned days (at most 90 rows, so not needed now).
- **Partitions** need no column: they are computed at day close from the unit day states.
- **Compact identifiers.** If 0011 moves unit ids to `bigint`, `path.ts`'s `cellToInt8` / `int8ToCell` are the conversion the session path already uses.
