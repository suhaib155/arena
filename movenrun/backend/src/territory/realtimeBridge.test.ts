/**
 * D1 regression — realtime must cross process boundaries.
 *
 * The defect: `TerritoryBroadcaster` keeps its subscribers in a `Map` in one
 * process, and the BullMQ worker that applies a capture runs in a *different*
 * process from the API that holds the SSE connections. So the worker's
 * `broadcastChanges(...)` fanned out to zero subscribers, always. Realtime
 * appeared to work in a single-process dev run and delivered nothing in the
 * deployed topology.
 *
 * These are the offline tests: a fake Redis, so the envelope format, the
 * privacy guarantee, the rollback ordering and the connection accounting are
 * all verifiable without a server. `realtimeBridge.redis.test.ts` runs the same
 * hop across two real ioredis connections.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TERRITORY_CHANNEL,
  TERRITORY_ENVELOPE_VERSION,
  assertNoLocationData,
  bridgeAppliedCapture,
  findLocationData,
  parseEnvelope,
  publishChanges,
  startHeartbeat,
  subscribeToTerritoryChannel,
  type RedisPublisher,
  type RedisSubscriber,
} from "./realtimeBridge.js";
import { TerritoryBroadcaster, type SseSink } from "./realtime.js";
import type { ControlChange } from "./ownership.service.js";

const CELL = "892a1008907ffff";

function change(overrides: Partial<ControlChange> = {}): ControlChange {
  return {
    cellId: CELL,
    gridVersion: 2,
    eventType: "captured",
    previousState: "neutral",
    nextState: "owned",
    previousOwner: null,
    nextOwner: "0x1111111111111111111111111111111111111111",
    controlDelta: 10,
    defenceDelta: 10,
    territoryVersion: 1,
    ...overrides,
  } as ControlChange;
}

/** A Redis stand-in that carries messages from publishers to subscribers. */
function fakeRedis() {
  const listeners = new Map<RedisSubscriber, ((c: string, m: string) => void)[]>();
  const subscribed = new Set<RedisSubscriber>();
  const published: string[] = [];

  function newSubscriber(): RedisSubscriber {
    const sub: RedisSubscriber = {
      async subscribe() {
        subscribed.add(sub);
      },
      async unsubscribe() {
        subscribed.delete(sub);
      },
      on(_event, listener) {
        listeners.set(sub, [...(listeners.get(sub) ?? []), listener]);
      },
      off(_event, listener) {
        listeners.set(sub, (listeners.get(sub) ?? []).filter((l) => l !== listener));
      },
    };
    return sub;
  }

  const publisher: RedisPublisher = {
    async publish(channel, message) {
      published.push(message);
      for (const sub of subscribed) {
        for (const listener of listeners.get(sub) ?? []) listener(channel, message);
      }
      return subscribed.size;
    },
  };

  return { publisher, newSubscriber, published };
}

/** A sink that records what was written to it. */
function recordingSink(): SseSink & { frames: string[] } {
  const frames: string[] = [];
  return {
    frames,
    write(chunk: string) {
      frames.push(chunk);
      return true;
    },
    end() {},
  };
}

// ------------------------------------------------------ the headline defect

test("D1: a change published by one process reaches a subscriber in another", async () => {
  const redis = fakeRedis();

  // The API process: its own broadcaster, its own SSE subscriber.
  const apiBroadcaster = new TerritoryBroadcaster();
  const sink = recordingSink();
  apiBroadcaster.subscribe(sink, 2, { clientKey: "user-1" });
  const subscription = await subscribeToTerritoryChannel(redis.newSubscriber(), apiBroadcaster);

  // The worker process: it holds no subscribers at all, which is the whole
  // point — before this fix it broadcast into its own empty map.
  const workerBroadcaster = new TerritoryBroadcaster();
  assert.equal(workerBroadcaster.subscriberCount, 0);
  const result = await publishChanges(redis.publisher, [change()]);

  assert.equal(result.published, 1);
  assert.equal(subscription.stats.received, 1);
  assert.equal(subscription.stats.delivered, 1);
  assert.equal(sink.frames.length, 1);
  assert.match(sink.frames[0], /^event: territoryCaptured\n/);
  assert.match(sink.frames[0], new RegExp(`"cellId":"${CELL}"`));
  await subscription.close();
});

test("D1: every API replica receives the same change", async () => {
  const redis = fakeRedis();
  const sinks = [recordingSink(), recordingSink(), recordingSink()];
  const subscriptions = [];
  for (const [i, sink] of sinks.entries()) {
    const broadcaster = new TerritoryBroadcaster();
    broadcaster.subscribe(sink, 2, { clientKey: `user-${i}` });
    subscriptions.push(await subscribeToTerritoryChannel(redis.newSubscriber(), broadcaster));
  }

  await publishChanges(redis.publisher, [change()]);
  for (const sink of sinks) assert.equal(sink.frames.length, 1);
  for (const subscription of subscriptions) await subscription.close();
});

test("D1: a closed subscription stops receiving", async () => {
  const redis = fakeRedis();
  const broadcaster = new TerritoryBroadcaster();
  const sink = recordingSink();
  broadcaster.subscribe(sink, 2, { clientKey: "user-1" });
  const subscription = await subscribeToTerritoryChannel(redis.newSubscriber(), broadcaster);

  await publishChanges(redis.publisher, [change()]);
  await subscription.close();
  await publishChanges(redis.publisher, [change({ territoryVersion: 2 })]);

  assert.equal(sink.frames.length, 1, "a closed subscription must not keep delivering");
});

// ------------------------------------------------- versioning and hardening

test("D1: messages carry a versioned envelope", async () => {
  const redis = fakeRedis();
  await publishChanges(redis.publisher, [change()]);
  const envelope = JSON.parse(redis.published[0]);
  assert.equal(envelope.v, TERRITORY_ENVELOPE_VERSION);
  assert.equal(envelope.event.cellId, CELL);
  assert.equal(envelope.event.version, 1);
});

test("D1: an envelope from an unknown version is ignored, not delivered", async () => {
  const parsed = parseEnvelope(JSON.stringify({ v: 99, event: { cellId: CELL } }));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.ok === false && parsed.reason, "unknownVersion");
});

test("D1: malformed traffic on the channel is dropped and counted, never thrown", async () => {
  const redis = fakeRedis();
  const broadcaster = new TerritoryBroadcaster();
  const sink = recordingSink();
  broadcaster.subscribe(sink, 2, { clientKey: "user-1" });
  const reasons: string[] = [];
  const subscription = await subscribeToTerritoryChannel(redis.newSubscriber(), broadcaster, {
    onDropped: (reason) => reasons.push(reason),
  });

  for (const junk of [
    "not json at all",
    "[]",
    JSON.stringify({ v: 1 }),
    JSON.stringify({ v: 1, event: { cellId: 42 } }),
    JSON.stringify({ v: 2, event: { cellId: CELL, gridVersion: 2, nextState: "owned", version: 1, at: "x", event: "territoryCaptured" } }),
  ]) {
    await redis.publisher.publish(TERRITORY_CHANNEL, junk);
  }

  assert.equal(sink.frames.length, 0, "nothing malformed may reach a client");
  assert.equal(subscription.stats.dropped, 5);
  assert.deepEqual(reasons, [
    "unparseable",
    "notAnObject",
    "malformedEvent",
    "malformedEvent",
    "unknownVersion",
  ]);
  await subscription.close();
});

test("D1: the broadcaster still filters by grid version across the hop", async () => {
  const redis = fakeRedis();
  const broadcaster = new TerritoryBroadcaster();
  const v2 = recordingSink();
  const v1 = recordingSink();
  broadcaster.subscribe(v2, 2, { clientKey: "a" });
  broadcaster.subscribe(v1, 1, { clientKey: "b" });
  const subscription = await subscribeToTerritoryChannel(redis.newSubscriber(), broadcaster);

  await publishChanges(redis.publisher, [change({ gridVersion: 2 })]);
  assert.equal(v2.frames.length, 1);
  assert.equal(v1.frames.length, 0, "a v1 subscriber must not see v2 territory");
  await subscription.close();
});

// -------------------------------------------------------------- no GPS. ever.

test("D1: the published payload carries no coordinate of any kind", async () => {
  const redis = fakeRedis();
  await publishChanges(redis.publisher, [change()]);
  const envelope = JSON.parse(redis.published[0]);
  assert.equal(findLocationData(envelope), null);
  // And explicitly, the exact keys a runner's privacy depends on.
  const serialised = redis.published[0];
  for (const forbidden of ["lat", "lng", "coordinates", "points", "routeId", "evidenceHash"]) {
    assert.ok(!serialised.includes(`"${forbidden}"`), `payload leaked "${forbidden}"`);
  }
});

test("D1: publishing a payload with location data throws rather than leaking it", () => {
  assert.throws(
    () => assertNoLocationData({ cellId: CELL, points: [{ lat: 51.5, lng: -0.1 }] }),
    /location data/,
  );
  assert.throws(() => assertNoLocationData({ nested: { deep: { latitude: 51.5 } } }), /latitude/);
  assert.equal(findLocationData({ cellId: CELL, version: 1 }), null);
});

test("D1: a received payload carrying location data is dropped, not forwarded", async () => {
  const redis = fakeRedis();
  const broadcaster = new TerritoryBroadcaster();
  const sink = recordingSink();
  broadcaster.subscribe(sink, 2, { clientKey: "user-1" });
  const subscription = await subscribeToTerritoryChannel(redis.newSubscriber(), broadcaster);

  // A hostile or buggy writer on the same Redis.
  await redis.publisher.publish(
    TERRITORY_CHANNEL,
    JSON.stringify({
      v: 1,
      event: {
        event: "territoryCaptured",
        cellId: CELL,
        gridVersion: 2,
        nextState: "owned",
        version: 1,
        at: new Date().toISOString(),
        coordinates: [[51.5, -0.1]],
      },
    }),
  );

  assert.equal(sink.frames.length, 0);
  assert.equal(subscription.stats.dropped, 1);
  await subscription.close();
});

// ------------------------------------------------------- no publish on rollback

test("D1: a rolled-back capture publishes nothing", async () => {
  const redis = fakeRedis();
  const broadcaster = new TerritoryBroadcaster();
  const sink = recordingSink();
  broadcaster.subscribe(sink, 2, { clientKey: "user-1" });
  const subscription = await subscribeToTerritoryChannel(redis.newSubscriber(), broadcaster);

  await assert.rejects(
    () =>
      bridgeAppliedCapture(redis.publisher, async () => {
        throw new Error("deadlock detected; transaction rolled back");
      }),
    /rolled back/,
  );

  assert.equal(redis.published.length, 0, "nothing may be published for a rolled-back capture");
  assert.equal(sink.frames.length, 0);
  await subscription.close();
});

test("D1: a committed capture publishes exactly its own changes, after it commits", async () => {
  const redis = fakeRedis();
  const order: string[] = [];
  const publisher: RedisPublisher = {
    async publish(channel, message) {
      order.push("publish");
      return redis.publisher.publish(channel, message);
    },
  };

  const applied = await bridgeAppliedCapture(publisher, async () => {
    order.push("commit");
    return { controlChanges: [change(), change({ cellId: "892a1008913ffff", territoryVersion: 4 })] };
  });

  assert.deepEqual(order, ["commit", "publish", "publish"], "publish must follow the commit");
  assert.equal(applied.controlChanges.length, 2);
  assert.equal(redis.published.length, 2);
});

test("D1: a Redis outage degrades the feed without failing the committed job", async () => {
  const errors: unknown[] = [];
  const broken: RedisPublisher = {
    async publish() {
      throw new Error("ECONNREFUSED");
    },
  };

  const applied = await bridgeAppliedCapture(broken, async () => ({ controlChanges: [change()] }), {
    onError: (error) => errors.push(error),
  });

  assert.equal(applied.controlChanges.length, 1, "the capture result must still be returned");
  assert.equal(errors.length, 1);
});

test("D1: a change with no broadcastable event type is skipped, not published as junk", async () => {
  const redis = fakeRedis();
  const result = await publishChanges(redis.publisher, [
    change({ eventType: "rejected" as ControlChange["eventType"] }),
  ]);
  assert.equal(result.published, 0);
  assert.equal(result.skipped, 1);
  assert.equal(redis.published.length, 0);
});

// ------------------------------------------- per-caller limits and cleanup

test("D1: one caller cannot hold more than the per-client stream cap", () => {
  const broadcaster = new TerritoryBroadcaster(100, 3);
  const accepted = [];
  for (let i = 0; i < 5; i++) {
    accepted.push(broadcaster.subscribe(recordingSink(), 2, { clientKey: "user-1" }));
  }
  assert.equal(accepted.filter(Boolean).length, 3);
  assert.equal(accepted[3], null);
  assert.equal(accepted[4], null);
  assert.equal(broadcaster.countForClient("user-1"), 3);
});

test("D1: one caller at their cap does not block anybody else", () => {
  const broadcaster = new TerritoryBroadcaster(100, 2);
  broadcaster.subscribe(recordingSink(), 2, { clientKey: "noisy" });
  broadcaster.subscribe(recordingSink(), 2, { clientKey: "noisy" });
  assert.equal(broadcaster.subscribe(recordingSink(), 2, { clientKey: "noisy" }), null);
  assert.ok(broadcaster.subscribe(recordingSink(), 2, { clientKey: "quiet" }));
});

test("D1: disconnecting frees the caller's slot", () => {
  const broadcaster = new TerritoryBroadcaster(100, 1);
  const unsubscribe = broadcaster.subscribe(recordingSink(), 2, { clientKey: "user-1" });
  assert.ok(unsubscribe);
  assert.equal(broadcaster.subscribe(recordingSink(), 2, { clientKey: "user-1" }), null);

  unsubscribe!();
  assert.equal(broadcaster.countForClient("user-1"), 0);
  assert.ok(broadcaster.subscribe(recordingSink(), 2, { clientKey: "user-1" }));
});

test("D1: unsubscribing twice does not free a slot twice", () => {
  // A reset socket emits both `error` and `close`, and the router wires
  // `unsubscribe` to each. Double-releasing would let a caller farm slots.
  const broadcaster = new TerritoryBroadcaster(100, 2);
  const unsubscribe = broadcaster.subscribe(recordingSink(), 2, { clientKey: "user-1" });
  broadcaster.subscribe(recordingSink(), 2, { clientKey: "user-1" });
  unsubscribe!();
  unsubscribe!();
  assert.equal(broadcaster.countForClient("user-1"), 1);
  assert.equal(broadcaster.subscriberCount, 1);
});

test("D1: a dead socket frees its slot instead of locking the caller out", () => {
  const broadcaster = new TerritoryBroadcaster(100, 1);
  const dead: SseSink = {
    write() {
      throw new Error("EPIPE");
    },
    end() {},
  };
  broadcaster.subscribe(dead, 2, { clientKey: "user-1" });
  broadcaster.broadcast({
    event: "territoryCaptured",
    cellId: CELL,
    gridVersion: 2,
    previousState: null,
    nextState: "owned",
    previousOwner: null,
    nextOwner: "0x1111…1111",
    version: 1,
    at: new Date().toISOString(),
  });
  assert.equal(broadcaster.subscriberCount, 0);
  assert.equal(broadcaster.countForClient("user-1"), 0);
  assert.ok(broadcaster.subscribe(recordingSink(), 2, { clientKey: "user-1" }));
});

test("D1: the process-wide cap still applies across different callers", () => {
  const broadcaster = new TerritoryBroadcaster(2, 10);
  assert.ok(broadcaster.subscribe(recordingSink(), 2, { clientKey: "a" }));
  assert.ok(broadcaster.subscribe(recordingSink(), 2, { clientKey: "b" }));
  assert.equal(broadcaster.subscribe(recordingSink(), 2, { clientKey: "c" }), null);
});

test("D1: closeAll releases every slot", () => {
  const broadcaster = new TerritoryBroadcaster(100, 1);
  broadcaster.subscribe(recordingSink(), 2, { clientKey: "user-1" });
  broadcaster.closeAll();
  assert.equal(broadcaster.countForClient("user-1"), 0);
  assert.ok(broadcaster.subscribe(recordingSink(), 2, { clientKey: "user-1" }));
});

// ------------------------------------------------------------------ heartbeat

test("D1: the heartbeat writes comment frames and drops dead sockets", async () => {
  const broadcaster = new TerritoryBroadcaster();
  const live = recordingSink();
  const dead: SseSink = {
    write() {
      throw new Error("EPIPE");
    },
    end() {},
  };
  broadcaster.subscribe(live, 2, { clientKey: "a" });
  broadcaster.subscribe(dead, 2, { clientKey: "b" });

  const stop = startHeartbeat(broadcaster, 5);
  await new Promise((resolve) => setTimeout(resolve, 30));
  stop();

  assert.ok(live.frames.length >= 1, "the live socket must receive a heartbeat");
  assert.ok(live.frames.every((f) => f === ": heartbeat\n\n"));
  assert.equal(broadcaster.subscriberCount, 1, "the dead socket must have been dropped");
  assert.equal(broadcaster.countForClient("b"), 0);

  const before = live.frames.length;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(live.frames.length, before, "stopping the heartbeat must actually stop it");
});
