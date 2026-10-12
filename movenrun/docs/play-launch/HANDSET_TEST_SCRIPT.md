# Physical handset test script (M gate and Play internal test)

Run on a real Android phone outdoors. Record for each step: PASS / FAIL, the
phone model, Android version, build (EAS build id or Play version code) and
commit, plus a screenshot or short screen recording. Paste results into
`EVIDENCE_REGISTER.md`. A step not run is NOT a pass.

Run once on the **preview APK** from the exact release commit (M gate) and again
on the **Play internal-test install** (R gate, adds steps 15 to 17).

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
| 15 | Sign in with a real email (code arrives) and with the review account | Both sign in; Account shows no wallet copy |
| 16 | Account security → Delete account | Confirm dialog; account deleted; signed out; local progress cleared; signing in again creates a fresh account |
| 17 | Play-installed build: map tiles | Real Google map tiles (not grey). Grey tiles mean the Play App Signing SHA-1 is missing from the Maps key |
| 18 | Smallest supported screen / largest font size | No clipped CTAs; Move, Finish, Back reachable |
| 19 | Gesture nav and 3-button nav | Back behaves the same |
| 20 | Reduced motion on | No essential information lost |

Two-account check (B gate): accounts A and B on two phones (or reinstall
between). Each saves a session; reinstall the app; sign in again; each sees only
their own verified sessions; delete A; B unaffected.
