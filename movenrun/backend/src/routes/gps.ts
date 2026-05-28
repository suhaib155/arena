import express from "express";
import { z } from "zod";
import { gpsQueue } from "../workers/gps.worker.js";

const router = express.Router();

const GPSPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0),
  altitude: z.number().optional(),
  timestamp: z.number().int().positive(),
});

const SubmitRouteSchema = z.object({
  walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  points: z.array(GPSPointSchema).min(2).max(10_000),
  startTime: z.number().int().positive(),
  endTime: z.number().int().positive(),
});

// POST /gps/submit — queue a GPS route for verification
router.post("/submit", async (req, res) => {
  const parsed = SubmitRouteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid route data", details: parsed.error.issues });
  }

  const { walletAddress, points, startTime, endTime } = parsed.data;
  const routeId = crypto.randomUUID();

  await gpsQueue.add("verify-route", {
    routeId,
    walletAddress,
    points,
    startTime,
    endTime,
  });

  return res.status(202).json({ routeId, status: "PENDING" });
});

// GET /gps/verify/:id — check verification status
router.get("/verify/:id", async (req, res) => {
  const { id } = req.params;
  // TODO: look up route status from DB via routeId
  return res.json({ routeId: id, status: "PENDING" });
});

export default router;



