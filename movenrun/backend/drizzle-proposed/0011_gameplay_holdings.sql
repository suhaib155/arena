-- 0011 gameplay holdings: PROPOSED, NOT APPLIED.
--
-- This file is deliberately outside drizzle/ and its journal. The staging
-- start command runs `drizzle-kit migrate`, which applies every journal entry,
-- so a file in drizzle/ would reach the live database on the next deploy.
-- Promoting it (move to drizzle/0011_gameplay_holdings.sql, add the journal
-- entry and checksum) is an owner decision; see
-- docs/G34_SERVER_ARCHITECTURE.md, "Going live". The rollback is
-- 0011_gameplay_holdings.down.sql next to this file.
--
-- What it adds: server-authoritative holding state, the append-only push
-- ledger, end-of-day unit snapshots, day settlement headers and credit lines,
-- clubs, memberships, club and district day aggregates, and a district map.
-- For the versioned rule sets (backend/src/gameplay/rules.ts): the rule set
-- each day is pinned to, per-walker daily take counters, and open two-day
-- challenges. Every gameplay row of a day must carry that day's pinned
-- holding rules version (foreign keys), so nothing is silently re-read
-- under another rule set.
-- Credits are off-chain game points: nothing here is a token, a balance or a
-- transfer.
--
-- Access: row level security on every new table. Nothing is granted to anon.
-- The signed-in role (Supabase `authenticated`) may read its own rows and the
-- public aggregates, column by column; nobody but the table owner (the API's
-- server role) can write. On plain PostgreSQL the role-specific statements are
-- skipped.
--
-- Erasure: every reference to a user either cascades or is set to NULL, so
-- the existing account deletion (which deletes the user row) keeps working
-- and leaves no gameplay row naming the person.

-- ── day rules: the one rule set each day runs under ────────────────────────
-- Pinned by the day's first push (or by its settlement, for a day without
-- pushes) and never changed. Pushes, counters, day states and the
-- settlement of a day all reference (day, holding_rules_version) here, so a
-- row under any other version cannot be stored. The API refuses (fails
-- closed) a day pinned to a version or config it does not know.
CREATE TABLE IF NOT EXISTS "gameplay_day_rules" (
  "day" integer PRIMARY KEY NOT NULL CHECK ("day" >= 0),
  "season" integer NOT NULL CHECK ("season" >= 1),
  "ruleset" text NOT NULL CHECK (length("ruleset") BETWEEN 1 AND 64),
  "holding_rules_version" integer NOT NULL CHECK ("holding_rules_version" > 0),
  "takeover_policy" text NOT NULL CHECK ("takeover_policy" IN ('immediate', 'two-day-challenge')),
  -- Takes per walker per day (rules.ts TakeBudget, "takes-v1"); NULL: no budget.
  "take_budget" integer CHECK ("take_budget" IS NULL OR "take_budget" >= 1),
  "unit_zone_rule" text NOT NULL CHECK (length("unit_zone_rule") BETWEEN 1 AND 64),
  "config" jsonb NOT NULL CHECK (jsonb_typeof("config") = 'object'),
  "config_digest" text NOT NULL CHECK ("config_digest" ~ '^[0-9a-f]{64}$'),
  "pinned_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "gameplay_day_rules_day_version" UNIQUE ("day", "holding_rules_version")
);--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.gameplay_day_rules_final()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'a day''s rule set is pinned once and never changed' USING ERRCODE = 'restrict_violation';
END
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "gameplay_day_rules_final" ON "gameplay_day_rules";--> statement-breakpoint
CREATE TRIGGER "gameplay_day_rules_final" BEFORE UPDATE OR DELETE ON "gameplay_day_rules"
  FOR EACH ROW EXECUTE FUNCTION public.gameplay_day_rules_final();--> statement-breakpoint

-- ── units: the current state of each unit of ground ────────────────────────
CREATE TABLE IF NOT EXISTS "gameplay_units" (
  "unit_id" text PRIMARY KEY NOT NULL CHECK (length("unit_id") BETWEEN 1 AND 64),
  "holder_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "strength" smallint DEFAULT 0 NOT NULL CHECK ("strength" BETWEEN 0 AND 100),
  "ground" text DEFAULT 'solid' NOT NULL CHECK ("ground" IN ('solid', 'shade')),
  "deeded" boolean DEFAULT false NOT NULL,
  "masked" boolean DEFAULT false NOT NULL,
  "level" smallint DEFAULT 1 NOT NULL CHECK ("level" BETWEEN 1 AND 5),
  "fortified" boolean DEFAULT false NOT NULL,
  "as_of_day" integer NOT NULL CHECK ("as_of_day" >= 0),
  "holding_rules_version" integer NOT NULL,
  "version" bigint DEFAULT 0 NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  -- unitProblems() in shared/src/domain/holding.ts, as constraints.
  CONSTRAINT "gameplay_units_held_iff_strength" CHECK (("holder_id" IS NULL) = ("strength" = 0)),
  CONSTRAINT "gameplay_units_masked_unheld" CHECK (NOT "masked" OR "holder_id" IS NULL),
  CONSTRAINT "gameplay_units_deeded_solid_held" CHECK (NOT "deeded" OR ("ground" = 'solid' AND "holder_id" IS NOT NULL)),
  CONSTRAINT "gameplay_units_shade_ceiling" CHECK ("ground" = 'solid' OR "strength" <= 25)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gameplay_units_holder_idx" ON "gameplay_units" ("holder_id") WHERE "holder_id" IS NOT NULL;--> statement-breakpoint

-- ── unit day states: each unit as it stood at the end of each day it changed
-- Day close reads the latest row on or before the day being settled, so a
-- late settlement is not confused by pushes made on later days.
CREATE TABLE IF NOT EXISTS "gameplay_unit_day_states" (
  "unit_id" text NOT NULL REFERENCES "gameplay_units"("unit_id"),
  "day" integer NOT NULL CHECK ("day" >= 0),
  "holder_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "strength" smallint NOT NULL CHECK ("strength" BETWEEN 0 AND 100),
  "ground" text NOT NULL CHECK ("ground" IN ('solid', 'shade')),
  "deeded" boolean NOT NULL,
  "masked" boolean NOT NULL,
  "level" smallint NOT NULL CHECK ("level" BETWEEN 1 AND 5),
  "fortified" boolean NOT NULL,
  "holding_rules_version" integer NOT NULL,
  PRIMARY KEY ("unit_id", "day"),
  CONSTRAINT "gameplay_unit_day_states_day_rules" FOREIGN KEY ("day", "holding_rules_version") REFERENCES "gameplay_day_rules" ("day", "holding_rules_version"),
  CONSTRAINT "gameplay_unit_day_states_held_iff_strength" CHECK (("holder_id" IS NULL) = ("strength" = 0)),
  CONSTRAINT "gameplay_unit_day_states_masked_unheld" CHECK (NOT "masked" OR "holder_id" IS NULL),
  CONSTRAINT "gameplay_unit_day_states_deeded_solid_held" CHECK (NOT "deeded" OR ("ground" = 'solid' AND "holder_id" IS NOT NULL)),
  CONSTRAINT "gameplay_unit_day_states_shade_ceiling" CHECK ("ground" = 'solid' OR "strength" <= 25)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gameplay_unit_day_states_day_idx" ON "gameplay_unit_day_states" ("day");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gameplay_unit_day_states_holder_idx" ON "gameplay_unit_day_states" ("holder_id") WHERE "holder_id" IS NOT NULL;--> statement-breakpoint

-- When account deletion sets a holder to NULL, the unit goes back on the map
-- exactly as the holding model's unheld() leaves it, so the checks above hold.
CREATE OR REPLACE FUNCTION public.gameplay_reset_erased_holder()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.holder_id IS NULL AND OLD.holder_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = OLD.holder_id) THEN
    NEW.strength := 0;
    NEW.ground := 'solid';
    NEW.level := 1;
    NEW.fortified := false;
    NEW.deeded := false;
    -- Unheld ground has no challenges (holding.ts unitProblems).
    IF TG_TABLE_NAME = 'gameplay_units' THEN
      DELETE FROM public.gameplay_unit_challenges WHERE unit_id = NEW.unit_id;
    END IF;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "gameplay_units_reset_erased_holder" ON "gameplay_units";--> statement-breakpoint
CREATE TRIGGER "gameplay_units_reset_erased_holder" BEFORE UPDATE OF "holder_id" ON "gameplay_units"
  FOR EACH ROW EXECUTE FUNCTION public.gameplay_reset_erased_holder();--> statement-breakpoint
DROP TRIGGER IF EXISTS "gameplay_unit_day_states_reset_erased_holder" ON "gameplay_unit_day_states";--> statement-breakpoint
CREATE TRIGGER "gameplay_unit_day_states_reset_erased_holder" BEFORE UPDATE OF "holder_id" ON "gameplay_unit_day_states"
  FOR EACH ROW EXECUTE FUNCTION public.gameplay_reset_erased_holder();--> statement-breakpoint

-- ── push ledger: one append-only row per applied push, refusals included ───
CREATE TABLE IF NOT EXISTS "gameplay_push_events" (
  -- The idempotency key. The server derives it from the verified movement
  -- session and the unit, so a retried upload maps to the same ids.
  "event_id" text PRIMARY KEY NOT NULL CHECK (length("event_id") BETWEEN 1 AND 200),
  -- Insertion order. Pushes on one unit are written under its row lock, so
  -- per unit this is also commit order: the ledger can be replayed exactly.
  "seq" bigint GENERATED ALWAYS AS IDENTITY NOT NULL UNIQUE,
  "unit_id" text NOT NULL REFERENCES "gameplay_units"("unit_id"),
  "walker_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "day" integer NOT NULL CHECK ("day" >= 0),
  "push_kind" text NOT NULL CHECK ("push_kind" IN ('solid', 'shade')),
  "shade_strength" smallint CHECK ("shade_strength" BETWEEN 1 AND 25),
  -- refused_take_budget: a take past the walker's daily budget; recorded, changes nothing.
  "outcome" text NOT NULL CHECK ("outcome" IN ('claimed', 'reinforced', 'eroded', 'flipped', 'refused_deeded', 'refused_masked', 'refused_daily_limit', 'refused_take_budget')),
  "previous_holder_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "new_holder_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "strength_before" smallint NOT NULL CHECK ("strength_before" BETWEEN 0 AND 100),
  "strength_after" smallint NOT NULL CHECK ("strength_after" BETWEEN 0 AND 100),
  "holding_rules_version" integer NOT NULL,
  "source_session_id" text REFERENCES "movement_verifications"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "gameplay_push_events_shade_has_strength" CHECK (("push_kind" = 'shade') = ("shade_strength" IS NOT NULL)),
  CONSTRAINT "gameplay_push_events_day_rules" FOREIGN KEY ("day", "holding_rules_version") REFERENCES "gameplay_day_rules" ("day", "holding_rules_version")
);--> statement-breakpoint
-- Owner decision 17 Oct: a walker pushes a unit someone else holds at most
-- once per day. Pushing someone else's ground always records "eroded" or
-- "flipped", so at most one such row may exist per walker, unit and day,
-- whatever the application does.
CREATE UNIQUE INDEX IF NOT EXISTS "gameplay_push_events_one_push_per_walker_unit_day"
  ON "gameplay_push_events" ("walker_id", "unit_id", "day")
  WHERE "outcome" IN ('eroded', 'flipped');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gameplay_push_events_unit_day_idx" ON "gameplay_push_events" ("unit_id", "day");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gameplay_push_events_day_idx" ON "gameplay_push_events" ("day");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gameplay_push_events_walker_idx" ON "gameplay_push_events" ("walker_id", "day");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gameplay_push_events_source_idx" ON "gameplay_push_events" ("source_session_id") WHERE "source_session_id" IS NOT NULL;--> statement-breakpoint

-- Append-only, except for erasure: a row may be deleted only once its walker
-- or its source session is gone, and updated only to clear a holder id whose
-- user is gone.
CREATE OR REPLACE FUNCTION public.gameplay_push_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = OLD.walker_id)
       OR (OLD.source_session_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.movement_verifications WHERE id = OLD.source_session_id)) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'gameplay_push_events is append-only' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'previous_holder_id' - 'new_holder_id') = (to_jsonb(OLD) - 'previous_holder_id' - 'new_holder_id')
     AND (NEW.previous_holder_id IS NOT DISTINCT FROM OLD.previous_holder_id
          OR (NEW.previous_holder_id IS NULL AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = OLD.previous_holder_id)))
     AND (NEW.new_holder_id IS NOT DISTINCT FROM OLD.new_holder_id
          OR (NEW.new_holder_id IS NULL AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = OLD.new_holder_id))) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'gameplay_push_events is append-only' USING ERRCODE = 'restrict_violation';
END
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "gameplay_push_events_append_only" ON "gameplay_push_events";--> statement-breakpoint
CREATE TRIGGER "gameplay_push_events_append_only" BEFORE UPDATE OR DELETE ON "gameplay_push_events"
  FOR EACH ROW EXECUTE FUNCTION public.gameplay_push_events_append_only();--> statement-breakpoint

-- ── walker days: each walker's take counter for a day ──────────────────────
-- Row-locked by every batch of that walker's pushes for the day, so
-- two sessions of one walker never both spend the last take. The budget
-- itself is the day's pinned `take_budget`.
CREATE TABLE IF NOT EXISTS "gameplay_walker_days" (
  "walker_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "day" integer NOT NULL CHECK ("day" >= 0),
  "holding_rules_version" integer NOT NULL,
  "takes_used" integer DEFAULT 0 NOT NULL CHECK ("takes_used" >= 0),
  "updated_at" timestamp DEFAULT now() NOT NULL,
  PRIMARY KEY ("walker_id", "day"),
  CONSTRAINT "gameplay_walker_days_day_rules" FOREIGN KEY ("day", "holding_rules_version") REFERENCES "gameplay_day_rules" ("day", "holding_rules_version")
);--> statement-breakpoint

-- At commit, for every take written: the walker's takes that day (eroded or
-- flipped rows) equal their counter and do not exceed the day's budget.
-- Deferred, so the counter can be updated after the rows in the same
-- transaction. Whatever the application does, a 14th take under a budget of
-- 13 cannot be committed.
CREATE OR REPLACE FUNCTION public.gameplay_check_take_budget()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  n integer;
  used integer;
  budget integer;
BEGIN
  SELECT count(*) INTO n FROM public.gameplay_push_events
   WHERE walker_id = NEW.walker_id AND day = NEW.day AND outcome IN ('eroded', 'flipped');
  SELECT takes_used INTO used FROM public.gameplay_walker_days WHERE walker_id = NEW.walker_id AND day = NEW.day;
  SELECT take_budget INTO budget FROM public.gameplay_day_rules WHERE day = NEW.day;
  IF used IS NULL OR n <> used THEN
    RAISE EXCEPTION 'takes of % on day % do not match the counter', NEW.walker_id, NEW.day USING ERRCODE = 'check_violation';
  END IF;
  IF budget IS NOT NULL AND n > budget THEN
    RAISE EXCEPTION 'takes of % on day % exceed the budget', NEW.walker_id, NEW.day USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "gameplay_push_events_take_budget" ON "gameplay_push_events";--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "gameplay_push_events_take_budget" AFTER INSERT ON "gameplay_push_events"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (NEW.outcome IN ('eroded', 'flipped'))
  EXECUTE FUNCTION public.gameplay_check_take_budget();--> statement-breakpoint

-- ── open two-day challenges (rules.ts TakeoverPolicy "two-day-challenge") ───
-- Part of a unit's current state, written under the unit's row lock. One row
-- per challenger; the day the challenge opened. A challenger's erasure
-- removes their challenges; a holder's erasure removes the unit's.
CREATE TABLE IF NOT EXISTS "gameplay_unit_challenges" (
  "unit_id" text NOT NULL REFERENCES "gameplay_units"("unit_id"),
  "walker_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "first_day" integer NOT NULL CHECK ("first_day" >= 0),
  "holding_rules_version" integer NOT NULL,
  PRIMARY KEY ("unit_id", "walker_id")
);--> statement-breakpoint

-- holding.ts unitProblems: only held ground has challenges, never by its holder, never from a later day.
CREATE OR REPLACE FUNCTION public.gameplay_check_challenge()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  u record;
BEGIN
  SELECT holder_id, as_of_day, holding_rules_version INTO u FROM public.gameplay_units WHERE unit_id = NEW.unit_id;
  IF u.holder_id IS NULL OR u.holder_id = NEW.walker_id OR NEW.first_day > u.as_of_day OR u.holding_rules_version <> NEW.holding_rules_version THEN
    RAISE EXCEPTION 'challenge on unit % is inconsistent with the unit', NEW.unit_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "gameplay_unit_challenges_consistent" ON "gameplay_unit_challenges";--> statement-breakpoint
CREATE TRIGGER "gameplay_unit_challenges_consistent" BEFORE INSERT OR UPDATE ON "gameplay_unit_challenges"
  FOR EACH ROW EXECUTE FUNCTION public.gameplay_check_challenge();--> statement-breakpoint

-- ── applied sessions: one row per verified movement session turned into pushes
CREATE TABLE IF NOT EXISTS "gameplay_applied_sessions" (
  "movement_verification_id" text PRIMARY KEY NOT NULL REFERENCES "movement_verifications"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "day" integer NOT NULL CHECK ("day" >= 0),
  "applied" integer NOT NULL CHECK ("applied" >= 0),
  "skipped" integer NOT NULL CHECK ("skipped" >= 0),
  "rejected" integer NOT NULL CHECK ("rejected" >= 0),
  "outcomes" jsonb NOT NULL,
  "holding_rules_version" integer NOT NULL,
  "applied_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gameplay_applied_sessions_user_idx" ON "gameplay_applied_sessions" ("user_id", "day");--> statement-breakpoint

-- ── day settlements: one header per closed day ─────────────────────────────
CREATE TABLE IF NOT EXISTS "gameplay_day_settlements" (
  "day" integer PRIMARY KEY NOT NULL CHECK ("day" >= 0),
  "season" integer NOT NULL CHECK ("season" >= 1),
  "status" text NOT NULL CHECK ("status" IN ('settled', 'refused')),
  "ruleset" text NOT NULL,
  "economy_rules_version" integer NOT NULL,
  "holding_rules_version" integer NOT NULL,
  "pool_micro" bigint DEFAULT 0 NOT NULL CHECK ("pool_micro" >= 0),
  "minted_micro" bigint DEFAULT 0 NOT NULL CHECK ("minted_micro" >= 0),
  "credited_micro" bigint DEFAULT 0 NOT NULL CHECK ("credited_micro" >= 0),
  "toll_paid_micro" bigint DEFAULT 0 NOT NULL CHECK ("toll_paid_micro" >= 0),
  "toll_received_micro" bigint DEFAULT 0 NOT NULL CHECK ("toll_received_micro" >= 0),
  "burned_micro" bigint DEFAULT 0 NOT NULL CHECK ("burned_micro" >= 0),
  "returned_micro" bigint DEFAULT 0 NOT NULL CHECK ("returned_micro" >= 0),
  "day_share_micro" bigint DEFAULT 0 NOT NULL CHECK ("day_share_micro" >= 0),
  "players" integer DEFAULT 0 NOT NULL CHECK ("players" >= 0),
  -- Problem text can name players: never granted to the signed-in role.
  "problems" jsonb DEFAULT '[]'::jsonb NOT NULL CHECK (jsonb_typeof("problems") = 'array'),
  "clubs_status" text NOT NULL CHECK ("clubs_status" IN ('settled', 'refused', 'skipped')),
  "clubs_problems" jsonb DEFAULT '[]'::jsonb NOT NULL CHECK (jsonb_typeof("clubs_problems") = 'array'),
  -- sha256 of the canonical inputs, for an independent reconciler.
  "input_digest" text NOT NULL CHECK ("input_digest" ~ '^[0-9a-f]{64}$'),
  "settled_at" timestamp DEFAULT now() NOT NULL,
  -- Section 6.1 invariants 1 to 4, held by the database as well as the model.
  CONSTRAINT "gameplay_day_settlements_books_close" CHECK (
    "status" <> 'settled' OR (
      "minted_micro" <= "pool_micro"
      AND "minted_micro" + "returned_micro" = "pool_micro"
      AND "credited_micro" + "toll_paid_micro" + "burned_micro" = "minted_micro"
      AND "toll_paid_micro" = "toll_received_micro")),
  CONSTRAINT "gameplay_day_settlements_refused_has_problems" CHECK ("status" <> 'refused' OR jsonb_array_length("problems") > 0),
  CONSTRAINT "gameplay_day_settlements_day_rules" FOREIGN KEY ("day", "holding_rules_version") REFERENCES "gameplay_day_rules" ("day", "holding_rules_version")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gameplay_day_settlements_season_idx" ON "gameplay_day_settlements" ("season", "day");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "gameplay_credit_lines" (
  "day" integer NOT NULL REFERENCES "gameplay_day_settlements"("day"),
  "player_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "earned_micro" bigint NOT NULL CHECK ("earned_micro" >= 0),
  "toll_paid_micro" bigint NOT NULL CHECK ("toll_paid_micro" >= 0),
  "toll_received_micro" bigint NOT NULL CHECK ("toll_received_micro" >= 0),
  "recharge_micro" bigint NOT NULL CHECK ("recharge_micro" >= 0),
  "upkeep_taken_micro" bigint NOT NULL CHECK ("upkeep_taken_micro" >= 0),
  "upkeep_in_condition_micro" bigint NOT NULL CHECK ("upkeep_in_condition_micro" >= 0),
  "zones_held" integer NOT NULL CHECK ("zones_held" >= 0),
  "net_micro" bigint NOT NULL CHECK ("net_micro" >= 0),
  PRIMARY KEY ("day", "player_id"),
  CONSTRAINT "gameplay_credit_lines_net_adds_up" CHECK (
    "net_micro" = "earned_micro" - "toll_paid_micro" - "recharge_micro" - "upkeep_taken_micro" + "toll_received_micro")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gameplay_credit_lines_player_idx" ON "gameplay_credit_lines" ("player_id", "day");--> statement-breakpoint

-- At commit, a settled day's lines must add up to its header; a refused day
-- has no lines. Checked once per header, deferred so the lines can follow it
-- in the same transaction.
CREATE OR REPLACE FUNCTION public.gameplay_check_day_lines()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  n integer;
  earned bigint;
  net bigint;
  paid bigint;
  received bigint;
BEGIN
  SELECT count(*), coalesce(sum(earned_micro), 0), coalesce(sum(net_micro), 0), coalesce(sum(toll_paid_micro), 0), coalesce(sum(toll_received_micro), 0)
    INTO n, earned, net, paid, received
    FROM public.gameplay_credit_lines WHERE day = NEW.day;
  IF NEW.status = 'refused' AND n > 0 THEN
    RAISE EXCEPTION 'refused day % has credit lines', NEW.day USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'settled' AND (n <> NEW.players OR earned <> NEW.minted_micro OR net <> NEW.credited_micro + NEW.toll_received_micro
     OR paid <> NEW.toll_paid_micro OR received <> NEW.toll_received_micro) THEN
    RAISE EXCEPTION 'credit lines of day % do not add up to its books', NEW.day USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "gameplay_day_settlements_lines_add_up" ON "gameplay_day_settlements";--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "gameplay_day_settlements_lines_add_up" AFTER INSERT ON "gameplay_day_settlements"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.gameplay_check_day_lines();--> statement-breakpoint

-- A settled day is final: its header never changes or goes, and its lines
-- go only with the player (erasure). A refused header may be deleted so the
-- day can be settled again once its problem is fixed.
CREATE OR REPLACE FUNCTION public.gameplay_settlements_final()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_TABLE_NAME = 'gameplay_day_settlements' THEN
    IF TG_OP = 'DELETE' AND OLD.status = 'refused' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'a settled day is final' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = OLD.player_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'credit lines are final' USING ERRCODE = 'restrict_violation';
END
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "gameplay_day_settlements_final" ON "gameplay_day_settlements";--> statement-breakpoint
CREATE TRIGGER "gameplay_day_settlements_final" BEFORE UPDATE OR DELETE ON "gameplay_day_settlements"
  FOR EACH ROW EXECUTE FUNCTION public.gameplay_settlements_final();--> statement-breakpoint
DROP TRIGGER IF EXISTS "gameplay_credit_lines_final" ON "gameplay_credit_lines";--> statement-breakpoint
CREATE TRIGGER "gameplay_credit_lines_final" BEFORE UPDATE OR DELETE ON "gameplay_credit_lines"
  FOR EACH ROW EXECUTE FUNCTION public.gameplay_settlements_final();--> statement-breakpoint

-- ── clubs ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "gameplay_clubs" (
  "club_id" text PRIMARY KEY NOT NULL CHECK ("club_id" ~ '^[A-Za-z0-9_-]{8,64}$'),
  "name" text NOT NULL CHECK (length("name") BETWEEN 3 AND 40),
  "created_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gameplay_clubs_name_unique" ON "gameplay_clubs" (lower("name"));--> statement-breakpoint

-- Membership spans [from_day, to_day). One open membership per walker; which
-- day a change takes effect is D18 (the server's pilot proposal: next day).
CREATE TABLE IF NOT EXISTS "gameplay_club_memberships" (
  "id" text PRIMARY KEY NOT NULL,
  "club_id" text NOT NULL REFERENCES "gameplay_clubs"("club_id") ON DELETE CASCADE,
  "walker_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "from_day" integer NOT NULL CHECK ("from_day" >= 0),
  "to_day" integer CHECK ("to_day" IS NULL OR "to_day" > "from_day"),
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gameplay_club_memberships_one_open" ON "gameplay_club_memberships" ("walker_id") WHERE "to_day" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gameplay_club_memberships_club_idx" ON "gameplay_club_memberships" ("club_id");--> statement-breakpoint

-- ── district map (D20): which district each unit belongs to ────────────────
-- Loaded by an operator from versioned geographic polygons; never derived
-- from the grid. Empty until D20 is decided, and district control then
-- reports every held unit as having no district.
CREATE TABLE IF NOT EXISTS "gameplay_unit_districts" (
  "unit_id" text PRIMARY KEY NOT NULL CHECK (length("unit_id") BETWEEN 1 AND 64),
  "district_id" text NOT NULL CHECK (length("district_id") BETWEEN 1 AND 64),
  "districts_version" text NOT NULL
);--> statement-breakpoint

-- ── club and district day aggregates (public; no player ids) ────────────────
CREATE TABLE IF NOT EXISTS "gameplay_club_days" (
  "day" integer NOT NULL REFERENCES "gameplay_day_settlements"("day"),
  "club_id" text NOT NULL REFERENCES "gameplay_clubs"("club_id") ON DELETE CASCADE,
  "members" integer NOT NULL CHECK ("members" >= 0),
  -- Totals by outcome and kind (D19 counts, unweighted). Never per member.
  "contributions" jsonb NOT NULL,
  "credits_micro" bigint NOT NULL CHECK ("credits_micro" >= 0),
  PRIMARY KEY ("day", "club_id")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gameplay_district_days" (
  "day" integer NOT NULL REFERENCES "gameplay_day_settlements"("day"),
  "district_id" text NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('controlled', 'tied', 'below_share', 'no_club')),
  "controller_club_id" text REFERENCES "gameplay_clubs"("club_id") ON DELETE SET NULL,
  "held_weight" bigint NOT NULL CHECK ("held_weight" >= 0),
  -- Club ids and ground tallies only.
  "standings" jsonb NOT NULL,
  PRIMARY KEY ("day", "district_id"),
  CONSTRAINT "gameplay_district_days_controller" CHECK ("status" = 'controlled' OR "controller_club_id" IS NULL)
);--> statement-breakpoint

-- ── day attribution index on verified sessions (read at day close) ─────────
CREATE INDEX IF NOT EXISTS "movement_verifications_verified_end_time_idx" ON "movement_verifications" ("end_time") WHERE "status" = 'verified';--> statement-breakpoint

-- ── row level security ─────────────────────────────────────────────────────
ALTER TABLE "gameplay_units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gameplay_unit_day_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gameplay_push_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gameplay_applied_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gameplay_day_settlements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gameplay_credit_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gameplay_clubs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gameplay_club_memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gameplay_unit_districts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gameplay_club_days" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gameplay_district_days" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gameplay_day_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gameplay_walker_days" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gameplay_unit_challenges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- The MovenRun user behind the caller's Supabase JWT (claims as PostgREST
-- sets them), or NULL. SECURITY DEFINER so policies can resolve it without
-- the caller reading auth_identities.
CREATE OR REPLACE FUNCTION public.gameplay_current_player_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT i.user_id
    FROM public.auth_identities i
   WHERE i.provider = 'supabase'
     AND i.revoked_at IS NULL
     AND i.provider_subject = (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
   LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gameplay_current_player_id() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gameplay_reset_erased_holder() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gameplay_push_events_append_only() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gameplay_check_day_lines() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gameplay_settlements_final() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gameplay_day_rules_final() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gameplay_check_take_budget() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gameplay_check_challenge() FROM PUBLIC;--> statement-breakpoint

-- Read policies for the signed-in role. No INSERT, UPDATE or DELETE policy
-- exists for anyone: with RLS on, only the owner (the API) can write.
DROP POLICY IF EXISTS "gameplay_units_own" ON "gameplay_units";--> statement-breakpoint
CREATE POLICY "gameplay_units_own" ON "gameplay_units" FOR SELECT USING ("holder_id" = public.gameplay_current_player_id());--> statement-breakpoint
DROP POLICY IF EXISTS "gameplay_push_events_own" ON "gameplay_push_events";--> statement-breakpoint
CREATE POLICY "gameplay_push_events_own" ON "gameplay_push_events" FOR SELECT USING ("walker_id" = public.gameplay_current_player_id());--> statement-breakpoint
DROP POLICY IF EXISTS "gameplay_applied_sessions_own" ON "gameplay_applied_sessions";--> statement-breakpoint
CREATE POLICY "gameplay_applied_sessions_own" ON "gameplay_applied_sessions" FOR SELECT USING ("user_id" = public.gameplay_current_player_id());--> statement-breakpoint
DROP POLICY IF EXISTS "gameplay_credit_lines_own" ON "gameplay_credit_lines";--> statement-breakpoint
CREATE POLICY "gameplay_credit_lines_own" ON "gameplay_credit_lines" FOR SELECT USING ("player_id" = public.gameplay_current_player_id());--> statement-breakpoint
DROP POLICY IF EXISTS "gameplay_club_memberships_own" ON "gameplay_club_memberships";--> statement-breakpoint
CREATE POLICY "gameplay_club_memberships_own" ON "gameplay_club_memberships" FOR SELECT USING ("walker_id" = public.gameplay_current_player_id());--> statement-breakpoint
DROP POLICY IF EXISTS "gameplay_day_settlements_public" ON "gameplay_day_settlements";--> statement-breakpoint
CREATE POLICY "gameplay_day_settlements_public" ON "gameplay_day_settlements" FOR SELECT USING ("status" = 'settled' AND public.gameplay_current_player_id() IS NOT NULL);--> statement-breakpoint
DROP POLICY IF EXISTS "gameplay_clubs_public" ON "gameplay_clubs";--> statement-breakpoint
CREATE POLICY "gameplay_clubs_public" ON "gameplay_clubs" FOR SELECT USING (public.gameplay_current_player_id() IS NOT NULL);--> statement-breakpoint
DROP POLICY IF EXISTS "gameplay_club_days_public" ON "gameplay_club_days";--> statement-breakpoint
CREATE POLICY "gameplay_club_days_public" ON "gameplay_club_days" FOR SELECT USING (public.gameplay_current_player_id() IS NOT NULL);--> statement-breakpoint
DROP POLICY IF EXISTS "gameplay_district_days_public" ON "gameplay_district_days";--> statement-breakpoint
CREATE POLICY "gameplay_district_days_public" ON "gameplay_district_days" FOR SELECT USING (public.gameplay_current_player_id() IS NOT NULL);--> statement-breakpoint
-- gameplay_unit_day_states, gameplay_unit_districts, gameplay_day_rules,
-- gameplay_walker_days and gameplay_unit_challenges: no policy and no grant
-- for any role, server only.

-- Privileges. Supabase grants every new public table to anon and
-- authenticated by default; take that back, then give the signed-in role
-- SELECT on the columns its policies show. Nothing at all for anon.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['gameplay_units', 'gameplay_unit_day_states', 'gameplay_push_events', 'gameplay_applied_sessions',
    'gameplay_day_settlements', 'gameplay_credit_lines', 'gameplay_clubs', 'gameplay_club_memberships',
    'gameplay_unit_districts', 'gameplay_club_days', 'gameplay_district_days',
    'gameplay_day_rules', 'gameplay_walker_days', 'gameplay_unit_challenges'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.gameplay_current_player_id() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.gameplay_current_player_id() TO authenticated;
    GRANT SELECT ("unit_id", "holder_id", "strength", "ground", "deeded", "level", "fortified", "as_of_day") ON public.gameplay_units TO authenticated;
    GRANT SELECT ("event_id", "unit_id", "walker_id", "day", "push_kind", "outcome", "strength_before", "strength_after") ON public.gameplay_push_events TO authenticated;
    GRANT SELECT ("movement_verification_id", "user_id", "day", "applied", "skipped", "rejected", "outcomes") ON public.gameplay_applied_sessions TO authenticated;
    GRANT SELECT ("day", "player_id", "earned_micro", "toll_paid_micro", "toll_received_micro", "recharge_micro", "upkeep_taken_micro",
      "upkeep_in_condition_micro", "zones_held", "net_micro") ON public.gameplay_credit_lines TO authenticated;
    GRANT SELECT ("id", "club_id", "walker_id", "from_day", "to_day") ON public.gameplay_club_memberships TO authenticated;
    GRANT SELECT ("day", "season", "status", "pool_micro", "minted_micro", "credited_micro", "toll_paid_micro", "toll_received_micro",
      "burned_micro", "returned_micro", "day_share_micro", "players", "clubs_status", "settled_at") ON public.gameplay_day_settlements TO authenticated;
    GRANT SELECT ("club_id", "name", "created_at") ON public.gameplay_clubs TO authenticated;
    GRANT SELECT ON public.gameplay_club_days TO authenticated;
    GRANT SELECT ON public.gameplay_district_days TO authenticated;
  END IF;
END
$$;
