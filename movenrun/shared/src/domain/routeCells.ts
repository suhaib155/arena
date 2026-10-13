/**
 * Route cells: the gameplay cells a route passed through, including the ones
 * between two samples.
 *
 * `cellsForObservations` (in `h3.ts`) is containment of observed points and
 * deliberately does not interpolate. Sealing and solid capture need the cells
 * the path itself crossed, so this module derives them on purpose, with the
 * assumption stated and bounded:
 *
 *  - **Straight between samples.** Two consecutive samples are joined by a
 *    straight segment, and the cells along it are found by stepping along that
 *    segment every {@link ROUTE_STEP_METERS}. A cell whose corner the segment
 *    clips by less than one step can be missed; at the gameplay resolution
 *    (edges about 530 m) that is a sliver, and missing it under-claims rather
 *    than over-claims.
 *  - **Short gaps only.** A gap longer than {@link MAX_BRIDGE_METERS} is not
 *    bridged: the samples on each side still count, the ground between them
 *    does not. A signal loss in a tunnel or a phone in a pocket is not a
 *    straight line anyone can vouch for.
 *  - **Counted, not hidden.** The result says how many gaps were bridged and
 *    how many were left open, so a caller can show or audit it.
 *
 * Nothing here decides validity. Speed, accuracy and spoofing checks belong to
 * movement verification, which runs before any caller asks for route cells.
 *
 * The output is a set of cells in first-touch order, never a trail of points.
 */
import { haversineMeters, interpolateCoordinate } from "./geo";
import { cellForCoordinate, type GeoCoordinate, type H3Cell } from "./h3";

/** Spacing of the points tested along a segment, in metres. */
export const ROUTE_STEP_METERS = 50;

/** The longest gap between two samples that is joined, in metres. */
export const MAX_BRIDGE_METERS = 2_000;

export interface RouteCells {
  /** Every cell the route touched, each once, in first-touch order. */
  cells: H3Cell[];
  /** Cells added only by joining two samples (not containing any sample). */
  interpolatedCells: number;
  /** Gaps between samples in non-neighbouring positions that were joined. */
  bridgedGaps: number;
  /** Gaps longer than {@link MAX_BRIDGE_METERS} that were left open. */
  unbridgedGaps: number;
}

export interface RouteCellsOptions {
  maxBridgeMeters?: number;
}

/**
 * The cells along a route of observed points. Throws `H3DomainError` (from
 * `cellForCoordinate`) when a point is not a valid coordinate.
 */
export function cellsAlongRoute(
  points: readonly GeoCoordinate[],
  options: RouteCellsOptions = {},
): RouteCells {
  const maxBridge = options.maxBridgeMeters ?? MAX_BRIDGE_METERS;
  if (!Number.isFinite(maxBridge) || maxBridge < 0) {
    throw new RangeError("maxBridgeMeters must be a non-negative number");
  }

  const seen = new Set<string>();
  const sampled = new Set<string>();
  const cells: H3Cell[] = [];
  const add = (cell: H3Cell) => {
    if (seen.has(cell)) return;
    seen.add(cell);
    cells.push(cell);
  };

  let bridgedGaps = 0;
  let unbridgedGaps = 0;
  let previous: { point: GeoCoordinate; cell: H3Cell } | null = null;

  for (const point of points) {
    const cell = cellForCoordinate(point);
    sampled.add(cell);
    if (previous && previous.cell !== cell) {
      const distance = haversineMeters(previous.point, point);
      if (distance > maxBridge) {
        unbridgedGaps++;
      } else {
        const steps = Math.ceil(distance / ROUTE_STEP_METERS);
        let crossedOther = false;
        for (let i = 1; i < steps; i++) {
          const between = cellForCoordinate(interpolateCoordinate(previous.point, point, i / steps));
          if (between !== previous.cell && between !== cell) crossedOther = true;
          add(between);
        }
        if (crossedOther) bridgedGaps++;
      }
    }
    add(cell);
    previous = { point, cell };
  }

  const interpolatedCells = cells.filter((c) => !sampled.has(c)).length;
  return { cells, interpolatedCells, bridgedGaps, unbridgedGaps };
}
