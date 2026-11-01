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
 * Before a candidate is measured, its retraced spurs are cut: wherever the
 * loop runs out and back along itself (two points of the ring that stay
 * within the retrace distance of each other while the path between them
 * grows past twice that distance), the out-and-back part is removed. A long
 * stick in front of a loop (a lollipop), a detour down a dead end, and the
 * stretch of an out-and-back route are spurs; what remains is the loop.
 * Candidates are trimmed the same way at their closing edge before they are
 * compared, so the many rings a long stick produces collapse into one.
 *
 * A session qualifies when any candidate does. **Only fixes on a
 * qualifying loop (after the spurs are cut) or strictly inside one are
 * claimable** (claim scope, an owner-changeable hypothesis): the stick, a
 * spur outside the loop, and any stretch neither on nor inside a qualifying
 * loop claim nothing, and no step across a gap is filled. Every
 * candidate is measured (smallest first, skipping one whose fixes are already
 * claimable), within a work budget (`maxWorkUnits`, counted in elementary
 * steps: distance tests, segment tests, ring points handled). When the
 * budget runs out before any loop qualifies the answer is no, with reason
 * `work_budget_exceeded` (fails closed); loops already found stand.
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
 * Privacy: the result stored is a version, a boolean, a reason code and the
 * claimable cells (a subset of the cells the movement row already stores,
 * at the rule set's unit resolution). No coordinate, index, area or polygon
 * leaves this function's caller.
 *
 * Pure: no I/O and no clock.
 */
import { hasEvidenceBreak } from "@movenrun/shared/evidence";
import { latLngToCell } from "h3-js";
import { haversineMeters, interpolateCoordinate, projector, RouteGeometryError, segmentCrossing, type PlanarPoint } from "@movenrun/shared/geo";
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
  /** Retrace distance, also the spur-cutting distance. */
  retraceMeters: number;
  /** Work budget for one session, in elementary steps; past it the session fails closed. */
  maxWorkUnits: number;
  /**
   * GPS error raises the bar instead of sealing by itself. With `u` the
   * median reported accuracy of the loop's fixes (metres, capped at the
   * on-foot policy's 40 m; a fix with no accuracy counts as 40 m), the loop
   * is simplified at `max(simplifyMeters, u * simplifyPerAccuracy)`, retrace
   * (and spurs) are looked for within `max(retraceMeters, u * retracePerAccuracy)`
   * and the width must reach `max(minWidthMeters, u * widthPerAccuracy)`: an
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
  maxWorkUnits: 4_000_000,
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
  if (!(r.retraceMeters > 0)) p.push("retrace distance must be positive");
  if (!(Number.isInteger(r.maxWorkUnits) && r.maxWorkUnits >= 10_000 && r.maxWorkUnits <= 50_000_000)) p.push("work budget must be a whole number from 10,000 to 50,000,000");
  for (const k of ["simplifyPerAccuracy", "retracePerAccuracy", "widthPerAccuracy"] as const) {
    if (!(r[k] >= 0 && r[k] <= 10)) p.push(`${k} must be 0 to 10`);
  }
  return p;
}

export const SEAL_LOOP_REASONS = [
  "enclosed", "no_closed_loop", "loop_too_small", "loop_retraced", "loop_too_thin", "insufficient_route", "route_outside_local_frame",
  "work_budget_exceeded",
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
  /**
   * Indices (into the input fixes, ascending) of the claimable fixes: those on
   * a qualifying loop (after its spurs are cut) and those strictly inside one.
   * Empty unless sealed.
   */
  claimFixes: number[];
  /**
   * Indices q (ascending) such that fixes q and q + 1 are both claimable and
   * joined by an observed step: the only steps a caller may fill between.
   * Never a step across a gap.
   */
  claimSteps: number[];
  /** Transient, for tests and measurement only: never stored. The largest qualifying loop, or the largest-area candidate. */
  best: LoopMeasure | null;
  /** Distinct candidate loops measured. */
  candidates: number;
  stretches: number;
  /** Work spent, in the budget's units. */
  work: number;
}

/* ── work budget ──────────────────────────────────────────────────────────── */

class BudgetExceeded extends Error {}

class Budget {
  spent = 0;
  constructor(readonly limit: number) {}
  /** Refuses (and stops the evaluation) before the spend would pass the limit. */
  spend(n: number): void {
    if (this.spent + n > this.limit) { this.spent = this.limit; throw new BudgetExceeded(); }
    this.spent += n;
  }
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

const dist = (a: PlanarPoint, b: PlanarPoint) => Math.hypot(a.x - b.x, a.y - b.y);

/** Even-odd test; a point on the boundary may go either way (its cell is on the loop anyway). */
function insideRing(p: PlanarPoint, ring: readonly PlanarPoint[]): boolean {
  let inside = false;
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const pa = ring[a]!, pb = ring[b]!;
    if ((pa.y > p.y) !== (pb.y > p.y) && p.x < ((pb.x - pa.x) * (p.y - pa.y)) / (pb.y - pa.y) + pa.x) inside = !inside;
  }
  return inside;
}

function pointSegmentDistance(p: PlanarPoint, a: PlanarPoint, b: PlanarPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Douglas-Peucker on an open polyline, iterative. Keeps both ends. */
function simplifyOpen(p: readonly PlanarPoint[], tol: number, budget: Budget): PlanarPoint[] {
  if (p.length <= 2 || tol <= 0) return [...p];
  const keep = new Uint8Array(p.length);
  keep[0] = 1;
  keep[p.length - 1] = 1;
  const stack: [number, number][] = [[0, p.length - 1]];
  while (stack.length > 0) {
    const [i, j] = stack.pop()!;
    budget.spend(j - i);
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
function simplifyRing(ring: readonly PlanarPoint[], tol: number, budget: Budget): PlanarPoint[] {
  if (ring.length <= 3) return [...ring];
  let far = 0, best = -1;
  for (let k = 1; k < ring.length; k++) {
    const d = dist(ring[k]!, ring[0]!);
    if (d > best) { best = d; far = k; }
  }
  budget.spend(ring.length);
  const first = simplifyOpen(ring.slice(0, far + 1), tol, budget);
  const second = simplifyOpen([...ring.slice(far), ring[0]!], tol, budget);
  return [...first, ...second.slice(1, -1)];
}

/**
 * Cut retraced spurs out of a closed ring (positions are cyclic; the edge
 * from the last point back to the first is part of the ring). From every
 * position, two pointers step outwards along the ring, each step taking the
 * move that keeps them closest, for as long as they stay within `radius` of
 * each other. When the path they enclose is longer than twice `radius`, it
 * ran out and back: it is a spur and is removed. On a straight line or a
 * corner the pointers part within about `radius` of path, so nothing that is
 * not a retrace is removed; a loop wider than `radius` is never collapsed.
 * Returns the kept positions in ring order.
 */
export function cutSpurs(ring: readonly PlanarPoint[], radius: number, budget: Budget = new Budget(Number.MAX_SAFE_INTEGER)): number[] {
  const n = ring.length;
  const all = Array.from({ length: n }, (_, i) => i);
  if (n < 4 || radius <= 0) return all;
  const edge = new Float64Array(n); // edge[i]: length from i to i + 1 (cyclic)
  for (let i = 0; i < n; i++) edge[i] = dist(ring[i]!, ring[(i + 1) % n]!);
  const removed = new Uint8Array(n);
  const mod = (i: number) => ((i % n) + n) % n;
  let m = 0;
  while (m < n) {
    if (removed[m]) { m += 1; continue; }
    let l = m - 1, r = m + 1; // unwrapped positions
    let path = edge[mod(l)]! + edge[mod(m)]!;
    budget.spend(1);
    if (dist(ring[mod(l)]!, ring[mod(r)]!) > radius) { m += 1; continue; }
    // Expand while the enclosed stretch stays a retrace and leaves at least 3 points of the ring.
    for (;;) {
      if (r - l + 1 >= n - 2) break;
      budget.spend(3);
      const a = dist(ring[mod(l - 1)]!, ring[mod(r)]!);
      const b = dist(ring[mod(l)]!, ring[mod(r + 1)]!);
      const c = dist(ring[mod(l - 1)]!, ring[mod(r + 1)]!);
      const best = Math.min(a, b, c);
      if (best > radius || removed[mod(l - 1)] || removed[mod(r + 1)]) break;
      if (best === c) { path += edge[mod(l - 1)]! + edge[mod(r)]!; l -= 1; r += 1; }
      else if (best === a) { path += edge[mod(l - 1)]!; l -= 1; }
      else { path += edge[mod(r)]!; r += 1; }
    }
    if (path > 2 * radius) {
      for (let q = l + 1; q < r; q++) removed[mod(q)] = 1;
      m = Math.max(m + 1, r);
    } else {
      m += 1;
    }
  }
  const kept = all.filter((i) => !removed[i]);
  return kept.length >= 3 ? kept : all.filter(() => false);
}

const RETRACE_SAMPLE_M = 5;
const ANTIPARALLEL_COS = -Math.SQRT1_2;

/** Measure a closed ring (the closing edge from last to first is implied). */
export function measureLoop(ring: readonly PlanarPoint[], rule: SealLoopRule, uncertaintyMeters: number, budget: Budget = new Budget(Number.MAX_SAFE_INTEGER)): LoopMeasure {
  const s = simplifyRing(ring, Math.max(rule.simplifyMeters, uncertaintyMeters * rule.simplifyPerAccuracy), budget);
  const retraceMeters = Math.max(rule.retraceMeters, uncertaintyMeters * rule.retracePerAccuracy);
  const n = s.length;
  const areaM2 = Math.abs(signedArea(s));
  const edges: { a: PlanarPoint; b: PlanarPoint; len: number; ux: number; uy: number }[] = [];
  let perimeterMeters = 0;
  for (let i = 0; i < n; i++) {
    const a = s[i]!, b = s[(i + 1) % n]!;
    const len = dist(a, b);
    perimeterMeters += len;
    edges.push({ a, b, len, ux: len > 0 ? (b.x - a.x) / len : 0, uy: len > 0 ? (b.y - a.y) / len : 0 });
  }
  // Retrace through a grid of edges (cell = retrace distance): each sample tests only nearby edges.
  const cell = Math.max(retraceMeters, 1);
  const grid = new Map<string, number[]>();
  edges.forEach((e, i) => {
    if (e.len === 0) return;
    const x0 = Math.floor((Math.min(e.a.x, e.b.x) - cell) / cell), x1 = Math.floor((Math.max(e.a.x, e.b.x) + cell) / cell);
    const y0 = Math.floor((Math.min(e.a.y, e.b.y) - cell) / cell), y1 = Math.floor((Math.max(e.a.y, e.b.y) + cell) / cell);
    budget.spend((x1 - x0 + 1) * (y1 - y0 + 1));
    for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
      const k = `${gx},${gy}`;
      const bucket = grid.get(k);
      if (bucket) bucket.push(i); else grid.set(k, [i]);
    }
  });
  let retraced = 0;
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]!;
    if (e.len === 0) continue;
    const samples = Math.max(1, Math.ceil(e.len / RETRACE_SAMPLE_M));
    for (let k = 0; k < samples; k++) {
      const f = (k + 0.5) / samples;
      const p = { x: e.a.x + (e.b.x - e.a.x) * f, y: e.a.y + (e.b.y - e.a.y) * f };
      const near = grid.get(`${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`) ?? [];
      budget.spend(1 + near.length);
      for (const j of near) {
        if (j === i) continue;
        const o = edges[j]!;
        if (e.ux * o.ux + e.uy * o.uy > ANTIPARALLEL_COS) continue;
        if (pointSegmentDistance(p, o.a, o.b) <= retraceMeters) { retraced += e.len / samples; break; }
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
  if (!(m.areaM2 >= rule.minAreaM2)) return "loop_too_small";
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
  /** For an untrimmed crossing: the crossing point, which starts and ends the ring. */
  cross?: PlanarPoint;
}

/** Median reported accuracy of the given fixes, capped at the policy maximum; a missing one counts as the maximum. */
function uncertaintyOf(fixes: readonly SealLoopFix[], idx: readonly number[]): number {
  const acc = idx.map((q) => {
    const a = fixes[q]!.accuracy;
    return typeof a === "number" && Number.isFinite(a) && a >= 0 ? Math.min(a, MAX_ACCURACY_M) : MAX_ACCURACY_M;
  });
  if (acc.length === 0) return MAX_ACCURACY_M;
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

/** Most fixes looked at per grid cell and direction when searching for a near pass. */
const NEAR_SCAN_PER_CELL = 64;
/** Most earlier steps tested for a crossing in one grid cell (the latest ones). */
const CROSS_SCAN_PER_CELL = 64;

/**
 * Whether the accepted fixes of one verified session enclose ground under
 * `rule`, and which fixes lie on the loops that do. The caller passes only
 * fixes the movement pipeline accepted, in time order, and the session's own
 * pauses.
 */
export function evaluateSealLoop(fixes: readonly SealLoopFix[], pauses: PauseSource, rule: SealLoopRule): SealLoopResult {
  const budget = new Budget(rule.maxWorkUnits);
  let stretches = 0;
  let tried = 0;
  const out = (reason: SealLoopReason, extra: Partial<SealLoopResult> = {}): SealLoopResult =>
    ({ version: rule.version, sealed: false, reason, claimFixes: [], claimSteps: [], best: null, candidates: tried, stretches, work: budget.spent, ...extra });
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
  const n = pts.length;

  // Stretches (maximal runs of fixes joined by observed steps) and path length along the route.
  const stretchOf = new Int32Array(n);
  const along = new Float64Array(n);
  stretches = 1;
  for (let i = 1; i < n; i++) {
    if (!observed(fixes[i - 1]!, fixes[i]!, pauses, rule)) stretches += 1;
    stretchOf[i] = stretches - 1;
    along[i] = along[i - 1]! + dist(pts[i - 1]!, pts[i]!);
  }
  // Isoperimetric bound: a ring shorter than this cannot reach the minimum area, whatever its shape.
  const minRing = 2 * Math.sqrt(Math.PI * rule.minAreaM2);
  const closure = rule.maxClosureMeters;
  const cell = Math.max(closure, rule.maxStepMeters, 1);
  // Sticks are trimmed at the retrace distance for the session's median
  // accuracy; each loop's spurs are then cut at its own retrace distance (the
  // same distance the retrace test uses, so nothing it would accept is cut).
  const allIdx = Array.from({ length: n }, (_, q) => q);
  const trimRadius = Math.max(rule.retraceMeters, uncertaintyOf(fixes, allIdx) * rule.retracePerAccuracy);

  let best: LoopMeasure | null = null;
  let bestReason: SealLoopReason = "no_closed_loop";
  const claim = new Uint8Array(n);
  let claimed = 0;
  let largest: LoopMeasure | null = null;
  const rings: PlanarPoint[][] = [];

  try {
    /** Shrink a near pass from both ends while the route runs back along itself (a stick in front of the loop). */
    // Memo: the pair last trimmed from fix i (one per i) and where it ended,
    // so the many passes along one stick are walked back once, not once each.
    const memoK = new Int32Array(n).fill(-1), memoI = new Int32Array(n), memoTo = new Int32Array(n);
    const trim = (i0: number, k0: number): [number, number] => {
      let i = i0, k = k0;
      const seen: number[] = [];
      let end: [number, number];
      for (;;) {
        if (memoK[i] === k) { end = [memoI[i]!, memoTo[i]!]; break; }
        seen.push(i, k);
        if (k - i < 4) { end = [i, k]; break; }
        budget.spend(3);
        const a = dist(pts[i + 1]!, pts[k]!), b = dist(pts[i]!, pts[k - 1]!), c = dist(pts[i + 1]!, pts[k - 1]!);
        const m = Math.min(a, b, c);
        if (m > trimRadius) { end = [i, k]; break; }
        if (m === c) { i += 1; k -= 1; } else if (m === a) i += 1; else k -= 1;
      }
      for (let q = 0; q < seen.length; q += 2) { memoK[seen[q]!] = seen[q + 1]!; memoI[seen[q]!] = end[0]; memoTo[seen[q]!] = end[1]; }
      return end;
    };
    const candidates = new Map<string, Candidate>();
    const addNear = (i0: number, k1: number) => {
      // Slide the closing fix to the nearest point of the route around it (the
      // same stretch), so a pass along a stick pairs each fix with its
      // opposite and the trim can walk the pair back to where the loop starts.
      let k0 = k1;
      const d0 = (k: number) => dist(pts[i0]!, pts[k]!);
      for (let moves = 0; moves < n; moves++) {
        budget.spend(2);
        if (k0 + 1 < n && stretchOf[k0 + 1] === stretchOf[i0] && d0(k0 + 1) < d0(k0)) k0 += 1;
        else if (k0 - 1 > i0 && d0(k0 - 1) < d0(k0)) k0 -= 1;
        else break;
      }
      if (along[k0]! - along[i0]! + closure < minRing) return;
      const [i, k] = trim(i0, k0);
      if (along[k]! - along[i]! + closure < minRing) return;
      const id = `${i}:${k}`;
      if (!candidates.has(id)) candidates.set(id, { i, k });
    };

    // (b) near passes inside one stretch: for each fix, the latest later fix
    // within the closing distance and the first one after the route has gone
    // far enough to come back (path length over the isoperimetric bound).
    {
      const grid = new Map<string, number[]>();
      for (let i = 0; i < n; i++) {
        const k0 = `${Math.floor(pts[i]!.x / cell)},${Math.floor(pts[i]!.y / cell)}`;
        const bucket = grid.get(k0);
        if (bucket) bucket.push(i); else grid.set(k0, [i]);
      }
      budget.spend(n);
      for (let i = 0; i < n; i++) {
        const p = pts[i]!;
        const gx = Math.floor(p.x / cell), gy = Math.floor(p.y / cell);
        let latest = -1, first = -1;
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          const bucket = grid.get(`${gx + dx},${gy + dy}`);
          if (!bucket) continue;
          // Latest: scan from the end.
          for (let q = bucket.length - 1, seen = 0; q >= 0 && seen < NEAR_SCAN_PER_CELL; q--, seen++) {
            const k = bucket[q]!;
            if (k <= latest || k <= i) break;
            budget.spend(1);
            if (stretchOf[k] === stretchOf[i] && dist(pts[k]!, p) <= closure) { latest = k; break; }
          }
          // First return: binary search past the minimum ring length, then scan forward.
          let lo = 0, hi = bucket.length;
          while (lo < hi) { const mid = (lo + hi) >> 1; if (along[bucket[mid]!]! - along[i]! < minRing - closure || bucket[mid]! <= i) lo = mid + 1; else hi = mid; }
          budget.spend(Math.ceil(Math.log2(bucket.length + 1)));
          for (let q = lo, seen = 0; q < bucket.length && seen < NEAR_SCAN_PER_CELL; q++, seen++) {
            const k = bucket[q]!;
            if (first >= 0 && k >= first) break;
            if (stretchOf[k] !== stretchOf[i]) break;
            budget.spend(1);
            if (dist(pts[k]!, p) <= closure) { first = k; break; }
          }
        }
        if (latest >= 0) addNear(i, latest);
        if (first >= 0 && first !== latest) addNear(i, first);
      }
    }

    // (a) strict self-crossings of observed steps within one stretch.
    {
      const grid = new Map<string, number[]>();
      for (let s = 1; s < n; s++) {
        if (stretchOf[s] !== stretchOf[s - 1]) continue;
        const a = pts[s - 1]!, b = pts[s]!;
        const x0 = Math.floor(Math.min(a.x, b.x) / cell), x1 = Math.floor(Math.max(a.x, b.x) / cell);
        const y0 = Math.floor(Math.min(a.y, b.y) / cell), y1 = Math.floor(Math.max(a.y, b.y) / cell);
        const seen = new Set<number>();
        for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
          const k0 = `${gx},${gy}`;
          const bucket = grid.get(k0);
          if (bucket) {
            // The most recent steps in the cell only: a crossing with an older
            // pass also crosses or nears a later one, which makes a smaller loop.
            const from = Math.max(0, bucket.length - CROSS_SCAN_PER_CELL);
            budget.spend(bucket.length - from);
            for (let bq = bucket.length - 1; bq >= from; bq--) {
              const t = bucket[bq]!;
              if (seen.has(t) || t >= s - 1 || stretchOf[t] !== stretchOf[s]) continue;
              seen.add(t);
              const c = segmentCrossing(pts[t - 1]!, pts[t]!, a, b);
              if (!c) continue;
              if (along[s - 1]! - along[t]! + 2 * cell < minRing) continue;
              const [i, k] = trim(t, s - 1);
              const id = `${i}:${k}`;
              if (candidates.has(id)) continue;
              if (i === t && k === s - 1) {
                const p0 = pts[t - 1]!, p1 = pts[t]!;
                candidates.set(id, { i, k, cross: { x: p0.x + (p1.x - p0.x) * c.s, y: p0.y + (p1.y - p0.y) * c.s } });
              } else if (along[k]! - along[i]! + closure >= minRing) {
                candidates.set(id, { i, k });
              }
            }
            bucket.push(s);
          } else {
            grid.set(k0, [s]);
          }
        }
      }
    }

    if (candidates.size === 0) return out("no_closed_loop");
    // Smallest first (cheap to measure; repeated laps qualify on one lap and
    // every longer ring over the same fixes is then skipped); ties by
    // position, so the order is a property of the route.
    const ordered = [...candidates.values()].sort((x, y) => (x.k - x.i) - (y.k - y.i) || x.i - y.i || x.k - y.k);
    budget.spend(ordered.length * Math.ceil(Math.log2(ordered.length + 1)));
    // Claimed fixes counted in a Fenwick tree, so the skip test is logarithmic.
    const tree = new Int32Array(n + 1);
    const mark = (q: number) => { for (let x = q + 1; x <= n; x += x & -x) tree[x]! += 1; };
    const upTo = (q: number) => { let t = 0; for (let x = q + 1; x > 0; x -= x & -x) t += tree[x]!; return t; };

    for (const c of ordered) {
      // Skip a candidate whose fixes are all claimable already.
      budget.spend(2 * Math.ceil(Math.log2(n + 1)));
      if (upTo(c.k) - (c.i > 0 ? upTo(c.i - 1) : 0) === c.k - c.i + 1) continue;
      tried += 1;
      const ringIdx: number[] = [];
      const ringPts: PlanarPoint[] = [];
      if (c.cross) { ringIdx.push(-1); ringPts.push(c.cross); }
      for (let q = c.i; q <= c.k; q++) { ringIdx.push(q); ringPts.push(pts[q]!); }
      budget.spend(ringPts.length);
      const ringU = uncertaintyOf(fixes, ringIdx.filter((q) => q >= 0));
      const spurRadius = Math.max(rule.retraceMeters, ringU * rule.retracePerAccuracy);
      // Edges longer than the spur radius (the closing edge, a sparse step)
      // get points every radius at most, never claimable (index -1), so a
      // spur that returns along such an edge is seen and cut.
      const dIdx: number[] = [];
      const dPts: PlanarPoint[] = [];
      for (let q = 0; q < ringPts.length; q++) {
        const a = ringPts[q]!, b = ringPts[(q + 1) % ringPts.length]!;
        dIdx.push(ringIdx[q]!); dPts.push(a);
        const parts = Math.ceil(dist(a, b) / spurRadius);
        for (let j = 1; j < parts; j++) { dIdx.push(-1); dPts.push({ x: a.x + ((b.x - a.x) * j) / parts, y: a.y + ((b.y - a.y) * j) / parts }); }
      }
      budget.spend(dPts.length);
      ringIdx.length = 0; ringIdx.push(...dIdx);
      ringPts.length = 0; ringPts.push(...dPts);
      const keep = cutSpurs(ringPts, spurRadius, budget);
      if (keep.length < 3) { if (bestReason === "no_closed_loop") bestReason = "loop_too_small"; continue; }
      const kept = keep.map((q) => ringPts[q]!);
      const keptIdx = keep.map((q) => ringIdx[q]!).filter((q) => q >= 0);
      const u = uncertaintyOf(fixes, keptIdx);
      // Cheap bound: simplification within the tolerance changes the area by
      // at most that times the perimeter, so a ring below this cannot pass.
      const raw = Math.abs(signedArea(kept));
      let rawPerimeter = 0;
      for (let q = 0; q < kept.length; q++) rawPerimeter += dist(kept[q]!, kept[(q + 1) % kept.length]!);
      budget.spend(kept.length);
      const m: LoopMeasure = raw + Math.max(rule.simplifyMeters, u * rule.simplifyPerAccuracy) * rawPerimeter < rule.minAreaM2
        ? { uncertaintyMeters: u, areaM2: raw, perimeterMeters: rawPerimeter, retracedShare: Number.NaN, widthMeters: (2 * raw) / Math.max(rawPerimeter, 1e-9) }
        : measureLoop(kept, rule, u, budget);
      const reason = verdictOf(m, rule);
      if (reason === "enclosed") {
        for (const q of keptIdx) if (!claim[q]) { claim[q] = 1; claimed += 1; mark(q); }
        rings.push(kept);
        if (largest === null || m.areaM2 > largest.areaM2) largest = m;
      } else if (best === null || m.areaM2 > best.areaM2) {
        best = m;
        bestReason = reason;
      }
    }
  } catch (err) {
    if (!(err instanceof BudgetExceeded)) throw err;
    if (claimed === 0) return out("work_budget_exceeded", { best });
  }
  if (claimed > 0) {
    // Fixes strictly inside a qualifying loop are claimable too (ground the
    // loop encloses). Within what is left of the budget; when it runs out,
    // the loops' own fixes stand and nothing more is added.
    try {
      for (const ring of rings) {
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const p of ring) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
        budget.spend(ring.length + n);
        for (let q = 0; q < n; q++) {
          if (claim[q]) continue;
          const p = pts[q]!;
          if (p.x <= x0 || p.x >= x1 || p.y <= y0 || p.y >= y1) continue;
          budget.spend(ring.length);
          if (insideRing(p, ring)) claim[q] = 2;
        }
      }
    } catch (err) {
      if (!(err instanceof BudgetExceeded)) throw err;
    }
    const claimFixes: number[] = [];
    const claimSteps: number[] = [];
    for (let q = 0; q < n; q++) {
      if (!claim[q]) continue;
      claimFixes.push(q);
      if (q + 1 < n && claim[q + 1] && stretchOf[q + 1] === stretchOf[q]) claimSteps.push(q);
    }
    return { version: rule.version, sealed: true, reason: "enclosed", claimFixes, claimSteps, best: largest, candidates: tried, stretches, work: budget.spent };
  }
  return out(bestReason, { best });
}

/* ── claimable cells ──────────────────────────────────────────────────────── */

/** Most claimable cells one session may store; more fails closed (`work_budget_exceeded`). */
export const MAX_CLAIM_UNITS = 20_000;

export interface ClaimCellOptions {
  /** H3 resolution of the rule set's units. */
  resolution: number;
  /** Fill distance along a claimable observed step (the session path's own step, 5 m by default). */
  stepMeters?: number;
}

/**
 * The H3 cells (at `resolution`, deduplicated, ascending) of a sealed
 * result's claimable fixes, and of points every `stepMeters` along the
 * observed steps between two claimable fixes (so a path that fills between
 * fixes finds the loop's cells too). Null when the result is not sealed or
 * the set is larger than `MAX_CLAIM_UNITS`. Never fills across a gap.
 */
export function claimCellsOf(fixes: readonly SealLoopFix[], result: Pick<SealLoopResult, "sealed" | "claimFixes" | "claimSteps">, options: ClaimCellOptions): string[] | null {
  if (!result.sealed || result.claimFixes.length === 0) return null;
  const step = options.stepMeters ?? 5;
  const cells = new Set<string>();
  for (const q of result.claimFixes) cells.add(latLngToCell(fixes[q]!.lat, fixes[q]!.lng, options.resolution));
  for (const q of result.claimSteps) {
    const a = { latitude: fixes[q]!.lat, longitude: fixes[q]!.lng };
    const b = { latitude: fixes[q + 1]!.lat, longitude: fixes[q + 1]!.lng };
    const parts = Math.ceil(haversineMeters(a, b) / step);
    for (let k = 1; k < parts; k++) {
      const m = interpolateCoordinate(a, b, k / parts);
      cells.add(latLngToCell(m.latitude, m.longitude, options.resolution));
    }
    if (cells.size > MAX_CLAIM_UNITS) return null;
  }
  if (cells.size > MAX_CLAIM_UNITS) return null;
  return [...cells].sort();
}
