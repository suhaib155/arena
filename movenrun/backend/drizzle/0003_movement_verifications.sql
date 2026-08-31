-- Server-verified movement sessions (see backend/src/db/movement.schema.ts and
-- backend/src/movement/**). Additive-only: creates one new table and its
-- constraints; touches nothing else. In particular it does NOT alter "routes",
-- which remains the wallet/oracle protocol's table.
--
-- (user_id, client_session_id) uniqueness is the movement submission
-- idempotency authority. It is the reason a concurrent retry of the same
-- completed session converges on one row instead of verifying twice: the
-- application catches the resulting 23505 and re-reads the winner. Without
-- this constraint the guarantee does not exist in production, however the
-- application code is written.
--
-- No raw GPS point, coordinate, or path column exists — only derived scalars
-- and the traversed H3 cells, consistent with the route pipeline. There is no
-- wallet, signature, or chain column here by design: this table records that a
-- USER's movement was measured, and asserts nothing about territory ownership.
--
-- Hand-authored like 0001 and 0002 (drizzle-kit generate remains blocked by
-- the pre-existing BigInt-default serialization bug in the route schema —
-- reproduced again on drizzle-kit v0.22.8 for this change; see
-- docs/CONTRACTS_AUDIT.md) and validated against an ephemeral PostgreSQL 16.

CREATE TABLE IF NOT EXISTS "movement_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"client_session_id" text NOT NULL,
	"status" text NOT NULL,
	"distance_meters" integer,
	"duration_seconds" integer,
	"traversed_hex_ids" text[],
	"confidence" real,
	"rejection_reasons" text[],
	"start_time" bigint NOT NULL,
	"end_time" bigint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "movement_verifications_user_session_unique" UNIQUE("user_id","client_session_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "movement_verifications_user_idx" ON "movement_verifications" USING btree (user_id);
