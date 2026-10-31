# Staging smoke results, 31 Oct 2026

Run on a GitHub-hosted Actions runner (read-only workflow, no secrets, branch `ci/staging-smoke-31oct`, not a deployment branch). No redeploy, no hosting change.

- Run: https://github.com/suhaib155/arena/actions/runs/41232297629 (conclusion: success)
- Artifact: `staging-smoke-evidence`, id 13053539913 (16 files, sanitized headers and bodies)
- Target: https://movenrun-staging-api.onrender.com
- Cold start: first warm-up attempt timed out at 30 s; second returned 200 at 19:03:20Z (Render Free idle behaviour).

| Check | Observed | Verdict |
|---|---|---|
| GET /health | 200 `{"status":"ok"}` | PASS |
| GET /ready | 200 `{"status":"ready","database":"ready","signIn":"supabase"}` | PASS |
| Origin https://movenrun.xyz | `access-control-allow-origin: https://movenrun.xyz` | PASS |
| Origin https://untrusted.example | no `access-control-allow-origin` header | PASS |
| Forged bearer on /identity/me | 401 `{"error":{"code":"session_invalid"}}` | PASS |
| Cache headers on that 401 | `cache-control: no-store`, `pragma: no-cache` | PASS |

Not verified here (runner has no deployment, dashboard or database access): deployment id/SHA match, rollback availability, key-set outage 503, migrations table, providers OFF and legacy secrets absent, #162 and deploy-branch heads. These stay NOT RUN; the READY sheet stays incomplete.
