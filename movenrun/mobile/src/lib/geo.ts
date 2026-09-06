/**
 * Local geo math for movement sessions. Everything here is computed on-device
 * from foreground GPS samples. This module itself performs no I/O; what the app
 * does with a finished route is decided elsewhere (see services/verifySession.ts).
 */

import { haversineMeters } from "@movenrun/shared/geo";
import { inspectFix, ON_FOOT_POLICY } from "@movenrun/shared/measurement";

export interface TrackPoint {
  /** Missing foreground continuity before this observation. */
  breakBefore?: boolean;
  latitude: number;
  longitude: number;
  /** ms epoch when the fix arrived. */
  timestamp: number;
  /** Reported horizontal accuracy in meters (null when unknown). */
  accuracy: number | null;
  /** Optional native speed in m/s, used only for measurement quality. */
  speed?: number | null;
}

/** Shared geodesic used by canonical evidence and server measurement. */
export const distanceMeters = haversineMeters;
export const MAX_ACCURACY_M = ON_FOOT_POLICY.maxAccuracyMeters;
export const MAX_PLAUSIBLE_SPEED_MS = ON_FOOT_POLICY.maxSpeedMetersPerSecond;
export const MIN_STEP_M = ON_FOOT_POLICY.minDisplacementMeters;

/** A noise fix never advances the distance anchor. */
export function acceptPoint(prev: TrackPoint | null, next: TrackPoint): boolean {
  return inspectFix(prev, next).accepted;
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
