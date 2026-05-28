import { createRequire } from "node:module";
import IORedis from "ioredis";
import { getConfig } from "../config.js";
import { GpsService } from "../services/gps.service.js";
import { HexService } from "../services/hex.service.js";
import { OracleService } from "../services/oracle.service.js";
import { RouteStatus } from "@movenrun/shared";
import type { GPSRoute } from "@movenrun/shared";
const require = createRequire(import.meta.url);
const { Worker, Queue } = require("bullmq") as {
  Worker: any;
  Queue: any;
};
const config = getConfig();
const redis = new IORedis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
});
export const gpsQueue = new Queue("gps-verification", {
  connection: redis,
});
const gpsService = new GpsService();
const hexService = new HexService();
const oracleService = new OracleService();
interface GpsJob {
  routeId: string;
  walletAddress: string;
  points: Array<{
    lat: number;
    lng: number;
    accuracy: number;
    timestamp: number;
  }>;
  startTime: number;
  endTime: number;
}
const worker = new Worker(
  "gps-verification",
  async (job: { data: GpsJob }) => {
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
    const anomaly = gpsService.validateRoute(route);
    if (anomaly.isAnomaly) {
      console.log(`[GPS Worker] Route ${routeId} rejected:`, anomaly.reasons);
      return {
        status: RouteStatus.Rejected,
        reasons: anomaly.reasons,
      };
    }
    const distanceMeters = Math.round(gpsService.calculateDistance(points));
    route.distanceMeters = distanceMeters;
    const hexIds = hexService.getHexIdsForPoints(points);
    route.hexIds = hexIds;
    const routeHash = gpsService.buildRouteHash(route);
    const oracleSig = await oracleService.signRouteProof(
      walletAddress,
      routeHash,
      distanceMeters
    );
    console.log(
      `[GPS Worker] Route ${routeId} verified: ${distanceMeters}m across ${hexIds.length} hexes`
    );
    return {
      status: RouteStatus.Verified,
      routeHash,
      distanceMeters,
      hexIds,
      oracleSig,
    };
  },
  {
    connection: redis,
    concurrency: 10,
  }
);
worker.on("failed", (job: any, err: Error) => {
  console.error(`[GPS Worker] Job ${job?.id} failed:`, err);
});
worker.on("completed", (job: any) => {
  console.log(`[GPS Worker] Job ${job.id} completed`);
});
export { worker };
