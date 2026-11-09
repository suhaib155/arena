# MovenRun 2026-11-09: state machines made explicit

Code commit `d8c527b` on `claude/project-thread-s1x12y`, draft PR #195 into
`integration/android-qa0-28oct` (`9fdc17d`). This is development only.

Nothing in this change touches deploys, migrations, providers, EAS builds,
onchain actions or the visible UI.

## Result
- **Survey.** We checked about 25 status, state and stage types across mobile,
  backend, shared, website and the release workflows. They are all
  catalogued in `docs/STATE_MACHINES.md`.
- **Transition tables.** Nine machines now have explicit typed transition
  tables built on one shared helper (`@movenrun/shared/state-machine`).
  - Mobile has three: capture, server check, and session truth.
  - Backend has six: sessions, wallet provisioning, wallet ownership, users,
    provider events, and the legacy route lifecycle.
- **Tests against real code.** Each table is checked by tests that drive the
  real store, service or pure function. Two exceptions are checked against
  the table alone: users (there is no production writer) and the route table
  (happy and anomaly paths only).
- **One intended behaviour guard.** A late result can no longer relabel a
  verified session as waiting. The reviewer traced every legitimate path and
  found that each one still passes.
- **Exhaustive switch.** Provider-event outcomes are now handled by an
  exhaustive `switch`. A new outcome kind becomes a compile error instead of
  a silent retry.
- **Catalogue gate.** A test in mobile and a test in backend fail when a new
  state type is not listed in the catalogue. This was verified by removing a
  name: the test fails.

## Gates

| Gate | Threshold | Result |
|---|---|---|
| Mobile tests | 100% pass, no fewer than before | 1058/1058 (was 1042) |
| Backend unit tests | 100% pass | 452/452 (was 441); DB tests run in CI |
| Shared tests | 100% pass | 183/183 |
| Type-check (mobile, backend, shared) | 0 errors | 0 |
| Independent review | 0 blockers | 0 blockers, 3 should-fix, all fixed in `d8c527b` |
| Forbidden attribution text | 0 hits | 0 |
| Catalogue gaps | 0 unlisted state types | 0 |

## Team and handoffs

| Agent | Job | Model tier | Outcome |
|---|---|---|---|
| Surveyor | Read-only sweep of backend, shared, website and workflows | mid | Done; 12 machines with file and line references |
| Builder | Mobile survey, tables, tests, docs | strongest | Done |
| Reviewer | Independent review of the commit; did not write it | strongest | 0 blockers. Three should-fix items were raised and all are fixed: a missing `signedIn -> unknown` edge, overstated backend coverage, and a guard that no pipeline test exercised |

There were no retries, no silent runs and no escalations. Rework was limited
to one review round.

## Open items for the owner (each needs a separate, reviewed change)
1. **Route jobs.** A redelivered route job can take a finished route back
   through `PROCESSING`.
2. **Wallet provisioning.** Provisioning uses read-then-write guards: there
   is a concurrency regression path, and revoked wallets are not checked.
   Embedded wallets are off in v1.
3. **Session status writes.** `SessionRepository.setStatus` writes any
   status. It has no production caller.
4. **Missing CHECKs.** Status columns have no database CHECK constraint,
   apart from provider events. Adding them would need a migration approval.
5. **Screen-held machines.** Three flows still hold their state in screen
   flags: GPS health on the session screen, the Save flow on the summary
   screen, and the website deletion page after a failed delete. Moving them
   would need a device pass while the UI freeze holds.
6. **Vercel previews.** The previews for `arena`, `arena-pchb` and
   `arena-qg9n` fail on this PR. They fail the same way on the base commit
   `9fdc17d`, so the failure is not caused by this change.
