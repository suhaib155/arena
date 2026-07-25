/**
 * Realtime territory updates.
 *
 * ## Why Server-Sent Events
 * The backend had no realtime layer. Territory updates are one-directional
 * (server → client), text, and low-volume, which is exactly what SSE is for.
 * It rides on the existing Express server, needs no new dependency, no protocol
 * upgrade, and no separate port, and it reconnects by itself. A WebSocket would
 * add a dependency and a second connection lifecycle for no gain here.
 *
 * ## What is broadcast
 * Cell id, grid version, state transition, truncated owner references, and a
 * version number. Nothing else.
 *
 * **Runner coordinates are never broadcast.** Not the route, not the current
 * position, not a bounding box of where someone is running. A live feed of
 * "which cells just changed" is a fact about the map; a live feed of where a
 * person is right now is a stalking tool. Subscribers learn that a cell changed
 * hands, not who was standing in it.
 *
 * ## Stale-event handling
 * Every event carries the territory row's `version` after the change. Clients
 * drop any event whose version is not newer than what they already hold, so an
 * out-of-order or duplicated delivery cannot roll a map back.
 */
import type { TerritoryState } from "./types.js";
import type { ControlChange } from "./ownership.service.js";

export type TerritoryEventName =
  | "territoryCaptured"
  | "territoryReinforced"
  | "territoryAttacked"
  | "territoryContested"
  | "territoryTransferred"
  | "territoryReleased";

/** The wire shape. Deliberately small and free of any location detail. */
export interface TerritoryBroadcastEvent {
  event: TerritoryEventName;
  cellId: string;
  gridVersion: number;
  previousState: TerritoryState | null;
  nextState: TerritoryState;
  /** Truncated wallet references, matching the HTTP views. */
  previousOwner: string | null;
  nextOwner: string | null;
  /** The territory row's version after the change — the staleness guard. */
  version: number;
  at: string;
}

const EVENT_FOR_TYPE: Record<string, TerritoryEventName> = {
  captured: "territoryCaptured",
  reinforced: "territoryReinforced",
  attacked: "territoryAttacked",
  contested: "territoryContested",
  transferred: "territoryTransferred",
  released: "territoryReleased",
};

function truncate(address: string | null): string | null {
  if (!address) return null;
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/** Convert an ownership change into its broadcast form. */
export function toBroadcastEvent(
  change: ControlChange,
  now: Date = new Date(),
): TerritoryBroadcastEvent | null {
  const event = EVENT_FOR_TYPE[change.eventType];
  if (!event) return null;
  return {
    event,
    cellId: change.cellId,
    gridVersion: change.gridVersion,
    previousState: change.previousState,
    nextState: change.nextState,
    previousOwner: truncate(change.previousOwner),
    nextOwner: truncate(change.nextOwner),
    version: change.territoryVersion,
    at: now.toISOString(),
  };
}

/** The minimal response surface the broadcaster needs. Keeps this testable. */
export interface SseSink {
  write(chunk: string): boolean;
  end(): void;
}

interface Subscriber {
  id: string;
  sink: SseSink;
  gridVersion: number;
  /** Per-caller bucket key (user id, else client IP). */
  clientKey: string;
}

/** Bucket used when the caller cannot be attributed to a user or an IP. */
export const UNATTRIBUTED_CLIENT_KEY = "unattributed";

export interface SubscribeOptions {
  /**
   * Who this connection belongs to — the verified user id where there is one,
   * otherwise the client IP. Used only for the per-caller connection cap; it is
   * never broadcast and never logged.
   */
  clientKey?: string;
}

/**
 * In-process SSE broadcaster.
 *
 * ## Reach
 * This class fans out to the sockets held by **this process**. Delivery across
 * processes — worker → API, and API replica → API replica — is the Redis hop in
 * realtimeBridge.ts, which calls `broadcast` here with what it receives. That
 * separation is deliberate: the socket bookkeeping stays synchronous and
 * testable, and the transport stays swappable.
 *
 * ## Why there is no replay buffer
 * A dropped connection is not resumed from a cursor: on reconnect the client
 * refetches its viewport from `GET /v1/territories/map`, which is authoritative
 * anyway. Buffering events per subscriber would add unbounded memory and a
 * second consistency model for a map the client can simply re-read. Every event
 * carries the row's `version`, so a late or duplicated delivery is dropped by
 * the client rather than rolling the map backwards.
 */
export class TerritoryBroadcaster {
  private subscribers = new Map<string, Subscriber>();
  private perClient = new Map<string, number>();
  private nextId = 1;
  /**
   * @param maxSubscribers process-wide cap, so a subscriber leak cannot
   *   exhaust memory.
   * @param maxPerClient per-caller cap. One phone needs one stream; a caller
   *   opening dozens is either buggy or hostile, and without this cap a single
   *   IP can take every slot and deny the feed to everybody else.
   */
  constructor(
    private readonly maxSubscribers = 5_000,
    private readonly maxPerClient = 4,
  ) {}

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  /** How many live connections one caller holds. */
  countForClient(clientKey: string): number {
    return this.perClient.get(clientKey) ?? 0;
  }

  /**
   * Register a subscriber. Returns an unsubscribe function, or null when either
   * the process-wide cap or this caller's cap is reached — the caller should
   * refuse the connection rather than hold one it will never serve.
   *
   * The returned function is idempotent: a socket that both errors and closes
   * must not decrement the per-caller count twice, or a caller could farm
   * themselves unlimited slots.
   */
  subscribe(sink: SseSink, gridVersion: number, options: SubscribeOptions = {}): (() => void) | null {
    if (this.subscribers.size >= this.maxSubscribers) return null;
    const clientKey = options.clientKey || UNATTRIBUTED_CLIENT_KEY;
    if (this.countForClient(clientKey) >= this.maxPerClient) return null;

    const id = `sub-${this.nextId++}`;
    this.subscribers.set(id, { id, sink, gridVersion, clientKey });
    this.perClient.set(clientKey, this.countForClient(clientKey) + 1);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.release(id);
    };
  }

  /** Drop one subscriber and its per-caller reservation. */
  private release(id: string): void {
    const subscriber = this.subscribers.get(id);
    if (!subscriber) return;
    this.subscribers.delete(id);
    const remaining = this.countForClient(subscriber.clientKey) - 1;
    if (remaining > 0) this.perClient.set(subscriber.clientKey, remaining);
    else this.perClient.delete(subscriber.clientKey);
  }

  /** Send one event to every subscriber watching the same grid version. */
  broadcast(event: TerritoryBroadcastEvent): number {
    const frame = `event: ${event.event}\ndata: ${JSON.stringify(event)}\n\n`;
    let delivered = 0;
    for (const subscriber of [...this.subscribers.values()]) {
      if (subscriber.gridVersion !== event.gridVersion) continue;
      try {
        subscriber.sink.write(frame);
        delivered += 1;
      } catch {
        // A dead socket is dropped rather than retried: the client will
        // reconnect and reconcile against the next map fetch. Released through
        // `release` so the caller's per-client slot is freed too — otherwise a
        // client whose sockets keep dying would run out of slots and be locked
        // off the feed.
        this.release(subscriber.id);
      }
    }
    return delivered;
  }

  /** Broadcast every ownership change from one applied capture. */
  broadcastChanges(changes: ControlChange[], now: Date = new Date()): number {
    let delivered = 0;
    for (const change of changes) {
      const event = toBroadcastEvent(change, now);
      if (event) delivered += this.broadcast(event);
    }
    return delivered;
  }

  /**
   * SSE comment frame — keeps proxies from closing an idle connection, and is
   * how a dead socket is discovered on a quiet grid. Driven by
   * `startHeartbeat` in realtimeBridge.ts.
   */
  heartbeat(): void {
    for (const subscriber of [...this.subscribers.values()]) {
      try {
        subscriber.sink.write(": heartbeat\n\n");
      } catch {
        this.release(subscriber.id);
      }
    }
  }

  /** Close every connection — used on shutdown. */
  closeAll(): void {
    for (const subscriber of this.subscribers.values()) {
      try {
        subscriber.sink.end();
      } catch {
        // Already closed.
      }
    }
    this.subscribers.clear();
    this.perClient.clear();
  }
}

/** Process-wide broadcaster. */
export const territoryBroadcaster = new TerritoryBroadcaster();
