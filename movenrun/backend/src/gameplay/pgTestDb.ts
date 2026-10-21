/**
 * A throwaway PostgreSQL database for the gameplay tests: the committed chain
 * 0000-0010, then the proposed 0011 (and, when asked, the proposed 1002
 * session-path addendum), each in one transaction. Test support only; the
 * caller drops the database when done. Nothing here runs against a hosted
 * database: the URL comes from MOVENRUN_TEST_DATABASE_URL.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Db } from "../db/client.js";

const BACKEND = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface TestDb {
  pool: pg.Pool;
  db: Db;
  drop(): Promise<void>;
}

function sqlFile(path: string): string[] {
  return readFileSync(join(BACKEND, path), "utf8").split("--> statement-breakpoint").filter((s) => s.trim());
}

async function runInTx(pool: pg.Pool, statements: string[]): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    for (const s of statements) await c.query(s);
    await c.query("COMMIT");
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  } finally {
    c.release();
  }
}

export async function createTestDb(url: string, prefix: string, opts: { gameplay: boolean; sessionPaths: boolean }): Promise<TestDb> {
  const admin = new pg.Pool({ connectionString: url });
  admin.on("error", () => undefined);
  for (const role of ["anon", "authenticated"]) {
    await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`)
      .catch((err: { code?: string }) => { if (err.code !== "23505" && err.code !== "42710") throw err; });
  }
  const name = `${prefix}_${randomBytes(6).toString("hex")}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const u = new URL(url);
  u.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: u.toString(), max: 40 });
  pool.on("error", () => undefined);
  const journal = JSON.parse(readFileSync(join(BACKEND, "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
  await runInTx(pool, journal.entries.flatMap((e) => sqlFile(`drizzle/${e.tag}.sql`)));
  if (opts.gameplay) await runInTx(pool, sqlFile("drizzle-proposed/0011_gameplay_holdings.sql"));
  if (opts.gameplay && opts.sessionPaths && existsSync(join(BACKEND, "drizzle-proposed/1002_session_paths.sql"))) {
    await runInTx(pool, sqlFile("drizzle-proposed/1002_session_paths.sql"));
  }
  return {
    pool,
    db: drizzle(pool) as unknown as Db,
    async drop() {
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end();
    },
  };
}
