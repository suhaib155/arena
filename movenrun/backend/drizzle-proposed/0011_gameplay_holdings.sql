-- 0011 gameplay holdings: PROPOSED, NOT APPLIED. Revision 3 (revision 2's
-- compact storage plus rule set 1002's session paths, default-deny access).
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
-- ledger (accepted pushes only, in day partitions), per-walker day counters
-- (takes, verified units, refusals as counts), per-player day proofs,
-- end-of-day unit snapshots, day settlement headers and credit lines, clubs,
-- memberships, club and district day aggregates, and a district map. For the
-- versioned rule sets (backend/src/gameplay/rules.ts): the rule set each day
-- is pinned to and open two-day challenges. Every gameplay row of a day must
-- carry that day's pinned holding rules version (foreign keys), so nothing is
-- silently re-read under another rule set.
-- Credits are off-chain game points: nothing here is a token, a balance or a
-- transfer.
--
-- Storage (docs/G34_STORAGE_CAPACITY.md): units are H3 cells stored as
-- bigint (the 64-bit index the hex string spells; only valid lowercase cells
-- are stored), players in the high-volume tables are integer surrogates
-- (gameplay_players), a push's event id is derived from (source, unit) and
-- never stored as text, refused pushes are counters on the walker's day row
-- rather than one row each, and the ledger and the day counters live in
-- one-day range partitions that a retention job can export and drop whole.
-- No retention runs today; every TTL is an owner decision.
--
-- Revision 3 changelog (revisions 1 and 2 were never applied anywhere):
--   new: gameplay_session_paths, folded in from the 1002 addendum
--        (drizzle-proposed/1002_session_paths.sql, now removed): the
--        resolution 10 path rule set 1002 derives once from the verified
--        fixes, bigint unit ids plus one interpolated bit per unit.
--   gameplay_unit_challenges  + opened_received_at timestamptz NOT NULL: the
--                         server's receipt time of the push that opened the
--                         challenge (the session row's created_at, or the
--                         server clock for a server batch), never a client
--                         clock. Read by 1002's 20-hour second-push gap.
--   gameplay_day_settlements + receipt_cutoff_at timestamptz NOT NULL: the
--                         day's close plus grace; sessions the server received
--                         at or after it count for no day (Track B finding 1).
--   movement_verifications: trigger gameplay_movement_receipt_immutable
--                         refuses any UPDATE that changes created_at, the
--                         server receipt time settlement selects by.
--   access: default deny on every table. The signed-in role's read policies
--        and column grants of revision 2 are removed, as is
--        gameplay_current_player_id(); anon and authenticated get nothing on
--        any gameplay table, partition, sequence, function or schema. The
--        API (table owner) serves every read.
--   movement_verifications + territory_seal_version smallint,
--                         territory_sealed boolean, territory_seal_reason text
--                         (sealing v2, docs/g34/SEALING_V2_28OCT.md): the
--                         server's own finding, at verification, that the
--                         accepted fixes enclose ground (enclosed-loop rule).
--                         All NULL unless gameplay asked for it; written once
--                         (trigger gameplay_movement_territory_seal_once).
--                         Reason codes only: no location, area or polygon.
--                         + territory_claim_units bigint[],
--                         territory_claim_resolution smallint: the cells a
--                         sealed session may claim (on or inside a qualifying
--                         loop), a subset-or-equal of cells the row already
--                         locates; NULL unless sealed. Reason code
--                         work_budget_exceeded added.
--   gameplay_ensure_day_partitions: a partition another creator committed
--        while this one waited for the lock is skipped instead of failing
--        the push with 42P07 (found by 40 concurrent first pushes of a day).
--   gameplay_account_deletion_jobs (30 Oct): durable account erasure jobs, one open
--        job per account, leased by the API's worker, completed in the
--        erasure transaction, user id cleared on completion; completed rows
--        purged 30 days after completion (partial index on completed_at).
--   unchanged from revision 2: the day-partitioned ledger and walker days,
--        bigint units, integer player numbers, refusal counters, player day
--        proofs and the unit budget counter the capacity guard scales.
--
-- Revision 2 changelog (revision 1 was never applied anywhere):
--   gameplay_push_events  event_id text PK, seq identity UNIQUE, unit_id text,
--                         walker_id/previous_holder_id/new_holder_id text,
--                         push_kind text, outcome text (8 values, refusals
--                         included), source_session_id text FK (cascade),
--                         created_at, 5 secondary indexes
--                     ->  PARTITION BY RANGE (day); unit bigint, seq bigint
--                         (sequence, no index), source_no int, walker_no /
--                         previous_holder_no / new_holder_no int,
--                         outcome smallint 1-4 (accepted pushes only),
--                         shade_strength smallint (0 = stepped on);
--                         PK (source_no, unit, day) is the derived event id;
--                         one-push unique (walker_no, day, unit) and the
--                         takers index (unit, day), both partial on takes.
--                         No FK to the movement session: deleting a session
--                         no longer deletes ledger rows.
--   gameplay_walker_days  walker_id text, takes_used, updated_at
--                     ->  PARTITION BY RANGE (day); walker_no int, takes_used,
--                         units_used (verified unit budget), refused_deeded,
--                         refused_masked, refused_daily_limit,
--                         refused_take_budget, visit_units bigint[] (one
--                         refused stepped-on unit per zone: settlement's
--                         visits and bounded dispute evidence, at most 1000).
--   gameplay_applied_sessions  movement_verification_id text PK, outcomes jsonb
--                     ->  source_no int PK, movement_verification_id text
--                         UNIQUE (or batch_key text UNIQUE for server
--                         batches), outcome_counts int[8], rejected_by_reason
--                         jsonb NULL when empty.
--   gameplay_units, gameplay_unit_challenges, gameplay_unit_districts
--                         unit_id text -> unit bigint.
--   gameplay_unit_day_states  unit_id text, holder_id text, ground text
--                     ->  unit bigint, holder_no int, shade boolean.
--   new: gameplay_players (user id <-> player_no), gameplay_player_day_proofs
--        (one row per walker and settled day: counts and a sha256 of the day's
--        accepted pushes), schema gameplay_partitions, sequences
--        gameplay_push_seq and gameplay_source_no_seq, function
--        gameplay_ensure_day_partitions.
--   removed: the signed-in role's read policy and column grant on
--        gameplay_push_events (the ledger, counters, proofs and players are
--        server only; the API serves every read).
--   unchanged: gameplay_day_rules, gameplay_day_settlements,
--        gameplay_credit_lines, gameplay_clubs, gameplay_club_memberships,
--        gameplay_club_days, gameplay_district_days, the end_time index.
--
-- Access: default deny. Row level security is on for every new table and
-- every partition, no policy exists for any role, and nothing is granted to
-- anon or authenticated (Supabase's default grants on new public tables are
-- revoked). Only the table owner (the API's server role) reads or writes;
-- the API serves every gameplay read. Partitions live in their own schema,
-- which no API role can use. On plain PostgreSQL the role-specific
-- statements are skipped.
--
-- Erasure (revision 3, erasure amendment; docs/G34_ERASURE_TOMBSTONES.md):
-- account deletion runs the gameplay erasure step (GameplayService
-- eraseBegin/eraseComplete, called by identity/accountDeletion.ts) before it
-- deletes the user row. That step deletes every row naming the person (their
-- player number, ledger rows, day rows, proofs, memberships, held ground and
-- challenges), replaces each of their settled credit lines with a random
-- per-line tombstone, and advances each affected settled day's erasure state
-- (gameplay_erasure_days: one row per day, never per erasure) from the
-- day's stored input digest to its digest after the erasure. The reconciler
-- accepts a day's changed inputs only through that state. The tombstone is a
-- random uuid: nothing maps it back to the person or to their other days. gameplay_players,
-- gameplay_credit_lines and gameplay_club_memberships no longer cascade from
-- users (RESTRICT / NO ACTION): deleting a user without the erasure step
-- fails instead of silently breaking a closed day's books.
--
-- Resume (erasure amendment): a resume row in gameplay_settlement_halts must
-- name a resume request (gameplay_resume_requests) that recorded a fresh
-- reconciliation proof of every closed day and carries two approvals by
-- distinct actors, neither of them the requester
-- (gameplay_resume_approvals), for the halt that is current. No single
-- operator can resume.

-- ── day rules: the one rule set each day runs under ────────────────────────
-- Pinned by the day's first push (or by its settlement, for a day without
-- pushes) and never changed. Pushes, counters, day states, proofs and the
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

-- ── players: a compact number for each user who has pushed ────────────────
-- The high-volume tables name players by this number (4 bytes) instead of
-- the user id (a 36-character text). Created by the server on a user's first
-- push; deleted by the erasure step, which cascades or nulls every row
-- naming the number. RESTRICT: a user row cannot go while its player row
-- exists, so a deletion that skipped the erasure step fails closed.
CREATE TABLE IF NOT EXISTS "gameplay_players" (
  "player_no" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "user_id" text NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

-- ── units: the current state of each unit of ground ────────────────────────
-- `unit` is the H3 cell's 64-bit index (the hex string read as a number). A
-- cell index has its top bit clear and mode 1 in bits 59-62.
CREATE TABLE IF NOT EXISTS "gameplay_units" (
  "unit" bigint PRIMARY KEY NOT NULL CHECK ("unit" > 0 AND (("unit" >> 59) & 15) = 1),
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
  "unit" bigint NOT NULL REFERENCES "gameplay_units"("unit"),
  "day" integer NOT NULL CHECK ("day" >= 0),
  "holder_no" integer REFERENCES "gameplay_players"("player_no") ON DELETE SET NULL,
  "holding_rules_version" integer NOT NULL,
  "strength" smallint NOT NULL CHECK ("strength" BETWEEN 0 AND 100),
  "level" smallint NOT NULL CHECK ("level" BETWEEN 1 AND 5),
  "shade" boolean NOT NULL,
  "deeded" boolean NOT NULL,
  "masked" boolean NOT NULL,
  "fortified" boolean NOT NULL,
  PRIMARY KEY ("unit", "day"),
  CONSTRAINT "gameplay_unit_day_states_day_rules" FOREIGN KEY ("day", "holding_rules_version") REFERENCES "gameplay_day_rules" ("day", "holding_rules_version"),
  CONSTRAINT "gameplay_unit_day_states_held_iff_strength" CHECK (("holder_no" IS NULL) = ("strength" = 0)),
  CONSTRAINT "gameplay_unit_day_states_masked_unheld" CHECK (NOT "masked" OR "holder_no" IS NULL),
  CONSTRAINT "gameplay_unit_day_states_deeded_solid_held" CHECK (NOT "deeded" OR (NOT "shade" AND "holder_no" IS NOT NULL)),
  CONSTRAINT "gameplay_unit_day_states_shade_ceiling" CHECK (NOT "shade" OR "strength" <= 25)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gameplay_unit_day_states_day_idx" ON "gameplay_unit_day_states" ("day");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gameplay_unit_day_states_holder_idx" ON "gameplay_unit_day_states" ("holder_no") WHERE "holder_no" IS NOT NULL;--> statement-breakpoint

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
    DELETE FROM public.gameplay_unit_challenges WHERE unit = NEW.unit;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "gameplay_units_reset_erased_holder" ON "gameplay_units";--> statement-breakpoint
CREATE TRIGGER "gameplay_units_reset_erased_holder" BEFORE UPDATE OF "holder_id" ON "gameplay_units"
  FOR EACH ROW EXECUTE FUNCTION public.gameplay_reset_erased_holder();--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.gameplay_reset_erased_state_holder()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.holder_no IS NULL AND OLD.holder_no IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.gameplay_players WHERE player_no = OLD.holder_no) THEN
    NEW.strength := 0;
    NEW.shade := false;
    NEW.level := 1;
    NEW.fortified := false;
    NEW.deeded := false;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "gameplay_unit_day_states_reset_erased_holder" ON "gameplay_unit_day_states";--> statement-breakpoint
CREATE TRIGGER "gameplay_unit_day_states_reset_erased_holder" BEFORE UPDATE OF "holder_no" ON "gameplay_unit_day_states"
  FOR EACH ROW EXECUTE FUNCTION public.gameplay_reset_erased_state_holder();--> statement-breakpoint

-- ── push ledger: one append-only row per accepted push, in day partitions ──
-- Accepted means the push changed or refreshed ground: claimed (1),
-- reinforced (2), eroded (3) or flipped (4). Refused pushes change nothing
-- and are counted on the walker's day row (gameplay_walker_days) instead.
-- The event id the API and the holding model use is "<source>:<cell>"; here
-- it is (source_no, unit), the primary key with the day. A movement session
-- is one source (gameplay_applied_sessions.source_no), as is a server batch.
-- `seq` is insertion order from a sequence: pushes on one unit are written
-- under its row lock, so per unit it is also commit order and the ledger can
-- be replayed exactly. It has no index; nothing looks a row up by it.
CREATE SEQUENCE IF NOT EXISTS "gameplay_push_seq" AS bigint;--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS "gameplay_source_no_seq" AS integer;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gameplay_push_events" (
  "unit" bigint NOT NULL REFERENCES "gameplay_units"("unit"),
  "seq" bigint DEFAULT nextval('gameplay_push_seq') NOT NULL,
  "day" integer NOT NULL CHECK ("day" >= 0),
  "source_no" integer NOT NULL CHECK ("source_no" > 0),
  "walker_no" integer NOT NULL REFERENCES "gameplay_players"("player_no") ON DELETE CASCADE,
  "previous_holder_no" integer REFERENCES "gameplay_players"("player_no") ON DELETE SET NULL,
  "new_holder_no" integer REFERENCES "gameplay_players"("player_no") ON DELETE SET NULL,
  "holding_rules_version" integer NOT NULL,
  "strength_before" smallint NOT NULL CHECK ("strength_before" BETWEEN 0 AND 100),
  "strength_after" smallint NOT NULL CHECK ("strength_after" BETWEEN 0 AND 100),
  "outcome" smallint NOT NULL CHECK ("outcome" BETWEEN 1 AND 4),
  -- 0: stepped on (solid); 1-25: shade at that strength.
  "shade_strength" smallint DEFAULT 0 NOT NULL CHECK ("shade_strength" BETWEEN 0 AND 25),
  PRIMARY KEY ("source_no", "unit", "day"),
  CONSTRAINT "gameplay_push_events_day_rules" FOREIGN KEY ("day", "holding_rules_version") REFERENCES "gameplay_day_rules" ("day", "holding_rules_version")
) PARTITION BY RANGE ("day");--> statement-breakpoint
-- Owner decision 17 Oct: a walker pushes a unit someone else holds at most
-- once per day. Pushing someone else's ground always records eroded (3) or
-- flipped (4), so at most one such row may exist per walker, unit and day,
-- whatever the application does. It also serves the take-budget check.
CREATE UNIQUE INDEX IF NOT EXISTS "gameplay_push_events_one_push_per_walker_unit_day"
  ON "gameplay_push_events" ("walker_no", "day", "unit")
  WHERE "outcome" IN (3, 4);--> statement-breakpoint
-- "Who already pushed this unit today": read for every unit of every batch.
CREATE INDEX IF NOT EXISTS "gameplay_push_events_takers_idx"
  ON "gameplay_push_events" ("unit", "day")
  WHERE "outcome" IN (3, 4);--> statement-breakpoint

-- Append-only, except for erasure: a row may be deleted only once its
-- walker is gone, and updated only to clear a holder number whose player is
-- gone. Dropping a whole partition (retention, owner only) fires no row
-- trigger; that is the only other way rows leave.
CREATE OR REPLACE FUNCTION public.gameplay_push_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.gameplay_players WHERE player_no = OLD.walker_no) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'gameplay_push_events is append-only' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'previous_holder_no' - 'new_holder_no') = (to_jsonb(OLD) - 'previous_holder_no' - 'new_holder_no')
     AND (NEW.previous_holder_no IS NOT DISTINCT FROM OLD.previous_holder_no
          OR (NEW.previous_holder_no IS NULL AND NOT EXISTS (SELECT 1 FROM public.gameplay_players WHERE player_no = OLD.previous_holder_no)))
     AND (NEW.new_holder_no IS NOT DISTINCT FROM OLD.new_holder_no
          OR (NEW.new_holder_no IS NULL AND NOT EXISTS (SELECT 1 FROM public.gameplay_players WHERE player_no = OLD.new_holder_no))) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'gameplay_push_events is append-only' USING ERRCODE = 'restrict_violation';
END
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "gameplay_push_events_append_only" ON "gameplay_push_events";--> statement-breakpoint
CREATE TRIGGER "gameplay_push_events_append_only" BEFORE UPDATE OR DELETE ON "gameplay_push_events"
  FOR EACH ROW EXECUTE FUNCTION public.gameplay_push_events_append_only();--> statement-breakpoint

-- ── walker days: each walker's counters for a day, in day partitions ──────
-- Row-locked by every batch of that walker's pushes for the day, so two
-- sessions of one walker never both spend the last take or the last unit.
-- takes_used: the day's pinned `take_budget` (rules.ts TakeBudget).
-- units_used: verified units pushed (accepted or refused), against the
--   server's capacity budget (GameplayService unitBudget; not a game rule).
-- refused_*: pushes that changed nothing, by reason. They are not ledger
--   rows; settlement counts them for clubs.
-- visit_units: one refused stepped-on unit per zone, first seen. A refused
--   stepped-on push still visits its zone at day close, and this is the
--   bounded evidence a dispute can see for refusals.
CREATE TABLE IF NOT EXISTS "gameplay_walker_days" (
  "walker_no" integer NOT NULL REFERENCES "gameplay_players"("player_no") ON DELETE CASCADE,
  "day" integer NOT NULL CHECK ("day" >= 0),
  "holding_rules_version" integer NOT NULL,
  "takes_used" integer DEFAULT 0 NOT NULL CHECK ("takes_used" >= 0),
  "units_used" integer DEFAULT 0 NOT NULL CHECK ("units_used" >= 0),
  "refused_deeded" integer DEFAULT 0 NOT NULL CHECK ("refused_deeded" >= 0),
  "refused_masked" integer DEFAULT 0 NOT NULL CHECK ("refused_masked" >= 0),
  "refused_daily_limit" integer DEFAULT 0 NOT NULL CHECK ("refused_daily_limit" >= 0),
  "refused_take_budget" integer DEFAULT 0 NOT NULL CHECK ("refused_take_budget" >= 0),
  "visit_units" bigint[] DEFAULT '{}' NOT NULL CHECK (cardinality("visit_units") <= 1000),
  PRIMARY KEY ("walker_no", "day"),
  CONSTRAINT "gameplay_walker_days_day_rules" FOREIGN KEY ("day", "holding_rules_version") REFERENCES "gameplay_day_rules" ("day", "holding_rules_version")
) PARTITION BY RANGE ("day");--> statement-breakpoint

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
   WHERE walker_no = NEW.walker_no AND day = NEW.day AND outcome IN (3, 4);
  SELECT takes_used INTO used FROM public.gameplay_walker_days WHERE walker_no = NEW.walker_no AND day = NEW.day;
  SELECT take_budget INTO budget FROM public.gameplay_day_rules WHERE day = NEW.day;
  IF used IS NULL OR n <> used THEN
    RAISE EXCEPTION 'takes of player % on day % do not match the counter', NEW.walker_no, NEW.day USING ERRCODE = 'check_violation';
  END IF;
  IF budget IS NOT NULL AND n > budget THEN
    RAISE EXCEPTION 'takes of player % on day % exceed the budget', NEW.walker_no, NEW.day USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "gameplay_push_events_take_budget" ON "gameplay_push_events";--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "gameplay_push_events_take_budget" AFTER INSERT ON "gameplay_push_events"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (NEW.outcome IN (3, 4))
  EXECUTE FUNCTION public.gameplay_check_take_budget();--> statement-breakpoint

-- ── day partitions ─────────────────────────────────────────────────────────
-- One partition per day for the ledger and the walker days, in a schema no
-- API role can use. Created ahead of time by the server (the maintenance
-- loop, and the push path for a day that has none yet), never by a client.
-- A push for a day without a partition fails and writes nothing. Each new
-- partition gets row level security and loses every privilege an API role
-- might have by default. Dropping one is retention (owner decision, not
-- built): export first, then DROP TABLE, which frees its space at once.
CREATE SCHEMA IF NOT EXISTS "gameplay_partitions";--> statement-breakpoint
REVOKE ALL ON SCHEMA "gameplay_partitions" FROM PUBLIC;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.gameplay_ensure_day_partitions(first_day integer, last_day integer)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  d integer;
  t text;
  p text;
  made integer := 0;
BEGIN
  IF first_day IS NULL OR last_day IS NULL OR first_day < 0 OR last_day < first_day OR last_day - first_day > 62 THEN
    RAISE EXCEPTION 'partition range % to % is not 0 <= first <= last <= first + 62', first_day, last_day USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- One creator at a time ("MRGP", key -1; day keys are never negative).
  PERFORM pg_advisory_xact_lock(1297237840, -1);
  FOR d IN first_day..last_day LOOP
    FOREACH t IN ARRAY ARRAY['gameplay_push_events', 'gameplay_walker_days'] LOOP
      p := t || '_d' || d;
      IF to_regclass(format('gameplay_partitions.%I', p)) IS NULL THEN
        -- A creator that held the lock just before may have committed this
        -- partition after this backend last read the catalog (an advisory
        -- lock does not refresh it). Its transaction also applied the RLS
        -- and the revokes below, so the duplicate is skipped, not counted.
        BEGIN
          EXECUTE format('CREATE TABLE gameplay_partitions.%I PARTITION OF public.%I FOR VALUES FROM (%s) TO (%s)', p, t, d, d + 1);
          EXECUTE format('ALTER TABLE gameplay_partitions.%I ENABLE ROW LEVEL SECURITY', p);
          EXECUTE format('REVOKE ALL ON TABLE gameplay_partitions.%I FROM PUBLIC', p);
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
            EXECUTE format('REVOKE ALL ON TABLE gameplay_partitions.%I FROM anon', p);
          END IF;
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
            EXECUTE format('REVOKE ALL ON TABLE gameplay_partitions.%I FROM authenticated', p);
          END IF;
          made := made + 1;
        EXCEPTION WHEN duplicate_table THEN
          NULL;
        END;
      END IF;
    END LOOP;
  END LOOP;
  RETURN made;
END
$$;--> statement-breakpoint

-- ── open two-day challenges (rules.ts TakeoverPolicy "two-day-challenge") ───
-- Part of a unit's current state, written under the unit's row lock. One row
-- per challenger; the day the challenge opened. A challenger's erasure
-- removes their challenges; a holder's erasure removes the unit's.
-- opened_received_at: when the server received the push that opened the
-- challenge (the movement row's created_at, or the server clock for a server
-- batch). Never a client clock. Kept while the challenge is open so 1002's
-- second-push gap does not depend on the ledger, whose partitions retention
-- may drop. Required: every challenge is opened by the service, which always
-- knows the receipt time, so an unknown time can never be stored.
CREATE TABLE IF NOT EXISTS "gameplay_unit_challenges" (
  "unit" bigint NOT NULL REFERENCES "gameplay_units"("unit"),
  "walker_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "first_day" integer NOT NULL CHECK ("first_day" >= 0),
  "holding_rules_version" integer NOT NULL,
  "opened_received_at" timestamptz NOT NULL,
  PRIMARY KEY ("unit", "walker_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gameplay_unit_challenges_walker_idx" ON "gameplay_unit_challenges" ("walker_id");--> statement-breakpoint

-- holding.ts unitProblems: only held ground has challenges, never by its holder, never from a later day.
CREATE OR REPLACE FUNCTION public.gameplay_check_challenge()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  u record;
BEGIN
  SELECT holder_id, as_of_day, holding_rules_version INTO u FROM public.gameplay_units WHERE unit = NEW.unit;
  IF u.holder_id IS NULL OR u.holder_id = NEW.walker_id OR NEW.first_day > u.as_of_day OR u.holding_rules_version <> NEW.holding_rules_version THEN
    RAISE EXCEPTION 'challenge on unit % is inconsistent with the unit', NEW.unit USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "gameplay_unit_challenges_consistent" ON "gameplay_unit_challenges";--> statement-breakpoint
CREATE TRIGGER "gameplay_unit_challenges_consistent" BEFORE INSERT OR UPDATE ON "gameplay_unit_challenges"
  FOR EACH ROW EXECUTE FUNCTION public.gameplay_check_challenge();--> statement-breakpoint

-- ── applied sources: one receipt per movement session (or server batch) ─────
-- The source number is the first half of every ledger row's event id. A
-- retried apply returns this receipt and writes nothing.
CREATE TABLE IF NOT EXISTS "gameplay_applied_sessions" (
  "source_no" integer PRIMARY KEY DEFAULT nextval('gameplay_source_no_seq') NOT NULL CHECK ("source_no" > 0),
  "movement_verification_id" text UNIQUE REFERENCES "movement_verifications"("id") ON DELETE CASCADE,
  "batch_key" text UNIQUE CHECK ("batch_key" IS NULL OR length("batch_key") BETWEEN 1 AND 200),
  "user_id" text REFERENCES "users"("id") ON DELETE CASCADE,
  "day" integer NOT NULL CHECK ("day" >= 0),
  "applied" integer NOT NULL CHECK ("applied" >= 0),
  "skipped" integer NOT NULL CHECK ("skipped" >= 0),
  "rejected" integer NOT NULL CHECK ("rejected" >= 0),
  -- By outcome, in policy.ts SERVER_OUTCOMES order.
  "outcome_counts" integer[] NOT NULL CHECK (cardinality("outcome_counts") = 8),
  -- NULL when nothing was rejected.
  "rejected_by_reason" jsonb CHECK ("rejected_by_reason" IS NULL OR jsonb_typeof("rejected_by_reason") = 'object'),
  "holding_rules_version" integer NOT NULL,
  "applied_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "gameplay_applied_sessions_one_source" CHECK (("movement_verification_id" IS NULL) <> ("batch_key" IS NULL)),
  CONSTRAINT "gameplay_applied_sessions_session_has_user" CHECK ("movement_verification_id" IS NULL OR "user_id" IS NOT NULL)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gameplay_applied_sessions_user_idx" ON "gameplay_applied_sessions" ("user_id", "day") WHERE "user_id" IS NOT NULL;--> statement-breakpoint

-- ── session paths (rule set 1002): one row per verified session ───────────
-- 1002 plays on H3 resolution 10 units, and the movement pipeline stores only
-- the resolution 8 cells that contain a fix. Raw fixes are never stored, so
-- the resolution 10 path is derived once, from the verified fixes, in the
-- transaction that stores the verification (backend/src/gameplay/path.ts),
-- and only when gameplay runs 1002. Units are bigint H3 indexes in walk order
-- (first touch), with one bit per unit: 1 = interpolated between two accepted
-- fixes, 0 = an accepted fix inside it. No position, no fix time and no
-- per-unit time is stored. The row cascades with its movement verification,
-- which account deletion removes. Pruning rows once their day is settled is
-- a retention decision for the owner; nothing prunes them today.
CREATE TABLE IF NOT EXISTS "gameplay_session_paths" (
  "movement_verification_id" text PRIMARY KEY NOT NULL REFERENCES "movement_verifications"("id") ON DELETE CASCADE,
  "path_version" smallint NOT NULL CHECK ("path_version" >= 1),
  "resolution" smallint NOT NULL CHECK ("resolution" BETWEEN 0 AND 15),
  -- At most 500 units (the rule's cap).
  "unit_ids" bigint[] NOT NULL CHECK (cardinality("unit_ids") <= 500 AND array_position("unit_ids", NULL) IS NULL),
  "interpolated" varbit NOT NULL,
  "skipped_segments" integer NOT NULL CHECK ("skipped_segments" >= 0),
  "truncated" boolean NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "gameplay_session_paths_flags" CHECK (length("interpolated") = cardinality("unit_ids"))
);--> statement-breakpoint

-- ── player day proofs: one row per walker and settled day ──────────────────
-- Written at day close: how many pushes were accepted (and how many were
-- takes), refused and counted against the unit budget, and the sha256 of
-- that walker's accepted ledger rows in seq order plus their refusal
-- counters. Small and resolution independent, so it can outlive the raw
-- partitions and still prove an archived partition was not altered. The
-- hashed rows name no other player (proof encoding 2: source, unit, outcome,
-- strengths, shade), so erasing a previous or new holder never changes
-- another walker's proof; the reconciler recomputes every proof of a day.
CREATE TABLE IF NOT EXISTS "gameplay_player_day_proofs" (
  "player_no" integer NOT NULL REFERENCES "gameplay_players"("player_no") ON DELETE CASCADE,
  "day" integer NOT NULL CHECK ("day" >= 0),
  "holding_rules_version" integer NOT NULL,
  "accepted" integer NOT NULL CHECK ("accepted" >= 0),
  "takes" integer NOT NULL CHECK ("takes" >= 0 AND "takes" <= "accepted"),
  "refused" integer NOT NULL CHECK ("refused" >= 0),
  "units_used" integer NOT NULL CHECK ("units_used" >= 0),
  "events_sha256" bytea NOT NULL CHECK (octet_length("events_sha256") = 32),
  PRIMARY KEY ("player_no", "day"),
  CONSTRAINT "gameplay_player_day_proofs_day_rules" FOREIGN KEY ("day", "holding_rules_version") REFERENCES "gameplay_day_rules" ("day", "holding_rules_version")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gameplay_player_day_proofs_day_idx" ON "gameplay_player_day_proofs" ("day");--> statement-breakpoint
-- Append-only: a proof is never updated, and is deleted only once its player
-- is gone (the erasure step deletes the gameplay_players row, which
-- cascades). Proofs carry no personal data beyond the player number, and
-- they do not outlive the person: erasure removes them, so a proof is not a
-- reason to keep anyone's data (docs/G34_ERASURE_TOMBSTONES.md). There is no
-- legal-hold exception; dropping or truncating the table fires no row
-- trigger.
CREATE OR REPLACE FUNCTION public.gameplay_player_day_proofs_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.gameplay_players WHERE player_no = OLD.player_no) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'gameplay_player_day_proofs is append-only' USING ERRCODE = 'restrict_violation';
END
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "gameplay_player_day_proofs_append_only" ON "gameplay_player_day_proofs";--> statement-breakpoint
CREATE TRIGGER "gameplay_player_day_proofs_append_only" BEFORE UPDATE OR DELETE ON "gameplay_player_day_proofs"
  FOR EACH ROW EXECUTE FUNCTION public.gameplay_player_day_proofs_append_only();--> statement-breakpoint

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
  -- The day's receipt cutoff (close plus grace): sessions the server received
  -- at or after it counted for nothing. Also bound into input_digest.
  "receipt_cutoff_at" timestamptz NOT NULL,
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

-- ── erasure days: how account erasure changed a closed day ────────────────
-- One row per settled day that any erasure changed, updated in place, never
-- one row per erasure: nothing here orders, counts per person or groups one
-- person's days. No identity column, sequence or timestamp. base_digest is
-- the header's input_digest (fixed at the first erasure), head_digest the
-- digest of the day's inputs after the latest erasure, computed in that
-- erasure's transaction. all_pre_verified: every erasure of the day found the
-- day passing the reconciler's full check just before it, so an erasure can
-- never launder an earlier mismatch (once false, never true again).
-- tombstones: how many of the day's credit lines are tombstoned. Removed only
-- with a refused header an operator deletes so the day settles afresh.
CREATE TABLE IF NOT EXISTS "gameplay_erasure_days" (
  "day" integer PRIMARY KEY NOT NULL REFERENCES "gameplay_day_settlements"("day") ON DELETE CASCADE,
  "base_digest" text NOT NULL CHECK ("base_digest" ~ '^[0-9a-f]{64}$'),
  "head_digest" text NOT NULL CHECK ("head_digest" ~ '^[0-9a-f]{64}$'),
  "erasures" integer NOT NULL CHECK ("erasures" >= 1),
  "tombstones" integer NOT NULL CHECK ("tombstones" >= 0 AND "tombstones" <= "erasures"),
  "all_pre_verified" boolean NOT NULL
);--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.gameplay_erasure_days_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.base_digest IS DISTINCT FROM (SELECT input_digest FROM public.gameplay_day_settlements WHERE day = NEW.day)
       OR NEW.erasures <> 1 OR NEW.tombstones > 1 THEN
      RAISE EXCEPTION 'erasure state of day % does not start from its stored digest', NEW.day USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- One more erasure: same day and base, one more count, at most one more
    -- tombstone, and verification can only be lost, never regained.
    IF NEW.day = OLD.day AND NEW.base_digest = OLD.base_digest AND NEW.erasures = OLD.erasures + 1
       AND NEW.tombstones IN (OLD.tombstones, OLD.tombstones + 1) AND (OLD.all_pre_verified OR NOT NEW.all_pre_verified) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'erasure state of day % may only advance by one erasure', OLD.day USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gameplay_day_settlements WHERE day = OLD.day) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'gameplay_erasure_days rows go only with a refused header' USING ERRCODE = 'restrict_violation';
END
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "gameplay_erasure_days_guard" ON "gameplay_erasure_days";--> statement-breakpoint
CREATE TRIGGER "gameplay_erasure_days_guard" BEFORE INSERT OR UPDATE OR DELETE ON "gameplay_erasure_days"
  FOR EACH ROW EXECUTE FUNCTION public.gameplay_erasure_days_guard();--> statement-breakpoint

-- One row. Every day close takes it FOR SHARE and every erasure UPDATEs it,
-- so a day never settles from inputs an erasure is changing: the close waits,
-- and its serializable snapshot then fails (40001) and is retried afresh.
CREATE TABLE IF NOT EXISTS "gameplay_erasure_fence" (
  "id" boolean PRIMARY KEY DEFAULT true CHECK ("id"),
  "erasures" bigint DEFAULT 0 NOT NULL CHECK ("erasures" >= 0)
);--> statement-breakpoint
INSERT INTO "gameplay_erasure_fence" ("id") VALUES (true) ON CONFLICT DO NOTHING;--> statement-breakpoint

-- Account erasure jobs (erasure queue, 30 Oct; docs/G34_ERASURE_QUEUE.md).
-- With gameplay enabled an account deletion request is accepted in a short
-- transaction (the person is signed out everywhere, the account is marked
-- "deleting" so it cannot sign in again, and one row is written here), and
-- the full erasure (the fence, the gameplay replay, every identity row, the
-- user row) runs later in its own transaction, retried with bounded backoff.
-- The job is completed in that same transaction, so a job is completed
-- exactly when the account is gone. user_id is the only link to a person and
-- is cleared on completion: a completed row says only that a deletion
-- finished, and when. The foreign key keeps the user row from going while an
-- open job names it. last_outcome holds a reason code only (never an error
-- message, an address or a token). The API owns the table; no other role
-- gets anything (below).
CREATE TABLE IF NOT EXISTS "gameplay_account_deletion_jobs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "user_id" text REFERENCES "users"("id"),
  "state" text NOT NULL CHECK ("state" IN ('pending', 'running', 'completed', 'needs_attention')),
  "attempts" integer DEFAULT 0 NOT NULL CHECK ("attempts" >= 0),
  "requested_at" timestamptz DEFAULT now() NOT NULL,
  "next_attempt_at" timestamptz DEFAULT now() NOT NULL,
  "lease_token" uuid,
  "lease_expires_at" timestamptz,
  "last_outcome" text CHECK ("last_outcome" IS NULL OR "last_outcome" ~ '^[a-z0-9_]{1,40}$'),
  "provider_stage" text CHECK ("provider_stage" IS NULL OR "provider_stage" IN ('none', 'queued', 'removed')),
  "attention_at" timestamptz,
  "completed_at" timestamptz,
  CONSTRAINT "gameplay_account_deletion_jobs_completed" CHECK (("state" = 'completed') = ("completed_at" IS NOT NULL)),
  CONSTRAINT "gameplay_account_deletion_jobs_subject" CHECK (("state" = 'completed') = ("user_id" IS NULL)),
  CONSTRAINT "gameplay_account_deletion_jobs_lease" CHECK (("state" = 'running') = ("lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL)),
  CONSTRAINT "gameplay_account_deletion_jobs_attention" CHECK (("state" = 'needs_attention') = ("attention_at" IS NOT NULL))
);--> statement-breakpoint
-- At most one open job per account: a repeated request finds the open one.
CREATE UNIQUE INDEX IF NOT EXISTS "gameplay_account_deletion_jobs_open_user" ON "gameplay_account_deletion_jobs" ("user_id") WHERE "state" <> 'completed';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gameplay_account_deletion_jobs_due" ON "gameplay_account_deletion_jobs" ("next_attempt_at") WHERE "state" IN ('pending', 'running');--> statement-breakpoint
-- Retention purge (30 days after completion): finds expired receipts in
-- completion order without scanning open jobs.
CREATE INDEX IF NOT EXISTS "gameplay_account_deletion_jobs_completed_at" ON "gameplay_account_deletion_jobs" ("completed_at") WHERE "state" = 'completed';--> statement-breakpoint

-- A credit line names its player, or (after erasure) a tombstone: a random
-- uuid made for that one line, linked to nothing else. Never both.
-- player_id has no ON DELETE action: a user row cannot go while a line names
-- it. line_key is the line's id either way, and amounts never change.
CREATE TABLE IF NOT EXISTS "gameplay_credit_lines" (
  "day" integer NOT NULL REFERENCES "gameplay_day_settlements"("day"),
  "player_id" text REFERENCES "users"("id"),
  "tombstone_id" uuid UNIQUE,
  "line_key" text GENERATED ALWAYS AS (coalesce("player_id", 'erased:' || "tombstone_id"::text)) STORED,
  "earned_micro" bigint NOT NULL CHECK ("earned_micro" >= 0),
  "toll_paid_micro" bigint NOT NULL CHECK ("toll_paid_micro" >= 0),
  "toll_received_micro" bigint NOT NULL CHECK ("toll_received_micro" >= 0),
  "recharge_micro" bigint NOT NULL CHECK ("recharge_micro" >= 0),
  "upkeep_taken_micro" bigint NOT NULL CHECK ("upkeep_taken_micro" >= 0),
  "upkeep_in_condition_micro" bigint NOT NULL CHECK ("upkeep_in_condition_micro" >= 0),
  "zones_held" integer NOT NULL CHECK ("zones_held" >= 0),
  "net_micro" bigint NOT NULL CHECK ("net_micro" >= 0),
  PRIMARY KEY ("day", "line_key"),
  CONSTRAINT "gameplay_credit_lines_one_owner" CHECK (("player_id" IS NULL) <> ("tombstone_id" IS NULL)),
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

-- A settled day is final: its header's books never change and it never
-- goes, and its lines are never deleted. A refused header may be deleted so
-- the day can be settled again once its problem is fixed. Erasure may only:
-- replace a line's player with the tombstone of an erasure record of the
-- tombstone while the day's erasure state allows one more (amounts
-- unchanged), and rewrite the problem texts of a header the day's erasure
-- state covers (same number of problems, nothing else).
CREATE OR REPLACE FUNCTION public.gameplay_settlements_final()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_TABLE_NAME = 'gameplay_day_settlements' THEN
    IF TG_OP = 'DELETE' AND OLD.status = 'refused' THEN RETURN OLD; END IF;
    IF TG_OP = 'UPDATE'
       AND (to_jsonb(NEW) - 'problems' - 'clubs_problems') = (to_jsonb(OLD) - 'problems' - 'clubs_problems')
       AND jsonb_array_length(NEW.problems) = jsonb_array_length(OLD.problems)
       AND jsonb_array_length(NEW.clubs_problems) = jsonb_array_length(OLD.clubs_problems)
       AND EXISTS (SELECT 1 FROM public.gameplay_erasure_days e WHERE e.day = OLD.day) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'a settled day is final' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.player_id IS NOT NULL AND NEW.player_id IS NULL
     AND OLD.tombstone_id IS NULL AND NEW.tombstone_id IS NOT NULL
     AND (to_jsonb(NEW) - 'player_id' - 'tombstone_id' - 'line_key') = (to_jsonb(OLD) - 'player_id' - 'tombstone_id' - 'line_key')
     AND (SELECT e.tombstones FROM public.gameplay_erasure_days e WHERE e.day = NEW.day)
         > (SELECT count(*) FROM public.gameplay_credit_lines l WHERE l.day = NEW.day AND l.player_id IS NULL) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'credit lines are final' USING ERRCODE = 'restrict_violation';
END
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "gameplay_day_settlements_final" ON "gameplay_day_settlements";--> statement-breakpoint
CREATE TRIGGER "gameplay_day_settlements_final" BEFORE UPDATE OR DELETE ON "gameplay_day_settlements"
  FOR EACH ROW EXECUTE FUNCTION public.gameplay_settlements_final();--> statement-breakpoint
DROP TRIGGER IF EXISTS "gameplay_credit_lines_final" ON "gameplay_credit_lines";--> statement-breakpoint
CREATE TRIGGER "gameplay_credit_lines_final" BEFORE UPDATE OR DELETE ON "gameplay_credit_lines"
  FOR EACH ROW EXECUTE FUNCTION public.gameplay_settlements_final();--> statement-breakpoint

-- ── settlement halts: the operator's halt-only switch, audited ─────────────
-- Each row is one halt or resume; the latest row is the status. A halt only
-- stops day close (nothing settles while the latest row is 'halt'); it
-- writes, overrides or credits nothing, and a resume settles nothing by
-- itself. The reconciler adds a halt row when a closed day's replay fails.
-- actor is a role label (e.g. ops-oncall, reconciler), never a name or an
-- address. Append-only: rows are never changed or removed. A resume row
-- must name the resume request that authorised it (below).
CREATE TABLE IF NOT EXISTS "gameplay_settlement_halts" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "action" text NOT NULL CHECK ("action" IN ('halt', 'resume')),
  "actor" text NOT NULL CHECK ("actor" ~ '^[a-z0-9][a-z0-9_.:-]{0,63}$'),
  "reason" text NOT NULL CHECK (length("reason") BETWEEN 1 AND 500),
  "day" integer CHECK ("day" >= 0),
  "resume_request_id" bigint UNIQUE,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "gameplay_settlement_halts_resume_authorised" CHECK (("action" = 'resume') = ("resume_request_id" IS NOT NULL))
);--> statement-breakpoint

-- ── resume under dual review ──────────────────────────────────────────────
-- A request records, for the halt that is current, the sha256 of a fresh
-- reconciliation proof (every closed day re-verified, read-only) and how
-- many days it covered. Each approval re-runs the proof and must see the
-- same sha256. The resume row is written with the second approval. Expires
-- 24 hours after the request (pilot proposal). Approvers are distinct role
-- labels, neither of them the requester; mapping labels to distinct
-- authenticated people is outside the database (docs/G34_ERASURE_TOMBSTONES.md).
CREATE TABLE IF NOT EXISTS "gameplay_resume_requests" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "halt_id" bigint NOT NULL REFERENCES "gameplay_settlement_halts"("id"),
  "requested_by" text NOT NULL CHECK ("requested_by" ~ '^[a-z0-9][a-z0-9_.:-]{0,63}$'),
  "reason" text NOT NULL CHECK (length("reason") BETWEEN 1 AND 500),
  "proof_sha256" text NOT NULL CHECK ("proof_sha256" ~ '^[0-9a-f]{64}$'),
  "proof_days" integer NOT NULL CHECK ("proof_days" >= 0),
  "created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gameplay_resume_approvals" (
  "request_id" bigint NOT NULL REFERENCES "gameplay_resume_requests"("id"),
  "approver" text NOT NULL CHECK ("approver" ~ '^[a-z0-9][a-z0-9_.:-]{0,63}$'),
  "proof_sha256" text NOT NULL CHECK ("proof_sha256" ~ '^[0-9a-f]{64}$'),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY ("request_id", "approver")
);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gameplay_settlement_halts_resume_request') THEN
    ALTER TABLE "gameplay_settlement_halts" ADD CONSTRAINT "gameplay_settlement_halts_resume_request"
      FOREIGN KEY ("resume_request_id") REFERENCES "gameplay_resume_requests"("id");
  END IF;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.gameplay_settlement_halts_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  latest record;
  req record;
  n integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.action = 'resume' THEN
      SELECT id, action INTO latest FROM public.gameplay_settlement_halts ORDER BY id DESC LIMIT 1;
      SELECT * INTO req FROM public.gameplay_resume_requests WHERE id = NEW.resume_request_id;
      SELECT count(*) INTO n FROM public.gameplay_resume_approvals a
       WHERE a.request_id = NEW.resume_request_id AND a.approver <> req.requested_by AND a.proof_sha256 = req.proof_sha256;
      IF latest.action IS DISTINCT FROM 'halt' OR req.halt_id IS DISTINCT FROM latest.id OR n < 2
         OR req.created_at < now() - interval '24 hours' THEN
        RAISE EXCEPTION 'a resume needs a fresh reconciliation proof and two distinct approvers for the current halt' USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "gameplay_settlement_halts_append_only" ON "gameplay_settlement_halts";--> statement-breakpoint
CREATE TRIGGER "gameplay_settlement_halts_append_only" BEFORE INSERT OR UPDATE OR DELETE ON "gameplay_settlement_halts"
  FOR EACH ROW EXECUTE FUNCTION public.gameplay_settlement_halts_append_only();--> statement-breakpoint
DROP TRIGGER IF EXISTS "gameplay_resume_requests_append_only" ON "gameplay_resume_requests";--> statement-breakpoint
CREATE TRIGGER "gameplay_resume_requests_append_only" BEFORE UPDATE OR DELETE ON "gameplay_resume_requests"
  FOR EACH ROW EXECUTE FUNCTION public.gameplay_settlement_halts_append_only();--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.gameplay_resume_approvals_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  req record;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'gameplay_resume_approvals is append-only' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT * INTO req FROM public.gameplay_resume_requests WHERE id = NEW.request_id;
  IF req.requested_by = NEW.approver THEN
    RAISE EXCEPTION 'the requester cannot approve their own resume' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF req.proof_sha256 IS DISTINCT FROM NEW.proof_sha256 THEN
    RAISE EXCEPTION 'the approval saw another reconciliation proof' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "gameplay_resume_approvals_guard" ON "gameplay_resume_approvals";--> statement-breakpoint
CREATE TRIGGER "gameplay_resume_approvals_guard" BEFORE INSERT OR UPDATE OR DELETE ON "gameplay_resume_approvals"
  FOR EACH ROW EXECUTE FUNCTION public.gameplay_resume_approvals_guard();--> statement-breakpoint

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
  -- No ON DELETE action: memberships are a closed day's input, so the
  -- erasure step removes them (and records the change) before the user goes.
  "walker_id" text NOT NULL REFERENCES "users"("id"),
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
  "unit" bigint PRIMARY KEY NOT NULL CHECK ("unit" > 0 AND (("unit" >> 59) & 15) = 1),
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

-- ── server receipt time of a session is immutable ──────────────────────────
-- Settlement counts a session only if the server received it before its day
-- closed (movement_verifications.created_at, the database's own clock at
-- insert; the API never supplies it). Rewriting it later could pull a late
-- session back into a closed day, so an UPDATE that changes it is refused.
CREATE OR REPLACE FUNCTION public.gameplay_movement_receipt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'movement_verifications.created_at is the server receipt time and cannot change' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "gameplay_movement_receipt_immutable" ON "movement_verifications";--> statement-breakpoint
CREATE TRIGGER "gameplay_movement_receipt_immutable" BEFORE UPDATE OF "created_at" ON "movement_verifications"
  FOR EACH ROW EXECUTE FUNCTION public.gameplay_movement_receipt_immutable();--> statement-breakpoint

-- Sealing v2: the server's territory seal of a verified session (V3 rule 3),
-- computed from the accepted fixes at verification and written in the same
-- transaction when gameplay asks for it. All NULL otherwise (gameplay off, or
-- a rule set that does not use it); a push then refuses the session. The
-- claimable cells (claim scope `loop-units`) are present exactly when the
-- seal is true: 1 to 20,000 H3 cells at the rule set's unit resolution.
ALTER TABLE "movement_verifications" ADD COLUMN IF NOT EXISTS "territory_seal_version" smallint;--> statement-breakpoint
ALTER TABLE "movement_verifications" ADD COLUMN IF NOT EXISTS "territory_sealed" boolean;--> statement-breakpoint
ALTER TABLE "movement_verifications" ADD COLUMN IF NOT EXISTS "territory_seal_reason" text;--> statement-breakpoint
ALTER TABLE "movement_verifications" ADD COLUMN IF NOT EXISTS "territory_claim_units" bigint[];--> statement-breakpoint
ALTER TABLE "movement_verifications" ADD COLUMN IF NOT EXISTS "territory_claim_resolution" smallint;--> statement-breakpoint
ALTER TABLE "movement_verifications" DROP CONSTRAINT IF EXISTS "movement_verifications_territory_seal";--> statement-breakpoint
ALTER TABLE "movement_verifications" ADD CONSTRAINT "movement_verifications_territory_seal" CHECK (
  ("territory_seal_version" IS NULL AND "territory_sealed" IS NULL AND "territory_seal_reason" IS NULL
   AND "territory_claim_units" IS NULL AND "territory_claim_resolution" IS NULL)
  OR ("territory_seal_version" >= 1 AND "territory_sealed" IS NOT NULL
      AND "territory_seal_reason" IN ('enclosed', 'no_closed_loop', 'loop_too_small', 'loop_retraced', 'loop_too_thin', 'insufficient_route',
                                      'route_outside_local_frame', 'work_budget_exceeded')
      AND "territory_sealed" = ("territory_seal_reason" = 'enclosed')
      AND (CASE WHEN "territory_sealed"
                THEN "territory_claim_units" IS NOT NULL AND cardinality("territory_claim_units") BETWEEN 1 AND 20000
                     AND array_position("territory_claim_units", NULL) IS NULL
                     AND "territory_claim_resolution" BETWEEN 0 AND 15
                ELSE "territory_claim_units" IS NULL AND "territory_claim_resolution" IS NULL END)));--> statement-breakpoint
-- Written once: a recorded territory seal never changes (a re-scored session
-- could otherwise claim ground its walk did not enclose).
CREATE OR REPLACE FUNCTION public.gameplay_movement_territory_seal_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.territory_seal_version IS NOT NULL AND (NEW.territory_seal_version IS DISTINCT FROM OLD.territory_seal_version
      OR NEW.territory_sealed IS DISTINCT FROM OLD.territory_sealed OR NEW.territory_seal_reason IS DISTINCT FROM OLD.territory_seal_reason
      OR NEW.territory_claim_units IS DISTINCT FROM OLD.territory_claim_units
      OR NEW.territory_claim_resolution IS DISTINCT FROM OLD.territory_claim_resolution) THEN
    RAISE EXCEPTION 'movement_verifications territory seal is written once' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "gameplay_movement_territory_seal_once" ON "movement_verifications";--> statement-breakpoint
CREATE TRIGGER "gameplay_movement_territory_seal_once" BEFORE UPDATE OF "territory_seal_version", "territory_sealed", "territory_seal_reason",
  "territory_claim_units", "territory_claim_resolution" ON "movement_verifications"
  FOR EACH ROW EXECUTE FUNCTION public.gameplay_movement_territory_seal_once();--> statement-breakpoint

-- ── row level security ─────────────────────────────────────────────────────
ALTER TABLE "gameplay_players" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gameplay_units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gameplay_unit_day_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gameplay_push_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gameplay_applied_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gameplay_player_day_proofs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
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
ALTER TABLE "gameplay_session_paths" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gameplay_settlement_halts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gameplay_erasure_days" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gameplay_erasure_fence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gameplay_account_deletion_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gameplay_resume_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gameplay_resume_approvals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.gameplay_reset_erased_holder() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gameplay_reset_erased_state_holder() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gameplay_push_events_append_only() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gameplay_check_day_lines() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gameplay_settlements_final() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gameplay_day_rules_final() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gameplay_check_take_budget() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gameplay_check_challenge() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gameplay_ensure_day_partitions(integer, integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gameplay_movement_receipt_immutable() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gameplay_movement_territory_seal_once() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gameplay_settlement_halts_append_only() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gameplay_player_day_proofs_append_only() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gameplay_erasure_days_guard() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.gameplay_resume_approvals_guard() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON SEQUENCE "gameplay_push_seq" FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON SEQUENCE "gameplay_source_no_seq" FROM PUBLIC;--> statement-breakpoint

-- No policy exists for any role: with RLS on and no grant, nobody but the
-- owner (the API) can read or write any gameplay table.

-- Privileges. Supabase grants every new public table to anon and
-- authenticated by default; take that back. Nothing at all for either role.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['gameplay_players', 'gameplay_units', 'gameplay_unit_day_states', 'gameplay_push_events', 'gameplay_applied_sessions',
    'gameplay_player_day_proofs', 'gameplay_day_settlements', 'gameplay_credit_lines', 'gameplay_clubs', 'gameplay_club_memberships',
    'gameplay_unit_districts', 'gameplay_club_days', 'gameplay_district_days',
    'gameplay_day_rules', 'gameplay_walker_days', 'gameplay_unit_challenges', 'gameplay_session_paths', 'gameplay_settlement_halts',
    'gameplay_erasure_days', 'gameplay_erasure_fence', 'gameplay_account_deletion_jobs', 'gameplay_resume_requests', 'gameplay_resume_approvals'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t);
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['gameplay_push_seq', 'gameplay_source_no_seq'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM authenticated', t);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.gameplay_ensure_day_partitions(integer, integer) FROM anon;
    REVOKE ALL ON SCHEMA gameplay_partitions FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.gameplay_ensure_day_partitions(integer, integer) FROM authenticated;
    REVOKE ALL ON SCHEMA gameplay_partitions FROM authenticated;
  END IF;
END
$$;
