-- Wallet sign-in from the app happens in the wallet's own browser, which then
-- hands a one-time code back to the app. Only the code's SHA-256 is stored and
-- it is bound to the app's PKCE challenge; it lives for a few minutes and is
-- spent on first use. Closed to the provider's REST API like every table (0006).
CREATE TABLE IF NOT EXISTS "wallet_sign_in_handoffs" (
  "code_hash" text PRIMARY KEY NOT NULL,
  "code_challenge" text NOT NULL,
  "subject" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp NOT NULL,
  "consumed_at" timestamp
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wallet_sign_in_handoffs_expires_idx" ON "wallet_sign_in_handoffs" ("expires_at");--> statement-breakpoint
ALTER TABLE "wallet_sign_in_handoffs" ENABLE ROW LEVEL SECURITY;
