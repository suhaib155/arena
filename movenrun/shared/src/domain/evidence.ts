/** Bounded session evidence, independent of the map's drawing budget. */
import { haversineMeters, projector, type PlanarPoint } from "./geo";
import { cellForCoordinate } from "./h3";
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

export function hasEvidenceBreak(a: SealRoutePoint, b: SealRoutePoint, pauses: PauseSource = []): boolean {
  if (b.breakBefore === true) return true;
  return (typeof pauses === "function" ? pauses() : pauses)
    .some((pause) => pause.startedAt < b.timestamp && pause.endedAt > a.timestamp);
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
