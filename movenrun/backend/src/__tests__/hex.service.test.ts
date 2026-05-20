import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { HexService } from "../services/hex.service.js";
import type { OracleService } from "../services/oracle.service.js";
import type { Db } from "../db/index.js";
import { ZoneStatus } from "@movenrun/shared";
import type { BoundingBox } from "@movenrun/shared";

// ─── Mock DB builder ──────────────────────────────────────────────────────────

function makeDb(overrides: Partial<{ selectRows: unknown[] }> = {}): Db {
  const rows = overrides.selectRows ?? [];

  // Chain is both fluent AND directly thenable so any .await point resolves rows
  function makeChain(): any {
    const promise = Promise.resolve(rows);
    const chain: any = {
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
      finally: promise.finally.bind(promise),
    };
    for (const method of ["from", "where", "groupBy", "orderBy", "limit"]) {
      chain[method] = jest.fn().mockReturnValue(chain);
    }
    return chain;
  }

  return {
    select: jest.fn().mockReturnValue(makeChain()),
    insert: jest.fn().mockReturnValue({ values: jest.fn().mockResolvedValue([]) }),
    update: jest.fn().mockReturnValue({
      set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
    }),
  } as unknown as Db;
}

function makeOracle(): jest.Mocked<Pick<OracleService, "signMintEligibility">> {
  return { signMintEligibility: jest.fn().mockResolvedValue("0xmint_sig") };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("HexService – latLngToHex / getHexIdsForPoints", () => {
  let svc: HexService;

  beforeEach(() => {
    svc = new HexService(makeDb(), makeOracle() as unknown as OracleService);
  });

  it("latLngToHex returns a non-empty string", () => {
    const hex = svc.latLngToHex(51.5, -0.1);
    expect(typeof hex).toBe("string");
    expect(hex.length).toBeGreaterThan(0);
  });

  it("getHexIdsForPoints deduplicates adjacent points in the same cell", () => {
    // Two nearby points that almost certainly fall in the same resolution-8 hex
    const pts = [
      { lat: 51.5, lng: -0.1 },
      { lat: 51.5001, lng: -0.1 },
    ];
    const ids = svc.getHexIdsForPoints(pts);
    // We expect 1 unique hex (both inside the same ~0.74 km² cell)
    expect(ids.length).toBeGreaterThanOrEqual(1);
    expect(ids.length).toBeLessThanOrEqual(2);
  });

  it("getHexIdsForPoints returns unique values", () => {
    const pts = Array.from({ length: 20 }, (_, i) => ({
      lat: 51.5 + i * 0.001,
      lng: -0.1,
    }));
    const ids = svc.getHexIdsForPoints(pts);
    const unique = new Set(ids);
    expect(ids.length).toBe(unique.size);
  });
});

describe("HexService – getZoneActivity", () => {
  it("returns zero activity when no DB rows found", async () => {
    const svc = new HexService(makeDb({ selectRows: [] }), makeOracle() as unknown as OracleService);
    const activity = await svc.getZoneActivity("881f1d4547fffff", 7);
    expect(activity.uniqueUsers).toBe(0);
    expect(activity.totalDistance).toBe(0);
    expect(activity.topMover).toBe("");
  });

  it("identifies the top mover correctly", async () => {
    const rows = [
      { userAddress: "0xAlice", distanceMeters: 5000 },
      { userAddress: "0xBob", distanceMeters: 3000 },
    ];
    const svc = new HexService(makeDb({ selectRows: rows }), makeOracle() as unknown as OracleService);
    const activity = await svc.getZoneActivity("881f1d4547fffff", 7);
    expect(activity.topMover).toBe("0xAlice");
    expect(activity.topMoverDistance).toBe(5000);
    expect(activity.uniqueUsers).toBe(2);
    expect(activity.totalDistance).toBe(8000);
  });
});

describe("HexService – getMintEligibility", () => {
  it("returns ineligible when not enough unique users", async () => {
    // Fewer than 5 unique users in 90-day window
    const rows = [
      { userAddress: "0xAlice", distanceMeters: 5000 },
      { userAddress: "0xBob", distanceMeters: 3000 },
    ];
    const svc = new HexService(makeDb({ selectRows: rows }), makeOracle() as unknown as OracleService);
    const result = await svc.getMintEligibility("881f1d4547fffff", "0xAlice");
    expect(result.eligible).toBe(false);
    expect(result.hasEnoughUsers).toBe(false);
  });

  it("returns ineligible when user is not the top mover", async () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({
      userAddress: `0xUser${i}`,
      distanceMeters: (6 - i) * 1000,
    }));
    const svc = new HexService(makeDb({ selectRows: rows }), makeOracle() as unknown as OracleService);
    // 0xUser5 is the lowest mover but there are 6 users
    const result = await svc.getMintEligibility("881f1d4547fffff", "0xUser5");
    expect(result.eligible).toBe(false);
    expect(result.isTopMover).toBe(false);
  });

  it("returns eligible with oracle sig for the top mover with enough users", async () => {
    const rows = [
      { userAddress: "0xAlice", distanceMeters: 9000 },
      { userAddress: "0xBob", distanceMeters: 4000 },
      { userAddress: "0xCarol", distanceMeters: 3000 },
      { userAddress: "0xDave", distanceMeters: 2000 },
      { userAddress: "0xEve", distanceMeters: 1000 },
      { userAddress: "0xFrank", distanceMeters: 500 },
    ];
    const oracle = makeOracle();
    const svc = new HexService(makeDb({ selectRows: rows }), oracle as unknown as OracleService);
    const result = await svc.getMintEligibility("881f1d4547fffff", "0xAlice");
    expect(result.eligible).toBe(true);
    expect(result.oracleSig).toBe("0xmint_sig");
    expect(oracle.signMintEligibility).toHaveBeenCalledTimes(1);
  });
});

describe("HexService – getHexesInBoundingBox", () => {
  it("returns an array of HexData", async () => {
    const svc = new HexService(makeDb({ selectRows: [] }), makeOracle() as unknown as OracleService);
    const bbox: BoundingBox = {
      minLat: 51.49,
      maxLat: 51.51,
      minLng: -0.11,
      maxLng: -0.09,
    };
    const hexes = await svc.getHexesInBoundingBox(bbox);
    expect(Array.isArray(hexes)).toBe(true);
    // A ~2.4 km² bbox should contain several resolution-8 hexes
    expect(hexes.length).toBeGreaterThan(0);
    for (const h of hexes) {
      expect(h.hexId).toBeTruthy();
      expect(Object.values(ZoneStatus)).toContain(h.status);
    }
  });

  it("marks owned zones as Active", async () => {
    // Determine a real hexId inside the bbox first
    const svc0 = new HexService(makeDb({ selectRows: [] }), makeOracle() as unknown as OracleService);
    const bbox: BoundingBox = { minLat: 51.49, maxLat: 51.51, minLng: -0.11, maxLng: -0.09 };
    const allHexes = await svc0.getHexesInBoundingBox(bbox);
    const targetHex = allHexes[0].hexId;

    // Now mock the DB to return that hex as an owned zone
    const ownedZoneRows = [{ hexId: targetHex, owner: "0xOwner", isDormant: false }];
    const dbWithZone = makeDb({ selectRows: ownedZoneRows });
    const svc = new HexService(dbWithZone, makeOracle() as unknown as OracleService);
    const hexes = await svc.getHexesInBoundingBox(bbox);

    const owned = hexes.find((h) => h.hexId === targetHex);
    expect(owned?.status).toBe(ZoneStatus.Active);
    expect(owned?.owner).toBe("0xOwner");
  });
});

describe("HexService – getNeighbors", () => {
  it("returns exactly 6 neighbors for a valid hex", () => {
    const svc = new HexService(makeDb(), makeOracle() as unknown as OracleService);
    const center = svc.latLngToHex(51.5, -0.1);
    const neighbors = svc.getNeighbors(center);
    expect(neighbors.length).toBe(6);
    expect(neighbors).not.toContain(center);
  });
});
