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
    await this.audit.record(inserted ? "webhook_accepted" : "webhook_duplicate", {
      subjectId: record.id,
      metadata: { provider: event.provider, eventType: event.eventType },
    });
    return { record, duplicate: !inserted };
  }

  /**
   * Claim and process one stored event. Idempotent and safe to call from any
   * number of workers: the CAS claim admits exactly one processor at a time,
   * and every terminal state refuses further transitions.
   */
  async process(eventId: string, data: Record<string, unknown> = {}): Promise<ProviderEventRecord | null> {
    const now = this.now();
    const claimed = await this.store.claim(eventId, now, this.leaseSeconds);
    if (!claimed) return null; // someone else holds it, or it is finished

    await this.audit.record("provider_event_processing_started", {
      subjectId: claimed.id,
      metadata: { eventType: claimed.eventType, attempt: claimed.attempts },
    });

    const handler = this.handlers.get(claimed.eventType);
    if (!handler) {
      // Not on the allowlist → safely ignored, durably recorded, audited.
      const ignored = await this.store.markIgnored(claimed.id, this.now());
      await this.audit.record("provider_event_ignored", {
        subjectId: claimed.id,
        metadata: { eventType: claimed.eventType },
      });
      return ignored;
    }

    try {
      const outcome = await handler.handle(claimed, data);
      if (outcome.kind === "processed") {
        const done = await this.store.markProcessed(claimed.id, this.now());
        await this.audit.record("provider_event_processed", { subjectId: claimed.id });
        return done;
      }
      if (outcome.kind === "terminal") {
        const term = await this.store.markTerminal(claimed.id, outcome.errorClass, this.now());
        await this.audit.record("provider_event_terminal", {
          subjectId: claimed.id,
          metadata: { errorClass: outcome.errorClass },
        });
        return term;
      }
      return this.settleRetry(claimed, outcome.errorClass);
    } catch (err) {
      // A throwing handler is a retryable failure by default — bounded below.
      const errorClass = err instanceof Error ? err.name : "unknown_error";
      return this.settleRetry(claimed, errorClass);
    }
  }

  /** Bounded retries: beyond maxAttempts a retryable failure becomes terminal. */
  private async settleRetry(claimed: ProviderEventRecord, errorClass: string): Promise<ProviderEventRecord | null> {
    if (claimed.attempts >= this.maxAttempts) {
      const term = await this.store.markTerminal(claimed.id, errorClass, this.now());
      await this.audit.record("provider_event_terminal", {
        subjectId: claimed.id,
        metadata: { errorClass, exhausted: true },
      });
      return term;
    }
    const retry = await this.store.markRetryable(claimed.id, errorClass, this.now());
    await this.audit.record("provider_event_retryable", {
      subjectId: claimed.id,
      metadata: { errorClass, attempt: claimed.attempts },
    });
    return retry;
  }
}
