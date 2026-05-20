import * as h3 from "h3-js";
import { HexActivity, ZoneMintEligibility } from "@movenrun/shared";
import { H3_RESOLUTION, MIN_ACTIVITY_THRESHOLD } from "@movenrun/shared/src/constants/h3.js";

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
}
