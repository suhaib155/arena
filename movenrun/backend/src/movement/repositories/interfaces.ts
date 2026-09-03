/**
 * Persistence boundary for movement verifications.
 *
 * The uniqueness invariant (one verification per user per client session) is
 * enforced by BOTH the database and this interface, and a violation surfaces
 * as {@link MovementSessionConflictError} so the service can convert it into
 * the deterministic "you already submitted this" outcome instead of a generic
 * failure — the same race-condition-backstop pattern as
 * `RouteHashConflictError` and identity's `UniqueConstraintError`.
 */
import type { MovementMode } from "@movenrun/shared/session";
import type { SealMethod } from "@movenrun/shared/sealing";

import type { MovementVerificationStatus } from "../domain/types.js";

export interface MovementVerificationRecord {
  id: string;
  userId: string;
  clientSessionId: string;
  status: MovementVerificationStatus;
  distanceMeters: number | null;
  durationSeconds: number | null;
  traversedHexIds: string[];
  confidence: number | null;
  rejectionReasons: string[];
  startTime: number;
  endTime: number;
  /**
   * Session provenance, as submitted. NULL for a row created before the
   * session model existed, and for a legacy submission that carries none.
   *
   * Nullable rather than defaulted, deliberately. A default would assert that
   * historical sessions were captured under rules that did not exist when they
   * ran; NULL says the only true thing, which is that nobody recorded it.
   */
  movementMode: MovementMode | null;
  rulesVersion: number | null;
  /** Lifecycle window — when the user started and finished, as distinct from
   *  `startTime`/`endTime`, which bound the observations. */
  startedAt: number | null;
  finishedAt: number | null;
  /** Total paused milliseconds. A summary, not the intervals: the durations
   *  are what later interpretation needs, and the individual pause timestamps
   *  would be a finer-grained record of when someone stood still. */
  pausedMs: number | null;
  /**
   * Sealing, as the engine concluded it — the summary only.
   *
   * NULL across all three means the row was never evaluated: it predates the
   * sealing engine, or it carried no provenance to interpret, or the session
   * was rejected. `false` is a different statement: the route was evaluated and
   * did not close, which is an ordinary outcome and not a failure.
   *
   * There is deliberately no column for where a loop closed. An intersection
   * coordinate, a polygon or a route index would be a finer-grained record of
   * the player's movement than this table has ever kept, and the territory work
   * that needs the geometry can recompute it from the route the client still
   * holds.
   */
  sealed: boolean | null;
  sealMethods: SealMethod[] | null;
  sealEventCount: number | null;
  createdAt: Date;
}

/**
 * Thrown when a retry reuses a session id but carries different immutable
 * metadata.
 *
 * The id says "this is that session"; the metadata says which session that
 * was. When they disagree, one of the two is wrong, and the safe answer is
 * neither overwriting the stored row nor silently returning it as though the
 * new payload had been accepted.
 */
export class MovementSessionMetadataConflictError extends Error {
  constructor() {
    super("movement session metadata does not match the stored verification");
    this.name = "MovementSessionMetadataConflictError";
  }
}

export type CreateMovementVerificationInput = Omit<MovementVerificationRecord, "createdAt">;

/** Thrown when (userId, clientSessionId) already exists. */
export class MovementSessionConflictError extends Error {
  constructor() {
    super("movement verification already exists for this user and session");
    this.name = "MovementSessionConflictError";
  }
}

export interface MovementVerificationRepository {
  /** Throws {@link MovementSessionConflictError} if the pair already exists. */
  create(input: CreateMovementVerificationInput): Promise<MovementVerificationRecord>;
  /** The idempotency lookup. Scoped by userId, so one user can never read
   *  another's verification even with a guessed session id. */
  findByUserSession(
    userId: string,
    clientSessionId: string,
  ): Promise<MovementVerificationRecord | null>;
}

/** In-memory implementation for tests. Mirrors the DB's uniqueness exactly. */
export class InMemoryMovementVerificationRepository
  implements MovementVerificationRepository
{
  private readonly byKey = new Map<string, MovementVerificationRecord>();

  private static key(userId: string, clientSessionId: string): string {
    // Length-prefixed so a userId containing the separator cannot forge a
    // collision with a different user's session.
    return `${userId.length}:${userId}:${clientSessionId}`;
  }

  async create(
    input: CreateMovementVerificationInput,
  ): Promise<MovementVerificationRecord> {
    const key = InMemoryMovementVerificationRepository.key(
      input.userId,
      input.clientSessionId,
    );
    if (this.byKey.has(key)) throw new MovementSessionConflictError();
    const record: MovementVerificationRecord = { ...input, createdAt: new Date() };
    this.byKey.set(key, record);
    return record;
  }

  async findByUserSession(
    userId: string,
    clientSessionId: string,
  ): Promise<MovementVerificationRecord | null> {
    return (
      this.byKey.get(
        InMemoryMovementVerificationRepository.key(userId, clientSessionId),
      ) ?? null
    );
  }
}
