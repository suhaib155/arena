/**
 * Route job orchestration — validate → dedup → sign → persist.
 *
 * `processRouteJob` is a pure function over injected dependencies (no imports
 * from `@movenrun/shared`, `gps.service.ts`, `hex.service.ts`, or
 * `oracle.service.ts`). This keeps it resolvable by `tsc` independent of the
 * shared-package build step, and lets tests exercise the full lifecycle
 * (validate/dedup/sign/persist/reject) with an in-memory repository and plain
 * stub functions — no BullMQ, no Redis, no Postgres, no shared package.
 *
 * `workers/gps.worker.ts` wires the real `GpsService`, `HexService`, and
 * `OracleService` in as adapter closures.
 */
import { toHexIdUint64 } from "./oracle.service.js";
import type { PersistedRouteStatus, RouteRepository } from "../repositories/route.repository.js";

export interface RouteJobPoint {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
}

export interface RouteJobInput {
  routeId: string;
  walletAddress: string;
  points: RouteJobPoint[];
  startTime: number;
  endTime: number;
}

export interface AnomalyCheckResult {
  isAnomaly: boolean;
  reasons: string[];
  confidence: number;
}

export interface RouteJobDeps {
  repository: RouteRepository;
  validateRoute: (input: {
    points: RouteJobPoint[];
    startTime: number;
    endTime: number;
  }) => AnomalyCheckResult;
  calculateDistance: (points: RouteJobPoint[]) => number;
  buildRouteHash: (input: {
    walletAddress: string;
    points: RouteJobPoint[];
    startTime: number;
    endTime: number;
  }) => string;
  getHexIdsForPoints: (points: RouteJobPoint[]) => string[];
  /** Signs (chainId, to, routeHash, distanceMeters, hexId) — see oracle.service.ts. */
  signRouteProof: (
    to: string,
    routeHash: string,
    distanceMeters: number,
    hexId: bigint
  ) => Promise<string>;
}

export type RouteJobOutcome =
  | { status: "REJECTED"; rejectionReasons: string[]; routeHash?: string; distanceMeters?: number }
  | { status: "VERIFIED"; routeHash: string; distanceMeters: number; hexId: string; oracleSig: string };

/** "0" is the documented "not in any zone" sentinel (mirrors oracle.service.ts's uint64 0). */
const NO_ZONE_HEX_ID = "0";

/**
 * Process one submitted route end-to-end. Never signs a route that failed
 * validation or that duplicates an existing routeHash / overlaps an already
 * VERIFIED route from the same wallet. Persists every transition.
 */
export async function processRouteJob(
  input: RouteJobInput,
  deps: RouteJobDeps
): Promise<RouteJobOutcome> {
  const { routeId, walletAddress, points, startTime, endTime } = input;

  await deps.repository.update(routeId, { status: "PROCESSING" });

  // 1. Anomaly detection — reject before spending any more work.
  const anomaly = deps.validateRoute({ points, startTime, endTime });
  if (anomaly.isAnomaly) {
    await deps.repository.update(routeId, {
      status: "REJECTED",
      confidence: anomaly.confidence,
      rejectionReasons: anomaly.reasons,
    });
    return { status: "REJECTED", rejectionReasons: anomaly.reasons };
  }

  // 2. Distance, hexes, and the route hash.
  const distanceMeters = Math.round(deps.calculateDistance(points));
  const hexIds = deps.getHexIdsForPoints(points);
  const routeHash = deps.buildRouteHash({ walletAddress, points, startTime, endTime });

  // 3. Server-side dedup — exact duplicate routeHash. Never sign a duplicate.
  const dupHash = await deps.repository.findByRouteHash(routeHash, routeId);
  if (dupHash) {
    const rejectionReasons = [`Duplicate route hash — already submitted as route ${dupHash.id}`];
    await deps.repository.update(routeId, {
      status: "REJECTED",
      routeHash,
      distanceMeters,
      confidence: anomaly.confidence,
      rejectionReasons,
    });
    return { status: "REJECTED", rejectionReasons, routeHash, distanceMeters };
  }

  // 4. Per-wallet time-overlap dedup — reject a route whose window overlaps an
  //    already-VERIFIED route from the same wallet (uses only startTime/endTime,
  //    already-persisted safe scalars; no raw GPS involved).
  const overlap = await deps.repository.findOverlappingVerified(
    walletAddress,
    startTime,
    endTime,
    routeId
  );
  if (overlap) {
    const rejectionReasons = [
      `Route window overlaps a previously verified route (${overlap.id}) for this wallet`,
    ];
    await deps.repository.update(routeId, {
      status: "REJECTED",
      routeHash,
      distanceMeters,
      confidence: anomaly.confidence,
      rejectionReasons,
    });
    return { status: "REJECTED", rejectionReasons, routeHash, distanceMeters };
  }

  // 5. Sign — only reachable once validation passed and no duplicate was found.
  //    A concrete hexId is always signed (0 = not in any zone), per PR #40.
  const primaryHexId = hexIds.length > 0 ? hexIds[0] : NO_ZONE_HEX_ID;
  const oracleSig = await deps.signRouteProof(
    walletAddress,
    routeHash,
    distanceMeters,
    toHexIdUint64(primaryHexId)
  );

  await deps.repository.update(routeId, {
    status: "VERIFIED",
    routeHash,
    distanceMeters,
    hexId: primaryHexId,
    oracleSig,
    confidence: anomaly.confidence,
    rejectionReasons: null,
  });

  return { status: "VERIFIED", routeHash, distanceMeters, hexId: primaryHexId, oracleSig };
}

/**
 * POST /gps/submit orchestration — persists the route record, then hands the
 * job off via `enqueue` (a plain function, not a BullMQ Queue instance) so this
 * stays free of BullMQ/Redis and is directly unit-testable.
 */
export interface SubmitRouteInput {
  walletAddress: string;
  points: RouteJobPoint[];
  startTime: number;
  endTime: number;
}

export interface SubmitRouteDeps {
  repository: RouteRepository;
  enqueue: (job: RouteJobInput) => Promise<void>;
  /** Overridable for deterministic tests; defaults to crypto.randomUUID(). */
  generateId?: () => string;
}

export interface SubmitRouteResult {
  routeId: string;
  status: PersistedRouteStatus;
}

export async function submitRoute(
  input: SubmitRouteInput,
  deps: SubmitRouteDeps
): Promise<SubmitRouteResult> {
  const routeId = (deps.generateId ?? (() => crypto.randomUUID()))();

  // Persist BEFORE enqueueing, so the route id is always resolvable via
  // getRouteView even if the worker hasn't picked the job up yet. Raw GPS
  // points are never persisted — only safe scalar lifecycle metadata.
  const record = await deps.repository.create({
    id: routeId,
    walletAddress: input.walletAddress,
    startTime: input.startTime,
    endTime: input.endTime,
  });

  await deps.enqueue({
    routeId,
    walletAddress: input.walletAddress,
    points: input.points,
    startTime: input.startTime,
    endTime: input.endTime,
  });

  return { routeId, status: record.status };
}

/**
 * GET /gps/verify/:id view — safe scalar lifecycle fields only. Never includes
 * raw GPS points, coordinates, or path. `oracleSig` is surfaced only once the
 * route is VERIFIED. Returns null when the id is unknown (caller maps to 404).
 */
export interface RouteView {
  routeId: string;
  status: PersistedRouteStatus;
  routeHash: string | null;
  distanceMeters: number | null;
  hexId: string | null;
  oracleSig: string | null;
  rejectionReasons: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export async function getRouteView(
  id: string,
  repository: RouteRepository
): Promise<RouteView | null> {
  const record = await repository.findById(id);
  if (!record) return null;

  return {
    routeId: record.id,
    status: record.status,
    routeHash: record.routeHash,
    distanceMeters: record.distanceMeters,
    hexId: record.hexId,
    oracleSig: record.status === "VERIFIED" ? record.oracleSig : null,
    rejectionReasons: record.rejectionReasons,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
