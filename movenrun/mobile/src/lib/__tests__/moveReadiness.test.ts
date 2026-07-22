/**
 * Start Move readiness state machine — offline node tests.
 *
 * Verifies the honest states (checking / ready / permission-required /
 * permission-denied / location-unavailable / blocked), that "GPS Ready" is
 * NEVER claimed unless permission is granted and services are on, that an
 * existing validation block always wins, and that offline never blocks a
 * session (GPS is on-device).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveReadiness, type ReadinessInput } from "../moveReadiness";

function base(): ReadinessInput {
  return {
    permission: "granted",
    locationServicesOn: true,
    blockedReason: null,
    online: true,
  };
}

test("granted + services on + not blocked → ready, canStartGps", () => {
  const r = resolveReadiness(base());
  assert.equal(r.kind, "ready");
  assert.equal(r.canStartGps, true);
  assert.equal(r.tone, "ready");
});

test("only the ready state may enable a real GPS start", () => {
  const inputs: ReadinessInput[] = [
    { ...base(), permission: "checking" },
    { ...base(), permission: "undetermined" },
    { ...base(), permission: "denied" },
    { ...base(), locationServicesOn: false },
    { ...base(), blockedReason: "GPS integrity check pending" },
  ];
  for (const i of inputs) {
    const r = resolveReadiness(i);
    assert.equal(r.canStartGps, false, `canStartGps must be false for ${r.kind}`);
    assert.notEqual(r.kind, "ready");
  }
});

test("blocked reason wins over everything, even granted permission", () => {
  const r = resolveReadiness({ ...base(), blockedReason: "Anti-cheat: cooldown active" });
  assert.equal(r.kind, "blocked");
  assert.equal(r.canStartGps, false);
  assert.match(r.message, /cooldown/i);
});

test("checking is not blocked and is not ready", () => {
  const r = resolveReadiness({ ...base(), permission: "checking" });
  assert.equal(r.kind, "checking");
  assert.equal(r.offerDemo, false);
});

test("denied is actionable and offers the demo fallback", () => {
  const r = resolveReadiness({ ...base(), permission: "denied" });
  assert.equal(r.kind, "permission-denied");
  assert.equal(r.offerDemo, true);
  assert.equal(r.tone, "danger");
});

test("undetermined asks for permission (not a false 'ready')", () => {
  const r = resolveReadiness({ ...base(), permission: "undetermined" });
  assert.equal(r.kind, "permission-required");
  assert.equal(r.primaryLabel, "Allow Location");
  assert.equal(r.canStartGps, false);
});

test("location services off → unavailable, even with granted permission", () => {
  const r = resolveReadiness({ ...base(), locationServicesOn: false });
  assert.equal(r.kind, "location-unavailable");
  assert.equal(r.canStartGps, false);
});

test("offline never blocks: a granted user is still ready, with an offline note", () => {
  const r = resolveReadiness({ ...base(), online: false });
  assert.equal(r.kind, "ready");
  assert.equal(r.canStartGps, true);
  assert.ok(r.offlineNote && /offline/i.test(r.offlineNote));
});
