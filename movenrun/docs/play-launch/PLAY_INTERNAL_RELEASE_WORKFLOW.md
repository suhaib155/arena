# From AAB to the internal testing track (Play v1)

**State (17 Oct 2026):** no Google Play developer account (X-01), no
production AAB (X-09), nothing uploaded. Every step here is the owner's, in
Play Console or GitHub, and none costs anything except the one-time US$25
registration (X-01b, its own approval). Google changes these rules; the pages
cited were read on 17 Oct 2026, re-read them on the day.

## Testing rules that decide the timeline

From [App testing requirements for new personal developer
accounts](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en):

- Applies to "personal developer accounts created after November 13, 2023".
- They "must run a closed test for their app with a minimum of 12 testers who
  have been opted in continuously for at least 14 days".
- "Internal testing is optional, but recommended as a starting point." It does
  not count toward the closed-test requirement.
- "At least 12 testers must be opted in to your closed test when you apply for
  production access." "Testers who opt in, test for fewer than 14 days, and
  then opt out do not count toward the requirement." A tester who opts out and
  back in needs 14 consecutive days again.
- Then: "When you meet these criteria, you can apply for production access"
  (Dashboard). Google decides; no date can be promised.

Organization accounts (registered entity with a D-U-N-S number) have no
closed-test requirement. Choose the type truthfully
(`PLAY_REGISTRATION_CHECKLIST.md` §1).

From [Set up an open, closed, or internal
test](https://support.google.com/googleplay/android-developer/answer/9845334?hl=en):

- Internal test: "up to 100 testers per app", added by email list; testers
  "cannot find your app by searching Google Play", so share the link; "Each
  tester needs to opt in using the link." "Internal tests might not be subject
  to standard Play policy or security reviews."
- Closed test: email lists ("up to 200 lists, and each list can contain up to
  2,000 users"), Google Groups, or an organization.

Testers need a Google account on an Android phone with Play. Keep tester names
and emails out of the repository (a Google Group or a Console email list is
the record).

## Workflow

| # | Step | Where | Proof |
|---|---|---|---|
| 1 | Merge decision for the Play v1 branch (`release/android-v1-cxfdbd`) into `main`, so `eas-production-aab.yml` can run | GitHub (X-14, owner) | Merge commit |
| 2 | EAS **production** environment variables: same names as preview (`X04_PREVIEW_BUILD_RUNBOOK.md`); Maps key restriction gets the upload key SHA-1 | Expo (X-08) | Names listed in Expo, values not recorded |
| 3 | GitHub environment `play-release` with you as required reviewer | GitHub → Settings → Environments (X-09) | Screenshot of the rule |
| 4 | Actions → **EAS Production AAB** → Run, type `build`. Gates run (type-check, tests, Hermes export, prebuild manifest check), then you approve the `play-release` job. Uses one Free build | GitHub, Expo (X-09) | Job summary: build id, versionCode, commit |
| 5 | Download the `.aab`. Run the 16 KB and manifest checks in `ANDROID_16KB_PAGE_SIZE.md` and the secrets check | Your computer | `bundletool` alignment line, readelf list |
| 6 | Create the app in Play Console: name, default language, Game, Free; accept the declarations (Developer Program Policies, US export laws) | Play Console (X-11) | |
| 7 | App content: privacy policy URL, app access, ads (No), content rating questionnaire, target audience 13+, news (No), Data safety, government (No), financial features, health, account deletion URL `https://movenrun.xyz/account-deletion/` | Play Console, answers in `PLAY_CONSOLE_WORKSHEET.md` | Each section shows complete |
| 8 | Main store listing: short and full description, icon, feature graphic, phone screenshots (X-13), category, contact email `info@movenrun.xyz`, website | `STORE_LISTING.md`, `store-assets/` | |
| 9 | Testing → Internal testing → Testers: create an email list (up to 100); save | Play Console | |
| 10 | Internal testing → Create new release. First time: accept **Play App Signing** (Google holds the app signing key; the EAS key becomes the upload key). Upload the `.aab`. Release name e.g. `1.0.0 (versionCode)`; release notes one line | Play Console (X-12) | Release page screenshot |
| 11 | Review release → fix every error (warnings are read, not ignored) → Start rollout to Internal testing | Play Console | Status "Available to internal testers" |
| 12 | Setup → App signing: copy the **app signing key SHA-1** and add it to the Maps key restriction (R-05). Without it Play-installed builds show no tiles | Play Console, Google Cloud Console | |
| 13 | App bundle explorer → the version: 64-bit ABIs present, 16 KB compatibility, permissions list matches the worksheet (R-04) | Play Console | Screenshot |
| 14 | Copy the internal testing link, open it on the test phone (account on the tester list), opt in, install from Play. Run `HANDSET_TEST_SCRIPT.md` steps 1–17 and Q0-6e on the Play install (QA-03) | Phone | Evidence register |
| 15 | Personal account only: Testing → Closed testing → create a track, add ≥ 12 testers (Google Group or list), promote the same release, start rollout. Keep ≥ 12 opted in for 14 consecutive days (X-01c, X-15) | Play Console | Tester count and start date in `EXTERNAL_ACTIONS.md` |
| 16 | Personal account only: Dashboard → Apply for production access after day 14 | Play Console | Google's answer |
| 17 | Production (X-16): staged rollout, then `POST_LAUNCH_MONITORING.md` | Play Console, owner's Publish | |

A later upload needs a higher versionCode: the production profile
auto-increments it on EAS (`autoIncrement`, `appVersionSource: remote`), so
re-running step 4 is enough. Never upload a preview APK to Play.

## What stays manual by design

The workflow never submits to Play (`eas submit` is not configured and needs
a service account key that does not exist). Every upload and every rollout is
a person's click in Play Console.
