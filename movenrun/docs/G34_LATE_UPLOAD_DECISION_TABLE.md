# Late uploads and the day-close cutoff: decision table

**Status: CONSERVATIVE DRAFT.** D1 (time attribution) is still an owner decision. Nothing here is a new payout rule, and nothing pays out historical late credits. Gameplay stays off (`MOVENRUN_GAMEPLAY_ENABLED` unset), and migration 0011 is still proposed and unapplied.

## The rule as built (`server-receipt-before-day-close`, version 1)

- **Which day a session belongs to.** Its D1 day: the day of its last verified fix, on the rules' clock (UTC plus `dayOffsetMinutes`). This is unchanged.
- **Receipt time.** `movement_verifications.created_at`. The database sets it when the row is inserted, and the phone never sends it. Proposed 0011 adds a trigger that refuses any UPDATE that changes it.
- **Cutoff.** Midnight after the session's day, plus `dayCloseGraceMs`. The grace is 2 hours under rule sets 1001 and 1002.
  - A session received strictly before the cutoff counts.
  - A session received at the cutoff or later is late.
- **What a late session gets.**
  - It is kept as verified route history, and verification is unchanged.
  - It earns no territory: `applySession` refuses it with `day_closed`.
  - It earns no credits for its own day.
  - It never raises the active-day count, either for its own day or for any later day in that week.
- **Proof.** Each settled day stores `receipt_cutoff_at`. The cutoff (rule, version, clock offset, grace and close instant) is also part of the day's `input_digest`.
- **Replay.** `verifyDay(day)` reads the day's inputs again and compares their digest with the stored one. If they differ, it refuses with `closed_day_replay_mismatch` and rewrites nothing. A mismatch is an operator incident and needs separate authorization before anything is changed.
- **Rule identity.**
  - 1001 and 1002 leave the field unnamed, which means v1. Their config digests are unchanged: 1001 is still `d4199ec6…41cd6`.
  - A future rule set that names a different cutoff gets a new digest.

## Late-but-real examples

| Case | Received | Counts for day D? | Territory | What the player sees (proposed) | Review needed? |
|---|---|---|---|---|---|
| Walk ends 23:30, uploads at 00:40 | inside the grace | yes | yes, if applied before the close | normal | no |
| Walk ends 23:30, phone offline until 02:10 | after the close | no | no | "Saved. Arrived after day close, so it does not count for that day." | owner: is 2 h enough? |
| Long walk across midnight, ends 00:20 | belongs to D+1 | counts for D+1 | D+1 | normal | no (D1 decides the day) |
| Retry of the same session after the close | first receipt kept | as first received | as first received | no change | no |
| Same walk sent again under a new session id after the close | late | no | no | "Late upload" | possible abuse signal |
| Phone clock wrong or time zone changed | server receipt time is used | by receipt only | by receipt only | normal | no |
| Upload backdated within the 30-day movement window | late for its own day | no, and no active-day boost | no | "Too late to count" | no |
| Last day of a season, upload after the close | late | no; it does not carry into the next season | no | "Too late to count" | owner: season-end grace |
| Server or scheduler down at the close, settles hours later | each session judged on its own receipt time | unchanged | unchanged | none | no |
| Row restored or edited with an earlier receipt after the day closed | n/a | the closed day is not changed | n/a | none | **yes: incident, `verifyDay` fails closed** |

## Open owner decisions

1. **D1 attribution.** Should a session belong to the day of its last fix, its first fix, or be split? This branch keeps last fix.
2. **Grace length.** It is 2 hours today. Options include a longer grace for offline walkers, or a "pending" state reviewed by an operator.
3. **Appeals.** Should a late-but-real upload (for example after a phone outage) ever earn anything? If yes, that should be a separate, reviewed credit on an open day, never a rewrite of a closed day.
4. **User-facing reasons.** The wording for "late", "pending" and "day closed". The mobile app does not show these yet.
