/**
 * Versioned H3 territory grid.
 *
 * ## Two grids, deliberately
 * The deployed contracts and the existing route-proof path work at **H3
 * resolution 8** (`@movenrun/shared`'s `H3_RESOLUTION`). That is grid version 1
 * and it is frozen: nothing here changes how a legacy route hashes, which hex
 * it reports, or what the oracle signs.
 *
 * Territory **ownership** is a new concept and uses **grid version 2 at
 * resolution 9** (~0.1 km² per cell, about a city block — the scale a single
 * run loop can plausibly enclose; a resolution-8 cell at 0.74 km² is too coarse
 * for street-level capture).
 *
 * Every stored territory carries its own `h3Resolution` and `gridVersion`.
 * Resolution is **never** inferred from an application default after storage:
 * changing `TERRITORY_H3_RESOLUTION` later must not silently reinterpret rows
 * written under the old one. `assertSameGridVersion` exists to make accidental
 * cross-version mixing a loud failure rather than a subtle ownership bug.
 *
 * ## h3-js API
 * Verified against the installed h3-js (4.x):
 *   - `polygonToCells(coords, res, isGeoJson)` — `isGeoJson: true` means the
 *     input is `[lng, lat]`, which is what everything in this module uses.
 *   - `cellToBoundary(cell, formatAsGeoJson)` — `true` returns `[lng, lat]`.
 * Neither order is guessed; `h3.test.ts` asserts both.
 */
import * as h3 from "h3-js";
import { LEGACY_GRID_VERSION, LEGACY_H3_RESOLUTION } from "./config.js";
import {
  isValidCoordinate,
  type GeoPoint,
  type Position,
  type Ring,
} from "./geometry.js";

export { LEGACY_GRID_VERSION, LEGACY_H3_RESOLUTION };

/** The territory ownership grid introduced by this work. */
export const TERRITORY_GRID_VERSION = 2;
export const TERRITORY_H3_RESOLUTION_V2 = 9;

/** Resolution paired with each known grid version. */
const GRID_RESOLUTIONS: Record<number, number> = {
  [LEGACY_GRID_VERSION]: LEGACY_H3_RESOLUTION,
  [TERRITORY_GRID_VERSION]: TERRITORY_H3_RESOLUTION_V2,
};

export function resolutionForGridVersion(gridVersion: number): number | null {
  return GRID_RESOLUTIONS[gridVersion] ?? null;
}

export function isKnownGridVersion(gridVersion: number): boolean {
  return gridVersion in GRID_RESOLUTIONS;
}

/**
 * Guard against mixing cells from different grids. Two H3 indexes at different
 * resolutions are simply different cells; comparing or unioning them silently
 * produces wrong ownership, so this throws rather than coercing.
 */
export function assertSameGridVersion(expected: number, actual: number, context: string): void {
  if (expected !== actual) {
    throw new Error(
      `Territory grid version mismatch in ${context}: expected v${expected}, got v${actual}. Cells from different grid versions must never be mixed.`,
    );
  }
}

/** True when the H3 index is valid and sits at the expected resolution. */
export function isCellOnGrid(cellId: string, resolution: number): boolean {
  return h3.isValidCell(cellId) && h3.getResolution(cellId) === resolution;
}

/** The H3 cell containing a coordinate, or null when the coordinate is invalid. */
export function latLngToCell(lat: number, lng: number, resolution: number): string | null {
  if (!isValidCoordinate(lat, lng)) return null;
  return h3.latLngToCell(lat, lng, resolution);
}

/**
 * Every distinct cell the route passed through, in first-visit order.
 *
 * Only the cells containing sample points — this is intentionally *not* a
 * continuous line trace. Territory rules treat a directly-crossed cell more
 * strongly than an enclosed one (see `rules.ts`), so under-reporting here is
 * conservative: it can never award more than the runner earned.
 */
export function getTraversedHexIds(points: GeoPoint[], resolution: number): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const point of points) {
    const cell = latLngToCell(point.lat, point.lng, resolution);
    if (!cell || seen.has(cell)) continue;
    seen.add(cell);
    ordered.push(cell);
  }
  return ordered;
}

/**
 * Cells whose centre falls inside the closed loop.
 *
 * `polygonToCells` is centre-based, so a cell the loop only clips is not
 * captured. That is the conservative reading and it matches the rule that a
 * runner must actually enclose ground to own it.
 */
export function getCapturedHexIdsForLoop(ring: Ring, resolution: number): string[] {
  if (ring.length < 4) return [];
  // `true` = the input is GeoJSON [lng, lat] — the order every ring here uses.
  return h3.polygonToCells([ring], resolution, true);
}

/**
 * Cell boundary cache.
 *
 * `cellToBoundary` is pure and deterministic, and the map API converts the same
 * popular cells on every viewport request, so the result is memoised. Bounded
 * with a simple insertion-order eviction: a Map preserves insertion order, so
 * deleting the first key drops the oldest entry.
 */
const MAX_CACHED_BOUNDARIES = 50_000;
const boundaryCache = new Map<string, Ring>();

/** Exported for tests only. */
export function _clearBoundaryCacheForTests(): void {
  boundaryCache.clear();
}

export function cellBoundaryRing(cellId: string): Ring {
  const cached = boundaryCache.get(cellId);
  if (cached) return cached;

  // `true` = return GeoJSON [lng, lat] positions.
  const boundary = h3.cellToBoundary(cellId, true) as Position[];
  const ring: Ring = boundary.map(([lng, lat]): Position => [lng, lat]);
  // GeoJSON rings must repeat their first position; h3 does not.
  if (ring.length > 0) ring.push([ring[0][0], ring[0][1]]);

  if (boundaryCache.size >= MAX_CACHED_BOUNDARIES) {
    const oldest = boundaryCache.keys().next().value;
    if (oldest !== undefined) boundaryCache.delete(oldest);
  }
  boundaryCache.set(cellId, ring);
  return ring;
}

export interface CellFeature {
  type: "Feature";
  id: string;
  properties: Record<string, unknown>;
  geometry: { type: "Polygon"; coordinates: Ring[] };
}

/** One H3 cell as a GeoJSON Polygon feature. */
export function h3CellToGeoJsonFeature(
  cellId: string,
  properties: Record<string, unknown> = {},
): CellFeature {
  return {
    type: "Feature",
    id: cellId,
    properties: { cellId, ...properties },
    geometry: { type: "Polygon", coordinates: [cellBoundaryRing(cellId)] },
  };
}

export interface CellFeatureCollection {
  type: "FeatureCollection";
  features: CellFeature[];
}

/** A FeatureCollection of cells, optionally with per-cell properties. */
export function h3CellsToGeoJsonFeatureCollection(
  cellIds: string[],
  propertiesFor: (cellId: string) => Record<string, unknown> = () => ({}),
): CellFeatureCollection {
  return {
    type: "FeatureCollection",
    features: cellIds.map((cellId) => h3CellToGeoJsonFeature(cellId, propertiesFor(cellId))),
  };
}

/** The ring-1 neighbours of a cell, excluding the cell itself. */
export function getNeighboringCells(cellId: string): string[] {
  if (!h3.isValidCell(cellId)) return [];
  return h3.gridDisk(cellId, 1).filter((id) => id !== cellId);
}

/** Centre of a cell as `[latitude, longitude]` — h3's own order, not GeoJSON. */
export function cellCenterLatLng(cellId: string): [number, number] {
  return h3.cellToLatLng(cellId);
}

/**
 * Every cell whose centre falls within a lat/lng bounding box, at `resolution`.
 * Used by the map API to scope a viewport query without scanning the table.
 */
export function cellsInBoundingBox(
  bounds: { west: number; south: number; east: number; north: number },
  resolution: number,
): string[] {
  const ring: Ring = [
    [bounds.west, bounds.south],
    [bounds.east, bounds.south],
    [bounds.east, bounds.north],
    [bounds.west, bounds.north],
    [bounds.west, bounds.south],
  ];
  return h3.polygonToCells([ring], resolution, true);
}
