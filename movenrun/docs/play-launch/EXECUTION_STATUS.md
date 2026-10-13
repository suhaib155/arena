# Execution status

**Updated:** 2026-10-13 · **Branch:** `release/android-v1-cxfdbd` (based on `main` d344c3b, not merged) · **Target:** 2 Nov 2026 · **Gate:** STOP — AUTH/RELEASE BLOCKER

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
| A | Google and wallet sign-in, cap, deletion | Code DONE, locally tested (E-19–E-24). Hosted: BLOCKED_OWNER (X-05, X-06, X-07, X-21) |
| M | Mobile release candidate | Code DONE (E-23). Phone run BLOCKED_OWNER (X-04, X-08, X-10); wallet proof due 24 Oct (D-19) |
| B | Backend hosted | Runbook and `render.yaml` (Free) DONE. Provisioning BLOCKED_OWNER (X-06) |
| P | Privacy policy and deletion | Pages DONE for Google and wallet; contact filled. Deployment at movenrun.xyz BLOCKED_OWNER (X-21) |
| G | Store graphics and listing | DONE except screenshots (X-13) |
| R | Signed AAB, Play internal test | Workflow DONE. BLOCKED_OWNER (X-01, X-09, X-11, X-12, X-14) |
| L | Production and 48-hour monitoring | BLOCKED_OWNER (X-15, X-16, X-18); plan updated with capacity and sign-in checks |

## 20-day calendar

| Days | Work | Status |
|---|---|---|
| 13–15 Oct | Decisions and data model | DONE |
| 16–18 Oct | Providers, JWT, admission | Code DONE; provider setup BLOCKED_OWNER |
| 19–21 Oct | Native flows and deletion | Code DONE; hosted run BLOCKED_OWNER |
| 22–24 Oct | Device gate | BLOCKED_OWNER |
| 25–27 Oct | Adversarial tests | Local set DONE; hosted repeat BLOCKED_OWNER |
| 28–29 Oct | PR and AAB | PR text DONE; merge and AAB BLOCKED_OWNER |
| 30 Oct–2 Nov | Play internal testing, GO/NO-GO | BLOCKED_OWNER |

## Checkpoint 2026-10-13: auth change

Owner replaced email codes with Google and wallet sign-in through Supabase Auth
(D-16–D-23). Done on this branch: 674ef5f (server sign-in, cap, deletion),
8dfecd2 (wallet handoff to the app), 40ea135 (app sign-in screens), dbeed8d
(website pages, policies, Render Free blueprint), plus this ledger update.
Remote re-checked before each push: nobody else pushed to the release branch.
Supabase, Google and Expo are not reachable from this workspace (network
policy), so no provider was enabled and no live migration was applied.

## Open owner decisions

- X-20: accept that Google and wallet create separate accounts in v1 (D-17).
- X-01: Play account type and creation date (closed-test requirement may make
  production by 2 Nov impossible regardless of engineering).

## Safety record

No merge, publish, payment, onchain transaction, contract change, provider
change or live database change was made. No secrets were committed.
