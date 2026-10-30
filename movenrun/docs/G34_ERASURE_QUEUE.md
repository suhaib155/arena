# Account erasure queue: design, flow and operator runbook (30 Oct 2026)

Status: code on the development branch `feat/g34-erasure-async-queue`, gameplay disabled, migration 0011 unapplied.
Nothing here is live. The queue only runs where gameplay is enabled **and** the proposed job table exists; with
gameplay off (today's deployment) account deletion stays synchronous, now with bounded lock waits and a typed
retryable error. Measurements: `docs/play-launch/ERASURE_STRESS_30OCT.md` (LOCAL, SYNTHETIC).

## 1. What existed before

| piece | where | what it is | why it is not the erasure queue |
|---|---|---|---|
| account deletion | `identity/accountDeletion.ts` | one synchronous transaction: gameplay fence, gameplay replay and tombstones (0011 only), identity rows, user row | no durable state at all: a timeout lost the request; the user saw a 500 and stayed signed in |
| provider deletion queue | `pending_auth_user_deletions` (applied migration 0007), `SupabaseSignInService.removeProviderUsers` / `retryPendingDeletions` | Supabase Auth users to remove at the provider, keyed by provider subject, retried every 5 min with a 10 min cutoff, skipped while the subject still maps to an account | it runs after the database erasure committed, has no lease, no state, no attempt policy, and is keyed by a provider id, not an account. Putting account ids in it would make the provider loop call the provider's delete with them. It stays as it is and is still fed by the erasure transaction |
| gameplay erasure | `GameplayService.takeErasureFence / eraseBegin / eraseComplete` (0011) | serialises erasures on one fence row against day close, verifies and tombstones settled days | the slow part (about 300 ms per settled day touched, queued behind every other erasure and close) |

So the new durable job belongs to the gameplay erasure (only that part is slow, and only where 0011 exists): table
`gameplay_account_deletion_jobs` in `drizzle-proposed/0011_gameplay_holdings.sql`. The provider queue is unchanged.

## 2. Flow

```
POST /identity/account/delete {confirm:"DELETE"}  (bearer session)
        |
        +-- gameplay off, or no job table ------------------------------------------+
        |                                                                           |
        v  gameplay on + job table (ACCEPT, short tx, lock_timeout 2 s, no fence)    v  SYNCHRONOUS (one tx, lock_timeout 5 s)
  open job for this user? --yes--> 202 pending (same request id)              fence -> user row FOR UPDATE -> erase all
        | no                                                                    | ok: 200 completed + provider removal
  user row FOR NO KEY UPDATE (gone? -> 200 completed, zero counts)              | 55P03/57014/40001/40P01/conn:
  INSERT job (pending, opaque uuid)                                             |    rollback, 503 deletion_busy, Retry-After 5
  users.status = 'deleting', security_version + 1, sessions deleted             | other: 500, rollback
  COMMIT --> 202 {deleted:false, status:"pending", requestId, signedOut:true}
        |                         (lock wait over budget / tx lost -> 503 deletion_busy, nothing written)
        v
  worker.kick() + maintenance every 30 s (and after every response)
        |
  CLAIM: UPDATE ... WHERE id = (due pending OR expired running ... FOR UPDATE SKIP LOCKED)
         state running, lease_token, lease_expires_at = now()+120 s, attempts+1
        |
  ATTEMPT (one tx, lock_timeout 3 s per lock wait):
     fence UPDATE -> user row FOR UPDATE -> job row FOR UPDATE (lease still ours? else lease_lost, rollback)
     -> gameplay verify/replay -> pending_auth_user_deletions INSERT -> delete identity rows
     -> gameplay erase + tombstones -> job: completed, user_id NULL, provider_stage queued|none
     -> DELETE user -> audit 'account_deleted' (no user id) -> COMMIT
        |                                     |
        | ok                                  | failed (tx rolled back whole)
        v                                     v
  provider removal after commit         classify: lock_timeout | serialization | deadlock |
  ok -> provider_stage 'removed'        statement_timeout | connection  -> pending, next_attempt_at =
  outage -> stays 'queued'; the          now() + backoff (DB clock)
  existing provider loop retries         fatal, or attempts >= 40 -> needs_attention (operator)
                                         lease_lost -> nothing (another worker owns it)
  worker dies anywhere: tx never commits; lease expires; next claim takes it over (attempts+1)

GET /identity/account/deletion/:requestId (no sign-in) -> {deleted, status: pending|completed, delayed, signInRecord}

Sign-in / session issue / refresh while 'deleting' -> 409 account_deletion_pending (nothing written for the account)
```

## 3. Job states and invariants

`pending -> running -> completed`, `running -> pending` (transient failure, with backoff), `running -> needs_attention`
(fatal or budget spent), `needs_attention -> pending` (operator requeue, audited), `running(expired) -> running`
(takeover). Enforced by CHECK constraints: completed iff `completed_at` set iff `user_id` NULL; running iff a lease;
needs_attention iff `attention_at`; at most one open job per account (partial unique index); `user_id` references
`users` with no action, so the user row cannot be deleted while an open job names it.

- **No lost request.** The job and the deleting status commit together, before the 202. A request that times out
  before commit wrote nothing (one transaction) and is answered 503 `deletion_busy`.
- **Exactly once.** The job completes inside the erasure transaction, after the worker re-checked its lease under the
  job row lock. A worker whose lease was taken over fails that check and rolls back. Two erasures of one account
  serialise on the user row; the second finds nothing. Settlement exactly-once is unchanged: day close and erasure
  still meet on the fence (G34_ERASURE_TOMBSTONES.md section 1.5).
- **No early claim.** Only a completed job, or an erasure that finished during the request, is reported as deleted.
- **No revived session.** Acceptance deletes every session and bumps the security version; `deleting` refuses
  authenticate, issue and refresh; a session insert during the erasure waits on the user row and then fails.
- **No cross-account erasure.** The user id comes from the bearer session (router) and from the job row (worker); the
  erasure statements are all keyed by that id, as before.

## 4. Lock order

Erasure attempt: fence (row exclusive via UPDATE) -> user row (FOR UPDATE) -> job row (FOR UPDATE) -> gameplay rows.
Acceptance: user row (FOR NO KEY UPDATE: it does not wait for the key-share locks a push's foreign-key check or a day
close holds; two acceptances still serialise on it, and the erasure's FOR UPDATE still conflicts with it) -> job row
(insert), no fence. Claim and release: job row only, autocommit. Day close: fence
(SHARE) -> advisory day lock -> fence row. No path takes the job row before the fence or the user row, so the queue adds
no cycle. Pre-existing and unchanged: a push holding unit rows while it waits for the user row's key-share lock can
deadlock with an erasure holding the user row and waiting for those unit rows (40P01; one side is aborted). The worker
now retries its side; the push side retries 5 times then answers 409 `concurrent_push_retry`, as before.

## 5. Retry policy

Per attempt: `SET LOCAL lock_timeout = 3 s` (pool `statement_timeout` 10 s still applies). Backoff before attempt n+1:
`c/2 + floor(random * c/2)` ms, `c = min(300 s, 2 s * 2^(n-1))` (capped exponential, equal jitter, never back to back),
on the database clock. 40 attempts, then needs_attention (roughly 2 to 3 hours of continuous transient failure).
Lease 120 s. Day close keeps its own five-attempt policy unchanged; push keeps its five attempts. All values are in
`DEFAULT_ERASURE_RETRY` (`gameplay/erasureJobs.ts`).

Classification (`classifyErasureError`): `55P03` lock_timeout, `40001` serialization, `40P01` deadlock, `57014`
statement_timeout, `08xxx`/`57P0x`/`53300`/socket errors/pool connect timeout/"Query read timeout" connection,
`ErasureLeaseLostError` lease_lost, anything else fatal (not retried automatically).

## 6. API semantics

| case | status | body |
|---|---|---|
| erased during the request (sync path, or already gone) | 200 | `{deleted:true, status:"completed", erased:{counts}, signInRecord}` |
| accepted and queued | 202 | `{deleted:false, status:"pending", requestId, signedOut:true, signInRecord:"pending"}` |
| could not start in budget (nothing written) | 503 + `Retry-After: 5` | `{error:{code:"deletion_busy"}}` |
| sign-in while deleting | 409 | `{error:{code:"account_deletion_pending"}}` |
| status lookup | 200 / 404 | `{deleted, status, delayed, signInRecord}`; `Cache-Control: no-store` |

The website deletion page now says "accepted, signed out, being removed" for a 202 and "busy, nothing deleted, try
again" for a 503. Its static text still says deletion "happens immediately", which is true with gameplay off; it must
change before gameplay is enabled (owner gate G-Q3 below). The app treats any 2xx as success and clears its local
credentials (correct for 202: the server already ended every session); its wording for 202, 409 and 503 is Lane B's.

## 7. Gameplay flag and 0011

| environment | deletion path | queries naming a gameplay relation |
|---|---|---|
| flag off, 0000-0010 only (today) | synchronous | only `to_regclass('public.gameplay_erasure_fence')` and `to_regclass('public.gameplay_account_deletion_jobs')` (catalogue probes; asserted by `gameplayFlagOff.test.ts`) |
| flag off, 0011 present | synchronous, erases gameplay rows (as before) and completes any open job | gameplay tables, by design: erasure must remove what exists whatever the flag says (unchanged principle) |
| flag on, 0011 present | queued | gameplay tables |
| flag on, 0011 absent | synchronous (no job table); the worker is wired but each run first probes for the job table and does nothing until it exists | catalogue probes only (worker probe asserted by `erasureQueue.pg.test.ts`) |

With the flag off, a maintenance task erases accounts left `deleting` by an earlier flag-on period (`sweepDeleting`,
every 15 min, reads `users` only, then the synchronous erasure).

## 8. Data minimisation

The job row holds a random job id, the account's user id until completion (then NULL), database timestamps, an attempt
count, a lease token and a reason code (`^[a-z0-9_]{1,40}$`). No email, provider subject, address, route, GPS, token or
error text. Logs from the worker carry counts and reason codes only. The request id given to the client is the job id:
it is unguessable and says only "pending" or "completed". The table is deliberately not named `gameplay_erasure_*`: the
erasure-state tables carry no time column at all (so nothing orders a person's erased days), and the
`erasureTombstones` unlinkability test enforces that by prefix. The job table does carry request and completion times
(as the existing `account_deleted` audit event does), but no day, no tombstone and no player column, so a completed row
cannot be joined to any settled day or tombstoned line; `erasureQueue.pg.test.ts` pins its column list. Completed rows are kept (no user id) as the deletion receipt;
their retention is an owner decision (G-Q4).

## 9. Proposed operational SLO (not observed performance, not a legal guarantee)

*Proposed:* 99% of accepted deletions complete their database erasure within 24 hours, and none stays in
needs_attention for more than one business day without an operator action. This is a target to adopt or reject, not a
measurement; the local stress numbers in `ERASURE_STRESS_30OCT.md` are synthetic and say nothing about hosted latency.

## 10. Operator runbook

Monitoring (counts only, no ids):

```sql
SELECT state, last_outcome, count(*), min(requested_at) AS oldest FROM gameplay_account_deletion_jobs
 WHERE state <> 'completed' GROUP BY 1, 2 ORDER BY 1, 2;
```

The worker logs `Account erasure: a job needs attention (<reason>)` once per parked job. Escalate when any job is in
needs_attention, or the oldest open job is older than 1 hour.

Diagnosis by `last_outcome`:
- `attempts_exhausted_lock_timeout` / `_serialization` / `_deadlock` / `_statement_timeout`: sustained contention (a
  stuck day close, a long transaction). Find the blocker (`pg_stat_activity`, `pg_locks`), end it, then requeue.
- `attempts_exhausted_connection`: database availability; requeue after recovery.
- `attempts_exhausted_lease`: workers kept dying mid-attempt (crash loop, memory). Fix the process first.
- `fatal`: a constraint or code fault. Do not requeue blindly; reproduce on a copy, fix, then requeue.

Requeue (the only supported manual action; it writes an `erasure_job_requeued` audit event with the operator's role
label and a reason code in the same transaction, and erases nothing itself):

```ts
import { requeueErasureJob } from "./src/gameplay/erasureJobs.js";
await requeueErasureJob(db, "<job uuid>", "ops-oncall", "blocker_cleared");
```

Never: delete or edit job rows by hand, set `state = 'completed'`, or delete the user row directly (the foreign key
refuses it while a job is open). Any of these would bypass the audit trail and could leave identity or gameplay rows
behind. If the queue itself is unusable, switch gameplay off: the synchronous path and `sweepDeleting` erase every
`deleting` account and complete its open job in the same transaction.

Provider stage: `provider_stage = 'queued'` means the Supabase Auth user is in `pending_auth_user_deletions` and the
existing sign-in maintenance task retries it; check that table's `attempts` and `last_attempt_at`.

Rollback of 0011 (owner decision, destructive): first switch gameplay off and let `sweepDeleting` finish every
`deleting` account (or run it by hand), then roll back; otherwise those accounts stay signed out with their data held
until the sweep runs.

Rolling the API back to a build older than this branch: that build has no `deleting` status handling and no sweep, so
accounts accepted for deletion stay signed out (their sessions were deleted) with their data held, and nothing erases
them. Before such a rollback, drain the queue (no open jobs), or after it erase each `deleting` account by hand with the
synchronous erasure of this branch's code, recording each in the incident log.

## 11. Owner gates (nothing below is done or authorised by this branch)

- **G-Q1** Applying 0011 (with this table) to any hosted database, and enabling `MOVENRUN_GAMEPLAY_ENABLED`.
- **G-Q2** Adopting, changing or rejecting the proposed SLO (section 9) and the 40-attempt / 5-minute policy.
- **G-Q3** Public wording, before gameplay is enabled (not needed for this development branch):
  `website/account-deletion/index.html` line 36 says deletion "happens immediately"; the page's 202 message says the
  data is "being removed now", although retries can take hours or wait for an operator (needs_attention); and
  `mobile/app/account/security.tsx` line 191 says the account has been "permanently deleted" on any 2xx, including a 202
  pending. Mobile UI is Lane B's and is not changed here.
- **G-Q4** Retention of completed job rows and of `security_audit_events` requeue records.
- **G-Q5** Who may run `requeueErasureJob` in production (operator identity is a role label only, as in D-E4).

## 12. Known limits

- Throughput is unchanged: erasures still serialise on the fence and each verifies every settled day the person
  touched. The queue makes the request fast and the completion durable; it does not make the erasure cheaper.
- Within one API instance a drain started by `kick()` and one started by the maintenance loop can overlap, and several
  instances drain in parallel. That is safe (claims use SKIP LOCKED, one job goes to one worker), but all erasures
  still serialise on the fence, so extra drains add no throughput.
- The provider stage in the status is the stage at completion (and `removed` when the worker's own call succeeded); a
  later success of the provider retry loop is not written back to the job.
- `pg` checked-out connection errors no longer crash the process (`db/client.ts` adds a per-client error listener),
  which the worker needs to survive a backend restart mid-attempt.
