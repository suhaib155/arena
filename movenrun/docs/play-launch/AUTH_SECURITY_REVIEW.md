# Sign-in security review (Google, wallet, guest)

**Date:** 13 Oct 2026 · **Scope:** the code on this branch: API (`backend/src/identity`,
`backend/drizzle`), app (`mobile/src/services/signInProviders.ts`, `mobile/src/lib/signInMethods.ts`,
`mobile/app/auth/*`, `SignInOptions.tsx`), website (`website/js/account-auth.js`,
`/sign-in/`, `/account-deletion/`, `vercel.json`).

**Method:**
- Every control was traced through the code path.
- Each finding was confirmed with a test or an end-to-end check, or marked residual.
- Supabase is replaced by a local stand-in in every test here, so nothing below is proof of the hosted provider's behaviour. That needs X-05–X-07, and the phone needs X-10.
- No part of this review is an independent audit.

**Result:** `PASS — SECURITY REVIEWED, READY FOR LIVE AUTH DEVICE GATE`, with one residual risk (F-06) to re-check on the phone.

## Threat model

Attackers considered:
- a malicious Android app on the same phone (custom-scheme interception, starting sign-ins itself);
- a phishing page or link;
- a counterfeit wallet link;
- several or malicious browser wallet extensions;
- OAuth login CSRF;
- a stolen bearer token;
- a replayed wallet signature;
- scripts creating accounts to fill the 1,000 cap;
- direct calls to Supabase with the public key;
- deletion racing a sign-in;
- account switching on one phone;
- free-host cold starts and retries;
- open redirects;
- clickjacking.

## Findings

| ID | Severity | Finding | State | Evidence |
|---|---|---|---|---|
| F-01 | **High** | **The 1,000-account cap could be filled by a script.** Wallet keys cost nothing, and the only brakes were 20 writes a minute per IP and Supabase's per-IP limit. A few addresses could take every place in hours, locking real players out of v1 | **Fixed.** At most 50 new accounts per rolling hour, enforced in the Supabase Before User Created hook (every new auth user, however the request reached Supabase; refused with 429) and in the API's admission transaction (`registration_busy`, 429). The refused provider user is deleted. Existing players are never affected. The owner can change it with one SQL update. Combined with the 80/90/95 % alerts, a filling cap is visible long before it is full | Migration 0009; `supabaseSignIn.service.test.ts` (HTTP burst, reopen after an hour); `runtime.test.ts` on PostgreSQL 16 (hook returns 429 and records one row per user; API 429 + provider user removed; existing player still 200) |
| F-02 | Medium | **Setup order allowed unchecked users.** The runbook enabled providers (X-05) before the hook existed (X-07), so in between, Supabase could create sign-in users that neither the cap nor the quota had checked | **Fixed in the runbook.** The order is now X-06 → X-07 → X-05, and the hook checks run (in a rolled-back transaction) before providers are switched on | `HOSTING_SUPABASE_FREE.md` (Order matters, §3), `EXTERNAL_ACTIONS.md`, `RELEASE_HANDOFF.md` |
| F-03 | Medium | **Orphan sign-in users were never removed.** Supabase users that never became a MovenRun account stayed for ever: a Google sign-in abandoned before the app reached the API, or a wallet grant made straight against Supabase with the public key. Each counts toward Supabase Free's monthly users | **Fixed.** Every 30 minutes while awake, and on each wake from sleep (`api/maintenance.ts`), the API lists auth users (id and two timestamps only). It removes those older than an hour, with no sign-in in the last hour, no MovenRun account and no wallet code waiting. Mapped users are never touched | `sweepOrphanProviderUsers` test (keeps recent, mapped and waiting users; pages) |
| F-04 | Medium | **The website took whichever extension wrote `window.ethereum` last.** With several wallets installed, or a malicious extension, the sign-in request could go to a wallet the person did not choose | **Fixed.** EIP-6963 discovery: one announced wallet is used; with several, the person picks from a list (names shown as text only); `window.ethereum` only when none announce | `evidence/web-wallet-discovery-check.mjs` 8/8 in Chromium (only the picked wallet is asked anything; markup in a wallet's name is not rendered; Cancel asks nothing) |
| F-05 | Medium | **The runbook raised Supabase's Web3 rate limit from 30 to 300 per 5 minutes per IP** because all API calls share one address. That also raised the ceiling for anyone calling Supabase directly | **Fixed in the runbook.** Left at the default 30 for internal and closed testing (about 6 wallet sign-ins a minute in total). Raise only after measuring hosted traffic. A hit shows "Too many attempts". CAPTCHA stays off (not wired; the quota is the control instead) | `HOSTING_SUPABASE_FREE.md` §2d |
| F-06 | Medium | **Consent phishing of the wallet handoff code.** PKCE means a code intercepted from a flow the real app started is worthless. But an attacker can **start** a flow with their own challenge: a malicious app on the phone, or a link sent to the person. If the person signs, the attacker can collect the code (the auto-return if their app claims `movenrun://`, or by asking for it) and get that wallet's MovenRun session. Impact: the game account (progress, deletion). Not the wallet or any funds | **Mitigated, residual.** The page warns before signing ("Only continue if you just tapped Continue with Wallet in the MovenRun app on this phone… If someone sent you this link… close this page"). The code is labelled never to be shared, and the app says to enter only a code from a page it just opened. Codes are single use, 5 minutes, bound to one challenge. **Residual:** the same class of risk as any custom-scheme OAuth app (RFC 8252 §8.6), and it also applies to Google. A verified Android App Link for the return would stop a malicious app receiving the auto-return. Whether wallet browsers hand an HTTPS App Link to the app is unproven, so it is a phone-gate item (QA-04), not shipped blind | `/sign-in/` copy; `SignInOptions.tsx`; `HANDSET_TEST_SCRIPT.md` step 15h |
| F-07 | Low | **The website read the API's error as `body.error`** (an object), so refusals such as "release is full" showed a generic message | **Fixed.** Uses `error.code` | Wallet discovery check: a 403 `registration_closed` shows its own text |
| F-08 | Low | **Supabase refusals during the wallet grant all became "That didn't match"**, including the hook's cap (403) and quota or rate limit (429) | **Fixed.** 403 → `registration_closed`, 429 → `too_many_attempts` | `supabaseSignIn.service.test.ts` |
| F-09 | Low | **`/auth/google/complete` accepted an OAuth session from any provider.** Only Google is enabled, but enabling another later would have been accepted as "Google" | **Fixed.** The verified token must list `google` among its providers | `supabaseSignIn.service.test.ts` (a GitHub OAuth session is refused) |
| F-10 | Low | **The website sent no anti-framing headers**, so the deletion page could be framed and clickjacked once someone signed in inside the frame | **Fixed** in `vercel.json`: `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, HSTS, and a permissions policy with camera, mic, location and payment off | Takes effect when the site is served on Vercel (X-21) |
| F-11 | Info | Contract wallets (EIP-1271/6492) cannot sign in | **By design.** Signatures must be 65 bytes and recover to the address; anything else is refused. Copy and Play answers don't promise them | `supabaseSignIn.service.test.ts` (other signer, malformed) |
| F-12 | Info | A captured (message, signature) pair, replayed straight to Supabase within its 10-minute window, yields a Supabase session for that wallet | **No MovenRun impact.** The API turns a Supabase session into a MovenRun session only through the Google route (must be OAuth from Google) or the wallet routes (MovenRun's own nonce, single use, consumed first). The Supabase user it creates is limited by the hook and removed by the sweep (F-03) | Code path in `supabaseSignIn.service.ts`; tests for each route |

## Controls checked and found sound

**Google**
- Supabase PKCE (S256) in the system browser (`expo-web-browser` auth session / Custom Tabs).
- Only `openid email profile` are requested: no Gmail or other Google scopes, and no provider refresh token is kept.
- The app accepts only the exact return `movenrun://auth/callback` and only from the auth session it opened. A code injected from elsewhere cannot be exchanged without that session's verifier, so login CSRF fails. Provider errors are reported without their text.
- The short-lived Supabase session is signed out once the API has issued the MovenRun session. The web flow keeps its verifier in `sessionStorage` for that tab only and removes it on return.

**Wallet message**
- The server writes the message in EIP-4361 form, with:
  - domain `movenrun.xyz` and URI `https://movenrun.xyz/sign-in/`;
  - chain 8453;
  - a 96-bit nonce;
  - issue and expiry times, valid for 5 minutes.
- **Exact message match:** the nonce is looked up, and the stored text must equal the submitted text.
- **Single use:** a conditional database write consumes the nonce before anything else happens.
- **Signature:** checked by `ethers.verifyMessage` (EOA), then again by Supabase Auth.
- **Nothing on chain:** the page asks wallets only for `eth_requestAccounts` and `personal_sign`. The end-to-end test fails on any other method: no transaction, typed-data approval, network switch or gas.
- **No secrets asked:** no recovery phrase or private key is ever requested.

**Handoff code**
- The code is 12 characters from a 30-character alphabet (about 59 bits), drawn from `crypto.randomBytes` with rejection sampling.
- Only its SHA-256 is stored.
- It is spent once, by an atomic conditional update, only together with the verifier whose S256 challenge it was issued for, within 5 minutes.
- A wrong verifier does not burn the code. A link carrying someone else's code does nothing without this phone's pending verifier.

**Sessions**
- **Token verification:** Supabase tokens are verified on the server against the project's JWKS (ES256/RS256), plus issuer, audience, role and expiry. Anonymous users are refused, and keys are refreshed on rotation.
- **Account key:** MovenRun accounts are keyed to the verified `sub` only, never email or address.
- **Lifetimes:** MovenRun access tokens last 10 minutes. Refresh tokens rotate, and reuse revokes the whole session family.
- **Bearer only:** tokens are sent as bearer headers, never cookies, so CSRF does not apply. CORS allows only explicit HTTPS origins.
- **Account switching:** a sign-in that started under one account cannot commit under another (generation check), and switching clears the pending movement queue.
- **Logout and deletion:** both revoke server sessions and clear the keystore.

**Deletion**
- Deletion erases every MovenRun row of the account in one transaction, then deletes the Supabase user, queuing and retrying it if Supabase is unreachable.
- The deleted token is refused everywhere afterwards. The web path works for wallet-only accounts (E-24).

**Data and secrets**
- Row level security is on for every table, including the new `auth_user_creations`, checked on PostgreSQL by `runtime.test.ts`. The Data API is to be turned off (runbook).
- The app refuses `sb_secret_` keys and reads only `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- A history-wide scan found no Supabase secret key, `service_role` token, private key or Resend key in any commit.

**Free host**
- Sign-in wakes the API early and gives up after 90 seconds with a retry message (E-28).
- Movement saves stay pending and replay to one row.

**Guest play**
- Unchanged. It never creates a Supabase user. Anonymous sign-ins stay off.

## Where verification happens

| Check | Done by |
|---|---|
| EIP-4361 parse, signature, URI/domain vs redirect list, issued within 10 min | Supabase Auth (hosted, unverified here) |
| Exact message, nonce single use, expiry, EOA signature | MovenRun API (`supabaseSignIn.service.ts`, `ethers`) |
| Google OAuth, PKCE code exchange | Supabase Auth and Google |
| Supabase token signature and claims | MovenRun API (`supabaseAuth.ts`, Node `crypto`) |
| Account cap and hourly quota | PostgreSQL (hook function and admission transaction) |
| Handoff code and PKCE binding | MovenRun API and PostgreSQL |

## Round 3 (13 Oct 2026, post-security, frontend on hold)

Backend-only pass over the token check, the hook, the sweep and the
migrations. No app source changed (D-25).

### New findings

| ID | Severity | Finding | State | Evidence |
|---|---|---|---|---|
| F-13 | Low | **Token header and `nbf` not checked.** A Supabase token with a `crit` header, or a `nbf` (not before) in the future, was accepted. Supabase issues neither today, so there is no known exploit; it is defence in depth | **Fixed.** Any `crit` header is refused (RFC 7515 §4.1.11); a future or malformed `nbf` is refused as `not_yet_valid` | `supabaseAuth.test.ts` (crit, `alg: none`, ES384, HS256 without a secret, nbf, audience arrays) |
| F-14 | Medium | **Orphan sweep race.** The sweep listed users, then deleted later from that list. A person who signed in between the two would lose their fresh sign-in user, and the app's hand-off to the API would then fail once. Two overlapping runs could also both list and delete | **Fixed (D-28).** Each candidate is read again at Supabase (`GET /admin/users/{id}`) just before deletion and kept if it is gone or signed in within the hour; a read error stops the run without deleting. At most 100 deletions per run; a run started while one is going joins it | `supabaseSignIn.service.test.ts` (sign-in after the listing kept; cap 3 of 5 then the rest; one listing for two callers; failed read keeps the user); `supabaseAuth.test.ts` (`getUser` reads id and two timestamps only; 404 is null) |
| F-15 | Low | **Identity responses could be cached.** Responses carrying session tokens and one-time codes had no `Cache-Control` | **Fixed.** Every `/identity` response sends `Cache-Control: no-store` and `Pragma: no-cache` | The HTTP tests assert it on every identity call |
| F-16 | Info | **Hosted hook may need schema access.** On plain PostgreSQL `supabase_auth_admin` can call the hook. Supabase's own hook guide also grants `usage on schema public` to that role; whether the hosted project already has it is unknown here | **Operator check.** Gate X-07 in `LIVE_SETUP_OPERATOR_GUIDE.md` checks it read-only and gives the one grant to run if missing (with approval) | `hookContract.test.ts` (role can call; cannot read tables directly) |

### Hook contract (proven on PostgreSQL 16, `hookContract.test.ts`)

Every committed migration is applied to a scratch database with the roles
`anon`, `authenticated` and `supabase_auth_admin` created first, as on Supabase.

| Contract | Result |
|---|---|
| Who may call | `supabase_auth_admin` only. PUBLIC, `anon` and `authenticated` get "permission denied". `SECURITY DEFINER` with `search_path = public, pg_temp` pinned. The auth role cannot read MovenRun tables directly |
| Return shape | `{}` to admit; `{"error":{"message":…,"http_code":403}}` at the cap; `{"error":{"message":…,"http_code":429}}` over the hourly quota. Nothing else |
| Concurrency | 20 simultaneous calls against a quota of 5 admit exactly 5 and record exactly 5 rows (advisory lock) |
| 1,000 cap | At the cap every call answers 403 and records nothing, even with quota left |
| 50/hour quota | Rows older than an hour stop counting; rows older than a day are pruned; quota 0 refuses everything (the X-07 invocation proof) |
| Deletion frees capacity | Deleting a player's row lets the next call through |
| Existing users when full | The hook runs only when Supabase creates a user; signing in again creates none. API side: existing players get 200 at the cap (`runtime.test.ts`, E-29) |
| Fail closed | No capacity row → 403. The function erroring (a missing table) → an error, never `{}`, so Supabase refuses the sign-up |
| Data recorded | `auth_user_creations` has two columns: a sequence number and a time. No identifier |

### Migration inventory and checksums

Migrations 0000–0009 are pinned in `backend/drizzle/CHECKSUMS.sha256` and the
journal is checked against the files (`migrationChecksums.test.ts`, D-27).
Inventory, scope and the rollback/rescue plan: `LIVE_SETUP_OPERATOR_GUIDE.md`
§Migrations.

### Token, session and code audit

| Check | Finding | Where |
|---|---|---|
| JWKS rotation | Keys refreshed after 10 minutes or on an unknown `kid`, at most once a minute; a provider outage keeps known keys and refuses unknown ones; JWKs with private parts, wrong `use` or mismatched `alg` ignored | `supabaseAuth.ts` `keyFor`/`refresh`; tests |
| Algorithm | ES256 or RS256 decided by the key, never by the header; HS256 only with a configured legacy secret (not set in the runbook); `none` and others refused | `supabaseAuth.ts` `verify` |
| Claims | `iss` = project URL `/auth/v1`; `aud` (string or array) contains `authenticated`; `role` = `authenticated` (so `service_role` and `anon` keys are refused); `exp` required with 30 s margin; `iat` and `nbf` not in the future; `sub` a UUID; anonymous users refused | same |
| Provider | Google route requires `google` in `app_metadata.providers` (F-09); wallet route requires MovenRun's own nonce first, so a token from any other path is never turned into a session (F-12) | `supabaseSignIn.service.ts` |
| PKCE | Google: Supabase S256 PKCE, verifier never leaves the app or tab (`sessionStorage`, removed on return). Wallet hand-off: challenge must be 43 base64url characters; verifier 43–128 RFC 7636 characters; S256 recomputed server-side | `supabaseSignIn.service.ts` lines 44–49 |
| Nonces and replay | 96-bit wallet nonce, single use by a conditional update, 5 minutes; exact message match; a replayed message or code fails | E-20, E-22 |
| Code leakage | Only the code's SHA-256 is stored; the API logs no URLs, bodies, tokens or codes (only fixed messages and counts); `no-referrer` on the website; `no-store` on responses (F-15); a leaked code is useless without the phone's verifier | `grep console.` over `backend/src` |
| Account switching | A sign-in started under one account cannot commit under another; the pending wallet sign-in and the movement queue are cleared on switch | E-23 |
| Refresh rotation | Access 10 minutes; each refresh rotates; reuse of a rotated refresh token revokes the whole family | `session.service.ts` |

### Secrets

`scripts/check-secrets.mjs` scans tracked files (now a step in
`backend-checks.yml`), the whole history (`--history`), or a built folder
(for example the website or a Hermes export). Patterns: Supabase `sb_secret_`
keys, `service_role` JWTs (payload decoded), private key blocks, Resend,
GitHub, Google OAuth client secrets, AWS keys, hex private keys (Hardhat's
public test keys excepted) and Expo tokens. It prints the kind and location,
never the value. Result on this branch: tracked files, all history and
`website/` clean (E-33).

### F-06 safer callback: design for later approval (X-23), not shipped

The residual stays open. What a verified Android App Link would and would not change:

- **Would close:** another app on the phone receiving the automatic return.
  With `android:autoVerify="true"` for `https://movenrun.xyz/auth/…` and
  `https://movenrun.xyz/.well-known/assetlinks.json` naming `io.movenrun.app`
  with the Play App Signing SHA-256 (and the EAS preview key for test builds),
  Android 12+ opens that link only in MovenRun. Other apps cannot claim a
  verified host, unlike `movenrun://`.
- **Would not close:** someone who starts a sign-in themselves and talks the
  person into reading out the code. That is handled only by the warning,
  the "never share" copy, single use and the 5-minute expiry.
- **Unknown:** whether MetaMask, Coinbase Wallet and Trust Wallet in-app
  browsers hand an `https` navigation to the app at all. If they do not, the
  page shows the code to type, as today.
- **Changes it needs:** `app.json` intent filter and the return handler (app
  source, so it waits for the frontend hold to lift), a landing page and
  `assetlinks.json` on the website (X-21), the API's allowed return target,
  Supabase's redirect list, and the signing certificate fingerprints (after
  X-01b and the first upload).
- **Phone test before deciding (QA-04):** on the preview APK, run handset step
  15h; then, with a test build carrying the App Link, check
  `adb shell pm get-app-links io.movenrun.app` shows `movenrun.xyz: verified`,
  and that each wallet browser opens the app from the return link. Ship only
  if all three wallets return or fall back to the typed code cleanly.

## Still to prove (not engineering-blocked)

- **Hosted:** that Supabase calls the hook and honours its 403 and 429; that the Web3 grant enforces the redirect list; the orphan sweep against the real admin API (X-05–X-07).
- **Phone (X-10):** each wallet's browser returning to the app; F-06 (step 15h); Google cancel and repeat; account switch on one phone; deletion; cold start.
