/**
 * Ownership application — capture, reinforce, attack, contest, transfer, and
 * the concurrency guarantee.
 *
 * The concurrency test is the one that matters: two runners closing loops over
 * the same untouched cell at the same moment must produce exactly one capture.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TerritoryOwnershipService } from "./ownership.service.js";
import { InMemoryTerritoryRepository } from "./repository.js";
import { neutralTerritory, TERRITORY_RULES } from "./rules.js";
import type { TerritoryRecord } from "./types.js";

const GRID = 2;
const RES = 9;
const CELL_A = "892a1008943ffff";
const CELL_B = "892a100894bffff";
const CELL_C = "892a100895bffff";

const RUNNER = "0x1111111111111111111111111111111111111111";
const RIVAL = "0x2222222222222222222222222222222222222222";

function service(repository = new InMemoryTerritoryRepository()) {
  return { repository, service: new TerritoryOwnershipService(repository) };
}

function capture(
  overrides: Partial<Parameters<TerritoryOwnershipService["applyCapture"]>[0]> = {},
) {
  return {
    routeId: "route-1",
    walletAddress: RUNNER,
    userId: "user-1",
    clubId: null,
    evidenceHash: "0xdeadbeef",
    gridVersion: GRID,
    resolution: RES,
    traversedHexIds: [CELL_A],
    capturedHexIds: [CELL_A, CELL_B],
    ...overrides,
  };
}

function seeded(repository: InMemoryTerritoryRepository, record: Partial<TerritoryRecord>) {
  repository.seed({ ...neutralTerritory(CELL_A, GRID, RES), ...record });
}

// ------------------------------------------------------------------ capture

test("an eligible capture claims every neutral cell it covers", async () => {
  const { service: svc, repository } = service();
  const result = await svc.applyCapture(capture());

  assert.deepEqual(result.capturedCellIds.sort(), [CELL_A, CELL_B].sort());
  assert.deepEqual(result.rejectedCellIds, []);

  const cells = await repository.findCells([CELL_A, CELL_B], GRID, RES);
  for (const cellId of [CELL_A, CELL_B]) {
    const cell = cells.get(cellId)!;
    assert.equal(cell.state, "owned");
    assert.equal(cell.ownerWalletAddress, RUNNER);
    assert.equal(cell.defenceScore, TERRITORY_RULES.captureDefence);
    assert.equal(cell.version, 1, "version must be bumped on every ownership write");
    assert.equal(cell.gridVersion, GRID);
    assert.equal(cell.h3Resolution, RES);
  }
});

test("capturing writes append-only history with the evidence hash, not GPS", async () => {
  const { service: svc, repository } = service();
  await svc.applyCapture(capture());

  const history = await repository.findCellHistory(CELL_A, GRID, 10);
  assert.equal(history.length, 1);
  assert.equal(history[0].eventType, "captured");
  assert.equal(history[0].previousState, "neutral");
  assert.equal(history[0].nextState, "owned");
  assert.equal(history[0].previousOwner, null);
  assert.equal(history[0].nextOwner, RUNNER);
  assert.equal(history[0].evidenceHash, "0xdeadbeef");
  assert.equal(history[0].routeId, "route-1");
  // Nothing resembling a coordinate is anywhere in the event.
  assert.ok(!("lat" in history[0]) && !("lng" in history[0]));
});

test("history accumulates and is never overwritten", async () => {
  const { service: svc, repository } = service();
  await svc.applyCapture(capture({ routeId: "route-1" }));
  await svc.applyCapture(capture({ routeId: "route-2" }));
  await svc.applyCapture(capture({ routeId: "route-3" }));

  const history = await repository.findCellHistory(CELL_A, GRID, 10);
  assert.equal(history.length, 3);
  assert.deepEqual(
    history.map((e) => e.eventType),
    ["reinforced", "reinforced", "captured"],
    "newest first: capture then two reinforcements",
  );
});

test("an empty capture list changes nothing", async () => {
  const { service: svc } = service();
  const result = await svc.applyCapture(capture({ capturedHexIds: [], traversedHexIds: [] }));
  assert.deepEqual(result.capturedCellIds, []);
  assert.deepEqual(result.controlChanges, []);
});

test("duplicate cell ids in the capture list are collapsed", async () => {
  const { service: svc } = service();
  const result = await svc.applyCapture(
    capture({ capturedHexIds: [CELL_A, CELL_A, CELL_A], traversedHexIds: [] }),
  );
  assert.deepEqual(result.capturedCellIds, [CELL_A]);
});

// -------------------------------------------------------------- reinforcing

test("re-running your own territory reinforces rather than re-captures", async () => {
  const { service: svc, repository } = service();
  await svc.applyCapture(capture({ routeId: "route-1" }));
  const result = await svc.applyCapture(capture({ routeId: "route-2" }));

  assert.deepEqual(result.capturedCellIds, []);
  assert.deepEqual(result.reinforcedCellIds.sort(), [CELL_A, CELL_B].sort());

  const cell = (await repository.findCells([CELL_A], GRID, RES)).get(CELL_A)!;
  assert.equal(
    cell.defenceScore,
    TERRITORY_RULES.captureDefence + TERRITORY_RULES.reinforceCrossed,
    "crossed cells get the stronger reinforcement",
  );
});

test("a crossed cell reinforces more than an enclosed one in the same run", async () => {
  const { service: svc, repository } = service();
  await svc.applyCapture(capture({ routeId: "route-1" }));
  await svc.applyCapture(capture({ routeId: "route-2", traversedHexIds: [CELL_A] }));

  const cells = await repository.findCells([CELL_A, CELL_B], GRID, RES);
  assert.ok(
    cells.get(CELL_A)!.defenceScore > cells.get(CELL_B)!.defenceScore,
    "the cell the runner actually entered should be better defended",
  );
});

// ----------------------------------------------------------------- attacking

test("attacking a rival cell lowers defence without transferring it", async () => {
  const { service: svc, repository } = service();
  seeded(repository, {
    ownerWalletAddress: RIVAL,
    ownerUserId: "user-2",
    state: "owned",
    defenceScore: 40,
    controlScore: 30,
  });

  const result = await svc.applyCapture(
    capture({ capturedHexIds: [CELL_A], traversedHexIds: [CELL_A] }),
  );

  assert.deepEqual(result.attackedCellIds, [CELL_A]);
  assert.deepEqual(result.capturedCellIds, []);
  assert.deepEqual(result.transferredCellIds, []);

  const cell = (await repository.findCells([CELL_A], GRID, RES)).get(CELL_A)!;
  assert.equal(cell.ownerWalletAddress, RIVAL, "ownership must survive an attack");
  assert.equal(cell.defenceScore, 40 - TERRITORY_RULES.attackCrossed);
});

test("an attack does not refresh the defender's lastDefendedAt", async () => {
  const { service: svc, repository } = service();
  const defendedAt = new Date("2026-01-01T00:00:00Z");
  seeded(repository, {
    ownerWalletAddress: RIVAL,
    state: "owned",
    defenceScore: 40,
    lastDefendedAt: defendedAt,
  });

  await svc.applyCapture(capture({ capturedHexIds: [CELL_A], traversedHexIds: [CELL_A] }));
  const cell = (await repository.findCells([CELL_A], GRID, RES)).get(CELL_A)!;
  assert.deepEqual(cell.lastDefendedAt, defendedAt, "being attacked is not defending");
});

// ------------------------------------------------ contested → transfer path

test("driving defence to zero contests a cell without taking it", async () => {
  const { service: svc, repository } = service();
  seeded(repository, { ownerWalletAddress: RIVAL, state: "owned", defenceScore: 3 });

  const result = await svc.applyCapture(
    capture({ capturedHexIds: [CELL_A], traversedHexIds: [CELL_A] }),
  );

  assert.deepEqual(result.contestedCellIds, [CELL_A]);
  assert.deepEqual(result.transferredCellIds, []);

  const cell = (await repository.findCells([CELL_A], GRID, RES)).get(CELL_A)!;
  assert.equal(cell.state, "contested");
  assert.equal(cell.ownerWalletAddress, RIVAL, "the incumbent still holds a contested cell");
  assert.equal(cell.defenceScore, 0);
  assert.ok(cell.contestedAt !== null);
});

test("a second qualifying run completes the transfer", async () => {
  const { service: svc, repository } = service();
  seeded(repository, { ownerWalletAddress: RIVAL, state: "owned", defenceScore: 3 });

  await svc.applyCapture(
    capture({ routeId: "route-1", capturedHexIds: [CELL_A], traversedHexIds: [CELL_A] }),
  );
  const result = await svc.applyCapture(
    capture({ routeId: "route-2", capturedHexIds: [CELL_A], traversedHexIds: [CELL_A] }),
  );

  assert.deepEqual(result.transferredCellIds, [CELL_A]);
  const cell = (await repository.findCells([CELL_A], GRID, RES)).get(CELL_A)!;
  assert.equal(cell.ownerWalletAddress, RUNNER);
  assert.equal(cell.state, "owned");
  assert.equal(cell.defenceScore, TERRITORY_RULES.captureDefence, "the new owner starts fresh");
});

test("a well-defended cell survives a single pass entirely", async () => {
  const { service: svc, repository } = service();
  seeded(repository, { ownerWalletAddress: RIVAL, state: "owned", defenceScore: 80 });

  const result = await svc.applyCapture(
    capture({ capturedHexIds: [CELL_A], traversedHexIds: [CELL_A] }),
  );
  assert.deepEqual(result.transferredCellIds, []);
  assert.deepEqual(result.contestedCellIds, []);
  assert.deepEqual(result.attackedCellIds, [CELL_A]);
});

// --------------------------------------------------- restricted / protected

test("restricted cells are rejected, not captured", async () => {
  const { service: svc, repository } = service();
  await repository.setClassification(CELL_B, GRID, "water");

  const result = await svc.applyCapture(capture());
  assert.deepEqual(result.capturedCellIds, [CELL_A]);
  assert.deepEqual(result.rejectedCellIds, [CELL_B]);

  const cell = (await repository.findCells([CELL_B], GRID, RES)).get(CELL_B)!;
  assert.equal(cell.ownerWalletAddress, null);
});

test("protected cells are rejected without changing", async () => {
  const { service: svc, repository } = service();
  seeded(repository, { ownerWalletAddress: RIVAL, state: "protected", defenceScore: 20 });

  const result = await svc.applyCapture(
    capture({ capturedHexIds: [CELL_A], traversedHexIds: [CELL_A] }),
  );
  assert.deepEqual(result.rejectedCellIds, [CELL_A]);

  const cell = (await repository.findCells([CELL_A], GRID, RES)).get(CELL_A)!;
  assert.equal(cell.defenceScore, 20);
  assert.equal(cell.version, 0, "a rejected cell must not be written at all");
});

// -------------------------------------------------------------- concurrency

test("two simultaneous captures of the same neutral cell yield exactly one owner", async () => {
  const { service: svc, repository } = service();

  const [first, second] = await Promise.all([
    svc.applyCapture(capture({ routeId: "route-a", walletAddress: RUNNER, capturedHexIds: [CELL_A], traversedHexIds: [CELL_A] })),
    svc.applyCapture(capture({ routeId: "route-b", walletAddress: RIVAL, capturedHexIds: [CELL_A], traversedHexIds: [CELL_A] })),
  ]);

  const captures = first.capturedCellIds.length + second.capturedCellIds.length;
  assert.equal(captures, 1, "exactly one of the two runners may capture the cell");

  const conflicts = first.conflictedCellIds.length + second.conflictedCellIds.length;
  assert.equal(conflicts, 1, "the loser must be reported as a conflict, not silently dropped");

  const cell = (await repository.findCells([CELL_A], GRID, RES)).get(CELL_A)!;
  assert.equal(cell.version, 1, "only one write may land");
  assert.ok([RUNNER, RIVAL].includes(cell.ownerWalletAddress!));
});

test("a cell lost to a race is reported as rejected, so nothing is over-promised", async () => {
  const { service: svc } = service();
  const [first, second] = await Promise.all([
    svc.applyCapture(capture({ routeId: "route-a", walletAddress: RUNNER, capturedHexIds: [CELL_A], traversedHexIds: [] })),
    svc.applyCapture(capture({ routeId: "route-b", walletAddress: RIVAL, capturedHexIds: [CELL_A], traversedHexIds: [] })),
  ]);
  const loser = first.capturedCellIds.length === 0 ? first : second;
  assert.ok(loser.rejectedCellIds.includes(CELL_A));
  assert.ok(loser.conflictedCellIds.includes(CELL_A));
});

test("a partial conflict still applies the cells that were free", async () => {
  const { service: svc, repository } = service();
  // RIVAL takes CELL_A first, at defence high enough to survive a pass.
  seeded(repository, { ownerWalletAddress: RIVAL, state: "owned", defenceScore: 80 });

  const result = await svc.applyCapture(
    capture({ capturedHexIds: [CELL_A, CELL_B, CELL_C], traversedHexIds: [CELL_A] }),
  );
  assert.deepEqual(result.attackedCellIds, [CELL_A]);
  assert.deepEqual(result.capturedCellIds.sort(), [CELL_B, CELL_C].sort());
});

// -------------------------------------------------------- grid-version safety

test("a cell stored under another grid version is never reinterpreted", async () => {
  const { service: svc, repository } = service();
  // A legacy-grid row for the same cell id.
  repository.seed({
    ...neutralTerritory(CELL_A, 1, 8),
    ownerWalletAddress: RIVAL,
    state: "owned",
    defenceScore: 50,
  });

  const result = await svc.applyCapture(
    capture({ capturedHexIds: [CELL_A], traversedHexIds: [CELL_A] }),
  );
  // The v2 lookup sees no v2 row, so it captures fresh — the v1 row is untouched.
  assert.deepEqual(result.capturedCellIds, [CELL_A]);

  const legacy = (await repository.findCells([CELL_A], 1, 8)).get(CELL_A)!;
  assert.equal(legacy.ownerWalletAddress, RIVAL, "the legacy row must not be touched");
  assert.equal(legacy.defenceScore, 50);
});

// ------------------------------------------------------------ control changes

test("only ownership changes reach the realtime feed", async () => {
  const { service: svc } = service();
  const captureResult = await svc.applyCapture(capture({ routeId: "route-1" }));
  assert.equal(captureResult.controlChanges.length, 2, "two captures broadcast");
  assert.equal(captureResult.controlChanges[0].eventType, "captured");
  assert.equal(captureResult.controlChanges[0].previousState, "neutral");
  assert.equal(captureResult.controlChanges[0].nextState, "owned");
  assert.equal(captureResult.controlChanges[0].territoryVersion, 1);

  const reinforceResult = await svc.applyCapture(capture({ routeId: "route-2" }));
  assert.deepEqual(
    reinforceResult.controlChanges,
    [],
    "a score-only reinforcement is not an ownership change",
  );
});

test("control-change versions increase, so a client can drop a stale event", async () => {
  const { service: svc, repository } = service();
  // Capture, then contest, then transfer — three ownership-relevant writes.
  await svc.applyCapture(
    capture({ routeId: "route-1", capturedHexIds: [CELL_A], traversedHexIds: [CELL_A] }),
  );
  const rivalCapture = capture({
    walletAddress: RIVAL,
    userId: "user-2",
    capturedHexIds: [CELL_A],
    traversedHexIds: [CELL_A],
  });
  // Attack repeatedly until the cell is contested, then take it.
  let contestVersion = 0;
  for (let i = 0; i < 10; i++) {
    const result = await svc.applyCapture({ ...rivalCapture, routeId: `route-atk-${i}` });
    if (result.contestedCellIds.length > 0) {
      contestVersion = result.controlChanges[0].territoryVersion;
      break;
    }
  }
  assert.ok(contestVersion > 1, "contesting must land on a later version than the capture");

  const transfer = await svc.applyCapture({ ...rivalCapture, routeId: "route-take" });
  assert.deepEqual(transfer.transferredCellIds, [CELL_A]);
  assert.ok(
    transfer.controlChanges[0].territoryVersion > contestVersion,
    "each ownership change must carry a strictly newer version",
  );
  assert.equal(transfer.controlChanges[0].previousOwner, RUNNER);
  assert.equal(transfer.controlChanges[0].nextOwner, RIVAL);

  const cell = (await repository.findCells([CELL_A], GRID, RES)).get(CELL_A)!;
  assert.equal(cell.version, transfer.controlChanges[0].territoryVersion);
});

// ------------------------------------------------------------ capture session

test("the capture evaluation is recorded whether or not it was eligible", async () => {
  const { service: svc, repository } = service();
  await svc.recordCaptureSession({
    id: "session-1",
    routeId: "route-1",
    walletAddress: RUNNER,
    userId: "user-1",
    loopClosed: false,
    captureEligible: false,
    closureDistanceMeters: 180,
    enclosedAreaSquareMeters: 4200,
    traversedHexCount: 6,
    capturedHexCount: 0,
    rejectionReasons: ["loopNotClosed", "areaBelowMinimum"],
    gridVersion: GRID,
    resolution: RES,
    createdAt: new Date(),
    processedAt: new Date(),
  });

  const stored = await repository.findCaptureSessionByRouteId("route-1");
  assert.ok(stored);
  assert.equal(stored.captureEligible, false);
  assert.deepEqual(stored.rejectionReasons, ["loopNotClosed", "areaBelowMinimum"]);
  assert.equal(stored.capturedHexCount, 0);
});

// ------------------------------------------------------------------ portfolio

test("owned cells are queryable per wallet, case-insensitively", async () => {
  const { service: svc, repository } = service();
  await svc.applyCapture(capture());
  const owned = await repository.findByOwner(RUNNER.toUpperCase(), GRID);
  assert.equal(owned.length, 2);
  assert.deepEqual(owned.map((t) => t.h3CellId).sort(), [CELL_A, CELL_B].sort());
});
