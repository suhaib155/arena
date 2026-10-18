/**
 * The server's ledger step: the shared holding ledger, one event at a time,
 * with the per-walker daily take budget applied in the same pass.
 *
 * Pure: the service loads the locked state and the walkers' counters, calls
 * this, and stores exactly what it returns in the same transaction. Every
 * holding rule (A9 or the two-day challenge, masks, deeds, decay, the
 * one-push rule) stays in `@movenrun/shared/holding`; this file adds only
 * the budget, which the shared models do not have.
 *
 * Order: events are applied by day, then event id (the shared ledger's
 * order), so the same batch always gives the same result whatever order it
 * arrived in. Across batches the order is commit order.
 */
import type { HoldingRules, PushOutcome, UnitState } from "@movenrun/shared/holding";
import { applyLedger, type LedgerEntry, type PushEvent, type RejectReason } from "@movenrun/shared/holdingLedger";
import type { TakeBudget } from "./rules.js";

/** A server outcome: the model's, plus a push refused by the take budget. */
export type ServerOutcome = PushOutcome | "refused_take_budget";

export const SERVER_OUTCOMES: readonly ServerOutcome[] = [
  "claimed", "reinforced", "eroded", "flipped", "refused_deeded", "refused_masked", "refused_daily_limit", "refused_take_budget",
];

export interface ServerLedgerEntry extends Omit<LedgerEntry, "outcome"> {
  outcome: ServerOutcome;
  /** Shade strength for a shade push, else null. */
  shadeStrength: number | null;
}

export type ServerEventResult =
  | { eventId: string; unitId: string; status: "applied"; outcome: ServerOutcome }
  | { eventId: string; unitId: string; status: "skipped"; reason: "already_applied" }
  | { eventId: string; unitId: string; status: "rejected"; reason: RejectReason; detail?: string };

/** A take (`TakeBudget` "takes-v1"): an applied push on ground another walker held at that moment. */
export function isTake(outcome: ServerOutcome): boolean {
  return outcome === "eroded" || outcome === "flipped";
}

export interface ServerLedgerInput {
  states: ReadonlyMap<string, UnitState>;
  events: readonly PushEvent[];
  holding: HoldingRules;
  /** Event ids already in the ledger; they are skipped and count for nothing. */
  appliedEventIds?: Iterable<string>;
  /** Takes already used, by walker, on the events' day (from the store, never the client). */
  takesUsed?: ReadonlyMap<string, number>;
  budget: TakeBudget | null;
}

export interface ServerLedgerResult {
  states: Map<string, UnitState>;
  results: ServerEventResult[];
  /** Applied pushes and budget refusals, in the order they were applied. */
  entries: ServerLedgerEntry[];
  /** Takes used after the batch, by walker (every walker of the input and of the batch). */
  takesUsed: Map<string, number>;
}

function compareEvents(a: PushEvent, b: PushEvent): number {
  // The shared ledger's order (holdingLedger.ts).
  const da = Number.isFinite(a.day) ? a.day : -Infinity;
  const db = Number.isFinite(b.day) ? b.day : -Infinity;
  if (da !== db) return da < db ? -1 : 1;
  const ia = String(a.eventId);
  const ib = String(b.eventId);
  if (ia !== ib) return ia < ib ? -1 : 1;
  const ka = JSON.stringify([a.unitId, a.walkerId, a.push]);
  const kb = JSON.stringify([b.unitId, b.walkerId, b.push]);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

export function applyServerLedger(input: ServerLedgerInput): ServerLedgerResult {
  const states = new Map(input.states);
  const applied = new Set(input.appliedEventIds ?? []);
  const takesUsed = new Map(input.takesUsed ?? []);
  const results: ServerEventResult[] = [];
  const entries: ServerLedgerEntry[] = [];
  const cap = input.budget?.perWalkerPerDay ?? null;

  for (const event of [...input.events].sort(compareEvents)) {
    const before = typeof event.unitId === "string" ? states.get(event.unitId) : undefined;
    const one = applyLedger({
      states: before ? new Map([[event.unitId, before]]) : new Map(),
      events: [event],
      rules: input.holding,
      appliedEventIds: applied.has(event.eventId) ? [event.eventId] : [],
    });
    const r = one.results[0]!;
    if (r.status === "skipped") {
      results.push({ eventId: r.eventId, unitId: r.unitId, status: "skipped", reason: "already_applied" });
      continue;
    }
    if (r.status === "rejected") {
      results.push(r);
      continue;
    }
    const entry = one.entries[0]!;
    const shadeStrength = event.push.kind === "shade" ? Math.floor(event.push.strength) : null;
    const used = takesUsed.get(event.walkerId) ?? 0;
    applied.add(event.eventId);
    if (isTake(entry.outcome) && cap !== null && used >= cap) {
      // Past the budget: recorded, so a retry is skipped, and nothing changes.
      results.push({ eventId: event.eventId, unitId: event.unitId, status: "applied", outcome: "refused_take_budget" });
      entries.push({
        ...entry, outcome: "refused_take_budget", newHolderId: before!.holderId, strengthAfter: before!.strength, shadeStrength,
      });
      continue;
    }
    states.set(event.unitId, one.states.get(event.unitId)!);
    if (isTake(entry.outcome)) takesUsed.set(event.walkerId, used + 1);
    else if (!takesUsed.has(event.walkerId)) takesUsed.set(event.walkerId, used);
    results.push({ eventId: event.eventId, unitId: event.unitId, status: "applied", outcome: entry.outcome });
    entries.push({ ...entry, shadeStrength });
  }
  return { states, results, entries, takesUsed };
}
