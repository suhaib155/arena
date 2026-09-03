/**
 * Route geometry: the metric and planar primitives sealing is built on.
 *
 * One implementation, shared by the phone's live preview and the server's
 * authoritative evaluation, because two implementations that agree today are
 * two implementations that will disagree later. Everything here is pure: no
 * clock, no I/O, no randomness, no platform API.
 *
 * ## Two different jobs, two different models
 *
 * **Distance** is geodesic. "Within 150 metres of where you started" is a
 * statement about the ground, and a planar approximation of it would be a
 * different rule wearing the same number. {@link haversineMeters} answers it.
 *
 * **Intersection** is planar, in a local tangent frame. Latitude and longitude
 * are not a Cartesian system — a degree of longitude is 111 km at the equator
 * and 20 km in Reykjavík — so running a segment-intersection test directly on
 * degrees would make a crossing's existence depend on where in the world it
 * happened. {@link projector} builds an equirectangular frame around one origin
 * and converts to metres east/north; segment tests run there.
 *
 * ## Why equirectangular is enough, and where it stops being enough
 *
 * The projection's error grows with distance from its origin, roughly as
 * `(d/R)²/6` in relative terms — about 4 metres at 100 km. That sounds like a
 * lot until you ask what the error does to an *intersection*: two segments only
 * cross if they are within a few metres of each other, and over that separation
 * the frame is locally consistent to well under a millimetre. Topology — did
 * these two segments cross, and where along each — survives. Absolute position
 * is not what the answer depends on.
 *
 * Past {@link MAX_PROJECTION_RADIUS_M} the assumption is no longer defended, so
 * {@link projector} refuses rather than returning quietly wrong geometry. A
 * session that spans more than 100 km from its own start is not a walk, and a
 * seal computed from a frame we cannot vouch for would be worse than no seal.
 *
 * ## Antimeridian
 *
 * Longitude differences are normalised into (−180, 180], so a route straddling
 * the 180th meridian projects continuously instead of jumping 40 000 km. Both
 * the distance and the projection do this, and both are tested there.
 */
import { isValidCoordinate, type GeoCoordinate } from "./h3";

/** Mean Earth radius, matching the value the movement pipeline already uses. */
export const EARTH_RADIUS_M = 6_371_000;

const DEG = Math.PI / 180;

/**
 * Longitude difference, wrapped into (−180, 180].
 *
 * Exported because every consumer of a longitude delta needs the same wrap, and
 * a second one written inline is how an antimeridian bug gets in.
 */
export function normalizeLongitudeDelta(degrees: number): number {
  let d = degrees;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d;
}

/**
 * Great-circle distance in metres.
 *
 * The `asin` form rather than `atan2`: both are exact for the distances this
 * product cares about, and this one is the shorter statement of the same
 * identity. The longitude delta is wrapped first, so a pair either side of the
 * antimeridian measures metres rather than half the planet.
 */
export function haversineMeters(a: GeoCoordinate, b: GeoCoordinate): number {
  const dLat = (b.latitude - a.latitude) * DEG;
  const dLon = normalizeLongitudeDelta(b.longitude - a.longitude) * DEG;
  const la = a.latitude * DEG;
  const lb = b.latitude * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* ── the local frame ──────────────────────────────────────────────────────── */

/** A point in the session's local tangent frame. Metres east and north of the
 *  frame's origin — never degrees, and never screen pixels. */
export interface PlanarPoint {
  x: number;
  y: number;
}

/**
 * How far from its origin a local frame is trusted, in metres.
 *
 * Not a gameplay limit and not a session limit: it is the distance past which
 * this module stops vouching for its own arithmetic. A route reaching beyond it
 * fails closed — see {@link projector}.
 */
export const MAX_PROJECTION_RADIUS_M = 100_000;

/** Thrown when geometry is asked for something it cannot answer honestly. */
export class RouteGeometryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteGeometryError";
  }
}

export interface Projector {
  /** The coordinate the frame is centred on. */
  readonly origin: GeoCoordinate;
  /** Project a coordinate into metres east/north of the origin. */
  project(coordinate: GeoCoordinate): PlanarPoint;
}

/**
 * Build a local tangent frame centred on `origin`.
 *
 * The scale factor `cos(latitude)` is taken from the **origin** and held fixed
 * for every point, which is what makes the frame a frame: a per-point scale
 * would stretch differently at each end of a segment and the straight line
 * between two fixes would stop being straight.
 *
 * Projection refuses a coordinate further than {@link MAX_PROJECTION_RADIUS_M}
 * from the origin, and refuses an origin at a pole, where the frame degenerates
 * (`cos(90°) = 0` collapses every longitude onto one line).
 */
export function projector(origin: GeoCoordinate): Projector {
  if (!isValidCoordinate(origin)) {
    throw new RouteGeometryError("Local frame origin is not a valid coordinate");
  }
  const cos = Math.cos(origin.latitude * DEG);
  if (Math.abs(cos) < 1e-6) {
    throw new RouteGeometryError("Local frame origin is too close to a pole");
  }
  return {
    origin,
    project(coordinate: GeoCoordinate): PlanarPoint {
      if (!isValidCoordinate(coordinate)) {
        throw new RouteGeometryError("Cannot project an invalid coordinate");
      }
      const x =
        EARTH_RADIUS_M * normalizeLongitudeDelta(coordinate.longitude - origin.longitude) * DEG * cos;
      const y = EARTH_RADIUS_M * (coordinate.latitude - origin.latitude) * DEG;
      if (Math.hypot(x, y) > MAX_PROJECTION_RADIUS_M) {
        throw new RouteGeometryError("Coordinate lies outside the local frame's trusted radius");
      }
      return { x, y };
    },
  };
}

/* ── segment intersection ─────────────────────────────────────────────────── */

/**
 * A segment shorter than this, in metres, carries no direction worth testing.
 *
 * Two identical fixes, or two a centimetre apart, define a line whose direction
 * is numerical noise; intersecting against it would produce an answer driven by
 * the last bit of a float. Such segments are skipped.
 */
export const DEGENERATE_SEGMENT_M = 0.01;

/**
 * Below this, the cross product of two segment directions (units: m²) is read
 * as parallel.
 *
 * This is the parallel test, and it is also what keeps a **collinear retrace**
 * out of the seal path: running back along the road you came down produces
 * parallel segments, and parallel segments never intersect here — see
 * {@link segmentCrossing}.
 */
export const PARALLEL_EPSILON_M2 = 1e-6;

/**
 * How far inside a segment an intersection must land, as a fraction of it.
 *
 * A **degeneracy guard, not a proximity radius** — the distinction matters
 * enough that a test asserts it. On the shortest segment the tracker can
 * produce (2 m), this excludes the outer two nanometres of each end. It exists
 * so that a crossing which is really an endpoint touch, arrived at through
 * floating point, is not read as a transverse cut.
 */
export const PARAM_EPSILON = 1e-9;

/**
 * Where two segments cross, as fractions along each.
 *
 * Fractions rather than a point: the caller already holds the route, so `s` and
 * `t` reconstruct the coordinate exactly when it is needed and carry no
 * location when it is not. Every consumer of this module downstream — seal
 * events, and later the territory geometry built from them — passes fractions
 * around instead of coordinates for that reason.
 */
export interface SegmentCrossing {
  /** Fraction along the first segment, strictly between 0 and 1. */
  s: number;
  /** Fraction along the second segment, strictly between 0 and 1. */
  t: number;
}

/**
 * A proper crossing of two planar segments, or null.
 *
 * "Proper" is the whole rule, and it is deliberately the narrowest reading of
 * *crossing your own line*:
 *
 *  - the segments are not parallel (so a collinear overlap is not a crossing);
 *  - neither is degenerate;
 *  - the intersection lies strictly inside **both**, so touching an endpoint is
 *    not a crossing.
 *
 * Endpoint contact is excluded because it is what GPS noise produces. A route
 * that doubles back on itself brushes its own vertices constantly; a genuine
 * transverse cut through the middle of an earlier segment is a different and
 * far more deliberate event. That choice is a hypothesis about the product, not
 * a mathematical necessity — `docs/SEALING_ENGINE.md` records it as one.
 */
export function segmentCrossing(
  a0: PlanarPoint,
  a1: PlanarPoint,
  b0: PlanarPoint,
  b1: PlanarPoint,
): SegmentCrossing | null {
  const ax = a1.x - a0.x;
  const ay = a1.y - a0.y;
  const bx = b1.x - b0.x;
  const by = b1.y - b0.y;

  if (Math.hypot(ax, ay) < DEGENERATE_SEGMENT_M) return null;
  if (Math.hypot(bx, by) < DEGENERATE_SEGMENT_M) return null;

  const denominator = ax * by - ay * bx;
  if (Math.abs(denominator) < PARALLEL_EPSILON_M2) return null;

  const dx = b0.x - a0.x;
  const dy = b0.y - a0.y;
  const s = (dx * by - dy * bx) / denominator;
  const t = (dx * ay - dy * ax) / denominator;

  if (s <= PARAM_EPSILON || s >= 1 - PARAM_EPSILON) return null;
  if (t <= PARAM_EPSILON || t >= 1 - PARAM_EPSILON) return null;
  return { s, t };
}

/** Linear interpolation between two coordinates, for reconstructing a crossing
 *  from the fractions above. Straight in the local frame, which is what the
 *  segment was assumed to be in the first place. */
export function interpolateCoordinate(
  a: GeoCoordinate,
  b: GeoCoordinate,
  fraction: number,
): GeoCoordinate {
  const f = Math.min(1, Math.max(0, fraction));
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * f,
    longitude: a.longitude + normalizeLongitudeDelta(b.longitude - a.longitude) * f,
  };
}
