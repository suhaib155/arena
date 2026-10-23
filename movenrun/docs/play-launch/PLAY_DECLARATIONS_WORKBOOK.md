# Play declarations workbook (owner decisions)

Prepared 23 Oct 2026 for candidate #125 at `15f7f87`. Nothing here is
submitted, registered or claimed true in the Play Console. **Every answer in
this workbook is an OWNER decision**, with legal sign-off where marked. The
earlier drafts in `PLAY_CONSOLE_WORKSHEET.md` (unconditional Health=No was
already corrected there on 18 Oct; location=approximate was corrected on 17
Oct) are not copied forward: each row below is derived from the data flow and
shows the alternative.

Paths are under `movenrun/` and cited at commit `15f7f87`
(`git show 15f7f87:movenrun/<path>`). Line numbers were read on that commit, not
copied from older documents (some of which cite another branch and differ).

**Policy citations.** Wording was fetched from the official page on 23 Oct
2026 unless a row says **UNKNOWN/REVERIFY**: the page could not be reached or
did not state the point, so the statement is not asserted. Google changes
these pages; re-read each before submitting.

| Short name | Official page |
|---|---|
| P-DS | Data safety form: https://support.google.com/googleplay/android-developer/answer/10787469 |
| P-HEALTH | Health apps declaration: https://support.google.com/googleplay/android-developer/answer/14738291 |
| P-TEST | Testing requirements for new personal accounts: https://support.google.com/googleplay/android-developer/answer/14151465 |
| P-ASSETS | Preview assets: https://support.google.com/googleplay/android-developer/answer/9866151 |
| P-RATING | Content ratings: https://support.google.com/googleplay/android-developer/answer/9859655 |
| P-DEL | Account deletion requirements: https://support.google.com/googleplay/android-developer/answer/13327111 |
| P-ACCESS | App access instructions: https://support.google.com/googleplay/android-developer/answer/15748846 |
| P-MAPS | Maps SDK for Android data disclosure: https://developers.google.com/maps/documentation/android-sdk/play-data-disclosure |

## 1. Data safety rows, derived from the data flow

Definitions used (P-DS, fetched 23 Oct): approximate location is an area of
3 km2 or more, and includes `ACCESS_COARSE_LOCATION`; precise location is an
area under 3 km2, and includes `ACCESS_FINE_LOCATION`; fitness info is
information about exercise or other physical activity; ephemeral means used
only in memory and kept no longer than needed for a real-time request; SDK data
sent off the device must be declared.

Form-level answers to decide (not asserted here): collects or shares data
(derived: yes); encrypted in transit (derived yes, see 1.8); account creation
methods; deletion offered (see section 5).

| # | Data type | Code evidence at 15f7f87 | Derived answer (options) | Owner decision |
|---|---|---|---|---|
| 1.1 | **Precise location** (route points) | Foreground watch only: `mobile/src/services/moveTracker.ts:87-88` (`watchPositionAsync`, accuracy from config); fix carries lat, lng, accuracy at `:95`. Points are sent to the API in `mobile/src/services/movementApi.ts:102` (`request.points.map`) via `POST /movement/verify` (`:335`). Fine location is declared in `mobile/app.json:29-30` | Collected when a signed-in player saves a session. Raw points are used to check the route; the stored row has no coordinates (`backend/src/db/movement.schema.ts:22-37`, insert at `backend/src/movement/services/movementVerification.service.ts:93-95`). Unsent routes wait on device up to 7 days and 6 attempts (`mobile/src/lib/pendingVerification.ts:65,83`; `mobile/src/services/verificationQueueStorage.ts:25-34`, unencrypted AsyncStorage). Ephemeral: arguable for the raw points, **not** for the device queue. Options: declare precise, not ephemeral (conservative); declare ephemeral only if the owner and counsel accept the device queue and server request memory as meeting P-DS | OWNER: declare? shared? ephemeral? |
| 1.2 | **Approximate location** | `ACCESS_COARSE_LOCATION` is declared (`mobile/app.json:29`); P-DS says that permission counts as approximate. Stored H3 cells: see 1.3 | The app requests coarse and fine together, so declaring approximate as well is the conservative option. A coarse-only grant is handled by the app (H-7 tests it) but P-DS still lists the permission. Do **not** answer "approximate only" on the strength of the old draft | OWNER: declare approximate in addition to precise? |
| 1.3 | **Stored H3 cells** (location trail) | Resolution 8, `shared/src/constants/h3.ts:1`; comment at `:9` gives about 0.74 km2 per cell. Stored as an array in `backend/src/db/movement.schema.ts:37` (`traversed_hex_ids`) | Each cell is under 3 km2 (P-DS precise threshold) and the array is a trail, so these are **precise** location data kept until account deletion (`backend/src/identity/accountDeletion.ts:103`). They are not ephemeral. A multi-cell trail can be more sensitive than one cell. Counsel may wish to weigh this against "approximate" | OWNER and legal |
| 1.4 | **Fitness info** (distance, duration, mode, pauses) | `backend/src/db/movement.schema.ts:33-34` (distance, duration), `:52` (movement mode), `:56` (paused ms) | P-DS defines fitness info as exercise or physical activity. Distance and duration of walks and runs fits. Option to decline exists only if the owner reads the definition as excluding a game session summary: weak. Consistent with section 2 | OWNER and legal |
| 1.5 | **Name** and **email address** | Scopes `openid email profile`: `mobile/src/lib/signInMethods.ts:90`. App forwards only `access_token`: `mobile/src/services/signInProviders.ts:98-101`. API reads the token and keeps the email: `backend/src/identity/providers/supabaseAuth.ts:142,151` and stores it in `backend/src/db/identity.schema.ts:74` (`normalized_email`). No code in the app or API reads the name or picture (search `user_metadata`, `avatar`, `picture` in `mobile/src` and `backend/src`: only the claims above) | Email: collected (account management), kept until deletion (`accountDeletion.ts:107`), deleted in Supabase through `supabaseAuth.ts:273-275`. Name: MovenRun does not read or store it; Supabase (service provider) holds it from Google, and it travels once inside the token the app forwards. Declare Name is the conservative option; "not collected" would need counsel's reading that provider storage does not count | OWNER and legal |
| 1.6 | **Pseudonymous wallet id** (User IDs) | Public address entered in the wallet browser on the website, not the app: `website/js/account-auth.js:208-210`. Kept briefly as `wallet_sign_in_challenges.address` (`backend/src/db/identity.schema.ts:288-292`). The Supabase user id is stored as `provider_subject` (`:71`). Wallet screens are off: `mobile/src/lib/releaseScope.ts:33` | A public wallet address is a stable pseudonymous identifier: User IDs, account management, not shared. Collected via the website the app opens, so confirm whether the app's form must include it. Do not describe it as "no wallet features": see the Blockchain / crypto row of `PLAY_CONSOLE_WORKSHEET.md` | OWNER and legal |
| 1.7 | **Third-party Maps SDK telemetry** | Maps is `react-native-maps` 1.20.1 (`mobile/package.json:38`) with `PROVIDER_GOOGLE` (`mobile/src/components/map/MovenMap.tsx:65`); the app calls camera APIs (`mobile/src/components/map/useMapCamera.ts:123`, `fitToCoordinates`). The app itself has no analytics, crash or ad SDK (`mobile/package.json`) and no device-id code (`mobile/src/lib/deviceLabel.ts:5` constant label from `Platform.OS`) | P-MAPS (fetched 23 Oct; page says last updated 2026-10-20, the older note in `DATA_INVENTORY.md` cites 2026-10-15) lists: request metadata (OS, device name, model, brand, form factor, SDK version), stack traces and crash metrics, IP address, a pseudonymous Maps SDK identifier, and map interaction events when Map Camera APIs are used. P-DS says SDK data sent off the device must be declared. Candidate types: Device or other IDs, Crash logs, Diagnostics, App interactions (and IP-derived data has no Play type). Whether Google is "shared" or a service provider is a legal question | OWNER and legal; REVERIFY P-MAPS date before submit |
| 1.8 | **Encryption in transit** | `mobile/plugins/withAndroidHardening.js:27` sets `usesCleartextTraffic=false`; Supabase URL must be https (`mobile/src/lib/signInMethods.ts:42`); API URL is not checked in code (`mobile/src/services/identityApi.ts`) but a release build refuses cleartext | Yes for app traffic. Database TLS (`sslmode=verify-full` in Render) is the owner's dashboard value, not read here | OWNER confirms Render value |
| 1.9 | **Not collected by the app** | No contacts, photos, files, audio, calendar, financial or message data. Blocked permissions in `mobile/app.json:32-40` include storage, audio, overlay and background location. Share image goes only where the player sends it | Do not tick them. Re-check if a dependency changes | OWNER |

Verified purposes to consider (owner picks): App functionality; Account
management (email, name, user IDs); Fraud prevention, security and compliance
if the movement plausibility check and audit rows count (`security_audit_events`,
`backend/src/db/identity.schema.ts:235`); not analytics or advertising.

**What cannot be answered from code.** Whether Google counts as a processor for
Maps data; whether provider-held name counts; whether the device queue breaks
"ephemeral". These are decisions, listed so they are not assumed.

## 2. Health apps declaration

Source P-HEALTH (fetched 23 Oct): every developer with an app on Play must
complete it, including closed, open and production tracks; apps with no health
features still complete it and certify that. Activity and Fitness is described
as "Apps that monitor and record physical activities, exercise routines, and
workouts" and also covers body vitals such as heart rate and weight.

Derived from the data flow: MovenRun records foreground walks and runs and
stores distance and duration (rows 1.1 and 1.4). It reads no heart rate,
weight or body data and uses no Health Connect or health permission
(`mobile/app.json:28-40`; module list in `mobile/package.json`). It makes no
medical claim (verify the store text, section 4).

Options for the owner:

1. Declare **Activity and Fitness** (consistent with Data safety fitness info).
   The packet notes this fits a movement-tracking game even without a medical
   function.
2. Declare **no health features**: possible only if the owner and counsel
   conclude a game's movement tracking is not "monitoring and recording
   physical activities". This sits badly with row 1.4 and with the app's own
   description. Do not choose it by default.

UNKNOWN/REVERIFY: any extra Console steps, review or listing requirements the
Activity and Fitness choice triggers, and the Console wording today. The help
page fetched gave no list of those steps.

## 3. Content rating

P-RATING (fetched 23 Oct): the developer completes the questionnaire in Play
Console under App content; answers must be accurate and complete;
misrepresentation can lead to removal; ratings are required for new apps. The
developer cannot pick a rating.

Facts to answer from (owner enters them): no violence or sexual content; no
gambling or real-money play; no user-to-user communication; location is not
shared with other users in v1 (confirm); no purchases; share image is sent only
via the system share sheet. The old expectation "Everyone / PEGI 3" is an
expectation, not a result. UNKNOWN/REVERIFY: the questionnaire's current
questions on location, user-generated content and the wallet sign-in, which
this workbook could not see.

## 4. Store assets

P-ASSETS (fetched 23 Oct):

| Asset | Spec from the page | State |
|---|---|---|
| App icon | 32-bit PNG with alpha, 512 x 512, at most 1024 KB | Produce from the real app icon. Check `store-assets/` and `STORE_LISTING.md`; **NOT VERIFIED** on this branch |
| Feature graphic | JPEG or 24-bit PNG, no alpha, 1024 x 500 | As above, not verified |
| Screenshots | JPEG or 24-bit PNG, no alpha; at least two overall; up to eight per device type; sides 320 to 3840 px, long side at most twice the short; games: three 16:9 or 9:16, 1080 px minimum, for recommendation eligibility | **Real screenshots only**, taken from a build on a phone or emulator showing true screens. No mock-ups, no invented player data, no real map location or personal data (crop or use a neutral area). Do not fabricate. None can be taken until an APK exists |
| Descriptions | Truthful. Do not state claims the app does not meet (no health benefit, no earnings, no token rewards) | `STORE_LISTING.md` to be re-read against the build |

## 5. Privacy policy, deletion URL, account deletion

| Item | Value | State |
|---|---|---|
| Privacy policy URL | `https://movenrun.xyz/privacy/` | Must load publicly without sign-in. On 17 Oct the apex returned 404 (X-21). **REVERIFY live** |
| Account deletion web URL | `https://movenrun.xyz/account-deletion/` | P-DEL (fetched 23 Oct): apps that let users create accounts need an in-app route and a web page that loads without errors, makes deletion easy to find, and names the app or developer as shown on the listing; the URL goes in the Data safety deletion questions. **REVERIFY live**, and that the page works for a wallet-only account |
| In-app path | Profile, Account, Account security, Delete account | Tested by H-10 |
| Data kept after deletion | One anonymous `account_deleted` audit row, no user id (`backend/src/identity/accountDeletion.ts:111-120`) | P-DEL: tell users about retained data in the privacy policy. Confirm the policy says so |
| Provider cleanup | Supabase user removed through the admin API (`backend/src/identity/providers/supabaseAuth.ts:273-275`) | Owner checks after H-10 |

## 6. Reviewer access

P-ACCESS (fetched 23 Oct): you must give reviewers what they need to use all
functionality; credentials should be durable and work from any location;
**for third-party sign-in such as Sign in with Google, provide full account
details and step-by-step instructions**.

This **contradicts** the earlier draft ("no credentials need to be supplied;
sign in with any Google account"; "No reviewer credentials, codes or test
wallets exist (D-21)"). The reviewer cannot be assumed to bring a Google
account. Options: (a) the owner creates a dedicated test Google account and
enters its details and the steps only in the Console; (b) the owner asserts
that all gameplay is available without sign-in and that account features need
the reviewer's own account: that is a risk if Play wants to see account
features. Credentials are never written to this repository or to chat. Explain
that wallet sign-in is optional and needs no funds. OWNER decision.

## 7. Closed testing for a new personal account

P-TEST (fetched 23 Oct): a closed test needs at least 12 testers opted in, each
for 14 consecutive days; a tester who opts out and rejoins restarts the count;
the developer then applies for production in the Dashboard with a three-part
form (closed test, app, production readiness); review typically takes seven
days or less.

Consequences for the plan: 14 days cannot start until a Play build exists and
12 testers have opted in. Never guarantee public release on 2 Nov; that date is
an engineering and pre-listing target only. Recruit genuine testers who
understand foreground location; no paid or fake testers. UNKNOWN/REVERIFY: that
the account type is Personal (the owner chooses the account type), and whether
the requirement applies to this account today. The page applies to new personal
accounts as stated; confirm in Play Console.

## 8. Other declarations (owner enters)

| Declaration | Derived position | Source |
|---|---|---|
| Ads | None: no ad SDK in `mobile/package.json` | Code |
| Financial features | No payments, tokens, balances or transfers in v1; wallet is a signature-only sign-in. Whether the console's crypto categories apply: UNKNOWN/REVERIFY | `mobile/src/lib/releaseScope.ts:33`; Console |
| Target audience | 13 and over per the draft; owner decides | Owner |
| Target API | 36 expected from Expo SDK 54 defaults, not set in repo: confirm in H-12(a). Play deadlines for target API and 16 KiB: UNKNOWN/REVERIFY on the Play policy timeline | `mobile/app.json` |

## 9. Rows the owner must answer before the Console (checklist)

[ ] Precise, approximate, ephemeral choices (1.1 to 1.3)
[ ] Fitness info (1.4) and Health apps option (section 2)
[ ] Name and email (1.5), wallet id (1.6)
[ ] Maps SDK types and shared/processor reading (1.7)
[ ] Content rating answers (3)
[ ] Real assets once a build exists (4)
[ ] Privacy and deletion URLs live (5)
[ ] Reviewer account decision (6)
[ ] 12 genuine testers, 14 days (7)
