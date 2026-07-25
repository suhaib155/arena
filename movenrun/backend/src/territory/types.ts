/**
 * Territory domain types — the vocabulary shared by the schema, the repository,
 * the ownership service and the HTTP layer.
 *
 * String unions rather than TypeScript enums, matching the identity module's
 * convention, so the DB schema can `$type<...>()` them without importing
 * runtime values across the schema boundary.
 */

/** Lifecycle state of one territory cell. */
export type TerritoryState =
  /** Unclaimed. Any valid closed-loop capture can take it. */
  | "neutral"
  /** Held by a user or club with defence above zero. */
  | "owned"
  /** Defence has reached zero; another qualifying action transfers it. */
  | "contested"
  /** Held and shielded from attack (events, sponsors, grace periods). */
  | "protected"
  /** Not playable at all — see classification.ts. */
  | "restricted"
  /** Owned but inactive for long enough to decay out of active play. */
  | "dormant";

/** An immutable ownership-history event type. */
export type TerritoryEventType =
  | "captured"
  | "reinforced"
  | "attacked"
  | "contested"
  | "transferred"
  | "expired"
  | "released"
  | "restricted";

/**
 * How a cell relates to the *requesting* user. Computed per request, never
 * stored — the same cell is `mine` to one runner and `rival` to another.
 * Mirrors the mobile `TerritoryRelationship`.
 */
export type TerritoryRelationship =
  | "mine"
  | "club"
  | "rival"
  | "contested"
  | "neutral"
  | "protected"
  | "restricted"
  /**
   * Held by someone, but the viewer is not signed in so no relationship can be
   * computed (D2).
   *
   * This exists because `rival` is a *claim about the viewer* — it asserts the
   * cell belongs to someone else. For an anonymous caller that assertion is
   * unfounded: the cell may well be their own. Labelling every owned cell
   * `rival` is what made a runner's own territory render in rival colours, so
   * the anonymous answer is now explicitly "claimed by someone" and nothing more.
   */
  | "claimed";

/**
 * Playability classification of a cell's ground. Independent of ownership: a
 * cell can be `water` and unowned, or `park` and owned.
 */
export type CellClassification =
  | "playable"
  | "restricted"
  | "water"
  | "private"
  | "dangerous"
  | "eventOnly"
  | "park"
  | "landmark";

/** Classifications that can never be captured. */
export const NON_CAPTURABLE_CLASSIFICATIONS: readonly CellClassification[] = [
  "restricted",
  "water",
  "private",
  "dangerous",
];

export function isCapturableClassification(classification: CellClassification): boolean {
  return !NON_CAPTURABLE_CLASSIFICATIONS.includes(classification);
}

/** A stored territory row. */
export interface TerritoryRecord {
  h3CellId: string;
  /** Stored explicitly — never re-inferred from application defaults. */
  h3Resolution: number;
  gridVersion: number;
  ownerWalletAddress: string | null;
  ownerUserId: string | null;
  ownerClubId: string | null;
  state: TerritoryState;
  classification: CellClassification;
  controlScore: number;
  defenceScore: number;
  capturedAt: Date | null;
  lastDefendedAt: Date | null;
  contestedAt: Date | null;
  expiresAt: Date | null;
  /** Optimistic-concurrency counter, bumped on every ownership write. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** One immutable entry in a cell's ownership history. */
export interface TerritoryOwnershipEvent {
  id: string;
  h3CellId: string;
  gridVersion: number;
  routeId: string | null;
  actorUserId: string | null;
  actorWalletAddress: string | null;
  eventType: TerritoryEventType;
  previousOwner: string | null;
  nextOwner: string | null;
  previousState: TerritoryState | null;
  nextState: TerritoryState;
  controlDelta: number;
  defenceDelta: number;
  /** The route hash the event was justified by. Never raw GPS. */
  evidenceHash: string | null;
  createdAt: Date;
}

/** The per-route record of what capture evaluation decided. */
export interface TerritoryCaptureSession {
  id: string;
  routeId: string;
  walletAddress: string;
  userId: string | null;
  loopClosed: boolean;
  captureEligible: boolean;
  closureDistanceMeters: number | null;
  enclosedAreaSquareMeters: number;
  traversedHexCount: number;
  capturedHexCount: number;
  /** Cells covered by the loop that produced no ownership event. */
  rejectedHexIds: string[];
  rejectionReasons: string[];
  gridVersion: number;
  resolution: number;
  createdAt: Date;
  processedAt: Date | null;
}
