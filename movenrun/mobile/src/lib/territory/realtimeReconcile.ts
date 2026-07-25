/**
 * Reconciling realtime territory events against the loaded map.
 *
 * Realtime delivery is best-effort and unordered. An event can arrive twice,
 * arrive after a newer one, or arrive for a cell the client has never loaded.
 * Every case has to leave the map correct, because the alternative — a stale
 * event silently rolling a cell back to its previous owner — is a bug the user
 * experiences as the game lying to them.
 *
 * The rule is version-based: an event is applied only when its `version` is
 * strictly newer than the version already held for that cell. Versions come
 * from the territory row's optimistic-concurrency counter, so they are
 * monotonic per cell by construction.
 *
 * Pure module — no EventSource, no React — so the ordering rules are testable.
 */
import type { TerritoryCell } from "./viewport";
import { toRelationship, type TerritoryRelationship } from "./territoryStyle";

export type TerritoryEventName =
  | "territoryCaptured"
  | "territoryReinforced"
  | "territoryAttacked"
  | "territoryContested"
  | "territoryTransferred"
  | "territoryReleased";

/** The wire shape broadcast by the backend (see backend territory/realtime.ts). */
export interface TerritoryEvent {
  event: TerritoryEventName;
  cellId: string;
  gridVersion: number;
  previousState: string | null;
  nextState: string;
  previousOwner: string | null;
  nextOwner: string | null;
  version: number;
  at: string;
}

const EVENT_NAMES = new Set<string>([
  "territoryCaptured",
  "territoryReinforced",
  "territoryAttacked",
  "territoryContested",
  "territoryTransferred",
  "territoryReleased",
]);

/**
 * Parse an SSE payload defensively. A malformed or unknown event returns null
 * rather than throwing — one bad frame must not take the stream down.
 */
export function parseTerritoryEvent(raw: unknown): TerritoryEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.event !== "string" || !EVENT_NAMES.has(value.event)) return null;
  if (typeof value.cellId !== "string" || value.cellId.length === 0) return null;
  if (typeof value.version !== "number" || !Number.isFinite(value.version)) return null;
  if (typeof value.nextState !== "string") return null;
  if (typeof value.gridVersion !== "number") return null;

  return {
    event: value.event as TerritoryEventName,
    cellId: value.cellId,
    gridVersion: value.gridVersion,
    previousState: typeof value.previousState === "string" ? value.previousState : null,
    nextState: value.nextState,
    previousOwner: typeof value.previousOwner === "string" ? value.previousOwner : null,
    nextOwner: typeof value.nextOwner === "string" ? value.nextOwner : null,
    version: value.version,
    at: typeof value.at === "string" ? value.at : new Date().toISOString(),
  };
}

export interface ReconcileOptions {
  /** The signed-in runner's truncated address, as the server broadcasts it. */
  viewerDisplayAddress: string | null;
  /** The grid the map is showing. Events for other grids are ignored. */
  gridVersion: number;
}

export interface ReconcileResult {
  cells: TerritoryCell[];
  /** True when the event actually changed something. */
  changed: boolean;
  /** Why it was ignored, when it was. */
  ignoredReason: "staleVersion" | "unknownCell" | "wrongGrid" | null;
}

/**
 * Derive the viewer's relationship to a cell from a broadcast event.
 *
 * The broadcast carries truncated owner references (the backend never sends
 * full addresses), so this compares against the viewer's own truncated form.
 *
 * When the viewer is anonymous, an owned cell reads as `claimed`, never
 * `rival` — matching what the map API now returns (D2). `rival` asserts the
 * cell belongs to someone *other than the viewer*, which is not knowable
 * without an identity; asserting it anyway is what made a runner's own
 * territory flip to rival colours the moment a live event touched it.
 */
export function relationshipFromEvent(
  event: TerritoryEvent,
  viewerDisplayAddress: string | null,
): TerritoryRelationship {
  if (event.nextState === "contested") return "contested";
  if (event.nextState === "protected") return "protected";
  if (event.nextState === "restricted") return "restricted";
  if (event.nextState === "neutral" || !event.nextOwner) return "neutral";
  if (!viewerDisplayAddress) return "claimed";
  if (event.nextOwner === viewerDisplayAddress) return "mine";
  return "rival";
}

/**
 * Apply one event to the loaded cells.
 *
 * Events for cells that are not loaded are dropped rather than inserted: the
 * client has no geometry for them, and the next viewport fetch will bring them
 * in with their polygon attached.
 */
export function reconcileEvent(
  cells: TerritoryCell[],
  event: TerritoryEvent,
  options: ReconcileOptions,
): ReconcileResult {
  if (event.gridVersion !== options.gridVersion) {
    return { cells, changed: false, ignoredReason: "wrongGrid" };
  }

  const index = cells.findIndex((cell) => cell.cellId === event.cellId);
  if (index === -1) {
    return { cells, changed: false, ignoredReason: "unknownCell" };
  }

  const held = cells[index];
  // Strictly newer. Equal versions mean a duplicate delivery of something
  // already applied; older means an out-of-order straggler. Both are dropped.
  if (event.version <= held.version) {
    return { cells, changed: false, ignoredReason: "staleVersion" };
  }

  const next = [...cells];
  next[index] = {
    ...held,
    state: event.nextState,
    relationship: relationshipFromEvent(event, options.viewerDisplayAddress),
    version: event.version,
  };
  return { cells: next, changed: true, ignoredReason: null };
}

/** Apply a batch of events in arrival order. */
export function reconcileEvents(
  cells: TerritoryCell[],
  events: TerritoryEvent[],
  options: ReconcileOptions,
): { cells: TerritoryCell[]; applied: number } {
  let current = cells;
  let applied = 0;
  for (const event of events) {
    const result = reconcileEvent(current, event, options);
    current = result.cells;
    if (result.changed) applied += 1;
  }
  return { cells: current, applied };
}

/**
 * Reconnection backoff: exponential with a ceiling, plus jitter so a server
 * restart doesn't bring every client back in the same millisecond.
 */
export const RECONNECT = {
  baseMs: 1_000,
  maxMs: 30_000,
  jitterRatio: 0.25,
} as const;

export function reconnectDelayMs(
  attempt: number,
  random: () => number = Math.random,
  config = RECONNECT,
): number {
  const exponential = Math.min(config.maxMs, config.baseMs * 2 ** Math.max(0, attempt));
  const jitter = exponential * config.jitterRatio * (random() * 2 - 1);
  return Math.max(config.baseMs, Math.round(exponential + jitter));
}

/**
 * Whether a realtime-updated map should be reconciled against a fresh fetch.
 *
 * Realtime is a fast path, not a source of truth: after this long without a
 * full fetch, refetch so any missed event is corrected.
 */
export const REALTIME_RECONCILE_INTERVAL_MS = 120_000;

export function needsFullReconcile(
  lastFullFetchAt: number | null,
  now: number = Date.now(),
  intervalMs: number = REALTIME_RECONCILE_INTERVAL_MS,
): boolean {
  if (lastFullFetchAt === null) return true;
  return now - lastFullFetchAt >= intervalMs;
}

/** Narrow an arbitrary API state string to a relationship for display. */
export { toRelationship };
