# Session state machine

The full life of one movement session at `15f7f87`, from the permission check to
verification and deletion. Sources are named for every step. Evidence is LOCAL
unless marked otherwise.

## 1. Readiness (before a session exists)

`lib/moveReadiness.ts` decides what the `/move` button does.

| Readiness | Button | What happens |
|---|---|---|
| checking | Start Move (disabled) | Reads permission and services status |
| permission-required | Allow Location | Shows the rationale ("only during an active foreground movement session, never in the background") before the OS prompt |
| permission-denied | Open Settings | `Linking.openSettings()`. Copy also offers "a demo route", which exists only in development builds (defect) |
| location-unavailable | Open Settings | Services are off. Same copy issue |
| blocked | Start Move (disabled) | An existing validation reason blocks the start |
| ready | Start Move | Opens `/move/session` |

Offline is not a blocker: the screen notes that the route is kept on the device
and sent later, which matches the retry queue in section 5.

Only foreground location is requested. The manifest blocks background location
and foreground-service permissions.

## 2. Capture lifecycle

Source: `mobile/src/lib/sessionLifecycle.ts`. Every state and event pair is in
`research/product-playability/state-machine/captureTable.ts`, and
`tests/stateMachine.test.ts` checks all 30 pairs against the real machine.

```
idle --requestStart--> starting --trackerStarted--> active <--pause/resume--> paused
          ^                |                          |                          |
          +--trackerFailed-+                          +---------finish-----------+--> finished
```

| From | Event | Outcome | To | Note |
|---|---|---|---|---|
| idle | requestStart | ok | starting | Nothing is stamped yet |
| starting | requestStart | ignored | starting | Double tap on Start |
| active, paused or finished | requestStart | ignored | unchanged | A late Start tap does nothing |
| active | resume | ignored | active | |
| starting | trackerStarted | ok | active | Session id, mode, rules version and start time are stamped together |
| starting | trackerFailed | ok | idle | Permission, services or acquisition timeout. Nothing is burned |
| active | pause | ok | paused | |
| active | trackerFailed | invalid | active | A mid-session error becomes a gap, not a reset |
| active | trackerStarted | invalid | active | A second native start cannot re-stamp |
| paused | pause | ignored | paused | No second open pause |
| paused | resume | ok | active | The next accepted fix starts a new stretch, with no straight bridge |
| active or paused | finish | ok | finished | An open pause closes at finish |
| finished | finish | ignored | finished | Double Finish is one session |

Every other pair is `invalid`. Both `ignored` and `invalid` leave the state unchanged.

## 3. Inside an active session

| Situation | Behaviour | Evidence |
|---|---|---|
| First fixes | Acquisition needs 3 fixes at 20 m accuracy or better over at least 8 s. It times out after 30 s | A01, A02 |
| Each fix | `inspectFix` accepts or rejects it: accuracy over 40 m, under 2 m of movement, over 12 m/s, older than 10 s, future-dated, unknown accuracy, or non-increasing time | corpus |
| Weak signal | A single `weak_accuracy` or `stale_fix` rejection, or an accepted fix worse than 25 m, turns the chip to weak signal (`session.tsx`, `mapPresence.ts`). Future-dated fixes do not (MR-A-05) | G01, C01 |
| App backgrounded | Tracking is foreground only. On return the next fix starts a new stretch and the gap is noted | L01 |
| Provider error | Recorded as a gap; the session continues | G03 |
| Process killed | The session lives in memory and is lost. Nothing is saved or submitted. The Home "Finish your move" task that would recover it is dead code (`hasRecoverableMovement` is hard-coded false) | L02 |
| Leave with X or Back | "This session won't be saved if you leave now." Discard | code read |

## 4. Summary and Save

| Rule | Value | Source |
|---|---|---|
| Saveable | 200 m or 5 min of active time | `isSaveable` |
| Active time | Wall clock minus pauses (MR-A-03) | `summary.tsx` |
| Session XP | 25 to 300: km × 60 + minutes × 3 | `sessionXp` |
| XP condition | Only if the route is drawable | `hasDrawableRoute` |
| XP timing | Banked at Save, before the upload starts (MR-A-09) | `xpSemantics.test.ts` |
| XP per day | Movement XP lands once per local day, keyed on the phone's date (MR-A-08) | `getLocalDateKey` |
| Upload | Only when signed in. Fire and forget | `submitCompletedSession` |

## 5. Verification

Source: `lib/movementVerification.ts`, `lib/pendingVerification.ts`,
`services/verifySession.ts`. Tested in `tests/verificationStates.test.ts`.

| State | Meaning |
|---|---|
| local | Saved on the device. Never submitted (guest, or below the threshold) |
| submitting | A request is in flight. Duplicate taps and remounts reuse it |
| verified | The server measured the route. Distance, duration, cells and the server's seal check come back. None of it is ownership |
| rejected | The server refused it, with reasons |
| pending | Not settled. Held in the retry queue |

Retry queue (persisted, owner-scoped):

| Outcome | Disposition | Queue item |
|---|---|---|
| offline, timeout, server error | retry | Kept, with backoff from 60 s doubling to a 6 h cap |
| unauthenticated | auth_blocked | Kept until the same account signs in again |
| invalid request, not found, malformed response | terminal | Deleted |
| 6 attempts, or older than 7 days | expired | Deleted |

At most 3 items and 10,000 points are kept. A movement request times out after 20 s.

## 6. Sign-in, sign-out and deletion

| Event | Effect on sessions |
|---|---|
| Sign-in times out (90 s) | Stays signed out. Local progress is untouched |
| Stored session rejected on start | `decideStartup` offers Retry or "Explore local beta" |
| Sign-out while a request is in flight | The privacy generation changes, so a late verdict is not written and the queued route is erased. Tested |
| Another account signs in | Queue items are owner-scoped, so the new account never submits the old account's routes |
| Account deletion | `POST /identity/account/delete`. The client clears credentials and the verification queue, then resets local progress |
| Guest "Reset progress" | Clears the local store. Nothing exists on the server |

## 7. Gaps in this machine

1. A process kill loses the session with no message on the next launch (S2 in V1_RELEASE_FIX_PRIORITIES.md).
2. Every duration that decides Save or XP uses the wall clock (MR-A-03).
3. XP does not wait for the server verdict (MR-A-09). This is a product choice to confirm, not a bug, as long as server data never feeds territory.
4. The day key follows the phone's date (MR-A-08).
