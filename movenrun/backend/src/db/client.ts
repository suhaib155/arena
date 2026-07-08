import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { getConfig } from "../config.js";
import * as schema from "./schema.js";

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
