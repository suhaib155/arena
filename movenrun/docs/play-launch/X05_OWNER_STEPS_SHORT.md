# X-05 owner steps (short)
Dashboards only. Never paste a secret, key or token into chat, code or a doc. Google first; wallet only after Google is verified.
1. Google Cloud, APIs & Services, OAuth consent screen: External; scopes `openid`, `email`, `profile` only; domains `movenrun.xyz`, `supabase.co`.
2. Credentials, Create OAuth client ID, type **Web application** (not Android).
3. Authorised redirect URI, exactly: `https://tavxmwuwkeynbnzfwove.supabase.co/auth/v1/callback`
4. Supabase, Authentication, URL Configuration: Site URL `https://movenrun.xyz`.
5. Redirect URLs, exactly these three and no others (no `www`):
   `movenrun://auth/callback`, `https://movenrun.xyz/sign-in/`, `https://movenrun.xyz/account-deletion/`
6. Supabase, Providers, Google: enable; paste the Web client ID and the client secret **here only**; leave "Skip nonce checks" off.
7. Confirm before enabling: Hook "Before User Created" still enabled; admission caps unchanged at 1000 accounts and 50 new per hour.
8. Keep OFF and unchanged: Email/OTP, Anonymous sign-ins, Manual linking, CAPTCHA. Web3 sign-in rate limit stays at the default.
9. Say "Google on". Engineering then runs one real spare-account login, one hook row, single-use exchange, replay and refresh refusals,
   deletion and late-provider cleanup. Reports carry no account identifiers or tokens.
10. Only after that passes: Providers, Web3 Wallet, **Ethereum** on (Solana and others off). Unfunded wallet, personal-sign only, no transaction.
11. Re-read Providers: Google and Ethereum on; Email and Anonymous off; URL list is exactly the three entries above.
12. Do not edit the caps to fake a capacity test; true cap denial (X-07b) is not proved by local tests.
13. If a toggle or credential read is denied, stop that step and use the dashboard page above; do not try another route.
Rollback: Supabase, Providers, turn **Google** off, then **Web3 Wallet, Ethereum** off. Nothing else changes (hook, URLs, database, API stay).
Issued MovenRun sessions keep working until sign-out or expiry. Record time and reason in the before/after/rollback ledger.
Detail and checks: `X05_PROVIDER_ENABLEMENT_PREFLIGHT.md`. Source: owner packet section 15.
