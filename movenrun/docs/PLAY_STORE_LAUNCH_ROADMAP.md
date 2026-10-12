<!-- Reviewed import of the 12 October 2026 Google Play launch roadmap. Execution state lives in docs/play-launch/. -->

# MOVENRUN
## Google Play launch roadmap — reconciled implementation plan
**Decision edition | 12 October 2026**  
**Scope:** Android / Google Play version 1.0; Base Sepolia proof retained, public token economy deferred.

> **Launch decision:** We should NOT spend another 3–4 weeks upgrading Expo from SDK 51 as a standalone task. The mobile PR #105 branch already uses SDK 54, React Native 0.81.5 and Expo Router 6. Instead, consolidate and device-accept that work; make the gameplay and hosted service truthful; complete the Play compliance, artwork and AAB pipeline; then enter Play testing.

**Status:** NOT ready for Google Play upload or production release. This is a practical release plan, not a claim that the missing gates have passed.

---

## 01 — Source-of-truth reconciliation

The attached *MovenRun Play Store Launch* report (11 October 2026) reviewed an older review checkout. Several observations are valid for the old `main` branch but do not describe the more advanced open mobile PR stack. The release must be cut from an integrated, verified branch—not directly from old `main` and not from an untested combination of pending work.

| Question | Report says | Updated evidence / decision |
|---|---|---|
| Expo / API level | SDK 51, target API 34, 3–4 week platform upgrade | `main` still uses Expo ~51; PR #105 uses Expo ~54.0.36, RN 0.81.5, Router ~6.0.24. Expo SDK 54 defaults to target/compile API 36. **A real production AAB must prove the target.** |
| GPS + real map | Basic tracking; asks whether to add basemap | The #103–105 stack already includes real Google Maps, foreground acquisition, H3 context and route summary. Preserve it. |
| SDK 54 handset evidence | Missing | Earlier #104 APK was visually installed and photographed; #105 correctness APK and its complete physical walk/Back test are **not yet proven**. |
| Backend | Built but not live | Consistent with the project record: #102 preview API preparation is open, hosting/OTP/DB operations unproven. |
| Privacy policy | Not yet a standalone, production-verifiable site page | Treat as a **release blocker**. Do not submit without live policy and deletion URLs. |
| Assets | None in the older `mobile/` tree | Treat as **unverified/missing from release source** until the integrated branch contains valid files and listing exports. Screenshots from the old APK are not final release screenshots. |
| AAB/submit | Preview-only workflow, weak versioning | Verified: #105 `eas.json` has APK preview and a production AAB profile, but no configured `autoIncrement`, remote version source or `submit` stanza; manually dispatched CI builds only preview APK. |
| V3 contracts | Not deployed | Stale claim: the user's later V3 deployment report provides **nine reportedly verified Base Sepolia addresses**. Not an app-store prerequisite. |
| Play account / testing | Account type decides 12 testers / 14 days | Confirmed for new personal accounts created after 13 Nov 2023. **Account type/status must be read in the real Play Console**. |

**Repository checkpoint:** `suhaib155/arena`; confirmed `main` is SDK 51; mobile PRs **#103**, **#104**, **#105** remain open/draft/unmerged at review. #105 is `fix/demo-preflight-correctness` at `5f2eeeffd0836a64609acf168076bc0eeacfada1`. V3 contracts have a separate `feat/v3-onchain-core` branch. PR #102 backend preview is also open.

**Do not blindly merge the stack.** Reconstruct or merge in dependency order, prove the full combined head, check CI, then designate a signed release candidate.

---

## 02 — Freeze version 1.0: what MovenRun must be on Google Play

**Recommended v1 positioning:** *MovenRun is a real-world movement game. Walk or run with foreground location to complete missions, grow your player profile, view real routes, and explore the ground around you.*

### Must work in v1

1. Real Android start-up, clear onboarding and trustworthy permissions; no hidden demo mode.
2. Real foreground GPS; current marker and local Google basemap; credible distance and route with pause gaps preserved.
3. Free Run + an achievable quest; incomplete quests cannot award XP and standing still cannot grant movement rewards.
4. A polished end-to-end route/result/share experience including no-route and short-session outcomes.
5. XP, levels, collections/passport and history only to the extent they are honestly earned and persist correctly.
6. Real login and server session verification **if v1 requires accounts or advertises saved/synced progress**. Offline/local-only experiences must be labelled and handled honestly.
7. Location retention/deletion rules, in-app deletion option and external account-deletion webpage (if account creation is enabled).
8. Screens/links that refer to clubs, territory ownership, Deeds, MOVE and network status accurately reflect what actually works; disable or clearly mark unavailable interactive actions rather than suggesting they are live.
9. Fast cold-start, correct Android Back, no unreachable CTAs, stable app recovery, no sensitive data leakage.

### Explicitly outside v1

- Transferable MOVE balances or liquid movement rewards.
- In-app cryptocurrency wallet, NFT purchase, Deed claiming, marketplace, contest staking or onchain game transactions.
- Mainnet contracts, sponsored gas/paymaster, yield, token-income promises.
- Background location tracking or foreground-service-location expansion.
- Public competitive land ownership, PvP victories or club membership **unless a server-authoritative implementation is actually live and tested**.
- Fake routes, seeded player records or invented territories in ordinary production paths.

**Product scope gate:** There are two valid routes, but choose **A** for fastest honest Play launch:
- **A — Movement Game v1 (recommended):** real routes + mission/XP + usable summaries + reliable auth/persistence where provided; experimental territory visuals are informational only and non-functional buttons are removed.
- **B — Multiplayer Territory v1 (larger):** require authoritative H3 Solid/Shade, shared ownership state, cross-account conflict handling and two-device consistency **before** listing. This is a later milestone and may substantially delay launch.

The store listing must only describe whichever version has passed physical and backend acceptance.

---

## 03 — Engineering order: release integration and native acceptance

**Workstream M1 — release branch, 2–5 working days after dependencies are available**

- Verify open PR heads and dependencies. Integrate the accepted #103 → #104 → #105 mobile stack, plus any required security/privacy/movement improvements, into one `release/android-v1` candidate, without accidentally replacing SDK 54 with main's SDK 51.
- Keep an auditable PR with all changes; CI must run full mobile + shared + relevant backend tests on the **final integrated commit**, not only individual ancestor PRs.
- `yarn install --immutable`, `npx expo-doctor`, TypeScript, Hermes export, Android prebuild and permission diff must pass from the final branch.
- Verify `react-native-maps`, Android package `io.movenrun.app`, the correct Google Maps SDK key and required foreground-location consent.
- Inspect generated AAB and Play listing target: **target SDK 36+**. Also check **64-bit native libraries and 16 KB memory-page compatibility** in the actual app bundle/Play Console, since the app uses native dependencies. The SDK/package version is evidence, not a substitute for checking the built binary.
- Freeze map camera/current-position vs canonical movement evidence; avoid experimental GPS redesign after device acceptance.

**Workstream M2 — physical test matrix, 2–5 days**

- Real phone outside: 60–90 s standing still; marker shows; ~0 m; no false route. Five-minute stationary save: no movement XP/streak/defence.
- Walk 100–300 m: live route grows over local map and distance is plausible. Pause → walk → resume must not draw a bridge or charge paused distance.
- Finish early and complete a valid quest. Verify 0 XP for premature completion and exactly-once reward for valid completion.
- Actual image share to receiving app; redacted endpoints/no raw coordinates; no-world-map fallback for no route.
- Summary hardware Back (unsaved confirmation, cancel, confirmed leave, saved, short), no old route resurrects on zone detail or relaunch.
- Test smallest supported screen/large fonts, gestures/3-button navigation, permissions denial, reduced precision, background/foreground transitions, offline/retry and low memory.
- Remove the huge blank Club Territory screen if reachable, compress repetitive Summary content, improve GPS-acquisition empty state—but **no broad UI rewrite**.

**Workstream M3 — final release source**

- Lock the actual user-visible v1 capabilities and store claims. Disable unreachable, seeded or misleading features.
- Freeze dependency versions, signing identity, application ID and release notes. Keep only release candidate fixes after this point.

**M gate:** APK hand-tested; combined branch green; real AAB reports API 36+; no release-blocking bugs.

---

## 04 — Backend, hosting, authentication and real data

**The first operational deployment required for Play is the backend, not a new blockchain contract.**

- Deploy the server API behind HTTPS and real domain; configure production CORS, origin controls, health and error reporting, safe logging and environment validation.
- Provision managed PostgreSQL and Redis if BullMQ/queues are actually used; run and verify migrations including the movement-verification schema. Document rollback/backups.
- Finish and exercise real email OTP/provider delivery, atomic challenge/attempt limits, resend protections, account recovery and per-user authorization.
- Fix replay risks: session-ID-only dedupe, overlapping/duplicated geometry, rate limits shared across instances, and auth/session privacy boundaries.
- Connect the Android **production EAS environment** to the correct API base URL. The old preview backend work in PR #102 is not proof of a live server.
- Define exactly which data fields leave the device: precise route evidence, account ID, email, metadata, retained/derived route, processing logs, recipients and retention/deletion schedule. Test deletion and any privacy-preserving redaction.
- In-app status must distinguish **local session recorded**, **pending server verification**, **verified**, and **not eligible**. No token/reward claims from a pending session.
- Enable minimum viable monitoring: API health, OTP delivery failures, verification latency/errors, queue backlog, crash reports, signup funnel and deletion workflow alerts. Logs must not expose precise route paths unnecessarily.
- If no reliable multiplayer territorial backend exists, leave territory control/social competition off or strictly informational for v1. Do not make the phone the authority for shared prizes or property.
- Remove the unused text-generation SDK from backend dependencies (done in the release branch) only after proving no runtime imports/use, keeping lockfile and build green; this is hygiene, **not itself a Play review blocker**.

**B gate:** two independent test accounts can register, start and finish sessions, receive correct persisted results after reinstall, and delete their account/data on request; system is monitored and back-up/restore plan exists.

---

## 05 — Google Play compliance and user trust

**Required before production; begin now alongside engineering.**

**Location & permission disclosures**
- Use foreground location only. Keep permission requests at the point of starting gameplay, preceded by a concise accurate explanation; provide fallback when denied.
- Verify merged Android manifest: fine/coarse location and network permissions; remove unnecessary `SYSTEM_ALERT_WINDOW`, storage or other legacy permissions if not required by functionality/dependencies. Check the **AAB's** manifest, not only `app.json`.
- App, privacy policy and Data safety declaration must agree on precise location collection/transmission/retention, and use of Map SDK, analytics, crash tooling and authentication providers.

**Mandatory public website pages**
- `/privacy`: publish an accessible, specific MovenRun privacy policy: developer identity/contact, data types, purpose, data processors, precise location lifecycle, retention, deletion, user rights, security and age scope. Link both in app and Play listing.
- `/account-deletion`: publish a working external account-deletion request flow with expected handling and retention exceptions. If the app permits account creation, offer an easy in-app path too.
- Publish a support/contact URL. Test the pages in an incognito browser, mobile and without login.

**Play Console App content**
- Data safety: actual account, location, activity, diagnostics and third-party SDK behavior; *do not* copy generic answers.
- Content rating; target audience/age group; ads disclosure; app access/reviewer credentials; privacy policy URL; deletion URL.
- Financial features declaration is required for every published app, including an app with **no** financial features. If in-app tokenized assets/reward issuance are enabled later, update declaration and comply with Play's blockchain rules. Do not advertise earning tradable assets for v1.
- Google reviewers must have reusable, location-independent access to OTP-protected features: a controlled reviewer/test access route that does not weaken normal authentication. Supply clear Play Console instructions; do not ship a public auth bypass.
- Ensure Google Play feature descriptions and screenshots show **real available behavior**, not concept mockups.

**P gate:** every App content declaration reflects verified implemented behavior; both site pages resolve; reviewer login works; no sensitive or unnecessary permissions in the final AAB.

---

## 06 — Branding, graphics and store listing

Use the existing MovenRun illustrated, map-first design language (Daylight Cartography). Polish for Google Play; do not fabricate a game state.

**Native assets**
- Configure bundled app icon, Android adaptive icon foreground/background, splash/background, and notification assets if any. Ensure images exist in tracked release source and resolve in prebuild.
- Export Play listing icon PNG **512×512**, feature graphic **1024×500**, clean readable composition. Feature graphic cannot be treated as a splash substitute.
- Create **at least two phone screenshots**, preferably 5–8, from the **final Play-bound build** with actual available Home / Live Move / real route / Summary / Profile. Avoid exposing private addresses, coordinates or emails.

**Listing text**
- Name: **MovenRun** (subject to Play Console availability).
- Category recommendation: **Game / Adventure or Sports**—choose based on real implemented interactions and target audience, not just route tracking.
- Suggested short description: **Turn everyday walks and runs into missions and real-world progress.**
- Full description must stick to proven features. No token-return, yields, promised ownership, multiplayer competition or NFT marketplace claims without a live corresponding feature.
- Include a support email/website and a truthful support response plan.

**A gate:** all graphic sizes validated; package splash/adaptive icon render on Android; final captured screenshots match release build and policy.

---

## 07 — EAS, signing, store setup and rollout plumbing

**R1 — Establish Play developer ownership**
- Choose a personal or organization developer account based on actual eligibility, identity-verification readiness and business setup. Do not register a fictitious organization to avoid closed testing.
- Reserve/create app with Android package **`io.movenrun.app`**. Do not change package ID after first upload.
- Set store contact and country availability; finish account and identity requirements.

**R2 — Production build**
- Set EAS production environment separately from preview (API base URL, app Google Maps key, provider IDs; no secret printed in logs). Never embed private backend secrets in public `EXPO_PUBLIC_*` fields.
- Extend `eas.json`: `cli.appVersionSource: "remote"` and `build.production.autoIncrement: true`; keep `build.production.android.buildType: "app-bundle"`.
- Build signed **AAB** using `eas build -p android --profile production` (not a preview APK). Inspect target SDK, versionCode, package, signing chain, **16 KB page support**, native 64-bit libraries and merged permissions.
- Use Play App Signing; protect upload credentials. Store service-account credentials in managed CI/EAS secrets if automating; for the first upload, **manual Play Console upload is acceptable** and often simpler. An automated `submit` block is optional, not an inherent app upload requirement.
- Extend CI to build production AAB for a protected release branch/tag, keep human approval before Play submission.

**R3 — Google Maps signing pitfall**
- The currently working preview APK key restriction is tied to the preview signing certificate. A Play-installed AAB can use **Google Play App Signing's different SHA-1**. Add/verify that certificate fingerprint and `io.movenrun.app` to the Maps API key restrictions before closed testing. A preview map working does **not** prove a Play-installed map works.

**R4 — First upload / testing**
- Upload AAB to **Internal testing** and install using the Play delivery path. Verify map, login, location and share image on the Play-signed build.
- If the personal developer account was created after **13 November 2023**, prepare a **closed test with 12+ continuously opted-in testers for 14 days**, then apply for production access and await approval. Internal testing does not replace this requirement.
- Closed testing, account verification and Play review clocks are calendar time outside engineering control. Do not promise a guaranteed release date.

**R gate:** store-accepted signed AAB, nonduplicated versionCode, valid Play-signed Maps, testing eligibility achieved and pre-launch report issues addressed.

---

## 08 — Do we have to deploy anything? What does “tx = 3” mean?

### Deployments required for first Play release

| Component | Deploy / configure? | Why |
|---|---|---|
| Mobile Android app | **YES** — build & distribute signed production AAB through Google Play | Listing/install artifact |
| Backend API | **YES if app uses login/server verification** | Real accounts, verified results, persistence |
| PostgreSQL | **YES for hosted backend** | Durable player/session/auth state |
| Redis/queue worker | **YES if required by enabled backend flows** | OTP rate control/queues/jobs |
| Website privacy page | **YES** | Play disclosure and support |
| Website account-deletion page | **YES if in-app signup** | Mandatory deletion access |
| Google Maps Android API key | **CONFIGURE**, not a blockchain deployment | Real Play signing fingerprint/package restriction |
| MOVE token & nine V3 contracts | **NO new blockchain deployment needed for offchain Play v1** | Existing Base Sepolia contracts remain for demo/testing; not an app requirement |
| Base mainnet contracts | **NO** | Requires independent security/legal/product readiness and new chain-specific deployment |
| Dune dashboard | **NO for Play** | Optional onchain public analytics, not a store requirement |

### Onchain “tx = 3”

There is **no universal Google Play requirement for three blockchain transactions**. The Play release requires app/store review, not an onchain transaction count. If “tx = 3” means a requested Base demonstration, get the exact application rubric first; do not manufacture traffic to chase an assumed threshold.

For a meaningful **optional Base Sepolia proof** after contract security checks, a small chain of transactions could be:
1. Publish one tiny dual-authorized daily settlement commitment.
2. Claim that settlement's valid Merkle reward.
3. Execute a legitimate token burn or another valid contract interaction.

Each is a separate state-changing onchain transaction and needs prepared proofs, valid signer keys, allowances and funded sender. A `view` call, opening BaseScan, signature creation, or deploying all nine contracts is **not** the same thing as demonstrating these actual game flows. Confirm chain transaction hashes instead of quoting a bare count. Do not run these transactions on behalf of real players until accounting is proven.

### Reported Base Sepolia suite (user's deployment report)

**Chain:** 84532 (Base Sepolia). **Not independently re-queried successfully for every address here.** The user's latest deployment manifest/report is the authority until read-only onchain reconciliation confirms it.

| Contract | Address |
|---|---|
| MovenRunRegistry | `0x206118A456feDD0d94E804079a14847103045347` |
| MovenRunToken (MOVE) | `0xe0e20384AD6989f80AF10Bd25cF16E4951857263` |
| MovenRunRewards | `0xd8148a742fe90E05f2471D465c0d24a6F15c1E5A` |
| MovenRunSettlement | `0xCf6DCEEf59E854B460F2eFC55a976511a0dFA893` |
| MovenRunDeed | `0xd13b9913D0feCF1F27843696eA48BC13A3cc6fb5` |
| MovenRunDeedClaims | `0xF04A7647195A6Adc77eEA4B2754dCf3620437721` |
| MovenRunContests | `0x60d818F9263941a2F5C23B989Bd934C20Af23e63` |
| MovenRunMarketplace | `0xbd2B9a42b8856A121Cc2eB73fb5879D39D5F3D03` |
| MovenRunTimelock | `0xD73d7457F4a6262632A3129149B7EC7ef287df23` |

**Gate for anything beyond onchain demo:** independent contract code/tests, deployment-manifest comparison, role inventory, signing policy, backend scoring and reconciliation. A reported verified contract is not a working in-app reward system.

---

## 09 — Execution plan and realistic timing

Parallelize design/policy and backend while validating the mobile candidate. These are **targets**, not commitments.

| Window from 12 Oct | Deliverables | Exit gate |
|---|---|---|
| Days 1–3 | Decide v1 scope; check Play account type; reconcile PRs and release source; begin icons/privacy pages | Release content frozen, clear branch owner |
| Days 3–10 | #105 APK handset proof; combined SDK54 branch; fix real bugs; add icons/splash | M gate; exact combined green candidate |
| Days 4–14 | Deploy API/Postgres/Redis as required; OTP and session verification; account deletion & privacy URLs | B + P gates |
| Days 7–17 | Production `eas.json` and AAB pipeline; Play app setup; Play-signing Maps SHA-1; final screenshots | A + R technical gates |
| Days 12–21 | Play Internal testing; adjust crashes, reviewer sign-in and store policy declarations | Testers can install via Google Play |
| From working closed-test release | If eligible personal account: 12 testers, 14 days continuous; then request production access | Eligibility/approval, not just time elapsed |
| After acceptance | Resolve Play pre-launch warnings, submit production, staged rollout, monitor and patch | Google Play approves; install/live flow passes |

**Practical forecast:** if the API, identity provider, store assets and app account are genuinely ready, an initial internal release can happen within roughly 2–3 weeks. Public production release may be **mid-November to December 2026 or later** depending on fixes, testing and Google approval. Do not anchor the schedule on the obsolete 3–4-week SDK upgrade estimate, but don't assume it is a zero-day merge either.

### Owner decisions this week

- Who owns the Play Console account, and is it personal or organization?
- Are we shipping the recommended Movement Game v1, or requiring full authoritative multiplayer before listing?
- Which domain hosts `/privacy`, `/account-deletion` and backend?
- Who holds the EAS/Google Play signing/Maps credentials and can approve an AAB upload?
- Who provides 12+ testers if the closed-test rule applies?

These five decisions unblock the calendar without touching the token economy.

---

## 10 — Release acceptance: do not list until these are true

### Critical must-pass gates

- [ ] One clean, reviewed Android release commit combines the accepted SDK54 mobile stack.
- [ ] Real AAB is signed, targets API >=36, versionCode is unique, `io.movenrun.app` intact, and all permissions have been reviewed.
- [ ] A Play-installed Internal-test build loads Google Maps (correct Play signing certificate restriction) and its native libraries pass Play 16 KB page-size and 64-bit checks.
- [ ] Real outdoor movement end to end: stationary, walk, pause, resume, finish, share, relaunch; no fabricated route or XP.
- [ ] Valid Quest XP awarded once; early finish and five-minute standing still confer no movement progression.
- [ ] Required login/API/session persistence operates over HTTPS; if not, it is removed as a v1 claim and any dependent functionality is disabled.
- [ ] Account deletion functions both in-app and on a public webpage if accounts are offered.
- [ ] `/privacy` works publicly; Data safety matches the actual collection/deletion/SDK behavior.
- [ ] Store icon, feature graphic, current screenshots, description, support contact and content rating are complete.
- [ ] Reviewer login instructions work without requiring an inaccessible email OTP.
- [ ] Financial features declaration correctly describes **actual in-app features**, including absence of crypto if excluded.
- [ ] Internal/closed test passes on representative Android devices. Qualifying 12/14-day closed test + production access approval completed if applicable.
- [ ] Play pre-launch warnings/blockers resolved; production rollout approved with monitoring/rollback plan.

### Stop conditions

Stop release and fix first if: app crashes before Move, maps are blank on Play-signed build, real route is fabricated/misattributed, rewarded stationary abuse persists, sign-in is unusable, backend stores/deletes data contrary to disclosures, store screenshots promise unavailable mechanics, or a Play policy form cannot be answered truthfully.

### First 48 hours after publication

Monitor crash-free sessions, route-start and finish conversion, OTP latency/delivery, device permissions, API health, privacy deletion requests, session verification results and reviews. Pause rollout or hotfix severe defects; preserve exact uploaded AAB/commit/build number for reproducibility.

---

## 11 — Immediately after v1 (not prerequisites)

1. Multiplayer-authoritative Solid/Shade ownership + territory decay and contest arbitration.
2. Credits-only city pilot, retention instrumentation, anti-abuse simulation and real club membership.
3. Independent V3 contract review + actual onchain test flows.
4. Embedded wallet/passkey/sponsored gas; only then gated MOVE settlement and claims.
5. Earned Deeds, traffic eligibility and contests; much later, mult-city sponsor economy.

This order reconciles the older V3 roadmap's **credits-first** strategy with the newer Base Sepolia deployment: contracts may exist on testnet while the app launches without tokens. That is an intentional separation, not a contradiction.

---

## 12 — Evidence, sources and freshness notes

**Source A — user-supplied launch assessment**  
*MovenRun Play Store Launch.html*, dated 11 October 2026. Treat its timing and SDK assessment as applying to its checked branch unless independently verified.

**Source B — primary MovenRun design**  
*MovenRun-Game-Economy-V3.pdf*; *MovenRun-Internal-Guide.pdf*; *MovenRun-Gamified-Screen-Guide.md*; *MovenRun-Review-and-Frontend-Blueprint.md*; prior project reports and user-supplied Base Sepolia manifest.

**Source C — live repository inspection, 12 October 2026**
- `main` Expo 51: https://github.com/suhaib155/arena/blob/main/movenrun/mobile/package.json
- PR #105 Expo 54: https://github.com/suhaib155/arena/blob/fix/demo-preflight-correctness/movenrun/mobile/package.json
- PR #105 app config: https://github.com/suhaib155/arena/blob/fix/demo-preflight-correctness/movenrun/mobile/app.json
- PR #105 EAS config: https://github.com/suhaib155/arena/blob/fix/demo-preflight-correctness/movenrun/mobile/eas.json
- PR #105 preview workflow: https://github.com/suhaib155/arena/blob/fix/demo-preflight-correctness/.github/workflows/eas-apk-build.yml
- PR #102: https://github.com/suhaib155/arena/pull/102
- PR #105: https://github.com/suhaib155/arena/pull/105

**Source D — current official Google / Expo documents**
- Play target SDK 2026: https://support.google.com/googleplay/android-developer/answer/11926878
- Play technical quality/16 KB support: https://support.google.com/googleplay/android-developer/answer/17492799
- Expo SDK 54 native versions: https://docs.expo.dev/versions/v54.0.0/
- New personal account closed testing: https://support.google.com/googleplay/android-developer/answer/14151465
- Play Store graphic requirements: https://support.google.com/googleplay/android-developer/answer/9866151
- Data safety: https://support.google.com/googleplay/android-developer/answer/10787469
- Account deletion: https://support.google.com/googleplay/android-developer/answer/10144311
- App review sign-in: https://support.google.com/googleplay/android-developer/answer/15748846
- Play financial features: https://support.google.com/googleplay/android-developer/answer/13849271
- Blockchain content: https://support.google.com/googleplay/android-developer/answer/13607354
- Expo versionCode: https://docs.expo.dev/build-reference/app-versions/

**Verification limits:** This review did not build or examine a signed AAB, access the user's Play Console, re-query all nine contracts directly from chain, or verify backend/website deployment. Do not upgrade those to pass without receipts/evidence.

**Durable record:** this file is the reviewed in-repository copy of the roadmap. Execution state, evidence and owner actions are maintained in `docs/play-launch/`.