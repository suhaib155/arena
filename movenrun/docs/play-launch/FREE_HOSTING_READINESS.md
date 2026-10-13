# Free hosting readiness (Render Free + Supabase Free)

**Owner decision, 13 Oct 2026 (D-29):** the API runs on **Render Free**, and
sign-in and PostgreSQL use the existing **Supabase Free** project `movenrun`
(ref `tavxmwuwkeynbnzfwove`, us-east-1). The budget is zero recurring spend,
with at most 1,000 registered accounts.

**Nothing here has been deployed.** This file covers what was prepared and
checked, and what stays a limit of the free plans.

## Deployable source

| | |
|---|---|
| Deploy branch | `deploy/render-free-staging` (named in `render.yaml`; moves only when the owner approves a new commit) |
| Approved-for-review commit | **`dd8306588667342fab2db0ebd4d55632acadb57a`** |
| Contains | Every commit of `release/android-v1-cxfdbd` (991ac6a), `fix/play-auth-security-gate` (b4612bb) and the earlier tip of this work (ea5d58a) |
| How that was checked | `git merge-base --is-ancestor` for each branch, and `git log` both ways. History is linear: no other branch has commits newer than 11 Sep 2026 that this one lacks. Nothing was rewritten or force-pushed |
| Includes | Cold-start handling (1f69dfc), email codes unwired (728165e), security fixes (688d8b3, e79a1e2, cae5f88, 41b78a8), wake-safe clean-up (dd83065), migrations 0000–0009 with pinned checksums |
| Not merged | `main` is untouched. Merging (X-14) is the owner's decision |

`render.yaml` previously named `release/android-v1-cxfdbd`, which predates
every security fix. It now names the deploy branch, and
`backend/src/api/renderBlueprint.test.ts` fails if any of these change:
- the branch, or automatic deploys being off;
- the free plan, a single instance, or the Virginia region;
- an added Render database;
- the build and start commands, or the health check;
- secrets that must stay out of the file.

## Official plan limits (read 13 Oct 2026; re-check before deploying)

**Render Free web service** (render.com/docs/free):
- Spins down after 15 minutes with no inbound traffic and takes about a minute to wake.
- 750 free instance hours per workspace each month. Above that, free services are suspended until the next month.
- Outbound bandwidth and build minutes have monthly allowances shown in the dashboard.
  - **With no payment method on file**, going over bandwidth suspends free services for the rest of the month instead of billing.
  - Going over build minutes stops new builds instead of billing.
- The filesystem is ephemeral, and Render "might restart a Free web service at any time".
- One instance only, no shell, no one-off jobs. Background workers and cron jobs are not free service types.
- Render says: "Do not use them for production applications."

**Supabase Free** (supabase.com/pricing):
- 500 MB database, 50,000 monthly active users, 5 GB egress and 1 GB file storage.
- The project pauses after 1 week of inactivity.
- **No automatic backups or point-in-time recovery.**
- At most 2 active free projects.
- The page does not say what happens to a Free project that exceeds its limits. It names no charge, and the spend cap it describes is for Pro.

**What this means for the promise to players:** this setup is fit for
staging, internal testing and a controlled closed test. It is not an
uninterrupted public service:
- The first request after a quiet spell waits about a minute.
- A restart can happen at any time.
- 1,000 *registered* accounts is the cap. That is not 1,000 people using it at the same moment.

## Background work on a sleeping host

| Job | Was | Now | Safe if it never runs? |
|---|---|---|---|
| Retry of provider-user deletions (after an account is erased while Supabase was unreachable) and release of uncollected wallet codes | Every 5 min by `setInterval`, only while awake | When due: 5 s after each start (every wake), after any request, once a minute while awake (`api/maintenance.ts`) | The MovenRun account is already erased, and its tokens are dead. Only the Supabase sign-in record lingers until the next wake. That is a privacy delay, not an access risk |
| Orphan sweep of unused Supabase sign-in users | Every 30 min by `setInterval`; first run 60 s after start | When due, as above; same safety rules (re-read before delete, 100 per run, one run at a time) | Yes. Orphans count toward Supabase's 50,000 monthly users and the hour's quota, but **not** toward the 1,000 cap, which counts MovenRun players |
| 1,000 cap and 50/hour quota | PostgreSQL (hook and admission transaction) | Unchanged | Not a timer. Enforced on every new user, awake or asleep |
| Code and nonce expiry | Checked when used | Unchanged | Not a timer |
| Session revocation | Checked in the database on every request | Unchanged | Not a timer |
| Hook's `auth_user_creations` pruning | Inside the hook | Unchanged | Not a timer |
| Rate limits | In process memory | Unchanged; reset on restart or wake | Partly. A restart forgets counts. The database quota and Supabase's own per-IP limits still apply |

Nothing pings the service to keep it awake, and nothing should (owner rule
and Render's terms). The clean-up logs only fixed lines with counts
("Maintenance: … handled N" or "… failed; will retry when next due"), never
ids, emails, tokens or errors.

## Database connection and TLS

- **Session pooler, port 5432, IPv4.** Render Free has no IPv6 egress.
- **`sslmode=verify-full&sslrootcert=/etc/secrets/supabase-ca.crt`.**
- Rehearsed here with a private CA on PostgreSQL 16 (E-36):
  - the exact Blueprint start command migrated a fresh database and served `/health` and `/ready` within 3 s;
  - the same URL without the CA was refused ("self-signed certificate");
  - the log held no key or connection string.
- **Pool limits.** The API holds at most 10 connections. Timeouts are 5 s to connect and 10 s per query. A client must send its request within 30 s.

## Spend protection

1. **Render:**
   - Workspace plan "Hobby" (free) and service instance type "Free".
   - **Do not add a payment method.** Without one, overages suspend the service instead of billing.
   - If Render insists on a card to create the service, stop and ask the owner: that is a separate approval.
2. **Supabase:**
   - Organization plan "Free".
   - Watch Usage (database size, egress, monthly users) weekly during testing.
   - No add-ons (compute, PITR, custom domain).
3. **Vercel** (website): Hobby plan; no card.
4. **Google Cloud** (OAuth client, Maps key):
   - The OAuth consent screen and client cost nothing.
   - The Maps SDK for Android has its own free usage. If a billing account is required for Maps, that is an owner decision (X-08). Set a budget alert at US$1 and restrict the key.
5. **Expo:** free plan's build quota (X-04). No paid build credits.

## Backups

The Free plan keeps none. Use the owner-run, encrypted `pg_dump` in
`LIVE_SETUP_OPERATOR_GUIDE.md` §Backup:
- weekly once players exist;
- before any destructive change.

Dumps contain account ids, Google emails and wallet addresses. Never put them
in Git, chat or a shared folder.

## Load-test plan (not run against any live provider without approval)

**Goal:** confirm the pilot fits the free plans, not prove production scale.

| Check | How | Pass |
|---|---|---|
| Cold start | After 20 idle minutes, time `GET /health`, then a sign-in | First answer within about 60 s; the app's 90 s limit is not hit |
| Pilot traffic | `autocannon` (or `k6`) from one laptop: 5 virtual users, 2 min, mix of `/health`, `/identity/me`, `POST /movement/verify` with a test account | p95 under 1 s once warm; no 5xx; global limit (300/min/IP) not hit by one user's normal use |
| Sign-up bursts | Already proven locally: 50/hour quota, 20 concurrent hook calls, cap race. Hosted: X-07b (quota 0, one refused sign-up) only | Refusals are 403/429, never a created account |
| Rate limit | 25 rapid `POST /identity/auth/...` from one IP | 429 after 20 per minute |
| Database size | After the closed test: `select pg_size_pretty(pg_database_size('postgres'));` and the largest tables | Well under 500 MB (estimate: 1,000 accounts × 100 sessions × ~2 KB ≈ 200 MB worst case, inferred, not measured) |
| Egress and bandwidth | Supabase Usage and Render Metrics after a week | Under 50 % of the monthly allowance |
| Fail closed | During a test, set `max_accounts` to the current count and try a new sign-up | Refused; existing players still sign in |

Run the hosted rows only after X-06 → X-21 and with the owner's approval.
Use test accounts, never real players.
