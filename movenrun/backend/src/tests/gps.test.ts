import { describe, it, expect } from "vitest";
import { GpsService } from "../services/gps.service.js";
import { GPSRoute, RouteStatus } from "@movenrun/shared";

const gps = new GpsService();

function makeRoute(points: Array<{ lat: number; lng: number; accuracy: number; timestamp: number }>): GPSRoute {
  return {
    id: "test-id",
    userId: "0x1234",
    walletAddress: "0x1234567890123456789012345678901234567890",
    points,
    startTime: points[0]?.timestamp ?? 0,
    endTime: points[points.length - 1]?.timestamp ?? 0,
    distanceMeters: 0,
    hexIds: [],
    status: RouteStatus.Pending,
  };
}

function makePoint(lat: number, lng: number, t: number, accuracy = 5): { lat: number; lng: number; accuracy: number; timestamp: number } {
  return { lat, lng, accuracy, timestamp: t };
}

describe("GpsService.validateRoute", () => {
  it("accepts a valid 10-point walking route", () => {
    const points = Array.from({ length: 10 }, (_, i) =>
      makePoint(37.7749 + i * 0.0001, -122.4194, 1_000_000 + i * 10_000)
    );
    const result = gps.validateRoute(makeRoute(points));
    expect(result.isAnomaly).toBe(false);
    expect(result.reasons).toHaveLength(0);
  });

  it("rejects a route with fewer than 10 points", () => {
    const points = Array.from({ length: 5 }, (_, i) =>
      makePoint(37.77, -122.42, 1_000_000 + i * 10_000)
    );
    const result = gps.validateRoute(makeRoute(points));
    expect(result.isAnomaly).toBe(true);
    expect(result.reasons.some((r) => r.includes("Too few GPS points"))).toBe(true);
  });

  it("rejects a route with teleportation (speed > 80 km/h)", () => {
    // Two points 100km apart in 1 second = impossible
    const points = [
      makePoint(37.77, -122.42, 1_000_000),
      makePoint(38.68, -121.49, 1_000_001), // ~130km apart
      ...Array.from({ length: 8 }, (_, i) =>
        makePoint(38.68 + i * 0.0001, -121.49, 1_000_001 + (i + 1) * 10_000)
      ),
    ];
    const result = gps.validateRoute(makeRoute(points));
    expect(result.isAnomaly).toBe(true);
    expect(result.reasons.some((r) => r.includes("Implausible speed"))).toBe(true);
  });

  it("rejects a route with non-monotonic timestamps", () => {
    const points = [
      makePoint(37.77, -122.42, 1_000_010),
      makePoint(37.7701, -122.4201, 1_000_000), // goes backwards
      ...Array.from({ length: 8 }, (_, i) =>
        makePoint(37.7701 + i * 0.0001, -122.42, 1_000_020 + i * 10_000)
      ),
    ];
    const result = gps.validateRoute(makeRoute(points));
    expect(result.isAnomaly).toBe(true);
    expect(result.reasons.some((r) => r.includes("Non-monotonic"))).toBe(true);
  });

  it("rejects a route with >30% poor accuracy points", () => {
    const points = Array.from({ length: 10 }, (_, i) =>
      makePoint(37.77 + i * 0.0001, -122.42, 1_000_000 + i * 10_000, i < 4 ? 100 : 5)
    );
    const result = gps.validateRoute(makeRoute(points));
    expect(result.isAnomaly).toBe(true);
    expect(result.reasons.some((r) => r.includes("accuracy"))).toBe(true);
  });

  it("accepts a loop route (start == end point)", () => {
    // A loop: 10 points that return to origin — perfectly valid
    const base = { lat: 37.7749, lng: -122.4194 };
    const t0 = 1_700_000_000_000; // fixed epoch ms
    const points = [
      makePoint(base.lat, base.lng,                         t0),
      makePoint(base.lat + 0.001, base.lng,                 t0 + 20_000),
      makePoint(base.lat + 0.002, base.lng,                 t0 + 40_000),
      makePoint(base.lat + 0.002, base.lng + 0.001,         t0 + 60_000),
      makePoint(base.lat + 0.001, base.lng + 0.001,         t0 + 80_000),
      makePoint(base.lat, base.lng + 0.001,                 t0 + 100_000),
      makePoint(base.lat - 0.001, base.lng,                 t0 + 120_000),
      makePoint(base.lat - 0.0005, base.lng - 0.0005,       t0 + 140_000),
      makePoint(base.lat, base.lng - 0.0001,                t0 + 160_000),
      makePoint(base.lat, base.lng,                         t0 + 180_000), // back to start
    ];
    const result = gps.validateRoute(makeRoute(points));
    expect(result.isAnomaly).toBe(false);
  });
});

describe("GpsService.calculateDistance", () => {
  it("computes correct haversine distance for a straight 1km route", () => {
    // ~1 degree latitude ≈ 111km; 0.009° ≈ 1km
    const points = [
      makePoint(37.0000, -122.0, 0),
      makePoint(37.0090, -122.0, 10_000),
    ];
    const dist = gps.calculateDistance(points);
    expect(dist).toBeGreaterThan(900);
    expect(dist).toBeLessThan(1100);
  });

  it("returns 0 for a single point", () => {
    expect(gps.calculateDistance([makePoint(37.0, -122.0, 0)])).toBe(0);
  });
});
