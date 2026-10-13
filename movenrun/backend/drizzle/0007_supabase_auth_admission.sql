-- Sign-in moves to Supabase Auth (Google and wallet). This migration adds what
-- the API needs around it and keeps every table closed to the provider's REST
-- API (see 0006).
--
-- account_capacity: the single source for the registered-account cap. The API
-- admits a new player only inside a transaction that holds an advisory lock
-- and counts users against this row, so concurrent sign-ups cannot overshoot.
-- The Supabase hook below reads the same row to stop creating auth users once
-- the cap is reached.
CREATE TABLE IF NOT EXISTS "account_capacity" (
  "id" boolean PRIMARY KEY DEFAULT true NOT NULL CHECK ("id"),
  "max_accounts" integer NOT NULL CHECK ("max_accounts" >= 0),
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
INSERT INTO "account_capacity" ("id", "max_accounts") VALUES (true, 1000) ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wallet_sign_in_challenges" (
  "nonce" text PRIMARY KEY NOT NULL,
  "address" text NOT NULL,
  "message" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp NOT NULL,
  "consumed_at" timestamp
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wallet_sign_in_challenges_expires_idx" ON "wallet_sign_in_challenges" ("expires_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pending_auth_user_deletions" (
  "subject" text PRIMARY KEY NOT NULL,
  "requested_at" timestamp DEFAULT now() NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_attempt_at" timestamp
);--> statement-breakpoint
ALTER TABLE "account_capacity" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "wallet_sign_in_challenges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pending_auth_user_deletions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Supabase Auth "before user created" hook. Refuses a new auth user once the
-- registered players have reached the cap. Existing players are unaffected
-- (signing in does not create a user). Configure it in the Supabase dashboard
-- under Authentication → Hooks; on a plain PostgreSQL server it is unused.
CREATE OR REPLACE FUNCTION public.movenrun_before_user_created(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  cap integer;
  admitted integer;
BEGIN
  SELECT max_accounts INTO cap FROM public.account_capacity WHERE id;
  SELECT count(*) INTO admitted FROM public.users;
  IF cap IS NULL OR admitted >= cap THEN
    RETURN jsonb_build_object('error', jsonb_build_object(
      'message', 'MovenRun is not accepting new accounts right now.',
      'http_code', 403));
  END IF;
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
