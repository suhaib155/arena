/**
 * Movement verification — the only writer of movement_verifications.
 *
 * The trust boundary in one place: `userId` is supplied by the caller from a
 * verified bearer session and is never read from the request body. Everything
 * the client sends is an observation; everything persisted or returned is
 * server-derived.
 */
import { verifyMovement, type VerifyMovementDeps } from "../domain/verification.js";
import { toSealSummary, type MovementObservation, type MovementVerificationResult } from "../domain/types.js";
import { sameSessionMetadata, type SessionMetadata } from "@movenrun/shared/session";

import {
  MovementSessionConflictError,
  MovementSessionMetadataConflictError,
  type MovementVerificationRecord,
  type MovementVerificationRepository,
} from "../repositories/interfaces.js";

export interface SubmitMovementInput {
  /** From the verified session. NOT from the body. */
  userId: string;
  /** Stable id the client minted for this completed session. */
  clientSessionId: string;
  observation: MovementObservation;
}

export interface SubmitMovementOutcome {
  record: MovementVerificationRecord;
  /** True when this call performed the verification; false when an existing
   *  result was returned unchanged. Lets the HTTP layer answer 201 vs 200
   *  without the client having to care. */
  created: boolean;
}

export interface MovementVerificationDeps extends VerifyMovementDeps {
  repository: MovementVerificationRepository;
  generateId: () => string;
}

export class MovementVerificationService {
  constructor(private readonly deps: MovementVerificationDeps) {}

  /**
   * Verify a completed session, exactly once per (user, clientSessionId).
   *
   * Three paths, and the third is the one that matters:
   *  1. Already stored → return it unchanged. A retry of an acknowledged
   *     submission is not a new submission.
   *  2. Not stored → verify, insert, return.
   *  3. Not stored, but a concurrent request inserted first → the insert
   *     raises MovementSessionConflictError and we re-read the winner's row.
   *     Both callers get the SAME authoritative result, which is what makes
   *     this idempotent under concurrency rather than merely on sequential
   *     retry. The database constraint is the arbiter; nothing here relies on
   *     process-local state, so it holds across restarts and replicas.
   */
  async submit(input: SubmitMovementInput): Promise<SubmitMovementOutcome> {
    const existing = await this.deps.repository.findByUserSession(
      input.userId,
      input.clientSessionId,
    );
    if (existing) {
      assertMetadataMatches(existing, input.observation.session);
      return { record: existing, created: false };
    }

    const result = verifyMovement(input.observation, this.deps);

    try {
      const record = await this.deps.repository.create({
        id: this.deps.generateId(),
        userId: input.userId,
        clientSessionId: input.clientSessionId,
        status: result.status,
        distanceMeters: result.distanceMeters,
        durationSeconds: result.durationSeconds,
        traversedHexIds: result.traversedHexIds,
        confidence: result.confidence,
        rejectionReasons: result.rejectionReasons,
        startTime: input.observation.startTime,
        endTime: input.observation.endTime,
        ...sessionColumns(input.observation.session),
        ...sealColumns(result),
      });
      return { record, created: true };
    } catch (err) {
      if (!(err instanceof MovementSessionConflictError)) throw err;
      const winner = await this.deps.repository.findByUserSession(
        input.userId,
        input.clientSessionId,
      );
      // The constraint fired, so a row exists; a missing one here would mean
      // the store is lying about its own invariant, and failing closed is
      // safer than inventing a second verification.
      if (!winner) throw err;
      /* The concurrent winner is subject to the same rule as a sequential
         retry: whoever got there first defined this session's provenance, and
         a loser carrying different metadata is refused rather than silently
         handed a record that describes a different session. */
      assertMetadataMatches(winner, input.observation.session);
      return { record: winner, created: false };
    }
  }

  /** Owner-scoped read. A user can only ever fetch their own verification. */
  async get(userId: string, clientSessionId: string): Promise<MovementVerificationRecord | null> {
    return this.deps.repository.findByUserSession(userId, clientSessionId);
  }
}

/**
 * Flatten session metadata into the columns the record stores.
 *
 * A submission without metadata writes NULLs, which is what "legacy" is: not a
 * sentinel version number, not today's mode, just the absence of a fact nobody
 * recorded.
 */
function sessionColumns(session: SessionMetadata | undefined): {
  movementMode: MovementVerificationRecord["movementMode"];
  rulesVersion: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  pausedMs: number | null;
} {
  if (!session) {
    return {
      movementMode: null,
      rulesVersion: null,
      startedAt: null,
      finishedAt: null,
      pausedMs: null,
    };
  }
  let paused = 0;
  for (const pause of session.pauses) paused += Math.max(0, pause.endedAt - pause.startedAt);
  return {
    movementMode: session.mode,
    rulesVersion: session.rulesVersion,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    pausedMs: paused,
  };
}

/**
 * Flatten the transient seal evaluation into the three columns the row keeps.
 *
 * The evaluation that arrives here carries the route slice each closure covers.
 * None of that is written: what is stored is whether the route closed, how, and
 * how many times. The slices existed to be handed to territory logic, which
 * does not exist yet, and keeping them would mean holding a record of where a
 * player's loops closed for no live reader.
 *
 * All three NULL when the engine did not run — a rejected session, or one with
 * no provenance to interpret. `sealed = false` is the different, positive
 * statement that the route was evaluated and stayed open.
 */
function sealColumns(result: MovementVerificationResult): {
  sealed: MovementVerificationRecord["sealed"];
  sealMethods: MovementVerificationRecord["sealMethods"];
  sealEventCount: number | null;
} {
  const summary = toSealSummary(result.sealEvaluation);
  if (!summary) return { sealed: null, sealMethods: null, sealEventCount: null };
  return {
    sealed: summary.sealed,
    sealMethods: summary.methods,
    sealEventCount: summary.eventCount,
  };
}

/**
 * Immutable metadata cannot be rewritten under a session id that already has
 * some.
 *
 * The risk this closes: attempt one stores `mode=A, rulesVersion=X`; attempt
 * two reuses the id with `mode=B, rulesVersion=Y`. Overwriting would let a
 * client restate what a past session was, and silently returning the stored
 * row would tell the client its new payload was accepted when it was not.
 * Neither is safe once gameplay reads this provenance, so a genuine
 * disagreement fails closed.
 *
 * Two cases deliberately do NOT conflict, because they are absence rather than
 * contradiction:
 *  - a legacy submission (no metadata) replaying against a stored row that has
 *    some — an older build retrying a session a newer one already submitted;
 *  - a submission with metadata against a stored legacy row — the row predates
 *    the model and cannot be retroactively stamped.
 * In both, the stored row stands unchanged.
 */
function assertMetadataMatches(
  existing: MovementVerificationRecord,
  incoming: SessionMetadata | undefined,
): void {
  if (!incoming) return;
  if (existing.movementMode === null || existing.rulesVersion === null) return;
  if (existing.startedAt === null || existing.finishedAt === null) return;

  const stored: SessionMetadata = {
    mode: existing.movementMode,
    rulesVersion: existing.rulesVersion,
    startedAt: existing.startedAt,
    finishedAt: existing.finishedAt,
    /* Pauses are stored as a total rather than as intervals, so the comparison
       is on that total. Reconstructing a single synthetic interval on both
       sides compares the one fact the row actually holds, and does not pretend
       to compare a list the database never kept. */
    pauses: [{ startedAt: 0, endedAt: existing.pausedMs ?? 0 }],
  };
  let incomingPaused = 0;
  for (const pause of incoming.pauses) {
    incomingPaused += Math.max(0, pause.endedAt - pause.startedAt);
  }
  const comparable: SessionMetadata = {
    ...incoming,
    pauses: [{ startedAt: 0, endedAt: incomingPaused }],
  };
  if (!sameSessionMetadata(stored, comparable)) {
    throw new MovementSessionMetadataConflictError();
  }
}
