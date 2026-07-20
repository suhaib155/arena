/**
 * Session & device management (PR #53) — inventory, per-session revocation,
 * revoke-others, IDOR/enumeration resistance, idempotency, privacy of the
 * public view, device-label sanitization, and race safety. Offline over the
 * in-memory stores (which mirror the DB semantics); the highest-risk races are
 * additionally proven on real PostgreSQL (see the PR's concurrency evidence).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness, type Harness } from "../testDoubles/harness.js";
import { SessionService } from "./session.service.js";
import { sanitizeDeviceLabel } from "../domain/deviceLabel.js";
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

async function newUser(h: Harness, subject: string) {
  const r = await h.identity.authenticate({ provider: "google", providerSubject: subject });
  return r.user.id;
}

async function issueFor(h: Harness, userId: string, deviceLabel?: string | null) {
  return h.sessions.issue({ userId, assuranceLevel: "aal2", deviceLabel: deviceLabel ?? null });
}

// ---- inventory -------------------------------------------------------------

test("inventory lists only caller-owned sessions, current first, actives by recency", async () => {
  const h = createHarness();
  const uA = await newUser(h, "inv-a");
  const uB = await newUser(h, "inv-b");
  const other1 = await issueFor(h, uA, "Old phone");
  h.advanceSeconds(10);
  const other2 = await issueFor(h, uA, "Tablet");
  h.advanceSeconds(10);
  const current = await issueFor(h, uA, "Pixel 8");
  await issueFor(h, uB, "B's phone"); // must never appear

  // Give other1 the most recent USE so recency ordering is by use, not issue.
  await h.stores.sessions.markUsed(other1.session.id, h.now());

  const list = await h.sessions.listSessions(current.session);
  assert.deepEqual(
    list.map((s) => s.id),
    [current.session.id, other1.session.id, other2.session.id],
    "current first, then actives by most recent use"
  );
  assert.equal(list[0].isCurrent, true);
  assert.ok(list.slice(1).every((s) => !s.isCurrent));
  assert.ok(!list.some((s) => s.deviceLabel === "B's phone"), "no cross-user leakage");
});

test("the public summary exposes no secret or internal fields", async () => {
  const h = createHarness();
  const uid = await newUser(h, "priv-1");
  const current = await issueFor(h, uid, "iPhone");
  const [summary] = await h.sessions.listSessions(current.session);
  assert.deepEqual(
    Object.keys(summary).sort(),
    ["assuranceLevel", "deviceLabel", "expiresAt", "id", "isCurrent", "issuedAt", "lastUsedAt", "revokedAt", "status"].sort(),
    "exactly the documented public fields — nothing else"
  );
  const blob = JSON.stringify(summary);
  for (const secret of ["refreshTokenHash", "familyId", "userId", "securityVersion", "userAgentHash", "revocationReason"]) {
    assert.ok(!blob.includes(secret), `${secret} must not appear`);
  }
});

test("expired sessions are mapped from authoritative time, shown in retention, then dropped", async () => {
  const h = createHarness();
  const uid = await newUser(h, "exp-1");
  const current = await issueFor(h, uid, "Current");
  const rec = (await h.stores.sessions.findById(current.session.id))!;
  const { toPublicSessionSummary } = await import("../http/publicViews.js");
  // A persisted "active" status past its expiry must map to "expired" — the
  // server clock is authoritative, not the un-swept stored status.
  const expiredView = toPublicSessionSummary(
    { ...rec, id: "other-id", expiresAt: new Date(h.now().getTime() - 1000) },
    current.session.id,
    h.now()
  );
  assert.equal(expiredView.status, "expired");
  assert.equal(expiredView.isCurrent, false);
  // Retention boundary: a session revoked longer ago than the window is
  // omitted from the inventory (bounded history, not unbounded).
  const old = await issueFor(h, uid, "Ancient");
  await h.sessions.revoke(old.session.id);
  const inWindow = await h.sessions.listSessions(current.session);
  assert.ok(inWindow.some((s) => s.id === old.session.id), "recently revoked is shown");
  h.advanceSeconds(SessionService.INVENTORY_RETENTION_DAYS * 24 * 3600 + 1);
  const afterWindow = await h.sessions.listSessions(current.session);
  assert.ok(!afterWindow.some((s) => s.id === old.session.id), "beyond retention window: omitted");
});

test("recently revoked sessions appear with status revoked and revocation time; inventory is capped", async () => {
  const h = createHarness();
  const uid = await newUser(h, "cap-1");
  const current = await issueFor(h, uid, "Current");
  const other = await issueFor(h, uid, "Other");
  await h.sessions.revokeOtherSession(current.session, other.session.id);
  const list = await h.sessions.listSessions(current.session);
  const revoked = list.find((s) => s.id === other.session.id);
  assert.ok(revoked);
  assert.equal(revoked!.status, "revoked");
  assert.ok(revoked!.revokedAt, "revocation time shown for recently revoked");
  // Cap: many sessions → bounded response.
  for (let i = 0; i < 30; i++) await issueFor(h, uid, `S${i}`);
  const capped = await h.sessions.listSessions(current.session);
  assert.ok(capped.length <= SessionService.INVENTORY_MAX_SESSIONS, "inventory bounded");
  assert.equal(capped[0].id, current.session.id, "current always included and first");
});

// ---- per-session revocation ------------------------------------------------

test("a swept rotation chain shows exactly ONE settled entry (its terminal row), not every link", async () => {
  const h = createHarness();
  const u = await newUser(h, "chain-sweep");
  // One "device" that refreshed twice: lineage = 3 rows (2 rotated links +
  // 1 terminal), then a second device's revoke-all sweeps everything.
  let device = await issueFor(h, u, "Old phone");
  device = await h.sessions.refresh(device.refreshToken);
  device = await h.sessions.refresh(device.refreshToken);
  const current = await issueFor(h, u, "New phone");
  await h.sessions.revokeAll(u); // sweeps rotated links AND terminals
  const fresh = await issueFor(h, u, "New phone");
  const list = await h.sessions.listSessions(fresh.session);
  const endedOldPhone = list.filter((s) => s.deviceLabel === "Old phone");
  assert.equal(endedOldPhone.length, 1, "one entry per device lineage, not one per rotation link");
  assert.equal(endedOldPhone[0].status, "revoked");
  assert.equal(endedOldPhone[0].id, device.session.id, "the lineage's terminal row represents the device");
  assert.ok(list.some((s) => s.id === current.session.id && s.status === "revoked"));
});

test("revokes another active session; repeat is idempotent; access/refresh die", async () => {
  const h = createHarness();
  const uid = await newUser(h, "rev-1");
  const other = await issueFor(h, uid, "Other");
  const current = await issueFor(h, uid, "Current");
  await h.sessions.revokeOtherSession(current.session, other.session.id);
  // Idempotent second call — no error, no state change.
  await h.sessions.revokeOtherSession(current.session, other.session.id);
  await expectError(() => h.sessions.verifyAccess(other.accessToken), "session_invalid");
  await expectError(() => h.sessions.refresh(other.refreshToken), "refresh_reuse_detected");
  // Current session unaffected.
  const still = await h.sessions.verifyAccess(current.accessToken);
  assert.equal(still.id, current.session.id);
});

test("the current session is refused by the per-session endpoint (conflict)", async () => {
  const h = createHarness();
  const uid = await newUser(h, "rev-cur");
  const current = await issueFor(h, uid, "Current");
  await expectError(() => h.sessions.revokeOtherSession(current.session, current.session.id), "conflict");
});

test("IDOR: foreign and nonexistent session ids are indistinguishable (both not_found), and nothing changes", async () => {
  const h = createHarness();
  const uA = await newUser(h, "idor-a");
  const uB = await newUser(h, "idor-b");
  const victim = await issueFor(h, uB, "Victim phone");
  const attacker = await issueFor(h, uA, "Attacker");

  await expectError(() => h.sessions.revokeOtherSession(attacker.session, victim.session.id), "not_found");
  await expectError(() => h.sessions.revokeOtherSession(attacker.session, "00000000-0000-4000-8000-000000000000"), "not_found");
  // Victim's session is untouched — the ownership-scoped UPDATE never matched.
  const stillValid = await h.sessions.verifyAccess(victim.accessToken);
  assert.equal(stillValid.id, victim.session.id);
  // And the victim's inventory is not visible to the attacker.
  const attackerList = await h.sessions.listSessions(attacker.session);
  assert.ok(!attackerList.some((s) => s.id === victim.session.id));
});

test("two concurrent revocations of the same session are safe (exactly one transition)", async () => {
  const h = createHarness();
  const uid = await newUser(h, "race-1");
  const other = await issueFor(h, uid, "Other");
  const current = await issueFor(h, uid, "Current");
  const results = await Promise.allSettled([
    h.sessions.revokeOtherSession(current.session, other.session.id),
    h.sessions.revokeOtherSession(current.session, other.session.id),
  ]);
  assert.ok(results.every((r) => r.status === "fulfilled"), "both calls succeed (idempotent)");
  const rec = await h.stores.sessions.findById(other.session.id);
  assert.equal(rec!.status, "revoked");
});

// ---- revoke-others ---------------------------------------------------------

test("revoke-others revokes every other active session, preserves the current one, and is idempotent", async () => {
  const h = createHarness();
  const uid = await newUser(h, "others-1");
  const s1 = await issueFor(h, uid, "One");
  const s2 = await issueFor(h, uid, "Two");
  const current = await issueFor(h, uid, "Current");

  const n = await h.sessions.revokeOtherSessions(current.session);
  assert.equal(n, 2);
  // Idempotent: an immediate repeat has nothing left to revoke.
  const again = await h.sessions.revokeOtherSessions(current.session);
  assert.equal(again, 0);
  await expectError(() => h.sessions.verifyAccess(s1.accessToken), "session_invalid");
  await expectError(() => h.sessions.refresh(s2.refreshToken), "refresh_reuse_detected");
  // Current access AND refresh both remain valid (no securityVersion bump).
  await h.sessions.verifyAccess(current.accessToken);
  const rotated = await h.sessions.refresh(current.refreshToken);
  assert.ok(rotated.accessToken, "current session refresh chain survives revoke-others");
});

test("revoke-others does not appear in the other user's world (scoped strictly to caller)", async () => {
  const h = createHarness();
  const uA = await newUser(h, "others-a");
  const uB = await newUser(h, "others-b");
  const a = await issueFor(h, uA, "A");
  const b = await issueFor(h, uB, "B");
  await h.sessions.revokeOtherSessions(a.session);
  const bStill = await h.sessions.verifyAccess(b.accessToken);
  assert.equal(bStill.id, b.session.id);
});

test("revoke-all still revokes the current session too (existing semantics preserved)", async () => {
  const h = createHarness();
  const uid = await newUser(h, "all-1");
  const current = await issueFor(h, uid, "Current");
  await h.sessions.revokeAll(uid);
  await expectError(() => h.sessions.verifyAccess(current.accessToken), "session_invalid");
});

// ---- audit privacy ---------------------------------------------------------

test("session-management audit events carry no tokens, hashes, user agents, or device labels", async () => {
  const h = createHarness();
  const uid = await newUser(h, "audit-1");
  const other = await issueFor(h, uid, "Secret Device Name XYZ");
  const current = await issueFor(h, uid, "Current");
  await h.sessions.revokeOtherSession(current.session, other.session.id);
  await h.sessions.revokeOtherSessions(current.session);
  const events = await h.audit.listByUser(uid);
  const blob = JSON.stringify(events);
  assert.ok(!blob.includes(other.refreshToken), "no refresh token in audit");
  assert.ok(!blob.includes(other.accessToken), "no access token in audit");
  assert.ok(!blob.includes("Secret Device Name XYZ"), "device label never audited");
  const rec = await h.stores.sessions.findById(other.session.id);
  assert.ok(!blob.includes(rec!.refreshTokenHash), "no token hash in audit");
});

// ---- device label ----------------------------------------------------------

test("device labels are normalized, bounded, control-char-rejected, and fall back safely", () => {
  assert.equal(sanitizeDeviceLabel("  Pixel   8  Pro "), "Pixel 8 Pro");
  assert.equal(sanitizeDeviceLabel("iPhone"), "iPhone");
  assert.equal(sanitizeDeviceLabel(""), null);
  assert.equal(sanitizeDeviceLabel("   "), null);
  assert.equal(sanitizeDeviceLabel("a".repeat(65)), null);
  assert.equal(sanitizeDeviceLabel("bad\u0000label"), null);
  assert.equal(sanitizeDeviceLabel("bad\u009flabel"), null);
  assert.equal(sanitizeDeviceLabel(42 as unknown as string), null);
  assert.equal(sanitizeDeviceLabel(["x"] as unknown as string), null);
});

test("a sanitized-null device label renders as the generic fallback, never breaking the view", async () => {
  const h = createHarness();
  const uid = await newUser(h, "label-1");
  const current = await h.sessions.issue({ userId: uid, assuranceLevel: "aal2", deviceLabel: sanitizeDeviceLabel("\u0007bell") });
  const [summary] = await h.sessions.listSessions(current.session);
  assert.equal(summary.deviceLabel, "MovenRun mobile");
});
