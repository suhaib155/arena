/**
 * Provider webhook event persistence (see backend/src/identity/webhooks/**).
 *
 * The (provider, provider_event_id) unique constraint is the replay/
 * idempotency authority for webhook ingestion — duplicate deliveries across
 * replicas and restarts converge on one row. Provider identity fields
 * (provider, providerEventId, eventType, eventVersion, payloadDigest,
 * providerCreatedAt, keyId) are IMMUTABLE after insert: no repository method
 * updates them (enforced in code + tested), only processing-lifecycle columns
 * change. No raw payload, token, key, or secret is ever stored — only a
 * SHA-256 digest and minimal normalized envelope fields.
 *
 * Like the other schema modules this imports only drizzle + local domain
 * types, never `@movenrun/shared`.
 */
import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { ProviderEventState } from "../identity/webhooks/types.js";

export const providerEvents = pgTable(
  "provider_events",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    eventVersion: text("event_version"),
    receivedAt: timestamp("received_at").defaultNow().notNull(),
    providerCreatedAt: timestamp("provider_created_at"),
    state: text("state").$type<ProviderEventState>().notNull().default("received"),
    attempts: integer("attempts").notNull().default(0),
    lastErrorClass: text("last_error_class"),
    // SHA-256 hex of the raw payload bytes — canonical, replay-stable digest.
    payloadDigest: text("payload_digest").notNull(),
    // Which signing-key version verified the delivery.
    keyId: text("key_id"),
    leaseExpiresAt: timestamp("lease_expires_at"),
    // Per-claim token (processing generation). Every settle transition matches
    // on this, so a slow worker whose lease expired and was reclaimed by
    // another worker cannot overwrite the newer claim's result.
    leaseToken: text("lease_token"),
    processedAt: timestamp("processed_at"),
    terminalAt: timestamp("terminal_at"),
  },
  (t) => ({
    // Replay authority: one row per provider delivery, ever.
    providerEventUnique: uniqueIndex("provider_events_provider_event_unique").on(t.provider, t.providerEventId),
    stateIdx: index("provider_events_state_idx").on(t.state),
    // DB-level backstops for the state machine.
    stateValid: check(
      "provider_events_state_valid",
      sql`${t.state} IN ('received','processing','processed','retryable_failure','terminal_failure','ignored')`
    ),
    attemptsNonNegative: check("provider_events_attempts_nonnegative", sql`${t.attempts} >= 0`),
  })
);
