/**
 * Viewport-driven territory loading and realtime reconciliation.
 *
 * The two tests that carry the most weight:
 *  - a slow response for an old viewport must never overwrite a fast response
 *    for the current one;
 *  - a stale or duplicated realtime event must never roll a cell back.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyError,
  applyResponse,
  beginLoading,
  cellsToFeatureCollection,
  INITIAL_VIEW_STATE,
  RequestSequence,
  shouldRefetch,
  ViewportCache,
  viewportKey,
  VIEWPORT_RULES,
  type TerritoryCell,
  type Viewport,
} from "../territory/viewport";
import {
  needsFullReconcile,
  parseTerritoryEvent,
  reconcileEvent,
  reconcileEvents,
  reconnectDelayMs,
  relationshipFromEvent,
  type TerritoryEvent,
} from "../territory/realtimeReconcile";

const VIEWPORT: Viewport = { west: -0.11, south: 51.49, east: -0.09, north: 51.51, zoom: 15 };

function cell(overrides: Partial<TerritoryCell> = {}): TerritoryCell {
  return {
    cellId: "892a1008943ffff",
    state: "owned",
    relationship: "rival",
    controlScore: 10,
    defenceScore: 20,
    gridVersion: 2,
    version: 1,
    coordinates: [[[-0.1, 51.5], [-0.099, 51.5], [-0.099, 51.501], [-0.1, 51.5]]],
    ...overrides,
  };
}

function event(overrides: Partial<TerritoryEvent> = {}): TerritoryEvent {
  return {
    event: "territoryCaptured",
    cellId: "892a1008943ffff",
    gridVersion: 2,
    previousState: "neutral",
    nextState: "owned",
    previousOwner: null,
    nextOwner: "0x1111…1111",
    version: 2,
    at: "2026-05-01T10:00:00.000Z",
    ...overrides,
  };
}

// ------------------------------------------------------------ refetch rules

test("the first viewport always fetches", () => {
  assert.equal(shouldRefetch(null, VIEWPORT), true);
});

test("a tiny camera drift does not refetch", () => {
  const nudged = { ...VIEWPORT, west: VIEWPORT.west + 0.0001, east: VIEWPORT.east + 0.0001 };
  assert.equal(shouldRefetch(VIEWPORT, nudged), false);
});

test("a pan beyond the movement threshold refetches", () => {
  const width = VIEWPORT.east - VIEWPORT.west;
  const panned = {
    ...VIEWPORT,
    west: VIEWPORT.west + width * 0.5,
    east: VIEWPORT.east + width * 0.5,
  };
  assert.equal(shouldRefetch(VIEWPORT, panned), true);
});

test("a meaningful zoom change refetches even without panning", () => {
  assert.equal(shouldRefetch(VIEWPORT, { ...VIEWPORT, zoom: 15.2 }), false);
  assert.equal(shouldRefetch(VIEWPORT, { ...VIEWPORT, zoom: 17 }), true);
});

test("the debounce interval is long enough to swallow a pan gesture", () => {
  assert.ok(VIEWPORT_RULES.debounceMs >= 250);
});

// ------------------------------------------------------------------- cache

test("a cached region is returned without a refetch", () => {
  const cache = new ViewportCache();
  cache.set(VIEWPORT, [cell()], 1000);
  assert.deepEqual(cache.get(VIEWPORT, 1500)?.length, 1);
});

test("a cached region expires after its TTL", () => {
  const cache = new ViewportCache();
  cache.set(VIEWPORT, [cell()], 1000);
  assert.equal(cache.get(VIEWPORT, 1000 + VIEWPORT_RULES.cacheTtlMs + 1), null);
});

test("near-identical viewports share one cache key", () => {
  const a = viewportKey(VIEWPORT);
  const b = viewportKey({ ...VIEWPORT, west: VIEWPORT.west + 0.000001 });
  assert.equal(a, b);
});

test("the cache is bounded and evicts the oldest entry", () => {
  const cache = new ViewportCache();
  for (let i = 0; i < VIEWPORT_RULES.maxCachedRegions + 5; i++) {
    cache.set({ ...VIEWPORT, west: -1 - i, east: -0.5 - i }, [cell()], 1000);
  }
  assert.equal(cache.size, VIEWPORT_RULES.maxCachedRegions);
});

test("re-reading a cached region keeps it alive against eviction", () => {
  const cache = new ViewportCache();
  const first = { ...VIEWPORT, west: -5, east: -4.5 };
  cache.set(first, [cell()], 1000);
  // Touch it again so it moves to the back of the eviction queue.
  cache.set(first, [cell()], 1100);
  for (let i = 0; i < VIEWPORT_RULES.maxCachedRegions - 1; i++) {
    cache.set({ ...VIEWPORT, west: -1 - i, east: -0.5 - i }, [cell()], 1200);
  }
  assert.ok(cache.get(first, 1300), "the recently-used region should survive");
});

// ------------------------------------------------------------ stale requests

test("A SLOW RESPONSE FOR AN OLD VIEWPORT IS IGNORED", () => {
  const sequence = new RequestSequence();
  const slowToken = sequence.begin(); // the user panned…
  const fastToken = sequence.begin(); // …and panned again before the first replied

  assert.equal(sequence.isCurrent(slowToken), false, "the superseded request must be ignored");
  assert.equal(sequence.isCurrent(fastToken), true);
});

test("cancelAll invalidates every request in flight", () => {
  const sequence = new RequestSequence();
  const token = sequence.begin();
  sequence.cancelAll();
  assert.equal(sequence.isCurrent(token), false);
});

// ------------------------------------------------------------- view state

test("loading never blanks the map", () => {
  const loaded = applyResponse(INITIAL_VIEW_STATE, [cell()]);
  const refreshing = beginLoading(loaded);
  assert.equal(refreshing.loading, true);
  assert.equal(refreshing.cells.length, 1, "previously loaded territory stays visible");
});

test("an error keeps previously loaded territory on screen", () => {
  const loaded = applyResponse(INITIAL_VIEW_STATE, [cell()]);
  const failed = applyError(beginLoading(loaded), "offline");
  assert.equal(failed.error, "offline");
  assert.equal(failed.loading, false);
  assert.equal(failed.cells.length, 1);
});

test("an empty response is reported as empty, not as an error", () => {
  const state = applyResponse(INITIAL_VIEW_STATE, []);
  assert.equal(state.empty, true);
  assert.equal(state.error, null);
});

test("a response never rolls back a newer version already held", () => {
  // A realtime event bumped the cell to version 5 while a fetch was in flight.
  const held = applyResponse(INITIAL_VIEW_STATE, [cell({ version: 5, state: "contested" })]);
  const stale = applyResponse(held, [cell({ version: 2, state: "owned" })]);
  assert.equal(stale.cells[0].version, 5);
  assert.equal(stale.cells[0].state, "contested");
});

test("a response with an equal version is applied, so a refetch can correct drift", () => {
  const held = applyResponse(INITIAL_VIEW_STATE, [cell({ version: 3, state: "owned" })]);
  const same = applyResponse(held, [cell({ version: 3, state: "contested" })]);
  assert.equal(same.cells[0].state, "contested");
});

test("cells become a valid GeoJSON FeatureCollection for the map source", () => {
  const collection = cellsToFeatureCollection([cell()]);
  assert.equal(collection.type, "FeatureCollection");
  assert.equal(collection.features[0].geometry.type, "Polygon");
  assert.equal(collection.features[0].properties.relationship, "rival");
  assert.equal(collection.features[0].id, "892a1008943ffff");
});

// --------------------------------------------------------- event parsing

test("a well-formed event parses", () => {
  const parsed = parseTerritoryEvent(event());
  assert.ok(parsed);
  assert.equal(parsed.event, "territoryCaptured");
  assert.equal(parsed.version, 2);
});

test("malformed frames are dropped rather than crashing the stream", () => {
  for (const bad of [
    null,
    undefined,
    "not an object",
    {},
    { event: "somethingElse", cellId: "a", version: 1, nextState: "owned", gridVersion: 2 },
    { event: "territoryCaptured", cellId: "", version: 1, nextState: "owned", gridVersion: 2 },
    { event: "territoryCaptured", cellId: "a", version: "one", nextState: "owned", gridVersion: 2 },
    { event: "territoryCaptured", cellId: "a", version: 1, gridVersion: 2 },
  ]) {
    assert.equal(parseTerritoryEvent(bad), null, `${JSON.stringify(bad)} should not parse`);
  }
});

// ------------------------------------------------------ event reconciliation

test("a newer event updates the cell", () => {
  const result = reconcileEvent([cell({ version: 1 })], event({ version: 2 }), {
    viewerDisplayAddress: null,
    gridVersion: 2,
  });
  assert.equal(result.changed, true);
  assert.equal(result.cells[0].version, 2);
  assert.equal(result.cells[0].state, "owned");
});

test("A STALE EVENT NEVER ROLLS A CELL BACK", () => {
  const current = [cell({ version: 7, state: "contested", relationship: "contested" })];
  const result = reconcileEvent(current, event({ version: 3, nextState: "owned" }), {
    viewerDisplayAddress: null,
    gridVersion: 2,
  });
  assert.equal(result.changed, false);
  assert.equal(result.ignoredReason, "staleVersion");
  assert.equal(result.cells[0].state, "contested");
});

test("a duplicated event is applied only once", () => {
  const start = [cell({ version: 1 })];
  const duplicate = event({ version: 2 });
  const { cells, applied } = reconcileEvents(start, [duplicate, duplicate, duplicate], {
    viewerDisplayAddress: null,
    gridVersion: 2,
  });
  assert.equal(applied, 1);
  assert.equal(cells[0].version, 2);
});

test("an event for an unloaded cell is dropped, not inserted without geometry", () => {
  const result = reconcileEvent([cell()], event({ cellId: "892a100894bffff", version: 9 }), {
    viewerDisplayAddress: null,
    gridVersion: 2,
  });
  assert.equal(result.changed, false);
  assert.equal(result.ignoredReason, "unknownCell");
  assert.equal(result.cells.length, 1);
});

test("an event for another grid version is ignored", () => {
  const result = reconcileEvent([cell()], event({ gridVersion: 1, version: 99 }), {
    viewerDisplayAddress: null,
    gridVersion: 2,
  });
  assert.equal(result.changed, false);
  assert.equal(result.ignoredReason, "wrongGrid");
});

test("out-of-order events settle on the newest state", () => {
  const start = [cell({ version: 1 })];
  const { cells } = reconcileEvents(
    start,
    [
      event({ version: 5, nextState: "contested", event: "territoryContested" }),
      event({ version: 3, nextState: "owned" }),
      event({ version: 2, nextState: "owned" }),
    ],
    { viewerDisplayAddress: null, gridVersion: 2 },
  );
  assert.equal(cells[0].version, 5);
  assert.equal(cells[0].state, "contested");
});

// -------------------------------------------------------- relationship map

test("relationship is derived from the event against the viewer", () => {
  assert.equal(relationshipFromEvent(event(), "0x1111…1111"), "mine");
  assert.equal(relationshipFromEvent(event(), "0x2222…2222"), "rival");
  // D2: an anonymous viewer gets `claimed`, never `rival` — a live event must
  // not flip a runner's own cell into rival colours just because the client
  // has no identity to compare against.
  assert.equal(relationshipFromEvent(event(), null), "claimed");
  assert.equal(
    relationshipFromEvent(event({ nextState: "contested" }), "0x1111…1111"),
    "contested",
  );
  assert.equal(
    relationshipFromEvent(event({ nextState: "neutral", nextOwner: null }), "0x1111…1111"),
    "neutral",
  );
});

// ------------------------------------------------------------- reconnection

test("reconnect backoff grows and is capped", () => {
  const noJitter = () => 0.5;
  assert.equal(reconnectDelayMs(0, noJitter), 1000);
  assert.equal(reconnectDelayMs(1, noJitter), 2000);
  assert.equal(reconnectDelayMs(3, noJitter), 8000);
  assert.equal(reconnectDelayMs(20, noJitter), 30_000, "capped");
});

test("reconnect backoff is jittered so clients do not stampede", () => {
  const low = reconnectDelayMs(4, () => 0);
  const high = reconnectDelayMs(4, () => 1);
  assert.notEqual(low, high);
  assert.ok(low >= 1000);
});

test("a full reconcile is due when realtime has been the only source for too long", () => {
  assert.equal(needsFullReconcile(null), true);
  assert.equal(needsFullReconcile(1000, 1000 + 60_000), false);
  assert.equal(needsFullReconcile(1000, 1000 + 200_000), true);
});
