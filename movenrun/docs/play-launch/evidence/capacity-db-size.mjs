// Measures how much PostgreSQL space 1,000 MovenRun accounts take, so the
// Supabase Free 500 MB limit is checked with numbers instead of an estimate.
//
// It creates a throwaway database, applies migrations 0000-0009 exactly as the
// hook contract test does, fills it with synthetic players (no real data), prints
// the size per table, then drops the database. It never connects to Supabase.
//
// Usage (from movenrun/backend, with a local superuser URL):
//   MOVENRUN_TEST_DATABASE_URL=postgres://... node ../docs/play-launch/evidence/capacity-db-size.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const require = createRequire(new URL("../../../backend/package.json", import.meta.url));
const pg = require("pg");
const drizzleDir = new URL("../../../backend/drizzle/", import.meta.url);
const databaseUrl = process.env.MOVENRUN_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("Set MOVENRUN_TEST_DATABASE_URL to a local PostgreSQL superuser URL");
const host = new URL(databaseUrl).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error("Refusing to run against a non-local database");

const ACCOUNTS = 1_000;
const SCENARIOS = {
  // A keen closed-test player: sign-ins on two phones, several walks a week.
  typical: { sessions: 30, walks: 40, hexesPerWalk: 12, auditEvents: 40, walletShare: 0.5 },
  // Far above what a pilot produces: daily walks for three months with long routes.
  heavy: { sessions: 200, walks: 100, hexesPerWalk: 60, auditEvents: 300, walletShare: 1 },
};

function migrationStatements() {
  const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", drizzleDir), "utf8"));
  return journal.entries.flatMap(({ tag }) =>
    readFileSync(new URL(`${tag}.sql`, drizzleDir), "utf8").split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean));
}

async function seed(pool, s) {
  await pool.query(`insert into users (id) select 'usr_' || g from generate_series(1, ${ACCOUNTS}) g`);
  await pool.query(`insert into auth_identities (id, user_id, provider, provider_subject, normalized_email, verification_status, last_authenticated_at)
    select 'aid_' || g, 'usr_' || g, 'supabase_google', gen_random_uuid()::text, 'player' || g || '@example.com', 'verified', now()
    from generate_series(1, ${ACCOUNTS}) g`);
  await pool.query(`insert into wallets (id, user_id, address_canonical, address_checksum, wallet_type, source_provider, ownership_status, is_active, verified_at)
    select 'wal_' || g, 'usr_' || g, lower(a), a, 'external', 'supabase_web3', 'verified', true, now()
    from (select g, '0x' || encode(gen_random_bytes(20), 'hex') as a from generate_series(1, ${Math.round(ACCOUNTS * s.walletShare)}) g) w`);
  await pool.query(`insert into auth_sessions (id, user_id, family_id, refresh_token_hash, device_label, user_agent_hash, expires_at, last_used_at, rotated_at, revoked_at, revocation_reason)
    select 'ses_' || u || '_' || n, 'usr_' || u, 'fam_' || u || '_' || (n / 10), encode(gen_random_bytes(32), 'hex'), 'Android',
           encode(gen_random_bytes(32), 'hex'), now() + interval '30 days', now(), now(), case when n < ${s.sessions} then now() end, case when n < ${s.sessions} then 'rotated' end
    from generate_series(1, ${ACCOUNTS}) u, generate_series(1, ${s.sessions}) n`);
  await pool.query(`insert into movement_verifications (id, user_id, client_session_id, status, distance_meters, duration_seconds, traversed_hex_ids, confidence,
                       rejection_reasons, start_time, end_time, movement_mode, rules_version, started_at, finished_at, paused_ms, sealed, seal_methods, seal_event_count)
    select 'mv_' || u || '_' || n, 'usr_' || u, gen_random_uuid()::text, 'verified', 4200, 2700,
           array(select '88' || substr(md5(u::text || n::text || h::text), 1, 7) || 'ffffff' from generate_series(1, ${s.hexesPerWalk}) h),
           0.93, '{}', 1760000000000, 1760002700000, 'walk', 3, 1760000000000, 1760002700000, 60000, true, '{play_integrity}', 1
    from generate_series(1, ${ACCOUNTS}) u, generate_series(1, ${s.walks}) n`);
  await pool.query(`insert into security_audit_events (id, user_id, event_type, subject_id, metadata)
    select 'aud_' || u || '_' || n, 'usr_' || u, 'session.refreshed', 'ses_' || u || '_' || n, '{"method":"google","outcome":"ok"}'::jsonb
    from generate_series(1, ${ACCOUNTS}) u, generate_series(1, ${s.auditEvents}) n`);
  await pool.query(`insert into auth_user_creations (created_at) select now() - (g || ' minutes')::interval from generate_series(1, ${ACCOUNTS}) g`);
}

const admin = new pg.Pool({ connectionString: databaseUrl, max: 1 });
admin.on("error", () => undefined);
for (const role of ["anon", "authenticated", "supabase_auth_admin"]) {
  await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`);
}
const serverVersion = (await admin.query("show server_version")).rows[0].server_version;
const results = {};
for (const [name, scenario] of Object.entries(SCENARIOS)) {
  const db = `movenrun_capacity_${randomBytes(4).toString("hex")}`;
  await admin.query(`CREATE DATABASE ${db}`);
  const url = new URL(databaseUrl);
  url.pathname = `/${db}`;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
  pool.on("error", () => undefined);
  try {
    for (const statement of migrationStatements()) await pool.query(statement);
    await pool.query("create extension if not exists pgcrypto");
    const empty = Number((await pool.query("select pg_database_size(current_database()) as b")).rows[0].b);
    await seed(pool, scenario);
    await pool.query("vacuum analyze");
    const total = Number((await pool.query("select pg_database_size(current_database()) as b")).rows[0].b);
    const tables = (await pool.query(`select c.relname as t, pg_total_relation_size(c.oid) as b, c.reltuples::bigint as rows
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' order by 2 desc limit 8`)).rows;
    results[name] = { scenario, emptyMB: +(empty / 2 ** 20).toFixed(1), totalMB: +(total / 2 ** 20).toFixed(1),
      playerDataMB: +((total - empty) / 2 ** 20).toFixed(1),
      tables: tables.map((r) => ({ table: r.t, rows: Number(r.rows), MB: +(Number(r.b) / 2 ** 20).toFixed(2) })) };
  } finally {
    await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`).catch(() => undefined);
  }
}
await admin.end();
console.log(JSON.stringify({ accounts: ACCOUNTS, postgres: serverVersion, results }, null, 2));
