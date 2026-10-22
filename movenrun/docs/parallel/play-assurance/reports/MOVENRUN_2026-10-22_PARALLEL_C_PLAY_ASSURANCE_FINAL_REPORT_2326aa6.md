# MovenRun Track C final report: Play readiness, auth and privacy assurance, free-tier operations

Date: 22 October 2026
Branch: `research/parallel-c-play-assurance`, draft PR #136, base `security/a10-single-use-google-exchange` at 2326aa6. Heads recorded before writing (04:55Z): #112 2326aa6, #125 15f7f87, #127 384150e, #128 49c9fe9, #129 d440f3a, live API branch 2192de6, release 991ac6a, `main` d344c3b, live website 61d30bb.
Scope: new files under `movenrun/docs/parallel/play-assurance/` and `movenrun/research/play-assurance/` only. No backend, mobile, website, workflow, lockfile or deployment change. No EAS build, Play Console action, provider toggle, deploy, signup or deletion.

## 1. Executive checkpoint

The code that is live (2192de6) and the Android candidate (#125) share the same backend and sign-in library code as the board head, so the findings below apply to what is deployed. No stop-ship leak or bypass was found. Four real but bounded defects are proven by local tests; the biggest launch blockers remain owner gates: Google provider enablement, the Maps key and one preview build, a phone run, and the Play developer account. With a Personal account, public availability is at least about four to five weeks after the account is started; 2 November stays the engineering and pre-listing target.

## 2. Evidence by class

| Class | What |
|---|---|
| Source verified | Every cited `path:line` at the stated SHA (independent reviewer spot-checked about 48 citations, 45 correct before fixes; the three wrong ones are corrected) |
| Local test confirmed | 21 of 21 tests pass from `movenrun/` (`node --import tsx --test 'research/play-assurance/tests/*.test.ts'`, Node 22.22.0, immutable install of the 2326aa6 lockfile): auth assurance 10, query-string exposure 8, artifact-script discipline 3 |
| Live observed | One passive check at 22 Oct 09:24Z (`research/play-assurance/evidence/LIVE_PASSIVE_CHECK_2026-10-22T0924Z.md`): API `/health` 200 after a 42.4 s wake, `/ready` 200; CORS allows only the apex; `www` 308 to apex; privacy, deletion and sign-in pages 200 with CSP, HSTS, frame and referrer headers |
| Reviewer reported | Live SHAs 2192de6 and 61d30bb, provider state OFF with 0 users (18 Oct), migrations 0000–0010 applied, #129 test counts |
| Simulation only | None in this track |
| Owner or provider gated | Genuine Google and wallet sign-in, hook invocation, provider deletion, any APK/AAB, any phone, every Play Console state |
| Not run | Real APK/AAB inspection (no artifact; build tools absent here), merged-manifest check, 16 KB alignment on a real binary, mobile and backend full suites |

## 3. Findings

| ID | Finding | Class | Where to fix |
|---|---|---|---|
| A-1 | Setting `SUPABASE_LEGACY_JWT_SECRET` makes the production API trust HS256 tokens again; anyone with the revoked secret could mint any user | SV + LT | Security board (refuse at startup, blueprint test) |
| A-2 | If an erased person signs in again while their provider deletion is pending, the queue row stays due forever and can starve the 50-row retry batch | SV + LT | Security board |
| A-3 | JWKS outage and a forged token both return 401 `verification_failed`; the app cannot say "try again" | SV + LT | Security board |
| A-4 | Malformed `%` escape in the Google callback URL throws `URIError` in the app's parser | SV + LT | #125 owner (library, not UI) |
| A-5 | A refresh retried after a lost response signs the player out everywhere (by design) | SV + LT | Document in tester script |
| A-6 | API reports `signInRecord: "pending"`; the website and the app's deletion call ignore it and show "deleted" | SV | Website release; #125 owner |
| P-1 | Public privacy text: claims a stored user-agent hash that is never stored; wallet sign-in challenge (address) retention depends on the next sign-in; "30 days" for Google exchange records is a minimum; backups wording conflicts with a code comment | SV | Website wording release |
| P-2 | Existing Play worksheet says Health "No" and cells are approximate location; the new drafts recommend Activity and Fitness, a Fitness info row, and H3 res-8 cells as precise location | SV | Owner decision |
| O-1 | `db:migrate` runs on every Render start and wake; a failed migration keeps the API down (fail closed) | SV | Keep 0011 off the deploy branch |
| O-2 | Native Vercel skipping likely cannot scope the website (not a workspace); canceled builds still count toward limits | SV + official docs | Owner dashboard test |
| D-1 | 143 advisory rows (3 critical, 77 high); by lockfile path none of the critical/high reach the Android runtime; one high is in the backend runtime (drizzle-orm 0.31.4, no raw identifiers found in source) | SV + audit | Dependency owner, P2 |
| D-2 | GHSA-vcc3-ghjq-m6fr: package ships in the app, but expo-router's inbound parser uses `URL.searchParams`; exception expires 21 Nov 2026 with source-pin tests | SV + LT | Reassess by 21 Nov |

## 4. Top 10 release fixes, ranked by impact and effort

| Rank | Fix | Impact | Effort |
|---|---|---|---|
| 1 | Owner: start the Play developer account (X-01) | Longest external lead time | Owner, hours plus Google's verification |
| 2 | Owner: enable Google (X-05), then run the genuine sign-in, replay and deletion checks | Unblocks every account flow | Owner, minutes |
| 3 | Refuse `SUPABASE_LEGACY_JWT_SECRET` at API startup (A-1) | Removes a whole-account forgery path | Small code change plus one test |
| 4 | Expo env and restricted Maps key with both SHA-1s, then one preview build (X-08, X-04) | No map, no launch | Owner, an hour |
| 5 | Show deletion "pending" honestly on web and app (A-6) | Play account-deletion accuracy | Small, website release + #125 |
| 6 | Correct the privacy wording mismatches (P-1) | Play privacy policy consistency | Small, website release |
| 7 | Clear the pending row when the subject is mapped, and add the "pending older than one day" count (A-2) | Deletion reliability | Small |
| 8 | Owner decides Health, Fitness info and location-precision answers (P-2) | Avoids a Data safety rejection | Owner, an hour |
| 9 | Map JWKS outage to 503 `provider_unavailable` (A-3) | Fewer false "sign-in failed" on cold starts | Small |
| 10 | Guard the callback decoder (A-4) and add debuggable and network-security-config checks to the artifact script | Robustness | Small |

## 5. Owner-only actions

See `OWNER_ACTIONS_ONE_PAGE.md`. In order: X-01 account; X-05 Google, then wallet; confirm by name that Render has no legacy-secret variable; X-08 Expo env and Maps key; approve one preview build of #125 at 15f7f87; phone run H-1 to H-12 (LAUNCH_GATES section 2a); declaration decisions; recruit 12 genuine testers; Vercel one-push test; approve a website wording release; later, storage and retention policy before any 0011 promotion.

## 6. Actions not taken or blocked

- Not done by design: EAS build, Play Console, provider toggles, deploys, website edits, edits to #125/#127/#128/#129, shared evidence registers, lockfile.
- Auth-config and PostgREST-config read tools were not used (they can return secrets), so provider state is the 18 Oct report.
- `EXTERNAL_ACTIONS.md` X-29 still shows the revoked `git diff --quiet HEAD^ HEAD -- .` line; left for the integration owner.
- The new tests must be run from `movenrun/`; from the repository root `tsx` cannot resolve the backend's dependencies (3 failures there, 21 passes from `movenrun/`).

## 7. Integration digest

- Affected paths: `movenrun/docs/parallel/play-assurance/*` (14 documents and this report), `movenrun/research/play-assurance/{README.md,tests/*,tools/android-artifact-acceptance.sh,evidence/*}`. Nothing outside them.
- Tests: 21/21 local at commit 61334d3 (content) on base 2326aa6.
- Conflicts with the ongoing integration: none by path. Fixes A-1/A-2/A-3 touch `backend/src/api/config.ts` and `identity/services/supabaseSignIn.service.ts`, which #129 does not change; land them on the security board, not on #111 (held).
- Next decisions (owner): start X-01; enable Google; choose the Health and location-precision answers.

## 8. Note for the coordinator

Do not merge this PR into launch source. Take from it: the four findings as small patches on the owning branches (A-1 to A-3 security board, A-4 and the A-6 app half to #125's owner, A-6 web half and P-1 to the next website release), the H-gate mapping (LAUNCH_GATES section 2a) for the phone run, and the artifact script for the first APK. Acceptance for each patch: the matching `finding:` test in `authAssurance.test.ts` fails, is inverted, and passes.
