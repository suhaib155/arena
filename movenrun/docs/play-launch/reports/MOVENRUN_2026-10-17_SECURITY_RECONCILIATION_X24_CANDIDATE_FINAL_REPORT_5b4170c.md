# MovenRun 17 Oct 2026: security reconciliation, X-24 candidate, G2 preparation

Code commit: `5b4170caacf9c717a8ed881ddc94f76996e506e4` on
`security/deep-audit-hardening` (#111). Nothing was deployed, merged,
published or rotated. No DNS, Vercel, Render or Supabase setting changed. No
secret value was read, printed or stored. Live checks were read only, from an
outside shell. The mobile app was not changed.

## Owner decisions waiting

| # | Decision | Recommendation | Where |
|---|---|---|---|
| 1 | **X-24**: deploy the #111 head | Approve: fast-forward, no migration, rollback is one click | `X24_DEPLOY_CANDIDATE.md` |
| 2 | Single-use Google exchange (#112) | Approve before X-05; adds migration 0010 | #112 |
| 3 | X-21 domain: make `movenrun.xyz` primary | Yes; sign-in fails from `www` today | `OWNER_DECISIONS_PRIVACY_REPO_DOMAIN.md` §3 |
| 4 | Android backup off | Yes; needs the mobile hold lifted for one config line | same file §1 |
| 5 | GitHub Pages off | Yes; it serves an old prototype | same file §2 |
| 6 | Repository private | Only after the five-point preflight | same file §2 |

## Reconciled with the 16 Oct X-26 closure

- PR #110's head `77a06b3` (X-26 closed, X-07 attached) is merged into #111.
  The only conflict was the report index; both rows are kept.
- **A-01 is closed.** It was a pre-remediation finding: the legacy secret was
  revoked on 16 Oct and V1–V6 passed (E-45). The 15 Oct report keeps its dated
  findings and now opens with a dated status note.
- X-07 is attached; X-07b (refusal at quota 0, then 50 restored) still waits
  for X-05 and is not claimed here.
- The tool attribution footer was removed from the #110 and #111 PR comments.

## Fixed and proven

| ID | What | Proof |
|---|---|---|
| A-04 race | 30 new movement sessions per account per day could be passed by concurrent requests that all read the same count. The count and insert are now one transaction behind a per-account advisory lock (`store.ts`); a retry of an admitted session still gets its row | E-46: 40 at once without the bound, 40 stored; with it, 30 stored, 10 refused; 5 retries of the last slot share one row (`f992304`) |
| A-02 | Rate limits keyed on a Render proxy node. `TRUST_PROXY=render-cloudflare` trusts Cloudflare's published ranges and private networks by network, so the key is the address that connected to Cloudflare. A client's own `X-Forwarded-For` or `Forwarded` is never used. The start log names the mode | E-47: tests 4/4 (one bucket across nodes and forged values, two clients, IPv6, sign-in write limit). Live today still FAILS, as expected until X-24 (`a6846fc`, `5b4170c`) |
| Check script | `scripts/check-client-ip.mjs` also probes the sign-in write limit with `--write` (4 requests), sends forged `Forwarded`, and names the failure mode | E-47 live output |
| A-09 | Strict website CSP: `script-src 'self'`, inline scripts moved to files, connections only to the site, the API and Supabase Auth (#113, on W1) | E-50: e2e 24/24 under the policy; a `script-src 'none'` run fails as it should |
| A-10 | A Google token is exchanged for one MovenRun session only, keyed by its Supabase `session_id` (#112). The app and site never retry with the same token, so normal sign-in is unchanged | E-51: compiled API, 4 concurrent replays give one 200 and three 401 |
| A-11 on W1 | W1's canonical links pointed at the deleted Vercel address too | Fixed on #113 |

## Checked and sound

- **Install scripts off**: only esbuild (allowed), keccak and secp256k1
  (contracts' hardhat only; load from prebuilds), and msgpackr-extract
  (optional native) have install scripts. EAS's `eas-build-pre-install` hook is
  run by EAS, not by Yarn. Mobile tsc clean and 910/910 (E-48).
- **Focused Render build**: 160 MB with `@movenrun/backend` and
  `@movenrun/shared`; API 21/21 on that tree (E-48). Residual: `workspaces
  focus` does not enforce the lockfile; CI's immutable install does.
- **Pinned resolutions** (qs, proxy-addr, ip-address) pass the full backend
  and API suites.

## Live state, 17 Oct (read only)

- API `dd83065` behind Cloudflare (`server: cloudflare`, `cf-ray`) and Render.
  Client-address check: global FAIL, write limit 4 of 4 in one bucket (too few
  samples to call).
- Website: apex 308 → `www`; `www` preflight gets no CORS allow, the apex does;
  the live site sends HSTS only; GitHub Pages serves the old prototype (E-49).

## Tests

| Suite | Result | Commit |
|---|---|---|
| Backend `yarn test` (PostgreSQL 16) | 419/419 | `5b4170c` |
| API `yarn test:api` | 21/21 | `5b4170c` |
| Mobile `tsc`, `yarn test` | clean, 910/910 | `5b4170c` |
| Secret scan `scripts/check-secrets.mjs` | pass | `5b4170c` |
| #112 backend, API | 420/420, 21/21 | `52bdc90bcc165359adaf85bb696a30a1071d027a` |
| #113 website e2e | 24/24 | `b20f5ed263ab2ac11e707f49de9450cdc5f5407b` |
| #114 shared | 188/188 | `e6fd9437d62f2c4d09536d2f6abd9bada69ea1ef` |

Contracts were not changed; CI covers their compile.

## Product roadmap (G0–G4)

The queue was continued, not restarted. G2's holding arithmetic (claim,
reinforce, erode, flip, decay, stages, deeds and masks) is a tested reference
model on #114, using the source's fixed numbers, with D4 as parameters and
shade strength (D2) as an input. It is not wired and stores nothing. It adds
assumption **A9**: the source's numbers let one visit flip undefended fresh
ground, which simulation should confirm. Enclosed-area geometry and the
territory ledger still wait on D2, D4 and D5. G3 and G4 follow G2.

## Gates

| Gate | State |
|---|---|
| X-26 | DONE 16 Oct |
| X-07 | DONE (attached); X-07b pending X-05 |
| X-06 | DONE (live dd83065) |
| X-24 | Candidate ready (#111), NOT approved |
| X-05, X-21, X-25 | Not approved |
| Merges, EAS builds, paid services, contracts, mobile UI | Not approved, untouched |

## Branches

| Branch | Head | PR |
|---|---|---|
| `security/deep-audit-hardening` | `5b4170c` code, then this report | #111 (on #110) |
| `security/x26-signing-keys` | `77a06b33ff6ce265f715922d11086626fdbc52e1` | #110 |
| `security/a10-single-use-google-exchange` | `52bdc90` | #112 (on #111) |
| `web/a09-strict-csp` | `b20f5ed` | #113 (on #108) |
| `feat/g2-holding-model` | `e6fd943` | #114 (on #109) |
| `deploy/render-free-staging` | `dd8306588667342fab2db0ebd4d55632acadb57a` | unchanged |
| `main`, `release/android-v1-cxfdbd` | `d344c3b`, `991ac6a` | unchanged |
