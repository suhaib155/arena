/**
 * Gameplay flag off: the default deployment.
 *
 * With MOVENRUN_GAMEPLAY_ENABLED unset, on a database that holds only the
 * committed migrations 0000-0010 (not the proposed 0011), the API must:
 *  (a) answer 404 on every gameplay route, the routes being read from the
 *      router itself (a new route is covered automatically, and a router
 *      shape this test cannot enumerate fails it);
 *  (b) run every maintenance task, and handle requests, without any query
 *      that names a gameplay_ relation, and without error;
 *  (c) start, answer /ready, and never read the proposed migration directory.
 *
 * The queries are observed on the real driver (pg Client.query), so nothing
 * the application sends can pass unseen. Supabase Auth is replaced by a
 * stand-in; no network is used.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { createGameplayRouter } from "../gameplay/router.js";
import { gameplayRulesFromEnv } from "../gameplay/rules.js";
import { createTestDb } from "../gameplay/pgTestDb.js";

const databaseUrl = process.env.MOVENRUN_TEST_DATABASE_URL;
const SUPABASE_URL = "https://movenrun-test.supabase.co";
const HERE = dirname(fileURLToPath(import.meta.url));

// ---- route enumeration (from the router source, not a hand-kept list) -------------------

interface RouteSpec { method: string; path: string }

function enumerateGameplayRoutes(): RouteSpec[] {
  const router = createGameplayRouter({
    service: {} as never,
    verifyBearer: async () => ({ userId: "x" }),
  });
  const stack = (router as unknown as { stack: { route?: { path: string; methods: Record<string, boolean> } }[] }).stack;
  const routes: RouteSpec[] = [];
  for (const layer of stack) {
    // A sub-router, middleware layer or regex path would hide routes from this
    // walk, so any of them fails the test until the walk is extended.
    assert.ok(layer.route, "gameplay router holds a layer that is not a plain route; extend enumerateGameplayRoutes");
    assert.equal(typeof layer.route.path, "string", "gameplay route path must be a string");
    for (const [method, on] of Object.entries(layer.route.methods)) {
      if (on) routes.push({ method: method.toUpperCase(), path: layer.route.path });
    }
  }
  return routes;
}

function concretePath(path: string): string {
  // Values a real handler would accept, so a leaked route could not hide
  // behind a 404 of its own: it would answer 401 (no session) or better.
  return "/gameplay" + path.replace(/:(\w+)/g, (_m, name: string) => (/^(season|day)$/.test(name) ? "1" : "abcdefgh12"));
}

test("gameplay router: every route is enumerated and the source registers no other kind of layer", () => {
  const routes = enumerateGameplayRoutes();
  assert.ok(routes.length >= 9, `expected the known gameplay routes, found ${routes.length}`);
  const source = readFileSync(join(HERE, "..", "gameplay", "router.ts"), "utf8");
  const registrations = [...source.matchAll(/\brouter\.(get|post|put|patch|delete|all|use|route)\(/g)];
  // Each registration in the source is exactly one route layer in the router.
  const layers = (createGameplayRouter({ service: {} as never, verifyBearer: async () => ({ userId: "x" }) }) as unknown as { stack: unknown[] }).stack;
  assert.equal(registrations.length, layers.length, "router.ts registers something the layer walk does not see one-to-one");
  assert.ok(!registrations.some((m) => m[1] === "use" || m[1] === "all" || m[1] === "route"), "router.use/all/route in router.ts: extend the enumeration");
});

test("app.ts registers only known non-gameplay path prefixes, and /gameplay only inside the flag guard", () => {
  const source = readFileSync(join(HERE, "app.ts"), "utf8");
  const allowed = new Set(["/health", "/ready", "/identity/auth", "/identity", "/movement"]);
  const guard = /if \(gameplay\) \{([\s\S]*?)\n  \}/.exec(source);
  assert.ok(guard, "app.ts no longer has an `if (gameplay) { ... }` block; update this test");
  const registration = /\bapp\.(use|all|get|post|put|patch|delete|options|head)\(\s*(?:(["'`])([^"'`]*)\2)?/g;
  const inside = guard[1] ?? "";
  const insideStart = guard.index + guard[0].indexOf(inside);
  let count = 0;
  for (const m of source.matchAll(registration)) {
    count += 1;
    const path = m[3];
    if (path === undefined) continue; // global middleware: covered by the behavioural sweep
    const where = `app.${m[1]}(${JSON.stringify(path)})`;
    if (path === "/gameplay" || path.startsWith("/gameplay/")) {
      const at = m.index ?? -1;
      assert.ok(at >= insideStart && at < insideStart + inside.length, `${where} in app.ts is outside the \`if (gameplay)\` guard`);
      continue;
    }
    assert.ok(allowed.has(path), `${where} in app.ts is not in the allow-list of known non-gameplay prefixes (${[...allowed].join(", ")}); add it only if it is not gameplay`);
  }
  assert.ok(count >= 8, "the scan found the registrations in app.ts");
  assert.ok(!/gameplay/i.test(source.replace(inside, "").split("\n").filter((l) => /\bapp\.(use|all|get|post|put|patch|delete)\(/.test(l)).join("\n")), "a gameplay registration outside the guard");
});

test("only the exact value \"true\" turns gameplay on", () => {
  for (const value of [undefined, "", "false", "TRUE", "True", "1", "yes", " true", "true "]) {
    const env: NodeJS.ProcessEnv = { MOVENRUN_GAMEPLAY_SEASON_START_DAY: "100" };
    if (value !== undefined) env.MOVENRUN_GAMEPLAY_ENABLED = value;
    assert.equal(gameplayRulesFromEnv(env), null, `flag value ${JSON.stringify(value)}`);
  }
});

// ---- spies --------------------------------------------------------------------------------

function installQuerySpy(): { queries: string[]; restore(): void } {
  const queries: string[] = [];
  const proto = pg.Client.prototype as unknown as { query: (...a: unknown[]) => unknown };
  const original = proto.query;
  proto.query = function (this: unknown, ...args: unknown[]) {
    const first = args[0];
    if (typeof first === "string") queries.push(first);
    else if (first && typeof (first as { text?: unknown }).text === "string") queries.push((first as { text: string }).text);
    else queries.push(`<unreadable query ${typeof first}>`);
    return original.apply(this, args);
  };
  return { queries, restore: () => { proto.query = original; } };
}

function installFsSpy(): { paths: string[]; restore(): void } {
  const paths: string[] = [];
  const fsAny = fs as unknown as Record<string, unknown>;
  const promisesAny = fs.promises as unknown as Record<string, unknown>;
  const names = ["readFileSync", "readFile", "readdirSync", "readdir", "openSync", "open", "statSync", "stat", "lstatSync", "lstat",
    "existsSync", "accessSync", "access", "createReadStream", "opendirSync", "opendir", "realpathSync", "readlinkSync"];
  const restores: (() => void)[] = [];
  const wrap = (holder: Record<string, unknown>, name: string) => {
    const original = holder[name];
    if (typeof original !== "function") return;
    holder[name] = function (this: unknown, ...args: unknown[]) {
      const p = args[0];
      if (typeof p === "string" || p instanceof URL || Buffer.isBuffer(p)) paths.push(String(p));
      return (original as (...a: unknown[]) => unknown).apply(this, args);
    };
    restores.push(() => { holder[name] = original; });
  };
  for (const n of names) wrap(fsAny, n);
  for (const n of ["readFile", "readdir", "stat", "lstat", "open", "opendir", "access", "realpath"]) wrap(promisesAny, n);
  syncBuiltinESMExports();
  return { paths, restore: () => { for (const r of restores) r(); syncBuiltinESMExports(); } };
}

async function waitFor(what: string, ok: () => boolean, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

const GAMEPLAY_TEXT = /gameplay/i;

test("flag unset, database 0000-0010 only: no gameplay route, no gameplay query, API ready, proposed directory untouched", { skip: !databaseUrl }, async () => {
  const admin = await createTestDb(databaseUrl!, "flagoff", { gameplay: false });
  const saved = { ...process.env };
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const originalInfo = console.info;
  const consoleLines: string[] = [];
  let server: ReturnType<ReturnType<typeof import("express")>["listen"]> | undefined;
  let closeDb: (() => Promise<void>) | undefined;
  let querySpy: ReturnType<typeof installQuerySpy> | undefined;
  let fsSpy: ReturnType<typeof installFsSpy> | undefined;
  try {
    // Precondition: this really is the committed chain only.
    const rel = await admin.pool.query("select count(*)::int as n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relname like 'gameplay%'");
    assert.equal(rel.rows[0].n, 0, "the test database must hold no gameplay relation");
    assert.ok((await admin.pool.query("select 1 from pg_tables where schemaname = 'public' and tablename = 'google_sign_in_exchanges'")).rowCount === 1, "0010 present");

    const dbUrl = (admin.pool as unknown as { options: { connectionString: string } }).options.connectionString;
    for (const key of ["REDIS_URL", "ORACLE_PRIVATE_KEY", "BASE_RPC_URL", "BASE_SEPOLIA_RPC_URL", "MOVENRUN_GAMEPLAY_ENABLED"]) delete process.env[key];
    Object.assign(process.env, {
      NODE_ENV: "production", DATABASE_URL: dbUrl,
      IDENTITY_SESSION_PEPPER: randomBytes(32).toString("hex"),
      CORS_ORIGINS: "https://preview.example.com",
      SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test", SUPABASE_SECRET_KEY: "sb_secret_test",
      IDENTITY_AUTH_DOMAIN: "movenrun.xyz",
      // Stray gameplay settings with the flag unset must be ignored entirely.
      MOVENRUN_GAMEPLAY_SEASON_START_DAY: "100", MOVENRUN_GAMEPLAY_CAPACITY_QUOTA_MIB: "100", MOVENRUN_GAMEPLAY_UNIT_BUDGET: "5",
    });

    // A session a week past its refresh expiry, so the clean-up has real work.
    await admin.pool.query("insert into users (id) values ('flagoff-user')");
    await admin.pool.query(`insert into auth_sessions (id, user_id, family_id, refresh_token_hash, expires_at)
      values ('flagoff-old', 'flagoff-user', 'f1', 'h-old', now() - interval '8 days')`);

    let adminListings = 0;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const target = String(input);
      if (target.startsWith(`${SUPABASE_URL}/auth/v1/admin/users?`) && (init?.method ?? "GET") === "GET") {
        adminListings += 1;
        return new Response(JSON.stringify({ users: [] }), { status: 200 });
      }
      throw new Error("unexpected outbound request");
    }) as typeof fetch;
    console.error = (...a: unknown[]) => { consoleLines.push(`error: ${a.map(String).join(" ")}`); };
    console.info = (...a: unknown[]) => { consoleLines.push(`info: ${a.map(String).join(" ")}`); };

    // Spies go in before the application code is loaded or started.
    querySpy = installQuerySpy();
    fsSpy = installFsSpy();
    const { createApiApp } = await import("./app.js");
    const { resolveApiConfig } = await import("./config.js");
    const db = await import("../db/client.js");
    closeDb = db.closeDb;
    const app = createApiApp(resolveApiConfig());
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const get = (path: string, init?: RequestInit) => originalFetch(base + path, init);

    // (c) readiness on the 0000-0010 database. The first finished response
    // also makes maintenance run every due task once.
    const ready = await get("/ready");
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { status: "ready", database: "ready", signIn: "supabase" });
    assert.equal((await get("/health")).status, 200);

    // (a) every gameplay route is a plain 404, with and without a bearer,
    // for the registered method and for the others.
    const routes = enumerateGameplayRoutes();
    const seen = new Set<string>();
    for (const route of routes) {
      const path = concretePath(route.path);
      for (const headers of [{}, { authorization: "Bearer not-a-real-token" }] as Record<string, string>[]) {
        for (const method of new Set([route.method, "GET", "POST", "PUT", "DELETE"])) {
          const res = await get(path, {
            method, headers: { ...headers, ...(method === "GET" ? {} : { "content-type": "application/json" }) },
            ...(method === "GET" ? {} : { body: "{}" }),
          });
          assert.equal(res.status, 404, `${method} ${path} must be 404 with the flag off`);
          assert.deepEqual(await res.json(), { error: "not_found" }, `${method} ${path} body`);
          seen.add(`${method} ${route.path}`);
        }
      }
    }
    for (const route of routes) assert.ok(seen.has(`${route.method} ${route.path}`), `route not covered: ${route.method} ${route.path}`);
    for (const path of ["/gameplay", "/gameplay/", "/gameplay/unknown", "/gameplay/me/holdings/x"]) {
      assert.equal((await get(path)).status, 404, path);
    }

    // Sweep: paths no router in this file knows about. An app.get/app.all in
    // app.ts outside the gameplay router would answer here, so each must be
    // byte-identical to the answer for a random unknown path.
    const unknown = await get(`/no-such-${randomBytes(6).toString("hex")}`);
    assert.equal(unknown.status, 404);
    const unknownBody = await unknown.json();
    for (const probe of ["/gameplay", "/gameplay/anything", "/gameplay/extra", "/gameplay/me/holdings", "/holdings/me", "/seasons", "/days", "/clubs",
      "/districts", "/territory", "/settlement", "/erasure", "/admin/gameplay", "/me/holdings", "/leaderboards/1"]) {
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        for (const auth of [false, true]) {
          const res = await get(probe, {
            method,
            headers: { ...(auth ? { authorization: "Bearer not-a-real-token" } : {}), ...(method === "GET" ? {} : { "content-type": "application/json" }) },
            ...(method === "GET" ? {} : { body: "{}" }),
          });
          assert.equal(res.status, 404, `${method} ${probe} (bearer: ${auth}) must be 404`);
          assert.deepEqual(await res.json(), unknownBody, `${method} ${probe} (bearer: ${auth}) must match an unknown path`);
        }
      }
    }

    // (b) the maintenance tasks, driven by the real app. Wait until the three
    // sign-in tasks have run, then let the queue settle.
    await waitFor("sign-in clean-up tasks to run", () => adminListings >= 1
      && querySpy!.queries.some((q) => /auth_sessions/i.test(q) && /delete/i.test(q))
      && querySpy!.queries.some((q) => /pending_auth_user_deletions/i.test(q))
      && querySpy!.queries.some((q) => /wallet_sign_in_handoffs/i.test(q)));
    await new Promise((r) => setTimeout(r, 400));
    const old = await admin.pool.query("select 1 from auth_sessions where id = 'flagoff-old'");
    assert.equal(old.rowCount, 0, "the expired-session clean-up really ran");

    // Findings over everything the application sent to the database.
    const gameplayQueries = querySpy.queries.filter((q) => GAMEPLAY_TEXT.test(q));
    assert.deepEqual(gameplayQueries, [], "no query may mention gameplay");
    assert.ok(!querySpy.queries.some((q) => /pg_database_size/i.test(q)), "no capacity-guard read");
    assert.ok(querySpy.queries.length > 10, "the spy saw the application's queries");
    assert.deepEqual(consoleLines.filter((l) => /Maintenance:.*failed|error/i.test(l)), [], "no maintenance or startup error");
    assert.ok(!consoleLines.some((l) => GAMEPLAY_TEXT.test(l)), "no log line mentions gameplay");

    // Startup and request handling never read the proposed migration directory.
    assert.deepEqual(fsSpy.paths.filter((p) => /drizzle-proposed|0011/.test(p)), [], "proposed 0011 must not be read");

    // The fs spy sees reads (control), including through the ESM named bindings.
    const fsBefore = fsSpy.paths.length;
    fs.existsSync(join(HERE, "..", "..", "drizzle-proposed"));
    assert.ok(fsSpy.paths.slice(fsBefore).some((p) => /drizzle-proposed/.test(p)), "fs spy control");

    // The spy would have caught a leak: a query naming a gameplay relation is recorded.
    const before = querySpy.queries.length;
    await admin.pool.query("select to_regclass('public.gameplay_control_probe')").catch(() => undefined);
    // admin.pool is a separate pool but the same driver class, so it is seen too.
    assert.ok(querySpy.queries.slice(before).some((q) => /gameplay_control_probe/.test(q)), "spy control");
  } finally {
    console.error = originalError;
    console.info = originalInfo;
    globalThis.fetch = originalFetch;
    fsSpy?.restore();
    querySpy?.restore();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await closeDb?.();
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    await admin.drop();
  }
});

test("account erasure with the flag off sends only the catalogue probe for the erasure fence, never a gameplay table", { skip: !databaseUrl }, async () => {
  const admin = await createTestDb(databaseUrl!, "flagoffdel", { gameplay: false });
  const spy = installQuerySpy();
  try {
    await admin.pool.query("insert into users (id) values ('flagoff-del')");
    const { createDrizzleAccountDeletionStore } = await import("../identity/accountDeletion.js");
    const result = await createDrizzleAccountDeletionStore(admin.db).erase("flagoff-del");
    assert.equal(result.users, 1);
    const mentioning = spy.queries.filter((q) => GAMEPLAY_TEXT.test(q));
    // The one statement allowed: a to_regclass() existence check (for the
    // fence and the proposed erasure job table), which reads no gameplay table
    // and returns false on a 0000-0010 database.
    assert.deepEqual(mentioning.map((q) => q.replace(/\s+/g, " ").trim()), ["SELECT to_regclass('public.gameplay_erasure_fence') IS NOT NULL AS ok, to_regclass('public.gameplay_erasure_jobs') IS NOT NULL AS jobs"]);
  } finally {
    spy.restore();
    await admin.drop();
  }
});
