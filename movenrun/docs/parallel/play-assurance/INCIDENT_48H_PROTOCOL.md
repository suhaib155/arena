# 48-hour post-release incident protocol

Checkpoint: 22 October 2026
Source heads: backend 2326aa6 (live API 2192de6); mobile 15f7f87 (#125); website 61d30bb; base checklist docs/play-launch/POST_LAUNCH_MONITORING.md @ 2326aa6.
Claim classes: SOURCE VERIFIED / LOCAL TEST CONFIRMED / REVIEWER REPORTED / OWNER-PROVIDER GATED / NOT RUN / UNKNOWN. This protocol applies to the first 48 hours after any Play-installed release (internal, closed or production track). It is a plan: no release exists yet and nothing here has been exercised. All provider-console actions are OWNER-PROVIDER GATED. Metric names refer to OPERATIONS_METRIC_CATALOGUE.md (M#).

## 1. Roles
| Role | Does | Does not |
|---|---|---|
| Owner | Play Console actions (halt staged rollout, release a previous build), Render and Vercel dashboard rollbacks, Supabase SQL and cap changes, user communications, decisions to resume | Edit committed migrations; broaden Data API exposure |
| Engineer | Reads logs and aggregate SQL, diagnoses, prepares fix-forward patches and a new build, writes the incident record, proposes (does not perform) provider actions | Touch provider dashboards without the owner; share IDs, tokens or coordinates in the record |

## 2. Watch windows
Checks at release, +2 h, +6 h, +24 h, +48 h (POST_LAUNCH_MONITORING.md @ 2326aa6). Each check:
1. `GET /ready` (allow ~60 s for a cold start; M7). 200 expected.
2. Play Console: Android vitals crash and ANR rates, install/update errors, reviews, policy status (thresholds in the base checklist: crash 1.09%, ANR 0.47%; Play-side values REVIEWER REPORTED from that doc, not re-fetched).
3. SQL (aggregates only): users count, pending deletions and those older than 1 day (M10, M11), database size (M12), accounts vs cap (M5), rejected-session share (M1), stationary share (M2).
4. Vercel: website loads in a private window; privacy, deletion and support pages open (M13 count).
5. Mailbox info@movenrun.xyz and Play reviews: count and categorise (feedback categories in PLAY_CLOSED_TEST_PROGRAM.md).
Record each check in the table in section 6. Between checks do not poll; the free host wakes on every request.

## 3. Freeze triggers (stop widening; keep running)
Freeze = no new testers or rollout increase, no migrations, no config changes except to reduce exposure. Any one of:
| Trigger | Threshold (planning) |
|---|---|
| Sign-in failure rate rising | `verification_failed` > 20% of attempts in a day, or any `registration_closed` before the cap is reached (M4) |
| Storage | > 60% of 500 MB, or growth > 3x model (M12) |
| Deletion backlog | any pending provider deletion older than 1 day (M11), or any email deletion request > 7 days old (internal target) |
| Reports | 2 or more independent blank-map or crash reports in the same screen; any misleading-XP report with evidence of standing-still XP (M2 over 5%) |
| Provider | `/ready` 503 on two checks 15 min apart (M8); Supabase pause |
| Capacity | accounts >= 950 of 1,000 (owner decides cap, D-20) |

## 4. Rollback triggers (undo a change)
| Trigger | Action | Owner/engineer |
|---|---|---|
| Sign-in fails for real players for > 30 min and cause is the release (not a provider outage) | Halt staged rollout in Play Console; if the API was changed, Render rollback | Owner halts; engineer confirms cause |
| Crash or blank-map reports above Play thresholds, or reproducible on 2 devices | Halt rollout; keep previous build available; prepare fix-forward build (new versionCode) | Owner / engineer |
| Privacy leak: any evidence a route, coordinate, token, email or wallet address is exposed in a log, page, response or screenshot | Immediate freeze and halt; remove the exposing artefact (website: Vercel rollback; API: Render rollback); engineer writes an aggregate-only record; owner/legal determination on any notification | Owner decides; do not copy the leaked value into the record |
| Storage > 75% (375 MB planning value) | Freeze; owner lowers `max_accounts` to current count so no new sign-ups; decide retention or paid plan. Rollback of code does not reduce rows | Owner SQL; engineer proposes retention patch as a new migration, never editing 0000-0010 |
| Deletion stuck (pending provider deletion > 1 day, repeated) | Freeze; check Supabase secret key and status; fix forward; do not tell the user deletion is complete while pending (the copy discloses retry) | Engineer diagnoses; owner acts at provider |
| Wrong data in the wrong account | Halt and freeze immediately | Owner |

Rollback references (REVIEWER REPORTED, recorded in project memory, not re-verified; confirm in the dashboard before use):
- Render API: live `dep-db9m51qjnfac73cqh6eg` (2192de6); rollback target `dep-db9gqfrbc2fs73do581g` (7f4c0d4). Reviewer reported (E-62); confirm in the dashboard.
- Vercel website: production `dpl_ABCfgjsFiJ4DHtRnrLPCc8npLAuD` (61d30bb); rollback target `dpl_1pNg2cyGZ4MLWuqfsSHBtU9P1KBf`. Reviewer reported (E-79); confirm in the dashboard.
Steps: Render dashboard > service > Events/Deploys > roll back to the chosen deploy (auto-deploy is off: `autoDeployTrigger: off`, render.yaml @ 2326aa6); remember `startCommand` runs `db:migrate` on every start, so a rollback re-runs migrations of the older code against a database that may be newer: confirm the older build contains all applied migrations' expectations before rolling back (UNKNOWN for any future 0011; not applied). Vercel dashboard > Deployments > select the rollback deployment > promote. Play Console: halt staged rollout; a previous version can only be re-released as a new version code (Play rule, not re-fetched: confirm in console).

## 5. Communications template (owner sends; no fixed response promises)
```
Subject: MovenRun: <short factual title>

Hello,

<One or two plain sentences on what happened and when (UTC), with no personal data.>
<What it affects: sign-in / map / sessions / account deletion.>
<What you can do now, if anything.>
<What we are doing. We do not promise a time for a fix or a reply.>

Contact: info@movenrun.xyz

Team MovenRun
```
Rules: no response-time or fix-time promises (matches public copy, privacy P24 and support:27 @ 61d30bb); no user data in the message; do not describe deletion as complete while a provider record is pending; do not claim a cause before it is confirmed; privacy exposure wording needs owner/legal determination first.

## 6. Incident record (aggregate only)
| Time (UTC) | Check (R/+2/+6/+24/+48) | Version code | Rollout % | /ready | Crash % | ANR % | Rejected share | Pending deletions (>1 d) | DB size | Trigger hit | Action | By |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | | | |

Close-out after +48 h: owner and engineer sign the record; list fixes made (new SHA, new version code), unresolved items, and which thresholds to change.

## Integration digest
- Affected paths: this file only. Evidence: POST_LAUNCH_MONITORING.md, EVIDENCE_REGISTER E-62/E-63, render.yaml startCommand and autoDeployTrigger @ 2326aa6; website copy @ 61d30bb. No conflict with #125/#127/#128/#129.
- Risk to note: Render rollback re-runs migrations on start (section 4).
- Next decisions (owner): (1) confirm current Render and Vercel rollback ids; (2) confirm freeze/rollback thresholds; (3) name who is on call for each check time.
