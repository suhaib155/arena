import { Worker, Queue } from "bullmq";
import IORedis from "ioredis";
import { getConfig } from "../config.js";
import { GpsService } from "../services/gps.service.js";
import { HexService } from "../services/hex.service.js";
import { OracleService } from "../services/oracle.service.js";
import { processRouteJob, type RouteJobInput } from "../services/route.service.js";
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
        }
      );

      if (outcome.status === "REJECTED") {
        console.log(`[GPS Worker] Route ${routeId} rejected:`, outcome.rejectionReasons);
      } else {
        console.log(
          `[GPS Worker] Route ${routeId} verified: ${outcome.distanceMeters}m, hex ${outcome.hexId}`
        );
      }
      return outcome;
    } catch (err) {
      // Never leave a route stuck in PROCESSING on an unexpected failure (e.g.
      // a signing error). Never log the error's raw content if it could carry
      // sensitive material — log only the message.
      const message = err instanceof Error ? err.message : "Unknown worker error";
      console.error(`[GPS Worker] Route ${routeId} failed:`, message);
      await routeRepository.update(routeId, {
        status: "REJECTED",
        rejectionReasons: [`Worker error: ${message}`],
      });
      throw err;
    }
  },
  { connection: redis, concurrency: 10 }
);

worker.on("failed", (job, err) => {
  console.error(`[GPS Worker] Job ${job?.id} failed:`, err.message);
});

console.log("[GPS Worker] Started");
