-- Row level security on every MovenRun table.
--
-- Managed PostgreSQL providers such as Supabase publish the `public` schema
-- through an automatic REST API that anyone holding the project's public key
-- can call. With RLS enabled and no policies, those API roles see and change
-- nothing. The API connects as the role that owns these tables, and an owner
-- is not subject to its own tables' RLS, so the server's behaviour is
-- unchanged. On a plain PostgreSQL server this is harmless.
--
-- Every later migration that creates a table must enable RLS on it as well;
-- runtime.test.ts fails while any table in `public` has it off.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
