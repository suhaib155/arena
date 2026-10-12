# Play Console submission worksheet (Play v1)

Answers are drafted from the code on the release branch (see `DATA_INVENTORY.md`).
The owner reviews and submits every declaration; items marked
**REQUIRES_OWNER/CONSOLE_CONFIRMATION** depend on facts only the Play Console
or the owner can confirm.

## App setup

| Field | Draft answer | Evidence |
|---|---|---|
| App name | MovenRun (subject to availability) | `mobile/app.json` |
| Package | `io.movenrun.app` (never change after first upload) | `app.json`, `easReleaseConfig.test.ts` |
| Default language | English (United States) | |
| App or game | **Game** | Missions, XP, levels, badges |
| Category | **Adventure** (alternative: Sports). REQUIRES_OWNER/CONSOLE_CONFIRMATION | Core loop is real-world exploration with missions |
| Free or paid | Free | No purchases in the app |
| Contact email | `{{SUPPORT_EMAIL}}` (X-02) | |
| Website | https://movenrun-website.vercel.app/ (or owner domain) | |
| Privacy policy URL | `https://<site>/privacy/` | `website/privacy/index.html` |

## App content

| Declaration | Draft answer | Notes |
|---|---|---|
| Privacy policy | URL above | Must be public and load without sign-in |
| Ads | **No, the app does not contain ads** | No ad SDK |
| App access | **Some functionality is restricted**: sign-in is optional, account features need an email code | Reviewer instructions below |
| Content rating (IARC) | Questionnaire: no violence, no sexual content, no gambling, no user-to-user communication, no sharing of location with other users, shares images only via the system share sheet at the user's choice, no purchases. Expected rating: Everyone / PEGI 3. REQUIRES_OWNER/CONSOLE_CONFIRMATION | |
| Target audience | **13 and over** (13–15, 16–17, 18+). Not designed for children | Privacy policy "Children" section |
| News app | No | |
| COVID-19 contact tracing | No | |
| Data safety | See next section | |
| Government app | No | |
| Financial features | **The app does not provide any financial features** | No payments, tokens, wallets, trading or lending in v1 |
| Health apps | **No** health features declared. REQUIRES_OWNER/CONSOLE_CONFIRMATION (Play may ask about fitness; the app records distance and time for a game, makes no health claims and does not use Health Connect) | |
| Blockchain / crypto | Not applicable: no blockchain-based content in v1 | Wallet and Deed surfaces unreachable (`releaseScope.ts`) |
| Account deletion | Yes, accounts can be created. In-app path: Profile → Account → Account security → Delete account. Web URL: `https://<site>/account-deletion/` | `accountDeletion.ts`, e2e evidence E-11 |

## Data safety

Does the app collect or share user data? **Yes.** Is all data encrypted in transit? **Yes** (HTTPS only). Can users request deletion? **Yes.**

| Data type | Collected | Shared | Optional? | Purposes | Processed ephemerally? |
|---|---|---|---|---|---|
| Location → Precise location | Yes (signed-in players saving a session send route points to MovenRun) | No | Optional (play without an account; location itself needed for a session) | App functionality | Raw points: yes, processed in memory. Coarse cells derived and stored |
| Location → Approximate location | Yes (H3 cells ~0.74 km² stored with verified sessions) | No | Optional | App functionality | No |
| Personal info → Email address | Yes | No | Optional (only for an account) | Account management, App functionality | No |
| Personal info → User IDs | Yes (internal account id) | No | Optional | Account management | No |
| App activity → Other actions (verified session summaries: distance, duration) | Yes | No | Optional | App functionality | No |
| Device or other IDs | No (only a generic label and a hashed user agent for the session list). REQUIRES_OWNER/CONSOLE_CONFIRMATION | | | | |
| App info and performance → Crash logs / diagnostics | No in-app SDK. Google Play vitals are collected by Google, not declared by the developer | | | | |

"Shared" means transferred to a third party for its own use. Service providers
(email delivery, hosting, Google Maps rendering) act on MovenRun's behalf and are
not "sharing" under Play's definition. Google Maps SDK: confirm Google's current
SDK guidance for Data safety in the console. REQUIRES_OWNER/CONSOLE_CONFIRMATION.

## App access instructions for reviewers (paste into App access)

> MovenRun can be played without an account. On the first screen, accept the
> Terms of Use and Privacy Policy, then tap "Start exploring" and start a Free
> Run from the Move button. Location permission is requested when a movement
> session starts.
>
> To review account features (verified sessions, Account security, Delete account):
> 1. On the first screen accept the Terms and Privacy Policy (or later open Profile → Account).
> 2. Enter the email `{{REVIEW_EMAIL}}` and tap to send the code. No email is sent for this account.
> 3. Enter the code `{{REVIEW_CODE}}`.
> The account works from any location. Deleting it is allowed; signing in again
> with the same email and code creates a fresh account.

The review email and code are server secrets (`IDENTITY_REVIEW_EMAIL`,
`IDENTITY_REVIEW_CODE`) set by the owner in the hosting dashboard (X-07). They
are not in the repository. The code obeys the normal expiry, single use, five
attempt cap and resend throttle; only that one email is affected.

## Store listing

See `STORE_LISTING.md` and `store-assets/`.
