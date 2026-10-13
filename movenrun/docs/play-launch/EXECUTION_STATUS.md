# Execution status

**Updated:** 2026-10-13 (round 3, post-security, frontend on hold) · **Release branch:** `release/android-v1-cxfdbd` at 991ac6a (not merged) · **Working branch:** `chore/post-security-launch-prep` · **Deploy branch:** `deploy/render-free-staging` at dd8306588667342fab2db0ebd4d55632acadb57a (prepared, not deployed) · **Engineering and pre-listing target:** 2 Nov 2026 (not a Play date, D-24)
**Security gate:** SECURITY REVIEWED LOCALLY (`AUTH_SECURITY_REVIEW.md`, rounds 1–3) · **Release gate:** STOP — LIVE AUTH AND ANDROID DEVICE GATES PENDING (Play account not created)
**Frontend:** on owner hold (D-25). **Play developer account:** NOT CREATED (X-01). **Separate accounts:** accepted 2026-10-13 (X-20).

## Owner dashboard

| | Items |
|---|---|
| **DONE** | Google + wallet sign-in code, cap, quota, deletion, sweep (locally tested); security review rounds 1–3; hook contract on PostgreSQL; migration checksums; secret scan in CI; operator guide; Play registration checklist; device gate plan; X-20 accepted |
| **BLOCKED — OWNER** | X-01a/b/c Play account (type, US$25, verification, closed test if Personal); X-06 → X-07 → X-05 → X-21 live setup; X-08, X-04 build; X-10 phone by 24 Oct; X-22 mailbox |
| **BLOCKED — EXTERNAL** | Google's account verification and (Personal) production-access review; whether wallet browsers return to the app (phone only); 64-bit and 16 KB confirmation in the App bundle explorer |
| **NEEDS APPROVAL** | Applying migrations (X-06), enabling providers (X-05), DNS (X-21), EAS build (X-04), US$25 fee (X-01b), merge (X-14), Play Console and publish (X-11, X-12, X-16), App Link return (X-23) |
| **OPEN** | F-06 residual (phone step 15h, then X-23); hosted proof that Supabase calls the hook (X-07b) |

Start here when resuming. Then read `TASK_REGISTER.md` and `EXTERNAL_ACTIONS.md`.

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
| B | Backend hosted | Runbook and `render.yaml` (Free) DONE. Provisioning BLOCKED_OWNER (X-06) |
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

## Open owner decisions

- X-01a: Play account type, chosen truthfully (Personal unless MovenRun is a
  registered entity with a D-U-N-S number).
- Approvals for the live sequence X-06 → X-07 → X-05 → X-21.

## Safety record

No merge, publish, payment, onchain transaction, contract change, provider
change or live database change was made. No secrets were committed.
