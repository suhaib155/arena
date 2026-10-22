/**
 * The server's verification path with its production wiring.
 *
 * Uses the same dependencies `backend/src/movement/http/productionRouter.ts`
 * builds: `GpsService.validateRoute` (through the router's own
 * `toValidatable` adapter) for anomalies, `GpsService.calculateDistance` for
 * distance and `HexService.getHexIdsForPoints` for cells. The repository is the
 * backend's in-memory implementation, so idempotency and the daily cap behave
 * as the service defines them, with no database and no network.
 *
 * Note: the backend's own movement tests stub `detectAnomalies`, so the
 * production anomaly rules (for example `MIN_POINTS = 10` in
 * `gps.service.ts`) are exercised end to end only here.
 */
import { GpsService } from "../../../backend/src/services/gps.service";
import { HexService } from "../../../backend/src/services/hex.service";
import { MovementVerificationService } from "../../../backend/src/movement/services/movementVerification.service";
import { InMemoryMovementVerificationRepository } from "../../../backend/src/movement/repositories/interfaces";
import { submitMovementSchema } from "../../../backend/src/movement/http/validation";
import type { MovementObservation, ObservedPoint } from "../../../backend/src/movement/domain/types";
import { hasEvidenceBreak } from "@movenrun/shared/evidence";

/**
 * Same adapter as `toValidatable` in backend/src/movement/http/productionRouter.ts.
 * Copied rather than imported because that module's import graph carries a
 * pre-existing type error (middleware/rateLimit.ts) that would fail this
 * folder's typecheck; tests/pipelineDrift.test.ts proves the two agree.
 */
export function toValidatable(observation: MovementObservation) {
  return {
    id: "", userId: "", walletAddress: "",
    points: observation.points.map((point, index) => {
      const previous = observation.points[index - 1];
      if (!previous) return point;
      const broken = hasEvidenceBreak(
        { latitude: previous.lat, longitude: previous.lng, timestamp: previous.timestamp },
        { latitude: point.lat, longitude: point.lng, timestamp: point.timestamp, breakBefore: point.breakBefore },
        observation.session?.pauses,
      );
      return broken ? { ...point, breakBefore: true } : point;
    }),
    startTime: observation.startTime, endTime: observation.endTime, distanceMeters: 0, hexIds: [] as string[],
    status: "PROCESSING",
  };
}

export interface ServerOutcome {
  /** HTTP-schema verdict before the service runs. */
  schemaValid: boolean;
  schemaIssues: string[];
  status: "verified" | "rejected" | "not_submitted" | "schema_rejected" | "error";
  distanceMeters: number | null;
  durationSeconds: number | null;
  reasons: string[];
  sealed: boolean | null;
  created: boolean | null;
  cellCount: number;
}

/**
 * P1 (PROPOSED, off by default): drop the legacy `MIN_POINTS = 10` anomaly for
 * sessions that carry metadata, whose every point already passed the shared
 * on-foot policy (`onFootQualityProblems`). The schema floor of two points stays.
 */
export interface ServerCandidateOptions { relaxLegacyPointFloor?: boolean }

export function createServer(now: () => number, options: ServerCandidateOptions = {}) {
  const gps = new GpsService();
  const hex = new HexService();
  const repository = new InMemoryMovementVerificationRepository();
  let id = 0;
  const service = new MovementVerificationService({
    repository,
    generateId: () => `synthetic_${++id}`,
    now,
    detectAnomalies: (observation) => {
      const verdict = gps.validateRoute(toValidatable(observation) as never);
      if (!options.relaxLegacyPointFloor || !observation.session) return verdict;
      const reasons = verdict.reasons.filter((r) => !r.startsWith("Too few GPS points"));
      return { isAnomaly: reasons.length > 0, reasons, confidence: reasons.length === 0 ? 0.95 : verdict.confidence };
    },
    calculateDistance: (points: ObservedPoint[]) => gps.calculateDistance(points as never),
    traversedHexIds: (points: ObservedPoint[]) => hex.getHexIdsForPoints(points),
  });
  return { service, repository };
}

export async function verifyOnServer(
  server: ReturnType<typeof createServer>,
  clientSessionId: string,
  submission: unknown,
  userId = "synthetic-user",
): Promise<ServerOutcome> {
  /* The wire body `movementApi.serializeRequest` builds: sessionId plus the
     flattened observations and the optional session metadata. */
  const sub = submission as { observations: { startTime: number; endTime: number; points: unknown[] }; session?: unknown };
  const wire = { sessionId: clientSessionId, startTime: sub.observations.startTime, endTime: sub.observations.endTime,
    points: sub.observations.points, ...(sub.session ? { session: sub.session } : {}) };
  const parsed = submitMovementSchema.safeParse(wire);
  if (!parsed.success) {
    return {
      schemaValid: false,
      schemaIssues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      status: "schema_rejected", distanceMeters: null, durationSeconds: null, reasons: [], sealed: null,
      created: null, cellCount: 0,
    };
  }
  try {
    const body = parsed.data;
    const observation: MovementObservation = {
      startTime: body.startTime, endTime: body.endTime, points: body.points, session: body.session,
    };
    const { record, created } = await server.service.submit({ userId, clientSessionId, observation });
    return {
      schemaValid: true, schemaIssues: [],
      status: record.status === "verified" ? "verified" : "rejected",
      distanceMeters: record.distanceMeters, durationSeconds: record.durationSeconds,
      reasons: record.rejectionReasons, sealed: (record as { sealed?: boolean | null }).sealed ?? null,
      created, cellCount: record.traversedHexIds.length,
    };
  } catch (error) {
    return {
      schemaValid: true, schemaIssues: [], status: "error", distanceMeters: null, durationSeconds: null,
      reasons: [error instanceof Error ? `${error.name}: ${error.message}` : String(error)], sealed: null,
      created: null, cellCount: 0,
    };
  }
}
