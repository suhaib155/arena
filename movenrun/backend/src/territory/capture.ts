/**
 * Closed-loop capture evaluation — the server's answer to "did this route
 * enclose anything, and may it claim it?".
 *
 * Server-authoritative by construction: it takes only the raw submitted points
 * plus configuration, and recomputes distance, closure, area, traversed cells
 * and captured cells itself. Nothing the client claims is read. There is no
 * input by which a caller can assert `captureEligible`.
 *
 * ## Endpoints being close is not enough
 * A route whose first and last points are 3 m apart satisfies closure and
 * nothing else. Capture additionally requires: enough points, enough distance,
 * enough duration, a non-degenerate simple polygon, an enclosed area inside the
 * configured band, forward-only timestamps, plausible speed, no teleports, and
 * acceptable GPS accuracy. Every failed requirement is reported, not just the
 * first, so the runner sees the whole picture.
 */
import type { TerritoryConfig } from "./config.js";
import {
  boundingBox,
  getLoopClosureDistanceMeters,
  hasSelfIntersection,
  haversineMeters,
  isValidCoordinate,
  polygonAreaSquareMeters,
  routeDistanceMeters,
  routeToRing,
  type BoundingBox,
  type GeoPoint,
  type Ring,
} from "./geometry.js";
import { getCapturedHexIdsForLoop, getTraversedHexIds } from "./h3.js";

/**
 * Machine-readable rejection reasons. The mobile app maps these to the
 * human-readable copy in PHASE 12; they are a stable API surface, so add rather
 * than rename.
 */
export type CaptureRejectionReason =
  | "insufficientPoints"
  | "insufficientDistance"
  | "insufficientDuration"
  | "loopNotClosed"
  | "invalidCoordinates"
  | "timestampReversal"
  | "impossibleSpeed"
  | "impossibleJump"
  | "poorGpsAccuracy"
  | "selfIntersectingRoute"
  | "degenerateGeometry"
  | "areaBelowMinimum"
  | "areaAboveMaximum";

export interface LoopCaptureEvaluation {
  loopClosed: boolean;
  closureDistanceMeters: number | null;
  enclosedAreaSquareMeters: number;
  captureEligible: boolean;
  captureRejectionReasons: CaptureRejectionReason[];
  traversedHexIds: string[];
  /** Empty unless `captureEligible` — cells are never computed for a route
   *  that cannot claim them, so a rejected route can't leak a capture preview. */
  capturedHexIds: string[];
  captureGridVersion: number;
  captureResolution: number;
  /** Server-recomputed route length in metres. */
  distanceMeters: number;
  durationSeconds: number;
  /** Bounding box of the enclosed polygon, when there is one. */
  bounds: BoundingBox | null;
}

export interface EvaluateLoopCaptureInput {
  points: GeoPoint[];
  startTime: number;
  endTime: number;
}

/**
 * Physics and quality checks over the raw sample sequence. Separated so
 * `antiCheat.ts` can reuse the same traversal for its risk scoring.
 */
export interface RouteQualityFindings {
  invalidCoordinateCount: number;
  timestampReversalCount: number;
  impossibleSpeedCount: number;
  impossibleJumpCount: number;
  poorAccuracyCount: number;
  poorAccuracyRatio: number;
  maxObservedSpeedMetersPerSecond: number;
  maxObservedJumpMeters: number;
  identicalPointRuns: number;
}

export function assessRouteQuality(
  points: GeoPoint[],
  config: TerritoryConfig,
): RouteQualityFindings {
  let invalidCoordinateCount = 0;
  let timestampReversalCount = 0;
  let impossibleSpeedCount = 0;
  let impossibleJumpCount = 0;
  let poorAccuracyCount = 0;
  let maxObservedSpeedMetersPerSecond = 0;
  let maxObservedJumpMeters = 0;
  let identicalPointRuns = 0;

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (!isValidCoordinate(point.lat, point.lng)) invalidCoordinateCount++;
    if (point.accuracy != null && point.accuracy > config.maxGpsAccuracyMeters) {
      poorAccuracyCount++;
    }
    if (i === 0) continue;

    const previous = points[i - 1];
    if (point.timestamp != null && previous.timestamp != null) {
      if (point.timestamp < previous.timestamp) timestampReversalCount++;
    }
    if (!isValidCoordinate(previous.lat, previous.lng) || !isValidCoordinate(point.lat, point.lng)) {
      continue;
    }

    const distance = haversineMeters(previous, point);
    if (distance > maxObservedJumpMeters) maxObservedJumpMeters = distance;
    if (distance > config.maxJumpMeters) impossibleJumpCount++;
    if (distance === 0) identicalPointRuns++;

    if (point.timestamp != null && previous.timestamp != null) {
      const seconds = (point.timestamp - previous.timestamp) / 1000;
      if (seconds > 0) {
        const speed = distance / seconds;
        if (speed > maxObservedSpeedMetersPerSecond) maxObservedSpeedMetersPerSecond = speed;
        if (speed > config.maxSpeedMetersPerSecond) impossibleSpeedCount++;
      }
    }
  }

  return {
    invalidCoordinateCount,
    timestampReversalCount,
    impossibleSpeedCount,
    impossibleJumpCount,
    poorAccuracyCount,
    poorAccuracyRatio: points.length > 0 ? poorAccuracyCount / points.length : 0,
    maxObservedSpeedMetersPerSecond,
    maxObservedJumpMeters,
    identicalPointRuns,
  };
}

/**
 * Evaluate a submitted route for closed-loop territory capture.
 *
 * Always returns a full evaluation — a rejected route still reports its
 * closure distance, enclosed area and traversed cells so the runner can see how
 * close they came. Only `capturedHexIds` is withheld unless eligible.
 */
export function evaluateLoopCapture(
  input: EvaluateLoopCaptureInput,
  config: TerritoryConfig,
): LoopCaptureEvaluation {
  const { points, startTime, endTime } = input;
  const reasons = new Set<CaptureRejectionReason>();

  const durationSeconds = Math.max(0, (endTime - startTime) / 1000);
  const distanceMeters = routeDistanceMeters(points.filter((p) => isValidCoordinate(p.lat, p.lng)));
  const closureDistanceMeters = getLoopClosureDistanceMeters(points);
  const loopClosed =
    closureDistanceMeters !== null && closureDistanceMeters <= config.maxClosureDistanceMeters;

  // ---- volume / effort requirements
  if (points.length < config.minRoutePoints) reasons.add("insufficientPoints");
  if (distanceMeters < config.minRouteDistanceMeters) reasons.add("insufficientDistance");
  if (durationSeconds < config.minDurationSeconds) reasons.add("insufficientDuration");
  if (!loopClosed) reasons.add("loopNotClosed");

  // ---- physics / quality
  const quality = assessRouteQuality(points, config);
  if (quality.invalidCoordinateCount > 0) reasons.add("invalidCoordinates");
  if (quality.timestampReversalCount > 0) reasons.add("timestampReversal");
  if (quality.impossibleSpeedCount > 0) reasons.add("impossibleSpeed");
  if (quality.impossibleJumpCount > 0) reasons.add("impossibleJump");
  if (quality.poorAccuracyRatio > config.maxPoorAccuracyRatio) reasons.add("poorGpsAccuracy");

  // ---- geometry
  const ring = routeToRing(points);
  let enclosedAreaSquareMeters = 0;
  let bounds: BoundingBox | null = null;

  if (!ring) {
    reasons.add("degenerateGeometry");
  } else {
    bounds = boundingBox(ring);
    enclosedAreaSquareMeters = polygonAreaSquareMeters(ring);
    if (hasSelfIntersection(ring)) reasons.add("selfIntersectingRoute");
    if (enclosedAreaSquareMeters < config.minAreaSquareMeters) reasons.add("areaBelowMinimum");
    if (enclosedAreaSquareMeters > config.maxAreaSquareMeters) reasons.add("areaAboveMaximum");
  }

  const traversedHexIds = getTraversedHexIds(points, config.resolution);
  const captureEligible = reasons.size === 0 && ring !== null;

  return {
    loopClosed,
    closureDistanceMeters,
    enclosedAreaSquareMeters,
    captureEligible,
    captureRejectionReasons: [...reasons],
    traversedHexIds,
    capturedHexIds: captureEligible ? capturedCells(ring, traversedHexIds, config) : [],
    captureGridVersion: config.gridVersion,
    captureResolution: config.resolution,
    distanceMeters,
    durationSeconds,
    bounds,
  };
}

/**
 * Cells the loop may claim: those it **encloses**, unioned with those it
 * actually **ran through**.
 *
 * The union is deliberate. `polygonToCells` is centre-based, and a
 * resolution-9 cell is ~0.1 km² while the minimum eligible loop is 0.01 km² —
 * so a perfectly legitimate small block loop can enclose no cell centre at all
 * and would otherwise capture nothing. Running the streets around a block is
 * exactly the behaviour this game is meant to reward, and PHASE 14 makes the
 * same point in the other direction: a runner must not be required to reach a
 * cell's exact centre.
 *
 * The two sets stay separately reported (`traversedHexIds` vs `capturedHexIds`)
 * because the ownership rules weight them differently — a directly crossed
 * rival cell takes a stronger attack than a merely enclosed one (see rules.ts).
 *
 * Enclosed cells come first so the ordering is stable and enclosure-dominant.
 */
function capturedCells(
  ring: Ring | null,
  traversedHexIds: string[],
  config: TerritoryConfig,
): string[] {
  if (!ring) return [];
  const enclosed = getCapturedHexIdsForLoop(ring, config.resolution);
  const union = new Set(enclosed);
  for (const cellId of traversedHexIds) union.add(cellId);
  return [...union];
}
