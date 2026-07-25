/**
 * D3 regression — the map response limit falls on matched territories, never
 * on candidate H3 cells.
 *
 * The defect: the endpoint generated every cell in the viewport, capped that
 * *candidate* list at `maxMapFeatures`, and only then looked rows up. At the
 * maximum legal viewport that is ~9 800 candidates against a 2 000 cap, so a
 * genuinely owned cell sitting at candidate index 5 000 returned **zero
 * features** while `meta.truncated` said true — territory was invisible at
 * wide zoom.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { createTerritoryRouter } from "./router.js";
import { dedupeTerritories, sortTerritoriesForViewer } from "./views.js";
import { TERRITORY_DEFAULTS, type TerritoryConfig } from "../config.js";
import { InMemoryTerritoryRepository } from "../repository.js";
import { TerritoryOwnershipService } from "../ownership.service.js";
import { cellsInBoundingBox, TERRITORY_H3_RESOLUTION_V2 } from "../h3.js";
import { neutralTerritory } from "../rules.js";
import type { TerritoryRecord } from "../types.js";

const GRID = 2;
const RES = TERRITORY_H3_RESOLUTION_V2;
const RUNNER = "0x1111111111111111111111111111111111111111";
const RIVAL = "0x2222222222222222222222222222222222222222";

/** Build a session-shaped viewer (D2). Identity only ever comes from a verified
 *  session, so tests construct it directly rather than faking a header. */
function viewer(wallet: string | null, clubId: string | null) {
  return wallet
    ? { userId: `user-${wallet.slice(-4)}`, walletAddresses: [wallet.toLowerCase()], clubId, authenticated: true }
    : { userId: null, walletAddresses: [], clubId, authenticated: false };
}


/** The widest viewport the config allows, at the equator (most cells). */
const WIDE = (() => {
  const side = Math.sqrt(TERRITORY_DEFAULTS.maxMapViewportArea);
  return { west: 0, south: 0, east: side, north: side };
})();

interface Captured {
  status: number;
  body: any;
}

async function getMap(
  repository: InMemoryTerritoryRepository,
  bounds: { west: number; south: number; east: number; north: number },
  who: ReturnType<typeof viewer> = viewer(RUNNER, null),
  config: TerritoryConfig = TERRITORY_DEFAULTS,
): Promise<Captured> {
  const router = createTerritoryRouter({ repository, config, resolveViewer: () => who });
  const captured: Captured = { status: 200, body: undefined };
  const res = {
    status(c: number) { captured.status = c; return this; },
    json(b: unknown) { captured.body = b; return this; },
    setHeader() { return this; },
    write() { return true; },
    end() { return this; },
    flushHeaders() {},
  } as unknown as Response;
  const req = {
    method: "GET",
    url: "/territories/map",
    originalUrl: "/territories/map",
    query: {
      west: String(bounds.west),
      south: String(bounds.south),
      east: String(bounds.east),
      north: String(bounds.north),
    },
    params: {},
    headers: {},
    header() { return undefined; },
    on() { return this; },
  } as unknown as Request;

  await new Promise<void>((resolve) => {
    (router as any)(req, res, () => resolve());
    setImmediate(resolve);
  });
  await new Promise((resolve) => setImmediate(resolve));
  return captured;
}

function owned(cellId: string, wallet: string, extra: Partial<TerritoryRecord> = {}) {
  return {
    ...neutralTerritory(cellId, GRID, RES),
    ownerWalletAddress: wallet,
    state: "owned" as const,
    controlScore: 10,
    defenceScore: 10,
    version: 1,
    ...extra,
  };
}

// ------------------------------------------------------- the headline defect

test("D3: an owned cell beyond the old candidate cap is still visible", async () => {
  const candidates = cellsInBoundingBox(WIDE, RES);
  assert.ok(
    candidates.length > TERRITORY_DEFAULTS.maxMapFeatures,
    `the viewport must exceed the feature cap for this test to mean anything ` +
      `(${candidates.length} candidates vs ${TERRITORY_DEFAULTS.maxMapFeatures})`,
  );

  // Exactly the cell that used to disappear: far past the candidate cap.
  const beyondCap = candidates[5000];
  const repository = new InMemoryTerritoryRepository();
  await new TerritoryOwnershipService(repository).applyCapture({
    routeId: "route-1",
    walletAddress: RUNNER,
    gridVersion: GRID,
    resolution: RES,
    traversedHexIds: [beyondCap],
    capturedHexIds: [beyondCap],
  });

  const result = await getMap(repository, WIDE);
  assert.equal(result.status, 200);
  const ids = result.body.features.map((f: any) => f.properties.cellId);
  assert.ok(
    ids.includes(beyondCap),
    `owned cell at candidate index 5000 must be visible; got ${ids.length} features`,
  );
  assert.equal(result.body.features.length, 1);
});

test("D3: an owned cell at the very last candidate index is visible", async () => {
  const candidates = cellsInBoundingBox(WIDE, RES);
  const last = candidates[candidates.length - 1];
  const repository = new InMemoryTerritoryRepository();
  repository.seed(owned(last, RUNNER));

  const result = await getMap(repository, WIDE);
  assert.deepEqual(
    result.body.features.map((f: any) => f.properties.cellId),
    [last],
  );
});

test("D3: truncation metadata counts matched territories, not candidates", async () => {
  const candidates = cellsInBoundingBox(WIDE, RES);
  const repository = new InMemoryTerritoryRepository();
  for (let i = 0; i < 5; i++) repository.seed(owned(candidates[i * 900], RUNNER));

  const result = await getMap(repository, WIDE);
  assert.equal(result.body.meta.count, 5);
  assert.equal(
    result.body.meta.total,
    5,
    "total must be the number of matched territories, not the ~9800 candidates",
  );
  assert.equal(result.body.meta.truncated, false, "5 matches is nowhere near the cap");
});

test("D3: truncation is reported only when MATCHES exceed the cap", async () => {
  const smallCap: TerritoryConfig = { ...TERRITORY_DEFAULTS, maxMapFeatures: 3 };
  const candidates = cellsInBoundingBox(WIDE, RES);
  const repository = new InMemoryTerritoryRepository();
  for (let i = 0; i < 10; i++) repository.seed(owned(candidates[i], RUNNER));

  const result = await getMap(repository, WIDE, viewer(RUNNER, null), smallCap);
  assert.equal(result.body.features.length, 3);
  assert.equal(result.body.meta.count, 3);
  assert.equal(result.body.meta.total, 10, "total is the honest match count");
  assert.equal(result.body.meta.truncated, true);
});

test("D3: an empty viewport still returns an empty, non-truncated collection", async () => {
  const result = await getMap(new InMemoryTerritoryRepository(), WIDE);
  assert.deepEqual(result.body.features, []);
  assert.equal(result.body.meta.total, 0);
  assert.equal(result.body.meta.truncated, false);
});

test("D3: territory outside the viewport is not returned", async () => {
  const repository = new InMemoryTerritoryRepository();
  const inside = cellsInBoundingBox(WIDE, RES)[0];
  const elsewhere = cellsInBoundingBox(
    { west: -0.105, south: 51.495, east: -0.095, north: 51.505 },
    RES,
  )[0];
  repository.seed(owned(inside, RUNNER));
  repository.seed(owned(elsewhere, RUNNER));

  const result = await getMap(repository, WIDE);
  assert.deepEqual(
    result.body.features.map((f: any) => f.properties.cellId),
    [inside],
  );
});

// ------------------------------------------------------- deterministic order

test("D3: results are ordered mine, club, contested, rival, then neutral", async () => {
  const candidates = cellsInBoundingBox(WIDE, RES);
  const repository = new InMemoryTerritoryRepository();
  const [c0, c1, c2, c3, c4] = candidates;

  repository.seed(owned(c0, RIVAL));
  repository.seed(owned(c1, RUNNER));
  repository.seed(owned(c2, RIVAL, { ownerClubId: "club-a" }));
  repository.seed(owned(c3, RIVAL, { state: "contested" }));
  repository.seed({ ...neutralTerritory(c4, GRID, RES), version: 1 });

  const result = await getMap(repository, WIDE, viewer(RUNNER, "club-a"));
  assert.deepEqual(
    result.body.features.map((f: any) => f.properties.relationship),
    ["mine", "club", "contested", "rival", "neutral"],
  );
});

test("D3: ordering is stable across repeated identical requests", async () => {
  const candidates = cellsInBoundingBox(WIDE, RES);
  const repository = new InMemoryTerritoryRepository();
  for (let i = 0; i < 20; i++) repository.seed(owned(candidates[i * 17], RIVAL));

  const first = await getMap(repository, WIDE);
  const second = await getMap(repository, WIDE);
  assert.deepEqual(
    first.body.features.map((f: any) => f.properties.cellId),
    second.body.features.map((f: any) => f.properties.cellId),
    "the same viewport must return the same features in the same order",
  );
});

test("D3: truncation keeps the runner's own territory, dropping rivals first", async () => {
  const smallCap: TerritoryConfig = { ...TERRITORY_DEFAULTS, maxMapFeatures: 2 };
  const candidates = cellsInBoundingBox(WIDE, RES);
  const repository = new InMemoryTerritoryRepository();
  // Rivals first in candidate order, so only priority ordering can save `mine`.
  for (let i = 0; i < 8; i++) repository.seed(owned(candidates[i], RIVAL));
  const mine = candidates[50];
  repository.seed(owned(mine, RUNNER));

  const result = await getMap(repository, WIDE, viewer(RUNNER, null), smallCap);
  const ids = result.body.features.map((f: any) => f.properties.cellId);
  assert.ok(ids.includes(mine), "the runner's own cell must survive truncation");
  assert.equal(result.body.features[0].properties.relationship, "mine");
});

// ----------------------------------------------------------- pure sort helper

test("D3: sortTerritoriesForViewer never mutates its input", () => {
  const input = [owned("892a1008943ffff", RIVAL), owned("892a100894bffff", RUNNER)];
  const before = input.map((t) => t.h3CellId);
  sortTerritoriesForViewer(input, viewer(RUNNER, null));
  assert.deepEqual(input.map((t) => t.h3CellId), before);
});

test("D3: sorting is viewer-relative — the same rows order differently", () => {
  const a = owned("892a1008943ffff", RIVAL);
  const b = owned("892a100894bffff", RUNNER);
  const forRunner = sortTerritoriesForViewer([a, b], viewer(RUNNER, null));
  const forRival = sortTerritoriesForViewer([a, b], viewer(RIVAL, null));
  assert.equal(forRunner[0].h3CellId, b.h3CellId);
  assert.equal(forRival[0].h3CellId, a.h3CellId);
});

test("D3: duplicate cell ids collapse to one feature", () => {
  const duplicated = [owned("892a1008943ffff", RUNNER), owned("892a1008943ffff", RUNNER)];
  assert.equal(dedupeTerritories(duplicated).length, 1);
});

// ------------------------------------------------- repository-level behaviour

test("D3: findPersistedCells returns only rows that exist, never neutral defaults", async () => {
  const repository = new InMemoryTerritoryRepository();
  const candidates = cellsInBoundingBox(WIDE, RES).slice(0, 500);
  repository.seed(owned(candidates[400], RUNNER));

  const persisted = await repository.findPersistedCells(candidates, GRID);
  assert.equal(persisted.length, 1, "untouched cells must not be fabricated");
  assert.equal(persisted[0].h3CellId, candidates[400]);

  // findCells, by contrast, fills in defaults — that is why the map endpoint
  // must not use it for this.
  const withDefaults = await repository.findCells(candidates.slice(0, 3), GRID, RES);
  assert.equal(withDefaults.size, 3);
});

test("D3: findPersistedCells is scoped to the grid version", async () => {
  const repository = new InMemoryTerritoryRepository();
  const cell = cellsInBoundingBox(WIDE, RES)[0];
  repository.seed({ ...owned(cell, RUNNER), gridVersion: 1, h3Resolution: 8 });

  assert.equal((await repository.findPersistedCells([cell], 2)).length, 0);
  assert.equal((await repository.findPersistedCells([cell], 1)).length, 1);
});

test("D3: findPersistedCells handles an empty candidate list", async () => {
  const repository = new InMemoryTerritoryRepository();
  assert.deepEqual(await repository.findPersistedCells([], GRID), []);
});
