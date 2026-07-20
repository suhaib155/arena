/**
 * SessionService — access-token expiry, refresh rotation, refresh-replay
 * detection, family revocation, revoked-session rejection, security-version
 * invalidation, revoke-all, and recent-auth enforcement. Offline only.
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

async function newUserSession(h: ReturnType<typeof createHarness>) {
  const r = await h.identity.authenticate({ provider: "google", providerSubject: `s-${Math.random()}` });
  return h.sessions.issue({ userId: r.user.id, assuranceLevel: "aal2" });
}

test("a fresh access token verifies to its live session", async () => {
  const h = createHarness();
  const issued = await newUserSession(h);
  const session = await h.sessions.verifyAccess(issued.accessToken);
  assert.equal(session.id, issued.session.id);
});

test("an access token past its TTL is rejected as expired", async () => {
  const h = createHarness();
  const issued = await newUserSession(h);
  h.advanceSeconds(601); // accessTokenTtlSeconds = 600
  await expectError(() => h.sessions.verifyAccess(issued.accessToken), "session_expired");
});

test("a tampered access token is rejected", async () => {
  const h = createHarness();
  const issued = await newUserSession(h);
  await expectError(() => h.sessions.verifyAccess(issued.accessToken + "x"), "session_invalid");
});

test("refresh rotates the token and issues a new working pair", async () => {
  const h = createHarness();
  const issued = await newUserSession(h);
  const rotated = await h.sessions.refresh(issued.refreshToken);
  assert.notEqual(rotated.refreshToken, issued.refreshToken);
  assert.notEqual(rotated.session.id, issued.session.id);
  assert.equal(rotated.session.familyId, issued.session.familyId);
  const s = await h.sessions.verifyAccess(rotated.accessToken);
  assert.equal(s.id, rotated.session.id);
});

test("replaying an already-rotated refresh token is detected and revokes the whole family", async () => {
  const h = createHarness();
  const issued = await newUserSession(h);
  const rotated = await h.sessions.refresh(issued.refreshToken);
  // Replay the OLD refresh token → reuse detected.
  await expectError(() => h.sessions.refresh(issued.refreshToken), "refresh_reuse_detected");
  // The family is revoked, so even the legitimately-rotated token no longer works.
  await expectError(() => h.sessions.refresh(rotated.refreshToken), "refresh_reuse_detected");
  await expectError(() => h.sessions.verifyAccess(rotated.accessToken), "session_invalid");
});

test("two concurrent refreshes with the same token cannot both succeed", async () => {
  const h = createHarness();
  const issued = await newUserSession(h);
  // Fire both refreshes before awaiting either — they interleave at await
  // points, so the atomic markRotated CAS is the only thing preventing a
  // double-spend of the refresh token.
  const results = await Promise.allSettled([
    h.sessions.refresh(issued.refreshToken),
    h.sessions.refresh(issued.refreshToken),
  ]);
  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  // Fail-closed semantics (tightened by the post-issue race guard): AT MOST
  // one refresh may succeed; when the race is detected the whole family dies,
  // which can take the would-be winner down with it (0 or 1 fulfilled).
  assert.ok(fulfilled.length <= 1, "concurrent refreshes can never both succeed");
  assert.ok(rejected.length >= 1, "the racing refresh must be rejected");
  assert.ok(
    rejected.some((r) => r.status === "rejected" && isIdentityError(r.reason) && r.reason.code === "refresh_reuse_detected"),
    "at least one rejection is flagged as reuse"
  );
  // The decisive invariant: after a detected reuse race, NO usable session
  // remains in the family — nothing minted during the race survives it.
  const remaining = await h.stores.sessions.listActiveByUser(issued.session.userId);
  assert.equal(remaining.length, 0, "no active session survives a reuse race (fail closed)");
  // The original refresh token is spent: a further attempt is also rejected.
  await expectError(() => h.sessions.refresh(issued.refreshToken), "refresh_reuse_detected");
});

test("a revocation landing between rotate and issue cannot leave the new session usable (refresh vs revoke race guard)", async () => {
  const h = createHarness();
  const issued = await newUserSession(h);
  // Interpose on the sessions repo: the moment refresh() inserts its NEW
  // session (repo.create), revoke every other session of the user — exactly
  // the revoke-others / revoke-all interleaving that lands in the
  // rotate→issue window.
  const realCreate = h.stores.sessions.create.bind(h.stores.sessions);
  h.stores.sessions.create = async (input) => {
    const created = await realCreate(input);
    await h.stores.sessions.revokeAllExcept(input.userId, created.id, "user_logout", h.now());
    return created;
  };
  await expectError(() => h.sessions.refresh(issued.refreshToken), "session_invalid");
  // Nothing survives: the guard revoked the family including the new session.
  const remaining = await h.stores.sessions.listActiveByUser(issued.session.userId);
  assert.equal(remaining.length, 0, "revocation racing a refresh leaves no usable session");
});

test("a revoked session's access token is rejected", async () => {
  const h = createHarness();
  const issued = await newUserSession(h);
  await h.sessions.revoke(issued.session.id);
  await expectError(() => h.sessions.verifyAccess(issued.accessToken), "session_invalid");
  await expectError(() => h.sessions.refresh(issued.refreshToken), "refresh_reuse_detected");
});

test("bumping the user's security version invalidates outstanding access tokens", async () => {
  const h = createHarness();
  const r = await h.identity.authenticate({ provider: "google", providerSubject: "sv-user" });
  const issued = await h.sessions.issue({ userId: r.user.id, assuranceLevel: "aal2" });
  await h.stores.users.bumpSecurityVersion(r.user.id);
  await expectError(() => h.sessions.verifyAccess(issued.accessToken), "session_invalid");
});

test("revokeAll ends every session and bumps security version", async () => {
  const h = createHarness();
  const r = await h.identity.authenticate({ provider: "google", providerSubject: "ra-user" });
  const a = await h.sessions.issue({ userId: r.user.id, assuranceLevel: "aal2" });
  const b = await h.sessions.issue({ userId: r.user.id, assuranceLevel: "aal2" });
  const count = await h.sessions.revokeAll(r.user.id);
  assert.ok(count >= 2);
  await expectError(() => h.sessions.verifyAccess(a.accessToken), "session_invalid");
  await expectError(() => h.sessions.verifyAccess(b.accessToken), "session_invalid");
});

test("assertRecentAuth enforces the recency window", async () => {
  const h = createHarness();
  const issued = await newUserSession(h);
  h.sessions.assertRecentAuth(issued.session); // within window: no throw
  h.advanceSeconds(301);
  assert.throws(() => h.sessions.assertRecentAuth(issued.session), (e: unknown) => isIdentityError(e) && e.code === "recent_auth_required");
});

test("an expired refresh token is rejected (not treated as reuse)", async () => {
  const h = createHarness();
  const issued = await newUserSession(h);
  h.advanceSeconds(60 * 60 * 24 * 31); // beyond 30-day refresh TTL
  await expectError(() => h.sessions.refresh(issued.refreshToken), "session_expired");
});

test("no plaintext refresh token is persisted — only its keyed hash", async () => {
  const h = createHarness();
  const issued = await newUserSession(h);
  const stored = await h.stores.sessions.findById(issued.session.id);
  assert.ok(stored);
  assert.notEqual(stored!.refreshTokenHash, issued.refreshToken);
  assert.ok(!issued.refreshToken.includes(stored!.refreshTokenHash));
  // The stored hash must not contain the raw secret half either.
  const secretHalf = issued.refreshToken.split(".")[1];
  assert.ok(!stored!.refreshTokenHash.includes(secretHalf));
});
