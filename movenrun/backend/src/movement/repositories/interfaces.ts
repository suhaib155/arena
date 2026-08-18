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
  createdAt: Date;
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
