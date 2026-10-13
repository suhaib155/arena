# Release handoff: from this branch to Google Play

The shortest path, in order. Each step names the item in `EXTERNAL_ACTIONS.md`.

1. **Answer X-01, X-02, X-03.** Fill the website placeholders; run
   `node scripts/check-launch-placeholders.mjs` in `movenrun/` until it passes.
2. **Provision the backend (X-05, X-06, X-07)** with `HOSTING_SUPABASE_FREE.md`. Migrations run on start; open
   `/ready`, sign in with a real email and with the review account.
3. **Deploy the website** (Vercel project for `movenrun/website`). Open
   `/privacy/`, `/account-deletion/` and `/support/` in a private window.
4. **Preview APK (X-04)** with `EXPO_PUBLIC_API_URL` set in the EAS preview
   environment. Run the handset script (X-10). Fix anything that fails before
   continuing.
5. **Merge (X-14)** after review of `PR_DESCRIPTION.md`.
6. **Production AAB (X-08, X-09):** set EAS production variables, approve the
   `play-release` run, download the `.aab`.
7. **Play Console (X-11):** create the app, App content from
   `PLAY_CONSOLE_WORKSHEET.md`, listing from `STORE_LISTING.md`.
8. **Internal testing (X-12):** upload the AAB, opt in, install from Play, add
   the Play App Signing SHA-1 to the Maps key, run handset steps 15–17, check
   the App bundle explorer (64-bit, 16 KB).
9. **Screenshots (X-13).**
10. **Closed test if required (X-15)**, then apply for production.
11. **Production (X-16):** staged rollout, owner presses Publish.
12. **First 48 hours (X-18):** `POST_LAUNCH_MONITORING.md`; record every check.

## How to resume engineering in a new session

- Branch `release/android-v1-cxfdbd`; read `EXECUTION_STATUS.md` then
  `TASK_REGISTER.md` (OPEN rows are unblocked engineering).
- Yarn 4 through corepack. If repo.yarnpkg.com is blocked, set
  `COREPACK_NPM_REGISTRY=https://registry.npmjs.org`.
- Local Postgres TLS check: see EVIDENCE E-17 for the URL shape.
- Backend tests that need Postgres read `MOVENRUN_TEST_DATABASE_URL`; without
  it they skip, so record the skipped count with any result.
- Regenerate `mobile/test-inventory.json` with `yarn test:inventory` after
  adding a mobile test file.
- Store artwork is rendered by `store-assets/render-artwork.mjs` (Playwright
  Chromium).
