# Play declarations, store assets and website truth (1 November 2026)

One source table for the first Google Play listing of the Movement Game v1.
Every row names the code it rests on. Nothing here has been entered in Play
Console, and nothing here is a legal sign-off. Earlier October drafts
(`PLAY_CONSOLE_WORKSHEET.md`, `STORE_LISTING.md`, `DATA_INVENTORY.md`) are
inputs, not current truth; where they differ, this file says which one is
right and why.

Pinned sources:

| What | Exact commit | Notes |
| --- | --- | --- |
| Android candidate | `ac8d87bed55f4dae0b9152ed21fa8cc29b8050f9` (`integration/android-qa0-28oct`) | The only SHA with a (conditional) build approval. No APK or AAB exists from it yet |
| Live staging API | `efd381bb6fc9e3be0229859d26ddee59cdbd410d` (`deploy/render-free-staging`) | Synchronous account deletion: `200 { deleted: true, erased, signInRecord }` |
| Live website | `61d30bbb009f809f60a05d1c4358fce7da7dadc9` (`web/a5-website-repairs`) | Vercel `dpl_ABCfgjsFiJ4DHtRnrLPCc8npLAuD`, aliased to `movenrun.xyz` |
| This change | branch `web/play-truth-1nov`, base `web/a5-website-repairs` | Not published |

## 1. Live website versus source

Checked 31 Oct 2026 22:37 UTC from an outside sandbox with a mobile user agent,
signed out, no cookies, no account data sent.

| URL | HTTP | Live bytes match | Truthful today? |
| --- | --- | --- | --- |
| `https://movenrun.xyz/` | 200 | `61d30bb:index.html` (sha256 `894f5d7de63d…`, 45,304 B) | No link to privacy, deletion or support anywhere on the page |
| `https://movenrun.xyz/privacy` | 200 | `61d30bb:privacy/index.html` (`ab93dd82e2c4…`) | No: "Deletion permanently removes …", "coarse map cells", "no third-party … crash-reporting SDKs" while the Maps SDK collects crash data |
| `https://movenrun.xyz/account-deletion` | 200 | `61d30bb:account-deletion/index.html` (`b9ab872875d3…`) | No: "permanently delete", "happens immediately", and the script says "have been deleted" for any 2xx, even when the sign-in record removal is still pending |
| `https://movenrun.xyz/support` | 200 | `61d30bb:support/index.html` (`9da1b59d40de…`) | No: "Both delete your account straight away" |
| `https://movenrun.xyz/sign-in` | 200 | `61d30bb:sign-in/index.html` (`234dd8707842…`) | Yes |
| `https://www.movenrun.xyz/` | 308 to apex | Vercel domain config | Yes |

Where the corrections sit:

| Correction | Branch | Website lineage | Can it be published as is? |
| --- | --- | --- | --- |
| #185 (squashed as `86267a9`) | `feat/g34-server-holdings` | Does **not** descend from the live site: it lacks the `web/a5` repairs, and its deletion page uses an inline script that the live CSP (`script-src 'self'`) blocks | No |
| #141, #160 (drafts) | `website/truthful-pending-deletion`, `website/pending-deletion-followup` | Descend from live `61d30bb` | Partly: still say "Our database plan has no automatic backups" and "the app does not currently show that status", which `ac8d87b` no longer matches |
| This change | `web/play-truth-1nov` (includes #141 and #160) | Descends from live `61d30bb` | Yes, once reviewed. Publishing is an owner action |

What this change fixes on the live lineage:

- Deletion page, privacy policy and support answer describe deletion as a
  request. They say "Deletion requested" or "Deletion pending" until the server
  confirms both the database erasure and the sign-in record removal, and say
  "Deletion complete" only then. No instant, permanent or time-bound claims.
- `js/deletion-outcome.js` decides the message from the status and body. It is
  correct for the current server (200 with `signInRecord`) and for the queued
  design behind migration 0011 (202, 409 `account_deletion_pending`, 503
  `deletion_busy`), so publishing the website does not depend on 0011.
- The absolute no-backup claim is gone. Copies made before a request, by us or
  by a provider, are disclosed as still holding data until deleted or expired.
- The stored H3 cells are called location data ("together they show
  approximately where you moved"), not "coarse".
- The Google Maps SDK's own collection is listed, per Google's disclosure page
  (last updated 2026-10-30): device and SDK details, network address, crash
  reports and stack traces from SDK code, a pseudonymous Maps SDK identifier,
  map pan and zoom events.
- The home page footer links the privacy policy, deletion page, support page
  and `info@movenrun.xyz`.
- `movenrun/website/tests/website.test.mjs` (29 tests) and the
  `website-checks` workflow. Run against the live files, 12 of the 29 fail;
  on this branch all pass.

Not changed, on purpose: the home page's planned Deeds and onchain sections
(owner scope, 13 Oct), the docs pages, and app copy (Lane 2 owns the app; see
section 8).

## 2. Data safety source table

"Collected" follows Play's definition: data sent off the device. Supabase,
Render and Google (Sign-In, Maps rendering) act as service providers, so
MovenRun's own collection is "not shared". The Maps SDK collects some data for
Google's own purposes; that is listed separately.

| Play data type | Answer | Source evidence | Ephemeral? | Required or optional | Purpose | Confidence |
| --- | --- | --- | --- | --- | --- | --- |
| Location: Precise | **Collected**, not shared | `app.json` requests `ACCESS_FINE_LOCATION`; signed-in saves send GPS points to `POST /movement/...` (`backend/src/movement/http/productionRouter.ts`), which reads them in memory; the stored `traversed_hex_ids` (`db/movement.schema.ts`) are H3 res 8 (`shared/src/constants/h3.ts`, about 0.74 km² each) and form a trail finer than Play's 3 km² approximate threshold | **No**: the cells outlive the request | Optional (guest play sends nothing) | App functionality | High |
| Location: Approximate | **Collected**, not shared | `ACCESS_COARSE_LOCATION` is requested; same data as above | No | Optional | App functionality | High |
| Health and fitness: Fitness info | **Collected** (recommended) | Stored `distance_meters`, `duration_seconds`, `movement_mode` per walk, run or ride | No | Optional | App functionality | Medium: owner/legal call |
| App activity: Other actions | Collected | Verified session summaries and result (`status`, `confidence`, `rejection_reasons`) | No | Optional | App functionality | Medium |
| Personal info: Email address | Collected (Google sign-in only) | Identity tables keep the email; Supabase Auth holds it | No | Optional | Account management | High |
| Personal info: Name | Collected by our sign-in provider, never read by app or API | Supabase Auth user metadata from Google | No | Optional | Account management | Medium: owner/legal call |
| Personal info: User IDs | Collected | Internal account id, Supabase user id, Google account id, **public wallet address** | No | Optional | Account management | High for collection; category of the wallet address is an owner/legal call |
| Personal info: Other info | Possibly: Google profile picture URL held by Supabase | Not image bytes; app and API never read it | No | Optional | Account management | Low: owner/legal call |
| Device or other IDs | **Not by MovenRun**. Yes **via the Maps SDK** (pseudonymous Maps SDK identifier) | App stores a constant device label only; `react-native-maps` 1.20.1 bundles the Google Maps SDK | n/a | n/a | Google: measure SDK use | Medium: declare unless Play's SDK guidance says otherwise |
| App info and performance: Crash logs, Diagnostics | **Not by MovenRun** (no crash or analytics SDK in `mobile/package.json`). Yes **via the Maps SDK** | Google Maps SDK disclosure page | n/a | n/a | Google: SDK stability | Medium |
| App activity: App interactions | Via the Maps SDK only (pan and zoom when camera APIs are used; the app uses them) | Google Maps SDK disclosure page | n/a | n/a | Google services | Medium |
| Photos and videos, Audio, Files, Contacts, Calendar, Messages, Financial info, Web history | **Not collected** | `RECORD_AUDIO`, media and storage permissions are in `blockedPermissions`; the share image goes only to the app the player picks (`expo-sharing`) | | | | High |
| Network (IP) address | No Play data type. Used in memory for rate limits, not stored; providers log it | Privacy policy "Your network address" | | | | High |

Form-level answers:

| Question | Answer | Evidence |
| --- | --- | --- |
| Collects or shares required data types? | Yes | Table above |
| All collected data encrypted in transit? | Yes | App and website call `https://` origins only; CSP `upgrade-insecure-requests`; HSTS |
| Account creation methods | OAuth (Continue with Google) and Other (wallet message signature, EIP-4361) | `website/js/account-auth.js`, identity router |
| Users can request deletion? | Yes: in app (Profile, Account, Account security, Delete account) and `https://movenrun.xyz/account-deletion/` | `app/account/security.tsx`, this change |
| Delete-account URL works signed out | Yes (HTTP 200, signed out, phone user agent) | Section 1 |
| Independent security review | No | |

### Deletion and retention facts the declarations rely on

- Current server (`efd381b`): erases account data in one transaction, then
  asks Supabase to remove the sign-in record; reports `signInRecord`
  `removed`, `none` or `pending`. Pending removals are retried.
- Queued design (#183, behind migration 0011, **not applied**): answers 202
  and finishes in the background. Website and app (`ac8d87b`) already word
  both cases correctly.
- Kept after deletion: one anonymous `account_deleted` event; Google exchange
  records (session id plus expiry, at least 30 days); wallet challenges until
  a later wallet sign-in clears them; any database copy made before the
  request; providers' own logs.
- Not proven: hosted capacity of the queue, that Supabase keeps no internal
  copies, and that every pending provider removal finishes. None of these is
  claimed anywhere.

## 3. App content declarations

| Declaration | Draft answer | Evidence or blocker |
| --- | --- | --- |
| Privacy policy URL | `https://movenrun.xyz/privacy/` | Live, 200 signed out; corrected copy not yet published |
| Ads | No ads | No ad SDK in `mobile/package.json` |
| App access | **BLOCKED**. Account features need Continue with Google or Continue with Wallet, and both providers are **off** in Supabase Auth. Reviewer login cannot be offered until the owner enables Google sign-in. No test accounts, bypass codes or shared credentials will be created | Owner decision X-05 |
| Content rating | Everyone / PEGI 3 expected: no violence, gambling, user-to-user chat, or location shared with other players | Owner completes the IARC questionnaire |
| Target audience | 13 and over; not designed for children | Privacy policy "Children" |
| Health apps | **Activity and Fitness** (recommended), not "no health features" | Records walks, runs and rides; no Health Connect, no body data |
| Financial features | None. Not a wallet or exchange; a wallet only signs one sign-in message | `releaseScope.ts`: `wallets: false`, `deeds: false` |
| Blockchain content | Same as above: no tokens, NFTs, balances or transactions in v1 | `releaseScope.ts`; privacy "No payments or tokens" |
| Government, news, COVID-19 | No | |
| Account deletion | Yes; in-app path and web URL above | |

## 4. Store listing text (supersedes `STORE_LISTING.md` where different)

**App name:** MovenRun
**Category:** Game, Adventure (or Sports). Owner picks in Console.
**Short description (69 characters):** Turn everyday walks and runs into missions and real-world progress.

**Full description:** use `STORE_LISTING.md` with these three changes:

1. "Delete your account and its data at any time, in the app or on the web"
   becomes "Request deletion of your account and its data at any time, in the
   app or on the web".
2. Under YOUR GROUND, keep the wording "as a personal map preview on your
   phone". Do not add territory, ownership, clubs, Deeds, points or tokens.
3. Under MISSIONS AND PROGRESS, keep "a server check confirms it and can
   withdraw it". Do not claim XP or verification behaviour that the final
   build does not show on a phone.

**Reviewer note:** replace "Deleting it is allowed; signing in again creates
a fresh account" with "Requesting deletion is allowed. The app shows
Deletion requested until the server confirms the removal is complete."
Paste the App access text only after Google sign-in is enabled (section 3).

## 5. Graphics and asset checklist

| Asset | Requirement | File | Status |
| --- | --- | --- | --- |
| App icon | 512×512 PNG, 32-bit with alpha, ≤ 1 MB | `docs/play-launch/store-assets/play-icon-512.png` on `ac8d87b` | **Ready**: 512×512, RGBA, 29 KB (checked) |
| Feature graphic | 1024×500 PNG or JPEG, no alpha, ≤ 1 MB | `store-assets/feature-graphic-1024x500.png` on `ac8d87b` | **Ready**: 1024×500, RGB, 178 KB (checked). Must not show territory, Deeds or token art; owner to confirm by eye |
| Phone screenshots | 2 to 8, from the **final Play build** on a real phone | none | **BLOCKED**: no build exists. Do not use mock-ups, website illustrations or emulator captures of features not in v1 |
| Adaptive and monochrome icons | Expo assets | `mobile/assets/` | In the candidate; validated by `nativeAssets.test.ts` |

Screenshot shot list (public place, no home address, email or private
coordinates, light mode, notifications hidden, real sessions only):

1. Home task board after one real session.
2. Live session: route drawing on the Google map with distance and time.
3. Session summary with the route and the verified or pending state.
4. Share image preview with endpoints hidden.
5. Quests list.
6. Profile with level, streak and badges.
7. Optional: Account security with the Delete account section.

Removed from the October list: the territory map capture. The personal
preview ships in v1, but a store screenshot of captured ground is the image
most easily read as ownership or a game feature the build does not have.

## 6. Build and signing matrix

| Item | Preview APK (phone testing) | Production AAB (Play) |
| --- | --- | --- |
| EAS profile | `preview`, `buildType: apk`, `distribution: internal` | `production`, `buildType: app-bundle`, `autoIncrement` |
| Approved? | One build, only from `ac8d87b`, only after the Lane 1 preflight passes. **Not started** | **No approval.** Needs a new owner decision |
| Signing key | EAS-managed upload or preview key | Play App Signing key (Google holds it); upload key in EAS |
| Maps key restriction | Package `io.movenrun.app` plus the **EAS preview** SHA-1 | Package plus the **Play App Signing** SHA-1 (from Console after the first upload) |
| Target and min SDK | 36 and 24 (Expo SDK 54; `androidTargetSdk.test.ts`) | Same; confirm against the target API level Play Console requires on the day of upload |
| 16 KB page size | Source guard `android16kPageSize.test.ts` | Must be confirmed on the real AAB in Console |
| Can it go to Play? | No | Yes, after the gates below |

## 7. Play account and testing gate (X-01)

- No Play developer account exists yet (owner, 13 Oct). Nothing here creates
  one or pays the registration fee.
- If the owner opens a **personal** account (created after 13 Nov 2023),
  Google requires a closed test with **at least 12 testers opted in for 14
  consecutive days** before production access can be requested (Play Console
  Help, answer 14151465, read 31 Oct 2026). Testers who leave before 14 days do
  not count. No launch date is promised.
- An organization account needs a D-U-N-S number for a real entity; only
  choose it if one exists.

## 8. Vercel inventory and ranked plan (read only)

Read 31 Oct 2026 through the connected Vercel account (`ghantareum-4453`). No
setting was changed.

| Project | Repo link and root | Domains | Latest builds | Role |
| --- | --- | --- | --- | --- |
| `movenrun-website` | `suhaib155/arena`, root `movenrun/website`, production branch `main` | `movenrun.xyz`, `www.movenrun.xyz` (308 to apex) | READY previews on every push | **Live site.** Production `dpl_ABCfgjsF…` from `web/a5-website-repairs` @ `61d30bb`, promoted by hand |
| `arena` | same repo, root `movenrun` | `arena-zeta-nine.vercel.app` | ERROR on every push | Unused |
| `arena-qg9n` | same repo, root `movenrun` | `arena-qg9n.vercel.app` | ERROR on every push | Unused |
| `arena-pchb` | same repo, root `movenrun` | `arena-pchb.vercel.app` | ERROR on every push | Unused |
| `arena-vv61` | same repo, repo root | `arena-vv61.vercel.app` | READY on every push | Unused; only old audit docs mention its address |
| Five other projects | other repos or none | | | Not MovenRun; untouched |

Every push to any branch of `suhaib155/arena` starts five Vercel builds.

Ranked plan, safest and most useful first. Each step is the owner's, in the
Vercel dashboard, and each can be reversed by reconnecting the repository:

1. **Protect the live site.** `movenrun-website` has production branch `main`
   and auto-assigns custom domains. `main` (`d344c3b`, 31 Aug) carries an older
   website. A push to `main` that touches the website would replace the live
   site at `movenrun.xyz` without anyone promoting it. Change the production
   branch to `web/a5-website-repairs`, or turn off automatic production
   deployments. Impact: none on the live site.
2. Disconnect Git from `arena`, `arena-qg9n` and `arena-pchb`. They have never
   built successfully, serve only `*.vercel.app` addresses and nothing links
   to them. Impact: three fewer failed builds per push.
3. Disconnect Git from `arena-vv61`. Impact: one fewer build per push; its
   address stops updating.
4. Optional: in `movenrun-website`, add an ignored build step so previews build
   only when `movenrun/website/` changes.

Deleting projects is not proposed.

## 9. Owner gates for Lane 4, in order

1. **Review and publish the website correction.** Phone: Vercel dashboard,
   `movenrun-website`, Deployments, open the preview for `web/play-truth-1nov`,
   check `/privacy/`, `/account-deletion/`, `/support/`, then Promote to
   Production. Confirmation: "Website correction promoted; movenrun.xyz shows
   'Request account deletion' as the deletion page title."
2. **Change the production branch** (section 8, step 1). Phone: Vercel,
   `movenrun-website`, Settings, Git, Production Branch. Confirmation:
   "Production branch set to web/a5-website-repairs."
3. **Disconnect the four unused projects** (section 8, steps 2 and 3).
   Confirmation: "Disconnected arena, arena-qg9n, arena-pchb, arena-vv61."
4. Later, with legal advice: approve the Data safety rows marked owner/legal
   call, and the Health apps answer.
5. Later: open the Play developer account (personal or organization).

## 10. For other lanes

- App copy (Lane 2): `app/legal.tsx` on `ac8d87b` still says "the coarse map
  cells crossed". It should match the website ("approximately where you
  moved"). Text only.
- `PLAY_CONSOLE_WORKSHEET.md` and `HANDSET_TEST_SCRIPT.md` deletion rows: use
  the wording in section 4 and the #185 audit rows 13 and 14 when those files
  are next edited on the Android branch.
