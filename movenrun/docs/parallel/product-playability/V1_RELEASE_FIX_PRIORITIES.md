# V1 release fix priorities

Every defect Track A found, ranked by severity, at `15f7f87`. Severities use the
rubric in [FIRST_WALK_UX_RESEARCH.md](FIRST_WALK_UX_RESEARCH.md). Evidence labels:
SYNTHETIC (corpus), LOCAL (code or unit test), NEEDS DEVICE. Every fix is
PROPOSED. Fixes in `mobile/` need the owner's UX0 approval because the mobile UI
is frozen. Fixes in `backend/` or `shared/` do not change the UI.

## Ranked list

| Rank | Id | Sev | Finding | Evidence | Reproduction | Candidate fix | Layer | Freeze |
|---|---|---|---|---|---|---|---|---|
| 1 | MR-A-01 | S2 | The server rejects honest saveable walks with "Too few GPS points" | SYNTHETIC: W04 (220 m, 7 points), W06 (150 m slow stroll, 9 points) | `run-tests.sh`, fixtures W04 and W06 | P1: skip the legacy `MIN_POINTS = 10` when the session carries metadata; keep the schema floor of 2 | backend | No UI change |
| 2 | MR-A-02 | S2 | A car or bus leg is credited as walking: 2,103 m and 144 XP for 299 m on foot, and the server agrees | SYNTHETIC: I02 | Fixture I02 | P2: after a speed rejection, the next accepted fix starts a new stretch | shared | No UI change |
| 3 | MR-A-10 | S2 | 10 unlabelled ownership, token or chain claims render in v1 through normal navigation, and 1 more by deep link | LOCAL: claims checker, each hit checked by hand | `claims-checker/check.ts` | Copy changes in V1_FEATURE_TRUTH_MATRIX.md; hide the Technical info contracts drawer behind the `wallets` flag | mobile | UX0 |
| 4 | S2-1 | S2 | No outdoor-safety line anywhere in the movement flow | LOCAL | Fresh install, Move, Start | UX0-1 | mobile | UX0 |
| 5 | MR-A-03 | S2 | Save eligibility and XP use the wall clock: a 1 h clock jump turns an 82 m walk into 191 XP | SYNTHETIC: C02 | Fixture C02 | P3: duration from the first and last accepted fix | mobile | No visible change |
| 6 | MR-A-04 | S2 | A still phone with overconfident accuracy gains 632 m and 53 XP, and the server agrees | SYNTHETIC: S03 | Fixture S03 | P5 only cuts it to 456 m. Collect QA0-17 data first, then design | shared | Open |
| 7 | S2-3 | S2 | GPS-ready, weak-signal and Pause changes are not announced to TalkBack | LOCAL; NEEDS DEVICE | TalkBack on, start a move, press Pause | UX0-6 | mobile | UX0 |
| 8 | S2-4 | S2 | `textFaint` text is 2.33:1 on white; StatusPill uses brand colours as text | LOCAL (computed ratios); NEEDS DEVICE for glare | Open Route History in sunlight | UX0-7 | mobile | UX0 |
| 9 | S2-7 | S2 | No guidance to keep the screen on; a pocketed phone silently loses route sections | LOCAL; NEEDS DEVICE | Lock the phone mid-walk | UX0-2 | mobile | UX0 |
| 10 | S2-2 | S2 | Loss framing: "Defend N zones" in a danger tone; "You won't earn XP if you leave now" and "Keep moving" on a timed quest | LOCAL | Let a preview zone decay; quit a quest | UX0-8 | mobile | UX0 |
| 11 | MR-A-05 | S2 | A clock set back makes every fix "future" and drops it silently; the chip stays green for 200 s | SYNTHETIC: C01 | Fixture C01 | P4: count future fixes towards weak signal | mobile | No layout change |
| 12 | S2-5 | S2 | `/move/captured` burst and `CountUpText` ignore Remove animations | LOCAL | Remove animations on, finish a route that creates a preview zone | Read `useReducedMotion` and show final values | mobile | UX0 |
| 13 | S2-6 | S2 | `numberOfLines={1}` clips distance and task text at large font sizes on 320 dp | LOCAL; NEEDS DEVICE | Largest font and display size, Home and Summary | Allow 2 to 3 lines | mobile | UX0 |
| 14 | L02 | S2 | A process kill loses the walk with no message on the next launch | SYNTHETIC: L02; LOCAL (`hasRecoverableMovement` hard-coded false) | Swipe the app away mid-walk | UX0-5 | mobile | UX0 |
| 15 | MR-A-09 | S3 | XP is banked at Save, before and regardless of the server verdict | LOCAL: `xpSemantics.test.ts` | Save a walk the server rejects | Owner decision: keep (XP is local, verification is separate) or bank after verify | mobile | Product decision |
| 16 | MR-A-08 | S3 | Movement XP and streak follow the phone's date; changing the date re-opens them | LOCAL: `xpSemantics.test.ts` | Move the date forward a day | Accept for v1 (local XP, no value), or take the day from the server | mobile | Product decision |
| 17 | MR-A-06 | S3 | Recovery after accuracy spikes adds about 10% distance | SYNTHETIC: G01 | Fixture G01 | None yet | shared | Open |
| 18 | copy | S3 | Denied and services-off copy offers "a demo route", which exists only in development builds | LOCAL | Deny location in a release build | UX0-4 | mobile | UX0 |
| 19 | copy | S3 | Seal hint tells people to cross their trail or return to the start | LOCAL | Start a session | UX0-3 | mobile | UX0 |
| 20 | route | S3 | `/questline` is reachable by deep link and says "a zone you own" | LOCAL | Open `movenrun://questline` | Add it to `FEATURE_ROUTES` | mobile | One line, no UI |
| 21 | a11y | S3 | Map controls are 44 dp with no `hitSlop`; Move label read twice; some rows lack a role | LOCAL | TalkBack over the tab bar and map | `hitSlop={4}`; hide the duplicate label; add roles | mobile | UX0 |
| 22 | nav | S3 | Profile empty state "Browse quests" opens Home, not Quests | LOCAL | New install, Profile | Route to `/quests` | mobile | UX0 |
| 23 | legal | S3 | `LEGAL_VERSION` is `v1-2026-11-02`, a future date | LOCAL | Read `lib/education.ts` | Confirm it matches the published terms | mobile | Owner check |
| 24 | MR-A-07 | S4 | Slow traffic under 12 m/s cannot be told apart from running | SYNTHETIC: I04 | Fixture I04 | Known limit for v1 | product | Accept |

## Before and after (SYNTHETIC)

| Applied | Corpus fixtures failing |
|---|---:|
| Today | 8 of 30 |
| P1 (backend only) | 6 |
| P1 to P5 together | 3 |

P1 and P2 together fix the two worst movement defects without touching the UI.

## Recommended order for the QA0 line

1. P1 (backend) and P2 (shared): small, testable, no UI change, and both change server verdicts that QA0 testers will see.
2. MR-A-10: the copy and the one flag condition, as one UX0 request together with S2-1, UX0-2 and UX0-4.
3. P3 and P4: client logic only, with no layout change.
4. The accessibility batch (S2-3 to S2-6) as a second UX0 request.
5. Collect QA0-17 device data, then decide MR-A-04.
