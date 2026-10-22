/**
 * Production wiring for gameplay. `createApiApp` calls this only when
 * `gameplayRulesFromEnv()` returns rules, that is when
 * MOVENRUN_GAMEPLAY_ENABLED is "true". With the flag unset nothing here runs:
 * no route is mounted, no maintenance task is added and no gameplay table is
 * touched, so the API works against a database without migration 0011.
 *
 * Capacity (docs/G34_STORAGE_CAPACITY.md): the per-walker daily unit budget
 * is always on (MOVENRUN_GAMEPLAY_UNIT_BUDGET, default 300). The capacity
 * guard is on only when MOVENRUN_GAMEPLAY_CAPACITY_QUOTA_MIB names the
 * confirmed database quota; it then reads pg_database_size at most once a
 * minute and refuses pushes (503) at the hard stop or when the size cannot
 * be read.
 */
import type { Router } from "express";
import type { Db } from "../db/client.js";
import { createWriteRateLimiter } from "../middleware/rateLimit.js";
import { createGameplayRouter, type VerifyBearer } from "./router.js";
import type { GameplayRules } from "./rules.js";
import { GameplayService } from "./service.js";
import { createCapacityGuard, DEFAULT_THRESHOLDS, gameplayCapacityFromEnv, type CapacityGuard } from "./capacity.js";
import { sql } from "drizzle-orm";

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
  env?: NodeJS.ProcessEnv;
}): ProductionGameplay {
  const capacity = gameplayCapacityFromEnv(input.env ?? process.env);
  let capacityGuard: CapacityGuard | undefined;
  if (capacity.quotaBytes !== null) {
    const db = input.db;
    capacityGuard = createCapacityGuard({
      thresholds: { ...DEFAULT_THRESHOLDS, quotaBytes: capacity.quotaBytes },
      readSizeBytes: async () => Number((await db.execute(sql`SELECT pg_database_size(current_database()) AS b`)).rows[0]?.b),
    });
  }
  const service = new GameplayService({ db: input.db, rules: input.rules, unitBudget: capacity.unitBudget, capacityGuard });
  return {
    router: createGameplayRouter({ service, verifyBearer: input.verifyBearer, writeLimiter: createWriteRateLimiter(input.rateLimit) }),
    dayClose: { name: "gameplay day close", everyMs: 15 * 60 * 1000, run: () => service.settleDueDays() },
  };
}
