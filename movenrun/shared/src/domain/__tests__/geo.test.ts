/**
 * Route geometry.
 *
 * Two things are proven here and they are different in kind. The distance
 * function is checked against known ground truth, because "within 150 metres"
 * is a claim about the world. The planar work is checked for *topology* —
 * whether two segments cross, and where along each — because that is the only
 * thing sealing asks of it, and it is the property that survives the
 * projection's error.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEGENERATE_SEGMENT_M,
  EARTH_RADIUS_M,
  MAX_PROJECTION_RADIUS_M,
  PARAM_EPSILON,
  RouteGeometryError,
  haversineMeters,
  interpolateCoordinate,
  normalizeLongitudeDelta,
  projector,
  segmentCrossing,
} from "../geo";

const BENGALURU = { latitude: 12.9716, longitude: 77.5946 };

/* ── distance ─────────────────────────────────────────────────────────────── */

test("distance is zero for one place and symmetric for two", () => {
  assert.equal(haversineMeters(BENGALURU, BENGALURU), 0);
  const other = { latitude: 12.98, longitude: 77.6 };
  assert.equal(
    haversineMeters(BENGALURU, other).toFixed(6),
    haversineMeters(other, BENGALURU).toFixed(6),
  );
});

test("a degree of latitude is about 111 km, anywhere", () => {
  for (const latitude of [0, 12.97, 51.5, 71.2]) {
    const d = haversineMeters({ latitude, longitude: 0 }, { latitude: latitude + 1, longitude: 0 });
    assert.ok(Math.abs(d - 111_195) < 50, `${latitude}° gave ${d} m`);
  }
});

test("a degree of longitude shrinks with latitude, as the globe requires", () => {
  const equator = haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 });
  const reykjavik = haversineMeters({ latitude: 64, longitude: 0 }, { latitude: 64, longitude: 1 });
  assert.ok(Math.abs(equator - 111_195) < 50);
  /* cos(64°) ≈ 0.438 — the whole reason a planar test on raw degrees would be
     a different rule in Iceland than in Bengaluru. */
  assert.ok(Math.abs(reykjavik - equator * Math.cos((64 * Math.PI) / 180)) < 100);
});

test("the antimeridian is metres away, not half a planet", () => {
  const west = { latitude: -16.5, longitude: 179.9995 };
  const east = { latitude: -16.5, longitude: -179.9995 };
  const d = haversineMeters(west, east);
  assert.ok(d < 120, `crossing 180° measured ${d} m`);
  assert.ok(d > 100, `crossing 180° measured ${d} m`);
});

test("a longitude delta always lands in (-180, 180]", () => {
  assert.equal(normalizeLongitudeDelta(0), 0);
  assert.equal(normalizeLongitudeDelta(180), 180);
  assert.equal(normalizeLongitudeDelta(-180), 180);
  assert.equal(normalizeLongitudeDelta(359.999).toFixed(6), (-0.001).toFixed(6));
  assert.equal(normalizeLongitudeDelta(-359.999).toFixed(6), (0.001).toFixed(6));
  for (const d of [-720, -361, -1, 1, 361, 720]) {
    const n = normalizeLongitudeDelta(d);
    assert.ok(n > -180 && n <= 180, `${d} normalised to ${n}`);
  }
});

/* ── the local frame ──────────────────────────────────────────────────────── */

test("the origin projects to the origin", () => {
  const p = projector(BENGALURU).project(BENGALURU);
  assert.equal(p.x, 0);
  assert.equal(p.y, 0);
});

test("projected metres agree with geodesic metres at session scale", () => {
  /* The claim the projection actually has to support: over the distances a
     route covers, planar length is the same number geodesic length is. */
  const frame = projector(BENGALURU);
  for (const [dLat, dLon] of [
    [0.001, 0],
    [0, 0.001],
    [0.01, 0.01],
    [-0.02, 0.03],
  ]) {
    const other = { latitude: BENGALURU.latitude + dLat, longitude: BENGALURU.longitude + dLon };
    const planar = frame.project(other);
    const planarLength = Math.hypot(planar.x, planar.y);
    const geodesic = haversineMeters(BENGALURU, other);
    const error = Math.abs(planarLength - geodesic);
    assert.ok(error < 0.5, `${dLat},${dLon}: planar ${planarLength} vs geodesic ${geodesic}`);
  }
});

test("the frame holds at high latitude, where longitude degrees are short", () => {
  const tromso = { latitude: 69.65, longitude: 18.96 };
  const frame = projector(tromso);
  const east = { latitude: 69.65, longitude: 18.96 + 0.01 };
  const planar = frame.project(east);
  const geodesic = haversineMeters(tromso, east);
  assert.ok(Math.abs(Math.hypot(planar.x, planar.y) - geodesic) < 0.5);
  /* And it is genuinely shorter than the same delta at the equator, rather
     than the frame having quietly ignored latitude. */
  assert.ok(planar.x < 400, `${planar.x} m for 0.01° of longitude at 69.65°`);
});

test("a route straddling the antimeridian projects continuously", () => {
  const frame = projector({ latitude: -16.5, longitude: 179.999 });
  const across = frame.project({ latitude: -16.5, longitude: -179.999 });
  assert.ok(Math.abs(across.x) < 300, `x jumped to ${across.x} m across 180°`);
});

test("a pole is refused rather than collapsing every longitude onto a line", () => {
  assert.throws(() => projector({ latitude: 90, longitude: 0 }), RouteGeometryError);
  assert.throws(() => projector({ latitude: -90, longitude: 12 }), RouteGeometryError);
});

test("an invalid origin or coordinate is refused, never wrapped onto real ground", () => {
  assert.throws(() => projector({ latitude: 91, longitude: 0 }), RouteGeometryError);
  const frame = projector(BENGALURU);
  assert.throws(() => frame.project({ latitude: 1000, longitude: 0 }), RouteGeometryError);
  assert.throws(() => frame.project({ latitude: 12, longitude: Number.NaN }), RouteGeometryError);
});

test("past the trusted radius the frame refuses instead of guessing", () => {
  const frame = projector({ latitude: 0, longitude: 0 });
  const inside = frame.project({ latitude: 0.8, longitude: 0 });
  assert.ok(Math.hypot(inside.x, inside.y) < MAX_PROJECTION_RADIUS_M);
  assert.throws(() => frame.project({ latitude: 1.2, longitude: 0 }), RouteGeometryError);
});

test("the trusted radius is a real bound and not a token value", () => {
  /* Sized against the Earth, not against a session: it is the distance past
     which this module stops vouching for its own arithmetic. */
  assert.ok(MAX_PROJECTION_RADIUS_M > 10_000);
  assert.ok(MAX_PROJECTION_RADIUS_M < EARTH_RADIUS_M / 10);
});

/* ── crossings ────────────────────────────────────────────────────────────── */

const P = (x: number, y: number) => ({ x, y });

test("two segments crossing at their middles meet at the middle of each", () => {
  const c = segmentCrossing(P(-10, 0), P(10, 0), P(0, -10), P(0, 10));
  assert.ok(c);
  assert.equal(c!.s.toFixed(9), (0.5).toFixed(9));
  assert.equal(c!.t.toFixed(9), (0.5).toFixed(9));
});

test("the fractions locate the crossing, not just its existence", () => {
  /* Horizontal 0..100, vertical at x = 25 — a quarter of the way along. */
  const c = segmentCrossing(P(0, 0), P(100, 0), P(25, -5), P(25, 15));
  assert.ok(c);
  assert.equal(c!.s.toFixed(9), (0.25).toFixed(9));
  assert.equal(c!.t.toFixed(9), (0.25).toFixed(9));
});

test("segments that miss each other do not cross", () => {
  assert.equal(segmentCrossing(P(0, 0), P(10, 0), P(0, 5), P(10, 5)), null);
  assert.equal(segmentCrossing(P(0, 0), P(10, 0), P(20, -5), P(20, 5)), null);
});

test("a T-junction touching an endpoint is not a crossing", () => {
  /* The vertical segment stops exactly on the horizontal one. Touching the
     line you already ran is what GPS noise does; cutting through it is not. */
  assert.equal(segmentCrossing(P(0, 0), P(10, 0), P(5, 5), P(5, 0)), null);
  assert.equal(segmentCrossing(P(0, 0), P(10, 0), P(5, 0), P(5, 5)), null);
});

test("meeting at a shared endpoint is not a crossing", () => {
  assert.equal(segmentCrossing(P(0, 0), P(10, 0), P(10, 0), P(10, 10)), null);
});

test("collinear overlap is not a crossing, so retracing a road never seals", () => {
  // Exact reverse along the same line.
  assert.equal(segmentCrossing(P(0, 0), P(10, 0), P(10, 0), P(0, 0)), null);
  // Partial overlap.
  assert.equal(segmentCrossing(P(0, 0), P(10, 0), P(5, 0), P(15, 0)), null);
  // Fully contained.
  assert.equal(segmentCrossing(P(0, 0), P(10, 0), P(3, 0), P(7, 0)), null);
  // Parallel but offset by a centimetre — still not a cut.
  assert.equal(segmentCrossing(P(0, 0), P(10, 0), P(10, 0.01), P(0, 0.01)), null);
});

test("a zero-length or sub-centimetre segment has no direction to cross", () => {
  assert.equal(segmentCrossing(P(5, 5), P(5, 5), P(0, 0), P(10, 10)), null);
  assert.equal(segmentCrossing(P(0, 0), P(10, 10), P(5, 5), P(5, 5)), null);
  const tiny = DEGENERATE_SEGMENT_M / 2;
  assert.equal(segmentCrossing(P(0, 0), P(tiny, 0), P(0, -1), P(0, 1)), null);
});

test("crossing is symmetric in its arguments, with the fractions swapped", () => {
  const a0 = P(-3, -1);
  const a1 = P(7, 4);
  const b0 = P(2, 6);
  const b1 = P(4, -6);
  const forward = segmentCrossing(a0, a1, b0, b1);
  const backward = segmentCrossing(b0, b1, a0, a1);
  assert.ok(forward && backward);
  assert.equal(forward!.s.toFixed(9), backward!.t.toFixed(9));
  assert.equal(forward!.t.toFixed(9), backward!.s.toFixed(9));
});

test("the interior epsilon is a degeneracy guard, not a proximity radius", () => {
  /* If it were a radius, it would be measured in metres and would be large
     enough to matter to a player. It is a fraction, and on the shortest
     segment the tracker can produce it excludes a few nanometres. */
  assert.ok(PARAM_EPSILON < 1e-6);
  const shortestSegmentM = 2;
  assert.ok(PARAM_EPSILON * shortestSegmentM < 1e-6, "the guard excludes a visible length");
});

test("a crossing a nanometre inside the end still counts; one at the end does not", () => {
  const nudge = 1e-4; // 0.1 mm along a 100 m segment
  assert.ok(segmentCrossing(P(0, 0), P(100, 0), P(nudge, -1), P(nudge, 1)));
  assert.equal(segmentCrossing(P(0, 0), P(100, 0), P(0, -1), P(0, 1)), null);
});

/* ── reconstruction ───────────────────────────────────────────────────────── */

test("a fraction turns back into the coordinate it came from", () => {
  const a = { latitude: 12.9, longitude: 77.5 };
  const b = { latitude: 12.91, longitude: 77.52 };
  assert.deepEqual(interpolateCoordinate(a, b, 0), a);
  const mid = interpolateCoordinate(a, b, 0.5);
  assert.equal(mid.latitude.toFixed(9), (12.905).toFixed(9));
  assert.equal(mid.longitude.toFixed(9), (77.51).toFixed(9));
  const end = interpolateCoordinate(a, b, 1);
  assert.equal(end.latitude.toFixed(9), b.latitude.toFixed(9));
  assert.equal(end.longitude.toFixed(9), b.longitude.toFixed(9));
});

test("interpolation crosses the antimeridian the short way", () => {
  const a = { latitude: 0, longitude: 179.9 };
  const b = { latitude: 0, longitude: -179.9 };
  const mid = interpolateCoordinate(a, b, 0.5);
  /* The short way is through 180, not back through Greenwich. */
  assert.ok(Math.abs(mid.longitude) > 179.9, `midpoint landed at ${mid.longitude}`);
});
