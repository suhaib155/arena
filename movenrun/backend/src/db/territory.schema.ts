/**
 * Territory ownership persistence schema.
 *
 * Combined into the single Drizzle client in db/client.ts and listed in
 * drizzle.config.ts, following the same pattern as identity.schema.ts. Imports
 * only drizzle plus the local territory string-union types — never
 * `@movenrun/shared` — so it stays resolvable independent of any package build.
 *
 * ## Invariants enforced at the DB level, not just in application code
 *  - a cell is unique **per grid version**, so a v2 row can never collide with
 *    or overwrite a row written under a different grid;
 *  - `h3Resolution` and `gridVersion` are stored on every row and are never
 *    re-inferred from application defaults after the fact;
 *  - `version` is an optimistic-concurrency counter bumped on every ownership
 *    write, so two runners cannot both capture the same neutral cell;
 *  - ownership events are append-only history — there is no update path.
 *
 * ## What is deliberately absent
 * No column anywhere stores a coordinate, a route point, a polyline, or any
 * other raw GPS. Territory is identified by H3 cell id; evidence is referenced
 * by route id and route hash only (see PHASE 18).
 */
import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  doublePrecision,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  CellClassification,
  TerritoryEventType,
  TerritoryState,
} from "../territory/types.js";

/**
 * One H3 cell's current ownership. The authoritative answer to "who holds this
 * ground right now"; history lives in `territoryOwnershipEvents`.
 */
export const territories = pgTable(
  "territories",
  {
    id: text("id").primaryKey(),
    h3CellId: text("h3_cell_id").notNull(),
    /** Stored, never inferred — see the module header. */
    h3Resolution: integer("h3_resolution").notNull(),
    gridVersion: integer("grid_version").notNull(),

    ownerWalletAddress: text("owner_wallet_address"),
    ownerUserId: text("owner_user_id"),
    ownerClubId: text("owner_club_id"),

    state: text("state").$type<TerritoryState>().notNull().default("neutral"),
    classification: text("classification")
      .$type<CellClassification>()
      .notNull()
      .default("playable"),

    controlScore: integer("control_score").notNull().default(0),
    defenceScore: integer("defence_score").notNull().default(0),

    capturedAt: timestamp("captured_at"),
    lastDefendedAt: timestamp("last_defended_at"),
    contestedAt: timestamp("contested_at"),
    expiresAt: timestamp("expires_at"),

    /** Optimistic-concurrency counter. Bumped on every ownership write. */
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    // The concurrency backstop: a cell exists at most once per grid version, so
    // two simultaneous first-captures cannot both insert.
    cellGridUnique: uniqueIndex("territories_cell_grid_unique").on(t.h3CellId, t.gridVersion),
    // The map API's hot path: "which cells in this set, on this grid".
    gridCellIdx: index("territories_grid_cell_idx").on(t.gridVersion, t.h3CellId),
    ownerIdx: index("territories_owner_idx").on(t.ownerWalletAddress),
    clubIdx: index("territories_club_idx").on(t.ownerClubId),
    stateIdx: index("territories_state_idx").on(t.gridVersion, t.state),
    updatedAtIdx: index("territories_updated_at_idx").on(t.updatedAt),
    expiresAtIdx: index("territories_expires_at_idx").on(t.expiresAt),
  }),
);

/**
 * What capture evaluation decided for one route. One row per processed route,
 * whether or not it captured anything — a rejected capture is exactly the thing
 * the runner most wants explained.
 */
export const territoryCaptureSessions = pgTable(
  "territory_capture_sessions",
  {
    id: text("id").primaryKey(),
    routeId: text("route_id").notNull(),
    walletAddress: text("wallet_address").notNull(),
    userId: text("user_id"),

    loopClosed: boolean("loop_closed").notNull().default(false),
    captureEligible: boolean("capture_eligible").notNull().default(false),
    closureDistanceMeters: doublePrecision("closure_distance_meters"),
    enclosedAreaSquareMeters: doublePrecision("enclosed_area_square_meters")
      .notNull()
      .default(0),

    /** Counts only. Awarded cell ids live in the ownership events. */
    traversedHexCount: integer("traversed_hex_count").notNull().default(0),
    capturedHexCount: integer("captured_hex_count").notNull().default(0),

    /**
     * Cells the loop covered that produced no ownership event — restricted,
     * protected, or lost to a concurrent capture. Stored as ids (which are
     * public map identifiers, not private data) rather than a bare count, so
     * the runner can be shown exactly which parts of their loop didn't land.
     */
    rejectedHexIds: text("rejected_hex_ids").array(),

    rejectionReasons: text("rejection_reasons").array(),
    gridVersion: integer("grid_version").notNull(),
    resolution: integer("resolution").notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    processedAt: timestamp("processed_at"),
  },
  (t) => ({
    // One capture evaluation per route: re-processing a route must update, not
    // accumulate, so a retried job cannot double-award.
    routeUnique: uniqueIndex("territory_capture_sessions_route_unique").on(t.routeId),
    walletIdx: index("territory_capture_sessions_wallet_idx").on(t.walletAddress),
    createdAtIdx: index("territory_capture_sessions_created_at_idx").on(t.createdAt),
  }),
);

/**
 * Append-only ownership history. Every state transition writes exactly one row
 * and no row is ever updated or deleted — the capture record of a cell is
 * evidence, and rewriting it would destroy the audit trail.
 */
export const territoryOwnershipEvents = pgTable(
  "territory_ownership_events",
  {
    id: text("id").primaryKey(),
    h3CellId: text("h3_cell_id").notNull(),
    gridVersion: integer("grid_version").notNull(),
    routeId: text("route_id"),

    actorUserId: text("actor_user_id"),
    actorWalletAddress: text("actor_wallet_address"),

    eventType: text("event_type").$type<TerritoryEventType>().notNull(),
    previousOwner: text("previous_owner"),
    nextOwner: text("next_owner"),
    previousState: text("previous_state").$type<TerritoryState>(),
    nextState: text("next_state").$type<TerritoryState>().notNull(),

    controlDelta: integer("control_delta").notNull().default(0),
    defenceDelta: integer("defence_delta").notNull().default(0),

    /** The route hash the event was justified by. Never raw GPS. */
    evidenceHash: text("evidence_hash"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    cellIdx: index("territory_ownership_events_cell_idx").on(
      t.gridVersion,
      t.h3CellId,
      t.createdAt,
    ),
    actorIdx: index("territory_ownership_events_actor_idx").on(t.actorWalletAddress),
    routeIdx: index("territory_ownership_events_route_idx").on(t.routeId),
    createdAtIdx: index("territory_ownership_events_created_at_idx").on(t.createdAt),
  }),
);

/**
 * A denormalised feed of ownership *changes* (capture, transfer, release) for
 * the realtime broadcaster and the "what changed near me" query. Distinct from
 * the full event log, which also carries score-only events.
 */
export const territoryControlChanges = pgTable(
  "territory_control_changes",
  {
    id: text("id").primaryKey(),
    h3CellId: text("h3_cell_id").notNull(),
    gridVersion: integer("grid_version").notNull(),
    previousOwner: text("previous_owner"),
    nextOwner: text("next_owner"),
    previousState: text("previous_state").$type<TerritoryState>(),
    nextState: text("next_state").$type<TerritoryState>().notNull(),
    /** The territory row's `version` after the change — lets a client discard
     *  a realtime event it has already applied or superseded. */
    territoryVersion: integer("territory_version").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    cellIdx: index("territory_control_changes_cell_idx").on(t.gridVersion, t.h3CellId),
    createdAtIdx: index("territory_control_changes_created_at_idx").on(t.createdAt),
  }),
);

/**
 * Idempotency ledger for territory application (D5).
 *
 * A BullMQ job can be retried — on a transient DB error, a worker restart, or a
 * manual re-queue. Without this table each retry re-ran the ownership rules and
 * handed out another reinforcement for the same run, silently inflating defence
 * and control from a single real route.
 *
 * `(route_id, grid_version)` is UNIQUE and is the idempotency key. The row is
 * inserted, the ownership writes are made, and the row is completed with the
 * serialised result **inside one transaction**, so:
 *
 *   - a retry after a completed attempt reads `result` back and mutates nothing;
 *   - a retry after a rolled-back attempt finds no row at all (the claim rolled
 *     back with everything else) and is safely re-runnable;
 *   - two concurrent attempts serialise on the row lock, so exactly one applies
 *     and the other replays the winner's stored result.
 *
 * `result` holds only cell ids and counts — never a coordinate.
 */
export const territoryRouteApplications = pgTable(
  "territory_route_applications",
  {
    id: text("id").primaryKey(),
    routeId: text("route_id").notNull(),
    gridVersion: integer("grid_version").notNull(),
    /** "in_progress" while the claiming transaction runs, "completed" after. */
    state: text("state").$type<"in_progress" | "completed">().notNull().default("in_progress"),
    /** Serialised ApplyCaptureResult. Null until the attempt completes. */
    result: jsonb("result"),
    /** How many times this key has been claimed — retry observability. */
    attempts: integer("attempts").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
  },
  (t) => ({
    // The idempotency key itself. This is what makes a retry a replay.
    routeGridUnique: uniqueIndex("territory_route_applications_key").on(
      t.routeId,
      t.gridVersion,
    ),
    stateIdx: index("territory_route_applications_state_idx").on(t.state),
  }),
);

/**
 * Manually configured cell classifications — the seam a future
 * OpenStreetMap-derived land-use service writes into (see PHASE 14). Kept
 * separate from `territories` so a cell can be classified before anyone has
 * ever run near it.
 */
export const territoryCellClassifications = pgTable(
  "territory_cell_classifications",
  {
    h3CellId: text("h3_cell_id").notNull(),
    gridVersion: integer("grid_version").notNull(),
    classification: text("classification").$type<CellClassification>().notNull(),
    /** Who/what set this — "manual", or a future classifier's identifier. */
    source: text("source").notNull().default("manual"),
    /** Operator-facing note. Never user-visible free text. */
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    cellGridUnique: uniqueIndex("territory_cell_classifications_unique").on(
      t.h3CellId,
      t.gridVersion,
    ),
  }),
);
