/**
 * Cell classification — which ground is playable at all.
 *
 * Two design decisions are locked here:
 *  - Unclassified ground is **playable**. Closed-by-default would make the game
 *    unplayable everywhere a classifier has not reached yet.
 *  - Classification never touches ownership, and never infers anything from how
 *    a basemap renders. Only an explicit, sourced classification counts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CellClassificationService,
  LayeredCellClassifier,
  ManualCellClassifier,
  type CellClassifier,
} from "./classification.service.js";
import { InMemoryTerritoryRepository } from "./repository.js";
import { neutralTerritory } from "./rules.js";
import type { CellClassification } from "./types.js";

const GRID = 2;
const RES = 9;
const CELL_A = "892a1008943ffff";
const CELL_B = "892a100894bffff";
const CELL_C = "892a100895bffff";

function service() {
  const repository = new InMemoryTerritoryRepository();
  return { repository, service: new CellClassificationService(repository) };
}

test("unclassified ground is playable", async () => {
  const { service: svc } = service();
  const result = await svc.filterCapturable([CELL_A, CELL_B], GRID);
  assert.deepEqual(result.capturable, [CELL_A, CELL_B]);
  assert.deepEqual(result.blocked, []);
});

test("non-playable classifications block capture and name the reason", async () => {
  for (const classification of ["restricted", "water", "private", "dangerous"] as CellClassification[]) {
    const { service: svc } = service();
    await svc.setClassification(CELL_A, GRID, classification);
    const result = await svc.filterCapturable([CELL_A, CELL_B], GRID);
    assert.deepEqual(result.capturable, [CELL_B]);
    assert.deepEqual(result.blocked, [{ cellId: CELL_A, classification }]);
  }
});

test("park, landmark and eventOnly ground stays capturable", async () => {
  for (const classification of ["park", "landmark", "eventOnly", "playable"] as CellClassification[]) {
    const { service: svc } = service();
    await svc.setClassification(CELL_A, GRID, classification);
    const result = await svc.filterCapturable([CELL_A], GRID);
    assert.deepEqual(result.capturable, [CELL_A], `${classification} should stay capturable`);
  }
});

test("classifying a cell as unplayable also restricts its existing territory row", async () => {
  const { service: svc, repository } = service();
  repository.seed({
    ...neutralTerritory(CELL_A, GRID, RES),
    ownerWalletAddress: "0x1111111111111111111111111111111111111111",
    state: "owned",
    defenceScore: 30,
  });

  await svc.setClassification(CELL_A, GRID, "water");
  const cell = (await repository.findCells([CELL_A], GRID, RES)).get(CELL_A)!;
  assert.equal(cell.classification, "water");
  assert.equal(cell.state, "restricted");
});

test("a classification is scoped to its grid version", async () => {
  const { service: svc } = service();
  await svc.setClassification(CELL_A, GRID, "water");
  const other = await svc.filterCapturable([CELL_A], 1);
  assert.deepEqual(other.capturable, [CELL_A], "a v2 classification must not bind the v1 grid");
});

test("an empty cell list is a no-op", async () => {
  const { service: svc } = service();
  const result = await svc.filterCapturable([], GRID);
  assert.deepEqual(result.capturable, []);
  assert.deepEqual(result.blocked, []);
  assert.equal((await svc.getClassifications([], GRID)).size, 0);
});

// ------------------------------------------------------ the classifier seam

test("a future automated classifier plugs in without changing callers", async () => {
  const repository = new InMemoryTerritoryRepository();
  // Stands in for a future OpenStreetMap land-use classifier.
  const landUse: CellClassifier = {
    async classify(cellIds) {
      const out = new Map<string, CellClassification>();
      for (const cellId of cellIds) {
        if (cellId === CELL_B) out.set(cellId, "water");
      }
      return out;
    },
  };
  const svc = new CellClassificationService(repository, landUse);
  const result = await svc.filterCapturable([CELL_A, CELL_B], GRID);
  assert.deepEqual(result.capturable, [CELL_A]);
  assert.deepEqual(result.blocked, [{ cellId: CELL_B, classification: "water" }]);
});

test("a manual override beats an automated classifier", async () => {
  const repository = new InMemoryTerritoryRepository();
  await repository.setClassification(CELL_A, GRID, "playable", "manual");

  const overEagerClassifier: CellClassifier = {
    async classify(cellIds) {
      return new Map(cellIds.map((id) => [id, "water" as CellClassification]));
    },
  };
  const layered = new LayeredCellClassifier([
    new ManualCellClassifier(repository),
    overEagerClassifier,
  ]);
  const svc = new CellClassificationService(repository, layered);

  const result = await svc.filterCapturable([CELL_A, CELL_C], GRID);
  assert.deepEqual(result.capturable, [CELL_A], "the operator override wins");
  assert.deepEqual(result.blocked, [{ cellId: CELL_C, classification: "water" }]);
});

test("a layered classifier stops asking once every cell has an opinion", async () => {
  const repository = new InMemoryTerritoryRepository();
  await repository.setClassification(CELL_A, GRID, "park", "manual");

  let secondaryCalls = 0;
  const secondary: CellClassifier = {
    async classify(cellIds) {
      secondaryCalls += 1;
      return new Map(cellIds.map((id) => [id, "water" as CellClassification]));
    },
  };
  const layered = new LayeredCellClassifier([new ManualCellClassifier(repository), secondary]);

  await layered.classify([CELL_A], GRID);
  assert.equal(secondaryCalls, 0, "no need to ask once the manual layer answered");

  await layered.classify([CELL_A, CELL_B], GRID);
  assert.equal(secondaryCalls, 1);
});
