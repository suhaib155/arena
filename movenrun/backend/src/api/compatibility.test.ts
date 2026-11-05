/**
 * Compatibility candidate: the security line's API and the Android release
 * candidate's movement rules, driven by the app's own client code, against a
 * real PostgreSQL migrated by the deployment command.
 *
 * What is real: the API app (rate limits, no-store, identity, movement), the
 * database and its migrations, the app's movement client and response decoder
 * (`mobile/src/services/movementApi.ts`), its authenticated transport, and its
 * estimated/verified XP settlement (`mobile/src/lib/movementXp.ts`). What is a
 * stand-in: Supabase Auth only (signing key, admin user calls). Routes are
 * synthetic walks in open ocean, not recordings.
 *
 * Skipped, loudly, when MOVENRUN_TEST_DATABASE_URL is not set.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, generateKeyPairSync, sign } from "node:crypto";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { Pool } from "pg";

import { resolveApiConfig } from "./config.js";
import { PROVIDER_UNAVAILABLE_RETRY_AFTER_SECONDS } from "../identity/domain/errors.js";
import { JWKS_RETRY_AFTER_FAILURE_MS } from "../identity/providers/supabaseAuth.js";
import { captureWalk, line, type WalkScenario } from "../movement/testing/syntheticWalks.js";
import type { ObservedPoint } from "../movement/domain/types.js";

const databaseUrl = process.env.MOVENRUN_TEST_DATABASE_URL;
const SUPABASE_URL = "https://compat-test.supabase.co";

// The app's own modules, loaded from the mobile workspace at run time (they
// are plain TypeScript with no React Native imports).
const mobile = (path: string) => import(new URL(`../../../mobile/src/${path}`, import.meta.url).href);

/** Honest 220 m city walk with 15 m accuracy: fewer than ten accepted fixes (MR-A-01 short route). */
function shortWalk(epochMs: number): WalkScenario {
  return {
    seed: 204, epochMs, accuracyM: 15, sigmaM: 5,
    legs: [{ kind: "still", seconds: 15 }, { kind: "move", path: line(220), speedMps: 1.4 }, { kind: "still", seconds: 5 }],
  };
}

/** A 600 m walk that passes the legacy ten-fix floor. */
function longerWalk(epochMs: number): WalkScenario {
  return {
    seed: 811, epochMs, accuracyM: 6, sigmaM: 2,
    legs: [{ kind: "still", seconds: 10 }, { kind: "move", path: line(600), speedMps: 1.4 }, { kind: "still", seconds: 5 }],
  };
}

/** The app's SubmitMovementRequest: observation window from the fixes, provenance when present. */
const toRequest = (sessionId: string, points: ObservedPoint[], session?: unknown) => ({
  sessionId,
  startTime: Math.min(...points.map((p) => p.timestamp)),
  endTime: Math.max(...points.map((p) => p.timestamp)),
  points,
  ...(session ? { session } : {}),
});

/** Stand-in XP curve for settlement arithmetic; the app's own curve is pinned by mobile tests. */
const xpFor = (distanceM: number, durationMs: number) => Math.round(distanceM / 10 + durationMs / 60_000);

test("compatibility candidate: app client, security API and movement rules on PostgreSQL", { skip: !databaseUrl }, async () => {
  const databaseName = `compat_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: databaseUrl });
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(databaseUrl!);
  url.pathname = `/${databaseName}`;
  const savedEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  const pool = new Pool({ connectionString: url.toString() });
  let shutdownApp: (() => Promise<void>) | undefined;
  try {
    for (const key of ["REDIS_URL", "ORACLE_PRIVATE_KEY", "BASE_RPC_URL", "BASE_SEPOLIA_RPC_URL"]) delete process.env[key];
    Object.assign(process.env, {
      NODE_ENV: "production", DATABASE_URL: url.toString(),
      IDENTITY_SESSION_PEPPER: randomBytes(32).toString("hex"),
      CORS_ORIGINS: "https://movenrun.xyz",
      SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test", SUPABASE_SECRET_KEY: "sb_secret_test",
      IDENTITY_AUTH_DOMAIN: "movenrun.xyz",
      RATE_LIMIT_WRITE_MAX: "100",
    });
    await new Promise<void>((resolve, reject) => execFile(process.execPath,
      ["../node_modules/drizzle-kit/bin.cjs", "migrate"], { env: process.env }, (error) => {
        if (error) reject(new Error("Migration command failed")); else resolve();
      }));
    assert.equal((await pool.query("select count(*)::int as n from drizzle.__drizzle_migrations")).rows[0].n, 11,
      "the candidate carries migrations 0000 to 0010 only");
    assert.equal((await pool.query("select count(*)::int as n from pg_tables where tablename like 'gameplay%'")).rows[0].n, 0,
      "no gameplay (0011) table exists");

    // Supabase Auth stand-in: a signing key that can go down, and admin user calls.
    const keys = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const provider = { jwksUp: true, deleted: [] as string[], signedIn: new Map<string, number>() };
    const mint = (sub: string) => {
      const now = Math.floor(Date.now() / 1000);
      provider.signedIn.set(sub, now * 1000);
      const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
      const head = enc({ alg: "ES256", kid: "k1", typ: "JWT" });
      const body = enc({
        iss: `${SUPABASE_URL}/auth/v1`, aud: "authenticated", role: "authenticated", sub, email: null,
        exp: now + 3600, iat: now, amr: [{ method: "oauth", timestamp: now }],
        app_metadata: { provider: "google", providers: ["google"] }, is_anonymous: false, session_id: randomUUID(),
      });
      return `${head}.${body}.${sign("sha256", Buffer.from(`${head}.${body}`), { key: keys.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
    };
    globalThis.fetch = async (input, init) => {
      const u = String(input);
      if (u === `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`) {
        if (!provider.jwksUp) throw new TypeError("fetch failed");
        return new Response(JSON.stringify({ keys: [{ ...keys.publicKey.export({ format: "jwk" }), kid: "k1", use: "sig", alg: "ES256" }] }), { status: 200 });
      }
      const user = new RegExp(`^${SUPABASE_URL}/auth/v1/admin/users/([0-9a-f-]{36})$`).exec(u);
      if (user && (init?.method ?? "GET") === "GET") {
        const at = provider.signedIn.get(user[1]!);
        if (at === undefined || provider.deleted.includes(user[1]!)) return new Response("{}", { status: 404 });
        return new Response(JSON.stringify({ id: user[1], created_at: new Date(at).toISOString(), last_sign_in_at: new Date(at).toISOString() }), { status: 200 });
      }
      if (user && init?.method === "DELETE") { provider.deleted.push(user[1]!); return new Response("{}", { status: 200 }); }
      if (u.startsWith(`${SUPABASE_URL}/auth/v1/admin/users?`)) return new Response(JSON.stringify({ users: [] }), { status: 200 });
      // The app's client calls this API over loopback; nothing else leaves the process.
      if (u.startsWith("http://127.0.0.1:")) return originalFetch(input, init);
      throw new Error(`unexpected outbound request: ${u}`);
    };

    const { createApiApp } = await import("./app.js");
    const { closeDb } = await import("../db/client.js");
    const server = createApiApp(resolveApiConfig()).listen(0, "127.0.0.1");
    await once(server, "listening");
    shutdownApp = async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeDb();
    };
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const call = (path: string, body?: unknown, token?: string) => originalFetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    // Provider outage before any key was fetched: a retryable 503, no account made.
    provider.jwksUp = false;
    const down = await call("/identity/auth/google/complete", { accessToken: mint(randomUUID()) });
    assert.equal(down.status, 503);
    assert.deepEqual(await down.json(), { error: { code: "provider_unavailable" } });
    assert.equal(down.headers.get("retry-after"), String(PROVIDER_UNAVAILABLE_RETRY_AFTER_SECONDS));
    assert.equal(down.headers.get("cache-control"), "no-store");
    assert.equal((await pool.query("select count(*)::int as n from users")).rows[0].n, 0);
    provider.jwksUp = true;
    // The verifier waits out its ten-second retry gap before fetching again.
    await new Promise((resolve) => setTimeout(resolve, JWKS_RETRY_AFTER_FAILURE_MS + 500));

    // Google sign-in through the security line.
    const subject = randomUUID();
    const signedIn = await call("/identity/auth/google/complete", { accessToken: mint(subject) });
    assert.equal(signedIn.status, 200);
    let accessToken: string | null = (await signedIn.json()).session.accessToken;

    // The app's movement client over the app's transport, pointed at this API.
    const { AuthedJsonTransport } = await mobile("services/authedTransport.ts");
    const { MovementApiClient, MovementApiError } = await mobile("services/movementApi.ts");
    const { recordEstimate, settle } = await mobile("lib/movementXp.ts");
    const { toVerifiedRecord } = await mobile("lib/verifiedMovement.ts");
    const transport = new AuthedJsonTransport({
      baseUrl: base,
      loadAccessToken: async () => accessToken,
      performRefresh: async () => ({ kind: "rejected" }),
      error: (status: number, code: string) => new MovementApiError(code, status, code),
    });
    const client = new MovementApiClient(transport);
    const stateOf = (v: { status: string; distanceMeters: number | null; durationSeconds: number | null; traversedHexIds: string[]; rejectionReasons: string[] }) =>
      v.status === "verified"
        ? { kind: "verified", distanceMeters: v.distanceMeters, durationSeconds: v.durationSeconds, traversedHexIds: v.traversedHexIds, sealed: null, sealMethods: null, sealCount: null }
        : { kind: "rejected", reasons: v.rejectionReasons };

    const epoch = Date.now() - 20 * 60_000;

    // 1. Short honest walk with session provenance: verified (MR-A-01), and
    //    verified XP never exceeds the phone's estimate.
    const walk = captureWalk(shortWalk(epoch));
    assert.ok(walk.accepted.length < 10, "really the short-route lane");
    const first = await client.submit(toRequest("compat-short-honest", walk.accepted, walk.session));
    assert.equal(first.verification.status, "verified", first.verification.rejectionReasons.join("; "));
    assert.equal(first.replayed, false);
    assert.ok(first.verification.distanceMeters >= 180 && first.verification.distanceMeters <= 260);
    let ledger = recordEstimate([], { clientSessionId: "compat-short-honest", estimatedXp: 500, submitted: true, savedAt: new Date().toISOString() });
    const record = toVerifiedRecord("compat-short-honest", stateOf(first.verification));
    const settled = settle(ledger, record, xpFor);
    const expected = xpFor(first.verification.distanceMeters, first.verification.durationSeconds * 1000);
    assert.ok(expected < 500);
    assert.equal(settled.verifiedXpDelta, expected, "verified XP is the server's measurement");
    assert.equal(settled.totalXpDelta, -(500 - expected), "the estimate above it is taken back");
    ledger = settled.ledger;

    // 2. A retry replays the same verdict and settles nothing twice.
    const replay = await client.submit(toRequest("compat-short-honest", walk.accepted, walk.session));
    assert.equal(replay.replayed, true);
    assert.deepEqual({ ...replay.verification, verifiedAt: null }, { ...first.verification, verifiedAt: null });
    const again = settle(ledger, toVerifiedRecord("compat-short-honest", stateOf(replay.verification)), xpFor);
    assert.deepEqual([again.totalXpDelta, again.verifiedXpDelta], [0, 0]);

    // 3. The same short walk without provenance keeps the legacy ten-fix floor.
    const legacy = await client.submit(toRequest("compat-short-legacy", walk.accepted));
    assert.equal(legacy.verification.status, "rejected");
    assert.equal(legacy.verification.distanceMeters, null);

    // 3b. A phone left still for five minutes, whose drift still produces five
    //     accepted fixes, is held to the short-route evidence policy (MR-A-01)
    //     and rejected as drift.
    const still = captureWalk({ seed: 103, epochMs: epoch + 2 * 60_000, accuracyM: 10, sigmaM: 4, legs: [{ kind: "still", seconds: 315 }] });
    assert.ok(still.accepted.length < 10, "really the short-route lane");
    const drift = await client.submit(toRequest("compat-short-stationary", still.accepted, still.session));
    assert.equal(drift.verification.status, "rejected");
    assert.equal(drift.verification.distanceMeters, null);
    assert.ok(drift.verification.rejectionReasons.some((r: string) => /short route/i.test(r)), drift.verification.rejectionReasons.join("; "));

    // 4. Impossible jump: one fix 2 km away for a second. Rejected, and the
    //    whole estimate is reversed.
    const long = captureWalk(longerWalk(epoch));
    const jumped = long.accepted.map((p, i) => (i === Math.floor(long.accepted.length / 2) ? { ...p, lat: p.lat + 0.018 } : p));
    const jump = await client.submit(toRequest("compat-impossible-jump", jumped, long.session));
    assert.equal(jump.verification.status, "rejected");
    ledger = recordEstimate(ledger, { clientSessionId: "compat-impossible-jump", estimatedXp: 120, submitted: true, savedAt: new Date().toISOString() });
    const reversed = settle(ledger, toVerifiedRecord("compat-impossible-jump", stateOf(jump.verification)), xpFor);
    assert.deepEqual([reversed.totalXpDelta, reversed.verifiedXpDelta], [-120, 0]);
    ledger = reversed.ledger;

    // 5. Clock integrity: a lifecycle that finishes an hour ahead of the server is rejected.
    const ahead = await client.submit(toRequest("compat-clock-ahead", long.accepted, { ...long.session, finishedAt: Date.now() + 60 * 60_000 }));
    assert.equal(ahead.verification.status, "rejected");
    assert.ok(ahead.verification.rejectionReasons.includes("Session lifecycle finishes in the future"));

    // 6. The honest longer walk verifies.
    const honest = await client.submit(toRequest("compat-long-honest", long.accepted, long.session));
    assert.equal(honest.verification.status, "verified", honest.verification.rejectionReasons.join("; "));

    // The raw response carries no XP, ownership or capture claim, and no coordinates are stored.
    const raw = await (await call("/movement/verify/compat-long-honest", undefined, accessToken!)).json();
    for (const key of ["xp", "capturedZones", "owned", "ownership", "lockedMove", "trustScore"]) assert.ok(!(key in raw), key);
    const stored = await pool.query("select * from movement_verifications");
    assert.equal(stored.rowCount, 6, "six sessions, the retry adds no row");
    assert.ok(!JSON.stringify(stored.rows).includes(String(walk.accepted[0]!.lat).slice(0, 8)));

    // 7. Provider outage after sign-in: the signed-in player keeps verifying
    //    walks, because a MovenRun session never consults the provider.
    provider.jwksUp = false;
    const outageWalk = captureWalk({ ...longerWalk(epoch + 5 * 60_000), seed: 812 });
    const during = await client.submit(toRequest("compat-during-outage", outageWalk.accepted, outageWalk.session));
    assert.equal(during.verification.status, "verified", during.verification.rejectionReasons.join("; "));
    provider.jwksUp = true;

    // 8. Account deletion: rows go, the provider user goes, the old token is
    //    refused, and the app's client reports it as signed out.
    const deleted = await call("/identity/account/delete", { confirm: "DELETE" }, accessToken!);
    assert.equal(deleted.status, 200);
    const deletedBody = await deleted.json();
    assert.equal(deletedBody.erased.movementSessions, 7);
    assert.equal(deletedBody.signInRecord, "removed");
    assert.deepEqual(provider.deleted, [subject]);
    assert.equal((await pool.query("select count(*)::int as n from movement_verifications")).rows[0].n, 0);
    await assert.rejects(client.submit(toRequest("compat-after-delete", long.accepted, long.session)),
      (e: { status?: number }) => e instanceof MovementApiError && e.status === 401);
    accessToken = null;
    await assert.rejects(client.submit(toRequest("compat-signed-out", long.accepted, long.session)),
      (e: unknown) => e instanceof MovementApiError);
    assert.equal((await pool.query("select count(*)::int as n from movement_verifications")).rows[0].n, 0);
  } finally {
    await shutdownApp?.();
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
    await pool.end();
    // Only the disposable database made above is ever removed.
    if (!/^compat_test_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Unexpected test database name");
    // pool.end() resolves before its sockets close; wait until the server sees
    // them gone so the forced drop never kills a closing client.
    for (let i = 0; i < 100; i++) {
      const open = await admin.query("select count(*)::int as count from pg_stat_activity where datname = $1", [databaseName]);
      if (open.rows[0].count === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }
});
