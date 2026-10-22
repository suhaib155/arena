# Free-tier operations runbook (Render Free, Supabase Free)

Checkpoint: 22 October 2026
Source heads: backend/render.yaml at 2326aa6 (#112, identical backend source at live API 2192de6); mobile at 15f7f87 (#125); website 61d30bb (#116); fact sheets OFFICIAL_SOURCES, WEBSITE_FACTS, ANDROID_FACTS (retrieved 2026-10-22).
Claim classes: SOURCE VERIFIED (read in git at the SHA) / LOCAL TEST CONFIRMED / REVIEWER REPORTED (recorded in project memory, not re-checked) / OWNER-PROVIDER GATED / NOT RUN / UNKNOWN. Nothing here contacts a live service. Paths are under `movenrun/` unless stated; `R` = repo-root `render.yaml`.

## 1. Render Free

| Fact | Class | Evidence |
|---|---|---|
| Spins down after 15 min with no inbound traffic; wake on next request takes about one minute | SOURCE VERIFIED | https://render.com/docs/free, retrieved 2026-10-22 |
| 750 free instance hours per workspace per calendar month; exhausted hours suspend all Free web services until next month | SOURCE VERIFIED | same page |
| Local disk lost on redeploy, restart and spin-down; Render may restart at any time; outbound ports 25/465/587 blocked | SOURCE VERIFIED | same page |
| One service, `plan: free`, `autoDeployTrigger: off`, branch `deploy/render-free-staging`, `healthCheckPath: /ready` | SOURCE VERIFIED | R:12-20,23 @ 2326aa6 |
| 750 h covers one always-on instance (31 days x 24 h = 744 h) only if nothing else in the workspace also runs; a second Free service in the same workspace would share the pool | SOURCE VERIFIED (arithmetic) + UNKNOWN (what else is in the workspace) | OWNER-PROVIDER GATED dashboard check |

### Do migrations run on startup?
Yes. The migration runs as part of the start command on every process start, not as a separate build or deploy step.
- `startCommand: yarn workspace @movenrun/backend db:migrate && yarn workspace @movenrun/backend start` (R:25 @ 2326aa6). The file comment says Free instances have no pre-deploy step, so migrations run before start (R:3-5).
- `db:migrate` is `drizzle-kit migrate` (backend/package.json:16 @ 2326aa6). `build` is typecheck plus `scripts/build-api.mjs` only; no migration there (backend/package.json:8). `backend/scripts/` contains only `build-api.mjs` (git ls-tree @ 2326aa6). `server.ts` does not migrate; it reads config and listens (backend/src/api/server.ts:6-11 @ 2326aa6).
- Consequence: every wake from spin-down is a new process start, so `drizzle-kit migrate` runs on every cold start. With nothing pending it is a no-op comparison against `drizzle.__drizzle_migrations`, but it adds database round trips to the roughly one-minute wake and a failed migration step stops the API from starting (the `&&` short-circuits). Wake-time cost of the no-op check: UNKNOWN / NOT RUN.
- The operator guide states drizzle applies all pending migrations in one transaction and a failure rolls back (docs/play-launch/LIVE_SETUP_OPERATOR_GUIDE.md:17-20, 41 @ 2326aa6). Not re-tested here.
- The E-62 boot log recorded `migrations applied successfully` after the 17 Oct deploy (docs/play-launch/EVIDENCE_REGISTER.md E-62 @ 2326aa6; REVIEWER REPORTED for the live log).

### Maintenance-on-wake model (backend/src/api/maintenance.ts @ 2326aa6)
- Tasks run when due: 5 s after start, after any response finishes, and once a minute while awake (maintenance.ts:6-10, 71-78). Nothing relies on `setInterval` surviving a sleep.
- Tasks registered (backend/src/api/app.ts:49-57): pending provider deletions plus expired wallet handoffs every 5 min; unused provider sign-in records every 30 min; expired sign-in sessions every hour.
- A failure only logs `Maintenance: <name> failed; will retry when next due`; a success logs only when count > 0 (maintenance.ts:53-54). Only counts are logged.
- Consequence: no keep-awake ping is needed for correctness. Clean-up is late, not lost. User-facing copy already says clean-up "can run later" (WEBSITE_FACTS P19).
- Known gap (SOURCE VERIFIED): a provider deletion that keeps failing is retried every 10 min forever (`due(now, 10*60*1000, 50)`, supabaseSignIn.service.ts:380-382; signInStores.ts:214-224 @ 2326aa6). There is no attempt cap, no age alert and no log line for a row that stays stuck, because `removeProviderUsers` swallows the error and only the removed count is returned. Visibility today is the SQL count only (section 4). Patch proposal (text only, not applied): log an aggregate `pending deletions older than 1 day: N` from the maintenance task.

### Probe cadence without keep-awake pings
Each probe to a sleeping service wakes it and spends instance hours; a ping every <15 min would keep it awake all month and is not recommended (the existing plan names a pinger as the wrong answer, FREE_HOSTING_READINESS.md "Cold starts" row @ 2326aa6).
| Situation | Cadence | Probe |
|---|---|---|
| Idle / no testers | None. Weekly manual dashboard look (section 3) | none |
| Active closed-test day | Owner opens `GET /ready` by hand at start of day and after each reported sign-in failure; expect up to ~60 s on the first call | `/ready` (probes migrated tables, returns 503 on any error, app.ts:66-79) |
| 48 h post-release | Per INCIDENT_48H_PROTOCOL.md (release, +2 h, +6 h, +24 h, +48 h) | `/ready` |
No external uptime service (it would either wake the host on a timer or cost money). `/health` returns 200 without touching the database (app.ts:65); use `/ready` when database state matters.

### Client behaviour on cold start
| Behaviour | Class | Evidence |
|---|---|---|
| Sign-in requests wait up to 90 s ("covers a free-tier cold start (about a minute)") | SOURCE VERIFIED | mobile/src/services/identityApi.ts:144-145 @ 15f7f87 |
| `wakeServer()` fires `GET /health` with the 90 s timeout while the person picks a method or is in Google's screens; result and failure ignored | SOURCE VERIFIED | identityApi.ts:374-385 @ 15f7f87 |
| Movement verification requests time out at 20 s | SOURCE VERIFIED | mobile/src/services/movementApi.ts:311 @ 15f7f87 |
| Unsent verification stored on phone, retried only on becoming authenticated or returning to foreground (no timer, no background task); max 6 attempts, 7 days, 3 items, backoff 60 s up to 6 h | SOURCE VERIFIED | useVerificationRetry.ts:1-20; pendingVerification.ts:65,83,93,96-99 @ 15f7f87 |
| Website sign-in and deletion pages use a 90 s API timeout and call `/health` on load | SOURCE VERIFIED | account-auth.js:55,71 @ 61d30bb |
| API cold start (server side) | LIVE OBSERVED 22 Oct 09:24Z: one `/health` request took 42.4 s from spin-down, the next `/ready` 0.33 s | single passive sample, not a distribution |
| Real-device cold-start latency | NOT RUN | needs the phone test |
Guidance for testers and support: "first sign-in after a quiet spell can take a minute; wait, do not tap repeatedly". Because a 20 s movement timeout is shorter than a ~60 s wake, a walk saved right after a long idle can land in the retry queue and verify on the next foreground; this is designed behaviour, not data loss, while the 7-day/6-attempt budget lasts.

## 2. Supabase Free

| Fact | Class | Evidence |
|---|---|---|
| Database size limit 500 MB per project | SOURCE VERIFIED | https://supabase.com/docs/guides/platform/billing-on-supabase, 2026-10-22 |
| "We may pause applications on the Free Plan that exhibit low activity in a 7-day period"; restorable from dashboard | SOURCE VERIFIED | https://supabase.com/docs/guides/deployment/going-into-prod, 2026-10-22 (wording is "may"; exact trigger UNKNOWN) |
| While paused, `/ready` returns 503 (all queries fail) | SOURCE VERIFIED (code path) | app.ts:66-79; FREE_HOSTING_READINESS.md "Project paused" row |
| 11.8 MiB database use reported at the historical checkpoint | REVIEWER REPORTED snapshot, not a current reading; re-measure with the section 4 query before relying on it |
| Migrations 0000-0010 applied (count 11), no `public` table without RLS, `account_capacity` 1,000 total / 50 per hour, hook EXECUTE for `supabase_auth_admin` only, 0 auth users, at 17 Oct 12:33 UTC | REVIEWER REPORTED (owner-requested read-only SQL) | EVIDENCE_REGISTER.md E-62, E-63 @ 2326aa6 |
| Migration 0011 not applied: not in `backend/drizzle/` at 2326aa6 (files 0000-0010 + CHECKSUMS.sha256); proposal lives on draft branches (E-76, E-90) | SOURCE VERIFIED (repo) / live state UNKNOWN |
| Applied migration files are never edited; `migrationChecksums.test.ts` pins hashes (D-27); fix forward with a new migration | SOURCE VERIFIED | LIVE_SETUP_OPERATOR_GUIDE.md:41-48; backend/drizzle/CHECKSUMS.sha256 @ 2326aa6. Test result NOT RUN here |
| Row-level security is default deny: migration 0006 enables RLS; the API uses a server-side database connection, not the Data API | SOURCE VERIFIED (file name 0006_row_level_security.sql); policy text not re-read |
| Data API exposure: do not add `public` tables to the exposed schema, add grants for `anon`/`authenticated`, or turn on exposure of new tables casually; any future gameplay table (0011) must ship with RLS enabled and no policy for `anon`/`authenticated` | Rule for owner/engineer; the live Data API setting is OWNER-PROVIDER GATED / UNKNOWN |
| Signup hook cap: `account_capacity` 1,000 total, 50 new per hour, enforced in SQL; refusal returns `registration_closed` (403) | LOCAL TEST CONFIRMED per E-63 narrative; live denial through a real provider sign-up NOT RUN (waits on X-05/X-07b) |
| No automatic backups or point-in-time recovery on Free | SOURCE VERIFIED (plan page read 13 Oct, FREE_HOSTING_READINESS.md:46); public copy says the same (privacy P22) |

Storage growth model (planning only, from FREE_HOSTING_READINESS.md @ 2326aa6): for 1,000 players at one hour a day, sessions ~2.8 MB/day capped near 100 MB by the weekly purge, security log ~1.2 MB/day uncapped (~430 MB/year). Supabase's own `auth` schema and system overhead were not measured (same file). 0011 would add tables and is not part of these numbers.

### Storage tripwires (planning values only, owner may change)
| Level | Of 500 MB | Action |
|---|---|---|
| 60% | 300 MB | Owner reviews growth per day; decide retention for `security_audit_events` (open item X-25) |
| 75% | 375 MB | Freeze: no new testers, no 0011, no wider rollout; run the largest-tables query; INCIDENT_48H_PROTOCOL.md rollback trigger |
| 85% | 425 MB | Lower `max_accounts` (owner SQL, one update) so existing players keep working while new sign-ups are refused; decide upgrade vs data reduction |
These are not provider thresholds. The existing readiness doc alarms at 70% (FREE_HOSTING_READINESS.md:170); reconcile to one set before launch (owner decision).

## 3. Support mailbox and deletion backlog
- Contact is info@movenrun.xyz; public copy promises no fixed response or deletion time (privacy P24, support:26-27 @ 61d30bb). Do not add an SLA anywhere.
- Mailbox actually receiving mail: OWNER-PROVIDER GATED (X-22 open in EXTERNAL_ACTIONS.md).
- Manual email deletion requests are handled by hand: keep a private log of date received and date completed (no email addresses in shared docs). Backlog review: weekly, and daily during the 48 h window.
- In-app deletion is immediate in the database; provider removal may be `pending` and retried (accountDeletion.ts:98-101; router.ts:373 @ 2326aa6). The web page shows success whenever the request is accepted and ignores `signInRecord` (account-deletion-page.js:37 @ 61d30bb).

## 4. Owner check queries (read-only, run in Supabase SQL editor, aggregates only)
```
select pg_size_pretty(pg_database_size('postgres'));
select count(*) from pending_auth_user_deletions;
select count(*) from pending_auth_user_deletions where requested_at < now() - interval '1 day';
select count(*) from users;
select max_accounts from account_capacity;
```
Column `requested_at` confirmed in backend/src/db/identity.schema.ts:327-332 @ 2326aa6. Queries NOT RUN.

## 5. Rollback references
| Target | Reference | Class |
|---|---|---|
| Render API | live `dep-db9m51qjnfac73cqh6eg` (2192de6); rollback target `dep-db9gqfrbc2fs73do581g` (7f4c0d4, the X-24 deploy) | REVIEWER REPORTED (E-62, project record). Rolling back to 7f4c0d4 is expected to be code-only (0010 stays applied; the older code does not use its table), but a rollback start with a newer applied migration was not tested here. Confirm both IDs in the Render dashboard before relying on them |
| Vercel website | production `dpl_ABCfgjsFiJ4DHtRnrLPCc8npLAuD` (61d30bb); rollback target `dpl_1pNg2cyGZ4MLWuqfsSHBtU9P1KBf` | REVIEWER REPORTED (E-79, X-21). Confirm in the Vercel dashboard before relying on them |
Rule: rollbacks are owner actions in the provider dashboards; do not delete a deployment that is a rollback target. A database migration is not undone by a Render rollback.

## Integration digest
- Affected paths: this file only (docs/parallel/play-assurance/). Evidence SHAs: 2326aa6, 15f7f87, 61d30bb. No conflict with #125/#127/#128/#129.
- Findings to carry: migrations run on every start via startCommand; stuck provider deletions have no cap, alert or log.
- Next decisions (owner): (1) one storage-tripwire set (60/75/85 vs 70); (2) whether to add the stuck-deletion aggregate log line (engineer patch); (3) which Render/Vercel rollback IDs are current.
