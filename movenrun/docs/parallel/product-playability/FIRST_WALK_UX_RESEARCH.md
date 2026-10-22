# First-walk UX research

The mobile UI is frozen. Everything here is research or a PROPOSED UX0 change
for the owner to approve separately. Nothing was tested with real people, and no
synthetic run or team member's walk is evidence of player retention.

## J1: first-time v1 player (the real app today)

| Step | Today at `15f7f87` | Friction or risk |
|---|---|---|
| Discover | Welcome: "Your next move starts here." Terms checkbox before any button | None found |
| Understand location | Intro step 1, then the `/move` rationale before the OS prompt: foreground only, never background | Intro step 2 says "Capture and defend" before any preview label |
| Sign in | Google or wallet, or "Start exploring" as a guest. Per the launch ledger both providers are OFF until the owner turns them on (hosted state, not checked by this track) | None found. `/move` states that only a signed-in save is sent to verify |
| Short genuine move | Start, acquire GPS (up to 30 s), walk | No safety line (S2-1); no hint to keep the screen on (S2-7); an honest 220 m city walk is rejected by the server (MR-A-01) |
| Honest progress | Distance and time on the session screen; "Cross your own trail…" seal hint | The seal hint is an instruction to return to a point |
| Stop, save, verify | Finish (2 taps), Summary, Save. Verification runs after XP is already shown | XP is shown before the server's verdict (MR-A-09). Below the threshold the summary explains it: "Move at least 200 m or 5 minutes to save a session and earn XP." |
| XP and next walk | XP banked once per day; "Back to Today" | The share card says "Move → Capture → Own" |
| Account controls | Account, Account security, Delete account | Guests see only "Reset progress" |

## J2: future territory pilot (not in the Play build)

Opt in, learn sealed loops and Solid and Shade, see the server's real regional
state, plan and finish a walk safely, claim, defend and decay, contribute to a
club, appeal a decision, and reset at season end. None of this exists in v1, and
no v1 screen may suggest it does. The map rules are in
[MAP_GEOGRAPHY_PRODUCT_SPEC.md](MAP_GEOGRAPHY_PRODUCT_SPEC.md). Per the V3 source,
an unsealed walk still earns normal progress, so J2 must never push a player to
close a loop.

## UX0 proposals

Each is small, copy or token level, and compared against the current app.

| Id | Change | Hypothesis | Benefit | Evidence to gather | Effort | Spoofing or unsafe-walking risk | Proof plan |
|---|---|---|---|---|---|---|---|
| UX0-1 | One safety line on `/move` and the session screen: "Stay aware of traffic. Stop any time." | People act on a reminder at the point of action | Fewer risky crossings; meets store safety expectations | Testers recall the line after the walk | 2 strings | None; lowers risk | Script T2: ask afterwards what the screen said about safety |
| UX0-2 | Pre-walk fact: "Keep MovenRun open while you move. Locking the screen pauses recording." | Users pocket the phone and lose route sections | Fewer silent gaps | Gap rate per session (QA0-18) | 1 string | None | Compare gap rate before and after on the same testers |
| UX0-3 | Replace "Cross your own trail, or finish near where you started, to seal this route." with "Sealing happens on its own if your route crosses itself. No need to change your path." | The current line makes people double back | Safer routes; matches V3 (unsealed walks still earn) | Share of walks that double back in the last 10% | 1 string | Lowers unsafe walking | T4: watch whether testers turn back near the end |
| UX0-4 | Remove "or try a demo route" from the denied and services-off copy in release builds | Users look for a button that is not there | Removes a dead end | Time to recover from a denial | 2 strings | None | T3: time from denial to a started session |
| UX0-5 | After a process kill, say on next launch: "Your last walk was interrupted and could not be saved." | Silent loss feels like a broken app | Trust; fewer repeat walks to "fix" it | QA0-20 | Small: one stored flag and one notice | None | T7 variant: kill the app mid-walk, note the tester's reaction on reopening |
| UX0-6 | Live-region announcements for the GPS chip and Pause/Resume | TalkBack users cannot tell when GPS is ready | Screen-reader users can start and pause safely | QA0-29 | Small | None | Two TalkBack testers complete T1 |
| UX0-7 | Text colour `textFaint` to `textDim` for text (icons unchanged) | Faint grey text is unreadable in sunlight | Readable summaries outdoors | QA0-32 | Token change | None | Testers read the summary in sunlight |
| UX0-8 | Soften "Defend N zones" (danger tone) and the quest quit dialog | Loss framing pushes people out or keeps them walking | Less pressure to walk when unsafe or tired | Tester comments | 3 strings | Lowers pressure | T5 and T6 |

No proposal raises a threshold, adds a reward or keeps more route data.

## Task scripts for consenting testers

The owner recruits testers. Each tester signs consent for observation. Walks
start and end at least 200 m from any home, in daylight, on pavements or in a
park. Observers note behaviour and quotes, never locations.

| Id | Task | Observe |
|---|---|---|
| T1 | "Install MovenRun and take a short walk of your choice." | Time to first started session; whether they understand Save; what they think XP means |
| T2 | "Walk to the end of the street and back, then stop." | Whether they look at the phone while walking; whether they notice any safety message |
| T3 | "When asked for location, choose Don't allow. Then try to walk anyway." | Whether they recover; time to recovery; any dead end |
| T4 | "Walk for about ten minutes anywhere you like." | Whether they change route to close a loop; how they read the seal hint |
| T5 | "Start a timed quest, then stop halfway." | Reaction to "You won't earn XP if you leave now" |
| T6 | "Look at what you have done today, then tell us what you own in the app." | Whether anyone believes they own a place, token or Deed |
| T7 | "Lock your phone, walk for two minutes, then look at your route." | Whether they notice and understand the gap |
| T8 | "Find how to delete your account." | Time to find it; confidence that it worked |

## Severity rubric

| Severity | Meaning | Examples |
|---|---|---|
| S1 | Blocks a user or creates a safety risk | A dead end with no way back; copy that tells people to hurry across a road |
| S2 | A significant barrier, or a claim the product does not keep | Unannounced GPS state for TalkBack users; "Own your season." |
| S3 | Minor friction | A 44 dp target; a label read twice |
| S4 | Cosmetic | Spacing |

A finding is raised one level if it affects safety or a legal claim, and if it
recurs for 3 or more testers.

## Metric definitions

These are definitions only. No measurement exists, and v1 has no analytics.
Each needs a privacy-reviewed event before it can be measured.

| Metric | Definition |
|---|---|
| Day-1 activation | Share of new installs that save at least one walk within 24 h of first open |
| Day-7 return | Share of day-1 activated users who save a walk on any day 2 to 7 |
| Completed walks | Sessions that reach Save, per active user per week |
| GPS permission dropout | Share of users who reach the location prompt and never start a session |
| Server verification error | Share of submitted sessions that end rejected, terminal or expired. Split by reason, and report "Too few GPS points" separately |
| Crash-free launches | Share of app launches with no crash before Home renders (Play Console vitals) |

## Outdoor-use notes

- **One-handed use**: Pause and Finish are at the bottom, at 58 dp. Good.
- **Below the V3 threshold**: the V3 source's 10 min and 750 m threshold is not in v1, which uses 200 m or 5 min. Do not raise the v1 threshold silently; slow walkers (W06) already struggle with the server's point floor.
- **Motion sickness**: the follow camera moves instantly under Reduce Motion. Good.
- **Battery**: high accuracy, 4 s and 5 m. GPS keeps running while paused; worth a device check.
- **Right-to-left**: no RTL layout work exists. A future note only.
