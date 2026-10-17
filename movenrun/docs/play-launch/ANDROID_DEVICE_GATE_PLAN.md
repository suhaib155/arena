# Android device gate plan (due 24 Oct 2026)

QA planning only. No app change is made for it (D-25). The gate proves, on a
real phone and the exact preview APK, that Google sign-in, wallet sign-in,
deletion and the free host behave as the local tests say. Steps are in
`HANDSET_TEST_SCRIPT.md`; this file says when, with what, and what counts as
a pass.

## Preconditions (all owner, in order)

1. X-06, X-07, X-05 (with the X-07b hook proof) and X-21 passed
   (`LIVE_SETUP_OPERATOR_GUIDE.md`).
2. X-08 build settings, then X-04 preview APK built from the commit under test.
   Record the EAS build id and the commit.
3. The phone: Android 12 or later (Android 14+ preferred), Google Play
   services, a Google account, and **at least one** of MetaMask, Coinbase
   Wallet or Trust Wallet with a fresh test wallet (no funds; never your main
   wallet, never type a recovery phrase anywhere for this test).
4. Outdoors with GPS for steps 5–8.

## Schedule

| Day | Work |
|---|---|
| By 20 Oct | X-06 → X-07 → X-05 → X-21 done; X-08; X-04 APK built |
| 21–22 Oct | Steps 1–14 (movement) and 15a–15b (Google) |
| 22–23 Oct | Steps 15c–15h (wallet, deletion, cold start, F-06 check) with each wallet available; two-account check |
| 24 Oct | Decision: PASS, or `WALLET_LOGIN_BLOCKED` (D-19) |

If the live setup slips, the gate slips with it; it cannot be passed with a
stand-in.

## Pass rules

| Area | Pass | Fail → |
|---|---|---|
| Google (15a, 15b, 16) | Signs in, same account on repeat, deletion removes it | STOP: release blocker, fix before anything else |
| Wallet (15c–15f) | With at least one wallet app: signs in by the automatic return **or** the typed code; deletion works; no transaction, network switch or approval is ever requested | `WALLET_LOGIN_BLOCKED`: owner decides Google-only v1 (the `SIGN_IN_METHODS` switch, already built and tested) or a deferral |
| Any request beyond one `personal_sign` | Never happens | STOP: security blocker |
| Cold start (15g) | Signs in within about a minute, or a clear retry message with working buttons | Record; acceptable on the free host only if the retry works |
| F-06 check (15h) | The warning shows on a sign-in the app did not start | STOP until the copy is visible |
| QA-04 (record only) | Per wallet: did the browser hand `movenrun://` back to the app? | Input to the X-23 App Link decision |
| Capacity (QA-02) | Two accounts each see only their own sessions; deleting one leaves the other intact | STOP |
| Backup and transfer (A2) | The installed APK's merged manifest has `allowBackup="false"` and `dataExtractionRules`; `adb shell bmgr backupnow io.movenrun.app` backs nothing up; after a phone-to-phone transfer (Android 12+) the app opens signed out with no unsent session | STOP: privacy blocker |

A step not run is not a pass. Any crash is a fail.

## What to record (in `EVIDENCE_REGISTER.md`)

Phone model, Android version, wallet app and version, EAS build id, commit,
PASS/FAIL per step, and a screenshot or short recording for 15a, 15c, 15d,
15e and 15h. Never record wallet addresses beyond the first and last four
characters, emails, or codes.

## Afterwards

PASS → X-14 (merge decision), X-09 (production AAB), then Play once X-01b is
done: X-11, X-12 (re-run steps 15a–17 on the Play install, App bundle
explorer for 64-bit and 16 KB).
