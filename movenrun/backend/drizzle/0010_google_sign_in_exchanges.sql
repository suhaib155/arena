-- One MovenRun session per Google sign-in. A Supabase access token stays valid
-- for its hour even after the app signs it out, so without a record anyone who
-- copied one in that hour could exchange it again for a long-lived MovenRun
-- session. The first exchange records the token's Supabase session id; a
-- second exchange of any token from that session is refused. Rows hold no
-- personal data and are deleted once the token has expired.
CREATE TABLE IF NOT EXISTS "google_sign_in_exchanges" (
  "session_id" text PRIMARY KEY NOT NULL,
  "expires_at" timestamp NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "google_sign_in_exchanges_expires_idx" ON "google_sign_in_exchanges" ("expires_at");--> statement-breakpoint
ALTER TABLE "google_sign_in_exchanges" ENABLE ROW LEVEL SECURITY;
