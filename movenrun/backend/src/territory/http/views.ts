/**
 * Territory API response shaping.
 *
 * ## The rule these functions exist to enforce
 * A territory response must never carry raw GPS, a route path, a coordinate
 * list, or anything else that could reconstruct where a person ran. Territory
 * geometry is H3 cell boundaries — deterministic polygons derived from a cell
 * id, identical for every viewer, revealing nothing about any individual.
 *
 * Owner identity is reduced to a truncated wallet address. A full address is
 * itself a persistent identifier that links a person's movements across every
 * cell they hold, so the public map shows enough to say "someone else holds
 * this" and no more.
 *
 * Pure functions over already-fetched records, so the privacy guarantees are
 * unit-testable without a database or Express.
 */
import { h3CellToGeoJsonFeature, type CellFeature } from "../h3.js";
import { actionEligibility, relationshipFor } from "../rules.js";
import type {
  TerritoryOwnershipEvent,
  TerritoryRecord,
  TerritoryRelationship,
} from "../types.js";

export interface Viewer {
  walletAddress: string | null;
  clubId: string | null;
}

/**
 * Public owner summary. Deliberately not the full address: `0x1234…cdef` is
 * enough to tell two rivals apart on a map without publishing a stable,
 * searchable identity for everyone who ever ran past.
 */
export interface OwnerSummary {
  displayAddress: string;
  clubId: string | null;
}

export function toOwnerSummary(territory: TerritoryRecord): OwnerSummary | null {
  if (!territory.ownerWalletAddress) return null;
  const address = territory.ownerWalletAddress;
  return {
    displayAddress:
      address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address,
    clubId: territory.ownerClubId,
  };
}

/** Properties attached to each map feature. Safe map data only. */
export interface TerritoryFeatureProperties extends Record<string, unknown> {
  cellId: string;
  state: string;
  relationship: TerritoryRelationship;
  controlScore: number;
  defenceScore: number;
  gridVersion: number;
  resolution: number;
  capturedAt: string | null;
  owner: OwnerSummary | null;
}

export function toMapFeature(territory: TerritoryRecord, viewer: Viewer): CellFeature {
  const properties: TerritoryFeatureProperties = {
    cellId: territory.h3CellId,
    state: territory.state,
    relationship: relationshipFor(territory, viewer),
    controlScore: territory.controlScore,
    defenceScore: territory.defenceScore,
    gridVersion: territory.gridVersion,
    resolution: territory.h3Resolution,
    // A capture date is coarse (a day-level fact about a fixed cell) and is
    // what makes "recently taken" readable on the map. It reveals no path.
    capturedAt: territory.capturedAt ? territory.capturedAt.toISOString() : null,
    owner: toOwnerSummary(territory),
  };
  return h3CellToGeoJsonFeature(territory.h3CellId, properties);
}

/**
 * Ordering priority when a viewport holds more territory than the response
 * limit allows (D3).
 *
 * The limit has to fall on *something*, so it should fall on what the runner
 * cares about least. Their own ground comes first, then their club's, then
 * anything actively in play, then rivals. Untouched and unplayable ground is
 * last because it carries the least information.
 */
const RELATIONSHIP_PRIORITY: Record<TerritoryRelationship, number> = {
  mine: 0,
  club: 1,
  contested: 2,
  rival: 3,
  protected: 4,
  neutral: 5,
  restricted: 6,
};

/**
 * Sort persisted territories for a viewer: by relationship priority, then by
 * cell id.
 *
 * Cell id is the tiebreak rather than `updatedAt` deliberately — it is stable,
 * so paging or re-requesting the same viewport returns the same features in the
 * same order. `updatedAt` would reshuffle the response every time anything
 * changed, which makes a truncated map flicker.
 *
 * Pure and total: never mutates its input.
 */
export function sortTerritoriesForViewer(
  territories: TerritoryRecord[],
  viewer: Viewer,
): TerritoryRecord[] {
  return [...territories].sort((a, b) => {
    const priority =
      RELATIONSHIP_PRIORITY[relationshipFor(a, viewer)] -
      RELATIONSHIP_PRIORITY[relationshipFor(b, viewer)];
    if (priority !== 0) return priority;
    return a.h3CellId < b.h3CellId ? -1 : a.h3CellId > b.h3CellId ? 1 : 0;
  });
}

/** Drop duplicate cell ids, keeping the first occurrence. */
export function dedupeTerritories(territories: TerritoryRecord[]): TerritoryRecord[] {
  const seen = new Set<string>();
  const out: TerritoryRecord[] = [];
  for (const territory of territories) {
    if (seen.has(territory.h3CellId)) continue;
    seen.add(territory.h3CellId);
    out.push(territory);
  }
  return out;
}

export interface TerritoryMapResponse {
  type: "FeatureCollection";
  features: CellFeature[];
  meta: {
    gridVersion: number;
    resolution: number;
    /** Features actually returned. */
    count: number;
    /** Features that matched before the cap was applied. */
    total: number;
    /** True when the cap trimmed the response — the map is partial. */
    truncated: boolean;
    /** Server time the response was built, for client cache reconciliation. */
    generatedAt: string;
  };
}

export function toMapResponse(
  territories: TerritoryRecord[],
  viewer: Viewer,
  meta: { gridVersion: number; resolution: number; total: number; truncated: boolean },
  now: Date = new Date(),
): TerritoryMapResponse {
  return {
    type: "FeatureCollection",
    features: territories.map((territory) => toMapFeature(territory, viewer)),
    meta: {
      gridVersion: meta.gridVersion,
      resolution: meta.resolution,
      count: territories.length,
      total: meta.total,
      truncated: meta.truncated,
      generatedAt: now.toISOString(),
    },
  };
}

export interface NeighbourSummary {
  cellId: string;
  state: string;
  relationship: TerritoryRelationship;
}

export interface PublicOwnershipEvent {
  eventType: string;
  previousState: string | null;
  nextState: string;
  /** Truncated, like every other owner reference in the API. */
  actor: string | null;
  at: string;
}

/**
 * One public history entry. Route ids and evidence hashes are stripped: they
 * are per-runner references into the private route record and have no business
 * on a public surface.
 */
export function toPublicEvent(event: TerritoryOwnershipEvent): PublicOwnershipEvent {
  const actor = event.actorWalletAddress;
  return {
    eventType: event.eventType,
    previousState: event.previousState,
    nextState: event.nextState,
    actor: actor ? `${actor.slice(0, 6)}…${actor.slice(-4)}` : null,
    at: event.createdAt.toISOString(),
  };
}

export interface TerritoryDetailResponse {
  cellId: string;
  gridVersion: number;
  resolution: number;
  state: string;
  relationship: TerritoryRelationship;
  classification: string;
  owner: OwnerSummary | null;
  controlScore: number;
  defenceScore: number;
  capturedAt: string | null;
  lastDefendedAt: string | null;
  contestedAt: string | null;
  neighbours: NeighbourSummary[];
  recentEvents: PublicOwnershipEvent[];
  actions: { canCapture: boolean; canReinforce: boolean; canAttack: boolean };
  /** What a run would need to do to take this cell, in plain terms. */
  captureRequirements: string[];
  geometry: CellFeature["geometry"];
}

export function toDetailResponse(
  territory: TerritoryRecord,
  neighbours: TerritoryRecord[],
  recentEvents: TerritoryOwnershipEvent[],
  viewer: Viewer,
  captureRequirements: string[],
): TerritoryDetailResponse {
  return {
    cellId: territory.h3CellId,
    gridVersion: territory.gridVersion,
    resolution: territory.h3Resolution,
    state: territory.state,
    relationship: relationshipFor(territory, viewer),
    classification: territory.classification,
    owner: toOwnerSummary(territory),
    controlScore: territory.controlScore,
    defenceScore: territory.defenceScore,
    capturedAt: territory.capturedAt ? territory.capturedAt.toISOString() : null,
    lastDefendedAt: territory.lastDefendedAt ? territory.lastDefendedAt.toISOString() : null,
    contestedAt: territory.contestedAt ? territory.contestedAt.toISOString() : null,
    neighbours: neighbours.map((neighbour) => ({
      cellId: neighbour.h3CellId,
      state: neighbour.state,
      relationship: relationshipFor(neighbour, viewer),
    })),
    recentEvents: recentEvents.map(toPublicEvent),
    actions: actionEligibility(territory, viewer),
    captureRequirements,
    geometry: h3CellToGeoJsonFeature(territory.h3CellId).geometry,
  };
}

/** Plain-language capture requirements, derived from the live configuration. */
export function describeCaptureRequirements(config: {
  minRoutePoints: number;
  minRouteDistanceMeters: number;
  minDurationSeconds: number;
  maxClosureDistanceMeters: number;
  minAreaSquareMeters: number;
}): string[] {
  return [
    `Close a loop within ${config.maxClosureDistanceMeters} m of where you started`,
    `Cover at least ${config.minRouteDistanceMeters} m`,
    `Keep moving for at least ${Math.round(config.minDurationSeconds / 60)} minutes`,
    `Enclose at least ${config.minAreaSquareMeters.toLocaleString("en-GB")} m²`,
    "Keep a clean GPS signal — the route must not cross itself or jump",
  ];
}

export interface CaptureResultResponse {
  routeId: string;
  routeStatus: string;
  loopClosed: boolean;
  captureEligible: boolean;
  closureDistanceMeters: number | null;
  enclosedAreaSquareMeters: number;
  gridVersion: number;
  resolution: number;
  capturedCells: string[];
  reinforcedCells: string[];
  attackedCells: string[];
  rejectedCells: string[];
  rejectionReasons: string[];
  /** Null while the worker has not finished — the client shows "verifying". */
  processedAt: string | null;
}
