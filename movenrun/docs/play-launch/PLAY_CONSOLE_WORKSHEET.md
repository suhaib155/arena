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
| Location → Precise location | Yes (signed-in players saving a session send route points to MovenRun; the H3 cells crossed, ~0.74 km² each, are stored) | No | Optional (play without an account; location itself needed for a session) | App functionality | **No** (17 Oct correction, see below) |
| Location → Approximate location | Yes, the same session data: declare it too (Android grants coarse location and the app requests it) | No | Optional | App functionality | No |
| Personal info → Email address | Yes (Google sign-in only) | No | Optional | Account management | No |
| Personal info → Name | Yes: Google provides the name to our sign-in provider (Supabase), which stores it; the app does not use it | No | Optional | Account management | No |
| Personal info → User IDs | Yes: internal account id, Supabase user id, Google account id, **public wallet address** (wallet sign-in). REQUIRES_OWNER/CONSOLE_CONFIRMATION of the wallet address category | No | Optional | Account management | No |
| App activity → Other actions (verified session summaries: distance, duration) | Yes | No | Optional | App functionality | No |
| Health and fitness → Fitness info (the same distance and duration of walks, runs and rides) | Yes, recommended (17 Oct): Play describes this type as information about physical activity. REQUIRES_OWNER/CONSOLE_CONFIRMATION | No | Optional | App functionality | No |
| Device or other IDs | No (only a generic label and a hashed user agent for the session list). REQUIRES_OWNER/CONSOLE_CONFIRMATION | | | | |
| App info and performance → Crash logs / diagnostics | No in-app SDK. Google Play vitals are collected by Google, not declared by the developer | | | | |

**17 Oct corrections to check before submitting.**

- *Precise, not only approximate.* Play's Data safety help defines
  approximate location as an area of about 3 km² or more. The stored H3
  res-8 cells are ~0.74 km² each and form a trail, which is finer than that,
  so the stored cells count as **precise** location that is **not** processed
  ephemerally. The earlier draft ("raw points ephemeral, cells approximate")
  under-declared. The privacy policy already describes the cells ("about
  0.7 km² each"); no wording change is needed there for this.
- *Fitness info.* Distance and duration of a walk, run or ride is physical
  activity data. Declaring it is the safer answer; not declaring it is only
  right if the console's current description clearly excludes a game's
  session summary.

**The form, in the order the console asks** (drafted from
`DATA_INVENTORY.md`):

| Question | Draft answer |
|---|---|
| Does your app collect or share any of the required user data types? | Yes |
| Is all of the user data collected by your app encrypted in transit? | Yes (every request from the app and the website is HTTPS) |
| Which account creation methods does your app support? | OAuth (Continue with Google) and Other: a wallet signature (EIP-4361). No username and password |
| Do you provide a way for users to request that their data is deleted? | Yes: in the app and at `https://movenrun.xyz/account-deletion/` |
| Data types | The table above: Location (precise, approximate), Personal info (email, name, user IDs), Health and fitness (fitness info), App activity (other actions). Not collected: financial info, messages, photos and videos (the share image goes only where the player sends it), audio, files, calendar, contacts, web browsing, device or other IDs, app info and performance |
| For each type: collected / shared | Collected; not shared. Supabase, Render and Google Maps act as service providers |
| For each type: processed ephemerally? | No for all declared types (the stored rows outlive the request) |
| For each type: required or optional? | Optional: the app is playable without an account, and only signed-in saves send data |
| For each type: purposes | App functionality; Account management for email, name and user IDs. Not analytics, advertising, personalisation, fraud prevention (unless the console counts the movement plausibility check as fraud prevention: then add it for location and fitness info), or developer communications |
| Independent security review | No |

"Shared" means transferred to a third party for its own use. Service providers
(Supabase Auth and database, Render hosting, Google Sign-In, Google Maps rendering) act on MovenRun's behalf and are
not "sharing" under Play's definition. Google Maps SDK: confirm Google's current
SDK guidance for Data safety in the console. REQUIRES_OWNER/CONSOLE_CONFIRMATION.

**Cross-check, 17 Oct, against the website candidate (`a8586c9`,
`website/privacy/`) and `DATA_INVENTORY.md`.** The form above matches both,
with four points for the owner to see before submitting:

- *Profile picture and name.* The privacy page says Google shares "email
  address, name and profile picture" with Supabase Auth (stored in user
  metadata; the app never shows them). Name is declared. The picture is a
  URL, not a photo the app collects; Play's "Photos" type is about photos
  and the app does not receive image files. Declare Personal info → **Other
  info** for the picture URL if the console's wording suggests it.
  REQUIRES_OWNER/CONSOLE_CONFIRMATION.
- *Network address.* Used in memory for rate limiting and not stored by
  MovenRun (privacy page "Your network address"). Play has no IP address data
  type; providers' logs are theirs. No declaration.
- *Used Google sign-ins (30 days).* The privacy page describes a record of
  each spent Google sign-in session id with an expiry and no email or account
  id (migration 0010, draft #112). It holds no Play data type; no
  declaration. `DATA_INVENTORY.md` gets the table row when #112 is merged.
- *Website-only providers.* Vercel and Google Fonts serve the website, not
  the app; they do not enter the app's Data safety form.

**Store listing facts (check against `STORE_LISTING.md` before pasting).**
App name MovenRun; package `io.movenrun.app`; version 1.0.0; Game →
Adventure (or Sports); Free, no in-app purchases; contains ads: No; contact
`info@movenrun.xyz`; website `https://movenrun.xyz/`; privacy policy
`https://movenrun.xyz/privacy/`; account deletion
`https://movenrun.xyz/account-deletion/`; target audience 13+; Android 7.0+
(minSdk 24), target API 36; permissions: precise and approximate location
(foreground only), internet, vibration. Testing and release steps:
`PLAY_INTERNAL_RELEASE_WORKFLOW.md`.

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
