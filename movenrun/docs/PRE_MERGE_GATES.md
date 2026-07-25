# Pre-Merge Gates — Real Map & Territory Capture

Branch: `claude/new-session-oi4cnk` · Base: `main`
Audited at commit: `78f11db61b13662951ddb45fb9f0373fbc33f619`

## Status: **NOT READY TO MERGE**

**This feature must not be merged until every BLOCKER below is complete.**
Four functional defects were found by audit and are unfixed; physical-device
validation has not been performed at all.

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
| ☑ | Backend tests pass | **B** | 505/505, exit 0 |
| ☑ | Mobile tests pass | **B** | 292/292, exit 0 |
| ☑ | Workspace lint passes | **B** | exit 0 |
| ☐ | **Contract verification passes** | **B** | ✗ **Could not run** — `binaries.soliditylang.org` blocked (HTTP 403 via proxy), Hardhat `HH502`. Must be run in a network-enabled CI job before merge. |
| ☐ | `node scripts/verify-package-manager.mjs` passes in CI | **H** | ✗ Fails in the audit sandbox only, because Corepack had to source Yarn from the npm registry (`repo.yarnpkg.com` is proxy-blocked), yielding `4.9.1-git.…`. Must be confirmed green in real CI. |
| ☐ | `yarn build` (workspace) passes | **M** | ✗ Fails at `@movenrun/shared` — that package has **no `tsconfig.json`**. Pre-existing on `main` (where the script failed even earlier, with a Yarn 1 syntax error). Not a regression; fix or remove the script. |

## 3. Correctness defects found by audit — all must be fixed

| | Gate | Sev | Evidence |
|---|---|---|---|
| ☐ | **D1** — Realtime events actually reach subscribers | **B** | Broadcaster is a module singleton in the **worker** process (`gps.worker.ts:122`); SSE subscribers register in the **API** process (`http/router.ts:140`). Separate processes, no Redis bridge ⇒ `/v1/territories/stream` delivers nothing, ever. |
| ☐ | **D2** — A runner's own territory renders as theirs | **B** | `territoryApi.ts:41` sends no identity header; `router.ts:77 defaultResolveViewer` therefore resolves `walletAddress: null` ⇒ every owned cell is labelled `rival`. |
| ☐ | **D3** — Owned territory is visible at all legal zoom levels | **B** | Feature cap is applied to *candidate* cells before the DB query (`router.ts`). Proven: at the max viewport, 9 838 candidates → capped to 2 000 → a genuinely owned cell at index 5 000 returns **0 features** while `meta.truncated: true`. |
| ☐ | **D4** — "Recentre on my location" recentres on the user | **H** | `live-map.tsx:175` centres on the *viewport centre* (a visual no-op) and no-ops entirely before the first fetch. `followUser` is hardcoded `false` with no toggle ⇒ no way to locate yourself. The a11y label is also inaccurate. |
| ☐ | **D5** — Retrying a BullMQ job cannot award territory twice | **B** | ✗ **Currently fails.** Proven: replaying one `routeId` three times gave defence 10 → 16 → 22, control 10 → 12 → 14, and wrote 3 ownership events (`captured, reinforced, reinforced`). Re-*capture* is prevented; extra reinforcement is not. Needs a per-route idempotency guard. |

## 4. Database gates

| | Gate | Sev | Evidence |
|---|---|---|---|
| ☑ | Migrations `0000`–`0003` apply cleanly to a **fresh disposable** PostgreSQL 16 | **B** | All four exit 0 (verified) |
| ☑ | Migration `0003` is safely re-appliable (redeploy safety) | **B** | Re-applied on top of itself, exit 0 — all statements use `IF NOT EXISTS` |
| ☑ | `(h3_cell_id, grid_version)` uniqueness enforced | **B** | Duplicate insert rejected by `territories_cell_grid_unique` |
| ☑ | Owned/neutral owner consistency enforced | **B** | Both bad directions rejected by `territories_owner_matches_state` |
| ☑ | Ineligible capture session cannot claim cells | **B** | Rejected by `territory_capture_sessions_ineligible_captures_nothing` |
| ☑ | One capture session per route | **B** | Rejected by `territory_capture_sessions_route_unique` |
| ☑ | Simultaneous capture yields exactly one owner | **B** | Two concurrent Postgres transactions on one new cell: 1 winner, 1 conflict, 1 row, `version=1` |
| ☐ | Migration rehearsed against a **restored copy of production** | **B** | Not done. Never run against production itself. |
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
| ☐ | App icon + adaptive icon render correctly | **H** | A-1 / I-1 — **no icon asset is configured at all** (pre-existing) |
| ☐ | Splash transition is clean | **M** | A-2 / I-2 — no splash image configured (pre-existing) |
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
| ☐ | SSE abuse limits reviewed | **H** | Only a global 5 000-subscriber cap; no per-IP connection limit. No heartbeat timer is wired (`heartbeat()` is never called), so idle connections will be dropped by proxies. |
| ☐ | Map-endpoint CPU cost accepted or mitigated | **H** | Max legal viewport costs ~122 ms CPU generating 9 838 cells, unauthenticated. At the 300 req/min limit one client can consume ~60% of a core. |
| ☐ | Privacy review signed off | **B** | Including the retention decision (territory + event history retained indefinitely) and account-deletion behaviour (release cells, do not delete history) — documented but **not implemented** |

## 7. Rollout and rollback plan

| | Gate | Sev |
|---|---|---|
| ☐ | Migration `0003` applied to staging and rehearsed against a production restore | **B** |
| ☐ | Rollback documented: `0003` is **additive only** — dropping the five new tables restores the prior schema, and no existing table is altered | **B** |
| ☐ | Feature-flag or staged-rollout decision recorded for `/v1/territories/*` | **H** |
| ☐ | Worker deployment order decided (worker must run, or routes stay `SUBMITTED` and no territory is ever awarded) | **B** |
| ☐ | Tile-provider quota and billing alert configured | **H** |
| ☐ | Monitoring for `territoryError` and `capture session not recorded` worker log lines | **H** |

---

## Recommended order of fixes

1. **D5** (retry idempotency) — economy correctness; smallest, most contained fix.
2. **D3** (wide-zoom invisibility) — the primary map feature is unreliable without it.
3. **D2** (own territory shows as rival) — the core "this is mine" signal is wrong.
4. **D1** (realtime not delivered) — either wire a Redis bridge or **remove the SSE endpoint and its documentation** until it works; shipping a silent endpoint is worse than shipping none.
5. **D4** (recentre control) — small, user-visible.
6. Map-endpoint CPU cost and SSE per-IP limits.
7. Icon / splash assets (pre-existing, but a release blocker).
8. Profile-ring product decision.
9. FK / `contested`-owner / dead-constraint schema decisions.
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
