# EAS preview APK prerequisites, 31 Oct 2026

Approval (31 Oct): exactly one EAS preview APK from `ac8d87bed55f4dae0b9152ed21fa8cc29b8050f9`, API `https://movenrun-staging-api.onrender.com`, only when every prerequisite below is verified. **No build quota has been used. No build has been started.** The workflow `eas-apk-build.yml` is not run until all rows read VERIFIED.

What the workflow does (read from the repo): manual run on the chosen branch; checks the `EXPO_TOKEN` secret is non-empty; checks `app.json` has no `FILL_ME_IN` project id; `yarn install --immutable`; `eas-cli@24.8.0 build -p android --profile preview --non-interactive`. It runs no tests, so CI must already be green on the commit (it is: #184 merged green). The build branch `build/android-preview-ac8d87b` points at exactly `ac8d87b`.

| # | Prerequisite | How it is checked | Status |
|---|---|---|---|
| 1 | Commit and branch | Branch `build/android-preview-ac8d87b` head is `ac8d87bed55f4dae0b9152ed21fa8cc29b8050f9` (GitHub API) | VERIFIED |
| 2 | Source ready | `app.json` has an EAS project id (not `FILL_ME_IN`), package `io.movenrun.app`, version 1.0.0; `eas.json` has the `preview` profile (APK, internal, environment `preview`) | VERIFIED (read from the commit) |
| 3 | `EXPO_TOKEN` GitHub Actions secret | Presence-only workflow on branch `ci/eas-prereq-check-31oct`, run 41232319352: "EXPO_TOKEN secret set: yes" (value never printed; not tested against Expo, so it may still be expired or revoked) | PRESENT, VALIDITY UNVERIFIED |
| 4 | EAS `preview` environment variables | Expo dashboard only. Needed names: `EXPO_PUBLIC_API_URL` (must equal `https://movenrun-staging-api.onrender.com`), `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (publishable key only), `GOOGLE_MAPS_ANDROID_API_KEY`; `EXPO_PUBLIC_WEB_URL` optional | NOT VERIFIED (no Expo access here) |
| 5 | Maps key restriction | Google Cloud console, Credentials: Android apps restriction with package `io.movenrun.app` and the signing SHA-1; API restriction Maps SDK for Android only (`docs/MAP_PROVIDER.md`) | NOT VERIFIED |
| 6 | Android signing | Expo dashboard, Credentials, Android: a keystore exists, or EAS generates one on the first non-interactive build; record its SHA-1 and add it to the Maps key restriction. With a new keystore the first build's SHA-1 is not known beforehand, so the map may not draw until the key is updated | NOT VERIFIED |
| 7 | Build quota | Expo dashboard, Usage / Builds: allowance left, nothing queued | NOT VERIFIED |
| 8 | Staging API reachable | Run 41232297629 on branch `ci/staging-smoke-31oct` (see `STAGING_SMOKE_RESULTS_31OCT.md`) | see that file |
| 9 | Google sign-in stays off | Supabase dashboard (unchanged since X-05 is not approved) | NOT RE-CHECKED |

## What is missing, in the order you can do it from a phone browser
1. expo.dev (project, Environment variables, `preview`): confirm the four names exist and that `EXPO_PUBLIC_API_URL` is exactly the staging address. Send only names and the API URL value, never keys.
2. expo.dev (Credentials, Android): note whether a keystore exists and its SHA-1 (a fingerprint, not a secret).
3. Google Cloud console (Credentials): confirm the Maps key is restricted to `io.movenrun.app` plus that SHA-1 and to Maps SDK for Android only.
4. expo.dev (Usage): confirm remaining Android build allowance and that nothing is queued.
5. Reply "prerequisites verified" with those facts in the chat. I will then run the workflow once on `build/android-preview-ac8d87b` (the approval allows exactly one), and nothing else.

If the token turns out to be invalid, the build step fails before any build is queued; that would not consume quota, but do not re-run without a fresh decision.
