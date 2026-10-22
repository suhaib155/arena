# Owner actions (one page)

Checkpoint: 22 October 2026. Only steps engineering cannot do. In order; each says what it unblocks. Never paste secrets, keys or tokens into chat or the repository.

| # | Action | Where | Unblocks |
|---|---|---|---|
| 1 | **Start the Play developer account now (X-01).** Choose the type that is true for you: Personal unless MovenRun is a registered entity with a D-U-N-S number. Pay the one-time fee and finish identity verification | play.google.com/console/signup | Everything in Play; longest lead time |
| 2 | **Enable Google sign-in (X-05).** Supabase → Authentication → Providers → Google: paste the Web client ID and secret there only. Keep Email, anonymous and manual linking off; keep the 1,000 / 50-per-hour hook. Then say "Google on" | Supabase dashboard, project `tavxmwuwkeynbnzfwove` | Genuine sign-in, hook proof (X-07b), replay and deletion checks |
| 3 | **Confirm by name only** that the Render service has no `SUPABASE_LEGACY_JWT_SECRET` variable (finding A-1) | Render → movenrun-staging-api → Environment | NO-GO check 3 |
| 4 | **Wallet sign-in only after step 2 passes.** Enable the Ethereum Web3 provider; tests use an unfunded wallet and message signing only | Supabase dashboard | Wallet checks |
| 5 | **Expo environment and Maps key (X-08).** Set the public variables in Expo for preview and production; restrict the Android Maps key to `io.movenrun.app` and the preview signing SHA-1 now, and add the Play App Signing SHA-1 once Play shows it | expo.dev; Google Cloud console | A build that shows a map |
| 6 | **Approve exactly one preview build (X-04)** of #125 at `15f7f87` after steps 2 and 5 | GitHub Actions / EAS | APK inspection and phone tests |
| 7 | **Phone test (X-10).** Install the APK, run H-1 to H-12 (LAUNCH_GATES section 2a, mostly HANDSET_TEST_SCRIPT) outdoors; run `android-artifact-acceptance.sh` on the same APK | A real Android phone | Play upload readiness |
| 8 | **Decide the declaration answers.** Health apps (Activity and Fitness or not), H3 cells as precise or approximate location, financial features "none", wallet address as user ID, backups wording | PLAY_DECLARATION_DRAFTS.md | Play App content (X-11) |
| 9 | **Recruit 12 genuine testers** who understand foreground location (no paid or fake testers); no installs until the Play build exists | Your contacts | Closed test, 14 consecutive days |
| 10 | **Vercel build budget.** Run the one-push test in VERCEL_DEPLOYMENT_BUDGET_PLAN, then choose native skipping or the #128 command; do not use the old `git diff --quiet HEAD^ HEAD -- .` line. Inventory the four projects before disconnecting anything | Vercel dashboard | Fewer wasted builds |
| 11 | **Approve a website wording release** for the privacy and deletion-page fixes (PRIVACY_CLAIM_CONSISTENCY_AUDIT) | Review a draft PR | Accurate public claims |
| 12 | **Later only:** storage quota, retention and erasure policy before any 0011 promotion; production deploys; publishing | — | Gameplay pilot, release |

2 November 2026 is the engineering and pre-listing target. With a Personal account the closed test alone needs 14 consecutive days after a Play build exists, so public availability comes later.
