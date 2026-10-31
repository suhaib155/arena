# MovenRun 30 Oct 2026 (second pass): owner decisions of 14:02Z

Gameplay line `feat/g34-server-holdings` at `d81867b`. Android line `integration/android-qa0-28oct` at `ac8d87b`. Deploy branch and #162 unchanged. Continues `MOVENRUN_2026-10-30_ERASURE_QUEUE_ANDROID_TRUTH_FINAL_REPORT_a1cbdbf.md`.

## Done
| Decision | Result |
|---|---|
| Deletion wording ("Deletion requested / pending"; never claim permanent deletion while provider removal is outstanding) | Merged: #185 website (86267a9, includes privacy page backup claim removed as unverified), #184 app (ac8d87b). Independent review applied. `DELETION_COPY_AUDIT_30OCT.md` lists 22 other places, not edited. |
| Deletion queue policy (30-day receipts, 40 attempts, 5-minute cap, 120 s lease, operator-only requeue with audit) | Merged #186 (d81867b). Lease was already 120 s; pinned by tests. Purge exactly 720 hours, outstanding jobs never purged, no HTTP requeue route (pinned). Queue and 0011 stay inactive. Strict suite 711/711. |
| DEP-EXC-2026-001 to 21 Nov, reassess by 14 Nov, no auto extension | Recorded as approved in chat; signature lines left blank. |
| Vercel read-only | Unchanged; nothing disconnected. |

## Not done, needs access I do not have
- X-04 EAS preview APK from `02d8ca9` against `https://movenrun-staging-api.onrender.com`: no Expo/EAS credentials or CLI here, so the build and the pre-build checks (restricted Maps key, signing, env vars, build quota) are unverified. The APK from `02d8ca9` does not include the deletion wording fix (#184 is later). Handset checklist follows the build; movement tests needing newer server rules are BLOCKED against the older staging backend.
- Hosted HTTP smoke tests: outbound HTTP returns 403 here; plan in `STAGING_SMOKE_TEST_PLAN_30OCT.md`.

## Open points
- The app's 202/409/503 handling is client-side only until the queue is promoted; staging runs the older server.
- If pending provider removal should count as an outstanding job, the retry loop must write `provider_stage` back first.
- The e2e script `web-sign-in-deletion-e2e.mjs` should gain a pending-case check.
- One unrelated PG test (`proofImmutability`) failed once on a shared local cluster and passed on rerun; CI was green.
