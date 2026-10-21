/**
 * Route fixtures for the session path tests and the drift measurement: the
 * shapes of the canonical-evidence fixtures (shared/src/domain/__tests__/
 * evidence.test.ts) and the movement verification fixture, as accepted-fix
 * sequences. Synthetic geometry only; no real route.
 */
import type { PathFix } from "./path.js";

const EARTH_RADIUS_M = 6_371_000;
const DEG = Math.PI / 180;
type XY = readonly [number, number];

export const T0 = 1_780_000_000_000;

function at(x: number, y: number, origin: { latitude: number; longitude: number }) {
  return {
    lat: origin.latitude + y / EARTH_RADIUS_M / DEG,
    lng: origin.longitude + x / EARTH_RADIUS_M / DEG / Math.cos(origin.latitude * DEG),
  };
}

/** Points every `step` metres along a polyline (the evidence tests' `poly`). */
export function poly(vertices: readonly XY[], step: number): XY[] {
  const result: XY[] = [];
  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1]!, b = vertices[i]!;
    const count = Math.max(1, Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let j = 0; j < count; j++) result.push([a[0] + (b[0] - a[0]) * j / count, a[1] + (b[1] - a[1]) * j / count]);
  }
  result.push(vertices[vertices.length - 1]!);
  return result;
}

/** Fixes from planar metres, one every `intervalMs`. */
export function fixesOf(xy: readonly XY[], origin: { latitude: number; longitude: number }, intervalMs: number): PathFix[] {
  return xy.map(([x, y], i) => ({ ...at(x, y, origin), timestamp: T0 + i * intervalMs }));
}

export interface RouteFixture {
  name: string;
  origin: { latitude: number; longitude: number };
  /** The route as drawn; the ground truth is this polyline walked every metre. */
  vertices: XY[];
}

const SF = { latitude: 37.7749, longitude: -122.4194 };
const LONDON = { latitude: 51.5, longitude: -0.12 };
const LOOP: XY[] = [[-250, 0], [250, 0], [250, 200], [-200, 200], [-200, -200], [450, -200], [450, 100], [0, 100], [0, -300], [650, -300], [650, 150], [400, 150], [400, -400]];
const EIGHT: XY[] = Array.from({ length: 201 }, (_, i) => {
  const t = (i + 0.37) * Math.PI * 2 / 200;
  return [600 * Math.sin(t), 300 * Math.sin(2 * t)] as const;
});

export const ROUTE_FIXTURES: readonly RouteFixture[] = [
  { name: "urban corners", origin: SF, vertices: [[0, 0], [400, 0], [400, 250], [750, 250], [750, 500], [350, 500], [350, 750], [0, 750], [0, 0]] },
  { name: "square", origin: SF, vertices: [[0, 0], [900, 0], [900, 900], [0, 900], [0, 0]] },
  { name: "figure eight", origin: SF, vertices: EIGHT },
  { name: "multiple loops", origin: SF, vertices: LOOP },
  { name: "out and back", origin: SF, vertices: [[0, 0], [2500, 0], [0, 0]] },
  // The movement verification fixture: 100 m north twice (51.5000 → 51.5018).
  { name: "verification fixture", origin: LONDON, vertices: [[0, 0], [0, 200]] },
];
