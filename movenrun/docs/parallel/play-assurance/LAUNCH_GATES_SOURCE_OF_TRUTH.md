# Launch gates: source of truth

Checkpoint: 22 October 2026, 09:30Z
Source heads: board `security/a10-single-use-google-exchange` 2326aa6 (#112); live API `deploy/render-free-staging` 2192de6; Android candidate #125 `preview/android-qa0-candidate` 15f7f87 (base `release/android-v1-cxfdbd` 991ac6a); live website 61d30bb (#116); #128 49c9fe9; #129 d440f3a; `main` d344c3b.

Claim classes: **SV** source verified (read at the SHA) · **LT** local test confirmed (this track ran it) · **LO** live observed by this track (passive read, timestamped) · **RR** reviewer or earlier report, not re-run here · **OG** owner or provider gated · **NR** not run.

A green pull request is not a working phone, a signed-in person or a Play listing. Each gate below names the state it has actually reached and the evidence that would move it.

## 1. State ladder

| State | Meaning | Who can produce the evidence |
|---|---|---|
| CODE TESTED LOCALLY | Unit/HTTP tests pass at an exact SHA | Engineering |
| LIVE SERVICE VERIFIED | The deployed service at a known SHA answers as expected | Engineering, read only |
| REAL PROVIDER TESTED | A genuine Google (then wallet) sign-in, hook call and deletion on the live project | Owner enables, then engineering checks aggregates |
| APK INSPECTED | An owner-authorised APK passes `android-artifact-acceptance.sh` | Owner builds, anyone inspects |
| PHYSICAL PHONE TESTED | H-1 to H-12 (section 2a) pass on that exact APK | Owner or tester with a phone |
| PLAY-SIGNED AAB TESTED | The Play-installed build works, maps included (Play App Signing SHA-1) | Owner |
| PLAY CONSOLE DECLARED | Data safety, Health, Financial, account deletion, app access, content rating filled | Owner |
| CLOSED TEST QUALIFIED | Personal account: 12 testers opted in for 14 consecutive days, then production access granted | Owner, testers, Google |
| RELEASE AUTHORIZED | Owner presses Publish on a staged rollout | Owner |

## 2. Gates today

| Gate | Reached state | Evidence and freshness | Next evidence needed | Blocked by |
|---|---|---|---|---|
| API code (sign-in, exchange, deletion, movement) | CODE TESTED LOCALLY | Track C 10/10 local auth tests at 2326aa6 (LT, 22 Oct); backend code identical at 2192de6, 2326aa6 and #125 (SV, `git diff --stat` empty for backend/mobile/shared) | Fixes for the four Track C findings (AUTH_SECURITY_GAP_ASSESSMENT.md) | Engineering only |
| Live API | LIVE SERVICE VERIFIED (health only) | 22 Oct 09:24Z (LO): `/health` 200 after a 42.4 s cold start, `/ready` 200 `signIn: supabase`; CORS preflight from `https://movenrun.xyz` gets `access-control-allow-origin: https://movenrun.xyz`, `www` and an unrelated origin get no allow header | — | — |
| Live website | LIVE SERVICE VERIFIED | 22 Oct 09:24Z (LO): apex 200, `www` 308 to apex, `/privacy/`, `/account-deletion/`, `/sign-in/` 200, CSP + HSTS + `X-Frame-Options: DENY` + `Referrer-Policy: no-referrer` served; `/scripts/ignored-build.sh` 404 | Privacy wording fixes (PRIVACY_CLAIM_CONSISTENCY_AUDIT.md) need an owner-approved website release | Owner (publishing) |
| X-05 Google provider | NOT ENABLED | RR: 18 Oct 19:35Z OFF, 0 users (E-86). Not re-read here: the auth-config read tools can return secrets and are off limits | Owner enables Google in Supabase with the client secret typed only in the dashboard; then one genuine sign-in, hook row (X-07b), replay refused, deletion | **OG** owner |
| X-05 wallet provider | NOT ENABLED | RR as above | Only after Google proof; unfunded wallet, message signing only | **OG** owner, after Google |
| X-07 signup hook (1,000 / 50 per hour) | Attached, invocation unproven | RR: E-45 (16 Oct) | X-07b: a genuine signup shows the hook ran | X-05 |
| X-08 Android public config + restricted Maps key | NOT DONE | RR (EXTERNAL_ACTIONS X-08) | Expo env set; Maps key restricted to `io.movenrun.app` + preview SHA-1 now, Play App Signing SHA-1 later | **OG** owner |
| X-04 signed preview APK of #125 15f7f87 | NOT BUILT | SV: no artifact exists; `appVersionSource: remote` | Owner approves exactly one EAS preview build after X-05 and X-08 | **OG** owner |
| APK acceptance | NOT RUN / ARTIFACT MISSING | Script ready (LT self-test) | Run `research/play-assurance/tools/android-artifact-acceptance.sh <apk>` | X-04 |
| X-10 phone H-1 to H-12 (section 2a) | NOT RUN | — | HANDSET_TEST_SCRIPT on the exact APK, outdoors | X-04 |
| X-01 Play developer account | NOT CREATED | Owner statement 13 Oct (RR) | Truthful account type (Personal unless a real D-U-N-S entity), fee, identity verification | **OG** owner, spending US$25 |
| Signed AAB + Play App Signing SHA-1 on Maps key | NOT STARTED | — | Production AAB, internal track install, map renders | X-01, X-09 |
| Listing assets and screenshots | NOT STARTED | — | Screenshots from the Play-installed build only | AAB |
| App content declarations | DRAFTS ONLY | PLAY_DECLARATION_DRAFTS.md (this track) | Owner reviews and submits | X-01 |
| Closed test (Personal) | NOT STARTED | Policy: 12 testers, 14 consecutive days, then apply (OFFICIAL_SOURCES, retrieved 22 Oct) | PLAY_CLOSED_TEST_PROGRAM.md | AAB + X-01 |
| Production access and rollout | NOT STARTED | — | Google grants access; owner publishes | All above |

Two external dates matter: Play requires new apps to target **API 36** (from 31 Aug 2026, extension to 1 Nov 2026), and updates without **16 KB page-size** support for apps with native code targeting API 35+ cannot be released from **1 Feb 2027** (both from OFFICIAL_SOURCES, retrieved 22 Oct 2026; dates have moved before). #125 carries an API 36 assertion test (SV, not run here); the 16 KB check needs the binary.

## 2a. Handset gates H-1 to H-12 (single mapping for all Track C docs)

The owner's 22 October continuation directive (§6) lists the physical-handset checks; `docs/play-launch/HANDSET_TEST_SCRIPT.md` numbers its steps 1–20 and 15a–15h. This table is the one mapping every Track C document uses. The directive's list has twelve items; items 11 and 12 are kept as H-11 and H-12 rather than dropped.

| Gate | Check | HANDSET_TEST_SCRIPT steps | Also needs |
|---|---|---|---|
| H-1 | Cold boot under Hermes, no crash | 1, 13 | — |
| H-2 | Maps signing: real tiles on preview and Play builds | 7, 17 | Acceptance script SHA-1 output |
| H-3 | Standing still earns nothing | 5, 6 | — |
| H-4 | Real 100–300 m walk | 7 | — |
| H-5 | Pause and resume, no bridged gap | 8 | — |
| H-6 | Quest awarded exactly once | 9, 10 | — |
| H-7 | Offline save then retry, verified once | 14, 15g | — |
| H-8 | Account creation and deletion | 15a–15f, 16 | Live X-05 window |
| H-9 | Backup and device transfer excluded | none in the script today | Acceptance script (`allowBackup`, `dataExtractionRules`); a manual `adb backup`/device-transfer attempt to add as a step |
| H-10 | Accessibility | 18, 19, 20 | — |
| H-11 | 16 KiB page size and native libraries | none in the script today | Acceptance script ELF alignment; run once on a 16 KB device or emulator image |
| H-12 | Deep-link interception (F-06) | 15h | AUTH_SECURITY_GAP_ASSESSMENT A-7 |

## 3. Dependency graph

```
X-05 Google ON ──► genuine sign-in + X-07b + replay + deletion ──► wallet ON ──► wallet checks
      │
X-08 Expo env + restricted Maps key (preview SHA-1)
      │
      ▼
X-04 one EAS preview APK (#125 15f7f87) ──► APK acceptance script ──► X-10 phone H-1..H-12
                                                                          │
X-01 Play account (truthful type, fee, ID verification) ─────────────────┤
                                                                          ▼
                     X-09 production AAB ──► internal track install ──► Play App Signing SHA-1 added to Maps key
                                                                          │
                     App content declarations + listing + screenshots ◄──┘
                                                                          │
                     Personal account: closed test 12 testers × 14 days ──► apply for production ──► review
                                                                          │
                                                                          ▼
                                                        X-16 owner publishes staged rollout ──► 48-hour protocol
```

Owner tasks that can start **today with no code change**: X-01 (account registration and identity verification, the longest external lead time), X-05 Google enablement, X-08 Expo environment and Maps key, X-22 mailbox check, and recruiting genuine closed-test testers (no installs until an AAB exists).

## 4. Realistic earliest timeline

Durations, not promises. Day 0 is the day the owner starts X-01.

| Step | Earliest | Depends on |
|---|---|---|
| X-01 account verified | day 2–7 (Google verification time varies) | Owner documents |
| X-05 Google proof, then wallet | same day as enablement | Owner dashboard step |
| X-04 APK + acceptance + X-10 phone | 1–3 days after X-05/X-08 | Owner build approval, a phone, outdoors |
| Production AAB on internal track | 1 day after X-01 and X-10 | X-09 |
| Closed test qualification | +14 consecutive days | 12 genuine opted-in testers |
| Production access review | up to ~7 days (policy page: "usually seven days or less") | Google |
| First public availability | roughly 4–5 weeks after day 0 at the earliest | All of the above |

The **2 November 2026** date remains the engineering and pre-listing target. With a Personal account, public availability on 2 November is not achievable; the closed-test clock alone is 14 days after an installable Play build exists.

## 5. Release NO-GO checklist

Every line needs the evidence named; "should work" is a NO-GO.

| # | Check | Pass evidence |
|---|---|---|
| 1 | Google sign-in on the live project, new account created once, replayed token refused | Aggregate counts: users +1, hook rows +1, replay 401 (no IDs) |
| 2 | Account deletion end to end, provider user gone | `signInRecord: "removed"`; pending deletions count 0; sign-in again creates a fresh account only by a new Google consent |
| 3 | API refuses a legacy HS256 token at startup config | Finding A-1 fixed, or Render env shows no `SUPABASE_LEGACY_JWT_SECRET` (owner check) |
| 4 | APK acceptance script exits 0 on the exact APK | Script output saved with APK SHA-256 |
| 5 | H-1 to H-12 (section 2a) pass on that APK | Filled HANDSET_TEST_SCRIPT plus the H-9 and H-11 extra checks, with device and OS |
| 6 | Map renders on the Play-installed build | Screenshot from internal track install |
| 7 | Data safety, Health, Financial, deletion and app access answers match DATA_FLOW_AND_RETENTION_MATRIX | Owner sign-off on PLAY_DECLARATION_DRAFTS |
| 8 | Public privacy page matches code | PRIVACY_CLAIM_CONSISTENCY_AUDIT mismatches closed |
| 9 | Storage below 60 % of the verified project limit | Supabase dashboard reading, dated |
| 10 | No promise of earnings, tokens, NFTs, property or live city competition in listing or app | Listing text review |
| 11 | Rollback references recorded for API and website | IDs in FREE_TIER_OPERATIONS_RUNBOOK |
| 12 | 48-hour protocol owner and contacts set | INCIDENT_48H_PROTOCOL filled |

Live observations are recorded verbatim in `research/play-assurance/evidence/LIVE_PASSIVE_CHECK_2026-10-22T0924Z.md`.

## Integration digest

- Affected paths: this file only (new, `docs/parallel/play-assurance/`).
- Evidence: Track C local tests at 2326aa6; passive live checks 22 Oct 09:24Z; fact sheets on #125 15f7f87 and 61d30bb.
- Conflicts: none with #127/#128/#129. `docs/play-launch/EXTERNAL_ACTIONS.md` X-29 still shows the revoked `git diff --quiet HEAD^ HEAD -- .` one-liner; the integration owner should replace it (not edited here, shared register).
- Next decisions: (1) owner starts X-01 now; (2) owner enables Google (X-05); (3) owner approves the one preview build after X-08.
