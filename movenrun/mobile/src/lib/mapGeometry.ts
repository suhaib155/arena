/**
 * Geometry for drawing a session on a real geographic map.
 *
 * Platform-free by design — no `react-native`, no map provider, no I/O — so
 * every decision the map makes about *where things go* is unit-testable on
 * plain Node, and swapping the provider cannot change the answers.
 *
 * ## The one rule this module exists to keep
 *
 * **A missing section of route is never drawn as a line.**
 *
 * The app tracks in the foreground only. Switch apps mid-walk, lose the fix,
 * or pause, and there is a span where the route genuinely was not observed. A
 * single `<Polyline>` over every point would connect the last fix before that
 * span to the first fix after it, and draw a straight line the player never
 * walked — across a park, through a building, over a river. It would look like
 * evidence, and it would be a fabrication.
 *
 * {@link routeSegments} splits the route wherever the *domain* says evidence
 * broke, using the same {@link hasEvidenceBreak} that
 * `@movenrun/shared/evidence` uses to refuse the distance for that span. The
 * line on the map and the number under it therefore break in exactly the same
 * places, because they ask the same function. There is no second opinion here
 * about what a gap is.
 *
 * ## What this module does not do
 *
 * No distance, no sealing, no crossing detection, no cell membership. Those
 * belong to the shared domain and are already answered there. This module
 * turns points into things a camera and a polyline can consume, and nothing
 * about a route's *meaning* is decided in it.
 */
import { hasEvidenceBreak } from "@movenrun/shared/evidence";
import { haversineMeters } from "@movenrun/shared/geo";
import type { PauseSource, SealRoutePoint } from "@movenrun/shared/sealing";

/** A coordinate in the shape every map provider accepts. */
export interface LatLng {
  latitude: number;
  longitude: number;
}

/** A map viewport, in the shape `react-native-maps` accepts. */
export interface MapRegion extends LatLng {
  latitudeDelta: number;
  longitudeDelta: number;
}

/** A geographic box. */
export interface Bounds {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
}

/**
 * The smallest viewport we will ever ask for, in degrees of latitude.
 *
 * Roughly 55 m of ground. Without a floor, a player standing still — or one
 * whose session is two fixes a metre apart — produces a zero-span box, and the
 * camera zooms to a level where the basemap has no tiles and the route is a
 * dot on grey. A floor is not a fabrication: it widens the *view*, never the
 * route.
 */
export const MIN_SPAN_DEGREES = 0.0005;

/**
 * Fraction of the fitted span left as breathing room around the route.
 *
 * The route should not touch the edges of the map — a polyline flush against
 * the frame reads as a route that continues off-screen.
 */
export const DEFAULT_PADDING_RATIO = 0.25;

/** Degrees of latitude per metre. Used only to size a viewport, never to
 *  measure a route: distance is the shared domain's answer, not this file's. */
const DEGREES_PER_METER_LAT = 1 / 111_320;

/**
 * Split a route into the spans that were actually observed.
 *
 * Each returned segment is a run of consecutive fixes with no evidence break
 * between them, so it can be drawn as one continuous line truthfully. A break
 * ends the current segment and starts a new one; nothing bridges them.
 *
 * Single-point segments are kept rather than dropped. A one-fix span is a real
 * thing that happened — the tracker recovered, produced one fix, and lost the
 * signal again — and the caller decides whether a lone point is worth a dot.
 * Dropping it here would quietly discard observed evidence.
 */
export function routeSegments<P extends SealRoutePoint>(
  points: readonly P[],
  pauses: PauseSource = [],
): P[][] {
  const segments: P[][] = [];
  let current: P[] = [];
  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    if (i > 0 && hasEvidenceBreak(points[i - 1]!, point, pauses)) {
      if (current.length > 0) segments.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

/**
 * Segments long enough to draw as a line, as plain coordinates.
 *
 * A polyline needs two points. This drops the lone-fix spans {@link
 * routeSegments} deliberately keeps, because a "line" through one point is not
 * a line — see {@link isolatedFixes} for the other half.
 */
export function polylineSegments<P extends SealRoutePoint>(
  points: readonly P[],
  pauses: PauseSource = [],
): LatLng[][] {
  return routeSegments(points, pauses)
    .filter((segment) => segment.length >= 2)
    .map((segment) => segment.map(toLatLng));
}

/** Observed spans that are a single fix, which no polyline can represent. */
export function isolatedFixes<P extends SealRoutePoint>(
  points: readonly P[],
  pauses: PauseSource = [],
): LatLng[] {
  return routeSegments(points, pauses)
    .filter((segment) => segment.length === 1)
    .map((segment) => toLatLng(segment[0]!));
}

/** Strip a route point down to what a map needs. */
export function toLatLng(point: LatLng): LatLng {
  return { latitude: point.latitude, longitude: point.longitude };
}

/**
 * The box containing every point, or null when there are none.
 *
 * Null rather than a default location: there is no honest viewport for a route
 * that does not exist, and a fallback coordinate would put the player
 * somewhere they have never been.
 */
export function boundsOf(points: readonly LatLng[]): Bounds | null {
  if (points.length === 0) return null;
  let minLatitude = Infinity;
  let maxLatitude = -Infinity;
  let minLongitude = Infinity;
  let maxLongitude = -Infinity;
  for (const point of points) {
    if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) continue;
    if (point.latitude < minLatitude) minLatitude = point.latitude;
    if (point.latitude > maxLatitude) maxLatitude = point.latitude;
    if (point.longitude < minLongitude) minLongitude = point.longitude;
    if (point.longitude > maxLongitude) maxLongitude = point.longitude;
  }
  if (!Number.isFinite(minLatitude) || !Number.isFinite(minLongitude)) return null;
  return { minLatitude, maxLatitude, minLongitude, maxLongitude };
}

export interface RegionOptions {
  /** Breathing room as a fraction of the span. */
  paddingRatio?: number;
  /** Smallest latitude span to allow, in degrees. */
  minSpanDegrees?: number;
}

/**
 * A viewport that contains the box, padded and floored.
 *
 * Longitude is widened by 1/cos(latitude) so the view covers a comparable
 * amount of *ground* east-west as north-south. Without it, a route walked at a
 * high latitude is squeezed: a degree of longitude is a fraction of a degree of
 * latitude on the ground, so an unadjusted equal-degree box shows far less
 * width than height. The correction is clamped near the poles, where the
 * scaling runs away and no sane viewport exists.
 */
export function regionForBounds(bounds: Bounds, options: RegionOptions = {}): MapRegion {
  const paddingRatio = options.paddingRatio ?? DEFAULT_PADDING_RATIO;
  const minSpan = options.minSpanDegrees ?? MIN_SPAN_DEGREES;

  const latitude = (bounds.minLatitude + bounds.maxLatitude) / 2;
  const longitude = (bounds.minLongitude + bounds.maxLongitude) / 2;

  const latSpan = bounds.maxLatitude - bounds.minLatitude;
  const lngSpan = bounds.maxLongitude - bounds.minLongitude;

  const padded = 1 + Math.max(0, paddingRatio);
  /* cos() of a latitude approaching the poles tends to zero, and dividing by it
     tends to infinity. 0.05 caps the widening at 20x, which is far past any
     inhabited latitude a player walks at. */
  const cosLat = Math.max(0.05, Math.cos((latitude * Math.PI) / 180));

  const latitudeDelta = Math.max(latSpan * padded, minSpan);
  const longitudeDelta = Math.max(lngSpan * padded, minSpan / cosLat);

  return { latitude, longitude, latitudeDelta, longitudeDelta };
}

/** A viewport containing the route, or null when there is no route. */
export function regionForPoints(
  points: readonly LatLng[],
  options: RegionOptions = {},
): MapRegion | null {
  const bounds = boundsOf(points);
  return bounds === null ? null : regionForBounds(bounds, options);
}

/**
 * A viewport centred on one coordinate, spanning roughly `radiusMeters`.
 *
 * Used for the follow camera, where the question is "how much ground around
 * the player" rather than "what contains the route".
 */
export function regionAround(centre: LatLng, radiusMeters: number): MapRegion {
  const latDelta = Math.max(radiusMeters * 2 * DEGREES_PER_METER_LAT, MIN_SPAN_DEGREES);
  const cosLat = Math.max(0.05, Math.cos((centre.latitude * Math.PI) / 180));
  return {
    latitude: centre.latitude,
    longitude: centre.longitude,
    latitudeDelta: latDelta,
    longitudeDelta: latDelta / cosLat,
  };
}

/**
 * Whether two viewports are close enough that moving between them is not worth
 * a camera command.
 *
 * The follow camera is fed by GPS fixes, which arrive every few metres. Issuing
 * an animation for a sub-metre change fights the user's own panning and burns
 * frames for a move nobody can see.
 */
export function regionsClose(
  a: MapRegion | null,
  b: MapRegion | null,
  epsilonDegrees = 1e-5,
): boolean {
  if (a === null || b === null) return a === b;
  return (
    Math.abs(a.latitude - b.latitude) < epsilonDegrees &&
    Math.abs(a.longitude - b.longitude) < epsilonDegrees &&
    Math.abs(a.latitudeDelta - b.latitudeDelta) < epsilonDegrees &&
    Math.abs(a.longitudeDelta - b.longitudeDelta) < epsilonDegrees
  );
}

/**
 * The last observed fix, or null.
 *
 * "Where the player is" for map purposes is the head of the route and nothing
 * else. There is no interpolation toward an expected position and no carrying
 * forward of a stale fix as though it were current.
 */
export function routeHead<P extends LatLng>(points: readonly P[]): P | null {
  return points.length > 0 ? points[points.length - 1]! : null;
}

/** The first observed fix, or null — where the session began. */
export function routeStart<P extends LatLng>(points: readonly P[]): P | null {
  return points.length > 0 ? points[0]! : null;
}

/* ── privacy ──────────────────────────────────────────────────────────────── */

/** Default radius hidden around each end of a shared route, in metres. */
export const DEFAULT_PRIVACY_RADIUS_M = 200;

/**
 * Hide the ground around both ends of a route before it is shown to anyone
 * else.
 *
 * A route's two most sensitive points are where it started and where it
 * stopped, because for most people that is one address. This removes every fix
 * within `radiusMeters` of *either* end.
 *
 * ## Why a radius and not a trim along the path
 *
 * Trimming the first and last N points looks equivalent and is not. A loop that
 * passes the front door in the middle — which is what an out-and-back or a
 * couple of laps around the block looks like — leaves the address exposed in
 * the part that was kept. A radius removes those passes too, wherever in the
 * route they occur.
 *
 * ## Why the survivors are re-marked
 *
 * Removing a run of points leaves two survivors that were never adjacent. Drawn
 * naively they would be joined by a straight line across the removed ground —
 * a line that points directly at the thing being hidden, and the most
 * eye-catching stroke on the map. So the first fix after each removed run is
 * marked `breakBefore`, and {@link routeSegments} then splits there like any
 * other gap. The redacted map has a hole in it, which is the honest shape of a
 * route with something removed.
 *
 * Distance is measured with the shared domain's geodesic — there is no second
 * implementation of it here.
 */
export function redactEndpoints<P extends SealRoutePoint>(
  points: readonly P[],
  radiusMeters: number = DEFAULT_PRIVACY_RADIUS_M,
): P[] {
  if (points.length === 0 || radiusMeters <= 0) return [...points];
  const first = points[0]!;
  const last = points[points.length - 1]!;

  const kept: P[] = [];
  let removedSincePrevious = false;
  for (const point of points) {
    const hidden =
      haversineMeters(first, point) <= radiusMeters ||
      haversineMeters(last, point) <= radiusMeters;
    if (hidden) {
      removedSincePrevious = true;
      continue;
    }
    /* Only after something was actually dropped, and never on the first
       surviving fix — there is nothing before it to bridge to. */
    kept.push(removedSincePrevious && kept.length > 0 ? { ...point, breakBefore: true } : point);
    removedSincePrevious = false;
  }
  return kept;
}
