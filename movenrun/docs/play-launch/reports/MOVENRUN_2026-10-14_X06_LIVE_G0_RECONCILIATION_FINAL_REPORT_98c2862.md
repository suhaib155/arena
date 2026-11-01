# MovenRun: X-06 live, G0 started, records reconciled

**Date:** 14 Oct 2026
**Covers:** the owner's 05:22 execution-sequence reconciliation and the reconciliation memo
**Code commit:** 98c2862 (G0, `feat/g0-economy-v3`, draft #109)
**Board:** [`../../product-roadmap/PR_QUEUE.md`](../../product-roadmap/PR_QUEUE.md)

## 1. Status

- **RELEASE_GATE_STOP:** the live sequence now waits on **X-07** (hook), then X-05 (providers), then X-21 (website). Each needs its own approval. X-24 (move the deploy branch) and X-25 (retention) are also undecided.
- **ENGINEERING_CONTINUES:** G0 is in review (#109). G2 can start once the owner answers D2 (shade shape) and D5 (zone and cell size).

## 2. X-06 proof (LIVE VERIFIED, E-41)

| Field | Value |
|---|---|
| Service | `movenrun-staging-api`, srv-db7a49dg1s2s739nleog, Free plan, Virginia, auto-deploy off |
| Branch and root | `deploy/render-free-staging`, `movenrun` |
| Live deploy | dep-db7a7o2vcj2c73crsemg, commit dd8306588667342fab2db0ebd4d55632acadb57a (the approved commit) |
| Earlier deploy | dep-db7a49tg1s2s739nlga0 failed: drizzle-kit ENOENT opening a file named in the database settings (cause inferred, not confirmed) |
| Start log | Migrations applied; API listening |
| `/health` | 200 `{"status":"ok"}` (cold start about 52 s) |
| `/ready` | 200, database ready, sign-in supabase |
| TLS headers | HSTS, CSP, nosniff, X-Frame-Options |
| Migrations | 10 rows in `drizzle.__drizzle_migrations`; hashes equal sha256 of 0000–0009 at dd83065. Not replayed separately |
| RLS | On for all 19 public tables, no policies (deny-all to anon and authenticated) |
| Data API | PostgREST exposes no schema |
| Users | `auth.users` 0; hook and providers not attached |

No secret was recorded.

## 3. PR and branch status (live refs, 14 Oct)

| Branch | Head | PR | Base | State |
|---|---|---|---|---|
| `main` | d344c3b | — | — | Untouched |
| `release/android-v1-cxfdbd` | 991ac6a | — | — | Unmerged |
| `deploy/render-free-staging` | dd83065 | — | — | Pinned; X-24 not approved |
| `chore/post-security-launch-prep` | 61c9386 (+ this report) | #106 draft | release | CI was green at 84fa0cf |
| `feat/g0-economy-v3` | e2ae062 | #109 draft | chore | New |
| `feat/g1-territory-geometry` | 635ad7f | #107 draft | chore | Synced by merge |
| `web/w1-review-preview` | bd7fff2 | #108 draft | chore | Synced by merge |

Dependencies: G0 and G1 before G2; G2 before G3 and G4. All syncs were merges; no history was rewritten.

## 4. Work done

| Packet | Result | Evidence |
|---|---|---|
| L1 (X-06) | Live verified | E-41 |
| G0 | `docs/GAME_ECONOMY_V3.md` from the V3 PDF (rev 2): every rule tagged SOURCE / ASSUMPTION (A1–A8) / DECISION NEEDED (D1–D13); invariants, chain boundary, threat model, build truth table | #109 |
| G0 code | `@movenrun/shared/economy-v3`: effort, consistency, pool split, trust weight, ceilings, per-session toll, recharge, upkeep, 60% cap, the reconciler's book check. Mints nothing, not wired | E-42: 23 tests reproduce the source's worked numbers (Meera among 40,000 players, Dan, toll and upkeep tables, 400M over about 180 seasons) and 300 seeded random days |
| G1 | Inferred cells recorded as analytic only; `covered` distinct from `held`; open checks before G2 (gap versus time, jump verdict, timestamps, private exposure) | 635ad7f; shared 170/170 |
| W1 | e2e 23/23 rerun on bd7fff2's parent 27b1e91 with the environment recorded; truthfulness blockers listed with source lines; year-free copyright option | PR_QUEUE § W1 blockers |
| X-25 | Marked UNDECIDED, with a retention matrix proposal | PR_QUEUE § X-25 |

## 5. Evidence levels

| Item | Code tested locally | Live verified | Device verified | Public approved |
|---|---|---|---|---|
| Staging backend (X-06) | Yes | **Yes (E-41)** | n/a | n/a |
| G0 reference model | Yes (E-42) | No | n/a | n/a |
| G1 regions and route cells | Yes | No | No | n/a |
| W1 website | Yes | Vercel preview only | No | **No (X-21)** |
| Sign-in (Google, wallet) | Yes | No (X-07, X-05) | No | n/a |

## 6. Security concerns

1. **Legacy JWT secret seen through the connector.** A read-only PostgREST config call returned the project's legacy JWT secret in its output. It is not written in the repository or the thread, but it passed through the connector's logs. Anyone holding it could sign tokens the project accepts. Proposed **X-26**: rotate it to JWT signing keys. The backend verifies tokens by JWKS and uses the legacy secret only if `SUPABASE_LEGACY_JWT_SECRET` is set, which the operator guide does not set. Confirm that in Render first.
2. **W1 present-tense claims.** Pages state on-device preview rules as working game rules (PR_QUEUE § W1 blockers). The 30-day deletion line stays BLOCKED_OWNER_PROOF: email From or Reply-To is not strong identity proof, and wallet-only accounts cannot be confirmed by email.
3. **Interpolated ground.** Must never claim, defend, toll or count deed traffic until G2 settles the open checks.
4. **Older-design constants.** `shared/src/constants/emission.ts` and the Base Sepolia contracts follow an earlier design. V3 code does not import them.

## 7. What was deliberately NOT changed (mobile/website/live resources)

- **Mobile:** nothing under `movenrun/mobile/` (frontend hold).
- **Website live:** movenrun.xyz, DNS and Vercel production are untouched. The W1 copy fixes are listed but not made, pending the owner's review.
- **Live resources:**
  - Render, Supabase and the connector were used read-only.
  - The Supabase hook and providers were not touched.
  - No migration was replayed.
  - No setting was changed (the JWT secret was not rotated).
  - The other Supabase project was never touched.
  - No contract change, no onchain transaction and no spending.
- **Git:**
  - `deploy/render-free-staging` is still at dd83065.
  - `main` is untouched.
  - No merge into main, no force-push, no PR closed.
- **Data:** nothing deleted (X-25 undecided).

## 8. Branches pushed

- `chore/post-security-launch-prep`: the ledgers (61c9386) and this report.
- `feat/g0-economy-v3`: 98c2862, then the merge e2ae062 (draft #109).
- `feat/g1-territory-geometry`: the merge 561f46e, then 635ad7f.
- `web/w1-review-preview`: the merge 27b1e91, then bd7fff2.

## 9. Next owner actions

1. **X-07:** approve attaching the before-user-created hook. I then run the read-only checks and the quota proof (set to 0, one refused sign-in, restored to 50).
2. **G0 decisions:** D5 (what a zone is, and the cell size) and D2 (the shade shape metric) unblock G2. The other decisions can follow. X-26 (rotate the legacy JWT secret) is also recommended.
