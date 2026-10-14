/**
 * The Supabase "before user created" hook (migrations 0007 and 0009) on real
 * PostgreSQL: who may call it, what it returns, and how it behaves under
 * concurrency. Supabase itself is not involved; whether the hosted project
 * actually calls the function is proven at X-07 (LIVE_SETUP_OPERATOR_GUIDE.md).
 *
 * Each run applies every committed migration, in journal order, to a scratch
 * database that is dropped afterwards. The roles Supabase has (anon,
 * authenticated, supabase_auth_admin) are created first when the test user may
 * create roles, so the migration's grants are exercised as they would be there.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import pg from "pg";

const databaseUrl = process.env.MOVENRUN_TEST_DATABASE_URL;
const drizzleDir = new URL("../../../drizzle/", import.meta.url);
const HOOK = "public.movenrun_before_user_created(jsonb)";

type Pool = InstanceType<typeof pg.Pool>;

function migrationStatements(): string[] {
  const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", drizzleDir), "utf8")) as { entries: { tag: string }[] };
  return journal.entries.flatMap(({ tag }) =>
    readFileSync(new URL(`${tag}.sql`, drizzleDir), "utf8").split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean));
}

async function withScratchDatabase(run: (pool: Pool, url: string, rolesCreated: boolean) => Promise<void>) {
  const admin = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  admin.on("error", () => undefined);
  const name = `movenrun_hook_${randomBytes(4).toString("hex")}`;
  let rolesCreated = false;
  try {
    const me = await admin.query("select rolcreaterole or rolsuper as can from pg_roles where rolname = current_user");
    if (me.rows[0]?.can) {
      for (const role of ["anon", "authenticated", "supabase_auth_admin"]) {
        await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role} NOLOGIN; END IF; END $$`);
      }
      rolesCreated = true;
    }
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(databaseUrl!);
    url.pathname = `/${name}`;
    const pool = new pg.Pool({ connectionString: url.toString(), max: 25 });
    pool.on("error", () => undefined); // idle clients closed by the final DROP DATABASE
    try {
      for (const statement of migrationStatements()) await pool.query(statement);
      await run(pool, url.toString(), rolesCreated);
    } finally {
      await pool.end();
    }
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => undefined);
    await admin.end();
  }
}

const call = async (pool: Pool) => (await pool.query("select public.movenrun_before_user_created('{}'::jsonb) as r")).rows[0].r as Record<string, unknown>;
const count = async (pool: Pool, sql: string) => (await pool.query(sql)).rows[0].n as number;
async function addPlayers(pool: Pool, n: number) {
  await pool.query("insert into users (id) select 'player-' || g || '-' || md5(random()::text) from generate_series(1, $1) g", [n]);
}

test("before-user-created hook: privileges, return shape, cap, quota, concurrency and fail-closed", { skip: !databaseUrl }, async () => {
  await withScratchDatabase(async (pool, _url, rolesCreated) => {
    // Return shape while open: an empty object, and one timestamp recorded.
    assert.deepEqual(await call(pool), {});
    assert.equal(await count(pool, "select count(*)::int as n from auth_user_creations"), 1);
    // The record holds no identifier: only a sequence number and a time.
    const columns = (await pool.query(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'auth_user_creations' order by ordinal_position")).rows.map((r) => r.column_name);
    assert.deepEqual(columns, ["id", "created_at"]);

    // Who may call it. PUBLIC never; Supabase's API roles never; only the auth service role.
    const privileges = await pool.query(
      "select r.rolname, has_function_privilege(r.oid, $1, 'execute') as can from pg_roles r where r.rolname in ('anon', 'authenticated', 'supabase_auth_admin')", [HOOK]);
    const acl = (await pool.query("select proacl::text as acl, prosecdef, proconfig from pg_proc where oid = $1::regprocedure", [HOOK])).rows[0];
    assert.ok(!/(^|[{,])=X/.test(acl.acl ?? ""), `PUBLIC must not execute the hook: ${acl.acl}`);
    assert.equal(acl.prosecdef, true);
    assert.ok((acl.proconfig as string[]).some((c) => c.startsWith("search_path=public, pg_temp")), "search_path is pinned");
    if (rolesCreated) {
      const can = Object.fromEntries(privileges.rows.map((r) => [r.rolname, r.can]));
      assert.deepEqual(can, { anon: false, authenticated: false, supabase_auth_admin: true });
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("set local role anon");
        await assert.rejects(client.query("select public.movenrun_before_user_created('{}'::jsonb)"), /permission denied/);
        await client.query("rollback");
        await client.query("begin");
        await client.query("set local role authenticated");
        await assert.rejects(client.query("select public.movenrun_before_user_created('{}'::jsonb)"), /permission denied/);
        await client.query("rollback");
        await client.query("begin");
        await client.query("set local role supabase_auth_admin");
        const r = await client.query("select public.movenrun_before_user_created('{}'::jsonb) as r");
        assert.deepEqual(r.rows[0].r, {});
        // The auth role reaches the tables only through the function, not directly.
        await assert.rejects(client.query("select count(*) from users"), /permission denied/);
        await client.query("rollback");
      } finally {
        client.release();
      }
    }

    // Hourly quota: 429 with a message, and nothing recorded for the refusal.
    await pool.query("update account_capacity set max_new_per_hour = 1");
    const busy = await call(pool);
    assert.deepEqual(Object.keys(busy), ["error"]);
    assert.deepEqual(busy, { error: { message: "Too many new accounts right now. Please try again later.", http_code: 429 } });
    assert.equal(await count(pool, "select count(*)::int as n from auth_user_creations"), 1);
    // Quota 0 refuses every new sign-in user: the operator's hook-invocation proof at X-07.
    await pool.query("update account_capacity set max_new_per_hour = 0");
    assert.equal(((await call(pool)).error as { http_code: number }).http_code, 429);
    // Rows older than an hour no longer count; rows older than a day are pruned on the next admission.
    await pool.query("update auth_user_creations set created_at = now() - interval '2 days'");
    await pool.query("update account_capacity set max_new_per_hour = 1");
    assert.deepEqual(await call(pool), {});
    assert.equal(await count(pool, "select count(*)::int as n from auth_user_creations"), 1);

    // Concurrency: 20 simultaneous new sign-in users against a quota of 5 admit exactly 5.
    await pool.query("delete from auth_user_creations");
    await pool.query("update account_capacity set max_new_per_hour = 5");
    const burst = await Promise.all(Array.from({ length: 20 }, () => call(pool)));
    assert.equal(burst.filter((r) => Object.keys(r).length === 0).length, 5);
    assert.equal(burst.filter((r) => (r.error as { http_code?: number } | undefined)?.http_code === 429).length, 15);
    assert.equal(await count(pool, "select count(*)::int as n from auth_user_creations"), 5);

    // Cap: once players reach it the hook answers 403 whatever the quota says.
    await pool.query("delete from auth_user_creations");
    await pool.query("update account_capacity set max_accounts = 3, max_new_per_hour = 50");
    await addPlayers(pool, 3);
    assert.deepEqual(await call(pool), { error: { message: "MovenRun is not accepting new accounts right now.", http_code: 403 } });
    // Concurrent calls at the cap all refuse; none is recorded.
    const full = await Promise.all(Array.from({ length: 10 }, () => call(pool)));
    assert.ok(full.every((r) => (r.error as { http_code?: number } | undefined)?.http_code === 403));
    assert.equal(await count(pool, "select count(*)::int as n from auth_user_creations"), 0);
    // Deleting an account frees its place.
    await pool.query("delete from users where id = (select id from users limit 1)");
    assert.deepEqual(await call(pool), {});

    // Fail closed: without the capacity row nothing is admitted.
    await pool.query("delete from account_capacity");
    assert.equal(((await call(pool)).error as { http_code: number }).http_code, 403);
    // And if the function itself errors (here, a missing table), the caller gets an
    // error, never an empty object, so Supabase refuses the sign-up.
    await pool.query("alter table auth_user_creations rename to auth_user_creations_gone");
    await pool.query("insert into account_capacity (id, max_accounts) values (true, 1000)");
    await assert.rejects(call(pool));
  });
});
