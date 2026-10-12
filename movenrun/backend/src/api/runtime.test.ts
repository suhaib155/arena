import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { resolveApiConfig } from "./config.js";

const databaseUrl = process.env.MOVENRUN_TEST_DATABASE_URL;

test("built API, migrations and real session/PostgreSQL flow (delivery transport mocked only)", { skip: !databaseUrl }, async () => {
  const databaseName = `preview_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: databaseUrl });
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(databaseUrl!);
  url.pathname = `/${databaseName}`;
  const savedEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  const pool = new Pool({ connectionString: url.toString() });
  let shutdownApp: (() => Promise<void>) | undefined;
  let child: ReturnType<typeof spawn> | undefined;
  try {
    for (const key of ["REDIS_URL", "ORACLE_PRIVATE_KEY", "BASE_RPC_URL", "BASE_SEPOLIA_RPC_URL"]) delete process.env[key];
    Object.assign(process.env, {
      NODE_ENV: "production", DATABASE_URL: url.toString(),
      IDENTITY_SESSION_PEPPER: randomBytes(32).toString("hex"),
      IDENTITY_OTP_PEPPER: randomBytes(32).toString("hex"),
      CORS_ORIGINS: "https://preview.example.com",
      RESEND_API_KEY: "re_test_transport_only", IDENTITY_EMAIL_FROM: "signin@preview.example.com",
    });
    // Exercise the actual deployment command, including its migration journal.
    for (let attempt = 0; attempt < 2; attempt++) {
      await new Promise<void>((resolve, reject) => execFile(process.execPath,
        ["../node_modules/drizzle-kit/bin.cjs", "migrate"], { env: process.env }, error => {
          if (error) reject(new Error("Migration command failed")); else resolve();
        }));
    }
    const migrationRows = await pool.query("select count(*)::int as count from drizzle.__drizzle_migrations");
    assert.equal(migrationRows.rows[0].count, 6);

    const reserve = createServer().listen(0, "127.0.0.1");
    await once(reserve, "listening");
    const port = (reserve.address() as { port: number }).port;
    await new Promise<void>(resolve => reserve.close(() => resolve()));
    child = spawn(process.execPath, ["dist/api.cjs"], { env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
    let logs = "";
    child.stdout!.on("data", data => { logs += String(data); });
    child.stderr!.on("data", data => { logs += String(data); });
    let healthy = false;
    for (let retry = 0; retry < 100; retry++) {
      try {
        healthy = (await originalFetch(`http://127.0.0.1:${port}/ready`)).status === 200;
        if (healthy) break;
      } catch { /* listener starting */ }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(healthy, "compiled API reaches readiness with migrated PostgreSQL and no legacy variables");
    assert.equal((await originalFetch(`http://127.0.0.1:${port}/gps/submit`, { method: "POST" })).status, 404);
    child.kill();
    await once(child, "exit");
    child = undefined;
    assert.match(logs, /V3 API listening/);
    assert.ok(!logs.includes(process.env.IDENTITY_SESSION_PEPPER!));
    const graph = JSON.parse(await readFile("dist/api-inputs.json", "utf8")) as string[];
    assert.ok(!graph.some(path => /src\/(workers|routes|blockchain)\//.test(path)));

    // The service generates the OTP; only the external delivery transport is
    // replaced. This is an integration test, not deployed authentication.
    let deliveredCode = "";
    globalThis.fetch = async (input, init) => {
      assert.equal(input, "https://api.resend.com/emails");
      deliveredCode = JSON.parse(String(init?.body)).text.match(/code is (\d{6})/)[1];
      return new Response(JSON.stringify({ id: "test-delivery" }), { status: 200 });
    };
    const { createApiApp } = await import("./app.js");
    const { closeDb } = await import("../db/client.js");
    const app = createApiApp(resolveApiConfig());
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    shutdownApp = async () => {
      await new Promise<void>(resolve => server.close(() => resolve()));
      await closeDb();
    };
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const request = (path: string, body?: unknown, token?: string) => originalFetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.equal((await request("/movement/verify", {})).status, 401);
    assert.equal((await request("/identity/me")).status, 401);
    const email = "runner@example.com";
    assert.equal((await request("/identity/auth/email/begin", { email })).status, 202);
    const auth = await request("/identity/auth/email/complete", { email, code: deliveredCode });
    assert.equal(auth.status, 200);
    const token = (await auth.json()).session.accessToken;
    assert.equal((await request("/identity/me", undefined, token)).status, 200);
    assert.notEqual((await request("/identity/auth/email/complete", { email, code: deliveredCode })).status, 200);
    const start = Date.now() - 180000;
    const movement = {
      sessionId: "preview-runtime-test", startTime: start, endTime: start + 120000,
      points: Array.from({ length: 121 }, (_, i) => ({ lat: 12.9716 + i * 0.000016, lng: 77.5946, accuracy: 5, timestamp: start + i * 1000 })),
    };
    const verified = await request("/movement/verify", movement, token);
    assert.equal(verified.status, 201);
    assert.equal((await verified.json()).status, "verified");
    assert.equal((await request("/movement/verify", movement, token)).status, 200);
    const rows = await pool.query("select * from movement_verifications where client_session_id = $1", [movement.sessionId]);
    assert.equal(rows.rowCount, 1);
    assert.ok(!JSON.stringify(rows.rows).includes("12.9716"));
    assert.ok(!("points" in rows.rows[0]));
    await pool.query("alter table auth_identities rename column provider_subject to unavailable_provider_subject");
    assert.equal((await request("/ready")).status, 503);
  } finally {
    child?.kill();
    await shutdownApp?.();
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
    await pool.end();
    // The name is generated above and only this disposable database is removed.
    if (!/^preview_test_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Unexpected test database name");
    await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }
});
