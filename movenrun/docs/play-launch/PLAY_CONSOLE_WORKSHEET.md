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
| Contact email | `info@movenrun.xyz` (developer name "Team MovenRun") | D-22 |
| Website | https://movenrun.xyz/ (X-21) | |
| Privacy policy URL | `https://movenrun.xyz/privacy/` | `website/privacy/index.html` |

## App content

| Declaration | Draft answer | Notes |
|---|---|---|
| Privacy policy | URL above | Must be public and load without sign-in |
| Ads | **No, the app does not contain ads** | No ad SDK |
| App access | **Some functionality is restricted**: sign-in is optional; account features need Continue with Google (any Google account) or a wallet. No credentials need to be supplied. REQUIRES_OWNER/CONSOLE_CONFIRMATION that Play accepts "sign in with your own Google account" for this app | Reviewer instructions below |
| Content rating (IARC) | Questionnaire: no violence, no sexual content, no gambling, no user-to-user communication, no sharing of location with other users, shares images only via the system share sheet at the user's choice, no purchases. Expected rating: Everyone / PEGI 3. REQUIRES_OWNER/CONSOLE_CONFIRMATION | |
| Target audience | **13 and over** (13–15, 16–17, 18+). Not designed for children | Privacy policy "Children" section |
| News app | No | |
| COVID-19 contact tracing | No | |
| Data safety | See next section | |
| Government app | No | |
| Financial features | **The app does not provide any financial features.** It is not a crypto wallet or exchange: an external wallet app is used **only to sign one sign-in message**. No payments, tokens, transfers, balances, trading or lending. REQUIRES_OWNER/CONSOLE_CONFIRMATION when the form lists crypto categories | D-18, `website/sign-in/` |
| Health apps | **No** health features declared. REQUIRES_OWNER/CONSOLE_CONFIRMATION (Play may ask about fitness; the app records distance and time for a game, makes no health claims and does not use Health Connect) | |
| Blockchain / crypto | **Do not answer "no wallet features".** Accurate statement: "Players may sign in by signing a message with their own Ethereum wallet (EIP-4361). The app sends no transactions, holds no keys, reads no balances and has no tokens, NFTs or blockchain-based rewards." Wallet management and Deed screens are unreachable in v1 (`releaseScope.ts`) | D-16, D-18 |
| Account deletion | Yes, accounts can be created (Google or wallet). In-app path: Profile → Account → Account security → Delete account. Web URL: `https://movenrun.xyz/account-deletion/` (sign in with Google or the wallet, then delete; works for wallet-only accounts with no email) | `accountDeletion.ts`, E-24 |

## Data safety

Does the app collect or share user data? **Yes.** Is all data encrypted in transit? **Yes** (HTTPS only). Can users request deletion? **Yes.**

| Data type | Collected | Shared | Optional? | Purposes | Processed ephemerally? |
|---|---|---|---|---|---|
| Location → Precise location | Yes (signed-in players saving a session send route points to MovenRun) | No | Optional (play without an account; location itself needed for a session) | App functionality | Raw points: yes, processed in memory. Coarse cells derived and stored |
| Location → Approximate location | Yes (H3 cells ~0.74 km² stored with verified sessions) | No | Optional | App functionality | No |
| Personal info → Email address | Yes (Google sign-in only) | No | Optional | Account management | No |
| Personal info → Name | Yes: Google provides the name to our sign-in provider (Supabase), which stores it; the app does not use it | No | Optional | Account management | No |
| Personal info → User IDs | Yes: internal account id, Supabase user id, Google account id, **public wallet address** (wallet sign-in). REQUIRES_OWNER/CONSOLE_CONFIRMATION of the wallet address category | No | Optional | Account management | No |
| App activity → Other actions (verified session summaries: distance, duration) | Yes | No | Optional | App functionality | No |
| Device or other IDs | No (only a generic label and a hashed user agent for the session list). REQUIRES_OWNER/CONSOLE_CONFIRMATION | | | | |
| App info and performance → Crash logs / diagnostics | No in-app SDK. Google Play vitals are collected by Google, not declared by the developer | | | | |

"Shared" means transferred to a third party for its own use. Service providers
(Supabase Auth and database, Render hosting, Google Sign-In, Google Maps rendering) act on MovenRun's behalf and are
not "sharing" under Play's definition. Google Maps SDK: confirm Google's current
SDK guidance for Data safety in the console. REQUIRES_OWNER/CONSOLE_CONFIRMATION.

## App access instructions for reviewers (paste into App access)

> MovenRun can be played without an account. On the first screen, accept the
> Terms of Use and Privacy Policy, then tap "Start exploring" and start a Free
> Run from the Move button. Location permission is requested when a movement
> session starts.
>
> To review account features (verified sessions, Account security, Delete
> account): on the first screen (or Profile → Account) tap **Continue with
> Google** and sign in with any Google account. A new MovenRun account is
> created on first sign-in. Deleting it is allowed; signing in again creates a
> fresh account.
>
> Continue with Wallet is optional. It opens the player's own wallet app to
> sign one message; it is not a transaction and needs no funds. No wallet,
> recovery phrase or cryptocurrency is needed to review the app.

No reviewer credentials, codes or test wallets exist (D-21).

## Store listing

See `STORE_LISTING.md` and `store-assets/`.
