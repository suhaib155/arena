/**
 * Google sign-in threat matrix over HTTP, end to end: the real token
 * verifier, sign-in service and Express router on in-memory stores. The
 * key-set endpoint is a local stand-in and every key is generated here.
 *
 * - Only the project's published ES256 / RS256 signing keys sign anyone in.
 *   A shared-secret (HS256) token, an unknown key, an algorithm mix-up, a
 *   critical header, a future `nbf`, a missing or duplicated OAuth `amr`
 *   entry, a stale Google sign-in and a replayed session are all 401 with
 *   no session.
 * - A key-set outage is 503 provider_unavailable for a token that needs a
 *   key, never for one that is refused on its face; it does not touch a
 *   MovenRun session already issued.
 * - No token appears in a response body or in anything the code logs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHmac, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { createInMemoryStores } from "../repositories/memory.js";
import { createInMemorySignInStores } from "../repositories/signInStores.js";
import { EoaSignatureVerifier } from "../providers/eoaVerifier.js";
import { JWKS_MAX_STALE_MS, SupabaseAuthError, SupabaseTokenVerifier } from "../providers/supabaseAuth.js";
import { SupabaseSignInService } from "../services/supabaseSignIn.service.js";
import { resolveIdentityConfig } from "../config.js";
import { createIdentityServices } from "./wiring.js";
import { createIdentityRouter } from "./router.js";

const URL_ = "https://threattest.supabase.co";
const T0 = new Date("2026-10-28T12:00:00Z");
const SUB = "5f6c2a1e-4b7d-4c8e-9f10-112233445566";
const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEYS = [
  { ...ec.publicKey.export({ format: "jwk" }), kid: "ec-1", use: "sig" },
  { ...rsa.publicKey.export({ format: "jwk" }), kid: "rsa-1", use: "sig", alg: "RS256" },
];

const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
let sessionN = 0;
const freshSession = () => `4f1c2b3a-1d2e-4f50-8a6b-${String(++sessionN).padStart(12, "0")}`;

type Mint = { header?: Record<string, unknown>; claims?: Record<string, unknown>; drop?: string[]; key?: KeyObject; hmac?: Buffer };

/** A Google-session access token as Supabase issues it, signed by `key` (ES256 by default). */
function mint(now: Date, opts: Mint = {}): string {
  const s = Math.floor(now.getTime() / 1000);
  const header = { alg: "ES256", typ: "JWT", kid: "ec-1", ...opts.header };
  const claims: Record<string, unknown> = {
    iss: `${URL_}/auth/v1`, aud: "authenticated", role: "authenticated", sub: SUB,
    exp: s + 3600, iat: s - 5, email: "runner@example.com", amr: [{ method: "oauth", timestamp: s - 5 }],
    app_metadata: { provider: "google", providers: ["google"] }, is_anonymous: false, session_id: freshSession(),
    ...opts.claims,
  };
  for (const k of opts.drop ?? []) delete claims[k];
  const head = `${enc(header)}.${enc(claims)}`;
  let sig: Buffer;
  if (opts.hmac) sig = createHmac("sha256", opts.hmac).update(head).digest();
  else if (header.alg === "RS256") sig = sign("sha256", Buffer.from(head), opts.key ?? rsa.privateKey);
  else if (header.alg === "none") sig = Buffer.alloc(0);
  else sig = sign("sha256", Buffer.from(head), { key: opts.key ?? ec.privateKey, dsaEncoding: "ieee-p1363" });
  return `${head}.${sig.toString("base64url") || "AA"}`;
}

type Res = { status: number; json: any; headers: Headers; text: string };

async function withApi(fn: (ctx: {
  jwks: { up: boolean; n: number };
  advance: (ms: number) => void;
  now: () => Date;
  google: (accessToken: string) => Promise<Res>;
  call: (method: string, path: string, body?: unknown, bearer?: string) => Promise<Res>;
  bodies: string[];
  logs: string[];
}) => Promise<void>) {
  let clock = T0;
  const now = () => clock;
  const jwks = { up: true, n: 0 };
  const fetchImpl = (async (url: string) => {
    assert.equal(String(url), `${URL_}/auth/v1/.well-known/jwks.json`);
    jwks.n += 1;
    if (!jwks.up) throw new TypeError("fetch failed");
    return new Response(JSON.stringify({ keys: KEYS }), { status: 200 });
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
  const cfg = resolveIdentityConfig({ NODE_ENV: "test", IDENTITY_SESSION_PEPPER: randomBytes(32).toString("hex"), IDENTITY_AUTH_DOMAIN: "movenrun.xyz" }, { requireSecrets: false });
  assert.ok(cfg.ok);
  const app = express();
  app.use(express.json());
  app.use("/identity", createIdentityRouter(createIdentityServices(stores, cfg.config), { supabaseSignIn: service }));
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const bodies: string[] = [];
  const call = async (method: string, path: string, body?: unknown, bearer?: string): Promise<Res> => {
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    bodies.push(text);
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, headers: res.headers, text };
  };
  // Everything the code under test writes to the console is captured.
  const logs: string[] = [];
  const saved = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  for (const k of Object.keys(saved) as Array<keyof typeof saved>) console[k] = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  try {
    await fn({ jwks, advance: (ms) => { clock = new Date(clock.getTime() + ms); }, now, google: (t) => call("POST", "/identity/auth/google/complete", { accessToken: t }), call, bodies, logs });
  } finally {
    Object.assign(console, saved);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function assertRefused(res: Res, label: string) {
  assert.equal(res.status, 401, label);
  assert.deepEqual(res.json, { error: { code: "verification_failed" } }, label);
  assert.equal(res.headers.get("cache-control"), "no-store", label);
  assert.equal(res.headers.get("retry-after"), null, label);
}

function assertNoLeak(tokens: string[], texts: string[], label: string) {
  for (const t of tokens) {
    const sig = t.split(".")[2] ?? t;
    for (const text of texts) {
      assert.ok(!text.includes(t), `${label}: a token was echoed`);
      if (sig.length > 8) assert.ok(!text.includes(sig), `${label}: a token signature was echoed`);
    }
  }
}

test("only the project's ES256 and RS256 signing keys sign in; every other token is 401 with no session", async () => {
  await withApi(async ({ now, google, bodies, logs }) => {
    const s = Math.floor(now().getTime() / 1000);
    const es = await google(mint(now()));
    assert.equal(es.status, 200, "ES256");
    assert.ok(es.json.session.accessToken);
    const rs = await google(mint(now(), { header: { alg: "RS256", kid: "rsa-1" } }));
    assert.equal(rs.status, 200, "RS256");

    const cases: Array<[string, string]> = [
      ["HS256 with a shared secret", mint(now(), { header: { alg: "HS256" }, hmac: randomBytes(32) })],
      ["HS256 keyed with the published public key", mint(now(), { header: { alg: "HS256" }, hmac: Buffer.from(JSON.stringify(KEYS[0])) })],
      ["alg none", mint(now(), { header: { alg: "none" } })],
      ["unknown kid", mint(now(), { header: { kid: "ec-9" } })],
      ["no kid", mint(now(), { header: { kid: undefined } })],
      ["RS256 header on the EC key", mint(now(), { header: { alg: "RS256", kid: "ec-1" }, key: rsa.privateKey })],
      ["ES256 header on the RSA key", mint(now(), { header: { alg: "ES256", kid: "rsa-1" } })],
      ["signed by another EC key", mint(now(), { key: generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey })],
      ["crit naming exp", mint(now(), { header: { crit: ["exp"] } })],
      ["crit naming an unknown extension", mint(now(), { header: { crit: ["x-movenrun"], "x-movenrun": true } })],
      ["empty crit", mint(now(), { header: { crit: [] } })],
      ["nbf an hour ahead", mint(now(), { claims: { nbf: s + 3600 } })],
      ["nbf not a number", mint(now(), { claims: { nbf: "now" } })],
      ["no amr", mint(now(), { drop: ["amr"] })],
      ["amr without oauth", mint(now(), { claims: { amr: [{ method: "token_refresh", timestamp: s - 5 }] } })],
      ["oauth amr without a timestamp", mint(now(), { claims: { amr: [{ method: "oauth" }] } })],
      ["duplicated oauth amr", mint(now(), { claims: { amr: [{ method: "oauth", timestamp: s - 5 }, { method: "oauth", timestamp: s - 4 }] } })],
      ["Google sign-in 11 minutes old", mint(now(), { claims: { amr: [{ method: "oauth", timestamp: s - 11 * 60 }] } })],
      ["no session id", mint(now(), { drop: ["session_id"] })],
      ["wrong issuer", mint(now(), { claims: { iss: "https://other.supabase.co/auth/v1" } })],
      ["expired", mint(now(), { claims: { exp: s - 1 } })],
      ["anonymous", mint(now(), { claims: { is_anonymous: true } })],
      ["not a JWT", "not-a-token-at-all-but-long-enough-to-pass-schema"],
    ];
    const tried: string[] = [];
    for (const [label, token] of cases) {
      tried.push(token);
      assertRefused(await google(token), label);
    }

    // Replay: the same token, and another token of the same Supabase session.
    const session = freshSession();
    const first = mint(now(), { claims: { session_id: session } });
    assert.equal((await google(first)).status, 200);
    assertRefused(await google(first), "replayed token");
    const refreshed = mint(now(), { claims: { session_id: session, iat: s, amr: [{ method: "oauth", timestamp: s - 5 }, { method: "token_refresh", timestamp: s }] } });
    assertRefused(await google(refreshed), "another token of a spent session");
    tried.push(first, refreshed);

    assertNoLeak(tried, [...bodies, ...logs], "refusals");
  });
});

test("a key-set outage is 503 only for tokens that need a key; a MovenRun session survives it; nothing leaks", async () => {
  await withApi(async ({ jwks, advance, now, google, call, bodies, logs }) => {
    const signedIn = await google(mint(now()));
    assert.equal(signedIn.status, 200);
    const { accessToken, refreshToken } = signedIn.json.session;

    jwks.up = false;
    // Inside the bounded stale window the cached keys still decide: forged stays 401, valid signs in.
    advance(11 * 60_000);
    const forgedCached = mint(now(), { key: generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey });
    assertRefused(await google(forgedCached), "forged, keys cached");
    assert.equal((await google(mint(now()))).status, 200, "valid, keys cached");

    // Past it, nothing can be verified: a token that needs a key is 503, never accepted.
    advance(JWKS_MAX_STALE_MS);
    const valid = mint(now());
    const down = await google(valid);
    assert.equal(down.status, 503);
    assert.deepEqual(down.json, { error: { code: "provider_unavailable" } });
    assert.equal(down.headers.get("retry-after"), "10");
    assert.equal(down.headers.get("cache-control"), "no-store");
    assert.ok(!("session" in (down.json ?? {})));

    // A token refused on its face is still 401 during the outage, and costs no key fetch.
    const fetches = jwks.n;
    const onItsFace = [
      "malformed.token-with-two-parts-only-but-long-enough",
      mint(now(), { header: { alg: "HS256" }, hmac: randomBytes(32) }),
      mint(now(), { header: { alg: "none" } }),
      mint(now(), { header: { crit: ["exp"] } }),
      mint(now(), { header: { kid: undefined } }),
    ];
    for (const t of onItsFace) assertRefused(await google(t), `refused on its face: ${t.slice(0, 12)}`);
    assert.equal(jwks.n, fetches, "no key fetch for a token refused on its face");

    // The MovenRun session issued before the outage is untouched: refresh and use it.
    const refreshedRes = await call("POST", "/identity/auth/refresh", { refreshToken });
    assert.equal(refreshedRes.status, 200);
    const me = await call("GET", "/identity/me", undefined, refreshedRes.json.session.accessToken);
    assert.equal(me.status, 200);
    assert.equal(me.json.user.id, signedIn.json.user.id);
    assert.equal(jwks.n, fetches, "a MovenRun session never consults the provider's keys");

    // The same Google token works once the provider is back (the outage did not spend it).
    jwks.up = true;
    advance(11_000);
    assert.equal((await google(valid)).status, 200);

    assertNoLeak([valid, forgedCached, ...onItsFace.filter((t) => t.includes(".") && t.split(".").length === 3)], [...logs], "logs");
    assertNoLeak([valid, forgedCached], bodies.filter((b) => !b.includes('"accessToken"')), "error bodies");
    assert.ok(!logs.some((l) => l.includes(accessToken) || l.includes(refreshToken)), "a MovenRun token was logged");
  });
});
