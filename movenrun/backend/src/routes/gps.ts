import { Router } from "express";
import { z } from "zod";
import { gpsQueue } from "../workers/gps.worker.js";
import { getDb } from "../db/client.js";
import { DrizzleRouteRepository } from "../repositories/route.repository.drizzle.js";
import { submitRoute, getRouteView } from "../services/route.service.js";

const router = Router();
const routeRepository = new DrizzleRouteRepository(getDb());

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

// POST /gps/submit — persist the route submission, then queue it for verification.
// See services/route.service.ts (submitRoute) for the persistence + enqueue logic.
router.post("/submit", async (req, res) => {
  const parsed = SubmitRouteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid route data", details: parsed.error.issues });
  }

  const result = await submitRoute(parsed.data, {
    repository: routeRepository,
    enqueue: async (job) => {
      await gpsQueue.add("verify-route", job);
    },
  });

  return res.status(202).json(result);
});

// GET /gps/verify/:id — read the persisted route status. Never returns raw GPS
// points, coordinates, or path — see services/route.service.ts (getRouteView).
router.get("/verify/:id", async (req, res) => {
  const view = await getRouteView(req.params.id, routeRepository);
  if (!view) {
    return res.status(404).json({ error: "Route not found" });
  }
  return res.json(view);
});

export default router;
