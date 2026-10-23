# A-2: provider deletion queue

Scope: `pending_auth_user_deletions`, `SupabaseSignInService` (`removeProviderUsers`,
`retryPendingDeletions`, `sweepOrphanProviderUsers`, `adoptPendingDeletion`,
`reportPendingDeletions`) and the Supabase sign-in entry in `identity/http/router.ts`.
No schema change. Applied migrations 0000-0010 and the journal are untouched.

## Problem (reproduced locally, memory and PostgreSQL 16)

1. Account erased; the provider delete fails, so the subject is queued.
2. The same Google account signs in before the retry. The provider user still exists, so a
   new MovenRun account is mapped to the same subject.
3. Every retry skipped mapped subjects without touching the row. The row stayed due and,
   ordered by `requested_at` with a limit of 50, stayed at the front of the batch. Fifty such
   rows blocked every real retry.

Reproduction tests are in `backend/src/identity/services/providerDeletionQueue.test.ts`.
Two more defects turned up while reproducing it:

- A provider user that had **signed in again but was not yet mapped** (a sign-in in
  progress) was deleted by the retry.
- Two retry workers running at once both deleted the same subject. Nothing owned the row.

## Policy: what happens to a new identity on the same subject

Alternatives considered:

| Option | Effect | Risk |
|---|---|---|
| A. **Supersede** (chosen) | Signing in again takes the subject over. The queue row is retired and the provider user stays. | The provider keeps a user the person chose to use again. The erased account's data is already gone. |
| B. Block sign-in until the deletion finishes | Erasure always completes first. | The person is locked out while the provider is down. This adds a new path where a sign-in fails. |
| C. Delete anyway | The queue always finishes. | It deletes the provider user behind a newly established, active account. Rejected. |

Option A was chosen because it never deletes by accident.

- A subject mapped to an active account is **never** deleted. Its row is retired ("kept").
- A provider user whose `last_sign_in_at` is later than the row's `requested_at`
  ("superseded") is not deleted, and its row is retired. If no account follows, the orphan
  sweep removes the user after its one-hour grace period. Clock skew can only push this
  towards keeping the user, and the sweep then removes it.
- When a sign-in reaches the API, it first calls `adoptPendingDeletion`. If no deletion is in
  flight, the row is retired. If a worker holds the row's lease, the sign-in is refused with
  `provisioning_failed` (503, retryable), so no account is made on a user that may disappear
  a moment later.

## Mechanism (no schema change)

- **Ownership by compare-and-set.** Each worker claims a row with one conditional `UPDATE`.
  The claim increments `attempts` and sets `last_attempt_at = now + lease` (10 min, far
  longer than the two 10 s provider calls). A `last_attempt_at` in the future means "in
  flight". `attempts` is the owner's token. `finish` (delete the row) and `release` (record a
  failed attempt) only apply while that token still matches. Under concurrent claims,
  PostgreSQL re-checks the condition on the latest row version, so exactly one claim wins.
  `adopt` reads the row `FOR UPDATE` inside a transaction, so it waits for any claim in
  progress.
- **Order of checks under the lease:** mapped? → read the provider user (any read failure
  means don't delete) → signed in since the request? → delete → finish. A provider sign-in
  before the claim shows up in the read. A sign-in after the claim reaches `adopt` while the
  lease is live and is refused.
- **Idempotent end states.** Removed, already gone (deleting a user that no longer exists
  counts as success), kept and superseded all retire the row. Retrying after a lost response
  converges. A retry never re-queues a row that another worker retired.
- **Bounded retry with back-off.** Rows never tried come first, then the longest-waiting.
  Each failure doubles the wait from 10 min, up to 24 h. The batch is still 50 rows. Rows
  are never abandoned, because erasure is an obligation: a stuck row is retried daily and
  shows up in the metric below.
- **The orphan sweep fails closed.** A failed listing or a failed re-read of a user deletes
  nothing. The sweep also re-reads the user under the lease and keeps any user that signed in
  within its grace period.
- **Metric.** An hourly maintenance task (`reportPendingDeletions`) logs one line when any
  row is older than 24 h:
  `Provider sign-in deletions pending over 24h: N (pending P, in flight F)`. It logs counts
  only, never subjects or user ids.

## Remaining gap

The provider has no conditional delete. One narrow window remains: a provider sign-in and the
whole API sign-in for the same subject land in the instant between the claimed worker's
provider read and its delete call, while `adopt` runs before the claim. In that order `adopt`
finds no lease, so the window needs both events inside one provider round trip. A later
alternative is a proposed (unapplied) migration that adds explicit `status` and `lease_until`
columns. It would make the states easier to read but would not close this provider-side gap,
so it is not proposed here.

## Tests

`providerDeletionQueue.test.ts` runs each scenario on the in-memory stores and on PostgreSQL:
re-sign-in race, sign-in since the request but not yet mapped, sign-in during the lease
(refused) and before it (adopted), lost response and a dead worker's lease, two concurrent
workers, provider lookup failure (queue and sweep), more than 50 stuck rows, and the overdue
count. `supabaseSignIn.service.test.ts` covers the router's adoption over HTTP.
