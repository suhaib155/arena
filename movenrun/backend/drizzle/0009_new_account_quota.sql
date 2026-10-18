-- New-account quota. The 1,000-account cap alone can be filled by a script:
-- wallet keys cost nothing to make, so an attacker could take every place
-- before real players arrive. This limits how many new accounts may be
-- created per rolling hour, at both boundaries:
--
--  * the Supabase "before user created" hook, which every new auth user passes
--    through however the request reached Supabase (through the API or
--    directly with the publishable key), and
--  * the API's own admission transaction, which creates MovenRun players.
--
-- The owner changes the quota by updating the one account_capacity row.
ALTER TABLE "account_capacity" ADD COLUMN IF NOT EXISTS "max_new_per_hour" integer DEFAULT 50 NOT NULL CHECK ("max_new_per_hour" >= 0);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_user_creations" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_user_creations_created_idx" ON "auth_user_creations" ("created_at");--> statement-breakpoint
ALTER TABLE "auth_user_creations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_created_at_idx" ON "users" ("created_at");--> statement-breakpoint
-- Same contract as 0007, plus the hourly quota. Each new auth user the hook
-- lets through is recorded (no identifier, only the time); a creation that
-- then fails still counts, which errs on the side of refusing.
CREATE OR REPLACE FUNCTION public.movenrun_before_user_created(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  cap integer;
  per_hour integer;
  admitted integer;
  recent integer;
BEGIN
  -- One decision at a time, so concurrent sign-ups cannot overshoot the quota.
  PERFORM pg_advisory_xact_lock(hashtext('movenrun_auth_user_creation'));
  SELECT max_accounts, max_new_per_hour INTO cap, per_hour FROM public.account_capacity WHERE id;
  SELECT count(*) INTO admitted FROM public.users;
  IF cap IS NULL OR admitted >= cap THEN
    RETURN jsonb_build_object('error', jsonb_build_object(
      'message', 'MovenRun is not accepting new accounts right now.',
      'http_code', 403));
  END IF;
  SELECT count(*) INTO recent FROM public.auth_user_creations WHERE created_at > now() - interval '1 hour';
  IF recent >= per_hour THEN
    RETURN jsonb_build_object('error', jsonb_build_object(
      'message', 'Too many new accounts right now. Please try again later.',
      'http_code', 429));
  END IF;
  INSERT INTO public.auth_user_creations DEFAULT VALUES;
  DELETE FROM public.auth_user_creations WHERE created_at < now() - interval '1 day';
  RETURN '{}'::jsonb;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.movenrun_before_user_created(jsonb) FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    GRANT EXECUTE ON FUNCTION public.movenrun_before_user_created(jsonb) TO supabase_auth_admin;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.movenrun_before_user_created(jsonb) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.movenrun_before_user_created(jsonb) FROM authenticated;
  END IF;
END
$$;
