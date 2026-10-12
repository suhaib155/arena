# External actions for the owner

Everything here needs a person, an account, a payment decision, a phone, or
Google. Each item says exactly what to do and what it unblocks. Never paste
passwords, tokens or keys into chat or into the repository; set them in the
dashboard named.

Status: **OPEN** unless marked otherwise.

## Decisions and information

| ID | Action | Unblocks |
|---|---|---|
| X-01 | Tell us the **Play developer account type** (personal or organisation) and the **date it was created**. Personal accounts created after 13 Nov 2023 must run a **closed test with at least 12 testers opted in for 14 continuous days** before production access can be requested | Launch plan (R gate timing) |
| X-02 | Choose the **developer name** shown on Play and the **support email**. Then replace `{{DEVELOPER_NAME}}` and `{{SUPPORT_EMAIL}}` in `movenrun/website/privacy/`, `account-deletion/` and `support/` | Privacy policy, deletion page, store listing |
| X-03 | Choose **hosting** for the API and PostgreSQL. Option A: approve the Render paid plans in `render.yaml` (web "starter" and Postgres "basic-256mb"). Option B (no spend): a free PostgreSQL (for example the existing Supabase project, used as plain Postgres through its connection string) plus a free or existing Node host. Then fill `{{HOSTING_PROVIDER}}`, `{{BACKUP_RETENTION_DAYS}}` and `{{API_BASE_URL}}` in the website | B gate, everything after it |
| X-04 | Approve triggering **EAS APK Build** (preview profile) on `release/android-v1-cxfdbd`. The workflow already exists on `main`, so it can run against this branch from the Actions tab: Run workflow → branch `release/android-v1-cxfdbd`. Uses the free EAS build quota | M gate on a phone |

## Server setup (after X-03)

| ID | Action |
|---|---|
| X-05 | On the host, set: `DATABASE_URL` (Postgres connection string, TLS on), `IDENTITY_SESSION_PEPPER` and `IDENTITY_OTP_PEPPER` (two different random 32+ byte values), `RESEND_API_KEY`, `IDENTITY_EMAIL_FROM` (an address on a domain verified in Resend), `CORS_ORIGINS` (must include the website origin, for example `https://movenrun-website.vercel.app`), `TRUST_PROXY_HOPS=1`, `NODE_ENV=production`. Run the database migrations once (`yarn db:migrate` in `movenrun/backend`), then open `/health` and `/ready` |
| X-06 | Verify the sending domain in Resend (SPF and DKIM records at the DNS provider) and send yourself one sign-in code |
| X-07 | Set `IDENTITY_REVIEW_EMAIL` (an address you control, not a real player) and `IDENTITY_REVIEW_CODE` (six digits, not a run like 123456 or a repeat like 111111) on the host. Put the same two values only into Play Console → App content → App access |

## Build and signing

| ID | Action |
|---|---|
| X-08 | In the Expo dashboard → project → Environment variables → **production**: set `EXPO_PUBLIC_API_URL` (the HTTPS API from X-03) and `GOOGLE_MAPS_ANDROID_API_KEY`. In Google Cloud, restrict that key to Android apps, package `io.movenrun.app`, with the SHA-1 of the EAS upload key (`eas credentials -p android`) and, after the first upload, the **Play App Signing** SHA-1 (Play Console → Test and release → App integrity). Restrict the API to Maps SDK for Android |
| X-09 | In GitHub → Settings → Environments, create **`play-release`** with yourself as required reviewer. Confirm the `EXPO_TOKEN` Actions secret exists. After the release branch is merged, run **EAS Production AAB** with confirm `build`. Download the `.aab` from the EAS build page |
| X-14 | Merge approval: review the pull request text in `PR_DESCRIPTION.md` and merge `release/android-v1-cxfdbd` into `main` when satisfied, using **Squash and merge** with the title and text from that file. Two older commits brought in from the integrated pull requests (baf57c8 and the merge 9fa7a70) carry tool attribution in their author or message; squashing keeps them out of `main` without rewriting the pushed branch. Needed for the production workflow to appear in the Actions tab |

## Phone and Play Console

| ID | Action |
|---|---|
| X-10 | Install the preview APK on an Android phone and run `HANDSET_TEST_SCRIPT.md` steps 1–14 and 18–20 outdoors. Record results in `EVIDENCE_REGISTER.md` |
| X-11 | Play Console: create the app (MovenRun, Game, Free), complete every App content declaration from `PLAY_CONSOLE_WORKSHEET.md`, the store listing from `STORE_LISTING.md` and `store-assets/`. You accept the declarations yourself |
| X-12 | Upload the AAB to **Internal testing**, add yourself as a tester, install from Play and run handset steps 15–17. Check the App bundle explorer for 64-bit libraries and 16 KB page-size support |
| X-13 | Capture 2–8 phone screenshots from the Play-installed build per `STORE_LISTING.md` and add them to the listing |
| X-15 | If X-01 requires it: run the **closed test** with at least 12 testers for 14 days, then apply for production access. Answer Google's questionnaire from what the testers actually did |
| X-16 | Production: create the release, pick a staged rollout percentage, and press **Publish** yourself |

## Workspace (optional)

| ID | Action |
|---|---|
| X-17 | To let future sessions reach Expo and Google build hosts directly, add them in Project settings → environment → Network access (`expo.dev`, `api.expo.dev`, `exp.host`, `dl.google.com`). Not required: the GitHub Actions path works without it |

## Answered

None yet.
