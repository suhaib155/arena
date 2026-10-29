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

/**
 * Returns a signature that is guaranteed to differ in its r component (bytes
 * 1..32), so it can never decode to the same (r, s, v) triple as the input.
 * Replacing the trailing hex digits instead is unsafe: the last byte is the
 * recovery id v, and ethers accepts 27/28, 0/1 and >= 35 encodings, so a
 * suffix such as "dead" (v = 0xad = 173, normalised to 27) leaves a signature
 * ending in "de1b" fully valid.
 */
function corruptSignature(sig: string): string {
  const i = 10; // inside r
  const flipped = sig[i] === "0" ? "1" : "0";
  return sig.slice(0, i) + flipped + sig.slice(i + 1);
}

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
    headers["x-movenrun-signature"] = corruptSignature(headers["x-movenrun-signature"]);
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

test("signature mutation helper: the old 'dead' suffix is a no-op for signatures ending in de1b, corruptSignature never is", async () => {
  // Signing is deterministic (RFC 6979), so grinding the message finds, for the
  // fixed test key, a signature whose last two bytes are 0xde 0x1b (about 1 in
  // 512). The previous mutation turned exactly these into a still-valid signature.
  let message = "";
  let sig = "";
  for (let n = 0; n < 200_000; n++) {
    message = `grind-${n}`;
    sig = await WALLET.signMessage(message);
    if (sig.endsWith("de1b")) break;
  }
  assert.ok(sig.endsWith("de1b"), "found a signature ending in de1b");

  const oldMutation = sig.slice(0, -4) + "dead";
  assert.notEqual(oldMutation, sig, "string differs");
  assert.equal(ethers.verifyMessage(message, oldMutation), WALLET.address, "old mutation still verifies (the flake)");

  const fixed = corruptSignature(sig);
  assert.notEqual(fixed, sig);
  assert.notEqual(ethers.Signature.from(fixed).r, ethers.Signature.from(sig).r);
  let recovered: string | null = null;
  try {
    recovered = ethers.verifyMessage(message, fixed);
  } catch {
    recovered = null;
  }
  assert.notEqual(recovered, WALLET.address, "corrupted signature must not verify as the signer");
});

test("POST /zones/mint rejects a corrupted signature even when the original ends in de1b", async () => {
  let signed = 0;
  const app = buildMirrorApp({ checkEligibility: () => {}, sign: () => signed++ }, ELIGIBLE);
  const body = { hexId: "8a2a1072b59ffff", walletAddress: WALLET.address };
  const issuedAt = Date.now();

  let headers: Record<string, string> = {};
  for (let n = 0; n < 200_000; n++) {
    headers = await buildAuthHeaders({ wallet: WALLET, method: "POST", path: "/zones/mint", body, chainId: CHAIN_ID, nonce: `grind-${n}`, issuedAt });
    if (headers["x-movenrun-signature"].endsWith("de1b")) break;
  }
  assert.ok(headers["x-movenrun-signature"].endsWith("de1b"));
  headers["x-movenrun-signature"] = corruptSignature(headers["x-movenrun-signature"]);

  await withTestServer(app, async (base) => {
    const res = await fetch(`${base}/zones/mint`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 401);
  });
  assert.equal(signed, 0);
});
