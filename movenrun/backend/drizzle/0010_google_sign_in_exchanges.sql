-- One MovenRun session per Google sign-in. A Supabase access token stays valid
-- for its hour even after the app signs it out, and refreshing it keeps its
-- session id, so without a record anyone holding one could exchange it again
-- for a long-lived MovenRun session. The first exchange records the Supabase
-- session id; a second exchange of any token from that session is refused.
-- The API exchanges a session only within ten minutes of its sign-in, so a
-- row ("expires_at": when it may go) is needed only until that window closes.
-- Rows hold no personal data.
CREATE TABLE IF NOT EXISTS "google_sign_in_exchanges" (
  "session_id" text PRIMARY KEY NOT NULL,
  "expires_at" timestamp NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "google_sign_in_exchanges_expires_idx" ON "google_sign_in_exchanges" ("expires_at");--> statement-breakpoint
ALTER TABLE "google_sign_in_exchanges" ENABLE ROW LEVEL SECURITY;
