# Live setup operator guide (X-06 → X-07 → X-05 → X-21 → X-08 / X-04)

**For:** the owner, at the dashboards. **Nothing here has been run.** Each gate
changes a live service and needs your explicit go. Do them in this order and
stop at the first failed check. Step-by-step dashboard detail is in
`HOSTING_SUPABASE_FREE.md`; this guide adds what to check before, the proof
that each gate worked, and what to do if it did not.

Rules for every gate:
- Supabase project **`movenrun`, ref `tavxmwuwkeynbnzfwove`** only. Never the other project.
- Free plans only. If a dashboard asks for a card or an upgrade, stop.
- Secrets go into the dashboard field named, never into chat, a file or the repository.
- Paste SQL into Supabase → SQL editor. Lines marked *read only* change nothing.

## Migrations

Applied by the API's start command at X-06 (`drizzle-kit migrate`). drizzle
runs every pending migration inside **one transaction**: if any statement
fails, none of them is applied. It records each file's SHA-256 in
`drizzle.__drizzle_migrations`, the same value pinned in
`backend/drizzle/CHECKSUMS.sha256` (checked locally: a fresh database's
recorded hashes equal the pinned list, E-32).

| File | SHA-256 (first 12) | What it does | Destructive? |
|---|---|---|---|
| 0000_loose_chat | `54edf115d912` | Legacy territory tables (`zones`, `routes`, `battles`, …), unused by v1 | No (create only) |
| 0001_identity_wallet_foundation | `3a1460b114b6` | `users`, `auth_identities`, `auth_sessions`, audit events, legacy email/wallet-link tables | No |
| 0002_provider_events | `e65dcb41259f` | `provider_events` | No |
| 0003_movement_verifications | `94c77a330e25` | `movement_verifications` | No |
| 0004_session_provenance | `f708e76e79fa` | Five nullable columns on `movement_verifications` | No |
| 0005_seal_summary | `daaee047a3ac` | Three nullable columns on `movement_verifications` | No |
| 0006_row_level_security | `d35e1a5c6441` | Row level security on every table, no policies | No |
| 0007_supabase_auth_admission | `f2ff43315efb` | `account_capacity` (1,000), wallet challenges, pending deletions, the hook function, grant to `supabase_auth_admin` | No |
| 0008_wallet_sign_in_handoff | `4df1233eb9fe` | `wallet_sign_in_handoffs` | No |
| 0009_new_account_quota | `02c0b1648cab` | `max_new_per_hour` (50), `auth_user_creations`, index on `users.created_at`, the hook with the quota | No |

None of them drops, deletes, truncates or touches the `auth` schema. Full
hashes: `backend/drizzle/CHECKSUMS.sha256`.

**Rollback and rescue.**
- *The deploy fails while migrating:* the transaction rolls back and the API
  does not start. Read the Render log, fix, redeploy. Nothing to undo.
- *Before any player exists* (the state at X-06): to remove MovenRun from
  the database entirely, run the drop script below. It is your decision,
  never automatic, and it leaves Supabase Auth alone.
- *After players exist:* never drop. Take an export first (next section),
  then fix forward with a **new** migration. Editing a committed migration
  is blocked by `migrationChecksums.test.ts` (D-27).

Drop script, before players only (APPROVAL):

```sql
-- Detach the hook first: Authentication → Hooks → Before User Created → disable.
begin;
drop function if exists public.movenrun_before_user_created(jsonb);
drop table if exists auth_user_creations, wallet_sign_in_handoffs, pending_auth_user_deletions,
  wallet_sign_in_challenges, account_capacity, movement_verifications, provider_events,
  security_audit_events, wallet_link_challenges, wallets, email_otp_challenges,
  auth_sessions, auth_identities, users, zones, routes, battles, hex_activities,
  user_route_hexes cascade;
drop schema if exists drizzle cascade;
commit;
```

## Backup and export (Free plan has no automatic backups)

Run from your own computer with PostgreSQL 16 client tools, over the
**session pooler** with verified TLS (`prod-ca-2021.crt` from §1). The
password is typed at the prompt, never put in the command.

```bash
export PGSSLMODE=verify-full PGSSLROOTCERT=./prod-ca-2021.crt
pg_dump "host=aws-0-us-east-1.pooler.supabase.com port=5432 dbname=postgres user=postgres.tavxmwuwkeynbnzfwove" \
  --schema=public --schema=drizzle --no-owner --format=custom \
  --file="movenrun-$(date +%F).dump"
pg_restore --list "movenrun-$(date +%F).dump" | head   # proves the file is readable
```

- Before any later destructive change, and weekly once players exist.
- The file holds account ids, Google emails and wallet addresses: keep it on
  an encrypted disk, never in the repository or a shared folder, and delete
  old copies. An erased account stays erased: do not restore a dump over live
  data without first removing rows for accounts deleted since the dump.
- **Keep privileges in the dump** (no `--no-privileges`). The restore drill
  (E-37) showed that a dump without them restores the sign-up hook callable
  by everyone, including `anon`, because a new function is executable by
  PUBLIC by default.
- **Restore** is for rescue only and needs your approval. Restore into an
  **empty** database, never over live data, and never with `--clean` as a
  shortcut: `pg_restore --no-owner -d "<connection to the empty database>" movenrun-YYYY-MM-DD.dump`.
  The one error "schema public already exists" is expected.
- **After every restore**, run this and check the result. It must print `f`, then `t`:

```sql
revoke all on function public.movenrun_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.movenrun_before_user_created(jsonb) to supabase_auth_admin;
select has_function_privilege('anon', 'public.movenrun_before_user_created(jsonb)', 'execute');                 -- f
select has_function_privilege('supabase_auth_admin', 'public.movenrun_before_user_created(jsonb)', 'execute');  -- t
```

  Then run the X-06 RLS and migration-hash checks.

## Gate X-06: database and API (APPROVAL: applying migrations)

**Before.** Read only:

```sql
select count(*) from pg_tables where schemaname = 'public';      -- expect 0 (no MovenRun tables yet)
select to_regprocedure('public.movenrun_before_user_created(jsonb)');  -- expect null
select to_regclass('drizzle.__drizzle_migrations');              -- expect null (no migration has ever run)
```

If either is not empty, stop: someone has already used this project.

**Source to deploy.** Branch `deploy/render-free-staging` at
**`dd8306588667342fab2db0ebd4d55632acadb57a`** (contents checked in
`FREE_HOSTING_READINESS.md`). Before deploying, confirm on GitHub that the
branch still shows this commit. If it shows anything else, stop and ask.

**Do, click by click.** No value below is a secret except where it says *dashboard only*.

*Supabase* (project `movenrun`):
1. Project Settings → Database → SSL Configuration → **Enforce SSL on incoming connections** on, then **Download certificate**. Keep `prod-ca-2021.crt`.
2. Project Settings → Data API → turn it off, or remove `public` from Exposed schemas.
3. Project Settings → Database → **Reset database password**, using a long generated one. *Dashboard and password manager only.*
4. Connect → **Session pooler** → copy the URI. Host `aws-0-us-east-1.pooler.supabase.com`, port `5432`, user `postgres.tavxmwuwkeynbnzfwove`.
5. Project Settings → API Keys → note the **publishable** key and create or copy a **secret** key. *Secret key: Render only.*

*Render* (workspace on the free Hobby plan, **no payment method**):
1. New → **Blueprint** → connect `suhaib155/arena`.
   - Blueprint file `render.yaml`, from branch `deploy/render-free-staging`.
   - Render shows one service, `movenrun-staging-api`, plan **Free**, region Virginia. If it shows a paid plan or a database, stop.
2. Fill the prompted values:
   - `DATABASE_URL`: the pooler URI + `?sslmode=verify-full&sslrootcert=/etc/secrets/supabase-ca.crt`. *Dashboard only.*
   - `SUPABASE_PUBLISHABLE_KEY`: `sb_publishable_…`
   - `SUPABASE_SECRET_KEY`: `sb_secret_…`. *Dashboard only.*
   - Everything else is already set by the Blueprint. `IDENTITY_SESSION_PEPPER` is generated by Render.
3. Service → Environment → **Secret Files** → add `supabase-ca.crt` with the certificate's contents.
4. **Manual Deploy → Deploy latest commit.** Check that the deploy shows commit `dd83065`.

**Bring back (redacted; never keys, passwords or the certificate):**
- the service URL (`https://….onrender.com`);
- the deploy id and the commit Render shows (must be `dd83065`);
- a screenshot of the instance type (**Free**) and of Billing showing no payment method;
- the outputs of the proof commands below.

With those, the next session records X-06 as complete and verified.

**Proof.**

```bash
curl -s https://<service>.onrender.com/health   # {"status":"ok"}
curl -s https://<service>.onrender.com/ready    # {"status":"ready","database":"ready","signIn":"supabase"}
```

```sql
-- read only: every migration applied, with the pinned content
select hash from drizzle.__drizzle_migrations order by created_at;
-- compare with: cut -c1-64 backend/drizzle/CHECKSUMS.sha256  (10 lines, identical)

-- read only: row level security on every MovenRun table
select relname, relrowsecurity from pg_class
 where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1;  -- all true (19 tables)

-- read only: no policy opens any table
select count(*) from pg_policies where schemaname = 'public';               -- 0

-- read only: the API's connection uses TLS
select ssl, version from pg_stat_ssl where pid = pg_backend_pid();         -- t, TLSv1.3 (or 1.2)
```

**Data API off.** From any computer, with the publishable key:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://tavxmwuwkeynbnzfwove.supabase.co/rest/v1/users?select=id" \
  -H "apikey: <publishable key>"
```

Any answer except `200` is acceptable; `200` with rows is a stop (turn the
Data API off in Project Settings → Data API). Even with it on, RLS with no
policies returns no rows.

**If it fails:** `/ready` 503 means the API cannot reach the database or a
table is missing: read the Render log (it prints no secrets). Fix and redeploy;
the migrations do not run twice.

## Gate X-07: attach the hook

**Before.** Read only:

```sql
select has_function_privilege('supabase_auth_admin', 'public.movenrun_before_user_created(jsonb)', 'execute'); -- t
select has_function_privilege('anon', 'public.movenrun_before_user_created(jsonb)', 'execute');                -- f
select has_function_privilege('authenticated', 'public.movenrun_before_user_created(jsonb)', 'execute');       -- f
select has_schema_privilege('supabase_auth_admin', 'public', 'usage');                                          -- t
select max_accounts, max_new_per_hour from account_capacity;                                                    -- 1000, 50
begin; select public.movenrun_before_user_created('{}'::jsonb); rollback;                                       -- {}
```

If the schema check is `f` (F-16), run this one grant (APPROVAL; it is what
Supabase's hook guide prescribes and gives no table access):
`grant usage on schema public to supabase_auth_admin;`

**Do.** Authentication → Hooks → **Before User Created** → Postgres →
`public` → `movenrun_before_user_created` → enable.

**Proof.** The hook page shows it enabled. The invocation proof needs a
provider, so it is done at the end of X-05 (step X-07b).

## Gate X-05: providers (APPROVAL: enabling providers)

**Before.** X-06 and X-07 proofs passed. Not before.

**Do.** `HOSTING_SUPABASE_FREE.md` §2: Google client, Google provider, Web3
→ Ethereum, Redirect URLs exactly as listed, Email off, anonymous off,
manual linking off, Web3 rate limit left at 30, CAPTCHA off.

**Proof, read only in the dashboard:** Authentication → Sign In / Providers
shows Google and Web3 on, Email and anonymous off; URL Configuration lists
exactly the three redirect URLs.

**X-07b: prove Supabase calls the hook.** About two minutes, right after
enabling:

1. SQL: `update account_capacity set max_new_per_hour = 0;`
2. On the website or app, try **Continue with Google** with a Google account
   that has never used MovenRun.
3. Expect the sign-in to be refused (the exact wording depends on where
   Supabase reports it), and Authentication → Users shows **no** new user.
4. SQL: `update account_capacity set max_new_per_hour = 50;` and check
   `select max_new_per_hour from account_capacity;` returns 50.
5. Try again: the account is created. `select count(*) from auth_user_creations;` is 1 or more.

If step 3 creates a user, the hook is not being called: disable both
providers again and re-check X-07 before going on.

**After an hour of use:** the clean-up works against the real admin API
when the Render log shows no "Maintenance: unused sign-in records failed"
line after a request. It runs when due on each wake and after requests, not
on a fixed clock (`FREE_HOSTING_READINESS.md`). Only counts are logged.

## Gate X-21: website at movenrun.xyz (APPROVAL: DNS)

**Do.** Vercel → project for `movenrun/website` → Domains → `movenrun.xyz`,
then the DNS records Vercel shows. Replace `{{API_BASE_URL}}` and
`{{SUPABASE_PUBLISHABLE_KEY}}`.

**Proof.**

```bash
node scripts/check-launch-placeholders.mjs              # passes
node scripts/check-secrets.mjs website                  # passes (no secret key on the site)
curl -sI https://movenrun.xyz/sign-in/ | grep -iE "x-frame-options|content-security-policy|strict-transport|referrer-policy"
for p in privacy support account-deletion sign-in; do curl -s -o /dev/null -w "$p %{http_code}\n" https://movenrun.xyz/$p/; done  # all 200
```

## Gates X-08 and X-04: build settings and the preview APK

**X-08.** Expo → Environment variables (preview and production):
`EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`,
`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (publishable only; the app refuses
`sb_secret_`), `GOOGLE_MAPS_ANDROID_API_KEY`. Maps key restricted to Android,
package `io.movenrun.app`, the EAS key's SHA-1.

**X-04 (APPROVAL: uses the free EAS build quota).** GitHub → Actions →
**EAS APK Build** on the reviewed branch. Exact steps, variable names and the
static APK checks: `X04_PREVIEW_BUILD_RUNBOOK.md`.

**Proof.** The workflow is green; the APK installs; then
`ANDROID_DEVICE_GATE_PLAN.md`. Optionally unpack the APK's
`assets/index.android.bundle` and run `node scripts/check-secrets.mjs <folder>`.

### Free EAS readiness (reviewed 17 Oct 2026, no build run)

**Config: ready, no change needed.**

| Item | State |
|---|---|
| `mobile/eas.json` `preview` | `buildType: apk`, `distribution: internal`, `environment: preview` (reads the X-08 variables from Expo's **preview** environment). An installable APK, no Play needed |
| `mobile/eas.json` `production` | `buildType: app-bundle`, `autoIncrement`, `environment: production`. Not for the device gate |
| Versions | `appVersionSource: remote`. On the first build EAS starts `versionCode` from the local value (1). Preview does not increment, which is fine for sideloading over the same APK |
| Project link | `app.json` `extra.eas.projectId` is set, so `eas init` has already been run under an Expo account |
| `.github/workflows/eas-apk-build.yml` | On `main`, so it shows in Actions; **Run workflow** lets you pick any branch, and that branch's copy of the file runs. Pinned `eas-cli@24.8.0`, `contents: read`, `EXPO_TOKEN` only on the steps that need it |
| Keystore | Nothing to make by hand. Checked in the `eas-cli@24.8.0` source: in `--non-interactive` mode, when the project has no Android keystore, EAS generates one and keeps it on Expo's servers. Never put a keystore in the repository |
| `.github/workflows/eas-production-aab.yml` | Not on `main` yet, so it cannot be started until it is merged (X-14, X-09) |

The APK workflow does not run the tests. Start it only on a commit whose
`mobile-checks` run (job "Mobile type-check": type-check, tests and Hermes
export) is green.

**Owner accounts and settings (all free):**

1. **Expo account** that owns the linked project: sign in at expo.dev and
   check the project with id `73abbcb8-…` is listed. If it is under another
   account, either sign in to that one or create a new project with `eas
   init` (that changes `projectId`, a one-line `app.json` change to review).
2. **`EXPO_TOKEN`**: expo.dev → Account settings → Access tokens → create a
   token (a robot user's token if you have one), and set it under GitHub →
   Settings → Secrets and variables → Actions. The README says one is set;
   check it has not been revoked or expired.
3. **X-08 variables** in Expo's **preview** environment (and production
   later). `EXPO_PUBLIC_*` values end up inside the app bundle, so give them
   Plain text or Sensitive visibility; Secret visibility protects nothing
   there. `GOOGLE_MAPS_ANDROID_API_KEY` as Sensitive.
4. **Maps key SHA-1 without spending a build:** `npx eas-cli@24.8.0
   credentials -p android` (signed in, from `movenrun/mobile`), pick the
   preview profile, let it set up a new keystore, and read its SHA-1. This
   uses no build quota. Add that SHA-1 to the Maps key restriction before the
   first build, so the first APK already shows tiles. The production profile
   uses the same default Android credentials unless you set others.
5. No payment method, no paid plan, no Google Play account needed for the
   preview APK.

**Quota.** The Free plan has a monthly build allowance and a low-priority
queue, so a build can wait. Expo's pricing page listed 30 builds a month (at
most 15 of them iOS) when last checked; check expo.dev/pricing and the
project's Usage page on the day. Assume every build that starts counts,
including one that fails. Plan for this month: one preview APK for the device
gate, one spare for a fix, then one production AAB after the merge. Do not
re-run the workflow to "try again" before reading why it failed.

## Free host: what not to add

The Render Free API sleeps after 15 idle minutes. The app and website already
wake it when sign-in is shown and wait up to 90 seconds before showing a
plain retry message (E-28). **Do not add an uptime pinger,
cron or keep-awake job**: it would hide the real behaviour and can breach
the free plan's terms. An always-on instance is a paid plan and your decision.
