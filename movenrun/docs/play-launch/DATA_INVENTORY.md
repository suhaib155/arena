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
| Access and refresh tokens | Android keystore via expo-secure-store | Sent as bearer to the API | Until sign-out, deletion or expiry |
| Share image | App cache | Only to the app the player chooses | Cache cleaned on start |

## On the server (`movenrun/backend`, PostgreSQL)

| Table | Personal data | Purpose | Retention |
|---|---|---|---|
| `users` | Opaque id, status, timestamps | Account | Until deletion |
| `auth_identities` | Normalized email (provider subject) | Sign-in | Until deletion |
| `auth_sessions` | Device label ("Android device"), hashed user agent, keyed hash of refresh token, times | Sessions and device list | Until deletion (revoked rows kept until deletion) |
| `email_otp_challenges` | Email, keyed hash of code, hashed request source | One-time codes, throttling | Expire in 5 min; deleted one day after expiry (swept on each code request), and at once for the account's emails on deletion |
| `movement_verifications` | Distance, duration, pause total, mode, rules version, times, H3 res-8 cells crossed (~0.74 km² each), confidence, rejection reasons, seal summary | Verified progress, dedupe | Until deletion |
| `security_audit_events` | User id, event type, redacted metadata | Security | Deleted with the account; one anonymous `account_deleted` row kept |
| `wallets`, `wallet_link_challenges` | None created in v1 | Deferred | Deleted with the account |

Raw GPS points are never written to the database or logs: the API's error
handler and server never log request bodies (`backend/src/api/app.ts`), and
`runtime.test.ts` asserts no coordinate reaches the stored row.

## Third parties

| Party | Data | Role |
|---|---|---|
| Google Maps SDK for Android | Map viewport, device and network info | Map display (processor under Google terms) |
| Email delivery (Resend) | Email address, code | Sends sign-in codes |
| Hosting + PostgreSQL provider (staging default: Render web service + Supabase PostgreSQL; production to be confirmed, X-03) | All server data above | Processor. Database reached only over verified TLS; RLS keeps the provider's REST API empty |
| Google Play | Install, crash/ANR statistics (Android vitals) | Distribution |

No ads, analytics, crash-reporting, attribution or social SDKs are in the app
(`mobile/package.json`). No payments, tokens, wallets or blockchain calls in v1.

## Android permissions (release manifest)

Declared: `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, plus `INTERNET` and
`VIBRATE` from the platform template and expo-haptics. Removed with
`tools:node="remove"`: background location, foreground service (location),
system alert window, external storage read/write, media images, record audio.
Verified by `expo prebuild` on 2026-10-12 (see EVIDENCE E-07). The merged
manifest of the real AAB still has to be checked (R-04).
