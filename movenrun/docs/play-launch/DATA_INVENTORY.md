# Data inventory (Play v1)

Traced from source on the release branch. This is the basis for the privacy
policy (`website/privacy/`) and the Data safety answers in
`PLAY_CONSOLE_WORKSHEET.md`. Re-check it whenever a dependency, endpoint or
table changes.

## On the device

| Data | Where | Leaves the device? | Retention |
|---|---|---|---|
| GPS points of the current session (lat, lng, accuracy, time) | Memory during the session | Only to the MovenRun API, once, when a signed-in player saves the session | Discarded when the summary flow ends |
| Pending verification (route of an unsent signed-in session) | AsyncStorage, account-scoped | Sent on retry | Max 7 days; deleted on send, expiry, discard, sign-out, account deletion |
| Game progress: XP, streak, quests, zones, route reviews without coordinates | AsyncStorage | No | Until reset, account deletion in app, or uninstall |
| Access and refresh tokens (MovenRun session) | Android keystore via expo-secure-store | Sent as bearer to the API | Until sign-out, deletion or expiry |
| Pending wallet sign-in verifier (random PKCE secret, start time) | Android keystore | No (only its SHA-256 goes into the wallet sign-in link) | Deleted after the code is spent; ignored after 10 minutes |
| Supabase session from Google sign-in | Memory only | Sent once to the MovenRun API, then signed out at Supabase | Seconds |
| Share image | App cache | Only to the app the player chooses | Cache cleaned on start |

## On the server (`movenrun/backend`, PostgreSQL)

| Table | Personal data | Purpose | Retention |
|---|---|---|---|
| `users` | Opaque id, status, timestamps | Account | Until deletion |
| `auth_identities` | Provider `supabase` + Supabase user id; Google email (null for wallet accounts) | Sign-in | Until deletion |
| `auth_sessions` | Device label ("Android device"), keyed hash of refresh token, times. The `user_agent_hash` column exists but every v1 sign-in route writes null (`identity/http/router.ts:149`, `:237`) | Sessions and device list | Until 7 days after the refresh token expires (30 days after issue), or account deletion if sooner; deleted by the API's background clean-up (F-18) |
| `email_otp_challenges` | None in v1 (email codes off, D-16) | — | Table kept; purged as before if ever enabled |
| `wallet_sign_in_challenges` | Public wallet address, the sign-in message, times | Single-use wallet sign-in | Expire in 5 min; deleted a day after expiry |
| `wallet_sign_in_handoffs` | SHA-256 of the one-time code, PKCE challenge, Supabase user id | Carry a wallet sign-in to the app | Expire in 5 min; uncollected ones release their provider user; spent ones deleted after a day |
| `pending_auth_user_deletions` | Supabase user id | Retry removing a provider user after deletion or refusal | Until Supabase confirms |
| `account_capacity` | None (the cap and the hourly new-account quota) | 1,000-account limit, at most 50 new accounts an hour | — |
| `auth_user_creations` | None (a timestamp only, no user id) | Hourly new-account quota in the Supabase hook | Deleted after a day |
| `movement_verifications` | Distance, duration, pause total, mode, rules version, times, H3 res-8 cells crossed (~0.74 km² each), confidence, rejection reasons, seal summary | Verified progress, dedupe | Until deletion |
| `security_audit_events` | User id, event type, redacted metadata | Security | Deleted with the account; one anonymous `account_deleted` row kept |
| `wallets`, `wallet_link_challenges` | None created in v1 | Deferred | Deleted with the account |

Raw GPS points are never written to the database or logs: the API's error
handler and server never log request bodies (`backend/src/api/app.ts`), and
`runtime.test.ts` asserts no coordinate reaches the stored row.

## Supabase Auth (project `tavxmwuwkeynbnzfwove`)

| Data | Source | Retention |
|---|---|---|
| `auth.users` row: id, Google email, name and avatar in user metadata, provider identity; or the public wallet address (Web3) | Google OAuth or the wallet signature | Deleted through the admin API when the MovenRun account is deleted, refused at the cap, or a wallet code is never collected |
| Supabase sessions and refresh tokens | Created at each sign-in | Signed out right after the MovenRun exchange (Google); expire on their own (wallet) |
| Auth audit logs (IP, user agent, event) | Supabase | Supabase's own retention |

## Third parties

| Party | Data | Role |
|---|---|---|
| Google Maps SDK for Android | By default: request metadata (device OS, name, model, brand, form factor; SDK version), stack traces and crash metrics from SDK code, IP address, a Maps SDK pseudonymous identifier; with camera APIs, map interaction events (pan, zoom). Google says these are used "to maintain and improve Google services" (developers.google.com/maps/documentation/android-sdk/play-data-disclosure, last updated 2026-10-15, read 18 Oct) | Map display. Whether Google counts as a service provider for this data is an owner/legal question (see the evidence section below) |
| Google (Sign-In via Supabase) | Google account email, name, picture, Google id | Authenticates "Continue with Google" |
| Supabase (Auth + PostgreSQL, us-east-1) | Everything in the two tables above | Processor |
| The player's wallet app (MetaMask, Coinbase Wallet, Trust Wallet) | The sign-in message | The player's own app; signs one message |
| Render (API host, Free) | Requests in transit; no request bodies logged | Processor. Database reached only over verified TLS; RLS keeps Supabase's REST API empty |
| Google Play | Install, crash/ANR statistics (Android vitals) | Distribution |

No ads, analytics, crash-reporting, attribution or social SDKs are in the app
(`mobile/package.json`). The Google Maps SDK (through `react-native-maps`) does collect its own crash and usage data for Google; see the row above and the evidence section. No payments or tokens. No blockchain calls: a wallet only signs one plain-text sign-in message; MovenRun sends no transaction, reads no balance and stores no wallet in v1. The app adds expo-web-browser and expo-crypto (system browser and hashing), both first-party Expo modules with no data collection.

## Android permissions (release manifest)

Declared: `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, plus `INTERNET` and
`VIBRATE` from the platform template and expo-haptics. Removed with
`tools:node="remove"`: background location, foreground service (location),
system alert window, external storage read/write, media images, record audio.
Verified by `expo prebuild` on 2026-10-12 (see EVIDENCE E-07). The merged
manifest of the real AAB still has to be checked (R-04).

17 Oct (#115): the application sets `android:allowBackup="false"`,
`android:dataExtractionRules` (every domain excluded from cloud backup and
device transfer) and `android:usesCleartextTraffic="false"`; expo-location's
background `LocationTaskService` is removed (`tools:node="remove"`); and the
unused `expo-clipboard`, which added an exported content provider, is no
longer a dependency. The only exported component left is the launcher
`MainActivity` (with the `movenrun://` scheme), plus AndroidX's
`ProfileInstallReceiver`, which only the system can call (`DUMP`
permission). Checked by `expo prebuild` and `androidManifestHardening.test.ts`;
on the phone by Q0-7.

## Data safety evidence (18 Oct, #115)

Each row traced in code on `privacy/a2-android-backup-off`. Paths are under
`movenrun/`. "API" is `backend/` on Render; "Supabase" is Supabase Auth.
**Owner/legal sign-off needed** marks an answer the code alone cannot settle.
Nothing here ticks a box in the Play Console.

**In transit, all rows.** The release manifest refuses cleartext
(`mobile/plugins/withAndroidHardening.js:25-29`, `androidPrebuildManifest.test.ts`).
The Supabase URL must be `https://<ref>.supabase.co` (`mobile/src/lib/signInMethods.ts:42`)
and the web URL `https://` (`:50`). The API URL is not checked in code
(`mobile/src/services/identityApi.ts:99-103`); in a release build the OS
refuses a plain `http://` URL, so a wrong value fails closed. API to database:
`sslmode=verify-full` with Supabase's CA, set in the Render dashboard
(`render.yaml:32-33`), owner confirms the value.

| Data | What happens, in code | Collected? / shared? | Purpose; optional? | Retention; deletion |
|---|---|---|---|---|
| Google email | Google sign-in asks for `openid email profile` (`mobile/src/lib/signInMethods.ts:90`). The app forwards the Supabase access token to the API (`mobile/src/services/signInProviders.ts:88-101`); the API reads only `sub`, `email`, `amr` and `app_metadata.providers` from it (`backend/src/identity/providers/supabaseAuth.ts:127-136`) and stores the email in `auth_identities.normalized_email` (`backend/src/db/identity.schema.ts:72-74`). Supabase stores it in `auth.users` | Collected. Not shared (Supabase, Render: service providers) | Account management; optional (no account needed to play) | Until account deletion: API rows `backend/src/identity/accountDeletion.ts:103-113`, Supabase user `supabaseAuth.ts:257-259` |
| Google name | Never read or stored by the app or the API. The app receives it in memory only inside the Supabase token response and the token's `user_metadata` claim, and keeps only `access_token` (`signInProviders.ts:98-101`); the API ignores the claim (`supabaseAuth.ts:127-136`). Supabase stores it in `raw_user_meta_data` (Supabase's standard Google behaviour, not code in this repo) | Collected by our service provider. The device does forward it once, inside the token. Declare as Name (current draft). **Owner/legal sign-off needed** | Account management (by the provider; unused by MovenRun); optional | Until the Supabase user is deleted with the account |
| Google user id | The API stores the **Supabase** user id (UUID) as `provider_subject` (`identity.schema.ts:69-71`, `supabaseSignIn.service.ts:125`), not Google's id. Google's `sub` sits in Supabase's identity record and the token's `user_metadata` | Collected (User IDs). Not shared | Account management; optional | Until account deletion (as email) |
| Google profile picture | **No image bytes** are fetched, stored or sent by the app or the API: no code reads `avatar_url` or `picture` (repo search, 18 Oct: no match outside theme shape helpers). Supabase keeps the **provider-hosted URL** (Google CDN) in `raw_user_meta_data`; the same URL travels once inside the token the app forwards | Not Photos. Possibly Personal info → Other info for the URL. **Owner/legal sign-off needed** | None at MovenRun; optional | Until the Supabase user is deleted |
| Wallet address | Entered in the wallet's browser on `movenrun.xyz/sign-in/` (`website/js/account-auth.js:210`), not in the app. API keeps it in `wallet_sign_in_challenges.address` (`identity.schema.ts:274-278`), expiry 5 min, deleted a day later; Supabase stores it as the Web3 identity (`supabaseAuth.ts:216-217`). `wallets` rows are not written by v1 sign-in; wallet screens are off (`mobile/src/lib/releaseScope.ts:33`) | Collected (User IDs), via the website the app opens. **Owner/legal sign-off needed** on category and on web-flow scope | Account management; optional | Challenge: a day after expiry. Supabase user: account deletion |
| Precise location (GPS points) | Foreground watch only (`mobile/src/services/moveTracker.ts:87`). Points (lat, lng, accuracy, time) are sent once to `/movement/verify` (`mobile/src/services/movementApi.ts:98-109`) and used in memory; the stored row has no coordinates (`backend/src/db/movement.schema.ts:22-37`, `backend/src/movement/services/movementVerification.service.ts:88-101`); no body logging (`backend/src/api/app.ts:99`). An unsent route waits in AsyncStorage, not encrypted at rest (`mobile/src/services/verificationQueueStorage.ts:11-23`), max 3 items, 6 attempts, 7 days (`mobile/src/lib/pendingVerification.ts:65,83,93`), excluded from backup and transfer | Collected; the points themselves processed ephemerally on the server. Not shared | App functionality (and plausibility checking); optional (signed-out play sends nothing) | Device queue: send, expiry, discard, sign-out, deletion (`mobile/src/store/useAuthStore.ts:159-162`) |
| H3 cells / route summary | Res-8 cells (`shared/src/constants/h3.ts:1`, ~0.74 km²) stored in `movement_verifications.traversed_hex_ids` (`movement.schema.ts:37`). Below Play's 3 km² line, so **precise** location, not ephemeral | Collected (Precise location; also Approximate, since coarse-only grants still send fixes). Not shared | App functionality; optional | Until account deletion (`accountDeletion.ts:103`) |
| Distance, duration, mode, pauses | `distance_meters`, `duration_seconds`, `movement_mode`, `paused_ms`, start and end times (`movement.schema.ts:33-34,41-42,52-56`) | Collected: Health and fitness → Fitness info, and App activity → Other actions. Not shared. **Owner/legal sign-off needed** | App functionality; optional | Until account deletion |
| App activity (game progress) | XP, streak, quests, zones stay in AsyncStorage on the phone (`mobile/src/store/useGameStore.ts:451`) and are never sent. Server-side activity is only the verified sessions above and `security_audit_events` (`identity.schema.ts:235`, metadata redacted `backend/src/identity/services/audit.service.ts:54`) | Local progress not collected. Audit events: collected for security, not shared | Security / fraud prevention for audit rows. **Owner/legal sign-off needed** on whether audit rows need a purpose entry | Audit: deleted with the account, one anonymous `account_deleted` row kept (`accountDeletion.ts:111-120`) |
| Diagnostics / crash logs | The app has no crash, analytics or logging SDK (`mobile/package.json`) and no `console.*` call in `mobile/src` or `mobile/app` (search, 18 Oct). **Google Maps SDK collects SDK stack traces and crash metrics, and request metadata** (official page above). Play vitals are Google Play's | App: no. Maps SDK: likely Crash logs and Diagnostics. **Owner/legal sign-off needed** | Google: "maintain and improve Google services" | Google's |
| Device or other IDs | The app sends no hardware, advertising or install id; the device label is a constant from `Platform.OS` (`mobile/src/lib/deviceLabel.ts:19-27`); user agent not stored (above). Network address used in memory for rate limiting (`backend/src/middleware/rateLimit.ts:51`). **Maps SDK creates a pseudonymous Maps SDK identifier** | App: no. Maps SDK: likely Device or other IDs. **Owner/legal sign-off needed** | Google: measure daily active SDK users | Google's |
| App interactions | None by the app. Maps SDK collects pan and zoom events when camera APIs are used; the app uses `fitToCoordinates` (`mobile/src/components/map/useMapCamera.ts:123`) | Maps SDK: possibly App interactions. **Owner/legal sign-off needed** | Google services | Google's |

**Open questions for the owner and legal reviewer**

1. *Maps SDK.* Google's page lists crash data, device details, an SDK
   identifier, IP and map interactions, used to improve Google's services.
   Play says SDK collection must be reflected in the form. Decide whether to
   declare Crash logs, Diagnostics, Device or other IDs and App interactions,
   and whether Google's own use makes it "shared" rather than a service
   provider.
2. *Name and picture URL.* Google gives them to Supabase server to server;
   the device carries them once inside the token. Declare Name (current
   draft) and decide on Other info for the picture URL. Optional mitigation
   for later (a change, not made): a Supabase access-token hook that drops
   `user_metadata` from the token.
3. *Wallet address.* Collected on the website the app opens, not by the
   binary. Confirm it belongs in the app's form as User IDs.
4. *Fitness info and Health apps.* Distance and duration of walks, runs and
   rides; see the Health apps assessment in `PLAY_CONSOLE_WORKSHEET.md`.
5. *Fraud prevention purpose.* The plausibility check and the security audit
   rows may count as fraud prevention or security for location, fitness info
   and user IDs.
6. *Database TLS.* Confirm the Render `DATABASE_URL` carries
   `sslmode=verify-full` (value never read here).
