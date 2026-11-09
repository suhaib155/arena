# State machines

Every status, state or stage union in MovenRun that changes over time is a
state machine, whether or not its transitions are written down. This page is
the catalogue. Read it before you change a status value, add a state, or add
code that writes one.

## How to work with one

- **Transitions live in a table.** Use `defineTransitions` from
  `@movenrun/shared/state-machine`. The table type is exhaustive, so a new
  state without a row is a compile error. `canTransition`, `terminalStates`
  and `reachableFrom` read the table.
- **Consume with an exhaustive `switch`.** End it with
  `default: return assertNever(value, "what")`. A new member then fails to
  compile at every consumer instead of falling through.
- **Prove it in a test.** Drive the real code (store, service or pure
  function) and check every observed move with `canTransition`. The tests
  listed below are the pattern to copy.
- **Register it here.** `stateCatalogue.test.ts` (mobile) and
  `stateCatalogue.test.ts` (backend) fail when an exported `…State`,
  `…Status` or `…Stage` type is not named on this page. Add a row; if it is
  a derived label rather than a machine, list it under "Derived labels".

## Machines with transition tables

| Machine | Type | States | Table | Proof |
|---|---|---|---|---|
| Capture lifecycle (phone) | `CaptureState`, `mobile/src/lib/sessionLifecycle.ts` | idle, starting, active, paused, finished | `CAPTURE_TRANSITIONS` | `mobile/src/lib/__tests__/stateTransitions.test.ts` walks every state against every event, both directions |
| Server check of one session (phone) | `VerificationState`, `mobile/src/lib/movementVerification.ts` | local, submitting, verified, rejected, pending | `VERIFICATION_TRANSITIONS`, enforced in `setVerificationState` | same file; a late `pending` cannot relabel a `verified` session |
| Session truth (phone) | `AuthStatus`, `mobile/src/lib/authLifecycle.ts` | unknown, restoring, signedOut, signedIn | `AUTH_STATUS_TRANSITIONS` | `mobile/src/store/__tests__/authStatusTransitions.test.ts` drives the real auth store |
| Identity sessions (server) | `SessionStatus`, `backend/src/identity/domain/types.ts` | active, rotated, revoked | `SESSION_STATUS_TRANSITIONS`, `backend/src/identity/domain/transitions.ts` | `transitions.test.ts` beside it |
| Embedded-wallet provisioning | `ProvisioningState`, same types file | requested, provisioning, active, failed_transient, failed_terminal | `PROVISIONING_TRANSITIONS` | `transitions.test.ts` |
| Wallet ownership | `WalletOwnershipStatus` | unverified, verified, revoked | `WALLET_OWNERSHIP_TRANSITIONS` | `transitions.test.ts` |
| User | `UserStatus` | active, disabled | `USER_STATUS_TRANSITIONS` | `transitions.test.ts` |
| Provider (webhook) events | `ProviderEventState`, `backend/src/identity/webhooks/types.ts` | received, processing, processed, retryable_failure, terminal_failure, ignored | `PROVIDER_EVENT_TRANSITIONS` (also a DB CHECK) | `transitions.test.ts`; outcome handling in `eventService.ts` is an exhaustive switch |
| Route lifecycle (legacy GPS worker) | `PersistedRouteStatus`, `backend/src/repositories/route.repository.ts` | SUBMITTED, PROCESSING, VERIFIED, REJECTED | `ROUTE_STATUS_TRANSITIONS` (plain object; the module imports nothing) | `backend/src/services/route.service.test.ts` |

## Machines already explicit in their own module

These are well-guarded and documented where they live; no table was added
because the module already is the table.

| Machine | Where | Notes |
|---|---|---|
| Startup routing | `BootstrapStatus`, `StartupRoute`, `mobile/src/lib/startupDecision.ts` | pure decision from known facts |
| First run | `FirstRunStage`, `ExperienceMode`, `mobile/src/lib/firstRun.ts` | account, intro, ready; versioned |
| Auth request in flight | `AuthOperation`, `mobile/src/lib/authLifecycle.ts` | one request at a time; kept apart from `AuthStatus` on purpose |
| Durable retry queue | `RetryVerdict`, `mobile/src/lib/pendingVerification.ts` | one ordered gate: owner, expiry, budget, backoff |
| Movement XP | `MovementXpStatus`, `mobile/src/lib/movementXp.ts` | saved_locally, pending_verification, verified, not_eligible; follows `VerificationState` |
| GPS acquisition | `GpsAcquisitionState`, `mobile/src/lib/gpsAcquisitionState.ts` | locating, improving, evaluating, ready |
| Device-management list | `SessionsStatus`, `mobile/src/store/useAuthStore.ts` | idle, loading, refreshing, ready, error; written only in `loadSessions` and the session actions |
| Movement verification (server) | `MovementVerificationStatus`, `backend/src/movement/domain/types.ts` (mirrored in `mobile/src/services/movementApi.ts`) | verified or rejected, written once at insert; no update path |
| Evidence capacity | `EvidenceStatus`, `shared/src/domain/evidence.ts` | complete, capacity_limited; a one-way latch |
| One-time challenges and handoffs | `consumed_at` plus `expires_at` on the challenge and handoff tables | compare-and-set `consumed_at IS NULL AND expires_at > now` |
| Provider config | `ProviderStatus`, `backend/src/identity/config.ts` | computed once from env; not a runtime machine |
| Android artifact gate | `GateStatus`, `mobile/src/lib/androidArtifactGate.ts` | PASS, FAIL, BLOCKED, NOT APPLICABLE, per check |
| Release workflows | `.github/workflows/eas-production-aab.yml` | typed `confirm == build`, then `gates`, then `build` behind the `play-release` environment |

## Implicit machines still held in screens or flags

Documented, not refactored: the mobile UI is frozen and these need a device
pass to change safely.

- **Live GPS health on the session screen** (`mobile/app/move/session.tsx`).
  Four values together say what the watch is doing: `interruption`
  (`services_off`, `watch_stopped` or null), `watchStopped`, `restartingRef`
  and `startError`, plus `trackerGapAtRef` and `continuityBrokenRef`. The
  intended states are *healthy*, *services off*, *watch stopped*,
  *restarting* and *start failed*. Each flag has a ref mirror for callbacks.
  Risk: two of them can disagree for one render, and a new cause has to be
  added in several places. Candidate: one `GpsHealth` union with a reducer in
  `lib/`, tested on Node, then swapped in with no copy change.
- **Save on the summary screen** (`mobile/app/move/summary.tsx`). `saved`
  (state) and `savingRef` (ref) encode *unsaved*, *saving* and *saved*;
  `backIntent` reads them. Candidate: one `SaveState` value.
- **Account security busy flag** (`mobile/app/account/security.tsx`). `busy`
  plus `wasSignedIn` cover the deletion and sign-out actions.
- **Website account deletion page** (`website/account-deletion/index.html`).
  Hidden steps, an access token string and button `disabled` encode *signed
  out*, *signing in*, *confirm*, *deleting*, *deleted* and *API unavailable*.
  Risk: after a non-ok delete (for example an expired token) the confirm form
  stays up with the stale token and no way back to sign-in without a reload.
- **Website sign-in hand-off** (`website/sign-in/index.html`,
  `website/js/account-auth.js`). The PKCE verifier in `sessionStorage` is the
  flow state; a return without `code` or `error` leaves it behind.
- **Pending provider-side user deletions** (`pending_auth_user_deletions`).
  The row's presence is the state; `attempts` only grows and there is no
  dead-letter state.

## Known gaps (not changed here; each needs its own reviewed change)

1. **Route jobs can revisit a finished route.** `processRouteJob` writes
   `PROCESSING` without reading the status, and `update()` is
   `WHERE id = ?`. A redelivered job can take `VERIFIED` back through
   `PROCESSING`. Fix shape: a conditional update (`WHERE status IN (...)`)
   or an early return on a final status.
2. **Wallet provisioning has read-then-write guards.** Two concurrent
   `provision()` calls can end `active -> failed_transient`; `provision()`
   does not check `revokedAt`, so a revoked embedded wallet could be
   re-verified. Embedded wallets are not enabled in Play v1. Fix shape:
   conditional updates on `provisioning_state` and `revoked_at IS NULL`.
3. **`SessionRepository.setStatus` writes any status.** It has no production
   caller. Fix shape: remove it from the interface or guard it with
   `SESSION_STATUS_TRANSITIONS`.
4. **Only `provider_events.state` has a database CHECK.** Every other status
   column is `text`. Fix shape: a migration adding CHECKs, which needs owner
   approval like any migration.
5. **`retryRestore` does not check `status`.** The UI only offers Retry from
   `unknown`, so `signedIn -> restoring` is not in the table and is not
   reachable from any screen today.
6. **Stale-lease reclaims of provider events do not check `maxAttempts`.**
   Only `settleRetry` does, so a handler that crashes the process could be
   reclaimed without limit. No production caller runs `process()` yet.

## Derived labels (not machines)

Computed from data each render, never stored or transitioned:
`ZoneState`, `DistrictStatus`, `BattleStatus`, `MissionStatus`,
`EventStatus`, `SponsorStatus`, `ObjectiveStatus`, `StepStatus`,
`GhostStatus`, `BadgeStatus`, `TaskState`, `TerritoryStage`,
`PermissionStatus`, `PublicSessionStatus`, `IdentityVerificationStatus`
(set once at insert), `RouteStatus` (shared enum; `PENDING` is never
persisted), `ZoneStatus`.
