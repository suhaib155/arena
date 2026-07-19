/**
 * In-memory ProviderEventStore — tests/dev only, never production (production
 * wires the Drizzle implementation; the securityControls guard test forbids
 * production imports from testDoubles, and this module is wired only via the
 * webhook router's explicit deps). Mirrors the DB semantics exactly:
 * (provider, providerEventId) uniqueness, CAS claim with lease, and immutable
 * provider identity fields (lifecycle methods never touch them).
 */
import { randomToken } from "../crypto/secure.js";
import { UniqueConstraintError } from "../repositories/interfaces.js";
import type {
  InsertProviderEventInput,
  ProviderEventRecord,
  ProviderEventStore,
} from "./types.js";

const clone = (r: ProviderEventRecord): ProviderEventRecord => ({ ...r });

export class InMemoryProviderEventStore implements ProviderEventStore {
  private rows = new Map<string, ProviderEventRecord>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async insertIfNew(
    input: InsertProviderEventInput
  ): Promise<{ record: ProviderEventRecord; inserted: boolean }> {
    for (const r of this.rows.values()) {
      if (r.provider === input.provider && r.providerEventId === input.providerEventId) {
        return { record: clone(r), inserted: false };
      }
    }
    const rec: ProviderEventRecord = {
      id: input.id,
      provider: input.provider,
      providerEventId: input.providerEventId,
      eventType: input.eventType,
      eventVersion: input.eventVersion ?? null,
      receivedAt: this.now(),
      providerCreatedAt: input.providerCreatedAt ?? null,
      state: "received",
      attempts: 0,
      lastErrorClass: null,
      payloadDigest: input.payloadDigest,
      keyId: input.keyId ?? null,
      leaseExpiresAt: null,
      leaseToken: null,
      processedAt: null,
      terminalAt: null,
    };
    this.rows.set(rec.id, rec);
    return { record: clone(rec), inserted: true };
  }

  async findById(id: string): Promise<ProviderEventRecord | null> {
    const r = this.rows.get(id);
    return r ? clone(r) : null;
  }

  async claim(id: string, now: Date, leaseSeconds: number): Promise<ProviderEventRecord | null> {
    const r = this.rows.get(id);
    if (!r) return null;
    const claimable =
      r.state === "received" ||
      r.state === "retryable_failure" ||
      // Stale-lease recovery: a crashed processor's claim expires.
      (r.state === "processing" && r.leaseExpiresAt !== null && r.leaseExpiresAt.getTime() < now.getTime());
    if (!claimable) return null;
    r.state = "processing";
    r.attempts += 1;
    r.leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000);
    r.leaseToken = randomToken(16); // fresh processing generation
    return clone(r);
  }

  /** A settle transition is valid only for the CURRENT claim's token. */
  private owns(r: ProviderEventRecord | undefined, leaseToken: string): r is ProviderEventRecord {
    return !!r && r.state === "processing" && r.leaseToken === leaseToken;
  }

  async markProcessed(id: string, leaseToken: string, at: Date): Promise<ProviderEventRecord | null> {
    const r = this.rows.get(id);
    if (!this.owns(r, leaseToken)) return null;
    r.state = "processed";
    r.processedAt = at;
    r.leaseExpiresAt = null;
    r.leaseToken = null;
    return clone(r);
  }

  async markRetryable(id: string, leaseToken: string, errorClass: string, at: Date): Promise<ProviderEventRecord | null> {
    const r = this.rows.get(id);
    if (!this.owns(r, leaseToken)) return null;
    r.state = "retryable_failure";
    r.lastErrorClass = errorClass;
    r.leaseExpiresAt = null;
    r.leaseToken = null;
    void at;
    return clone(r);
  }

  async markTerminal(id: string, leaseToken: string, errorClass: string, at: Date): Promise<ProviderEventRecord | null> {
    const r = this.rows.get(id);
    if (!this.owns(r, leaseToken)) return null;
    r.state = "terminal_failure";
    r.lastErrorClass = errorClass;
    r.terminalAt = at;
    r.leaseExpiresAt = null;
    r.leaseToken = null;
    return clone(r);
  }

  async markIgnored(id: string, leaseToken: string, at: Date): Promise<ProviderEventRecord | null> {
    const r = this.rows.get(id);
    if (!this.owns(r, leaseToken)) return null;
    r.state = "ignored";
    r.terminalAt = at;
    r.leaseExpiresAt = null;
    r.leaseToken = null;
    return clone(r);
  }
}

// Re-exported so callers converting DB conflicts share one error type.
export { UniqueConstraintError };
