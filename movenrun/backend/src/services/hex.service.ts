import { HexActivity, ZoneMintEligibility } from "@movenrun/shared";
import {
  cellCenter,
  cellForCoordinate,
  cellsForObservations,
  H3_RESOLUTION,
  neighborhood,
  toGameplayCell,
} from "@movenrun/shared/h3";
import { MIN_ACTIVITY_THRESHOLD } from "@movenrun/shared";

/**
 * Server-side H3 geography.
 *
 * Every geometric call here now goes through the canonical shared domain, so
 * the backend and the app derive the same cell from the same coordinate by
 * construction. This class used to call `h3-js` directly with a resolution
 * imported through a deep path into the shared package's source
 * (`@movenrun/shared/src/constants/h3.js`), which reached past an exports map
 * that named a `dist/` the package could not build. It kept working only
 * because the backend runs through `tsx`; it was never a supported import.
 *
 * The behaviour of `getHexIdsForPoints` is unchanged — same cells, same
 * deduplication, same first-touch order — and the movement-verification tests
 * that describe it run untouched. What is new is that invalid coordinates are
 * now rejected instead of being wrapped onto real ground by the library, and
 * that a malformed cell id can no longer produce a plausible-looking centre or
 * neighbour list.
 *
 * Nothing here writes territory. `hex_activities` still has no writer, and
 * `getHexActivity` still returns zeros — see the stub note below.
 */
export class HexService {
  /** The cell containing a coordinate, at the canonical gameplay resolution.
   *  Throws for anything that is not a real latitude/longitude. */
  latLngToHex(lat: number, lng: number): string {
    return cellForCoordinate({ latitude: lat, longitude: lng });
  }

  /**
   * The H3 cells a set of observed points falls in — deduplicated, in
   * first-touch order.
   *
   * Containment of the points, not intersection of the path between them: a
   * cell appears exactly when a point was observed inside it, and cells crossed
   * unsampled between two consecutive fixes are not included. Sealing and solid
   * capture will need true path geometry and must derive it deliberately rather
   * than reading it into this.
   */
  getHexIdsForPoints(points: Array<{ lat: number; lng: number }>): string[] {
    return cellsForObservations(
      points.map((p) => ({ latitude: p.lat, longitude: p.lng })),
    );
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

  async getDefenderScore(_hexId: string): Promise<bigint> {
    // TODO: aggregate 30-day movement for current zone owner from DB
    return 0n;
  }

  // mintCost = BASE_MINT_COST * sqrt(weeklyMoverCount) — floor sqrt
  private _calculateMintCost(weeklyMoverCount: number): bigint {
    const BASE = 500n * BigInt(10 ** 18);
    const sqrtCount = BigInt(Math.floor(Math.sqrt(Math.max(weeklyMoverCount, 1))));
    return BASE * sqrtCount;
  }

  /** The six cells surrounding one, excluding it. Rejects a cell that is not
   *  canonical geography, where the library would have answered with an empty
   *  list and no indication that anything was wrong. */
  getNeighbors(hexId: string): string[] {
    const cell = toGameplayCell(hexId);
    return neighborhood(cell, 1).filter((c) => c !== cell);
  }

  /** Hex centre, latitude first — matching H3's own argument order, and the
   *  reason the domain layer speaks in named fields instead of tuples. */
  hexToLatLng(hexId: string): [number, number] {
    const { latitude, longitude } = cellCenter(toGameplayCell(hexId));
    return [latitude, longitude];
  }

  /** The resolution this service indexes at. Read from the shared domain; there
   *  is no backend-local copy and no environment override. */
  get resolution(): number {
    return H3_RESOLUTION;
  }
}
