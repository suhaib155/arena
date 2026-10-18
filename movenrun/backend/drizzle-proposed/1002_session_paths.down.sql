-- Rollback for 1002_session_paths.sql. Run before 0011's rollback. It
-- destroys the stored 1002 session paths; sessions already applied keep
-- their pushes in the ledger, but an unapplied 1002 session can no longer be
-- applied (its raw fixes were never stored).
DROP TABLE IF EXISTS "gameplay_session_paths";
