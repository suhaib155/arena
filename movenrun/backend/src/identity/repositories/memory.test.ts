/**
 * In-memory repositories — the same uniqueness/atomicity invariants the DB
 * constraints enforce (identity.schema.ts), exercised offline. Mirrors the
 * "constraints reject duplicate states" behavior validated against Postgres.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryStores } from "./memory.js";
import { UniqueConstraintError } from "./interfaces.js";

async function seedUser(stores: ReturnType<typeof createInMemoryStores>, id: string) {
  await stores.users.create({ id });
}

test("an active (provider, subject) identity is unique; a revoked one frees the slot", async () => {
  const s = createInMemoryStores();
  await seedUser(s, "u1");
  await seedUser(s, "u2");
  const first = await s.identities.create({ id: "i1", userId: "u1", provider: "google", providerSubject: "sub" });
  await assert.rejects(
    s.identities.create({ id: "i2", userId: "u2", provider: "google", providerSubject: "sub" }),
    (e: unknown) => e instanceof UniqueConstraintError && e.constraint === "auth_identities_provider_subject_active_unique"
  );
  await s.identities.revoke(first.id, new Date());
  const relinked = await s.identities.create({ id: "i3", userId: "u2", provider: "google", providerSubject: "sub" });
  assert.equal(relinked.userId, "u2");
});

test("a verified address may be owned by only one user", async () => {
  const s = createInMemoryStores();
  await seedUser(s, "u1");
  await seedUser(s, "u2");
  await s.wallets.create({ id: "w1", userId: "u1", addressCanonical: "0xaaa", walletType: "external_eoa", sourceProvider: "wc", ownershipStatus: "verified" });
  await assert.rejects(
    s.wallets.create({ id: "w2", userId: "u2", addressCanonical: "0xaaa", walletType: "external_eoa", sourceProvider: "wc", ownershipStatus: "verified" }),
    (e: unknown) => e instanceof UniqueConstraintError && e.constraint === "wallets_verified_address_unique"
  );
});

test("at most one active wallet per user", async () => {
  const s = createInMemoryStores();
  await seedUser(s, "u1");
  await s.wallets.create({ id: "w1", userId: "u1", addressCanonical: "0xa", walletType: "embedded_eoa", sourceProvider: "embedded", isActive: true });
  await assert.rejects(
    s.wallets.create({ id: "w2", userId: "u1", addressCanonical: "0xb", walletType: "external_eoa", sourceProvider: "wc", isActive: true }),
    (e: unknown) => e instanceof UniqueConstraintError && e.constraint === "wallets_active_per_user_unique"
  );
});

test("at most one non-revoked embedded wallet per (user, provider)", async () => {
  const s = createInMemoryStores();
  await seedUser(s, "u1");
  await s.wallets.create({ id: "w1", userId: "u1", addressCanonical: "0xa", walletType: "embedded_eoa", sourceProvider: "embedded", isEmbedded: true });
  await assert.rejects(
    s.wallets.create({ id: "w2", userId: "u1", addressCanonical: "0xb", walletType: "embedded_eoa", sourceProvider: "embedded", isEmbedded: true }),
    (e: unknown) => e instanceof UniqueConstraintError && e.constraint === "wallets_embedded_per_user_provider_unique"
  );
});

test("setActive makes exactly one wallet active, atomically", async () => {
  const s = createInMemoryStores();
  await seedUser(s, "u1");
  await s.wallets.create({ id: "w1", userId: "u1", addressCanonical: "0xa", walletType: "external_eoa", sourceProvider: "wc", ownershipStatus: "verified" });
  await s.wallets.create({ id: "w2", userId: "u1", addressCanonical: "0xb", walletType: "external_eoa", sourceProvider: "wc", ownershipStatus: "verified" });
  await s.wallets.setActive("u1", "w1");
  await s.wallets.setActive("u1", "w2");
  const all = await s.wallets.listByUser("u1");
  assert.equal(all.filter((w) => w.isActive).length, 1);
  assert.equal((await s.wallets.findActiveByUser("u1"))!.id, "w2");
});

test("challenge consume is atomic and single-use", async () => {
  const s = createInMemoryStores();
  await seedUser(s, "u1");
  await s.walletChallenges.create({ id: "c1", userId: "u1", action: "link_external_wallet", domain: "d", uri: "u", chainId: 1, nonce: "n1", notBefore: new Date(), expiresAt: new Date(Date.now() + 1000) });
  const first = await s.walletChallenges.consume("n1", new Date());
  assert.ok(first);
  const second = await s.walletChallenges.consume("n1", new Date());
  assert.equal(second, null); // replay rejected
});

test("markRotated is a compare-and-set — only the first transition wins", async () => {
  const s = createInMemoryStores();
  await seedUser(s, "u1");
  await s.sessions.create({
    id: "s1", userId: "u1", familyId: "f1", assuranceLevel: "aal2",
    refreshTokenHash: "h1", securityVersion: 0,
    expiresAt: new Date(Date.now() + 1000), lastAuthenticatedAt: new Date(),
  });
  const first = await s.sessions.markRotated("s1", new Date());
  const second = await s.sessions.markRotated("s1", new Date());
  assert.ok(first, "first rotation transitions the active session");
  assert.equal(second, null, "a second rotation of an already-rotated session returns null");
});

test("createUserWithIdentity is all-or-nothing (no orphan user on conflict)", async () => {
  const s = createInMemoryStores();
  await s.createUserWithIdentity({ userId: "u1", identity: { id: "i1", provider: "google", providerSubject: "dup" } });
  await assert.rejects(
    s.createUserWithIdentity({ userId: "u2", identity: { id: "i2", provider: "google", providerSubject: "dup" } }),
    (e: unknown) => e instanceof UniqueConstraintError
  );
  // u2 must not exist (rolled back).
  assert.equal(await s.users.findById("u2"), null);
});
