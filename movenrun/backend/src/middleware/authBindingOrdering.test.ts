/**
 * Proves the "auth failure never reaches persistence/enqueue/signing"
 * ordering guarantee end-to-end over real HTTP, using a small handler that
 * mirrors routes/gps.ts's POST /submit exactly (requireWalletAuth ->
 * body validation -> signer-matches-walletAddress check -> persist/enqueue)
 * with spies substituted for submitRoute's persistence/enqueue and for the
 * oracle signer.
 *
 * This can't be proven against the REAL routes/gps.ts / routes/zones.ts /
 * routes/battles.ts files directly: they import gps.worker.ts, which
 * constructs a live IORedis connection and calls getConfig() at module load
 * time (getConfig() calls process.exit(1) on invalid/missing env, and even
 * with well-formed fake env values, IORedis would attempt a real background
 * connection). Mirroring the exact handler shape gives the same ordering
 * guarantee without needing a live Postgres/Redis in CI — the same
 * constraint that shaped route.service.ts's testing approach in PR #41.
 * `requireWalletAuth` itself (the actual production middleware, not a
 * mirror) is exercised for real here and in auth.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { ethers } from "ethers";
import { requireWalletAuth, buildAuthHeaders } from "./auth.js";

const TEST_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const WALLET = new ethers.Wallet(TEST_PK);
const OTHER_WALLET = ethers.Wallet.createRandom();
const CHAIN_ID = 84532n;

function buildMirrorApp(spies: { create: () => void; enqueue: () => void; sign: () => void }) {
  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    })
  );

  // Mirrors routes/gps.ts's POST /submit ordering exactly.
  app.post("/gps/submit", requireWalletAuth({ chainId: CHAIN_ID, maxAgeSeconds: 300 }), (req, res) => {
    const body = req.body as { walletAddress?: string };
    if (typeof body.walletAddress !== "string") {
      return res.status(400).json({ error: "Invalid route data" });
    }
    if (body.walletAddress.toLowerCase() !== req.movenrunAuth!.address) {
      return res.status(403).json({ error: "Signer does not match walletAddress" });
    }
    spies.create();
    spies.enqueue();
    spies.sign();
    return res.status(202).json({ routeId: "mock-route", status: "SUBMITTED" });
  });

  return app;
}

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

test("missing auth: no route is created, nothing is enqueued, nothing is signed", async () => {
  let created = 0;
  let enqueued = 0;
  let signed = 0;
  const app = buildMirrorApp({ create: () => created++, enqueue: () => enqueued++, sign: () => signed++ });
  const body = { walletAddress: WALLET.address, points: [] };

  await withTestServer(app, async (base) => {
    const res = await fetch(`${base}/gps/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 401);
  });

  assert.equal(created, 0);
  assert.equal(enqueued, 0);
  assert.equal(signed, 0);
});

test("signer mismatch (signed by a different wallet than body.walletAddress): rejected before persistence", async () => {
  let created = 0;
  let enqueued = 0;
  let signed = 0;
  const app = buildMirrorApp({ create: () => created++, enqueue: () => enqueued++, sign: () => signed++ });
  // body claims WALLET, but the request is signed by OTHER_WALLET.
  const body = { walletAddress: WALLET.address, points: [] };

  await withTestServer(app, async (base) => {
    const headers = await buildAuthHeaders({ wallet: OTHER_WALLET, method: "POST", path: "/gps/submit", body, chainId: CHAIN_ID });
    const res = await fetch(`${base}/gps/submit`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 403);
    const json = (await res.json()) as { error: string };
    assert.match(json.error, /does not match walletAddress/);
  });

  assert.equal(created, 0);
  assert.equal(enqueued, 0);
  assert.equal(signed, 0);
});

test("valid signed request matching walletAddress: reaches persistence/enqueue/signing exactly once", async () => {
  let created = 0;
  let enqueued = 0;
  let signed = 0;
  const app = buildMirrorApp({ create: () => created++, enqueue: () => enqueued++, sign: () => signed++ });
  const body = { walletAddress: WALLET.address, points: [] };

  await withTestServer(app, async (base) => {
    const headers = await buildAuthHeaders({ wallet: WALLET, method: "POST", path: "/gps/submit", body, chainId: CHAIN_ID });
    const res = await fetch(`${base}/gps/submit`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 202);
  });

  assert.equal(created, 1);
  assert.equal(enqueued, 1);
  assert.equal(signed, 1);
});
