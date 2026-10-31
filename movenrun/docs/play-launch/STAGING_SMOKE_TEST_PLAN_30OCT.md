# Staging smoke-test plan, 30 Oct 2026 (Lane C)

Target: Render service `movenrun-staging-api`, code commit `efd381bb6fc9e3be0229859d26ddee59cdbd410d` (the #162 security candidate).

## 1. Status in plain words

| Item | Value | Mark |
|---|---|---|
| Live deployment | `dep-dbi94de1egvs73f8ns5g`, commit efd381b, live since 2026-10-30 12:49:57Z | Reported to this workspace by the owner side; not read from Render here |
| Rollback target | `dep-db9m51qjnfac73cqh6eg` at `2192de6` (X-27, migrations 0000-0010 as listed in `drizzle/CHECKSUMS.sha256`) | From the evidence register (E-62, E-123) |
| Hosted HTTP checks | **NOT RUN from the agent environment.** Outbound requests return 403 and were not worked around | **UNVERIFIED** |
| Meaning of "live" | A deployment showing `live` is not the same as passing the checks below. Nothing is passed until the Evidence column in section 6 is filled | |

Every expected result below is what the code and the CI/local test evidence say should happen. None of it has been observed on the hosted service.

## 2. Ground rules

- No secrets in commands. `BASE` is the staging API origin, `GOOD_ORIGIN` the one allowed web origin, `BAD_ORIGIN` an origin that is not on the list. Set them in your shell; do not paste real tokens or database URLs into any file.
- All checks are read-only or send deliberately invalid input. Signing providers stay OFF. Do not make a real provider fail: the JWKS-outage check uses a local stand-in (section 4.4), never the hosted Supabase.
- **No second deploy happens without a new, explicit owner approval.** A failed check leads to rollback or a report, not a redeploy.
- **PR #162's head (`0faf652`) must not move.** Smoke-test results are recorded on the board branch only. Do not push to `integration/security-staging-preflight-28oct` or to `deploy/render-free-staging`.
- No migration 0011, no gameplay flag, no provider toggles.
- Cold start: Render Free sleeps. Send the first request, allow up to about 60 seconds, then run the checks.

```sh
BASE="https://<staging-api-host>"          # placeholder
GOOD_ORIGIN="https://<allowed-origin>"     # placeholder, from the CORS allowlist
BAD_ORIGIN="https://not-allowed.invalid"
```

## 3. Stop conditions (abort and go to section 7)

An unexpected applied migration, an unrecognised commit SHA, a JWT accepted that should be refused, an unhealthy database, CORS allowing an origin it should not, or `/ready` degraded after the warm-up window.

## 4. Command-by-command plan

### 4.1 Deployment identity (Render dashboard or connected tooling, read-only)

Confirm the live deployment id is `dep-dbi94de1egvs73f8ns5g`, its commit is exactly `efd381bb6fc9e3be0229859d26ddee59cdbd410d`, auto-deploy is off, and `dep-db9m51qjnfac73cqh6eg` is still listed as a prior deployment (rollback available).
Pass: all four hold. Fail: any differs.

### 4.2 Health and readiness

```sh
curl -sS -m 90 -o /dev/null -w '%{http_code}\n' "$BASE/health"
curl -sS -m 30 -i "$BASE/ready"
curl -sS -m 30 -i "$BASE/identity/ready"
```

Expected: `/health` 200 with `{"status":"ok"}`. `/ready` 200 with `{"status":"ready","database":"ready","signIn":"supabase"}`; it probes migrated tables, so 503 `{"status":"unavailable"}` means the database or schema is wrong. `/identity/ready` (the identity router's own check) 200, with `Cache-Control: no-store`.
Pass: 200 on all three within the warm-up window. Fail: 503, a timeout after warm-up, or a different body.

### 4.3 CORS allow and deny

```sh
curl -sS -i -X OPTIONS "$BASE/identity/ready" \
  -H "Origin: $GOOD_ORIGIN" -H "Access-Control-Request-Method: GET" | grep -i -E '^(HTTP|access-control)'
curl -sS -i -X OPTIONS "$BASE/identity/ready" \
  -H "Origin: $BAD_ORIGIN" -H "Access-Control-Request-Method: GET" | grep -i -E '^(HTTP|access-control)'
```

Expected: the allowed origin is echoed in `Access-Control-Allow-Origin`; the other origin gets no `Access-Control-Allow-Origin` header; no `*` appears anywhere.
Pass: both as stated. Fail: any wildcard, or the bad origin echoed.

### 4.4 Forged and malformed tokens return 401; key-set outage returns 503

Hosted part (no real token needed):

```sh
curl -sS -i "$BASE/identity/me" -H "Authorization: Bearer not-a-jwt"
curl -sS -i "$BASE/identity/me" -H "Authorization: Bearer eyJhbGciOiJub25lIn0.e30."
curl -sS -i "$BASE/identity/me"
```

Expected: 401 each time, JSON error body, `Cache-Control: no-store`. A token with `alg: none` or a bad signature is never accepted.
Pass: 401 on all three. Fail: any 200, or a 5xx.

Key-set outage (JWKS unavailable): expected 503 `provider_unavailable` with `Retry-After: 10`, per the 28 Oct report (LOCAL/PG tests, CI on #162). Run it only with the local stand-in: start a local copy of the efd381b backend against a local fake key-set server that returns 500 or refuses connections, then send a request with a token whose key id is unknown.
Pass: 503 plus `Retry-After`, and forged tokens still 401 during the outage (stale keys must not keep signing people in). Fail: 200, 401 without `Retry-After` where an outage is simulated, or a hang.
Note: the `Retry-After` header is not present in the source on the board branch (this branch only carries the docs and the earlier code); it belongs to the #162 candidate. Read it on the exact SHA, not on the board branch.
Do not try to break the hosted Supabase key endpoint. If no local stand-in is possible, mark this item NOT RUN, not PASS.

### 4.5 `Cache-Control: no-store` on authentication routes

```sh
curl -sS -i -X POST "$BASE/identity/auth/refresh" -H 'Content-Type: application/json' -d '{}' | grep -i -E '^(HTTP|cache-control|pragma)'
curl -sS -i "$BASE/identity/me" | grep -i -E '^(HTTP|cache-control|pragma)'
curl -sS -i -X POST "$BASE/identity/auth/google/complete" -H 'Content-Type: application/json' -d '{}' | grep -i -E '^(HTTP|cache-control|pragma)'
```

Expected: refused with 400/401 (never 200 with an empty body), and `Cache-Control: no-store` plus `Pragma: no-cache` on every response, denials included. Google sign-in must not be completed here: the provider is OFF and a synthetic request does not count as a live sign-in.
Pass: header present on all. Fail: missing on any denial.

### 4.6 Deletion-queue idempotence

The asynchronous deletion queue in the gameplay line is behind the gameplay flag and is **not deployed** on this service. Hosted idempotence is therefore not testable and must be recorded as NOT APPLICABLE, not PASS. What can be checked on the hosted service, read-only (SQL, owner or connected tooling, no writes):

```sql
select count(*) from pending_auth_user_deletions;   -- expect 0 (or rows younger than 1 hour)
select count(*) from google_sign_in_exchanges;       -- table exists (migration 0010)
```

The compare-and-swap claim of the existing deletion queue (#148) is covered by CI and local tests (E-104). Repeating a real account deletion on staging is out of scope.
Pass: counts as stated, no stale pending rows. Fail: pending rows older than an hour.

### 4.7 Schema check, 0000-0010 and no 0011

```sql
select count(*) from drizzle.__drizzle_migrations;   -- expect 11
select hash from drizzle.__drizzle_migrations order by id;
```

Compare each hash with `movenrun/backend/drizzle/CHECKSUMS.sha256`. Expect 11 rows, all matching, no 0011 (its hashes are in E-120 and must not appear).
Pass: 11 rows, all match. Fail: any other count, any mismatch, or 0011 present.

## 5. Provider and exposure checks (read-only, names only)

Signing providers still OFF in the Supabase dashboard; the Render environment lists variable names only (never open values); `SUPABASE_LEGACY_JWT_SECRET` and `SUPABASE_JWT_SECRET` still absent (X-30). Record yes/no only.

## 6. Readiness sheet

Fill the Evidence column with a timestamp (UTC), the person or tool, and the command output reference. Leave blank until run.

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Live deploy id and exact SHA match (4.1) | OWNER-VERIFIED | OWNER-VERIFIED via cloud integrations (31 Oct 22:17Z), not independently reproduced by the agent: live Render deployment |
| 2 | Rollback deployment still available (4.1) | OWNER-VERIFIED | OWNER-VERIFIED via cloud integrations (31 Oct 22:17Z): rollback target available |
| 3 | `/health` 200 (4.2) | READY | VERIFIED 31 Oct: 200 `{"status":"ok"}` |
| 4 | `/ready` 200 and database ready (4.2) | READY | VERIFIED 31 Oct: 200, database ready |
| 5 | CORS allows listed origin only (4.3) | READY | VERIFIED 31 Oct: listed origin echoed, untrusted origin no allow header |
| 6 | Forged and malformed tokens return 401 (4.4) | READY (partial) | VERIFIED 31 Oct (forged token 401 `session_invalid`; malformed variants NOT RUN) |
| 7 | Key-set outage returns 503 with Retry-After (local stand-in) (4.4) | PENDING | Left pending by owner instruction (31 Oct 22:17Z) |
| 8 | `no-store` on authentication routes, denials included (4.5) | READY (partial) | VERIFIED 31 Oct on the 401: `no-store`, `pragma: no-cache` (other auth routes NOT RUN) |
| 9 | Deletion queue: no stale pending rows; async queue not deployed (4.6) | N/A | Queue not deployed; no database access from runner |
| 10 | Migrations: 11 rows, hashes match, no 0011 (4.7) | OWNER-VERIFIED | OWNER-VERIFIED via cloud integrations (31 Oct 22:17Z): healthy Supabase, 11 applied migrations (hash comparison not reproduced by the agent) |
| 11 | Providers OFF, legacy secrets absent (section 5) | PENDING | Left pending by owner instruction (31 Oct 22:17Z) |
| 12 | #162 head unchanged at `0faf652`; deploy branch at efd381b | OWNER-VERIFIED | OWNER-VERIFIED via cloud integrations (31 Oct 22:17Z): #162 head and exact deployment branch |

Overall: READY only if every row is READY (row 9 may be N/A). Any NOT READY or blank row means NOT READY. Report `live`, `passed` and `failed` as three separate labels with the deployment id and the tested SHA.

Sign-off (owner): Name ______  Date ______  Signature ______ (left blank)

## 7. Rollback

1. Stop. Do not run further checks that change state.
2. In the Render dashboard for `movenrun-staging-api`, roll back to `dep-db9m51qjnfac73cqh6eg` (commit `2192de6`). Auto-deploy stays off.
3. Do not move `deploy/render-free-staging` backwards or forwards as part of the rollback; the dashboard rollback is enough. Do not use force-push.
4. Re-run 4.2 (`/health`, `/ready`) against the rolled-back service and record the result.
5. Migrations: efd381b added none beyond 0010, so no database rollback is needed. If 4.7 shows anything unexpected, stop and report; never apply a down-migration without a separate owner decision.
6. Rollback pointers: `X24_DEPLOY_CANDIDATE.md` (rollback steps), `X26_SIGNING_KEY_RUNBOOK.md` (key matters).

## 8. After the checks

- A second deployment of any kind needs a new, explicit owner approval (a new X-33 style authorization naming the commit). A failed smoke test is not that approval.
- Do not retarget or rebase #179 (Google acceptance tests) until this sheet is complete and READY, and never by changing #162's head.
- Record results as a new evidence entry on the board branch.


### Result of 31 Oct run
Sheet remains INCOMPLETE. Agent-reproduced: rows 3, 4, 5 (6 and 8 partially). Owner-verified via cloud integrations: rows 1, 2, 10, 12. Pending by owner instruction: rows 7 (key-set outage) and 11 (providers). Evidence: STAGING_SMOKE_RESULTS_31OCT.md; run https://github.com/suhaib155/arena/actions/runs/41232297629.
