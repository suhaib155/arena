# No-cost staging: Supabase PostgreSQL + Render free web service

This is the default staging path while X-03 is open. It costs nothing. The API
runs unchanged; Supabase is used only as a plain PostgreSQL server (no Supabase
SDK, auth or storage), so the app never talks to Supabase directly.

Proven locally (EVIDENCE E-17, E-18): the full backend suite, the migration
command and the built API run over **verified TLS** (`sslmode=verify-full` with a
private CA, the same shape as Supabase), as a **non-superuser table owner**, with
**row level security on every table**; a REST-style role with full grants reads
0 rows and cannot insert.

## 1. Supabase (project "MovenRun", Free plan)

1. Project Settings → Database → **SSL Configuration**: turn on *Enforce SSL on
   incoming connections* and **Download certificate** (`prod-ca-2021.crt`).
2. Project Settings → **Data API**: turn the Data API off (or remove `public`
   from *Exposed schemas*). Migration `0006_row_level_security` already blocks
   it; this is the second lock.
3. Connect → **Session pooler** connection string (IPv4; Render has no IPv6
   egress, so do not use the direct `db.<ref>.supabase.co` host). It looks like
   `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`.
   Do not use the transaction pooler (port 6543) for migrations.
4. Database password: generate a long random one in the dashboard. Never paste
   it in chat or the repository.

Free plan limits to know: the project pauses after about a week without
traffic (restore from the dashboard), 500 MB database, daily backups are not
included on Free. Set `{{BACKUP_RETENTION_DAYS}}` on the website accordingly
(for example "0 (no provider backups on the free plan)") or upgrade later with
approval.

## 2. Render web service (Free instance)

Create → Web Service → repository `suhaib155/arena`:

| Setting | Value |
|---|---|
| Name | `movenrun-staging-api` |
| Branch | `release/android-v1-cxfdbd` |
| Root directory | `movenrun` |
| Runtime | Node |
| Instance type | **Free** |
| Build command | `corepack enable && yarn install --immutable && yarn workspace @movenrun/backend build` |
| Start command | `yarn workspace @movenrun/backend db:migrate && yarn workspace @movenrun/backend start` |
| Health check path | `/ready` |
| Auto-deploy | Off |

Migrations run in the start command because pre-deploy commands need a paid
instance. The migration command is idempotent (the runtime test runs it twice).

**Secret file** (Environment → Secret Files): name `supabase-ca.crt`, contents
of the downloaded certificate. It appears at `/etc/secrets/supabase-ca.crt`.

**Environment variables:**

| Key | Value |
|---|---|
| `NODE_VERSION` | `22` |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | session pooler string + `?sslmode=verify-full&sslrootcert=/etc/secrets/supabase-ca.crt` |
| `IDENTITY_SESSION_PEPPER` | random, 32+ bytes (Render "Generate") |
| `IDENTITY_OTP_PEPPER` | a different random value |
| `CORS_ORIGINS` | website origin, e.g. `https://movenrun-website.vercel.app` |
| `RESEND_API_KEY` | from Resend (X-06) |
| `IDENTITY_EMAIL_FROM` | address on the Resend-verified domain |
| `TRUST_PROXY_HOPS` | `1` |
| `IDENTITY_REVIEW_EMAIL`, `IDENTITY_REVIEW_CODE` | X-07 |

Check: open `https://<service>.onrender.com/health` and `/ready` (both 200).

## 3. Point the app and website at it

- EAS → Environment variables → **preview**: `EXPO_PUBLIC_API_URL=https://<service>.onrender.com`.
- Website: replace `{{API_BASE_URL}}` and `{{HOSTING_PROVIDER}}` ("Render (web
  service) and Supabase (PostgreSQL)"), then run
  `node scripts/check-launch-placeholders.mjs`.

## Limits of the free path (why production may need approval)

A Render free instance sleeps after 15 minutes idle and takes up to about a
minute to wake. The first sign-in after a quiet period is slow, and a session
save can time out once (the app keeps it pending and retries, so nothing is
lost). That is acceptable for internal and closed testing. For production, an
always-on instance (Render Starter or similar) is recommended; that is a paid
plan and needs owner approval (X-03).
