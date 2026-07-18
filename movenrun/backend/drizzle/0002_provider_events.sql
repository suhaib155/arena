-- Provider webhook event persistence (see backend/src/db/provider.schema.ts
-- and backend/src/identity/webhooks/**). Additive-only: creates one new table
-- and its constraints; touches nothing else.
--
-- (provider, provider_event_id) uniqueness is the webhook replay/idempotency
-- authority. State/attempts CHECKs are DB-level backstops for the event
-- state machine. No raw payload, token, key, or secret column exists — only a
-- SHA-256 payload digest and minimal normalized envelope fields.
--
-- Hand-authored like 0001 (drizzle-kit generate remains blocked by the
-- pre-existing BigInt-default serialization bug in the route schema — see
-- docs/CONTRACTS_AUDIT.md) and validated against an ephemeral PostgreSQL 16.

CREATE TABLE IF NOT EXISTS "provider_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"event_version" text,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"provider_created_at" timestamp,
	"state" text DEFAULT 'received' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error_class" text,
	"payload_digest" text NOT NULL,
	"key_id" text,
	"lease_expires_at" timestamp,
	"processed_at" timestamp,
	"terminal_at" timestamp,
	CONSTRAINT "provider_events_state_valid" CHECK ("state" IN ('received','processing','processed','retryable_failure','terminal_failure','ignored')),
	CONSTRAINT "provider_events_attempts_nonnegative" CHECK ("attempts" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "provider_events_provider_event_unique" ON "provider_events" USING btree (provider,provider_event_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_events_state_idx" ON "provider_events" USING btree (state);
