/**
 * WalletLinkService — the full external-wallet linking matrix. EOA signatures
 * are produced with a real ethers Wallet (pure crypto, NO network/RPC), and
 * the smart-account path uses a deterministic verifier double. Every negative
 * case (wrong domain/uri/chain/action, expired, consumed replay, replay after
 * restart) is asserted, plus normalization, duplicate ownership, concurrency,
 * active-wallet transactionality/fallback, and the pending-op policy hook.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Wallet } from "ethers";
import {
  createHarness,
  TEST_CHAIN_ID,
  TEST_DOMAIN,
  TEST_URI,
  type Harness,
} from "../testDoubles/harness.js";
import { SmartAccountVerifierDouble } from "../testDoubles/index.js";
import { WalletLinkService } from "./walletLink.service.js";
import { EoaSignatureVerifier, NotConfiguredSmartAccountVerifier } from "../providers/eoaVerifier.js";
import { isIdentityError, type IdentityErrorCode } from "../domain/errors.js";
import type { SessionRecord } from "../repositories/records.js";

/** Structural signer — Wallet.createRandom() returns an HDNodeWallet, so we
 *  depend only on the address + signMessage surface both share. */
type SignerLike = { address: string; signMessage(message: string): Promise<string> };

async function expectError(fn: () => Promise<unknown>, code: IdentityErrorCode): Promise<void> {
  try {
    await fn();
    assert.fail(`expected IdentityError(${code}) but call succeeded`);
  } catch (err) {
    assert.ok(isIdentityError(err), `expected IdentityError, got ${String(err)}`);
    assert.equal(err.code, code);
  }
}

async function session(h: Harness, subject: string): Promise<SessionRecord> {
  const r = await h.identity.authenticate({ provider: "google", providerSubject: subject });
  const issued = await h.sessions.issue({ userId: r.user.id, assuranceLevel: "aal2" });
  return issued.session;
}

const goodExpect = { domain: TEST_DOMAIN, uri: TEST_URI, chainId: TEST_CHAIN_ID, action: "link_external_wallet" as const };

async function linkEoa(h: Harness, s: SessionRecord, wallet: SignerLike) {
  const { challenge, message } = await h.walletLink.beginChallenge({
    session: s,
    action: "link_external_wallet",
    address: wallet.address,
    chainId: TEST_CHAIN_ID,
    walletType: "external_eoa",
  });
  const signature = await wallet.signMessage(message);
  return h.walletLink.completeLink({
    session: s,
    nonce: challenge.nonce,
    address: wallet.address,
    signature,
    walletType: "external_eoa",
    sourceProvider: "walletconnect",
    expect: goodExpect,
  });
}

test("links a valid external EOA after signature verification", async () => {
  const h = createHarness();
  const s = await session(h, "eoa-1");
  const wallet = Wallet.createRandom();
  const linked = await linkEoa(h, s, wallet);
  assert.equal(linked.ownershipStatus, "verified");
  assert.equal(linked.addressCanonical, wallet.address.toLowerCase());
  assert.equal(linked.walletType, "external_eoa");
});

test("links a smart-account wallet through the ERC-1271/6492 verifier path", async () => {
  const h = createHarness({ smartAccountVerifier: new SmartAccountVerifierDouble() });
  const s = await session(h, "sa-1");
  const wallet = Wallet.createRandom();
  const { challenge } = await h.walletLink.beginChallenge({
    session: s,
    action: "link_external_wallet",
    address: wallet.address,
    chainId: TEST_CHAIN_ID,
    walletType: "external_smart_account",
  });
  const linked = await h.walletLink.completeLink({
    session: s,
    nonce: challenge.nonce,
    address: wallet.address,
    signature: `smart-account-ok:${wallet.address.toLowerCase()}`,
    walletType: "external_smart_account",
    sourceProvider: "base",
    expect: goodExpect,
  });
  assert.equal(linked.walletType, "external_smart_account");
  assert.equal(linked.ownershipStatus, "verified");
});

test("a smart-account signature is NOT accepted by the fail-closed default verifier", async () => {
  const h = createHarness(); // default = NotConfiguredSmartAccountVerifier
  const s = await session(h, "sa-2");
  const wallet = Wallet.createRandom();
  const { challenge } = await h.walletLink.beginChallenge({
    session: s,
    action: "link_external_wallet",
    address: wallet.address,
    chainId: TEST_CHAIN_ID,
    walletType: "external_smart_account",
  });
  await expectError(
    () =>
      h.walletLink.completeLink({
        session: s,
        nonce: challenge.nonce,
        address: wallet.address,
        signature: "anything",
        walletType: "external_smart_account",
        sourceProvider: "base",
        expect: goodExpect,
      }),
    "wallet_challenge_invalid"
  );
});

test("wrong domain, URI, chain, or action are each rejected", async () => {
  const h = createHarness();
  const s = await session(h, "neg-1");
  const wallet = Wallet.createRandom();
  const mk = async () => {
    const { challenge, message } = await h.walletLink.beginChallenge({
      session: s,
      action: "link_external_wallet",
      address: wallet.address,
      chainId: TEST_CHAIN_ID,
      walletType: "external_eoa",
    });
    const signature = await wallet.signMessage(message);
    return { nonce: challenge.nonce, signature };
  };
  const base = { session: s, address: wallet.address, walletType: "external_eoa" as const, sourceProvider: "wc" };

  let c = await mk();
  await expectError(() => h.walletLink.completeLink({ ...base, ...c, expect: { ...goodExpect, domain: "evil.test" } }), "wallet_challenge_invalid");
  c = await mk();
  await expectError(() => h.walletLink.completeLink({ ...base, ...c, expect: { ...goodExpect, uri: "https://evil.test" } }), "wallet_challenge_invalid");
  c = await mk();
  await expectError(() => h.walletLink.completeLink({ ...base, ...c, expect: { ...goodExpect, chainId: 1 } }), "wallet_challenge_invalid");
  c = await mk();
  await expectError(() => h.walletLink.completeLink({ ...base, ...c, expect: { ...goodExpect, action: "base_account_login" } }), "wallet_challenge_invalid");
});

test("beginChallenge rejects an unsupported chain", async () => {
  const h = createHarness();
  const s = await session(h, "chain-neg");
  const wallet = Wallet.createRandom();
  await expectError(
    () => h.walletLink.beginChallenge({ session: s, action: "link_external_wallet", address: wallet.address, chainId: 999999, walletType: "external_eoa" }),
    "invalid_request"
  );
});

test("an expired challenge is rejected", async () => {
  const h = createHarness();
  const s = await session(h, "exp-1");
  const wallet = Wallet.createRandom();
  const { challenge, message } = await h.walletLink.beginChallenge({ session: s, action: "link_external_wallet", address: wallet.address, chainId: TEST_CHAIN_ID, walletType: "external_eoa" });
  const signature = await wallet.signMessage(message);
  h.advanceSeconds(301); // challengeTtlSeconds = 300
  await expectError(() => h.walletLink.completeLink({ session: s, nonce: challenge.nonce, address: wallet.address, signature, walletType: "external_eoa", sourceProvider: "wc", expect: goodExpect }), "challenge_expired");
});

test("a consumed challenge cannot be replayed (same service instance)", async () => {
  const h = createHarness();
  const s = await session(h, "replay-1");
  const wallet = Wallet.createRandom();
  const { challenge, message } = await h.walletLink.beginChallenge({ session: s, action: "link_external_wallet", address: wallet.address, chainId: TEST_CHAIN_ID, walletType: "external_eoa" });
  const signature = await wallet.signMessage(message);
  const args = { session: s, nonce: challenge.nonce, address: wallet.address, signature, walletType: "external_eoa" as const, sourceProvider: "wc", expect: goodExpect };
  await h.walletLink.completeLink(args);
  await expectError(() => h.walletLink.completeLink(args), "challenge_consumed");
});

test("a consumed challenge is still rejected after a simulated process restart", async () => {
  const h = createHarness();
  const s = await session(h, "restart-1");
  const wallet = Wallet.createRandom();
  const { challenge, message } = await h.walletLink.beginChallenge({ session: s, action: "link_external_wallet", address: wallet.address, chainId: TEST_CHAIN_ID, walletType: "external_eoa" });
  const signature = await wallet.signMessage(message);
  const args = { session: s, nonce: challenge.nonce, address: wallet.address, signature, walletType: "external_eoa" as const, sourceProvider: "wc", expect: goodExpect };
  await h.walletLink.completeLink(args);

  // "Restart": a brand-new service instance backed by the SAME stores (the DB).
  const restarted = new WalletLinkService({
    stores: h.stores,
    audit: h.audit,
    sessions: h.sessions,
    eoaVerifier: new EoaSignatureVerifier(),
    smartAccountVerifier: new NotConfiguredSmartAccountVerifier(),
    config: { authDomain: TEST_DOMAIN, uri: TEST_URI, allowedChainIds: [TEST_CHAIN_ID], challengeTtlSeconds: 300 },
    now: h.now,
  });
  await expectError(() => restarted.completeLink(args), "challenge_consumed");
});

test("address case is normalized — a checksummed input links to the lowercase canonical", async () => {
  const h = createHarness();
  const s = await session(h, "norm-1");
  const wallet = Wallet.createRandom();
  const { challenge, message } = await h.walletLink.beginChallenge({ session: s, action: "link_external_wallet", address: wallet.address, chainId: TEST_CHAIN_ID, walletType: "external_eoa" });
  const signature = await wallet.signMessage(message);
  const linked = await h.walletLink.completeLink({
    session: s,
    nonce: challenge.nonce,
    address: wallet.address.toUpperCase().replace("0X", "0x"), // odd casing
    signature,
    walletType: "external_eoa",
    sourceProvider: "wc",
    expect: goodExpect,
  });
  assert.equal(linked.addressCanonical, wallet.address.toLowerCase());
});

test("a wallet already verified-owned by another user is rejected (duplicate ownership)", async () => {
  const h = createHarness();
  const wallet = Wallet.createRandom();
  const sA = await session(h, "dup-A");
  await linkEoa(h, sA, wallet);
  const sB = await session(h, "dup-B");
  await expectError(() => linkEoa(h, sB, wallet), "wallet_owned_by_another_user");
});

test("concurrent link attempts of the same address by the same user yield one wallet", async () => {
  const h = createHarness();
  const s = await session(h, "conc-1");
  const wallet = Wallet.createRandom();
  const mk = async () => {
    const { challenge, message } = await h.walletLink.beginChallenge({ session: s, action: "link_external_wallet", address: wallet.address, chainId: TEST_CHAIN_ID, walletType: "external_eoa" });
    const signature = await wallet.signMessage(message);
    return h.walletLink.completeLink({ session: s, nonce: challenge.nonce, address: wallet.address, signature, walletType: "external_eoa", sourceProvider: "wc", expect: goodExpect });
  };
  const [a, b] = await Promise.all([mk(), mk()]);
  assert.equal(a.id, b.id);
  const verified = (await h.stores.wallets.listByUser(s.userId)).filter((w) => w.ownershipStatus === "verified");
  assert.equal(verified.length, 1);
});

test("active-wallet switching is transactional — at most one active", async () => {
  const h = createHarness();
  const s = await session(h, "active-1");
  const w1 = await linkEoa(h, s, Wallet.createRandom());
  const w2 = await linkEoa(h, s, Wallet.createRandom());
  await h.walletLink.setActiveWallet(s, w1.id);
  await h.walletLink.setActiveWallet(s, w2.id);
  const wallets = await h.stores.wallets.listByUser(s.userId);
  assert.equal(wallets.filter((w) => w.isActive).length, 1);
  assert.equal((await h.stores.wallets.findActiveByUser(s.userId))!.id, w2.id);
});

test("revoking the active wallet falls back to another verified wallet", async () => {
  const h = createHarness();
  const s = await session(h, "fallback-1");
  const w1 = await linkEoa(h, s, Wallet.createRandom());
  const w2 = await linkEoa(h, s, Wallet.createRandom());
  await h.walletLink.setActiveWallet(s, w1.id);
  await h.walletLink.revokeWallet(s, w1.id);
  const active = await h.stores.wallets.findActiveByUser(s.userId);
  assert.equal(active!.id, w2.id);
  const revoked = await h.stores.wallets.findById(w1.id);
  assert.equal(revoked!.ownershipStatus, "revoked");
  assert.ok(revoked!.revokedAt); // history preserved
});

test("wallet changes are blocked while a sensitive operation is pending (policy hook)", async () => {
  const h = createHarness({ walletChangePolicy: () => true });
  const s = await session(h, "policy-1");
  // Link happens through beginChallenge/completeLink (not gated); the guard is
  // on active-switch and revoke.
  const w = await linkEoa(createHarness(), s, Wallet.createRandom()).catch(() => null);
  void w;
  const s2 = await session(h, "policy-2");
  const wallet = Wallet.createRandom();
  // Manually create a verified wallet to attempt switching.
  const linked = await h.stores.wallets.create({ id: "wpol", userId: s2.userId, addressCanonical: wallet.address.toLowerCase(), walletType: "external_eoa", sourceProvider: "wc", ownershipStatus: "verified" });
  await expectError(() => h.walletLink.setActiveWallet(s2, linked.id), "wallet_operation_locked");
});
