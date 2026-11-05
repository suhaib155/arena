# Android v1 candidate: ancestry, text-truth audit and fixes (30 Oct 2026)

Branch `feat/android-rc-truth-30oct`, cut from `integration/android-qa0-28oct`
at `79b223b`. **No build ran. Nothing was checked on an APK or a phone.**
Every handset row is NOT RUN. This work needs the text-truth exception the
owner approved on 30 Oct for necessary truthful copy corrections only: no
layout, navigation (other than hiding one row), styling or new feature changed.

## 1. Ancestry and the smallest safe chain

Read from git on 30 Oct, not from memory.

| Item | State | In `79b223b` |
|---|---|---|
| #161 (base `preview/android-qa0-candidate`, head the integration branch) | open; the integration branch is 21 commits ahead of `15f7f87` | yes, it is the branch |
| #169 test discovery | merged | yes |
| #177 release-candidate guard and gates | merged | yes |
| #178 DEP-EXC reachability proof and Vercel plan | merged | yes |
| #159 truthful copy (one commit `00eee3e` on `15f7f87`) | open | **no** |
| #132, #142 handset worksheets | open, docs only | no (superseded by `ANDROID_V1_PHONE_TEST_PLAN.md`) |
| #166 stationary-risk rule (server only, off) | open against the integration branch | no (decision O-4; no app change) |
| #154 blanket 4x drift rule | rejected | no; the guard test fails if it appears |

**Smallest chain for one coherent candidate:**
`integration/android-qa0-28oct` (`79b223b`) + #159 (cherry-picked cleanly as
`f21ce32`, no conflicts, author preserved) + this branch's truth commit
(`745cfef`) + documents. Merge nothing else: no gameplay branch, no
migration 0011, no website branch, no #166. After review, #159 is superseded
by this chain and can be closed, as can #132 and #142.

Preserved and re-checked by existing tests that pass on this branch: Expo SDK
54 and target API 36, Hermes with the h3-js fix, foreground-only location, no
background or foreground-service permission, backup off, no cleartext traffic,
package `io.movenrun.app`, the four deferred feature flags all false.

## 2. Truth matrix

"Estimated" means the phone's own measurement. "Verified" means a server
verdict arrived. v1 has no token, no transferable Deed, no payout, no live
territory and no competition.

| Screen | Claim before | Problem | After | Test |
|---|---|---|---|---|
| Home, "XP today" | Sum of history rows | Rows hold the Save-time estimate and are never adjusted: estimate 53, server declined, total XP 0, tile still "+53" (T3, reproduced) | Subtracts the XP the server took back for sessions saved today; tile reads "XP today (est.)" while any session saved today has no verdict | `tasks.test.ts` T3 cases (3 failed before, pass after) |
| Home, intro and questline | "Capture and defend", "zone you own" | Live capture and ownership | "Explore new ground", "local preview"; step title "Refresh a preview zone" | `v1TruthfulClaims.test.ts` (#159) |
| Move, live card | "Make your mark", "Sealed sections are banked" | Implies banking and a server-recognised seal; the phone runs v1 closing rules, not the server's stricter gameplay rules | "Loop preview"; "Loop closed on this phone ... This is a preview and nothing is claimed"; labels say "loop closed" | `sealing.test.ts`, `v1TextTruth30oct.test.ts` |
| Move, permission states | "or try a demo route" | The demo button exists only in development builds | Clause removed | `v1TextTruth30oct.test.ts` |
| Move, offline note | "syncs later" | Guests send nothing | "If you are signed in, the server check waits until you are back online" | `moveReadiness.test.ts` |
| Summary, XP card | "+N XP", "Earn on save" | Estimate shown as earned | "+N XP" with "Estimate, counts when saved"; after Save: Estimated on this phone, Estimated waiting for the server check, Verified, or Not eligible | `v1TextTruth30oct.test.ts` |
| Summary, server line | "Needs review"; "Server check: sealed" | Nobody reviews; "sealed" reads as claimable land | "Not eligible"; "Server check: loop closed (preview rules)"; "Loop check not run" | `verifiedMovement.test.ts` |
| Summary, save and hint | "Save + preview capture", "Capture preview" | Local preview that no server agrees to | "Save session"; "Explored (local preview)" | `v1TextTruth30oct.test.ts` |
| Zone result | "Zone Captured" | Same | "Zone Explored"; the note card already says the ground is a personal preview | `v1TextTruth30oct.test.ts` |
| Quest | Timed quests pay XP on the timer | Accurate: in-app XP once per day, labelled "XP earned" | No change | existing |
| Territory intro | "Own: Zone Deeds are a preview ..." | Names Deeds, which v1 hides | "Preview: your ground is a personal preview kept on this device. It is not ownership of any place. No token, no wallet, no rewards, and no value" | `territoryIntro.test.ts` |
| Profile, Settings | "Technical info" row leading to Base Sepolia contracts and the token contract | Testnet token contract presented in a v1 app | Row hidden and `/settings/technical` added to the deferred `wallets` routes | `releaseScope.test.ts`, `phase5Guards.test.ts` |
| Legal | "territory and Deed previews do not establish permanent ownership" | Implies temporary ownership, names Deeds | "Your ground on the map is a personal preview on this device. It is not ownership of any place." | `phase5Guards.test.ts` |
| Deletion (dialog, success alert, legal) | "permanently deleted" | The sign-in record removal may still be finishing | Account data deleted, removal of the sign-in record requested and may still be finishing (#159) | `v1TruthfulClaims.test.ts` |
| Share card, season screen | "Move, Capture, Own", "Own your season" | Ownership | "Move, Explore, Progress", "Shape your season" (#159) | `v1TruthfulClaims.test.ts` |

**Seal preview decision.** The phone's closing rules are not the future gameplay
pilot's sealing v2 (minimum area, no out-and-back or spur loops), and that code
is not in this candidate. The preview is therefore explicitly provisional:
the header comment of `sealPreview.ts` says so, every label says "closed", and
no H3 identifier or hexagon id is rendered. The summary's small hexagon row is
decorative and shows no id.

**Kept out, re-checked.** The 4x stationary filter and the stationary-risk rule
id and variable are absent from `mobile/app`, `mobile/src` and `shared/src`
(`releaseCandidateMovementRules.test.ts`, which also fails on any new
`process.env` read). The verify request carries no rule field.

## 3. Open items (not fixed here, with reason)

| # | Item | Why not now |
|---|---|---|
| O-A | Local territory vocabulary remains on shipped screens: "Capture", "Defend", "Control", "Defence" on Territory, zone detail, weekly recap, route review history, collections and tasks, always next to "Preview" labels | A wider rename touches many strings and tests; owner decision on how far the preview language goes. Nothing there states a token, payout or live competition |
| O-B | A still, overconfident phone can still verify and bank estimated XP (case S03) because the stationary rule is off | By directive: no 4x filter and no automatic rule before real phone data (H-3, H-5) |
| O-C | Server-side deletion becomes asynchronous in lane A | The app copy above is true for both outcomes; re-check wording when lane A lands |
| O-D | Help topics and the share-route proof still say "Local capture" / "Local defence preview" | Local-preview wording; part of O-A |
| O-E | Hosted staging runs an older movement backend | Owner decision O-3 before the phone run |
| O-F | Stray empty file `mobile/40` | Owner decision O-6 |
