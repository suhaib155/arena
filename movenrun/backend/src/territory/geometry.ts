/**
 * Territory geometry — coordinates, distance, polygons, area, self-intersection,
 * point-in-polygon and bounding boxes.
 *
 * ## Why this is hand-rolled rather than Turf
 * The four operations actually needed here (spherical ring area, segment
 * self-intersection, ray-cast point-in-polygon, bbox) are a few dozen lines
 * each and are covered by unit tests below. Pulling in `@turf/*` would add five
 * packages and a transitive tree to the backend for that, against the
 * repository's standing "no casual new dependencies" rule. The ring-area
 * formula used is the standard spherical one (the same one Turf implements), so
 * results agree to floating-point noise.
 *
 * ## Coordinate order
 * Everything **exported** in polygon/ring form is GeoJSON: `[longitude,
 * latitude]`. Route points arrive as `{ lat, lng }` (the shape the existing GPS
 * pipeline uses) and are converted at the boundary by `routeToRing`.
 *
 * Imports nothing — see `backend/src/territory/config.ts` for why.
 */

/** A route point in the shape the existing GPS pipeline already uses. */
export interface GeoPoint {
  lat: number;
  lng: number;
  accuracy?: number;
  timestamp?: number;
}

/** GeoJSON position: `[longitude, latitude]`. */
export type Position = [number, number];

/** A linear ring in GeoJSON order, first position repeated last. */
export type Ring = Position[];

export interface BoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

const EARTH_RADIUS_M = 6_371_008.8; // IUGG mean radius, as used by Turf.
const DEG_TO_RAD = Math.PI / 180;

/** Latitude/longitude range check. Rejects NaN and Infinity. */
export function isValidCoordinate(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/** Haversine distance in metres. */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = (b.lat - a.lat) * DEG_TO_RAD;
  const dLng = (b.lng - a.lng) * DEG_TO_RAD;
  const la = a.lat * DEG_TO_RAD;
  const lb = b.lat * DEG_TO_RAD;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total route length in metres along consecutive points. */
export function routeDistanceMeters(points: GeoPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineMeters(points[i - 1], points[i]);
  return total;
}

/**
 * Straight-line distance in metres between a route's first and last point.
 * Returns `null` when there are fewer than two points.
 */
export function getLoopClosureDistanceMeters(points: GeoPoint[]): number | null {
  if (points.length < 2) return null;
  return haversineMeters(points[0], points[points.length - 1]);
}

/**
 * Whether the route's endpoints are within `toleranceMeters` of each other.
 *
 * **This alone never means a route may capture territory.** A route that starts
 * and ends on the same doorstep but covers 12 m in 40 seconds satisfies this and
 * must still be rejected — see `evaluateLoopCapture` in `capture.ts`, which
 * additionally requires movement, duration, distance, area, geometry validity
 * and GPS quality.
 */
export function isClosedLoop(points: GeoPoint[], toleranceMeters: number): boolean {
  const closure = getLoopClosureDistanceMeters(points);
  return closure !== null && closure <= toleranceMeters;
}

/**
 * Convert a route into a closed GeoJSON linear ring, dropping invalid
 * coordinates and consecutive duplicates. Returns `null` when fewer than three
 * distinct positions survive — that cannot bound an area.
 */
export function routeToRing(points: GeoPoint[]): Ring | null {
  const ring: Ring = [];
  for (const point of points) {
    if (!isValidCoordinate(point.lat, point.lng)) continue;
    const position: Position = [point.lng, point.lat];
    const previous = ring[ring.length - 1];
    if (previous && previous[0] === position[0] && previous[1] === position[1]) continue;
    ring.push(position);
  }
  // A repeated closing position from the source shouldn't count as a corner.
  if (
    ring.length >= 2 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
  ) {
    ring.pop();
  }
  if (ring.length < 3) return null;
  ring.push([ring[0][0], ring[0][1]]);
  return ring;
}

/**
 * Normalise an arbitrary ring: validate every position, drop consecutive
 * duplicates, and ensure it is explicitly closed. Returns `null` when the
 * result cannot form a polygon.
 */
export function normalizePolygonCoordinates(ring: Position[]): Ring | null {
  return routeToRing(ring.map(([lng, lat]) => ({ lat, lng })));
}

/**
 * Spherical area of a closed ring, in square metres. Always non-negative, so
 * winding order does not matter.
 *
 * Uses the standard spherical-excess formula for a polygon on a sphere:
 *   A = R²/2 · Σ (λ₂ − λ₁)(2 + sin φ₁ + sin φ₂)
 */
export function polygonAreaSquareMeters(ring: Ring): number {
  if (ring.length < 4) return 0;
  let total = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[i + 1];
    total +=
      (lng2 - lng1) * DEG_TO_RAD * (2 + Math.sin(lat1 * DEG_TO_RAD) + Math.sin(lat2 * DEG_TO_RAD));
  }
  return Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}

/** Bounding box of a ring, in degrees. */
export function boundingBox(ring: Ring): BoundingBox {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return { west, south, east, north };
}

/**
 * Ray-casting point-in-polygon test against a single ring. Points exactly on an
 * edge are not guaranteed either way (the classic ray-cast caveat); territory
 * decisions never hinge on a single boundary point, so that is acceptable.
 */
export function pointInPolygon(point: Position, ring: Ring): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Orientation sign of the triple (a, b, c): >0 left turn, <0 right, 0 collinear. */
function cross(a: Position, b: Position, c: Position): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a: Position, b: Position, p: Position): boolean {
  return (
    Math.min(a[0], b[0]) <= p[0] &&
    p[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= p[1] &&
    p[1] <= Math.max(a[1], b[1])
  );
}

/** Proper or improper intersection of segments a1a2 and b1b2. */
function segmentsIntersect(a1: Position, a2: Position, b1: Position, b2: Position): boolean {
  const d1 = cross(b1, b2, a1);
  const d2 = cross(b1, b2, a2);
  const d3 = cross(a1, a2, b1);
  const d4 = cross(a1, a2, b2);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  // Collinear-overlap cases.
  if (d1 === 0 && onSegment(b1, b2, a1)) return true;
  if (d2 === 0 && onSegment(b1, b2, a2)) return true;
  if (d3 === 0 && onSegment(a1, a2, b1)) return true;
  if (d4 === 0 && onSegment(a1, a2, b2)) return true;
  return false;
}

/**
 * Does the ring cross itself?
 *
 * Adjacent segments legitimately share an endpoint (and the last segment shares
 * one with the first), so those pairs are skipped. Everything else is compared
 * with an x-sweep: segments are visited in order of their minimum longitude and
 * only tested against still-active segments whose maximum longitude has not been
 * passed. For route-shaped input — which is spatially coherent — that keeps the
 * active set small; the worst case is still quadratic, which is why route length
 * is capped upstream (`routes/gps.ts` allows at most 10 000 points).
 */
export function hasSelfIntersection(ring: Ring): boolean {
  const segmentCount = ring.length - 1;
  if (segmentCount < 4) return false;

  const order = Array.from({ length: segmentCount }, (_, i) => i).sort(
    (a, b) => Math.min(ring[a][0], ring[a + 1][0]) - Math.min(ring[b][0], ring[b + 1][0]),
  );

  const active: number[] = [];
  for (const i of order) {
    const iMin = Math.min(ring[i][0], ring[i + 1][0]);

    // Retire segments entirely to the left of the sweep line.
    for (let k = active.length - 1; k >= 0; k--) {
      const j = active[k];
      if (Math.max(ring[j][0], ring[j + 1][0]) < iMin) active.splice(k, 1);
    }

    for (const j of active) {
      // Skip adjacent segments, and the first/last pair which close the ring.
      const adjacent =
        Math.abs(i - j) === 1 ||
        (Math.min(i, j) === 0 && Math.max(i, j) === segmentCount - 1);
      if (adjacent) continue;
      if (segmentsIntersect(ring[i], ring[i + 1], ring[j], ring[j + 1])) return true;
    }
    active.push(i);
  }
  return false;
}

/** A GeoJSON LineString feature from route points. `null` below two points. */
export function routeToLineString(points: GeoPoint[]): {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: "LineString"; coordinates: Position[] };
} | null {
  const coordinates = points
    .filter((p) => isValidCoordinate(p.lat, p.lng))
    .map((p): Position => [p.lng, p.lat]);
  if (coordinates.length < 2) return null;
  return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } };
}

/** A GeoJSON Polygon feature from a closed ring. */
export function ringToPolygonFeature(
  ring: Ring,
  properties: Record<string, unknown> = {},
): {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: "Polygon"; coordinates: Ring[] };
} {
  return { type: "Feature", properties, geometry: { type: "Polygon", coordinates: [ring] } };
}
