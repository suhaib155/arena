# Physical handset test script (M gate and Play internal test)

Run on a real Android phone outdoors. Record for each step: PASS / FAIL, the
phone model, Android version, build (EAS build id or Play version code) and
commit, plus a screenshot or short screen recording. Paste results into
`EVIDENCE_REGISTER.md`. A step not run is NOT a pass.

Run once on the **preview APK** from the exact release commit (M gate) and again
on the **Play internal-test install** (R gate, adds steps 16 to 17). Steps
15a–15f need a wallet app installed (no funds needed) and must pass on a phone
by 24 Oct, otherwise the release flags `WALLET_LOGIN_BLOCKED` (DECISIONS D-19).

| # | Step | Expected |
|---|---|---|
| 1 | Fresh install, cold start | Splash with MovenRun icon on light background, then welcome. No crash, no blank screen |
| 2 | Accept Terms, tap Start exploring | Home task board. No Clubs tab: bar is Home · Territory · Move · Profile |
| 3 | Start Free Run, deny location | Clear explanation, a way to retry or open settings, no crash |
| 4 | Allow "only while using", choose approximate location | Session explains reduced precision honestly; no fabricated route |
| 5 | Allow precise; stand still 60–90 s | Marker shows; distance ≈ 0 m; no route line grows |
| 6 | Stand still 5 min, finish and save | No movement XP, no streak, no defence credit |
| 7 | Walk 100–300 m | Route grows along real streets on Google map tiles; distance plausible |
| 8 | Pause, walk 50 m, resume, walk | No straight bridge across the paused gap; paused distance not counted |
| 9 | Start a quest, finish early | 0 XP |
| 10 | Complete a valid quest | XP awarded exactly once; repeating the same day gives none |
| 11 | Summary → hardware Back with unsaved session | Confirmation; Cancel stays; Leave discards; saved/short cases behave |
| 12 | Share route image to a messaging app | Image arrives; endpoints hidden by default; no raw coordinates text |
| 13 | Kill app during and after a session, relaunch | No old route resurrects on zone detail or summary |
| 14 | Airplane mode during save (signed in) | Shows pending; after network returns, verified once (not twice) |
| 15a | Continue with Google (Chrome Custom Tab opens, pick an account) | Returns to the app signed in; no "unmatched route" screen; Account shows verified-session count |
| 15b | Sign out, Continue with Google again with the same Google account | Same account (same verified-session count) |
| 15c | Continue with Wallet → MetaMask (or Coinbase Wallet / Trust Wallet) | Wallet opens movenrun.xyz/sign-in/; the message names movenrun.xyz and says it is not a transaction; no transaction, network switch or approval is requested |
| 15d | Sign in the wallet | Wallet returns to MovenRun signed in. If it does not, the page shows a 12-character code; typing it in the app signs in. Record which happened per wallet app |
| 15e | Save a verified session while signed in with the wallet, then Account security → Delete account | Session verifies; deletion succeeds; signing in with the same wallet again creates a fresh account with 0 sessions |
| 15f | Kill the app while the wallet is open, sign in the wallet, reopen MovenRun | The code field is shown; the code from the page signs in |
| 15g | Leave the API idle for 20 minutes (it sleeps), open the app, then Continue with Google | Signs in within about a minute, or shows "MovenRun took too long to answer…" with the buttons usable again. Never an endless spinner. Record the time taken |
| 16 | Google account: Account security → Delete account; then delete on the web for a second account at movenrun.xyz/account-deletion/ | Confirm dialog; account deleted; signed out; local progress cleared; signing in again creates a fresh account; web deletion signs out the phone |
| 17 | Play-installed build: map tiles | Real Google map tiles (not grey). Grey tiles mean the Play App Signing SHA-1 is missing from the Maps key |
| 18 | Smallest supported screen / largest font size | No clipped CTAs; Move, Finish, Back reachable |
| 19 | Gesture nav and 3-button nav | Back behaves the same |
| 20 | Reduced motion on | No essential information lost |

Two-account check (B gate): accounts A and B on two phones (or reinstall
between). Each signs in and saves a verified session. Reinstall the app and sign
in again: Profile → Account shows "N verified sessions saved to this account"
with that account's own count and distance only. Local XP, streaks and quests do
not come back after a reinstall (known v1 limit, DECISIONS D-07). Delete A; sign
in as B: B's count is unchanged.
