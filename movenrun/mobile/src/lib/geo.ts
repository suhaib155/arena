/**
 * Local geo math for movement sessions. Everything here is computed on-device
 * from foreground GPS samples — nothing is sent anywhere.
 */

export interface TrackPoint {
  latitude: number;
  longitude: number;
  /** ms epoch when the fix arrived. */
  timestamp: number;
  /** Reported horizontal accuracy in meters (null when unknown). */
  accuracy: number | null;
}

const EARTH_RADIUS_M = 6_371_000;

/** Haversine distance between two points, in meters. */
export function distanceMeters(a: TrackPoint, b: TrackPoint): number {
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const la = (a.latitude * Math.PI) / 180;
  const lb = (b.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Accuracy worse than this is treated as a poor fix and dropped. */
export const MAX_ACCURACY_M = 40;
/** Jumps implying speed above this (m/s ≈ 43 km/h) are treated as GPS glitches. */
export const MAX_PLAUSIBLE_SPEED_MS = 12;
/** Ignore micro-jitter below this distance between accepted points. */
export const MIN_STEP_M = 2;

/**
 * Decide whether a new fix should extend the route. Filters poor accuracy,
 * teleport glitches, and standing-still jitter.
 */
export function acceptPoint(prev: TrackPoint | null, next: TrackPoint): boolean {
  if (next.accuracy != null && next.accuracy > MAX_ACCURACY_M) return false;
  if (!prev) return true;
  const d = distanceMeters(prev, next);
  if (d < MIN_STEP_M) return false;
  const dt = Math.max(0.5, (next.timestamp - prev.timestamp) / 1000);
  if (d / dt > MAX_PLAUSIBLE_SPEED_MS) return false;
  return true;
}

/** Format meters as "0.0 km" / "320 m". */
export function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

/** Format elapsed milliseconds as "M:SS" / "H:MM:SS". */
export function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Pace as M'SS" per km, or null when there isn't enough signal yet. */
export function formatPace(meters: number, ms: number): string | null {
  if (meters < 150 || ms < 30_000) return null;
  const secPerKm = ms / 1000 / (meters / 1000);
  if (!isFinite(secPerKm) || secPerKm > 30 * 60) return null;
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}'${String(s).padStart(2, "0")}"`;
}

/**
 * Project route points to a unit box (0..1, y down) for drawing a route
 * preview without any map dependency. Keeps aspect ratio, centers the route.
 */
export function projectToBox(points: TrackPoint[]): { x: number; y: number }[] {
  if (points.length === 0) return [];
  const lat0 = points[0].latitude;
  const cos = Math.cos((lat0 * Math.PI) / 180);
  const xs = points.map((p) => p.longitude * cos);
  const ys = points.map((p) => -p.latitude);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 1e-6);
  const padX = (span - (maxX - minX)) / 2;
  const padY = (span - (maxY - minY)) / 2;
  return points.map((p, i) => ({
    x: (xs[i] - minX + padX) / span,
    y: (ys[i] - minY + padY) / span,
  }));
}

/** Downsample a polyline to at most `max` points, always keeping the head. */
export function downsample<T>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}
