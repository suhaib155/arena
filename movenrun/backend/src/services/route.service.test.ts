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
  type RouteCaptureOutcome,
  type RouteJobDeps,
  type RouteJobInput,
  type TerritoryApplicationResult,
} from "./route.service.js";
import { OracleService } from "./oracle.service.js";
import {
  InMemoryRouteRepository,
  RouteHashConflictError,
  type CreateRouteInput,
  type RouteRecord,
  type RouteRepository,
  type UpdateRoutePatch,
} from "../repositories/route.repository.js";

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

/**
 * Simulates the race condition documented in route.service.ts step 5: two
 * concurrent submissions of the same route can both pass the synchronous
 * findByRouteHash check before either writes. This wraps a real
 * InMemoryRouteRepository and makes exactly one `update()` call throw
 * RouteHashConflictError — as the DB would for the losing writer — so the
 * test doesn't need a live Postgres to exercise the backstop.
 */
class ConflictOnceRepository implements RouteRepository {
  private thrown = false;
  constructor(private readonly inner: RouteRepository, private readonly shouldConflict: (patch: UpdateRoutePatch) => boolean) {}
  create(input: CreateRouteInput) {
    return this.inner.create(input);
  }
  findById(id: string) {
    return this.inner.findById(id);
  }
  findByRouteHash(routeHash: string, excludeId: string) {
    return this.inner.findByRouteHash(routeHash, excludeId);
  }
  findOverlappingVerified(walletAddress: string, startTime: number, endTime: number, excludeId: string) {
    return this.inner.findOverlappingVerified(walletAddress, startTime, endTime, excludeId);
  }
  update(id: string, patch: UpdateRoutePatch): Promise<RouteRecord | null> {
    if (!this.thrown && this.shouldConflict(patch)) {
      this.thrown = true;
      return Promise.reject(new RouteHashConflictError());
    }
    return this.inner.update(id, patch);
  }
}

test("a routeHash conflict raised during finalization is a deterministic REJECTED, not a generic failure", async () => {
  const repo = new ConflictOnceRepository(
    new InMemoryRouteRepository(),
    (patch) => patch.status === "VERIFIED"
  );

  const input: RouteJobInput = {
    routeId: "route-race-1",
    walletAddress: WALLET,
    points: POINTS,
    startTime: 7000,
    endTime: 7500,
  };
  await repo.create({
    id: input.routeId,
    walletAddress: input.walletAddress,
    startTime: input.startTime,
    endTime: input.endTime,
  });

  let signCallCount = 0;
  const outcome = await processRouteJob(
    input,
    baseDeps({
      repository: repo,
      signRouteProof: async (...args) => {
        signCallCount++;
        return oracle.signRouteProof(...args);
      },
    })
  );

  assert.equal(outcome.status, "REJECTED");
  if (outcome.status !== "REJECTED") return;
  assert.match(outcome.rejectionReasons[0], /Duplicate route hash detected during finalization/);
  // The race is only detectable after signing has already happened — this
  // documents that known, narrow window rather than hiding it. The critical
  // property is what happens NEXT: the signature is discarded, never
  // persisted or exposed as VERIFIED.
  assert.equal(signCallCount, 1);

  const persisted = await repo.findById("route-race-1");
  assert.equal(persisted?.status, "REJECTED");
  assert.equal(persisted?.oracleSig, null);
  assert.equal(persisted?.routeHash, null, "the colliding hash must not be persisted on the loser");

  const view = await getRouteView("route-race-1", repo);
  assert.equal(view?.status, "REJECTED");
  assert.equal(view?.oracleSig, null);
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

// ---------------------------------------------------------------------------
// Territory capture wiring (PHASE 6).
//
// The invariant under test: capture is an ADDITIVE step that can only run for a
// route which already passed validation and both dedup checks, and territory is
// only applied when that capture is eligible. The pre-territory behaviour is
// unchanged when no capture dependency is injected — the tests above, which
// pass no capture deps at all, are themselves that proof.
// ---------------------------------------------------------------------------

const ELIGIBLE_CAPTURE: RouteCaptureOutcome = {
  traversedHexIds: ["892a1008943ffff"],
  capturedHexIds: ["892a1008943ffff", "892a100894bffff"],
  loopClosed: true,
  closureDistanceMeters: 12,
  enclosedAreaSquareMeters: 62_500,
  captureEligible: true,
  captureRejectionReasons: [],
  captureGridVersion: 2,
  captureResolution: 9,
};

const INELIGIBLE_CAPTURE: RouteCaptureOutcome = {
  ...ELIGIBLE_CAPTURE,
  capturedHexIds: [],
  loopClosed: false,
  captureEligible: false,
  captureRejectionReasons: ["loopNotClosed"],
};

const EMPTY_APPLICATION: TerritoryApplicationResult = {
  capturedCellIds: [],
  reinforcedCellIds: [],
  attackedCellIds: [],
  contestedCellIds: [],
  transferredCellIds: [],
  rejectedCellIds: [],
};

test("a verified route carries its server-computed capture result", async () => {
  const repo = new InMemoryRouteRepository();
  const input: RouteJobInput = {
    routeId: "route-cap-1",
    walletAddress: WALLET,
    points: POINTS,
    startTime: 1000,
    endTime: 2000,
  };
  await submitted(repo, input);

  const outcome = await processRouteJob(
    input,
    baseDeps({ repository: repo, evaluateCapture: () => ELIGIBLE_CAPTURE }),
  );

  assert.equal(outcome.status, "VERIFIED");
  assert.equal(outcome.capture?.captureEligible, true);
  assert.equal(outcome.capture?.captureGridVersion, 2);
  assert.equal(outcome.capture?.captureResolution, 9);
  // The legacy signed hexId still comes from getHexIdsForPoints (resolution 8),
  // never from the territory grid.
  assert.equal(outcome.status === "VERIFIED" && outcome.hexId, "8a2a1072b59ffff");
});

test("capture is never evaluated for a route that fails validation", async () => {
  const repo = new InMemoryRouteRepository();
  const input: RouteJobInput = {
    routeId: "route-cap-2",
    walletAddress: WALLET,
    points: POINTS,
    startTime: 1000,
    endTime: 2000,
  };
  await submitted(repo, input);

  let captureCalls = 0;
  const outcome = await processRouteJob(
    input,
    baseDeps({
      repository: repo,
      validateRoute: () => ({ isAnomaly: true, reasons: ["Implausible speed"], confidence: 0.2 }),
      evaluateCapture: () => {
        captureCalls += 1;
        return ELIGIBLE_CAPTURE;
      },
    }),
  );

  assert.equal(outcome.status, "REJECTED");
  assert.equal(captureCalls, 0, "a route that failed validation must never reach capture");
});

test("capture is never evaluated for a duplicate route", async () => {
  const repo = new InMemoryRouteRepository();
  const first: RouteJobInput = {
    routeId: "route-cap-3a",
    walletAddress: WALLET,
    points: POINTS,
    startTime: 1000,
    endTime: 2000,
  };
  const duplicate: RouteJobInput = { ...first, routeId: "route-cap-3b" };
  await submitted(repo, first);
  await submitted(repo, duplicate);

  let captureCalls = 0;
  const deps = baseDeps({
    repository: repo,
    evaluateCapture: () => {
      captureCalls += 1;
      return ELIGIBLE_CAPTURE;
    },
  });

  await processRouteJob(first, deps);
  assert.equal(captureCalls, 1);

  const outcome = await processRouteJob(duplicate, deps);
  assert.equal(outcome.status, "REJECTED");
  assert.match(outcome.rejectionReasons[0], /Duplicate route hash/);
  assert.equal(captureCalls, 1, "the duplicate must not be evaluated for capture");
});

test("territory is applied only for an eligible capture", async () => {
  const repo = new InMemoryRouteRepository();
  const input: RouteJobInput = {
    routeId: "route-cap-4",
    walletAddress: WALLET,
    points: POINTS,
    startTime: 1000,
    endTime: 2000,
  };
  await submitted(repo, input);

  let applied = 0;
  const outcome = await processRouteJob(
    input,
    baseDeps({
      repository: repo,
      evaluateCapture: () => ELIGIBLE_CAPTURE,
      applyCapture: async ({ capture }) => {
        applied += 1;
        return { ...EMPTY_APPLICATION, capturedCellIds: capture.capturedHexIds };
      },
    }),
  );

  assert.equal(applied, 1);
  assert.equal(outcome.status, "VERIFIED");
  assert.deepEqual(
    outcome.status === "VERIFIED" ? outcome.territory?.capturedCellIds : null,
    ELIGIBLE_CAPTURE.capturedHexIds,
  );
});

test("an ineligible capture changes no ownership", async () => {
  const repo = new InMemoryRouteRepository();
  const input: RouteJobInput = {
    routeId: "route-cap-5",
    walletAddress: WALLET,
    points: POINTS,
    startTime: 1000,
    endTime: 2000,
  };
  await submitted(repo, input);

  let applied = 0;
  const outcome = await processRouteJob(
    input,
    baseDeps({
      repository: repo,
      evaluateCapture: () => INELIGIBLE_CAPTURE,
      applyCapture: async () => {
        applied += 1;
        return EMPTY_APPLICATION;
      },
    }),
  );

  assert.equal(applied, 0, "an ineligible loop must never apply territory");
  assert.equal(outcome.status, "VERIFIED", "the route itself is still a valid run");
  assert.equal(outcome.capture?.captureEligible, false);
  assert.equal(outcome.status === "VERIFIED" && outcome.territory, undefined);
});

test("a territory write failure does not un-verify an already-signed route", async () => {
  const repo = new InMemoryRouteRepository();
  const input: RouteJobInput = {
    routeId: "route-cap-6",
    walletAddress: WALLET,
    points: POINTS,
    startTime: 1000,
    endTime: 2000,
  };
  await submitted(repo, input);

  const outcome = await processRouteJob(
    input,
    baseDeps({
      repository: repo,
      evaluateCapture: () => ELIGIBLE_CAPTURE,
      applyCapture: async () => {
        throw new Error("territory database unavailable");
      },
    }),
  );

  assert.equal(outcome.status, "VERIFIED");
  assert.equal(
    outcome.status === "VERIFIED" && outcome.territoryError,
    "territory database unavailable",
  );
  const record = await repo.findById("route-cap-6");
  assert.equal(record?.status, "VERIFIED", "the route record must stay VERIFIED");
  assert.ok(record?.oracleSig, "the signature must still be persisted");
});

test("route processing is unchanged when no capture dependency is injected", async () => {
  const repo = new InMemoryRouteRepository();
  const input: RouteJobInput = {
    routeId: "route-cap-7",
    walletAddress: WALLET,
    points: POINTS,
    startTime: 1000,
    endTime: 2000,
  };
  await submitted(repo, input);

  const outcome = await processRouteJob(input, baseDeps({ repository: repo }));
  assert.equal(outcome.status, "VERIFIED");
  assert.equal(outcome.capture, undefined);
  assert.equal(outcome.status === "VERIFIED" && outcome.territory, undefined);
});
