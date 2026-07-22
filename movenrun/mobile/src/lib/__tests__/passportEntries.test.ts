/**
 * Passport route stamps — offline node tests. Verifies no-route state, entry
 * mapping, missing-metadata fallback, territory/trust mapping, and — critically
 * — that NO raw coordinate/route/path field is ever emitted.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPassportStamps } from "../passportEntries";
import type { RouteTrustRecord } from "../routeTrust";

function rec(p: Partial<RouteTrustRecord> = {}): RouteTrustRecord {
  return {
    id: `r-${Math.random()}`,
    createdAt: "2026-06-18T10:00:00.000Z",
    trustScore: 82,
    trustLabel: "Strong",
    explanation: "",
    positiveSignals: [],
    riskFlags: [],
    distanceMeters: 3200,
    durationSeconds: 1500,
    routeOutcome: "saved",
    zoneCountTouched: 0,
    defendedCount: 0,
    ...p,
  };
}

test("no routes → no stamps", () => {
  assert.deepEqual(buildPassportStamps([]), []);
});

test("maps a route to a safe stamp with real date/distance/duration/trust", () => {
  const [s] = buildPassportStamps([rec()]);
  assert.equal(s.dateLabel, "Jun 18");
  assert.equal(s.trustLabel, "Strong");
  assert.match(s.distanceLabel!, /km/);
  assert.ok(s.durationLabel);
  assert.equal(s.activity, "Movement route");
});

test("missing optional metadata degrades to null", () => {
  const [s] = buildPassportStamps([rec({ distanceMeters: 0, durationSeconds: 0 })]);
  assert.equal(s.distanceLabel, null);
  assert.equal(s.durationLabel, null);
});

test("territory result maps captured/defended and omits plain saves", () => {
  assert.equal(buildPassportStamps([rec({ routeOutcome: "captured" })])[0].territoryLabel, "Captured a zone");
  assert.match(buildPassportStamps([rec({ routeOutcome: "defended", defendedCount: 2 })])[0].territoryLabel!, /Defended 2 zones/);
  assert.equal(buildPassportStamps([rec({ routeOutcome: "saved" })])[0].territoryLabel, null);
});

test("respects the max and preserves newest-first order", () => {
  const many = Array.from({ length: 10 }, (_, i) => rec({ id: `r${i}` }));
  const stamps = buildPassportStamps(many, 6);
  assert.equal(stamps.length, 6);
  assert.equal(stamps[0].id, "r0");
});

test("no stamp exposes raw coordinate/route/path/location fields", () => {
  const [s] = buildPassportStamps([rec()]);
  const keys = Object.keys(s);
  for (const forbidden of ["lat", "lng", "latitude", "longitude", "coordinates", "coords", "points", "path", "location", "route"]) {
    assert.ok(!keys.includes(forbidden), `stamp must not expose ${forbidden}`);
  }
});
