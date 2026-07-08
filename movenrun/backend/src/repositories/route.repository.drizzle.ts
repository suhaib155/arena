import { and, eq, gt, lt, ne } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { routes } from "../db/schema.js";
import type {
  CreateRouteInput,
  RouteRecord,
  RouteRepository,
  UpdateRoutePatch,
} from "./route.repository.js";

function toRecord(row: typeof routes.$inferSelect): RouteRecord {
  return {
    id: row.id,
    walletAddress: row.walletAddress,
    status: row.status,
    distanceMeters: row.distanceMeters,
    routeHash: row.routeHash,
    hexId: row.hexId,
    confidence: row.confidence,
    oracleSig: row.oracleSig,
    startTime: row.startTime,
    endTime: row.endTime,
    rejectionReasons: row.rejectionReasons,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Postgres-backed RouteRepository, used in production (routes/gps.ts, workers/gps.worker.ts). */
export class DrizzleRouteRepository implements RouteRepository {
  constructor(private readonly db: Db) {}

  async create(input: CreateRouteInput): Promise<RouteRecord> {
    const [row] = await this.db
      .insert(routes)
      .values({
        id: input.id,
        walletAddress: input.walletAddress,
        startTime: input.startTime,
        endTime: input.endTime,
        status: "SUBMITTED",
      })
      .returning();
    return toRecord(row);
  }

  async findById(id: string): Promise<RouteRecord | null> {
    const [row] = await this.db.select().from(routes).where(eq(routes.id, id)).limit(1);
    return row ? toRecord(row) : null;
  }

  async update(id: string, patch: UpdateRoutePatch): Promise<RouteRecord | null> {
    const [row] = await this.db
      .update(routes)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(routes.id, id))
      .returning();
    return row ? toRecord(row) : null;
  }

  async findByRouteHash(routeHash: string, excludeId: string): Promise<RouteRecord | null> {
    const [row] = await this.db
      .select()
      .from(routes)
      .where(and(eq(routes.routeHash, routeHash), ne(routes.id, excludeId)))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async findOverlappingVerified(
    walletAddress: string,
    startTime: number,
    endTime: number,
    excludeId: string
  ): Promise<RouteRecord | null> {
    // Standard interval-overlap predicate: existing.start < new.end AND existing.end > new.start.
    const [row] = await this.db
      .select()
      .from(routes)
      .where(
        and(
          eq(routes.walletAddress, walletAddress),
          eq(routes.status, "VERIFIED"),
          ne(routes.id, excludeId),
          lt(routes.startTime, endTime),
          gt(routes.endTime, startTime)
        )
      )
      .limit(1);
    return row ? toRecord(row) : null;
  }
}
