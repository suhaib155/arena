/**
 * Wallet sign-in over HTTP while the sign-in provider is partly or wholly
 * down. The real Web3 grant client, real token verifier, sign-in service and
 * Express router on in-memory stores; one local stand-in answers both the
 * grant and the key-set endpoint, and every key is generated here.
 *
 * - A grant that cannot be reached, answers 5xx or returns no token is the
 *   provider being down: 503 provider_unavailable with Retry-After, the same
 *   as a key-set outage, never "not configured" and never a session.
 * - A grant the provider refuses is final: 401, 403 at the account cap,
 *   429 at the hourly quota, with no Retry-After.
 * - A key-set outage after a good grant is 503; a token signed by any other
 *   key after a good key fetch stays 401.
 * - A forged MovenRun bearer is 401 no-store during a total outage and costs
 *   no provider call (the hosted B0 smoke check, pinned here).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { Wallet } from "ethers";
import { createInMemoryStores } from "../repositories/memory.js";
import { createInMemorySignInStores } from "../repositories/signInStores.js";
import { EoaSignatureVerifier } from "../providers/eoaVerifier.js";
import { SupabaseAuthClient, SupabaseTokenVerifier } from "../providers/supabaseAuth.js";
import { SupabaseSignInService } from "../services/supabaseSignIn.service.js";
import { resolveIdentityConfig } from "../config.js";
import { createIdentityServices } from "./wiring.js";
import { createIdentityRouter } from "./router.js";

const URL_ = "https://walletoutage.supabase.co";
const T0 = new Date("2026-11-01T12:00:00Z");
const SUB = "cccccccc-cccc-4ccc-8ccc-000000000001";
const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
const publicJwk = { ...ec.publicKey.export({ format: "jwk" }), kid: "ec-1", use: "sig" };

type SignerWallet = { address: string; signMessage(m: string): Promise<string> };
type Grant = "ok" | "network" | "502" | "no-token" | "400" | "403" | "429" | "foreign-key";
type Res = { status: number; json: any; headers: Headers };

const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
let sessionN = 0;

/** A wallet-session access token as the provider issues it after a Web3 grant. */
function mintWeb3(now: Date, key: KeyObject = ec.privateKey): string {
  const s = Math.floor(now.getTime() / 1000);
  const head = `${enc({ alg: "ES256", typ: "JWT", kid: "ec-1" })}.${enc({
    iss: `${URL_}/auth/v1`, aud: "authenticated", role: "authenticated", sub: SUB,
    exp: s + 3600, iat: s - 5, amr: [{ method: "web3", timestamp: s - 5 }],
    app_metadata: { provider: "web3", providers: ["web3"] }, is_anonymous: false,
    session_id: `4f1c2b3a-1d2e-4f50-8a6b-${String(++sessionN).padStart(12, "0")}`,
  })}`;
  return `${head}.${sign("sha256", Buffer.from(head), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}

async function withApi(fn: (ctx: {
  provider: { grant: Grant; jwksUp: boolean; calls: string[] };
  advance: (ms: number) => void;
  walletSignIn: (wallet: SignerWallet) => Promise<Res & { message: string; signature: string }>;
  call: (method: string, path: string, body?: unknown, bearer?: string) => Promise<Res>;
}) => Promise<void>) {
  let clock = T0;
  const now = () => clock;
  const provider = { grant: "ok" as Grant, jwksUp: true, calls: [] as string[] };
  const fetchImpl = (async (url: string) => {
    const u = String(url);
    if (u === `${URL_}/auth/v1/.well-known/jwks.json`) {
      provider.calls.push("jwks");
      if (!provider.jwksUp) throw new TypeError("fetch failed");
      return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
    }
    assert.equal(u, `${URL_}/auth/v1/token?grant_type=web3`);
    provider.calls.push("grant");
    switch (provider.grant) {
      case "network": throw new TypeError("fetch failed");
      case "502": return new Response("{}", { status: 502 });
      case "no-token": return new Response(JSON.stringify({ user: { id: SUB } }), { status: 200 });
      case "400": return new Response("{}", { status: 400 });
      case "403": return new Response("{}", { status: 403 });
      case "429": return new Response("{}", { status: 429 });
      case "foreign-key":
        return new Response(JSON.stringify({ access_token: mintWeb3(now(), generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey) }), { status: 200 });
      default: return new Response(JSON.stringify({ access_token: mintWeb3(now()) }), { status: 200 });
    }
  }) as unknown as typeof fetch;
  const stores = createInMemoryStores(now);
  const service = new SupabaseSignInService({
    tokens: new SupabaseTokenVerifier({ url: URL_ }, fetchImpl, now),
    auth: new SupabaseAuthClient({ url: URL_, publishableKey: "sb_publishable_test", secretKey: "sb_secret_test" }, fetchImpl),
    stores,
    signIn: createInMemorySignInStores(),
    eoaVerifier: new EoaSignatureVerifier(),
    config: { authDomain: "movenrun.xyz", chainId: 8453 },
    now,
  });
  const cfg = resolveIdentityConfig({ NODE_ENV: "test", IDENTITY_SESSION_PEPPER: "w".repeat(32), IDENTITY_AUTH_DOMAIN: "movenrun.xyz" }, { requireSecrets: false });
  assert.ok(cfg.ok);
  const app = express();
  app.use(express.json());
  app.use("/identity", createIdentityRouter(createIdentityServices(stores, cfg.config), { supabaseSignIn: service }));
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown, bearer?: string): Promise<Res> => {
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as any, headers: res.headers };
  };
  const walletSignIn = async (wallet: SignerWallet) => {
    const begin = await call("POST", "/identity/auth/wallet/begin", { address: wallet.address });
    assert.equal(begin.status, 200, "begin needs no provider");
    const message: string = begin.json.message;
    const signature = await wallet.signMessage(message);
    return { ...(await call("POST", "/identity/auth/wallet/complete", { message, signature })), message, signature };
  };
  try {
    await fn({ provider, advance: (ms) => { clock = new Date(clock.getTime() + ms); }, walletSignIn, call });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function assertUnavailable(res: Res, label: string) {
  assert.equal(res.status, 503, label);
  assert.deepEqual(res.json, { error: { code: "provider_unavailable" } }, label);
  assert.equal(res.headers.get("retry-after"), "10", label);
  assert.equal(res.headers.get("cache-control"), "no-store", label);
}

function assertFinal(res: Res, status: number, code: string, label: string) {
  assert.equal(res.status, status, label);
  assert.equal(res.json?.error?.code, code, label);
  assert.equal(res.headers.get("retry-after"), null, `${label}: a refusal is not retryable`);
  assert.equal(res.headers.get("cache-control"), "no-store", label);
  assert.ok(!("session" in (res.json ?? {})), `${label}: no session`);
}

test("a wallet grant outage (network, 5xx, no token) is 503 provider_unavailable, never not-configured; a new sign-in works once it is back", async () => {
  for (const kind of ["network", "502", "no-token"] as const) {
    await withApi(async ({ provider, walletSignIn }) => {
      const wallet = Wallet.createRandom();
      provider.grant = kind;
      const down = await walletSignIn(wallet);
      assertUnavailable(down, kind);
      assert.ok(!("session" in (down.json ?? {})), `${kind}: no session`);
      provider.grant = "ok";
      const ok = await walletSignIn(wallet);
      assert.equal(ok.status, 200, `${kind}: recovers with a new challenge`);
      assert.ok(ok.json.session.accessToken);
    });
  }
});

test("the challenge spent by a failed grant cannot be replayed after recovery", async () => {
  await withApi(async ({ provider, walletSignIn, call }) => {
    provider.grant = "502";
    const down = await walletSignIn(Wallet.createRandom());
    assertUnavailable(down, "grant down");
    provider.grant = "ok";
    const replay = await call("POST", "/identity/auth/wallet/complete", { message: down.message, signature: down.signature });
    assertFinal(replay, 401, "challenge_consumed", "replayed challenge");
    assert.deepEqual(provider.calls, ["grant"], "the replay never reached the provider");
  });
});

test("a refused grant is final: 401, 403 at the cap, 429 at the quota, with no Retry-After", async () => {
  const cases: Array<[Grant, number, string]> = [
    ["400", 401, "verification_failed"],
    ["403", 403, "registration_closed"],
    ["429", 429, "too_many_attempts"],
  ];
  for (const [grant, status, code] of cases) {
    await withApi(async ({ provider, walletSignIn }) => {
      provider.grant = grant;
      assertFinal(await walletSignIn(Wallet.createRandom()), status, code, `grant ${grant}`);
    });
  }
});

test("after a good grant a key-set outage is 503, and a token from another key after a good fetch stays 401", async () => {
  await withApi(async ({ provider, walletSignIn, advance }) => {
    const wallet = Wallet.createRandom();
    provider.jwksUp = false;
    assertUnavailable(await walletSignIn(wallet), "keys down");
    provider.jwksUp = true;
    advance(11_000);
    provider.grant = "foreign-key";
    assertFinal(await walletSignIn(wallet), 401, "verification_failed", "foreign key");
    provider.grant = "ok";
    assert.equal((await walletSignIn(wallet)).status, 200, "valid after recovery");
  });
});

test("a forged MovenRun bearer is 401 no-store during a total provider outage and calls no provider", async () => {
  await withApi(async ({ provider, call }) => {
    provider.grant = "network";
    provider.jwksUp = false;
    const forged = await call("GET", "/identity/me", undefined, "mr_at_" + "A".repeat(43));
    assert.equal(forged.status, 401);
    assert.equal(forged.headers.get("cache-control"), "no-store");
    assert.equal(forged.headers.get("retry-after"), null);
    const none = await call("GET", "/identity/me");
    assert.equal(none.status, 401);
    assert.deepEqual(provider.calls, [], "a MovenRun bearer never consults the provider");
  });
});
