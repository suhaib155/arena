/**
 * Viewport-driven territory loading.
 *
 * Pure logic — no React, no fetch, no timers — so every rule below is testable
 * offline and the screen stays a thin shell around it.
 *
 * The rules, and why each exists:
 *
 *  - **Never fetch the whole city.** Only the visible bounding box is requested,
 *    and the backend rejects an oversized one anyway.
 *  - **Debounce.** A pan gesture emits dozens of region events; one request per
 *    event would hammer the API and race itself.
 *  - **Ignore tiny changes.** A few pixels of drift is not a new viewport.
 *  - **Cache recent regions.** Panning back to where you just were should be
 *    instant, not another round trip.
 *  - **Drop stale responses.** Responses can arrive out of order; a slow reply
 *    for an old viewport must never overwrite a fast reply for the current one.
 *  - **Keep showing what you have.** A refresh must not blank the map.
 */
import type { TerritoryRelationship } from "./territoryStyle";

export interface Viewport {
  west: number;
  south: number;
  east: number;
  north: number;
  zoom: number;
}

/** One territory cell as the map needs it. */
export interface TerritoryCell {
  cellId: string;
  state: string;
  relationship: TerritoryRelationship;
  controlScore: number;
  defenceScore: number;
  gridVersion: number;
  /** The server-side row version — the staleness guard for realtime events. */
  version: number;
  /** GeoJSON Polygon ring set, as returned by the API. */
  coordinates: number[][][];
}

export const VIEWPORT_RULES = {
  /** Wait this long after the last camera movement before requesting. */
  debounceMs: 400,
  /**
   * Refetch only when the viewport moved by more than this share of its own
   * width/height, or when zoom changed by more than `zoomEpsilon`.
   */
  moveThreshold: 0.25,
  zoomEpsilon: 0.6,
  /** Cached regions kept before the oldest is evicted. */
  maxCachedRegions: 24,
  /** A cached region older than this is refetched. */
  cacheTtlMs: 60_000,
} as const;

/** A stable cache key for a viewport, rounded so near-identical boxes share one. */
export function viewportKey(viewport: Viewport): string {
  const round = (value: number) => value.toFixed(4);
  return [
    round(viewport.west),
    round(viewport.south),
    round(viewport.east),
    round(viewport.north),
    Math.round(viewport.zoom),
  ].join(",");
}

/**
 * Whether a new viewport differs enough from the last fetched one to be worth
 * a request. Returns true when there is no previous viewport at all.
 */
export function shouldRefetch(
  previous: Viewport | null,
  next: Viewport,
  rules = VIEWPORT_RULES,
): boolean {
  if (!previous) return true;
  if (Math.abs(previous.zoom - next.zoom) > rules.zoomEpsilon) return true;

  const width = Math.max(1e-9, previous.east - previous.west);
  const height = Math.max(1e-9, previous.north - previous.south);

  const movedX = Math.max(
    Math.abs(next.west - previous.west),
    Math.abs(next.east - previous.east),
  );
  const movedY = Math.max(
    Math.abs(next.south - previous.south),
    Math.abs(next.north - previous.north),
  );

  return movedX / width > rules.moveThreshold || movedY / height > rules.moveThreshold;
}

interface CacheEntry {
  cells: TerritoryCell[];
  fetchedAt: number;
}

/**
 * Bounded, TTL'd cache of recently loaded regions.
 *
 * A `Map` preserves insertion order, so evicting the first key drops the oldest
 * entry — no separate LRU bookkeeping needed for a cache this small.
 */
export class ViewportCache {
  private entries = new Map<string, CacheEntry>();

  constructor(private readonly rules = VIEWPORT_RULES) {}

  get size(): number {
    return this.entries.size;
  }

  get(viewport: Viewport, now: number = Date.now()): TerritoryCell[] | null {
    const key = viewportKey(viewport);
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (now - entry.fetchedAt > this.rules.cacheTtlMs) {
      this.entries.delete(key);
      return null;
    }
    return entry.cells;
  }

  set(viewport: Viewport, cells: TerritoryCell[], now: number = Date.now()): void {
    const key = viewportKey(viewport);
    // Re-inserting moves the key to the end, keeping recently-used entries alive.
    this.entries.delete(key);
    this.entries.set(key, { cells, fetchedAt: now });
    while (this.entries.size > this.rules.maxCachedRegions) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

/**
 * Tracks which request is current, so an out-of-order response is discarded.
 *
 * `begin()` returns a monotonically increasing token; `isCurrent(token)` is
 * false once a later request has started. This is the "cancel or ignore stale
 * requests" rule — the in-flight fetch is not aborted (an abort mid-flight
 * would waste work already done server-side), its *result* is ignored.
 */
export class RequestSequence {
  private current = 0;

  begin(): number {
    this.current += 1;
    return this.current;
  }

  isCurrent(token: number): boolean {
    return token === this.current;
  }

  /** Invalidate every in-flight request — used when the screen unmounts. */
  cancelAll(): void {
    this.current += 1;
  }
}

/** What the map should display right now. */
export interface TerritoryViewState {
  cells: TerritoryCell[];
  /** True while a request is in flight. The map still shows `cells`. */
  loading: boolean;
  /** Set when the last request failed. Previous cells are kept visible. */
  error: string | null;
  /** True when the last response was empty — "nothing captured here yet". */
  empty: boolean;
}

export const INITIAL_VIEW_STATE: TerritoryViewState = {
  cells: [],
  loading: false,
  error: null,
  empty: false,
};

/**
 * Merge a successful response into the current state.
 *
 * Cells are keyed by id, with the response's version winning only when it is
 * not older than what is held. That keeps a realtime update that arrived
 * between request and response from being rolled back by the older snapshot.
 */
export function applyResponse(
  state: TerritoryViewState,
  cells: TerritoryCell[],
): TerritoryViewState {
  const merged = new Map(state.cells.map((cell) => [cell.cellId, cell]));
  for (const cell of cells) {
    const held = merged.get(cell.cellId);
    if (held && held.version > cell.version) continue;
    merged.set(cell.cellId, cell);
  }
  return {
    cells: [...merged.values()],
    loading: false,
    error: null,
    empty: cells.length === 0,
  };
}

/** Mark a request as started without clearing what is already on screen. */
export function beginLoading(state: TerritoryViewState): TerritoryViewState {
  return { ...state, loading: true, error: null };
}

/**
 * Record a failure. Previously loaded territory stays visible: a dropped
 * connection should not blank the map the runner is looking at.
 */
export function applyError(state: TerritoryViewState, error: string): TerritoryViewState {
  return { ...state, loading: false, error };
}

/** Build a GeoJSON FeatureCollection for the map's territory ShapeSource. */
export function cellsToFeatureCollection(cells: TerritoryCell[]): {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    id: string;
    properties: Record<string, unknown>;
    geometry: { type: "Polygon"; coordinates: number[][][] };
  }[];
} {
  return {
    type: "FeatureCollection",
    features: cells.map((cell) => ({
      type: "Feature",
      id: cell.cellId,
      properties: {
        cellId: cell.cellId,
        state: cell.state,
        relationship: cell.relationship,
        controlScore: cell.controlScore,
        defenceScore: cell.defenceScore,
      },
      geometry: { type: "Polygon", coordinates: cell.coordinates },
    })),
  };
}
