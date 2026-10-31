# Identity and staging READY matrix (1 Nov 2026)

Nothing here was deployed, enabled or changed. Hosted rows come from read-only reads; local rows from tests on this branch. Results use PASS, FAIL, BLOCKED, NOT RUN and UNKNOWN only.

## 1. Hosted staging (read-only, 31 Oct 22:40 UTC)

| Row | Result | Evidence |
|---|---|---|
| B0 five HTTP checks (`/health` 200, `/ready` 200, allowed origin echoed, untrusted origin refused, forged bearer `/identity/me` 401 with no-store) | PASS (reused, not rerun) | Actions run 41232297629, job 124628835714: 6 of 6 rows PASS; artifact `staging-smoke-evidence` 13053539913 kept until 30 Nov |
| Live Render deploy and code | PASS | Render deploy list: `dep-dbi94de1egvs73f8ns5g` live at `efd381bb6fc9e3be0229859d26ddee59cdbd410d` |
| Rollback target | PASS (identity), see note | `dep-db9m51qjnfac73cqh6eg` deactivated, code `2192de6`. Rolling back removes the key-outage 503, the legacy-name startup refusal and exactly-once deletion, so use it only for an outage the new code causes |
| `deploy/render-free-staging` | PASS | `efd381b`, unchanged |
| #162 review head | PASS | `0faf652` (efd381b plus one doc commit), unchanged |
| Supabase project | PASS | auth, db, pooler, realtime, storage ACTIVE_HEALTHY; GoTrue v2.197.0 |
| Supabase `rest` (PostgREST) | NOT APPLICABLE | Reports UNHEALTHY with an empty exposed schema list. That is the intended setting (no schema exposed); the API talks to Postgres directly and never uses PostgREST |
| Migrations applied | PASS | `drizzle.__drizzle_migrations` = 11 (0000 to 0010) |
| Migration 0011 absent | PASS | 0 `gameplay*` tables in any schema; no `gameplay_partitions` schema |
| Sign-in providers (Google, Web3, Email, anonymous) ON/OFF | UNKNOWN | Not read: the auth-config read can return provider secrets. Owner check in section 5 |
| Hosted key-set outage gives 503 | NOT RUN | Not induced on purpose. Proven locally (section 2) |

## 2. Local proof: 503 `provider_unavailable` versus 401

| Case | Result | Test |
|---|---|---|
| Key-set network error, timeout, 500, 503: 503 with `Retry-After: 10` and no-store, no session | PASS | `identity/http/jwksOutage.test.ts` |
| Forged token after a good key fetch: 401, no Retry-After | PASS | `jwksOutage.test.ts`, `authThreats.test.ts` |
| Inside the 1 h stale window cached keys still decide; after it 503; a token refused on its face stays 401 and costs no fetch | PASS | `authThreats.test.ts` |
| Wallet grant unreachable, 5xx or tokenless: 503 `provider_unavailable` with Retry-After | PASS (fixed here) | `identity/http/walletProviderOutage.test.ts`. Before this change it was 503 `provider_not_configured` with no Retry-After, so the app said "isn't available yet" during an outage |
| Wallet grant refused: 401, 403 at the cap, 429 at the quota, no Retry-After | PASS | `walletProviderOutage.test.ts` |
| Challenge spent by a failed grant cannot be replayed | PASS | `walletProviderOutage.test.ts` |
| Forged MovenRun bearer during a total provider outage: 401 no-store, no provider call (B0 row 5 pinned) | PASS | `walletProviderOutage.test.ts` |
| Guest play independent of providers; Google and wallet stay separate; single-use exchange; refresh replay | PASS | #179 tests plus existing suites (see `GOOGLE_AUTH_ACCEPTANCE_29OCT.md`) |

Backend strict suite on this branch: 494 of 494 pass, 0 skipped (unit 432, db 62); typecheck clean.

## 3. Account deletion HTTP matrix

| Code line | Request | Expected | Where it is |
|---|---|---|---|
| Live (`efd381b`) | `POST /identity/account/delete` without the confirmation | 400 `invalid_request` | Staged |
| Live | With confirmation | 200 `{deleted: true, erased, signInRecord}`; `signInRecord` is `removed`, `pending` (provider down, retried by the worker) or `none` | Staged |
| Live | Old access token afterwards | 401 | Staged |
| Dev only (`feat/g34-server-holdings`, needs 0011) | With confirmation | 202 `{deleted: false, status: "pending", requestId, signedOut: true}` | NOT staged |
| Dev only | Again while pending | 409 `account_deletion_pending` | NOT staged |
| Dev only | Queue cannot start in time | 503 `deletion_busy` | NOT staged |

The dev rows are checked once a backend carrying them is staged under its own approval. Never test them against the live server.

## 4. Live server versus the Android candidate

The live server (`efd381b`) and the Android candidate (`ac8d87b`) have diverged. The candidate's backend has the newer movement decisions (short-route evidence MR-A-01, unobserved bridges MR-A-02, clock-forward rejection); the live server does not. The API shape is the same, so the app talks to it, but server verification outcomes for short or gappy walks will differ. No compatibility candidate was cut, because no signed-in phone test can happen while sign-in providers are off: guest play, maps, GPS and local XP need no backend. A single merged candidate (security from `efd381b` plus movement from `ac8d87b`, no 0011, no gameplay) becomes worth building when the owner approves X-05. Until then, do not mark any server-verification phone row PASS against staging.

## 5. Owner phone checks (no values, ON/OFF only)

1. Open supabase.com/dashboard, project `tavxmwuwkeynbnzfwove`, Authentication, Sign In / Providers. Reply with ON or OFF for: Google, Web3 Wallet (Ethereum), Email, Anonymous sign-ins. Expected today: all OFF.
2. Same project, Authentication, Rate Limits: reply with the Web3 sign-in number only.
3. Authentication, URL Configuration: reply whether the Site URL is `https://movenrun.xyz` (yes or no).

Send nothing else from those pages. These answers close the UNKNOWN row in section 1; they change nothing.

## 6. Watching for 503s and rolling back

- A `/ready` 503 means the API cannot reach the database. Sign-in 503 `provider_unavailable` means the provider's keys or Web3 grant are unreachable; both carry Retry-After and clear on their own.
- Check from a phone: Render, `movenrun-staging-api`, Logs, filter `503`. A run of `provider_unavailable` longer than 10 minutes is a Supabase incident (status.supabase.com), not a reason to roll back.
- Roll back only if the live code itself fails (`/health` not 200 after warm-up, or 5xx on every request). Rolling back needs the owner's approval and loses the security fixes listed in section 1.
