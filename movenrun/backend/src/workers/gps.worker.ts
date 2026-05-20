import { Worker, Queue } from "bullmq";
import IORedis from "ioredis";
import { getConfig } from "../config.js";
import { GpsService } from "../services/gps.service.js";
import { HexService } from "../services/hex.service.js";
import { OracleService } from "../services/oracle.service.js";
import { GPSRoute, RouteStatus } from "@movenrun/shared";

const config = getConfig();
const redis = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });

export const gpsQueue = new Queue("gps-verification", { connection: redis });

const gpsService   = new GpsService();
const hexService   = new HexService();
const oracleService = new OracleService();

interface GpsJob {
  routeId: string;
  walletAddress: string;
  points: Array<{ lat: number; lng: number; accuracy: number; timestamp: number }>;
  startTime: number;
  endTime: number;
}

const worker = new Worker<GpsJob>(
  "gps-verification",
  async (job) => {
    const { routeId, walletAddress, points, startTime, endTime } = job.data;

    const route: GPSRoute = {
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

    // 1. Anomaly detection
    const anomaly = gpsService.validateRoute(route);
    if (anomaly.isAnomaly) {
      console.log(`[GPS Worker] Route ${routeId} rejected:`, anomaly.reasons);
      // TODO: update DB status to REJECTED
      return { status: RouteStatus.Rejected, reasons: anomaly.reasons };
    }

    // 2. Calculate distance
    const distanceMeters = Math.round(gpsService.calculateDistance(points));
    route.distanceMeters = distanceMeters;

    // 3. Get hex IDs covered
    const hexIds = hexService.getHexIdsForPoints(points);
    route.hexIds = hexIds;

    // 4. Build route hash
    const routeHash = gpsService.buildRouteHash(route);

    // 5. Get oracle signature
    const oracleSig = await oracleService.signRouteProof(walletAddress, routeHash, distanceMeters);

    // TODO: persist to DB, emit event for mobile to poll

    console.log(`[GPS Worker] Route ${routeId} verified: ${distanceMeters}m across ${hexIds.length} hexes`);
    return {
      status: RouteStatus.Verified,
      routeHash,
      distanceMeters,
      hexIds,
      oracleSig,
    };
  },
  { connection: redis, concurrency: 10 }
);

worker.on("failed", (job, err) => {
  console.error(`[GPS Worker] Job ${job?.id} failed:`, err);
});

console.log("[GPS Worker] Started");
