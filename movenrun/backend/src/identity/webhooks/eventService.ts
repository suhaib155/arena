/**
 * Provider-event ingestion + idempotent processing skeleton (ADR-0013).
 *
 * ingest():  persist a VERIFIED event exactly once. The DB unique index on
 *            (provider, providerEventId) makes duplicate/concurrent deliveries
 *            converge on one row; the caller returns idempotent success.
 *
 * process(): claim (atomic CAS with lease) → dispatch to an ALLOWLISTED
 *            handler → mark processed / retryable (bounded) / terminal /
 *            ignored. Unknown event types are safely ignored and audited.
 *            Handlers must call the existing domain services, so identity and
 *            wallet invariants (ownership scoping, uniqueness, atomicity)
 *            still hold — a webhook can never bypass them, persist secret
 *            material, or attach a wallet to the wrong user.
 *
 * The production handler registry is EMPTY until ADR-0011 selects a provider
 * and its event semantics — every verified event is stored durably and then
 * ignored (audited), which is this PR's declared stopping point.
 */
import { newId } from "../crypto/secure.js";
import type { AuditService } from "../services/audit.service.js";
import type {
  ProviderEventHandler,
  ProviderEventRecord,
  ProviderEventStore,
  VerifiedProviderEvent,
} from "./types.js";

export interface ProviderEventServiceOptions {
  store: ProviderEventStore;
  audit: AuditService;
  /** eventType → handler. This IS the allowlist: anything absent is ignored. */
  handlers?: ReadonlyMap<string, ProviderEventHandler>;
  maxAttempts?: number;
  leaseSeconds?: number;
  now?: () => Date;
  idGen?: () => string;
}

export interface IngestResult {
  record: ProviderEventRecord;
  duplicate: boolean;
  /** True when this delivery duplicates a stored event ID but carries a
   *  DIFFERENT payload digest — a security anomaly (a valid-signed reuse of an
   *  id with changed content), not an ordinary duplicate. */
  digestMismatch: boolean;
}

export class ProviderEventService {
  private readonly store: ProviderEventStore;
  private readonly audit: AuditService;
  private readonly handlers: ReadonlyMap<string, ProviderEventHandler>;
  private readonly maxAttempts: number;
  private readonly leaseSeconds: number;
  private readonly now: () => Date;
  private readonly idGen: () => string;

  constructor(opts: ProviderEventServiceOptions) {
    this.store = opts.store;
    this.audit = opts.audit;
    this.handlers = opts.handlers ?? new Map();
    this.maxAttempts = opts.maxAttempts ?? 5;
    this.leaseSeconds = opts.leaseSeconds ?? 60;
    this.now = opts.now ?? (() => new Date());
    this.idGen = opts.idGen ?? newId;
  }

  /** Persist a verified event exactly once (DB-authoritative idempotency). */
  async ingest(event: VerifiedProviderEvent): Promise<IngestResult> {
    const { record, inserted } = await this.store.insertIfNew({
      id: this.idGen(),
      provider: event.provider,
      providerEventId: event.providerEventId,
      eventType: event.eventType,
      eventVersion: event.eventVersion,
      providerCreatedAt: event.providerCreatedAt,
      payloadDigest: event.payloadDigest,
      keyId: event.keyId,
    });
    // A duplicate that carries a DIFFERENT digest for the same event id is a
    // security anomaly (valid-signed reuse of an id with changed content), not
    // an ordinary duplicate — surface it as a distinct rejection signal. The
    // FIRST delivery's content stays authoritative (never overwritten).
    const digestMismatch = !inserted && record.payloadDigest !== event.payloadDigest;
    if (inserted) {
      await this.audit.record("webhook_accepted", {
        subjectId: record.id,
        metadata: { provider: event.provider, eventType: event.eventType },
      });
    } else if (digestMismatch) {
      await this.audit.record("webhook_rejected", {
        subjectId: record.id,
        metadata: { provider: event.provider, eventType: event.eventType, reason: "digest_mismatch" },
      });
    } else {
      await this.audit.record("webhook_duplicate", {
        subjectId: record.id,
        metadata: { provider: event.provider, eventType: event.eventType },
      });
    }
    return { record, duplicate: !inserted, digestMismatch };
  }

  /**
   * Claim and process one stored event. Idempotent and safe to call from any
   * number of workers: the CAS claim admits exactly one processor at a time,
   * and every terminal state refuses further transitions.
   */
  async process(eventId: string, data: Record<string, unknown> = {}): Promise<ProviderEventRecord | null> {
    const now = this.now();
    const claimed = await this.store.claim(eventId, now, this.leaseSeconds);
    if (!claimed || !claimed.leaseToken) return null; // someone else holds it, or it is finished
    // Bind every settle transition to THIS claim's token, so a slow worker
    // whose lease was reclaimed cannot overwrite the newer claim's result.
    const token = claimed.leaseToken;

    await this.audit.record("provider_event_processing_started", {
      subjectId: claimed.id,
      metadata: { eventType: claimed.eventType, attempt: claimed.attempts },
    });

    const handler = this.handlers.get(claimed.eventType);
    if (!handler) {
      // Not on the allowlist → safely ignored, durably recorded, audited.
      const ignored = await this.store.markIgnored(claimed.id, token, this.now());
      await this.audit.record("provider_event_ignored", {
        subjectId: claimed.id,
        metadata: { eventType: claimed.eventType },
      });
      return ignored;
    }

    try {
      const outcome = await handler.handle(claimed, data);
      if (outcome.kind === "processed") {
        const done = await this.store.markProcessed(claimed.id, token, this.now());
        if (done) await this.audit.record("provider_event_processed", { subjectId: claimed.id });
        return done;
      }
      if (outcome.kind === "terminal") {
        const term = await this.store.markTerminal(claimed.id, token, outcome.errorClass, this.now());
        if (term) await this.audit.record("provider_event_terminal", {
          subjectId: claimed.id,
          metadata: { errorClass: outcome.errorClass },
        });
        return term;
      }
      return this.settleRetry(claimed, token, outcome.errorClass);
    } catch (err) {
      // A throwing handler is a retryable failure by default — bounded below.
      const errorClass = err instanceof Error ? err.name : "unknown_error";
      return this.settleRetry(claimed, token, errorClass);
    }
  }

  /** Bounded retries: beyond maxAttempts a retryable failure becomes terminal. */
  private async settleRetry(claimed: ProviderEventRecord, token: string, errorClass: string): Promise<ProviderEventRecord | null> {
    if (claimed.attempts >= this.maxAttempts) {
      const term = await this.store.markTerminal(claimed.id, token, errorClass, this.now());
      if (term) await this.audit.record("provider_event_terminal", {
        subjectId: claimed.id,
        metadata: { errorClass, exhausted: true },
      });
      return term;
    }
    const retry = await this.store.markRetryable(claimed.id, token, errorClass, this.now());
    if (retry) await this.audit.record("provider_event_retryable", {
      subjectId: claimed.id,
      metadata: { errorClass, attempt: claimed.attempts },
    });
    return retry;
  }
}
