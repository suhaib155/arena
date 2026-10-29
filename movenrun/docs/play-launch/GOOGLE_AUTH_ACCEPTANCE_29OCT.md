# Google sign-in acceptance (29 Oct 2026)

Providers are OFF and stay off. Nothing here enables, changes or calls a hosted service. Part A is what runs locally with stand-ins today. Part B is the script the owner runs once X-05 provider enablement is approved (`X05_PROVIDER_ENABLEMENT_PREFLIGHT.md` holds the preconditions and the full dashboard steps; this page is the acceptance layer on top of it). That document lives on branch `security/a10-single-use-google-exchange` at `docs/play-launch/X05_PROVIDER_ENABLEMENT_PREFLIGHT.md` and is not in this branch's tree.

This branch is based on the staging security candidate (head `0faf652`) and must be opened as its own PR against `integration/security-staging-preflight-28oct`. It must NOT be merged into it until the owner accepts a new head for #162.

Code base: `integration/security-staging-preflight-28oct` at `0faf652` carries the full sign-in stack (single-use exchange, key-set outage 503, deletion queue). `integration/android-qa0-28oct` (`a2a3eec`) does not carry the 503 mapping (`jwksOutage.test.ts` is absent there): a key-set outage there is a 401. Acceptance below applies to the staging candidate; the Android build talks to the staging API, so the API under test must be that candidate or later.

## Part A. Local acceptance (stand-ins: in-memory stores, fake Supabase, locally generated keys, local PostgreSQL 16)

| # | Case | Result | Test (file: name) |
|---|---|---|---|
| 1 | Google token exchange, happy path | Already covered | `identity/services/supabaseSignIn.service.test.ts`: "Google sign-in over HTTP returns a MovenRun session and the same player every time"; `identity/http/authThreats.test.ts`: first test (ES256 and RS256 sign in, 200); `api/runtime.test.ts` (built API, PostgreSQL) |
| 2 | Single use; replay and refresh of a spent session refused | Already covered | `supabaseSignIn.service.test.ts`: "a Google token is exchanged once..."; "once per Supabase session: replays and refreshes at 10, 11, 30 and 65 minutes..."; "the window..."; "concurrent refreshes... exactly one wins" (`supabaseSignIn.service.test.ts`, line 284); "25 concurrent Google sign-ins"; `authThreats.test.ts` replay cases |
| 3 | Expired, forged, wrong-issuer, wrong-algorithm, anonymous tokens refused (401, nothing leaked) | Already covered | `authThreats.test.ts`: "only the project's ES256 and RS256 signing keys sign in; every other token is 401" (23 refusal cases incl. expired, other key, wrong issuer); `identity/providers/supabaseAuth.test.ts`: "issuer, audience, role, expiry, subject and anonymous users are checked". Wrong audience and wrong role are asserted at the verifier (unit) level, not through HTTP |
| 4 | Key-set outage is 503 `provider_unavailable` (with Retry-After and no-store), not 401; issued sessions survive | Already covered | `identity/http/jwksOutage.test.ts` (3 tests); `authThreats.test.ts`: "a key-set outage is 503 only for tokens that need a key..." |
| 5 | 1,000-account cap and 50-per-hour limit in the Before User Created logic | Already covered | `identity/repositories/hookContract.test.ts` (PostgreSQL: privileges, 403 at cap, 429 over quota, 20 concurrent calls admit exactly the quota, quota reopens after an hour, fail closed); `supabaseSignIn.service.test.ts`: "the account cap counts Google and wallet players together...", "concurrent first sign-ins at the last free place admit exactly one player", "the hourly new-account quota refuses a burst over HTTP..."; `api/runtime.test.ts` |
| 6 | Guest play unaffected | New (4 tests) | `mobile/src/lib/__tests__/guestPlayIndependence.test.ts`: guest choice is a local first-run transition; `firstRun` imports no identity or network module; the welcome screen's guest handler touches no sign-in code and is not disabled by provider state; guest is not a switchable sign-in method |
| 7 | Google and wallet accounts stay separate | New (1 test) | `identity/http/googleWalletSeparation.test.ts`: "one person's Google account and wallet are two players, each stable across sign-ins" (including same email on a second Google account) |
| 8 | Account deletion | Covered plus 2 new | Existing: `supabaseSignIn.service.test.ts` ("account deletion while the provider is down reports the sign-in record pending..."), `identity/http/router.test.ts` (confirmation, only the bearer's account), `api/runtime.test.ts` (PostgreSQL: deleted token refused), `services/providerDeletionQueue.test.ts`. New: `googleWalletSeparation.test.ts`: deleting the Google account leaves the wallet player working and a returning Google user is a new player; deleting the wallet account leaves the Google player working |

Totals: 8 cases; 5 already fully covered (1 to 5); 3 touched by new tests (6, 7, 8 partly). New tests: 7 (3 backend, 4 mobile). The new tests pin current behaviour; they pass on the branch and were not written to fail first, since no defect was found.

Run: backend `node ../scripts/run-tests.mjs` in `movenrun/backend` (with `MOVENRUN_TEST_DATABASE_URL` set to a fresh local database) and mobile `node --import tsx scripts/run-tests.ts` in `movenrun/mobile`.

## Part B. Owner acceptance script (run only after X-05 is approved and the preflight passes)

Rules: use a Google account that has never used MovenRun and a phone or browser you control. Copy no token, code, email or wallet address into chat, the repository or the register; record status codes and counts only. Stop at the first unexpected result and use the rollback.

Before you start: complete the preconditions P1 to P7 in `X05_PROVIDER_ENABLEMENT_PREFLIGHT.md` (on branch `security/a10-single-use-google-exchange`, path `docs/play-launch/X05_PROVIDER_ENABLEMENT_PREFLIGHT.md`; not in this branch's tree) (hook attached, capacity 1000 and 50, no auth users, API reachable). Read-only SQL: `select count(*) from users;` should be 0; `select max_accounts, max_new_per_hour from account_capacity;` should be 1000 and 50.

| Step | Do | Expected | If not |
|---|---|---|---|
| B1 | Supabase, Authentication, Sign In / Providers: turn Google on only (Web application client, scopes openid email profile, Skip nonce checks off). Leave Web3, Email and anonymous off | Google on, others off | Turn Google off |
| B2 | Hook proof (X-07b). `update account_capacity set max_new_per_hour = 0;` then Continue with Google | Sign-in refused, Authentication, Users shows no new user | If a user appears the hook is not called: roll back |
| B3 | `update account_capacity set max_new_per_hour = 50;` and read it back | 50 | Fix before continuing |
| B4 | Continue with Google (app or website) | Signed in; `users` 1; `google_sign_in_exchanges` 1; one Google user in Authentication | Roll back |
| B5 | Replay: in the browser developer tools of the same session, re-send the `/identity/auth/google/complete` request once (owner's browser only) | 401. Skip if you prefer; the replay is proven by Part A. This step handles a live token only in the owner's own browser and may be skipped | Roll back, this is a security fault |
| B6 | Sign out and sign in again with the same Google account | Same player (progress kept); `google_sign_in_exchanges` 2 | Note and stop |
| B7 | Guest: sign out, choose Start exploring | Walk and Save work, no sign-in prompt | Report |
| B8 | Outage behaviour is not triggered live. Do not block Supabase. Part A covers it | n/a | n/a |
| B9 | Cap and quota are not tested live beyond B2 (lowering `max_accounts` closes sign-up for everyone and needs its own approval) | n/a | n/a |
| B10 | Only if the wallet provider is also approved: Web3 on, sign in with a wallet | A second player (`users` 2); no transaction screen | Turn Web3 off |
| B11 | Separate accounts: confirm the Google player and the wallet player have different progress | Two players | Roll back |
| B12 | Delete each test account (app, Account, Delete account; the website path for wallet-only) | `users` back to 0, `pending_auth_user_deletions` 0 within minutes, Authentication Users empty, the old token refused | If the Supabase user stays, the API retries; check after an hour |
| B13 | Read the Render log for the period | No error lines, no secret, token or address | Report |

Rollback at any step: Supabase, Authentication, Sign In / Providers, turn Google off (and Web3 Wallet, Ethereum off if on). The hook, URL list, database and API stay as they are. Issued MovenRun sessions keep working until they expire or the player signs out. If the owner stops between B2 and B3, set `max_new_per_hour` back to 50 (and the account cap back to 1,000) before leaving. Record the time and reason in the register.

Not in this script: raising the Web3 rate limit or hourly quota, CAPTCHA, email or anonymous sign-in, identity linking, App Links.
