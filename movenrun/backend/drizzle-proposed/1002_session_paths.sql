-- 1002 session paths: PROPOSED, NOT APPLIED. An addendum to the proposed
-- migration 0011 (it needs 0011 first), for gameplay rule set 1002 only.
-- To be folded into 0011 by its owner when 0011 is finalised; it is not in
-- drizzle/ or its journal, and nothing runs it outside the local tests.
--
-- Why: rule set 1002 plays on H3 resolution 10 units, and the movement
-- pipeline stores only the resolution 8 cells that contain a fix. Raw fixes
-- are never stored, so the resolution 10 path is derived once, from the
-- verified fixes, in the same transaction that stores the verification
-- (backend/src/gameplay/path.ts), and kept here.
--
-- Size: one row per verified session while gameplay runs 1002. Units are
-- bigint H3 indexes (8 bytes each, not a 15-character text), with one bit
-- per unit saying whether it was stepped on or interpolated. No coordinate,
-- no timestamp and no per-unit time is stored.
--
-- Privacy and erasure: the same granularity as the 1002 push ledger. The row
-- cascades with its movement verification, which account deletion removes.
-- No retention rule is applied here; pruning rows once their day is settled
-- (the ledger then holds the pushes) is a retention decision for the owner.
--
-- Access: row level security on, nothing granted to anon or authenticated.
CREATE TABLE IF NOT EXISTS "gameplay_session_paths" (
  "movement_verification_id" text PRIMARY KEY NOT NULL REFERENCES "movement_verifications"("id") ON DELETE CASCADE,
  "path_version" smallint NOT NULL CHECK ("path_version" >= 1),
  "resolution" smallint NOT NULL CHECK ("resolution" BETWEEN 0 AND 15),
  -- Walk order (first touch). At most 500 units (the rule's cap).
  "unit_ids" bigint[] NOT NULL CHECK (cardinality("unit_ids") <= 500 AND array_position("unit_ids", NULL) IS NULL),
  -- One bit per unit: 1 = interpolated between two accepted fixes, 0 = an accepted fix inside it.
  "interpolated" varbit NOT NULL,
  "skipped_segments" integer NOT NULL CHECK ("skipped_segments" >= 0),
  "truncated" boolean NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "gameplay_session_paths_flags" CHECK (length("interpolated") = cardinality("unit_ids"))
);--> statement-breakpoint
ALTER TABLE "gameplay_session_paths" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
  REVOKE ALL ON TABLE public.gameplay_session_paths FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.gameplay_session_paths FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.gameplay_session_paths FROM authenticated;
  END IF;
END $$;
