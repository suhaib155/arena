/**
 * Production wiring for gameplay. `createApiApp` calls this only when
 * `gameplayRulesFromEnv()` returns rules, that is when
 * MOVENRUN_GAMEPLAY_ENABLED is "true". With the flag unset nothing here runs:
 * no route is mounted, no maintenance task is added and no gameplay table is
 * touched, so the API works against a database without migration 0011.
 */
import type { Router } from "express";
import type { Db } from "../db/client.js";
import { createWriteRateLimiter } from "../middleware/rateLimit.js";
import { createGameplayRouter, type VerifyBearer } from "./router.js";
import type { GameplayRules } from "./rules.js";
import { GameplayService } from "./service.js";

export interface ProductionGameplay {
  router: Router;
  /** A maintenance task: settles closed days (see api/maintenance.ts). */
  dayClose: { name: string; everyMs: number; run: () => Promise<number> };
}

export function createProductionGameplay(input: {
  db: Db;
  rules: GameplayRules;
  verifyBearer: VerifyBearer;
  rateLimit?: Parameters<typeof createWriteRateLimiter>[0];
}): ProductionGameplay {
  const service = new GameplayService({ db: input.db, rules: input.rules });
  return {
    router: createGameplayRouter({ service, verifyBearer: input.verifyBearer, writeLimiter: createWriteRateLimiter(input.rateLimit) }),
    dayClose: { name: "gameplay day close", everyMs: 15 * 60 * 1000, run: () => service.settleDueDays() },
  };
}
