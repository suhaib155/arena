/**
 * Rate-limiter integration tests. These mount a small standalone Express app
 * (not the real index.ts / routes/*.ts, which import gps.worker.ts and
 * therefore construct a live IORedis connection + getConfig() at module load
 * — see docs/CONTRACTS_AUDIT.md "Why auth/rate-limit aren't tested against
 * the real route files") and drive it over a real ephemeral-port HTTP
 * listener with Node's built-in fetch — no new test-only dependency needed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { createGlobalRateLimiter, createWriteRateLimiter } from "./rateLimit.js";

async function withTestServer(app: express.Express, fn: (baseUrl: string) => Promise<void>) {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("global rate limiter returns 429 with a safe JSON body after the threshold", async () => {
  const app = express();
  app.use(createGlobalRateLimiter({ RATE_LIMIT_WINDOW_MS: 60_000, RATE_LIMIT_MAX: 2, RATE_LIMIT_WRITE_MAX: 20 }));
  app.get("/x", (_req, res) => res.json({ ok: true }));

  await withTestServer(app, async (base) => {
    const r1 = await fetch(`${base}/x`);
    const r2 = await fetch(`${base}/x`);
    const r3 = await fetch(`${base}/x`);

    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(r3.status, 429);

    const body = (await r3.json()) as Record<string, unknown>;
    assert.equal(typeof body.error, "string");
    // No internals (store state, window config) leak into the response.
    assert.deepEqual(Object.keys(body), ["error"]);
  });
});

test("write rate limiter is stricter than the global limiter and keys on the verified wallet when present", async () => {
  const app = express();
  app.use((req, _res, next) => {
    // Simulate requireWalletAuth having already run and attached a verified
    // wallet — the write limiter's keyGenerator reads this.
    (req as express.Request & { movenrunAuth?: { address: string } }).movenrunAuth = { address: "0xabc" };
    next();
  });
  app.post("/write", createWriteRateLimiter({ RATE_LIMIT_WINDOW_MS: 60_000, RATE_LIMIT_MAX: 300, RATE_LIMIT_WRITE_MAX: 1 }), (_req, res) =>
    res.status(200).json({ ok: true })
  );

  await withTestServer(app, async (base) => {
    const r1 = await fetch(`${base}/write`, { method: "POST" });
    const r2 = await fetch(`${base}/write`, { method: "POST" });

    assert.equal(r1.status, 200);
    assert.equal(r2.status, 429);

    const body = (await r2.json()) as Record<string, unknown>;
    assert.equal(typeof body.error, "string");
    assert.deepEqual(Object.keys(body), ["error"], "write limiter's 429 body must be safe JSON with no internals");
  });
});

test("write rate limiter tracks distinct wallets separately even from the same IP", async () => {
  const app = express();
  let nextWallet = "0xaaa";
  app.use((req, _res, next) => {
    (req as express.Request & { movenrunAuth?: { address: string } }).movenrunAuth = { address: nextWallet };
    next();
  });
  app.post("/write", createWriteRateLimiter({ RATE_LIMIT_WINDOW_MS: 60_000, RATE_LIMIT_MAX: 300, RATE_LIMIT_WRITE_MAX: 1 }), (_req, res) =>
    res.status(200).json({ ok: true })
  );

  await withTestServer(app, async (base) => {
    nextWallet = "0xaaa";
    const r1 = await fetch(`${base}/write`, { method: "POST" });
    assert.equal(r1.status, 200);

    nextWallet = "0xbbb";
    const r2 = await fetch(`${base}/write`, { method: "POST" });
    assert.equal(r2.status, 200, "a different wallet from the same IP should not be blocked by wallet A's limit");
  });
});

test("write rate limiter's keyGenerator does not trigger express-rate-limit's IPv6 validation warning", () => {
  // express-rate-limit synchronously validates options when the limiter is
  // constructed and logs via console.error (ERR_ERL_KEY_GEN_IPV6) if a custom
  // keyGenerator looks like it uses req.ip without normalizing IPv6 addresses
  // via their ipKeyGenerator helper — see
  // https://express-rate-limit.github.io/ERR_ERL_KEY_GEN_IPV6/. This is a
  // regression guard: if a future change swaps ipKeyGenerator(req.ip) back
  // for a bare req.ip, this test fails instead of only a manually-checked
  // console warning appearing in production logs.
  const originalError = console.error;
  const captured: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    captured.push(args);
  };
  try {
    createWriteRateLimiter({ RATE_LIMIT_WINDOW_MS: 60_000, RATE_LIMIT_MAX: 300, RATE_LIMIT_WRITE_MAX: 20 });
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(captured, [], "constructing the write rate limiter must not log any validation warning");
});
