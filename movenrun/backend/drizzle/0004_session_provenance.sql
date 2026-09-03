-- Session provenance for movement verifications (PR #92).
--
-- Every column is nullable, and that is the design rather than a convenience.
-- NULL means "captured before the session model existed": the mode was never
-- chosen, the rules version did not exist, and the lifecycle window was never
-- recorded. A NOT NULL column with a default would have been easier and would
-- have asserted that historical sessions followed rules that had not been
-- written when they ran.
--
-- Nothing added here is measurement or location. `movement_mode` and
-- `rules_version` are provenance; `started_at`/`finished_at` are the lifecycle
-- window, distinct from the existing `start_time`/`end_time`, which bound the
-- observations; `paused_ms` is a total, deliberately not the pause intervals —
-- the durations are what later interpretation needs, and the timestamps would
-- be a finer-grained record of when someone stood still.
--
-- No index is added: nothing queries on these yet, and the existing
-- (user_id, client_session_id) unique constraint that carries idempotency is
-- untouched.
ALTER TABLE "movement_verifications" ADD COLUMN "movement_mode" text;--> statement-breakpoint
ALTER TABLE "movement_verifications" ADD COLUMN "rules_version" integer;--> statement-breakpoint
ALTER TABLE "movement_verifications" ADD COLUMN "started_at" bigint;--> statement-breakpoint
ALTER TABLE "movement_verifications" ADD COLUMN "finished_at" bigint;--> statement-breakpoint
ALTER TABLE "movement_verifications" ADD COLUMN "paused_ms" integer;
