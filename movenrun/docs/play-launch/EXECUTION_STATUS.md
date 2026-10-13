# Execution status

**Updated:** 2026-10-13 · **Branch:** `release/android-v1-cxfdbd` (based on `main` d344c3b, not merged) · **Status:** ENGINEERING COMPLETE — EXTERNAL STORE GATES REMAIN

Start here when resuming. Then read `TASK_REGISTER.md` and `EXTERNAL_ACTIONS.md`.

## Gates

| Gate | Meaning | State |
|---|---|---|
| M | Mobile release candidate (code, tests, config) | Code complete and tested (E-01–E-08). Physical phone run outstanding (X-04, X-10) |
| B | Backend hosted, auth working | Code complete (E-03, E-12, E-13), managed-Postgres ready (E-17 verified TLS, E-18 RLS). No-cost staging runbook ready; provisioning needs the owner's dashboards (X-03, X-05) |
| P | Privacy policy and account deletion | In-app and web deletion working (E-09–E-11, E-16). Placeholders and deployment outstanding (X-02, X-03) |
| G | Store graphics and listing | Icon, feature graphic, listing text done (E-14). Screenshots need the Play build (X-13) |
| R | Signed production AAB, Play internal test | Workflow ready. Needs merge, EAS variables, approval environment (X-08, X-09, X-14) |
| L | Production launch and 48-hour monitoring | Owner only (X-15, X-16, X-18); monitoring plan ready |

## Engineering done in this pass

Integrated #102–#105; froze Path A scope with a tested switchboard and route
guard; removed economy and ownership copy; account deletion in app, API and web;
reviewer sign-in through secrets; verified-session history on Account; daily
purge of expired sign-in codes; EAS production profile, permission removal,
production AAB workflow and Hermes CI check; new icons, splash, Play icon and
feature graphic; privacy, deletion and support pages; launch ledger.

## Checkpoint 2026-10-13

Remote re-checked: no one else pushed to the release branch and `main` is
unchanged (d344c3b). Supabase and Composio tools are not reachable from this
workspace and supabase.com is blocked by its network policy, so nothing was
provisioned. Added: migration `0006_row_level_security` (E-18), a verified-TLS
proof for managed Postgres (E-17), the no-cost staging runbook
`HOSTING_SUPABASE_FREE.md`, and `POST_LAUNCH_MONITORING.md`.

## Remaining engineering (not blocking launch)

- B-07 shared rate limiter if the API ever runs on more than one instance.
- M-08 restore local XP and streaks from the server (deferred, D-07).

## Safety record

No merge, publish, payment, onchain transaction, contract change or production
data change was made. No secrets were committed.
