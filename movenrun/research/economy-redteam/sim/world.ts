/**
 * SYNTHETIC geography and routes for the scenario lab.
 *
 * Everything is laid out in metres on a flat plane around an arbitrary origin
 * in open ocean (manifest `geography.origin`), then turned into GPS-like fixes.
 * Nothing here is a real city, polygon or road network.
 *
 * A route is turned into units exactly as the server would: the resolution 10
 * verified-steps path through `deriveSessionPath` (backend gameplay path.ts,
 * imported read-only, with the path rule taken from the 1002 rule object),
 * and the resolution 8 stored cells through `cellsForObservations` (what the
 * 1001 rule set consumes). A GPS gap is a stretch with no fixes, longer than
 * the path rule's segment limits, so the units inside it are not pushed: they
 * are neither stepped nor interpolated.
 */
import { cellsForObservations } from "@movenrun/shared/h3";
import { deriveSessionPath, type PathFix, type SessionPathRule } from "../../../backend/src/gameplay/path.ts";
import { between, gauss, type Rnd } from "./prng.ts";

const EARTH_RADIUS_M = 6_371_000;
const DEG = Math.PI / 180;

export type XY = readonly [number, number];
export type Density = "low" | "med" | "high";

export interface WorldSpec {
  origin: { latitude: number; longitude: number };
  urbanParticipants: number;
  density: Density;
  areaPerUrbanParticipantKm2: Record<Density, number>;
  villages: number;
  cbdRadiusMeters: number;
}

export interface World {
  spec: WorldSpec;
  urbanRadius: number;
  villages: XY[];
  villageRadius: number;
}

export function makeWorld(spec: WorldSpec, rnd: Rnd): World {
  const areaM2 = Math.max(1, spec.urbanParticipants) * spec.areaPerUrbanParticipantKm2[spec.density] * 1e6;
  const urbanRadius = Math.max(1200, Math.sqrt(areaM2 / Math.PI));
  const villages: XY[] = [];
  for (let i = 0; i < spec.villages; i++) {
    const a = (i / spec.villages) * 2 * Math.PI + between(rnd, -0.3, 0.3);
    const d = urbanRadius * between(rnd, 2.2, 3.0) + 3000;
    villages.push([Math.cos(a) * d, Math.sin(a) * d]);
  }
  return { spec, urbanRadius, villages, villageRadius: 700 };
}

export function pointInDisc(rnd: Rnd, c: XY, r: number): XY {
  const a = rnd() * 2 * Math.PI;
  const d = Math.sqrt(rnd()) * r;
  return [c[0] + Math.cos(a) * d, c[1] + Math.sin(a) * d];
}

/** A closed loop of 4–6 corners around a centre. */
export function loopAround(rnd: Rnd, c: XY, radius: number): XY[] {
  const n = 4 + Math.floor(rnd() * 3);
  const angles = Array.from({ length: n }, () => rnd() * 2 * Math.PI).sort((a, b) => a - b);
  const pts = angles.map((a) => [c[0] + Math.cos(a) * radius * (0.6 + 0.4 * rnd()), c[1] + Math.sin(a) * radius * (0.6 + 0.4 * rnd())] as XY);
  return [...pts, pts[0]!];
}

/** A grid-like one-way path: along x, then along y, with one jog. */
export function streetPath(rnd: Rnd, a: XY, b: XY): XY[] {
  const midX = a[0] + (b[0] - a[0]) * between(rnd, 0.3, 0.7);
  return [a, [midX, a[1]], [midX, b[1]], b];
}

export interface RouteSpec {
  id: string;
  waypoints: XY[];
  speedMps: number;
  fixIntervalS: number;
}

export interface DerivedPath {
  /** Resolution 10 units in walk (first-touch) order, as `deriveSessionPath` returns them. */
  res10: string[];
  /** Parallel to res10: reached by interpolation only. */
  interpolated: boolean[];
  /** Resolution 8 stored cells, unique, in first-seen order (the pipeline's traversed_hex_ids). */
  res8: string[];
  skippedSegments: number;
  truncated: boolean;
}

export interface Route {
  id: string;
  durationMs: number;
  distanceM: number;
  clean: DerivedPath;
  /** The same walk with one GPS gap (no fixes for 3–6 minutes). */
  gapped: DerivedPath;
  /** Units of the clean path that the gapped path does not push (non-Solid ground). */
  gapLostUnits: number;
}

function toLatLng(origin: WorldSpec["origin"], p: XY) {
  return {
    lat: origin.latitude + p[1] / EARTH_RADIUS_M / DEG,
    lng: origin.longitude + p[0] / EARTH_RADIUS_M / DEG / Math.cos(origin.latitude * DEG),
  };
}

/** Fixes along the waypoints, relative to t = 0, with about 4 m of position noise. */
function fixesOf(origin: WorldSpec["origin"], spec: RouteSpec, rnd: Rnd): { fixes: PathFix[]; distanceM: number } {
  const fixes: PathFix[] = [];
  const stepM = spec.speedMps * spec.fixIntervalS;
  let t = 0;
  let distanceM = 0;
  for (let i = 0; i + 1 < spec.waypoints.length; i++) {
    const a = spec.waypoints[i]!, b = spec.waypoints[i + 1]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    distanceM += len;
    const n = Math.max(1, Math.round(len / stepM));
    for (let k = 0; k < n; k++) {
      const x = a[0] + ((b[0] - a[0]) * k) / n + gauss(rnd) * 4;
      const y = a[1] + ((b[1] - a[1]) * k) / n + gauss(rnd) * 4;
      fixes.push({ ...toLatLng(origin, [x, y]), timestamp: t });
      t += spec.fixIntervalS * 1000;
    }
  }
  const last = spec.waypoints[spec.waypoints.length - 1]!;
  fixes.push({ ...toLatLng(origin, last), timestamp: t });
  return { fixes, distanceM };
}

function derive(fixes: PathFix[], rule: SessionPathRule): DerivedPath {
  const p = deriveSessionPath(fixes, [], rule);
  const res8 = cellsForObservations(fixes.map((f) => ({ latitude: f.lat, longitude: f.lng })));
  return { res10: p.units, interpolated: p.interpolated, res8, skippedSegments: p.skippedSegments, truncated: p.truncated };
}

export function buildRoute(origin: WorldSpec["origin"], spec: RouteSpec, rule: SessionPathRule, rnd: Rnd): Route {
  const { fixes, distanceM } = fixesOf(origin, spec, rnd);
  const clean = derive(fixes, rule);
  // The gap: drop every fix in a 3–6 minute stretch somewhere in the walk.
  const total = fixes[fixes.length - 1]!.timestamp;
  const gapMs = between(rnd, 180_000, 360_000);
  const start = between(rnd, 0.1, 0.8) * Math.max(0, total - gapMs);
  const kept = fixes.filter((f) => f.timestamp < start || f.timestamp > start + gapMs);
  const gapped = kept.length >= 2 ? derive(kept, rule) : clean;
  const cleanSet = new Set(gapped.res10);
  const gapLostUnits = clean.res10.filter((u) => !cleanSet.has(u)).length;
  return { id: spec.id, durationMs: total, distanceM, clean, gapped, gapLostUnits };
}
