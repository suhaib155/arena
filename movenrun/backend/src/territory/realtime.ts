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
}

/**
 * In-process SSE broadcaster.
 *
 * Single-instance only: subscribers are held in memory, so a second backend
 * instance would not see this one's events. Fanning out across instances needs
 * a Redis pub/sub hop between `broadcast` and the subscriber loop — the
 * interface here is deliberately shaped so that is a swap of one method, not a
 * redesign. This is called out rather than silently assumed, in the same spirit
 * as the auth nonce cache's single-instance note in middleware/auth.ts.
 */
export class TerritoryBroadcaster {
  private subscribers = new Map<string, Subscriber>();
  private nextId = 1;
  /** Bounded so a subscriber leak cannot exhaust memory. */
  constructor(private readonly maxSubscribers = 5_000) {}

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  /**
   * Register a subscriber. Returns an unsubscribe function, or null when the
   * subscriber cap is reached (the caller should respond 503 rather than
   * accepting a connection it will never serve).
   */
  subscribe(sink: SseSink, gridVersion: number): (() => void) | null {
    if (this.subscribers.size >= this.maxSubscribers) return null;
    const id = `sub-${this.nextId++}`;
    this.subscribers.set(id, { id, sink, gridVersion });
    return () => {
      this.subscribers.delete(id);
    };
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
        // reconnect and reconcile against the next map fetch.
        this.subscribers.delete(subscriber.id);
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

  /** SSE comment frame — keeps proxies from closing an idle connection. */
  heartbeat(): void {
    for (const subscriber of [...this.subscribers.values()]) {
      try {
        subscriber.sink.write(": heartbeat\n\n");
      } catch {
        this.subscribers.delete(subscriber.id);
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
  }
}

/** Process-wide broadcaster. */
export const territoryBroadcaster = new TerritoryBroadcaster();
