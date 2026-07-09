/**
 * Proves POST /zones/mint's auth wiring end-to-end over real HTTP, using a
 * handler that mirrors routes/zones.ts's POST /mint exactly (requireWalletAuth
 * -> body validation -> signer-matches-walletAddress check -> eligibility
 * check -> oracle signing) with spies substituted for the eligibility lookup
 * and the oracle signer.
 *
 * Can't be proven against the real routes/zones.ts directly: it constructs
 * `new OracleService()` at module load, which reads `ORACLE_PRIVATE_KEY` via
 * getConfig() (process.exit(1) on invalid/missing env) — the same constraint
 * documented for routes/gps.ts in docs/CONTRACTS_AUDIT.md "Why auth/rate-limit
 * aren't tested against the real route files".
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

interface Eligibility {
  isEligible: boolean;
  topMover: string;
  mintCost: bigint;
}

function buildMirrorApp(spies: { checkEligibility: () => void; sign: () => void }, eligibility: Eligibility) {
  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    })
  );

  // Mirrors routes/zones.ts's POST /mint ordering exactly.
  app.post("/zones/mint", requireWalletAuth({ chainId: CHAIN_ID, maxAgeSeconds: 300 }), (req, res) => {
    const schema = z.object({
      hexId: z.string(),
      walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

    const { hexId, walletAddress } = parsed.data;

    if (walletAddress.toLowerCase() !== req.movenrunAuth!.address) {
      return res.status(403).json({ error: "Signer does not match walletAddress" });
    }

    spies.checkEligibility();
    if (!eligibility.isEligible) {
      return res.status(403).json({ error: "Zone not eligible for minting", eligibility });
    }
    if (eligibility.topMover.toLowerCase() !== walletAddress.toLowerCase()) {
      return res.status(403).json({ error: "Not the top mover for this zone" });
    }

    spies.sign();
    return res.json({ hexId, mintCost: eligibility.mintCost.toString(), oracleSig: "0xmocksig" });
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

const ELIGIBLE: Eligibility = { isEligible: true, topMover: WALLET.address, mintCost: 100n };

test("POST /zones/mint rejects missing auth and produces no oracle signature", async () => {
  let eligibilityChecks = 0;
  let signed = 0;
  const app = buildMirrorApp({ checkEligibility: () => eligibilityChecks++, sign: () => signed++ }, ELIGIBLE);
  const body = { hexId: "8a2a1072b59ffff", walletAddress: WALLET.address };

  await withTestServer(app, async (base) => {
    const res = await fetch(`${base}/zones/mint`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 401);
  });

  assert.equal(eligibilityChecks, 0, "auth middleware runs before handler logic");
  assert.equal(signed, 0);
});

test("POST /zones/mint rejects a mismatched signer (signed by a different wallet than body.walletAddress) and produces no oracle signature", async () => {
  let eligibilityChecks = 0;
  let signed = 0;
  const app = buildMirrorApp({ checkEligibility: () => eligibilityChecks++, sign: () => signed++ }, ELIGIBLE);
  const body = { hexId: "8a2a1072b59ffff", walletAddress: WALLET.address };

  await withTestServer(app, async (base) => {
    const headers = await buildAuthHeaders({ wallet: OTHER_WALLET, method: "POST", path: "/zones/mint", body, chainId: CHAIN_ID });
    const res = await fetch(`${base}/zones/mint`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 403);
    const json = (await res.json()) as { error: string };
    assert.match(json.error, /does not match walletAddress/);
  });

  assert.equal(eligibilityChecks, 0, "the eligibility check must not run when the signer doesn't match");
  assert.equal(signed, 0);
});

test("POST /zones/mint rejects a bad signature and produces no oracle signature", async () => {
  let signed = 0;
  const app = buildMirrorApp({ checkEligibility: () => {}, sign: () => signed++ }, ELIGIBLE);
  const body = { hexId: "8a2a1072b59ffff", walletAddress: WALLET.address };

  await withTestServer(app, async (base) => {
    const headers = await buildAuthHeaders({ wallet: WALLET, method: "POST", path: "/zones/mint", body, chainId: CHAIN_ID });
    headers["x-movenrun-signature"] = headers["x-movenrun-signature"].slice(0, -4) + "dead";
    const res = await fetch(`${base}/zones/mint`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 401);
  });

  assert.equal(signed, 0);
});

test("POST /zones/mint: valid auth reaches existing handler behavior and signs exactly once", async () => {
  let eligibilityChecks = 0;
  let signed = 0;
  const app = buildMirrorApp({ checkEligibility: () => eligibilityChecks++, sign: () => signed++ }, ELIGIBLE);
  const body = { hexId: "8a2a1072b59ffff", walletAddress: WALLET.address };

  await withTestServer(app, async (base) => {
    const headers = await buildAuthHeaders({ wallet: WALLET, method: "POST", path: "/zones/mint", body, chainId: CHAIN_ID });
    const res = await fetch(`${base}/zones/mint`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { oracleSig: string };
    assert.equal(json.oracleSig, "0xmocksig");
  });

  assert.equal(eligibilityChecks, 1);
  assert.equal(signed, 1);
});

test("POST /zones/mint: valid auth but not the top mover is rejected before signing (existing behavior preserved)", async () => {
  let signed = 0;
  const notTopMover: Eligibility = { isEligible: true, topMover: OTHER_WALLET.address, mintCost: 100n };
  const app = buildMirrorApp({ checkEligibility: () => {}, sign: () => signed++ }, notTopMover);
  const body = { hexId: "8a2a1072b59ffff", walletAddress: WALLET.address };

  await withTestServer(app, async (base) => {
    const headers = await buildAuthHeaders({ wallet: WALLET, method: "POST", path: "/zones/mint", body, chainId: CHAIN_ID });
    const res = await fetch(`${base}/zones/mint`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 403);
  });

  assert.equal(signed, 0);
});
