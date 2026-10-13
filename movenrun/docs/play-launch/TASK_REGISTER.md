# Task register

Prefixes: **M** mobile, **B** backend and auth, **P** privacy and deletion,
**A** store assets, **R** release build and signing, **QA** device testing,
**O** operations.

States (exactly one): **DONE** · **BLOCKED_OWNER** (needs an owner action in
`EXTERNAL_ACTIONS.md`) · **BLOCKED_PROVIDER** (needs Google, Supabase, Expo or
Play to act or be reachable) · **BLOCKED_CODE** (engineering left to do) ·
**DEFERRED** (not in v1, by decision).

**Frontend hold (D-25, owner 2026-10-13):** no mobile UI, screen, visual,
navigation or design work until the owner's next design brief. M-tasks below
that are DONE stay as they are; no new M-task is started.

## 20-day plan (owner decision 2026-10-13; 2 Nov 2026 is the engineering and pre-listing target, not a Play date, D-24)

| Days | Work | State |
|---|---|---|
| 13–15 Oct | Decisions and data model | DONE (D-16–D-23, migrations 0007–0009) |
| 16–18 Oct | Providers, JWT, admission | Code DONE early (E-19–E-22). Live provider setup BLOCKED_OWNER (X-05–X-07) |
| 19–21 Oct | Native flows and deletion | Code DONE early (E-23, E-24). Hosted run BLOCKED_OWNER (X-06, X-08, X-21) |
| 22–24 Oct | Device gate | BLOCKED_OWNER (X-04, X-10). Plan: `ANDROID_DEVICE_GATE_PLAN.md`. Wallet must be proven on a phone by 24 Oct (D-19) |
| 25–27 Oct | Adversarial tests | Local set DONE (replay, tampering, wrong verifier, cap rush, quota burst, hook concurrency, sweep race, forged tokens). Hosted repeat BLOCKED_OWNER |
| 28–29 Oct | PR and AAB | PR text ready; merge and AAB BLOCKED_OWNER (X-14, X-09) |
| 30 Oct–2 Nov | Pre-listing complete | Engineering, operator guides, declarations and listing material DONE. Play Console steps wait on X-01 (account NOT CREATED) |
| After 2 Nov | Play | X-01b registration and verification, X-12 internal test; if Personal, X-01c 14-day closed test and production access. No date promised |

## Tasks

| ID | Task | State | Evidence / blocker |
|---|---|---|---|
| M-01 | Integrate the SDK 54 stack (#102–#105) on one release branch | DONE | E-01 |
| M-02 | Freeze Play v1 scope: hide Clubs, competition, Deeds, wallet management; route guard; tests | DONE | E-05, `FEATURE_MATRIX.md` |
| M-03 | Remove economy and ownership wording from reachable copy | DONE | 83685ac, a18a196 |
| M-04 | Delete account in Account security | DONE | E-10 |
| M-05 | Show the account's verified sessions after sign-in / reinstall | DONE | E-13 |
| M-06 | Release config: EAS production profile, remote version codes, permission removal | DONE | E-07 |
| M-07 | Hermes export check in mobile CI | DONE | 626f3c0 |
| M-08 | Restore local XP and streaks from the server after reinstall | DEFERRED | D-07 |
| M-09 | "Continue with Google" in the app (Supabase PKCE in the system browser, exact redirect, Supabase session signed out after) | DONE (locally tested) | E-23, 40ea135 |
| M-10 | "Continue with Wallet" in the app (wallet's browser + PKCE-bound one-time code, link back or typed) | DONE (locally tested) | E-22–E-24, D-19 |
| M-11 | Remove the email code form from first run and Account; guest play kept | DONE | 40ea135 |
| M-12 | In-app legal and account copy for Google and wallet; legal version bumped so testers accept the new policy | DONE | dbeed8d |
| M-15 | Sign-in method switch (`SIGN_IN_METHODS`): turning wallet off hides the button and disarms the return link, the fallback for WALLET_LOGIN_BLOCKED. Both stay on | DONE (locally tested) | E-30 |
| M-16 | App copy: enter only a code from the page you just opened; `registration_busy` message keeps guest play open | DONE (locally tested) | E-30 |
| M-14 | Sign-in survives a sleeping free host: wake-up call when sign-in is shown, 90 s limit, retry copy (app and website) | DONE (locally tested) | E-28 |
| M-13 | Prove Google and wallet sign-in on a phone with the preview APK | BLOCKED_OWNER | X-04, X-05, X-06, X-08, X-10. Due 24 Oct |
| B-01 | Hard account erasure endpoint | DONE | E-09 |
| B-02 | Reviewer sign-in through server secrets | DEFERRED | Withdrawn by D-21 (code removed) |
| B-03 | `GET /movement/verifications` | DONE | E-13 |
| B-04 | Remove an unused SDK dependency | DONE | 915727b |
| B-05 | Provision hosting, run migrations, set secrets | BLOCKED_OWNER | X-06 (approval to apply migrations to the live database) |
| B-06 | Real email delivery | DEFERRED | D-16 (email codes are not a v1 requirement) |
| B-07 | Shared rate limiter across instances | DEFERRED | One free instance in v1 |
| B-08 | Row level security on every table | DONE | E-18 |
| B-09 | Verified TLS to a managed Postgres | DONE | E-17 |
| B-10 | No-cost hosting runbook (Supabase + Render Free) | DONE | `HOSTING_SUPABASE_FREE.md`, `render.yaml` |
| B-11 | Verify Supabase access tokens (JWKS ES256/RS256, issuer, audience, role, expiry) | DONE | E-20 |
| B-12 | Google sign-in exchange `POST /identity/auth/google/complete` | DONE | E-19, E-20 |
| B-13 | Wallet sign-in `begin` / `complete` (server-written EIP-4361, single use, EOA only) | DONE | E-20, D-18 |
| B-14 | Wallet handoff to the app `complete {handoffChallenge}` + `exchange` | DONE | E-22 |
| B-15 | 1,000-account cap: atomic admission, hook, alerts at 80/90/95/100 %, orphan cleanup | DONE | E-21, D-20 |
| B-16 | Remove reviewer code and email delivery from v1 requirements | DONE | 674ef5f |
| B-17 | Enable Google and Web3 providers, redirect list, rate limit, hook in Supabase | BLOCKED_OWNER | X-05, X-07 (approval to enable providers) |
| B-18 | Linking Google and wallet to one account | DEFERRED | D-17, accepted by the owner 2026-10-13 (X-20) |
| B-20 | Hourly new-account quota (default 50) in the Supabase hook and the API admission transaction, migration 0009 (F-01) | DONE (tested with stand-in, real PostgreSQL) | E-29 |
| B-21 | Sweep of unused Supabase sign-in users older than an hour (F-03) | DONE (tested with stand-in) | E-29 |
| B-22 | Provider refusals keep their meaning (403 cap, 429 quota/rate limit); Google route requires a Google session (F-08, F-09) | DONE (tested with stand-in) | E-29 |
| B-23 | Security review and wallet provider decision | DONE | `AUTH_SECURITY_REVIEW.md`, `WALLET_AUTH_PROVIDER_DECISION.md` |
| B-24 | Orphan sweep: re-read each user before deleting, at most 100 deletions a run, one run at a time (F-14, D-28) | DONE (tested with stand-in) | E-32 |
| B-25 | Token check refuses `crit` headers and future `nbf`; audit of JWKS, claims, PKCE, nonces, codes, refresh (F-13) | DONE | E-32, `AUTH_SECURITY_REVIEW.md` round 3 |
| B-26 | Hook contract on PostgreSQL: privileges, return shape, concurrency, cap, quota, deletion, fail-closed | DONE | E-32 |
| B-27 | Migration checksum lock and journal check; inventory, rollback and rescue plan | DONE | E-32, `LIVE_SETUP_OPERATOR_GUIDE.md` |
| B-28 | Secret scan script (tracked files, history, built folders) and CI step | DONE | E-33 |
| B-29 | `Cache-Control: no-store` on every identity response (F-15) | DONE | E-32 |
| B-30 | Operator guide with proof commands per gate (X-06 → X-07 → X-05 → X-21 → X-08/X-04), backup/export, RLS, TLS and Data API proofs | DONE | `LIVE_SETUP_OPERATOR_GUIDE.md` |
| B-31 | Verified App Link return (F-06 safer callback) | BLOCKED_OWNER | Design only; needs app change (D-25), X-21, signing certificate, X-23 |
| B-19 | Email codes cannot be switched on in the hosted API by an environment variable; `RESEND_API_KEY` and `IDENTITY_OTP_PEPPER` play no part in config | DONE | E-27 |
| P-01 | Data inventory | DONE | `DATA_INVENTORY.md` (Google, wallet, Supabase) |
| P-02 | Privacy policy page | DONE | `website/privacy/` |
| P-03 | Web account deletion with Google or wallet (works for wallet-only accounts) | DONE (locally tested) | E-24 |
| P-04 | Support page | DONE | `website/support/` |
| P-05 | Fill public placeholders | BLOCKED_OWNER | Contact and name done; API URL and publishable key exist only after X-06, X-21 |
| P-06 | Deploy the website at `movenrun.xyz`, check every URL loads without sign-in | BLOCKED_OWNER | X-21 |
| P-11 | Website: EIP-6963 wallet discovery and chooser; API error codes read correctly; anti-phishing copy on `/sign-in/` (F-04, F-06, F-07) | DONE (tested in Chromium with stand-ins) | E-31 |
| P-12 | Website security headers (`vercel.json`: no framing, nosniff, no-referrer, HSTS, permissions) (F-10) | DONE; live once X-21 | — |
| P-07 | Wallet sign-in page `/sign-in/` for the app | DONE (locally tested) | E-24 |
| P-10 | Purge expired OTP rows | DONE | E-16 |
| A-01 | App icon, adaptive icon, monochrome icon, splash | DONE | E-14 |
| A-02 | Play icon 512 and feature graphic | DONE | E-14 |
| A-03 | Store listing text | DONE | `STORE_LISTING.md` (sign-in wording updated) |
| A-04 | Phone screenshots | BLOCKED_OWNER | X-13 |
| R-01 | Production AAB workflow with release gates | DONE | `.github/workflows/eas-production-aab.yml` |
| R-02 | EAS environment variables (API, Supabase URL and publishable key, Maps key) | BLOCKED_OWNER | X-08 |
| R-03 | Build the AAB | BLOCKED_OWNER | X-09, X-14 |
| R-04 | Check the AAB's merged manifest, 64-bit and 16 KB | BLOCKED_PROVIDER | Needs the Play App bundle explorer after X-12 |
| R-05 | Play App Signing SHA-1 on the Maps key | BLOCKED_OWNER | X-08, X-11 |
| QA-01 | Handset script on the preview APK (both sign-in methods, verified movement, deletion) | BLOCKED_OWNER | X-04, X-10 |
| QA-02 | Two-account and cap check on the hosted API | BLOCKED_OWNER | B-05, B-17 |
| QA-04 | On the phone: does each wallet's browser hand `movenrun://` back to the app; would a verified App Link for the return work there (F-06 residual); handset step 15h | BLOCKED_OWNER | X-10 |
| QA-03 | Handset script on the Play internal test install | BLOCKED_OWNER | X-12 |
| O-01 | Play Console app, declarations, listing | BLOCKED_OWNER | X-11 |
| O-02 | Closed test (12 testers, 14 days) if the account is Personal | BLOCKED_OWNER | X-01c, X-15 |
| O-06 | Play registration and pre-listing checklist | DONE | `PLAY_REGISTRATION_CHECKLIST.md` |
| O-07 | Register the Play developer account | BLOCKED_OWNER | X-01a, X-01b (NOT CREATED) |
| QA-05 | Device gate plan with pass rules | DONE | `ANDROID_DEVICE_GATE_PLAN.md` |
| M-17 | Any further app UI, screen or navigation change | DEFERRED | Frontend hold (D-25) |
| O-03 | Production release and rollout | BLOCKED_OWNER | X-16 |
| O-04 | 48-hour monitoring plan (now with capacity alerts and sign-in checks) | DONE | `POST_LAUNCH_MONITORING.md` |
| O-05 | Run and record the 48-hour monitoring | BLOCKED_OWNER | X-18, after X-16 |
