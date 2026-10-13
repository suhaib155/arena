# No-cost setup: Supabase Free (Auth + PostgreSQL) and Render Free

This is the v1 hosting path (DECISIONS D-16, D-23). It costs nothing. Supabase
project **`movenrun`**, ref **`tavxmwuwkeynbnzfwove`** (us-east-1) provides
sign-in (Google and wallet) and the PostgreSQL database. The Express API on
Render keeps all game data and issues the app's own sessions. **Do not touch
the owner's other Supabase project, and do not create another one.**

Every step below is a dashboard action for the owner. Never paste a password,
client secret or secret key into chat or the repository. Steps marked
**APPROVAL** change a live service; they are listed so the owner can approve
and run them.

Proven locally (EVIDENCE E-17, E-18, E-20–E-24): the API, migrations and tests
over verified TLS as a non-superuser owner with row level security on every
table; Google and wallet sign-in, the cap, the hook SQL and deletion against a
stand-in for Supabase Auth.

## 1. Database (Supabase → project `movenrun`)

1. Project Settings → Database → **SSL Configuration**: turn on *Enforce SSL on
   incoming connections* and **Download certificate** (`prod-ca-2021.crt`).
2. Project Settings → **Data API**: turn it off, or remove `public` from
   *Exposed schemas*. Migration `0006` already blocks it (RLS with no policies);
   this is the second lock.
3. Connect → **Session pooler** string (IPv4; Render has no IPv6 egress):
   `postgresql://postgres.tavxmwuwkeynbnzfwove:<password>@aws-0-us-east-1.pooler.supabase.com:5432/postgres`.
   Not the transaction pooler (6543) for migrations.
4. Database password: generate a long random one in the dashboard.

Free plan: pauses after about a week without traffic (restore in the
dashboard), 500 MB database, 50,000 monthly active auth users, **no database
backups**. The privacy policy says so; if backups are ever turned on, update
`website/privacy/` and `website/account-deletion/`.

## 2. Sign-in providers (Supabase → Authentication)

**2a. Google** (APPROVAL: enabling a provider)

1. Google Cloud Console (any project you own) → APIs & Services → **OAuth
   consent screen**: External, app name MovenRun, support email
   `info@movenrun.xyz`, scopes **openid, email, profile only**, authorised
   domain `movenrun.xyz` and `supabase.co`. Publish to production (basic scopes
   need no verification review).
2. Credentials → Create OAuth client ID → **Web application**. Authorised
   redirect URI: `https://tavxmwuwkeynbnzfwove.supabase.co/auth/v1/callback`.
3. Supabase → Authentication → Sign In / Providers → **Google**: enable, paste
   the client ID and client secret **here only**. Leave "Skip nonce check" off.

**2b. Wallet** (APPROVAL: enabling a provider)

Authentication → Sign In / Providers → **Web3 Wallet → Ethereum**: enable.

**2c. URL configuration**

Authentication → URL Configuration:

| Field | Value |
|---|---|
| Site URL | `https://movenrun.xyz` |
| Redirect URLs | `movenrun://auth/callback` · `https://movenrun.xyz/sign-in/` · `https://movenrun.xyz/account-deletion/` |

The wallet message's URI (`https://movenrun.xyz/sign-in/`) must be on this
list or Supabase refuses wallet sign-in.

**2d. Settings that must stay this way**

- Authentication → Sign In / Providers → **Email: disable** (no email sign-up,
  no magic links). **Anonymous sign-ins: off.** **Manual linking: off** (D-17).
- Authentication → Rate Limits → **Web3 sign-ins**: raise from 30 to about 300
  per 5 minutes. Every wallet sign-in reaches Supabase from the API's single
  address, so the per-IP limit is shared by all players.

## 3. Database changes (APPROVAL: applying migrations to the live database)

Migrations `0000`–`0008` are applied by the API's start command
(`drizzle-kit migrate`, idempotent). They create the game tables,
`account_capacity` (max 1,000), the wallet sign-in tables and the function
`public.movenrun_before_user_created`. Nothing runs until the owner deploys.

After the first deploy, Authentication → **Hooks → Before User Created**:
choose *Postgres function* → schema `public` → `movenrun_before_user_created`.
The migration already grants it to `supabase_auth_admin` only.

Check in the SQL editor (read only):

```sql
select max_accounts from account_capacity;                    -- 1000
select count(*) from users;                                    -- admitted players
select public.movenrun_before_user_created('{}'::jsonb);      -- {} while open
```

To change the cap later: `update account_capacity set max_accounts = <n>;`
(owner decision, D-20).

## 4. API (Render → New → Blueprint, or Web Service)

`render.yaml` at the repository root describes the free service. Manual setup:

| Setting | Value |
|---|---|
| Name | `movenrun-staging-api` |
| Branch | `release/android-v1-cxfdbd` (switch to `main` after merge) |
| Root directory | `movenrun` |
| Instance type | **Free** |
| Region | Virginia (next to us-east-1) |
| Build | `corepack enable && yarn install --immutable && yarn workspace @movenrun/backend build` |
| Start | `yarn workspace @movenrun/backend db:migrate && yarn workspace @movenrun/backend start` |
| Health check | `/ready` |
| Auto-deploy | Off |

**Secret file**: `supabase-ca.crt` with the downloaded certificate
(appears at `/etc/secrets/supabase-ca.crt`).

**Environment** (values in the dashboard only):

| Key | Value |
|---|---|
| `NODE_VERSION` | `22` |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | session pooler string + `?sslmode=verify-full&sslrootcert=/etc/secrets/supabase-ca.crt` |
| `IDENTITY_SESSION_PEPPER` | random, 32+ bytes (Render "Generate") |
| `SUPABASE_URL` | `https://tavxmwuwkeynbnzfwove.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | Project Settings → API Keys → publishable key (`sb_publishable_…`) |
| `SUPABASE_SECRET_KEY` | Project Settings → API Keys → a secret key (`sb_secret_…`). Server only; used only to delete auth users (account deletion and the cap) |
| `IDENTITY_AUTH_DOMAIN` | `movenrun.xyz` |
| `CORS_ORIGINS` | `https://movenrun.xyz` |
| `TRUST_PROXY_HOPS` | `1` |

Not needed any more: `IDENTITY_OTP_PEPPER`, `RESEND_API_KEY`,
`IDENTITY_EMAIL_FROM`, `IDENTITY_REVIEW_EMAIL`, `IDENTITY_REVIEW_CODE`.

Check: `https://<service>.onrender.com/health` → `{"status":"ok"}`;
`/ready` → `{"status":"ready","database":"ready","signIn":"supabase"}`.

## 5. App and website

- EAS → Environment variables (**preview** and **production**):
  `EXPO_PUBLIC_API_URL=https://<service>.onrender.com`,
  `EXPO_PUBLIC_SUPABASE_URL=https://tavxmwuwkeynbnzfwove.supabase.co`,
  `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>` (never the secret key;
  the app refuses `sb_secret_` keys).
- Website: point `movenrun.xyz` at the Vercel project for `movenrun/website`
  (X-21). Replace `{{API_BASE_URL}}` (deletion and sign-in pages) and
  `{{SUPABASE_PUBLISHABLE_KEY}}` (deletion page), then
  `node scripts/check-launch-placeholders.mjs` must pass.

## Limits of the free path

A free Render instance sleeps after 15 idle minutes and takes up to about a
minute to wake; the first sign-in after a quiet period is slow, and a session
save can time out once (the app keeps it pending and retries). Acceptable for
internal and closed testing. An always-on instance is a paid plan and needs
owner approval.
