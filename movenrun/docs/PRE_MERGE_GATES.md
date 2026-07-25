# Pre-Merge Gates — Real Map & Territory Capture

Branch: `review/pre-merge-audit` · Base: `main`
Originally audited at commit: `78f11db61b13662951ddb45fb9f0373fbc33f619`
Defect fixes D1–D5 applied at: `78d3340`, `450e0f5`, `3c2cdb5`, `901719e`, `48237d5`

## Status: **NOT READY TO MERGE**

**This feature must not be merged until every BLOCKER below is complete.**

The five functional defects found by audit (D1–D5) are now **fixed and covered
by automated tests**. What has *not* happened is **physical-device validation** —
no build has been installed on any handset, and the native half of every fix
(Redis between two real processes, the OS permission dialog, the GPS radio, the
launcher icon, the launch screen) is unverified. Several process, privacy and
rollout gates also remain open.

---

## Legend

| Mark | Meaning |
|---|---|
| ☐ | Not done |
| ☑ | Done, with evidence linked |
| **B** | BLOCKER — merge is forbidden until complete |
| **H** | High — must be resolved or explicitly waived in writing |
| **M** | Medium — may be deferred with a tracked follow-up issue |

---

## 1. Process gates

| | Gate | Sev | Evidence |
|---|---|---|---|
| ☐ | Draft PR opened from `claude/new-session-oi4cnk` and reviewed by a human | **B** | |
| ☑ | Contracts diff against `origin/main` is **empty** | **B** | `git diff origin/main...HEAD -- movenrun/contracts` → no output (verified) |
| ☐ | No merge, rebase, squash or force-push performed on `main` | **B** | Branch left untouched by this audit |
| ☐ | Rollout **and rollback** plan documented and approved | **B** | See §7 |

## 2. Automated verification

| | Gate | Sev | Evidence |
|---|---|---|---|
| ☑ | `yarn install --immutable` passes | **B** | exit 0 |
| ☑ | Backend TypeScript check passes | **B** | exit 0 |
| ☑ | Mobile TypeScript check passes | **B** | exit 0 |
| ☑ | Backend tests pass | **B** | 583/583, exit 0 (with a live Redis; 579/583 + 4 skipped without one) |
| ☑ | Mobile tests pass | **B** | 353/353, exit 0 |
| ☑ | Workspace lint passes | **B** | exit 0 |
| ☐ | **Contract verification passes** | **B** | ✗ **Could not run** — `binaries.soliditylang.org` blocked (HTTP 403 via proxy), Hardhat `HH502`. Must be run in a network-enabled CI job before merge. |
| ☐ | `node scripts/verify-package-manager.mjs` passes in CI | **H** | ✗ Still exit 1 in this sandbox only, because Corepack had to source Yarn from the npm registry (`repo.yarnpkg.com` is proxy-blocked), yielding `4.9.1-git.20250411.hash-1908ee79f` against an expected `4.9.1`. Environmental, not a code change. Must be confirmed green in real CI. |
| ☐ | `yarn build` (workspace) passes | **M** | ✗ Fails at `@movenrun/shared` — that package has **no `tsconfig.json`**. Pre-existing on `main` (where the script failed even earlier, with a Yarn 1 syntax error). Not a regression; fix or remove the script. |

## 3. Correctness defects found by audit

All five are fixed in code. **Each still needs its device test** (§5) before the
row can be considered closed for release — an automated test cannot exercise a
permission dialog, a GPS radio, or two processes on real infrastructure.

| | Gate | Sev | Evidence |
|---|---|---|---|
| ☑ | **D1** — Realtime events actually reach subscribers | **B** | Fixed in `901719e`. The worker publishes committed ownership changes to the Redis channel `movenrun:territory:v1`; every API process subscribes on a **dedicated** connection and fans out to its own SSE subscribers (`territory/realtimeBridge.ts`). 22 offline tests + **4 integration tests over a real Redis with separate publisher and subscriber ioredis connections** (all pass; skipped loudly, never silently, when no Redis is reachable) + 5 router-level stream tests. Also adds the heartbeat timer, a per-caller connection cap, idempotent disconnect cleanup, a versioned envelope, and an explicit `resync` reconnect contract. **Device test A-13/I-13 outstanding.** |
| ☑ | **D2** — A runner's own territory renders as theirs | **B** | Fixed in `3c2cdb5`. Identity now comes from the caller's **verified session** only (`territory/http/viewer.ts`): bearer token → `sessions.verifyAccess` → `walletLink.listWallets`. The spoofable `x-movenrun-address` header is gone, and the mobile client sends its existing session. An unauthenticated caller gets the new `claimed` label rather than `rival`. 19 backend + 11 mobile tests, including four spoof routes and two source-level guards. **Device test A-14/I-14 outstanding.** |
| ☑ | **D3** — Owned territory is visible at all legal zoom levels | **B** | Fixed in `450e0f5`. The response limit now falls on **matched territories**, never on candidate H3 cells; persisted-cell lookup is chunked. 15 regression tests, including the exact failing case (an owned cell at candidate index 5 000 in a 9 838-candidate viewport is returned). **Device test A-15 outstanding.** |
| ☑ | **D4** — "Recentre on my location" recentres on the user | **H** | Fixed in `48237d5`. Recentre asks the device for a fix (`lib/territory/deviceLocation.ts`), a map gesture drops follow, pressing again restores it, and the accessibility label is derived from the state so it can no longer over-promise. Permission-refused / services-off / no-fix are three distinct messages. 25 tests. **Device test A-16/I-16 outstanding.** |
| ☑ | **D5** — Retrying a BullMQ job cannot award territory twice | **B** | Fixed in `78d3340`. `(route_id, grid_version)` is a UNIQUE idempotency key; the claim, the ownership writes and the completion all happen in **one** transaction, so a retry after completion replays the stored result, a retry after rollback is safely re-runnable, and concurrent retries serialise on the row lock. 13 regression tests, including the original three-replay case (defence stays 10, one event written). **Device test A-11 outstanding — re-queue a completed job on real infrastructure.** |

## 4. Database gates

| | Gate | Sev | Evidence |
|---|---|---|---|
| ☑ | Migrations `0000`–`0004` apply cleanly to a **fresh disposable** PostgreSQL 16 | **B** | All five exit 0 (re-verified after the D5 fix) |
| ☑ | Migration `0004` applies to a database already at `0003` | **B** | Applied to a DB stopped at `0003`, exit 0. `0004` is **additive only** — one new table, no ALTER of any existing table |
| ☑ | Migration `0004` is safely re-appliable (redeploy safety) | **B** | Re-applied on top of itself, exit 0 — `IF NOT EXISTS` on the table and both indexes |
| ☑ | Migration `0003` is safely re-appliable (redeploy safety) | **B** | Re-applied on top of itself, exit 0 — all statements use `IF NOT EXISTS` |
| ☑ | The idempotency key is enforced by the database, not just by code | **B** | Duplicate `(route_id, grid_version)` rejected by `territory_route_applications_key`; a different `grid_version` correctly accepted as a separate application |
| ☑ | An idempotency row cannot be left in a lying state | **B** | `attempts = 0`, `grid_version = 0`, an unknown `state`, and a `completed` row with no `result` are all rejected by CHECK constraints |
| ☑ | `(h3_cell_id, grid_version)` uniqueness enforced | **B** | Duplicate insert rejected by `territories_cell_grid_unique` |
| ☑ | Owned/neutral owner consistency enforced | **B** | Both bad directions rejected by `territories_owner_matches_state` |
| ☑ | Ineligible capture session cannot claim cells | **B** | Rejected by `territory_capture_sessions_ineligible_captures_nothing` |
| ☑ | One capture session per route | **B** | Rejected by `territory_capture_sessions_route_unique` |
| ☑ | Simultaneous capture yields exactly one owner | **B** | Two concurrent Postgres transactions on one new cell: 1 winner, 1 conflict, 1 row, `version=1` |
| ☐ | Migration rehearsed against a **restored copy of production** | **B** | Not done. Never run against production itself. |
| ☐ | Decision recorded: `territory_route_applications` is never pruned | **M** | The ledger grows by one row per processed route, forever. Rows are tiny (no coordinates — cell ids and counts only), but a retention policy should be chosen deliberately rather than by default. |
| ☐ | Decision recorded: territory tables have **no foreign keys** | **M** | Pre-existing tables use 5 FKs; the 5 new tables use 0. `route_id` / `owner_user_id` have no referential integrity. |
| ☐ | Decision recorded: `contested` with a NULL owner is accepted | **M** | The third branch of `territories_owner_matches_state` permits it; a contested cell should logically always have an incumbent. |
| ☐ | Dead constraint removed or made reachable | **M** | `territories_state_valid` is unreachable — `territories_owner_matches_state` rejects every invalid state first. |

## 5. Build and device gates

*None of these can be satisfied by automated audit. See `PRE_MERGE_DEVICE_TEST_PLAN.md`.*

| | Gate | Sev | Test ID |
|---|---|---|---|
| ☐ | Android development build installs and launches | **B** | A-1 |
| ☐ | iOS development build installs and launches | **B** | I-1 |
| ☐ | MapLibre loads a **production-intended** style on device | **B** | A-3 / I-3 |
| ☐ | Foreground run records correctly | **B** | A-7 / I-7 |
| ☐ | **Background locked-screen run** records correctly | **B** | A-7 / I-7 |
| ☐ | Pause / resume behaves correctly | **B** | A-9 / I-8 |
| ☐ | Interrupted-session restore works | **B** | A-10 / I-9 |
| ☐ | A valid real-world loop is confirmed and awarded | **B** | A-11 / I-10 |
| ☐ | An invalid open route is rejected | **B** | A-12 / I-11 |
| ☐ | A duplicate route is rejected | **B** | A-12 (extend: resubmit the same route) |
| ☐ | A restricted cell is rejected | **B** | Seed a `water` classification, then run through it |
| ☐ | Pause and Finish remain reachable at max font / small screen | **B** | A-21 / I-19 |
| ☐ | Profile ring renders correctly | **H** | A-20 / I-18 — **product decision needed**: the circle is a static decorative border, not a progress ring; there is no SVG library in the project |
| ☐ | App icon + adaptive icon render correctly | **H** | A-1 / I-1 — assets now exist, but `adaptive-icon.png` is **opaque with a baked-in `#0A0F1F` background** against a declared `#1E4D3A`, so the launcher will show a near-black tile. Artwork deliberately not regenerated in this pass. |
| ☐ | Splash transition is clean | **H** | A-2 / I-2 — **`splash-icon.png` is opaque with a baked-in near-black `#0A0F1F` background** while `splash.backgroundColor` is the cream `#F0E9DE` and `resizeMode` is `contain`, so the launch screen will most likely show a dark square on a cream field. Raised from **M** to **H**: this is the first frame every user sees. Fix is either a transparent re-cut of the raster **or** reverting `backgroundColor` — not both. |
| ☐ | Realtime reaches a second device | **B** | A-13 / I-13 — the D1 fix is proven across two Redis connections in tests; two handsets and a deployed worker are what proves it in practice. |
| ☐ | Own territory renders as `mine`, signed out renders as `Claimed` | **B** | A-14 / I-14 — the D2 fix, on a real session. |
| ☐ | Recentre, follow, and all three location failure messages | **H** | A-16 / I-16 — the D4 fix. The permission dialog is native and cannot be tested any other way. |
| ☐ | A re-queued job awards territory exactly once | **B** | A-11 — the D5 fix, on real infrastructure. |
| ☐ | All major screens visually reviewed on device | **H** | A-22 / I-20 |
| ☐ | Battery baseline recorded | **M** | A-19 / I-17 |
| ☐ | OEM background-restriction behaviour documented | **H** | A-8 |

## 6. Security and privacy gates

| | Gate | Sev | Evidence |
|---|---|---|---|
| ☑ | No map-provider secret committed | **B** | Enforced by test in `mapConfigCore.test.ts`; no token or key in the diff |
| ☑ | No public OpenStreetMap tile server used as a backend | **B** | Enforced by the same test |
| ☑ | No raw GPS in territory API responses | **B** | `views.test.ts` sweeps every response shape for coordinate keys, route ids, evidence hashes and full addresses |
| ☑ | Public history strips route ids and evidence hashes | **B** | `router.test.ts` |
| ☑ | Capture result requires auth and is scoped to the signer | **B** | `router.test.ts`: 401 unauthenticated, 403 for another wallet, identical 404 for unknown vs unprocessed |
| ☑ | No coordinate written to any log | **B** | `territoryScreenGuards.test.ts` + worker logs counts/reasons only |
| ☑ | `/v1` is behind the global rate limiter | **H** | `index.ts:27` mounts it before the `/v1` router |
| ☐ | **Unauthenticated map endpoints explicitly approved by a human** | **B** | `GET /v1/territories/map`, `/:cellId`, `/:cellId/history`, `/stream` are all public. This is a deliberate design choice (public map data, truncated owners, cell-derived geometry) but it **publishes an aggregate map of where people run** and needs a named owner's sign-off. |
| ☑ | SSE abuse limits implemented | **H** | Fixed with D1: a per-caller cap (4 concurrent streams, keyed on the verified user id, else the client IP — never a client-supplied value) on top of the global 5 000 cap; a 25 s heartbeat timer is now wired and stopped on shutdown; disconnect release is idempotent so a socket that both errors and closes cannot free a slot twice; a dead socket frees its own slot rather than locking its owner off the feed. **Still needs a human review of the chosen numbers** against expected concurrency. |
| ☑ | No coordinate crosses the realtime transport | **B** | `realtimeBridge.test.ts` — the published envelope is swept for coordinate keys, and a received payload carrying location data is dropped rather than forwarded. Checked on **both** sides of the Redis hop. |
| ☑ | Realtime cannot announce ownership the database does not hold | **B** | `bridgeAppliedCapture` publishes only after the capture transaction resolves; a rolled-back capture publishes nothing (tested). |
| ☐ | Map-endpoint CPU cost accepted or mitigated | **H** | Max legal viewport costs ~122 ms CPU generating 9 838 cells, unauthenticated. At the 300 req/min limit one client can consume ~60% of a core. |
| ☐ | Privacy review signed off | **B** | Including the retention decision (territory + event history retained indefinitely) and account-deletion behaviour (release cells, do not delete history) — documented but **not implemented** |

## 7. Rollout and rollback plan

| | Gate | Sev |
|---|---|---|
| ☐ | Migrations `0003`–`0004` applied to staging and rehearsed against a production restore | **B** |
| ☐ | Rollback documented: `0003` and `0004` are **additive only** — dropping the six new tables restores the prior schema, and no existing table is altered | **B** |
| ☐ | Redis is reachable from **both** the API and the worker in the target environment | **B** |
| ☐ | Decision recorded: with Redis down, the live feed is silent but territory stays correct over HTTP | **H** |
| ☐ | Feature-flag or staged-rollout decision recorded for `/v1/territories/*` | **H** |
| ☐ | Worker deployment order decided (worker must run, or routes stay `SUBMITTED` and no territory is ever awarded) | **B** |
| ☐ | Tile-provider quota and billing alert configured | **H** |
| ☐ | Monitoring for `territoryError` and `capture session not recorded` worker log lines | **H** |

---

## What remains

Defect fixes D1–D5 are done, in the recommended order, and SSE abuse limits went
in alongside D1. What is left before this can be considered for merge:

1. **Physical-device validation.** Nothing in §5 has been performed. This is the
   single largest outstanding item and no automated result substitutes for it.
2. **Splash / adaptive-icon rasters.** Both carry a baked-in near-black
   background against light declared colours. A design decision, deliberately
   not made in this pass — see A-1 / A-2.
3. Human sign-off on the **unauthenticated map endpoints** (§6) and the
   **privacy review**, including retention and account deletion.
4. **Map-endpoint CPU cost** — still ~122 ms for the widest legal viewport,
   unauthenticated. Accept or mitigate.
5. **Review the SSE cap numbers** (4 per caller, 5 000 per process, 25 s
   heartbeat) against expected concurrency.
6. Contract verification and `verify-package-manager` confirmed green in real
   CI (both blocked by this sandbox's network policy, not by the code).
7. Rollout / rollback plan, including Redis reachability from both processes.
8. Profile-ring product decision.
9. FK / `contested`-owner / dead-constraint schema decisions, plus a retention
   decision for `territory_route_applications`.
10. `yarn build` script and the `shared` tsconfig gap.

---

## Sign-off

Merge is permitted only when every **B** row above is ☑ **and** the device test
plan is complete with evidence attached.

| Role | Name | Date | Signature |
|---|---|---|---|
| Engineering reviewer | | | |
| Privacy reviewer (unauthenticated endpoints) | | | |
| Product owner (Profile ring, icon assets) | | | |
| Release manager (rollout/rollback) | | | |
