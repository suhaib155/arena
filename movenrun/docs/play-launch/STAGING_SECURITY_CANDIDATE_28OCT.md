# Staging security candidate, 28 Oct 2026 (prepared, NOT deployed)

**Nothing is deployed.** This page prepares one staging deployment. It runs
only after X-30 passes and the owner approves this exact SHA in writing. The
security code being good is not an approval to deploy.

## The candidate

| | |
|---|---|
| Service | `movenrun-staging-api`, `srv-db7a49dg1s2s739nleog` (Render Free, Virginia, auto-deploy off) |
| Source branch | `integration/security-staging-preflight-28oct` (not a deploy branch, no PR yet) |
| Candidate SHA (code) | `efd381bb6fc9e3be0229859d26ddee59cdbd410d` |
| Branch head | adds only this document on top of the candidate. `git diff efd381b <head> --stat` lists this file alone, so both deploy the same code |
| Base | `2192de6930be18d7e4bc07a94b93828d46b0a7d5`, the last recorded live code on `deploy/render-free-staging` (X-27). It is an ancestor of the candidate, so the deploy branch could move forward with no merge |
| Current deploy ID | **UNKNOWN**: not checked today (no Render access from here). Last recorded live deploy: `dep-db9m51qjnfac73cqh6eg` at `2192de6` (X-27). That deploy is the rollback target |
| CI | CI: pending PR |

## Integrated PRs

Cherry-picked in dependency order onto `2192de6`, with no conflicts. Cherry-pick
was used instead of a merge because the three branches also carry 17 board and
report commits (from `security/a10-single-use-google-exchange`). Those commits
touch only `movenrun/docs` and are left out.

| PR | Source commit | On this branch |
|---|---|---|
| #143 legacy-secret fail-closed | `5a06c69` | `09642b2` |
| #144 key outage is 503 (stacked on #143) | `88a5bc3`, `db929f9` | `c12ae04`, `9f63831` |
| #148 deletion queue compare-and-set, wallet handoff expiry | `0b74c89`, `b52ae9b` | `c6591cd`, `4051f48` |
| this branch | | `647e9a9` Retry-After on the deletion-in-flight 503, `no-store` on every identity response; `18983bb` acceptance tests; `e70953f` merge of `ci/test-discovery` (complete test runner, CI uses it); `efd381b` `no-store` set before the global rate limiter, so its 429 is not cached either (review finding) |

Checks after the cherry-picks: `supabaseAuth.ts`, its tests and `jwksOutage.test.ts`
match #144 byte for byte. `signInStores.ts`, `providerDeletionQueue.test.ts`,
`runtime.test.ts` and `A2_DELETION_QUEUE.md` match #148. Every other difference
from #148 is #143/#144 content.

## Tree comparison against 2192de6

`git diff --stat 2192de6..efd381b`: 22 files, +2092 / −123. Backend identity
and API code, their tests, two runbooks, and the test runner from `ci/test-discovery`:

```
backend/src/api/app.ts                                  (no-store on /identity; deletion-age report)
backend/src/api/server.ts                               (startup log: signing keys only)
backend/src/identity/domain/errors.ts                   (provider_unavailable, Retry-After seconds)
backend/src/identity/http/router.ts                     (Retry-After on retryable 503s)
backend/src/identity/providers/supabaseAuth.ts          (no HS256, legacy-name startup refusal, outage = 503)
backend/src/identity/repositories/signInStores.ts       (deletion queue CAS)
backend/src/identity/services/supabaseSignIn.service.ts (CAS ownership, adoption, handoff expiry)
backend/src/api/{config,renderBlueprint,runtime}.test.ts
backend/src/identity/http/{authThreats,jwksOutage}.test.ts
backend/src/identity/providers/supabaseAuth.test.ts
backend/src/identity/services/{providerDeletionQueue,supabaseSignIn.service}.test.ts
docs/play-launch/X26_SIGNING_KEY_RUNBOOK.md
docs/security/A2_DELETION_QUEUE.md
scripts/run-tests.mjs                                   (complete test discovery, from ci/test-discovery)
backend/package.json, shared/package.json               (test scripts call the runner; no dependency change)
.github/workflows/backend-checks.yml                    (CI runs the runner with --strict)
```

Unchanged: `render.yaml`, `backend/src/middleware/` (CORS, helmet, rate limits),
`backend/src/api/config.ts`, `trustedProxies.ts`, all gameplay, mobile, website,
contracts and shared source code. No new dependency and no lockfile change; the
two package.json edits change test scripts only.

## Migrations: unchanged

No new migration. `backend/drizzle/` (0000–0010, `meta/_journal.json`,
`CHECKSUMS.sha256`) is byte-identical to `2192de6`:

- `git diff --quiet 2192de6 efd381b -- movenrun/backend/drizzle` exits 0
- tree object `461b9314a086524240025a39538618de8ea7892d` at both commits
- `sha256sum -c CHECKSUMS.sha256`: 0000–0010 all OK
- `meta/_journal.json` sha256 `ba6655ac100565bfec878ed0fbe6f87d75c5d87284ca3de81cfa5f80fc3595a5`
- the runtime test runs the deploy command (`drizzle-kit migrate`) twice on a fresh database. It records 11 rows, and the second run is a no-op

So migration `0010` (X-27, single-use Google exchange) stays as it is. A
rollback needs no database step.

## X-30: environment-name gate (names only)

The candidate refuses to start if either name below is **present** in its
environment, **even with an empty value**. The process exits 1 before it
listens, and the log says only `V3 API startup failed; check required
environment configuration`. No value is printed. Deploying first and checking
afterwards could take staging offline.

| Name | Required state |
|---|---|
| `SUPABASE_LEGACY_JWT_SECRET` | **ABSENT** |
| `SUPABASE_JWT_SECRET` | **ABSENT** |

- Check service-local variables, any linked environment group and any
  Blueprint-sourced variable. Look at **names only**. Never open, copy, print
  or redact a value.
- If either name is present, X-30 = BLOCKED. The owner removes it through the
  Render dashboard's normal change procedure. Nobody deletes or rotates it
  silently.
- Check again **immediately before** an approved deploy, even if X-30 passed
  earlier.
- `render.yaml` names neither variable. `renderBlueprint.test.ts` keeps it that way.

X-30 status today: **UNKNOWN** (not checked from here).

## Approved deploy, if and only if

1. X-30 shows both names ABSENT, re-checked just now.
2. The owner has approved `efd381bb6fc9e3be0229859d26ddee59cdbd410d` (or the
   docs-only branch head above) by exact SHA.
3. CI is green at that SHA (fill the CI line above).

Then do one manual deploy of that SHA to `movenrun-staging-api` and nothing else.

## Smoke tests after the deploy

Base URL `https://movenrun-staging-api.onrender.com`. The first request may take
about a minute (cold start). Use only synthetic input. Never paste a real token.

| Check | Expected |
|---|---|
| Deploy log | migrations report nothing new, then `V3 API listening; Supabase tokens: signing keys only; proxies: trusted by network (Cloudflare, private)` |
| `GET /health` | 200 `{"status":"ok"}` |
| `GET /ready` | 200 `{"status":"ready","database":"ready","signIn":"supabase"}` |
| CORS preflight, `Origin: https://movenrun.xyz`, `OPTIONS /identity/auth/google/complete` with `Access-Control-Request-Method: POST` | `Access-Control-Allow-Origin: https://movenrun.xyz`, no `Allow-Credentials` |
| The same preflight from `Origin: https://www.movenrun.xyz` | **no** `Access-Control-Allow-Origin` header (www is not a trusted API origin) |
| `POST /identity/auth/google/complete` with body `{"accessToken":"malformed.token-with-two-parts-only-but-long-enough"}` | 401 `{"error":{"code":"verification_failed"}}`, `Cache-Control: no-store`, no `Retry-After` |
| `POST /identity/auth/google/complete` with a syntactically valid but unsigned JWT (`alg: HS256` or `alg: none`, synthetic claims) | 401 `verification_failed` |
| `GET /identity/me` with no token | 401 `unauthenticated`, `Cache-Control: no-store` |

**Key-set outage.** This is not tested live, because it would need the provider
to fail. Locally, `authThreats.test.ts` and `jwksOutage.test.ts` show what
happens. Once the cached keys are over an hour old and the key set cannot be
fetched, a well-formed token that needs a key gets 503
`{"error":{"code":"provider_unavailable"}}` with `Retry-After: 10` and
`Cache-Control: no-store`. A malformed, HS256, `none`, `crit` or kid-less token
is still 401 and causes no key fetch. MovenRun sessions already issued keep
refreshing. In the logs, a run of `provider_unavailable` 503s means a provider
outage, not an attack. 401s stay 401s.

## Stop criteria (roll back at once)

- The deploy fails to start, `/ready` is not 200 within 5 minutes of the deploy going live, or the log shows `startup failed`.
- `/health` or `/ready` is not 200 after the cold start.
- The apex preflight gets no `Access-Control-Allow-Origin`, or the www preflight gets one.
- The malformed-token or unsigned-token check returns anything other than 401.
- Any token, key or connection string appears in a response or the deploy log.
- Sign-in from the staging app returns 5xx other than a short `provider_unavailable` burst.

## Rollback (app only)

- Redeploy `dep-db9m51qjnfac73cqh6eg` (X-27, `2192de6`) from the Render
  dashboard, or another release that has actually been verified as live and
  good. That deploy runs the same migrations (0000–0010), so the database
  needs nothing.
- **Never** roll back or edit migration `0010`, `drizzle.__drizzle_migrations`,
  `meta/_journal.json` or `CHECKSUMS.sha256`. No database step is part of this
  rollback.
- After the rollback, check `/health`, `/ready` and the apex CORS preflight again.

## Local evidence at the candidate (28 Oct 2026)

Node v22.22.0, PostgreSQL 16.15 (local cluster, a fresh database per run).

| Run | Executed | Pass | Fail | Skipped |
|---|---|---|---|---|
| `tsc -p tsconfig.json`, `tsc -p tsconfig.api.json` | clean | | | |
| Backend `test` (`run-tests.mjs --strict`, unit + db, fresh DB) | 486 (424 unit, 62 db, 48 files) | 486 | 0 | 0 |
| `test:api` (`--strict`, fresh DB, built API) | 20 | 20 | 0 | 0 |
| Old backend `test` script at `2192de6` style (plain sh globs, no DB), for comparison | 340 | 328 | 0 | 12 (the PostgreSQL-only cases: 11 deletion-queue `[postgres]` and the auth hook) |

The plain-sh `test` script misses 126 tests (see `ci/test-discovery`).

A secret scan of the diff (JWT-shaped strings, `sb_secret_`/`sb_publishable_`
keys, PEM blocks, cloud and Git tokens, 32-byte hex keys, connection strings
with passwords) found nothing. Every key in the tests is generated at run time.

## Threat acceptance map

| Threat | Covered by |
|---|---|
| Only ES256/RS256 keys from the JWKS. HS256, `none`, unknown or missing kid, algorithm mix-ups, `crit`, future `nbf`, missing or duplicated OAuth `amr`, stale sign-in, replayed session are all refused | `authThreats.test.ts` "only the project's ES256 and RS256 signing keys sign in…", plus `supabaseAuth.test.ts` and `supabaseSignIn.service.test.ts` |
| Startup refused when either name is present, empty included, with no value logged | `config.test.ts` (in-process and both names empty at process level), `supabaseAuth.test.ts` |
| Key outage is 503 `provider_unavailable` with Retry-After, forged or malformed is 401, sessions survive, nothing leaks | `authThreats.test.ts` "a key-set outage is 503 only for…", `jwksOutage.test.ts`. The first fails on `2192de6`: stale keys still signed people in |
| Retry-After on the deletion-in-flight 503, `no-store` on pre-router refusals | `supabaseSignIn.service.test.ts` "a sign-in refused while a deletion is in flight…" and the `runtime.test.ts` 413 assertion. Both fail before `647e9a9`. The global-limiter 429 is covered by middleware order (`efd381b`) only, with no dedicated test |
| Deletion exactly once: overlapping workers, sign-back-in, retries, delayed provider removal, handoff expiry, never finished while cleanup is pending | `providerDeletionQueue.test.ts`, memory and PostgreSQL (11 cases each), and `supabaseSignIn.service.test.ts` "account deletion while the provider is down reports … pending" |
| CORS apex only, rate limits and admission intact | `renderBlueprint.test.ts` CORS preflight test, middleware untouched, existing `rateLimit`/`security`/quota/cap tests pass |

## Independent review

A separate reviewer checked `e70953f`: verdict ACCEPT WITH NOTES. Cherry-picks
match their PRs by patch id, scope is as listed, drizzle checksums pass, the
secret scan is clean. Mutation checks: removing the stale-key bound fails 1
test and removing Retry-After fails 3. Removing the `alg` match check fails
none, because a mismatched key type already fails signature verification, so
the algorithm mix-up cases prove "401" rather than that one guard. Notes fixed
since: the global-limiter 429 now carries `no-store` (`efd381b`), and this page
now names `efd381b` with current counts.
