# Play closed-test program (personal developer account)

Checkpoint: 22 October 2026
Source heads: mobile 15f7f87 (#125, release candidate; no APK/AAB built yet); backend 2326aa6 (live API 2192de6); website 61d30bb; existing docs in docs/play-launch/ @ 2326aa6 (PLAY_CONSOLE_WORKSHEET, HANDSET_TEST_SCRIPT, ANDROID_DEVICE_GATE_PLAN). Official pages retrieved 2026-10-22.
Claim classes: SOURCE VERIFIED / LOCAL TEST CONFIRMED / REVIEWER REPORTED / OWNER-PROVIDER GATED / NOT RUN / UNKNOWN. The program starts only after the owner has a Play developer account (none exists as of last report). No account is created, no tester contacted and no form filled by this document.

## 1. The 2 November 2026 date
2 November 2026 is an engineering and pre-listing goal (build, internal-track smoke, store assets, closed-test start if the account allows). It is not a publication date and not a promise of public availability. The public site itself says nothing there is a commitment to a feature on a date (disclaimers:52 @ 61d30bb).

## 2. Two tracks, kept separate
| | Internal testing track | Closed testing track |
|---|---|---|
| Purpose | Smoke the Play-installed signed build: install, Maps tiles, sign-in, core loop | Qualify for production access and gather real feedback |
| Counts toward production access | No | Yes, only if 12+ testers are opted in to the closed test for 14 consecutive days before applying |
| Testers | Owner and a few trusted people (devices already used for HANDSET_TEST_SCRIPT) | At least 12 genuine opted-in testers, ideally 15-20 to survive drop-outs |
| Evidence kept | Step results per HANDSET_TEST_SCRIPT, Maps tile check | Daily scorecard (section 8), feedback log, fixes, retests |
Rules (SOURCE VERIFIED, https://support.google.com/googleplay/android-developer/answer/14151465): applies to personal accounts created after 13 Nov 2023; Production stays disabled until met; "At least 12 testers must be opted in to your closed test when you apply for production access"; testers who leave before 14 days do not count; opt-out then back in requires the 14 days to be consecutive; review "usually takes seven days or less, but can occasionally take longer"; fewer than 12 opted-in testers or low engagement may mean continued testing.
Do not report internal-track activity as closed-test engagement.

## 3. Earliest realistic timeline (relative, not promises)
Day 0 = the day the Play developer account is verified and usable (OWNER-PROVIDER GATED; duration UNKNOWN).
1. Day 0 to build: enable Play App Signing, upload the first signed AAB (EAS production profile builds an AAB, mobile/eas.json:14-19 @ 15f7f87). Needs: owner decisions already open in EXTERNAL_ACTIONS (Maps key, signing, listing).
2. Internal-track smoke: days after the first upload, bounded by owner device time.
3. Closed test live and 12+ testers opted in: Day T. Production application can be filed no earlier than Day T + 14 (consecutive).
4. Google review: up to about 7 days, sometimes longer.
So production access is at least Day T + 14 plus review. From 22 October there are 11 days to 2 November, fewer than the 14 consecutive days alone, so 2 November cannot be a production date for a new personal account (arithmetic from the cited rule). The Maps key must include the Play App Signing SHA-1 or the Play-installed build shows grey tiles (HANDSET_TEST_SCRIPT step 17 @ 2326aa6); this cannot be proven before a Play-installed build exists (NOT RUN).

## 4. Recruiting genuine testers
- Ask people who will really use a walking game and can follow the tester script; explain in plain words: the app uses precise location only while open and in a session, never in the background; it sends a route once to be verified and keeps a summary; accounts can be deleted in the app and on the website.
- No payment, gift cards, rewards or incentives for installing, rating or reviewing; no fake or duplicate accounts; no review requests tied to anything. Testers may leave honest feedback privately; a Play review is never required.
- Testers join via the closed-test opt-in link or a Google Group/email list the owner controls (OWNER-PROVIDER GATED: tester list mechanics UNKNOWN until console is open). Collect only an email needed for the list; keep it out of shared documents.
- Tell testers that staying opted in for 14 days matters and that leaving early forfeits the count.
- Mix: at least 3 different Android versions and 3 device makes where possible; at least 2 testers who use TalkBack or large font.
- Ask for consent for the feedback form: anonymous by default; no coordinates or route screenshots wanted.

## 5. Distribution
Only the Play-installed signed AAB is the test artifact for this program. A sideloaded preview APK (mobile/eas.json:7-12, buildType apk) is for the owner's pre-gate device checks only and is not given to closed testers. Play App Signing certificate SHA-1 must be added to the Maps key restrictions before Play testers see tiles. Release notes for testers name known limits (cold-start waits up to ~1 min, section 6 script P).

## 6. Tester task scripts (each step: do, then record pass/fail and a category)
Map on the repo's HANDSET_TEST_SCRIPT steps; this adds tester-facing wording.
| ID | Task | What to note |
|---|---|---|
| T1 | First Google sign-in (first attempt after a quiet period may wait up to ~1 min; wait, do not tap repeatedly) | Time to finish, any error text (no screenshots of account details) |
| T2 | Wallet sign-in: only if the owner enables it for this build (providers last reported OFF); otherwise skip and record "not offered" | Never use a funded wallet; no recovery phrase anywhere |
| T3 | Location: deny permission, observe messaging; then re-permit via settings | Is the reason for location clear before the prompt? |
| T4 | Stand still for 5 minutes in a session | XP or distance should not increase (misleading XP if it does) |
| T5 | Walk 100-300 m outdoors in a session | Distance plausible vs a map app; map follows you |
| T6 | Pause and resume mid-walk | Timer and distance behave |
| T7 | Airplane mode at the end of a walk; save; reconnect; reopen the app | Result verifies later; no duplicate (queue retries on foreground, 6 attempts/7 days) |
| T8 | Complete one daily quest; try again the same day | XP once only (useGameStore.ts:253 @ 15f7f87) |
| T9 | Delete the account in the app (Profile > Account > Account security > Delete account); sign in again | Fresh account, no old sessions |
| T10 | Accessibility: TalkBack or font scale 200%; can you finish T1-T6? | Barriers, unlabeled controls |
| T11 | Battery: note percentage before and after a 20 min session, screen on/off | Unusual drain |
| T12 | Kill and reopen the app during and after a session | State recovers |
| P | Cold start: leave the app closed 20+ min, open, sign in | Perceived wait |

## 7. Feedback categories, rubric and severity
Categories: crash; blank map; GPS inaccuracy; misleading XP; signup failure; privacy concern; navigation difficulty; accessibility barrier.
Anonymous form fields (no name, email, coordinates or route): category; step ID; Android version and device make (not model serial); app version; what happened; what you expected; frequency (once/sometimes/always); severity guess 1-4; screenshot only if it contains no map location or account detail (tester decides).
Triage rubric (engineer applies):
| Severity | Meaning | Examples | Response |
|---|---|---|---|
| S1 | Blocks use or exposes data | Crash on launch, cannot sign in, route/coordinate/token exposed, wrong account data | Freeze closed test additions; fix-forward build; owner notified same day |
| S2 | Core loop wrong | Blank map, standing-still XP, session lost, deletion fails | Fix before applying for production |
| S3 | Degraded | GPS drift, slow wake, confusing copy, TalkBack gaps | Fix or document before production |
| S4 | Polish | Wording, spacing | Backlog |
Fix-retest loop: log (aggregate IDs only) > reproduce on a device > fix on a branch > new signed build to the closed track > ask the same tester to retest the step > mark retested with date. A fix-forward build changes versionCode only via EAS remote counter (appVersionSource remote, mobile/eas.json:3-4 @ 15f7f87). Changes during the 14 days do not reset the opt-in count.

## 8. Daily scorecard (14 days; fill one row per day)
| Day | Date | Opted-in testers (>= 12) | Dropped out | Active testers | Sessions completed | Feedback items | S1 open | S2 open | Fixes shipped | Retests passed | Crash % (vitals) | /ready ok | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | | | | | | |
| 2 | | | | | | | | | | | | | |
| 3 | | | | | | | | | | | | | |
| 4 | | | | | | | | | | | | | |
| 5 | | | | | | | | | | | | | |
| 6 | | | | | | | | | | | | | |
| 7 | | | | | | | | | | | | | |
| 8 | | | | | | | | | | | | | |
| 9 | | | | | | | | | | | | | |
| 10 | | | | | | | | | | | | | |
| 11 | | | | | | | | | | | | | |
| 12 | | | | | | | | | | | | | |
| 13 | | | | | | | | | | | | | |
| 14 | | | | | | | | | | | | | |
Qualification check on day 14: opted-in count still >= 12 and consecutive; no S1 open; S2 items fixed or explained.

## 9. Evidence to keep for the production-access questions
The form has sections "About your closed test", "About your app/game", "About your production readiness" and asks for a summary of tester feedback (14151465, 2026-10-22). Keep: tester count by day (from the console); the scorecard; an anonymised feedback summary by category with counts; list of fixes with SHA and version code; retest results; crash/ANR figures from Android vitals; the data safety, health, financial and account-deletion declarations as filed (PLAY_CONSOLE_WORKSHEET.md @ 2326aa6). Do not keep tester emails in shared evidence. Declarations are the owner's determination.

## 10. Reviewer access without an auth bypass
Per the worksheet draft, App access is "some functionality restricted": sign-in is optional and Continue with Google works with any Google account; no credentials are supplied and no reviewer credentials, codes or test wallets exist (PLAY_CONSOLE_WORKSHEET.md:28,60-77; D-21 @ 2326aa6). Keep it that way: no hard-coded account, no bypass code, no engineer's personal credentials. Whether Play accepts this wording is OWNER-PROVIDER GATED (REQUIRES_OWNER/CONSOLE_CONFIRMATION). The 1,000-account cap and 50-per-hour quota could refuse a reviewer sign-up if exhausted: check headroom (`account_capacity`, M5) before submitting for review.

## Integration digest
- Affected paths: this file only. Evidence: 14151465 retrieved 2026-10-22; PLAY_CONSOLE_WORKSHEET, HANDSET_TEST_SCRIPT @ 2326aa6; eas.json and useGameStore @ 15f7f87. No conflict with #125/#127/#128/#129.
- UNKNOWN: Play account verification time; tester list mechanics; Maps key SHA-1 effect until a Play-installed build exists; reviewer-access acceptance.
- Next decisions (owner): (1) start account creation now (longest external dependency); (2) decide whether wallet sign-in is in the first build; (3) name the tester pool owner and a feedback-form host that adds no tracker.
