/**
 * D1 integration — the same hop, over a real Redis, with **separate**
 * publisher and subscriber connections.
 *
 * The fake in realtimeBridge.test.ts proves the logic; it cannot prove that
 * ioredis actually delivers across connections, that a connection in subscriber
 * mode behaves, or that the channel name matches on both sides. Those are
 * exactly the things that made the in-process broadcaster look fine while
 * delivering nothing in production, so they are checked against the real
 * client.
 *
 * Skipped, loudly, when no Redis is reachable — a CI box without one must not
 * report a green run that proved nothing. Set `REDIS_TEST_URL` (or `REDIS_URL`)
 * to point at a throwaway instance; the test only publishes on its own
 * namespaced channel and writes no keys.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import IORedis from "ioredis";
import {
  publishChanges,
  subscribeToTerritoryChannel,
  TERRITORY_CHANNEL,
} from "./realtimeBridge.js";
import { TerritoryBroadcaster, type SseSink } from "./realtime.js";
import type { ControlChange } from "./ownership.service.js";

const REDIS_URL = process.env.REDIS_TEST_URL ?? process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
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

/** Connect, or return null when nothing is listening. */
async function connect(): Promise<InstanceType<typeof IORedis> | null> {
  const client = new IORedis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    connectTimeout: 1_000,
  });
  try {
    await client.connect();
    return client;
  } catch {
    client.disconnect();
    return null;
  }
}

/** Wait for a predicate, so the test does not depend on a fixed sleep. */
async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return predicate();
}

test("D1 integration: worker → Redis → API → SSE, across two connections", async (t) => {
  const publisher = await connect();
  if (!publisher) {
    t.skip(`no Redis at ${REDIS_URL} — set REDIS_TEST_URL to run this test`);
    return;
  }
  // ioredis puts a connection into subscriber mode, after which it cannot run
  // ordinary commands. A second, dedicated connection is not an optimisation
  // here; sharing one would break both roles.
  const subscriber = await connect();
  assert.ok(subscriber, "a second connection must be available");

  const broadcaster = new TerritoryBroadcaster();
  const sink = recordingSink();
  broadcaster.subscribe(sink, 2, { clientKey: "user-1" });
  const subscription = await subscribeToTerritoryChannel(subscriber!, broadcaster);

  try {
    const result = await publishChanges(publisher, [
      change(),
      change({ cellId: "892a1008913ffff", eventType: "reinforced", territoryVersion: 7 }),
    ]);
    assert.equal(result.published, 2);

    assert.ok(await waitFor(() => sink.frames.length === 2), `delivered ${sink.frames.length}/2`);
    assert.match(sink.frames[0], /^event: territoryCaptured\n/);
    assert.match(sink.frames[1], /^event: territoryReinforced\n/);

    const payload = JSON.parse(sink.frames[0].split("data: ")[1]);
    assert.equal(payload.cellId, CELL);
    assert.equal(payload.gridVersion, 2);
    assert.equal(payload.version, 1);
    // Truncated owner reference, never the full address.
    assert.equal(payload.nextOwner, "0x1111…1111");

    // And nothing that could place a runner.
    for (const forbidden of ["lat", "lng", "coordinates", "points", "routeId", "evidenceHash"]) {
      assert.ok(!sink.frames[0].includes(`"${forbidden}"`), `payload leaked "${forbidden}"`);
    }
  } finally {
    await subscription.close();
    await subscriber!.quit().catch(() => undefined);
    await publisher.quit().catch(() => undefined);
  }
});

test("D1 integration: two API replicas both receive one worker publish", async (t) => {
  const publisher = await connect();
  if (!publisher) {
    t.skip(`no Redis at ${REDIS_URL} — set REDIS_TEST_URL to run this test`);
    return;
  }

  const replicas: {
    connection: InstanceType<typeof IORedis>;
    sink: ReturnType<typeof recordingSink>;
    subscription: Awaited<ReturnType<typeof subscribeToTerritoryChannel>>;
  }[] = [];
  for (let i = 0; i < 2; i++) {
    const connection = await connect();
    assert.ok(connection);
    const broadcaster = new TerritoryBroadcaster();
    const sink = recordingSink();
    broadcaster.subscribe(sink, 2, { clientKey: `user-${i}` });
    replicas.push({
      connection: connection!,
      sink,
      subscription: await subscribeToTerritoryChannel(connection!, broadcaster),
    });
  }

  try {
    await publishChanges(publisher, [change()]);
    assert.ok(
      await waitFor(() => replicas.every((r) => r.sink.frames.length === 1)),
      `delivered to ${replicas.filter((r) => r.sink.frames.length === 1).length}/2 replicas`,
    );
  } finally {
    for (const replica of replicas) {
      await replica.subscription.close();
      await replica.connection.quit().catch(() => undefined);
    }
    await publisher.quit().catch(() => undefined);
  }
});

test("D1 integration: a closed subscription really stops receiving", async (t) => {
  const publisher = await connect();
  if (!publisher) {
    t.skip(`no Redis at ${REDIS_URL} — set REDIS_TEST_URL to run this test`);
    return;
  }
  const subscriber = await connect();
  assert.ok(subscriber);

  const broadcaster = new TerritoryBroadcaster();
  const sink = recordingSink();
  broadcaster.subscribe(sink, 2, { clientKey: "user-1" });
  const subscription = await subscribeToTerritoryChannel(subscriber!, broadcaster);

  try {
    await publishChanges(publisher, [change()]);
    assert.ok(await waitFor(() => sink.frames.length === 1));

    await subscription.close();
    await publishChanges(publisher, [change({ territoryVersion: 2 })]);
    // Give it a genuine chance to arrive before declaring it did not.
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(sink.frames.length, 1, "an unsubscribed connection must receive nothing further");
  } finally {
    await subscriber!.quit().catch(() => undefined);
    await publisher.quit().catch(() => undefined);
  }
});

test("D1 integration: unrelated traffic on the channel cannot reach a client", async (t) => {
  const publisher = await connect();
  if (!publisher) {
    t.skip(`no Redis at ${REDIS_URL} — set REDIS_TEST_URL to run this test`);
    return;
  }
  const subscriber = await connect();
  assert.ok(subscriber);

  const broadcaster = new TerritoryBroadcaster();
  const sink = recordingSink();
  broadcaster.subscribe(sink, 2, { clientKey: "user-1" });
  const dropped: string[] = [];
  const subscription = await subscribeToTerritoryChannel(subscriber!, broadcaster, {
    onDropped: (reason) => dropped.push(reason),
  });

  try {
    await publisher.publish(TERRITORY_CHANNEL, "definitely not json");
    await publisher.publish(TERRITORY_CHANNEL, JSON.stringify({ v: 42, event: {} }));
    assert.ok(await waitFor(() => dropped.length === 2), `dropped ${dropped.length}/2`);
    assert.equal(sink.frames.length, 0);
    assert.deepEqual(dropped, ["unparseable", "unknownVersion"]);
  } finally {
    await subscription.close();
    await subscriber!.quit().catch(() => undefined);
    await publisher.quit().catch(() => undefined);
  }
});
