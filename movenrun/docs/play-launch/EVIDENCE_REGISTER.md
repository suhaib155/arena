# Evidence register

Only what was actually run is recorded as evidence. A gate with no evidence row
is not passed. Commit ids are on `release/android-v1-cxfdbd`.

## Recorded before the auth change (2026-10-12 and 2026-10-13)

| ID | Gate | What was run | Result | Commit |
|---|---|---|---|---|
| E-01 | M | Integration of the SDK 54 stack (#103 → #104 → #105, then #102 merged with `--no-ff`); only `yarn.lock` overlapped and was regenerated with yarn | Clean; all suites green after merge | 2306c9a |
| E-02 | M | `mobile`: `yarn lint`, `npx tsc --noEmit`, `yarn test` (node test runner, inventory regenerated) | Lint clean, typecheck clean, **890/890 pass** | fa3b927 |
| E-03 | B | `backend`: `yarn typecheck`, `yarn build`, `yarn test` with `MOVENRUN_TEST_DATABASE_URL` on a local PostgreSQL 16; `yarn test:api` | Typecheck and build clean; **380/380 pass, 0 skipped** at fa3b927, **382/382** at a55fd35; API 9/9 | fa3b927 |
| E-04 | M | `shared`: `yarn test` | 156/156 pass | fa3b927 |
| E-05 | M | `releaseScope.test.ts`: every Clubs, competition, Deed and wallet entry point unreachable; route guard covers each deferred route | 12/12 pass | 83685ac |
| E-06 | M | `npx expo-doctor` | 16/18 checks pass. The two failures are network lookups to hosts blocked in this workspace (expo.dev API, React Native Directory), not project problems. Re-run where those hosts are reachable | 2306c9a |
| E-07 | M/R | `npx expo prebuild -p android --clean` (generated project not committed) | applicationId `io.movenrun.app`, compileSdk 36, targetSdk 36, minSdk 24, Gradle 8.14.3, Hermes on, new architecture off. Merged manifest permissions: fine and coarse location, internet, vibrate; background location, foreground service, overlay, storage, media images and audio carry `tools:node="remove"` | 626f3c0 |
| E-08 | M | `npx expo export -p android` (Hermes bytecode) | 4.36 MB `.hbc`. Searched for keys, tokens, `.env` values and private URLs: none found | 626f3c0 |
| E-09 | P | `runtime.test.ts` on real Postgres: delete account erases every account row in one transaction, a second account is untouched, the same email signs up fresh afterwards, one anonymous audit row remains, no coordinate reaches stored rows | Pass | cf0947a |
| E-10 | P | Mobile `sessionManagement.test.ts`: delete refuses during another session action, clears credentials and the pending queue only after the server confirms, reports errors | Pass | 6e3d148 |
| E-11 | P | **Superseded by E-24** (email-code web deletion was replaced) | Pass at the time | 60f4ad1 |
| E-12 | B | **Withdrawn (D-21): review access code removed.** Was: review access tests (`emailOtp.service.test.ts`, `config.test.ts`): fixed code only for the configured email, no email sent, expiry, single use, attempt cap and throttle still apply; guessable codes refused | Pass | 58237e4 |
| E-13 | B | Verified-session history: `GET /movement/verifications` returns only the caller's rows, newest first, limit 1–100; mobile counts only `verified` results | Pass (backend router test, runtime test, `accountHistory.test.ts`) | 9ead53d, fa3b927 |
| E-14 | G | `nativeAssets.test.ts`: app icon, adaptive foreground and monochrome 1024×1024, adaptive background Morning White, Play icon 512×512, feature graphic 1024×500 without alpha | Pass | bab3a1b |
| E-16 | P | Expired sign-in challenges deleted a day after expiry on the next code request, for any email (`emailOtp.service.test.ts`, Postgres check in `runtime.test.ts`). Backend now **382/382**, API 9/9 | Pass | a55fd35 |
| E-17 | B | Local PostgreSQL switched to TLS-only connections with a private CA (the same shape as Supabase). Backend suite, the `drizzle-kit migrate` deployment command and the built API run with `sslmode=verify-full&sslrootcert=<ca>`; without the CA the connection is refused (`unable to verify the first certificate`) | 382/382, API 9/9, 0 skipped | 0a48e0d |
| E-18 | B | Migration `0006_row_level_security`: runtime test runs as a **non-superuser, no-bypass table owner** and the whole flow still works; it asserts every `public` table has RLS on. Probe: a separate role granted SELECT/INSERT on all tables reads 0 rows from `users` and its insert is refused | Pass | 0a48e0d |
| E-15 | P | `scripts/check-launch-placeholders.mjs` (now also checks `sign-in/`) | Fails as designed on 3 values only the deployed services provide: `{{API_BASE_URL}}` ×2, `{{SUPABASE_PUBLISHABLE_KEY}}` (X-06, X-21). Contact, developer name, host and backup text are filled | dbeed8d |

## Auth change: Google and wallet sign-in (2026-10-13)

| ID | Gate | What was run | Result | Commit |
|---|---|---|---|---|
| E-19 | B | `backend`: typecheck, build, `yarn test` on PostgreSQL 16 with `MOVENRUN_TEST_DATABASE_URL`; `yarn test:api` 5 times in a row | **397/397, 0 skipped**; API **10/10** every run | 8dfecd2 |
| E-20 | B | `supabaseAuth.test.ts`: ES256/RS256 via JWKS, issuer, audience, role, expiry, anonymous users refused, key rotation throttled; `supabaseSignIn.service.test.ts`: EIP-4361 message shape, single use, tampering, other signer, expiry, Google needs an OAuth session, provider-user cleanup and retry | Pass | 674ef5f |
| E-21 | B | Account cap over HTTP with max 2: Google + wallet count together, existing players still sign in, deletion frees a place; **8 concurrent first sign-ins at the last free place on real Postgres admit exactly 1**, the other 7 get 403 and their 7 provider users are deleted; hook SQL returns 403 when full and `{}` when open | Pass (`runtime.test.ts`, `supabaseSignIn.service.test.ts`) | 674ef5f |
| E-22 | B | Wallet handoff (app path): code only with the right PKCE verifier, spent once, typed with spaces/lower case accepted, expired codes release their provider user unless the same wallet has a newer or spent code; same on real Postgres | Pass | 8dfecd2 |
| E-23 | M | `mobile`: `npx tsc --noEmit`, `yarn test` (inventory regenerated), `npx expo export -p android` | **904/904**; Hermes bundle builds (4.4 MB) with expo-web-browser and expo-crypto. New tests: RFC 7636 PKCE vectors, exact redirect matching, code alphabet shared with the server, publishable-key-only config, store commit/cancel/error/one-at-a-time | 40ea135 |
| E-24 | P | `evidence/web-sign-in-deletion-e2e.mjs`: Chromium + built API + real Postgres + a local HTTPS stand-in for Supabase Auth. Google sign-in on the deletion page (PKCE redirect, token exchange, Supabase session signed out) → delete; wallet-only account (no email) signs in with an injected key → delete; both provider users deleted; the page asked the wallet only for `eth_requestAccounts` and `personal_sign`; `/sign-in/` handoff code works only with the app verifier and once; all four public pages fit 320 px. Screenshots in `evidence/screens/` | **23/23 pass** | dbeed8d |
| E-25 | M | Shared: `yarn test` | 156/156 | dbeed8d |

## Recorded 2026-10-13, second session

| ID | Gate | What was run | Result | Commit |
|---|---|---|---|---|
| E-26 | B, M, P | Re-run of every suite on a fresh checkout of 991ac6a before any change (PostgreSQL 16, Chromium 1194) | Backend 397/397, API 10/10 (after `yarn build`; without a build the runtime test fails because `dist/api.cjs` is missing), shared 156/156, mobile 904/904, website 23/23. Matches the earlier session's claims | 991ac6a |
| E-27 | B | Email codes unwired from the hosted API: `createApiApp` builds no email delivery and never mounts `/identity/auth/email/*`; `RESEND_API_KEY` no longer changes config validation. `runtime.test.ts` now starts the built API **with** `RESEND_API_KEY` and `IDENTITY_EMAIL_FROM` set and gets 404 from both email routes | Backend 397/397, API 10/10 (3 runs) | 728165e |
| E-28 | M, P | Sleeping free host. App: sign-in requests (Google complete, wallet exchange) time out after 90 s with `request_timeout` and store nothing; the sign-in block sends one unauthenticated `GET /health` when it appears; new copy for the timeout (`signInTimeout.test.ts`, 4 tests). Website: same wake-up on page load and a 90 s limit on API calls with its own message, checked in Chromium against an API that never answers (`evidence/web-cold-host-check.mjs`, timer shortened) | Mobile 908/908, typecheck clean, `npx expo export -p android` builds the Hermes bundle (4.4 MB); web check 3/3; website e2e 23/23 re-run on the changed script | 1f69dfc |

## Evidence level by capability

Levels: **implemented** → **locally tested** (tests or browser here, providers
replaced by stand-ins) → **hosted tested** (real Supabase + Render) → **APK
handset tested** → **Play-installed tested**. Nothing above "locally tested"
has been run for sign-in yet.

| Capability | Level reached | Next level blocked by |
|---|---|---|
| Continue with Google (app) | Locally tested (E-23; server side E-19, E-20) | X-05, X-06, X-08 (hosted), X-04, X-10 (APK) |
| Continue with Google (web deletion page) | Locally tested (E-24) | X-05, X-06, X-21 |
| Continue with Wallet (app, via wallet browser + code) | Locally tested (E-22, E-23, E-24) | X-05, X-06, X-21, then X-10 with a real wallet app. **Device proof due 24 Oct (D-19)** |
| Wallet sign-in on the web deletion page | Locally tested (E-24) | X-05, X-06, X-21 |
| 1,000-account cap and hook | Locally tested (E-21) | X-06, X-07 |
| Account deletion, both methods, provider user removal | Locally tested (E-21, E-24) | Hosted: X-06; handset: X-10 |
| Sign-in when the free API is asleep (wake-up, 90 s limit, retry copy) | Locally tested (E-28) | Hosted: X-06; handset: X-10 step 15g |
| Email codes unreachable on the hosted API | Locally tested (E-27) | Hosted: X-06 (check `/identity/auth/email/begin` answers 404) |
| Verified movement | Locally tested (E-13, runtime test) | Hosted: X-06; handset: X-10 |
| Play internal test install | Blocked | X-01, X-09, X-11, X-12, X-14 |

## Not yet run (blocked externally)

| Gate | Needed evidence | Blocker |
|---|---|---|
| M | Preview APK on a physical phone, `HANDSET_TEST_SCRIPT.md` steps 1–15f, 18–20 (Google, wallet with a real wallet app, deletion) | X-04, X-08, X-10 |
| B | Hosted API `/health` and `/ready`, real Google and wallet sign-in through Supabase, hook at the cap, two-account check | X-05, X-06, X-07 (runbook: `HOSTING_SUPABASE_FREE.md`) |
| R | Production AAB from the release commit, merged manifest of the AAB, 16 KB page size and 64-bit check (Play Console App bundle explorer) | X-08, X-09 |
| R | Play internal test install, Google map tiles with the Play App Signing SHA-1, steps 15–17 | X-11, X-12 |
| G | Phone screenshots from the Play-bound build | X-13 |
| L | 48-hour monitoring record after a Play release | X-16, `POST_LAUNCH_MONITORING.md` |
