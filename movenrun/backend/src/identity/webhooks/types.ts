/**
 * Provider webhook boundary — narrow interfaces (ADR-0013).
 *
 * The verifier receives RAW request bytes and verifies the signature BEFORE
 * any parsing. Verification failures carry a coarse failure class (for audit
 * and stable responses) and never include the raw signature or payload.
 *
 * No concrete provider is selected (ADR-0011 is Blocked), so production
 * webhook ingestion stays disabled and fails closed; the HMAC verifier below
 * these interfaces is real, generic infrastructure — not a fake adapter.
 */

export type WebhookRejectReason =
  | "missing_signature"
  | "malformed_signature"
  | "bad_signature"
  | "unknown_key_version"
  | "expired_key"
  | "missing_timestamp"
  | "stale_timestamp"
  | "future_timestamp"
  | "payload_too_large"
  | "malformed_payload";

export class WebhookVerificationError extends Error {
  readonly reason: WebhookRejectReason;
  constructor(reason: WebhookRejectReason) {
    // Reason class only — never the signature or payload contents.
    super(`webhook verification failed: ${reason}`);
    this.name = "WebhookVerificationError";
    this.reason = reason;
  }
}

/** A webhook that passed signature/timestamp verification. The raw body is
 *  intentionally NOT carried forward — only its digest and parsed envelope. */
export interface VerifiedProviderEvent {
  provider: string;
  providerEventId: string;
  eventType: string;
  eventVersion: string | null;
  /** Provider-declared creation time, when present in the envelope. */
  providerCreatedAt: Date | null;
  /** SHA-256 hex digest of the raw payload bytes (canonical, replay-stable). */
  payloadDigest: string;
  /** Which signing key verified this delivery. */
  keyId: string;
  /** Parsed envelope data for the processor. Never secret material. */
  data: Record<string, unknown>;
}

export interface VerifyWebhookInput {
  /** Exact raw request bytes as received — signature covers these. */
  rawBody: Buffer;
  /** Relevant headers, lower-cased keys. */
  headers: Record<string, string | undefined>;
  now: Date;
}

export interface ProviderWebhookVerifier {
  readonly provider: string;
  /** Throws WebhookVerificationError on any failure; never logs raw input. */
  verify(input: VerifyWebhookInput): Promise<VerifiedProviderEvent>;
}

/** Event-processing lifecycle states (see providerEvents repositories). */
export const PROVIDER_EVENT_STATES = [
  "received",
  "processing",
  "processed",
  "retryable_failure",
  "terminal_failure",
  "ignored",
] as const;
export type ProviderEventState = (typeof PROVIDER_EVENT_STATES)[number];

export interface ProviderEventRecord {
  id: string;
  provider: string;
  providerEventId: string;
  eventType: string;
  eventVersion: string | null;
  receivedAt: Date;
  providerCreatedAt: Date | null;
  state: ProviderEventState;
  attempts: number;
  lastErrorClass: string | null;
  payloadDigest: string;
  keyId: string | null;
  leaseExpiresAt: Date | null;
  processedAt: Date | null;
  terminalAt: Date | null;
}

export interface InsertProviderEventInput {
  id: string;
  provider: string;
  providerEventId: string;
  eventType: string;
  eventVersion?: string | null;
  providerCreatedAt?: Date | null;
  payloadDigest: string;
  keyId?: string | null;
}

/**
 * Durable, replica-safe provider-event store. The (provider, providerEventId)
 * uniqueness in the database is the replay/idempotency authority — never a
 * process-local structure. Provider identity fields are immutable after
 * insert: no store method can modify them.
 */
export interface ProviderEventStore {
  /** Insert if this (provider, providerEventId) was never seen. Returns the
   *  stored record plus whether THIS call inserted it (false = duplicate). */
  insertIfNew(input: InsertProviderEventInput): Promise<{ record: ProviderEventRecord; inserted: boolean }>;
  findById(id: string): Promise<ProviderEventRecord | null>;
  /**
   * Atomically claim an event for processing (compare-and-set): transitions
   * received/retryable_failure — or processing with an EXPIRED lease (stale
   * lease recovery) — to processing, bumping attempts and setting a fresh
   * lease. Returns the claimed record, or null if another processor holds it.
   */
  claim(id: string, now: Date, leaseSeconds: number): Promise<ProviderEventRecord | null>;
  markProcessed(id: string, at: Date): Promise<ProviderEventRecord | null>;
  markRetryable(id: string, errorClass: string, at: Date): Promise<ProviderEventRecord | null>;
  markTerminal(id: string, errorClass: string, at: Date): Promise<ProviderEventRecord | null>;
  markIgnored(id: string, at: Date): Promise<ProviderEventRecord | null>;
}

/** Outcome a processor handler reports for a claimed event. */
export type ProcessOutcome =
  | { kind: "processed" }
  | { kind: "retry"; errorClass: string }
  | { kind: "terminal"; errorClass: string };

/**
 * A handler for one allowlisted event type. Handlers MUST go through the
 * existing domain services (identity/session/wallet) so every invariant —
 * ownership scoping, uniqueness, atomic transitions — still applies; a
 * webhook can never directly persist secret material or attach a wallet to
 * the wrong user, because the domain layer refuses.
 */
export interface ProviderEventHandler {
  handle(event: ProviderEventRecord, data: Record<string, unknown>): Promise<ProcessOutcome>;
}
