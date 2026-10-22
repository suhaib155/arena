# Play declaration drafts (Track C, C3)

Checkpoint: 22 October 2026
Source heads: backend/shared 2326aa6 (= live API 2192de6); mobile 15f7f87 (#125); website 61d30bb (live); existing worksheet docs/play-launch/PLAY_CONSOLE_WORKSHEET.md on the board head.
Claim classes: SOURCE VERIFIED / LOCAL TEST CONFIRMED / REVIEWER REPORTED / OWNER-PROVIDER GATED / NOT RUN / UNKNOWN.

Every answer below is DRAFT. The owner (with legal advice where needed) submits every declaration; nothing here has been entered in Play Console (no developer account exists). Official rules: Data safety https://support.google.com/googleplay/android-developer/answer/10787469; User Data and account deletion https://support.google.com/googleplay/android-developer/answer/10144311 and /13327111; Health apps /14738291; Financial features /13849271; all retrieved 2026-10-22 (see OFFICIAL_SOURCES.md). Field-level evidence is in DATA_FLOW_AND_RETENTION_MATRIX.md (rows cited as "M#").
Path shorthand: B = movenrun/backend/src @2326aa6; M = movenrun/mobile @15f7f87; W = movenrun/website @61d30bb.
Confidence: H = source read, answer follows from definition; M = depends on a definition or provider fact; L = depends on unknown.

## 1. Data safety

Top-level (DRAFT):
| Question | Draft | Evidence | Conf |
|---|---|---|---|
| Collects or shares required user data types? | Yes | rows below | H |
| All data encrypted in transit? | Yes for traffic to the API and Supabase (HTTPS; Android cleartext disabled). Maps SDK traffic is Google's own; confirm in Google's SDK disclosure | M/plugins/withAndroidHardening.js:25-29; W/vercel.json CSP upgrade-insecure-requests; API host https | M. Live TLS NOT RUN |
| Users can request data deletion? | Yes (in-app and web) | section 4 | H |
| Independent security review | Do not claim | none exists | H |

Per data type. "Required" = cannot use the feature without it. "Ephemeral" per Play: only in memory and discarded when the request completes.

| Data type | Collected? | Shared? | Required / optional | Purposes (Play list) | Ephemeral? | Evidence | Conf |
|---|---|---|---|---|---|---|---|
| Location > Precise location | Yes: GPS points leave the device when a signed-in player saves a session (M1, M12); H3 res-8 cells stored (M13) | No for our processing (Render and Supabase act on our behalf). Google Maps SDK transfers data to Google independently (M4): owner decision whether to mark Shared per Google's SDK guidance | Optional overall (guest play works, signed-out sessions upload nothing). Location permission is needed to start a session | App functionality. Account management: no | Route points: yes in memory on the server; the stored cell list is not ephemeral. Answer per type: owner decision | M/app.json:28-31; M/src/lib/pendingVerification.ts:126-173; B/movement/http/validation.ts:27-33,76; B/db/movement.schema.ts:22-23,26-68 | M |
| Location > Approximate location | Draft: Yes, only if owner treats the res-8 cell list (~0.74 km2, below Play's 3 km2 precise threshold) as a separate coarse record. Recommended: declare cells under Precise to avoid under-declaring | No | Optional | App functionality | No | S/constants/h3.ts:1 (res 8); Play definition: precise < 3 km2, approx >= 3 km2 | L. Owner/legal determination |
| Personal info > Email address | Yes, Google sign-in only (M14) | No | Optional | Account management | No | B/db/identity.schema.ts:74; M/src/lib/signInMethods.ts:90 | H |
| Personal info > Name | Name and avatar sit at Supabase from Google. Not stored by our backend (M15). Draft: Yes (collected via sign-in provider on our behalf), purpose Account management | No | Optional | Account management | No | docs/play-launch/DATA_INVENTORY.md Supabase Auth table; B grep: no avatar/name handling | M. auth.users contents OWNER-PROVIDER GATED |
| Personal info > User IDs | Yes: MovenRun user id, Supabase user id, public wallet address (wallet sign-in) | No | Optional | Account management; App functionality | No | B/db/identity.schema.ts:61-92,288-301 | M. Wallet-address category is UNKNOWN on Play's page |
| App activity > Other user-generated content / App interactions | Verified session summaries: distance, duration, mode, times, seal summary (M13). Draft category: "Other actions"; owner pick | No | Optional | App functionality | No | B/db/movement.schema.ts:26-68 | M |
| App activity > Other (security events) | Audit event types tied to user id (M20) | No | Required for account holders | Fraud prevention, security, and compliance | No | B/db/identity.schema.ts:235-250 | M. Metadata contents UNKNOWN |
| App info and performance | No app-side crash or diagnostics SDK. Google Play vitals are collected by Google, not declared by us | n/a | n/a | n/a | n/a | M/package.json (no sentry/firebase); M/app/legal.tsx:13 | H for app-side |
| Device or other IDs | Draft: No. A generic label ("Android device") is stored; the user-agent hash column exists but is never populated on the Supabase path. IP is processed in memory; hosting providers see it | n/a | n/a | n/a | n/a | B/identity/http/router.ts:148-149; B/db/identity.schema.ts:164-165 | M. Owner/legal determination on IP |
| Financial info; Health and fitness data; Contacts; Photos; Audio; Files; Messages; Web history | No | n/a | n/a | n/a | n/a | M/app.json:32-41 blocked permissions; no such APIs in package.json | H (source) |

Also disclose (not asked by the form, needed in the privacy policy per Play): retention and deletion (matrix section 3), unsent sessions on device, third parties (Google Maps SDK, Google sign-in, Supabase, Render, Vercel website, Google Fonts on the website).

## 2. Health apps declaration (DRAFT, owner/legal determination)
- Play requires every published app to complete it, even if answering "no health features" (https://support.google.com/googleplay/android-developer/answer/14738291, 2026-10-22).
- Likely relevant category: Activity and Fitness ("apps that monitor and record physical activities"). The app records walking/running distance, duration, pace-derived verification and a movement mode (M13). It makes no medical claim: in-app Terms say "not medical or navigation advice" (M/app/legal.tsx:19). No Health Connect (not in M/package.json).
- Conflict to resolve: existing worksheet says "No health features" (docs/play-launch/PLAY_CONSOLE_WORKSHEET.md, Health apps row). Source suggests the safer draft is to declare Activity and Fitness and describe it as a game. Confidence L. Question for owner: declare Activity and Fitness, or "no health features" with a game-category rationale?

## 3. Financial features declaration (DRAFT, owner determination)
- Draft: no financial features. v1 has no purchases, payouts, tokens, balances or deeds; wallet is used only to sign one message (M/src/lib/releaseScope.ts:10-30 wallets/deeds features off; legal copy M/app/legal.tsx:18; W/privacy/index.html:100).
- The form lists categories "Cryptocurrency wallet", "Tokenized digital asset (NFT)...", "Mobile payments and digital wallets" (https://support.google.com/googleplay/android-developer/answer/13849271, 2026-10-22). Whether message-signing sign-in counts: not stated on that page (UNKNOWN). Flag to owner. Keep consistent: website onchain docs call deeds "planned" (WEBSITE_FACTS Part 1, docs pages); owner may want to confirm no earn-for-play promise (Play blockchain content policy https://support.google.com/googleplay/android-developer/answer/13607354).
- Do not state "no wallet features" anywhere (wallet sign-in exists; source: B/identity/services/supabaseSignIn.service.ts:195-213).

## 4. Account deletion (DRAFT)
| Item | Answer | Evidence | Conf |
|---|---|---|---|
| Accounts can be created in app | Yes (Google or wallet) | M/app/welcome.tsx:1-10; M/src/lib/signInMethods.ts:88 | H |
| In-app deletion path | Profile > Account > Account security > Delete account (confirm dialog) | M/app/account/security.tsx:176-201,321-336 | H (source). On-device NOT RUN |
| Web deletion URL | https://movenrun.xyz/account-deletion/ (sign in with Google or wallet, then delete). Page must carry the app/developer name as on the listing: check at listing time | W/account-deletion/index.html; M/app/legal.tsx:15 | M. Live page state per WEBSITE_FACTS |
| Data deleted | Account, sign-in sessions, every verified session summary, security events, provider sign-in record (queued retry) | B/identity/accountDeletion.ts:79-124 | H |
| Data kept | One anonymous `account_deleted` count; owner-made encrypted copies if any (UNKNOWN); provider logs; wallet challenge and Google exchange rows until their purge (see audit) | B/identity/accountDeletion.ts:116-123; W/account-deletion/index.html:36 | M |
| Known gap | Neither website nor app shows "pending" provider deletion (matrix section 3) | B/identity/http/router.ts:372-373; M/src/services/identityApi.ts:471-476 | H |
| Email fallback | info@movenrun.xyz, manual, no SLA | W/support/index.html:26-27 | Mailbox OWNER-PROVIDER GATED |

## 5. App access for reviewers (DRAFT)
- No bypass or hidden credentials exist; do not add one. Guest play exists: first screen offers "explore as a guest"; "Guest play is not a sign-in method and is always available" (M/app/welcome.tsx:6; M/src/lib/releaseScope.ts:86).
- Proposed honest text: "Core movement play needs no account: accept terms, choose explore as guest, start a Free Run, grant location when prompted. Account features (verified sessions, Account security, Delete account) need Continue with Google with the reviewer's own Google account, or a wallet app. No credentials are provided. New accounts are limited to 1,000 in the first release; if the cap is reached or the free-hosted service is asleep, sign-in may take about a minute or fail."
- Limits to state (UNKNOWN until live): API cold start (Render Free spins down after 15 minutes idle and takes about a minute to wake, https://render.com/docs/free, 2026-10-22); Google and wallet providers are OFF at last report, so sign-in cannot be reviewed until the owner turns them on; reviewers need a physical or emulated location source.
- Existing worksheet draft has the same approach (docs/play-launch/PLAY_CONSOLE_WORKSHEET.md "App access"); confirm Play accepts "use your own Google account" (REQUIRES owner/console confirmation).

## 6. Other declarations
| Item | Draft | Evidence | Conf |
|---|---|---|---|
| Ads | No ads | No ad SDK: M/package.json; W/privacy/index.html:35,68 | H (app source) |
| Content rating inputs | No violence, sexual content, gambling, user-to-user chat; location is not shared with other users (v1 has no multiplayer); shares an image only via system share sheet at user's choice; no purchases. Expected low rating; IARC result decides | M/src/lib/releaseScope.ts (clubs, competition off); M/app/legal.tsx:12 | M |
| Target audience | 13 and over; not directed to children. Owner/legal determination for age-gating and Families policy | W/privacy/index.html:97; no age field in schema | M |
| Privacy policy URL | https://movenrun.xyz/privacy/ (HTML, public, non-PDF). Must match app behavior: see PRIVACY_CLAIM_CONSISTENCY_AUDIT.md before submission | W/privacy/index.html | M |
| App category | Game (Adventure or Sports): owner choice | worksheet | L |
| Prominent location disclosure | Only the OS permission string "MovenRun uses location during a movement session to draw your route and calculate progress." (M/app.json:54) and an upload note on the summary screen (M/app/move/summary.tsx:683-685). No dedicated pre-permission screen found; permission is requested from the move readiness flow (M/app/move/index.tsx:72-100; text not read). Play requires in-app disclosure immediately before the runtime prompt (https://support.google.com/googleplay/android-developer/answer/10144311) | M | L. Question for owner |

## 7. Decision worksheet (owner)
| # | Decision | Options | Recommendation | Blocks |
|---|---|---|---|---|
| 1 | Health declaration | Activity and Fitness / no health features | Activity and Fitness; confirm with legal | Console form |
| 2 | Res-8 cells category | Precise only / Precise + Approximate | Precise only, explained in policy | Data safety |
| 3 | Google Maps SDK sharing | Mark Shared / not | Follow Google's current SDK guidance | Data safety |
| 4 | Wallet address category | User IDs / other | User IDs; Play page silent | Data safety |
| 5 | Financial features answer | None / crypto wallet category | None, with the sign-in-only explanation | Console form |
| 6 | Prominent disclosure before location prompt | Add screen / rely on OS string + readiness text | Add (patch proposal: one screen on first Start stating "MovenRun uses your precise location while a session is running and, if you are signed in and tap Save, sends the route points once to verify distance"). Not applied to #125 | Policy compliance |
| 7 | Reviewer access | Own Google account / provide test account | Own Google account; no bypass | App access |
| 8 | Backups statement | Confirm none / document copies | Check Supabase plan and any owner copies | Privacy text |

## Integration digest
- Affected paths: docs/parallel/play-assurance/PLAY_DECLARATION_DRAFTS.md (new). Conflicts: docs/play-launch/PLAY_CONSOLE_WORKSHEET.md says Health "No" and lists coarse cells as Approximate; this draft differs on both.
- Evidence SHAs: B 2326aa6, M 15f7f87, W 61d30bb; official pages retrieved 2026-10-22.
- Next decisions (max 3): Health declaration; in-app prominent disclosure before the location prompt; Maps SDK sharing answer.
