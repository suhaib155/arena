/**
 * GET /gps/verify/:id must be owner-authorized.
 *
 * It was previously unauthenticated: anyone holding a route UUID could read
 * that wallet's verified distance, primary hex, session window and — once
 * VERIFIED — its oracle signature. An unguessable id is a capability, not an
 * authorization model for another user's movement data.
 *
 * `routes/gps.ts` cannot be imported here: it constructs the BullMQ queue at
 * module load, which needs Redis. The handler is therefore mirrored over real
 * HTTP the same way middleware/authBindingOrdering.test.ts does it, and the
 * source file is asserted separately so the mirror cannot drift from shipped
 * behaviour unnoticed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { requireWalletAuth, buildAuthHeaders } from "./auth.js";
import { getRouteView } from "../services/route.service.js";
import { InMemoryRouteRepository } from "../repositories/route.repository.js";
import { ethers } from "ethers";

const OWNER = ethers.Wallet.createRandom();
const STRANGER = ethers.Wallet.createRandom();
const CHAIN_ID = 84532n;

test("the shipped route actually carries the guard this test mirrors", () => {
  const src = readFileSync(join(process.cwd(), "src", "routes", "gps.ts"), "utf8");
  const handler = src.slice(src.indexOf('router.get("/verify/:id"'));
  assert.match(handler, /requireWalletAuth\(\)/, "the read must be wallet-authenticated");
  assert.match(handler, /walletAddress\.toLowerCase\(\) !== req\.movenrunAuth!\.address/,
    "the signer must be bound to the route's owner");
  assert.ok(!/status\(403\)/.test(handler), "a foreign route must 404, not 403 — no existence oracle");
});

test("only the owning wallet can read a route's verification result", async () => {
  const repository = new InMemoryRouteRepository();
  const created = await repository.create({
    id: "11111111-1111-4111-8111-111111111111",
    walletAddress: OWNER.address.toLowerCase(),
    startTime: 1_700_000_000_000,
    endTime: 1_700_000_300_000,
  });

  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { (req as express.Request & { rawBody?: Buffer }).rawBody = buf; } }));
  app.get("/gps/verify/:id", requireWalletAuth({ chainId: CHAIN_ID, maxAgeSeconds: 300 }), async (req, res) => {
    const view = await getRouteView(req.params.id, repository);
    if (!view) return res.status(404).json({ error: "Route not found" });
    const owner = await repository.findById(req.params.id);
    if (!owner || owner.walletAddress.toLowerCase() !== req.movenrunAuth!.address) {
      return res.status(404).json({ error: "Route not found" });
    }
    return res.json(view);
  });

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  const path = `/gps/verify/${created.id}`;

  try {
    // No signature at all.
    assert.equal((await fetch(`${base}${path}`)).status, 401);

    // The owner reads their own route.
    const ownerHeaders = await buildAuthHeaders({
      wallet: OWNER, method: "GET", path, chainId: CHAIN_ID,
    });
    const mine = await fetch(`${base}${path}`, { headers: ownerHeaders });
    assert.equal(mine.status, 200);
    assert.equal((await mine.json()).routeId, created.id);

    // A different authenticated wallet gets 404 — not the data, and not a 403
    // that would confirm the id exists.
    const strangerHeaders = await buildAuthHeaders({
      wallet: STRANGER, method: "GET", path, chainId: CHAIN_ID,
    });
    const theirs = await fetch(`${base}${path}`, { headers: strangerHeaders });
    assert.equal(theirs.status, 404);
    const text = await theirs.text();
    for (const leaked of ["oracleSig", "distanceMeters", "routeHash", OWNER.address.toLowerCase()]) {
      assert.ok(!text.includes(leaked), `404 body leaked ${leaked}`);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
