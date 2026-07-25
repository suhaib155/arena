-- Territory ownership persistence (see backend/src/db/territory.schema.ts and
-- backend/src/territory/**). Additive-only: creates five new tables and their
-- constraints; touches nothing that already exists.
--
-- Hand-authored like 0001 and 0002 (drizzle-kit generate remains blocked by the
-- pre-existing BigInt-default serialization bug in the route schema — see
-- docs/CONTRACTS_AUDIT.md) and validated against an ephemeral PostgreSQL 16.
--
-- Design notes that the schema itself encodes:
--
--   * (h3_cell_id, grid_version) is UNIQUE on "territories". This is the
--     concurrency backstop: two runners closing loops over the same untouched
--     cell at the same instant cannot both insert it. Combined with the
--     optimistic "version" column and SELECT ... FOR UPDATE in
--     territory/repository.drizzle.ts, exactly one capture wins and the loser
--     is reported as a conflict rather than silently overwriting.
--
--   * h3_resolution and grid_version are stored on EVERY territory row and are
--     never re-derived from application configuration. Changing
--     TERRITORY_H3_RESOLUTION later must not retroactively reinterpret rows
--     written under the previous one.
--
--   * "territory_ownership_events" is append-only history. There is no update
--     path in the application, and nothing here should ever add one — the
--     capture record of a cell is evidence.
--
--   * No column in any of these tables stores a coordinate, a route point, a
--     polyline, or any other raw GPS. Territory is identified by H3 cell id;
--     evidence is referenced by route id and route hash only.

CREATE TABLE IF NOT EXISTS "territories" (
	"id" text PRIMARY KEY NOT NULL,
	"h3_cell_id" text NOT NULL,
	"h3_resolution" integer NOT NULL,
	"grid_version" integer NOT NULL,
	"owner_wallet_address" text,
	"owner_user_id" text,
	"owner_club_id" text,
	"state" text DEFAULT 'neutral' NOT NULL,
	"classification" text DEFAULT 'playable' NOT NULL,
	"control_score" integer DEFAULT 0 NOT NULL,
	"defence_score" integer DEFAULT 0 NOT NULL,
	"captured_at" timestamp,
	"last_defended_at" timestamp,
	"contested_at" timestamp,
	"expires_at" timestamp,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "territories_state_valid" CHECK ("state" IN ('neutral','owned','contested','protected','restricted','dormant')),
	CONSTRAINT "territories_classification_valid" CHECK ("classification" IN ('playable','restricted','water','private','dangerous','eventOnly','park','landmark')),
	CONSTRAINT "territories_resolution_valid" CHECK ("h3_resolution" >= 0 AND "h3_resolution" <= 15),
	CONSTRAINT "territories_grid_version_positive" CHECK ("grid_version" > 0),
	CONSTRAINT "territories_scores_nonnegative" CHECK ("control_score" >= 0 AND "defence_score" >= 0),
	CONSTRAINT "territories_version_nonnegative" CHECK ("version" >= 0),
	-- An owned cell must actually name an owner, and a neutral cell must not.
	CONSTRAINT "territories_owner_matches_state" CHECK (
		("state" = 'owned' AND "owner_wallet_address" IS NOT NULL)
		OR ("state" = 'neutral' AND "owner_wallet_address" IS NULL)
		OR "state" IN ('contested','protected','restricted','dormant')
	)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "territories_cell_grid_unique" ON "territories" USING btree (h3_cell_id,grid_version);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "territories_grid_cell_idx" ON "territories" USING btree (grid_version,h3_cell_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "territories_owner_idx" ON "territories" USING btree (owner_wallet_address);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "territories_club_idx" ON "territories" USING btree (owner_club_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "territories_state_idx" ON "territories" USING btree (grid_version,state);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "territories_updated_at_idx" ON "territories" USING btree (updated_at);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "territories_expires_at_idx" ON "territories" USING btree (expires_at);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "territory_capture_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"route_id" text NOT NULL,
	"wallet_address" text NOT NULL,
	"user_id" text,
	"loop_closed" boolean DEFAULT false NOT NULL,
	"capture_eligible" boolean DEFAULT false NOT NULL,
	"closure_distance_meters" double precision,
	"enclosed_area_square_meters" double precision DEFAULT 0 NOT NULL,
	"traversed_hex_count" integer DEFAULT 0 NOT NULL,
	"captured_hex_count" integer DEFAULT 0 NOT NULL,
	"rejection_reasons" text[],
	"grid_version" integer NOT NULL,
	"resolution" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	CONSTRAINT "territory_capture_sessions_counts_nonnegative" CHECK ("traversed_hex_count" >= 0 AND "captured_hex_count" >= 0),
	CONSTRAINT "territory_capture_sessions_area_nonnegative" CHECK ("enclosed_area_square_meters" >= 0),
	-- An ineligible capture must never carry captured cells.
	CONSTRAINT "territory_capture_sessions_ineligible_captures_nothing" CHECK ("capture_eligible" OR "captured_hex_count" = 0)
);
--> statement-breakpoint
-- One capture evaluation per route: a retried worker job updates it rather than
-- accumulating rows, so a capture can never be double-reported.
CREATE UNIQUE INDEX IF NOT EXISTS "territory_capture_sessions_route_unique" ON "territory_capture_sessions" USING btree (route_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "territory_capture_sessions_wallet_idx" ON "territory_capture_sessions" USING btree (wallet_address);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "territory_capture_sessions_created_at_idx" ON "territory_capture_sessions" USING btree (created_at);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "territory_ownership_events" (
	"id" text PRIMARY KEY NOT NULL,
	"h3_cell_id" text NOT NULL,
	"grid_version" integer NOT NULL,
	"route_id" text,
	"actor_user_id" text,
	"actor_wallet_address" text,
	"event_type" text NOT NULL,
	"previous_owner" text,
	"next_owner" text,
	"previous_state" text,
	"next_state" text NOT NULL,
	"control_delta" integer DEFAULT 0 NOT NULL,
	"defence_delta" integer DEFAULT 0 NOT NULL,
	"evidence_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "territory_ownership_events_type_valid" CHECK ("event_type" IN ('captured','reinforced','attacked','contested','transferred','expired','released','restricted')),
	CONSTRAINT "territory_ownership_events_next_state_valid" CHECK ("next_state" IN ('neutral','owned','contested','protected','restricted','dormant')),
	CONSTRAINT "territory_ownership_events_previous_state_valid" CHECK ("previous_state" IS NULL OR "previous_state" IN ('neutral','owned','contested','protected','restricted','dormant'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "territory_ownership_events_cell_idx" ON "territory_ownership_events" USING btree (grid_version,h3_cell_id,created_at);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "territory_ownership_events_actor_idx" ON "territory_ownership_events" USING btree (actor_wallet_address);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "territory_ownership_events_route_idx" ON "territory_ownership_events" USING btree (route_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "territory_ownership_events_created_at_idx" ON "territory_ownership_events" USING btree (created_at);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "territory_control_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"h3_cell_id" text NOT NULL,
	"grid_version" integer NOT NULL,
	"previous_owner" text,
	"next_owner" text,
	"previous_state" text,
	"next_state" text NOT NULL,
	"territory_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "territory_control_changes_next_state_valid" CHECK ("next_state" IN ('neutral','owned','contested','protected','restricted','dormant')),
	CONSTRAINT "territory_control_changes_version_nonnegative" CHECK ("territory_version" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "territory_control_changes_cell_idx" ON "territory_control_changes" USING btree (grid_version,h3_cell_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "territory_control_changes_created_at_idx" ON "territory_control_changes" USING btree (created_at);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "territory_cell_classifications" (
	"h3_cell_id" text NOT NULL,
	"grid_version" integer NOT NULL,
	"classification" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "territory_cell_classifications_valid" CHECK ("classification" IN ('playable','restricted','water','private','dangerous','eventOnly','park','landmark'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "territory_cell_classifications_unique" ON "territory_cell_classifications" USING btree (h3_cell_id,grid_version);
