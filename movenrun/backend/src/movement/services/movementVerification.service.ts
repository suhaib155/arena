/**
 * Movement verification — the only writer of movement_verifications.
 *
 * The trust boundary in one place: `userId` is supplied by the caller from a
 * verified bearer session and is never read from the request body. Everything
 * the client sends is an observation; everything persisted or returned is
 * server-derived.
 */
import { verifyMovement, type VerifyMovementDeps } from "../domain/verification.js";
import type { MovementObservation } from "../domain/types.js";
import {
  MovementSessionConflictError,
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
    if (existing) return { record: existing, created: false };

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
      return { record: winner, created: false };
    }
  }

  /** Owner-scoped read. A user can only ever fetch their own verification. */
  async get(userId: string, clientSessionId: string): Promise<MovementVerificationRecord | null> {
    return this.deps.repository.findByUserSession(userId, clientSessionId);
  }
}
