import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { GpsService, type GpsPoint, type OracleAttestation } from "../services/gps.service.js";
import type { OracleService } from "../services/oracle.service.js";
import type IORedis from "ioredis";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePoint(lat: number, lng: number, tsMs: number, altitude?: number): GpsPoint {
  return { lat, lng, timestamp: tsMs, altitude };
}

/** Build a straight-line route moving ~1 km north at a walking pace (~5 km/h). */
function walkingRoute(pointCount = 10): GpsPoint[] {
  const points: GpsPoint[] = [];
  const startTs = 1_700_000_000_000;
  const stepMs = 60_000; // 1 minute between points
  // ~0.09° latitude ≈ 10 km, so 0.009° ≈ 1 km over 10 steps
  for (let i = 0; i < pointCount; i++) {
    points.push(makePoint(51.5 + i * 0.001, -0.1, startTs + i * stepMs));
  }
  return points;
}

// ─── Mock dependencies ────────────────────────────────────────────────────────

function makeMocks() {
  const mockOracle = {
    signRouteProof: jest.fn().mockResolvedValue("0xmocksig"),
  } as unknown as OracleService;

  const mockRedis = {
    setex: jest.fn().mockResolvedValue("OK"),
    get: jest.fn().mockResolvedValue(null),
  } as unknown as IORedis;

  return { mockOracle, mockRedis };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GpsService – Layer 1: checkPlausibility", () => {
  let svc: GpsService;

  beforeEach(() => {
    const { mockOracle, mockRedis } = makeMocks();
    svc = new GpsService(mockOracle, mockRedis);
  });

  it("accepts a valid walking route", () => {
    const result = svc.checkPlausibility(walkingRoute());
    expect(result.valid).toBe(true);
    expect(result.distance_meters).toBeGreaterThan(100);
  });

  it("rejects fewer than 2 points", () => {
    const result = svc.checkPlausibility([makePoint(51.5, -0.1, 0)]);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/at least 2/i);
  });

  it("rejects speed > 25 km/h", () => {
    // ~300 m in 40 seconds → 7.5 m/s ≈ 27 km/h, below 500 m teleportation threshold
    const p1 = makePoint(51.5, -0.1, 1_000_000_000_000);
    const p2 = makePoint(51.5027, -0.1, 1_000_000_040_000); // 40 s later, ~300 m north
    const result = svc.checkPlausibility([p1, p2]);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/speed too high/i);
  });

  it("rejects route shorter than 100 m", () => {
    // Two points only 10 m apart
    const p1 = makePoint(51.5, -0.1, 1_000_000_000_000);
    const p2 = makePoint(51.5001, -0.1, 1_000_000_060_000); // ~11 m north
    const result = svc.checkPlausibility([p1, p2]);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/too short/i);
  });

  it("rejects teleportation (>500 m in <5 s)", () => {
    const p1 = makePoint(51.5, -0.1, 1_000_000_000_000);
    const p2 = makePoint(51.51, -0.1, 1_000_000_003_000); // 3 s later, ~1.1 km
    const result = svc.checkPlausibility([p1, p2]);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/teleportation/i);
  });

  it("rejects non-monotonic timestamps", () => {
    const p1 = makePoint(51.5, -0.1, 1_000_000_060_000);
    const p2 = makePoint(51.5001, -0.1, 1_000_000_000_000); // earlier timestamp
    const result = svc.checkPlausibility([p1, p2]);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/non-monotonic/i);
  });

  it("rejects sustained >45° elevation gain", () => {
    // Each segment: 10 m horizontal, 20 m vertical → ~63° slope
    const startTs = 1_700_000_000_000;
    const points: GpsPoint[] = [];
    for (let i = 0; i < 10; i++) {
      points.push({
        lat: 51.5 + i * 0.0001, // ~11 m per step (horizontal)
        lng: -0.1,
        timestamp: startTs + i * 30_000,
        altitude: i * 20, // 20 m gain per step
      });
    }
    const result = svc.checkPlausibility(points);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/elevation/i);
  });

  it("accepts a route with moderate elevation gain", () => {
    const startTs = 1_700_000_000_000;
    const points: GpsPoint[] = walkingRoute(10).map((p, i) => ({
      ...p,
      altitude: i * 5, // gentle 5 m/step rise — well under 45°
    }));
    const result = svc.checkPlausibility(points);
    expect(result.valid).toBe(true);
  });
});

describe("GpsService – Layer 2: buildHexActivity", () => {
  let svc: GpsService;

  beforeEach(() => {
    const { mockOracle, mockRedis } = makeMocks();
    svc = new GpsService(mockOracle, mockRedis);
  });

  it("returns a map with at least one hex entry", () => {
    const hexActivity = svc.buildHexActivity(walkingRoute());
    expect(hexActivity.size).toBeGreaterThan(0);
  });

  it("total distance across all hexes matches route distance", () => {
    const pts = walkingRoute(20);
    const hexActivity = svc.buildHexActivity(pts);
    const totalFromHexes = [...hexActivity.values()].reduce((a, b) => a + b, 0);
    const totalFromPlausibility = svc.checkPlausibility(pts).distance_meters;
    // Allow rounding: within 2 meters
    expect(Math.abs(Math.round(totalFromHexes) - totalFromPlausibility)).toBeLessThanOrEqual(2);
  });

  it("assigns all distance to a single hex when points don't cross a cell boundary", () => {
    // Two adjacent points well within a single ~461 m H3 resolution-8 hex
    const p1 = makePoint(51.5, -0.1, 1_000_000_000_000);
    const p2 = makePoint(51.5002, -0.1, 1_000_000_060_000); // ~22 m north
    const hexActivity = svc.buildHexActivity([p1, p2]);
    expect(hexActivity.size).toBe(1);
  });

  it("all meter values are non-negative", () => {
    const hexActivity = svc.buildHexActivity(walkingRoute(30));
    for (const meters of hexActivity.values()) {
      expect(meters).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("GpsService – Layer 3: createAttestation", () => {
  let svc: GpsService;
  let mockOracle: jest.Mocked<Pick<OracleService, "signRouteProof">>;
  let mockRedis: { setex: jest.Mock; get: jest.Mock };

  beforeEach(() => {
    mockOracle = { signRouteProof: jest.fn().mockResolvedValue("0xoraclesig") };
    mockRedis = { setex: jest.fn().mockResolvedValue("OK"), get: jest.fn().mockResolvedValue(null) };
    svc = new GpsService(
      mockOracle as unknown as OracleService,
      mockRedis as unknown as IORedis,
    );
  });

  it("returns a signed attestation for a valid route", async () => {
    const attestation = await svc.createAttestation(
      "0xabc1234567890123456789012345678901234567",
      walkingRoute(),
      "device-abc",
    );
    expect(attestation.oracleSig).toBe("0xoraclesig");
    expect(attestation.routeHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(attestation.distanceMeters).toBeGreaterThan(100);
    expect(Object.keys(attestation.hexActivity).length).toBeGreaterThan(0);
  });

  it("stores attestation in Redis with 3600 TTL", async () => {
    await svc.createAttestation(
      "0xabc1234567890123456789012345678901234567",
      walkingRoute(),
      "device-xyz",
    );
    expect(mockRedis.setex).toHaveBeenCalledWith(
      expect.stringMatching(/^attestation:0x/),
      3600,
      expect.any(String),
    );
  });

  it("throws when the route is invalid", async () => {
    const badPoints = [
      makePoint(51.5, -0.1, 1_000_000_000_000),
      makePoint(51.5001, -0.1, 1_000_000_060_000), // only ~11 m
    ];
    await expect(
      svc.createAttestation("0xabc1234567890123456789012345678901234567", badPoints, "dev"),
    ).rejects.toThrow(/plausibility/i);
    expect(mockOracle.signRouteProof).not.toHaveBeenCalled();
  });
});

describe("GpsService – buildRouteHash", () => {
  let svc: GpsService;

  beforeEach(() => {
    const { mockOracle, mockRedis } = makeMocks();
    svc = new GpsService(mockOracle, mockRedis);
  });

  it("returns a 0x-prefixed 64-char hex string", () => {
    const hash = svc.buildRouteHash("0xabc", walkingRoute());
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("is deterministic for the same input", () => {
    const pts = walkingRoute();
    const h1 = svc.buildRouteHash("0xabc", pts);
    const h2 = svc.buildRouteHash("0xabc", pts);
    expect(h1).toBe(h2);
  });

  it("changes when userAddress changes", () => {
    const pts = walkingRoute();
    const h1 = svc.buildRouteHash("0xaaa", pts);
    const h2 = svc.buildRouteHash("0xbbb", pts);
    expect(h1).not.toBe(h2);
  });
});

describe("GpsService – haversineMeters", () => {
  let svc: GpsService;

  beforeEach(() => {
    const { mockOracle, mockRedis } = makeMocks();
    svc = new GpsService(mockOracle, mockRedis);
  });

  it("returns 0 for identical points", () => {
    expect(svc.haversineMeters(51.5, -0.1, 51.5, -0.1)).toBe(0);
  });

  it("returns ~111 km for 1 degree of latitude", () => {
    const dist = svc.haversineMeters(0, 0, 1, 0);
    expect(dist).toBeGreaterThan(110_500);
    expect(dist).toBeLessThan(111_500);
  });

  it("is symmetric", () => {
    const d1 = svc.haversineMeters(51.5, -0.1, 48.8, 2.3);
    const d2 = svc.haversineMeters(48.8, 2.3, 51.5, -0.1);
    expect(Math.abs(d1 - d2)).toBeLessThan(0.01);
  });
});
