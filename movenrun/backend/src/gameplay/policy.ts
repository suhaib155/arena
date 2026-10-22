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
 * It also applies the server's per-walker daily unit budget (a capacity
 * guard, not a game rule): a push the model would apply, past the walker's
 * remaining units, is rejected as `unit_budget` and changes nothing.
 *
 * Order: events are applied by day, then event id (the shared ledger's
 * order), so the same batch always gives the same result whatever order it
 * arrived in. Across batches the order is commit order.
 */
import { decayTo, type HoldingRules, type PushOutcome, type UnitState } from "@movenrun/shared/holding";
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

/** The model's reasons, plus a push past the walker's daily unit budget. */
export type ServerRejectReason = RejectReason | "unit_budget";

/** Refused outcomes: recorded as counts, they change no ground. */
export const REFUSED_OUTCOMES = ["refused_deeded", "refused_masked", "refused_daily_limit", "refused_take_budget"] as const;
export type RefusedOutcome = (typeof REFUSED_OUTCOMES)[number];

export function isRefused(outcome: ServerOutcome): outcome is RefusedOutcome {
  return (REFUSED_OUTCOMES as readonly string[]).includes(outcome);
}

export type ServerEventResult =
  | { eventId: string; unitId: string; status: "applied"; outcome: ServerOutcome }
  | { eventId: string; unitId: string; status: "skipped"; reason: "already_applied" }
  | { eventId: string; unitId: string; status: "rejected"; reason: ServerRejectReason; detail?: string };

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
  /**
   * Verified units each walker may still push on the events' day (from the
   * store, never the client). Absent: no unit budget. A walker missing from
   * the map has none left.
   */
  unitsRemaining?: ReadonlyMap<string, number>;
  /**
   * Walk position of each event (its unit's first-touch index in the
   * session path). Used only when the budget's order is `walk-order-v1`;
   * events without one come after, by event id.
   */
  walkOrder?: ReadonlyMap<string, number>;
  /** The challenge's day-boundary guard (`SecondPushGap`), with the server receipt times it needs. */
  secondPush?: SecondPushInput;
}

export interface SecondPushInput {
  minElapsedMs: number;
  windowDays: number;
  /** Server receipt time of each event's session (epoch ms). */
  eventReceivedMs: ReadonlyMap<string, number>;
  /** Server receipt time of the session that opened each open challenge, keyed by `challengeKey`. Unknown is treated as too recent. */
  challengeOpenedMs: ReadonlyMap<string, number>;
}

export const challengeKey = (unitId: string, walkerId: string) => `${unitId}\u0000${walkerId}`;

export interface ServerLedgerResult {
  states: Map<string, UnitState>;
  results: ServerEventResult[];
  /** Applied pushes and budget refusals, in the order they were applied. */
  entries: ServerLedgerEntry[];
  /** Takes used after the batch, by walker (every walker of the input and of the batch). */
  takesUsed: Map<string, number>;
  /** Units this batch counted against each walker's unit budget: every applied push, refusals included. */
  unitsUsed: Map<string, number>;
  /** With `secondPush`: receipt times of open challenges after the batch (input ones plus any opened by it). */
  challengeOpenedMs: Map<string, number>;
}

function walkComparator(walk: ReadonlyMap<string, number>) {
  return (a: PushEvent, b: PushEvent): number => {
    const da = Number.isFinite(a.day) ? a.day : -Infinity;
    const db = Number.isFinite(b.day) ? b.day : -Infinity;
    if (da !== db) return da < db ? -1 : 1;
    const wa = walk.get(String(a.eventId)) ?? Infinity;
    const wb = walk.get(String(b.eventId)) ?? Infinity;
    if (wa !== wb) return wa < wb ? -1 : 1;
    return compareEvents(a, b);
  };
}

/** The shared ledger's event order. */
export function compareEvents(a: PushEvent, b: PushEvent): number {
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
  const unitsUsed = new Map<string, number>();

  const order = input.budget?.order === "walk-order-v1" && input.walkOrder ? walkComparator(input.walkOrder) : compareEvents;
  const opened = new Map(input.secondPush?.challengeOpenedMs ?? []);

  for (const event of [...input.events].sort(order)) {
    const before = typeof event.unitId === "string" ? states.get(event.unitId) : undefined;
    // The day-boundary guard: a would-be second push that comes too soon after
    // the push that opened the challenge is shown to the model as a same-day
    // challenge, so it cannot complete it; the real first day is put back after.
    const held = input.secondPush && before ? tooSoon(before, event, input.secondPush, opened, input.holding) : null;
    const one = applyLedger({
      states: before ? new Map([[event.unitId, held ? held.presented : before]]) : new Map(),
      events: [event],
      rules: input.holding,
      appliedEventIds: applied.has(event.eventId) ? [event.eventId] : [],
    });
    if (held && one.entries[0]) {
      one.entries[0] = { ...one.entries[0], strengthBefore: before!.strength };
      const s = one.states.get(event.unitId);
      if (s?.challenges) {
        one.states.set(event.unitId, { ...s, challenges: s.challenges.map((c) => (c.walkerId === event.walkerId ? { ...c, day: held.firstDay } : c)) });
      }
    }
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
    if (input.unitsRemaining) {
      const spent = unitsUsed.get(event.walkerId) ?? 0;
      if (spent >= (input.unitsRemaining.get(event.walkerId) ?? 0)) {
        // Past the unit budget: not applied, not recorded, nothing changes.
        results.push({ eventId: event.eventId, unitId: event.unitId, status: "rejected", reason: "unit_budget" });
        continue;
      }
    }
    unitsUsed.set(event.walkerId, (unitsUsed.get(event.walkerId) ?? 0) + 1);
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
    const after = one.states.get(event.unitId)!;
    states.set(event.unitId, after);
    if (input.secondPush && after.challenges?.some((c) => c.walkerId === event.walkerId) && !before?.challenges?.some((c) => c.walkerId === event.walkerId)) {
      const at = input.secondPush.eventReceivedMs.get(event.eventId);
      if (at !== undefined) opened.set(challengeKey(event.unitId, event.walkerId), at);
    }
    if (isTake(entry.outcome)) takesUsed.set(event.walkerId, used + 1);
    else if (!takesUsed.has(event.walkerId)) takesUsed.set(event.walkerId, used);
    results.push({ eventId: event.eventId, unitId: event.unitId, status: "applied", outcome: entry.outcome });
    entries.push({ ...entry, shadeStrength });
  }
  return { states, results, entries, takesUsed, unitsUsed, challengeOpenedMs: opened };
}

/**
 * The state to show the model when `event` would complete the walker's open
 * challenge too soon after it opened, else null. The unit is decayed to the
 * event's day first so the moved challenge date stays consistent with it.
 */
function tooSoon(
  before: UnitState, event: PushEvent, gap: SecondPushInput, opened: ReadonlyMap<string, number>, holding: HoldingRules,
): { presented: UnitState; firstDay: number } | null {
  if (before.holderId === null || before.holderId === event.walkerId || !Number.isFinite(event.day) || event.day < before.asOfDay) return null;
  const mine = before.challenges?.find((c) => c.walkerId === event.walkerId);
  if (!mine || !(mine.day < event.day) || event.day - mine.day > gap.windowDays) return null;
  const openedAt = opened.get(challengeKey(event.unitId, event.walkerId));
  const at = gap.eventReceivedMs.get(event.eventId);
  if (openedAt !== undefined && at !== undefined && at - openedAt >= gap.minElapsedMs) return null;
  const decayed = decayTo(before, event.day, holding);
  if (decayed.holderId === null || !decayed.challenges) return null;
  return {
    presented: { ...decayed, challenges: decayed.challenges.map((c) => (c.walkerId === event.walkerId ? { ...c, day: event.day } : c)) },
    firstDay: mine.day,
  };
}
