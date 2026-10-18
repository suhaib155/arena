/**
 * The canonical gameplay path of a verified session at a fine resolution
 * (rule set 1002 only).
 *
 * The movement pipeline stores the resolution 8 cells that contain a fix
 * (`traversed_hex_ids`, `cellsForObservations`). Rule set 1002 plays on
 * resolution 10 units (about 76 m), which that column cannot express: a
 * resolution 10 unit cannot be recovered from a resolution 8 cell, and the
 * raw fixes are never stored. So the path is derived here, once, from the
 * very fixes the pipeline has just verified, in the same request, and stored
 * beside the verification (see `drizzle-proposed/1002_session_paths.sql`).
 * Nothing the client sends is a cell: the input is the verified observation.
 *
 * What the path contains, in walk order (first touch):
 *
 * - **stepped** units: the unit contains an accepted fix (assumption A1,
 *   exactly what the pipeline already records at resolution 8);
 * - **interpolated** units: the unit is crossed by the straight segment
 *   between two consecutive accepted fixes, sampled every `stepMeters`. A
 *   segment is only walked when the pipeline's own continuity rules hold for
 *   it: no break or pause between the fixes (`hasEvidenceBreak`), no longer
 *   than `maxSegmentMeters` (the sealing continuity break, 200 m in sealing
 *   rules version 1), no faster than `maxSpeedMetersPerSecond` (the on-foot
 *   policy's 12 m/s) and no longer in time than `maxSegmentMs`. Any other
 *   segment contributes nothing between its ends.
 *
 * A unit first reached by interpolation and later stepped on is stepped. The
 * path holds at most `maxUnits` units; the rest are dropped in walk order and
 * the path says it was truncated.
 *
 * Privacy: the stored path is a set of resolution 10 cells in first-touch
 * order, the same granularity the 1002 push ledger stores per push and the
 * same ordering `traversed_hex_ids` already keeps at resolution 8. No
 * coordinate, timestamp or per-cell time is stored.
 *
 * Pure: no I/O and no clock.
 */
import { cellToParent, latLngToCell } from "h3-js";
import { hasEvidenceBreak } from "@movenrun/shared/evidence";
import { haversineMeters, interpolateCoordinate } from "@movenrun/shared/geo";
import type { PauseSource } from "@movenrun/shared/sealing";

/** How a session's gameplay path is derived. Part of the rule set's identity: a change is a new version. */
export interface SessionPathRule {
  name: "verified-steps";
  version: 1;
  /** H3 resolution of the units. */
  resolution: number;
  /** Sampling spacing along a walked segment, in metres. */
  stepMeters: number;
  /** A segment longer than this is not walked between its ends (sealing continuity break, rules version 1). */
  maxSegmentMeters: number;
  /** A segment slower than this many milliseconds is not walked between its ends. PILOT PROPOSAL. */
  maxSegmentMs: number;
  /** A segment faster than this is not walked between its ends (on-foot policy v1). */
  maxSpeedMetersPerSecond: number;
  /** Most units one path keeps. */
  maxUnits: number;
  /** Whether interpolated units become pushes. Stepped units always do. */
  pushInterpolated: boolean;
}

/** Rule set 1002's path rule. SIMULATION-PILOT PROPOSAL. */
export const VERIFIED_STEPS_V1: Readonly<SessionPathRule> = Object.freeze({
  name: "verified-steps",
  version: 1,
  resolution: 10,
  stepMeters: 8,
  maxSegmentMeters: 200,
  maxSegmentMs: 120_000,
  maxSpeedMetersPerSecond: 12,
  maxUnits: 500,
  pushInterpolated: true,
});

export interface PathFix {
  lat: number;
  lng: number;
  timestamp: number;
  breakBefore?: boolean;
}

export interface SessionPath {
  pathVersion: number;
  resolution: number;
  /** Units in walk (first-touch) order. */
  units: string[];
  /** Parallel to `units`: true when the unit holds no accepted fix and was reached by interpolation only. */
  interpolated: boolean[];
  /** Segments between consecutive fixes that were not walked (a break, a pause, too long, too slow or too fast). */
  skippedSegments: number;
  /** True when `maxUnits` was reached and later units were dropped. */
  truncated: boolean;
}

/** Problems with a path rule; empty when it is usable. */
export function sessionPathRuleProblems(r: SessionPathRule): string[] {
  const p: string[] = [];
  if (r.name !== "verified-steps" || r.version !== 1) p.push("unknown session path rule");
  if (!(Number.isInteger(r.resolution) && r.resolution >= 0 && r.resolution <= 15)) p.push("path resolution must be 0-15");
  if (!(r.stepMeters > 0 && r.stepMeters <= 50)) p.push("path step must be above 0 and at most 50 m");
  if (!(r.maxSegmentMeters > 0 && r.maxSegmentMeters <= 200)) p.push("path segments may not exceed the 200 m continuity break");
  if (!(r.maxSegmentMs > 0)) p.push("path segment time limit must be positive");
  if (!(r.maxSpeedMetersPerSecond > 0 && r.maxSpeedMetersPerSecond <= 12)) p.push("path speed may not exceed the on-foot policy's 12 m/s");
  if (!(Number.isInteger(r.maxUnits) && r.maxUnits >= 1)) p.push("path unit cap must be a whole number, 1 or more");
  return p;
}

function walkable(a: PathFix, b: PathFix, pauses: PauseSource, rule: SessionPathRule): boolean {
  const ta = { latitude: a.lat, longitude: a.lng, timestamp: a.timestamp };
  const tb = { latitude: b.lat, longitude: b.lng, timestamp: b.timestamp, breakBefore: b.breakBefore };
  if (hasEvidenceBreak(ta, tb, pauses)) return false;
  const dt = b.timestamp - a.timestamp;
  if (!(dt > 0) || dt > rule.maxSegmentMs) return false;
  const d = haversineMeters(ta, tb);
  if (d > rule.maxSegmentMeters) return false;
  return d / (dt / 1000) <= rule.maxSpeedMetersPerSecond;
}

/**
 * The path of verified fixes. The caller passes only fixes the movement
 * pipeline accepted (a session with any refused fix is rejected whole before
 * this runs). Throws for a coordinate that is not a real latitude/longitude,
 * which the pipeline has already refused.
 */
export function deriveSessionPath(fixes: readonly PathFix[], pauses: PauseSource, rule: SessionPathRule): SessionPath {
  const index = new Map<string, number>();
  const units: string[] = [];
  const interpolated: boolean[] = [];
  let truncated = false;
  let skippedSegments = 0;
  const add = (cell: string, stepped: boolean) => {
    const at = index.get(cell);
    if (at !== undefined) {
      if (stepped) interpolated[at] = false;
      return;
    }
    if (units.length >= rule.maxUnits) {
      truncated = true;
      return;
    }
    index.set(cell, units.length);
    units.push(cell);
    interpolated.push(!stepped);
  };
  for (let i = 0; i < fixes.length; i++) {
    const fix = fixes[i]!;
    if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lng) || Math.abs(fix.lat) > 90 || Math.abs(fix.lng) > 180) {
      throw new RangeError("not a coordinate");
    }
    const prev = fixes[i - 1];
    if (prev) {
      if (walkable(prev, fix, pauses, rule)) {
        const a = { latitude: prev.lat, longitude: prev.lng };
        const b = { latitude: fix.lat, longitude: fix.lng };
        const n = Math.ceil(haversineMeters(a, b) / rule.stepMeters);
        for (let k = 1; k < n; k++) {
          const s = interpolateCoordinate(a, b, k / n);
          add(latLngToCell(s.latitude, s.longitude, rule.resolution), false);
        }
      } else {
        skippedSegments += 1;
      }
    }
    add(latLngToCell(fix.lat, fix.lng, rule.resolution), true);
  }
  return { pathVersion: rule.version, resolution: rule.resolution, units, interpolated, skippedSegments, truncated };
}

/** The units a path pushes, in walk order, under its rule. */
export function pushUnitsOf(path: Pick<SessionPath, "units" | "interpolated">, rule: Pick<SessionPathRule, "pushInterpolated">): string[] {
  return rule.pushInterpolated ? [...path.units] : path.units.filter((_, i) => !path.interpolated[i]);
}

/** Stepped units only: the "crossed cells" of a session for the toll (economy V3 §20: never interpolated). */
export function steppedUnitsOf(path: Pick<SessionPath, "units" | "interpolated">): string[] {
  return path.units.filter((_, i) => !path.interpolated[i]);
}

/* ── compact storage ─────────────────────────────────────────────────────── */

/** An H3 index as a decimal bigint string (8 bytes in a bigint[] column instead of a 15-character text). */
export function cellToInt8(cell: string): string {
  if (!/^[0-9a-f]{15,16}$/.test(cell)) throw new RangeError("not an H3 index");
  return BigInt(`0x${cell}`).toString(10);
}

export function int8ToCell(value: string | number | bigint): string {
  const n = BigInt(value);
  if (n <= 0n) throw new RangeError("not an H3 index");
  return n.toString(16);
}

/** The interpolated flags as a bit string for a `varbit` column. */
export function flagsToBits(flags: readonly boolean[]): string {
  return flags.map((f) => (f ? "1" : "0")).join("");
}

export function bitsToFlags(bits: string, length: number): boolean[] {
  if (bits.length !== length || /[^01]/.test(bits)) throw new RangeError("path flags do not match its units");
  return [...bits].map((b) => b === "1");
}

/** The parent at a coarser resolution; used by the drift measurement. */
export function parentOf(cell: string, resolution: number): string {
  return cellToParent(cell, resolution);
}
