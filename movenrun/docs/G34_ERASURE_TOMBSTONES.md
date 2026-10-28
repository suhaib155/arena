# G3/G4 erasure tombstones, reconcilable closed days, and dual-review resume

**Status: implemented against the PROPOSED, UNAPPLIED migration 0011 (revision 3, erasure amendment). Gameplay stays off (`MOVENRUN_GAMEPLAY_ENABLED` unset). Every retention period below is a PROPOSAL pending an owner decision.**

Directive 28 Oct 2026, section 5 items 2, 5 and 6. This closes three problems #156 left open:

- (a) Account erasure tripped the reconciler: after a deletion, the replay of every closed day the person touched reported `closed_day_replay_mismatch` and halted settlement.
- (b) Resume after a halt was a single unchecked call.
- (c) "Legal hold" had been suggested as a way to keep identity-linked rows. It is not used. Nothing identity-linked is kept to make reconciliation work.

## 1. The model

### 1.1 Erasure

Account deletion (`identity/accountDeletion.ts`) runs a two-phase gameplay erasure step inside its one transaction. The step runs whenever the 0011 tables exist, whatever the flag says. On a database without 0011 it does nothing (one catalog lookup).

1. **Begin** runs after the user row is locked and before anything is deleted.
   - It takes the erasure fence (`gameplay_erasure_fence`, one row, `UPDATE`).
   - It finds the first day any of the person's data touches: their lines, memberships, sessions, ledger rows as walker or holder, unit day states and proofs.
   - For every settled day from then on, it runs the reconciler's full check (`verifyDayIn`) and notes the day's current digest head.
2. The existing deletion removes the person's movement sessions. Their 1002 session paths cascade with them.
3. **Complete** runs before the user row is deleted.
   - It deletes their challenges and memberships and their gameplay applied-session receipts, and puts their held ground back on the map as unheld.
   - It nulls their club authorship.
   - It deletes their `gameplay_players` row. That cascades their ledger rows, day rows and proofs, and nulls them as previous or new holder (the 0011 triggers reset those unit states).
   - For each settled day whose input digest changed, or that holds their credit line, or whose problem texts name them, it appends one **erasure record** and then:
     - replaces their credit line's `player_id` with that record's **tombstone**, `erasure_record_id`. Amounts are unchanged and the line's key becomes `erased:<uuid>`;
     - rewrites their id out of that header's problem texts. The header's books are untouched.
4. The user row is deleted.

### 1.2 Erasure records (`gameplay_erasure_records`)

| Column | Meaning |
|---|---|
| `record_id` | A random uuid made for this row alone. It is the tombstone. |
| `day` | The settled day. |
| `pre_digest` | The day's digest head before this erasure: the header's `input_digest`, or the previous record's `post_digest`. |
| `post_digest` | The digest of the day's inputs right after the erasure, computed in the same transaction. |
| `pre_verified` | The day passed the reconciler's full check just before the erasure. |
| `line_tombstoned` | Whether this record replaced a credit line. |
| `prev_hash`, `record_hash` | The per-day hash chain: `sha256("erasure-record-v1"\|prev\|record_id\|day\|pre\|post\|verified\|tombstoned)`. |

There is no user column, no player number and no timestamp.

The insert trigger recomputes the hash and refuses any record that does not extend the day's chain. That means its `pre_digest` must be the current head and its `prev_hash` the last record's hash. Records are append-only. They go only when an operator removes a refused header so the day can be settled afresh.

### 1.3 Tombstone properties

- **Non-reversible.** The tombstone is `randomUUID()`. No table, log line or return value maps it to the user id, the player number, or the person's other days. The plan object holding the user id lives only inside the deletion call.
- **Per erasure and day.** One person's two days get two unrelated uuids.
- **No hidden identity graph.** Deletion followed by sign-up again with the same provider subject resolves to nobody (the identity rows are gone), so the sign-in flow creates a new user id. Gameplay then assigns a new, never-reused `player_no`. Nothing carries over: no credit, no ground, no proof, and no link to any record.

### 1.4 How the reconciler accepts an erased day (`verifyDayIn`)

A day without records is checked exactly as before:

- the input digest matches;
- the stored books pass the invariants;
- a fresh settlement under the pinned rules matches the stored books;
- **new:** every stored proof recomputes from the ledger, while the day's partitions exist (`closed_day_proof_mismatch`).

A day with records is checked as follows:

- the chain must run from the stored header digest to the digest of the inputs as they are now;
- every link must have `pre_verified = true` and a correct hash (`closed_day_erasure_invalid`), and the current digest must equal the head (`closed_day_replay_mismatch`);
- the stored books, including the tombstoned lines, must pass every invariant. Lines still add up to the header because the tombstoned lines keep their amounts;
- tombstoned lines must equal the records that tombstoned them;
- every proof must recompute.

The fresh-settlement comparison is skipped for such a day, because it is impossible once the person's inputs are gone. That is the price of erasure, and it is stated rather than hidden.

All four codes make `verifyDayOrHalt` halt.

**Proofs commit to tombstone-stable values (proof encoding 2).** A ledger row is hashed as source, unit, outcome, strengths and shade. It no longer includes the previous or new holder's player number, and the outcome already says whose ground it was. Erasing a holder therefore changes nobody else's proof. Under encoding 1, the other walker's proof would have stopped matching.

**An erasure cannot launder a mismatch.** If a day already failed before the erasure, its record says `pre_verified = false`, and the day keeps failing after it.

### 1.5 Concurrency

- **Settlement.** Every day close takes the fence `FOR SHARE` inside its serializable transaction, and erasure `UPDATE`s it.
  - A close that starts during an erasure waits.
  - A close whose snapshot predates a committed erasure fails with 40001 and is retried afresh. The existing retry loop handles this.
  - So no day settles from inputs that an erasure is changing.
- **Two erasures** serialise on the fence. Two deletions of the same account serialise on the user row lock. The second sees no user and does nothing.
- **Pushes.** A push by the person being erased waits on the user row through its foreign key, and then fails.

### 1.6 Fail closed

`gameplay_players.user_id`, `gameplay_credit_lines.player_id` and `gameplay_club_memberships.walker_id` no longer cascade from `users`. A deletion that skips the erasure step fails with 23503 instead of silently breaking a closed day. Credit lines are never deleted. The only change allowed to a line is player to tombstone, with amounts unchanged. A tombstone cannot be turned back into a player.

## 2. What is erased and what is kept (retention: PROPOSALS)

| Data | On account deletion | Kept for (proposal, owner decision) |
|---|---|---|
| User id, sign-in identities, sessions, audit history (existing) | Deleted | Not kept. One anonymous `account_deleted` event remains (existing). |
| Movement sessions and 1002 session paths (location-derived) | Deleted | Not kept. |
| Ledger rows they walked, day rows (`visit_units`), proofs, player number | Deleted | Not kept. |
| Their number as previous/new holder in others' ledger rows; unit day states they held | Set to NULL / reset to unheld | The rows belong to the other walker and their retention (14-day raw window, `G34_DATA_LIFECYCLE.md`). |
| Held ground, challenges, memberships, club authorship | Ground back on the map unheld; challenges and memberships deleted; authorship NULL | Not kept. |
| Settled credit lines | Player replaced by a random per-day tombstone; amounts kept | **Proposal:** for the season record plus a 30-day appeal window (≤ 120 days after the day). After that, settled lines and records of a closed, verified season may be compacted into day totals (not built). |
| Erasure records (digests, flags, chain hashes; no identity) | Appended | **Proposal:** as long as the settled header they chain from. |
| Day headers (totals only) and club/district day aggregates | Unchanged (problem texts scrubbed of the id) | Season record (existing proposal). |
| Archives (designed in `G34_DATA_LIFECYCLE.md` §2, not built) | Erasure list applied on restore; bounded by archive expiry and key destruction | ≤ 120 days, as designed there. |

There is **no legal-hold exception**. No table, trigger or code path keeps identity-linked rows or paths because of a hold. If counsel ever requires a hold, it must be designed and decided as its own change. It must not reuse this erasure path.

## 3. Resume under dual review

`resumeSettlement` now always refuses with 403 `dual_review_required`. Resume takes three steps:

1. `requestResume({ actor, reason })`:
   - is refused unless settlement is halted;
   - runs a **fresh reconciliation proof**: every stored header re-verified with `verifyDayIn`, in one snapshot, under the halt-table lock;
   - refuses with `resume_proof_failed` if any day fails, and records nothing;
   - otherwise records the request with the proof's sha256, which binds the halt id.
2. `approveResume({ requestId, approver })`:
   - the approver must not be the requester;
   - the same approver counts once;
   - each approval re-runs the proof and must get the same sha256, else `resume_proof_stale`. An erasure, a new settlement or any change since the request makes the proof stale.
3. The second distinct approval writes the resume row in the same transaction.

The database enforces the same rules. A `resume` row needs a `resume_request_id`, and its insert trigger requires that:

- the request is for the current halt;
- the request is younger than 24 hours (**proposal**);
- the request has two approvals by actors other than the requester, both carrying the request's proof sha256.

Approvals are refused for the requester, and requests, approvals and the halt log are append-only. A used request cannot resume a later halt.

**Why one operator cannot resume.** A halt means a closed day may not reconcile. Resuming lets the next run settle more days on top of it. One person could do that by mistake, or to hide tampering, and the next day's books would then rest on unverified ground. The proof requirement makes resume impossible while any day fails. Repairing such a day remains its own authorised incident; resume repairs nothing. The two-approver requirement means one person cannot both judge the evidence and act on it.

## 4. Day receipts (item 2): confirmed

- Each day header stores `receipt_cutoff_at` (close + grace) and `input_digest`. The digest binds the cutoff.
- A session received at or after the cutoff counts for no day, and `applySession` refuses it with `day_closed`. The tests show this is deterministic for retries, for new ids, and when settlement is delayed.
- The movement row itself stays a truthful `verified` session.
- Existing tests: `receiptCutoff.pg.test.ts` (retries after cutoff, concurrent closes, serialization retry, delayed scheduler).
- New tests:
  - erasure racing a day close;
  - deletion and re-creation with the same provider subject, with a late upload for an old day that is refused while the session record stays unchanged.

## 5. Residual risks

1. **Authentication of records is structural, not cryptographic.** The table owner (the API role) could disable triggers and forge a whole consistent chain. The same role can already rewrite any table. An HMAC or signature with a key held outside the database would close this. It needs a managed secret: **owner decision**.
2. **Approver labels are role labels, not people.** The database checks that the labels differ. Mapping each label to a distinct authenticated person (operator accounts, SSO, hardware keys) is outside this code: **owner decision before any hosted pilot**.
3. **Linkage by side knowledge.** One erasure's records are consecutive in `seq`. Someone who knows when a person deleted their account could guess which tombstoned lines were theirs. They would learn daily credit amounts, but no location and no identity from the database. Merging tombstones per day, or compacting after the appeal window, would reduce this (**proposal**).
4. **Club standings at read time.** The stored club day aggregates are unchanged. The club leaderboard is recomputed from lines and current memberships, so an erased member's past contribution leaves their club's board score. Player balances and player-board scores of others are unchanged. The erased player leaves the player board, and the others are ranked again among themselves.
5. **Cost.** Erasure re-verifies, then recomputes, every settled day from the person's first touched day: two day replays each. That is bounded by one season (90 days). It was not measured at 200 players.
6. **Rule-set drift.** If a build that no longer knows a settled day's pinned rule set runs an erasure, the replay fails closed and the account deletion fails. It is retried, not silently skipped. Builds must keep every pinned rule set.
7. **Retention drops.** Once a day's partitions are dropped (not built), its replay already fails by design. Erasure records do not change that, and the proof check is skipped for days without partitions.

## 6. Owner decisions

- **D-E1.** Retention of tombstoned credit lines and erasure records: season + 30 days, then compaction?
- **D-E2.** HMAC or signature over erasure records with an off-database key.
- **D-E3.** Resume: two approvers distinct from the requester (built, three roles), or requester plus one approver. The request expiry is 24 hours.
- **D-E4.** Mapping operator role labels to authenticated people.
- **D-E5.** Club board semantics after a member's erasure.
