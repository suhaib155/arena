/**
 * Postgres-backed ProviderEventStore (production).
 *
 * All security-relevant transitions are single conditional statements so they
 * are atomic across replicas:
 *  - insertIfNew: INSERT ... ON CONFLICT (provider, provider_event_id) DO
 *    NOTHING — the unique index is the replay authority; a duplicate delivery
 *    inserts nothing and returns the existing row.
 *  - claim: UPDATE ... WHERE state claimable OR lease expired ... RETURNING —
 *    a compare-and-set; exactly one concurrent processor can win.
 *  - mark*: conditional on the expected current state, so out-of-order or
 *    duplicate lifecycle calls cannot corrupt the state machine.
 * No method can modify the provider identity fields after insert.
 */
import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import { randomToken } from "../crypto/secure.js";
import type { Db } from "../../db/client.js";
import { providerEvents } from "../../db/provider.schema.js";
import type {
  InsertProviderEventInput,
  ProviderEventRecord,
  ProviderEventStore,
} from "./types.js";

const toRecord = (r: typeof providerEvents.$inferSelect): ProviderEventRecord => ({ ...r });

export class DrizzleProviderEventStore implements ProviderEventStore {
  constructor(private readonly db: Db) {}

  async insertIfNew(
    input: InsertProviderEventInput
  ): Promise<{ record: ProviderEventRecord; inserted: boolean }> {
    const inserted = await this.db
      .insert(providerEvents)
      .values({
        id: input.id,
        provider: input.provider,
        providerEventId: input.providerEventId,
        eventType: input.eventType,
        eventVersion: input.eventVersion ?? null,
        providerCreatedAt: input.providerCreatedAt ?? null,
        payloadDigest: input.payloadDigest,
        keyId: input.keyId ?? null,
      })
      .onConflictDoNothing({ target: [providerEvents.provider, providerEvents.providerEventId] })
      .returning();
    if (inserted.length > 0) return { record: toRecord(inserted[0]), inserted: true };
    const [existing] = await this.db
      .select()
      .from(providerEvents)
      .where(
        and(eq(providerEvents.provider, input.provider), eq(providerEvents.providerEventId, input.providerEventId))
      )
      .limit(1);
    // The conflict row must exist (it caused the conflict); if it vanished the
    // caller's insert can simply be retried by the provider's redelivery.
    if (!existing) throw new Error("provider event conflict row not found");
    return { record: toRecord(existing), inserted: false };
  }

  async findById(id: string): Promise<ProviderEventRecord | null> {
    const [row] = await this.db.select().from(providerEvents).where(eq(providerEvents.id, id)).limit(1);
    return row ? toRecord(row) : null;
  }

  async claim(id: string, now: Date, leaseSeconds: number): Promise<ProviderEventRecord | null> {
    const lease = new Date(now.getTime() + leaseSeconds * 1000);
    const [row] = await this.db
      .update(providerEvents)
      // Fresh processing generation every claim (stale reclaims get a new one).
      .set({ state: "processing", attempts: sql`${providerEvents.attempts} + 1`, leaseExpiresAt: lease, leaseToken: randomToken(16) })
      .where(
        and(
          eq(providerEvents.id, id),
          or(
            inArray(providerEvents.state, ["received", "retryable_failure"]),
            // Stale-lease recovery: an expired processing claim is reclaimable.
            and(eq(providerEvents.state, "processing"), lt(providerEvents.leaseExpiresAt, now))
          )
        )
      )
      .returning();
    return row ? toRecord(row) : null;
  }

  /** Settle only the CURRENT claim: state='processing' AND matching token. */
  private ownedProcessing(id: string, leaseToken: string) {
    return and(
      eq(providerEvents.id, id),
      eq(providerEvents.state, "processing"),
      eq(providerEvents.leaseToken, leaseToken)
    );
  }

  async markProcessed(id: string, leaseToken: string, at: Date): Promise<ProviderEventRecord | null> {
    const [row] = await this.db
      .update(providerEvents)
      .set({ state: "processed", processedAt: at, leaseExpiresAt: null, leaseToken: null })
      .where(this.ownedProcessing(id, leaseToken))
      .returning();
    return row ? toRecord(row) : null;
  }

  async markRetryable(id: string, leaseToken: string, errorClass: string, _at: Date): Promise<ProviderEventRecord | null> {
    const [row] = await this.db
      .update(providerEvents)
      .set({ state: "retryable_failure", lastErrorClass: errorClass, leaseExpiresAt: null, leaseToken: null })
      .where(this.ownedProcessing(id, leaseToken))
      .returning();
    return row ? toRecord(row) : null;
  }

  async markTerminal(id: string, leaseToken: string, errorClass: string, at: Date): Promise<ProviderEventRecord | null> {
    const [row] = await this.db
      .update(providerEvents)
      .set({ state: "terminal_failure", lastErrorClass: errorClass, terminalAt: at, leaseExpiresAt: null, leaseToken: null })
      .where(this.ownedProcessing(id, leaseToken))
      .returning();
    return row ? toRecord(row) : null;
  }

  async markIgnored(id: string, leaseToken: string, at: Date): Promise<ProviderEventRecord | null> {
    const [row] = await this.db
      .update(providerEvents)
      .set({ state: "ignored", terminalAt: at, leaseExpiresAt: null, leaseToken: null })
      .where(this.ownedProcessing(id, leaseToken))
      .returning();
    return row ? toRecord(row) : null;
  }
}
