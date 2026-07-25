/**
 * Route → GeoJSON conversion for the live map.
 *
 * ## Coordinate order
 * GeoJSON positions are **`[longitude, latitude]`** — always, everywhere, with
 * no exceptions. `RouteSample` (and every other MovenRun point type) is
 * `{ latitude, longitude }`, so every conversion in this file flips the pair.
 * Getting this backwards puts London in the Indian Ocean and silently produces
 * a valid-looking but wrong capture polygon, which is why
 * `src/lib/__tests__/routeGeoJson.test.ts` asserts the order explicitly rather
 * than only asserting shape.
 *
 * ## Simplification
 * `simplifyRouteForRendering` exists purely so MapLibre isn't handed 20 000
 * vertices. It is **never** applied to the evidence uploaded to the backend:
 * the server recomputes distance, traversed cells, closure and area from the
 * full raw sample list (see PHASE 18), and a simplified route would change all
 * four.
 */
import type { Feature, FeatureCollection, LineString, Polygon, Position } from "geojson";
import {
  isValidCoordinate,
  sampleDistanceMeters,
  type RouteSample,
} from "./routeSample";

/** Anything with a latitude and longitude — `RouteSample`, `TrackPoint`, … */
export interface LatLngLike {
  latitude: number;
  longitude: number;
}

export { isValidCoordinate };

/** Convert one point to a GeoJSON position. Always `[longitude, latitude]`. */
export function toPosition(point: LatLngLike): Position {
  return [point.longitude, point.latitude];
}

/** Drop any point whose coordinate is out of range or non-finite. */
export function validCoordinatesOnly<T extends LatLngLike>(points: T[]): T[] {
  return points.filter((p) => isValidCoordinate(p.latitude, p.longitude));
}

/**
 * A LineString feature for the route. Returns `null` for fewer than two valid
 * points — GeoJSON requires at least two positions in a LineString, and an
 * invalid feature makes MapLibre drop the whole source silently.
 */
export function pointsToLineString(
  points: LatLngLike[],
  properties: Record<string, unknown> = {},
): Feature<LineString> | null {
  const valid = validCoordinatesOnly(points);
  if (valid.length < 2) return null;
  return {
    type: "Feature",
    properties,
    geometry: { type: "LineString", coordinates: valid.map(toPosition) },
  };
}

/** Wrap the route line (when there is one) in a FeatureCollection. */
export function pointsToFeatureCollection(
  points: LatLngLike[],
  properties: Record<string, unknown> = {},
): FeatureCollection {
  const line = pointsToLineString(points, properties);
  return { type: "FeatureCollection", features: line ? [line] : [] };
}

/**
 * Close the route into a Polygon by repeating the first position last.
 *
 * Returns `null` for fewer than four distinct valid points — a polygon ring
 * needs at least three corners plus the repeated closing position. This does
 * **not** decide whether the loop is *valid* for capture; that is the server's
 * job (closure distance, area, self-intersection, duration, GPS quality). This
 * only produces the geometry a preview can be drawn from.
 */
export function closeRoutePolygon(points: LatLngLike[]): Feature<Polygon> | null {
  const valid = validCoordinatesOnly(points);
  if (valid.length < 3) return null;

  const ring = valid.map(toPosition);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]]);
  }
  // After closing, a ring needs 4 positions (3 corners + repeat).
  if (ring.length < 4) return null;

  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [ring] },
  };
}

/**
 * Approximate route length in metres (haversine over consecutive points).
 * A client-side estimate for the live UI — the server recomputes the
 * authoritative distance from the raw evidence.
 */
export function calculateApproximateDistance(points: LatLngLike[]): number {
  const valid = validCoordinatesOnly(points);
  let total = 0;
  for (let i = 1; i < valid.length; i++) {
    total += sampleDistanceMeters(valid[i - 1], valid[i]);
  }
  return total;
}

/**
 * Straight-line distance in metres from the last point back to the first — how
 * far the runner still is from closing the loop. Returns `null` when there
 * aren't yet two valid points to measure between.
 */
export function calculateClosureDistance(points: LatLngLike[]): number | null {
  const valid = validCoordinatesOnly(points);
  if (valid.length < 2) return null;
  return sampleDistanceMeters(valid[0], valid[valid.length - 1]);
}

/**
 * Ramer–Douglas–Peucker simplification, **for rendering only**.
 *
 * `toleranceMeters` is the maximum distance a dropped vertex may be from the
 * retained line. The first and last points are always kept, so the closure
 * indicator still measures against the true start.
 */
export function simplifyRouteForRendering<T extends LatLngLike>(
  points: T[],
  toleranceMeters = 4,
  maxPoints = 600,
): T[] {
  const valid = validCoordinatesOnly(points);
  if (valid.length <= 2) return valid;

  let simplified = douglasPeucker(valid, toleranceMeters);

  // Hard ceiling: if the route is so long that even simplification leaves too
  // many vertices, drop evenly-spaced ones. Head and tail are always kept.
  if (simplified.length > maxPoints) {
    const step = (simplified.length - 1) / (maxPoints - 1);
    const capped: T[] = [];
    for (let i = 0; i < maxPoints; i++) {
      capped.push(simplified[Math.round(i * step)]);
    }
    simplified = capped;
  }
  return simplified;
}

/**
 * Perpendicular distance in metres from `point` to the segment `start`→`end`,
 * using a local equirectangular projection. Accurate enough at route scale
 * (metres over hundreds of metres) and far cheaper than repeated haversine.
 */
function perpendicularDistanceMeters(
  point: LatLngLike,
  start: LatLngLike,
  end: LatLngLike,
): number {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon =
    metersPerDegreeLat * Math.cos((start.latitude * Math.PI) / 180);

  const px = (point.longitude - start.longitude) * metersPerDegreeLon;
  const py = (point.latitude - start.latitude) * metersPerDegreeLat;
  const ex = (end.longitude - start.longitude) * metersPerDegreeLon;
  const ey = (end.latitude - start.latitude) * metersPerDegreeLat;

  const segmentLengthSquared = ex * ex + ey * ey;
  if (segmentLengthSquared === 0) return Math.hypot(px, py);

  // Project onto the segment, clamped to its endpoints.
  const t = Math.max(0, Math.min(1, (px * ex + py * ey) / segmentLengthSquared));
  return Math.hypot(px - t * ex, py - t * ey);
}

function douglasPeucker<T extends LatLngLike>(points: T[], toleranceMeters: number): T[] {
  if (points.length <= 2) return points;

  let maxDistance = 0;
  let index = 0;
  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const distance = perpendicularDistanceMeters(points[i], start, end);
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }

  if (maxDistance <= toleranceMeters) return [start, end];

  const left = douglasPeucker(points.slice(0, index + 1), toleranceMeters);
  const right = douglasPeucker(points.slice(index), toleranceMeters);
  // `index` appears in both halves — drop the duplicate.
  return [...left.slice(0, -1), ...right];
}

/**
 * Build everything the live map needs from the accepted samples of a run, in
 * one pass: the simplified render line, the closure distance, and the
 * provisional closed polygon (only once there is enough geometry for one).
 */
export interface LiveRouteGeoJson {
  line: Feature<LineString> | null;
  polygon: Feature<Polygon> | null;
  closureDistanceMeters: number | null;
  distanceMeters: number;
  renderedPointCount: number;
}

export function buildLiveRouteGeoJson(
  samples: RouteSample[],
  options: { toleranceMeters?: number; maxPoints?: number } = {},
): LiveRouteGeoJson {
  const rendered = simplifyRouteForRendering(
    samples,
    options.toleranceMeters ?? 4,
    options.maxPoints ?? 600,
  );
  return {
    line: pointsToLineString(rendered),
    polygon: closeRoutePolygon(rendered),
    // Closure and distance are measured on the FULL sample list, never on the
    // simplified render copy — simplification would shift both.
    closureDistanceMeters: calculateClosureDistance(samples),
    distanceMeters: calculateApproximateDistance(samples),
    renderedPointCount: rendered.length,
  };
}
