# Release handoff: from this branch to Google Play

The shortest path, in order. Each step names the item in `EXTERNAL_ACTIONS.md`.

1. **Answer X-01 and X-20** (Play account type and date; accept separate
   Google and wallet accounts).
2. **API on Render Free (X-06, approval)** from `render.yaml`; the first start
   applies migrations 0000–0009 to the live database. Then attach the Before
   User Created hook (X-07) and run its checks. Open `/ready`.
3. **Supabase providers (X-05, approval), only after step 2** in project
   `movenrun` only: Google, Web3 Wallet, redirect list, email and anonymous
   sign-in off, Web3 rate limit left at its default. `HOSTING_SUPABASE_FREE.md` §2.
4. **Website at movenrun.xyz (X-21)**: fill the API URL and publishable key;
   `node scripts/check-launch-placeholders.mjs` must pass. Open `/privacy/`,
   `/account-deletion/`, `/support/` and `/sign-in/` in a private window.
5. **Preview APK (X-08, X-04)** with the API and Supabase public settings in
   the EAS preview environment. Run the handset script (X-10), including
   Google, wallet with a real wallet app, verified movement and deletion.
   **Wallet must pass on the phone by 24 Oct** or the release is flagged
   `WALLET_LOGIN_BLOCKED` and the owner chooses Google-only or a deferral.
6. **Merge (X-14, approval)** after review of `PR_DESCRIPTION.md`.
7. **Production AAB (X-09):** approve the `play-release` run, download the `.aab`.
8. **Play Console (X-11, approval):** App content from
   `PLAY_CONSOLE_WORKSHEET.md` (wallet sign-in described exactly as written
   there), listing from `STORE_LISTING.md`.
9. **Internal testing (X-12, approval):** upload, install from Play, add the
   Play App Signing SHA-1 to the Maps key, re-run steps 15a–17, check the App
   bundle explorer (64-bit, 16 KB). GO/NO-GO by 2 Nov.
10. **Screenshots (X-13).**
11. **Closed test if required (X-15)**, then apply for production.
12. **Production (X-16, approval):** staged rollout, owner presses Publish.
13. **First 48 hours (X-18):** `POST_LAUNCH_MONITORING.md`; record every check.

## How to resume engineering in a new session

- Branch `release/android-v1-cxfdbd`; read `EXECUTION_STATUS.md` then
  `TASK_REGISTER.md` (BLOCKED_CODE rows are unblocked engineering).
- Yarn 4 through corepack. If repo.yarnpkg.com is blocked, set
  `COREPACK_NPM_REGISTRY=https://registry.npmjs.org`.
- Local Postgres TLS check: see EVIDENCE E-17 for the URL shape.
- Backend tests that need Postgres read `MOVENRUN_TEST_DATABASE_URL`; without
  it they skip, so record the skipped count with any result.
- Regenerate `mobile/test-inventory.json` with `yarn test:inventory` after
  adding a mobile test file.
- Store artwork is rendered by `store-assets/render-artwork.mjs` (Playwright
  Chromium).
- The web e2e (`evidence/web-sign-in-deletion-e2e.mjs`) binds 127.0.0.1:443 for
  its Supabase stand-in and needs a migrated database; see its header.
- `mobile/app/auth/callback.tsx` and `auth/wallet.tsx` are the deep-link
  landings for `movenrun://auth/...`; keep them in release scope.
