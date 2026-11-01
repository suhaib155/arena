# X-24 deploy candidate (prepared 17 Oct 2026, NOT deployed)

X-24 is the owner's approval to move `deploy/render-free-staging` and deploy.
Nothing here is approved yet. This page replaces the earlier X-24 proposal
(f6ce3c5 alone): the candidate below contains f6ce3c5 and everything reviewed
since.

## The candidate

| | |
|---|---|
| Live today | `dd8306588667342fab2db0ebd4d55632acadb57a` (X-06, E-41) |
| Candidate | `security/deep-audit-hardening` (draft #111) at `7f4c0d428c24763f9cacca616d7233cf3dba9ff4`; its code is `5b4170caacf9c717a8ed881ddc94f76996e506e4` (the head adds one docs commit). The branch is held at that head so the reviewed SHA stays valid |
| Relation | fast-forward: `dd83065` is an ancestor, so the deploy branch moves forward with no merge |
| Migrations | none new: still `0000`–`0009`, checksums unchanged. Rollback needs no database step |
| Not included | single-use Google exchange (A-10, own draft PR, adds migration `0010`); website CSP (W1 side, ships with X-21) |

What it changes on the live API:

- **F-17 / F-18** (`f6ce3c5`): device list fix, expired sessions cleaned up.
- **#110**: refuses legacy Supabase API keys and HS256 tokens unless a legacy
  secret is configured (it is not: removed 16 Oct), and logs the token trust
  mode at start.
- **#111**: rate limits keyed on the visitor (`TRUST_PROXY=render-cloudflare`),
  30 new movement sessions per account per day enforced atomically, 32 KB
  sign-in bodies, last-use written once a minute, patched `proxy-addr`, `qs`,
  `ip-address`, focused install with no third-party install scripts.

## Settings the deploy needs (names only)

| Setting | Value | Where |
|---|---|---|
| `TRUST_PROXY` | `render-cloudflare` | New. In `render.yaml`; if the service is not synced from the Blueprint, add it in Render → Environment |
| Build command | `corepack enable && yarn workspaces focus @movenrun/backend && yarn workspace @movenrun/backend build` | `render.yaml`; same note as above |
| `TRUST_PROXY_HOPS` | `1` | Unchanged; ignored while `TRUST_PROXY` is set, used again on rollback |
| `SUPABASE_LEGACY_JWT_SECRET` | must stay absent | Removed 16 Oct (E-45) |

No secret changes. No secret value is needed to deploy.

## Preflight (read only, immediately before the deploy)

Stop if any line does not hold.

1. `security/deep-audit-hardening` is still at `7f4c0d4`, and
   `git diff 5b4170c 7f4c0d4 -- movenrun/backend movenrun/shared render.yaml`
   is empty. CI is green on that commit.
2. The target has no migration after `0009`:
   `git ls-tree 7f4c0d4 movenrun/backend/drizzle/` lists `0000`–`0009` only,
   and `CHECKSUMS.sha256` matches `dd83065` for every line. Migration `0010`
   (#112) must never reach the deploy branch with this deploy: the start
   command migrates on boot.
3. Render → `movenrun-staging-api`: note the current deploy ID (`dd83065`) and
   that Rollback lists it. Render Free keeps only the two most recent earlier
   deploys, so this deploy should be the only one in between.
4. Render → Settings: auto-deploy is off; the build command is the one below.
   Render → Environment, **names only**: `TRUST_PROXY` (add it if missing:
   Blueprint edits do not reach a service that is not synced from the
   Blueprint), `TRUST_PROXY_HOPS` kept as the fallback,
   `SUPABASE_LEGACY_JWT_SECRET` absent, the `sb_` publishable and secret key
   variables present. No value is read, copied or shown.
5. No card is added, no paid instance or keep-alive is turned on.

## Steps (only after the owner approves X-24)

1. Fast-forward `deploy/render-free-staging` to `7f4c0d4`; no merge to `main`
   or the release branch.
2. Render → `movenrun-staging-api` → Manual Deploy → Deploy latest commit.
3. Check, read only:
   - the deploy shows the candidate SHA; `/health` 200, `/ready` 200;
   - the start log reads `Supabase tokens: …` and
     `proxies: trusted by network (Cloudflare, private)`;
   - `node scripts/check-client-ip.mjs https://movenrun-staging-api.onrender.com 12 --write`
     prints PASS for both limits (one bucket, forged `X-Forwarded-For` and
     `Forwarded` ignored). From a second network (a phone off Wi-Fi), the
     first `/health` shows close to the full 300 while the first run's bucket
     is lower: different people, different buckets;
   - forged HS256, unknown-kid and `alg: none` tokens get 401 (as in E-45);
   - CORS preflight from `https://movenrun.xyz` allowed;
   - the log since the deploy shows no errors and no secret value.
   No test account is created: real sign-in waits for X-05.
4. Record what was seen (SHA, deploy ID, outputs) in the evidence register.
   Results that were not seen are not recorded.

## Rollback

Render → the service → Rollback to the previous deploy (dd83065), or move the
deploy branch back to `dd83065` and deploy. No migration ran, so the database
needs nothing. If only the client-address check fails, remove `TRUST_PROXY`
in Render → Environment instead: the API goes back to `TRUST_PROXY_HOPS=1`.
After any rollback, check `/health`, `/ready` and the start log again, and
review the environment names and build command: a rollback restores the code,
not the settings, so `TRUST_PROXY` stays set unless removed (the old code
ignores it).

## Known limits

- `yarn workspaces focus` does not enforce the lockfile the way
  `yarn install --immutable` does. CI runs the immutable install on every
  commit, and Render builds only reviewed commits.
- Cloudflare's address list is copied from cloudflare.com/ips (17 Oct).
  If it changes, the API keys on a Cloudflare edge address: shared buckets,
  never a client-chosen one.
