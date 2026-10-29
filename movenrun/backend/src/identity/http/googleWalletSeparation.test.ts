/**
 * Google acceptance: Google and wallet accounts stay separate, and deleting
 * one never touches the other.
 *
 * Local stand-ins only: an in-memory store and a fake Supabase. One person
 * signs in with a Google account and with a wallet. The rule (D-17, manual
 * linking off) is that these are two MovenRun players that nothing merges,
 * not by email, not by sign-in order and not by deletion.
 */
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
import { SupabaseSignInService } from "../services/supabaseSignIn.service.js";
import { resolveIdentityConfig } from "../config.js";
import { createIdentityServices } from "./wiring.js";
import { createIdentityRouter } from "./router.js";

const T0 = new Date("2026-10-29T12:00:00Z");
const GOOGLE_SUB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SAME_EMAIL = "runner@example.com";

type Json = { status: number; json: any };

async function withApp(fn: (h: {
  post: (path: string, body: unknown, token?: string) => Promise<Json>;
  get: (path: string, token: string) => Promise<Json>;
  googleToken: (sub?: string) => string;
  deleted: string[];
  walletSignIn: (wallet: { address: string; signMessage(m: string): Promise<string> }) => Promise<Json>;
}) => Promise<void>) {
  const clock = T0;
  const now = () => clock;
  const stores = createInMemoryStores(now);
  const tokens = new Map<string, VerifiedSupabaseUser>();
  const walletUsers = new Map<string, string>();
  const deleted: string[] = [];
  let n = 0;
  const mint = (subject: string, methods: string[], email: string | null, providers: string[]) => {
    const t = `token-${n++}-${"x".repeat(30)}`;
    tokens.set(t, { subject, methods, email, providers, sessionId: `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, "0")}`, oauthSignedInAt: now(), expiresAt: new Date(now().getTime() + 3600_000) });
    return t;
  };
  const service = new SupabaseSignInService({
    tokens: { async verify(t: string) { const u = tokens.get(t); if (!u) throw new SupabaseAuthError("bad_signature"); return u; } },
    auth: {
      async signInWithEthereum(message: string) {
        const address = message.split("\n")[1].toLowerCase();
        if (!walletUsers.has(address)) walletUsers.set(address, `cccccccc-cccc-4ccc-8ccc-${String(walletUsers.size + 1).padStart(12, "0")}`);
        return { accessToken: mint(walletUsers.get(address)!, ["web3"], null, []) };
      },
      async deleteUser(subject: string) { deleted.push(subject); },
      async listUsers() { return []; },
      async getUser() { return null; },
    },
    stores,
    signIn: createInMemorySignInStores(),
    eoaVerifier: new EoaSignatureVerifier(),
    config: { authDomain: "movenrun.xyz", chainId: 8453 },
    now,
  });
  const cfg = resolveIdentityConfig({ NODE_ENV: "test", IDENTITY_SESSION_PEPPER: "x".repeat(32) }, { requireSecrets: false });
  assert.ok(cfg.ok);
  const app = express();
  app.use(express.json());
  app.use("/identity", createIdentityRouter(createIdentityServices(stores, cfg.config), {
    supabaseSignIn: service,
    accountDeletion: {
      async erase(userId) {
        const identities = await stores.identities.listActiveByUser(userId);
        for (const i of identities) await stores.identities.revoke(i.id, new Date());
        return { users: 1, identities: identities.length, sessions: 0, otpChallenges: 0, wallets: 0, walletChallenges: 0, auditEvents: 0, movementSessions: 0, providerSubjects: identities.map((i) => i.providerSubject) };
      },
    },
  }));
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown, token?: string): Promise<Json> => {
    const res = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const post = (path: string, body: unknown, token?: string) => call("POST", path, body, token);
  const get = (path: string, token: string) => call("GET", path, undefined, token);
  const walletSignIn = async (wallet: { address: string; signMessage(m: string): Promise<string> }) => {
    const begin = await post("/identity/auth/wallet/begin", { address: wallet.address });
    assert.equal(begin.status, 200);
    return post("/identity/auth/wallet/complete", { message: begin.json.message, signature: await wallet.signMessage(begin.json.message) });
  };
  try {
    await fn({ post, get, googleToken: (sub = GOOGLE_SUB) => mint(sub, ["oauth"], SAME_EMAIL, ["google"]), deleted, walletSignIn, });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("one person's Google account and wallet are two players, each stable across sign-ins", async () => {
  await withApp(async ({ post, get, googleToken, walletSignIn }) => {
    const wallet = Wallet.createRandom();
    const g1 = await post("/identity/auth/google/complete", { accessToken: googleToken() });
    const w1 = await walletSignIn(wallet);
    assert.equal(g1.status, 200);
    assert.equal(w1.status, 200);
    assert.notEqual(g1.json.user.id, w1.json.user.id, "Google and wallet are never merged");

    // Signing in again, in either order, returns the same two players and creates no third.
    const w2 = await walletSignIn(wallet);
    const g2 = await post("/identity/auth/google/complete", { accessToken: googleToken() });
    assert.equal(g2.json.user.id, g1.json.user.id);
    assert.equal(w2.json.user.id, w1.json.user.id);

    // Each session sees only its own player.
    assert.equal((await get("/identity/me", g2.json.session.accessToken)).json.user.id, g1.json.user.id);
    assert.equal((await get("/identity/me", w2.json.session.accessToken)).json.user.id, w1.json.user.id);

    // A second Google account with the same email is a third player: email never links accounts.
    const other = await post("/identity/auth/google/complete", { accessToken: googleToken("dddddddd-dddd-4ddd-8ddd-dddddddddddd") });
    assert.equal(new Set([g1.json.user.id, w1.json.user.id, other.json.user.id]).size, 3);
  });
});

test("deleting the Google account leaves the wallet account working, and signing in again makes a new player", async () => {
  await withApp(async ({ post, get, googleToken, walletSignIn, deleted }) => {
    const wallet = Wallet.createRandom();
    const g = await post("/identity/auth/google/complete", { accessToken: googleToken() });
    const w = await walletSignIn(wallet);

    const del = await post("/identity/account/delete", { confirm: "DELETE" }, g.json.session.accessToken);
    assert.equal(del.status, 200);
    assert.equal(del.json.signInRecord, "removed");
    assert.deepEqual(deleted, [GOOGLE_SUB], "only the Google sign-in record was removed at the provider");

    // The wallet player is untouched.
    const still = await get("/identity/me", w.json.session.accessToken);
    assert.equal(still.status, 200);
    assert.equal(still.json.user.id, w.json.user.id);
    assert.equal((await walletSignIn(wallet)).json.user.id, w.json.user.id);

    // The same Google account coming back is a new player, never the erased one.
    const back = await post("/identity/auth/google/complete", { accessToken: googleToken() });
    assert.equal(back.status, 200);
    assert.notEqual(back.json.user.id, g.json.user.id);
    assert.notEqual(back.json.user.id, w.json.user.id);
  });
});

test("deleting the wallet account leaves the Google account working", async () => {
  await withApp(async ({ post, get, googleToken, walletSignIn, deleted }) => {
    const wallet = Wallet.createRandom();
    const g = await post("/identity/auth/google/complete", { accessToken: googleToken() });
    const w = await walletSignIn(wallet);
    const del = await post("/identity/account/delete", { confirm: "DELETE" }, w.json.session.accessToken);
    assert.equal(del.status, 200);
    assert.equal(deleted.length, 1);
    assert.notEqual(deleted[0], GOOGLE_SUB);
    const still = await get("/identity/me", g.json.session.accessToken);
    assert.equal(still.status, 200);
    assert.equal(still.json.user.id, g.json.user.id);
  });
});
