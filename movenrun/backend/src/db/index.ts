import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getConfig } from "../config.js";
import * as schema from "./schema.js";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!_db) {
    const config = getConfig();
    const pool = new Pool({ connectionString: config.DATABASE_URL });
    _db = drizzle(pool, { schema });
  }
  return _db;
}

export type Db = ReturnType<typeof getDb>;
