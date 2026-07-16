/**
 * IdentityService — canonical identity resolution, idempotency, concurrency,
 * no-silent-merge, and linking/unlinking safeguards. Fully offline: no network,
 * no RPC, no provider — deterministic in-memory stores only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "../testDoubles/harness.js";
import { isIdentityError, type IdentityErrorCode } from "../domain/errors.js";

async function expectError(fn: () => Promise<unknown>, code: IdentityErrorCode): Promise<void> {
  try {
    await fn();
    assert.fail(`expected IdentityError(${code}) but call succeeded`);
  } catch (err) {
    assert.ok(isIdentityError(err), `expected IdentityError, got ${String(err)}`);
    assert.equal(err.code, code);
  }
}

test("creates a user with an email identity on first authenticate", async () => {
  const h = createHarness();
  const r = await h.identity.authenticate({ provider: "email_otp", providerSubject: "a@example.com", normalizedEmail: "a@example.com", emailVerified: true });
  assert.equal(r.created, true);
  assert.equal(r.identity.provider, "email_otp");
  assert.equal(r.identity.userId, r.user.id);
  assert.equal(r.user.status, "active");
});

test("creates a user with a Google identity", async () => {
  const h = createHarness();
  const r = await h.identity.authenticate({ provider: "google", providerSubject: "google-sub-1", normalizedEmail: "g@example.com", emailVerified: true });
  assert.equal(r.created, true);
  assert.equal(r.identity.provider, "google");
  assert.equal(r.identity.assuranceLevel, "aal2");
});

test("creates then resolves a Base Account identity idempotently", async () => {
  const h = createHarness();
  const first = await h.identity.authenticate({ provider: "base_account", providerSubject: "0xabc" });
  const second = await h.identity.authenticate({ provider: "base_account", providerSubject: "0xabc" });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.user.id, second.user.id);
});

test("repeated provider callbacks never create a second user", async () => {
  const h = createHarness();
  const ids = new Set<string>();
  for (let i = 0; i < 5; i++) {
    const r = await h.identity.authenticate({ provider: "google", providerSubject: "sub-repeat" });
    ids.add(r.user.id);
  }
  assert.equal(ids.size, 1);
});

test("concurrent first-time callbacks converge on ONE user (no duplicate, no orphan)", async () => {
  const h = createHarness();
  const results = await Promise.all(
    Array.from({ length: 8 }, () => h.identity.authenticate({ provider: "google", providerSubject: "sub-concurrent" }))
  );
  const userIds = new Set(results.map((r) => r.user.id));
  assert.equal(userIds.size, 1, "all concurrent callbacks resolve to one user");
  const createdCount = results.filter((r) => r.created).length;
  assert.equal(createdCount, 1, "exactly one call created the user");
  // No orphan user: exactly one user exists overall.
  const only = [...userIds][0];
  const identities = await h.identity.listIdentities(only);
  assert.equal(identities.length, 1);
});

test("a provider-subject collision resolves to the same user, never a second", async () => {
  const h = createHarness();
  const a = await h.identity.authenticate({ provider: "google", providerSubject: "collide" });
  const b = await h.identity.authenticate({ provider: "google", providerSubject: "collide" });
  assert.equal(a.user.id, b.user.id);
});

test("a matching email across DIFFERENT providers does NOT silently merge accounts", async () => {
  const h = createHarness();
  const viaEmail = await h.identity.authenticate({ provider: "email_otp", providerSubject: "same@example.com", normalizedEmail: "same@example.com", emailVerified: true });
  const viaGoogle = await h.identity.authenticate({ provider: "google", providerSubject: "google-xyz", normalizedEmail: "same@example.com", emailVerified: true });
  assert.notEqual(viaEmail.user.id, viaGoogle.user.id, "same email under two providers = two distinct users");
});

test("links a new auth method to an authenticated, recently-verified session", async () => {
  const h = createHarness();
  const base = await h.identity.authenticate({ provider: "email_otp", providerSubject: "u@example.com", normalizedEmail: "u@example.com", emailVerified: true });
  const issued = await h.sessions.issue({ userId: base.user.id, assuranceLevel: "aal2" });
  const linked = await h.identity.linkIdentity(issued.session, { provider: "google", providerSubject: "g-link-1", emailVerified: true });
  assert.equal(linked.userId, base.user.id);
  const list = await h.identity.listIdentities(base.user.id);
  assert.equal(list.length, 2);
});

test("linking an identity owned by another user is rejected", async () => {
  const h = createHarness();
  const other = await h.identity.authenticate({ provider: "google", providerSubject: "owned-by-other" });
  const me = await h.identity.authenticate({ provider: "email_otp", providerSubject: "me@example.com", normalizedEmail: "me@example.com", emailVerified: true });
  const issued = await h.sessions.issue({ userId: me.user.id, assuranceLevel: "aal2" });
  void other;
  await expectError(() => h.identity.linkIdentity(issued.session, { provider: "google", providerSubject: "owned-by-other" }), "identity_owned_by_another_user");
});

test("linking requires recent authentication (step-up)", async () => {
  const h = createHarness();
  const me = await h.identity.authenticate({ provider: "email_otp", providerSubject: "stale@example.com", normalizedEmail: "stale@example.com", emailVerified: true });
  const issued = await h.sessions.issue({ userId: me.user.id, assuranceLevel: "aal2" });
  h.advanceSeconds(301); // beyond recentAuthWindowSeconds (300)
  await expectError(() => h.identity.linkIdentity(issued.session, { provider: "google", providerSubject: "g-late" }), "recent_auth_required");
});

test("unlinks a non-final method and refuses to remove the FINAL login method", async () => {
  const h = createHarness();
  const base = await h.identity.authenticate({ provider: "email_otp", providerSubject: "f@example.com", normalizedEmail: "f@example.com", emailVerified: true });
  const issued = await h.sessions.issue({ userId: base.user.id, assuranceLevel: "aal2" });
  const linked = await h.identity.linkIdentity(issued.session, { provider: "google", providerSubject: "g-final" });

  // Removing one of two is fine.
  await h.identity.unlinkIdentity(issued.session, linked.id);
  const afterUnlink = await h.identity.listIdentities(base.user.id);
  assert.equal(afterUnlink.length, 1);

  // Removing the last one is refused. Re-authenticate first (unlink revoked sessions).
  const fresh = await h.sessions.issue({ userId: base.user.id, assuranceLevel: "aal2" });
  await expectError(() => h.identity.unlinkIdentity(fresh.session, afterUnlink[0].id), "final_login_method");
});

test("removing a login method revokes all of the user's sessions", async () => {
  const h = createHarness();
  const base = await h.identity.authenticate({ provider: "email_otp", providerSubject: "rv@example.com", normalizedEmail: "rv@example.com", emailVerified: true });
  const issued = await h.sessions.issue({ userId: base.user.id, assuranceLevel: "aal2" });
  const linked = await h.identity.linkIdentity(issued.session, { provider: "google", providerSubject: "g-rv" });
  await h.identity.unlinkIdentity(issued.session, linked.id);
  // The session used to unlink is now revoked (material security event).
  await expectError(() => h.sessions.verifyAccess(issued.accessToken), "session_invalid");
});
