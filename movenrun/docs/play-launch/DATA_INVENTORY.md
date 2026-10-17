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
| `auth_sessions` | Device label ("Android device"), hashed user agent, keyed hash of refresh token, times | Sessions and device list | Until 7 days after the refresh token expires (30 days after issue), or account deletion if sooner; deleted by the API's background clean-up (F-18) |
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
| Google Maps SDK for Android | Map viewport, device and network info | Map display (processor under Google terms) |
| Google (Sign-In via Supabase) | Google account email, name, picture, Google id | Authenticates "Continue with Google" |
| Supabase (Auth + PostgreSQL, us-east-1) | Everything in the two tables above | Processor |
| The player's wallet app (MetaMask, Coinbase Wallet, Trust Wallet) | The sign-in message | The player's own app; signs one message |
| Render (API host, Free) | Requests in transit; no request bodies logged | Processor. Database reached only over verified TLS; RLS keeps Supabase's REST API empty |
| Google Play | Install, crash/ANR statistics (Android vitals) | Distribution |

No ads, analytics, crash-reporting, attribution or social SDKs are in the app
(`mobile/package.json`). No payments or tokens. No blockchain calls: a wallet only signs one plain-text sign-in message; MovenRun sends no transaction, reads no balance and stores no wallet in v1. The app adds expo-web-browser and expo-crypto (system browser and hashing), both first-party Expo modules with no data collection.

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
