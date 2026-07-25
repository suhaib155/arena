/**
 * D5 regression — territory application is idempotent per (routeId, gridVersion).
 *
 * The defect this locks down: a retried BullMQ job re-ran the ownership rules
 * for the same route. The cell was not re-*captured* (the state machine saw it
 * as already owned), but every retry handed out another **reinforcement** —
 * defence 10 → 16 → 22 and a fresh ownership event, from one real run.
 *
 * The fix keys the whole application on `(routeId, gridVersion)` in the
 * database and commits the claim, the ownership writes and the stored result in
 * one transaction. These tests prove each of the guarantees that buys.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TerritoryOwnershipService, type ApplyCaptureResult } from "./ownership.service.js";
import { InMemoryTerritoryRepository } from "./repository.js";
import { neutralTerritory, TERRITORY_RULES } from "./rules.js";
import type { TerritoryRecord } from "./types.js";

const GRID = 2;
const RES = 9;
const CELL_A = "892a1008943ffff";
const CELL_B = "892a100894bffff";
const RUNNER = "0x1111111111111111111111111111111111111111";
const RIVAL = "0x2222222222222222222222222222222222222222";

function svc(repository = new InMemoryTerritoryRepository()) {
  return { repository, service: new TerritoryOwnershipService(repository) };
}

function capture(overrides: Record<string, unknown> = {}) {
  return {
    routeId: "route-retry",
    walletAddress: RUNNER,
    gridVersion: GRID,
    resolution: RES,
    traversedHexIds: [CELL_A],
    capturedHexIds: [CELL_A],
    ...overrides,
  } as Parameters<TerritoryOwnershipService["applyCapture"]>[0];
}

async function cellOf(
  repository: InMemoryTerritoryRepository,
  cellId = CELL_A,
): Promise<TerritoryRecord> {
  return (await repository.findCells([cellId], GRID, RES)).get(cellId)!;
}

/** Everything a repeat must leave untouched. */
function fingerprint(cell: TerritoryRecord) {
  return {
    owner: cell.ownerWalletAddress,
    state: cell.state,
    control: cell.controlScore,
    defence: cell.defenceScore,
    version: cell.version,
  };
}

// ------------------------------------------------------- sequential duplicate

test("D5: processing the same route twice applies territory exactly once", async () => {
  const { repository, service } = svc();

  const first = await service.applyCapture(capture());
  const afterFirst = fingerprint(await cellOf(repository));

  const second = await service.applyCapture(capture());
  const afterSecond = fingerprint(await cellOf(repository));

  assert.deepEqual(first.capturedCellIds, [CELL_A]);
  assert.deepEqual(
    second,
    first,
    "a retry must return the stored result, not a freshly computed one",
  );
  assert.deepEqual(
    afterSecond,
    afterFirst,
    "control, defence, version, owner and state must all be unchanged by a retry",
  );
  assert.equal(afterSecond.defence, TERRITORY_RULES.captureDefence);
  assert.equal(afterSecond.version, 1, "the retry must not bump the row version");
});

// ---------------------------------------------------------- three repetitions

test("D5: three repeated attempts leave one capture and no extra reinforcement", async () => {
  const { repository, service } = svc();
  const results: ApplyCaptureResult[] = [];
  const states: ReturnType<typeof fingerprint>[] = [];

  for (let attempt = 0; attempt < 3; attempt++) {
    results.push(await service.applyCapture(capture()));
    states.push(fingerprint(await cellOf(repository)));
  }

  // This is the exact regression: defence used to walk 10 -> 16 -> 22.
  assert.deepEqual(
    states.map((s) => s.defence),
    [TERRITORY_RULES.captureDefence, TERRITORY_RULES.captureDefence, TERRITORY_RULES.captureDefence],
    "defence must not grow across retries",
  );
  assert.deepEqual(
    states.map((s) => s.control),
    [TERRITORY_RULES.captureControl, TERRITORY_RULES.captureControl, TERRITORY_RULES.captureControl],
    "control must not grow across retries",
  );
  assert.deepEqual(states[1], states[0]);
  assert.deepEqual(states[2], states[0]);
  for (const result of results) assert.deepEqual(result, results[0]);
});

// ----------------------------------------------------------- ownership events

test("D5: repeats write exactly one ownership-event set", async () => {
  const { repository, service } = svc();
  for (let i = 0; i < 3; i++) await service.applyCapture(capture());

  const byRoute = await repository.findEventsByRoute("route-retry", GRID);
  assert.equal(byRoute.length, 1, `expected 1 event, got ${byRoute.length}`);
  assert.equal(byRoute[0].eventType, "captured");

  const cellHistory = await repository.findCellHistory(CELL_A, GRID, 50);
  assert.equal(cellHistory.length, 1, "no duplicate history rows for one route");
});

test("D5: a route covering several cells writes each cell's event once", async () => {
  const { repository, service } = svc();
  const input = capture({ capturedHexIds: [CELL_A, CELL_B], traversedHexIds: [CELL_A] });

  await service.applyCapture(input);
  await service.applyCapture(input);

  const events = await repository.findEventsByRoute("route-retry", GRID);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((e) => e.h3CellId).sort(), [CELL_A, CELL_B].sort());
});

// ---------------------------------------------------------------- concurrency

test("D5: concurrent duplicate processing produces one effective result", async () => {
  const { repository, service } = svc();

  const [a, b, c] = await Promise.all([
    service.applyCapture(capture()),
    service.applyCapture(capture()),
    service.applyCapture(capture()),
  ]);

  const cell = await cellOf(repository);
  assert.equal(cell.version, 1, "exactly one write may land");
  assert.equal(cell.defenceScore, TERRITORY_RULES.captureDefence);

  const events = await repository.findEventsByRoute("route-retry", GRID);
  assert.equal(events.length, 1, "concurrent attempts must not each write an event");

  // Every caller sees the same answer, whoever won.
  assert.deepEqual(b, a);
  assert.deepEqual(c, a);
});

// ------------------------------------------------------- retry after complete

test("D5: a retry after completion mutates nothing and replays the stored result", async () => {
  const { repository, service } = svc();
  const original = await service.applyCapture(capture());
  const before = fingerprint(await cellOf(repository));

  // Simulate the worker being restarted and the job redelivered much later.
  const replay = await service.applyCapture(capture());

  assert.deepEqual(replay, original);
  assert.deepEqual(fingerprint(await cellOf(repository)), before);
});

test("D5: the replayed result is a copy — a caller cannot corrupt the ledger", async () => {
  const { service } = svc();
  const first = await service.applyCapture(capture());
  first.capturedCellIds.push("tampered");

  const second = await service.applyCapture(capture());
  assert.deepEqual(
    second.capturedCellIds,
    [CELL_A],
    "mutating a returned result must not change what the next replay yields",
  );
});

// ------------------------------------------------------- retry after rollback

test("D5: a rolled-back attempt leaves no claim and stays retryable", async () => {
  const repository = new InMemoryTerritoryRepository();
  const service = new TerritoryOwnershipService(repository);

  // Force the first attempt to fail *during* the transaction, the way a
  // transient DB error would. The claim and the writes roll back together.
  const realApply = repository.applyOwnershipTransactionIdempotent.bind(repository);
  let failNext = true;
  repository.applyOwnershipTransactionIdempotent = (async (writes, options) => {
    if (failNext) {
      failNext = false;
      throw new Error("transient database error");
    }
    return realApply(writes, options);
  }) as typeof repository.applyOwnershipTransactionIdempotent;

  await assert.rejects(() => service.applyCapture(capture()), /transient database error/);

  // Nothing was applied…
  const afterFailure = await cellOf(repository);
  assert.equal(afterFailure.state, "neutral");
  assert.equal(afterFailure.version, 0);
  assert.equal((await repository.findEventsByRoute("route-retry", GRID)).length, 0);

  // …and the retry succeeds normally, because no claim survived the rollback.
  const retry = await service.applyCapture(capture());
  assert.deepEqual(retry.capturedCellIds, [CELL_A]);
  const afterRetry = await cellOf(repository);
  assert.equal(afterRetry.version, 1);
  assert.equal(afterRetry.defenceScore, TERRITORY_RULES.captureDefence);
});

// ---------------------------------------------------- the key is route + grid

test("D5: a different route on the same cell still applies", async () => {
  const { repository, service } = svc();
  await service.applyCapture(capture({ routeId: "route-1" }));
  const second = await service.applyCapture(capture({ routeId: "route-2" }));

  // A genuinely different run reinforces — that is not a replay.
  assert.deepEqual(second.reinforcedCellIds, [CELL_A]);
  const cell = await cellOf(repository);
  assert.equal(cell.version, 2);
  assert.equal(
    cell.defenceScore,
    TERRITORY_RULES.captureDefence + TERRITORY_RULES.reinforceCrossed,
  );
});

test("D5: the same route on a different grid version is a separate application", async () => {
  const { repository, service } = svc();
  await service.applyCapture(capture({ gridVersion: 2 }));
  const other = await service.applyCapture(capture({ gridVersion: 3, resolution: 10 }));

  assert.deepEqual(other.capturedCellIds, [CELL_A], "grid v3 is not a replay of grid v2");
  assert.equal((await repository.findCells([CELL_A], 2, 9)).get(CELL_A)!.version, 1);
  assert.equal((await repository.findCells([CELL_A], 3, 10)).get(CELL_A)!.version, 1);
});

// --------------------------------------------------- attacks are idempotent too

test("D5: a retried attack does not drain a rival twice", async () => {
  const repository = new InMemoryTerritoryRepository();
  repository.seed({
    ...neutralTerritory(CELL_A, GRID, RES),
    ownerWalletAddress: RIVAL,
    state: "owned",
    defenceScore: 40,
    controlScore: 30,
  });
  const service = new TerritoryOwnershipService(repository);

  const first = await service.applyCapture(capture());
  const afterFirst = await cellOf(repository);
  assert.deepEqual(first.attackedCellIds, [CELL_A]);
  assert.equal(afterFirst.defenceScore, 40 - TERRITORY_RULES.attackCrossed);

  await service.applyCapture(capture());
  const afterRetry = await cellOf(repository);
  assert.equal(
    afterRetry.defenceScore,
    afterFirst.defenceScore,
    "a retried attack must not drain the defender again",
  );
  assert.equal(afterRetry.ownerWalletAddress, RIVAL);
  assert.equal((await repository.findEventsByRoute("route-retry", GRID)).length, 1);
});

test("D5: a retried reinforcement does not stack", async () => {
  const repository = new InMemoryTerritoryRepository();
  repository.seed({
    ...neutralTerritory(CELL_A, GRID, RES),
    ownerWalletAddress: RUNNER,
    state: "owned",
    defenceScore: 30,
    controlScore: 20,
  });
  const service = new TerritoryOwnershipService(repository);

  await service.applyCapture(capture());
  const afterFirst = fingerprint(await cellOf(repository));
  assert.equal(afterFirst.defence, 30 + TERRITORY_RULES.reinforceCrossed);

  await service.applyCapture(capture());
  assert.deepEqual(
    fingerprint(await cellOf(repository)),
    afterFirst,
    "a retried reinforcement must not stack",
  );
});

// ------------------------------------------------------------- ledger reads

test("D5: a completed application is readable by its key", async () => {
  const { repository, service } = svc();
  assert.equal(
    await repository.findCompletedApplication({ routeId: "route-retry", gridVersion: GRID }),
    null,
    "nothing recorded before the first attempt",
  );

  const result = await service.applyCapture(capture());
  const stored = await repository.findCompletedApplication<ApplyCaptureResult>({
    routeId: "route-retry",
    gridVersion: GRID,
  });
  assert.deepEqual(stored, result);
});
