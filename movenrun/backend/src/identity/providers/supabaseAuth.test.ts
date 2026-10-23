import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { LEGACY_JWT_SECRET_VARIABLES, SupabaseAuthClient, SupabaseAuthError, SupabaseTokenVerifier, supabaseAuthConfigFrom, tokenTrustSummary } from "./supabaseAuth.js";

const URL_ = "https://tavxtestproject.supabase.co";
const SUB = "5f6c2a1e-4b7d-4c8e-9f10-112233445566";
const NOW = new Date("2026-10-13T12:00:00Z");
const nowS = Math.floor(NOW.getTime() / 1000);

const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = (key: KeyObject, kid: string) => ({ ...key.export({ format: "jwk" }), kid, use: "sig" });

function token(claims: Record<string, unknown>, opts: { alg?: string; kid?: string; key?: KeyObject; hmac?: string } = {}): string {
  const alg = opts.alg ?? "ES256";
  const header = Buffer.from(JSON.stringify({ alg, typ: "JWT", ...(opts.kid === undefined ? { kid: "ec-1" } : opts.kid ? { kid: opts.kid } : {}) })).toString("base64url");
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const data = Buffer.from(`${header}.${body}`);
  let sig: Buffer;
  if (alg === "HS256") sig = createHmac("sha256", opts.hmac ?? "x").update(data).digest();
  else if (alg === "ES256") sig = sign("sha256", data, { key: opts.key ?? ec.privateKey, dsaEncoding: "ieee-p1363" });
  else if (alg === "RS256") sig = sign("sha256", data, opts.key ?? rsa.privateKey);
  else sig = Buffer.alloc(0);
  return `${header}.${body}.${sig.toString("base64url") || "AA"}`;
}

const good = {
  iss: `${URL_}/auth/v1`,
  aud: "authenticated",
  role: "authenticated",
  sub: SUB,
  exp: nowS + 3600,
  iat: nowS - 10,
  email: "Player@Example.com",
  amr: [{ method: "oauth", timestamp: nowS - 10 }],
  app_metadata: { provider: "google", providers: ["google"] },
  is_anonymous: false,
  session_id: "4F1C2B3A-1D2E-4F50-8A6B-7C8D9E0F1A2B",
};

function jwksFetch(keys: unknown[], counter = { n: 0 }): typeof fetch {
  return (async (url: string | URL | Request) => {
    counter.n += 1;
    assert.equal(String(url), `${URL_}/auth/v1/.well-known/jwks.json`);
    return new Response(JSON.stringify({ keys }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

const verifier = (fetchImpl = jwksFetch([jwk(ec.publicKey, "ec-1"), jwk(rsa.publicKey, "rsa-1")])) =>
  new SupabaseTokenVerifier({ url: URL_ }, fetchImpl, () => NOW);

async function rejects(v: SupabaseTokenVerifier, t: string, reason: string) {
  await assert.rejects(v.verify(t), (err: unknown) => err instanceof SupabaseAuthError && err.reason === reason);
}

test("a valid ES256 token yields the subject, verified email and sign-in method", async () => {
  const user = await verifier().verify(token(good));
  assert.equal(user.subject, SUB);
  assert.equal(user.email, "player@example.com");
  assert.deepEqual(user.methods, ["oauth"]);
  assert.deepEqual(user.providers, ["google"]);
  assert.equal(user.sessionId, "4f1c2b3a-1d2e-4f50-8a6b-7c8d9e0f1a2b");
  const { session_id: _omit, ...withoutSession } = good;
  assert.equal((await verifier().verify(token(withoutSession))).sessionId, null);
  assert.equal((await verifier().verify(token({ ...good, session_id: "not-a-uuid" }))).sessionId, null);
  // The Google sign-in time is the oauth entry's timestamp only; a newer
  // token_refresh (or any other method) entry never replaces it.
  assert.equal(user.oauthSignedInAt?.getTime(), (nowS - 10) * 1000);
  const refreshed = await verifier().verify(token({ ...good, iat: nowS, amr: [{ method: "oauth", timestamp: nowS - 900 }, { method: "token_refresh", timestamp: nowS - 5 }] }));
  assert.equal(refreshed.oauthSignedInAt?.getTime(), (nowS - 900) * 1000);
  const reordered = await verifier().verify(token({ ...good, amr: [{ method: "token_refresh", timestamp: nowS - 5 }, { method: "otp", timestamp: nowS - 1 }, { method: "oauth", timestamp: nowS - 900 }] }));
  assert.equal(reordered.oauthSignedInAt?.getTime(), (nowS - 900) * 1000);
  // No oauth entry, two of them, or no usable timestamp: no sign-in time.
  for (const amr of [undefined, [], [{ method: "token_refresh", timestamp: nowS - 5 }], [{ method: "oauth" }], [{ method: "oauth", timestamp: "soon" }], [{ method: "oauth", timestamp: nowS - 900 }, { method: "oauth", timestamp: nowS - 5 }], ["oauth"]]) {
    const { amr: _drop, ...rest } = good;
    assert.equal((await verifier().verify(token(amr === undefined ? rest : { ...rest, amr }))).oauthSignedInAt, null, JSON.stringify(amr));
  }
});

test("RS256 keys from the JWKS are accepted", async () => {
  const user = await verifier().verify(token(good, { alg: "RS256", kid: "rsa-1" }));
  assert.equal(user.subject, SUB);
});

test("signature, algorithm and key mix-ups are refused", async () => {
  const v = verifier();
  const other = generateKeyPairSync("ec", { namedCurve: "P-256" });
  await rejects(v, token(good, { key: other.privateKey }), "bad_signature");
  await rejects(v, token(good, { alg: "RS256", kid: "ec-1" }), "bad_signature"); // header alg ≠ key type
  await rejects(v, token(good, { alg: "none" }), "bad_signature");
  await rejects(v, token(good, { alg: "HS256", hmac: "guess" }), "bad_signature"); // no legacy secret configured
  await rejects(v, token(good, { kid: "" }), "bad_signature");
  await rejects(v, token(good, { kid: "unknown" }), "bad_signature");
  const [h, , s] = token(good).split(".");
  const forged = Buffer.from(JSON.stringify({ ...good, sub: "00000000-0000-4000-8000-000000000000" })).toString("base64url");
  await rejects(v, `${h}.${forged}.${s}`, "bad_signature");
  await rejects(v, "not.a.jwt!", "malformed_token");
});

test("issuer, audience, role, expiry, subject and anonymous users are checked", async () => {
  const v = verifier();
  await rejects(v, token({ ...good, iss: "https://other.supabase.co/auth/v1" }), "wrong_issuer");
  await rejects(v, token({ ...good, aud: "anon" }), "wrong_audience");
  await rejects(v, token({ ...good, role: "service_role" }), "wrong_role");
  await rejects(v, token({ ...good, exp: nowS - 1 }), "expired");
  await rejects(v, token({ ...good, exp: nowS + 10 }), "expired"); // inside the skew margin
  await rejects(v, token({ ...good, iat: nowS + 3600 }), "not_yet_valid");
  await rejects(v, token({ ...good, nbf: nowS + 3600 }), "not_yet_valid");
  await rejects(v, token({ ...good, nbf: "soon" }), "not_yet_valid");
  assert.equal((await v.verify(token({ ...good, nbf: nowS - 5 }))).subject, SUB);
  assert.equal((await v.verify(token({ ...good, aud: ["other", "authenticated"] }))).subject, SUB);
  await rejects(v, token({ ...good, aud: ["anon", "service_role"] }), "wrong_audience");
  await rejects(v, token({ ...good, sub: "user-1" }), "bad_subject");
  await rejects(v, token({ ...good, is_anonymous: true }), "anonymous_user");
});

test("a token marking any header critical, or naming none or another algorithm, is refused", async () => {
  const v = verifier();
  const withHeader = (extra: Record<string, unknown>) => {
    const t = token(good);
    const [h, b, sig] = t.split(".");
    const header = { ...JSON.parse(Buffer.from(h, "base64url").toString()), ...extra };
    return `${Buffer.from(JSON.stringify(header)).toString("base64url")}.${b}.${sig}`;
  };
  await rejects(v, withHeader({ crit: ["b64"], b64: false }), "bad_signature");
  await rejects(v, withHeader({ alg: "none" }), "bad_signature");
  await rejects(v, withHeader({ alg: "ES384" }), "bad_signature");
  await rejects(v, token(good, { alg: "HS256", hmac: "guess" }), "bad_signature"); // no legacy secret configured
});

test("an HS256 token is refused even when the verifier is handed a legacy shared secret", async () => {
  // A synthetic secret made here; a token signed with it is otherwise perfect.
  const secret = randomBytes(48).toString("base64url");
  const counter = { n: 0 };
  const smuggled = { url: URL_, legacyJwtSecret: secret } as unknown as ConstructorParameters<typeof SupabaseTokenVerifier>[0];
  const v = new SupabaseTokenVerifier(smuggled, jwksFetch([jwk(ec.publicKey, "ec-1")], counter), () => NOW);
  for (const kid of [undefined, "ec-1", ""]) {
    await rejects(v, token(good, { alg: "HS256", hmac: secret, kid }), "bad_signature");
  }
  // The shared-secret path never even reaches the key set.
  assert.equal(counter.n, 0);
  // The same verifier still accepts a token signed by the published EC key.
  assert.equal((await v.verify(token(good))).subject, SUB);
});

test("no shared-secret verification exists to re-enable", () => {
  // Fails if someone brings an HMAC acceptor or a legacy-secret setting back
  // into the verifier. Re-adding one is a security change, not a test fix.
  const source = readFileSync(new URL("./supabaseAuth.ts", import.meta.url), "utf8");
  assert.ok(!/createHmac|timingSafeEqual/.test(source), "the token verifier computes no HMAC");
  assert.ok(!/legacyJwtSecret/.test(source), "the verifier has no legacy secret setting");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/HS(256|384|512)/.test(code), "no HS algorithm is named outside comments");
});

test("a configured legacy shared-secret variable refuses startup, whatever its value", () => {
  const keys = { SUPABASE_URL: URL_, SUPABASE_PUBLISHABLE_KEY: "sb_publishable_a", SUPABASE_SECRET_KEY: "sb_secret_b" };
  assert.ok(LEGACY_JWT_SECRET_VARIABLES.includes("SUPABASE_LEGACY_JWT_SECRET"));
  assert.ok(LEGACY_JWT_SECRET_VARIABLES.includes("SUPABASE_JWT_SECRET"));
  for (const name of LEGACY_JWT_SECRET_VARIABLES) {
    for (const value of [randomBytes(48).toString("base64url"), "short", ""]) {
      let message = "";
      try {
        supabaseAuthConfigFrom({ ...keys, [name]: value });
      } catch (err) {
        message = err instanceof Error ? err.message : "";
      }
      assert.ok(message.includes(name), `${name} is refused by name`);
      if (value) assert.ok(!message.includes(value), "the refusal never echoes the value");
    }
    // Set on its own, without the rest of the Supabase settings, it is refused too.
    assert.throws(() => supabaseAuthConfigFrom({ [name]: "x".repeat(40) }), (err: unknown) => err instanceof Error && err.message.includes(name));
  }
});

test("malformed headers and algorithm none are refused before any key lookup", async () => {
  const counter = { n: 0 };
  const v = new SupabaseTokenVerifier({ url: URL_ }, jwksFetch([jwk(ec.publicKey, "ec-1")], counter), () => NOW);
  const [, body, sig] = token(good).split(".");
  const enc = (s: string) => Buffer.from(s).toString("base64url");
  for (const header of ["not json", "[]", "null", "1", '"ES256"']) {
    await rejects(v, `${enc(header)}.${body}.${sig}`, "malformed_token");
  }
  for (const t of ["", "a.b", "a.b.c.d", `.${body}.${sig}`, `${enc("{}")}.${body}.`, `${enc("{}")}..${sig}`]) {
    await rejects(v, t, "malformed_token");
  }
  for (const alg of ["none", "None", "NONE", "", "es256", 256, null]) {
    await rejects(v, `${enc(JSON.stringify({ alg, typ: "JWT", kid: "ec-1" }))}.${body}.${sig}`, "bad_signature");
  }
  await rejects(v, `${enc(JSON.stringify({ typ: "JWT", kid: "ec-1" }))}.${body}.${sig}`, "bad_signature");
  assert.equal(counter.n, 0);
});

test("JWKS is cached, private keys in it are ignored, and an unknown kid refetches at most once a minute", async () => {
  const counter = { n: 0 };
  let clock = NOW;
  const withPrivate = { ...ec.privateKey.export({ format: "jwk" }), kid: "ec-1", use: "sig" };
  const v = new SupabaseTokenVerifier({ url: URL_ }, jwksFetch([withPrivate], counter), () => clock);
  await rejects(v, token(good), "bad_signature");
  await rejects(v, token(good), "bad_signature");
  assert.equal(counter.n, 1);
  clock = new Date(NOW.getTime() + 61_000);
  await rejects(v, token({ ...good, exp: nowS + 7200 }), "bad_signature");
  assert.equal(counter.n, 2);
});

test("an unreachable JWKS fails closed", async () => {
  const down = (async () => { throw new Error("network"); }) as typeof fetch;
  await rejects(verifier(down), token(good), "bad_signature");
});

test("the Web3 grant posts message and signature with the publishable key only", async () => {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(JSON.stringify({ access_token: "tok", user: { id: SUB } }), { status: 200 });
  }) as unknown as typeof fetch;
  const client = new SupabaseAuthClient({ url: URL_, publishableKey: "sb_publishable_x", secretKey: "sb_secret_y" }, fetchImpl);
  const session = await client.signInWithEthereum("msg", "0xsig");
  assert.equal(session.accessToken, "tok");
  assert.equal(seen[0].url, `${URL_}/auth/v1/token?grant_type=web3`);
  assert.equal((seen[0].init.headers as Record<string, string>).apikey, "sb_publishable_x");
  assert.deepEqual(JSON.parse(String(seen[0].init.body)), { chain: "ethereum", message: "msg", signature: "0xsig" });
});

test("a refused grant and an outage are told apart; an already deleted user counts as deleted", async () => {
  const status = (code: number) => (async () => new Response("{}", { status: code })) as unknown as typeof fetch;
  const cfg = { url: URL_, publishableKey: "sb_publishable_x", secretKey: "sb_secret_y" };
  await assert.rejects(new SupabaseAuthClient(cfg, status(400)).signInWithEthereum("m", "s"), (e: unknown) => e instanceof SupabaseAuthError && e.reason === "rejected");
  await assert.rejects(new SupabaseAuthClient(cfg, status(502)).signInWithEthereum("m", "s"), (e: unknown) => e instanceof SupabaseAuthError && e.reason === "unavailable");
  await new SupabaseAuthClient(cfg, status(404)).deleteUser(SUB);
  await new SupabaseAuthClient(cfg, status(200)).deleteUser(SUB);
  await assert.rejects(new SupabaseAuthClient(cfg, status(500)).deleteUser(SUB));
  await assert.rejects(new SupabaseAuthClient(cfg, status(200)).deleteUser("../other"));
});

test("reading one auth user returns only its id and timestamps; a missing user is null, not an error", async () => {
  const cfg = { url: URL_, publishableKey: "sb_publishable_x", secretKey: "sb_secret_y" };
  const seen: string[] = [];
  const reply = (code: number, body: unknown) => (async (url: string, init: RequestInit) => {
    seen.push(`${init.method} ${url} ${(init.headers as Record<string, string>).apikey}`);
    return new Response(JSON.stringify(body), { status: code });
  }) as unknown as typeof fetch;
  const user = await new SupabaseAuthClient(cfg, reply(200, {
    id: SUB, created_at: "2026-10-13T10:00:00Z", last_sign_in_at: null, email: "x@example.com", phone: "1",
  })).getUser(SUB);
  assert.deepEqual(user, { id: SUB, createdAt: new Date("2026-10-13T10:00:00Z"), lastSignInAt: null });
  assert.equal(seen[0], `GET ${URL_}/auth/v1/admin/users/${SUB} sb_secret_y`);
  assert.equal(await new SupabaseAuthClient(cfg, reply(404, {})).getUser(SUB), null);
  // Unreadable or someone else's record: an error, so the sweep keeps the user.
  await assert.rejects(new SupabaseAuthClient(cfg, reply(200, { id: SUB })).getUser(SUB));
  await assert.rejects(new SupabaseAuthClient(cfg, reply(200, { id: "7f6c2a1e-4b7d-4c8e-9f10-112233445566", created_at: "2026-10-13T10:00:00Z" })).getUser(SUB));
  await assert.rejects(new SupabaseAuthClient(cfg, reply(500, {})).getUser(SUB));
  await assert.rejects(new SupabaseAuthClient(cfg, reply(200, {})).getUser("../users"));
});

test("configuration is all or nothing", () => {
  assert.equal(supabaseAuthConfigFrom({}), null);
  assert.throws(() => supabaseAuthConfigFrom({ SUPABASE_URL: URL_ }));
  const keys = { SUPABASE_PUBLISHABLE_KEY: "sb_publishable_a", SUPABASE_SECRET_KEY: "sb_secret_b" };
  assert.throws(() => supabaseAuthConfigFrom({ SUPABASE_URL: "http://x.supabase.co", ...keys }));
  assert.throws(() => supabaseAuthConfigFrom({ SUPABASE_URL: URL_, ...keys, SUPABASE_SECRET_KEY: keys.SUPABASE_PUBLISHABLE_KEY }));
  assert.deepEqual(supabaseAuthConfigFrom({ SUPABASE_URL: `${URL_}/`, ...keys }), {
    url: URL_, publishableKey: "sb_publishable_a", secretKey: "sb_secret_b",
  });
});

test("legacy anon and service_role JWT keys are refused, so revoking the legacy secret cannot break the API", () => {
  const legacyShaped = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2ln"; // shape only, signs nothing
  const keys = { SUPABASE_PUBLISHABLE_KEY: "sb_publishable_a", SUPABASE_SECRET_KEY: "sb_secret_b" };
  assert.throws(() => supabaseAuthConfigFrom({ SUPABASE_URL: URL_, ...keys, SUPABASE_PUBLISHABLE_KEY: legacyShaped }), /sb_publishable_/);
  assert.throws(() => supabaseAuthConfigFrom({ SUPABASE_URL: URL_, ...keys, SUPABASE_SECRET_KEY: legacyShaped }), /sb_secret_/);
  assert.throws(() => supabaseAuthConfigFrom({ SUPABASE_URL: URL_, SUPABASE_PUBLISHABLE_KEY: "sb_secret_b", SUPABASE_SECRET_KEY: "sb_publishable_a" }));
});

test("the startup summary names the only trusted keys: the published signing keys", () => {
  assert.equal(tokenTrustSummary(), "signing keys only");
});
