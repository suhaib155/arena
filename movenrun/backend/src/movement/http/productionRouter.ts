/**
 * Production wiring for the movement surface.
 *
 * Bearer verification is delegated to the identity SessionService — the same
 * check the identity router uses — so there is exactly one definition of "a
 * valid session" in the backend. Measurement reuses the existing, already
 * tested GpsService/HexService rather than re-deriving distance or H3 cells.
 *
 * Nothing here opens a DB connection at import time: getDb() is lazy.
 */
import type { Router } from "express";
import { getDb } from "../../db/client.js";
import { getIdentityConfig } from "../../identity/config.js";
import { getProviderConfig } from "../../identity/providerConfig.js";
import { createDrizzleStores } from "../../identity/repositories/drizzle/stores.js";
import { createIdentityServices } from "../../identity/http/wiring.js";
import { GpsService } from "../../services/gps.service.js";
import { HexService } from "../../services/hex.service.js";
import { DrizzleMovementVerificationRepository } from "../repositories/drizzle/store.js";
import { MovementVerificationService } from "../services/movementVerification.service.js";
import { createMovementRouter } from "./router.js";
import { createWriteRateLimiter } from "../../middleware/rateLimit.js";
import type { MovementObservation, ObservedPoint } from "../domain/types.js";

/** GpsService speaks the shared GPSRoute shape; only points/startTime/endTime
 *  are read by validateRoute and calculateDistance, so the chain-specific
 *  fields are filled with inert placeholders — the same adapter approach
 *  workers/gps.worker.ts uses. No wallet is involved or invented. */
function toValidatable(observation: MovementObservation) {
  return {
    id: "",
    userId: "",
    walletAddress: "",
    points: observation.points,
    startTime: observation.startTime,
    endTime: observation.endTime,
    distanceMeters: 0,
    hexIds: [] as string[],
    status: "PROCESSING",
  };
}

export function createProductionMovementRouter(): Router {
  const stores = createDrizzleStores(getDb());
  const providerConfig = getProviderConfig();
  const identity = createIdentityServices(stores, getIdentityConfig(), {}, {
    providerName: providerConfig.providerName,
    providerStatus: providerConfig.providerStatus,
    webhooksEnabled: providerConfig.webhooks.enabled,
  });

  const gps = new GpsService();
  const hex = new HexService();

  const service = new MovementVerificationService({
    repository: new DrizzleMovementVerificationRepository(getDb()),
    generateId: () => crypto.randomUUID(),
    now: () => Date.now(),
    detectAnomalies: (observation) =>
      gps.validateRoute(toValidatable(observation) as never),
    calculateDistance: (points: ObservedPoint[]) => gps.calculateDistance(points as never),
    traversedHexIds: (points: ObservedPoint[]) => hex.getHexIdsForPoints(points),
  });

  return createMovementRouter({
    service,
    writeLimiter: createWriteRateLimiter(),
    // Deny-by-default: any invalid/expired/revoked token throws an
    // IdentityError from verifyAccess and never reaches a handler.
    verifyBearer: async (token) => {
      const session = await identity.sessions.verifyAccess(token);
      return { userId: session.userId };
    },
  });
}
