/**
 * Rule set 1002's session path: derived from the verified fixes only,
 * stepped and interpolated units told apart, gaps never bridged, a bounded
 * size, compact storage, and the drift against the pipeline's resolution 8
 * cells measured on the route fixtures. No database.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cellToParent, getResolution, latLngToCell } from "h3-js";
import { cellsForObservations } from "@movenrun/shared/h3";
import {
  bitsToFlags, cellToInt8, deriveSessionPath, flagsToBits, int8ToCell, pushUnitsOf, sessionPathRuleProblems, steppedUnitsOf, VERIFIED_STEPS_V1,
  type PathFix,
} from "./path.js";
import { fixesOf, poly, ROUTE_FIXTURES, T0 } from "./pathFixtures.js";
import { verifyMovement } from "../movement/domain/verification.js";
import { MovementVerificationService } from "../movement/services/movementVerification.service.js";
import { InMemoryMovementVerificationRepository } from "../movement/repositories/interfaces.js";
import type { MovementObservation } from "../movement/domain/types.js";

const R = VERIFIED_STEPS_V1;
const LONDON = { latitude: 51.5, longitude: -0.12 };

/** A straight walk east at `speed` m/s with a fix every `everyMs`. */
function walkEast(meters: number, everyMs: number, speed = 1.4, origin = LONDON): PathFix[] {
  const step = speed * (everyMs / 1000);
  const xy = Array.from({ length: Math.floor(meters / step) + 1 }, (_, i) => [i * step, 0] as const);
  return fixesOf(xy, origin, everyMs);
}

test("the 1002 path rule is valid and inside the pipeline's own limits", () => {
  assert.deepEqual(sessionPathRuleProblems(R), []);
  assert.equal(R.resolution, 10);
  assert.ok(R.maxSegmentMeters <= 200, "never longer than the sealing continuity break");
  assert.ok(R.maxSpeedMetersPerSecond <= 12, "never faster than the on-foot policy");
  assert.ok(sessionPathRuleProblems({ ...R, maxSegmentMeters: 500 }).length > 0);
  assert.ok(sessionPathRuleProblems({ ...R, maxSpeedMetersPerSecond: 22 }).length > 0);
  assert.ok(sessionPathRuleProblems({ ...R, version: 2 as 1 }).length > 0);
});

test("stepped units hold a fix; interpolated units lie on a walked segment between two fixes; walk order is first touch", () => {
  // Two fixes 150 m apart in 100 s: the segment is walked and the units between are interpolated.
  const a = { lat: 51.5, lng: -0.12, timestamp: T0 };
  const b = { lat: 51.5, lng: -0.12 + 150 / (6_371_000 * Math.cos(51.5 * Math.PI / 180)) * (180 / Math.PI), timestamp: T0 + 100_000 };
  const path = deriveSessionPath([a, b], [], R);
  const ca = latLngToCell(a.lat, a.lng, 10), cb = latLngToCell(b.lat, b.lng, 10);
  assert.equal(path.units[0], ca);
  assert.equal(path.units[path.units.length - 1], cb);
  assert.deepEqual(steppedUnitsOf(path).sort(), [ca, cb].sort());
  assert.ok(path.units.length >= 2);
  for (const u of path.units) assert.equal(getResolution(u), 10);
  assert.equal(path.interpolated.filter(Boolean).length, path.units.length - 2);
  // A unit reached by interpolation and later stepped on is stepped, at its first-touch position.
  const back = deriveSessionPath([a, b, { ...a, timestamp: T0 + 200_000 }], [], R);
  assert.deepEqual(back.units, path.units);
  // Deterministic.
  assert.deepEqual(deriveSessionPath([a, b], [], R), path);
});

test("gaps are never bridged: a break, a pause, a segment over 200 m, over 120 s or over 12 m/s adds only its two ends", () => {
  const long = walkEast(600, 50_000, 1.4).filter((_, i) => i % 1 === 0); // fixes 70 m apart, 50 s apart: walked
  const walked = deriveSessionPath(long, [], R);
  assert.equal(walked.skippedSegments, 0);
  const ends = (fixes: PathFix[]) => new Set(fixes.map((f) => latLngToCell(f.lat, f.lng, 10)));
  const cases: [string, PathFix[], Parameters<typeof deriveSessionPath>[1]][] = [
    ["breakBefore", long.map((f, i) => (i > 0 ? { ...f, breakBefore: true } : f)), []],
    ["pause", long, [{ startedAt: T0, endedAt: T0 + 10 * 3_600_000 }]],
    ["too far (250 m)", walkEast(1000, 178_000, 1.4), []],
    ["too slow (130 s)", walkEast(600, 130_000, 0.5), []],
    ["too fast (13 m/s)", walkEast(600, 10_000, 13), []],
  ];
  for (const [name, fixes, pauses] of cases) {
    const p = deriveSessionPath(fixes, pauses, R);
    assert.equal(p.interpolated.filter(Boolean).length, 0, name);
    assert.deepEqual(new Set(p.units), ends(fixes), name);
    assert.equal(p.skippedSegments, fixes.length - 1, name);
  }
});

test("the path is bounded: at most maxUnits units, the rest dropped in walk order and flagged", () => {
  const far = walkEast(60_000, 5_000, 1.4); // about 60 km: many hundred resolution 10 units
  const full = deriveSessionPath(far, [], { ...R, maxUnits: 100_000 });
  assert.ok(full.units.length > R.maxUnits);
  const capped = deriveSessionPath(far, [], R);
  assert.equal(capped.units.length, R.maxUnits);
  assert.equal(capped.truncated, true);
  assert.deepEqual(capped.units, full.units.slice(0, R.maxUnits));
  assert.equal(deriveSessionPath(walkEast(500, 5_000), [], R).truncated, false);
});

test("compact storage round-trips: bigint ids and one bit per unit", () => {
  const path = deriveSessionPath(fixesOf(poly(ROUTE_FIXTURES[0]!.vertices, 25), ROUTE_FIXTURES[0]!.origin, 18_000), [], R);
  assert.deepEqual(path.units.map(cellToInt8).map(int8ToCell), path.units);
  assert.deepEqual(bitsToFlags(flagsToBits(path.interpolated), path.units.length), path.interpolated);
  assert.throws(() => cellToInt8("u-1"));
  assert.throws(() => bitsToFlags("01", 3));
  // 8 bytes a unit against a 15-character text id.
  assert.equal(Buffer.byteLength(path.units[0]!), 15);
});

test("pushes: interpolated units push under 1002's rule; the toll's crossed cells are stepped units only", () => {
  const path = { units: ["a", "b", "c"], interpolated: [false, true, false] };
  assert.deepEqual(pushUnitsOf(path, { pushInterpolated: true }), ["a", "b", "c"]);
  assert.deepEqual(pushUnitsOf(path, { pushInterpolated: false }), ["a", "c"]);
  assert.deepEqual(steppedUnitsOf(path), ["a", "c"]);
});

/* ── drift and coverage on the route fixtures ───────────────────────────── */

test("route fixtures: the resolution 10 path covers the walked ground, adds no unit off it, and its drift from resolution 8 is measured", () => {
  const rows: string[] = [];
  for (const spacing of [5.3, 25, 40]) {
    for (const f of ROUTE_FIXTURES) {
      const truth = new Set(fixesOf(poly(f.vertices, 1), f.origin, 1).map((p) => latLngToCell(p.lat, p.lng, 10)));
      const fixes = fixesOf(poly(f.vertices, spacing), f.origin, Math.round((spacing / 1.4) * 1000));
      const res8 = new Set<string>(cellsForObservations(fixes.map((p) => ({ latitude: p.lat, longitude: p.lng }))));
      const path = deriveSessionPath(fixes, [], R);
      const stepped = steppedUnitsOf(path);
      const recall = (s: string[]) => s.filter((c) => truth.has(c)).length / truth.size;
      // Interpolated units lie on the walked line: nothing off the route on these fixtures.
      assert.equal(path.units.filter((c) => !truth.has(c)).length, 0, `${f.name} @${spacing}`);
      assert.ok(recall(path.units) >= 0.96, `${f.name} @${spacing}: ${recall(path.units)}`);
      assert.ok(recall(path.units) >= recall(stepped));
      // Drift: the resolution 8 parent of a fix's resolution 10 cell is not always the fix's resolution 8 cell (H3 children do not nest exactly).
      const fixDrift = fixes.filter((p) => cellToParent(latLngToCell(p.lat, p.lng, 10), 8) !== latLngToCell(p.lat, p.lng, 8)).length / fixes.length;
      const outside = path.units.filter((c) => !res8.has(cellToParent(c, 8))).length;
      const parents = new Set(path.units.map((c) => cellToParent(c, 8)));
      assert.equal([...res8].filter((c) => !parents.has(c)).length, 0, "every resolution 8 cell the pipeline stored is under some unit of the path");
      assert.ok(fixDrift <= 0.1, `${f.name}: ${fixDrift}`);
      rows.push(`${f.name} @${spacing} m: res8 ${res8.size}, truth ${truth.size}, stepped ${stepped.length}, interpolated ${path.units.length - stepped.length}, `
        + `recall stepped ${recall(stepped).toFixed(3)} all ${recall(path.units).toFixed(3)}, units whose res8 parent is not stored ${outside}, fix parent drift ${(fixDrift * 100).toFixed(1)}%`);
    }
  }
  if (process.env.MOVENRUN_PRINT_MEASUREMENTS) console.log(rows.join("\n"));
});

/* ── the movement pipeline: derived from verified fixes only, flag-gated ── */

const NOW = T0 + 3_600_000;
function observation(fixes: PathFix[]): MovementObservation {
  return { startTime: fixes[0]!.timestamp, endTime: fixes[fixes.length - 1]!.timestamp, points: fixes.map((f) => ({ ...f, accuracy: 6 })) };
}
const baseDeps = {
  detectAnomalies: () => ({ isAnomaly: false, reasons: [] as string[], confidence: 0.95 }),
  calculateDistance: () => 1000,
  traversedHexIds: (points: { lat: number; lng: number }[]) => cellsForObservations(points.map((p) => ({ latitude: p.lat, longitude: p.lng }))),
  now: () => NOW,
};
const sessionPath = (o: MovementObservation) => deriveSessionPath(o.points, o.session?.pauses ?? [], R);

test("verification: an accepted session gets its path from its own fixes; a rejected one gets none; without the gameplay dependency nothing changes", () => {
  const obs = observation(walkEast(800, 5_000));
  const plain = verifyMovement(obs, baseDeps);
  const withPath = verifyMovement(obs, { ...baseDeps, sessionPath });
  assert.equal(plain.status, "verified");
  assert.equal("sessionPath" in plain, false, "flag off: the result is exactly as before");
  const { sessionPath: derived, ...rest } = withPath;
  assert.deepEqual(rest, plain);
  assert.deepEqual(derived, sessionPath(obs));
  const rejected = verifyMovement(obs, { ...baseDeps, sessionPath, detectAnomalies: () => ({ isAnomaly: true, reasons: ["x"], confidence: 0.2 }) });
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.sessionPath, undefined);
});

test("the movement service stores the path with the verification, once; a retry with other points changes nothing", async () => {
  const repository = new InMemoryMovementVerificationRepository();
  let n = 0;
  const service = new MovementVerificationService({ ...baseDeps, sessionPath, repository, generateId: () => `mv-${++n}` });
  const obs = observation(walkEast(800, 5_000));
  const first = await service.submit({ userId: "u1", clientSessionId: "s1", observation: obs });
  assert.equal(first.created, true);
  const stored = repository.sessionPaths.get(first.record.id)!;
  assert.deepEqual(stored, sessionPath(obs));
  // The client cannot replace the path by resubmitting other fixes under the same id.
  const other = observation(walkEast(800, 5_000, 1.4, { latitude: 48.85, longitude: 2.35 }));
  const again = await service.submit({ userId: "u1", clientSessionId: "s1", observation: other });
  assert.equal(again.created, false);
  assert.deepEqual(repository.sessionPaths.get(first.record.id), stored);
  // Without the dependency (gameplay off or 1001) no path is stored.
  const off = new InMemoryMovementVerificationRepository();
  await new MovementVerificationService({ ...baseDeps, repository: off, generateId: () => "mv-off" }).submit({ userId: "u1", clientSessionId: "s2", observation: obs });
  assert.equal(off.sessionPaths.size, 0);
});
