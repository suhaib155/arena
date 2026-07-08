/**
 * Route lifecycle + server-side dedup tests. No network, no Postgres, no Redis,
 * no `@movenrun/shared` (node:test + tsx only) — processRouteJob is exercised
 * against an InMemoryRouteRepository and plain stub functions, plus the real
 * OracleService (with a deterministic test key, same pattern as
 * oracle.service.test.ts) so the "signed" path proves an actual oracle
 * signature is produced and persisted.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import {
  processRouteJob,
  submitRoute,
  getRouteView,
  type RouteJobDeps,
  type RouteJobInput,
} from "./route.service.js";
import { OracleService } from "./oracle.service.js";
import { InMemoryRouteRepository } from "../repositories/route.repository.js";

const TEST_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const oracle = new OracleService({ privateKey: TEST_PK, chainId: 84532n });

const WALLET = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const POINTS = [
  { lat: 37.77, lng: -122.41, accuracy: 5, timestamp: 1_700_000_000_000 },
  { lat: 37.771, lng: -122.411, accuracy: 5, timestamp: 1_700_000_010_000 },
  { lat: 37.772, lng: -122.412, accuracy: 5, timestamp: 1_700_000_020_000 },
];

function cleanValidateRoute(): RouteJobDeps["validateRoute"] {
  return () => ({ isAnomaly: false, reasons: [], confidence: 0.95 });
}

function baseDeps(overrides: Partial<RouteJobDeps> = {}): RouteJobDeps {
  return {
    repository: new InMemoryRouteRepository(),
    validateRoute: cleanValidateRoute(),
    calculateDistance: () => 500,
    buildRouteHash: ({ walletAddress, startTime, endTime }) =>
      ethers.keccak256(ethers.toUtf8Bytes(`${walletAddress}|${startTime}|${endTime}`)),
    getHexIdsForPoints: () => ["8a2a1072b59ffff"],
    signRouteProof: (to, routeHash, distanceMeters, hexId) =>
      oracle.signRouteProof(to, routeHash, distanceMeters, hexId),
    ...overrides,
  };
}

async function submitted(repo: InMemoryRouteRepository, input: RouteJobInput) {
  await repo.create({
    id: input.routeId,
    walletAddress: input.walletAddress,
    startTime: input.startTime,
    endTime: input.endTime,
  });
}

test("accepted path: validation passes, no duplicate -> VERIFIED with a real oracle signature", async () => {
  const repo = new InMemoryRouteRepository();
  const input: RouteJobInput = {
    routeId: "route-1",
    walletAddress: WALLET,
    points: POINTS,
    startTime: 1000,
    endTime: 2000,
  };
  await submitted(repo, input);

  const outcome = await processRouteJob(input, baseDeps({ repository: repo }));

  assert.equal(outcome.status, "VERIFIED");
  if (outcome.status !== "VERIFIED") return;
  assert.equal(outcome.distanceMeters, 500);
  assert.equal(outcome.hexId, "8a2a1072b59ffff");
  assert.ok(outcome.oracleSig.startsWith("0x"));

  const persisted = await repo.findById("route-1");
  assert.equal(persisted?.status, "VERIFIED");
  assert.equal(persisted?.oracleSig, outcome.oracleSig);
  assert.equal(persisted?.routeHash, outcome.routeHash);
  assert.equal(persisted?.distanceMeters, 500);
  assert.equal(persisted?.hexId, "8a2a1072b59ffff");
  assert.equal(persisted?.rejectionReasons, null);
});

test("validation failure persists REJECTED + rejectionReasons and never signs", async () => {
  const repo = new InMemoryRouteRepository();
  const input: RouteJobInput = {
    routeId: "route-2",
    walletAddress: WALLET,
    points: POINTS,
    startTime: 1000,
    endTime: 2000,
  };
  await submitted(repo, input);

  let signCalled = false;
  const outcome = await processRouteJob(
    input,
    baseDeps({
      repository: repo,
      validateRoute: () => ({ isAnomaly: true, reasons: ["Implausible speed"], confidence: 0.2 }),
      signRouteProof: async () => {
        signCalled = true;
        return "0xshouldnothappen";
      },
    })
  );

  assert.equal(outcome.status, "REJECTED");
  if (outcome.status !== "REJECTED") return;
  assert.deepEqual(outcome.rejectionReasons, ["Implausible speed"]);
  assert.equal(signCalled, false, "oracle signer must not be called for a rejected route");

  const persisted = await repo.findById("route-2");
  assert.equal(persisted?.status, "REJECTED");
  assert.deepEqual(persisted?.rejectionReasons, ["Implausible speed"]);
  assert.equal(persisted?.confidence, 0.2);
  assert.equal(persisted?.oracleSig, null);
});

test("duplicate routeHash is rejected and the oracle signer is never called", async () => {
  const repo = new InMemoryRouteRepository();
  const sharedHash = "0x" + "ab".repeat(32);

  // An existing, already-verified route with the same routeHash.
  await repo.create({ id: "route-existing", walletAddress: WALLET, startTime: 100, endTime: 200 });
  await repo.update("route-existing", { status: "VERIFIED", routeHash: sharedHash, distanceMeters: 500 });

  const input: RouteJobInput = {
    routeId: "route-3",
    walletAddress: WALLET,
    points: POINTS,
    startTime: 5000,
    endTime: 6000, // no time overlap with route-existing — isolates the routeHash dedup check
  };
  await submitted(repo, input);

  let signCalled = false;
  const outcome = await processRouteJob(
    input,
    baseDeps({
      repository: repo,
      buildRouteHash: () => sharedHash,
      signRouteProof: async () => {
        signCalled = true;
        return "0xshouldnothappen";
      },
    })
  );

  assert.equal(outcome.status, "REJECTED");
  if (outcome.status !== "REJECTED") return;
  assert.match(outcome.rejectionReasons[0], /Duplicate route hash/);
  assert.equal(signCalled, false);

  const persisted = await repo.findById("route-3");
  assert.equal(persisted?.status, "REJECTED");
  assert.equal(persisted?.oracleSig, null);
});

test("overlapping time window with an already-VERIFIED route for the same wallet is rejected", async () => {
  const repo = new InMemoryRouteRepository();

  await repo.create({ id: "route-existing", walletAddress: WALLET, startTime: 1000, endTime: 2000 });
  await repo.update("route-existing", {
    status: "VERIFIED",
    routeHash: "0x" + "11".repeat(32),
    distanceMeters: 400,
  });

  // Overlaps [1000,2000]: starts before it ends and ends after it starts.
  const input: RouteJobInput = {
    routeId: "route-4",
    walletAddress: WALLET,
    points: POINTS,
    startTime: 1500,
    endTime: 2500,
  };
  await submitted(repo, input);

  let signCalled = false;
  const outcome = await processRouteJob(
    input,
    baseDeps({
      repository: repo,
      buildRouteHash: () => "0x" + "22".repeat(32), // distinct hash — isolates the overlap check
      signRouteProof: async () => {
        signCalled = true;
        return "0xshouldnothappen";
      },
    })
  );

  assert.equal(outcome.status, "REJECTED");
  if (outcome.status !== "REJECTED") return;
  assert.match(outcome.rejectionReasons[0], /overlaps a previously verified route/);
  assert.equal(signCalled, false);
});

test("a non-overlapping window for the same wallet is NOT rejected by the overlap check", async () => {
  const repo = new InMemoryRouteRepository();

  await repo.create({ id: "route-existing", walletAddress: WALLET, startTime: 1000, endTime: 2000 });
  await repo.update("route-existing", {
    status: "VERIFIED",
    routeHash: "0x" + "33".repeat(32),
    distanceMeters: 400,
  });

  const input: RouteJobInput = {
    routeId: "route-5",
    walletAddress: WALLET,
    points: POINTS,
    startTime: 3000, // strictly after route-existing ends
    endTime: 4000,
  };
  await submitted(repo, input);

  const outcome = await processRouteJob(
    input,
    baseDeps({ repository: repo, buildRouteHash: () => "0x" + "44".repeat(32) })
  );

  assert.equal(outcome.status, "VERIFIED");
});

test("worker never signs a duplicate even if validation would otherwise pass", async () => {
  // Regression guard: dedup must run and short-circuit BEFORE signRouteProof.
  const repo = new InMemoryRouteRepository();
  const dupHash = "0x" + "55".repeat(32);
  await repo.create({ id: "existing", walletAddress: WALLET, startTime: 1, endTime: 2 });
  await repo.update("existing", { status: "VERIFIED", routeHash: dupHash });

  const input: RouteJobInput = {
    routeId: "route-6",
    walletAddress: WALLET,
    points: POINTS,
    startTime: 9000,
    endTime: 9500,
  };
  await submitted(repo, input);

  let signCallCount = 0;
  await processRouteJob(
    input,
    baseDeps({
      repository: repo,
      buildRouteHash: () => dupHash,
      signRouteProof: async () => {
        signCallCount++;
        return "0x00";
      },
    })
  );
  assert.equal(signCallCount, 0);
});

test("submitRoute persists a SUBMITTED route and enqueues the job", async () => {
  const repo = new InMemoryRouteRepository();
  const enqueued: RouteJobInput[] = [];

  const result = await submitRoute(
    { walletAddress: WALLET, points: POINTS, startTime: 1000, endTime: 2000 },
    {
      repository: repo,
      generateId: () => "fixed-route-id",
      enqueue: async (job) => {
        enqueued.push(job);
      },
    }
  );

  assert.equal(result.routeId, "fixed-route-id");
  assert.equal(result.status, "SUBMITTED");
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].routeId, "fixed-route-id");
  assert.equal(enqueued[0].walletAddress, WALLET);

  const persisted = await repo.findById("fixed-route-id");
  assert.equal(persisted?.status, "SUBMITTED");
  assert.equal(persisted?.walletAddress, WALLET);
  assert.equal(persisted?.startTime, 1000);
  assert.equal(persisted?.endTime, 2000);
  // Raw GPS points are never part of the persisted record's shape.
  assert.equal((persisted as unknown as { points?: unknown }).points, undefined);
});

test("getRouteView returns the persisted status and hides raw GPS/points", async () => {
  const repo = new InMemoryRouteRepository();
  await repo.create({ id: "route-view-1", walletAddress: WALLET, startTime: 1000, endTime: 2000 });
  await repo.update("route-view-1", {
    status: "VERIFIED",
    routeHash: "0x" + "66".repeat(32),
    distanceMeters: 750,
    hexId: "8a2a1072b59ffff",
    oracleSig: "0xdeadbeef",
  });

  const view = await getRouteView("route-view-1", repo);
  assert.ok(view);
  assert.equal(view?.routeId, "route-view-1");
  assert.equal(view?.status, "VERIFIED");
  assert.equal(view?.distanceMeters, 750);
  assert.equal(view?.hexId, "8a2a1072b59ffff");
  assert.equal(view?.oracleSig, "0xdeadbeef");
  assert.equal(typeof view?.createdAt, "string");
  assert.equal(typeof view?.updatedAt, "string");
  // No raw GPS/points/coordinates/path field exists on the view at all.
  assert.equal((view as unknown as { points?: unknown }).points, undefined);
  assert.equal((view as unknown as { coordinates?: unknown }).coordinates, undefined);
  assert.equal((view as unknown as { path?: unknown }).path, undefined);
});

test("getRouteView hides oracleSig unless the route is VERIFIED", async () => {
  const repo = new InMemoryRouteRepository();
  await repo.create({ id: "route-view-2", walletAddress: WALLET, startTime: 1000, endTime: 2000 });
  // Simulate a record that somehow carries a stale oracleSig but isn't VERIFIED.
  await repo.update("route-view-2", { status: "REJECTED", oracleSig: "0xstale" });

  const view = await getRouteView("route-view-2", repo);
  assert.equal(view?.status, "REJECTED");
  assert.equal(view?.oracleSig, null);
});

test("getRouteView returns null for an unknown route id (caller maps this to 404)", async () => {
  const repo = new InMemoryRouteRepository();
  const view = await getRouteView("does-not-exist", repo);
  assert.equal(view, null);
});
