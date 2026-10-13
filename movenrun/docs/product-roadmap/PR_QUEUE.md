# MovenRun product roadmap: PR queue

**The single task board for the whole product.** One row per work packet:
its branch or PR, its state, the proof, and the next action. Launch details
stay in `docs/play-launch/` (EXECUTION_STATUS, TASK_REGISTER,
EXTERNAL_ACTIONS); this board links to them rather than repeating them.

**States:**
- `DONE`
- `IN_PROGRESS`
- `IN_REVIEW` (draft PR open)
- `BLOCKED_OWNER`
- `BLOCKED_PROVIDER`
- `DEFERRED`
- `NOT_STARTED`

**Evidence levels:**
- CODE TESTED LOCALLY
- LIVE VERIFIED
- DEVICE VERIFIED
- PUBLIC APPROVED

**Rules:**
- A packet becomes a PR only when real code and tests exist.
- PRs are drafts and are never merged without the owner.
- No mobile frontend PR while the frontend hold stands. See
  [DESIGN_CONSTRAINTS.md](DESIGN_CONSTRAINTS.md).

**Updated:** 13 Oct 2026, from live GitHub refs.

## Branches (live)

| Branch | Head | Role |
|---|---|---|
| `main` | d344c3b | Untouched. Merging is the owner's (X-14) |
| `release/android-v1-cxfdbd` | 991ac6a | Play v1 integration branch, unmerged |
| `fix/play-auth-security-gate` | b4612bb | Security review rounds 1–2 (ancestor of everything below) |
| `deploy/render-free-staging` | dd83065 | The commit X-06 approved. Moves only with owner approval (X-24) |
| `chore/post-security-launch-prep` | this board | Security round 3–4, session fixes (f6ce3c5), launch ledgers |
| `feat/g1-territory-geometry` | 6257d9a | G1: map regions + covered-ground endpoint (on top of the chore branch) |
| `web/w1-review-preview` | 8c4d55b | W1: website review version (on top of the chore branch) |
| `feat/v3-onchain-core` | c8262ec | Separate prototype contracts branch. Not part of Play v1 |

## Work packets

| Packet | Scope | Branch / PR | State | Proof | Next action |
|---|---|---|---|---|---|
| **L0** | Launch integration and old-PR reconciliation | `release/android-v1-cxfdbd`; PR list below | DONE (classification) | 31 of 42 open PRs are ancestors of the release tree (`git merge-base --is-ancestor`, 13 Oct) | Owner decides whether to close the included PRs (see below) |
| **L1** | X-06 live backend and free-host reliability | `deploy/render-free-staging` dd83065 | BLOCKED_OWNER | Render connected through Composio on 13 Oct. Its workspace has no services or Blueprints yet, and the connector cannot create one | Owner creates the Blueprint service in the Render dashboard (`LIVE_SETUP_OPERATOR_GUIDE.md` X-06); then I verify the service, deploy, logs, `/health`, `/ready` and migration hashes through the connector |
| **L2** | Supabase hook, providers, live Google + wallet + deletion + cap | — | BLOCKED_OWNER | Code tested locally (E-19–E-28, hook contract on PostgreSQL) | X-07, then X-05, each with its own approval, after L1 |
| **L3** | Session retention and storage capacity | `chore/post-security-launch-prep` (f6ce3c5), draft #106 | IN_REVIEW | CODE TESTED LOCALLY: backend 409/409, API 17/17, DB size measured (E-39, E-40) | X-24 approval after L1; X-25 decision (proposal below) |
| **W1** | Responsive website review version | `web/w1-review-preview`, draft #108 | IN_REVIEW | CODE TESTED LOCALLY: 8 pages × 6 widths + 200% text/zoom clean; sign-in/deletion e2e 23/23; packet `docs/play-launch/WEBSITE_W1_REVIEW_PACKET.md` | Owner reviews; X-21 NOT approved; 30-day line waits on `ACCOUNT_DELETION_OPERATIONS.md` proof |
| **G0** | Canonical product spec (V3 economy, settlement invariants, threat model) | — | NOT_STARTED | PR #88 holds an older V3 roadmap; it is stale on deployment facts | Reconcile #88 into `docs/GAME_ECONOMY_V3.md` once the owner shares the V3 source document again (it is not in the repository) |
| **G1** | Server-authoritative spatial pipeline and map geometry contract | `feat/g1-territory-geometry`, draft #107 | IN_REVIEW | CODE TESTED LOCALLY: shared 170/170 (14 new), backend 411/411 (2 new), API 17/17, build; CI green | Review. Route cells between samples done (`route-cells`, unwired); next is wiring them into G2 |
| **G2** | Sealing claims, solid/shade, one holder per unit | — | NOT_STARTED | Sealing engine exists (`shared/src/domain/sealing.ts`, #93, included) | Needs G0's solid/shade rule text; then enclosed-area computation and the territory ledger |
| **G3** | Strength, erosion, defence, credits settlement | — | NOT_STARTED | — | After G2 |
| **G4** | Clubs, contributions, districts, seasons | — | NOT_STARTED | Website and app show clubs as preview/mockup only | After G2; no seeded-as-live leaderboards |
| **G5** | Deed lifecycle and eligibility (pre-financial) | Old chain #80–#87 | DEFERRED | Contracts prototype on a separate branch; not audited | After a safe pilot; reuse #80/#81 only after review against V3 |
| **G6** | Economy simulation and limited-token research | — | DEFERRED | — | Separate from Play v1 |
| **G7** | Production economy, wallets, audited mainnet readiness | — | DEFERRED | — | Security, legal and audit gates |
| **UX0** | Real geographic territory map and full game UX in the app | — | BLOCKED_OWNER | Contract ready: `docs/TERRITORY_GEOMETRY.md` | Waits for the owner's mobile design instruction |
| **QA0** | Release build, phone, Play prerequisites | — | BLOCKED_OWNER | Plans: `ANDROID_DEVICE_GATE_PLAN.md`, `PLAY_REGISTRATION_CHECKLIST.md` | X-08, X-04, X-10; Play account X-01 |

**Dependencies:**
- G0 and G1 come before G2.
- G2 comes before G3 and G4.
- A safe pilot comes before G5–G7.
- UX0 starts only on the owner's go.
- L1 → L2 → W1 publication (X-21).

## X-25 proposal: security log retention (decision only; nothing deleted)

**Today:** `security_audit_events` keeps every row until the account is
deleted. Each 10-minute token refresh writes one row, about 0.19 KB (E-39).

**Proposal for the owner:**
- Delete routine `session_refreshed` rows after **30 days**.
- Keep security-relevant rows for **180 days**. These are replay detection,
  revocations, sign-in and wallet events.
- Keep the anonymous `account_deleted` row as now.

**Why 30 days is enough for refreshes:**
- They are the bulk of the table and carry no incident signal.
- Supabase Free keeps its own auth logs for only about a day, so these rows
  are the investigation trail.

**Implementation:** a maintenance task like the session clean-up. It is not
built; it waits for the owner's decision.

## Existing open PRs (live on 13 Oct 2026)

"Included" means the PR's head commit is an ancestor of
`chore/post-security-launch-prep` (and so of the release tree). None of these
was merged into `main`.

| PR | Title (short) | Verdict | Evidence / note | Proposed action (owner) |
|---|---|---|---|---|
| #105, #104, #103, #101, #100 | Demo mobile preflight, game UI, device polish, responsive actions, real maps | Included | Ancestors | Close as included in the release branch |
| #102 | Backend: isolate V3 preview API, email delivery | Included, partly superseded | Ancestor; email codes later unwired (D-16) | Close as included |
| #99, #98, #97, #96, #95 | GPS privacy reset, failed GPS starts, foreground GPS, route evidence, session provenance | Included | Ancestors | Close as included |
| #94 | Android Hermes / H3 startup fix | Included, unproven on a device | Ancestor; `docs/HERMES_H3_COMPATIBILITY.md` says a cold launch on a phone is still the proof | Keep open until the phone test (QA0) |
| #93, #92, #91 | Sealing engine, V3 session model, canonical H3 | Included | Ancestors; basis of G1/G2 | Close as included |
| #90, #89 | Daylight Cartography motion, V3 integration baseline | Included | Ancestors (mobile UI, frozen) | Close as included |
| #78, #77, #76, #75, #74 | Mobile privacy claims, verification retry, verified movement, session submission, movement API client | Included | Ancestors | Close as included |
| #72, #71, #70, #69 | Honest product claims, UI guards, task hero, onboarding | Included | Ancestors | Close as included |
| #68, #67, #66, #65, #64, #63 | API 36, GPS power, Move today, test discovery, design review | Included | Ancestors | Close as included |
| #88 | V3 roadmap docs | Still needed, stale | 1 commit not in the tree; deployment facts out of date | Fold into G0, then close |
| #80 | Minimal MOVE-free DeedRegistry contract | Independent, deferred | 1 commit, contracts only | Keep for G5 review; no deployment |
| #81 | Website deed metadata endpoints | Conflicts with W1 rules | Public deed endpoints on the marketing site | Keep closed to publication; revisit in G5 |
| #82, #83, #86 | Deed EIP-712 signer, claim bridge, CLI wiring | Independent, deferred | Backend services not in the release tree | Revisit in G5 with V3 rules |
| #84, #85, #87 | Base Batches application docs | Superseded | Application material; chain-name claims now limited by the owner | Close |
| #61 | "Aurora Cartography" mobile visual refresh (July) | Superseded | 8 commits not in tree; later design work replaced it; mobile is frozen | Close |
| #45 | Isolated v2 territory economy contracts (July) | Superseded | `feat/v3-onchain-core` is the newer contracts line | Close |

I have not closed or merged any PR. Closing is the owner's call.

## Draft PRs opened by this board

| PR | Packet | Base ← head |
|---|---|---|
| #106 (draft) | L1/L3 launch hardening | `release/android-v1-cxfdbd` ← `chore/post-security-launch-prep` |
| #107 (draft) | G1 map regions and coverage | `chore/post-security-launch-prep` ← `feat/g1-territory-geometry` |
| #108 (draft) | W1 website review version | `chore/post-security-launch-prep` ← `web/w1-review-preview` |

**Vercel note.** The repository's Vercel Git integration builds a *preview*
deployment for every pushed branch and PR. These include the
`movenrun-website` project, on `*.vercel.app` URLs. Previews are not
production and do not touch `movenrun.xyz` or DNS, but they exist on the
internet. Whether they need a Vercel login depends on the project's
Deployment Protection setting, which this workspace cannot see. On #106 and #107
three other Vercel projects (`arena`, `arena-pchb`, `arena-qg9n`) report
build errors; they predate this work (the same three fail on #105, 9 Sep).
