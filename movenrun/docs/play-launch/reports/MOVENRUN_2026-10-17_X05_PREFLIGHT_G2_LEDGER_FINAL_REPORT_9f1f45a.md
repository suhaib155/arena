# MovenRun 17 Oct 2026: website apex check, X-05 preflight, G2 ledger

## Completed
- Website PRs #108 (bd7fff2), #113 (b20f5ed), #116 (bca2692) checked against
  the live domain: the apex is canonical everywhere, `vercel.json` has no
  redirects that conflict with the 308, strict CSP kept. No change (E-66).
- X-05 preflight: `X05_PROVIDER_ENABLEMENT_PREFLIGHT.md` (9f1f45a on #112):
  preconditions P1–P7, Google and wallet dashboard steps (setting names only),
  three redirect URLs without `www`, checks C1–C5 (hook, first sign-ins and
  separate accounts, cap refusal, exchange replay, deletion and clean-up),
  rollback. Nothing was enabled.
- G2 holding ledger, draft #117 at 9a272f7 on #114: shared 198/198 (E-65).

## Live state
Unchanged since E-63/E-64: staging at 2192de6, Pages 404, apex 200, `www` 308.

## Risks and blockers
- X-05 checks need a client that can sign in. The reviewed website is not
  live (X-21) and the preview APK comes after X-05.
- Lowering `max_accounts` or `max_new_per_hour` to test refusals is a live
  database write and needs its own approval.
- The two-network client-address check has not been run (one network only).

## Owner-only
Two-network check; X-05 approval; choice of X-21 first or an app build for
the X-05 checks; approval for any live cap change during testing.

## Next packet
G3 reference model (strength, erosion, defence, fortification, credits
settlement) without inventing D2, D4 or D5 values; then G4.
