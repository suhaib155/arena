/**
 * The one place a completed movement session is submitted for verification.
 *
 * Screens do not call `movementApi` directly. Having a single semantic owner is
 * what makes "one completed session, one logical verification" enforceable
 * rather than a convention: the in-flight guard below lives here, so a second
 * screen, a replayed effect, a double tap, an app foreground and an explicit
 * Retry cannot each start their own request.
 *
 * ## One pipeline, three entry points
 *
 *   {@link submitCompletedSession}      the original attempt, from the summary
 *   {@link retryVerification}           an explicit user retry
 *   {@link retryPendingVerifications}   the authenticated foreground sweep
 *
 * All three funnel into `runSubmission`, so all three share the same in-flight
 * map, the same session id, and the same settle/cleanup behaviour. A persisted
 * queue that grew its own submission path would be a second pipeline with a
 * second set of bugs, and would let a foreground sweep and a button press race
 * into two requests for one run.
 *
 * ## What this does NOT do
 *
 * It does not award XP, complete a quest, capture a zone, defend a zone, or
 * touch the game store in any way. Completion and reward semantics are exactly
 * as they were; server verification is not a reward authority in this task, and
 * `traversedHexIds` is not mapped onto territory. Those boundaries are asserted
 * by tests, not merely intended.
 *
 * It also does not retry in the background, on a timer, on a render, or on a
 * GPS update — see `retryPendingVerifications` for the only triggers there are.
 */
import {
  MovementApiError,
  type MovementApiClient,
  type SubmitMovementRequest,
} from "./movementApi";
import {
  clearPendingQueue,
  loadPendingQueue,
  removePendingItem,
  savePendingItem,
} from "./verificationQueue";
import {
  buildPendingItem,
  classifyOutcome,
  MAX_ATTEMPTS,
  isExpired,
  isDeadVerdict,
  retryEligibility,
  withAttempt,
  type PendingVerificationItem,
  type RetryVerdict,
} from "@/lib/pendingVerification";
import {
  isVerifiable,
  shouldSubmit,
  toSubmission,
  type PendingReason,
  type SessionSubmission,
  type VerificationState,
} from "@/lib/movementVerification";
import { distanceDiagnostics } from "@/lib/distanceDiagnostics";
import { isSaveable, isSessionPrivacyCurrent } from "./moveSession";
import type { FinishedSession } from "./moveSession";
import { captureVerificationScope, isVerificationScopeCurrent, verificationGeneration, type VerificationScope } from "./verificationPrivacy";

/**
 * Map a transport failure onto an honest client-side pending reason.
 *
 * 4xx and 5xx are kept apart on purpose. A 400/422 is the server having read
 * the payload and refused it, and a 404 is the endpoint not being there;
 * neither improves by being sent again, and folding them into `server_error`
 * would make the retry layer batter a wall until its budget ran out.
 */
export function pendingReasonFor(error: MovementApiError): PendingReason {
  switch (error.kind) {
    case "network_unavailable":
      return "offline";
    case "timeout":
      return "timeout";
    case "unauthorized":
    case "forbidden":
      return "unauthenticated";
    case "invalid_request":
      return "invalid_request";
    case "not_found":
      return "not_found";
    case "malformed_response":
      return "malformed_response";
    default:
      return "server_error";
  }
}

/**
 * What every entry point needs to run one submission.
 *
 * `readState` is deliberately absent: it is the *summary screen's* question
 * ("has this session already been answered for?"), and a queued item has
 * already answered it by being queued. Requiring it of the retry path would
 * have meant inventing a reader for sessions the app is no longer looking at.
 */
export interface PipelineDeps {
  client: MovementApiClient;
  /** Records a transition, addressed by session id so a late response cannot
   *  land on a different session. */
  writeState: (clientSessionId: string, next: VerificationState) => void;
  /**
   * The account authenticated right now (`PublicUser.id`), or null.
   *
   * Optional, and null is a meaningful value rather than a missing one: with no
   * authenticated account there is nobody to bind a queued route to, so the
   * failure stays in memory and no coordinates are written to disk. Callers
   * that have no notion of an account — older tests, and any surface that
   * submits without sign-in — therefore get the safe behaviour by default.
   */
  ownerUserId?: string | null;
  /** Injected clock, so every bound in the retry policy is testable. */
  now?: () => number;
}

export interface SubmitDeps extends PipelineDeps {
  /** Reads the state for this session; the orchestrator never caches it. */
  readState: () => VerificationState;
}

/**
 * In-flight submissions, keyed by session id.
 *
 * Keyed rather than a single slot so the guard is about *this session*, and
 * shared at module scope so it holds across screen instances and across entry
 * points — a summary that unmounts and remounts, or a foreground sweep landing
 * while the user taps Retry, rejoins the same promise instead of starting a
 * second request.
 */
const inFlight = new Map<string, Promise<VerificationState>>();
const flightKey = (id: string, owner: string | null) => JSON.stringify([verificationGeneration(), owner, id]);

/** Test seam only. */
export function __resetInFlight(): void {
  inFlight.clear();
}

/** Does this session already have a request out? */
export function isSubmissionInFlight(clientSessionId: string, ownerUserId: string | null = null): boolean {
  return inFlight.has(flightKey(clientSessionId, ownerUserId));
}

/**
 * The single submission pipeline.
 *
 * Everything about durability lives in the `.then`/`.catch` below rather than
 * at the call sites, so there is exactly one description of when observations
 * are written to disk and — more importantly — when they are deleted from it.
 */
function runSubmission(
  clientSessionId: string,
  submission: SessionSubmission,
  deps: PipelineDeps,
  existing: PendingVerificationItem | null,
): Promise<VerificationState> {
  const scope = captureVerificationScope(deps.ownerUserId ?? null);
  if (!isVerificationScopeCurrent(scope)) return Promise.resolve({ kind: "pending", reason: "unauthenticated" });
  const key = flightKey(clientSessionId, scope.ownerUserId);
  const running = inFlight.get(key);
  if (running) return running;

  const now = deps.now ?? Date.now;
  const owner = deps.ownerUserId ?? null;

  deps.writeState(clientSessionId, { kind: "submitting" });

  /* Built field by field rather than spread, so the request carries the
     session's own metadata and nothing else that happens to be on the object.
     A retry passes the metadata it was queued with — it is never rebuilt from
     the current default mode or the current rules version, which would
     reinterpret a session that already happened. */
  const request: SubmitMovementRequest = {
    sessionId: clientSessionId,
    startTime: submission.observations.startTime,
    endTime: submission.observations.endTime,
    points: submission.observations.points,
    ...(submission.session ? { session: submission.session } : {}),
  };

  const operation = deps.client
    .submit(request)
    .then(({ verification }): VerificationState => {
      if (!isVerificationScopeCurrent(scope)) return { kind: "pending", reason: "unauthenticated" };
      distanceDiagnostics.backend(clientSessionId, verification.distanceMeters);
      if (verification.status === "verified") {
        return {
          kind: "verified",
          distanceMeters: verification.distanceMeters,
          durationSeconds: verification.durationSeconds,
          // Traversal, recorded as such. Nothing here becomes a captured zone.
          traversedHexIds: verification.traversedHexIds,
          sealed: verification.sealed ?? null,
          sealMethods: verification.sealMethods ?? null,
          sealCount: verification.sealCount ?? null,
        };
      }
      return { kind: "rejected", reasons: verification.rejectionReasons };
    })
    .catch((err: unknown): VerificationState => {
      /* Anything that is not a decoded verdict leaves the session unverified
         and possibly retryable. It never becomes `verified`, and it never
         erases the completed workout. */
      const reason: PendingReason =
        err instanceof MovementApiError ? pendingReasonFor(err) : "server_error";
      return { kind: "pending", reason };
    })
    .then(async (next) => {
      if (!isVerificationScopeCurrent(scope)) return next;
      deps.writeState(clientSessionId, next);
      await settleDurableState(clientSessionId, submission, next, existing, owner, now(), scope);
      return next;
    })
    .finally(() => {
      if (inFlight.get(key) === operation) inFlight.delete(key);
    });

  inFlight.set(key, operation);
  return operation;
}

/**
 * Decide what the durable queue should hold now that this attempt has settled.
 *
 * The rule is one sentence: **route observations exist on disk only while a
 * retry could still change the outcome.**
 *
 *   verified / rejected  → the server has answered, terminally. Task 4's
 *                          settled record already holds everything worth
 *                          keeping (and holds a hex *count*, not a trail), so
 *                          keeping the raw points would be a duplicate copy of
 *                          the most sensitive data in the app for no reason.
 *   terminal failure     → no future retry can succeed. Same conclusion.
 *   no authenticated     → nobody to bind the item to. Never write it.
 *   account
 *   budget exhausted     → the item is dead on arrival. Do not write it back.
 *   retryable / auth     → keep it, with the attempt counted.
 */
async function settleDurableState(
  clientSessionId: string,
  submission: SessionSubmission,
  next: VerificationState,
  existing: PendingVerificationItem | null,
  owner: string | null,
  at: number,
  scope: VerificationScope,
): Promise<void> {
  if (!isVerificationScopeCurrent(scope)) return;
  if (next.kind !== "pending") {
    // A verdict, either way. Nothing is owed a retry.
    await removePendingItem(clientSessionId, scope);
    return;
  }

  const disposition = classifyOutcome(next.reason);
  if (disposition === "terminal") {
    await removePendingItem(clientSessionId, scope);
    return;
  }

  if (owner === null) {
    /* An unauthenticated failure has no owner, and an unowned route is one that
       can never pass the account check — so it could only ever sit there as
       orphaned location data. Refuse to create it, and remove any earlier item
       for this session rather than leaving one behind. */
    await removePendingItem(clientSessionId, scope);
    return;
  }

  const item =
    existing && existing.ownerUserId === owner
      ? withAttempt(existing, next.reason, at)
      : buildPendingItem({
          clientSessionId,
          ownerUserId: owner,
          observations: submission.observations,
          session: submission.session,
          reason: next.reason,
          now: at,
        });

  if (item.attempts >= MAX_ATTEMPTS || isExpired(item, at)) {
    // Spent. Storing it would be storing coordinates nothing may ever send.
    await removePendingItem(clientSessionId, scope);
    return;
  }

  await savePendingItem(item, scope);
}

/**
 * Submit one completed session, at most once logically.
 *
 * Never throws: every failure becomes a `VerificationState`, so a caller in a
 * UI event handler cannot produce an unhandled rejection and a failed
 * verification can never interrupt the completion flow the user is in.
 */
export function submitCompletedSession(
  session: FinishedSession,
  deps: SubmitDeps,
): Promise<VerificationState> {
  if (!isSessionPrivacyCurrent(session)) return Promise.resolve({ kind: "pending", reason: "unauthenticated" });
  const id = session.clientSessionId;

  /* Already running for this session: hand back the SAME promise. This is the
     guard that survives re-render, double tap, effect replay and summary
     remount — none of which a disabled button would cover. */
  const running = inFlight.get(flightKey(id, deps.ownerUserId ?? null));
  if (running) return running;

  const state = deps.readState();
  if (!shouldSubmit(state)) return Promise.resolve(state);
  // A bounded prefix cannot stand in for the completed workout on the server.
  if (session.evidenceStatus === "capacity_limited") return Promise.resolve(state);

  if (
    !isVerifiable({
      mode: session.mode,
      finished: true,
      saveable: isSaveable(session.distanceM, session.durationMs),
      points: session.points,
    })
  ) {
    return Promise.resolve(state);
  }

  return runSubmission(id, toSubmission(session), deps, null);
}

/* ── retry ────────────────────────────────────────────────────────────────── */

/** What one sweep did, so callers and tests can see it without reading storage. */
export interface RetrySweepResult {
  attempted: string[];
  /** Session id → why it was skipped. Never contains observations. */
  skipped: Record<string, RetryVerdict>;
  /** Items deleted because they can never succeed again. */
  discarded: string[];
}

export interface RetryDeps extends PipelineDeps {
  /** Called for each settled result so the caller can reconcile it (Task 4). */
  onSettled?: (clientSessionId: string, state: VerificationState) => void;
}

async function runPending(
  item: PendingVerificationItem,
  deps: RetryDeps,
): Promise<VerificationState> {
  const scope = captureVerificationScope(deps.ownerUserId ?? null);
  /* The queued item's own metadata, replayed exactly. An item queued before
     the session model existed has none, and resubmits in the legacy shape
     rather than being stamped with today's values. */
  const state = await runSubmission(
    item.clientSessionId,
    item.session ? { observations: item.observations, session: item.session } : { observations: item.observations },
    deps,
    item,
  );
  if (isVerificationScopeCurrent(scope)) deps.onSettled?.(item.clientSessionId, state);
  return state;
}

/**
 * Retry one queued session because the user asked.
 *
 * Bypasses the backoff delay and nothing else: the ownership check, the
 * retention window and the attempt budget all still apply, because a button
 * press is evidence of intent, not of authorisation. The session id is the one
 * from the queue — a manual retry has no more right to mint a fresh id than an
 * automatic one, and doing so would create a second verification server-side.
 */
export async function retryVerification(
  clientSessionId: string,
  deps: RetryDeps,
): Promise<VerificationState | null> {
  const now = deps.now ?? Date.now;
  const scope = captureVerificationScope(deps.ownerUserId ?? null);
  const queue = await loadPendingQueue(scope);
  if (!isVerificationScopeCurrent(scope)) return null;
  const item = queue.find((i) => i.clientSessionId === clientSessionId && i.ownerUserId === deps.ownerUserId);
  if (!item) return null;

  const verdict = retryEligibility(item, {
    now: now(),
    currentUserId: deps.ownerUserId ?? null,
    manual: true,
  });
  if (verdict !== "ok") {
    if (isDeadVerdict(verdict)) await removePendingItem(item.clientSessionId, scope);
    return null;
  }
  return runPending(item, deps);
}

/**
 * The automatic sweep: retry everything this account is allowed to retry.
 *
 * Called from deliberate foreground moments only — authenticated bootstrap and
 * the app becoming active — never from a timer, a background task, a render, a
 * navigation event or a GPS update. There is no scheduler here and no attempt
 * to be one; the sweep looks at what is queued, applies the gate, and returns.
 *
 * `ownerUserId === null` short-circuits before storage is even read: an app
 * that has not resolved authentication has no business deciding anything about
 * a queued route, and this is what makes "no upload before authentication
 * resolves" true by construction rather than by effect ordering.
 */
export async function retryPendingVerifications(deps: RetryDeps): Promise<RetrySweepResult> {
  const result: RetrySweepResult = { attempted: [], skipped: {}, discarded: [] };
  const owner = deps.ownerUserId ?? null;
  if (owner === null) return result;

  const now = deps.now ?? Date.now;
  const scope = captureVerificationScope(owner);
  const queue = await loadPendingQueue(scope);

  for (const item of queue) {
    if (!isVerificationScopeCurrent(scope)) break;
    const verdict = retryEligibility(item, { now: now(), currentUserId: owner });
    if (verdict !== "ok") {
      result.skipped[item.clientSessionId] = verdict;
      /* Dead items are deleted rather than left to rot: an expired or spent
         entry is precise location that nothing is ever allowed to send. */
      if (isDeadVerdict(verdict)) {
        await removePendingItem(item.clientSessionId, scope);
        result.discarded.push(item.clientSessionId);
      }
      continue;
    }
    result.attempted.push(item.clientSessionId);
    await runPending(item, deps);
  }

  return result;
}

/**
 * Drop every queued route.
 *
 * Exported here as well as on the queue so the sign-out path has one obvious
 * name to call, and so this module — the one that decides when observations may
 * exist — is also the one that says when they may not.
 */
export async function discardPendingRetries(): Promise<void> {
  await clearPendingQueue();
}
