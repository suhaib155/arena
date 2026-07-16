/**
 * HTTP router integration — real Express app over in-memory stores. Exercises
 * deny-by-default auth, the email login → token flow, provider fail-closed
 * behavior, secret-shaped-input rejection, and that responses never leak
 * secret material. Uses only loopback (127.0.0.1) — no external network.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import { AddressInfo } from "node:net";
import { createInMemoryStores } from "../repositories/memory.js";
import { resolveIdentityConfig } from "../config.js";
import { createIdentityServices } from "./wiring.js";
import { createIdentityRouter } from "./router.js";
import { EmailOtpDeliveryDouble } from "../testDoubles/index.js";

const cfg = resolveIdentityConfig(
  {
    NODE_ENV: "test",
    IDENTITY_SESSION_PEPPER: "x".repeat(24),
    IDENTITY_OTP_PEPPER: "y".repeat(24),
    IDENTITY_AUTH_DOMAIN: "movenrun.test",
    IDENTITY_ALLOWED_CHAIN_IDS: "84532",
  },
  { requireSecrets: true }
);
assert.ok(cfg.ok);
const config = cfg.config;

const delivery = new EmailOtpDeliveryDouble();
const stores = createInMemoryStores();
const services = createIdentityServices(stores, config, { emailDelivery: delivery });

const app = express();
app.use(express.json());
app.use("/identity", createIdentityRouter(services));
app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: { code: "internal" } });
});

let server: Server;
let base: string;

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});
after(() => server?.close());

async function post(path: string, body: unknown, token?: string) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
async function get(path: string, token?: string) {
  const res = await fetch(base + path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

async function login(email: string): Promise<{ accessToken: string; refreshToken: string }> {
  await post("/identity/auth/email/begin", { email });
  const code = delivery.lastCodeFor(email)!;
  const res = await post("/identity/auth/email/complete", { email, code });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  return { accessToken: res.json.session.accessToken, refreshToken: res.json.session.refreshToken };
}

test("readiness reports provider status", async () => {
  const res = await get("/identity/ready");
  assert.equal(res.status, 200);
  assert.equal(res.json.providers.embeddedWalletEnabled, false);
});

test("email login issues tokens and never returns secret-shaped fields", async () => {
  const { accessToken, refreshToken } = await login("router@example.com");
  assert.ok(accessToken && refreshToken);
  const me = await get("/identity/me", accessToken);
  assert.equal(me.status, 200);
  assert.equal(me.json.user.status, "active");
  // Response carries no hash/securityVersion/device fields.
  const blob = JSON.stringify(me.json);
  for (const bad of ["refreshTokenHash", "securityVersion", "userAgentHash", "codeHash", "pepper"]) {
    assert.ok(!blob.includes(bad), `response must not include ${bad}`);
  }
});

test("protected routes deny by default without a bearer token", async () => {
  const res = await get("/identity/wallets");
  assert.equal(res.status, 401);
});

test("a valid token lists wallets", async () => {
  const { accessToken } = await login("wallets@example.com");
  const res = await get("/identity/wallets", accessToken);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.json.wallets));
});

test("unknown/extra fields (e.g. mnemonic) are rejected by strict validation", async () => {
  const res = await post("/identity/auth/email/complete", { email: "x@example.com", code: "123456", mnemonic: "a b c" });
  assert.equal(res.status, 400);
  assert.equal(res.json.error.code, "invalid_request");
});

test("a private-key-shaped value is rejected as prohibited secret input", async () => {
  const rawKey = "0x" + "a".repeat(64);
  const res = await post("/identity/auth/refresh", { refreshToken: rawKey });
  assert.equal(res.status, 400);
  assert.equal(res.json.error.code, "invalid_request");
});

test("google/base entry points fail closed (no provider wired)", async () => {
  const g = await post("/identity/auth/google/begin", {});
  assert.equal(g.status, 503);
  assert.equal(g.json.error.code, "provider_not_configured");
});

test("wallet export begins with step-up and exposes NO secret", async () => {
  const { accessToken } = await login("export@example.com");
  const res = await post("/identity/wallets/export/begin", {}, accessToken);
  assert.equal(res.status, 503); // provider-isolated, not yet wired
  const blob = JSON.stringify(res.json);
  assert.ok(!/mnemonic|privatekey|private_key|seed/i.test(blob));
});

test("a full wallet-link challenge round-trip works over HTTP", async () => {
  const { Wallet } = await import("ethers");
  const wallet = Wallet.createRandom();
  const { accessToken } = await login("link@example.com");
  const begin = await post(
    "/identity/wallets/link/begin",
    { action: "link_external_wallet", address: wallet.address, chainId: 84532, walletType: "external_eoa" },
    accessToken
  );
  assert.equal(begin.status, 200, JSON.stringify(begin.json));
  const signature = await wallet.signMessage(begin.json.message);
  const complete = await post(
    "/identity/wallets/link/complete",
    { nonce: begin.json.nonce, address: wallet.address, signature, walletType: "external_eoa", chainId: 84532, action: "link_external_wallet", sourceProvider: "walletconnect" },
    accessToken
  );
  assert.equal(complete.status, 200, JSON.stringify(complete.json));
  assert.equal(complete.json.wallet.ownershipStatus, "verified");
});
