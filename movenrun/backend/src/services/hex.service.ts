import * as h3 from "h3-js";
import { gte, sql, eq, and, desc } from "drizzle-orm";
import {
  H3_RESOLUTION,
  MIN_ACTIVITY_THRESHOLD,
  MIN_ACTIVITY_DAYS,
} from "@movenrun/shared/src/constants/h3.js";
import type {
  ZoneActivity,
  HexData,
  MintEligibility,
  BoundingBox,
  ZoneMintEligibility,
  HexActivity,
} from "@movenrun/shared";
import { ZoneStatus } from "@movenrun/shared";
import { hexActivityDaily, zones } from "../db/schema.js";
import type { Db } from "../db/index.js";
import type { OracleService } from "./oracle.service.js";

const BASE_MINT_COST = 500n * BigInt(10 ** 18);
const MIN_UNIQUE_USERS_FOR_MINT = 5;
const MINT_ELIGIBILITY_WINDOW_DAYS = 30;
const ZONE_ACTIVITY_UNIQUE_USER_DAYS = 90;

export class HexService {
  constructor(
    private readonly db: Db,
    private readonly oracle: OracleService,
  ) {}

  // ── Public API ──────────────────────────────────────────────────────────────

  latLngToHex(lat: number, lng: number): string {
    return h3.latLngToCell(lat, lng, H3_RESOLUTION);
  }

  getHexIdsForPoints(points: Array<{ lat: number; lng: number }>): string[] {
    const seen = new Set<string>();
    for (const p of points) {
      seen.add(this.latLngToHex(p.lat, p.lng));
    }
    return Array.from(seen);
  }

  getNeighbors(hexId: string): string[] {
    return h3.gridDisk(hexId, 1).filter((h) => h !== hexId);
  }

  hexToLatLng(hexId: string): [number, number] {
    return h3.cellToLatLng(hexId);
  }

  // ── getZoneActivity ─────────────────────────────────────────────────────────

  async getZoneActivity(hexId: string, days: number): Promise<ZoneActivity> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const sinceDate = since.toISOString().slice(0, 10);

    const rows = await this.db
      .select({
        userAddress: hexActivityDaily.userAddress,
        distanceMeters: sql<number>`sum(${hexActivityDaily.distanceMeters})`.as("distance_meters"),
      })
      .from(hexActivityDaily)
      .where(
        and(
          eq(hexActivityDaily.hexId, hexId),
          gte(hexActivityDaily.date, sinceDate),
        ),
      )
      .groupBy(hexActivityDaily.userAddress)
      .orderBy(desc(sql`sum(${hexActivityDaily.distanceMeters})`));

    if (rows.length === 0) {
      return {
        hexId,
        uniqueUsers: 0,
        topMover: "",
        topMoverDistance: 0,
        totalDistance: 0,
      };
    }

    const totalDistance = rows.reduce((sum, r) => sum + (r.distanceMeters ?? 0), 0);
    const topRow = rows[0];

    return {
      hexId,
      uniqueUsers: rows.length,
      topMover: topRow.userAddress,
      topMoverDistance: topRow.distanceMeters ?? 0,
      totalDistance,
    };
  }

  // ── getHexActivity (legacy compat) ──────────────────────────────────────────

  async getHexActivity(hexId: string): Promise<HexActivity> {
    const [weekly, monthly] = await Promise.all([
      this.getZoneActivity(hexId, 7),
      this.getZoneActivity(hexId, 30),
    ]);

    return {
      hexId,
      weeklyMoverCount: weekly.uniqueUsers,
      monthlyMoverCount: monthly.uniqueUsers,
      totalDistanceMeters: weekly.totalDistance,
      topMover: weekly.topMover || "0x0000000000000000000000000000000000000000",
      topMoverDistanceMeters: weekly.topMoverDistance,
      lastActivityAt: 0,
    };
  }

  // ── getHexesInBoundingBox ───────────────────────────────────────────────────

  async getHexesInBoundingBox(bbox: BoundingBox): Promise<HexData[]> {
    const polygon = [
      [
        [bbox.minLng, bbox.minLat],
        [bbox.maxLng, bbox.minLat],
        [bbox.maxLng, bbox.maxLat],
        [bbox.minLng, bbox.maxLat],
        [bbox.minLng, bbox.minLat],
      ],
    ];

    const hexIds = h3.polygonToCells(
      polygon as Parameters<typeof h3.polygonToCells>[0],
      H3_RESOLUTION,
    );

    if (hexIds.length === 0) return [];

    // Fetch owned zones in the batch
    const ownedZones = await this.db
      .select({ hexId: zones.hexId, owner: zones.owner, isDormant: zones.isDormant })
      .from(zones)
      .where(sql`${zones.hexId} = ANY(${hexIds})`);

    const zoneMap = new Map(ownedZones.map((z) => [z.hexId, z]));

    return hexIds.map((hexId): HexData => {
      const zone = zoneMap.get(hexId);
      if (!zone) return { hexId, status: ZoneStatus.Unminted };
      if (zone.isDormant) return { hexId, status: ZoneStatus.Dormant, owner: zone.owner };
      return { hexId, status: ZoneStatus.Active, owner: zone.owner };
    });
  }

  // ── getMintEligibility ──────────────────────────────────────────────────────

  async getMintEligibility(hexId: string, userAddress: string): Promise<MintEligibility> {
    const [topMoverActivity, uniqueUserActivity] = await Promise.all([
      this.getZoneActivity(hexId, MINT_ELIGIBILITY_WINDOW_DAYS),
      this.getZoneActivity(hexId, ZONE_ACTIVITY_UNIQUE_USER_DAYS),
    ]);

    const hasEnoughUsers = uniqueUserActivity.uniqueUsers >= MIN_UNIQUE_USERS_FOR_MINT;
    const isTopMover =
      topMoverActivity.topMover.toLowerCase() === userAddress.toLowerCase();

    const eligible = hasEnoughUsers && isTopMover;
    const mintCost = this._calculateMintCost(topMoverActivity.uniqueUsers);

    if (!eligible) {
      return {
        hexId,
        eligible: false,
        isTopMover,
        hasEnoughUsers,
        mintCost,
        reason: !hasEnoughUsers
          ? `Zone needs ${MIN_UNIQUE_USERS_FOR_MINT}+ unique users in 90 days (currently ${uniqueUserActivity.uniqueUsers})`
          : "Not the top mover in this zone over the last 30 days",
      };
    }

    const expiry = Math.floor(Date.now() / 1000) + 3600; // 1-hour validity
    const oracleSig = await this.oracle.signMintEligibility(
      hexId,
      userAddress,
      mintCost,
      expiry,
    );

    return {
      hexId,
      eligible: true,
      isTopMover: true,
      hasEnoughUsers: true,
      mintCost,
      oracleSig,
    };
  }

  // ── Legacy getMintEligibility for backwards compat ──────────────────────────

  async getLegacyMintEligibility(hexId: string): Promise<ZoneMintEligibility> {
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
    const activity = await this.getZoneActivity(hexId, 30);
    return BigInt(activity.topMoverDistance);
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _calculateMintCost(weeklyMoverCount: number): bigint {
    const sqrtCount = BigInt(Math.max(1, Math.floor(Math.sqrt(weeklyMoverCount))));
    return BASE_MINT_COST * sqrtCount;
  }
}
