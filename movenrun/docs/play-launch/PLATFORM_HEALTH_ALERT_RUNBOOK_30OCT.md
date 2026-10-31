# Platform health and alert runbook, 30 Oct 2026 (Lane D)

Zero-spend. Nothing here needs a paid plan, a paid monitor, or fabricated keep-alive traffic. Where a check needs a dashboard, the owner or operator reads it by hand. Marks: VERIFIED (source or record) or UNVERIFIED (not observed in this workspace, which cannot reach Render, Supabase or Vercel).

## 1. Who acts

| Role | Who | Does |
|---|---|---|
| Operator | Owner (suhaib155) or the connected operator | Reads dashboards, runs the checks, rolls back |
| Agent session | This workspace | Prepares text only. Cannot reach hosted services (403) and never deploys |
| Decision owner | Owner | Any spend, upgrade, plan change, disconnect, deploy approval |

## 2. Render Free (`movenrun-staging-api`)

| What | How often | Healthy | Act when |
|---|---|---|---|
| Cold start | Whenever a tester reports slowness; before any test session | First request after idle may take up to about 60 s (free instances sleep; UNVERIFIED for this service, vendor behaviour) | Never "fix" with scheduled pings: that would be fabricated traffic. Send one request and wait |
| `GET /health` | Before each test session | 200 `{"status":"ok"}` | Non-200 after 90 s: look at the deploy log |
| `GET /ready` | Before each test session; at release, +2 h, +6 h, +24 h, +48 h (`POST_LAUNCH_MONITORING.md`) | 200 `ready`; it probes the migrated tables | 503 `unavailable`: check Supabase first (section 3), then Render logs |
| Deploy state | After any deploy | Exact SHA expected, auto-deploy off | Unexpected SHA or an auto-deploy: stop and tell the owner |
| 5xx and restarts | Weekly, and after any report | No sustained 5xx | Bursts for more than 15 minutes: roll back (section 6) |

## 3. Supabase Free (project `movenrun`, ref `tavxmwuwkeynbnzfwove`)

| What | How often | Healthy | Act when |
|---|---|---|---|
| Project pause risk | Weekly, and before any deploy, migration or test session | Dashboard shows Active; status `ACTIVE_HEALTHY`. Free projects pause after about a week of inactivity (vendor policy; UNVERIFIED current figure) | Paused: the owner restores it in the dashboard, then re-checks `/ready`. A deploy while paused fails at `db:migrate` with `tenant/user not found` (this happened on 29 Oct, E-122) |
| Service health | Before deploys; on any `/ready` 503 | Database, Auth and API all healthy on the status page and dashboard | Degraded: wait, do not deploy |
| Migrations | After every deploy | 11 rows in `drizzle.__drizzle_migrations`, hashes equal `CHECKSUMS.sha256`, no 0011 | Any other count: stop, report |
| Capacity | Weekly | Under the account cap, database size and connections well inside the free plan | 800 accounts or a near-limit database: tell the owner (D-20) |
| Pending deletions | Weekly, and daily in the 48 h after a release | `select count(*) from pending_auth_user_deletions` is 0 | Rows older than 1 hour: investigate the sweeper, owner decision |
| Keep-alive | Not done | Real use (test sessions, the checks above) keeps the project active | If it must stay awake, that is an owner decision (upgrade or accept the pause), never synthetic pinging by default |

## 4. Vercel Hobby (website)

| What | How often | Healthy | Act when |
|---|---|---|---|
| Daily deployment cap (100 per day, cancelled ignored builds still count) | Daily while pushes are frequent | Under 50 of 100 (tripwire from the cleanup plan) | At 50: stop CI-only and documentation-only pushes to branches that trigger previews; batch commits. At "Deployment rate limited, retry in 24 hours": wait; do not retry-loop |
| Production website | Weekly, and after any website change | `https://movenrun.xyz/` answers 200 on production `dpl_ABCfgjsFiJ4DHtRnrLPCc8npLAuD` (UNVERIFIED here, E-79) | Not 200: owner promotes rollback `dpl_1pNg2cyGZ4MLWuqfsSHBtU9P1KBf` in the dashboard |
| Spurious failed builds | On review | Failures on `arena`, `arena-pchb`, `arena-qg9n` are known and not code failures (`VERCEL_BUDGET_CLEANUP_PLAN_29OCT.md`) | A failure on `movenrun-website` itself: read the build log |

Cleanup options (Git disconnection, ignored build step) are owner actions, one at a time, in `VERCEL_BUDGET_CLEANUP_PLAN_29OCT.md`. This runbook performs none of them.

## 5. Alert thresholds (manual, no spend)

| Signal | Check | Threshold | Escalate to owner when |
|---|---|---|---|
| Job backlog / orphaned pending deletion | SQL above | 0 expected; any row older than 1 h | Immediately if older than 6 h |
| 5xx | Render logs | Any sustained burst | More than 15 min, or any 5xx on sign-in |
| DB pool exhaustion | Render logs, Supabase connections | Connection errors in logs | Twice in a day |
| Inactive/paused project | `/ready` 503 plus dashboard | Any pause | Immediately |
| CI under-discovery | Compare test-file counts with `test-inventory.json`; a green run with fewer files than expected | Any drop | Before merge |
| Vercel cap | Section 4 | 50 per day | At the limit |

Live monitors that need spend are not set up. Escalation path: operator notes the time (UTC), the signal and the output, tells the owner, and waits for a decision; nothing is changed on a hosted service without it.

## 6. Rollback pointers

- Render staging API: previous deployment `dep-db9m51qjnfac73cqh6eg` (2192de6); steps in `STAGING_SMOKE_TEST_PLAN_30OCT.md` section 7 and `X24_DEPLOY_CANDIDATE.md`. No second deploy without a new owner approval; #162 head must not move.
- Website: `dpl_1pNg2cyGZ4MLWuqfsSHBtU9P1KBf` (dashboard promote, owner).
- Keys: `X26_SIGNING_KEY_RUNBOOK.md`. Release monitoring: `POST_LAUNCH_MONITORING.md`.

## 7. Read-only checklist: verify the #128 ignored-build helper against Vercel's root directory

Do not run anything against Vercel from this workspace. The owner or operator reads the dashboard and records answers here. Script: `movenrun/ops/vercel/ignored-build.sh` on the #128 branch (`ops/vercel-ignore-build`, 49c9fe9). Planned field value: `sh ../ops/vercel/ignored-build.sh || exit 1`.

| # | Question | Where to read | Expected | Answer |
|---|---|---|---|---|
| 1 | Root Directory of `movenrun-website` | Settings, General | `movenrun/website` | |
| 2 | Is "Include source files outside of the Root Directory" enabled? | Settings, General | Enabled (otherwise `../ops/vercel/` does not exist in the checkout) | |
| 3 | Does the build checkout contain `movenrun/ops/vercel/ignored-build.sh`? | A build log line listing the folder, or the first build after the change | Present. If absent, `sh` errors and `|| exit 1` makes the build proceed: safe, saves nothing | |
| 4 | Is git history deep enough for the previous commit? | Build log (shallow clone?) | Previous commit reachable, or the script fails open and builds | |
| 5 | Exit codes understood: 0 skips, 1 builds | Vercel Ignored Build Step docs | Matches | |
| 6 | Manual override works: `VERCEL_FORCE_BUILD` set, or a manual redeploy from the dashboard | Dashboard | A build can always be forced | |
| 7 | The revoked one-liner `git diff --quiet HEAD^ HEAD -- .` is NOT used | Settings, Build and Deployment | Not present | |
| 8 | Native "Skip deployment" shown to scope the website (the folder is not a workspace member, so unproven) | Settings, Build and Deployment | Prefer native only if demonstrably correct; otherwise the helper | |
| 9 | A change touching only `movenrun/backend/` is skipped; a change under `movenrun/website/` and the helper itself still deploy | One test push, read the deployment list | Both as stated | |
| 10 | Cancelled builds still count toward 100 per day, so the helper saves build minutes, not the cap | Vendor documentation | Do not claim cap savings from a static script test | |

Success metric: fewer spurious builds while required website changes still deploy. Until rows 1 to 4 and 9 are answered, the helper is UNVERIFIED against Vercel and no cap saving is claimed.
