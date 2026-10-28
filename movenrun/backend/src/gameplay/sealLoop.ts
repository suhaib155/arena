/**
 * Territory sealing v2: does a verified route enclose ground (V3 rule 3)?
 *
 * The movement pipeline's sealing engine (`@movenrun/shared/sealing`, rules
 * version 1) says a route "sealed" when it cut its own line anywhere or
 * finished within 150 m of its start. Both are true of routes that enclose
 * nothing: an out-and-back along one street finishes where it started, one
 * jitter knot is a self-crossing, and the engine draws a straight line across
 * any jump under 200 m between fixes, so an unobserved stretch can close a
 * loop. That is right for a live preview and wrong as the gate on claiming
 * land, so the gameplay server asks a second, stricter question here, from
 * the same accepted fixes, and stores only the answer.
 *
 * ## The criterion (`enclosed-loop` v1)
 *
 * 1. **Observed steps only.** The line between two consecutive accepted fixes
 *    is evidence only if nothing broke it (no `breakBefore`, no pause), it is
 *    at most `maxStepMeters` long, it took at most `maxStepMs` and it is no
 *    faster than `maxSpeedMetersPerSecond`. Every other step is a gap, and a
 *    gap is never walked: no candidate loop may contain one, whatever its
 *    length. Routes are split into stretches at every gap.
 * 2. **Candidate loops, built from accepted fixes only.** Inside one stretch:
 *    (a) a strict self-crossing of two observed steps closes the fixes between
 *    them, the crossing point being on both observed steps; (b) a near pass,
 *    fix `i` and a later fix `k` no more than `maxClosureMeters` apart, closes
 *    fixes `i..k` with one closing edge no longer than an observed step.
 *    Coming home is (b) with `i` the first fix and `k` the last. Nothing is
 *    interpolated, snapped or completed; no geometry is invented.
 * 3. **The loop must enclose ground.** The candidate is simplified
 *    (Douglas-Peucker, `simplifyMeters`, which removes GPS zigzag but keeps
 *    corners) and passes when all hold:
 *    - enclosed area (shoelace, signed, so a figure-eight's lobes cancel) of
 *      at least `minAreaM2`;
 *    - retraced share at most `maxRetracedShare`: the share of the loop's
 *      length that runs back along another part of the same loop, closer
 *      than `retraceMeters` and within 45 degrees of the opposite heading
 *      (an out-and-back, a spur, both sidewalks of one street);
 *    - effective width `2 * area / perimeter` of at least `minWidthMeters`
 *      (a square of side s has s/2; a strip of width w has just under w).
 *
 * A session qualifies when any candidate does. Candidates are tried largest
 * first, at most `maxCandidates` of them; past that the answer is no (fails
 * closed).
 *
 * ## Status of the numbers
 *
 * Every threshold below is a PILOT HYPOTHESIS, measured against synthetic
 * fixtures in docs/g34/SEALING_V2_28OCT.md, and not V3 source: V3 says a
 * route must seal and does not say how big a loop is. Owner acceptance is
 * pending. Changing any number is a new rule version.
 *
 * ## What this does not touch
 *
 * Movement verification, distance and movement XP: an unsealed or
 * unqualified session is still a verified movement session. Only claiming
 * land needs this. The phone's live seal preview (rules version 1) is not
 * changed and can say "sealed" where this says no.
 *
 * Privacy: the result stored is a version, a boolean and a reason code. No
 * coordinate, index, area or polygon leaves this function's caller.
 *
 * Pure: no I/O and no clock.
 */
import { hasEvidenceBreak } from "@movenrun/shared/evidence";
import { haversineMeters, projector, RouteGeometryError, segmentCrossing, type PlanarPoint } from "@movenrun/shared/geo";
import type { PauseSource } from "@movenrun/shared/sealing";

export interface SealLoopRule {
  name: "enclosed-loop";
  version: 1;
  /** Longest step between consecutive accepted fixes that counts as observed. */
  maxStepMeters: number;
  /** Longest time between consecutive accepted fixes that counts as observed. */
  maxStepMs: number;
  /** Fastest observed step (the on-foot policy's limit). */
  maxSpeedMetersPerSecond: number;
  /** Longest closing edge of a near-pass loop (never longer than an observed step). */
  maxClosureMeters: number;
  /** Douglas-Peucker tolerance for the loop before it is measured. */
  simplifyMeters: number;
  minAreaM2: number;
  minWidthMeters: number;
  maxRetracedShare: number;
  retraceMeters: number;
  /** Most candidate loops measured for one session. */
  maxCandidates: number;
  /**
   * GPS error raises the bar instead of sealing by itself. With `u` the
   * median reported accuracy of the loop's fixes (metres, capped at the
   * on-foot policy's 40 m; a fix with no accuracy counts as 40 m), the loop
   * is simplified at `max(simplifyMeters, u * simplifyPerAccuracy)`, retrace
   * is looked for within `max(retraceMeters, u * retracePerAccuracy)` and
   * the width must reach `max(minWidthMeters, u * widthPerAccuracy)`: an
   * out-and-back recorded with 15 m error looks like two sidewalks 20 m apart.
   */
  simplifyPerAccuracy: number;
  retracePerAccuracy: number;
  widthPerAccuracy: number;
}

/**
 * The pilot hypothesis (owner acceptance pending). See the module comment and
 * docs/g34/SEALING_V2_28OCT.md for the measurements behind each number.
 */
export const ENCLOSED_LOOP_V1: Readonly<SealLoopRule> = Object.freeze({
  name: "enclosed-loop",
  version: 1,
  maxStepMeters: 50,
  maxStepMs: 120_000,
  maxSpeedMetersPerSecond: 12,
  maxClosureMeters: 50,
  simplifyMeters: 10,
  minAreaM2: 2_000,
  minWidthMeters: 20,
  maxRetracedShare: 0.2,
  retraceMeters: 25,
  maxCandidates: 400,
  simplifyPerAccuracy: 1,
  retracePerAccuracy: 3,
  widthPerAccuracy: 2,
});

export function sealLoopRuleProblems(r: SealLoopRule): string[] {
  const p: string[] = [];
  if (r.name !== "enclosed-loop" || r.version !== 1) p.push("unknown seal loop rule");
  if (!(r.maxStepMeters > 0 && r.maxStepMeters <= 200)) p.push("observed step must be above 0 and at most the 200 m continuity break");
  if (!(r.maxStepMs > 0)) p.push("observed step time must be positive");
  if (!(r.maxSpeedMetersPerSecond > 0 && r.maxSpeedMetersPerSecond <= 12)) p.push("observed step speed may not exceed the on-foot policy's 12 m/s");
  if (!(r.maxClosureMeters >= 0 && r.maxClosureMeters <= r.maxStepMeters)) p.push("closing edge may not be longer than an observed step");
  if (!(r.simplifyMeters >= 0 && r.simplifyMeters <= 50)) p.push("simplification must be 0 to 50 m");
  if (!(r.minAreaM2 > 0)) p.push("minimum area must be positive");
  if (!(r.minWidthMeters > 0)) p.push("minimum width must be positive");
  if (!(r.maxRetracedShare >= 0 && r.maxRetracedShare <= 1)) p.push("retraced share must be 0 to 1");
  if (!(r.retraceMeters >= 0)) p.push("retrace distance must be 0 or more");
  if (!(Number.isInteger(r.maxCandidates) && r.maxCandidates >= 1)) p.push("candidate cap must be a whole number, 1 or more");
  for (const k of ["simplifyPerAccuracy", "retracePerAccuracy", "widthPerAccuracy"] as const) {
    if (!(r[k] >= 0 && r[k] <= 10)) p.push(`${k} must be 0 to 10`);
  }
  return p;
}

export const SEAL_LOOP_REASONS = [
  "enclosed", "no_closed_loop", "loop_too_small", "loop_retraced", "loop_too_thin", "insufficient_route", "route_outside_local_frame",
] as const;
export type SealLoopReason = (typeof SEAL_LOOP_REASONS)[number];

export interface SealLoopFix {
  lat: number;
  lng: number;
  timestamp: number;
  /** Reported horizontal accuracy in metres; absent or not finite counts as the policy's 40 m. */
  accuracy?: number | null;
  breakBefore?: boolean;
}

/** The on-foot policy's weakest accepted accuracy (shared measurement policy). */
export const MAX_ACCURACY_M = 40;

export interface LoopMeasure {
  /** Median reported accuracy of the loop's fixes, as used. */
  uncertaintyMeters: number;
  areaM2: number;
  perimeterMeters: number;
  retracedShare: number;
  widthMeters: number;
}

export interface SealLoopResult {
  version: number;
  sealed: boolean;
  reason: SealLoopReason;
  /** Transient, for tests and measurement only: never stored. The qualifying loop, or the largest-area candidate. */
  best: LoopMeasure | null;
  candidates: number;
  stretches: number;
}

/* ── geometry ─────────────────────────────────────────────────────────────── */

function signedArea(p: readonly PlanarPoint[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!, b = p[(i + 1) % p.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

function pointSegmentDistance(p: PlanarPoint, a: PlanarPoint, b: PlanarPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Douglas-Peucker on an open polyline, iterative. Keeps both ends. */
function simplifyOpen(p: readonly PlanarPoint[], tol: number): PlanarPoint[] {
  if (p.length <= 2 || tol <= 0) return [...p];
  const keep = new Uint8Array(p.length);
  keep[0] = 1;
  keep[p.length - 1] = 1;
  const stack: [number, number][] = [[0, p.length - 1]];
  while (stack.length > 0) {
    const [i, j] = stack.pop()!;
    let worst = -1, at = -1;
    for (let k = i + 1; k < j; k++) {
      const d = pointSegmentDistance(p[k]!, p[i]!, p[j]!);
      if (d > worst) { worst = d; at = k; }
    }
    if (at >= 0 && worst > tol) {
      keep[at] = 1;
      stack.push([i, at], [at, j]);
    }
  }
  return p.filter((_, k) => keep[k] === 1);
}

/**
 * A closed ring simplified: split at the vertex farthest from the first, so
 * both halves are open polylines with fixed ends that lie on the ring.
 */
function simplifyRing(ring: readonly PlanarPoint[], tol: number): PlanarPoint[] {
  if (ring.length <= 3) return [...ring];
  let far = 0, best = -1;
  for (let k = 1; k < ring.length; k++) {
    const d = Math.hypot(ring[k]!.x - ring[0]!.x, ring[k]!.y - ring[0]!.y);
    if (d > best) { best = d; far = k; }
  }
  const first = simplifyOpen(ring.slice(0, far + 1), tol);
  const second = simplifyOpen([...ring.slice(far), ring[0]!], tol);
  return [...first, ...second.slice(1, -1)];
}

const RETRACE_SAMPLE_M = 5;
const ANTIPARALLEL_COS = -Math.SQRT1_2;

/** Measure a closed ring (the closing edge from last to first is implied). */
export function measureLoop(ring: readonly PlanarPoint[], rule: SealLoopRule, uncertaintyMeters: number): LoopMeasure {
  const s = simplifyRing(ring, Math.max(rule.simplifyMeters, uncertaintyMeters * rule.simplifyPerAccuracy));
  const retraceMeters = Math.max(rule.retraceMeters, uncertaintyMeters * rule.retracePerAccuracy);
  const n = s.length;
  const areaM2 = Math.abs(signedArea(s));
  const edges: { a: PlanarPoint; b: PlanarPoint; len: number; ux: number; uy: number }[] = [];
  let perimeterMeters = 0;
  for (let i = 0; i < n; i++) {
    const a = s[i]!, b = s[(i + 1) % n]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    perimeterMeters += len;
    edges.push({ a, b, len, ux: len > 0 ? (b.x - a.x) / len : 0, uy: len > 0 ? (b.y - a.y) / len : 0 });
  }
  let retraced = 0;
  if (retraceMeters > 0) {
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i]!;
      if (e.len === 0) continue;
      const samples = Math.max(1, Math.ceil(e.len / RETRACE_SAMPLE_M));
      for (let k = 0; k < samples; k++) {
        const f = (k + 0.5) / samples;
        const p = { x: e.a.x + (e.b.x - e.a.x) * f, y: e.a.y + (e.b.y - e.a.y) * f };
        for (let j = 0; j < edges.length; j++) {
          if (j === i) continue;
          const o = edges[j]!;
          if (o.len === 0 || e.ux * o.ux + e.uy * o.uy > ANTIPARALLEL_COS) continue;
          if (pointSegmentDistance(p, o.a, o.b) <= retraceMeters) { retraced += e.len / samples; break; }
        }
      }
    }
  }
  return {
    uncertaintyMeters,
    areaM2,
    perimeterMeters,
    retracedShare: perimeterMeters > 0 ? Math.min(1, retraced / perimeterMeters) : 1,
    widthMeters: perimeterMeters > 0 ? (2 * areaM2) / perimeterMeters : 0,
  };
}

function verdictOf(m: LoopMeasure, rule: SealLoopRule): SealLoopReason {
  if (m.areaM2 < rule.minAreaM2) return "loop_too_small";
  if (m.retracedShare > rule.maxRetracedShare) return "loop_retraced";
  if (m.widthMeters < Math.max(rule.minWidthMeters, m.uncertaintyMeters * rule.widthPerAccuracy)) return "loop_too_thin";
  return "enclosed";
}

/* ── the evaluation ───────────────────────────────────────────────────────── */

interface Candidate {
  /** First fix of the loop. */
  i: number;
  /** Last fix of the loop. */
  k: number;
  /** For a crossing: the crossing point, which starts and ends the ring. */
  cross?: PlanarPoint;
}

/** Median reported accuracy of fixes i..k, capped at the policy maximum; a missing one counts as the maximum. */
function uncertaintyOf(fixes: readonly SealLoopFix[], i: number, k: number): number {
  const acc: number[] = [];
  for (let q = i; q <= k; q++) {
    const a = fixes[q]!.accuracy;
    acc.push(typeof a === "number" && Number.isFinite(a) && a >= 0 ? Math.min(a, MAX_ACCURACY_M) : MAX_ACCURACY_M);
  }
  acc.sort((x, y) => x - y);
  return acc[Math.floor((acc.length - 1) / 2)]!;
}

function observed(a: SealLoopFix, b: SealLoopFix, pauses: PauseSource, rule: SealLoopRule): boolean {
  const ta = { latitude: a.lat, longitude: a.lng, timestamp: a.timestamp };
  const tb = { latitude: b.lat, longitude: b.lng, timestamp: b.timestamp, breakBefore: b.breakBefore };
  if (hasEvidenceBreak(ta, tb, pauses)) return false;
  const dt = b.timestamp - a.timestamp;
  if (!(dt > 0) || dt > rule.maxStepMs) return false;
  const d = haversineMeters(ta, tb);
  return d <= rule.maxStepMeters && d / (dt / 1000) <= rule.maxSpeedMetersPerSecond;
}

/**
 * Whether the accepted fixes of one verified session enclose ground under
 * `rule`. The caller passes only fixes the movement pipeline accepted, in
 * time order, and the session's own pauses.
 */
export function evaluateSealLoop(fixes: readonly SealLoopFix[], pauses: PauseSource, rule: SealLoopRule): SealLoopResult {
  const out = (reason: SealLoopReason, extra: Partial<SealLoopResult> = {}): SealLoopResult =>
    ({ version: rule.version, sealed: reason === "enclosed", reason, best: null, candidates: 0, stretches: 0, ...extra });
  const valid = fixes.every((f) => Number.isFinite(f.lat) && Number.isFinite(f.lng) && Number.isFinite(f.timestamp)
    && Math.abs(f.lat) <= 90 && Math.abs(f.lng) <= 180);
  if (!valid || fixes.length < 4) return out("insufficient_route");

  let pts: PlanarPoint[];
  try {
    const frame = projector({ latitude: fixes[0]!.lat, longitude: fixes[0]!.lng });
    pts = fixes.map((f) => frame.project({ latitude: f.lat, longitude: f.lng }));
  } catch (err) {
    if (err instanceof RouteGeometryError) return out("route_outside_local_frame");
    throw err;
  }

  // Stretches: maximal runs of fixes joined by observed steps.
  const stretchOf = new Int32Array(fixes.length);
  let stretches = 1;
  for (let i = 1; i < fixes.length; i++) {
    if (!observed(fixes[i - 1]!, fixes[i]!, pauses, rule)) stretches += 1;
    stretchOf[i] = stretches - 1;
  }

  const candidates: Candidate[] = [];
  const cell = Math.max(rule.maxClosureMeters, rule.maxStepMeters, 1);
  const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;

  // (b) near passes, inside one stretch: for each fix, the latest later fix
  // within the closing distance (the largest loop through it) and the first
  // fix that comes back within it after the route has left (the smallest).
  {
    const grid = new Map<string, number[]>();
    for (let i = 0; i < pts.length; i++) {
      const k0 = key(pts[i]!.x, pts[i]!.y);
      const bucket = grid.get(k0);
      if (bucket) bucket.push(i); else grid.set(k0, [i]);
    }
    const seen = new Set<string>();
    const add = (i: number, k: number) => {
      const id = `${i}:${k}`;
      if (!seen.has(id)) { seen.add(id); candidates.push({ i, k }); }
    };
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      const gx = Math.floor(p.x / cell), gy = Math.floor(p.y / cell);
      const near: number[] = [];
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const k of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
          if (k <= i || stretchOf[k] !== stretchOf[i]) continue;
          if (Math.hypot(pts[k]!.x - p.x, pts[k]!.y - p.y) <= rule.maxClosureMeters) near.push(k);
        }
      }
      if (near.length === 0) continue;
      near.sort((x, y) => x - y);
      // The run of indices right after i is the route still near i; the first index after a break in it is a return.
      let run = i;
      let first = -1;
      for (const k of near) {
        if (k === run + 1) { run = k; continue; }
        first = k;
        break;
      }
      const last = near[near.length - 1]!;
      if (first >= 0 && first >= i + 3) add(i, first);
      if (last >= i + 3 && last > run) add(i, last);
    }
  }

  // (a) strict self-crossings of observed steps within one stretch.
  {
    const grid = new Map<string, number[]>();
    for (let s = 1; s < pts.length; s++) {
      if (stretchOf[s] !== stretchOf[s - 1]) continue;
      const a = pts[s - 1]!, b = pts[s]!;
      const x0 = Math.floor(Math.min(a.x, b.x) / cell), x1 = Math.floor(Math.max(a.x, b.x) / cell);
      const y0 = Math.floor(Math.min(a.y, b.y) / cell), y1 = Math.floor(Math.max(a.y, b.y) / cell);
      const seen = new Set<number>();
      for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
        const k0 = `${gx},${gy}`;
        for (const t of grid.get(k0) ?? []) {
          if (seen.has(t) || t >= s - 1 || stretchOf[t] !== stretchOf[s]) continue;
          seen.add(t);
          const c = segmentCrossing(pts[t - 1]!, pts[t]!, a, b);
          if (c) {
            const p0 = pts[t - 1]!, p1 = pts[t]!;
            candidates.push({ i: t, k: s - 1, cross: { x: p0.x + (p1.x - p0.x) * c.s, y: p0.y + (p1.y - p0.y) * c.s } });
          }
        }
        const bucket = grid.get(k0);
        if (bucket) bucket.push(s); else grid.set(k0, [s]);
      }
    }
  }

  if (candidates.length === 0) return out("no_closed_loop", { stretches });
  // Largest first; ties by position, so the order is a property of the route.
  candidates.sort((x, y) => (y.k - y.i) - (x.k - x.i) || x.i - y.i || x.k - y.k);

  let best: LoopMeasure | null = null;
  let bestReason: SealLoopReason = "no_closed_loop";
  let tried = 0;
  for (const c of candidates) {
    if (tried >= rule.maxCandidates) break;
    if (c.k - c.i < 2) continue;
    tried += 1;
    const ring = pts.slice(c.i, c.k + 1);
    if (c.cross) ring.unshift(c.cross);
    // Cheap bound: simplification within `simplifyMeters` changes the area by
    // at most that times the raw perimeter, so a ring below this cannot pass.
    const raw = Math.abs(signedArea(ring));
    let rawPerimeter = 0;
    for (let q = 0; q < ring.length; q++) {
      const a = ring[q]!, b = ring[(q + 1) % ring.length]!;
      rawPerimeter += Math.hypot(b.x - a.x, b.y - a.y);
    }
    const u = uncertaintyOf(fixes, c.i, c.k);
    let m: LoopMeasure;
    if (raw + Math.max(rule.simplifyMeters, u * rule.simplifyPerAccuracy) * rawPerimeter < rule.minAreaM2) {
      m = { uncertaintyMeters: u, areaM2: raw, perimeterMeters: NaN, retracedShare: NaN, widthMeters: NaN };
    } else {
      m = measureLoop(ring, rule, u);
    }
    const reason = verdictOf(m, rule);
    if (reason === "enclosed") return { version: rule.version, sealed: true, reason, best: m, candidates: tried, stretches };
    if (best === null || m.areaM2 > best.areaM2) { best = m; bestReason = reason; }
  }
  return { version: rule.version, sealed: false, reason: bestReason, best, candidates: tried, stretches };
}
