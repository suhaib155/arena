import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as routeSchema from "./schema.js";
import * as identitySchema from "./identity.schema.js";
import * as providerSchema from "./provider.schema.js";
import * as movementSchema from "./movement.schema.js";

// One combined schema object for the Drizzle client — the route/zone/battle
// tables plus the identity/wallet tables and the provider-event table.
const schema = { ...routeSchema, ...identitySchema, ...providerSchema, ...movementSchema };

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
  // Database access does not require the legacy worker/oracle configuration.
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || !/^postgres(?:ql)?:\/\//.test(connectionString)) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL");
  }
  _pool = new Pool({ connectionString, connectionTimeoutMillis: 5000, query_timeout: 10000, statement_timeout: 10000, max: 10 });
  // An idle connection can fail during database maintenance. Never print the
  // underlying error, which can include connection details.
  _pool.on("error", () => { console.error("Database connection unavailable"); });
  _db = drizzle(_pool, { schema });
  return _db;
}

export async function closeDb(): Promise<void> {
  const pool = _pool;
  _pool = null;
  _db = null;
  await pool?.end();
}
