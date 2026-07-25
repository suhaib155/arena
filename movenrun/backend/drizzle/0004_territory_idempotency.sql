-- Territory application idempotency ledger (D5). See
-- backend/src/db/territory.schema.ts and backend/src/territory/ownership.service.ts.
--
-- Additive-only: creates one new table and its constraints. Touches no existing
-- table, so it applies cleanly both to a fresh database and to one already at
-- 0003.
--
-- Why this exists
-- ---------------
-- A BullMQ job can be retried: a transient DB error, a worker restart, or a
-- manual re-queue all re-run the same routeId. Before this table, each retry
-- re-ran the ownership rules and awarded ANOTHER reinforcement for the same
-- run — defence 10 -> 16 -> 22 from one real route.
--
-- (route_id, grid_version) is UNIQUE and is the idempotency key. The claim, the
-- ownership writes and the completion are all made in ONE transaction, which is
-- what gives the three guarantees:
--
--   * retry after completion  -> the row is `completed`, its `result` is
--                                replayed, and nothing is mutated;
--   * retry after rollback    -> the claim rolled back with everything else, so
--                                no row exists and the work is safely re-runnable;
--   * concurrent retries      -> both contend for the same row; the loser blocks
--                                on the lock, then reads `completed` and replays.
--
-- `result` stores cell ids and counts only. No coordinate, route point or
-- polyline is ever written here.

CREATE TABLE IF NOT EXISTS "territory_route_applications" (
	"id" text PRIMARY KEY NOT NULL,
	"route_id" text NOT NULL,
	"grid_version" integer NOT NULL,
	"state" text DEFAULT 'in_progress' NOT NULL,
	"result" jsonb,
	"attempts" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "territory_route_applications_state_valid" CHECK ("state" IN ('in_progress','completed')),
	CONSTRAINT "territory_route_applications_attempts_positive" CHECK ("attempts" >= 1),
	CONSTRAINT "territory_route_applications_grid_version_positive" CHECK ("grid_version" > 0),
	-- A completed application must carry the result it is meant to replay, and
	-- an in-progress one must not pretend to have one.
	CONSTRAINT "territory_route_applications_completed_has_result" CHECK (
		("state" = 'completed' AND "result" IS NOT NULL AND "completed_at" IS NOT NULL)
		OR ("state" = 'in_progress' AND "result" IS NULL AND "completed_at" IS NULL)
	)
);
--> statement-breakpoint
-- The idempotency key. This is what turns a retry into a replay.
CREATE UNIQUE INDEX IF NOT EXISTS "territory_route_applications_key" ON "territory_route_applications" USING btree (route_id,grid_version);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "territory_route_applications_state_idx" ON "territory_route_applications" USING btree (state);
