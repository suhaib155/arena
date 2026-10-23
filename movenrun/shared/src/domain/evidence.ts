/** Bounded session evidence, independent of the map's drawing budget. */
import { haversineMeters, projector, type PlanarPoint } from "./geo";
import { cellForCoordinate } from "./h3";
import { isUnobservedBridge, ON_FOOT_POLICY, type MeasurementFix } from "./measurement";
import {
  createSealScanner,
  type PauseSource,
  type SealEvent,
  type SealRoutePoint,
  type SealingRules,
} from "./sealing";

/** Existing production HTTP/queue ceiling. This is not the display-point budget. */
export const MAX_CANONICAL_POINTS = 10_000;
export const EVIDENCE_CHUNK_SIZE = 256;
export const RECENT_EVIDENCE_POINTS = 256;
/** Smaller than reported GPS uncertainty; evaluated against route fixtures. */
export const SIMPLIFICATION_TOLERANCE_M = 0.1;
/** Budget relative to measured accepted evidence, never an asserted client distance. */
export const MAX_SIMPLIFICATION_DISTANCE_LOSS = 0.0001;

export type EvidenceStatus = "complete" | "capacity_limited";
export interface EvidencePoint extends SealRoutePoint { accuracy?: number | null }
interface Entry<P> { point: P; pinned: boolean; cell: string }
interface Chunk<P> { entries: Entry<P>[]; compacted: boolean; originalEnd: number }

/** A deliberate interruption: the device marked one, or the player paused. */
export function hasExplicitBreak(a: SealRoutePoint, b: SealRoutePoint, pauses: PauseSource = []): boolean {
  if (b.breakBefore === true) return true;
  return (typeof pauses === "function" ? pauses() : pauses)
    .some((pause) => pause.startedAt < b.timestamp && pause.endedAt > a.timestamp);
}

/**
 * The line from `a` to `b` is not evidence: an explicit break, or an
 * unobserved bridge (stale anchor after a rejected jump, outage, long silence).
 * Distance, duration, drawing and traversal all split here. Plausibility gates
 * use {@link hasExplicitBreak} instead, so a bridge never excuses a pair from
 * the speed checks.
 */
export function hasEvidenceBreak(a: EvidencePoint, b: EvidencePoint, pauses: PauseSource = []): boolean {
  return hasExplicitBreak(a, b, pauses) || isUnobservedBridge(a, b);
}

/**
 * Point floor for a submission that carries no session metadata.
 *
 * Kept for legacy uploads only. Without provenance the server cannot tell
 * whether the points were filtered by the on-foot capture rule, so a bare count
 * is the only evidence bar it has.
 */
export const LEGACY_MIN_POINTS = 10;

/**
 * Minimum evidence for a short metadata-bearing on-foot route (fewer than
 * {@link LEGACY_MIN_POINTS} accepted fixes).
 *
 * Every submitted fix of such a route has already passed `inspectFix` against
 * its predecessor, so each continuous segment is a displacement larger than
 * both reported accuracy circles. Five fixes are four such independent
 * observations. Nothing here depends on pace: a slower walk only ever adds
 * fixes and observed time, so this cannot punish slow movement.
 *
 * This is route evidence for saving a walk, not economic eligibility.
 */
export const SHORT_ROUTE_EVIDENCE = Object.freeze({
  minFixes: 5,
  minContinuousSegments: 4,
  /** Below this a reported accuracy is not a phone GNSS estimate. */
  minAccuracyMeters: 1,
  /** The app's own usable-signal ceiling; weaker fixes need the legacy count. */
  maxAccuracyMeters: 25,
  minObservedSeconds: 30,
  /** Furthest fix from the start of its continuous stretch must clear this and a multiple of the worst accuracy. */
  minExtentMeters: 40,
  extentAccuracyMultiple: 3,
});

export interface ShortRouteFix extends SealRoutePoint { accuracy: number | null }

/**
 * Human-readable reasons a short route lacks the evidence to stand without the
 * legacy point floor; empty when it has enough, or when it is not short.
 */
export function shortRouteEvidenceProblems(points: readonly ShortRouteFix[],
  pauses: PauseSource = []): string[] {
  if (points.length >= LEGACY_MIN_POINTS) return [];
  const policy = SHORT_ROUTE_EVIDENCE;
  if (points.length < policy.minFixes) {
    return [`Too few accepted GPS fixes for a short route: ${points.length} (needs ${policy.minFixes})`];
  }
  const problems: string[] = [];
  let segments = 0, observedMs = 0, extent = 0;
  // Extent is measured from the start of each continuous stretch, so ground
  // covered across a pause or break never stands in for observed movement.
  let stretchStart = points[0]!;
  for (let i = 1; i < points.length; i++) {
    if (hasEvidenceBreak(points[i - 1]!, points[i]!, pauses)) { stretchStart = points[i]!; continue; }
    segments += 1;
    observedMs += Math.max(0, points[i]!.timestamp - points[i - 1]!.timestamp);
    extent = Math.max(extent, haversineMeters(stretchStart, points[i]!));
  }
  if (segments < policy.minContinuousSegments) {
    problems.push(`Too few continuous GPS segments for a short route: ${segments} (needs ${policy.minContinuousSegments})`);
  }
  const accuracies = points.map((p) => p.accuracy);
  if (accuracies.some((a) => a === null || !Number.isFinite(a) ||
    a < policy.minAccuracyMeters || a > policy.maxAccuracyMeters)) {
    problems.push(`A short route needs reported accuracy between ${policy.minAccuracyMeters} and ${policy.maxAccuracyMeters} m on every fix`);
    return problems;
  }
  if (observedMs < policy.minObservedSeconds * 1000) {
    problems.push(`Short route covers only ${Math.round(observedMs / 1000)} s of continuous observation (needs ${policy.minObservedSeconds} s)`);
  }
  const worst = Math.max(...(accuracies as number[]));
  if (extent < Math.max(policy.minExtentMeters, policy.extentAccuracyMultiple * worst)) {
    problems.push("Short route stays too close to its start to rule out GPS drift");
  }
  return problems;
}

/**
 * Stationary drift (MR-C, Track A fixture S03).
 *
 * The anchor rule in `inspectFix` trusts the reported accuracy circles. A phone
 * that reports 6 m while its real error wanders 15 m (multipath beside tall
 * buildings) clears those circles every few fixes while standing still, and
 * each clearance was banked as walked distance: 632 m and 53 XP for five
 * minutes on one spot, verified by the server.
 *
 * Two grounded checks, both of which only ever withhold distance:
 *
 * 1. **Observed scatter.** The receiver's own stream says how noisy it is: the
 *    residual of the last few delivered fixes about a straight constant-speed
 *    track. Walking leaves a small residual; an error cloud jumping around one
 *    spot leaves a large one. The uncertainty used for the disjoint-circle test
 *    is the larger of the reported accuracy and a multiple of that residual.
 *    Client side only: the server never sees the rejected fixes it needs.
 * 2. **Wandering in place (server).** Within one continuous stretch, over the
 *    last two minutes, accepted movement whose path is far longer than the
 *    ground it spans (path > 4 x diameter) is going round in circles inside its
 *    own error envelope. Depends only on accepted points, so the server checks
 *    it on what was uploaded, which also covers older or modified clients. The
 *    phone does not apply it: at ratios tight enough to matter for drift it
 *    withholds honest laps of small loops, and the scatter check already does
 *    most of the work (measured in the MR-C doc).
 *
 * Neither invents distance: a withheld fix is simply not accepted, and the next
 * fix is measured from the same anchor, so a real walk loses at most a corner;
 * the server check rejects a route rather than trimming it.
 * Residual: these reduce, not remove, the false positive; see
 * docs/movement/MR-C_CLOCK_DRIFT_AND_XP_STATUS.md for the measured threshold.
 */
export const STATIONARY_DRIFT_POLICY = Object.freeze({
  /** Delivered fixes in the scatter estimate (about 32 s at the 4 s watch). */
  scatterFixes: 8,
  /** Fewer than this and there is no estimate (reported accuracy stands). */
  minScatterFixes: 4,
  /** The effective accuracy is at least this multiple of the residual RMS. */
  scatterMultiple: 2,
  /** Look-back for the wandering check, within one continuous stretch. */
  wanderWindowMs: 120_000,
  /**
   * Path longer than this multiple of the window's diameter is wandering. At a
   * walking 1.4 m/s (168 m in the window) honest laps of a loop narrower than
   * about 42 m fail it; that is the documented nonpassable case.
   */
  maxPathToDiameter: 4,
});

const METRES_PER_DEGREE = 111_320;

/**
 * Residual RMS (metres) of fixes about a least-squares constant-velocity track.
 * Zero when there are too few fixes to say anything.
 */
export function observedScatterMeters(fixes: readonly MeasurementFix[]): number {
  const n = fixes.length;
  if (n < STATIONARY_DRIFT_POLICY.minScatterFixes) return 0;
  const origin = fixes[0]!;
  const east = Math.cos((origin.latitude * Math.PI) / 180) * METRES_PER_DEGREE;
  const t = fixes.map((f) => (f.timestamp - origin.timestamp) / 1000);
  const meanT = t.reduce((a, b) => a + b, 0) / n;
  let varT = 0;
  for (const ti of t) varT += (ti - meanT) ** 2;
  let squared = 0;
  for (const axis of [
    fixes.map((f) => (f.longitude - origin.longitude) * east),
    fixes.map((f) => (f.latitude - origin.latitude) * METRES_PER_DEGREE),
  ]) {
    const mean = axis.reduce((a, b) => a + b, 0) / n;
    let cov = 0;
    for (let i = 0; i < n; i++) cov += (t[i]! - meanT) * (axis[i]! - mean);
    const slope = varT > 0 ? cov / varT : 0;
    for (let i = 0; i < n; i++) squared += (axis[i]! - mean - slope * (t[i]! - meanT)) ** 2;
  }
  return Math.sqrt(squared / (n - 2));
}

/**
 * The accepted points of `points` (oldest first) in the same continuous
 * stretch as, and within the wander window before, a candidate at `timestamp`.
 * The stretch ends at any evidence break, so a pause, background gap or
 * unobserved bridge never joins two places into one window.
 */
export function wanderWindow<P extends EvidencePoint>(points: readonly P[], timestamp: number,
  pauses: PauseSource = []): P[] {
  const window: P[] = [];
  for (let i = points.length - 1; i >= 0; i--) {
    const point = points[i]!;
    if (timestamp - point.timestamp > STATIONARY_DRIFT_POLICY.wanderWindowMs) break;
    window.unshift(point);
    if (i > 0 && hasEvidenceBreak(points[i - 1]!, point, pauses)) break;
  }
  return window;
}

/** True when `window` plus `next` covers much more path than ground. */
export function wandersInPlace(window: readonly EvidencePoint[], next: EvidencePoint,
  maxPathToDiameter: number = STATIONARY_DRIFT_POLICY.maxPathToDiameter): boolean {
  if (window.length < 2) return false;
  const all = [...window, next];
  let path = 0, diameter = 0;
  for (let i = 1; i < all.length; i++) path += haversineMeters(all[i - 1]!, all[i]!);
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) diameter = Math.max(diameter, haversineMeters(all[i]!, all[j]!));
  }
  return path > maxPathToDiameter * diameter;
}

/**
 * The phone's stationary-drift guard, applied after `inspectFix` accepts a fix.
 * `observe` every delivered fix (only those of usable quality and increasing
 * time feed the scatter estimate); `withholds` says whether an otherwise
 * accepted fix is inside the uncertainty the scatter shows.
 */
export function createStationaryDriftGuard() {
  const recent: MeasurementFix[] = [];
  return {
    observe(fix: MeasurementFix): void {
      if (fix.accuracy === null || !(fix.accuracy <= ON_FOOT_POLICY.maxAccuracyMeters)) return;
      if (recent.length > 0 && fix.timestamp <= recent[recent.length - 1]!.timestamp) return;
      recent.push(fix);
      if (recent.length > STATIONARY_DRIFT_POLICY.scatterFixes) recent.shift();
    },
    /** `previous` is the anchor `inspectFix` measured from, or null after a break. */
    withholds(previous: MeasurementFix | null, next: MeasurementFix & { breakBefore?: boolean }): boolean {
      if (!previous) return false;
      const scatter = STATIONARY_DRIFT_POLICY.scatterMultiple * observedScatterMeters(recent);
      const uncertainty = Math.max(previous.accuracy ?? ON_FOOT_POLICY.maxAccuracyMeters, scatter) +
        Math.max(next.accuracy ?? ON_FOOT_POLICY.maxAccuracyMeters, scatter);
      return haversineMeters(previous, next) <= uncertainty;
    },
  };
}

/**
 * The server's wandering check on uploaded points. Empty when the route gets
 * somewhere; one reason when any accepted point wandered in place.
 */
export function stationaryDriftProblems(points: readonly EvidencePoint[], pauses: PauseSource = []): string[] {
  for (let i = 1; i < points.length; i++) {
    const point = points[i]!;
    if (hasEvidenceBreak(points[i - 1]!, point, pauses)) continue;
    const window = wanderWindow(points.slice(0, i), point.timestamp, pauses);
    if (wandersInPlace(window, point)) {
      return ["Route wanders in place like stationary GPS drift"];
    }
  }
  return [];
}

/** Canonical measured distance: a missing segment never contributes a straight-line guess. */
export function evidenceDistance(points: readonly SealRoutePoint[], pauses: PauseSource = []): number {
  let distance = 0;
  for (let i = 1; i < points.length; i++) {
    if (!hasEvidenceBreak(points[i - 1]!, points[i]!, pauses)) {
      distance += haversineMeters(points[i - 1]!, points[i]!);
    }
  }
  return distance;
}

/** Stable witnesses survive array reindexing; intersection fractions must remain identical. */
export function crossingWitnesses(events: readonly SealEvent[], points: readonly SealRoutePoint[]): string {
  return JSON.stringify(events.filter((event) => event.method === "self_cross").map((event) => [
    points[event.startIndex - 1]?.timestamp,
    points[event.startIndex]?.timestamp,
    points[event.endIndex]?.timestamp,
    points[event.endIndex + 1]?.timestamp,
    event.closure.kind === "crossing" ? event.closure.priorFraction : null,
    event.closure.kind === "crossing" ? event.closure.closingFraction : null,
  ]));
}

function traversal<P extends EvidencePoint>(entries: readonly Entry<P>[], pauses: PauseSource): string {
  const cells: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const current = entries[i]!;
    if (i > 0 && hasEvidenceBreak(entries[i - 1]!.point, current.point, pauses)) cells.push("|");
    if (cells[cells.length - 1] !== current.cell) cells.push(current.cell);
  }
  return cells.join(",");
}

function deviation(point: PlanarPoint, a: PlanarPoint, b: PlanarPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2));
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}

/** Simplify one original chunk once. Original points never disappear into an archive. */
function simplify<P extends EvidencePoint>(entries: readonly Entry<P>[], rules: SealingRules,
  pauses: PauseSource): Entry<P>[] {
  if (entries.length < 3) return [...entries];
  let project: ReturnType<typeof projector>;
  try { project = projector(entries[0]!.point); } catch { return [...entries]; }
  let planar: PlanarPoint[];
  try { planar = entries.map((entry) => project.project(entry.point)); } catch { return [...entries]; }
  const keep = new Set<number>([0, entries.length - 1]);
  for (let i = 0; i < entries.length; i++) {
    if (entries[i]!.pinned) keep.add(i);
    if (i > 0 && (hasEvidenceBreak(entries[i - 1]!.point, entries[i]!.point, pauses) ||
      haversineMeters(entries[i - 1]!.point, entries[i]!.point) > rules.continuityBreakMeters ||
      entries[i - 1]!.cell !== entries[i]!.cell)) {
      keep.add(i - 1); keep.add(i);
    }
  }
  const anchors = [...keep].sort((a, b) => a - b);
  const stack: [number, number][] = anchors.slice(1).map((end, i) => [anchors[i]!, end]);
  while (stack.length) {
    const [start, end] = stack.pop()!;
    if (end - start < 2) continue;
    let worst = -1, split = -1;
    for (let i = start + 1; i < end; i++) {
      const error = deviation(planar[i]!, planar[start]!, planar[end]!);
      if (error > worst) { worst = error; split = i; }
    }
    // A removed sample cannot manufacture the engine's distance-based route break.
    if (haversineMeters(entries[start]!.point, entries[end]!.point) > rules.continuityBreakMeters) {
      split = Math.floor((start + end) / 2);
      worst = Infinity;
    }
    if (worst > SIMPLIFICATION_TOLERANCE_M) {
      keep.add(split); stack.push([start, split], [split, end]);
    }
  }
  return entries.filter((_, index) => keep.has(index));
}

export interface CanonicalEvidence<P extends EvidencePoint> {
  /** False means capacity was exhausted. Capture/time/distance still continue. */
  push(point: P): { represented: boolean; closed: boolean };
  snapshot(): P[];
  clear(): void;
  readonly events: readonly SealEvent[];
  readonly status: EvidenceStatus;
  readonly distanceMeters: number;
  readonly stats: {
    received: number; retained: number; chunks: number; compactedChunks: number;
    rejectedCompactions: number; removed: number; distanceLossMeters: number;
  };
}

/**
 * Only committed evidence reaches the live scanner. Old chunks may compact once;
 * the rolling window, break endpoints and every announced loop remain exact.
 * A candidate must preserve full ordered crossing witnesses and H3 traversal.
 * At saturation the represented prefix freezes. The workout itself keeps running.
 */
export function createCanonicalEvidence<P extends EvidencePoint>(rules: SealingRules,
  pauses: PauseSource = []): CanonicalEvidence<P> {
  const chunks: Chunk<P>[] = [];
  let scanner = createSealScanner(rules, pauses);
  let retained = 0, received = 0, removed = 0, compactedChunks = 0, rejectedCompactions = 0;
  let distanceLoss = 0, rawDistance = 0;
  let previous: P | null = null;
  let status: EvidenceStatus = "complete";
  let disposed = false;
  const flatten = () => chunks.flatMap((chunk) => chunk.entries);
  const points = () => flatten().map((entry) => entry.point);

  function compactOne(upcoming?: P): void {
    // Each original chunk is considered once; work is bounded and amortized.
    const chunk = chunks.find((candidate) => !candidate.compacted &&
      received - candidate.originalEnd >= RECENT_EVIDENCE_POINTS);
    if (!chunk) return;
    chunk.compacted = true;
    const replacement = simplify(chunk.entries, rules, pauses);
    if (replacement.length === chunk.entries.length) return;
    const originalEntries = flatten();
    const originalPoints = originalEntries.map((entry) => entry.point);
    const candidateEntries = chunks.flatMap((item) => item === chunk ? replacement : item.entries);
    const candidatePoints = candidateEntries.map((entry) => entry.point);
    const loss = Math.max(0, evidenceDistance(chunk.entries.map((entry) => entry.point), pauses) -
      evidenceDistance(replacement.map((entry) => entry.point), pauses));
    if (distanceLoss + loss > rawDistance * MAX_SIMPLIFICATION_DISTANCE_LOSS ||
      traversal(originalEntries, pauses) !== traversal(candidateEntries, pauses)) {
      rejectedCompactions += 1; return;
    }
    const replay = createSealScanner(rules, pauses);
    for (const point of candidatePoints) replay.push(point);
    let baseline = scanner;
    const before = upcoming ? [...originalPoints, upcoming] : originalPoints;
    const after = upcoming ? [...candidatePoints, upcoming] : candidatePoints;
    if (upcoming) {
      // At the hard cap, include the incoming fix in both candidate checks:
      // compaction must not hide the very crossing that is arriving now.
      baseline = createSealScanner(rules, pauses);
      for (const point of before) baseline.push(point);
      replay.push(upcoming);
    }
    if (crossingWitnesses(baseline.events, before) !== crossingWitnesses(replay.events, after) ||
      baseline.subpathCount !== replay.subpathCount ||
      JSON.stringify(baseline.unavailable) !== JSON.stringify(replay.unavailable)) {
      rejectedCompactions += 1; return;
    }
    const deleted = chunk.entries.length - replacement.length;
    chunk.entries = replacement;
    retained -= deleted; removed += deleted; compactedChunks += 1; distanceLoss += loss;
    scanner = replay;
    if (upcoming) {
      scanner = createSealScanner(rules, pauses);
      for (const point of candidatePoints) scanner.push(point);
    }
  }

  return {
    push(point) {
      if (disposed) return { represented: false, closed: false };
      received += 1;
      const broken = previous !== null && hasEvidenceBreak(previous, point, pauses);
      if (previous !== null && !broken) rawDistance += haversineMeters(previous, point);
      previous = point;
      if (status === "capacity_limited") return { represented: false, closed: false };
      if (retained >= MAX_CANONICAL_POINTS) compactOne(point);
      if (retained >= MAX_CANONICAL_POINTS) {
        status = "capacity_limited";
        return { represented: false, closed: false };
      }
      let last = chunks[chunks.length - 1];
      if (!last || last.entries.length >= EVIDENCE_CHUNK_SIZE || last.compacted) {
        last = { entries: [], compacted: false, originalEnd: received };
        chunks.push(last);
      }
      const entry: Entry<P> = { point, pinned: retained === 0 || broken, cell: cellForCoordinate(point) };
      if (broken && retained > 0) {
        const previousChunk = last.entries.length ? last : chunks[chunks.length - 2]!;
        previousChunk.entries[previousChunk.entries.length - 1]!.pinned = true;
      }
      last.entries.push(entry); last.originalEnd = received; retained += 1;
      const closures = scanner.push(point);
      if (closures.length) {
        const all = flatten();
        for (const event of closures) {
          for (let i = Math.max(0, event.startIndex - 1); i <= event.endIndex + 1; i++) {
            if (all[i]) all[i]!.pinned = true;
          }
        }
      }
      // Commit this fix and pin its new closures before a scheduled compaction.
      if (received % EVIDENCE_CHUNK_SIZE === 0) compactOne();
      return { represented: true, closed: closures.length > 0 };
    },
    snapshot: points,
    clear() {
      chunks.length = 0; previous = null; retained = 0; received = 0; removed = 0;
      distanceLoss = 0; rawDistance = 0; compactedChunks = 0; rejectedCompactions = 0;
      scanner = createSealScanner(rules, []); status = "capacity_limited"; disposed = true;
    },
    get events() { return scanner.events; },
    get status() { return status; },
    get distanceMeters() { return Math.max(0, rawDistance - distanceLoss); },
    get stats() {
      return { received, retained, chunks: chunks.length, compactedChunks, rejectedCompactions,
        removed, distanceLossMeters: distanceLoss };
    },
  };
}
