import { Router } from "express";
import { z } from "zod";
import { gpsQueue } from "../workers/gps.worker.js";
import { getDb } from "../db/client.js";
import { DrizzleRouteRepository } from "../repositories/route.repository.drizzle.js";
import { submitRoute, getRouteView } from "../services/route.service.js";
import { requireWalletAuth } from "../middleware/auth.js";
import { createWriteRateLimiter } from "../middleware/rateLimit.js";

const router = Router();
const routeRepository = new DrizzleRouteRepository(getDb());
const writeLimiter = createWriteRateLimiter();

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
// Wallet-signature auth (see middleware/auth.ts) runs BEFORE this handler body,
// so an auth failure never reaches parsing, persistence, or enqueueing.
router.post("/submit", requireWalletAuth(), writeLimiter, async (req, res) => {
  const parsed = SubmitRouteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid route data", details: parsed.error.issues });
  }

  // The verified signer (req.movenrunAuth, set by requireWalletAuth) must be
  // the wallet the route is submitted for — a caller cannot submit a route,
  // and therefore cannot get it signed/persisted, for someone else's wallet.
  if (parsed.data.walletAddress.toLowerCase() !== req.movenrunAuth!.address) {
    return res.status(403).json({ error: "Signer does not match walletAddress" });
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
//
// Owner-authorized. This was previously unauthenticated: anyone holding a route
// UUID could read that wallet's verified distance, primary hex, session window
// and — once VERIFIED — its oracle signature. A capability URL is not an
// authorization model for another user's movement, so the same wallet-signature
// auth the write path uses now guards the read, and the verified signer must be
// the wallet the route belongs to.
//
// A route owned by someone else returns 404, not 403, so this cannot be used to
// probe whether a given route id exists.
router.get("/verify/:id", requireWalletAuth(), async (req, res) => {
  const view = await getRouteView(req.params.id, routeRepository);
  if (!view) {
    return res.status(404).json({ error: "Route not found" });
  }
  const owner = await routeRepository.findById(req.params.id);
  if (!owner || owner.walletAddress.toLowerCase() !== req.movenrunAuth!.address) {
    return res.status(404).json({ error: "Route not found" });
  }
  return res.json(view);
});

export default router;
