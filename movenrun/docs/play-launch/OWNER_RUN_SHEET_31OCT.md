# Owner run sheet, 31 Oct 2026: preview APK build and staging smoke tests

Nothing in this sheet has been run. The agent environment has no Expo or EAS access and its outbound HTTP returns 403, so the build and the HTTP checks are for the owner's PC. Do not deploy again and do not change hosting settings.

## Part A. One EAS preview APK (X-04, revised 31 Oct)

Approved: exactly one build from commit `ac8d87bed55f4dae0b9152ed21fa8cc29b8050f9`, API `https://movenrun-staging-api.onrender.com`. No second build, no Play submission, no production release.

The workflow builds the head of the branch it is run on and takes no commit input. The branch `build/android-preview-ac8d87b` already points at exactly that commit.

### A1. Checks before you press anything (all must hold; if any fails, stop and do not run the workflow)
| # | Check | Where | Pass |
|---|---|---|---|
| 1 | Branch head is the approved commit | GitHub, branch `build/android-preview-ac8d87b` | head SHA is `ac8d87bed55f4dae0b9152ed21fa8cc29b8050f9` |
| 2 | CI is green on that commit | GitHub, commit page for the SHA | Mobile type-check and backend checks passed (the squash merge #184 ran them) |
| 3 | `EXPO_TOKEN` secret exists | GitHub repo, Settings, Secrets and variables, Actions | listed (do not open the value) |
| 4 | Build quota left, nothing queued | expo.dev, Usage / Builds | allowance remaining and no build in progress |
| 5 | EAS environment `preview` has these names | expo.dev, project, Environment variables, `preview` | `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `GOOGLE_MAPS_ANDROID_API_KEY` present; `EXPO_PUBLIC_WEB_URL` optional |
| 6 | API URL value is the approved target | same page, value of `EXPO_PUBLIC_API_URL` (plain text) | exactly `https://movenrun-staging-api.onrender.com` (no trailing path). If it differs, stop: the build would target something else |
| 7 | Supabase key is the publishable key | same page | starts with the publishable format, never a secret/service key |
| 8 | Maps key is restricted | Google Cloud console, Credentials | restricted to Android apps, package `io.movenrun.app`, with the signing SHA-1 EAS will use (see A3), and to Maps SDK for Android only |
| 9 | Android signing | expo.dev, project, Credentials, Android | a keystore exists (or EAS will generate one on the first build); note its SHA-1 for check 8 |
| 10 | Google sign-in stays OFF | Supabase dashboard | providers unchanged; the preview app may hide the Google button |

### A2. Run the build (GitHub Actions)
1. Open `https://github.com/suhaib155/arena/actions/workflows/eas-apk-build.yml`.
2. Click "Run workflow". For "Use workflow from" choose the branch `build/android-preview-ac8d87b`. There are no inputs. Click "Run workflow" once.
3. Watch the run. The workflow checks the secret, checks that the EAS project id is linked (it is: `app.json` carries a project id), installs with `yarn install --immutable`, then runs `eas-cli@24.8.0 build -p android --profile preview --non-interactive`.
4. Copy the EAS build URL from the last step's log and send it to the project chat. Do not re-run on failure: record the failing line instead and ask for a decision.
5. Download the APK from the EAS build page onto the phone (or `adb install -r movenrun.apk`).
6. Afterwards delete the branch `build/android-preview-ac8d87b` (GitHub, Branches) so nothing else builds from it.

### A3. After the build
- Record in the project chat: EAS build id, time, `adb shell dumpsys package io.movenrun.app | grep -i versionName`, and the signing SHA-1 shown on the EAS credentials page (a fingerprint, not a secret; check it matches the Maps key restriction).
- Run the handset plan `ANDROID_V1_PHONE_TEST_PLAN.md` (rows H-1 to H-12).

### A4. What this build can and cannot prove
The hosted staging API runs the older security backend (`efd381b`). It does not carry the newer movement rules (the MR-A-01 / MR-A-02 and future-skew checks) or the queued deletion responses (202, 409, 503). So:
| Row | Status against staging |
|---|---|
| H-1 cold start, H-2 offline and retry, H-7 to H-9, H-11, H-12 | can be run |
| H-3 stationary (mandatory) | can be run; records phone behaviour; the server stationary rule is off |
| H-4, H-5, H-6 (small loop, track loop, slow walk, vehicle, clock jump) | run the phone side, but server verdict rows are **BLOCKED** until the newer movement rules are on the target server. Do not mark them PASS against staging |
| H-10 deletion | the sync 200 path only; the 202/409/503 messages are **BLOCKED** (client-side only until the queue is promoted) |
| Anything needing gameplay, territory economy or Play-installed behaviour | **BLOCKED** (out of scope) |

## Part B. Staging smoke tests (read-only, from your PC)

Target: `movenrun-staging-api`, expected live commit `efd381bb6fc9e3be0229859d26ddee59cdbd410d`, deployment `dep-dbi94de1egvs73f8ns5g`. Render Free sleeps: the first request can take about 60 seconds. Every command below is a GET, an OPTIONS, or a request with deliberately invalid input. None needs a token or secret. If a result is a stop condition (section B3), do not change anything; report it.

### B0. The owner's five commands (31 Oct), exactly as given
```sh
BASE="https://movenrun-staging-api.onrender.com"

curl -i "$BASE/health"
curl -i "$BASE/ready"

curl -i -H "Origin: https://movenrun.xyz" "$BASE/health"

curl -i -H "Origin: https://untrusted.example" "$BASE/health"

curl -i -H "Authorization: Bearer invalid.invalid.invalid" "$BASE/identity/me"
```
Expected, from the code at `efd381b` and its tests (not yet observed on the hosted service):
| Command | Expected |
|---|---|
| `/health` | 200 `{"status":"ok"}` (the first call may take about 60 s while Render wakes) |
| `/ready` | 200 `{"status":"ready","database":"ready","signIn":"supabase"}`; 503 `{"status":"unavailable"}` means the database or schema is wrong |
| `/health` with `Origin: https://movenrun.xyz` | 200, and `Access-Control-Allow-Origin: https://movenrun.xyz` if that is the origin configured in Render's `CORS_ORIGINS` (documented value; if it is not listed, no allow header appears and that is a finding to report, not to fix) |
| `/health` with `Origin: https://untrusted.example` | no `Access-Control-Allow-Origin` header at all, and never `*` |
| `/identity/me` with the invalid bearer | 401 with a JSON error body and `Cache-Control: no-store` |
Paste the full output of all five into the project chat. Record each as READY or NOT READY in the sheet in section B2; the overall READY sheet stays incomplete until you report results and the remaining rows are filled.

### B1. Fuller command set (optional, bash, Git Bash or WSL; for PowerShell use `curl.exe`)
```sh
BASE="https://movenrun-staging-api.onrender.com"
GOOD_ORIGIN="https://movenrun.xyz"          # documented CORS_ORIGINS value; if Render shows a different value, use that
BAD_ORIGIN="https://not-allowed.invalid"

# 1 warm-up, then health and readiness
curl -sS -m 90 -o /dev/null -w 'health %{http_code}\n' "$BASE/health"
curl -sS -m 30 -i "$BASE/health"
curl -sS -m 30 -i "$BASE/ready"
curl -sS -m 30 -i "$BASE/identity/ready"

# 2 CORS: allowed origin is echoed, other origin gets no allow header, never *
curl -sS -i -X OPTIONS "$BASE/identity/ready" -H "Origin: $GOOD_ORIGIN" -H "Access-Control-Request-Method: GET" | grep -iE '^(HTTP|access-control)'
curl -sS -i -X OPTIONS "$BASE/identity/ready" -H "Origin: $BAD_ORIGIN"  -H "Access-Control-Request-Method: GET" | grep -iE '^(HTTP|access-control)'

# 3 forged and missing tokens must be 401
curl -sS -i "$BASE/identity/me" -H "Authorization: Bearer not-a-jwt"
curl -sS -i "$BASE/identity/me" -H "Authorization: Bearer eyJhbGciOiJub25lIn0.e30."
curl -sS -i "$BASE/identity/me"

# 4 no-store on authentication routes, denials included
curl -sS -i -X POST "$BASE/identity/auth/refresh" -H 'Content-Type: application/json' -d '{}' | grep -iE '^(HTTP|cache-control|pragma)'
curl -sS -i "$BASE/identity/me" | grep -iE '^(HTTP|cache-control|pragma)'
```
Do not complete a real Google sign-in or delete a real account as part of these checks.

### B2. Expected results and how to record them
| # | Check | Expected | Record |
|---|---|---|---|
| 1 | `/health` | 200 `{"status":"ok"}` | READY / NOT READY |
| 2 | `/ready` and `/identity/ready` | 200, database ready, sign-in `supabase` | READY / NOT READY |
| 3 | CORS | allowed origin echoed; bad origin has no `Access-Control-Allow-Origin`; no `*` | READY / NOT READY |
| 4 | Forged / missing tokens | 401 each time, JSON body | READY / NOT READY |
| 5 | `no-store` | `Cache-Control: no-store` and `Pragma: no-cache` on every response above, including 401s | READY / NOT READY |

Not testable from outside, so they stay **NOT RUN** in the READY sheet: deployment id and exact SHA (Render dashboard, read-only), rollback deployment still listed, key-set outage 503 with `Retry-After` (local stand-in only; do not break the hosted key endpoint), migrations count 11 with matching hashes and no 0011 (Supabase SQL editor, read-only `select count(*) from drizzle.__drizzle_migrations;`), providers OFF and legacy secrets absent. Queued deletion idempotence is N/A: the queue is not deployed.

### B3. Stop conditions
A JWT accepted that should be refused, CORS allowing an origin it should not or a wildcard, `/ready` still degraded after the 60-second warm-up, or a response header missing on a denial. On any of these: change nothing, paste the command and output into the project chat. A rollback (Render dashboard to `dep-db9m51qjnfac73cqh6eg`) is only done on a separate owner decision.

### B4. The READY sheet stays incomplete
The 12-row READY sheet in `STAGING_SMOKE_TEST_PLAN_30OCT.md` section 6 remains incomplete until each row has a UTC time, who ran it and an output reference. Overall result is READY only if every row is READY (row 9 may be N/A). Report `live`, `passed` and `failed` as three separate labels.
