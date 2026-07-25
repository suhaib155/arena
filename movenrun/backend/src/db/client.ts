import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { getConfig } from "../config.js";
import * as routeSchema from "./schema.js";
import * as identitySchema from "./identity.schema.js";
import * as providerSchema from "./provider.schema.js";
import * as territorySchema from "./territory.schema.js";

// One combined schema object for the Drizzle client — the route/zone/battle
// tables plus the identity/wallet tables, the provider-event table, and the
// territory ownership tables.
const schema = {
  ...routeSchema,
  ...identitySchema,
  ...providerSchema,
  ...territorySchema,
};

export type Db = NodePgDatabase<typeof schema>;

let _pool: Pool | null = null;
let _db: Db | null = null;

/**
 * Lazy singleton Postgres/Drizzle client. Nothing connects at import time —
 * the pool is only created the first time a caller actually needs the DB
 * (routes/gps.ts, workers/gps.worker.ts). This keeps modules that merely
 * import this file (including anything transitively reachable from tests)
 * safe to load without a live DATABASE_URL / Postgres instance.
 */
export function getDb(): Db {
  if (_db) return _db;
  const config = getConfig();
  _pool = new Pool({ connectionString: config.DATABASE_URL });
  _db = drizzle(_pool, { schema });
  return _db;
}
