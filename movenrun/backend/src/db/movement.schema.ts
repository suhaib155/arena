import { pgTable, text, integer, bigint, boolean, real, timestamp, index, unique } from "drizzle-orm/pg-core";
import type { MovementMode } from "@movenrun/shared/session";
import type { SealMethod } from "@movenrun/shared/sealing";

import type { MovementVerificationStatus } from "../movement/domain/types.js";

/**
 * Server-verified movement sessions — the identity-domain movement record.
 *
 * Deliberately NOT the `routes` table in ./schema.ts. That table is the
 * wallet/oracle protocol: it is keyed by `wallet_address`, carries `oracle_sig`
 * and `route_hash`, and exists to produce an on-chain claim. This app has no
 * wallet (ADR-0011 is Blocked, no embedded-wallet provider is wired), so
 * reusing it would mean inventing a nullable or fabricated wallet identity to
 * satisfy a chain protocol that is not being exercised. Two different trust
 * boundaries deserve two tables.
 *
 * What this one is: "a session belonging to an authenticated USER was measured
 * by the server". It carries no wallet, no signature, and no chain artefact,
 * and it says nothing about territory ownership.
 *
 * Raw GPS points are never persisted — only the derived scalars and the
 * traversed H3 cells, matching the privacy stance of the route pipeline.
 */
export const movementVerifications = pgTable("movement_verifications", {
  id: text("id").primaryKey(),
  /** Resolved from the bearer token's session. NEVER from the request body. */
  userId: text("user_id").notNull(),
  /** Stable id minted by the client for one completed session. The
   *  idempotency key, together with user_id. */
  clientSessionId: text("client_session_id").notNull(),
  status: text("status").$type<MovementVerificationStatus>().notNull(),
  distanceMeters: integer("distance_meters"),
  durationSeconds: integer("duration_seconds"),
  /** H3 cells the route passed through. Traversal only — this is NOT capture,
   *  and confers no ownership. There is no server-side territory model yet. */
  traversedHexIds: text("traversed_hex_ids").array(),
  confidence: real("confidence"),
  rejectionReasons: text("rejection_reasons").array(),
  /** Observation window: the first and last accepted fix. */
  startTime: bigint("start_time", { mode: "number" }).notNull(),
  endTime: bigint("end_time", { mode: "number" }).notNull(),
  /* ── session provenance (PR #92) ──────────────────────────────────────────
     All nullable, and NULL is load-bearing: it marks a session captured before
     the session model existed, or submitted by a build that predates it. A
     NOT NULL column with a default would have been more convenient and would
     have asserted that every historical session followed rules that did not
     exist when it ran. Nothing here is measurement — mode and rules version
     are provenance, and the lifecycle window is distinct from the observation
     window above. No coordinates, and no pause timestamps: a total, not the
     intervals. */
  movementMode: text("movement_mode").$type<MovementMode>(),
  rulesVersion: integer("rules_version"),
  startedAt: bigint("started_at", { mode: "number" }),
  finishedAt: bigint("finished_at", { mode: "number" }),
  pausedMs: integer("paused_ms"),
  /* ── sealing (PR #93) ─────────────────────────────────────────────────────
     The summary, and only the summary. NULL means the sealing engine never ran
     on this row — it predates the engine, carried no provenance, or the session
     was rejected — which is a different fact from `false`, meaning the route
     was evaluated and did not close. No intersection coordinate, no polygon and
     no route index is stored: a durable record of WHERE a loop closed would be
     finer-grained movement data than this table has ever held, and the geometry
     is recomputable from the route the client still has. */
  sealed: boolean("sealed"),
  sealMethods: text("seal_methods").array().$type<SealMethod[]>(),
  sealEventCount: integer("seal_event_count"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("movement_verifications_user_idx").on(t.userId),
  /* The idempotency invariant, enforced by the DATABASE rather than by a
     process-local cache. Two concurrent retries of the same completed session
     race to insert; exactly one wins and the loser re-reads the winner's row.
     A single-process in-memory guard (as used for the wallet route's nonce
     cache) would not survive a restart and would not hold across replicas. */
  userSessionUnique: unique("movement_verifications_user_session_unique").on(
    t.userId,
    t.clientSessionId,
  ),
}));
