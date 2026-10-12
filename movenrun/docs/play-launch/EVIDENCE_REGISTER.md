# Evidence register

Only what was actually run is recorded as evidence. A gate with no evidence row
is not passed. Commit ids are on `release/android-v1-cxfdbd`.

## Recorded (2026-10-12)

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
| E-11 | P | `evidence/web-account-deletion-e2e.mjs`: Chromium against the real API on Postgres: email → code → confirm → DELETE; account gone afterwards. Screenshots `web-deletion-confirm.png`, `web-deletion-done.png` | Pass | 60f4ad1 |
| E-12 | B | Review access tests (`emailOtp.service.test.ts`, `config.test.ts`): fixed code only for the configured email, no email sent, expiry, single use, attempt cap and throttle still apply; guessable codes refused | Pass | 58237e4 |
| E-13 | B | Verified-session history: `GET /movement/verifications` returns only the caller's rows, newest first, limit 1–100; mobile counts only `verified` results | Pass (backend router test, runtime test, `accountHistory.test.ts`) | 9ead53d, fa3b927 |
| E-14 | G | `nativeAssets.test.ts`: app icon, adaptive foreground and monochrome 1024×1024, adaptive background Morning White, Play icon 512×512, feature graphic 1024×500 without alpha | Pass | bab3a1b |
| E-16 | P | Expired sign-in challenges deleted a day after expiry on the next code request, for any email (`emailOtp.service.test.ts`, Postgres check in `runtime.test.ts`). Backend now **382/382**, API 9/9 | Pass | a55fd35 |
| E-15 | P | `scripts/check-launch-placeholders.mjs` | Fails as designed while 10 owner placeholders remain in the website pages (X-02, X-03) | 60f4ad1 |

## Not yet run (blocked externally)

| Gate | Needed evidence | Blocker |
|---|---|---|
| M | Preview APK on a physical phone, `HANDSET_TEST_SCRIPT.md` steps 1–14, 18–20 | X-04 (trigger build), X-10 (phone) |
| B | Hosted API `/health` and `/ready`, real email code delivery, two-account check | X-03, X-05, X-06 |
| R | Production AAB from the release commit, merged manifest of the AAB, 16 KB page size and 64-bit check (Play Console App bundle explorer) | X-08, X-09 |
| R | Play internal test install, Google map tiles with the Play App Signing SHA-1, steps 15–17 | X-11, X-12 |
| G | Phone screenshots from the Play-bound build | X-13 |
