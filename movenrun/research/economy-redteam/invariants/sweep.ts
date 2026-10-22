/**
 * Seeded sweeps over VERIFIED_STEPS_V1 (rule set 1002's path rule), synthetic
 * geometry only. Pure: the same manifest gives byte-identical CSV.
 *
 * - segments: one gap between two fixes, random length and walking speed,
 *   capped at the rule's 120 s; how many units are interpolated and pushed.
 * - sparse walks: a random polyline walked at 1.4 m/s, sampled every N
 *   seconds; how many pushed units lie off the true polyline's cells.
 */
import { latLngToCell } from "h3-js";
import { deriveSessionPath, pushUnitsOf, VERIFIED_STEPS_V1 } from "../../../backend/src/gameplay/path.ts";
import { densify, fix, ll, mulberry32, T0, type Manifest } from "./helpers.ts";

const cellAt = (x: number, y: number) => { const p = ll(x, y); return latLngToCell(p.lat, p.lng, 10); };

export function segmentSweep(m: Manifest): string {
  const rows = ["seed,segments,walkable,with_interpolated,interpolated_units,pushed_units"];
  const [l0, l1] = m.magnitudes.segmentLengthM;
  const [v0, v1] = m.magnitudes.walkingSpeedMps;
  for (const seed of m.seeds.segmentSweep) {
    const rnd = mulberry32(seed);
    let walkable = 0, withInterp = 0, interp = 0, pushed = 0;
    for (let i = 0; i < m.magnitudes.segmentsPerSeed; i++) {
      const len = l0 + rnd() * (l1 - l0);
      const a = rnd() * Math.PI * 2;
      const x0 = rnd() * 1000, y0 = rnd() * 1000;
      const dt = Math.min(m.magnitudes.segmentDurationCapMs, Math.round((len / (v0 + rnd() * (v1 - v0))) * 1000));
      const p = deriveSessionPath([fix(x0, y0, T0), fix(x0 + Math.cos(a) * len, y0 + Math.sin(a) * len, T0 + dt)], [], VERIFIED_STEPS_V1);
      if (p.skippedSegments === 0) walkable++;
      const k = p.interpolated.filter(Boolean).length;
      if (k > 0) withInterp++;
      interp += k;
      pushed += pushUnitsOf(p, VERIFIED_STEPS_V1).length;
    }
    rows.push([seed, m.magnitudes.segmentsPerSeed, walkable, withInterp, interp, pushed].join(","));
  }
  return rows.join("\n") + "\n";
}

export function sparseWalkSweep(m: Manifest): string {
  const rows = ["seed,fix_interval_s,pushed_units,interpolated_units,off_route_units,off_route_share"];
  const [g0, g1] = m.magnitudes.sparseWalkLegLengthM;
  for (const seed of m.seeds.sparseWalkSweep) {
    const rnd = mulberry32(seed);
    const route: [number, number][] = [[0, 0]];
    let heading = rnd() * Math.PI * 2;
    for (let i = 0; i < m.magnitudes.sparseWalkLegs; i++) {
      heading += (rnd() < 0.5 ? -1 : 1) * Math.PI / 2;
      const len = g0 + rnd() * (g1 - g0);
      const [x, y] = route[route.length - 1]!;
      route.push([x + Math.cos(heading) * len, y + Math.sin(heading) * len]);
    }
    // About 1 m spacing along the whole route; fixes fall every 1.4 x s metres of arc, corners or not.
    const fine = densify(route, 1);
    const truth = new Set(fine.map(([x, y]) => cellAt(x, y)));
    for (const s of m.magnitudes.fixIntervalsS) {
      const every = Math.round(1.4 * s);
      const picked = fine.filter((_, i) => i % every === 0);
      if ((fine.length - 1) % every !== 0) picked.push(fine[fine.length - 1]!);
      const fixes = picked.map(([x, y], i) => fix(x, y, T0 + i * s * 1000));
      const p = deriveSessionPath(fixes, [], VERIFIED_STEPS_V1);
      const pushedUnits = pushUnitsOf(p, VERIFIED_STEPS_V1);
      const off = pushedUnits.filter((u) => !truth.has(u)).length;
      rows.push([seed, s, pushedUnits.length, p.interpolated.filter(Boolean).length, off, (off / pushedUnits.length).toFixed(4)].join(","));
    }
  }
  return rows.join("\n") + "\n";
}
