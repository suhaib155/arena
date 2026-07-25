import { Worker, Queue } from "bullmq";
import IORedis from "ioredis";
import { getConfig } from "../config.js";
import { GpsService } from "../services/gps.service.js";
import { HexService } from "../services/hex.service.js";
import { OracleService } from "../services/oracle.service.js";
import { processRouteJob, type RouteJobInput } from "../services/route.service.js";
import { evaluateLoopCapture } from "../territory/capture.js";
import { getTerritoryConfig } from "../territory/config.js";
import { getDb } from "../db/client.js";
import { DrizzleRouteRepository } from "../repositories/route.repository.drizzle.js";
import { RouteStatus, type GPSRoute } from "@movenrun/shared";

const config = getConfig();
const redis = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });

export const gpsQueue = new Queue("gps-verification", { connection: redis });

const gpsService = new GpsService();
const hexService = new HexService();
const oracleService = new OracleService();
const routeRepository = new DrizzleRouteRepository(getDb());
// Validated at worker startup — an invalid territory configuration must fail
// here, loudly, rather than silently mis-awarding territory later.
const territoryConfig = getTerritoryConfig();

type GpsJob = RouteJobInput;
type JobPoint = GpsJob["points"][number];

/** Build the shared GPSRoute shape GpsService expects; distanceMeters/hexIds/status
 *  are not read by validateRoute/buildRouteHash and are filled with placeholders. */
function toGpsRoute(
  routeId: string,
  walletAddress: string,
  points: JobPoint[],
  startTime: number,
  endTime: number
): GPSRoute {
  return {
    id: routeId,
    userId: walletAddress,
    walletAddress,
    points,
    startTime,
    endTime,
    distanceMeters: 0,
    hexIds: [],
    status: RouteStatus.Processing,
  };
}

const worker = new Worker<GpsJob>(
  "gps-verification",
  async (job) => {
    const { routeId, walletAddress, points, startTime, endTime } = job.data;

    try {
      // processRouteJob owns the full lifecycle: mark PROCESSING, validate,
      // server-side routeHash + per-wallet time-overlap dedup, then sign only
      // when neither check rejects it. It persists every transition itself —
      // see services/route.service.ts. The real GpsService/HexService/
      // OracleService are wired in here as adapter closures so
      // route.service.ts stays free of any `@movenrun/shared` import (see its
      // header comment / docs/CONTRACTS_AUDIT.md "Backend typecheck scope").
      const outcome = await processRouteJob(
        { routeId, walletAddress, points, startTime, endTime },
        {
          repository: routeRepository,
          validateRoute: ({ points: pts, startTime: st, endTime: et }) =>
            gpsService.validateRoute(toGpsRoute(routeId, walletAddress, pts, st, et)),
          calculateDistance: (pts) => gpsService.calculateDistance(pts),
          buildRouteHash: ({ walletAddress: wa, points: pts, startTime: st, endTime: et }) =>
            gpsService.buildRouteHash(toGpsRoute(routeId, wa, pts, st, et)),
          getHexIdsForPoints: (pts) => hexService.getHexIdsForPoints(pts),
          signRouteProof: (to, routeHash, distanceMeters, hexId) =>
            oracleService.signRouteProof(to, routeHash, distanceMeters, hexId),
          // Closed-loop territory capture. processRouteJob only reaches this
          // after validation and both dedup checks have passed, so a rejected
          // route can never be evaluated for capture, let alone awarded any.
          // getHexIdsForPoints above is untouched: it still runs on the LEGACY
          // resolution-8 grid that the oracle signature and the deployed
          // contracts depend on. Capture uses the separate versioned territory
          // grid (v2 @ resolution 9) and never feeds the signed hexId.
          evaluateCapture: ({ points: pts, startTime: st, endTime: et }) => {
            const evaluation = evaluateLoopCapture(
              { points: pts, startTime: st, endTime: et },
              territoryConfig
            );
            return {
              traversedHexIds: evaluation.traversedHexIds,
              capturedHexIds: evaluation.capturedHexIds,
              loopClosed: evaluation.loopClosed,
              closureDistanceMeters: evaluation.closureDistanceMeters,
              enclosedAreaSquareMeters: evaluation.enclosedAreaSquareMeters,
              captureEligible: evaluation.captureEligible,
              captureRejectionReasons: evaluation.captureRejectionReasons,
              captureGridVersion: evaluation.captureGridVersion,
              captureResolution: evaluation.captureResolution,
            };
          },
        }
      );

      if (outcome.status === "REJECTED") {
        console.log(`[GPS Worker] Route ${routeId} rejected:`, outcome.rejectionReasons);
      } else {
        console.log(
          `[GPS Worker] Route ${routeId} verified: ${outcome.distanceMeters}m, hex ${outcome.hexId}`
        );
        // Counts and reasons only — never a coordinate, an area boundary, or
        // any other value that could reconstruct where someone ran.
        if (outcome.capture) {
          console.log(
            `[GPS Worker] Route ${routeId} capture: eligible=${outcome.capture.captureEligible} ` +
              `closed=${outcome.capture.loopClosed} cells=${outcome.capture.capturedHexIds.length} ` +
              `grid=v${outcome.capture.captureGridVersion}` +
              (outcome.capture.captureRejectionReasons.length > 0
                ? ` reasons=${outcome.capture.captureRejectionReasons.join(",")}`
                : "")
          );
        }
        if (outcome.territoryError) {
          console.error(
            `[GPS Worker] Route ${routeId} verified but territory application failed:`,
            outcome.territoryError
          );
        }
      }
      return outcome;
    } catch (err) {
      // Never leave a route stuck in PROCESSING on an unexpected failure (e.g.
      // a signing error). Never log the error's raw content if it could carry
      // sensitive material — log only the message.
      const message = err instanceof Error ? err.message : "Unknown worker error";
      console.error(`[GPS Worker] Route ${routeId} failed:`, message);
      try {
        await routeRepository.update(routeId, {
          status: "REJECTED",
          rejectionReasons: [`Worker error: ${message}`],
        });
      } catch (updateErr) {
        // Best-effort only: signing already failed closed above (it is
        // unreachable without a prior successful persisted dedup check), so
        // this catch only affects how the failure gets recorded. If
        // persistence itself is unavailable (e.g. a total DB outage), this
        // route may remain stuck in PROCESSING until the outage clears and
        // it's retried or cleaned up operationally — see docs/CONTRACTS_AUDIT.md.
        const updateMessage = updateErr instanceof Error ? updateErr.message : "Unknown error";
        console.error(
          `[GPS Worker] Route ${routeId} could not be marked REJECTED (persistence unavailable):`,
          updateMessage
        );
      }
      throw err;
    }
  },
  { connection: redis, concurrency: 10 }
);

worker.on("failed", (job, err) => {
  console.error(`[GPS Worker] Job ${job?.id} failed:`, err.message);
});

console.log("[GPS Worker] Started");
