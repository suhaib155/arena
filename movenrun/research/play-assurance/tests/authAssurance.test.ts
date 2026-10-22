/**
 * Track C auth assurance: local negative tests against the real sign-in code.
 *
 * Offline only. No network, no database, no provider account. Each test runs
 * the shipped modules (backend/src, mobile/src) with in-memory stores or a
 * stubbed fetch. Tests named "finding:" pin behaviour that this track reports
 * as a gap (AUTH_SECURITY_GAP_ASSESSMENT.md); when a fix lands, the matching
 * test is expected to fail and should be flipped to assert the fixed behaviour.
 *
 * Run from movenrun/:  node --import tsx --test 'research/play-assurance/tests/*.test.ts'
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { resolveApiConfig } from "../../../backend/src/api/config.js";
import { getAllowedOrigins } from "../../../backend/src/middleware/security.js";
import { SupabaseTokenVerifier, tokenTrustSummary, type VerifiedSupabaseUser } from "../../../backend/src/identity/providers/supabaseAuth.js";
import { SupabaseSignInService, pkceChallengeOf } from "../../../backend/src/identity/services/supabaseSignIn.service.js";
import { createInMemoryStores } from "../../../backend/src/identity/repositories/memory.js";
import { createInMemorySignInStores } from "../../../backend/src/identity/repositories/signInStores.js";
import { EoaSignatureVerifier } from "../../../backend/src/identity/providers/eoaVerifier.js";
import { isIdentityError } from "../../../backend/src/identity/domain/errors.js";
import { createHarness } from "../../../backend/src/identity/testDoubles/harness.js";
import { parseGoogleCallback } from "../../../mobile/src/lib/signInMethods.js";

const URL_ = "https://tavxmwuwkeynbnzfwove.supabase.co";
const NOW = new Date("2026-10-22T06:00:00Z");
const nowS = Math.floor(NOW.getTime() / 1000);
const SUB = "5b0f6c1e-2d3a-4b5c-8d6e-7f8091a2b3c4";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const claims = (extra: Record<string, unknown> = {}) => ({
  iss: `${URL_}/auth/v1`, aud: "authenticated", role: "authenticated", sub: SUB, exp: nowS + 3600, iat: nowS - 10,
  session_id: randomUUID(), app_metadata: { providers: ["google"] }, amr: [{ method: "oauth", timestamp: nowS - 10 }], ...extra,
});

function hs256(payload: object, secret: string): string {
  const head = `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}`;
  return `${head}.${createHmac("sha256", secret).update(head).digest("base64url")}`;
}

function apiEnv(extra: Record<string, string> = {}) {
  return {
    NODE_ENV: "production", DATABASE_URL: "postgres://localhost/track_c", CORS_ORIGINS: "https://movenrun.xyz",
    IDENTITY_SESSION_PEPPER: randomBytes(32).toString("hex"), SUPABASE_URL: URL_,
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_trackc", SUPABASE_SECRET_KEY: "sb_secret_trackc", IDENTITY_AUTH_DOMAIN: "movenrun.xyz",
    ...extra,
  };
}

const noJwks = (async () => new Response(JSON.stringify({ keys: [] }), { status: 200 })) as typeof fetch;

// ---------------------------------------------------------------------------
// C2 / C9: legacy HS256 trust can be re-enabled by one environment variable.
// ---------------------------------------------------------------------------

test("control: the production API config without a legacy secret refuses every HS256 token", async () => {
  const config = resolveApiConfig(apiEnv());
  assert.equal(tokenTrustSummary(config.supabase), "signing keys only");
  const v = new SupabaseTokenVerifier(config.supabase, noJwks, () => NOW);
  await assert.rejects(v.verify(hs256(claims(), "x".repeat(40))), /bad_signature/);
});

test("finding: production API config accepts SUPABASE_LEGACY_JWT_SECRET and then trusts HS256 tokens signed with it", async () => {
  // Whoever holds the (revoked, X-26) legacy secret could mint a token for any
  // subject if the variable were ever restored by a merge, a blueprint or a dashboard edit.
  const secret = "legacy-secret-for-local-test-only-0123456789";
  const config = resolveApiConfig(apiEnv({ SUPABASE_LEGACY_JWT_SECRET: secret }));
  assert.equal(tokenTrustSummary(config.supabase), "signing keys and legacy secret");
  const v = new SupabaseTokenVerifier(config.supabase, noJwks, () => NOW);
  const forged = await v.verify(hs256(claims(), secret));
  assert.equal(forged.subject, SUB);
  assert.ok(forged.oauthSignedInAt, "a forged token can also satisfy the Google exchange window");
});

// ---------------------------------------------------------------------------
// C2: provider (JWKS) outage is indistinguishable from a forged token.
// ---------------------------------------------------------------------------

function service(tokens: { verify(t: string): Promise<VerifiedSupabaseUser> }, deleteFails = false) {
  const stores = createInMemoryStores(() => NOW);
  const signIn = createInMemorySignInStores();
  const deleted: string[] = [];
  const svc = new SupabaseSignInService({
    tokens,
    auth: {
      async signInWithEthereum() { throw new Error("not used"); },
      async deleteUser(subject: string) { if (deleteFails) throw new Error("provider down"); deleted.push(subject); },
      async listUsers() { return []; },
      async getUser() { return null; },
    },
    stores,
    signIn,
    eoaVerifier: new EoaSignatureVerifier(),
    config: { authDomain: "movenrun.xyz", chainId: 8453 },
    now: () => NOW,
  });
  return { svc, stores, signIn, deleted };
}

test("finding: a JWKS outage and a forged Google token produce the same public error (401 verification_failed)", async () => {
  const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const head = `${b64({ alg: "ES256", kid: "k1", typ: "JWT" })}.${b64(claims())}`;
  const good = `${head}.${sign("sha256", Buffer.from(head), { key: ec.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  const down = (async () => { throw new Error("network"); }) as typeof fetch;
  const outage = service(new SupabaseTokenVerifier({ url: URL_ }, down, () => NOW)).svc;
  const forged = service(new SupabaseTokenVerifier({ url: URL_ }, noJwks, () => NOW)).svc;
  const codes: string[] = [];
  for (const s of [outage, forged]) {
    try { await s.verifyGoogle(good); assert.fail("should refuse"); } catch (err) {
      assert.ok(isIdentityError(err));
      codes.push(`${err.status}:${err.code}`);
    }
  }
  // The app cannot tell "try again shortly" from "this sign-in is bad".
  assert.deepEqual(codes, ["401:verification_failed", "401:verification_failed"]);
});

// ---------------------------------------------------------------------------
// C7: provider deletion queue after an erase, then the person signs in again.
// ---------------------------------------------------------------------------

test("control: a failed provider deletion is queued and becomes due for retry after ten minutes", async () => {
  const { svc, signIn } = service({ async verify() { throw new Error("unused"); } }, true);
  const first = await svc.removeProviderUsers([SUB]);
  assert.deepEqual(first.pending, [SUB]);
  assert.deepEqual(await signIn.pendingAuthDeletions.due(new Date(NOW.getTime() + 11 * 60_000), 10 * 60_000, 50), [SUB]);
});

test("finding: if the erased person signs in again while the provider deletion is pending, the queue row is never cleared", async () => {
  const ctx = service({ async verify() { throw new Error("unused"); } }, true);
  await ctx.svc.removeProviderUsers([SUB]); // erase happened; provider unreachable → queued
  // The same Google account signs in again before the retry: Supabase still has the
  // user, so a NEW MovenRun account is created and mapped to the same subject.
  const user = await ctx.stores.users.create({ id: randomUUID() });
  await ctx.stores.identities.create({ id: randomUUID(), userId: user.id, provider: "supabase", providerSubject: SUB });
  const later = new Date(NOW.getTime() + 60 * 60_000);
  for (let run = 0; run < 3; run++) {
    const outcome = await ctx.svc.removeProviderUsers(await ctx.signIn.pendingAuthDeletions.due(later, 10 * 60_000, 50));
    assert.deepEqual(outcome, { removed: [], pending: [] }, "mapped user is correctly kept");
  }
  // ...but the row stays due forever (no remove, no markAttempt), taking a slot in
  // every 50-row retry batch. 50 such rows would starve genuine pending deletions.
  assert.deepEqual(await ctx.signIn.pendingAuthDeletions.due(later, 10 * 60_000, 50), [SUB]);
});

// ---------------------------------------------------------------------------
// C2: refresh rotation on a lost response.
// ---------------------------------------------------------------------------

test("finding (design trade-off): retrying a refresh after a lost response revokes the whole family", async () => {
  const h = createHarness();
  const r = await h.identity.authenticate({ provider: "google", providerSubject: `s-${randomUUID()}` });
  const issued = await h.sessions.issue({ userId: r.user.id, assuranceLevel: "aal2" });
  const rotated = await h.sessions.refresh(issued.refreshToken); // server rotated; response "lost"
  await assert.rejects(h.sessions.refresh(issued.refreshToken), (e: unknown) => isIdentityError(e) && e.code === "refresh_reuse_detected");
  // The new pair the client never received is dead too: the player must sign in with Google again.
  await assert.rejects(h.sessions.verifyAccess(rotated.accessToken));
});

// ---------------------------------------------------------------------------
// C2: wallet handoff code + PKCE verifier.
// ---------------------------------------------------------------------------

test("control: a wallet handoff code needs the right verifier, a wrong one does not burn it, and it is single-use", async () => {
  const { svc } = service({ async verify() { throw new Error("unused"); } });
  const verifier = randomBytes(32).toString("base64url");
  const { code } = await svc.createHandoff({ subject: SUB, email: null, method: "wallet" }, pkceChallengeOf(verifier));
  await assert.rejects(svc.exchangeHandoff(code, randomBytes(32).toString("base64url")));
  assert.equal((await svc.exchangeHandoff(code.toLowerCase().replace(/(.{4})/g, "$1-"), verifier)).subject, SUB);
  await assert.rejects(svc.exchangeHandoff(code, verifier));
});

// ---------------------------------------------------------------------------
// C2: CORS is apex-only when configured apex-only.
// ---------------------------------------------------------------------------

test("control: with CORS_ORIGINS=https://movenrun.xyz the www host is not an allowed origin, and '*' cannot start", () => {
  const allowed = getAllowedOrigins({ NODE_ENV: "production", CORS_ORIGINS: "https://movenrun.xyz" } as never);
  assert.deepEqual(allowed, ["https://movenrun.xyz"]);
  assert.ok(!allowed.includes("https://www.movenrun.xyz"));
  assert.throws(() => getAllowedOrigins({ NODE_ENV: "production", CORS_ORIGINS: "*" } as never));
  assert.throws(() => resolveApiConfig(apiEnv({ CORS_ORIGINS: "http://movenrun.xyz" })));
});

// ---------------------------------------------------------------------------
// C2 / F-06: mobile Google callback parser (identical at #125 15f7f87).
// ---------------------------------------------------------------------------

test("control: only the exact movenrun://auth/callback redirect with a well-formed code is accepted", () => {
  assert.deepEqual(parseGoogleCallback("movenrun://auth/callback?code=abcDEF123-_.~"), { kind: "code", code: "abcDEF123-_.~" });
  assert.equal(parseGoogleCallback("movenrun://auth/callbackx?code=abcdefgh").kind, "error");
  assert.equal(parseGoogleCallback("https://evil.example/auth/callback?code=abcdefgh").kind, "error");
  assert.deepEqual(parseGoogleCallback("movenrun://auth/callback?error=access_denied&error_description=x"), { kind: "error", reason: "provider_error" });
  assert.deepEqual(parseGoogleCallback("movenrun://auth/callback?code=a%3Cb%3Ecdefgh"), { kind: "error", reason: "missing_code" });
  assert.deepEqual(parseGoogleCallback(null), { kind: "cancelled" });
});

test("finding: a malformed percent-escape in the callback URL throws instead of returning an error result", () => {
  // Any app (or a crafted link) can open movenrun://auth/callback; a bounded
  // malformed escape is enough to make the parser throw URIError.
  for (const url of ["movenrun://auth/callback?code=abcdefgh&x=%E0%A4%A", "movenrun://auth/callback?%zz=1"]) {
    assert.throws(() => parseGoogleCallback(url), URIError, url);
  }
});
