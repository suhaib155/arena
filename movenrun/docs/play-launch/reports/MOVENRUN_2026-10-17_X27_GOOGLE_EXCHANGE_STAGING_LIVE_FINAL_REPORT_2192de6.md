# MovenRun milestone report: #112 single-use Google exchange live on staging (X-27)

**Date:** 17 Oct 2026 · **Code deployed:** `2192de6930be18d7e4bc07a94b93828d46b0a7d5` · **Deploy branch:** `deploy/render-free-staging` 7f4c0d4 → 2192de6 (fast-forward) · **Render deploy:** `dep-db9m51qjnfac73cqh6eg`, live 11:57:57 UTC · **Rollback target:** `dep-db9gqfrbc2fs73do581g` (7f4c0d4)

## Approval

The owner's "Next approved execution packet" (17 Oct, 11:52 UTC) approved one
controlled Render Free staging deployment of #112's reviewed code at 2192de6
with its additive migration `0010_google_sign_in_exchanges`, through the
existing procedure, with no separate SQL. Nothing else was approved: X-05,
the full website, main, contracts, spending and Play stay closed.

## Preflight (all passed before deploying)

| Check | Result |
|---|---|
| Deploy branch | at 7f4c0d4 (X-24), Render live deploy `dep-db9gqfrbc2fs73do581g` at 7f4c0d4 |
| Ancestry | 7f4c0d4 is an ancestor of 2192de6: fast-forward, no merge |
| CI at 2192de6 | backend-checks and mobile-checks success |
| Migration checksums | `sha256sum -c CHECKSUMS.sha256` OK for 0000–0010 |
| Scope 7f4c0d4..2192de6 | backend identity code and tests, migration 0010 with journal and checksum, docs. No other migration, no mobile, website or provider change |
| Render | service `movenrun-staging-api`: plan free, auto-deploy off (`autoDeployTrigger: off`), branch `deploy/render-free-staging`, health check `/ready` |
| Rollback | previous deploy at 7f4c0d4 kept. Migration 0010 only adds a table, so the old code runs with it in place; no database step is needed on rollback |

## Deploy

The branch was fast-forwarded 7f4c0d4 → 2192de6, then one deploy was started
through the Render API (`trigger: api`). Build and start took about a minute.
The migration ran only through the start command's `db:migrate`.

## Live verification (LIVE VERIFIED, E-62)

| Check | Result |
|---|---|
| `/health`, `/ready` | 200 `ok`; 200 `ready`, database ready, sign-in supabase |
| Boot log | `migrations applied successfully`; `Supabase tokens: signing keys only; proxies: trusted by network (Cloudflare, private)` |
| Error logs since deploy | none |
| JWT rejection on `/identity/auth/google/complete` | forged HS256 401, unknown-kid ES256 401, `alg: none` 401, missing token 400 |
| CORS preflight | `https://movenrun.xyz` allowed; `https://www.movenrun.xyz` and an unrelated origin get no allow-origin |
| Proxy rate limits | global limit 300, remaining falls by one per request across 12 requests with forged `X-Forwarded-For`/`Forwarded` on every other one; sign-in write limit 20, falls by one across 4: PASS, one bucket |

No test account was created and no real sign-in was attempted (X-05 is off).
No credential, environment value or JWT setting was read.

## Not verified here (owner action)

- **11 migrations and RLS by SQL.** A read of the production database from
  this workspace was refused by its permission guard, so the count and the
  RLS flag are not LIVE VERIFIED. The boot log shows the journal (0000–0010)
  applied and 0010 enables RLS on its table. To confirm, run as the read-only
  role in the Supabase SQL editor:
  `select count(*) from drizzle.__drizzle_migrations;` (expect 11) and
  `select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;` (expect no rows).
- **Two-network client-address check.** Still an owner/device step, needed
  before the real-authentication gate (X-05).

## Other work in this window

- G2 #114 at 59185eb: one push per walker per unit per day (owner decision
  17 Oct); gameplay numbers stay provisional (D4 and others open). Shared
  190/190, CI green (E-61).
- #115 and #116 descriptions cleaned; no code change.

## Blockers

Owner: the SQL confirmation above, the two-network result, the GitHub Pages
Unpublish click, the Vercel apex steps (X-21a). Approvals still closed: X-05,
X-21 publication, merge to main, contracts, spending, Play.
