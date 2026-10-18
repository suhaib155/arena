# Execution status

**Updated:** 2026-10-17 (X-26 closed 16 Oct; X-07 attached, X-07b waits on X-05; X-24 candidate is #111 at 7f4c0d4, conditional on the owner's grant, not approved; #112 on hold until the owner approves its migration plan; frontend on hold) · **Release branch:** `release/android-v1-cxfdbd` at 991ac6a (not merged) · **Working branch:** `chore/post-security-launch-prep` · **Deploy branch:** `deploy/render-free-staging` at dd8306588667342fab2db0ebd4d55632acadb57a (X-06 LIVE VERIFIED 14 Oct, E-41. X-24 candidate: head of `security/deep-audit-hardening`, #111, see `X24_DEPLOY_CANDIDATE.md`) · **Engineering and pre-listing target:** 2 Nov 2026 (not a Play date, D-24)
**Security gate:** SECURITY REVIEWED LOCALLY (`AUTH_SECURITY_REVIEW.md`, rounds 1–3) · **Release gate:** STOP — LIVE AUTH AND ANDROID DEVICE GATES PENDING (Play account not created)
**Frontend:** on owner hold (D-25). **Play developer account:** NOT CREATED (X-01). **Separate accounts:** accepted 2026-10-13 (X-20).

## Owner dashboard

| | Items |
|---|---|
| **DONE** | Google + wallet sign-in code, cap, quota, deletion, sweep (locally tested); security review rounds 1–3; hook contract on PostgreSQL; migration checksums; secret scan in CI; operator guide; Play registration checklist; device gate plan; X-20 accepted; device list fix F-17; session clean-up F-18; database size measured for 1,000 accounts (E-39); X-26 closed and X-07 attached 16 Oct (E-45); 15 Oct audit fixes and the 17 Oct admission-race and client-address fixes on #111 (E-46–E-48) |
| **BLOCKED — OWNER** | X-01a/b/c Play account (type, US$25, verification, closed test if Personal); X-05 (then X-07b) → X-21 live setup; X-08, X-04 build; X-10 phone by 24 Oct; X-22 mailbox |
| **BLOCKED — EXTERNAL** | Google's account verification and (Personal) production-access review; whether wallet browsers return to the app (phone only); 64-bit and 16 KB confirmation in the App bundle explorer |
| **NEEDS APPROVAL** | deploy candidate #111 (X-24); single-use Google exchange #112 (reworked 7e3a9c9 after the owner's review, adds migration 0010, own approval after X-24: `A10_GOOGLE_EXCHANGE_PLAN.md`); Android backup off, Pages off, repository visibility (`OWNER_DECISIONS_PRIVACY_REPO_DOMAIN.md`); security log retention (X-25, undecided); enabling providers (X-05), DNS (X-21), EAS build (X-04), US$25 fee (X-01b), merge (X-14), Play Console and publish (X-11, X-12, X-16), App Link return (X-23) |
| **OPEN** | F-06 residual (phone step 15h, then X-23); hosted proof that Supabase calls the hook (X-07b) |

Start here when resuming. Then read `TASK_REGISTER.md` and `EXTERNAL_ACTIONS.md`. The whole-product board (L0–L3, W1, G0–G7, UX0, QA0) is `../product-roadmap/PR_QUEUE.md`; the owner's design rules are `../product-roadmap/DESIGN_CONSTRAINTS.md`.

## Why the gate is STOP

The Google and wallet sign-in code, the 1,000-account cap and deletion for both
methods are built and pass locally, with Supabase replaced by a stand-in. None
of it has run against the real Supabase project or on a phone, because enabling
providers, applying migrations to the live database and building the APK each
need the owner (X-04–X-08, X-21). The gate turns to
`PASS — GOOGLE AND WALLET AUTH READY FOR PLAY DEVICE GATE` when Google and
wallet sign-in work against the hosted API with the real Supabase project.

## Gates

| Gate | Meaning | State |
|---|---|---|
| A | Google and wallet sign-in, cap, deletion | Code DONE, locally tested (E-19–E-28). Hosted: BLOCKED_OWNER (X-05, X-06, X-07, X-21) |
| M | Mobile release candidate | Code DONE (E-23). Phone run BLOCKED_OWNER (X-04, X-08, X-10); wallet proof due 24 Oct (D-19) |
| B | Backend hosted | LIVE VERIFIED 14 Oct (E-41): `movenrun-staging-api` at dd83065, `/health` and `/ready` 200, migrations 0000–0009 match |
| P | Privacy policy and deletion | Pages DONE for Google and wallet; contact filled. Deployment at movenrun.xyz BLOCKED_OWNER (X-21) |
| G | Store graphics and listing | DONE except screenshots (X-13) |
| R | Signed AAB, Play internal test | Workflow DONE. BLOCKED_OWNER (X-01 account NOT CREATED, X-09, X-11, X-12, X-14) |
| L | Production and 48-hour monitoring | BLOCKED_OWNER (X-15, X-16, X-18); plan updated with capacity and sign-in checks |

## 20-day calendar

| Days | Work | Status |
|---|---|---|
| 13–15 Oct | Decisions, data model, security review | DONE |
| 16–18 Oct | Live setup X-06 → X-07 → X-05 (with X-07b) → X-21 | Code and operator guide DONE; the live steps wait on owner approval |
| 19–21 Oct | Hosted checks, X-08, X-04 APK | BLOCKED_OWNER |
| 22–24 Oct | Device gate (`ANDROID_DEVICE_GATE_PLAN.md`) | BLOCKED_OWNER; wallet decision on 24 Oct (D-19) |
| 25–27 Oct | Adversarial tests | Local set DONE; hosted repeat BLOCKED_OWNER |
| 28–29 Oct | PR and production AAB | PR text DONE; merge and AAB BLOCKED_OWNER |
| 30 Oct–2 Nov | Pre-listing complete | Declarations, listing, registration checklist DONE; Play Console waits on X-01b |
| After 2 Nov | Play account, internal test, closed test if Personal (14 days), production access | Not scheduled; no date promised |

## Checkpoint 2026-10-13: auth change

Owner replaced email codes with Google and wallet sign-in through Supabase Auth
(D-16–D-23). Done on this branch: 674ef5f (server sign-in, cap, deletion),
8dfecd2 (wallet handoff to the app), 40ea135 (app sign-in screens), dbeed8d
(website pages, policies, Render Free blueprint), plus this ledger update.
Remote re-checked before each push: nobody else pushed to the release branch.
Supabase, Google and Expo are not reachable from this workspace (network
policy), so no provider was enabled and no live migration was applied.

## Checkpoint 2026-10-13 (second session)

Fresh checkout of 991ac6a: every suite re-run and matches the ledger (E-26).
Nobody had pushed to the release branch since. New work is on
a working branch (now `fix/play-auth-security-gate`), a descendant of the release branch, proposed
to it as a draft pull request (no force-push, nothing merged):

- The hosted API can no longer be switched into sending email codes by an
  environment variable; the email routes answer 404 even with a Resend key
  set (B-19, E-27).
- Sign-in on a sleeping free host: the app and website wake the API as soon
  as sign-in is shown, wait at most 90 s, then show a retry message instead
  of spinning (M-14, E-28). Handset step 15g checks it on a phone.

Supabase, Render, movenrun.xyz and Expo are still unreachable from this
workspace (proxy denies them), so nothing hosted could be tested.

## Checkpoint 2026-10-13 (security review)

Owner asked for a security-first pass. Done on the working branch:
- Provider decision: keep Supabase Web3 behind the API; Reown and Privy both
  stop at 500 monthly users on their free plans and would add a second
  identity system (`WALLET_AUTH_PROVIDER_DECISION.md`).
- Review of every sign-in path (`AUTH_SECURITY_REVIEW.md`): one High and
  four Medium findings fixed (account-cap flooding, setup order, orphan
  sign-in users, wallet choice on the web, Web3 rate limit), one Medium
  mitigated with a phone check left (F-06), four Low fixed.
- New migration 0009 (hourly new-account quota). The live database still has
  none of 0000–0009; applying them is X-06.
- Wallet sign-in can now be switched off in one place if it fails the phone
  gate; it stays on.

## Checkpoint 2026-10-13 (round 3: post-security, frontend on hold)

Owner facts recorded: no Play developer account yet (X-01 split into a–c,
D-24), mobile frontend on hold (D-25), uniquely named reports (D-26), and
separate Google and wallet accounts accepted (X-20). Done on
`chore/post-security-launch-prep`, backend and docs only:
- Orphan sweep re-reads each user before deleting, caps deletions and runs
  once at a time (F-14); token check refuses `crit` and future `nbf` (F-13);
  identity responses are `no-store` (F-15).
- Hook contract proven on PostgreSQL with the Supabase roles; migrations
  pinned by checksum (D-27); secret scan in backend CI.
- `LIVE_SETUP_OPERATOR_GUIDE.md`, `PLAY_REGISTRATION_CHECKLIST.md`,
  `ANDROID_DEVICE_GATE_PLAN.md`; F-06 App Link design for later (X-23).
- Tests: backend 406/406, API 10/10, shared 156/156, mobile 910/910
  (unchanged), web 23/23, 8/8, 3/3 (E-32–E-34).
- Report: `reports/INDEX.md`.

## Checkpoint 2026-10-13 (free hosting readiness)

Owner chose Render Free + the existing Supabase Free project (D-29) and
reconfirmed separate accounts. Done, backend and infrastructure only:
- One deployable head that holds every security and cold-start commit,
  pushed as `deploy/render-free-staging` at dd83065 (D-30). `render.yaml`
  no longer names the pre-security release branch, and a test guards it.
- Clean-up no longer assumes an always-on process (D-31). Request time is
  bounded, and readiness covers migration 0009.
- The Blueprint start command was rehearsed with verified TLS (E-36).
- `FREE_HOSTING_READINESS.md`: official limits, spend protection, backups,
  load-test plan. X-06 is click by click in the operator guide.
- Nothing deployed.

## Checkpoint 2026-10-13 (X-06 approved, operator access required)

Owner approved X-06 for dd83065. This workspace cannot reach Render or
Supabase (proxy) and holds no credentials, so nothing was deployed. The
owner runs it from the click-by-click steps and brings back the listed
proofs. Also done: the backup/restore drill, which found and fixed a
privilege loss in the documented dump (D-33); previews of the four website
pages (X-21 still held); and a staging monitoring runbook. Branches were
reconciled: there are no other pushes, and only docs are ahead of the
deploy branch.

## Checkpoint 2026-10-13 (round 4: session storage)

Resume check: no branch newer than this work. X-06 was still not reachable
from here, so it stays APPROVED, OPERATOR ACCESS REQUIRED. Measuring
database size for 1,000 accounts (E-39) found two problems in session
storage. Every 10 minutes of play adds a session row, and nothing deleted
those rows (F-18). The device list read only the newest 100 rows, so long
use on one phone hid every other device (F-17). Both are fixed in f6ce3c5
with tests (E-40). No migration was added. The deploy branch was not moved
(X-24). Only owner and vendor actions remain; the prioritised checklist is in
the round 4 report.

## Checkpoint 2026-10-13 (owner product-roadmap override)

The owner restored the full product roadmap: clubs, districts, sealing,
territory and Deeds are core, the map shows geographic areas and never
hexagons, and the website loses dates, response promises, network labels and
app CTAs (D-35). Done:
- **L0:** 42 open PRs classified (31 included in the release tree).
- **Board:** the durable board `product-roadmap/PR_QUEUE.md`.
- **G1:** map regions plus `GET /movement/coverage` on
  `feat/g1-territory-geometry` (24ab525, tested locally).
- **G1 (2):** bounded route-cell interpolation for sealing (6257d9a,
  shared 170/170). Draft #107; repository checks green.
- **W1:** the website review version on `web/w1-review-preview` (8c4d55b),
  draft #108. Local checks pass, including the sign-in/deletion e2e 23/23.
  Not published (X-21).
- **Render:** connected through Composio. The workspace is empty, so the
  first service still has to be created in the dashboard (X-06).

## Checkpoint 2026-10-14 (execution sequence reconciliation)

- **X-06 LIVE VERIFIED** (E-41): service, live deploy at the approved commit,
  `/health`, `/ready`, migration hashes, RLS on all tables, no Data API
  schema. The deploy branch stays at dd83065 (X-24 not approved).
- **G0** started from the owner's V3 PDF: `docs/GAME_ECONOMY_V3.md` with
  SOURCE / ASSUMPTION / DECISION NEEDED tags and a tested day-settlement
  reference model (E-42), draft #109.
- Records corrected: X-25 is UNDECIDED (matrix proposal in PR_QUEUE);
  inferred route cells are analytic only; W1 truthfulness blockers listed
  with source lines; W1 e2e rerun recorded with its environment.
- **Security note:** a read-only PostgREST config call through the connector
  returned the project's legacy JWT secret in its output. It is not written
  anywhere in the repository, but it has passed through the connector's logs.
  Proposed X-26: rotate it (move to JWT signing keys) after checking the
  backend does not depend on it.

## Open owner decisions

- X-01a: Play account type, chosen truthfully (Personal unless MovenRun is a
  registered entity with a D-U-N-S number).
- Approvals for the live sequence X-07 → X-05 → X-21 (X-06 done).
- X-25 retention matrix; X-26 legacy JWT secret rotation; G0 decisions D1–D13.

## Safety record

No merge, publish, payment, onchain transaction, contract change, provider
change or live database change was made. No secrets were committed.
