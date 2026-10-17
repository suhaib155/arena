# X-24 deploy candidate (prepared 17 Oct 2026, NOT deployed)

X-24 is the owner's approval to move `deploy/render-free-staging` and deploy.
Nothing here is approved yet. This page replaces the earlier X-24 proposal
(f6ce3c5 alone): the candidate below contains f6ce3c5 and everything reviewed
since.

## The candidate

| | |
|---|---|
| Live today | `dd8306588667342fab2db0ebd4d55632acadb57a` (X-06, E-41) |
| Candidate | the head of `security/deep-audit-hardening` (draft #111), full SHA in the 17 Oct report |
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

## Steps (only after the owner approves X-24)

1. Fast-forward `deploy/render-free-staging` to the candidate SHA.
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
   - CORS preflight from `https://movenrun.xyz` allowed.

## Rollback

Render → the service → Rollback to the previous deploy (dd83065), or move the
deploy branch back to `dd83065` and deploy. No migration ran, so the database
needs nothing. If only the client-address check fails, remove `TRUST_PROXY`
in Render → Environment instead: the API goes back to `TRUST_PROXY_HOPS=1`.

## Known limits

- `yarn workspaces focus` does not enforce the lockfile the way
  `yarn install --immutable` does. CI runs the immutable install on every
  commit, and Render builds only reviewed commits.
- Cloudflare's address list is copied from cloudflare.com/ips (17 Oct).
  If it changes, the API keys on a Cloudflare edge address: shared buckets,
  never a client-chosen one.
