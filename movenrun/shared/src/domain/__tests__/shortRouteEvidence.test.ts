/** Short-route minimum evidence (MR-A-01). Synthetic open-ocean coordinates only. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_MIN_POINTS,
  SHORT_ROUTE_EVIDENCE,
  shortRouteEvidenceProblems,
  type ShortRouteFix,
} from "../evidence";

const T0 = Date.UTC(2026, 9, 22, 9, 0, 0);
const east = (metres: number) => -25 + metres / 111_320;

/** n fixes along a straight line, `step` metres and `seconds` apart. */
function walk(n: number, step = 35, seconds = 25, accuracy: number | null = 15): ShortRouteFix[] {
  return Array.from({ length: n }, (_, i) => ({
    latitude: 0.25, longitude: east(i * step), timestamp: T0 + i * seconds * 1000, accuracy,
  }));
}

test("an honest seven-fix 210 m walk at 15 m accuracy has enough evidence", () => {
  assert.deepEqual(shortRouteEvidenceProblems(walk(7)), []);
});

test("pace does not matter: the same route at a quarter of the speed passes", () => {
  assert.deepEqual(shortRouteEvidenceProblems(walk(7, 35, 100)), []);
});

test("routes at or above the legacy floor are not judged by the short-route policy", () => {
  assert.equal(LEGACY_MIN_POINTS, 10);
  assert.deepEqual(shortRouteEvidenceProblems(walk(10, 1, 1, null)), []);
});

test("fewer than five fixes fail with the count", () => {
  assert.deepEqual(shortRouteEvidenceProblems(walk(4)),
    [`Too few accepted GPS fixes for a short route: 4 (needs ${SHORT_ROUTE_EVIDENCE.minFixes})`]);
});

test("unknown, zero or weak accuracy fails", () => {
  for (const accuracy of [null, 0, 0.5, 26, Number.NaN]) {
    const problems = shortRouteEvidenceProblems(walk(7, 35, 25, accuracy));
    assert.ok(problems.some((p) => /reported accuracy/.test(p)), `${accuracy}: ${problems.join("; ")}`);
  }
});

test("less than 30 s of continuous observation fails", () => {
  const problems = shortRouteEvidenceProblems(walk(6, 20, 5, 5));
  assert.ok(problems.some((p) => /25 s of continuous observation/.test(p)), problems.join("; "));
});

test("segments across a pause or a foreground break do not count", () => {
  const points = walk(6);
  points[2] = { ...points[2]!, breakBefore: true };
  const pauses = [{ startedAt: points[4]!.timestamp - 2000, endedAt: points[4]!.timestamp - 1000 }];
  const problems = shortRouteEvidenceProblems(points, pauses);
  assert.ok(problems.some((p) => /continuous GPS segments for a short route: 3/.test(p)), problems.join("; "));
});

test("drift that never leaves the start fails; the bar scales with the worst accuracy", () => {
  const drift: ShortRouteFix[] = [[0, 0], [12, 0], [12, 12], [0, 12], [-6, 2], [6, 5]].map(([e, n], i) => ({
    latitude: 0.25 + n! / 111_320, longitude: east(e!), timestamp: T0 + i * 20_000, accuracy: 5,
  }));
  assert.ok(shortRouteEvidenceProblems(drift).some((p) => /GPS drift/.test(p)));
  // 5 fixes 15 m apart reach 60 m: fine at 15 m accuracy, not at 25 m (needs 75 m).
  assert.deepEqual(shortRouteEvidenceProblems(walk(5, 15, 25, 15)), []);
  assert.ok(shortRouteEvidenceProblems(walk(5, 15, 25, 25)).some((p) => /GPS drift/.test(p)));
});

test("a far fix across a break or pause does not satisfy the drift guard", () => {
  const drift: ShortRouteFix[] = [[0, 0], [12, 0], [12, 12], [0, 12], [-6, 2], [6, 5]].map(([e, n], i) => ({
    latitude: 0.25 + n! / 111_320, longitude: east(e!), timestamp: T0 + i * 20_000, accuracy: 5,
  }));
  const far = { latitude: 0.25, longitude: east(60), timestamp: T0 + 6 * 20_000, accuracy: 5 };
  // Displacement gained while the evidence was interrupted was never observed.
  assert.ok(shortRouteEvidenceProblems([...drift, { ...far, breakBefore: true }])
    .some((p) => /GPS drift/.test(p)));
  const pauses = [{ startedAt: far.timestamp - 15_000, endedAt: far.timestamp - 5_000 }];
  assert.ok(shortRouteEvidenceProblems([...drift, far], pauses).some((p) => /GPS drift/.test(p)));
});
