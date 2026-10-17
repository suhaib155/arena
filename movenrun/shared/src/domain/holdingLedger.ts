/**
 * Game Economy V3: applying one session's pushes to many units of ground, as a
 * pure reference model (G2 preparation).
 *
 * `holding.ts` decides what one push does to one unit. This module takes a
 * batch of pushes (one uploaded session, or a retry of one), applies them in a
 * fixed order to a map of unit states, and returns the new states, a result
 * for every event and an append-only list of ledger entries.
 *
 * ## Guarantees
 *
 * - Idempotent: an event whose `eventId` was already applied (passed in
 *   `appliedEventIds`, or seen earlier in the same batch) is skipped and
 *   changes nothing, so a retried upload never counts twice.
 * - Deterministic: events are applied sorted by day, then eventId, so the
 *   order they arrive in does not matter.
 * - One bad event never throws: an event dated before its unit's last change,
 *   for an unknown unit, with a malformed push, or that would leave a state
 *   failing `unitProblems()` is returned as rejected and changes nothing.
 *   Rejected events are not recorded as applied; a retry is rejected again.
 * - Every output state passes `unitProblems()`. Input states must too: an
 *   inconsistent input is a caller or store bug and throws.
 *
 * ## What it is not
 *
 * It stores nothing, is not wired into the API, the app or the database, and
 * decides no geometry. Rules (D4), shade strength (D2) and what a unit is
 * (D5) all come in from the caller, as in `holding.ts`.
 */

import {
  applyPush,
  MAX_SHADE_STRENGTH,
  newUnit,
  unitProblems,
  type HoldingRules,
  type Push,
  type PushOutcome,
  type UnitState,
} from "./holding";

export interface PushEvent {
  /** Stable id from the uploading client; the idempotency key. */
  eventId: string;
  unitId: string;
  walkerId: string;
  push: Push;
  /** Day index, the same scale as `UnitState.asOfDay`. */
  day: number;
}

export type RejectReason =
  | "stale_day"        // earlier than the unit's asOfDay
  | "unknown_unit"     // not in the states and createMissing is off
  | "invalid_event"    // missing ids, a bad day or a malformed push
  | "inconsistent_state"; // the push would leave a state failing unitProblems()

export type EventResult =
  | { eventId: string; unitId: string; status: "applied"; outcome: PushOutcome; removed: number }
  | { eventId: string; unitId: string; status: "skipped"; reason: "already_applied" }
  | { eventId: string; unitId: string; status: "rejected"; reason: RejectReason; detail?: string };

/** One append-only record per applied event, refusals included. */
export interface LedgerEntry {
  eventId: string;
  unitId: string;
  walkerId: string;
  day: number;
  /** Stepped on ("solid") or only enclosed ("shade"); settlement counts only stepped-on visits. */
  pushKind: Push["kind"];
  outcome: PushOutcome;
  previousHolderId: string | null;
  newHolderId: string | null;
  /** Strength as stored before the push (before decay to `day`). */
  strengthBefore: number;
  strengthAfter: number;
  rulesVersion: number;
}

export interface LedgerInput {
  states: ReadonlyMap<string, UnitState> | Readonly<Record<string, UnitState>>;
  events: readonly PushEvent[];
  rules: HoldingRules;
  /** Event ids applied by earlier batches; they are skipped. */
  appliedEventIds?: Iterable<string>;
  /** Create an unknown unit with `newUnit(unitId, day)` instead of rejecting the event. */
  createMissing?: boolean;
}

export interface LedgerResult {
  /** Every input unit plus any created, keyed by unitId. A new map; the input is not changed. */
  states: Map<string, UnitState>;
  /** One per input event, in the order they were applied (day, then eventId). */
  results: EventResult[];
  entries: LedgerEntry[];
  /** The input ids plus every id applied here, sorted; pass it to the next batch. */
  appliedEventIds: string[];
}

function compareEvents(a: PushEvent, b: PushEvent): number {
  // A malformed day or id still sorts consistently; such events are rejected anyway.
  const da = Number.isFinite(a.day) ? a.day : -Infinity;
  const db = Number.isFinite(b.day) ? b.day : -Infinity;
  if (da !== db) return da < db ? -1 : 1;
  const ia = String(a.eventId);
  const ib = String(b.eventId);
  if (ia !== ib) return ia < ib ? -1 : 1;
  // Same id twice: a stable tie-break on the content, so a shuffle cannot change which one applies.
  const ka = JSON.stringify([a.unitId, a.walkerId, a.push]);
  const kb = JSON.stringify([b.unitId, b.walkerId, b.push]);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

function eventProblem(e: PushEvent): string | null {
  if (typeof e.eventId !== "string" || e.eventId === "") return "missing eventId";
  if (typeof e.unitId !== "string" || e.unitId === "") return "missing unitId";
  if (typeof e.walkerId !== "string" || e.walkerId === "") return "missing walkerId";
  if (!Number.isInteger(e.day) || e.day < 0) return "day must be a whole number, 0 or more";
  const p = e.push as Push | undefined;
  if (!p || (p.kind !== "solid" && p.kind !== "shade")) return "unknown push kind";
  if (p.kind === "shade" && (!Number.isFinite(p.strength) || p.strength < 0 || p.strength > MAX_SHADE_STRENGTH)) {
    return "shade strength must be between 0 and 25";
  }
  // Under 1 a shade push floors to nothing: it would hold unheld ground at 0 or spend the
  // walker's one push of the day on someone else's ground for no effect. Rejected here, on
  // the event alone, so a retry is rejected again whatever the unit's state by then.
  if (p.kind === "shade" && Math.floor(p.strength) < 1) return "shade strength under 1 pushes nothing";
  return null;
}

function toMap(states: LedgerInput["states"]): Map<string, UnitState> {
  const entries: [string, UnitState][] = states instanceof Map ? [...states.entries()] : Object.entries(states);
  const out = new Map<string, UnitState>();
  for (const [key, state] of entries) {
    if (state.unitId !== key) throw new RangeError(`unit ${key} is stored under the wrong id (${state.unitId})`);
    const problems = unitProblems(state);
    if (problems.length > 0) throw new RangeError(`unit ${key} is inconsistent: ${problems.join(", ")}`);
    out.set(key, state);
  }
  return out;
}

/** Apply a batch of pushes. Pure: the same input always gives the same output. */
export function applyLedger(input: LedgerInput): LedgerResult {
  const { rules, createMissing = false } = input;
  const states = toMap(input.states);
  const applied = new Set(input.appliedEventIds ?? []);
  const results: EventResult[] = [];
  const entries: LedgerEntry[] = [];

  for (const event of [...input.events].sort(compareEvents)) {
    const { eventId, unitId } = event;
    const invalid = eventProblem(event);
    if (invalid) {
      results.push({ eventId, unitId, status: "rejected", reason: "invalid_event", detail: invalid });
      continue;
    }
    if (applied.has(eventId)) {
      results.push({ eventId, unitId, status: "skipped", reason: "already_applied" });
      continue;
    }
    let before = states.get(unitId);
    if (!before) {
      if (!createMissing) {
        results.push({ eventId, unitId, status: "rejected", reason: "unknown_unit" });
        continue;
      }
      before = newUnit(unitId, event.day);
    }
    if (event.day < before.asOfDay) {
      results.push({ eventId, unitId, status: "rejected", reason: "stale_day", detail: `unit is as of day ${before.asOfDay}` });
      continue;
    }

    let next;
    try {
      next = applyPush({ state: before, walkerId: event.walkerId, push: event.push, day: event.day, rules });
    } catch (err) {
      results.push({ eventId, unitId, status: "rejected", reason: "invalid_event", detail: err instanceof Error ? err.message : String(err) });
      continue;
    }
    const problems = unitProblems(next.state);
    if (problems.length > 0) {
      results.push({ eventId, unitId, status: "rejected", reason: "inconsistent_state", detail: problems.join(", ") });
      continue;
    }

    states.set(unitId, next.state);
    applied.add(eventId);
    results.push({ eventId, unitId, status: "applied", outcome: next.outcome, removed: next.removed });
    entries.push({
      eventId,
      unitId,
      walkerId: event.walkerId,
      day: event.day,
      pushKind: event.push.kind,
      outcome: next.outcome,
      previousHolderId: before.holderId,
      newHolderId: next.state.holderId,
      strengthBefore: before.strength,
      strengthAfter: next.state.strength,
      rulesVersion: rules.rulesVersion,
    });
  }

  return { states, results, entries, appliedEventIds: [...applied].sort() };
}
