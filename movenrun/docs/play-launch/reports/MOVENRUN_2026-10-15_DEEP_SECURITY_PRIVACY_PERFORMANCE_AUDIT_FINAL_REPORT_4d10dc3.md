# MovenRun 15 Oct 2026: deep security, privacy, trust and performance audit

Code commit: `4d10dc3` on `security/deep-audit-hardening` (base `security/x26-signing-keys`, `20df9ae`).
Not deployed. The live API stays at `dd83065`; deploying needs X-24. No secret
value was read, printed or stored. Live checks were read only (GET, OPTIONS and
one POST with an empty body).

Scope: API (`backend/`), database migrations and the Supabase hook, Android
app config (`mobile/`), website (`website/`), CI workflows, Render Blueprint,
dependencies and the whole git history (364 commits, every branch). Earlier
reviews (F-01 to F-18 in `AUTH_SECURITY_REVIEW.md`, X-26) were built on, not
repeated. This is not an independent audit.

## What the owner needs to do

| # | Action | Why | Where |
|---|---|---|---|
| 1 | **Run X-26 §3 now** (disable legacy keys, revoke the legacy JWT secret), before X-05 | A-01: the secret still works, and it also opens the Auth admin API | `X26_SIGNING_KEY_RUNBOOK.md` §3 |
| 2 | **Vercel: make `movenrun.xyz` the primary domain**, `www` redirecting to it | A-03: today the site moves to `www`, where the API refuses its calls and wallets see a domain mismatch | Vercel → Project → Domains (part of X-21) |
| 3 | After the next deploy (X-24): run `node scripts/check-client-ip.mjs https://movenrun-staging-api.onrender.com`; raise `TRUST_PROXY_HOPS` in the Render dashboard until it passes | A-02: rate limits are keyed on a proxy, not on the player | Render → Environment |
| 4 | Decide: Android backups off (`"allowBackup": false`) | A-08: route points of unsent sessions go into Google backups | app.json (app is frozen, so not changed) |
| 5 | Decide: make the repository private, and turn off GitHub Pages | A-12: the open incident runbook and an old prototype are public | GitHub → Settings |

## Findings

Severity is impact × how easily it can happen today. "Fixed" means fixed on
this branch with tests; live systems change only after the owner's approval.

| ID | Severity | Finding | Proof | Fix | State |
|---|---|---|---|---|---|
| A-01 | **Critical** | **The leaked legacy JWT secret is still trusted, and the runbook understated it.** A `service_role` token minted with it is accepted by the Auth admin API (list, create, delete users; read Google emails), Storage and Realtime, not just the Data API (which is empty). The repository is public, so the open incident is publicly documented | `X26_SIGNING_KEY_RUNBOOK.md:28` (old impact line); incident open since 14 Oct 06:07 | Revoke per runbook §3 before any sign-in provider is on. Runbook impact line corrected (`1efea82`) | **Owner action** |
| A-02 | **High** | **Rate limits are keyed on a proxy address, not the caller.** With `TRUST_PROXY_HOPS=1` behind Render and its CDN, one caller's requests land in 2–3 interleaving buckets. So every player behind the same proxy node shares one 20-a-minute sign-in budget: one abuser can lock real players out of sign-in, while the abuser's own limit is spread across nodes | Live, 15 Oct: `RateLimit-Remaining: 299 299 298 298 297 296 297 296 295 295 294 294` → `FAIL` (`scripts/check-client-ip.mjs`); `app.ts:60`, `render.yaml:46` | Config accepts 0–3 hops with the trade-off explained (`config.ts`); `scripts/check-client-ip.mjs` proves the live result (one bucket, forged `X-Forwarded-For` ignored) | Code fixed; live value after X-24 |
| A-03 | **High** | **Live website domain does not match the API, Supabase or wallet message.** `movenrun.xyz` answers 308 → `www.movenrun.xyz`. The API allows only `https://movenrun.xyz`; the wallet message says `movenrun.xyz` and `https://movenrun.xyz/sign-in/`; Supabase redirects list the apex. From `www`, sign-in and account deletion fail (CORS), wallets warn about a different site, and Google's return is not on the list | Live: `curl -I https://movenrun.xyz/` → `location: https://www.movenrun.xyz/`; preflight from `https://www.movenrun.xyz` → no `access-control-allow-origin`; from the apex → allowed | Make the apex primary in Vercel (no code change). Do not add `www` to the lists instead: one canonical origin keeps the wallet message honest | **Owner action** (X-21) |
| A-04 | **High** | **One account could fill the free database.** `/movement/verify` accepts sessions of up to 10,000 points, 20 a minute, and keeps every row with its traversed cells for the life of the account. A script on one account writes tens of MB an hour; Supabase Free holds 500 MB, and a full database stops sign-in for everyone | `evidence.ts:13` (10,000 points), `rateLimit.ts` (20/min), `movement.schema.ts` (cells kept) | At most **30 new sessions per account per 24 h** (429 `daily_limit_reached`); retries of stored sessions still answer; the app already treats 429 as retry-later (`movementApi.ts:198`) | Fixed (`c638a29`), tests on PostgreSQL 16 |
| A-05 | **High** | **Third-party install scripts ran next to secrets.** Render's build step sees the API's environment (database URL, Supabase secret key, session pepper) and ran `yarn install` for the whole monorepo with install scripts on. In CI, `EXPO_TOKEN` was set for the whole job, so every dependency's install script could read it, and `npx eas-cli@latest` ran whatever version was published last. A compromised package (the slopsquatting and worm attacks in the screenshots) would have had the keys | `render.yaml:21`; `eas-apk-build.yml:16,61`; `eas-production-aab.yml:77,96`; `.yarnrc.yml` had no `enableScripts` | Install scripts off (`.yarnrc.yml`), only esbuild allowed by name; `EXPO_TOKEN` only on the two steps that use it; `eas-cli` pinned to 24.8.0; APK workflow read-only token | Fixed (`ec6dc75`) |
| A-06 | Medium | **Render installed 1,578 packages to run an API that needs ~150.** Slower free builds and ten times the third-party code | Full install `node_modules` 1.1 GB / 742 top-level; focused 160 MB / 151 | `yarn workspaces focus @movenrun/backend` in the Blueprint; the API suite passes on the focused tree | Fixed (`2379930`) |
| A-07 | Medium | **Known-vulnerable packages in the API's runtime tree**: `proxy-addr` 2.0.7 (critical advisory, IP spoofing via IPv4-mapped IPv6 trust subnets), `qs` 6.15.3 (two DoS issues), `ip-address` 10.2.0 (address misclassification) | `yarn npm audit --environment production` on `@movenrun/backend` | Express 4.22.3; resolutions `qs` 6.16.0, `proxy-addr` 2.0.8, `ip-address` 10.7.2 (each two weeks or more old). Left: `drizzle-orm` <0.45.2 identifier-escaping advisory, not reachable (no `sql.raw` or `sql.identifier` anywhere in `backend/src`); upgrade in its own PR | Fixed (`3c5a2d1`) |
| A-08 | Medium | **Android backups are on by default.** Expo sets `android:allowBackup` true unless told otherwise, so AsyncStorage (including the route points of an unsent session, up to 7 days) goes into Google cloud backup and device transfer | `@expo/config-plugins/build/android/AllowBackup.js:26` (`?? true`); `app.json` has no `allowBackup`; `DATA_INVENTORY.md` (pending verification row) | `"android": { "allowBackup": false }`. Trade-off: local progress no longer moves with a backup | **Owner decision** (app frozen) |
| A-09 | Medium | **Website script protection.** The CSP sets framing and base rules but no `script-src` or `connect-src`, and the sign-in and deletion pages (which hold tokens) run inline scripts. The live site today sends no security headers at all | `vercel.json:9`; `sign-in/index.html:54`, `account-deletion/index.html:69`; live `curl -I https://www.movenrun.xyz/` | Move the two inline scripts into `/js/` and add `default-src 'self'; script-src 'self'; connect-src` (API and Supabase only); `style-src`/`font-src` for Google Fonts. Do it with W1 (#108) so the two don't conflict | Recommended (X-21) |
| A-10 | Medium | **A Google sign-in token can be exchanged more than once.** `/identity/auth/google/complete` checks the Supabase token's signature and expiry only. Signing out at Supabase does not revoke an issued token, so anyone who obtains one within its hour can mint further MovenRun sessions | `supabaseSignIn.service.ts:115`; `account-auth.js:124-125` | Make the exchange single use: store the token's `session_id` claim (unique) on first use, or confirm it with `GET /auth/v1/user` before issuing | Recommended (needs a migration) |
| A-11 | Low | **Links to a deleted Vercel address.** Sitemap, robots and 12 canonical/OG tags pointed at `movenrun-website.vercel.app`, which answers `DEPLOYMENT_NOT_FOUND`. A released `*.vercel.app` name can be claimed by anyone | `robots.txt:4`, `sitemap.xml`; live 404 | All point at `https://movenrun.xyz/` | Fixed (`4d10dc3`) |
| A-12 | Low | **Public repository and GitHub Pages.** The repo is public (security design and the open X-26 runbook are visible) and Pages serves an old prototype at `suhaib155.github.io/arena` | GitHub repo metadata `visibility: public`, `has_pages: true`; live 200 | Turn off Pages; consider private (Render and Vercel work with private repos). Security must not depend on secrecy, but an open incident should not be published | **Owner decision** |
| A-13 | Low | Every authenticated request wrote the session's last-use time (3 queries, one of them a write, per call) | `session.service.ts:190` | Written at most once a minute | Fixed |
| A-14 | Low | Public sign-in routes parsed bodies up to 2 MB | `app.ts:78` | 32 KB for `/identity`, 2 MB only for `/movement`; the sign-in limiter runs before parsing | Fixed |
| A-15 | Low | The API connects as the tables' owner, so RLS never applies to it; one SQL bug reaches every table | `0006_row_level_security.sql` comment | A dedicated login role with only the grants the API uses | Recommended |
| A-16 | Low | One pepper signs access tokens and keys refresh hashes, with no rotation path: changing it signs everyone out | `session.service.ts` header, `keyedHash` | Accept a `IDENTITY_SESSION_PEPPER_PREVIOUS` for verification during a rotation window | Recommended |
| A-17 | Info | Actions pinned by tag, no Dependabot | `.github/workflows/*` | Dependabot for npm and Actions; GitHub secret scanning and push protection (free on public repos) | Recommended |
| A-18 | Info | `/identity/ready` reports the old provider fields (`google: "disabled"`) although Google sign-in is the plan | Live response | Report the Supabase sign-in state or drop the fields | Recommended |
| A-19 | Info | App build tooling has advisories (xmldom, shell-quote, postcss, brace-expansion) | `yarn npm audit` on `@movenrun/mobile` | Build-time only, not in the APK; refresh with the next Expo SDK patch | Note |

## Checked and found sound

- **Secrets:** full history of all branches scanned twice (repo scanner plus
  patterns for Google, Alchemy, Infura, JWT, Basescan, private keys, GitHub,
  Anthropic, Resend, Expo, `sb_secret_`): nothing. Only `.env.example` files
  were ever committed. No key in the app or website besides the publishable key.
- **Packages (slopsquatting):** every direct dependency is a well-known package;
  the lockfile pins 1,220 checksums; one local patch (`h3-js`) removes an unused
  decoder and nothing else. Only 6 packages had install scripts at all.
- **Injection:** all SQL through Drizzle parameters; no `sql.raw`. Request
  bodies are strict zod schemas; errors never echo input.
- **XSS:** the website writes untrusted text with `textContent` only; the two
  `innerHTML` uses are static strings (`main.js:154,349`).
- **Auth:** tokens verified by JWKS with issuer, audience, role, expiry, `nbf`
  and `crit` checks; refresh rotation with reuse detection; PKCE everywhere;
  wallet nonce single use. The API refuses forged tokens (E-43).
- **CORS:** a foreign origin gets no `access-control-allow-origin` (live).
- **API headers (live):** HSTS, `nosniff`, `frame-ancestors`, `no-referrer`,
  CORP/COOP.
- **Database:** RLS on every table, hook callable by `supabase_auth_admin` only,
  `SECURITY DEFINER` with a pinned `search_path`, migration checksums.
- **App:** foreground location only, background location and storage
  permissions removed, tokens in the Android keystore, no logging, no
  analytics or ad SDKs.

## The screenshot checklist, for MovenRun

| Topic | State |
|---|---|
| Understand the code, test it, second review | Every finding above traced to a line and tested; backend 415/415 and API 17/17 on PostgreSQL 16, mobile 910/910 |
| Check packages, hardcoded keys | Done (above); install scripts now off (A-05) |
| Rate limiting | Present, but keyed wrongly live (A-02); per-account movement cap added (A-04) |
| Caching | Not needed for v1 scale; identity responses are `no-store` on purpose |
| Load balancing, reverse proxy, API gateway, CDN, WAF, DDoS | Render's proxy and CDN in front; one free instance by choice. Paid tiers only if traffic needs them |
| CI/CD, Docker, Kubernetes, IaC | GitHub Actions checks; Render Blueprint is the infrastructure as code. Containers and Kubernetes are not needed |
| Timeouts, retries, backoff, circuit breaking | Provider and DB calls time out at 10 s; client waits 90 s for a cold start; failed provider deletions retry; the app queues movement retries |
| Idempotency | Movement keyed by (user, session id) in the database; refresh rotation is compare-and-set |
| Race conditions, locking | Advisory lock in the hook; conditional updates for nonces and codes; sweep re-reads before deleting |
| Queues, pub/sub, sagas, dead letters | Not used in the v1 API (BullMQ is legacy and excluded from the build) |
| Cron jobs | Wake-safe maintenance (`maintenance.ts`) instead of timers |
| Indexing, N+1, pooling | Indexes on the hot keys; session pooler; no N+1 found. A-13 removed a write per request |
| Read replicas, sharding, partitioning | Not needed at 1,000 accounts |
| Health checks, liveness, readiness | `/health` and `/ready` (probes migrated columns) |
| Monitoring, logging, alerting, SLOs | Manual checks in `POST_LAUNCH_MONITORING.md`; logs carry counts only. Add a free uptime alert on `/ready` (every 30 min; it must not keep the host awake all day) |
| Secrets management, IAM | Dashboard-only secrets; A-01, A-05, A-15 |
| OAuth, JWT rotation | PKCE; JWKS rotation handled; legacy secret revoke pending (A-01); own pepper rotation (A-16) |
| TLS, encryption at rest and in transit | HTTPS only; database over `verify-full`; Supabase encrypts at rest |
| CORS, CSRF, SQLi, XSS, SSRF | Sound (above). CSRF does not apply to bearer tokens. No user-controlled outbound URLs, so no SSRF path |
| Migrations, schema versioning | Drizzle migrations with pinned checksums |
| Backups, disaster recovery, failover | Free plan has none; owner-run encrypted `pg_dump` (FREE_HOSTING_READINESS). Single region by choice |
| Cold starts, serverless limits | Measured 11 s wake today; the site and app wake the API early |
| Feature flags, rollbacks, staged releases | Play staged rollout; manual deploy branch; `account_capacity` is the release switch |

## Speed and smoothness

- Render builds install about a tenth of the packages (A-06).
- One database write less per authenticated request (A-13).
- `/ready` runs 13 small queries per health check. Caching a good result for
  10 s would cut database load without hiding an outage for long.
- The 11 s wake is the free host. Render's paid instance ($7/month) removes it;
  that is a spending decision for later.

UI ideas only (the app is frozen): show "MovenRun is waking up" with progress
during a cold start, explain the daily session limit if anyone reaches it, and
show the wallet sign-in domain (`movenrun.xyz`) on the sign-in page so people
can compare it with what their wallet shows.

## Tests on this branch

- Backend 415 pass / 0 fail on PostgreSQL 16 (4 new), API 17 pass / 0 fail
  (body limits on the compiled server), typecheck clean.
- Mobile 910 pass / 0 fail with install scripts off.
- API suite also passes on the focused (Render-style) install.
- Contracts compile was not run here (the compiler download is blocked in this
  workspace); CI runs it on the PR.
