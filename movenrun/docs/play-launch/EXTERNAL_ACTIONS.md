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
| X-04 | **REVISED 31 Oct (owner): supersedes the 02d8ca9 approval. Exactly one EAS preview APK from `ac8d87bed55f4dae0b9152ed21fa8cc29b8050f9`, API staging, only if prerequisites verified; EAS access missing here, so not started; exact owner steps in OWNER_RUN_SHEET_31OCT.md.** Superseded text: APPROVED 30 Oct 14:02Z (owner): exactly one EAS preview APK from `02d8ca937a04fc6533d3c77bf06e135c61391b96`, API `https://movenrun-staging-api.onrender.com`, conditional on verified restricted Maps key, signing configuration, environment variables, remaining build quota and pre-build checks; handset checklist afterward; movement tests needing newer server rules marked BLOCKED; no Play submission, no additional builds. NOT YET RUN: this environment has no EAS/Expo credentials or CLI, so the build and the pre-build verification of those conditions need the owner or tooling with EAS access.** Original text: APPROVAL to trigger **one EAS APK Build** (preview profile) of the verified candidate #125 at `15f7f87` (E-87), or of `release/android-v1-cxfdbd` once #125 is in it, from the Actions tab, after X-05 and X-08a. Uses the free EAS build quota | Device gate (22–24 Oct) |

## Supabase and hosting (order: X-06, then X-07, then X-05, then X-21)

| ID | Action |
|---|---|
| X-05 | **READY FOR THE OWNER, NOT ENABLED (18 Oct 19:35Z, E-86).** Dashboard steps sent about 14:08Z; live state still 0 users. After "Google on", the live checks run (signup, hook row X-07b, replay refused, deletion); then wallet. Earlier: READY (18 Oct, E-85). X-21 is live (E-79) and the automated preflight passes; nothing is enabled. The owner does the dashboard steps below, one provider at a time (Google first, then wallet), with the checks in `X05_PROVIDER_ENABLEMENT_PREFLIGHT.md` after each. Earlier: blocked on X-21 (17 Oct, E-69, E-70). **APPROVAL (providers)**: preflight, checks and rollback in `X05_PROVIDER_ENABLEMENT_PREFLIGHT.md`. In project `movenrun` only, follow `HOSTING_SUPABASE_FREE.md` §2: Google OAuth client in Google Cloud (scopes openid, email, profile) with redirect `https://tavxmwuwkeynbnzfwove.supabase.co/auth/v1/callback`, client id and secret entered **only** in Supabase; enable **Web3 Wallet → Ethereum**; Redirect URLs `movenrun://auth/callback`, `https://movenrun.xyz/sign-in/`, `https://movenrun.xyz/account-deletion/`; Email provider off, anonymous sign-ins off, manual linking off; Web3 rate limit **left at the default 30 per 5 minutes** (do not raise it; see `AUTH_SECURITY_REVIEW.md` F-05). **Do this last: only after X-06 and X-07**, so no sign-in user is created before the hook checks it. The Google OAuth client can be prepared earlier |
| X-06 | **DONE — LIVE VERIFIED 2026-10-14 (E-41):** `movenrun-staging-api` live at dd83065, `/health` and `/ready` 200, migration hashes 0000–0009 match, RLS on, no Data API schema. Original instruction kept below. **APPROVED by the owner 2026-10-13.** This workspace cannot reach Render or Supabase and holds none of their credentials, so you run it: deploy branch `deploy/render-free-staging` at `dd8306588667342fab2db0ebd4d55632acadb57a`, click by click in `LIVE_SETUP_OPERATOR_GUIDE.md` gate X-06: CA download, Data API off, session pooler, Render Blueprint on the Free plan with **no payment method**, `DATABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` and the CA secret file set in Render. The first start applies migrations 0000–0009 to the live database. Then prove `/health`, `/ready`, the migration hashes and RLS |
| X-07 | **DONE 2026-10-16 (attached)**: Before User Created → `public.movenrun_before_user_created`, enabled by the owner after X-26 closed; permissions and limits re-checked read only (E-45). Remaining: invocation proof X-07b inside the X-05 window |
| X-21 | **DONE, LIVE VERIFIED 18 Oct (E-79).** Owner promoted in the Vercel dashboard; production dpl_ABCfgjsFiJ4DHtRnrLPCc8npLAuD (61d30bb), rollback dpl_1pNg2cyGZ4MLWuqfsSHBtU9P1KBf. Earlier text kept: **Conditionally approved 17 Oct; release 61d30bb ready (E-74).** Open: send one outside email to info@movenrun.xyz and confirm receipt; the Vercel daily limit must have room for the promote. Then promote preview dpl_B78x3Xc9ySbs2Jzpy8mkE7pPpAxi and verify live; rollback to dpl_1pNg2cyGZ4MLWuqfsSHBtU9P1KBf. **HELD: review the four page previews first** (`WEBSITE_REVIEW_PREVIEW.md`). Then point **`movenrun.xyz`** at the Vercel project for `movenrun/website` (Vercel → Domains, then the DNS records it shows). Wallets compare the sign-in message's domain with the page they show; it must be `movenrun.xyz`. Then fill `{{API_BASE_URL}}` and `{{SUPABASE_PUBLISHABLE_KEY}}` and run `node scripts/check-launch-placeholders.mjs`. Make `movenrun.xyz` the primary domain with `www` redirecting to it (`OWNER_DECISIONS_PRIVACY_REPO_DOMAIN.md` §3); today the apex redirects to `www`, where the API refuses calls (E-49) |
| X-22 | Make sure `info@movenrun.xyz` receives mail (it is the public contact on the website, the Google consent screen and Play) |
| X-24 | **DONE, LIVE VERIFIED 17 Oct (E-55).** Owner granted X-24 only; `deploy/render-free-staging` fast-forwarded dd83065 → 7f4c0d4 (#111 head), deployed by the owner's operator (Render `dep-db9gqfrbc2fs73do581g`, auto-deploy off). No new migration (0000–0009). Open: the client-address check from two independent client networks. Rollback steps stay in `X24_DEPLOY_CANDIDATE.md` |
| X-28 | Delete the scratch branch `ops/two-network-check` (b23c31e) in GitHub; this workspace cannot delete refs |
| X-29 | Vercel quota: each push builds 5 projects. In Vercel → `movenrun-website` → Settings → Git → Ignored Build Step, choose "Custom" and enter `sh ../ops/vercel/ignored-build.sh \|\| exit 1` (needs #128 merged into the branch Vercel builds; root directory stays `movenrun/website`; the script fails open, so an error still builds). Then disconnect Git for `arena`, `arena-pchb` and `arena-qg9n` (failing since 9 Sep, unused, E-95). Hold `arena-vv61` until you confirm it serves nothing. Production stays on dpl_ABCfgjsFiJ4DHtRnrLPCc8npLAuD. Path verified read-only on 23 Oct (E-100): Root Directory `movenrun/website`, "Include files outside the root directory" ON, so `../ops/vercel/` is present in the build checkout; the ignored-build command is still unset. On a branch without #128 the script is missing, `sh` fails and `\|\| exit 1` builds, so it fails open. The 18 Oct one-liner `git diff --quiet HEAD^ HEAD -- .` is revoked. **23 Oct (E-115):** the Hobby limit of 100 deployments per day was reached on `arena`, then on `movenrun-website`, `arena-pchb`, `arena-qg9n` and `arena-vv61`; previews fail, production untouched. Delete no project, deployment or DNS record | Build quota |
| X-30 | **CLEARED 29 Oct (E-121).** Owner confirmed by names only that `SUPABASE_LEGACY_JWT_SECRET` and `SUPABASE_JWT_SECRET` are absent from the Render environment | Closed |
| X-31 | **DECISION (gameplay, not needed for Play v1):** (a) keep, loosen or drop the 4x path-to-ground drift rule in #154, which also rejects honest small-loop laps such as a 400 m track at 5.5 m/s; (b) 1003B take budget at 3 or 5 per day (#149, re-run after #152); (c) sealing v2 thresholds (#168: 2,000 m² area, retrace share 0.2, width max(20 m, 2× accuracy); parallel sidewalks 20 m apart seal in 50% of noisy seeds); (d) erasure tombstone retention, checked resume and legal hold for settlement (#167); (e) a rolling-window valve cap for the contracts research (#147, #163); (f) stationary-risk rule #166 on or off for QA0. 0011 hashes are now up 709ff82a… and down 276cd12b… (E-120), superseding e3f355a9… and c134da41… | Gameplay pilot preparation |
| X-32 | **APPROVED 30 Oct (owner): exception to 21 Nov 2026, reassess by 14 Nov, no automatic extension; amendment text in DEP_EXC_2026_001_AMENDMENT_30OCT.md, sign-off blank.** Was:  accept, amend or reject dependency exception DEP-EXC-2026-001 (#131, `decode-uri-component` via `query-string@7.1.3`) before its 21 Nov 2026 expiry | Android candidate dependency review |
| X-33 | **CONSUMED 30 Oct 12:49:57Z (owner approved, single retry done; dep-dbi94de1egvs73f8ns5g at efd381b live; no second deploy without a new approval; hosted smoke tests not run).** Original text:  The first approved deployment failed on a paused Supabase project (E-122). Supabase is healthy again and the deploy branch is at `efd381b` (E-123). A new single-deployment authorization for the same commit is needed | Security staging candidate #162 |
| X-34 | **DECIDED 29 Oct (owner): option (a), documented source-correctness fix; implemented and merged as #176 (E-127). Rule 1001 unchanged, rule 1002 disabled.** | Gameplay pilot preparation |
| X-27 | **DONE, LIVE VERIFIED 17 Oct (E-62).** Owner approved one staging deploy of #112 at 2192de6 with migration 0010. `deploy/render-free-staging` fast-forwarded 7f4c0d4 → 2192de6; Render `dep-db9m51qjnfac73cqh6eg`, auto-deploy off, migration through the start command only. SQL check done 17 Oct (E-63: 11 migrations, every table with RLS, caps 1,000 and 50/h). Open: the two-network client-address check before X-05. Rollback: Render → Rollback to `dep-db9gqfrbc2fs73do581g` (7f4c0d4); no database step |
| X-25 | **DECISION — UNDECIDED (security log retention)**: `security_audit_events` is kept until the account is deleted, about 1.2 MB a day for 1,000 hourly players (E-39). Proposed matrix: routine refresh rows 30 days, security-relevant rows 180 days, anonymous deletion row kept (`product-roadmap/PR_QUEUE.md` §X-25). No retention period is promised publicly and nothing is deleted until you decide |
| X-26 | **DONE 2026-10-16 (incident closed)**: legacy JWT secret revoked, ECC (P-256) key current, legacy API keys disabled, Render legacy variable removed; checks V1–V6 passed (`X26_SIGNING_KEY_RUNBOOK.md` §6, E-45) |

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
