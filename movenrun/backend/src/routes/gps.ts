import { Router } from "express";
import { createHash } from "crypto";
import { z } from "zod";
import { gpsQueue } from "../workers/gps.worker.js";
import { getRedis } from "../services/redis.js";

const router = Router();

const GPS_RATE_LIMIT_MAX = 10;
const GPS_RATE_LIMIT_WINDOW_SECONDS = 3600; // 1 hour

const GPSPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0),
  altitude: z.number().optional(),
  timestamp: z.number().int().positive(),
});

const SubmitRouteSchema = z.object({
  walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  points: z.array(GPSPointSchema).min(10, "Minimum 10 GPS points required").max(10_000),
  startTime: z.number().int().positive(),
  endTime: z.number().int().positive(),
});

function buildPreliminaryHash(
  walletAddress: string,
  points: Array<{ lat: number; lng: number; timestamp: number }>,
  startTime: number,
  endTime: number
): string {
  const payload = JSON.stringify({
    walletAddress,
    points: points.map((p) => [p.lat, p.lng, p.timestamp]),
    startTime,
    endTime,
  });
  return createHash("sha256").update(payload).digest("hex");
}

// POST /gps/submit — queue a GPS route for verification
router.post("/submit", async (req, res) => {
  const parsed = SubmitRouteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Invalid route data",
      code: "VALIDATION_ERROR",
      details: parsed.error.issues,
    });
  }

  const { walletAddress, points, startTime, endTime } = parsed.data;
  const redis = getRedis();

  try {
    // Check if user is banned
    const banKey = `banned:${walletAddress.toLowerCase()}`;
    const banReason = await redis.get(banKey);
    if (banReason) {
      return res.status(403).json({
        success: false,
        error: "Account is banned",
        code: "USER_BANNED",
        reason: banReason,
      });
    }

    // Rate limit: 10 GPS submissions per user per hour
    const rateLimitKey = `ratelimit:gps:${walletAddress.toLowerCase()}`;
    const count = await redis.incr(rateLimitKey);
    if (count === 1) {
      await redis.expire(rateLimitKey, GPS_RATE_LIMIT_WINDOW_SECONDS);
    }
    if (count > GPS_RATE_LIMIT_MAX) {
      const ttl = await redis.ttl(rateLimitKey);
      return res.status(429).json({
        success: false,
        error: "Rate limit exceeded",
        code: "RATE_LIMITED",
        message: `Maximum ${GPS_RATE_LIMIT_MAX} GPS submissions per hour`,
        retryAfterSeconds: ttl,
      });
    }

    // Duplicate route detection — reject if exact same route was already submitted
    const routeContentHash = buildPreliminaryHash(walletAddress, points, startTime, endTime);
    const dupKey = `route:content:${routeContentHash}`;
    const existingRouteId = await redis.get(dupKey);
    if (existingRouteId) {
      return res.status(409).json({
        success: false,
        error: "Duplicate route",
        code: "DUPLICATE_ROUTE",
        routeId: existingRouteId,
      });
    }

    const routeId = crypto.randomUUID();

    // Store content hash → routeId mapping (24-hour TTL)
    await redis.setex(dupKey, 86400, routeId);

    await gpsQueue.add("verify-route", {
      routeId,
      walletAddress,
      points,
      startTime,
      endTime,
    });

    return res.status(202).json({ success: true, routeId, status: "PENDING" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[GPS] submit error", { walletAddress, error: message });
    return res.status(500).json({
      success: false,
      error: "Failed to submit route",
      code: "INTERNAL_ERROR",
    });
  }
});

// GET /gps/verify/:id — check verification status
router.get("/verify/:id", async (req, res) => {
  const { id } = req.params;
  try {
    // TODO: look up route status from DB via routeId
    return res.json({ success: true, routeId: id, status: "PENDING" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[GPS] verify error", { routeId: id, error: message });
    return res.status(500).json({
      success: false,
      error: "Failed to fetch route status",
      code: "INTERNAL_ERROR",
    });
  }
});

export default router;
