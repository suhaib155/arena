# Play registration, testing and pre-listing checklist

**State (13 Oct 2026):** no Google Play developer account exists (D-24, X-01).
Nothing here has been started. Google changes these rules; re-read the pages
named on the day you register and trust them over this file.

**Dates.** 2 Nov 2026 is the engineering and pre-listing target: the code,
build pipeline, declarations and listing material ready to enter. It is not a
Play availability date. Registration, Google's checks and (for a Personal
account) the 14-day closed test and production-access review come after
registration and are not in our control.

## 1. Choose the account type truthfully (X-01a)

| | Personal | Organization |
|---|---|---|
| Who it is for | An individual | A registered legal entity (company, partnership, non-profit) |
| Needs | Legal name and address, government ID, a verified email and phone, an Android phone for device verification in the Play Console app | Everything in Personal, plus the entity's **D-U-N-S number**, registered name and address matching it, an organisation website and contact phone |
| Before production | **Closed test: at least 12 testers opted in for 14 continuous days**, then apply for production access and wait for approval (applies to Personal accounts created after 13 Nov 2023) | No closed-test requirement |
| Shown on Play | The developer name you choose ("Team MovenRun"); Google may also show verified contact details. Check the signup page | The organisation name |

Choose **Organization only if MovenRun is a registered entity with a D-U-N-S
number** that you can prove. Do not register as an organization to skip the
testing rule; a mismatch with the D-U-N-S record fails verification and can
close the account.

## 2. Register (X-01b, APPROVAL: US$25)

1. Use a Google account you will keep for the app's life (not a personal
   inbox you may lose). Turn on 2-Step Verification for it first.
2. play.google.com/console/signup → choose the type from §1.
3. Pay the **one-time US$25** registration fee.
4. Developer name: **Team MovenRun**. Contact email: **info@movenrun.xyz**
   (X-22: it must receive mail). Website: https://movenrun.xyz (after X-21).
5. Complete identity verification (and D-U-N-S for Organization), email and
   phone verification, and Android device verification in the Play Console
   app. Google's review can take several days.
6. Record the account type and the date the account was created in
   `EXTERNAL_ACTIONS.md` X-01 (it decides whether X-01c applies).

## 3. Testing tracks

| Track | When | Needs | Purpose here |
|---|---|---|---|
| Internal testing (X-12) | As soon as the app exists in Console | The AAB from `eas-production-aab.yml`, up to 100 testers by email | First Play-installed run of the handset script, App bundle explorer checks |
| Closed testing (X-01c / X-15, Personal only) | After internal testing passes | **≥ 12 testers opted in, 14 continuous days**, each installing from Play | The production-access requirement; collect real feedback |
| Production access application (Personal only) | After the 14 days | Answers about the test, the app and readiness | Google decides; no date can be promised |
| Production (X-16) | After access is granted (Personal) or after review (Organization) | Your **Publish** | Staged rollout, then `POST_LAUNCH_MONITORING.md` |

Rule wording, cited and step-by-step workflow (read 17 Oct 2026):
`PLAY_INTERNAL_RELEASE_WORKFLOW.md`.

Closed-test tester list: keep names and emails out of the repository. Testers
must keep the app installed and stay opted in; a tester who leaves early may
not count toward the 14 days.

## 4. Before creating the app in Console (X-11)

All drafts exist; you accept every declaration yourself.

| Item | Source |
|---|---|
| App name, default language, Game, Free, category | `PLAY_CONSOLE_WORKSHEET.md` App setup |
| Privacy policy URL `https://movenrun.xyz/privacy/` (loads without sign-in) | `website/privacy/`, X-21 |
| Account deletion URL `https://movenrun.xyz/account-deletion/` | `website/account-deletion/`, E-24 |
| App access instructions (guest play, or reviewer's own Google account) | Worksheet, D-21 |
| Ads: none · Content rating questionnaire · Target audience 13+ | Worksheet |
| Data safety answers | Worksheet, `DATA_INVENTORY.md` |
| Financial features / blockchain: wallet used only to sign one sign-in message; no tokens, transactions, balances | Worksheet, D-18 |
| Short and full description | `STORE_LISTING.md` |
| Icon 512 × 512, feature graphic 1024 × 500 | `store-assets/` (approved, already committed) |
| Phone screenshots (2–8) | X-13, from the Play-installed build; no new artwork is made |

## 5. Pre-listing engineering review (checked on this branch, 13 Oct 2026)

| Requirement | State | Evidence |
|---|---|---|
| Target and compile API 36 | Met: Expo SDK 54 / React Native 0.81.5 resolve to API 36; CI guard fails on a downgrade | `mobile/src/lib/__tests__/androidTargetSdk.test.ts`, `mobile/README.md` |
| Package `io.movenrun.app`, never changes | Met | `mobile/app.json`, `easReleaseConfig.test.ts`, D-03 |
| Versioning | Met: `appVersionSource: remote`, `autoIncrement` on production; user-visible version 1.0.0 | `mobile/eas.json`, D-03 |
| Permissions | Met: only fine and coarse foreground location; background location, foreground service, overlay, storage, media and audio blocked; the AAB workflow checks the merged manifest | `app.json`, `androidRuntimePolicy.test.ts`, `eas-production-aab.yml`, D-04 |
| 64-bit | Expected: React Native 0.81 builds arm64-v8a and x86_64. **Confirm in the App bundle explorer** (R-04) | After X-12 |
| 16 KB memory pages | Expected (17 Oct inventory): fbjni 0.7.0 and the Fresco 3.6.0 natives read at 16 KB from their AARs; React Native, Hermes, expo-modules-core and react-native-screens built with the 16 KB flag on NDK r27; AGP 8.11 zip-aligns uncompressed libraries. Guarded by `android16kPageSize.test.ts`. **Confirm on the built APK/AAB and in the App bundle explorer** (R-04) | `ANDROID_16KB_PAGE_SIZE.md` |
| Signing custody | Play App Signing (Google holds the app signing key); EAS holds the upload key; nothing is in the repository. A lost upload key is reset through Play support | D-09 |
| Maps key | Restricted to Android, `io.movenrun.app`, the EAS upload key's SHA-1, and after the first upload the **Play App Signing SHA-1** (Console → Setup → App signing) | X-08, R-05 |
| Data safety consistency | Matches `DATA_INVENTORY.md`; no analytics, ads or crash SDK | Worksheet |
| Account deletion in app and on the web | Met (locally tested) | E-10, E-24 |
| Release build path | `eas-production-aab.yml`, `play-release` environment with you as reviewer | D-08, X-09 |
| No secrets in the build | `scripts/check-secrets.mjs` on the unpacked bundle | `LIVE_SETUP_OPERATOR_GUIDE.md` X-04 |

Open, owner side: X-01a–c, X-09, X-11–X-13, X-15, X-16.

## 6. Ready vs owner-only (17 Oct 2026)

Nothing below has been registered, paid, built or uploaded.

| Item | State | Who |
|---|---|---|
| Account type guide, registration steps, testing tracks | Written (§1–§3) | Ready |
| Developer name, contact email, website | Answered (X-02) | Ready |
| Store listing text, icon, feature graphic | `STORE_LISTING.md`, `store-assets/` | Ready |
| App content declarations, reviewer access text | Drafted in `PLAY_CONSOLE_WORKSHEET.md` | Ready to paste; you accept each one |
| Data safety form | Drafted question by question in the worksheet from `DATA_INVENTORY.md`. 17 Oct corrections: stored cells are **precise** location (finer than Play's ~3 km² approximate threshold) and session distance and duration are declared as **fitness info** | Ready to paste; two points to confirm in the console |
| Backup and transfer off (A2, #115) | In the build config, checked by `expo prebuild`; phone check is Q0-6 in `ANDROID_DEVICE_GATE_PLAN.md` | Device check: owner |
| Preview APK pipeline (free EAS) | Config ready, no fix needed; exact steps, variable names and APK checks in `X04_PREVIEW_BUILD_RUNBOOK.md` | Running a build: owner (X-04) |
| Manifest hardening (cleartext off, background location service removed, unused exported clipboard provider gone) | In the build config, #115; phone check Q0-7 | Device check: owner |
| 16 KB page size | Inventory and verification commands in `ANDROID_16KB_PAGE_SIZE.md` | Check on the built APK/AAB: owner's build |
| AAB to internal track | `PLAY_INTERNAL_RELEASE_WORKFLOW.md` | **Owner only** (needs X-01b) |
| QA0 device checks (Hermes start, location, Google, wallet, deletion, backup) | Steps, expected results and evidence rules in `ANDROID_DEVICE_GATE_PLAN.md` | Owner, on a phone |
| Privacy policy and deletion pages live on the apex domain | Pages written; apex still redirects to `www` (E-49) | Owner (X-21) |
| Google account with 2-Step Verification for Play | Not started | Owner |
| Play developer registration and the **US$25** fee | Not started (spending) | **Owner only** (X-01b) |
| Identity, phone and device verification | Not started | **Owner only** |
| Create the app, accept declarations, upload the AAB | Not started; needs X-01b and the production AAB | **Owner only** (X-11, X-12) |
| Closed test with 12 testers for 14 days, production access | Only if the account is Personal | **Owner only** (X-01c, X-15) |
| Publish | | **Owner only** (X-16) |
