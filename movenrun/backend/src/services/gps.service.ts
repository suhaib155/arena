import { createHash } from "crypto";
import * as h3 from "h3-js";
import type IORedis from "ioredis";
import { H3_RESOLUTION } from "@movenrun/shared/src/constants/h3.js";
import type { OracleService } from "./oracle.service.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_SPEED_KMH = 25;
const MAX_SPEED_MS = MAX_SPEED_KMH / 3.6; // 6.944 m/s
const MIN_SPEED_KMH = 0.5;
const MIN_SPEED_MS = MIN_SPEED_KMH / 3.6; // 0.139 m/s
const MIN_DISTANCE_METERS = 100;
const TELEPORT_DISTANCE_METERS = 500;
const TELEPORT_TIME_SECONDS = 5;
const MAX_SLOPE_DEGREES = 45;
const SUSTAINED_SLOPE_SEGMENTS = 3;
const ATTESTATION_TTL_SECONDS = 3600;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GpsPoint {
  lat: number;
  lng: number;
  timestamp: number; // Unix milliseconds
  altitude?: number;
  accuracy?: number;
}

export interface PlausibilityResult {
  valid: boolean;
  reason?: string;
  distance_meters: number;
}

export interface OracleAttestation {
  routeHash: string;
  userAddress: string;
  hexActivity: Record<string, number>;
  distanceMeters: number;
  timestamp: number;
  deviceId: string;
  oracleSig: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class GpsService {
  constructor(
    private readonly oracle: OracleService,
    private readonly redis: IORedis,
  ) {}

  // ── Layer 1: Route Plausibility ─────────────────────────────────────────────

  checkPlausibility(points: GpsPoint[]): PlausibilityResult {
    if (points.length < 2) {
      return { valid: false, reason: "Route must have at least 2 GPS points", distance_meters: 0 };
    }

    let totalDistance = 0;
    let sustainedSlopeCount = 0;

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];

      const dtSeconds = (curr.timestamp - prev.timestamp) / 1000;
      if (dtSeconds <= 0) {
        return { valid: false, reason: `Non-monotonic timestamps at index ${i}`, distance_meters: 0 };
      }

      const horizDist = this.haversineMeters(prev.lat, prev.lng, curr.lat, curr.lng);
      totalDistance += horizDist;

      // Teleportation check: >500m in <5 seconds
      if (horizDist > TELEPORT_DISTANCE_METERS && dtSeconds < TELEPORT_TIME_SECONDS) {
        return {
          valid: false,
          reason: `Teleportation detected at index ${i}: ${horizDist.toFixed(0)}m in ${dtSeconds.toFixed(1)}s`,
          distance_meters: 0,
        };
      }

      const speed = horizDist / dtSeconds;

      // Speed upper bound
      if (speed > MAX_SPEED_MS) {
        return {
          valid: false,
          reason: `Speed too high at index ${i}: ${(speed * 3.6).toFixed(1)} km/h (max ${MAX_SPEED_KMH} km/h)`,
          distance_meters: 0,
        };
      }

      // Speed lower bound (only if there's meaningful time elapsed)
      if (dtSeconds > 30 && speed < MIN_SPEED_MS) {
        return {
          valid: false,
          reason: `User stationary at index ${i}: ${(speed * 3.6).toFixed(2)} km/h for ${dtSeconds.toFixed(0)}s`,
          distance_meters: 0,
        };
      }

      // Elevation check: impossible sustained climb >45 degrees
      if (
        prev.altitude !== undefined &&
        curr.altitude !== undefined &&
        horizDist > 0
      ) {
        const verticalDelta = Math.abs(curr.altitude - prev.altitude);
        const slopeDeg = (Math.atan2(verticalDelta, horizDist) * 180) / Math.PI;

        if (slopeDeg > MAX_SLOPE_DEGREES) {
          sustainedSlopeCount++;
          if (sustainedSlopeCount >= SUSTAINED_SLOPE_SEGMENTS) {
            return {
              valid: false,
              reason: `Impossible sustained elevation gain: ${slopeDeg.toFixed(1)}° over ${SUSTAINED_SLOPE_SEGMENTS}+ consecutive segments`,
              distance_meters: 0,
            };
          }
        } else {
          sustainedSlopeCount = 0;
        }
      }
    }

    if (totalDistance < MIN_DISTANCE_METERS) {
      return {
        valid: false,
        reason: `Total distance too short: ${totalDistance.toFixed(0)}m (minimum ${MIN_DISTANCE_METERS}m)`,
        distance_meters: totalDistance,
      };
    }

    return { valid: true, distance_meters: Math.round(totalDistance) };
  }

  // ── Layer 2: H3 Hex Assignment ───────────────────────────────────────────────

  buildHexActivity(points: GpsPoint[]): Map<string, number> {
    const hexActivity = new Map<string, number>();

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const segmentDist = this.haversineMeters(prev.lat, prev.lng, curr.lat, curr.lng);

      // Assign segment distance to the hex the starting point is in
      const hexId = h3.latLngToCell(prev.lat, prev.lng, H3_RESOLUTION);
      hexActivity.set(hexId, (hexActivity.get(hexId) ?? 0) + segmentDist);
    }

    // Also register the final point's hex (with 0 if not already present)
    if (points.length > 0) {
      const last = points[points.length - 1];
      const lastHex = h3.latLngToCell(last.lat, last.lng, H3_RESOLUTION);
      if (!hexActivity.has(lastHex)) {
        hexActivity.set(lastHex, 0);
      }
    }

    return hexActivity;
  }

  // ── Layer 3: Oracle Attestation ──────────────────────────────────────────────

  async createAttestation(
    userAddress: string,
    points: GpsPoint[],
    deviceId: string,
  ): Promise<OracleAttestation> {
    const plausibility = this.checkPlausibility(points);
    if (!plausibility.valid) {
      throw new Error(`Route plausibility check failed: ${plausibility.reason}`);
    }

    const hexActivity = this.buildHexActivity(points);
    const hexActivityRecord = Object.fromEntries(
      [...hexActivity.entries()].map(([k, v]) => [k, Math.round(v)]),
    );

    const routeHash = this.buildRouteHash(userAddress, points, hexActivityRecord);
    const distanceMeters = plausibility.distance_meters;
    const nowMs = Date.now();

    // Sign with oracle key: (userAddress, routeHash, distanceMeters)
    const oracleSig = await this.oracle.signRouteProof(userAddress, routeHash, distanceMeters);

    const attestation: OracleAttestation = {
      routeHash,
      userAddress,
      hexActivity: hexActivityRecord,
      distanceMeters,
      timestamp: nowMs,
      deviceId,
      oracleSig,
    };

    // Cache with 1-hour TTL so the client can retrieve it
    await this.redis.setex(
      `attestation:${routeHash}`,
      ATTESTATION_TTL_SECONDS,
      JSON.stringify(attestation),
    );

    return attestation;
  }

  async getAttestation(routeHash: string): Promise<OracleAttestation | null> {
    const raw = await this.redis.get(`attestation:${routeHash}`);
    if (!raw) return null;
    return JSON.parse(raw) as OracleAttestation;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  buildRouteHash(
    userAddress: string,
    points: GpsPoint[],
    hexActivity?: Record<string, number>,
  ): string {
    const payload = JSON.stringify({
      userAddress: userAddress.toLowerCase(),
      points: points.map((p) => [p.lat, p.lng, p.timestamp]),
      hexActivity: hexActivity ?? {},
    });
    return "0x" + createHash("sha256").update(payload).digest("hex");
  }

  haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6_371_000;
    const dLat = this._toRad(lat2 - lat1);
    const dLng = this._toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(this._toRad(lat1)) * Math.cos(this._toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private _toRad(deg: number): number {
    return (deg * Math.PI) / 180;
  }
}
