import * as h3 from "h3-js";
import { HexActivity, ZoneMintEligibility } from "@movenrun/shared";
import { H3_RESOLUTION, MIN_ACTIVITY_THRESHOLD } from "@movenrun/shared/src/constants/h3.js";
import {
  getLoopClosureDistanceMeters,
  isClosedLoop,
  isValidCoordinate,
  normalizePolygonCoordinates,
  routeToRing,
} from "../territory/geometry.js";
import {
  cellsInBoundingBox,
  getCapturedHexIdsForLoop,
  getNeighboringCells,
  getTraversedHexIds,
  h3CellsToGeoJsonFeatureCollection,
  h3CellToGeoJsonFeature,
  TERRITORY_H3_RESOLUTION_V2,
} from "../territory/h3.js";

/**
 * Hex/zone helpers.
 *
 * The original resolution-8 behaviour below (`latLngToHex`, `getHexIdsForPoints`,
 * `getNeighbors`, `hexToLatLng`, mint eligibility) is unchanged — the deployed
 * contracts and the oracle route proof depend on it.
 *
 * The territory-capture methods added underneath **delegate** to
 * `src/territory/*` rather than reimplementing anything. That is deliberate:
 * this file imports the bare `@movenrun/shared` specifier, which puts it
 * outside the backend's `tsc` include list (see backend/tsconfig.json), so
 * logic living here cannot be type-checked or unit-tested. The territory
 * modules import nothing from `@movenrun/shared`, are inside the type-check
 * scope, and carry the tests. Callers get the methods on `HexService`; the
 * behaviour lives where it can be verified.
 */
export class HexService {
  // Convert lat/lng to H3 hex ID at resolution 8
  latLngToHex(lat: number, lng: number): string {
    return h3.latLngToCell(lat, lng, H3_RESOLUTION);
  }

  // Get all H3 hex IDs covered by a list of GPS points
  getHexIdsForPoints(points: Array<{ lat: number; lng: number }>): string[] {
    const hexSet = new Set<string>();
    for (const p of points) {
      hexSet.add(this.latLngToHex(p.lat, p.lng));
    }
    return Array.from(hexSet);
  }

  // Get hex activity from DB (stub — will be wired to Drizzle queries)
  async getHexActivity(hexId: string): Promise<HexActivity> {
    // TODO: query from DB
    return {
      hexId,
      weeklyMoverCount: 0,
      monthlyMoverCount: 0,
      totalDistanceMeters: 0,
      topMover: "0x0000000000000000000000000000000000000000",
      topMoverDistanceMeters: 0,
      lastActivityAt: 0,
    };
  }

  async getMintEligibility(hexId: string): Promise<ZoneMintEligibility> {
    const activity = await this.getHexActivity(hexId);
    const isEligible = activity.monthlyMoverCount >= MIN_ACTIVITY_THRESHOLD;
    const mintCost = this._calculateMintCost(activity.weeklyMoverCount);

    return {
      hexId,
      isEligible,
      topMover: activity.topMover,
      weeklyMoverCount: activity.weeklyMoverCount,
      mintCost,
      oracleSig: "",
    };
  }

  async getDefenderScore(hexId: string): Promise<bigint> {
    // TODO: aggregate 30-day movement for current zone owner from DB
    return 0n;
  }

  // mintCost = BASE_MINT_COST * sqrt(weeklyMoverCount) — floor sqrt
  private _calculateMintCost(weeklyMoverCount: number): bigint {
    const BASE = 500n * BigInt(10 ** 18);
    const sqrtCount = BigInt(Math.floor(Math.sqrt(Math.max(weeklyMoverCount, 1))));
    return BASE * sqrtCount;
  }

  // Get neighboring hexes (ring of radius 1)
  getNeighbors(hexId: string): string[] {
    return h3.gridDisk(hexId, 1).filter((h) => h !== hexId);
  }

  // Hex center as lat/lng
  hexToLatLng(hexId: string): [number, number] {
    return h3.cellToLatLng(hexId);
  }

  // ---------------------------------------------------------------------------
  // Territory capture geometry (grid version 2 @ resolution 9).
  //
  // Every method below is a thin delegation to src/territory/* — see the class
  // comment. None of them touch the legacy resolution-8 path above.
  // ---------------------------------------------------------------------------

  /** Latitude/longitude range check, rejecting NaN and Infinity. */
  isValidCoordinate(lat: number, lng: number): boolean {
    return isValidCoordinate(lat, lng);
  }

  /**
   * Whether a route's endpoints are within `toleranceMeters` of each other.
   * Closure alone NEVER grants capture — see territory/capture.ts, which also
   * requires distance, duration, area, geometry validity and GPS quality.
   */
  isClosedLoop(
    points: Array<{ lat: number; lng: number }>,
    toleranceMeters: number
  ): boolean {
    return isClosedLoop(points, toleranceMeters);
  }

  /** Straight-line metres from a route's last point back to its first. */
  getLoopClosureDistanceMeters(
    points: Array<{ lat: number; lng: number }>
  ): number | null {
    return getLoopClosureDistanceMeters(points);
  }

  /** Distinct territory cells the route passed through, in first-visit order. */
  getTraversedHexIds(
    points: Array<{ lat: number; lng: number }>,
    resolution: number = TERRITORY_H3_RESOLUTION_V2
  ): string[] {
    return getTraversedHexIds(points, resolution);
  }

  /** Territory cells enclosed by a closed route loop. */
  getCapturedHexIdsForLoop(
    points: Array<{ lat: number; lng: number }>,
    resolution: number = TERRITORY_H3_RESOLUTION_V2
  ): string[] {
    const ring = routeToRing(points);
    if (!ring) return [];
    return getCapturedHexIdsForLoop(ring, resolution);
  }

  /** One cell as a GeoJSON Polygon feature, in [longitude, latitude] order. */
  h3CellToGeoJsonFeature(cellId: string, properties: Record<string, unknown> = {}) {
    return h3CellToGeoJsonFeature(cellId, properties);
  }

  /** Many cells as a GeoJSON FeatureCollection. */
  h3CellsToGeoJsonFeatureCollection(
    cellIds: string[],
    propertiesFor: (cellId: string) => Record<string, unknown> = () => ({})
  ) {
    return h3CellsToGeoJsonFeatureCollection(cellIds, propertiesFor);
  }

  /** Ring-1 neighbours of a territory cell (excludes the cell itself). */
  getNeighboringCells(cellId: string): string[] {
    return getNeighboringCells(cellId);
  }

  /** Validate + close an arbitrary GeoJSON ring, or null when unusable. */
  normalizePolygonCoordinates(ring: Array<[number, number]>) {
    return normalizePolygonCoordinates(ring);
  }

  /** Territory cells whose centre falls inside a lat/lng bounding box. */
  cellsInBoundingBox(
    bounds: { west: number; south: number; east: number; north: number },
    resolution: number = TERRITORY_H3_RESOLUTION_V2
  ): string[] {
    return cellsInBoundingBox(bounds, resolution);
  }
}
