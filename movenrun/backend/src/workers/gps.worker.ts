import { Worker, Queue } from "bullmq";
import IORedis from "ioredis";
import { eq, sql } from "drizzle-orm";
import { getConfig } from "../config.js";
import { getDb } from "../db/index.js";
import { gpsSubmissions, hexActivityDaily } from "../db/schema.js";
import { GpsService, type GpsPoint } from "../services/gps.service.js";
import { OracleService } from "../services/oracle.service.js";

const config = getConfig();
const redis = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });

export const gpsQueue = new Queue("gps-verification", { connection: redis });

interface GpsJob {
  jobId: string;
  userAddress: string;
  gpsPoints: GpsPoint[];
  deviceId: string;
}

const worker = new Worker<GpsJob>(
  "gps-verification",
  async (job) => {
    const { jobId, userAddress, gpsPoints, deviceId } = job.data;
    const db = getDb();
    const oracle = new OracleService();
    const gpsService = new GpsService(oracle, redis);

    // ── Layer 1: Plausibility ─────────────────────────────────────────────────
    const plausibility = gpsService.checkPlausibility(gpsPoints);
    if (!plausibility.valid) {
      await db
        .update(gpsSubmissions)
        .set({ status: "REJECTED", rejectionReason: plausibility.reason })
        .where(eq(gpsSubmissions.id, jobId));

      console.log(`[GPS Worker] Job ${jobId} rejected: ${plausibility.reason}`);
      return { status: "REJECTED", reason: plausibility.reason };
    }

    // ── Layer 2: H3 Hex Assignment ────────────────────────────────────────────
    const hexActivity = gpsService.buildHexActivity(gpsPoints);
    const hexActivityRecord = Object.fromEntries(
      [...hexActivity.entries()].map(([k, v]) => [k, Math.round(v)]),
    );

    // ── Layer 3: Oracle Attestation ───────────────────────────────────────────
    const routeHash = gpsService.buildRouteHash(userAddress, gpsPoints, hexActivityRecord);
    const distanceMeters = plausibility.distance_meters;
    const oracleSig = await oracle.signRouteProof(userAddress, routeHash, distanceMeters);

    // Store attestation in Redis with 1-hour TTL for client retrieval
    await redis.setex(
      `attestation:${routeHash}`,
      3600,
      JSON.stringify({ routeHash, userAddress, hexActivity: hexActivityRecord, distanceMeters, deviceId, oracleSig }),
    );

    // ── Persist result to DB ──────────────────────────────────────────────────
    await db
      .update(gpsSubmissions)
      .set({ status: "VERIFIED", routeHash, hexActivity: hexActivityRecord, distanceMeters, oracleSig })
      .where(eq(gpsSubmissions.id, jobId));

    // ── Update hex_activity_daily per hex ─────────────────────────────────────
    const today = new Date().toISOString().slice(0, 10);
    for (const [hexId, meters] of hexActivity) {
      if (meters < 1) continue;
      await db
        .insert(hexActivityDaily)
        .values({
          hexId,
          userAddress,
          date: today,
          distanceMeters: Math.round(meters),
          moveEarned: "0",
        })
        .onConflictDoUpdate({
          target: [hexActivityDaily.hexId, hexActivityDaily.userAddress, hexActivityDaily.date],
          set: {
            distanceMeters: sql`${hexActivityDaily.distanceMeters} + excluded.distance_meters`,
          },
        });
    }

    console.log(
      `[GPS Worker] Job ${jobId} verified: ${distanceMeters}m across ${hexActivity.size} hexes`,
    );

    // TODO: emit WebSocket notification to userAddress
    return {
      status: "VERIFIED",
      routeHash,
      distanceMeters,
      hexIds: Array.from(hexActivity.keys()),
      oracleSig,
    };
  },
  { connection: redis, concurrency: 10 },
);

worker.on("failed", async (job, err) => {
  console.error(`[GPS Worker] Job ${job?.id} failed:`, err);
  if (job?.data?.jobId) {
    try {
      const db = getDb();
      await db
        .update(gpsSubmissions)
        .set({ status: "FAILED", rejectionReason: err.message })
        .where(eq(gpsSubmissions.id, job.data.jobId));
    } catch {
      // best-effort DB update on worker failure
    }
  }
});

console.log("[GPS Worker] Started");
