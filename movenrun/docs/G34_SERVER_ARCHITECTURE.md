# G3/G4 server architecture: holdings, settlement, clubs, districts, leaderboards

**Status:** PREPARATION, in draft review. Nothing here is live. The gameplay routes are not mounted unless `MOVENRUN_GAMEPLAY_ENABLED=true`, and the migration they need (`backend/drizzle-proposed/0011_gameplay_holdings.sql`) is written and tested on a local PostgreSQL only. It is not applied to staging or to any other live database, and it is not in the migration journal that the staging start command runs.

**Scope:** server-authoritative storage and HTTP access for the shared reference models: holding (`shared/src/domain/holding.ts`), the push ledger (`holdingLedger.ts`), day settlement (`holdingSettlement.ts`) and clubs, districts and leaderboards (`clubsDistricts.ts`). The rules stay in those models. The server loads state, runs them, and stores what they return. Credits are off-chain game points: no token, balance, wallet, transfer or chain.

**Out of scope:** multiplayer activation, shade derivation (D2), deeds and contests, levels purchase, fortify, any map drawing (the app's map stays geographic; H3 is an internal index and never appears in a player-facing response from these routes).

## 1. Where the code sits

| Piece | Path |
|---|---|
| Proposed migration and rollback | `backend/drizzle-proposed/0011_gameplay_holdings.sql`, `0011_gameplay_holdings.down.sql` |
| Pilot rules (every open value, named by decision) | `backend/src/gameplay/rules.ts` |
| Service: apply, settle, clubs, reads | `backend/src/gameplay/service.ts` |
| HTTP routes | `backend/src/gameplay/router.ts` |
| Production wiring (flag, maintenance task) | `backend/src/gameplay/wiring.ts`, called from `backend/src/api/app.ts` |
| Tests | `backend/src/gameplay/rules.test.ts` (no database), `backend/src/gameplay/gameplay.pg.test.ts` (real PostgreSQL) |

**Base.** The G-stack (#114 → #117 → #118 → #119 → #120) branched from `feat/g0-economy-v3` and carries the backend as it was before #112. That backend has no migration 0010 and none of the A-10 exchange changes, so the live chain's next number (0011) and the live auth path were not on it. This branch is `feat/sim-pilot-ruleset` (#120, e6cfe42) with `security/a10-single-use-google-exchange` (#112, 2d24d0f) merged in. Its backend and shared code are identical to 2192de6, the commit live on staging. The merge had no conflicts: the G-stack changes only `shared/` and docs, and #112 changes only `backend/`, website and docs. The PR is based on #120, so the diff shows #112's changes as well until #112 lands. The gameplay work is the commits after the merge.

## 2. Authority boundary

- The phone never names a unit, a push, an outcome, a strength or a credit. `POST /gameplay/sessions/:sessionId/apply` takes an empty body (strict: any field is a 400). The server finds the caller's own verified movement session by `(user from the bearer token, client session id)` and derives one stepped-on push per traversed unit.
- Traversed units are the cells that contain a verified fix (`HexService.getHexIdsForPoints`), never cells inferred between fixes (assumption A1). Shade (enclosed ground) needs D2 and is not derived. The model and the store support it, through the server-only `applyPushes`, which has no route.
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

One index is added to an existing table, `movement_verifications (end_time) WHERE status = 'verified'`, for day attribution at close. It is dropped by the rollback.

## 4. Idempotency

| Write | Key | Replay behaviour |
|---|---|---|
| Apply a session | `(user_id, client_session_id)` finds the movement row, and `gameplay_applied_sessions` is keyed by its id. The movement row is locked `FOR UPDATE` first, so concurrent applies of one session serialise | 201 the first time, then 200 with the stored result and `replayed: true`. Tested: five concurrent applies → one applied, four replays, events counted once |
| Each push | `event_id = mv:<movement id>:<unit id>`, the primary key. Ids already stored are passed to `applyLedger` as applied, so the model skips them | Skipped, never counted twice |
| Settle a day | `day`, the primary key, under an exclusive advisory lock | Returns the stored summary with `created: false`. Tested: three concurrent settlements → one created |
| Create a club | Client-chosen `club_id` | Same creator and name → 200, no change; anyone else → 409 `club_id_taken` |
| Join or leave | The open-membership row, locked | Joining your own club again or leaving with no club changes nothing |

## 5. Concurrency

- **Pushes on a unit.** A batch inserts any missing unit rows (`ON CONFLICT DO NOTHING`) and then locks all its units with `SELECT … ORDER BY unit_id FOR UPDATE`. Every batch locks in the same order, so two batches cannot deadlock. The day's existing pushers and the already-applied event ids are read after the locks are held, so a batch that waited sees everything the batch before it committed. The model then runs on exactly the state that will be written. Tested: ten walkers push one unit at once. The stored ledger is a single chain, each push starting where the previous one left the unit (by `seq`), and the unit row equals the last event.
- **Pushes against day close.** A push takes `pg_advisory_xact_lock_shared(MRGP, day)`. Settlement takes the exclusive `pg_advisory_xact_lock(MRGP, day)` and runs `SERIALIZABLE`, retrying serialization failures up to four times. A day is never settled while a push for it is in flight. After its close, any push for it gets 409 `day_closed`.
- **Fail-safe.** If the application ever disagreed with the database, the one-push index or the event primary key would raise `23505`. The whole batch then rolls back and the client gets 409 `concurrent_push_retry`.

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
  - No `INSERT`, `UPDATE` or `DELETE` grant or policy exists for any role. Tested: inserts, updates, deletes, ungranted columns and the server-only tables all fail with `42501` for `authenticated`.
- **The routes** expose no unit ids and no other player's id. Holdings are counts by stage. A player board shows rank, score and whether the row is yours. Club and district responses carry club ids and tallies only. A refused board reports how many problems it had, not their text.

Opening the Data API read path at all (the `authenticated` grants) is a change from 0000–0010, where every table is closed to it. The API serves the same reads. Whether to keep the grants is listed under "Going live".

## 8. The one-push rule in the database

The owner's 17 Oct rule says a walker may push a unit that someone else holds at most once per day. Claiming and reinforcing are not limited, and a flip does not reset the day.

- In the model, `applyPush` refuses a second push from a walker already in `pushedBy` for that day (`refused_daily_limit`). The server rebuilds `pushedBy` from the ledger (eroded or flipped rows for the unit and day) after locking the unit.
- In the database, pushing someone else's ground always records `eroded` or `flipped`. The partial unique index `gameplay_push_events_one_push_per_walker_unit_day` on `(walker_id, unit_id, day) WHERE outcome IN ('eroded','flipped')` makes a second such row impossible, whatever the application does. Tested: a forged second `eroded` row fails on that index (`23505`), and the same scenario through the service ends in `refused_daily_limit`.
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

Errors are `{ "error": "<code>" }`: `session_not_found`, `session_not_verified`, `session_in_future`, `season_not_started`, `day_closed`, `too_many_units`, `concurrent_push_retry`, `club_id_taken`, `club_name_taken`, `already_in_club`, `club_not_found`, `invalid_request`, `not_found`.

## 11. Rollback

| Situation | Action |
|---|---|
| Code only (flag on, problem found) | Unset `MOVENRUN_GAMEPLAY_ENABLED` and restart. Routes and the task disappear and data stays. |
| Bad settled day | Settled days are final by design. Fix forward in a new rules version; never edit a header. A refused header may be deleted (the trigger allows it), and the next maintenance run settles that day again. |
| Remove the schema | Run `0011_gameplay_holdings.down.sql` in one transaction (and, if 0011 was promoted into `drizzle/`, delete its row from `drizzle.__drizzle_migrations` in the same transaction). This destroys all gameplay data and leaves 0000–0010 untouched. Tested: up → down gives exactly the 0000–0010 tables and no gameplay functions, and up again works. |
| Restore | Supabase Free has no point-in-time restore. Take a `pg_dump` of the `gameplay_*` tables before any rollback that matters. |

## 12. Open decisions D1–D23

**Source rule** is quoted or summarised from the V3 source as recorded in `GAME_ECONOMY_V3.md`. **Simulated pilot value** is `sim-pilot-1` (`SIM_PILOT_RULESET.md`), synthetic players only. **In the server code** says what this branch does. **Needs owner decision** is what has to be approved before go-live. Nothing in the last two columns is approved.

| Id | Topic | Source rule | Simulated pilot value | In the server code | Needs owner decision |
|---|---|---|---|---|---|
| D1 | Session day, time zone, day close | Rule 7: rewards settle once a day among the people who moved that day. No day boundary given | Not simulated (the simulator numbers days itself) | UTC day of the last verified fix. Close at midnight + 2 h grace. Season 1 start from env, required. Consistency counts a rolling 7 days | Yes: time zone or offset, grace, season start date, and "this week" (rolling vs calendar) |
| D2 | Shade shape and sprawl | §4: 25 × shape × sprawl; sprawl thins past 12 enclosed per stepped cell | Shape below 0.35 claims nothing; sprawl 12 | Not derived. The store accepts shade pushes (1–25) from server code only | Yes: the shape metric, before any shade is derived |
| D3 | Masked areas | §4: military, schools, hospitals, shelters, private land, hazards are never held | Not set | `masked` column, enforced (masked ⇒ unheld). No data source | Yes: data source and update process |
| D4 | Decay rate, stage floors | §5 names the stages, no numbers; shade decays 3× (HYPOTHESIS) | 3/day, floors 60/30/10 | Same, holding rules version 1001 | Yes |
| D5 | Unit and zone | §3: tolls and deeds per cell, upkeep per zone; zone undefined | 201 m unit (resolution 9 scale), zone = unit | Unit = the traversed cell the movement pipeline stores today (resolution 8, about 531 m); zone = unit. Res 9 needs the movement pipeline to store res 9 cells | Yes: resolution, and zone grouping (the G2 churn study compares larger upkeep zones) |
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
| A9 / rule | One push per walker per unit per day | Owner decision 17 Oct | Enforced | Enforced by the model and by a unique index | Decided |

Values the server adds that are not D-items, all PILOT PROPOSALS: trust weight 1 for everyone (§17, no trust service), kit level 1, at most 500 units per session, at most 31 days settled per maintenance run.

## 13. Free-tier footprint

Supabase Free allows 500 MB of database. A rough sizing: each push row is about 250 bytes with its indexes, and each unit day state about 150. At 1,000 players with 1.5 sessions a day crossing about 6 resolution-8 cells, that is roughly 9,000 pushes and up to 9,000 day states a day, about 3–4 MB a day, or 300 MB over a 90-day season. At resolution 9 it is about 2.5× more. A retention rule for settled ledger rows and superseded day states is needed before a pilot of that size. It belongs with the X-25 data-retention decision. No pruning is implemented: it would need an exception in the append-only trigger, and that should be approved first.

## 14. Going live (each step needs owner approval)

1. Approve the D-values above, or change them, as a server ruleset. Any change to the V3 economy numbers would be a new economy rules version, never an edit.
2. Decide the retention rule for settled ledger rows and day states (section 13), and whether to keep the `authenticated` Data API read grants (section 7) or serve reads through the API only.
3. Promote the migration. Move `0011_gameplay_holdings.sql` into `backend/drizzle/`, add its journal entry and checksum, update `runtime.test.ts`'s migration count to 12, review, merge, and move `deploy/render-free-staging` to the approved commit. Taking a backup first is part of the same approval.
4. Load the D20 district map for the pilot area.
5. Set `MOVENRUN_GAMEPLAY_SEASON_START_DAY` and then `MOVENRUN_GAMEPLAY_ENABLED=true` on staging. This step activates multiplayer gameplay and is its own approval.
6. Wire the app. The mobile UI is frozen; the app keeps showing territory as an on-device preview until this is approved.
7. Run an independent reconciliation of the first settled days. Recompute each day from the stored inputs and compare it with `input_digest` and the header.
