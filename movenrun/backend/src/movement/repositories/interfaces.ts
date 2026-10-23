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

import type { MovementVerificationStatus, SessionPath } from "../domain/types.js";

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

/**
 * The user has already stored the daily allowance of new verifications. A
 * retry of a session already stored is never refused by this.
 */
export class MovementDailyLimitError extends Error {
  constructor() {
    super("daily movement verification limit reached");
    this.name = "MovementDailyLimitError";
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

/**
 * A per-account admission bound checked in the same atomic step as the insert:
 * at most `max` rows for this user created at or after `since`, counting the
 * new one. Checked before the insert, a count can be passed by any number of
 * concurrent requests that all read the same total.
 */
export interface DailyAdmission {
  since: Date;
  max: number;
}

/**
 * Gameplay data written with the verification, in the same transaction, or
 * not at all. Only rule set 1002's session path today; absent unless
 * gameplay is enabled with a rule set that needs it.
 */
export interface VerificationExtras {
  sessionPath?: SessionPath;
}

export interface MovementVerificationRepository {
  /**
   * Throws {@link MovementSessionConflictError} if the pair already exists,
   * and, with `admission`, {@link MovementDailyLimitError} when the account
   * already holds `admission.max` rows since `admission.since`. An existing
   * pair wins over the limit, so a concurrent retry of an admitted session
   * still converges on its row.
   */
  create(input: CreateMovementVerificationInput, admission?: DailyAdmission, extras?: VerificationExtras): Promise<MovementVerificationRecord>;
  /** The idempotency lookup. Scoped by userId, so one user can never read
   *  another's verification even with a guessed session id. */
  findByUserSession(
    userId: string,
    clientSessionId: string,
  ): Promise<MovementVerificationRecord | null>;
  /** The user's own verifications, newest first, at most `limit`. Scoped by
   *  userId exactly like the lookup above. */
  listByUser(userId: string, limit: number): Promise<MovementVerificationRecord[]>;
  /** How many verifications this user has stored since `since`. */
  countCreatedSince(userId: string, since: Date): Promise<number>;
}

/** In-memory implementation for tests. Mirrors the DB's uniqueness exactly. */
export class InMemoryMovementVerificationRepository
  implements MovementVerificationRepository
{
  private readonly byKey = new Map<string, MovementVerificationRecord>();
  /** Session paths written with their verification, by verification id. */
  readonly sessionPaths = new Map<string, SessionPath>();

  private static key(userId: string, clientSessionId: string): string {
    // Length-prefixed so a userId containing the separator cannot forge a
    // collision with a different user's session.
    return `${userId.length}:${userId}:${clientSessionId}`;
  }

  async create(
    input: CreateMovementVerificationInput,
    admission?: DailyAdmission,
    extras?: VerificationExtras,
  ): Promise<MovementVerificationRecord> {
    const key = InMemoryMovementVerificationRepository.key(
      input.userId,
      input.clientSessionId,
    );
    // No await between the checks and the write, so this is atomic in-process.
    if (this.byKey.has(key)) throw new MovementSessionConflictError();
    if (admission && this.countSync(input.userId, admission.since) >= admission.max) throw new MovementDailyLimitError();
    const record: MovementVerificationRecord = { ...input, createdAt: new Date() };
    this.byKey.set(key, record);
    if (extras?.sessionPath) this.sessionPaths.set(input.id, extras.sessionPath);
    return record;
  }

  async listByUser(userId: string, limit: number): Promise<MovementVerificationRecord[]> {
    return [...this.byKey.values()]
      .filter((record) => record.userId === userId)
      .sort((a, b) => b.endTime - a.endTime)
      .slice(0, limit);
  }

  async countCreatedSince(userId: string, since: Date): Promise<number> {
    return this.countSync(userId, since);
  }

  private countSync(userId: string, since: Date): number {
    let n = 0;
    for (const record of this.byKey.values()) {
      if (record.userId === userId && record.createdAt.getTime() >= since.getTime()) n += 1;
    }
    return n;
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
