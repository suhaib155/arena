# Task register

Prefixes: **M** mobile, **B** backend and auth, **P** privacy and deletion,
**A** store assets, **R** release build and signing, **QA** device testing,
**O** operations.

States (exactly one): **DONE** · **BLOCKED_OWNER** (needs an owner action in
`EXTERNAL_ACTIONS.md`) · **BLOCKED_PROVIDER** (needs Google, Supabase, Expo or
Play to act or be reachable) · **BLOCKED_CODE** (engineering left to do) ·
**DEFERRED** (not in v1, by decision).

## 20-day plan (owner decision 2026-10-13, target 2 Nov 2026)

| Days | Work | State |
|---|---|---|
| 13–15 Oct | Decisions and data model | DONE (D-16–D-23, migrations 0007–0008) |
| 16–18 Oct | Providers, JWT, admission | Code DONE early (E-19–E-22). Live provider setup BLOCKED_OWNER (X-05–X-07) |
| 19–21 Oct | Native flows and deletion | Code DONE early (E-23, E-24). Hosted run BLOCKED_OWNER (X-06, X-08, X-21) |
| 22–24 Oct | Device gate | BLOCKED_OWNER (X-04, X-10). Wallet must be proven on a phone by 24 Oct (D-19) |
| 25–27 Oct | Adversarial tests | Local adversarial set DONE (replay, tampering, wrong verifier, cap rush, expiry, forged tokens). Hosted repeat BLOCKED_OWNER |
| 28–29 Oct | PR and AAB | PR text ready; merge and AAB BLOCKED_OWNER (X-14, X-09) |
| 30 Oct–2 Nov | Play internal testing, GO/NO-GO | BLOCKED_OWNER (X-01, X-11, X-12) |

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
| B-18 | Linking Google and wallet to one account | DEFERRED | D-17; owner acceptance X-20 |
| P-01 | Data inventory | DONE | `DATA_INVENTORY.md` (Google, wallet, Supabase) |
| P-02 | Privacy policy page | DONE | `website/privacy/` |
| P-03 | Web account deletion with Google or wallet (works for wallet-only accounts) | DONE (locally tested) | E-24 |
| P-04 | Support page | DONE | `website/support/` |
| P-05 | Fill public placeholders | BLOCKED_OWNER | Contact and name done; API URL and publishable key exist only after X-06, X-21 |
| P-06 | Deploy the website at `movenrun.xyz`, check every URL loads without sign-in | BLOCKED_OWNER | X-21 |
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
| QA-03 | Handset script on the Play internal test install | BLOCKED_OWNER | X-12 |
| O-01 | Play Console app, declarations, listing | BLOCKED_OWNER | X-11 |
| O-02 | Closed test (12 testers, 14 days) if the account requires it | BLOCKED_OWNER | X-01, X-15 |
| O-03 | Production release and rollout | BLOCKED_OWNER | X-16 |
| O-04 | 48-hour monitoring plan (now with capacity alerts and sign-in checks) | DONE | `POST_LAUNCH_MONITORING.md` |
| O-05 | Run and record the 48-hour monitoring | BLOCKED_OWNER | X-18, after X-16 |
