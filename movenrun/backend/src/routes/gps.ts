import { Router } from "express";
import { z } from "zod";
import { gpsQueue } from "../workers/gps.worker.js";
import { GpsService } from "../services/gps.service.js";
import { OracleService } from "../services/oracle.service.js";
import { getRedis } from "../lib/redis.js";
import { getDb } from "../db/index.js";
import { gpsSubmissions } from "../db/schema.js";
import { eq } from "drizzle-orm";

const router = Router();

// ─── Schema ───────────────────────────────────────────────────────────────────

const GpsPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  timestamp: z.number().int().positive(),
  altitude: z.number().optional(),
  accuracy: z.number().min(0).optional(),
});

const SubmitBodySchema = z.object({
  gpsPoints: z.array(GpsPointSchema).min(2).max(10_000),
  userAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  deviceAttestation: z.string().min(1),
});

// ─── Device attestation format validation ────────────────────────────────────

type DeviceAttestationFormat = "safetynet" | "devicecheck" | "unknown";

function validateDeviceAttestation(token: string): {
  valid: boolean;
  format: DeviceAttestationFormat;
  reason?: string;
} {
  // SafetyNet / Play Integrity: JWT format (three base64url segments separated by dots)
  const jwtParts = token.split(".");
  if (jwtParts.length === 3 && jwtParts.every((p) => /^[A-Za-z0-9_-]+$/.test(p))) {
    try {
      const payload = JSON.parse(Buffer.from(jwtParts[1], "base64url").toString("utf8"));
      if (typeof payload === "object" && payload !== null) {
        // Full cryptographic verification would call Google Play Integrity API here
        return { valid: true, format: "safetynet" };
      }
    } catch {
      // Not valid JWT payload
    }
  }

  // Apple DeviceCheck: base64-encoded binary token (typically ~120 bytes)
  const b64Regex = /^[A-Za-z0-9+/]+=*$/;
  if (b64Regex.test(token)) {
    const decoded = Buffer.from(token, "base64");
    if (decoded.length >= 32) {
      // Full verification would call Apple DeviceCheck API here
      return { valid: true, format: "devicecheck" };
    }
  }

  return { valid: false, format: "unknown", reason: "Unrecognised device attestation format" };
}

// ─── POST /gps/submit ─────────────────────────────────────────────────────────

router.post("/submit", async (req, res) => {
  const parsed = SubmitBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
  }

  const { gpsPoints, userAddress, deviceAttestation } = parsed.data;

  const attResult = validateDeviceAttestation(deviceAttestation);
  if (!attResult.valid) {
    return res.status(400).json({ error: "Invalid device attestation", reason: attResult.reason });
  }

  // Fast synchronous plausibility check before queuing
  const oracle = new OracleService();
  const redis = getRedis();
  const gpsService = new GpsService(oracle, redis);
  const plausibility = gpsService.checkPlausibility(gpsPoints);
  if (!plausibility.valid) {
    return res.status(422).json({ error: "Route failed plausibility check", reason: plausibility.reason });
  }

  const jobId = crypto.randomUUID();
  const deviceId = Buffer.from(deviceAttestation.slice(0, 64)).toString("hex");

  const db = getDb();
  await db.insert(gpsSubmissions).values({
    id: jobId,
    userAddress,
    gpsPoints,
    status: "PENDING",
    deviceId,
  });

  await gpsQueue.add(
    "verify-route",
    { jobId, userAddress, gpsPoints, deviceId },
    { jobId },
  );

  return res.status(202).json({ jobId, status: "PENDING" });
});

// ─── GET /gps/status/:jobId ───────────────────────────────────────────────────

router.get("/status/:jobId", async (req, res) => {
  const { jobId } = req.params;

  const db = getDb();
  const rows = await db
    .select()
    .from(gpsSubmissions)
    .where(eq(gpsSubmissions.id, jobId))
    .limit(1);

  if (rows.length === 0) {
    return res.status(404).json({ error: "Job not found" });
  }

  const row = rows[0];

  if (row.status === "VERIFIED") {
    return res.json({
      jobId,
      status: row.status,
      result: {
        oracleSig: row.oracleSig,
        hexActivity: row.hexActivity,
        distanceMeters: row.distanceMeters,
        routeHash: row.routeHash,
      },
    });
  }

  return res.json({ jobId, status: row.status });
});

// ─── POST /gps/verify (sync, for testing) ────────────────────────────────────

router.post("/verify", async (req, res) => {
  const parsed = SubmitBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
  }

  const { gpsPoints, userAddress, deviceAttestation } = parsed.data;

  const attResult = validateDeviceAttestation(deviceAttestation);
  if (!attResult.valid) {
    return res.status(400).json({ error: "Invalid device attestation", reason: attResult.reason });
  }

  const oracle = new OracleService();
  const redis = getRedis();
  const gpsService = new GpsService(oracle, redis);

  try {
    const deviceId = Buffer.from(deviceAttestation.slice(0, 64)).toString("hex");
    const attestation = await gpsService.createAttestation(userAddress, gpsPoints, deviceId);

    return res.json({
      status: "VERIFIED",
      oracleSig: attestation.oracleSig,
      hexActivity: attestation.hexActivity,
      distanceMeters: attestation.distanceMeters,
      routeHash: attestation.routeHash,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Verification failed";
    return res.status(422).json({ error: message });
  }
});

export default router;
