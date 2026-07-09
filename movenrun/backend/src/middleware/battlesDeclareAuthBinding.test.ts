/**
 * Proves POST /battles/declare's auth wiring end-to-end over real HTTP, using
 * a handler that mirrors routes/battles.ts's POST /declare exactly
 * (requireWalletAuth -> body validation -> signer-matches-challengerAddress
 * check -> intentional 501) with a spy on the 501 path itself. The real
 * routes/battles.ts has no live-service imports at module load, but is still
 * mirrored here (rather than imported directly) for consistency with the
 * other auth-binding tests and to avoid coupling this test to route-file
 * internals — see docs/CONTRACTS_AUDIT.md "Why auth/rate-limit aren't tested
 * against the real route files".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import { ethers } from "ethers";
import { requireWalletAuth, buildAuthHeaders } from "./auth.js";

const TEST_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const WALLET = new ethers.Wallet(TEST_PK);
const OTHER_WALLET = ethers.Wallet.createRandom();
const CHAIN_ID = 84532n;

function buildMirrorApp(spies: { reachedDeclareLogic: () => void }) {
  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    })
  );

  // Mirrors routes/battles.ts's POST /declare ordering exactly — still 501,
  // no signing call exists anywhere in this path.
  app.post("/battles/declare", requireWalletAuth({ chainId: CHAIN_ID, maxAgeSeconds: 300 }), (req, res) => {
    const schema = z.object({
      hexId: z.string(),
      challengerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

    if (parsed.data.challengerAddress.toLowerCase() !== req.movenrunAuth!.address) {
      return res.status(403).json({ error: "Signer does not match challengerAddress" });
    }

    spies.reachedDeclareLogic();
    return res.status(501).json({
      error: "challenge_declaration_not_wired",
      message: "Challenge declaration requires the on-chain zone owner and a validated defender base score.",
      hexId: parsed.data.hexId,
    });
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

test("POST /battles/declare rejects missing auth (auth runs before handler logic)", async () => {
  let reached = 0;
  const app = buildMirrorApp({ reachedDeclareLogic: () => reached++ });
  const body = { hexId: "8a2a1072b59ffff", challengerAddress: WALLET.address };

  await withTestServer(app, async (base) => {
    const res = await fetch(`${base}/battles/declare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 401);
  });

  assert.equal(reached, 0);
});

test("POST /battles/declare rejects a mismatched signer (signed by a different wallet than challengerAddress)", async () => {
  let reached = 0;
  const app = buildMirrorApp({ reachedDeclareLogic: () => reached++ });
  const body = { hexId: "8a2a1072b59ffff", challengerAddress: WALLET.address };

  await withTestServer(app, async (base) => {
    const headers = await buildAuthHeaders({ wallet: OTHER_WALLET, method: "POST", path: "/battles/declare", body, chainId: CHAIN_ID });
    const res = await fetch(`${base}/battles/declare`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 403);
    const json = (await res.json()) as { error: string };
    assert.match(json.error, /does not match challengerAddress/);
  });

  assert.equal(reached, 0);
});

test("POST /battles/declare rejects a bad signature", async () => {
  let reached = 0;
  const app = buildMirrorApp({ reachedDeclareLogic: () => reached++ });
  const body = { hexId: "8a2a1072b59ffff", challengerAddress: WALLET.address };

  await withTestServer(app, async (base) => {
    const headers = await buildAuthHeaders({ wallet: WALLET, method: "POST", path: "/battles/declare", body, chainId: CHAIN_ID });
    headers["x-movenrun-signature"] = headers["x-movenrun-signature"].slice(0, -4) + "dead";
    const res = await fetch(`${base}/battles/declare`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 401);
  });

  assert.equal(reached, 0);
});

test("POST /battles/declare: with valid auth, still returns the intentional 501 and no signing occurs", async () => {
  let reached = 0;
  const app = buildMirrorApp({ reachedDeclareLogic: () => reached++ });
  const body = { hexId: "8a2a1072b59ffff", challengerAddress: WALLET.address };

  await withTestServer(app, async (base) => {
    const headers = await buildAuthHeaders({ wallet: WALLET, method: "POST", path: "/battles/declare", body, chainId: CHAIN_ID });
    const res = await fetch(`${base}/battles/declare`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 501);
    const json = (await res.json()) as Record<string, unknown>;
    assert.equal(json.error, "challenge_declaration_not_wired");
    // No signature/oracleSig field is ever present on this response.
    assert.equal(json.oracleSig, undefined);
  });

  assert.equal(reached, 1, "valid auth should reach the 501 path exactly once");
});
