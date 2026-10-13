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

**Order matters.** Do §1, then §4 (the API's first start applies the
migrations), then attach the hook in §3, and only then enable the providers
in §2. A provider switched on before the hook is attached can create sign-in
users that neither the account cap nor the hourly quota has checked. The
Google OAuth client (§2a steps 1–2) can be prepared at any time; only the
"enable" switches wait.

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
- Authentication → Rate Limits → **Web3 sign-ins**: **leave at the default
  (30 per 5 minutes per IP) for internal and closed testing.** Every wallet
  sign-in the API makes reaches Supabase from the API's address, so this limit
  is shared by all players: about 6 wallet sign-ins a minute in total, which
  is plenty for testing. The same limit also slows anyone calling Supabase
  directly with the public key. Raise it only after measuring real traffic on
  the hosted API, and only as far as needed (60 doubles it). When it is hit,
  players see "Too many attempts. Please wait a moment and try again."
  (AUTH_SECURITY_REVIEW.md, F-05)
- **CAPTCHA: off.** Supabase's hCaptcha/Turnstile option would need a widget in
  the wallet's browser and in the app's sign-in; it is not wired, so turning it
  on would break sign-in. The hourly new-account quota (§3) is the abuse
  control instead.

## 3. Database changes (APPROVAL: applying migrations to the live database)

Migrations `0000`–`0009` are applied by the API's start command
(`drizzle-kit migrate`, idempotent). They create the game tables,
`account_capacity` (max 1,000 accounts, at most 50 new ones per rolling
hour), the wallet sign-in tables, `auth_user_creations` (one timestamp per new
sign-in user, nothing else) and the function
`public.movenrun_before_user_created`. Nothing runs until the owner deploys.

What the migrations touch: only tables in `public` that MovenRun creates, one
function, and grants on that function to `supabase_auth_admin`. They do not
read or change anything in the `auth` schema. The project is empty of
MovenRun tables today, so there is nothing to back up first; the rollback
before any player exists is to drop the MovenRun tables and the function
(owner decision, never automatic). Once players exist, the Free plan keeps
no backups, so a later destructive change needs a manual export first.

After the first deploy, Authentication → **Hooks → Before User Created**:
choose *Postgres function* → schema `public` → `movenrun_before_user_created`.
The migration already grants it to `supabase_auth_admin` only.

Check in the SQL editor. The first three are read only; the last calls the
hook inside a transaction that is rolled back, so it records nothing:

```sql
select max_accounts, max_new_per_hour from account_capacity;   -- 1000, 50
select count(*) from users;                                     -- admitted players
select count(*) from auth_user_creations
  where created_at > now() - interval '1 hour';                 -- new sign-in users this hour
begin; select public.movenrun_before_user_created('{}'::jsonb); rollback;  -- {} while open
```

Then confirm in Authentication → Hooks that **Before User Created** shows the
function as enabled. Only after that, enable the providers (§2).

The hook refuses a new sign-in user with 403 when the players reach the cap
and with 429 when 50 were already created in the last hour, however the
request reached Supabase. The API applies the same two checks to new players.
Unused sign-in users (abandoned Google sign-ins, wallet grants made directly
against Supabase) are removed by the API after an hour (F-03).

To change the cap or the quota later (owner decision, D-20):
`update account_capacity set max_accounts = <n>, max_new_per_hour = <m>;`

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
save can time out once (the app keeps it pending and retries). The app and the
website send a wake-up request as soon as sign-in is shown and wait up to 90
seconds for a sign-in answer before showing a retry message (E-28). Acceptable for
internal and closed testing. An always-on instance is a paid plan and needs
owner approval.
