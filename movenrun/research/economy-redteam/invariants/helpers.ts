/**
 * Shared helpers for the server-authority invariant fixtures (B4).
 *
 * Synthetic planar geometry around a fixed origin, a seeded PRNG, and an
 * exact restatement of the player-day proof digest that the day close writes
 * (backend/src/gameplay/service.ts:1108-1135 at cb27318). The restatement is
 * checked against the stored value on local PostgreSQL in
 * invariants.pg.test.ts, so the pure proof tests below read the real format.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PathFix } from "../../../backend/src/gameplay/path.ts";

export const HERE = dirname(fileURLToPath(import.meta.url));

export interface Manifest {
  version: number;
  origin: { latitude: number; longitude: number };
  baseTimestampMs: number;
  seeds: { pathFuzz: number[]; segmentSweep: number[]; sparseWalkSweep: number[] };
  magnitudes: {
    walkingSpeedMps: [number, number];
    segmentLengthM: [number, number];
    segmentDurationCapMs: number;
    fixIntervalsS: number[];
    sparseWalkLegs: number;
    sparseWalkLegLengthM: [number, number];
    segmentsPerSeed: number;
    fuzzWalksPerSeed: number;
    fuzzFixesPerWalk: [number, number];
  };
}

export function loadManifest(): Manifest {
  return JSON.parse(readFileSync(join(HERE, "manifest.json"), "utf8")) as Manifest;
}

/** mulberry32: a small, well-known 32-bit PRNG. Same seed, same sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EARTH_RADIUS_M = 6_371_000;
const DEG = Math.PI / 180;
export const ORIGIN = { latitude: 51.52, longitude: -0.1 };
export const T0 = 1_780_000_000_000;

/** A synthetic point `x` metres east and `y` metres north of the origin. */
export function ll(x: number, y: number, origin = ORIGIN): { lat: number; lng: number } {
  return {
    lat: origin.latitude + y / EARTH_RADIUS_M / DEG,
    lng: origin.longitude + x / EARTH_RADIUS_M / DEG / Math.cos(origin.latitude * DEG),
  };
}

export function fix(x: number, y: number, timestamp: number, breakBefore?: boolean): PathFix {
  return { ...ll(x, y), timestamp, ...(breakBefore ? { breakBefore } : {}) };
}

/** Points every `stepM` metres along a polyline, the vertices included. */
export function densify(vertices: readonly (readonly [number, number])[], stepM: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 1; i < vertices.length; i++) {
    const [ax, ay] = vertices[i - 1]!;
    const [bx, by] = vertices[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / stepM));
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  out.push([...vertices[vertices.length - 1]!] as [number, number]);
  return out;
}

/* ── the player-day proof, restated ────────────────────────────────────── */

/** One accepted ledger row as the day close reads it (service.ts:916-926). */
export interface ProofLedgerRow {
  source_no: number;
  /** H3 index as a decimal bigint string (`unit::text`). */
  unit: string;
  outcome: 1 | 2 | 3 | 4;
  previous_holder_no: number | null;
  new_holder_no: number | null;
  strength_before: number;
  strength_after: number;
  shade_strength: number;
}

export interface ProofRefusalRow {
  refused_deeded: number;
  refused_masked: number;
  refused_daily_limit: number;
  refused_take_budget: number;
  visit_units: string[];
}

/**
 * The events_sha256 of one walker's day: their accepted rows in seq order,
 * then one refusal line when they have a day row (service.ts:1114-1133).
 */
export function proofDigest(rows: readonly ProofLedgerRow[], refusal: ProofRefusalRow | null): string {
  const lines = rows.map((e) => [e.source_no, e.unit, e.outcome, e.previous_holder_no ?? "", e.new_holder_no ?? "",
    `${e.strength_before}>${e.strength_after}`, e.shade_strength].join(":"));
  if (refusal) {
    lines.push(["refused", refusal.refused_deeded, refusal.refused_masked, refusal.refused_daily_limit, refusal.refused_take_budget,
      refusal.visit_units.join(",")].join(":"));
  }
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}
