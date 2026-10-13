# First 48 hours after a Play release

The mandate counts the launch as done only after a Play-installed v1 has been
watched for 48 hours and the results recorded here. Use the same checks for the
internal and closed test tracks, so problems surface before production.

## Before pressing Publish

- Staged rollout starts small (for example 10–20 %); raising it is an owner decision.
- `/ready` on the API returns 200; the database is not paused.
- The review account still signs in (X-07).
- Website privacy, deletion and support URLs load in a private window.

## Checks (at release, +2 h, +6 h, +24 h, +48 h)

| Check | Where | Healthy | Act when |
|---|---|---|---|
| User-perceived crash rate | Play Console → Android vitals | Below 1.09 % (Play bad-behaviour threshold) | Any new crash cluster in Movement, Account or Summary |
| User-perceived ANR rate | Android vitals | Below 0.47 % | Any ANR on session start or map screen |
| Install and update errors | Play Console → Statistics / Release overview | No spike | Device or Android version clusters |
| API readiness | `GET /ready` | 200 every check | Any 503: check database and host logs |
| API error rate and latency | Host logs/metrics | No sustained 5xx; sign-in under a few seconds once warm | 5xx bursts, timeouts |
| Sign-in codes delivered | Resend dashboard | Delivered, no bounces from real players | Bounces or blocks on the sending domain |
| Account deletions | `security_audit_events` count of `account_deleted` | Requests complete | A deletion request that did not complete |
| Database size and connections | Database dashboard | Well inside the plan | Near limits |
| Ratings and reviews | Play Console → Ratings and reviews | Read every review | Reply within a day to bugs; log them as tasks |
| Policy status | Play Console → Policy status / Inbox | No issues | Any warning: stop the rollout and record it |

## Stop conditions

Halt the staged rollout (owner action in Play Console) when crash or ANR rates
cross the thresholds above, sign-in fails for real players, data appears in the
wrong account, or Google raises a policy issue.

## Record

| Time (UTC) | Version code | Rollout % | Crash % | ANR % | /ready | Notes | Checked by |
|---|---|---|---|---|---|---|---|
| | | | | | | | |
