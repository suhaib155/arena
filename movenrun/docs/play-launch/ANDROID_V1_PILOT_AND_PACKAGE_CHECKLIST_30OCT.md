# Android v1: first pilot procedure and Play package honesty checklist (30 Oct 2026)

Nothing here has been run. No APK exists, no phone was used, no Play account
exists (X-01), and no Play date is promised: 2 November is an engineering and
pre-listing target only (D-24). Use this after the preview APK in
`ANDROID_PREVIEW_APK_BUILD_REQUEST_30OCT.md` is approved and built, with the
rows in `ANDROID_V1_PHONE_TEST_PLAN.md`.

## 1. Twenty-minute pilot usability procedure

Goal: one person records one real walk and understands the result. This is a
usability observation, not a retention or earnings study, and it produces no
statistics.

**Who and where.** One adult who has not seen the app, on a phone with the
preview APK, outdoors in a safe place with a clear sky. A second person
observes and takes notes. The participant uses a test Google account only if
H-8 is unblocked; otherwise guest play. Tell them it is a test build, that
nothing earns money, and that they can stop at any time.

| Min | What happens | What the observer records |
|---|---|---|
| 0 to 2 | Hand over the phone with the app closed. Say only: "Record a short walk and tell me what the app says about it." Do not explain screens | Where they hesitate on first launch; whether they notice the Terms and the intro |
| 2 to 4 | They reach Move and are asked for location. They choose what to allow | Which permission they pick; whether the copy made sense; any request for background location (there must be none) |
| 4 to 6 | Standing still at the start, they press Start. The observer asks them to wait 30 seconds | The distance shown while still (a number); whether they understand the phone is finding its position |
| 6 to 14 | They walk a safe loop of about 300 to 400 m and return near the start, screen on | Whether the loop preview ("loop closed", "Loop preview") is understood; whether they expect a reward from it; any look of confusion or stopping to read while walking |
| 14 to 16 | They finish and read the summary aloud: distance, time, XP | In their words: what the XP number means. The correct reading is "an estimate on this phone until the server check says otherwise" |
| 16 to 18 | They press Save. Then they look at Home | Do they say the XP is theirs for certain? Do they find "XP today (est.)"? Does "Verified" or "Not eligible" appear, and do they understand it? |
| 18 to 20 | Open question: "What did this app just do for you? Is anything here worth money? Who owns the ground on the map?" | Direct quotes, especially about money, ownership and who else can see them |

**Success.** The participant records a walk without help, can say in their own
words that XP is in-app progress, that it was estimated until checked, and that
the map ground is a preview and not ownership. Any belief in money, tokens,
ownership, other players or leaderboards is a copy defect: write it down with
the screen name and quote.

**Do not.** Coach during the walk, ask for coordinates, record the route
screen, or keep the participant's email. Evidence follows the rules in the
phone test plan.

**Real phone evidence that closes the open gates.**

| Gate | Closed only by |
|---|---|
| GPS | H-3 stationary number, H-4(a) small loop, H-5 track loop and long walk, H-6 vehicle segment |
| Maps | H-11(a) real tiles with the signing SHA-1 on the key |
| Hermes | H-1 three cold starts with an empty error grep |
| Authentication | H-8 Google (and wallet), H-9 forged links refused |
| Deletion | H-10 in-app deletion, fresh re-sign-in, owner server check, website deletion |
| Privacy | H-12(b) backup refused and a real transfer bringing nothing |

## 2. Play package honesty checklist

Short list of claims the package may make. Each item is OPEN until the cited
evidence exists. Play Console registration and any public release are owner
gates. Do not state a public release date.

| # | Claim | Honest wording | Evidence needed | State |
|---|---|---|---|---|
| 1 | Signed AAB | "A signed app bundle exists" only after the production profile built and its checks passed | `eas-production-aab.yml` run, `bundletool` checks, 16 KiB on the AAB | NOT BUILT |
| 2 | Internal and closed test readiness | "Ready to upload to internal testing" means the AAB, listing, declarations and reviewer notes are done; it does not mean a track exists | Play account (X-01), upload by the owner | BLOCKED on X-01 |
| 3 | Account deletion | In-app path (Profile, Account, Account security, Delete account) and the public web page `movenrun.xyz/account-deletion/` both work. The text says account data is deleted and removal of the sign-in record is requested and may still be finishing | H-10 and the owner's server check; the web page opened without the app | NOT RUN |
| 4 | Privacy policy and Data safety | Location is collected only in the foreground during a session; with an account, a summary of each verified session is stored; raw GPS points are not stored on the server; no ads, no analytics | `DATA_INVENTORY.md`, `PLAY_CONSOLE_WORKSHEET.md` Data safety, owner confirmation | Drafted, owner to confirm |
| 5 | Foreground location | Foreground only, no background location permission, no foreground service | H-12(a) permission list; H-4(d) background stop | NOT RUN |
| 6 | Fitness and health declaration | Activity and Fitness, as the worksheet says; not "no health features" | Owner and legal confirmation | Drafted, owner to confirm |
| 7 | Financial and crypto declarations | No financial features. A wallet signs one sign-in message; no transactions, keys, balances, tokens, NFTs or blockchain rewards. Do not answer "no wallet features" | Worksheet wording; H-8 wallet prompt shows signature only | Drafted, owner to confirm |
| 8 | Store text | No claim of ownership, tokens, payouts, live competition, leaderboards or guaranteed progress. XP is in-app progress with no cash value. Timed missions pay XP on finishing the timer; movement XP is estimated until a server check | `STORE_LISTING.md` (corrected in the 29 Oct audit), `v1TextTruth30oct.test.ts` | Drafted |
| 9 | Screenshots | Taken from the real app on a real phone, after the copy fixes, showing no coordinates, no place names, no email, no wallet address, and no Technical info or Deed screens | Phone run | NOT TAKEN |
| 10 | Support contact and website | A working address and a live site | Owner | Owner |
| 11 | Age rating and target audience | Questionnaire as drafted; 13 and over; not designed for children | Owner confirms in the console | Drafted |
| 12 | Test credentials and review notes | Sign-in is optional; reviewers can use guest play or their own Google account; no credentials are supplied; explain that location must be allowed outdoors or with a mock location for the Move screen | Console acceptance | Drafted, owner to confirm |
| 13 | Maps key | Restricted to `io.movenrun.app` and both signing SHA-1 values (preview keystore, Play App Signing) | Owner in Cloud Console | NOT CHECKED |
| 14 | Dependency advisory | Internal register item DEP-EXC-2026-001 until 21 Nov 2026, reassessment by 14 Nov; not a Data safety answer | H-9 | Open |

A claim stays out of the listing, the declarations and the reviewer notes until
its evidence row is closed.
