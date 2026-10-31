# MovenRun milestone report: X-21 live, X-05 ready, 0011 storage (18 Oct 2026)

Code commit described: `1541a01` (newest code commit, #124). Evidence E-79 to E-85.

## A. Status table

| Feature | Prior state | New state | Evidence | Owner gate |
|---|---|---|---|---|
| Website (X-21) | Release 61d30bb staged; live site without the four pages or headers | **Live, verified** on movenrun.xyz; www redirects to the apex | E-79 (live HTTP) | Done (owner promoted) |
| Sign-in providers (X-05) | Blocked on X-21 | **Ready for the owner**: automated preflight passes; nothing enabled | E-85 (SQL aggregates, live HTTP) | Owner dashboard steps |
| G3/G4 server holdings | #121 draft | #121 at 685852b with rule sets 1001/1002, day pinning, fail closed | E-80 (local tests, CI) | 0011 and flag stay owner-only |
| 0011 storage | Not measured | #124 at 1541a01: measured; 0011 as written does not fit Free past about 200 res10 players for one season | E-84 (local PostgreSQL 16 bench) | Retention and ledger shape decisions |
| G2 route farming | Not studied | #123 at 8ed1054: study done | E-81 (synthetic simulation) | Rule decisions |
| Android / Play readiness | #115 at 3c8d2f8 | #115 at 1c3caab: manifest test, data-safety inventory, EAS plan | E-82 (local tests, CI) | Build commit choice, X-08 |
| G5-G7 contract research | #122 at 560d3bc | #122 at 76ecf4e: issue ledger with proofs | E-83 (local Hardhat) | G5-1 to G5-12 |

## B. What changed

| PR | Branch | Head | Base | Content |
|---|---|---|---|---|
| #121 | feat/g34-server-holdings | 685852b | #120 (with #112 and #123 merged in) | `rules.ts` registry (1001 default, 1002 optional), `policy.ts`, `service.ts` day pinning and lock order; 0011 adds gameplay_day_rules, gameplay_walker_days, gameplay_unit_challenges (RLS on, no grants), deferred take-budget trigger; `G34_SERVER_ARCHITECTURE.md` §15 |
| #124 | feat/g34-storage-capacity | 1541a01 | #121 (685852b merged) | `backend/scripts/gameplay-storage-bench.ts`, `backend/src/gameplay/capacity.ts` and test, `docs/G34_STORAGE_CAPACITY.md`, `bench:gameplay-storage` script. 0011 not edited |
| #123 | feat/sim-churn-study | 8ed1054 | — | `shared/src/sim/routeCredit.ts`, `routeFarmingStudy.ts`, test, `docs/SIM_ROUTE_FARMING_STUDY.md`, `sim --route-farming` |
| #115 | privacy/a2-android-backup-off | 1c3caab | — | `mobile/src/lib/__tests__/androidPrebuildManifest.test.ts`; DATA_INVENTORY, PLAY_CONSOLE_WORKSHEET, X04_PREVIEW_BUILD_RUNBOOK |
| #122 | research/g5-g7-economy | 76ecf4e | — | `docs/G5_CONTRACT_ISSUE_LEDGER.md`, `shared/contract-proofs/g5-ledger/*`, `shared/src/sim/contractLedger.ts` and test |
| board | security/a10-single-use-google-exchange | this commit | — | EVIDENCE_REGISTER E-79 to E-85, EXTERNAL_ACTIONS X-21 and X-05, PR_QUEUE rows, EXECUTION_STATUS checkpoint, this report |

## C. Verification

- #121: backend 476/476, gameplay 49/49 over 4 runs, api 21/21, shared 247 + 1 skipped; 30 parallel takes give 13 taken and 17 refused (budget 13). CI suite completed.
- #124: backend 363/363 against local PostgreSQL 16 (13 new capacity tests, both 0011 suites), typecheck clean, shared 247 pass. CI was still running when this report was written.
- #123: shared 257 + 1 skipped; tsc clean. #115: mobile 931/931; CI completed. #122: Hardhat 18/18, shared 250/250; CI completed.
- Live website (E-79): apex 200 for /, /privacy/, /sign-in/, /account-deletion/, /support/, /docs/, /docs/roadmap/; www 308 to the apex with the path kept; /.env, /.git/config, /vercel.json, /package.json 404. Canonical tags on the apex; every same-site asset 200; no inline scripts or style attributes.
- API CORS preflight: from the apex 204 with `access-control-allow-origin: https://movenrun.xyz`; from www and an untrusted origin 404 with no CORS header.
- Supabase (read only, E-85): 0 auth users, 0 app users, account_capacity 1000 and 50 per hour, 20 public tables, 0 without RLS, 0 gameplay tables; hook EXECUTE: supabase_auth_admin true, anon false, authenticated false.
- Render: live dep-db9m51qjnfac73cqh6eg (2192de6), no newer deploy; /health and /ready 200.
- Device proof: none. Sign-in has not been run end to end; the providers are off.

## D. Security and privacy

- Live CSP: `default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'` + staging API + the Supabase project; `frame-src 'none'; worker-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests`. HSTS 2 years, X-Frame-Options DENY, nosniff, no-referrer, Permissions-Policy.
- Live text: no dates, no response promises. The one "30 days" is retention of the used-Google-sign-in record (no email or account id).
- Android: allowBackup false, dataExtractionRules, cleartext off, only MainActivity exported; the `movenrun://` scheme remains the F-06 residual.
- Storage abuse (E-84): one abusive account can write about 5 MiB a day today; a per-walker daily unit budget of 300 caps it at about 0.15 MiB. Tripwire model (warn 60%, backpressure 75%, hard stop 85%) fails closed; not wired.
- Residual: A6 lets spoofers keep 1.44x at the launch pool (E-81). Contract issues H1-H3 and N1 remain unfixed on feat/v3-onchain-core (E-83).
- No secret, token, address list, coordinate or database URL was read or written. No `reveal` call; no auth configuration dump.

## E. Live action log

| Time (UTC) | Provider | Target | Old | New | Authorization | Result | Rollback |
|---|---|---|---|---|---|---|---|
| 18 Oct 09:19:07 | Vercel | movenrun-website production | dpl_1pNg2cyGZ4MLWuqfsSHBtU9P1KBf (main d344c3b) | dpl_ABCfgjsFiJ4DHtRnrLPCc8npLAuD (promote of dpl_B78x3Xc9ySbs2Jzpy8mkE7pPpAxi, 61d30bb) | Owner, in the dashboard (the API promote from this workspace was refused and not retried another way) | Live, verified (E-79) | Promote dpl_1pNg2cyGZ4MLWuqfsSHBtU9P1KBf |

No other live change. Render, Supabase and DNS untouched.

## F. Game economy

- SOURCE: owner V3 PDF rev 2 (unchanged).
- Hypotheses on #121: rule set 1002 (two-day challenge, 3-day window, 13-take budget, res10 units in res9 zones), opt-in by setting; 1001 stays the default.
- Simulation (synthetic, with attrition assumptions; not measured retention): per-account repeat-route rule penalises 65% of honest accounts; linked-identical-as-one (0.8) cuts colluders from 4.75x to 1.74x and costs real households 33%. The earlier 81% figure is synthetic with attrition assumptions.
- Open D items touched: D1 (midnight straddle completes a challenge in 30 minutes), D5 (mixed-holder zones; `each-holder-holds-zone`), budget order (applied in unit-id order, not walk order), res8 pipeline vs 1002 (1002 refuses real sessions today).
- G5: decisions G5-5 (transferability), G5-6 (privacy), G5-2 lead; N1 added (no burn or revoke).

## G. Cost and capacity

- Vercel Hobby: 85 deployments in the 24 hours before 08:45Z against 100 a day; each branch push makes about 5. This report is one push.
- Supabase Free: 11.8 MB used of 500 MiB (owner to confirm the quota in the dashboard).
- 0011 as written, res10 (1002): about 206 players fit one season, 51 fit four. 1,000 players need 1,918 MiB for one season (384%).
- Recommended design (partitioned ledger, 14-day raw retention, per-player-day proofs): about 774 players for one season, 539 for four; 1,072 and 674 with the compact ledger. A 5,000-player pilot does not fit Free at any resolution.
- Render Free: unchanged.

## H. Blockers (owner only)

1. **X-05 dashboard steps** (only the owner holds the Google Cloud and Supabase dashboards and the client secret): create the Google Web OAuth client; in Supabase enable Google, then Ethereum wallet, one at a time; Redirect URLs exactly `movenrun://auth/callback`, `https://movenrun.xyz/sign-in/`, `https://movenrun.xyz/account-deletion/`; Email, anonymous and manual linking off; Web3 limit at the default; then the checks in `X05_PROVIDER_ENABLEMENT_PREFLIGHT.md`.
2. **0011 shape and retention** before 0011 is ever applied (E-84).
3. **Rule decisions**: rule set 1001 vs 1002, route-farming rule, A6 trust order, D1, D5.
4. **EAS build commit** (#115 base differs from release/android-v1-cxfdbd) and X-08.
5. **Data safety answers** (Maps SDK, name, wallet address, Health apps, fraud purposes).
6. **X-28**: delete `ops/two-network-check` (this workspace's delete was refused).
7. G5-1 to G5-12.

## I. What remains off

X-05 providers (off), multiplayer gameplay flag (off), migration 0011 (not applied), main merge (none), backend redeploy (none), on-chain actions (none), Play publication (no account), mobile UI (frozen, UX0), website changes beyond X-21 (none).

## J. Next independent work

1. Revise the 0011 ledger draft on #121 to the partitioned shape with bigint cells and derived event ids, then re-run the #124 bench against it.
2. Wire the storage tripwire and the per-walker daily unit budget behind the gameplay flag, tests only.
3. Fix the res8/1002 mismatch and the midnight straddle on #121, so the rule set can be judged on real sessions.
