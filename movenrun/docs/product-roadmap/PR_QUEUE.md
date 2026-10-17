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

**Updated:** 17 Oct 2026, from live GitHub refs (`git ls-remote`, 17 Oct). Rows not touched on 17 Oct keep their 14 Oct heads.

## Branches (live)

| Branch | Head | Role |
|---|---|---|
| `main` | d344c3b | Untouched. Merging is the owner's (X-14) |
| `release/android-v1-cxfdbd` | 991ac6a | Play v1 integration branch, unmerged |
| `fix/play-auth-security-gate` | b4612bb | Security review rounds 1–2 (ancestor of everything below) |
| `deploy/render-free-staging` | 7f4c0d4 | X-24 (17 Oct, owner grant), LIVE VERIFIED (E-55). Moves only with a new owner approval |
| `chore/post-security-launch-prep` | this board (61c9386 + report) | Security round 3–4, session fixes (f6ce3c5), launch ledgers |
| `feat/g0-economy-v3` | e2ae062 | G0: V3 spec proposal + tested day-settlement reference model (on top of the chore branch) |
| `feat/g1-territory-geometry` | 635ad7f | G1: map regions + covered-ground endpoint (on top of the chore branch) |
| `web/w1-review-preview` | bd7fff2 | W1: website review version (on top of the chore branch) |
| `security/x26-signing-keys` | 77a06b3 | #110: legacy key refusal, X-26 closure records (16 Oct) |
| `security/deep-audit-hardening` | 7f4c0d4 (code 5b4170c) | #111 on #110: audit fixes, admission race, client address. **Live as X-24** (not merged to main) |
| `security/a10-single-use-google-exchange` | 2192de6, then the 17 Oct board commit | #112 on #111 (contains its head): single-use Google exchange, migration 0010 |
| `web/a09-strict-csp` | b20f5ed | #113 on W1: strict website CSP |
| `feat/g2-holding-model` | 59185eb | #114 on G0: holding arithmetic reference model, one push per walker per unit per day |
| `feat/v3-onchain-core` | c8262ec | Separate prototype contracts branch. Not part of Play v1 |

## Work packets

| Packet | Scope | Branch / PR | State | Proof | Next action |
|---|---|---|---|---|---|
| **L0** | Launch integration and old-PR reconciliation | `release/android-v1-cxfdbd`; PR list below | DONE (classification) | 31 of 42 open PRs are ancestors of the release tree (`git merge-base --is-ancestor`, 13 Oct) | Owner decides whether to close the included PRs (see below) |
| **L1** | X-06 live backend and free-host reliability | `deploy/render-free-staging` dd83065 | DONE | LIVE VERIFIED 14 Oct (E-41): service `movenrun-staging-api` (srv-db7a49dg1s2s739nleog, Free, auto-deploy off), live deploy dep-db7a7o2vcj2c73crsemg at dd8306588667342fab2db0ebd4d55632acadb57a; `/health` and `/ready` 200; 10 migration hashes match 0000–0009; RLS on all 19 tables; Data API exposes no schema | X-07 approval next. The free instance sleeps; no keep-awake pings |
| **L2** | Supabase hook, providers, live Google + wallet + deletion + cap | — | BLOCKED_OWNER | Code tested locally (E-19–E-28, hook contract on PostgreSQL) | X-07, then X-05, each with its own approval, after L1 |
| **L3** | Session retention and storage capacity | `chore/post-security-launch-prep` (f6ce3c5), draft #106 | IN_REVIEW | CODE TESTED LOCALLY: backend 409/409, API 17/17, DB size measured (E-39, E-40); its code (f6ce3c5) is live inside X-24 since 17 Oct (E-55) | X-25 decision (proposal below) |
| **W1** | Responsive website review version | `web/w1-review-preview`, draft #108 | IN_REVIEW | CODE TESTED LOCALLY: 8 pages × 6 widths + 200% text/zoom clean; sign-in/deletion e2e 23/23 rerun on 8c4d55b (website from the W1 tree, backend from the chore tree, local PostgreSQL 16, Supabase and wallet stubbed); packet `docs/play-launch/WEBSITE_W1_REVIEW_PACKET.md` | Owner reviews; X-21 NOT approved. Truthfulness blockers in §W1 blockers below. Rerun the e2e on the exact W1 head before any publish |
| **G0** | Canonical product spec (V3 economy, settlement invariants, threat model) | `feat/g0-economy-v3`, draft #109 | IN_REVIEW | `docs/GAME_ECONOMY_V3.md` from the owner's V3 PDF (rev 2, 31 Aug 2026), every rule tagged SOURCE / ASSUMPTION / DECISION NEEDED. Reference model `@movenrun/shared/economy-v3`: CODE TESTED LOCALLY, 23 tests reproduce the source's worked numbers; shared 179/179 | Owner answers D1–D13 (D5 cell vs zone and D2 shade shape gate G2). #88 was not used as input and can be closed once #109 is accepted |
| **G1** | Server-authoritative spatial pipeline and map geometry contract | `feat/g1-territory-geometry`, draft #107 | IN_REVIEW | CODE TESTED LOCALLY: shared 170/170 (14 new), backend 411/411 (2 new), API 17/17, build; CI green | Review. Route cells between samples done (`route-cells`, unwired). Inferred cells are analytic only: they never award, claim, defend, erode, validate or count for tolls or deed traffic; `covered` stays distinct from `held` |
| **G2** | Sealing claims, solid/shade, one holder per unit | `feat/g2-holding-model`, draft #114 (holding arithmetic only) | IN_PROGRESS | Holding model CODE TESTED LOCALLY: shared 190/190 (E-52, E-61); owner set A9 on 17 Oct (V3 numbers stay, one push per walker per unit per day); sealing engine exists (#93, included) | Review #114. Still needs D2 (shade shape and sprawl), D4 (decay numbers) and D5 (zone and cell size) for enclosed-area computation and the territory ledger |
| **G3** | Strength, erosion, defence, credits settlement | — | NOT_STARTED | — | After G2 |
| **G4** | Clubs, contributions, districts, seasons | — | NOT_STARTED | Website and app show clubs as preview/mockup only | After G2; no seeded-as-live leaderboards |
| **G5** | Deed lifecycle and eligibility (pre-financial) | Old chain #80–#87 | DEFERRED | Contracts prototype on a separate branch; not audited | After a safe pilot; reuse #80/#81 only after review against V3 |
| **G6** | Economy simulation and limited-token research | — | DEFERRED | — | Separate from Play v1 |
| **G7** | Production economy, wallets, audited mainnet readiness | — | DEFERRED | — | Security, legal and audit gates |
| **UX0** | Real geographic territory map and full game UX in the app | — | BLOCKED_OWNER | Contract ready: `docs/TERRITORY_GEOMETRY.md` | Waits for the owner's mobile design instruction |
| **S1** | Security audit fixes (X-24) | `security/deep-audit-hardening`, draft #111 (on #110) | DONE (deployed; PR stays a draft, not merged) | LIVE VERIFIED 17 Oct at 7f4c0d4 (E-55); CODE TESTED LOCALLY (E-46–E-48) | Client-address check from two independent client networks (owner or a phone) |
| **S2** | Single-use Google exchange (A-10) | `security/a10-single-use-google-exchange`, draft #112 | LIVE ON STAGING | CODE TESTED LOCALLY: 427/427, API 21/21 at 2192de6 (E-56); LIVE VERIFIED on Render staging 17 Oct, X-27 (E-62) | Owner SQL check and two-network check before X-05; merge to main not approved |
| **P2a** | Android backup and device transfer off (A2, native config only) | `privacy/a2-android-backup-off`, draft #115 (on #111) | IN_REVIEW | CODE TESTED LOCALLY: mobile 914/914, prebuild manifest has `allowBackup="false"` and `dataExtractionRules` (E-57) | Phone check in the device gate (APK manifest, `bmgr`, phone-to-phone transfer); merge with the owner |
| **P2b** | Unpublish the old GitHub Pages prototype (A3) | — (repository setting) | DONE | 17 Oct 12:34 UTC (E-64): `suhaib155.github.io/arena/` now 404 (was 200, E-58). LIVE VERIFIED | — |
| **W2** | Apex domain primary (X-21a, A4) | — (Vercel setting) | DONE | 17 Oct 12:34 UTC (E-64): `movenrun.xyz` 200, `www` 308 → apex (also for paths), API CORS allows the apex only. LIVE VERIFIED. The live site is still the old production build (`/privacy/` 404) until X-21 publishes the reviewed site | X-21 publication stays gated |
| **W3** | Website draft truthfulness repairs (A5) | `web/a5-website-repairs`, draft #116 (on #113) | IN_REVIEW | CODE TESTED LOCALLY (E-60): territory labelled as an on-device preview, Points not shown as earned, no simulated live activity | Owner review of the preview; publication stays X-21 |
| **W1a** | Strict website CSP (A-09) | `web/a09-strict-csp`, draft #113 (on W1) | IN_REVIEW | e2e 24/24 under the policy (E-50) | Ships with W1 at X-21 |
| **QA0** | Release build, phone, Play prerequisites | — | BLOCKED_OWNER | Plans: `ANDROID_DEVICE_GATE_PLAN.md`, `PLAY_REGISTRATION_CHECKLIST.md` | X-08, X-04, X-10; Play account X-01 |

**Dependencies:**
- G0 and G1 come before G2.
- G2 comes before G3 and G4.
- A safe pilot comes before G5–G7.
- UX0 starts only on the owner's go.
- L1 → L2 → W1 publication (X-21).

## X-25: security log retention (UNDECIDED; nothing deleted)

**State: UNDECIDED.** Earlier records said both "30 days for all audit rows"
(84fa0cf) and "30 days routine, 180 days security" (13 Oct report). Neither
is a decision. Nothing is deleted and no clean-up job exists until the owner
chooses.

**Today:** `security_audit_events` keeps every row until the account is
deleted. One row is about 0.19 KB (E-39); at 1,000 hourly players that is
about 1.2 MB a day, almost all of it `session_refreshed`.

**Proposed retention matrix (for the owner to accept, change or reject):**

| Row kind | Proposed | Why | Size at 1,000 hourly players |
|---|---|---|---|
| `session_refreshed` (routine) | 30 days | Bulk of rows; no incident signal after a month | about 36 MB |
| Replay detection, revocation, sign-in, wallet link, quota refusal | 180 days | The incident trail; rare rows | under 1 MB |
| `account_deleted` (anonymous) | Kept | Deletion evidence; holds no identity | negligible |
| Raw GPS (V3 §27 target 24–72 h) | Not decided here | Separate decision with the location-data design | — |

Total stays well inside the 500 MB Supabase Free database. Measurement after
X-05 (real row rates) should confirm the sizes before any job is built.

**What is not promised:** no public retention period is stated anywhere until
this is decided and the deletion job is built and tested.

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
| #109 (draft) | G0 V3 spec and day-settlement model | `chore/post-security-launch-prep` ← `feat/g0-economy-v3` |

**Vercel note.** The repository's Vercel Git integration builds a *preview*
deployment for every pushed branch and PR. These include the
`movenrun-website` project, on `*.vercel.app` URLs. Previews are not
production and do not touch `movenrun.xyz` or DNS, but they exist on the
internet. Whether they need a Vercel login depends on the project's
Deployment Protection setting, which this workspace cannot see. On #106 and #107
three other Vercel projects (`arena`, `arena-pchb`, `arena-qg9n`) report
build errors; they predate this work (the same three fail on #105, 9 Sep).

## W1 blockers (source lines on `web/w1-review-preview` at 8c4d55b)

The website describes today's **local-preview** app rules as working game
rules. In the app, capture, holding and districts run on the device only; no
server agrees to them yet, and V3 says nothing is claimed until a route seals.
The vision (clubs, districts, sealing, deeds, the planned network objective)
stays; the wording must say what is preview.

| # | File:line | Text | Problem | Proposed fix |
|---|---|---|---|---|
| 1 | `website/index.html:7`, `:11`, `:111` | "Each session claims a new cell" | Metadata and hero state a claim rule that is local preview and differs from V3 sealing | "Each session maps the ground you cover. Seal a loop to claim it (in development)" or similar |
| 2 | `website/docs/index.html:59` | "capture, holding and decay, districts and mastery … all work" | True only on the device; not multiplayer, not server-held | Say they work as an on-device preview |
| 3 | `website/index.html:305`, `:640` | Eight districts and mastery presented as current | Local preview | Label as preview |
| 4 | `website/docs/capture/index.html:55`, `:59–60`; `docs/faq/index.html:55`; `docs/how-it-works/index.html:66` | "claims the first cell … one claim a day" | Preview rule; V3 replaces it with sealing, solid and shade | Mark as the current preview rule and link the V3 direction |
| 5 | `website/account-deletion/index.html:64` | "within 30 days" | BLOCKED_OWNER_PROOF: no tested staff deletion procedure; email From/Reply-To is not strong identity proof, and wallet-only accounts cannot be confirmed by email | Remove from proposed production copy until proven; keep in-app deletion as the primary path |
| 6 | `website/docs/*/index.html` footers (for example `docs/capture/index.html:83`) | "© 2026 MovenRun" | Owner concern about dates | Year-free option: "© MovenRun. All rights reserved." |

Before any publish (X-21): rerun `web-sign-in-deletion-e2e.mjs` on the exact
W1 head and record the SHA and environment.

