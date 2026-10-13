# Execution status

**Updated:** 2026-10-13 (security review) · **Release branch:** `release/android-v1-cxfdbd` at 991ac6a (not merged) · **Working branch:** `fix/play-auth-security-gate`, a descendant of it · **Target:** 2 Nov 2026
**Security gate:** PASS — SECURITY REVIEWED, READY FOR LIVE AUTH DEVICE GATE (`AUTH_SECURITY_REVIEW.md`) · **Release gate:** STOP — AUTH/RELEASE BLOCKER (nothing hosted or on a phone yet)

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

## Checkpoint 2026-10-13 (second session)

Fresh checkout of 991ac6a: every suite re-run and matches the ledger (E-26).
Nobody had pushed to the release branch since. New work is on
`claude/project-thread-lj1gny`, a descendant of the release branch, proposed
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

## Open owner decisions

- X-20: accept that Google and wallet create separate accounts in v1 (D-17).
- X-01: Play account type and creation date (closed-test requirement may make
  production by 2 Nov impossible regardless of engineering).

## Safety record

No merge, publish, payment, onchain transaction, contract change, provider
change or live database change was made. No secrets were committed.
