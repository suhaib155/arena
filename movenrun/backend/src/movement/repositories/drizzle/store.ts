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
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { isSealMethod, type SealMethod } from "@movenrun/shared/sealing";
import type { Db } from "../../../db/client.js";
import { movementVerifications } from "../../../db/movement.schema.js";
import {
  MovementDailyLimitError,
  MovementSessionConflictError,
  type CreateMovementVerificationInput,
  type DailyAdmission,
  type MovementVerificationRecord,
  type MovementVerificationRepository,
  type VerificationExtras,
} from "../interfaces.js";
import type { SessionPath } from "../../domain/types.js";

/** H3 index as a decimal bigint (8 bytes per unit in a bigint[] column). */
function cellToInt8(cell: string): string {
  if (!/^[0-9a-f]{15,16}$/.test(cell)) throw new RangeError("not an H3 index");
  return BigInt(`0x${cell}`).toString(10);
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Rule set 1002's session path, written in the verification's transaction
 * (table `gameplay_session_paths`, proposed with migration 0011, see
 * drizzle-proposed/0011_gameplay_holdings.sql, revision 3). Only reached when gameplay asked
 * for a path, so with gameplay off no gameplay table is touched.
 */
async function insertSessionPath(tx: Tx, movementVerificationId: string, path: SessionPath): Promise<void> {
  const ids = path.units.map(cellToInt8);
  const bits = path.interpolated.map((f) => (f ? "1" : "0")).join("");
  await tx.execute(sql`
    INSERT INTO gameplay_session_paths (movement_verification_id, path_version, resolution, unit_ids, interpolated, skipped_segments, truncated)
    VALUES (${movementVerificationId}, ${path.pathVersion}, ${path.resolution}, ${sql.param(ids)}::bigint[], ${bits}::varbit,
            ${path.skippedSegments}, ${path.truncated})`);
}

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

  /**
   * With `admission`, the count and the insert run in one transaction that
   * first takes a transaction-scoped advisory lock keyed by the user. Two
   * submissions from one account therefore run one after the other: the second
   * waits for the first to commit, and under READ COMMITTED its count then
   * sees the first row. Other accounts take different keys and never wait on
   * each other (a hash collision only serialises two accounts, never admits
   * extra rows). The lock is released by COMMIT or ROLLBACK, so a crash cannot
   * leave it held, and it works through a transaction-mode pooler.
   *
   * The session lookup comes before the count so a concurrent retry of a
   * session admitted moments ago gets the conflict (and so its stored row),
   * never the limit.
   */
  async create(
    input: CreateMovementVerificationInput,
    admission?: DailyAdmission,
    extras?: VerificationExtras,
  ): Promise<MovementVerificationRecord> {
    const path = extras?.sessionPath;
    try {
      if (!admission) {
        if (!path) {
          const [row] = await this.db.insert(movementVerifications).values(input).returning();
          return toRecord(row);
        }
        return await this.db.transaction(async (tx) => {
          const [row] = await tx.insert(movementVerifications).values(input).returning();
          await insertSessionPath(tx, row.id, path);
          return toRecord(row);
        });
      }
      return await this.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"movement_admission:" + input.userId}, 0))`);
        const [same] = await tx
          .select({ id: movementVerifications.id })
          .from(movementVerifications)
          .where(and(eq(movementVerifications.userId, input.userId), eq(movementVerifications.clientSessionId, input.clientSessionId)))
          .limit(1);
        if (same) throw new MovementSessionConflictError();
        const [counted] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(movementVerifications)
          .where(and(eq(movementVerifications.userId, input.userId), gte(movementVerifications.createdAt, admission.since)));
        if ((counted?.n ?? 0) >= admission.max) throw new MovementDailyLimitError();
        const [row] = await tx.insert(movementVerifications).values(input).returning();
        if (path) await insertSessionPath(tx, row.id, path);
        return toRecord(row);
      });
    } catch (err) {
      if (isSessionConflict(err)) throw new MovementSessionConflictError();
      throw err;
    }
  }

  async listByUser(userId: string, limit: number): Promise<MovementVerificationRecord[]> {
    const rows = await this.db
      .select()
      .from(movementVerifications)
      .where(eq(movementVerifications.userId, userId))
      .orderBy(desc(movementVerifications.endTime), desc(movementVerifications.createdAt))
      .limit(limit);
    return rows.map(toRecord);
  }

  async countCreatedSince(userId: string, since: Date): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(movementVerifications)
      .where(and(eq(movementVerifications.userId, userId), gte(movementVerifications.createdAt, since)));
    return row?.n ?? 0;
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
