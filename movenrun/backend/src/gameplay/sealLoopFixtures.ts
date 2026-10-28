/**
 * Synthetic seal fairness fixtures (sealing v2, docs/g34/SEALING_V2_28OCT.md).
 *
 * Shapes in planar metres around synthetic origins, walked at about 1.4 m/s
 * (a fix every 10 s, about 14 m apart), with optional deterministic GPS
 * error: a first-order autoregressive offset per fix (correlation 0.9, so
 * consecutive fixes drift together the way real GPS error does), standard
 * deviation `sigma` metres per axis, each fix reporting the accuracy an
 * honest phone would (`accuracyFor`). Gaps and breaks are explicit. No real
 * route, no real location data.
 */
import type { SealLoopFix } from "./sealLoop.js";

type XY = readonly [number, number];
const EARTH_RADIUS_M = 6_371_000;
const DEG = Math.PI / 180;
export const T0 = 1_780_000_000_000;
export const STEP_M = 14;
export const STEP_MS = 10_000;

export const PARK = { latitude: 51.52, longitude: -0.1 };

/** One walked part of a route, then how the next part begins. */
export interface Leg {
  vertices: XY[];
  /** How the step into this leg is made: walked (default), an unobserved jump with this many ms, or a declared break. */
  join?: { kind: "walked" } | { kind: "jump"; ms: number } | { kind: "break"; ms: number };
}

export interface SealFixture {
  name: string;
  group: "park" | "grid" | "short" | "lollipop" | "eight" | "out-and-back" | "sidewalks" | "spur" | "spoof-gap" | "honest-gap" | "h3";
  /** Whether a fair rule should let this route claim land. Null: the owner decides (boundary case). */
  shouldSeal: boolean | null;
  legs: Leg[];
  origin?: { latitude: number; longitude: number };
}

export function polyline(vertices: readonly XY[], step = STEP_M): XY[] {
  const out: XY[] = [];
  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1]!, b = vertices[i]!;
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let j = 0; j < n; j++) out.push([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n]);
  }
  out.push(vertices[vertices.length - 1]!);
  return out;
}

const rect = (w: number, h: number, x = 0, y = 0): XY[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
const square = (perimeter: number) => rect(perimeter / 4, perimeter / 4);
const ellipse = (a: number, b: number, n = 72): XY[] =>
  Array.from({ length: n + 1 }, (_, i) => [a * Math.cos((i / n) * 2 * Math.PI) - a, b * Math.sin((i / n) * 2 * Math.PI)] as const);
const eight = (a: number, b: number, n = 120): XY[] =>
  Array.from({ length: n + 1 }, (_, i) => { const t = (i / n) * 2 * Math.PI; return [a * Math.sin(t), b * Math.sin(2 * t)] as const; });
const back = (v: XY[]): XY[] => [...v].reverse();

export const SEAL_FIXTURES: readonly SealFixture[] = [
  { name: "park oval 1.5 km (600x360 m)", group: "park", shouldSeal: true, legs: [{ vertices: ellipse(300, 180) }] },
  { name: "park irregular loop 1.2 km", group: "park", shouldSeal: true, legs: [{ vertices: [[0, 0], [220, -40], [380, 60], [350, 240], [160, 300], [-40, 180], [0, 0]] }] },
  { name: "park lake path 2.9 km (1200x600 m)", group: "park", shouldSeal: true, legs: [{ vertices: ellipse(600, 300) }] },
  { name: "street block 80x80 m (320 m)", group: "grid", shouldSeal: true, legs: [{ vertices: rect(80, 80) }] },
  { name: "street block 100x150 m (500 m)", group: "grid", shouldSeal: true, legs: [{ vertices: rect(100, 150) }] },
  { name: "street block 60x250 m (620 m)", group: "grid", shouldSeal: true, legs: [{ vertices: rect(60, 250) }] },
  { name: "street block 200x200 m (800 m)", group: "grid", shouldSeal: true, legs: [{ vertices: rect(200, 200) }] },
  { name: "three blocks, L-shaped (1.2 km)", group: "grid", shouldSeal: true, legs: [{ vertices: [[0, 0], [300, 0], [300, 150], [150, 150], [150, 300], [0, 300], [0, 0]] }] },
  { name: "short loop 150 m (37.5 m square)", group: "short", shouldSeal: null, legs: [{ vertices: square(150) }] },
  { name: "short loop 200 m (50 m square)", group: "short", shouldSeal: true, legs: [{ vertices: square(200) }] },
  { name: "short loop 250 m", group: "short", shouldSeal: true, legs: [{ vertices: square(250) }] },
  { name: "short loop 300 m", group: "short", shouldSeal: true, legs: [{ vertices: square(300) }] },
  { name: "short loop 400 m", group: "short", shouldSeal: true, legs: [{ vertices: square(400) }] },
  { name: "short loop 300 m circle", group: "short", shouldSeal: true, legs: [{ vertices: ellipse(300 / (2 * Math.PI), 300 / (2 * Math.PI), 36) }] },
  { name: "loop 200x200, stops 40 m short of start", group: "short", shouldSeal: true, legs: [{ vertices: [[0, 0], [200, 0], [200, 200], [0, 200], [0, 40]] }] },
  { name: "loop 200x200, stops 80 m short of start", group: "short", shouldSeal: null, legs: [{ vertices: [[0, 0], [200, 0], [200, 200], [0, 200], [0, 80]] }] },
  { name: "lollipop: 300 m stick, 100x100 head", group: "lollipop", shouldSeal: true, legs: [{ vertices: [[0, 0], [300, 0], [400, 0], [400, 100], [300, 100], [300, 0], [0, 0]] }] },
  { name: "lollipop: 800 m stick, 150x150 head", group: "lollipop", shouldSeal: true, legs: [{ vertices: [[0, 0], [800, 0], [950, 0], [950, 150], [800, 150], [800, 0], [0, 0]] }] },
  { name: "figure eight 1200x600 m", group: "eight", shouldSeal: true, legs: [{ vertices: eight(600, 300) }] },
  { name: "figure eight 60x30 m", group: "eight", shouldSeal: false, legs: [{ vertices: eight(30, 15, 40) }] },
  { name: "out-and-back 1 km, one street", group: "out-and-back", shouldSeal: false, legs: [{ vertices: [[0, 0], [1000, 0], [0, 0]] }] },
  { name: "out-and-back 2.5 km, one street", group: "out-and-back", shouldSeal: false, legs: [{ vertices: [[0, 0], [2500, 0], [0, 0]] }] },
  { name: "out-and-back 400 m, one street", group: "out-and-back", shouldSeal: false, legs: [{ vertices: [[0, 0], [400, 0], [0, 0]] }] },
  { name: "sidewalks 10 m apart, 500 m", group: "sidewalks", shouldSeal: false, legs: [{ vertices: rect(500, 10) }] },
  { name: "sidewalks 15 m apart, 500 m", group: "sidewalks", shouldSeal: false, legs: [{ vertices: rect(500, 15) }] },
  { name: "sidewalks 20 m apart, 500 m", group: "sidewalks", shouldSeal: false, legs: [{ vertices: rect(500, 20) }] },
  { name: "sidewalks 20 m apart, 1.5 km", group: "sidewalks", shouldSeal: false, legs: [{ vertices: rect(1500, 20) }] },
  { name: "boulevard 30 m wide, 500 m", group: "sidewalks", shouldSeal: null, legs: [{ vertices: rect(500, 30) }] },
  { name: "1 km straight with a 6 m knot", group: "spur", shouldSeal: false, legs: [{ vertices: [[0, 0], [500, 0], [506, 4], [503, -3], [499, 2], [1000, 0]] }] },
  { name: "1 km straight with a 12 m loop", group: "spur", shouldSeal: false, legs: [{ vertices: [[0, 0], [500, 0], [512, 0], [512, 12], [500, 12], [500, -5], [1000, 0]] }] },
  { name: "straight 600 m, 40 m spur, back to start", group: "spur", shouldSeal: false, legs: [{ vertices: [[0, 0], [600, 0], [600, 40], [600, 0], [0, 0]] }] },
  {
    name: "spoof: 190x400 loop, top side a 190 m jump in 20 s", group: "spoof-gap", shouldSeal: false,
    legs: [{ vertices: [[0, 0], [0, 400]] }, { join: { kind: "jump", ms: 20_000 }, vertices: [[190, 400], [190, 0], [0, 0]] }],
  },
  {
    name: "spoof: 400 m U, 150 m declared break home", group: "spoof-gap", shouldSeal: false,
    legs: [{ vertices: [[0, 0], [400, 0], [400, 150]] }, { join: { kind: "break", ms: 60_000 }, vertices: [[0, 150], [0, 120]] }],
  },
  {
    name: "spoof: 300x150 loop, 150 m side a 3 min gap", group: "spoof-gap", shouldSeal: false,
    legs: [{ vertices: [[0, 0], [300, 0], [300, 150]] }, { join: { kind: "jump", ms: 180_000 }, vertices: [[150, 150], [0, 150], [0, 0]] }],
  },
  {
    name: "honest: block 200x200, 40 m dropout", group: "honest-gap", shouldSeal: true,
    legs: [{ vertices: [[0, 0], [200, 0], [200, 80]] }, { join: { kind: "jump", ms: 30_000 }, vertices: [[200, 120], [200, 200], [0, 200], [0, 0]] }],
  },
  {
    name: "honest: block 200x200, 70 m dropout", group: "honest-gap", shouldSeal: null,
    legs: [{ vertices: [[0, 0], [200, 0], [200, 65]] }, { join: { kind: "jump", ms: 50_000 }, vertices: [[200, 135], [200, 200], [0, 200], [0, 0]] }],
  },
  { name: "block 100x150 inside one res8 cell", group: "h3", shouldSeal: true, legs: [{ vertices: rect(100, 150) }], origin: { latitude: 51.5007, longitude: -0.1246 } },
  { name: "block 100x150 across a res8 boundary", group: "h3", shouldSeal: true, legs: [{ vertices: rect(100, 150) }], origin: { latitude: 51.5108, longitude: -0.1302 } },
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The accuracy an honest phone reports for per-axis error `sigma`: the 68%
 * horizontal radius of a circular Gaussian is about 1.5 sigma, and a good
 * fix reports about 5 m.
 */
export function accuracyFor(sigma: number): number {
  return Math.max(5, Math.round(1.5 * sigma));
}

/** Planar metres to a coordinate around `origin`. */
export function toLatLng(x: number, y: number, origin: { latitude: number; longitude: number }) {
  return { lat: origin.latitude + y / EARTH_RADIUS_M / DEG, lng: origin.longitude + x / EARTH_RADIUS_M / DEG / Math.cos(origin.latitude * DEG) };
}

/**
 * The accepted fixes of a fixture: each leg walked every `STEP_M` metres,
 * one fix every `STEP_MS`, with AR(1) GPS error of `sigma` metres per axis
 * from `seed`. A jump leg's first fix arrives `ms` after the previous one; a
 * break leg's carries `breakBefore`.
 */
export function fixtureFixes(f: SealFixture, sigma = 0, seed = 1): SealLoopFix[] {
  const origin = f.origin ?? PARK;
  const rnd = mulberry32(seed * 7919 + f.name.length);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const rho = 0.9;
  let ex = sigma * gauss(), ey = sigma * gauss();
  const fixes: SealLoopFix[] = [];
  let t = T0;
  for (const leg of f.legs) {
    const pts = polyline(leg.vertices);
    pts.forEach(([x, y], j) => {
      let breakBefore = false;
      if (fixes.length > 0) {
        if (j === 0 && leg.join?.kind === "jump") t += leg.join.ms;
        else if (j === 0 && leg.join?.kind === "break") { t += leg.join.ms; breakBefore = true; }
        else t += STEP_MS;
      }
      if (fixes.length > 0) {
        ex = rho * ex + Math.sqrt(1 - rho * rho) * sigma * gauss();
        ey = rho * ey + Math.sqrt(1 - rho * rho) * sigma * gauss();
      }
      fixes.push({ ...toLatLng(x + ex, y + ey, origin), timestamp: t, accuracy: accuracyFor(sigma), ...(breakBefore ? { breakBefore: true } : {}) });
    });
  }
  // Drop exact duplicates (a leg that starts where the previous one ended).
  return fixes.filter((p, i) => i === 0 || p.lat !== fixes[i - 1]!.lat || p.lng !== fixes[i - 1]!.lng);
}
