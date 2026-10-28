/**
 * Google sign-in over HTTP while the provider's signing keys cannot be
 * fetched: a bounded, uncached 503 the client may retry, never a session;
 * a bad token after a good fetch stays a 401. Real token verifier, Express
 * router and in-memory stores; the key-set endpoint is a local stand-in and
 * every key is generated here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { generateKeyPairSync, sign } from "node:crypto";
import { createInMemoryStores } from "../repositories/memory.js";
import { createInMemorySignInStores } from "../repositories/signInStores.js";
import { EoaSignatureVerifier } from "../providers/eoaVerifier.js";
import { SupabaseAuthError, SupabaseTokenVerifier } from "../providers/supabaseAuth.js";
import { SupabaseSignInService } from "../services/supabaseSignIn.service.js";
import { resolveIdentityConfig } from "../config.js";
import { createIdentityServices } from "./wiring.js";
import { createIdentityRouter } from "./router.js";

const URL_ = "https://outagetest.supabase.co";
const T0 = new Date("2026-10-13T12:00:00Z");
const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
const publicJwk = { ...ec.publicKey.export({ format: "jwk" }), kid: "ec-1", use: "sig" };

function mint(now: Date, sessionId: string, key = ec.privateKey): string {
  const s = Math.floor(now.getTime() / 1000);
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = `${enc({ alg: "ES256", typ: "JWT", kid: "ec-1" })}.${enc({
    iss: `${URL_}/auth/v1`, aud: "authenticated", role: "authenticated", sub: "5f6c2a1e-4b7d-4c8e-9f10-112233445566",
    exp: s + 3600, iat: s - 5, email: "runner@example.com", amr: [{ method: "oauth", timestamp: s - 5 }],
    app_metadata: { provider: "google", providers: ["google"] }, is_anonymous: false, session_id: sessionId,
  })}`;
  return `${head}.${sign("sha256", Buffer.from(head), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}

async function withApi(fn: (ctx: {
  jwks: { up: boolean; failure: () => Promise<Response>; n: number };
  advance: (ms: number) => void;
  now: () => Date;
  post: (accessToken: string) => Promise<{ status: number; json: any; headers: Headers }>;
}) => Promise<void>) {
  let clock = T0;
  const now = () => clock;
  const jwks = { up: true, n: 0, failure: (): Promise<Response> => Promise.reject(new TypeError("fetch failed")) };
  const fetchImpl = (async (url: string) => {
    assert.equal(String(url), `${URL_}/auth/v1/.well-known/jwks.json`);
    jwks.n += 1;
    if (!jwks.up) return jwks.failure();
    return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
  }) as unknown as typeof fetch;
  const stores = createInMemoryStores(now);
  const service = new SupabaseSignInService({
    tokens: new SupabaseTokenVerifier({ url: URL_ }, fetchImpl, now),
    auth: {
      async signInWithEthereum() { throw new SupabaseAuthError("unavailable"); },
      async deleteUser() {},
      async listUsers() { return []; },
      async getUser() { return null; },
    },
    stores,
    signIn: createInMemorySignInStores(),
    eoaVerifier: new EoaSignatureVerifier(),
    config: { authDomain: "movenrun.xyz", chainId: 8453 },
    now,
  });
  const cfg = resolveIdentityConfig({ NODE_ENV: "test", IDENTITY_SESSION_PEPPER: "p".repeat(32), IDENTITY_AUTH_DOMAIN: "movenrun.xyz" }, { requireSecrets: false });
  assert.ok(cfg.ok);
  const app = express();
  app.use(express.json());
  app.use("/identity", createIdentityRouter(createIdentityServices(stores, cfg.config), { supabaseSignIn: service }));
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (accessToken: string) => {
    const res = await fetch(`${base}/identity/auth/google/complete`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessToken }),
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as any, headers: res.headers };
  };
  try {
    await fn({ jwks, advance: (ms) => { clock = new Date(clock.getTime() + ms); }, now, post });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const session = (n: number) => `4f1c2b3a-1d2e-4f50-8a6b-${String(n).padStart(12, "0")}`;

function assertUnavailable(res: { status: number; json: any; headers: Headers }, label: string) {
  assert.equal(res.status, 503, label);
  assert.deepEqual(res.json, { error: { code: "provider_unavailable" } }, label);
  assert.equal(res.headers.get("cache-control"), "no-store", label);
  assert.equal(res.headers.get("retry-after"), "10", label);
}

test("a JWKS outage is 503 provider_unavailable with no-store and Retry-After, for every failure kind", async () => {
  const kinds: Array<[string, () => Promise<Response>]> = [
    ["network", () => Promise.reject(new TypeError("fetch failed"))],
    ["timeout", () => Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError"))],
    ["500", async () => new Response("{}", { status: 500 })],
    ["503", async () => new Response("{}", { status: 503 })],
  ];
  for (const [label, failure] of kinds) {
    await withApi(async ({ jwks, now, post }) => {
      jwks.up = false;
      jwks.failure = failure;
      const res = await post(mint(now(), session(1)));
      assertUnavailable(res, label);
      assert.ok(!("session" in (res.json ?? {})), "no session is issued");
    });
  }
});

test("after a good fetch a forged token stays 401 with no Retry-After; a valid one signs in", async () => {
  await withApi(async ({ now, post }) => {
    const forged = await post(mint(now(), session(2), generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey));
    assert.equal(forged.status, 401);
    assert.equal(forged.json.error.code, "verification_failed");
    assert.equal(forged.headers.get("retry-after"), null);
    const ok = await post(mint(now(), session(3)));
    assert.equal(ok.status, 200);
    assert.ok(ok.json.session.accessToken);
  });
});

test("concurrent sign-ins during an outage all get 503 from one fetch, then recover", async () => {
  await withApi(async ({ jwks, advance, now, post }) => {
    jwks.up = false;
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => post(mint(now(), session(10 + i)))));
    for (const r of results) assertUnavailable(r, "concurrent");
    assert.equal(jwks.n, 1);
    // The same token can be retried once the provider is back; it was not spent by the outage.
    const retried = mint(now(), session(30));
    assertUnavailable(await post(retried), "still down");
    jwks.up = true;
    advance(11_000);
    const ok = await post(retried);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("cache-control"), "no-store");
  });
});
