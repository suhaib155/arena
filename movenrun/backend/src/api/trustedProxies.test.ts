import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { createGlobalRateLimiter, createWriteRateLimiter } from "../middleware/rateLimit.js";
import { trustProxySetting, type TrustProxyMode } from "./trustedProxies.js";

const LIMITS = { RATE_LIMIT_WINDOW_MS: 60_000, RATE_LIMIT_MAX: 50, RATE_LIMIT_WRITE_MAX: 20 };
const CLOUDFLARE_EDGE = "172.64.33.1";

/** The X-Forwarded-For a request carries when it reaches the API: whatever
 *  the client wrote, then the address Cloudflare saw, then Cloudflare's edge,
 *  then the Render proxy node that took it (the socket peer, 127.0.0.1 here). */
function chain(client: string, options: { forged?: string; renderNode?: string } = {}) {
  return [options.forged, client, CLOUDFLARE_EDGE, options.renderNode ?? "10.200.1.5"].filter(Boolean).join(", ");
}

async function serve(mode: TrustProxyMode, hops = 0) {
  const app = express();
  app.set("trust proxy", trustProxySetting(mode, hops));
  app.use(createGlobalRateLimiter(LIMITS));
  app.get("/health", (req, res) => { res.json({ ip: req.ip }); });
  app.use("/identity/auth", createWriteRateLimiter(LIMITS));
  app.post("/identity/auth/begin", (req, res) => { res.status(400).json({ ip: req.ip }); });
  const server: Server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  async function call(path: string, headers: Record<string, string>, method = "GET") {
    const res = await fetch(base + path, { method, headers });
    const body = await res.json() as { ip: string };
    return { ip: body.ip, remaining: Number(res.headers.get("ratelimit-remaining")) };
  }
  return { call, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

test("by network: the client's real address is the key, whatever it writes in the headers", async () => {
  const api = await serve("render-cloudflare");
  try {
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      const headers: Record<string, string> = { "x-forwarded-for": chain("198.51.100.7", { forged: i % 2 ? `203.0.113.${i}` : undefined, renderNode: `10.200.1.${i % 2 ? 5 : 6}` }) };
      if (i % 3 === 0) headers.forwarded = `for=203.0.113.${i + 50}`;
      const r = await api.call("/health", headers);
      assert.equal(r.ip, "198.51.100.7");
      seen.push(r.remaining);
    }
    assert.deepEqual(seen, [49, 48, 47, 46, 45, 44], "one bucket for one client across proxy nodes and forged values");
    // A different person gets their own bucket.
    const other = await api.call("/health", { "x-forwarded-for": chain("192.0.2.44") });
    assert.equal(other.ip, "192.0.2.44");
    assert.equal(other.remaining, 49);
    // IPv6 clients are keyed too.
    const v6 = await api.call("/health", { "x-forwarded-for": chain("2001:db8:1::7") });
    assert.equal(v6.ip, "2001:db8:1::7");
  } finally { await api.close(); }
});

test("by network: the sign-in write limit is keyed the same way and cannot be dodged", async () => {
  const api = await serve("render-cloudflare");
  try {
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await api.call("/identity/auth/begin", { "x-forwarded-for": chain("198.51.100.9", { forged: `203.0.113.${i}` }) }, "POST");
      assert.equal(r.ip, "198.51.100.9");
      seen.push(r.remaining);
    }
    assert.deepEqual(seen, [19, 18, 17, 16]);
    const other = await api.call("/identity/auth/begin", { "x-forwarded-for": chain("192.0.2.45") }, "POST");
    assert.equal(other.remaining, 19);
  } finally { await api.close(); }
});

test("one hop, as live today: the key is a Render node, so strangers share buckets", async () => {
  const api = await serve("hops", 1);
  try {
    const a = await api.call("/health", { "x-forwarded-for": chain("198.51.100.7", { renderNode: "10.200.1.5" }) });
    const b = await api.call("/health", { "x-forwarded-for": chain("192.0.2.44", { renderNode: "10.200.1.5" }) });
    assert.equal(a.ip, "10.200.1.5");
    assert.equal(b.remaining, a.remaining - 1, "two people, one bucket");
  } finally { await api.close(); }
});

test("a client that connects without any proxy is keyed by its socket, and its header is ignored", async () => {
  const api = await serve("hops", 0);
  try {
    const r = await api.call("/health", { "x-forwarded-for": "203.0.113.9" });
    assert.equal(r.ip, "127.0.0.1");
  } finally { await api.close(); }
});
