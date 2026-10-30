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
import { randomUUID } from "node:crypto";
import { hasEvidenceBreak } from "@movenrun/shared/evidence";
import { H3_RESOLUTION } from "@movenrun/shared/h3";
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
import type { MovementObservation, ObservedPoint, TerritorySealResult } from "../domain/types.js";
import { deriveSessionPath, type SessionPathRule } from "../../gameplay/path.js";
import { claimCellsOf, evaluateSealLoop, type ClaimCellOptions, type SealLoopRule } from "../../gameplay/sealLoop.js";

/** GpsService speaks the shared GPSRoute shape; only points/startTime/endTime
 *  are read by validateRoute and calculateDistance, so the chain-specific
 *  fields are filled with inert placeholders — the same adapter approach
 *  workers/gps.worker.ts uses. No wallet is involved or invented. */
export function toValidatable(observation: MovementObservation) {
  return {
    id: "",
    userId: "",
    walletAddress: "",
    points: observation.points.map((point, index) => {
      const previous = observation.points[index - 1];
      if (!previous) return point;
      const broken = hasEvidenceBreak(
        { latitude: previous.lat, longitude: previous.lng, timestamp: previous.timestamp },
        { latitude: point.lat, longitude: point.lng, timestamp: point.timestamp, breakBefore: point.breakBefore },
        observation.session?.pauses,
      );
      return broken ? { ...point, breakBefore: true } : point;
    }),
    startTime: observation.startTime,
    endTime: observation.endTime,
    distanceMeters: 0,
    hexIds: [] as string[],
    status: "PROCESSING",
  };
}

/** The 1002 path of an accepted observation: its own fixes and pauses, nothing else. */
export function sessionPathFor(rule: SessionPathRule) {
  return (observation: MovementObservation) => deriveSessionPath(observation.points, observation.session?.pauses ?? [], rule);
}

/**
 * Sealing v2's territory seal of an accepted observation: its own fixes (with
 * their reported accuracy) and pauses, nothing else, and the cells it may
 * claim at the rule set's unit resolution.
 */
export function territorySealFor(rule: SealLoopRule, claim: ClaimCellOptions) {
  return (observation: MovementObservation): TerritorySealResult => {
    const r = evaluateSealLoop(observation.points, observation.session?.pauses ?? [], rule);
    if (!r.sealed) return { version: r.version, sealed: false, reason: r.reason, claimUnits: null, claimResolution: null };
    const cells = claimCellsOf(observation.points, r, claim);
    if (cells === null) return { version: r.version, sealed: false, reason: "work_budget_exceeded", claimUnits: null, claimResolution: null };
    return { version: r.version, sealed: true, reason: r.reason, claimUnits: cells, claimResolution: claim.resolution };
  };
}

export function createProductionMovementRouter(
  rateLimitConfig?: Parameters<typeof createWriteRateLimiter>[0],
  /**
   * Gameplay only (MOVENRUN_GAMEPLAY_ENABLED): a session-path rule set (1002)
   * also derives and stores the session path; sealing v2 also computes and
   * stores the territory seal.
   */
  options: { sessionPathRule?: SessionPathRule; territorySealRule?: SealLoopRule; territoryClaim?: ClaimCellOptions } = {},
): Router {
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
    generateId: () => randomUUID(),
    now: () => Date.now(),
    detectAnomalies: (observation) =>
      gps.validateRoute(toValidatable(observation) as never),
    calculateDistance: (points: ObservedPoint[]) => gps.calculateDistance(points as never),
    traversedHexIds: (points: ObservedPoint[]) => hex.getHexIdsForPoints(points),
    ...(options.sessionPathRule ? { sessionPath: sessionPathFor(options.sessionPathRule) } : {}),
    ...(options.territorySealRule ? { territorySeal: territorySealFor(options.territorySealRule, options.territoryClaim ?? { resolution: H3_RESOLUTION }) } : {}),
  });

  return createMovementRouter({
    service,
    writeLimiter: createWriteRateLimiter(rateLimitConfig),
    // Deny-by-default: any invalid/expired/revoked token throws an
    // IdentityError from verifyAccess and never reaches a handler.
    verifyBearer: async (token) => {
      const session = await identity.sessions.verifyAccess(token);
      return { userId: session.userId };
    },
  });
}
