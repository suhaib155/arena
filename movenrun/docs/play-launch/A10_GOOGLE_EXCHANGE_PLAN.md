# A-10 single-use Google exchange (#112): rule, failure cases, migration plan

Written 17 Oct 2026 for the owner's review of #112. Nothing here is approved,
applied or deployed. #112 is not part of X-24.

## The rule

**One MovenRun session per Supabase session.** A Supabase access token is
valid for an hour even after the app signs it out, and a refresh gives a new
token with the same `session_id` and the same sign-in time (`amr`
timestamp). So the API:

1. exchanges a Supabase session only within **10 minutes of its Google
   sign-in** (1 minute of clock difference allowed);
2. records the `session_id` the first time it is spent, and keeps the record
   until that window has closed (sign-in + 11 minutes);
3. refuses a token with no `session_id` or no sign-in time.

Any token of a session, refreshed or not, is refused either by its record
(inside the window) or by its sign-in time (after it). The record only has to
live for the window, so the table stays small.

The app and the website exchange the token right after the Google redirect
and never retry with it (`mobile/src/services/signInProviders.ts`,
`website/js/account-auth.js`), so normal sign-in is unchanged. That Supabase
keeps the `amr` time across refreshes is from Supabase's token format, not
yet seen on the live project: it is checked when providers go on (X-05).

## When the record is written, and what each failure does

The record is written after the account is admitted and immediately before
the MovenRun session is issued (`beforeSession` in `signupOrLogin`).

| Failure | Spent? | What the player does | Test |
|---|---|---|---|
| Database or backend outage while the account is looked up or created | No | Retries; the same token works | HTTP: 500, then 200 with the same token |
| Account cap (403) or hourly quota (429) | Yes; its provider user is removed | Signs in again later (a new Supabase user) | HTTP and PostgreSQL: 403, then 401 with the same token |
| Session write fails after the record | Yes, nothing issued | Signs in with Google again (new Supabase session), same player | HTTP: 500, then 401, then a new sign-in gets the same player |
| Process lost after the record | Yes | Same as above | Covered by the case above |
| Response lost after the session was issued | Yes, one session exists | Same as above; the orphan session expires on its own | HTTP: 200, then 401 for the token and its refresh |
| Copied token, or a refresh of it | Yes | Nothing: refused | Service, HTTP and PostgreSQL |

No case issues a second session for one Supabase session. Making the record
and the session one database transaction would also cover the session-write
case, but it would mean one transaction across the identity and session
stores; a new Google sign-in already recovers it, so it is not proposed.

## Clean-up

Each exchange deletes at most 500 records whose window has closed, by primary
key. Nothing runs on a timer, so a sleeping Render Free host does no work and
the first sign-in after a wake does one bounded delete. Tested in memory and
on PostgreSQL (520 old records: 500, then 20; live records kept).

## Tests on `7e3a9c9`

- Backend 424/424 on PostgreSQL 16; API 21/21 (compiled API, real ES256 JWTs
  from the stand-in, migrations run twice, 11 migration records, RLS on every
  public table, checksums pinned).
- 25 concurrent sign-ins (10 existing players, 15 new): 25 sessions. The 25
  tokens replayed twice at once: 50 refused. One token sent 25 times at once:
  one session. Wallet sign-in does not touch the record.
- Refreshed token (same session id and sign-in time) refused; sign-in older
  than 10 minutes refused; sign-in time in the future refused; missing
  `session_id` or sign-in time refused.

## Migration plan (separate approval, after X-24)

1. **Owner approves #112** and its migration `0010_google_sign_in_exchanges`
   (one table, primary key and index, RLS on, no personal data). Additive: no
   existing table or row changes.
2. Only after X-24 is live and verified: fast-forward the deploy branch to the
   approved #112 head and deploy once. The start command applies `0010` on
   boot; nothing is applied by hand.
3. Check: `/ready` 200 (it reads the new table); 11 rows in
   `drizzle.__drizzle_migrations`; RLS on `google_sign_in_exchanges`.
4. Rollback: redeploy the X-24 commit. Its code never reads the table, so the
   table can stay; dropping it is not needed and would be its own step.
5. Real Google sign-in is checked when X-05 turns the provider on.

Applying `0010` by adding #112 to the X-24 deploy is not part of this plan.
