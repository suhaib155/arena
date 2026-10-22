# Release red team (C9)

Checkpoint: 22 October 2026
Source heads: 2326aa6 (board, #112), 2192de6 (live API, code identical), #125 15f7f87 (Android), 61d30bb (live website), render.yaml at 2192de6.

Claim classes: **SV** source verified · **LT** local test confirmed · **LO** live observed (passive, 22 Oct 09:24Z) · **RR** earlier report · **OG** needs owner, provider or device · **NR** not run.

No scanning, load tests, credential attacks or enrolment were run. Live checks were one `/health`, one `/ready`, three CORS preflights and five website GETs. No stop-ship issue (critical leak or auth bypass) was found.

| # | Failure path | Verdict | Evidence | Regression guard |
|---|---|---|---|---|
| 1 | Missing or wrong Android signing SHA-1 on the Maps key gives a blank map on the Play build although the preview worked | **Open risk, OG** | Maps key comes only from `GOOGLE_MAPS_ANDROID_API_KEY` at build time; the app shows a missing-key state when unset (ANDROID_FACTS, `app.config.js` @15f7f87). Play re-signs with the App Signing key, a different SHA-1 | NO-GO 6 (map renders on the Play-installed build); ANDROID_BINARY_ACCEPTANCE prints both SHA-1s |
| 2 | OAuth client misconfiguration, wrong redirect or host | **Guarded in code, OG for config** | App accepts only exact `movenrun://auth/callback` (LT control); API CORS apex-only (LO); `www` 308 to apex (LO). The Google client's authorised redirect must be the Supabase callback for `tavxmwuwkeynbnzfwove` | X-05 live check; AUTH §3 |
| 3 | Callback interception, token in logs | **Low** | PKCE protects both codes (AUTH A-7); website strips `?code=` before exchange; no `console.*` in mobile app code; API never logs bodies (`api/app.ts:99`) (SV) | AUTH A-4 test for the parser |
| 4 | Backend offline makes a pending walk look verified, or loses it | **Guarded (SV), device NR** | Unsent sessions queue on the phone (3 items, 7 days); server status is shown separately and "local progression remains explicitly local" (`docs/MOVEMENT_RESULT_STATES.md` @15f7f87). Server idempotency is a database unique key on (user, client session id) (`db/movement.schema.ts:71-78`) | H-tests offline retry step |
| 5 | Shared Cloudflare/Render proxy header trust creates fake IP buckets | **Guarded, RR** | Live blueprint sets `TRUST_PROXY` (render.yaml:54 @2192de6), trusting published Cloudflare ranges (`api/trustedProxies.ts`); X-24 live check passed 17 Oct (E-55) | `trustedProxies.test.ts` in the backend suite |
| 6 | Migration runs on startup; flag-on path touches absent tables | **Real behaviour, bounded** | `startCommand` runs `db:migrate` before `start` on every boot and wake (render.yaml:25). Only 0000–0010 exist on this line; 0011 is not in `backend/drizzle` at 2326aa6. The gameplay flag and its tables live on #129 only. A failed migration stops the start (fail closed) | Do not promote a branch containing 0011 to the deploy branch without the 0011 gate; #129's flag-off test (reviewer reported) |
| 7 | Late-night timezone or rapid retries duplicate progress | **Server guarded (SV); app XP NR** | Same unique key as row 4; a retried submission returns the stored record. XP and missions are computed on the phone (DATA_FLOW matrix), so day-boundary duplication is an app question for the H-tests | H-test "quest award once" |
| 8 | Account deletion leaves resurrectable sessions | **Guarded for MovenRun sessions (SV); provider gap A-2/A-6** | Erase deletes every `auth_sessions` row in one transaction under a row lock (`accountDeletion.ts:84,104`); `verifyAccess` needs a live session row, so issued access tokens die with it. A Supabase user still pending removal can be signed into again only by a fresh Google consent or wallet signature, which creates a new account and leaves the queue row stuck (AUTH A-2, LT) | AUTH A-2 test; metric "pending provider deletions older than 1 day" |
| 9 | Inaccurate retention text, privacy 404, conflicting Play fields | **Mismatches found** | Live pages 200 (LO). Wording mismatches listed in PRIVACY_CLAIM_CONSISTENCY_AUDIT (user-agent hash, wallet challenge retention, "30 days" purge timing, backups, deletion "pending"). The existing worksheet and the new drafts disagree on Health and on precise vs approximate location (PLAY_DECLARATION_DRAFTS) | Owner decision before X-11 |
| 10 | Monorepo preview builds exhaust Vercel Hobby | **Open, OG** | Each push builds several projects (X-29); canceled builds still count; native skipping needs a recognised workspace graph and the website is not a workspace (VERCEL_DEPLOYMENT_BUDGET_PLAN). This track pushes once | Owner dashboard test in the budget plan |
| 11 | Compromised legacy JWT secret reintroduced by a merge | **Proven latent gap** | One environment variable re-enables HS256 trust (AUTH A-1, LT) | Fix: refuse the variable at startup; blueprint test |
| 12 | Unsupported promise of cash, NFTs, property or live city competition | **Clean in v1 sources** | Store listing describes XP and badges only (`docs/play-launch/STORE_LISTING.md:3,18-20,39`); clubs, competition, deeds and wallets are unreachable in release builds (`mobile/src/lib/releaseScope.ts` @15f7f87); website docs say deeds are planned with no monetary value (WEBSITE_FACTS) | Keep `releaseScope.ts` flags false; listing review at NO-GO 10 |

## Integration digest

- Affected paths: this file only.
- Evidence: as cited; tests in `research/play-assurance/tests/`.
- Conflicts: none. Row 6 depends on #129 staying off the deploy branch.
- Next decisions: (1) take AUTH A-1 and A-2 fixes onto the security board; (2) owner settles Health and location precision answers.
