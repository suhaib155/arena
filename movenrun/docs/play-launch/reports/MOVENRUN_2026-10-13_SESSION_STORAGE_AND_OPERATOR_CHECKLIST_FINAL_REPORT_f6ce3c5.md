# MovenRun: session storage fixes and the operator checklist

**Written:** 13 Oct 2026, 19:20 UTC
**Code described:** `f6ce3c5` on `chore/post-security-launch-prep` (not deployed; the deploy branch stays at dd83065)
**Target:** 2 Nov 2026 for engineering and pre-listing readiness, not a Play date.

STATUS: STOP — X-06 APPROVED, OPERATOR ACCESS REQUIRED; OTHER ENGINEERING CONTINUES

Engineering that can be done without you is finished for now. Every
remaining item needs an owner approval, an owner account or a vendor; see §6.

## 1. Resume check

| Check | Result |
|---|---|
| Newer branches or pushes | None. Newest remote refs are this work (caaf947, then this round), `deploy/render-free-staging` dd83065, `fix/play-auth-security-gate` b4612bb, `release/android-v1-cxfdbd` 991ac6a. Everything else dates from 11 Sep or earlier. `main` untouched |
| Is X-06 live on Render? | **Unknown from here, so not marked done.** `api.render.com`, the Supabase project URL and any `onrender.com` host are refused by this workspace's network policy. No proof has come back from you |
| Are migrations in the live Supabase project? | Same: cannot be checked here. X-06 stays **APPROVED, OPERATOR ACCESS REQUIRED** (D-32) |

## 2. Work done this round

| What | Result | Files |
|---|---|---|
| Database size for 1,000 accounts (was an inferred estimate) | **Measured** on local PostgreSQL 16 with synthetic players: typical use 55 MB, heavy use 323 MB of the 500 MB Free limit. Refreshes fill the database, not players (E-39) | `evidence/capacity-db-size.mjs`, `FREE_HOSTING_READINESS.md` |
| F-17 (Medium): device list lost other devices | After about 17 hours of use on one phone, other devices vanished from the list and could not be signed out one by one. **Fixed**: rotated refresh links are left out of the list query | `drizzle/stores.ts`, `memory.ts`, `interfaces.ts` |
| F-18 (Low): sessions never deleted | **Fixed**: sessions a week past refresh expiry are deleted by the background clean-up, at most 10,000 rows a run, hourly when due. No new migration | `session.service.ts`, `api/app.ts` |
| Data inventory | Session retention now reads "until 7 days after the refresh token expires" | `DATA_INVENTORY.md` |
| Ledgers | F-17/F-18, B-42–B-44, X-24, X-25, D-34, E-39, E-40, checkpoint | `AUTH_SECURITY_REVIEW.md`, `TASK_REGISTER.md`, `EXTERNAL_ACTIONS.md`, `DECISIONS.md`, `EVIDENCE_REGISTER.md`, `EXECUTION_STATUS.md`, `PR_DESCRIPTION.md` |

**Not changed:**
- The mobile app.
- The website.
- The homepage.
- The deploy branch.
- Any migration.

## 3. Tests (f6ce3c5)

| Suite | Result |
|---|---|
| Backend, on PostgreSQL 16 | 409/409, 0 skipped. Three tests are new; the device list test failed before the fix |
| API, with the compiled server | 17/17. On start-up, the clean-up deleted only the expired session |
| Build and type check | Pass |
| Secret scan | Clean |
| Website, shared, mobile | Unchanged since dd83065: 23/23, 156/156, 910/910 |

**Live versus unproven:** everything above is locally tested. Nothing is
hosted-tested, because X-06 has not been reported back.

## 4. Approvals

| Approval | State |
|---|---|
| Consumed | X-06 (approved; you run it) |
| Withheld | X-07, X-05, X-21, X-24 (new), X-25 (new decision), X-04/X-08, X-14, X-23, Play registration |

**X-21 is NOT approved.** The four page previews from the last report are
still current; no website file changed.

## 5. Risks

| Risk | State |
|---|---|
| F-06 wallet code phishing | Mitigated, not solved. Needs the phone test, then X-23 (app change, on hold) |
| Security log growth | About 1.2 MB a day for 1,000 hourly players, kept until account deletion (X-25) |
| Hosted API lacks F-17/F-18 until X-24 | Staging only. The device list gap needs long sessions, and storage growth takes weeks |
| Free host cold starts and restarts | About a minute to wake; clean-up catches up on wake |
| No Play developer account | X-01a/b; Play steps cannot start |
| No database backups on Free | Owner-run dump, drilled (D-33) |

## 6. Operator checklist (in priority order)

1. **X-06 (approved): deploy.** Follow `LIVE_SETUP_OPERATOR_GUIDE.md` gate X-06 on `deploy/render-free-staging` at dd83065:
   - Render Free, no payment method;
   - migrations 0000–0009 into project `tavxmwuwkeynbnzfwove` only.

   Send back:
   - the service URL;
   - the deploy id and commit;
   - the Free-plan screenshot;
   - the `/ready` and migration-hash outputs.
2. **Website review:** answer the four points in `WEBSITE_REVIEW_PREVIEW.md`:
   - the policy's effective date;
   - the 3-day and 30-day promises;
   - the sign-in fallback wording;
   - the homepage claims.
3. **X-24 (approval): move the deploy branch to f6ce3c5** once X-06 is verified, then use Manual Deploy.
4. **X-07 (approval): attach the sign-up hook** in Supabase. Run the read-only checks first.
5. **X-05 (approval): enable Google and Web3 sign-in,** then X-07b (quota 0, one refused sign-up proves the hook runs).
6. **X-22: confirm `info@movenrun.xyz` receives mail.**
7. **X-21 (approval): publish the website** after step 2.
8. **X-01a/b: create the Play developer account** (type chosen truthfully, US$25 fee).
9. **X-08, X-04 (approvals): Maps key and the preview APK build;** then X-10, the phone test, by 24 Oct.
10. **X-25 (decision): security log retention.**
11. **Later:** X-14 merge, X-09 AAB, X-11/X-12 Play Console and internal test, X-23 App Link return.

Next recommended action: run X-06 from `LIVE_SETUP_OPERATOR_GUIDE.md` on `deploy/render-free-staging` at dd83065 and send back the service URL, deploy id and `/ready` output.

Resume: read `EXECUTION_STATUS.md`, then this report; continue on `chore/post-security-launch-prep`; never move the deploy branch without owner approval.
