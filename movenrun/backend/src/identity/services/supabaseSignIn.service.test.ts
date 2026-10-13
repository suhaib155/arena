import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Wallet } from "ethers";
import { createInMemoryStores } from "../repositories/memory.js";
import { createInMemorySignInStores } from "../repositories/signInStores.js";
import { EoaSignatureVerifier } from "../providers/eoaVerifier.js";
import { SupabaseAuthError, type VerifiedSupabaseUser } from "../providers/supabaseAuth.js";
import { createHash, randomBytes } from "node:crypto";
import { SupabaseSignInService, WALLET_HANDOFF_TTL_MS, WALLET_MESSAGE_TTL_MS } from "./supabaseSignIn.service.js";
import { resolveIdentityConfig } from "../config.js";
import { createIdentityServices } from "../http/wiring.js";
import { createIdentityRouter } from "../http/router.js";
import { isIdentityError } from "../domain/errors.js";

const T0 = new Date("2026-10-13T12:00:00Z");
const GOOGLE_SUB = "11111111-1111-4111-8111-111111111111";

/** Fake Supabase: wallet grants map an address to a stable user id; tokens are opaque strings. */
function fakeSupabase(opts: { refuseWeb3?: boolean; refuseStatus?: number; failDelete?: boolean } = {}) {
  const usersByAddress = new Map<string, string>();
  /** Every auth user the fake knows, for the admin listing. */
  const listed: Array<{ id: string; createdAt: Date; lastSignInAt: Date | null }> = [];
  const tokens = new Map<string, VerifiedSupabaseUser>();
  const deleted: string[] = [];
  const grants: string[] = [];
  const listCalls = { n: 0 };
  const listGate: { wait: Promise<void> | null } = { wait: null };
  let n = 0;
  const mint = (subject: string, methods: string[], email: string | null, providers: string[] = []) => {
    const t = `token-${n++}-${"x".repeat(30)}`;
    tokens.set(t, { subject, methods, email, providers, expiresAt: new Date(T0.getTime() + 3600_000) });
    return t;
  };
  return {
    deleted,
    grants,
    listed,
    listCalls,
    listGate,
    googleToken: (subject = GOOGLE_SUB, email: string | null = "runner@example.com", providers = ["google"]) => mint(subject, ["oauth"], email, providers),
    web3Token: (subject: string) => mint(subject, ["web3"], null),
    tokens: {
      async verify(token: string) {
        const user = tokens.get(token);
        if (!user) throw new SupabaseAuthError("bad_signature");
        return user;
      },
    },
    auth: {
      async signInWithEthereum(message: string, _signature: string) {
        grants.push(message);
        if (opts.refuseWeb3) throw new SupabaseAuthError("rejected", opts.refuseStatus ?? 400);
        const address = message.split("\n")[1].toLowerCase();
        if (!usersByAddress.has(address)) {
          const hex = (usersByAddress.size + 2).toString(16).padStart(12, "0");
          usersByAddress.set(address, `22222222-2222-4222-8222-${hex}`);
        }
        return { accessToken: mint(usersByAddress.get(address)!, ["web3"], null) };
      },
      async deleteUser(subject: string) {
        if (opts.failDelete) throw new SupabaseAuthError("unavailable");
        deleted.push(subject);
        const at = listed.findIndex((u) => u.id === subject);
        if (at >= 0) listed.splice(at, 1);
      },
      async listUsers(page: number, perPage: number) {
        listCalls.n += 1;
        await listGate.wait;
        return listed.slice((page - 1) * perPage, page * perPage);
      },
      async getUser(subject: string) {
        return listed.find((u) => u.id === subject) ?? null;
      },
    },
  };
}

function setup(opts: { maxAccounts?: number; maxNewPerHour?: number; refuseWeb3?: boolean; refuseStatus?: number; failDelete?: boolean } = {}) {
  let clock = T0;
  const now = () => clock;
  const stores = createInMemoryStores(now, { maxAccounts: opts.maxAccounts, maxNewPerHour: opts.maxNewPerHour });
  const signIn = createInMemorySignInStores();
  const supabase = fakeSupabase(opts);
  const service = new SupabaseSignInService({
    tokens: supabase.tokens,
    auth: supabase.auth,
    stores,
    signIn,
    eoaVerifier: new EoaSignatureVerifier(),
    config: { authDomain: "movenrun.xyz", chainId: 8453 },
    now,
  });
  return { service, stores, signIn, supabase, advance: (ms: number) => { clock = new Date(clock.getTime() + ms); } };
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (isIdentityError(err)) return err.code;
    throw err;
  }
  return "ok";
}

test("the wallet message is EIP-4361, bound to MovenRun's domain, Base, a fresh nonce and five minutes", async () => {
  const { service } = setup();
  const wallet = Wallet.createRandom();
  const { message, expiresAt } = await service.beginWallet(wallet.address.toLowerCase());
  const lines = message.split("\n");
  assert.equal(lines[0], "movenrun.xyz wants you to sign in with your Ethereum account:");
  assert.equal(lines[1], wallet.address); // checksummed
  assert.match(message, /it is not a transaction and costs nothing/);
  assert.match(message, /\nURI: https:\/\/movenrun\.xyz\/sign-in\/\nVersion: 1\nChain ID: 8453\nNonce: [0-9a-f]{24}\n/);
  assert.match(message, /\nIssued At: 2026-10-13T12:00:00.000Z\nExpiration Time: 2026-10-13T12:05:00.000Z$/);
  assert.equal(expiresAt.getTime() - T0.getTime(), WALLET_MESSAGE_TTL_MS);
  const again = await service.beginWallet(wallet.address);
  assert.notEqual(again.message, message);
  assert.equal(await code(service.beginWallet("0x123")), "invalid_request");
  assert.equal(await code(service.beginWallet("0x52908400098527886E0F7030069857D2E4169EE7".replace("E7", "e7"))), "invalid_request"); // bad checksum
});

test("a correctly signed message signs in, once; replay, tampering, other signers and expiry are refused", async () => {
  const { service, supabase, advance } = setup();
  const wallet = Wallet.createRandom();
  const { message } = await service.beginWallet(wallet.address);
  const signature = await wallet.signMessage(message);

  const first = await service.completeWallet(message, signature);
  assert.equal(first.method, "wallet");
  assert.equal(first.email, null);
  assert.equal(await code(service.completeWallet(message, signature)), "challenge_consumed");

  const second = await service.beginWallet(wallet.address);
  assert.equal(await code(service.completeWallet(second.message.replace("8453", "1"), await wallet.signMessage(second.message.replace("8453", "1")))), "verification_failed");
  assert.equal(await code(service.completeWallet(second.message.replace("movenrun.xyz", "evil.example"), await wallet.signMessage(second.message))), "verification_failed");
  const intruder = Wallet.createRandom();
  assert.equal(await code(service.completeWallet(second.message, await intruder.signMessage(second.message))), "verification_failed");
  // The intruder's attempt used up the nonce: the real signature no longer works either.
  assert.equal(await code(service.completeWallet(second.message, await wallet.signMessage(second.message))), "challenge_consumed");

  const third = await service.beginWallet(wallet.address);
  advance(WALLET_MESSAGE_TTL_MS + 1);
  assert.equal(await code(service.completeWallet(third.message, await wallet.signMessage(third.message))), "challenge_expired");
  assert.equal(await code(service.completeWallet("no nonce here".repeat(5), "0x" + "a".repeat(130))), "verification_failed");
  assert.equal(await code(service.completeWallet(third.message, "0x1234")), "verification_failed");
  // Only the one good signature ever reached Supabase.
  assert.equal(supabase.grants.length, 1);
});

test("the same wallet always reaches the same Supabase user; a refused grant is a failed sign-in", async () => {
  const { service } = setup();
  const wallet = Wallet.createRandom();
  const subjects = [];
  for (let i = 0; i < 2; i++) {
    const { message } = await service.beginWallet(wallet.address);
    subjects.push((await service.completeWallet(message, await wallet.signMessage(message))).subject);
  }
  assert.equal(subjects[0], subjects[1]);

  const refused = setup({ refuseWeb3: true });
  const { message } = await refused.service.beginWallet(wallet.address);
  assert.equal(await code(refused.service.completeWallet(message, await wallet.signMessage(message))), "verification_failed");

  // The provider's hook refusals keep their meaning: 403 is the account cap,
  // 429 the hourly new-account quota or the provider's own rate limit.
  for (const [refuseStatus, expected] of [[403, "registration_closed"], [429, "too_many_attempts"]] as const) {
    const h = setup({ refuseWeb3: true, refuseStatus });
    const m = (await h.service.beginWallet(wallet.address)).message;
    assert.equal(await code(h.service.completeWallet(m, await wallet.signMessage(m))), expected);
  }
});

test("Google sign-in accepts only a verified OAuth session", async () => {
  const { service, supabase } = setup();
  const ok = await service.verifyGoogle(supabase.googleToken());
  assert.deepEqual(ok, { subject: GOOGLE_SUB, email: "runner@example.com", method: "google" });
  assert.equal(await code(service.verifyGoogle("forged")), "verification_failed");
  // An OAuth session from any provider other than Google is refused.
  assert.equal(await code(service.verifyGoogle(supabase.googleToken(GOOGLE_SUB, null, ["github"]))), "verification_failed");
  // A wallet session must come through the wallet routes, where the nonce is checked.
  assert.equal(await code(service.verifyGoogle(supabase.web3Token("33333333-3333-4333-8333-333333333333"))), "verification_failed");
});

test("provider users are removed only when no MovenRun account uses them, and failures are retried", async () => {
  const flaky = setup({ failDelete: true });
  const result = await flaky.service.removeProviderUsers([GOOGLE_SUB]);
  assert.deepEqual(result, { removed: [], pending: [GOOGLE_SUB] });
  assert.deepEqual(await flaky.signIn.pendingAuthDeletions.due(T0, 0, 10), [GOOGLE_SUB]);

  const { service, stores, supabase, signIn } = setup();
  await stores.createUserWithIdentity({
    userId: "u1",
    identity: { id: "i1", provider: "supabase", providerSubject: GOOGLE_SUB, assuranceLevel: "aal2" },
  });
  assert.deepEqual(await service.removeProviderUsers([GOOGLE_SUB]), { removed: [], pending: [] });
  assert.deepEqual(supabase.deleted, []);
  await signIn.pendingAuthDeletions.add(["44444444-4444-4444-8444-444444444444"]);
  assert.equal(await service.retryPendingDeletions(), 1);
  assert.deepEqual(supabase.deleted, ["44444444-4444-4444-8444-444444444444"]);
});

// ---- HTTP: one account per Supabase user, the account cap, deletion --------

async function withApp(maxAccounts: number, fn: (h: ReturnType<typeof setup> & { post: (path: string, body: unknown, token?: string) => Promise<{ status: number; json: any }> }) => Promise<void>, opts: { maxNewPerHour?: number } = {}) {
  const h = setup({ maxAccounts, maxNewPerHour: opts.maxNewPerHour });
  const cfg = resolveIdentityConfig({ NODE_ENV: "test", IDENTITY_SESSION_PEPPER: "x".repeat(32) }, { requireSecrets: false });
  assert.ok(cfg.ok);
  const services = createIdentityServices(h.stores, cfg.config);
  const erasedUsers: string[] = [];
  const app = express();
  app.use(express.json());
  app.use("/identity", createIdentityRouter(services, {
    supabaseSignIn: h.service,
    accountDeletion: {
      async erase(userId) {
        erasedUsers.push(userId);
        const identities = await h.stores.identities.listActiveByUser(userId);
        for (const i of identities) await h.stores.identities.revoke(i.id, new Date());
        return { users: 1, identities: identities.length, sessions: 0, otpChallenges: 0, wallets: 0, walletChallenges: 0, auditEvents: 0, movementSessions: 0, providerSubjects: identities.map((i) => i.providerSubject) };
      },
    },
  }));
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (path: string, body: unknown, token?: string) => {
    const res = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  try {
    await fn({ ...h, post });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("Google sign-in over HTTP returns a MovenRun session and the same player every time", async () => {
  await withApp(1000, async ({ post, supabase }) => {
    const a = await post("/identity/auth/google/complete", { accessToken: supabase.googleToken(), deviceLabel: "Android device" });
    assert.equal(a.status, 200);
    assert.ok(a.json.session.accessToken && a.json.session.refreshToken);
    assert.equal(a.json.embeddedWallet, null); // no wallet row is created in v1
    const b = await post("/identity/auth/google/complete", { accessToken: supabase.googleToken() });
    assert.equal(b.json.user.id, a.json.user.id);
    const other = await post("/identity/auth/google/complete", { accessToken: supabase.googleToken("55555555-5555-4555-8555-555555555555", "runner@example.com") });
    // Same email, different Google account → a different player. Never merged by email.
    assert.notEqual(other.json.user.id, a.json.user.id);
    assert.equal((await post("/identity/auth/google/complete", { accessToken: "y".repeat(40) })).status, 401);
    // Email codes are off unless explicitly enabled.
    assert.equal((await post("/identity/auth/email/begin", { email: "runner@example.com" })).status, 404);
  });
});

test("wallet sign-in over HTTP: begin, sign, complete", async () => {
  await withApp(1000, async ({ post }) => {
    const wallet = Wallet.createRandom();
    const begin = await post("/identity/auth/wallet/begin", { address: wallet.address });
    assert.equal(begin.status, 200);
    const done = await post("/identity/auth/wallet/complete", { message: begin.json.message, signature: await wallet.signMessage(begin.json.message) });
    assert.equal(done.status, 200);
    assert.ok(done.json.session.accessToken);
    const replay = await post("/identity/auth/wallet/complete", { message: begin.json.message, signature: await wallet.signMessage(begin.json.message) });
    assert.equal(replay.status, 401);
  });
});

const pkcePair = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

test("wallet sign-in started by the app: the wallet's browser gets a one-time code that only the app's verifier can spend", async () => {
  await withApp(1000, async ({ post }) => {
    const wallet = Wallet.createRandom();
    const pkce = pkcePair();
    const begin = await post("/identity/auth/wallet/begin", { address: wallet.address });
    const signature = await wallet.signMessage(begin.json.message);
    // A malformed challenge is refused before the message is spent.
    assert.equal((await post("/identity/auth/wallet/complete", { message: begin.json.message, signature, handoffChallenge: "!".repeat(43) })).status, 400);
    const done = await post("/identity/auth/wallet/complete", { message: begin.json.message, signature, handoffChallenge: pkce.challenge });
    assert.equal(done.status, 200);
    assert.equal(done.json.session, undefined); // no session in the wallet's browser
    assert.match(done.json.handoff.code, /^[A-Z2-9]{12}$/);

    const attacker = pkcePair();
    assert.equal((await post("/identity/auth/wallet/exchange", { code: done.json.handoff.code, codeVerifier: attacker.verifier })).status, 401);
    // Typed by hand: lower case and spaces are tolerated.
    const typed = done.json.handoff.code.toLowerCase().replace(/(....)/g, "$1 ").trim();
    const app = await post("/identity/auth/wallet/exchange", { code: typed, codeVerifier: pkce.verifier, deviceLabel: "Android device" });
    assert.equal(app.status, 200);
    assert.ok(app.json.session.accessToken);
    assert.equal((await post("/identity/auth/wallet/exchange", { code: done.json.handoff.code, codeVerifier: pkce.verifier })).status, 401);

    // The same wallet signed in directly is the same player.
    const again = await post("/identity/auth/wallet/begin", { address: wallet.address });
    const direct = await post("/identity/auth/wallet/complete", { message: again.json.message, signature: await wallet.signMessage(again.json.message) });
    assert.equal(direct.json.user.id, app.json.user.id);
  });
});

test("an uncollected handoff code expires and releases its provider user, unless the wallet signed in another way", async () => {
  const { service, supabase, advance, stores } = setup();
  const lost = Wallet.createRandom();
  const b1 = await service.beginWallet(lost.address);
  const v1 = await service.completeWallet(b1.message, await lost.signMessage(b1.message));
  const p1 = pkcePair();
  const h1 = await service.createHandoff(v1, p1.challenge);
  assert.equal(h1.expiresAt.getTime() - T0.getTime(), WALLET_HANDOFF_TTL_MS);

  const retried = Wallet.createRandom();
  const b2 = await service.beginWallet(retried.address);
  const v2 = await service.completeWallet(b2.message, await retried.signMessage(b2.message));
  await service.createHandoff(v2, pkcePair().challenge); // abandoned
  advance(WALLET_HANDOFF_TTL_MS - 1000);
  const b3 = await service.beginWallet(retried.address);
  const v3 = await service.completeWallet(b3.message, await retried.signMessage(b3.message));
  const p3 = pkcePair();
  const h3 = await service.createHandoff(v3, p3.challenge); // the retry, still live
  advance(2000);

  assert.equal(await code(service.exchangeHandoff(h1.code, p1.verifier)), "verification_failed"); // expired
  assert.equal(await service.expireHandoffs(), 1);
  assert.deepEqual(supabase.deleted, [v1.subject]);
  assert.equal(await service.expireHandoffs(), 0);
  // The retried wallet's newer code still works.
  assert.equal((await service.exchangeHandoff(h3.code, p3.verifier)).subject, v3.subject);
  assert.equal(await code(service.createHandoff(v3, "short")), "invalid_request");
  assert.equal(await code(service.exchangeHandoff("0OIL0OIL0OIL", p3.verifier)), "verification_failed");
});

test("the account cap counts Google and wallet players together, lets existing players in, and frees a place on deletion", async () => {
  await withApp(2, async ({ post, supabase }) => {
    const google = await post("/identity/auth/google/complete", { accessToken: supabase.googleToken() });
    assert.equal(google.status, 200);
    const wallet = Wallet.createRandom();
    const begin = await post("/identity/auth/wallet/begin", { address: wallet.address });
    const walletDone = await post("/identity/auth/wallet/complete", { message: begin.json.message, signature: await wallet.signMessage(begin.json.message) });
    assert.equal(walletDone.status, 200);

    // Third new player: refused, and the provider user just created is removed again.
    const newcomer = "66666666-6666-4666-8666-666666666666";
    const full = await post("/identity/auth/google/complete", { accessToken: supabase.googleToken(newcomer) });
    assert.equal(full.status, 403);
    assert.equal(full.json.error.code, "registration_closed");
    assert.deepEqual(supabase.deleted, [newcomer]);

    // Existing players still sign in at capacity.
    assert.equal((await post("/identity/auth/google/complete", { accessToken: supabase.googleToken() })).status, 200);

    // Deleting an account removes its provider user and frees the place.
    const del = await post("/identity/account/delete", { confirm: "DELETE" }, google.json.session.accessToken);
    assert.equal(del.status, 200);
    assert.equal(del.json.signInRecord, "removed");
    assert.ok(!("providerSubjects" in del.json.erased));
    assert.deepEqual(supabase.deleted, [newcomer, GOOGLE_SUB]);
  });
});

test("concurrent first sign-ins at the last free place admit exactly one player", async () => {
  await withApp(1, async ({ post, supabase }) => {
    const tokens = Array.from({ length: 8 }, (_, i) => supabase.googleToken(`77777777-7777-4777-8777-00000000000${i}`));
    const results = await Promise.all(tokens.map((accessToken) => post("/identity/auth/google/complete", { accessToken })));
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    assert.equal(results.filter((r) => r.status === 403).length, 7);
  });
});

test("the orphan sweep removes only old provider users with no account, no recent sign-in and no waiting code", async () => {
  const { service, stores, signIn, supabase, advance } = setup();
  const id = (n: number) => `55555555-5555-4555-8555-${n.toString(16).padStart(12, "0")}`;
  const old = new Date(T0.getTime() - 2 * 3600_000);
  supabase.listed.push(
    { id: id(1), createdAt: old, lastSignInAt: old },                                  // abandoned: removed
    { id: id(2), createdAt: old, lastSignInAt: null },                                 // never signed in: removed
    { id: id(3), createdAt: old, lastSignInAt: new Date(T0.getTime() - 10 * 60_000) }, // signed in recently: kept
    { id: id(4), createdAt: new Date(T0.getTime() - 5 * 60_000), lastSignInAt: null }, // new: kept
    { id: id(5), createdAt: old, lastSignInAt: old },                                  // a MovenRun player: kept
    { id: id(6), createdAt: old, lastSignInAt: old },                                  // wallet code waiting: kept
  );
  await stores.createUserWithIdentity({
    userId: "u5", identity: { id: "i5", provider: "supabase", providerSubject: id(5), assuranceLevel: "aal2" },
  });
  await signIn.walletHandoffs.create({ codeHash: "h6", codeChallenge: "c".repeat(43), subject: id(6), expiresAt: new Date(T0.getTime() + 60_000) });
  // Small pages, to cover paging.
  assert.equal(await service.sweepOrphanProviderUsers({ perPage: 2 }), 2);
  assert.deepEqual(supabase.deleted.sort(), [id(1), id(2)]);
  // Later, once the recent ones age past the grace period, they go too; the player never does.
  advance(3 * 3600_000);
  await service.sweepOrphanProviderUsers({ perPage: 2 });
  assert.deepEqual(supabase.deleted.sort(), [id(1), id(2), id(3), id(4), id(6)]);
});

test("the orphan sweep re-reads each user before deleting: one who signed in since the listing is kept", async () => {
  const { service, supabase } = setup();
  const id = (n: number) => `55555555-5555-4555-8555-${n.toString(16).padStart(12, "0")}`;
  const old = new Date(T0.getTime() - 2 * 3600_000);
  supabase.listed.push({ id: id(1), createdAt: old, lastSignInAt: old }, { id: id(2), createdAt: old, lastSignInAt: old });
  // The listing is taken while both look abandoned...
  let release!: () => void;
  supabase.listGate.wait = new Promise<void>((r) => { release = r; });
  const run = service.sweepOrphanProviderUsers();
  await new Promise((r) => setImmediate(r));
  // ...then user 1 signs in before the delete; user 2 is deleted by someone else.
  supabase.listed[0] = { id: id(1), createdAt: old, lastSignInAt: T0 };
  supabase.listed.splice(1, 1);
  supabase.listGate.wait = null;
  release();
  assert.equal(await run, 0);
  assert.deepEqual(supabase.deleted, []);
});

test("one sweep deletes at most its cap, and a sweep started during another joins it", async () => {
  const { service, supabase } = setup();
  const id = (n: number) => `55555555-5555-4555-8555-${n.toString(16).padStart(12, "0")}`;
  const old = new Date(T0.getTime() - 2 * 3600_000);
  for (let i = 1; i <= 5; i++) supabase.listed.push({ id: id(i), createdAt: old, lastSignInAt: null });
  let release!: () => void;
  supabase.listGate.wait = new Promise<void>((r) => { release = r; });
  const first = service.sweepOrphanProviderUsers({ maxDeletes: 3 });
  const second = service.sweepOrphanProviderUsers({ maxDeletes: 3 });
  assert.equal(first, second);
  supabase.listGate.wait = null;
  release();
  assert.equal(await first, 3);
  assert.equal(supabase.listCalls.n, 1);
  assert.equal(supabase.deleted.length, 3);
  // The next run picks up the rest.
  assert.equal(await service.sweepOrphanProviderUsers({ maxDeletes: 3 }), 2);
  assert.equal(supabase.listed.length, 0);
});

test("a sweep that fails part-way lets the next one start, and a failed read keeps the user", async () => {
  const { service, supabase } = setup();
  const id = (n: number) => `55555555-5555-4555-8555-${n.toString(16).padStart(12, "0")}`;
  const old = new Date(T0.getTime() - 2 * 3600_000);
  supabase.listed.push({ id: id(1), createdAt: old, lastSignInAt: null });
  const getUser = supabase.auth.getUser;
  supabase.auth.getUser = async () => { throw new SupabaseAuthError("unavailable"); };
  await assert.rejects(service.sweepOrphanProviderUsers());
  assert.deepEqual(supabase.deleted, []);
  supabase.auth.getUser = getUser;
  assert.equal(await service.sweepOrphanProviderUsers(), 1);
});

test("the hourly new-account quota refuses a burst over HTTP, removes the refused provider user, and reopens an hour later", async () => {
  await withApp(1000, async ({ post, supabase, advance }) => {
    const sub = (n: number) => `66666666-6666-4666-8666-${n.toString(16).padStart(12, "0")}`;
    const google = (n: number) => post("/identity/auth/google/complete", { accessToken: supabase.googleToken(sub(n), null) });
    assert.equal((await google(1)).status, 200);
    assert.equal((await google(2)).status, 200);
    const busy = await google(3);
    assert.equal(busy.status, 429);
    assert.equal(busy.json.error.code, "registration_busy");
    assert.deepEqual(supabase.deleted, [sub(3)]);
    // Existing players are unaffected by the quota.
    assert.equal((await google(1)).status, 200);
    advance(61 * 60_000);
    assert.equal((await google(3)).status, 200);
  }, { maxNewPerHour: 2 });
});
