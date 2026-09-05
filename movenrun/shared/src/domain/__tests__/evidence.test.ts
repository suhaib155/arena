import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createCanonicalEvidence, crossingWitnesses, evidenceDistance, hasEvidenceBreak,
  MAX_CANONICAL_POINTS, MAX_SIMPLIFICATION_DISTANCE_LOSS, SIMPLIFICATION_TOLERANCE_M,
} from "../evidence";
import { createSealScanner, sealingRulesFor, type PauseSource, type SealRoutePoint } from "../sealing";
import { cellBoundary, cellForCoordinate } from "../h3";
import { EARTH_RADIUS_M, haversineMeters, projector } from "../geo";
import type { PauseInterval } from "../session";

const ORIGIN = { latitude: 37.7749, longitude: -122.4194 };
const T0 = 1_780_000_000_000;
const RULES = sealingRulesFor(1)!;
const DEG = Math.PI / 180;
type XY = readonly [number, number];
function at(x: number, y: number, origin = ORIGIN) {
  return { latitude: origin.latitude + y / EARTH_RADIUS_M / DEG,
    longitude: origin.longitude + x / EARTH_RADIUS_M / DEG / Math.cos(origin.latitude * DEG) };
}
function route(xy: readonly XY[]): SealRoutePoint[] {
  return xy.map(([x, y], i) => ({ ...at(x, y), timestamp: T0 + i * 4000 }));
}
function poly(vertices: readonly XY[], step = 5.3): XY[] {
  const result: XY[] = [];
  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1]!, b = vertices[i]!;
    const count = Math.max(1, Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let j = 0; j < count; j++) result.push([
      a[0] + (b[0] - a[0]) * j / count, a[1] + (b[1] - a[1]) * j / count,
    ]);
  }
  result.push(vertices[vertices.length - 1]!);
  return result;
}
function scan(points: readonly SealRoutePoint[], pauses: PauseSource = []) {
  const scanner = createSealScanner(RULES, pauses);
  for (const point of points) scanner.push(point);
  return scanner;
}

test("a banked trail releases its dead search index while its event remains replayable", () => {
  const points = route([[-20, 0], [20, 0], [25, 20], [-10, 20], [-10, -10], [0, -10]]);
  const scanner = createSealScanner(RULES);
  let sawClosure = false;
  for (const point of points) {
    if (scanner.push(point).length) {
      sawClosure = true;
      assert.equal(scanner.indexedReferences, 0);
      assert.ok(scanner.events.length > 0);
    }
  }
  assert.equal(sawClosure, true);
  assert.equal(scanner.events.length, scan(points).events.length);
});
function h3Traversal(points: readonly SealRoutePoint[], pauses: PauseSource = []) {
  const cells: string[] = [];
  for (let i = 0; i < points.length; i++) {
    if (i > 0 && (hasEvidenceBreak(points[i - 1]!, points[i]!, pauses) ||
      haversineMeters(points[i - 1]!, points[i]!) > RULES.continuityBreakMeters)) cells.push("|");
    const cell = cellForCoordinate(points[i]!);
    if (cells[cells.length - 1] !== cell) cells.push(cell);
  }
  return cells;
}
function breakWitnesses(points: readonly SealRoutePoint[], pauses: PauseSource = []) {
  return points.flatMap((point, i) => i > 0 && (hasEvidenceBreak(points[i - 1]!, point, pauses) ||
    haversineMeters(points[i - 1]!, point) > RULES.continuityBreakMeters)
    ? [[points[i - 1]!.timestamp, point.timestamp]] : []);
}
function maximumDeviation(original: readonly SealRoutePoint[], retained: readonly SealRoutePoint[]) {
  const frame = projector(original[0]!);
  const byTime = new Map(original.map((point, i) => [point.timestamp, i]));
  let maximum = 0;
  for (let i = 1; i < retained.length; i++) {
    const start = byTime.get(retained[i - 1]!.timestamp)!, end = byTime.get(retained[i]!.timestamp)!;
    const a = frame.project(retained[i - 1]!), b = frame.project(retained[i]!);
    const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
    for (let j = start + 1; j < end; j++) {
      const p = frame.project(original[j]!);
      const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
      maximum = Math.max(maximum, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
    }
  }
  return maximum;
}
function capture(points: readonly SealRoutePoint[], pauses: PauseSource = []) {
  const evidence = createCanonicalEvidence<SealRoutePoint>(RULES, pauses);
  for (const point of points) assert.equal(evidence.push(point).represented, true);
  return evidence;
}
function assertCompleteParity(points: readonly SealRoutePoint[], pauses: PauseSource = [], exactRawWitnesses = true) {
  const evidence = capture(points, pauses), snapshot = evidence.snapshot();
  const original = scan(points, pauses), replay = scan(snapshot, pauses);
  assert.equal(evidence.status, "complete");
  assert.ok(snapshot.length <= MAX_CANONICAL_POINTS);
  assert.equal(snapshot[0], points[0]);
  assert.equal(snapshot[snapshot.length - 1], points[points.length - 1]);
  assert.deepEqual(h3Traversal(snapshot, pauses), h3Traversal(points, pauses));
  assert.deepEqual(breakWitnesses(snapshot, pauses), breakWitnesses(points, pauses));
  assert.equal(crossingWitnesses(evidence.events, snapshot), crossingWitnesses(replay.events, snapshot));
  if (exactRawWitnesses) {
    assert.equal(crossingWitnesses(original.events, points), crossingWitnesses(replay.events, snapshot));
  } else {
    // Future intersections use the canonical line already committed by compaction.
    // Compare geometry in order, while canonical replay above remains exact.
    assert.equal(original.events.length, replay.events.length);
    for (let i = 0; i < original.events.length; i++) {
      const before = original.events[i]!, after = replay.events[i]!;
      assert.equal(before.method, after.method);
      assert.equal(before.closure.kind, "crossing");
      assert.equal(after.closure.kind, "crossing");
      if (before.closure.kind !== "crossing" || after.closure.kind !== "crossing") continue;
      const a = points[before.startIndex - 1]!, b = points[before.startIndex]!;
      const c = snapshot[after.startIndex - 1]!, d = snapshot[after.startIndex]!;
      const rawCrossing = { latitude: a.latitude + (b.latitude - a.latitude) * before.closure.priorFraction,
        longitude: a.longitude + (b.longitude - a.longitude) * before.closure.priorFraction };
      const canonicalCrossing = { latitude: c.latitude + (d.latitude - c.latitude) * after.closure.priorFraction,
        longitude: c.longitude + (d.longitude - c.longitude) * after.closure.priorFraction };
      assert.ok(haversineMeters(rawCrossing, canonicalCrossing) <= SIMPLIFICATION_TOLERANCE_M);
    }
  }
  assert.deepEqual(replay.unavailable, original.unavailable);
  assert.equal(replay.subpathCount, original.subpathCount);
  const measured = evidenceDistance(points, pauses), represented = evidenceDistance(snapshot, pauses);
  assert.ok(Math.abs(evidence.distanceMeters - represented) < 0.000001);
  assert.ok(measured - represented <= measured * MAX_SIMPLIFICATION_DISTANCE_LOSS + 0.000001);
  assert.ok(maximumDeviation(points, snapshot) <= SIMPLIFICATION_TOLERANCE_M + 0.000001);
  assert.equal(JSON.stringify(evidence.snapshot()), JSON.stringify(snapshot));
  assert.equal(JSON.stringify(capture(points, pauses).snapshot()), JSON.stringify(snapshot));
  return evidence;
}

for (const count of [2047, 2048, 2049, 5000, 10000]) {
  test(`canonical evidence remains complete across the display boundary: ${count} accepted fixes`, () => {
    const points = route(Array.from({ length: count }, (_, i) => [i * 2.5, 0.04 * Math.sin(i / 17)] as const));
    const evidence = assertCompleteParity(points);
    assert.ok(evidence.stats.removed > 0);
    assert.ok(evidence.stats.retained < points.length * 0.7);
    // The rolling original window remains exact, including timestamps and coordinates.
    assert.deepEqual(evidence.snapshot().slice(-256), points.slice(-256));
  });
}

const LOOP_VERTICES: XY[] = [[-250, 0], [250, 0], [250, 200], [-200, 200], [-200, -200],
  [450, -200], [450, 100], [0, 100], [0, -300], [650, -300], [650, 150], [400, 150], [400, -400]];
const ordinary: { name: string; xy: XY[]; expectedEvents?: number }[] = [
  { name: "urban corners", xy: poly([[0, 0], [400, 0], [400, 250], [750, 250], [750, 500], [350, 500], [350, 750], [0, 750], [0, 0]]) },
  { name: "square", xy: poly([[0, 0], [900, 0], [900, 900], [0, 900], [0, 0]]) },
  { name: "figure eight", xy: Array.from({ length: 1001 }, (_, i) => {
    const t = (i + 0.37) * Math.PI * 2 / 1000;
    return [600 * Math.sin(t), 300 * Math.sin(2 * t)] as const;
  }), expectedEvents: 1 },
  { name: "multiple loops", xy: poly(LOOP_VERTICES), expectedEvents: 3 },
  { name: "out and back", xy: poly([[0, 0], [2500, 0], [0, 0]]) },
  { name: "jitter", xy: Array.from({ length: 1500 }, (_, i) => [i * 3, 0.4 * Math.sin(i * 1.7) + 0.8 * Math.sin(i * 0.19)] as const) },
];
for (const fixture of ordinary) test(`canonical ${fixture.name} preserves route facts and retry bytes`, () => {
  const evidence = assertCompleteParity(route(fixture.xy), [], fixture.name !== "figure eight");
  if (fixture.expectedEvents !== undefined) assert.equal(evidence.events.length, fixture.expectedEvents);
});

test("closed pause replacement is read by the live scanner and later compaction", () => {
  const points = route(poly([[0, 0], [800, 0], [800, 400], [0, 400], [0, -200]], 5));
  let pauses: PauseInterval[] = [];
  const source = () => pauses;
  const evidence = createCanonicalEvidence<SealRoutePoint>(RULES, source);
  const pauseIndex = 161;
  for (let i = 0; i < points.length; i++) {
    if (i === pauseIndex) pauses = [{ startedAt: points[i - 1]!.timestamp + 1, endedAt: points[i]!.timestamp - 1 }];
    evidence.push(points[i]!);
  }
  assert.equal(scan(evidence.snapshot(), source).subpathCount, 2);
  assert.deepEqual(breakWitnesses(evidence.snapshot(), source), breakWitnesses(points, source));
  assert.deepEqual(h3Traversal(evidence.snapshot(), source), h3Traversal(points, source));
  assert.equal(crossingWitnesses(evidence.events, evidence.snapshot()), crossingWitnesses(scan(evidence.snapshot(), source).events, evidence.snapshot()));
  assertCompleteParity(points, source);
});

test("explicit gap preserves both endpoints without bridging distance or scanner geometry", () => {
  const first = poly([[0, 0], [800, 0]], 5), second = poly([[1400, 0], [1400, 800], [0, 800]], 5);
  const points = route([...first, ...second]);
  points[first.length] = { ...points[first.length]!, breakBefore: true };
  const evidence = assertCompleteParity(points);
  assert.equal(scan(evidence.snapshot()).subpathCount, 2);
  assert.ok(evidence.distanceMeters < 3001);
});

test("unmarked distance discontinuity cannot be manufactured or erased by compaction", () => {
  const points = route([...poly([[0, 0], [800, 0]], 5), ...poly([[1400, 0], [1400, 800]], 5)]);
  const evidence = assertCompleteParity(points);
  assert.equal(scan(evidence.snapshot()).subpathCount, 2);
});

test("announced shallow crossing and its entire original loop slice stay pinned", () => {
  const shallow = poly([[-20, 0], [20, 0], [25, 20], [-25, 20], [-25, 0.04], [-15, 0.04], [-10, -0.04], [-5, 0.04], [0, 0.04]], 5);
  const points = route([...shallow, ...Array.from({ length: 1200 }, (_, i) => [(i + 1) * 3, 0.04] as const)]);
  const evidence = createCanonicalEvidence<SealRoutePoint>(RULES);
  let pinned: SealRoutePoint[] = [], witness = "";
  for (const point of points) {
    const result = evidence.push(point);
    if (result.closed && pinned.length === 0) {
      const snapshot = evidence.snapshot(), event = evidence.events[0]!;
      pinned = snapshot.slice(event.startIndex - 1, event.endIndex + 2);
      witness = crossingWitnesses(evidence.events, snapshot);
    }
  }
  assert.ok(pinned.length > 0);
  assert.equal(evidence.events.length, 1);
  const snapshot = evidence.snapshot();
  assert.equal(crossingWitnesses(evidence.events, snapshot), witness);
  for (const point of pinned) assert.equal(snapshot.find(candidate => candidate.timestamp === point.timestamp), point);
  assert.ok(evidence.stats.compactedChunks > 0);
  assertCompleteParity(points);
});

test("collinear endpoint contacts never become new crossing claims during compaction", () => {
  const points = route(poly(LOOP_VERTICES, 5));
  assert.equal(scan(points).events.length, 0);
  const evidence = assertCompleteParity(points);
  assert.equal(evidence.events.length, 0);
});

test("a sub-decimetre H3 boundary excursion survives old-chunk compaction", () => {
  const boundary = cellBoundary(cellForCoordinate(ORIGIN)), a = boundary[0]!, b = boundary[1]!;
  const center = { latitude: (a.latitude + b.latitude) / 2, longitude: (a.longitude + b.longitude) / 2 };
  const project = projector(center), pa = project.project(a), pb = project.project(b);
  const length = Math.hypot(pb.x - pa.x, pb.y - pa.y), ux = (pb.x - pa.x) / length, uy = (pb.y - pa.y) / length;
  const points: SealRoutePoint[] = Array.from({ length: 1200 }, (_, i) => {
    const along = (i - 10) * 5, normal = i === 10 ? -0.04 : 0.04;
    return { ...at(along * ux - normal * uy, along * uy + normal * ux, center), timestamp: T0 + i * 4000 };
  });
  assert.equal(h3Traversal(points.slice(0, 21)).length, 3);
  const evidence = assertCompleteParity(points);
  assert.ok(evidence.stats.compactedChunks > 0);
  for (const i of [9, 10, 11]) assert.ok(evidence.snapshot().some(point => point.timestamp === points[i]!.timestamp));
});

test("small cross-track error cannot spend more than the measured-distance loss budget", () => {
  const points = route(Array.from({ length: 1500 }, (_, i) => [i * 2.5, i % 2 ? 0.04 : -0.04] as const));
  const evidence = assertCompleteParity(points);
  assert.ok(evidence.stats.rejectedCompactions > 0, "the geometric tolerance alone admits excessive cumulative loss");
});

test("a closure arriving on the compaction tick is pinned before old evidence changes", () => {
  const xy: XY[] = Array.from({ length: 256 }, (_, i) => [i * 2.5, 0] as const);
  for (let i = 1; i <= 128; i++) xy.push([637.5, i * 300 / 128]);
  for (let i = 1; i <= 126; i++) xy.push([637.5 - i * (637.5 - 21.25) / 126, 300]);
  xy.push([21.25, 10], [21.25, -10]);
  const points = route(xy);
  assert.equal(points.length, 512);
  const raw = scan(points);
  assert.equal(raw.events.length, 1);
  const evidence = capture(points);
  assert.equal(crossingWitnesses(evidence.events, evidence.snapshot()), crossingWitnesses(raw.events, points));
});

test("capacity freezes represented evidence and claims while accepted scalar distance continues", () => {
  const shallow = poly([[-20, 0], [20, 0], [25, 20], [-25, 20], [-25, 0.04], [-15, 0.04], [-10, -0.04], [-5, 0.04], [0, 0.04]], 5);
  const points = route([...shallow, ...Array.from({ length: 10_500 }, (_, i) => [(i + 1) * 3, i % 2 === 0 ? 2 : -2] as const)]);
  const evidence = createCanonicalEvidence<SealRoutePoint>(RULES);
  let frozenJSON: string | undefined, frozenWitnesses = "", distanceAtCapacity = 0, ignored = 0;
  for (const point of points) {
    const result = evidence.push(point);
    if (!result.represented) {
      assert.equal(result.closed, false);
      ignored += 1;
      if (frozenJSON === undefined) {
        frozenJSON = JSON.stringify(evidence.snapshot());
        frozenWitnesses = crossingWitnesses(evidence.events, evidence.snapshot());
        distanceAtCapacity = evidence.distanceMeters;
      }
    }
  }
  assert.ok(ignored > 0);
  assert.equal(evidence.status, "capacity_limited");
  assert.equal(evidence.stats.retained, MAX_CANONICAL_POINTS);
  assert.equal(evidence.stats.received, points.length);
  assert.equal(JSON.stringify(evidence.snapshot()), frozenJSON);
  assert.equal(crossingWitnesses(evidence.events, evidence.snapshot()), frozenWitnesses);
  assert.ok(evidence.events.length >= 1);
  assert.ok(evidence.distanceMeters > distanceAtCapacity + 100);
  assert.equal(crossingWitnesses(scan(evidence.snapshot()).events, evidence.snapshot()), frozenWitnesses);
  assert.ok(Math.abs(evidence.distanceMeters - (evidenceDistance(points) - evidence.stats.distanceLossMeters)) < 0.000001);
  evidence.clear();
  assert.equal(evidence.status, "capacity_limited");
  assert.deepEqual(evidence.snapshot(), []);
  assert.deepEqual(evidence.events, []);
  assert.equal(evidence.distanceMeters, 0);
  assert.deepEqual(evidence.stats, { received: 0, retained: 0, chunks: 0, compactedChunks: 0,
    rejectedCompactions: 0, removed: 0, distanceLossMeters: 0 });
  const nextSession = route([[0, -10], [0, 10]]);
  for (const point of nextSession) assert.deepEqual(evidence.push(point), { represented: false, closed: false });
  assert.deepEqual(evidence.snapshot(), []);
  assert.equal(evidence.distanceMeters, 0);
  assert.equal(evidence.stats.received, 0);
  const fresh = capture(nextSession);
  assert.deepEqual(fresh.snapshot(), nextSession);
  assert.ok(Math.abs(fresh.distanceMeters - 20) < 0.001);
});
