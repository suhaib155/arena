/**
 * Realtime territory broadcasting.
 *
 * The rule this file protects: a broadcast says a cell changed hands. It never
 * says where anybody is. A live feed of runner coordinates would be a stalking
 * tool, so the wire shape is asserted key-by-key rather than loosely spot-checked.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TerritoryBroadcaster,
  toBroadcastEvent,
  type SseSink,
} from "./realtime.js";
import type { ControlChange } from "./ownership.service.js";

const CELL = "892a1008943ffff";
const RUNNER = "0x1111111111111111111111111111111111111111";
const RIVAL = "0x2222222222222222222222222222222222222222";

function change(overrides: Partial<ControlChange> = {}): ControlChange {
  return {
    cellId: CELL,
    gridVersion: 2,
    previousOwner: null,
    nextOwner: RUNNER,
    previousState: "neutral",
    nextState: "owned",
    territoryVersion: 1,
    eventType: "captured",
    ...overrides,
  };
}

/** A recording sink standing in for an Express response. */
function sink(): SseSink & { frames: string[]; ended: boolean } {
  const frames: string[] = [];
  return {
    frames,
    ended: false,
    write(chunk: string) {
      frames.push(chunk);
      return true;
    },
    end() {
      (this as { ended: boolean }).ended = true;
    },
  };
}

// ------------------------------------------------------------- event shape

test("an ownership change becomes a named SSE event", () => {
  const event = toBroadcastEvent(change());
  assert.ok(event);
  assert.equal(event.event, "territoryCaptured");
  assert.equal(event.cellId, CELL);
  assert.equal(event.gridVersion, 2);
  assert.equal(event.nextState, "owned");
  assert.equal(event.version, 1);
});

test("every ownership event type maps to its broadcast name", () => {
  const expected: Record<string, string> = {
    captured: "territoryCaptured",
    reinforced: "territoryReinforced",
    attacked: "territoryAttacked",
    contested: "territoryContested",
    transferred: "territoryTransferred",
    released: "territoryReleased",
  };
  for (const [eventType, name] of Object.entries(expected)) {
    const event = toBroadcastEvent(change({ eventType: eventType as ControlChange["eventType"] }));
    assert.equal(event?.event, name, `${eventType} should broadcast as ${name}`);
  }
});

test("an unmappable event type is dropped rather than broadcast malformed", () => {
  assert.equal(toBroadcastEvent(change({ eventType: "expired" })), null);
});

test("broadcast owner references are truncated, like the HTTP views", () => {
  const event = toBroadcastEvent(change({ previousOwner: RIVAL, nextOwner: RUNNER }));
  assert.equal(event?.previousOwner, "0x2222…2222");
  assert.equal(event?.nextOwner, "0x1111…1111");
});

test("THE WIRE SHAPE CONTAINS NO LOCATION DETAIL", () => {
  const event = toBroadcastEvent(change());
  assert.ok(event);
  assert.deepEqual(
    Object.keys(event).sort(),
    ["at", "cellId", "event", "gridVersion", "nextOwner", "nextState", "previousOwner", "previousState", "version"],
  );
  const serialised = JSON.stringify(event);
  for (const forbidden of ["lat", "lng", "latitude", "longitude", "coord", "point", "route"]) {
    assert.ok(
      !serialised.toLowerCase().includes(forbidden),
      `broadcast contains "${forbidden}"`,
    );
  }
  assert.ok(!serialised.includes(RUNNER), "a full wallet address was broadcast");
});

// ------------------------------------------------------------ broadcasting

test("subscribers on the same grid receive events", () => {
  const broadcaster = new TerritoryBroadcaster();
  const a = sink();
  const b = sink();
  broadcaster.subscribe(a, 2);
  broadcaster.subscribe(b, 2);

  const delivered = broadcaster.broadcast(toBroadcastEvent(change())!);
  assert.equal(delivered, 2);
  assert.equal(a.frames.length, 1);
  assert.match(a.frames[0], /^event: territoryCaptured\ndata: \{/);
  assert.ok(a.frames[0].endsWith("\n\n"), "SSE frames must end with a blank line");
});

test("subscribers on a different grid version are not sent the event", () => {
  const broadcaster = new TerritoryBroadcaster();
  const legacy = sink();
  broadcaster.subscribe(legacy, 1);
  const delivered = broadcaster.broadcast(toBroadcastEvent(change({ gridVersion: 2 }))!);
  assert.equal(delivered, 0);
  assert.equal(legacy.frames.length, 0);
});

test("unsubscribing stops delivery", () => {
  const broadcaster = new TerritoryBroadcaster();
  const s = sink();
  const unsubscribe = broadcaster.subscribe(s, 2)!;
  unsubscribe();
  assert.equal(broadcaster.subscriberCount, 0);
  assert.equal(broadcaster.broadcast(toBroadcastEvent(change())!), 0);
});

test("a dead socket is dropped rather than retried forever", () => {
  const broadcaster = new TerritoryBroadcaster();
  const dead: SseSink = {
    write() {
      throw new Error("EPIPE");
    },
    end() {},
  };
  const alive = sink();
  broadcaster.subscribe(dead, 2);
  broadcaster.subscribe(alive, 2);

  const delivered = broadcaster.broadcast(toBroadcastEvent(change())!);
  assert.equal(delivered, 1);
  assert.equal(broadcaster.subscriberCount, 1, "the dead subscriber is removed");
});

test("the subscriber cap refuses honestly instead of accepting a dead connection", () => {
  const broadcaster = new TerritoryBroadcaster(2);
  assert.ok(broadcaster.subscribe(sink(), 2));
  assert.ok(broadcaster.subscribe(sink(), 2));
  assert.equal(broadcaster.subscribe(sink(), 2), null);
  assert.equal(broadcaster.subscriberCount, 2);
});

test("applied ownership changes broadcast in one call", () => {
  const broadcaster = new TerritoryBroadcaster();
  const s = sink();
  broadcaster.subscribe(s, 2);

  const delivered = broadcaster.broadcastChanges([
    change({ cellId: "892a1008943ffff" }),
    change({ cellId: "892a100894bffff", eventType: "transferred", previousOwner: RIVAL }),
    // Not an ownership change — dropped, not broadcast.
    change({ cellId: "892a100895bffff", eventType: "expired" }),
  ]);
  assert.equal(delivered, 2);
  assert.equal(s.frames.length, 2);
  assert.match(s.frames[1], /territoryTransferred/);
});

// --------------------------------------------------------------- lifecycle

test("heartbeats keep idle connections alive without carrying data", () => {
  const broadcaster = new TerritoryBroadcaster();
  const s = sink();
  broadcaster.subscribe(s, 2);
  broadcaster.heartbeat();
  assert.equal(s.frames[0], ": heartbeat\n\n");
});

test("closeAll ends every connection and clears the registry", () => {
  const broadcaster = new TerritoryBroadcaster();
  const s = sink();
  broadcaster.subscribe(s, 2);
  broadcaster.closeAll();
  assert.equal(broadcaster.subscriberCount, 0);
  assert.equal(s.ended, true);
});

// ------------------------------------------------------ stale-event guard

test("versions increase across changes, so a client can discard a stale event", () => {
  const first = toBroadcastEvent(change({ territoryVersion: 1 }))!;
  const second = toBroadcastEvent(change({ territoryVersion: 4, eventType: "transferred" }))!;
  assert.ok(second.version > first.version);
  // A client applying max-version-wins ends on the newer state.
  const applied = [second, first].reduce((held, event) =>
    event.version > held.version ? event : held,
  );
  assert.equal(applied.version, 4);
  assert.equal(applied.event, "territoryTransferred");
});
