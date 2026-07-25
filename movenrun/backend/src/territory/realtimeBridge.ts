/**
 * Cross-process realtime bridge for territory ownership events (D1).
 *
 * ## The defect this fixes
 * `TerritoryBroadcaster` holds its subscribers in a `Map` in one process. The
 * BullMQ worker that actually *applies* a capture runs in a **different**
 * process from the API that holds the SSE connections, so
 * `broadcaster.broadcastChanges(...)` in the worker fanned out to zero
 * subscribers — always. Realtime worked only in a single-process dev setup, and
 * the deployed topology (API + worker, and any API replica beyond the first)
 * silently delivered nothing.
 *
 * ## The bridge
 *
 *     worker  ──publish──▶  Redis channel  ──subscribe──▶  API  ──SSE──▶  app
 *
 * The worker publishes each ownership change after its transaction has
 * committed; every API process subscribes and hands what it receives to its own
 * in-process broadcaster. One Redis hop, no new dependency (ioredis is already
 * here for BullMQ), and `TerritoryBroadcaster` is unchanged — this is the
 * "swap of one method" its header comment anticipated.
 *
 * ## Envelope versioning
 * Every message is `{ v: 1, event }`. A subscriber ignores an envelope whose
 * version it does not understand, so a future field change can roll out to
 * workers and API instances in either order without a partially-upgraded fleet
 * delivering garbage to a phone. Unparseable and malformed messages are dropped
 * and counted, never thrown — a bad publish must not take the API down.
 *
 * ## No coordinates. Ever.
 * The payload is the same `TerritoryBroadcastEvent` the in-process broadcaster
 * sends: cell id, grid version, state transition, truncated owner references,
 * version, timestamp. `assertNoLocationData` re-checks that on **both** sides of
 * the hop, because Redis is the one place a future caller might be tempted to
 * push "richer" data through. A live feed of which cells changed is a fact
 * about the map; a live feed of where a person is running is a stalking tool.
 *
 * ## No publish on rollback
 * `publishChanges` is called only with changes from a capture that has already
 * committed. `bridgeAppliedCapture` makes that structural: it takes a thunk,
 * awaits it, and publishes only if it resolved. If the transaction throws, the
 * publish never happens — an event announcing ownership that was rolled back is
 * worse than no event at all, because the client has no way to learn it was
 * retracted.
 */
import type { TerritoryBroadcastEvent, TerritoryBroadcaster } from "./realtime.js";
import { toBroadcastEvent } from "./realtime.js";
import type { ControlChange } from "./ownership.service.js";

/** The Redis channel. Versioned in the name as well as in the envelope, so an
 *  incompatible future format can move channel instead of coexisting. */
export const TERRITORY_CHANNEL = "movenrun:territory:v1";

/** Envelope version. Bump only for an incompatible payload change. */
export const TERRITORY_ENVELOPE_VERSION = 1;

export interface TerritoryEnvelope {
  v: number;
  event: TerritoryBroadcastEvent;
}

/**
 * The publish half of a Redis client, narrowed to one method. Anything that can
 * publish satisfies it — the real ioredis client, or a fake in a unit test.
 */
export interface RedisPublisher {
  publish(channel: string, message: string): Promise<unknown>;
}

/**
 * The subscribe half. A real ioredis connection in subscriber mode cannot run
 * ordinary commands, which is exactly why this is a separate interface and why
 * the API must use a **dedicated** connection for it.
 */
export interface RedisSubscriber {
  subscribe(channel: string): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
  on(event: "message", listener: (channel: string, message: string) => void): unknown;
  off?(event: "message", listener: (channel: string, message: string) => void): unknown;
}

/**
 * Keys that must never appear anywhere in a realtime payload.
 *
 * Held as data so it can be asserted by a test, in the same spirit as the HTTP
 * layer's privacy sweep in http/views.test.ts.
 */
export const FORBIDDEN_REALTIME_KEYS = [
  "lat",
  "lng",
  "latitude",
  "longitude",
  "coords",
  "coordinates",
  "points",
  "path",
  "polyline",
  "route",
  "routeId",
  "evidenceHash",
  "accuracy",
  "speed",
  "heading",
  "altitude",
] as const;

/** Recursively test a payload for any location-bearing key. */
export function findLocationData(value: unknown, seen = new Set<unknown>()): string | null {
  if (!value || typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findLocationData(item, seen);
      if (found) return found;
    }
    return null;
  }
  for (const [key, child] of Object.entries(value)) {
    if ((FORBIDDEN_REALTIME_KEYS as readonly string[]).includes(key)) return key;
    const found = findLocationData(child, seen);
    if (found) return found;
  }
  return null;
}

/** Throws if a payload carries location data. Used on both sides of the hop. */
export function assertNoLocationData(event: unknown): void {
  const found = findLocationData(event);
  if (found) {
    throw new Error(`realtime payload carries location data ("${found}") — refusing to publish`);
  }
}

/** The fields a well-formed event must have, with their types. */
function isBroadcastEvent(value: unknown): value is TerritoryBroadcastEvent {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.event === "string" &&
    typeof e.cellId === "string" &&
    e.cellId.length > 0 &&
    Number.isInteger(e.gridVersion) &&
    typeof e.nextState === "string" &&
    Number.isInteger(e.version) &&
    typeof e.at === "string"
  );
}

/**
 * Parse a received message into an event, or null with a reason.
 *
 * Everything arriving here is treated as untrusted: a malformed publish, a
 * message from a newer deployment, or an unrelated writer on the same Redis
 * must all be dropped quietly rather than crashing the API process that holds
 * live SSE connections.
 */
export function parseEnvelope(
  message: string,
): { ok: true; event: TerritoryBroadcastEvent } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return { ok: false, reason: "unparseable" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "notAnObject" };
  }
  const envelope = parsed as Record<string, unknown>;
  if (envelope.v !== TERRITORY_ENVELOPE_VERSION) return { ok: false, reason: "unknownVersion" };
  if (!isBroadcastEvent(envelope.event)) return { ok: false, reason: "malformedEvent" };
  if (findLocationData(envelope.event)) return { ok: false, reason: "locationData" };
  return { ok: true, event: envelope.event };
}

// ------------------------------------------------------------------ publish

export interface PublishResult {
  published: number;
  /** Changes that produced no broadcastable event (unknown event type). */
  skipped: number;
}

/**
 * Publish ownership changes to every API process.
 *
 * Failures are swallowed *per event* and reported through `onError`: realtime
 * is a convenience layer over an authoritative HTTP API, so a Redis outage must
 * degrade the live feed, never fail the worker job that already committed the
 * ownership change to Postgres. The client reconciles on its next map fetch.
 */
export async function publishChanges(
  redis: RedisPublisher,
  changes: ControlChange[],
  options: { now?: Date; onError?: (error: unknown) => void } = {},
): Promise<PublishResult> {
  const now = options.now ?? new Date();
  let published = 0;
  let skipped = 0;
  for (const change of changes) {
    const event = toBroadcastEvent(change, now);
    if (!event) {
      skipped += 1;
      continue;
    }
    // Belt and braces: refuse to put location data on the wire even if a future
    // caller widens ControlChange.
    assertNoLocationData(event);
    const envelope: TerritoryEnvelope = { v: TERRITORY_ENVELOPE_VERSION, event };
    try {
      await redis.publish(TERRITORY_CHANNEL, JSON.stringify(envelope));
      published += 1;
    } catch (error) {
      options.onError?.(error);
    }
  }
  return { published, skipped };
}

/**
 * Run a capture and publish only what it actually committed.
 *
 * The ordering is the point: `apply()` is awaited first, so a transaction that
 * rolls back throws here and **nothing is published**. Writing this as a helper
 * rather than as two statements at the call site is deliberate — it is the kind
 * of ordering that gets accidentally inverted during a refactor.
 */
export async function bridgeAppliedCapture<T extends { controlChanges: ControlChange[] }>(
  redis: RedisPublisher,
  apply: () => Promise<T>,
  options: { now?: Date; onError?: (error: unknown) => void } = {},
): Promise<T> {
  const applied = await apply();
  await publishChanges(redis, applied.controlChanges, options);
  return applied;
}

// ---------------------------------------------------------------- subscribe

export interface BridgeSubscription {
  /** Stop receiving and release the channel subscription. */
  close(): Promise<void>;
  /** Counters, for the readiness probe and for tests. */
  readonly stats: { received: number; delivered: number; dropped: number };
}

/**
 * Subscribe this process's broadcaster to the shared channel.
 *
 * Must be given a **dedicated** connection: ioredis puts a connection into
 * subscriber mode, after which it can no longer run ordinary commands, so
 * sharing the BullMQ connection would break the queue.
 */
export async function subscribeToTerritoryChannel(
  redis: RedisSubscriber,
  broadcaster: Pick<TerritoryBroadcaster, "broadcast">,
  options: { onDropped?: (reason: string) => void } = {},
): Promise<BridgeSubscription> {
  const stats = { received: 0, delivered: 0, dropped: 0 };

  const listener = (channel: string, message: string) => {
    if (channel !== TERRITORY_CHANNEL) return;
    stats.received += 1;
    const parsed = parseEnvelope(message);
    if (!parsed.ok) {
      stats.dropped += 1;
      options.onDropped?.(parsed.reason);
      return;
    }
    // The broadcaster filters by grid version and drops dead sockets itself.
    stats.delivered += broadcaster.broadcast(parsed.event);
  };

  redis.on("message", listener);
  await redis.subscribe(TERRITORY_CHANNEL);

  return {
    stats,
    async close() {
      redis.off?.("message", listener);
      try {
        await redis.unsubscribe(TERRITORY_CHANNEL);
      } catch {
        // Connection already gone — nothing to release.
      }
    },
  };
}

// ---------------------------------------------------------------- heartbeat

/**
 * Periodic SSE comment frames.
 *
 * Idle connections are killed by proxies and by mobile radios long before an
 * ownership change happens on a quiet grid, and a client that does not know its
 * connection is dead shows a stale map indefinitely. `unref()` keeps the timer
 * from holding the process open at shutdown.
 */
export function startHeartbeat(
  broadcaster: Pick<TerritoryBroadcaster, "heartbeat">,
  intervalMs = 25_000,
): () => void {
  const timer = setInterval(() => broadcaster.heartbeat(), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
