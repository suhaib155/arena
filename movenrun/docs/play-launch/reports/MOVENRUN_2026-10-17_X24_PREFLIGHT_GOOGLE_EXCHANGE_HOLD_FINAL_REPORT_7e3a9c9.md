# MovenRun 17 Oct 2026: owner review of X-24 and #112 answered

Code commit: `7e3a9c9` on `security/a10-single-use-google-exchange` (#112).
Nothing was deployed, merged, published or rotated. No Render, Vercel,
Supabase or DNS setting was read or changed. No secret value was read. The
mobile app was not changed. The owner's review is not an X-24 grant and was
not treated as one.

## Owner decisions waiting

| # | Decision | State |
|---|---|---|
| 1 | **X-24**: deploy #111 at `7f4c0d4` (code `5b4170c`) | Ready; preflight added to `X24_DEPLOY_CANDIDATE.md`. Needs the owner's explicit grant |
| 2 | **#112 and migration 0010** | Hold items answered (below). Plan for approval: `A10_GOOGLE_EXCHANGE_PLAN.md`, after X-24 and before X-05 |
| 3 | X-21 apex primary, Android backup off (needs a mobile-hold exception), Pages off | Recommended, not granted |
| 4 | Repository visibility | Owner's review: keep public for now (recorded) |
| 5 | X-25 retention | Undecided |

## #112 hold items

| Item from the review | What changed | Proof (E-53) |
|---|---|---|
| Claim happened before the session was created | The record is written after the account is admitted, immediately before the MovenRun session is issued. An outage before that point leaves the token usable; a cap or quota refusal spends it (its provider user is removed) | Database failure 500 → retry 200; mutation moving the claim back first fails that test |
| Failed insert, cap refusal, outage, lost response | Each case is in the plan's failure table. None issues a second session; a failed session write or lost response is recovered by a new Google sign-in, which reaches the same player | HTTP tests for each case |
| Once per token or per session | **Once per Supabase session.** A session is exchanged only within 10 minutes of its sign-in (`amr` time, kept by refreshes); its record is kept until that window closes | Refreshed token 401; stale sign-in 401; future sign-in 401 |
| Clean-up on a sleeping host | No timer; each exchange deletes at most 500 spent records | PostgreSQL: 520 → 20 → 0, live record kept |
| 20+ concurrent sign-ins, wallet, ES256, missing session id | 25 concurrent (10 existing, 15 new) all 200; 50 concurrent replays 401; one token × 25 gives one session; wallet unaffected; compiled API with real ES256 tokens; missing `session_id` 401 | Backend 424/424, API 21/21 |
| Checksum, 11 migrations, RLS | `0010` is unapplied anywhere, so its comment and pinned checksum were updated; 11 migration records after two runs; RLS on every public table | `test:api` |

That Supabase keeps the `amr` time across refreshes comes from its token
format and is checked on the live project when X-05 turns providers on.

## #111 and #112 no longer diverge

#112 now contains the #111 head (`7f4c0d4`, merged with a merge commit) and
adds only its own change. Nothing was merged into the deploy branch.
#111 itself was not touched, so the reviewed X-24 SHA stays valid.

## X-24 preflight (repository part, E-54)

`5b4170c` → `7f4c0d4` changes no backend, shared or `render.yaml` file.
The target has migrations `0000`–`0009` only, with checksums equal to
`dd83065`. The live code (`dd83065`) has no `TRUST_PROXY` setting and ignores
it, so a rollback is safe with it set. The Render part (deploy ID, auto-deploy
off, build command, environment names, two retained deploys) is for the
operator immediately before X-24, as listed in the preflight.

## Tests

| Suite | Result | Commit |
|---|---|---|
| Backend (PostgreSQL 16) | 424/424 | `7e3a9c9` |
| API `test:api` | 21/21 | `7e3a9c9` |
| Backend `tsc` | clean | `7e3a9c9` |
| Secret scan | pass | `7e3a9c9` |

Mobile and website code did not change.

## Gates

| Gate | State |
|---|---|
| X-26 | DONE 16 Oct (historical, closed) |
| X-07 | DONE (attached); X-07b pending X-05 |
| X-24 | Candidate ready, NOT approved |
| #112 / 0010 | ON HOLD for the owner |
| X-05, X-21, X-25 | Not approved |
| Merges, EAS builds, paid services, contracts, mobile UI | Not approved, untouched |

## Branches

| Branch | Head | PR |
|---|---|---|
| `security/deep-audit-hardening` | `7f4c0d428c24763f9cacca616d7233cf3dba9ff4` (held) | #111 |
| `security/a10-single-use-google-exchange` | `7e3a9c9`, then this report | #112 |
| `deploy/render-free-staging` | `dd8306588667342fab2db0ebd4d55632acadb57a` | unchanged |
| `main`, `release/android-v1-cxfdbd` | `d344c3b`, `991ac6a` | unchanged |

G0–G4 continue from the queue (#114 next); nothing was restarted.
