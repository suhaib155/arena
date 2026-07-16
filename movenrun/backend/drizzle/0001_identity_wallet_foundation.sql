-- Identity & wallet foundation (see backend/src/db/identity.schema.ts and
-- backend/src/identity/**). Additive-only: creates the users, auth_identities,
-- wallets, auth_sessions, wallet_link_challenges, email_otp_challenges, and
-- security_audit_events tables plus their security-critical constraints. It
-- touches none of the existing route/zone/battle tables.
--
-- This migration was hand-authored to match identity.schema.ts exactly (the
-- pre-existing bigint `0n` defaults in the routes schema trip a drizzle-kit
-- 0.22.8 generate serialization bug — a documented follow-up in
-- docs/CONTRACTS_AUDIT.md), and validated by applying it to an ephemeral
-- PostgreSQL 16 cluster together with 0000. There is deliberately NO column
-- for a private key, mnemonic, or recovery secret anywhere below.

CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"disabled_at" timestamp,
	"security_version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_subject" text NOT NULL,
	"normalized_email" text,
	"verification_status" text DEFAULT 'unverified' NOT NULL,
	"assurance_level" text DEFAULT 'aal1' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_authenticated_at" timestamp,
	"revoked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wallets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	-- Nullable while an embedded wallet is still being provisioned (before the
	-- provider returns a public address); always set for external wallets.
	"address_canonical" text,
	"address_checksum" text,
	"wallet_type" text NOT NULL,
	"source_provider" text NOT NULL,
	"chain_family" text DEFAULT 'evm' NOT NULL,
	"ownership_status" text DEFAULT 'unverified' NOT NULL,
	"is_embedded" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"provisioning_state" text,
	"provider_wallet_ref" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"verified_at" timestamp,
	"revoked_at" timestamp,
	-- Defense-in-depth: the address column must already be canonical lowercase.
	CONSTRAINT "wallets_address_canonical_lowercase" CHECK ("address_canonical" = lower("address_canonical"))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"family_id" text NOT NULL,
	"assurance_level" text DEFAULT 'aal1' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"security_version" integer DEFAULT 0 NOT NULL,
	"device_label" text,
	"user_agent_hash" text,
	"issued_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"last_used_at" timestamp,
	"rotated_at" timestamp,
	"revoked_at" timestamp,
	"revocation_reason" text,
	"last_authenticated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wallet_link_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text,
	"action" text NOT NULL,
	"domain" text NOT NULL,
	"uri" text NOT NULL,
	"chain_id" integer NOT NULL,
	"nonce" text NOT NULL,
	"expected_address" text,
	"issued_at" timestamp DEFAULT now() NOT NULL,
	"not_before" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_otp_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"normalized_email" text NOT NULL,
	"purpose" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"request_source_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_sent_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "security_audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"event_type" text NOT NULL,
	"subject_id" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wallet_link_challenges" ADD CONSTRAINT "wallet_link_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_identities_user_idx" ON "auth_identities" USING btree (user_id);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_identities_provider_subject_active_unique" ON "auth_identities" USING btree (provider,provider_subject) WHERE "auth_identities"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wallets_user_idx" ON "wallets" USING btree (user_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wallets_address_idx" ON "wallets" USING btree (address_canonical);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wallets_verified_address_unique" ON "wallets" USING btree (address_canonical) WHERE "wallets"."ownership_status" = 'verified';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wallets_active_per_user_unique" ON "wallets" USING btree (user_id) WHERE "wallets"."is_active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wallets_embedded_per_user_provider_unique" ON "wallets" USING btree (user_id,source_provider) WHERE "wallets"."is_embedded" = true AND "wallets"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_sessions_user_idx" ON "auth_sessions" USING btree (user_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_sessions_family_idx" ON "auth_sessions" USING btree (family_id);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_sessions_refresh_hash_unique" ON "auth_sessions" USING btree (refresh_token_hash);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wallet_link_challenges_user_idx" ON "wallet_link_challenges" USING btree (user_id);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wallet_link_challenges_nonce_unique" ON "wallet_link_challenges" USING btree (nonce);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_otp_challenges_email_idx" ON "email_otp_challenges" USING btree (normalized_email);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "security_audit_events_user_idx" ON "security_audit_events" USING btree (user_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "security_audit_events_type_idx" ON "security_audit_events" USING btree (event_type);
