/**
 * The app's projection of a movement session onto real geography.
 *
 * This is the mobile side of the one canonical world grid: cell ids here are
 * H3 resolution-8 indexes produced by `@movenrun/shared/h3`, the same module
 * the backend derives its traversed cells from. The app and the server no
 * longer index different worlds.
 *
 * ## What replaced what
 *
 * `lib/zones.ts` used to quantize routes onto a local ~300 m axial lattice and
 * hash the result into an `mrx-…` id. That lattice was never real geography: it
 * was an on-device approximation with no relationship to the H3 cells the
 * backend, the shared constants and the contracts have always used. The
 * generator is gone; what remains there is a recogniser, so a persisted id from
 * that era can be identified during migration and never mistaken for ground.
 *
 * ## Privacy
 *
 * A sequence of H3 cells is coarse location history — half a square kilometre
 * per cell, and a route is recoverable from the order. So this module derives
 * cells and hands them straight to the caller; it stores nothing, caches
 * nothing, and logs nothing. The only cells that reach disk are the ones the
 * player actually captures, which the store already held as zone ids and which
 * are single points rather than a trail.
 *
 * Nothing here captures, owns, defends or seals anything. It answers "which
 * ground did this route touch", and the answer is evidence of movement, not a
 * claim on the ground.
 */
import {
  cellsForObservations,
  isGameplayCell,
  parseGameplayCell,
  tryCellForCoordinate,
  type H3Cell,
} from "@movenrun/shared/h3";

import type { TrackPoint } from "./geo";
import { zoneNameForId } from "./zones";

export type { H3Cell };
export { isGameplayCell, parseGameplayCell };

/** One piece of real ground a route passed through. */
export interface CellTouch {
  /** A canonical H3 resolution-8 cell id. Never shown to a player as-is. */
  id: H3Cell;
  /** The friendly label a player sees instead of the index. */
  name: string;
}

/**
 * The cells a route touched, in first-touch order, each appearing once.
 *
 * A point the device could not resolve into a coordinate — a malformed sample,
 * a fix with a non-finite value — is skipped rather than throwing. The server
 * is the authority on whether a route is valid, and it rejects such payloads
 * with reasons; a summary screen refusing to render because one of nine hundred
 * samples was malformed would be the wrong failure. The skip is silent by
 * design and can never invent a cell, because {@link tryCellForCoordinate}
 * returns null rather than clamping.
 */
export function cellsForRoute(points: readonly TrackPoint[]): CellTouch[] {
  const usable: { latitude: number; longitude: number }[] = [];
  for (const point of points) {
    if (tryCellForCoordinate(point) === null) continue;
    usable.push({ latitude: point.latitude, longitude: point.longitude });
  }
  return cellsForObservations(usable).map(toTouch);
}

/**
 * The cell the device is in right now, or `null` when there is no usable fix.
 *
 * Null is a real answer and the only honest one when location is unavailable,
 * denied or stale. There is no fallback cell: not the last one, not the first
 * fixture, not a nearby guess. A screen with no location shows its own neutral
 * state rather than a current cell that is not where the player is.
 */
export function currentCell(point: TrackPoint | null | undefined): CellTouch | null {
  if (!point) return null;
  const cell = tryCellForCoordinate(point);
  return cell === null ? null : toTouch(cell);
}

/** The friendly label for a cell. Raw indexes stay internal — see
 *  `zoneNameForId`, which is deterministic for any id and so keeps working
 *  unchanged for both real cells and archived legacy ones. */
export function cellName(cell: H3Cell): string {
  return zoneNameForId(cell);
}

function toTouch(id: H3Cell): CellTouch {
  return { id, name: zoneNameForId(id) };
}
