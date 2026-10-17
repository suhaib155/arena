-- Rollback for 0011_gameplay_holdings.sql. Removes everything 0011 added and
-- nothing else: migrations 0000 to 0010 and their data are untouched.
--
-- It destroys all gameplay data (holdings, the push ledger, settled credits,
-- clubs). Take a backup first if any of it must be kept. If 0011 was promoted
-- into drizzle/, also delete its row from drizzle.__drizzle_migrations in the
-- same transaction, or a later `drizzle-kit migrate` will not re-apply it.
DROP TABLE IF EXISTS "gameplay_district_days";--> statement-breakpoint
DROP TABLE IF EXISTS "gameplay_club_days";--> statement-breakpoint
DROP TABLE IF EXISTS "gameplay_unit_districts";--> statement-breakpoint
DROP TABLE IF EXISTS "gameplay_club_memberships";--> statement-breakpoint
DROP TABLE IF EXISTS "gameplay_clubs";--> statement-breakpoint
DROP TABLE IF EXISTS "gameplay_credit_lines";--> statement-breakpoint
DROP TABLE IF EXISTS "gameplay_day_settlements";--> statement-breakpoint
DROP TABLE IF EXISTS "gameplay_applied_sessions";--> statement-breakpoint
DROP TABLE IF EXISTS "gameplay_push_events";--> statement-breakpoint
DROP TABLE IF EXISTS "gameplay_unit_day_states";--> statement-breakpoint
DROP TABLE IF EXISTS "gameplay_units";--> statement-breakpoint
DROP INDEX IF EXISTS "movement_verifications_verified_end_time_idx";--> statement-breakpoint
DROP FUNCTION IF EXISTS public.gameplay_current_player_id();--> statement-breakpoint
DROP FUNCTION IF EXISTS public.gameplay_settlements_final();--> statement-breakpoint
DROP FUNCTION IF EXISTS public.gameplay_check_day_lines();--> statement-breakpoint
DROP FUNCTION IF EXISTS public.gameplay_push_events_append_only();--> statement-breakpoint
DROP FUNCTION IF EXISTS public.gameplay_reset_erased_holder();
