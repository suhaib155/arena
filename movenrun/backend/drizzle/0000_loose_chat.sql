CREATE TABLE IF NOT EXISTS "battles" (
	"id" text PRIMARY KEY NOT NULL,
	"hex_id" text NOT NULL,
	"challenger" text NOT NULL,
	"defender" text NOT NULL,
	"challenge_start" timestamp NOT NULL,
	"challenge_end" timestamp NOT NULL,
	"challenger_score" text DEFAULT '0',
	"defender_score" text DEFAULT '0',
	"resolved" boolean DEFAULT false NOT NULL,
	"winner" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hex_activities" (
	"hex_id" text PRIMARY KEY NOT NULL,
	"weekly_mover_count" integer DEFAULT 0 NOT NULL,
	"monthly_mover_count" integer DEFAULT 0 NOT NULL,
	"total_distance_meters" bigint DEFAULT 0 NOT NULL,
	"top_mover" text,
	"top_mover_distance_meters" bigint DEFAULT 0 NOT NULL,
	"last_activity_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "routes" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet_address" text NOT NULL,
	"status" text DEFAULT 'SUBMITTED' NOT NULL,
	"distance_meters" integer,
	"route_hash" text,
	"hex_id" text,
	"confidence" real,
	"oracle_sig" text,
	"start_time" bigint NOT NULL,
	"end_time" bigint NOT NULL,
	"earned_amount" text,
	"rejection_reasons" text[],
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "routes_route_hash_unique" UNIQUE("route_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_route_hexes" (
	"id" text PRIMARY KEY NOT NULL,
	"route_id" text NOT NULL,
	"wallet_address" text NOT NULL,
	"hex_id" text NOT NULL,
	"distance_meters" integer NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zones" (
	"hex_id" text PRIMARY KEY NOT NULL,
	"token_id" text NOT NULL,
	"owner" text NOT NULL,
	"ownership_start" timestamp NOT NULL,
	"last_activity" timestamp,
	"is_dormant" boolean DEFAULT false NOT NULL,
	"accumulated_yield" text DEFAULT '0' NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_route_hexes" ADD CONSTRAINT "user_route_hexes_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "battles_hex_idx" ON "battles" USING btree (hex_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "routes_wallet_idx" ON "routes" USING btree (wallet_address);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "routes_status_idx" ON "routes" USING btree (status);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "routes_wallet_time_idx" ON "routes" USING btree (wallet_address,start_time,end_time);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hex_user_idx" ON "user_route_hexes" USING btree (hex_id,wallet_address);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_route_hex_route_idx" ON "user_route_hexes" USING btree (route_id);