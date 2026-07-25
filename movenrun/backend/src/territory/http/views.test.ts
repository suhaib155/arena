/**
 * Territory API response shaping — the privacy boundary.
 *
 * The headline test here walks every response shape looking for anything that
 * could reconstruct where a person ran: coordinate keys, route ids, evidence
 * hashes, full wallet addresses. Territory geometry is an H3 cell boundary,
 * which is derived from a cell id and is identical for every viewer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeCaptureRequirements,
  toDetailResponse,
  toMapFeature,
  toMapResponse,
  toOwnerSummary,
  toPublicEvent,
} from "./views.js";
import { TERRITORY_DEFAULTS } from "../config.js";
import { neutralTerritory } from "../rules.js";
import { latLngToCell, TERRITORY_H3_RESOLUTION_V2 } from "../h3.js";
import type { TerritoryOwnershipEvent, TerritoryRecord } from "../types.js";

const CELL = latLngToCell(51.5, -0.1, TERRITORY_H3_RESOLUTION_V2)!;
const RUNNER = "0x1111111111111111111111111111111111111111";
const RIVAL = "0x2222222222222222222222222222222222222222";

/** Build a session-shaped viewer (D2). Identity only ever comes from a verified
 *  session, so tests construct it directly rather than faking a header. */
function viewer(wallet: string | null, clubId: string | null) {
  return wallet
    ? { userId: `user-${wallet.slice(-4)}`, walletAddresses: [wallet.toLowerCase()], clubId, authenticated: true }
    : { userId: null, walletAddresses: [], clubId, authenticated: false };
}


function owned(wallet: string, overrides: Partial<TerritoryRecord> = {}): TerritoryRecord {
  return {
    ...neutralTerritory(CELL, 2, TERRITORY_H3_RESOLUTION_V2),
    ownerWalletAddress: wallet,
    ownerUserId: "user-1",
    state: "owned",
    controlScore: 30,
    defenceScore: 40,
    capturedAt: new Date("2026-05-01T10:00:00Z"),
    version: 3,
    ...overrides,
  };
}

function event(overrides: Partial<TerritoryOwnershipEvent> = {}): TerritoryOwnershipEvent {
  return {
    id: "evt-1",
    h3CellId: CELL,
    gridVersion: 2,
    routeId: "route-private-abc123",
    actorUserId: "user-1",
    actorWalletAddress: RUNNER,
    eventType: "captured",
    previousOwner: null,
    nextOwner: RUNNER,
    previousState: "neutral",
    nextState: "owned",
    controlDelta: 10,
    defenceDelta: 10,
    evidenceHash: "0xsecretroutehash",
    createdAt: new Date("2026-05-01T10:00:00Z"),
    ...overrides,
  };
}

/** Recursively collect every key and string value in a response object. */
function flatten(value: unknown, keys: string[] = [], values: string[] = []) {
  if (Array.isArray(value)) {
    for (const item of value) flatten(item, keys, values);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key);
      flatten(child, keys, values);
    }
  } else if (typeof value === "string") {
    values.push(value);
  }
  return { keys, values };
}

// --------------------------------------------------------------- owner view

test("owner addresses are truncated, never published in full", () => {
  const summary = toOwnerSummary(owned(RUNNER));
  assert.ok(summary);
  assert.equal(summary.displayAddress, "0x1111…1111");
  assert.notEqual(summary.displayAddress, RUNNER);
});

test("an unowned cell has no owner summary", () => {
  assert.equal(toOwnerSummary(neutralTerritory(CELL, 2, 9)), null);
});

// ---------------------------------------------------------------- map view

test("a map feature carries safe properties and a cell-derived polygon", () => {
  const feature = toMapFeature(owned(RUNNER), viewer(RUNNER, null));
  assert.equal(feature.geometry.type, "Polygon");
  assert.equal(feature.properties.cellId, CELL);
  assert.equal(feature.properties.relationship, "mine");
  assert.equal(feature.properties.controlScore, 30);
  assert.equal(feature.properties.defenceScore, 40);
  assert.equal(feature.properties.gridVersion, 2);
  assert.equal(feature.properties.resolution, 9);
  assert.equal(feature.properties.capturedAt, "2026-05-01T10:00:00.000Z");
});

test("the same cell is labelled per viewer without changing its data", () => {
  const territory = owned(RUNNER);
  const mine = toMapFeature(territory, viewer(RUNNER, null));
  const theirs = toMapFeature(territory, viewer(RIVAL, null));
  assert.equal(mine.properties.relationship, "mine");
  assert.equal(theirs.properties.relationship, "rival");
  assert.deepEqual(mine.geometry, theirs.geometry, "geometry must not vary by viewer");
  assert.equal(mine.properties.controlScore, theirs.properties.controlScore);
});

test("D2: an anonymous viewer sees owned cells as `claimed`, never `rival` or `mine`", () => {
  // `rival` asserts the cell belongs to somebody other than the viewer, which
  // is not knowable without an identity. Asserting it anyway is what made a
  // runner's own territory render in rival colours.
  const feature = toMapFeature(owned(RUNNER), viewer(null, null));
  assert.equal(feature.properties.relationship, "claimed");
});

test("the map response reports truncation honestly", () => {
  const response = toMapResponse([owned(RUNNER)], viewer(RUNNER, null), {
    gridVersion: 2,
    resolution: 9,
    total: 5000,
    truncated: true,
  });
  assert.equal(response.type, "FeatureCollection");
  assert.equal(response.meta.count, 1);
  assert.equal(response.meta.total, 5000);
  assert.equal(response.meta.truncated, true);
  assert.ok(response.meta.generatedAt);
});

// ------------------------------------------------------------- detail view

test("detail carries neighbours, actions and requirements", () => {
  const neighbour = { ...neutralTerritory("892a100894bffff", 2, 9) };
  const response = toDetailResponse(
    owned(RIVAL),
    [neighbour],
    [event()],
    viewer(RUNNER, null),
    describeCaptureRequirements(TERRITORY_DEFAULTS),
  );
  assert.equal(response.relationship, "rival");
  assert.deepEqual(response.actions, {
    canCapture: false,
    canReinforce: false,
    canAttack: true,
  });
  assert.equal(response.neighbours.length, 1);
  assert.equal(response.neighbours[0].relationship, "neutral");
  assert.ok(response.captureRequirements.length >= 4);
  assert.equal(response.geometry.type, "Polygon");
});

test("capture requirements read as plain language derived from configuration", () => {
  const requirements = describeCaptureRequirements(TERRITORY_DEFAULTS);
  assert.ok(requirements.some((r) => r.includes("50 m")), "closure tolerance");
  assert.ok(requirements.some((r) => r.includes("800 m")), "minimum distance");
  assert.ok(requirements.some((r) => r.includes("5 minutes")), "minimum duration");
});

// ------------------------------------------------------------ history view

test("public history strips route ids and evidence hashes", () => {
  const publicEvent = toPublicEvent(event());
  assert.deepEqual(Object.keys(publicEvent).sort(), [
    "actor",
    "at",
    "eventType",
    "nextState",
    "previousState",
  ]);
  assert.equal(publicEvent.actor, "0x1111…1111");
  assert.equal(publicEvent.eventType, "captured");
});

// ------------------------------------------------------- the privacy sweep

test("NO response shape leaks GPS, a route id, an evidence hash or a full address", () => {
  const responses = [
    toMapResponse([owned(RUNNER)], viewer(RIVAL, null), {
      gridVersion: 2,
      resolution: 9,
      total: 1,
      truncated: false,
    }),
    toDetailResponse(
      owned(RUNNER),
      [neutralTerritory("892a100894bffff", 2, 9)],
      [event()],
      viewer(RIVAL, null),
      describeCaptureRequirements(TERRITORY_DEFAULTS),
    ),
    { events: [toPublicEvent(event())] },
  ];

  const forbiddenKeys = [
    "lat",
    "lng",
    "latitude",
    "longitude",
    "points",
    "path",
    "polyline",
    "routeId",
    "evidenceHash",
    "ownerWalletAddress",
    "actorWalletAddress",
    "actorUserId",
    "ownerUserId",
  ];

  for (const response of responses) {
    const { keys, values } = flatten(response);
    for (const forbidden of forbiddenKeys) {
      assert.ok(!keys.includes(forbidden), `response exposes "${forbidden}"`);
    }
    for (const value of values) {
      assert.ok(!value.includes(RUNNER), "a full wallet address leaked");
      assert.ok(!value.includes(RIVAL), "a full wallet address leaked");
      assert.ok(!value.includes("route-private-abc123"), "a route id leaked");
      assert.ok(!value.includes("0xsecretroutehash"), "an evidence hash leaked");
    }
  }
});

test("cell geometry is derived from the cell id alone — identical for everyone", () => {
  const a = toMapFeature(owned(RUNNER), viewer(RUNNER, null));
  const b = toMapFeature(owned(RIVAL), viewer(null, null));
  assert.deepEqual(a.geometry, b.geometry);
  // And the polygon is the H3 cell itself, not anything route-shaped. A cell
  // has 6 corners, or a few more where it straddles an icosahedron face
  // boundary, plus the repeated closing position.
  const ring = a.geometry.coordinates[0];
  assert.ok(ring.length >= 7 && ring.length <= 11, `unexpected ring size ${ring.length}`);
  assert.deepEqual(ring[ring.length - 1], ring[0], "ring must be closed");
});
