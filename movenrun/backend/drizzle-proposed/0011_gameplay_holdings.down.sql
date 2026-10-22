-- Rollback for 0011_gameplay_holdings.sql (revision 3). Removes everything
-- 0011 added and nothing else: migrations 0000 to 0010 and their data are
-- untouched.
--
-- THIS IS NOT A HARMLESS ROLLBACK. It permanently destroys every gameplay
-- record:
--   - holdings (gameplay_units) and every end-of-day unit snapshot;
--   - the append-only push ledger, every day partition of it, and the
--     gameplay_partitions schema that holds them;
--   - every walker's day counters: takes, verified units, refusal counts and
--     the refused-visit evidence;
--   - every player day proof, so archived ledger partitions can no longer be
--     checked against the database;
--   - settled days, credit lines, club and district day aggregates, clubs and
--     memberships;
--   - applied-session receipts, the rule set pinned to each day, open
--     challenges, the district map and the player numbers;
--   - every stored 1002 session path: an unapplied 1002 session can then
--     never be applied (its raw fixes were never stored);
--   - the sequences behind ledger order and source numbers.
-- Settled days are meant to be final; after this they cannot be reconciled
-- or replayed. Take a pg_dump of the gameplay_* tables and the
-- gameplay_partitions schema first, and treat running this as its own owner
-- decision. If 0011 was promoted into drizzle/, also delete its row from
-- drizzle.__drizzle_migrations in the same transaction, or a later
-- `drizzle-kit migrate` will not re-apply it.
DROP TABLE IF EXISTS "gameplay_session_paths";--> statement-breakpoint
DROP TABLE IF EXISTS "gameplay_unit_challenges";--> statement-breakpoint
DROP TABLE IF EXISTS "gameplay_walker_days";--> statement-breakpoint
DROP TABLE IF EXISTS "gameplay_district_days";--> statement-breakpoint
DROP TABLE IF EXISTS "gameplay_club_days";--> statement-breakpoint
DROP TABLE IF EXISTS "gameplay_unit_districts";--> statement-breakpoint
DROP TABLE IF EXISTS "gameplay_club_memberships";--> statement-breakpoint
DROP TABLE IF EXISTS "gameplay_clubs";--> statement-breakpoint
DROP TABLE IF EXISTS "gameplay_credit_lines";--> statement-breakpoint
DROP TABLE IF EXISTS "gameplay_day_settlements";--> statement-breakpoint
DROP TABLE IF EXISTS "gameplay_player_day_proofs";--> statement-breakpoint
DROP TABLE IF EXISTS "gameplay_applied_sessions";--> statement-breakpoint
DROP TABLE IF EXISTS "gameplay_push_events";--> statement-breakpoint
DROP TABLE IF EXISTS "gameplay_unit_day_states";--> statement-breakpoint
DROP TABLE IF EXISTS "gameplay_units";--> statement-breakpoint
DROP TABLE IF EXISTS "gameplay_players";--> statement-breakpoint
DROP TABLE IF EXISTS "gameplay_day_rules";--> statement-breakpoint
-- Empty once the partitioned tables are gone; without CASCADE, so anything
-- else someone put there stops the rollback instead of being dropped.
DROP SCHEMA IF EXISTS "gameplay_partitions";--> statement-breakpoint
DROP SEQUENCE IF EXISTS "gameplay_push_seq";--> statement-breakpoint
DROP SEQUENCE IF EXISTS "gameplay_source_no_seq";--> statement-breakpoint
DROP INDEX IF EXISTS "movement_verifications_verified_end_time_idx";--> statement-breakpoint
DROP FUNCTION IF EXISTS public.gameplay_ensure_day_partitions(integer, integer);--> statement-breakpoint
DROP FUNCTION IF EXISTS public.gameplay_current_player_id();--> statement-breakpoint
DROP FUNCTION IF EXISTS public.gameplay_settlements_final();--> statement-breakpoint
DROP FUNCTION IF EXISTS public.gameplay_check_day_lines();--> statement-breakpoint
DROP FUNCTION IF EXISTS public.gameplay_push_events_append_only();--> statement-breakpoint
DROP FUNCTION IF EXISTS public.gameplay_reset_erased_holder();--> statement-breakpoint
DROP FUNCTION IF EXISTS public.gameplay_reset_erased_state_holder();--> statement-breakpoint
DROP FUNCTION IF EXISTS public.gameplay_check_challenge();--> statement-breakpoint
DROP FUNCTION IF EXISTS public.gameplay_check_take_budget();--> statement-breakpoint
DROP FUNCTION IF EXISTS public.gameplay_day_rules_final();
