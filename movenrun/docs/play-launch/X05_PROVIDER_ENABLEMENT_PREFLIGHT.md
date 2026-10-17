# X-05 provider enablement: preflight, checks and rollback (prepared 17 Oct 2026, NOT done)

X-05 is the owner's approval to switch on **Google** and **Web3 wallet**
sign-in in Supabase project `movenrun` (`tavxmwuwkeynbnzfwove`). Nothing here
is approved or done. This page gathers what `HOSTING_SUPABASE_FREE.md` §2,
`LIVE_SETUP_OPERATOR_GUIDE.md` gate X-05 / X-07b, `AUTH_SECURITY_REVIEW.md`
and `A10_GOOGLE_EXCHANGE_PLAN.md` already say, checked against the code in
`backend/src/identity`, and adds the checks and the rollback. Setting names
only: no value is written here, and none is pasted into chat or the
repository.

Anything this workspace could not see is marked **to confirm in the
dashboard**.

## Preconditions (stop if any is not true)

| # | Condition | State on 17 Oct | Source |
|---|---|---|---|
| P1 | X-27 live: #112 at `2192de6` on `deploy/render-free-staging`, migration `0010` applied | **Done**: E-62 (API), E-63 (SQL: 11 migrations, every `public` table with RLS, `google_sign_in_exchanges` RLS on with 0 rows) | `EVIDENCE_REGISTER.md` |
| P2 | Before User Created hook attached to `public.movenrun_before_user_created`; EXECUTE for `supabase_auth_admin` only; schema usage granted | **Done**: owner confirmation 16 Oct (E-45), grants re-read 17 Oct (E-63). Re-read the hook page right before X-05 | `LIVE_SETUP_OPERATOR_GUIDE.md` gate X-07 |
| P3 | `account_capacity` reads 1,000 accounts and 50 new per hour | **Done** (E-63). Re-run the read-only query below right before X-05 | `HOSTING_SUPABASE_FREE.md` §3 |
| P4 | Two-network client-address check on the live API | **Owed by the owner.** E-62 and E-63 ran from one network only | `X24_DEPLOY_CANDIDATE.md` step 3, `scripts/check-client-ip.mjs` |
| P5 | No auth users exist yet | 0 on 17 Oct (E-63) | — |
| P6 | API CORS allows exactly `https://movenrun.xyz`; `movenrun.xyz` is the primary domain, `www` redirects to it | **Done** (E-62, E-64) | — |
| P7 | A client that can complete a sign-in is available for the checks | **Open.** The reviewed website (with `/sign-in/` and `/account-deletion/`) is not published (X-21, E-64: apex `/privacy/` still 404), and the preview APK (X-04) comes after X-05. See "Which client runs the checks" | `EXTERNAL_ACTIONS.md` X-21, X-04 |

P4, the owner's step: run
`node scripts/check-client-ip.mjs https://movenrun-staging-api.onrender.com 12 --write`
from the usual network, then from a second one (a phone off Wi-Fi). Pass:
PASS for both limits on each run, and the second network's first `/health`
shows close to the full 300 while the first network's bucket is lower.

Read-only SQL right before X-05 (all from `LIVE_SETUP_OPERATOR_GUIDE.md`
gate X-07; the last line calls the hook inside a rolled-back transaction):

```sql
select has_function_privilege('supabase_auth_admin', 'public.movenrun_before_user_created(jsonb)', 'execute'); -- t
select has_function_privilege('anon', 'public.movenrun_before_user_created(jsonb)', 'execute');                -- f
select has_function_privilege('authenticated', 'public.movenrun_before_user_created(jsonb)', 'execute');       -- f
select has_schema_privilege('supabase_auth_admin', 'public', 'usage');                                          -- t
select max_accounts, max_new_per_hour from account_capacity;                                                    -- 1000, 50
select count(*) from users;                                                                                     -- 0
begin; select public.movenrun_before_user_created('{}'::jsonb); rollback;                                       -- {}
```

Dashboard, read only: Authentication → Hooks → **Before User Created** shows
`movenrun_before_user_created` as enabled.

### Which client runs the checks

Every check below needs a real sign-in, and both sign-in routes end on the
website or the app:

- Google returns to `movenrun://auth/callback` (app,
  `mobile/src/lib/signInMethods.ts`) or to the page it started on
  (`website/js/account-auth.js` sends `location.origin + location.pathname`,
  so `https://movenrun.xyz/account-deletion/` or `/sign-in/`).
- Wallet sign-in always signs on `https://movenrun.xyz/sign-in/`: the
  server writes that URI and the domain `movenrun.xyz` into the message.

So the checks need either the reviewed website live at the apex with its two
placeholders filled (X-21), or an app build pointing at the staging API.
Enabling the providers before that is safe (the hook still checks every new
user) but the checks then wait. **To confirm with the owner:** which client
is used, and whether X-21 goes first.

## Steps (only after the owner approves X-05)

Order: Google client (may be prepared earlier) → URL configuration → Google
on → Web3 on → read-only proof → X-07b. Do the switches one after another in
one sitting so the checks start straight away.

### 1. Google Cloud (can be prepared before the approval)

From `HOSTING_SUPABASE_FREE.md` §2a:

1. APIs & Services → **OAuth consent screen**: External; app name; support
   email; scopes **openid, email, profile only**; authorised domains
   `movenrun.xyz` and `supabase.co`; publish to production.
2. Credentials → **Create OAuth client ID** → type **Web application**.
   Authorised redirect URI: the project's Supabase callback
   (`https://tavxmwuwkeynbnzfwove.supabase.co/auth/v1/callback`).

One Web application client is enough. The app does not use native Google
sign-in: it runs Supabase's PKCE flow in the system browser
(`expo-web-browser`, `AUTH_SECURITY_REVIEW.md` "Google"), so no Android OAuth
client and no SHA-1 fingerprint is needed for v1. The client secret is shown
once in Google Cloud and is typed only into Supabase.

### 2. Supabase → Authentication → URL Configuration

| Setting | What it must hold |
|---|---|
| Site URL | the apex website |
| Redirect URLs | exactly three: the app return `movenrun://auth/callback`, the apex `/sign-in/` page and the apex `/account-deletion/` page |

Do not add `www.movenrun.xyz`: it 308-redirects to the apex with the path
kept (E-64), so the website always sends an apex return address, and a
shorter list is a smaller target. Wallet sign-in is refused by Supabase if
the message URI (the apex `/sign-in/`) is not on this list
(`HOSTING_SUPABASE_FREE.md` §2c).

### 3. Supabase → Authentication → Sign In / Providers → Google

| Setting | Action |
|---|---|
| Enable Sign in with Google | on |
| Client ID(s) | the Web application client ID from step 1 only |
| Client Secret | the Web client's secret, entered here only |
| Skip nonce checks | **off** (`HOSTING_SUPABASE_FREE.md` §2a) |
| Allow users without an email | leave at its default, off (**to confirm in the dashboard** that this is the default; the code does not need it) |
| Callback URL shown on the page | must equal the redirect URI given to Google in step 1 |

### 4. Supabase → Authentication → Sign In / Providers → Web3 Wallet

| Setting | Action |
|---|---|
| Web3 Wallet → **Ethereum** | on |
| Solana (or any other chain) | off |

Signature only: the page asks the wallet for `eth_requestAccounts` and one
`personal_sign` of an EIP-4361 message (domain `movenrun.xyz`, chain 8453,
96-bit single-use nonce, 5-minute expiry). No transaction, no typed-data
approval, no network switch, no gas (`AUTH_SECURITY_REVIEW.md` "Wallet
message"; `supabaseSignIn.service.ts`). The API checks nonce, exact message
and EOA signature itself, then calls Supabase's Web3 grant from the server.

### 5. Settings that must stay as they are (check, do not change)

From `HOSTING_SUPABASE_FREE.md` §2d:

| Setting | Must be |
|---|---|
| Email provider | off (no sign-up, no magic links) |
| Anonymous sign-ins | off |
| Manual linking | off (D-17: Google and wallet are separate accounts) |
| Rate Limits → Web3 sign-ins | the default, 30 per 5 minutes per IP (F-05; do not raise) |
| CAPTCHA | off (not wired; turning it on breaks sign-in) |
| Hooks → Before User Created | still enabled, still the MovenRun function |

### 6. Proof, read only in the dashboard

Authentication → Sign In / Providers shows Google and Web3 on, Email and
anonymous off. URL Configuration lists exactly the three redirect URLs.

## Checks right after enabling

Record what was seen in `EVIDENCE_REGISTER.md`; results not seen are not
recorded. No token, code, email address or wallet address is copied into
chat, the repository or the register (counts and status codes only).

### C1. The hook is really called (X-07b)

`LIVE_SETUP_OPERATOR_GUIDE.md` X-07b. **Each `update` below is a live
database write and is part of the X-05 approval only if the owner says so.**

1. SQL: `update account_capacity set max_new_per_hour = 0;`
2. **Continue with Google** with a Google account that has never used
   MovenRun.
3. Expect a refusal, and Authentication → Users shows **no** new user.
4. SQL: `update account_capacity set max_new_per_hour = 50;` then
   `select max_new_per_hour from account_capacity;` reads 50.

If step 3 creates a user, the hook is not called: turn both providers off
(Rollback) and re-check gate X-07 before going on.

### C2. First real sign-in, one of each

1. **Google**: Continue with Google, same account as C1. Expect a MovenRun
   session (the app or page shows the signed-in state).
   - SQL: `select count(*) from users;` → 1;
     `select count(*) from auth_user_creations;` → 1 or more;
     `select count(*) from google_sign_in_exchanges;` → 1.
   - Authentication → Users: one user, provider Google.
2. **Wallet**: on a phone with a wallet browser, Continue with Wallet. The
   wallet shows a sign-in message and **no** transaction or gas screen.
   Expect a MovenRun session; `users` → 2; Authentication → Users: a second
   user with a Web3 identity.
3. **Separate accounts (D-17)**: using the same person's Google account and
   wallet gives two MovenRun accounts. Nothing links them; manual linking
   stays off. This is the accepted v1 rule (X-20), not a fault.
4. Render log since enabling: no error lines, no secret, token or address
   (the API logs fixed messages and counts only).

Also from `A10_GOOGLE_EXCHANGE_PLAN.md`: the rule that Supabase keeps the
`oauth` time across refreshes is from Supabase's token format and has not
been seen on the live project. **To confirm with the first real Google
token:** the claim names and their order only (`amr` with one `oauth` entry,
`session_id` present), read in the owner's own browser; no token is copied.

### C3. The hook refuses at the cap

Proving the 403 without creating 1,000 accounts has two parts:

- **Function answer (no live change):** in the SQL editor,
  `begin; update account_capacity set max_accounts = 0; select public.movenrun_before_user_created('{}'::jsonb); rollback;`
  should return the 403 error object
  (`MovenRun is not accepting new accounts right now.`). The transaction is
  rolled back and records nothing, but it contains an `update`, so the owner
  approves running it. While it is open, a real sign-up waits on the row.
- **Supabase honours it (live change, own approval):** temporarily set
  `max_accounts` to the current `select count(*) from users;` (2 after C2),
  try one new Google or wallet sign-in (expect refusal and no new auth user;
  a wallet attempt shows `registration_closed`, a Google refusal comes back
  from Supabase on the return page), then set `max_accounts = 1000` back
  and read it again. **Lowering `max_accounts` in `account_capacity` is a
  live database write that closes sign-up for everyone while it lasts, so it
  needs its own owner approval and is not covered by approving X-05.** C1
  already proves Supabase calls the hook and honours its refusal; this step
  only adds the 403 branch, which `hookContract.test.ts` proves on PostgreSQL.

Existing players are not affected at the cap: the hook runs only when
Supabase creates a user, and the API admits existing players (E-29).

### C4. Replay of the Google exchange

The rule (`A10_GOOGLE_EXCHANGE_PLAN.md`): one MovenRun session per Supabase
session; exchange only within 10 minutes of the Google sign-in; the session
id is recorded for 30 days.

- **Read only:** after C2, `google_sign_in_exchanges` has exactly one row per
  Google sign-in made; a second Google sign-in adds one more.
- **Live replay (owner's browser only):** in the browser's developer tools,
  re-send the `/identity/auth/google/complete` request from C2 once. Expect
  **401**. The token never leaves that browser and is not copied anywhere.
  If the owner prefers not to, the replay stays proven by the HTTP and
  PostgreSQL tests (`A10_GOOGLE_EXCHANGE_PLAN.md` "Tests"), and the register
  says the live replay was not run.
- Normal use is unchanged: the app and the website exchange once and never
  retry with the same token.

### C5. Account deletion and provider clean-up

Delete both test accounts, one in the app and one on `/account-deletion/`
(the web path works for wallet-only accounts, E-24):

1. SQL: `select count(*) from users;` back to 0;
   `select count(*) from pending_auth_user_deletions;` 0 within a few
   minutes (the API removes the Supabase user after commit and retries until
   Supabase confirms; `accountDeletion.ts`).
2. Authentication → Users: both users gone.
3. The old MovenRun token is refused (401) on its next use.
4. Abandoned sign-in users (a Google sign-in that never reached the API) are
   removed by the API's sweep after an hour (F-03, F-14). After an hour of
   use, the Render log shows no
   `Maintenance: unused sign-in records failed` line.

`google_sign_in_exchanges` rows are not personal data and expire after 30
days on their own; deletion does not need to remove them.

## Rollback

**Do:** Authentication → Sign In / Providers → turn **Google** off, then
**Web3 Wallet → Ethereum** off. Nothing else: the hook, the URL list, the
database and the API stay as they are. No deploy and no migration is
involved.

What happens then (from the code):

| Thing | After the provider is off |
|---|---|
| New Google or wallet sign-ins | Stop at Supabase. The API answers wallet attempts with a refusal (`verification_failed`, or `registration_closed` if Supabase answers 403; **to confirm in the dashboard** which status Supabase returns for a disabled provider) |
| MovenRun sessions already issued | **Keep working.** They are the API's own tokens (10-minute access, rotating refresh) and never call Supabase again. Players stay signed in until they sign out, delete the account or the refresh expires |
| Supabase sessions already issued | The app and website sign them out right after the exchange. Any left are useless to MovenRun: the Google route needs a fresh, unspent session (10 minutes, recorded), the wallet routes need MovenRun's own single-use nonce. Whether Supabase revokes its own sessions when a provider is switched off: **to confirm in the dashboard** |
| Auth users already created | Stay. Mapped users keep their MovenRun account; unmapped ones are swept after an hour |
| Account deletion | Still works for signed-in players in the app. On the website it needs a sign-in, so it needs the provider back on (or the support email route) |

To end every MovenRun session as well (for example if a provider was
misconfigured in a way that let a wrong user in), that is a separate live
database write, not prepared here, with its own owner approval.

Then record the rollback, its time and the reason in the register, and
re-read Authentication → Sign In / Providers.

## Not in X-05

- Raising the Web3 rate limit or the hourly quota (F-05, D-20).
- CAPTCHA, Email, anonymous sign-in, identity linking.
- Android App Links for the return (F-06, X-23).
- Publishing the website (X-21) and building the APK (X-04).
