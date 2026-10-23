import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { Wallet } from "ethers";
import { resolveApiConfig } from "./config.js";

const databaseUrl = process.env.MOVENRUN_TEST_DATABASE_URL;
const SUPABASE_URL = "https://movenrun-test.supabase.co";

test("built API, migrations and real session/PostgreSQL flow (Supabase Auth stand-in only)", { skip: !databaseUrl }, async () => {
  const databaseName = `preview_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: databaseUrl });
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(databaseUrl!);
  url.pathname = `/${databaseName}`;
  const savedEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  const pool = new Pool({ connectionString: url.toString() });
  let shutdownApp: (() => Promise<void>) | undefined;
  let child: ReturnType<typeof spawn> | undefined;
  try {
    for (const key of ["REDIS_URL", "ORACLE_PRIVATE_KEY", "BASE_RPC_URL", "BASE_SEPOLIA_RPC_URL"]) delete process.env[key];
    Object.assign(process.env, {
      NODE_ENV: "production", DATABASE_URL: url.toString(),
      IDENTITY_SESSION_PEPPER: randomBytes(32).toString("hex"),
      // Left over from the email-code design: the API must ignore them.
      RESEND_API_KEY: "re_test_not_used", IDENTITY_EMAIL_FROM: "MovenRun <info@movenrun.xyz>",
      CORS_ORIGINS: "https://preview.example.com",
      SUPABASE_URL: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test", SUPABASE_SECRET_KEY: "sb_secret_test",
      IDENTITY_AUTH_DOMAIN: "movenrun.xyz",
      // This one test makes more sign-in calls from one address than a person would.
      RATE_LIMIT_WRITE_MAX: "100",
    });
    // Exercise the actual deployment command, including its migration journal.
    for (let attempt = 0; attempt < 2; attempt++) {
      await new Promise<void>((resolve, reject) => execFile(process.execPath,
        ["../node_modules/drizzle-kit/bin.cjs", "migrate"], { env: process.env }, error => {
          if (error) reject(new Error("Migration command failed")); else resolve();
        }));
    }
    const migrationRows = await pool.query("select count(*)::int as count from drizzle.__drizzle_migrations");
    assert.equal(migrationRows.rows[0].count, 11);
    // A hosted database's automatic REST API must not reach any table: every
    // table has row level security on (and no policies).
    const openTables = await pool.query(
      "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity"
    );
    assert.deepEqual(openTables.rows, []);
    const tableCount = await pool.query("select count(*)::int as count from pg_tables where schemaname = 'public'");
    assert.ok(tableCount.rows[0].count >= 10);

    const reserve = createServer().listen(0, "127.0.0.1");
    await once(reserve, "listening");
    const port = (reserve.address() as { port: number }).port;
    await new Promise<void>(resolve => reserve.close(() => resolve()));
    child = spawn(process.execPath, ["dist/api.cjs"], { env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
    let logs = "";
    child.stdout!.on("data", data => { logs += String(data); });
    child.stderr!.on("data", data => { logs += String(data); });
    let healthy = false;
    for (let retry = 0; retry < 100; retry++) {
      try {
        healthy = (await originalFetch(`http://127.0.0.1:${port}/ready`)).status === 200;
        if (healthy) break;
      } catch { /* listener starting */ }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(healthy, "compiled API reaches readiness with migrated PostgreSQL and no legacy variables");
    assert.equal((await originalFetch(`http://127.0.0.1:${port}/gps/submit`, { method: "POST" })).status, 404);
    // Public sign-in routes refuse large bodies; only movement accepts megabytes.
    const bulky = JSON.stringify({ address: "0x" + "a".repeat(40_000) });
    assert.equal((await originalFetch(`http://127.0.0.1:${port}/identity/auth/wallet/begin`, {
      method: "POST", headers: { "content-type": "application/json" }, body: bulky,
    })).status, 413);
    assert.notEqual((await originalFetch(`http://127.0.0.1:${port}/movement/verify`, {
      method: "POST", headers: { "content-type": "application/json" }, body: bulky,
    })).status, 413);
    child.kill();
    await once(child, "exit");
    child = undefined;
    assert.match(logs, /V3 API listening/);
    assert.match(logs, /proxies: 0 trusted hop\(s\)/);
    assert.ok(!logs.includes(process.env.IDENTITY_SESSION_PEPPER!));
    const graph = JSON.parse(await readFile("dist/api-inputs.json", "utf8")) as string[];
    assert.ok(!graph.some(path => /src\/(workers|routes|blockchain)\//.test(path)));

    // A session a week past its refresh expiry, and a live one: the clean-up
    // run at start deletes only the first (the batch delete is real SQL).
    await pool.query("insert into users (id) values ('prune-check')");
    await pool.query(`insert into auth_sessions (id, user_id, family_id, refresh_token_hash, expires_at)
      values ('prune-old', 'prune-check', 'f1', 'h-old', now() - interval '8 days'),
             ('prune-live', 'prune-check', 'f2', 'h-live', now() + interval '1 day')`);

    // Supabase Auth is the only thing replaced: a stand-in that publishes a
    // signing key, issues Web3 sessions and accepts admin deletions. Tokens are
    // real ES256 JWTs that the API verifies exactly as it would Supabase's.
    const keys = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const deletedProviderUsers: string[] = [];
    let adminListings = 0;
    const walletUsers = new Map<string, string>();
    /** When each provider user last signed in, for the admin user lookup. */
    const providerSignIns = new Map<string, number>();
    const mint = (sub: string, method: string, email: string | null, session: { id?: string | null; signedInAt?: number; refreshedAt?: number } = {}) => {
      const now = Math.floor(Date.now() / 1000);
      providerSignIns.set(sub, now * 1000);
      const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
      const head = enc({ alg: "ES256", kid: "k1", typ: "JWT" });
      const sessionId = session.id === undefined ? randomUUID() : session.id;
      const body = enc({ iss: `${SUPABASE_URL}/auth/v1`, aud: "authenticated", role: "authenticated", sub, email, exp: now + 3600, iat: now, amr: [{ method, timestamp: session.signedInAt ?? now }, ...(session.refreshedAt === undefined ? [] : [{ method: "token_refresh", timestamp: session.refreshedAt }])], app_metadata: { provider: method === "oauth" ? "google" : "web3", providers: [method === "oauth" ? "google" : "web3"] }, is_anonymous: false, ...(sessionId === null ? {} : { session_id: sessionId }) });
      return `${head}.${body}.${sign("sha256", Buffer.from(`${head}.${body}`), { key: keys.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
    };
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url === `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`) {
        return new Response(JSON.stringify({ keys: [{ ...keys.publicKey.export({ format: "jwk" }), kid: "k1", use: "sig", alg: "ES256" }] }), { status: 200 });
      }
      if (url === `${SUPABASE_URL}/auth/v1/token?grant_type=web3`) {
        const { message } = JSON.parse(String(init?.body));
        const address = String(message).split("\n")[1];
        if (!walletUsers.has(address)) walletUsers.set(address, randomUUID());
        return new Response(JSON.stringify({ access_token: mint(walletUsers.get(address)!, "web3", null) }), { status: 200 });
      }
      const admin = new RegExp(`^${SUPABASE_URL}/auth/v1/admin/users/([0-9a-f-]{36})$`).exec(url);
      if (admin && (init?.method ?? "GET") === "GET") {
        // The deletion queue reads the user before deleting it (A-2).
        assert.equal((init?.headers as Record<string, string>).apikey, "sb_secret_test");
        const at = providerSignIns.get(admin[1]);
        if (deletedProviderUsers.includes(admin[1]) || at === undefined) return new Response("{}", { status: 404 });
        return new Response(JSON.stringify({ id: admin[1], created_at: new Date(at).toISOString(), last_sign_in_at: new Date(at).toISOString() }), { status: 200 });
      }
      if (admin && init?.method === "DELETE") {
        assert.equal((init.headers as Record<string, string>).apikey, "sb_secret_test");
        deletedProviderUsers.push(admin[1]);
        return new Response("{}", { status: 200 });
      }
      if (url.startsWith(`${SUPABASE_URL}/auth/v1/admin/users?`) && (init?.method ?? "GET") === "GET") {
        assert.equal((init?.headers as Record<string, string>).apikey, "sb_secret_test");
        adminListings += 1;
        return new Response(JSON.stringify({ users: [] }), { status: 200 });
      }
      throw new Error(`unexpected outbound request: ${url}`);
    };
    const { createApiApp } = await import("./app.js");
    const { closeDb } = await import("../db/client.js");
    const app = createApiApp(resolveApiConfig());
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    shutdownApp = async () => {
      await new Promise<void>(resolve => server.close(() => resolve()));
      await closeDb();
    };
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const request = (path: string, body?: unknown, token?: string) => originalFetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const signIn = async (subject: string, address: string) => {
      const completed = await request("/identity/auth/google/complete", { accessToken: mint(subject, "oauth", address) });
      assert.equal(completed.status, 200);
      return (await completed.json()).session.accessToken as string;
    };
    assert.equal((await request("/movement/verify", {})).status, 401);
    assert.equal((await request("/identity/me")).status, 401);
    // Email codes are not part of this deployment.
    assert.equal((await request("/identity/auth/email/begin", { email: "runner@example.com" })).status, 404);
    assert.equal((await request("/identity/auth/email/complete", { email: "runner@example.com", code: "123456" })).status, 404);
    const email = "runner@example.com";
    const subject = randomUUID();
    const token = await signIn(subject, email);
    assert.equal((await request("/identity/me", undefined, token)).status, 200);
    // A token not signed by the project's key gets nothing.
    const forged = mint(subject, "oauth", email).replace(/\.[^.]+$/, ".AAAA");
    assert.equal((await request("/identity/auth/google/complete", { accessToken: forged })).status, 401);
    // A Google token is exchanged once. Replaying it, even several at once,
    // gets nothing, so a copied token cannot mint more sessions.
    const copied = mint(subject, "oauth", email);
    const replays = await Promise.all(Array.from({ length: 4 }, () => request("/identity/auth/google/complete", { accessToken: copied })));
    assert.deepEqual(replays.map(r => r.status).sort(), [200, 401, 401, 401]);
    assert.equal((await request("/identity/auth/google/complete", { accessToken: copied })).status, 401);
    // Once per Supabase session: a refreshed token (same session id and
    // sign-in time, new expiry) is refused too, and so is a sign-in older than
    // the ten-minute window or a token without a session id.
    const refreshedSession = randomUUID();
    const signedIn = Math.floor(Date.now() / 1000) - 120;
    assert.equal((await request("/identity/auth/google/complete", { accessToken: mint(subject, "oauth", email, { id: refreshedSession, signedInAt: signedIn }) })).status, 200);
    assert.equal((await request("/identity/auth/google/complete", { accessToken: mint(subject, "oauth", email, { id: refreshedSession, signedInAt: signedIn }) })).status, 401);
    assert.equal((await request("/identity/auth/google/complete", { accessToken: mint(subject, "oauth", email, { signedInAt: Math.floor(Date.now() / 1000) - 11 * 60 }) })).status, 401);
    assert.equal((await request("/identity/auth/google/complete", { accessToken: mint(subject, "oauth", email, { id: null }) })).status, 401);
    // A refresh entry newer than the Google sign-in never restarts the window:
    // a session signed in 11 minutes ago is refused even when its token says
    // it was refreshed just now (and a refresh within the window is fine).
    const nowS = Math.floor(Date.now() / 1000);
    assert.equal((await request("/identity/auth/google/complete", { accessToken: mint(subject, "oauth", email, { signedInAt: nowS - 11 * 60, refreshedAt: nowS }) })).status, 401);
    assert.equal((await request("/identity/auth/google/complete", { accessToken: mint(subject, "oauth", email, { signedInAt: nowS - 60, refreshedAt: nowS }) })).status, 200);
    const kept = await pool.query("select session_id, expires_at > now() + interval '29 days' as kept from google_sign_in_exchanges where session_id = $1", [refreshedSession]);
    assert.deepEqual(kept.rows, [{ session_id: refreshedSession, kept: true }]);
    // Twenty-five new players at once each get their session.
    const crowd = await Promise.all(Array.from({ length: 25 }, () => request("/identity/auth/google/complete", { accessToken: mint(randomUUID(), "oauth", null) })));
    assert.deepEqual(crowd.map(r => r.status), Array(25).fill(200));
    // Spent records are removed in bounded batches by later exchanges.
    await pool.query("insert into google_sign_in_exchanges (session_id, expires_at) select 'old-' || g, now() - interval '1 hour' from generate_series(1, 520) g");
    assert.equal((await request("/identity/auth/google/complete", { accessToken: mint(subject, "oauth", email) })).status, 200);
    assert.equal((await pool.query("select count(*)::int as count from google_sign_in_exchanges where session_id like 'old-%'")).rows[0].count, 20);
    assert.equal((await request("/identity/auth/google/complete", { accessToken: mint(subject, "oauth", email) })).status, 200);
    assert.equal((await pool.query("select count(*)::int as count from google_sign_in_exchanges where session_id like 'old-%'")).rows[0].count, 0);
    assert.equal((await pool.query("select count(*)::int as count from google_sign_in_exchanges where session_id = $1", [refreshedSession])).rows[0].count, 1);
    // The same Google user is the same player.
    const again = await (await request("/identity/me", undefined, await signIn(subject, email))).json();
    assert.equal(again.user.id, (await (await request("/identity/me", undefined, token)).json()).user.id);
    const start = Date.now() - 180000;
    const movement = {
      sessionId: "preview-runtime-test", startTime: start, endTime: start + 120000,
      points: Array.from({ length: 121 }, (_, i) => ({ lat: 12.9716 + i * 0.000016, lng: 77.5946, accuracy: 5, timestamp: start + i * 1000 })),
    };
    const verified = await request("/movement/verify", movement, token);
    assert.equal(verified.status, 201);
    assert.equal((await verified.json()).status, "verified");
    assert.equal((await request("/movement/verify", movement, token)).status, 200);
    const rows = await pool.query("select * from movement_verifications where client_session_id = $1", [movement.sessionId]);
    assert.equal(rows.rowCount, 1);
    assert.ok(!JSON.stringify(rows.rows).includes("12.9716"));
    assert.ok(!("points" in rows.rows[0]));
    // Account deletion: a second, independent account must be untouched when
    // the first is erased, and the erased email can start over from nothing.
    // The second account signs in with a wallet: message from the API, signed
    // by a real key, checked by the API and passed to the provider.
    const wallet = Wallet.createRandom();
    const walletBegin = await (await request("/identity/auth/wallet/begin", { address: wallet.address })).json();
    const walletSignature = await wallet.signMessage(walletBegin.message);
    const walletDone = await request("/identity/auth/wallet/complete", { message: walletBegin.message, signature: walletSignature });
    assert.equal(walletDone.status, 200);
    const otherToken = (await walletDone.json()).session.accessToken as string;
    // Replaying the same signed message is refused by the database's single-use check.
    assert.equal((await request("/identity/auth/wallet/complete", { message: walletBegin.message, signature: walletSignature })).status, 401);
    // The same wallet from the app: signed in the wallet's browser, collected by the app with its PKCE verifier.
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const handoffBegin = await (await request("/identity/auth/wallet/begin", { address: wallet.address })).json();
    const handoffDone = await (await request("/identity/auth/wallet/complete", {
      message: handoffBegin.message, signature: await wallet.signMessage(handoffBegin.message), handoffChallenge: challenge,
    })).json();
    assert.equal(handoffDone.session, undefined);
    assert.equal((await request("/identity/auth/wallet/exchange", { code: handoffDone.handoff.code, codeVerifier: randomBytes(32).toString("base64url") })).status, 401);
    const collected = await request("/identity/auth/wallet/exchange", { code: handoffDone.handoff.code, codeVerifier: verifier });
    assert.equal(collected.status, 200);
    const collectedMe = await (await request("/identity/me", undefined, (await collected.json()).session.accessToken)).json();
    assert.equal(collectedMe.user.id, (await (await request("/identity/me", undefined, otherToken)).json()).user.id);
    assert.equal((await request("/identity/auth/wallet/exchange", { code: handoffDone.handoff.code, codeVerifier: verifier })).status, 401);
    const otherMovement = { ...movement, sessionId: "preview-runtime-test-other" };
    assert.equal((await request("/movement/verify", otherMovement, otherToken)).status, 201);
    const me = await (await request("/identity/me", undefined, token)).json();
    const userId = me.user.id as string;
    assert.ok(userId);

    assert.equal((await request("/identity/account/delete", {})).status, 401);
    assert.equal((await request("/identity/account/delete", {}, token)).status, 400);
    assert.equal((await request("/identity/account/delete", { confirm: "delete" }, token)).status, 400);
    const deleted = await request("/identity/account/delete", { confirm: "DELETE" }, token);
    assert.equal(deleted.status, 200);
    const deletedBody = await deleted.json();
    assert.equal(deletedBody.deleted, true);
    assert.equal(deletedBody.erased.users, 1);
    assert.equal(deletedBody.erased.movementSessions, 1);
    assert.ok(!JSON.stringify(deletedBody).includes(email));
    assert.ok(!JSON.stringify(deletedBody).includes(userId));

    // The deleted account's token is dead everywhere.
    assert.equal((await request("/identity/me", undefined, token)).status, 401);
    assert.equal((await request("/movement/verify", movement, token)).status, 401);
    assert.equal((await request("/identity/account/delete", { confirm: "DELETE" }, token)).status, 401);

    // Nothing that identifies the account remains in any table.
    for (const [table, column] of [
      ["users", "id"], ["auth_identities", "user_id"], ["auth_sessions", "user_id"], ["wallets", "user_id"],
      ["wallet_link_challenges", "user_id"], ["security_audit_events", "user_id"], ["movement_verifications", "user_id"],
    ] as const) {
      const left = await pool.query(`select count(*)::int as count from ${table} where ${column} = $1`, [userId]);
      assert.equal(left.rows[0].count, 0, `${table} still holds the deleted account`);
    }
    for (const table of ["auth_identities", "email_otp_challenges"]) {
      const dump = JSON.stringify((await pool.query(`select * from ${table}`)).rows);
      assert.ok(!dump.includes(email), `${table} still holds the deleted email`);
      assert.ok(!dump.includes(subject), `${table} still holds the deleted provider user`);
    }
    // The provider's user went too, and nothing is left queued.
    assert.equal(deletedBody.signInRecord, "removed");
    assert.deepEqual(deletedProviderUsers, [subject]);
    assert.equal((await pool.query("select count(*)::int as count from pending_auth_user_deletions")).rows[0].count, 0);
    const deletionEvents = await pool.query("select user_id, subject_id, metadata from security_audit_events where event_type = 'account_deleted'");
    assert.equal(deletionEvents.rowCount, 1);
    assert.deepEqual(deletionEvents.rows[0], { user_id: null, subject_id: null, metadata: null });

    // The other account is intact and still signed in.
    assert.equal((await request("/identity/me", undefined, otherToken)).status, 200);
    const otherRows = await pool.query("select count(*)::int as count from movement_verifications where client_session_id = $1", [otherMovement.sessionId]);
    assert.equal(otherRows.rows[0].count, 1);
    const history = await (await request("/movement/verifications", undefined, otherToken)).json();
    assert.deepEqual(history.verifications.map((v: { sessionId: string }) => v.sessionId), [otherMovement.sessionId]);

    // The same person can sign up again and starts with a brand new account.
    const freshToken = await signIn(subject, email);
    const fresh = await (await request("/identity/me", undefined, freshToken)).json();
    assert.notEqual(fresh.user.id, userId);
    const freshRows = await pool.query("select count(*)::int as count from movement_verifications where user_id = $1", [fresh.user.id]);
    assert.equal(freshRows.rows[0].count, 0);

    // Account cap, enforced by PostgreSQL: with one place left, eight
    // simultaneous new players produce exactly one new account.
    const before = (await pool.query("select count(*)::int as count from users")).rows[0].count as number;
    await pool.query("update account_capacity set max_accounts = $1", [before + 1]);
    const rushTokens = Array.from({ length: 8 }, () => mint(randomUUID(), "oauth", null));
    const rush = await Promise.all(rushTokens.map(accessToken => request("/identity/auth/google/complete", { accessToken })));
    assert.deepEqual(rush.map(r => r.status).sort(), [200, 403, 403, 403, 403, 403, 403, 403]);
    // A refused sign-in is spent: its provider user is being removed.
    const refusedToken = rushTokens[rush.findIndex(r => r.status === 403)];
    assert.equal((await request("/identity/auth/google/complete", { accessToken: refusedToken })).status, 401);
    assert.equal((await pool.query("select count(*)::int as count from users")).rows[0].count, before + 1);
    // The seven refused provider users were removed again.
    assert.equal(deletedProviderUsers.length, 1 + 7);
    // Existing players still get in when full.
    assert.equal((await request("/identity/auth/google/complete", { accessToken: mint(subject, "oauth", email) })).status, 200);
    // The Supabase "before user created" hook reads the same cap.
    const hookFull = await pool.query("select public.movenrun_before_user_created('{}'::jsonb) as r");
    assert.equal(hookFull.rows[0].r.error.http_code, 403);
    await pool.query("update account_capacity set max_accounts = 1000");
    const hookOpen = await pool.query("select public.movenrun_before_user_created('{}'::jsonb) as r");
    assert.deepEqual(hookOpen.rows[0].r, {});
    // The hook's hourly quota (0009): it records each user it lets through and
    // refuses with 429 once the hour's quota is used, whoever called the provider.
    assert.equal((await pool.query("select count(*)::int as count from auth_user_creations")).rows[0].count, 1);
    await pool.query("update account_capacity set max_new_per_hour = 1");
    const hookBusy = await pool.query("select public.movenrun_before_user_created('{}'::jsonb) as r");
    assert.equal(hookBusy.rows[0].r.error.http_code, 429);
    // The API applies the same hourly quota to new players, on real Postgres.
    const recentPlayers = (await pool.query("select count(*)::int as count from users where created_at > now() - interval '1 hour'")).rows[0].count as number;
    await pool.query("update account_capacity set max_new_per_hour = $1", [recentPlayers]);
    const busyUser = randomUUID();
    const busy = await request("/identity/auth/google/complete", { accessToken: mint(busyUser, "oauth", null) });
    assert.equal(busy.status, 429);
    assert.equal((await busy.json()).error.code, "registration_busy");
    assert.ok(deletedProviderUsers.includes(busyUser));
    assert.equal((await request("/identity/auth/google/complete", { accessToken: mint(subject, "oauth", email) })).status, 200);
    await pool.query("update account_capacity set max_new_per_hour = 50");

    // Clean-up does not wait for a timer: the first requests after start
    // (a wake from sleep on the free host) already ran the orphan sweep,
    // which listed provider users once and only once while it was due.
    assert.equal(adminListings, 1);
    const pruneLeft = await pool.query("select id from auth_sessions where user_id = 'prune-check' order by id");
    assert.deepEqual(pruneLeft.rows.map(r => r.id), ["prune-live"]);
    await pool.query("alter table auth_identities rename column provider_subject to unavailable_provider_subject");
    assert.equal((await request("/ready")).status, 503);
  } finally {
    child?.kill();
    await shutdownApp?.();
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
    await pool.end();
    // The name is generated above and only this disposable database is removed.
    if (!/^preview_test_[a-f0-9]{32}$/.test(databaseName)) throw new Error("Unexpected test database name");
    // pg's pool.end() resolves before its sockets finish closing; wait for the
    // server to see them gone so the forced drop never kills a closing client.
    for (let i = 0; i < 100; i++) {
      const open = await admin.query("select count(*)::int as count from pg_stat_activity where datname = $1", [databaseName]);
      if (open.rows[0].count === 0) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }
});
