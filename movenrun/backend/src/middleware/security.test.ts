/**
 * CORS allowlist + helmet header tests. `getAllowedOrigins`/`createCorsMiddleware`
 * take an injectable config (defaulting to `getConfig()`) specifically so these
 * cases don't fight the config module's process-wide singleton cache — see
 * middleware/security.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import http from "node:http";
import { getAllowedOrigins, createCorsMiddleware, createSecurityHeadersMiddleware } from "./security.js";

test("getAllowedOrigins: falls back to dev defaults when CORS_ORIGINS is unset outside production", () => {
  const origins = getAllowedOrigins({ NODE_ENV: "development", CORS_ORIGINS: undefined });
  assert.ok(origins.length > 0);
  assert.ok(origins.every((o) => o.startsWith("http://localhost")));
});

test("getAllowedOrigins: parses an explicit comma-separated allowlist", () => {
  const origins = getAllowedOrigins({ NODE_ENV: "development", CORS_ORIGINS: "https://a.example, https://b.example" });
  assert.deepEqual(origins, ["https://a.example", "https://b.example"]);
});

test("getAllowedOrigins: production with no CORS_ORIGINS fails closed", () => {
  assert.throws(
    () => getAllowedOrigins({ NODE_ENV: "production", CORS_ORIGINS: undefined }),
    /fail closed/
  );
});

test("getAllowedOrigins: production wildcard is rejected", () => {
  assert.throws(
    () => getAllowedOrigins({ NODE_ENV: "production", CORS_ORIGINS: "*" }),
    /must not contain/
  );
});

test("getAllowedOrigins: production with a real explicit allowlist succeeds", () => {
  const origins = getAllowedOrigins({ NODE_ENV: "production", CORS_ORIGINS: "https://movenrun.app" });
  assert.deepEqual(origins, ["https://movenrun.app"]);
});

async function withTestServer(app: express.Express, fn: (port: number) => Promise<void>) {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function get(port: number, origin?: string): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: "/x", method: "GET", headers: origin ? { Origin: origin } : {} },
      (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

test("CORS: an allowed origin gets an Access-Control-Allow-Origin header matching it", async () => {
  const app = express();
  app.use(createCorsMiddleware({ NODE_ENV: "development", CORS_ORIGINS: "https://allowed.example" }));
  app.get("/x", (_req, res) => res.json({ ok: true }));

  await withTestServer(app, async (port) => {
    const res = await get(port, "https://allowed.example");
    assert.equal(res.headers["access-control-allow-origin"], "https://allowed.example");
  });
});

test("CORS: a disallowed origin gets no Access-Control-Allow-Origin header", async () => {
  const app = express();
  app.use(createCorsMiddleware({ NODE_ENV: "development", CORS_ORIGINS: "https://allowed.example" }));
  app.get("/x", (_req, res) => res.json({ ok: true }));

  await withTestServer(app, async (port) => {
    const res = await get(port, "https://evil.example");
    assert.equal(res.headers["access-control-allow-origin"], undefined);
  });
});

test("CORS: a request with no Origin header (non-browser client) is not blocked", async () => {
  const app = express();
  app.use(createCorsMiddleware({ NODE_ENV: "development", CORS_ORIGINS: "https://allowed.example" }));
  app.get("/x", (_req, res) => res.json({ ok: true }));

  await withTestServer(app, async (port) => {
    const res = await get(port);
    assert.equal(res.status, 200);
  });
});

test("helmet: default security headers are present on a basic response", async () => {
  const app = express();
  app.use(createSecurityHeadersMiddleware());
  app.get("/x", (_req, res) => res.json({ ok: true }));

  await withTestServer(app, async (port) => {
    const res = await get(port);
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(res.headers["x-dns-prefetch-control"], "off");
    assert.equal(res.headers["x-powered-by"], undefined, "helmet should strip Express's X-Powered-By header");
  });
});
