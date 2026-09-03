/**
 * Postgres-backed movement verification store (production wiring).
 *
 * Mirrors the in-memory repository's semantics in SQL, and translates a
 * Postgres unique-violation (SQLSTATE 23505) on the user/session index into
 * the typed {@link MovementSessionConflictError} the service already handles —
 * the same pattern as DrizzleRouteRepository/RouteHashConflictError and
 * identity's UniqueConstraintError.
 *
 * That translation is the whole point: it is what makes two concurrent retries
 * of the same completed session converge on one row in the DATABASE rather
 * than in a process-local cache, so the guarantee survives a restart and holds
 * across replicas.
 */
import { and, eq } from "drizzle-orm";
import { isSealMethod, type SealMethod } from "@movenrun/shared/sealing";
import type { Db } from "../../../db/client.js";
import { movementVerifications } from "../../../db/movement.schema.js";
import {
  MovementSessionConflictError,
  type CreateMovementVerificationInput,
  type MovementVerificationRecord,
  type MovementVerificationRepository,
} from "../interfaces.js";

const UNIQUE_INDEX = "movement_verifications_user_session_unique";

function isSessionConflict(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string; detail?: string };
  if (e?.code !== "23505") return false;
  if (e.constraint === UNIQUE_INDEX) return true;
  return typeof e.detail === "string" && e.detail.includes(UNIQUE_INDEX);
}

type Row = typeof movementVerifications.$inferSelect;

/**
 * Read the stored method list, dropping anything this build does not recognise.
 *
 * A text array comes back as whatever is in the column, and a method name is a
 * gameplay fact: a value written by a newer build, or by hand, must not be
 * handed on as though this build understood it. Unknown names are dropped
 * rather than passed through — an unknown method fails closed at the boundary.
 */
function readSealMethods(stored: readonly string[] | null): SealMethod[] | null {
  if (stored === null) return null;
  return stored.filter(isSealMethod);
}

function toRecord(row: Row): MovementVerificationRecord {
  return {
    id: row.id,
    userId: row.userId,
    clientSessionId: row.clientSessionId,
    status: row.status,
    distanceMeters: row.distanceMeters,
    durationSeconds: row.durationSeconds,
    traversedHexIds: row.traversedHexIds ?? [],
    confidence: row.confidence,
    rejectionReasons: row.rejectionReasons ?? [],
    startTime: row.startTime,
    endTime: row.endTime,
    movementMode: row.movementMode,
    rulesVersion: row.rulesVersion,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    pausedMs: row.pausedMs,
    sealed: row.sealed,
    sealMethods: readSealMethods(row.sealMethods),
    sealEventCount: row.sealEventCount,
    createdAt: row.createdAt,
  };
}

export class DrizzleMovementVerificationRepository
  implements MovementVerificationRepository
{
  constructor(private readonly db: Db) {}

  async create(
    input: CreateMovementVerificationInput,
  ): Promise<MovementVerificationRecord> {
    try {
      const [row] = await this.db.insert(movementVerifications).values(input).returning();
      return toRecord(row);
    } catch (err) {
      if (isSessionConflict(err)) throw new MovementSessionConflictError();
      throw err;
    }
  }

  async findByUserSession(
    userId: string,
    clientSessionId: string,
  ): Promise<MovementVerificationRecord | null> {
    const [row] = await this.db
      .select()
      .from(movementVerifications)
      .where(
        and(
          eq(movementVerifications.userId, userId),
          eq(movementVerifications.clientSessionId, clientSessionId),
        ),
      )
      .limit(1);
    return row ? toRecord(row) : null;
  }
}
