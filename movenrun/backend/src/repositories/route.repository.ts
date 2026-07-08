/**
 * Route lifecycle persistence — repository interface + two implementations.
 *
 * Deliberately imports NOTHING from `@movenrun/shared`, `gps.service.ts`,
 * `hex.service.ts`, or `oracle.service.ts`: this keeps the module resolvable by
 * `tsc` independent of the shared-package build step (see
 * docs/CONTRACTS_AUDIT.md "Backend typecheck scope"), and keeps
 * `InMemoryRouteRepository` usable in tests with zero external services.
 *
 * `PersistedRouteStatus` intentionally mirrors (does not import)
 * `@movenrun/shared`'s `RouteStatus` string values that are relevant to the
 * persisted lifecycle (SUBMITTED, PROCESSING, REJECTED, VERIFIED — "PENDING" is
 * a pre-lifecycle shared-enum value not used here).
 */

export type PersistedRouteStatus = "SUBMITTED" | "PROCESSING" | "REJECTED" | "VERIFIED";

/** A persisted route record. Safe scalar lifecycle metadata only — no raw GPS
 *  points, coordinates, or path are ever stored here. */
export interface RouteRecord {
  id: string;
  walletAddress: string;
  status: PersistedRouteStatus;
  /** Null until the worker computes it (or the route was rejected before that point). */
  distanceMeters: number | null;
  /** Null until computed; unique once set (DB-level backstop for dedup). */
  routeHash: string | null;
  /** Primary captured H3 hex as a string ("0" = not in any zone), null until computed. */
  hexId: string | null;
  /** Anomaly-check confidence (0..1), null until validation runs. */
  confidence: number | null;
  /** Set only once the route is VERIFIED. */
  oracleSig: string | null;
  startTime: number;
  endTime: number;
  rejectionReasons: string[] | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRouteInput {
  id: string;
  walletAddress: string;
  startTime: number;
  endTime: number;
}

export interface UpdateRoutePatch {
  status?: PersistedRouteStatus;
  distanceMeters?: number | null;
  routeHash?: string | null;
  hexId?: string | null;
  confidence?: number | null;
  oracleSig?: string | null;
  rejectionReasons?: string[] | null;
}

/**
 * Thrown by `update()` when a patch's `routeHash` collides with another row's
 * `routeHash` — the `routes_route_hash_unique` DB constraint (or its
 * in-memory-test equivalent below). This is the race-condition backstop: two
 * concurrent submissions of the same route can both pass the synchronous
 * `findByRouteHash` check before either writes, so the losing writer's
 * `update()` call is the last line of defense. Callers (route.service.ts)
 * catch this and convert it into a deterministic duplicate rejection instead
 * of a generic failure.
 */
export class RouteHashConflictError extends Error {
  constructor() {
    super("routeHash uniqueness conflict");
    this.name = "RouteHashConflictError";
  }
}

export interface RouteRepository {
  create(input: CreateRouteInput): Promise<RouteRecord>;
  findById(id: string): Promise<RouteRecord | null>;
  update(id: string, patch: UpdateRoutePatch): Promise<RouteRecord | null>;
  /** Any OTHER route already carrying this exact routeHash — the dedup check. */
  findByRouteHash(routeHash: string, excludeId: string): Promise<RouteRecord | null>;
  /** A VERIFIED route from the same wallet whose [startTime,endTime] window
   *  overlaps — the per-wallet time-overlap dedup check. */
  findOverlappingVerified(
    walletAddress: string,
    startTime: number,
    endTime: number,
    excludeId: string
  ): Promise<RouteRecord | null>;
}

/** In-memory implementation — used by tests and available for local dev without
 *  a live Postgres. Never used in production (see gps.ts / gps.worker.ts, which
 *  wire the Drizzle-backed implementation). */
export class InMemoryRouteRepository implements RouteRepository {
  private rows = new Map<string, RouteRecord>();

  async create(input: CreateRouteInput): Promise<RouteRecord> {
    const now = new Date();
    const record: RouteRecord = {
      id: input.id,
      walletAddress: input.walletAddress,
      status: "SUBMITTED",
      distanceMeters: null,
      routeHash: null,
      hexId: null,
      confidence: null,
      oracleSig: null,
      startTime: input.startTime,
      endTime: input.endTime,
      rejectionReasons: null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(record.id, record);
    return { ...record };
  }

  async findById(id: string): Promise<RouteRecord | null> {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }

  async update(id: string, patch: UpdateRoutePatch): Promise<RouteRecord | null> {
    const row = this.rows.get(id);
    if (!row) return null;
    // Mirrors the DB's routes_route_hash_unique constraint so tests can
    // exercise the race-condition path without a live Postgres.
    if (patch.routeHash) {
      for (const other of this.rows.values()) {
        if (other.id !== id && other.routeHash === patch.routeHash) {
          throw new RouteHashConflictError();
        }
      }
    }
    const updated: RouteRecord = { ...row, ...patch, updatedAt: new Date() };
    this.rows.set(id, updated);
    return { ...updated };
  }

  async findByRouteHash(routeHash: string, excludeId: string): Promise<RouteRecord | null> {
    for (const row of this.rows.values()) {
      if (row.id !== excludeId && row.routeHash === routeHash) return { ...row };
    }
    return null;
  }

  async findOverlappingVerified(
    walletAddress: string,
    startTime: number,
    endTime: number,
    excludeId: string
  ): Promise<RouteRecord | null> {
    for (const row of this.rows.values()) {
      if (row.id === excludeId) continue;
      if (row.walletAddress !== walletAddress) continue;
      if (row.status !== "VERIFIED") continue;
      const overlaps = startTime < row.endTime && endTime > row.startTime;
      if (overlaps) return { ...row };
    }
    return null;
  }
}
