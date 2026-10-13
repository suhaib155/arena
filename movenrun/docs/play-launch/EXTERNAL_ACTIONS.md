# External actions for the owner

Everything here needs a person, an account, an approval, a phone, or Google.
Each item says exactly what to do and what it unblocks. Never paste passwords,
client secrets, keys, recovery phrases or private keys into chat or into the
repository; set them in the dashboard named.

Status: **OPEN** unless marked otherwise. Items marked **APPROVAL** change a live
service and wait for the owner's explicit go.

## Decisions and information

| ID | Action | Unblocks |
|---|---|---|
| X-01 | **NOT CREATED — OWNER REGISTRATION PENDING** (owner, 2026-10-13: no Play developer account exists yet). Split into X-01a–c below. Steps and documents: `PLAY_REGISTRATION_CHECKLIST.md` | Everything in Play Console (X-11, X-12, X-15, X-16) |
| X-01a | Choose the account type that is **true for you**: **Personal** if MovenRun is not a registered legal entity with a D-U-N-S number; **Organization** only if it is one and you can prove it. Never register as an organization to avoid the testing rule | X-01b |
| X-01b | **APPROVAL (spending US$25)**: register at play.google.com/console/signup, pay the one-time US$25 fee, and complete identity, contact and device verification. Google's verification can take several days | X-11, X-12 |
| X-01c | **If Personal:** run a **closed test with at least 12 testers opted in for 14 continuous days**, then apply for production access in Play Console and wait for Google's answer. Not needed for Organization accounts. Internal testing (X-12) works before this | X-16 |
| X-02 | **ANSWERED 2026-10-13**: developer name "Team MovenRun", contact `info@movenrun.xyz`. Filled in on every public page | — |
| X-03 | **ANSWERED 2026-10-13**: free tier only. Supabase Free project `movenrun` (`tavxmwuwkeynbnzfwove`) + Render Free (`render.yaml`, `HOSTING_SUPABASE_FREE.md`) | — |
| X-20 | **ANSWERED 2026-10-13**: owner replied "accept separate accounts". D-17 accepted: Google and wallet sign-ins create separate accounts in v1, no linking | — |
| X-04 | **APPROVAL** to trigger **EAS APK Build** (preview profile) on `release/android-v1-cxfdbd` from the Actions tab, after X-05 and X-08a. Uses the free EAS build quota | Device gate (22–24 Oct) |

## Supabase and hosting (order: X-06, then X-07, then X-05, then X-21)

| ID | Action |
|---|---|
| X-05 | **APPROVAL (providers)**: in project `movenrun` only, follow `HOSTING_SUPABASE_FREE.md` §2: Google OAuth client in Google Cloud (scopes openid, email, profile) with redirect `https://tavxmwuwkeynbnzfwove.supabase.co/auth/v1/callback`, client id and secret entered **only** in Supabase; enable **Web3 Wallet → Ethereum**; Redirect URLs `movenrun://auth/callback`, `https://movenrun.xyz/sign-in/`, `https://movenrun.xyz/account-deletion/`; Email provider off, anonymous sign-ins off, manual linking off; Web3 rate limit **left at the default 30 per 5 minutes** (do not raise it; see `AUTH_SECURITY_REVIEW.md` F-05). **Do this last: only after X-06 and X-07**, so no sign-in user is created before the hook checks it. The Google OAuth client can be prepared earlier |
| X-06 | **APPROVAL (database)**: deploy branch `deploy/render-free-staging` at `dd8306588667342fab2db0ebd4d55632acadb57a`, click by click in `LIVE_SETUP_OPERATOR_GUIDE.md` gate X-06: CA download, Data API off, session pooler, Render Blueprint on the Free plan with **no payment method**, `DATABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` and the CA secret file set in Render. The first start applies migrations 0000–0009 to the live database. Then prove `/health`, `/ready`, the migration hashes and RLS |
| X-07 | After X-06: Supabase → Authentication → **Hooks → Before User Created** → Postgres function `public.movenrun_before_user_created` (§3). Run the read-only checks, then the hook-invocation proof (quota set to 0 for one refused sign-in, then restored) in `LIVE_SETUP_OPERATOR_GUIDE.md` gate X-07 |
| X-21 | Point **`movenrun.xyz`** at the Vercel project for `movenrun/website` (Vercel → Domains, then the DNS records it shows). Wallets compare the sign-in message's domain with the page they show; it must be `movenrun.xyz`. Then fill `{{API_BASE_URL}}` and `{{SUPABASE_PUBLISHABLE_KEY}}` and run `node scripts/check-launch-placeholders.mjs` |
| X-22 | Make sure `info@movenrun.xyz` receives mail (it is the public contact on the website, the Google consent screen and Play) |

## Build and signing

| ID | Action |
|---|---|
| X-08 | Expo dashboard → project → Environment variables, **preview** and **production**: `EXPO_PUBLIC_API_URL` (the Render URL), `EXPO_PUBLIC_SUPABASE_URL=https://tavxmwuwkeynbnzfwove.supabase.co`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (publishable key only), `GOOGLE_MAPS_ANDROID_API_KEY`. In Google Cloud restrict the Maps key to Android apps, package `io.movenrun.app`, with the SHA-1 of the EAS upload key and, after the first upload, the **Play App Signing** SHA-1. Restrict the API to Maps SDK for Android |
| X-09 | GitHub → Settings → Environments: create **`play-release`** with yourself as required reviewer. Confirm the `EXPO_TOKEN` Actions secret exists. After the merge, run **EAS Production AAB** with confirm `build` |
| X-14 | **APPROVAL (merge)**: review `PR_DESCRIPTION.md` and merge `release/android-v1-cxfdbd` into `main` with **Squash and merge** using that title and text. Two older commits from integrated pull requests (baf57c8, merge 9fa7a70) carry tool attribution; squashing keeps them out of `main` without rewriting the pushed branch |

## Phone and Play Console

| ID | Action |
|---|---|
| X-10 | Install the preview APK on an Android phone with **MetaMask, Coinbase Wallet or Trust Wallet** installed (any one; no funds needed) and run `HANDSET_TEST_SCRIPT.md` outdoors, including steps 15a–15h (Google, wallet, deletion, cold start, F-06). **By 24 Oct** (D-19). Plan and pass rules: `ANDROID_DEVICE_GATE_PLAN.md` |
| X-11 | **APPROVAL (Play Console)**, after X-01b: create the app (MovenRun, Game, Free) and complete App content from `PLAY_CONSOLE_WORKSHEET.md` (including the blockchain question: wallet sign-in only, no tokens or transactions) and the listing from `STORE_LISTING.md`. You accept the declarations yourself |
| X-12 | **APPROVAL (internal testing)**: upload the AAB to Internal testing, add yourself, install from Play and run handset steps 15a–17. Check the App bundle explorer for 64-bit libraries and 16 KB page size |
| X-13 | Capture 2–8 phone screenshots from the Play-installed build per `STORE_LISTING.md` |
| X-15 | X-01c: if the account is Personal, the closed test (12 testers, 14 continuous days) and the production-access application. Production cannot start before Google grants it, so no Play availability date is promised |
| X-16 | **APPROVAL (publish)**: production release, staged rollout, you press **Publish** |
| X-18 | For 48 hours after the release, run `POST_LAUNCH_MONITORING.md` and fill its record table |

## For later approval (not needed for the device gate)

| ID | Action |
|---|---|
| X-23 | Decide whether to move the app's sign-in return to a **verified HTTPS App Link** (`https://movenrun.xyz/auth/...` plus `/.well-known/assetlinks.json` with the Play App Signing SHA-256) to close the F-06 interception path. Design and test plan in `AUTH_SECURITY_REVIEW.md` §F-06 safer callback. Needs app changes (frontend hold), X-21 and the signing certificate, so it waits for the phone result (QA-04) and your go |

## Workspace (optional)

| ID | Action |
|---|---|
| X-17 | To let future sessions reach Expo, Google and Supabase directly, add `expo.dev`, `api.expo.dev`, `exp.host`, `dl.google.com` and `tavxmwuwkeynbnzfwove.supabase.co` in Project settings → environment → Network access. Not required: every step above works from the dashboards |

## Withdrawn by the 2026-10-13 decision

Resend domain verification and email delivery (old X-06), reviewer email and
code secrets (old X-07), `IDENTITY_OTP_PEPPER`, and the paid Render plans.
