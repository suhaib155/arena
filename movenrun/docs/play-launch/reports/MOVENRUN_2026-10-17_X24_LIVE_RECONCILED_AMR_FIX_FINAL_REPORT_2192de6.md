# MovenRun 17 Oct 2026: X-24 live reconciled, #112 sign-in time fixed

Code commit: `2192de6` on `security/a10-single-use-google-exchange` (#112).
First work packet of the owner's continuation document (P0 and P1). Nothing
was deployed, merged, published or rotated, and X-24 was not redeployed. No
Render, Vercel, Supabase or DNS setting was read or changed, and no secret
value was read. The mobile app and website were not changed.

## Owner decisions waiting

| # | Decision | Recommendation |
|---|---|---|
| 1 | Approve #112 at `2192de6` and its migration `0010` for one deploy before X-05 | Approve: the sign-in time finding is fixed and tested (E-56); steps and rollback in `A10_GOOGLE_EXCHANGE_PLAN.md` |
| 2 | Client-address check from two independent client networks (a phone on mobile data plus one other network) | Owner runs it once; this workspace leaves from one address only |
| 3 | G2: in model #114 one visit takes over unfortified ground (push 100 against fresh strength 100) | Decide before any server-held territory ships; the V3 numbers are not changed without the owner |

## P0: X-24 reconciled (E-55)

| Check | Result | Label |
|---|---|---|
| Deploy branch | `deploy/render-free-staging` = `7f4c0d4` (owner grant, fast-forward from `dd83065`) | LIVE VERIFIED (GitHub) |
| Render deploy `dep-db9gqfrbc2fs73do581g`, auto-deploy off | As reported by the owner's operator; not read here | Reported |
| `/health`, `/ready` | 200, 200 | LIVE VERIFIED |
| Rate limit across requests | One bucket (limit 300; remaining 297 → 294) | LIVE VERIFIED (one network) |
| CORS | Only `https://movenrun.xyz`; `www` and an unrelated origin get none | LIVE VERIFIED |
| Two independent client networks | Not run | Open (decision 2) |

Board updated once: `PR_QUEUE.md` (S1 DONE, S2 BLOCKED_OWNER, L3, branches),
`EXECUTION_STATUS.md` (header, dashboard, dated checkpoint and correction),
`EXTERNAL_ACTIONS.md` (X-24 DONE), `EVIDENCE_REGISTER.md` (E-55, E-56).
Older statements that X-24 was not approved are kept and marked superseded.

## P1: #112 sign-in time (B1, E-56)

The finding: a refreshed token could carry a newer `amr` time, and the
record was kept only until sign-in + 11 minutes, so a spent session could
later look fresh. Now:

- the time comes only from the single `amr` entry with method `oauth`; a
  `token_refresh` entry, `iat` and the newest time are never used, and no
  entry, two entries or a bad time is refused;
- records are kept 30 days, so the record alone refuses the session long
  after it could be eligible; clean-up stays bounded (500 per exchange).

| Case required by B1 | Result |
|---|---|
| Newer `token_refresh` entry, any order | Ignored |
| No `amr`, no `oauth`, two `oauth`, bad time | Refused |
| Replays at 10, 11, 30, 65 min, several refreshes | One exchange only |
| 25 concurrent refreshes of one session | One session |
| Window edges (10 min, +60 s skew, ±1 ms) | Accepted at the edge, refused 1 ms past |
| New Google sign-in after a failure, lost response or cancel | New Supabase session, same player |
| Compiled API, `oauth` 11 min ago plus a refresh now | 401 |
| Mutation: use the newest `amr` time | Tests fail |

Migration `0010` is byte-for-byte unchanged (checksum unchanged). Its header
comment still describes the shorter retention; the code and the plan are
the current rule. That Supabase never moves the `oauth` time on refresh is
checked on the live project at X-05 (claim names and order only).

## Tests on `2192de6`

| Suite | Result |
|---|---|
| Backend on PostgreSQL 16 | 427/427, 0 skipped |
| API `test:api` (compiled, ES256 stand-in, migrations twice, RLS) | 21/21 |
| Backend `tsc` | clean |
| Secret scan | pass |

## Gates

| Gate | State |
|---|---|
| X-24 | DONE, LIVE VERIFIED (two-network check open) |
| #112 / 0010 | Waiting on the owner (decision 1) |
| X-05, X-21 publication, X-25, main merges, Play, mobile UI | Not approved, untouched |

## Branches

| Branch | Head | PR |
|---|---|---|
| `deploy/render-free-staging` | `7f4c0d428c24763f9cacca616d7233cf3dba9ff4` | live |
| `security/deep-audit-hardening` | `7f4c0d4` | #111 |
| `security/a10-single-use-google-exchange` | `2192de6`, then this report | #112 |
| `main`, `release/android-v1-cxfdbd` | `d344c3b`, `991ac6a` | unchanged |

Next approved work, in order: A2 Android backup off (native config only),
A3 Pages unpublish after checks, A4/A5 domain and website draft, G2 #114
as simulation only.
