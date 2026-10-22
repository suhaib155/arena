/**
 * The synthetic local frame every fixture is drawn in.
 *
 * SYNTHETIC / NOT LIVE. The origin is a point in the open Atlantic chosen so
 * that no fixture can be mistaken for, or matched against, anyone's real street,
 * home or route. Geometry is described in metres east/north of the origin; the
 * "street block", "park loop" and similar words in fixture titles describe the
 * shape only, never a real place.
 */
const EARTH_RADIUS_M = 6_371_000;
const DEG = Math.PI / 180;

export interface LatLng { latitude: number; longitude: number }

export const SYNTHETIC_ORIGIN: LatLng = Object.freeze({ latitude: 0.5, longitude: -25.5 });

/** Metres east/north of an origin to a coordinate (equirectangular; fine under ~20 km). */
export function offset(origin: LatLng, eastM: number, northM: number): LatLng {
  const latitude = origin.latitude + (northM / EARTH_RADIUS_M) / DEG;
  const longitude = origin.longitude + (eastM / (EARTH_RADIUS_M * Math.cos(origin.latitude * DEG))) / DEG;
  return { latitude, longitude };
}

/** A 2D point in metres. */
export interface Xy { x: number; y: number }

export function lengthOf(path: readonly Xy[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
  return total;
}

/** Position at arc length `s` along a polyline (clamped to its ends). */
export function along(path: readonly Xy[], s: number): Xy {
  if (path.length === 0) return { x: 0, y: 0 };
  if (s <= 0) return path[0]!;
  let remaining = s;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (remaining <= seg && seg > 0) {
      const f = remaining / seg;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    remaining -= seg;
  }
  return path[path.length - 1]!;
}

/** Shapes used by the corpus, in metres. */
export const SHAPES = {
  /** An out-and-straight line east. */
  line: (meters: number): Xy[] => [{ x: 0, y: 0 }, { x: meters, y: 0 }],
  /** A rectangular "block" loop that returns to its start. */
  block: (width: number, height: number): Xy[] => [
    { x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }, { x: 0, y: 0 },
  ],
  /** An L-shaped route with one corner. */
  ell: (east: number, north: number): Xy[] => [{ x: 0, y: 0 }, { x: east, y: 0 }, { x: east, y: north }],
  /** A figure-eight that crosses itself once in the middle. */
  figureEight: (size: number): Xy[] => [
    { x: 0, y: 0 }, { x: size, y: size }, { x: size, y: 0 }, { x: 0, y: size }, { x: 0, y: 0 },
  ],
};
