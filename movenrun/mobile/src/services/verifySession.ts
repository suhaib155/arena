/**
 * The one place a completed movement session is submitted for verification.
 *
 * Screens do not call `movementApi` directly. Having a single semantic owner is
 * what makes "one completed session, one logical verification" enforceable
 * rather than a convention: the in-flight guard below lives here, so a second
 * screen, a replayed effect, or a double tap cannot each start their own
 * request.
 *
 * ## What this does NOT do
 *
 * It does not award XP, complete a quest, capture a zone, defend a zone, or
 * touch the game store in any way. Completion and reward semantics are exactly
 * as they were; server verification is not a reward authority in this task, and
 * `traversedHexIds` is not mapped onto territory. Those boundaries are asserted
 * by tests, not merely intended.
 *
 * It also does not retry. One completed session gets one attempt here; a
 * failure leaves honest `pending` state that a later, separate retry design can
 * pick up.
 */
import {
  MovementApiError,
  type MovementApiClient,
  type SubmitMovementRequest,
} from "./movementApi";
import {
  isVerifiable,
  shouldSubmit,
  toObservations,
  type PendingReason,
  type VerificationState,
} from "@/lib/movementVerification";
import { isSaveable } from "./moveSession";
import type { FinishedSession } from "./moveSession";

/** Map a transport failure onto an honest client-side pending reason. */
export function pendingReasonFor(error: MovementApiError): PendingReason {
  switch (error.kind) {
    case "network_unavailable":
      return "offline";
    case "timeout":
      return "timeout";
    case "unauthorized":
    case "forbidden":
      return "unauthenticated";
    case "malformed_response":
      return "malformed_response";
    default:
      return "server_error";
  }
}

export interface SubmitDeps {
  client: MovementApiClient;
  /** Reads the state for this session; the orchestrator never caches it. */
  readState: () => VerificationState;
  /** Records a transition, addressed by session id so a late response cannot
   *  land on a different session. */
  writeState: (clientSessionId: string, next: VerificationState) => void;
}

/**
 * In-flight submissions, keyed by session id.
 *
 * Keyed rather than a single slot so the guard is about *this session*, and
 * shared at module scope so it holds across screen instances — a summary that
 * unmounts and remounts while a request is in flight rejoins the same promise
 * instead of starting a second one.
 */
const inFlight = new Map<string, Promise<VerificationState>>();

/** Test seam only. */
export function __resetInFlight(): void {
  inFlight.clear();
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
  const id = session.clientSessionId;

  /* Already running for this session: hand back the SAME promise. This is the
     guard that survives re-render, double tap, effect replay and summary
     remount — none of which a disabled button would cover. */
  const running = inFlight.get(id);
  if (running) return running;

  const state = deps.readState();
  if (!shouldSubmit(state)) return Promise.resolve(state);

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

  deps.writeState(id, { kind: "submitting" });

  const request: SubmitMovementRequest = {
    sessionId: id,
    ...toObservations(session),
  };

  const operation = deps.client
    .submit(request)
    .then(({ verification }): VerificationState => {
      if (verification.status === "verified") {
        return {
          kind: "verified",
          distanceMeters: verification.distanceMeters,
          durationSeconds: verification.durationSeconds,
          // Traversal, recorded as such. Nothing here becomes a captured zone.
          traversedHexIds: verification.traversedHexIds,
        };
      }
      return { kind: "rejected", reasons: verification.rejectionReasons };
    })
    .catch((err: unknown): VerificationState => {
      /* Anything that is not a decoded verdict leaves the session unverified
         and retryable. It never becomes `verified`, and it never erases the
         completed workout. */
      const reason: PendingReason =
        err instanceof MovementApiError ? pendingReasonFor(err) : "server_error";
      return { kind: "pending", reason };
    })
    .then((next) => {
      deps.writeState(id, next);
      return next;
    })
    .finally(() => {
      inFlight.delete(id);
    });

  inFlight.set(id, operation);
  return operation;
}
