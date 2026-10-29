/**
 * SIMULATION ONLY. The ledger step of experiment 1003 (see `rules1003.ts`).
 *
 * Each push goes through the server's own ledger step (`applyServerLedger`,
 * one event at a time, 1002's holding rules and second-push gap, no take
 * budget), so the holding arithmetic, the one-push rule, decay, the challenge
 * and the gap are exactly the server's. This file only classifies the push
 * and then applies the 1003 budget and the reduced-strength incidental
 * erosion to the result. Pure.
 */
import { decayTo, erosionResist, type UnitState } from "@movenrun/shared/holding";
import type { PushEvent } from "@movenrun/shared/holdingLedger";
import { applyServerLedger, challengeKey, type ServerRejectReason } from "../policy.js";
import { counts1003, type EventClass1003, type Experiment1003 } from "./rules1003.js";

export interface Entry1003 {
  unitId: string;
  walkerId: string;
  /** Null for refusals by the holding model (one-push rule, masked, deeded). */
  cls: EventClass1003 | null;
  /** The push returned to the walker's own open challenge from an earlier day. */
  deliberate: boolean;
  /** Outcome recorded: the model's, `refused_take_budget` (hard) or `eroded` (softened). */
  outcome: string;
  previousHolderId: string | null;
  /** The budget refused (hard) or weakened (soft) this push. */
  blocked: "hard" | "soft" | null;
  counted: boolean;
}

export interface Session1003Input {
  states: Map<string, UnitState>;
  /** In walk order. */
  events: readonly PushEvent[];
  exp: Experiment1003;
  /** Counted events already used today by the session's walker. */
  used: number;
  /** Units the walker may still push today (server capacity guard), or null for none. */
  unitsRemaining: number | null;
  receivedMs: number;
  /** Receipt times of open challenges (mutated). */
  opened: Map<string, number>;
  gap: boolean;
}

export interface Session1003Result {
  entries: Entry1003[];
  rejected: ServerRejectReason[];
  used: number;
  unitsUsed: number;
}

/** Applies one session's pushes under a 1003 variant. Mutates `states` and `opened`. */
export function applySession1003(input: Session1003Input): Session1003Result {
  const { exp, states, opened } = input;
  const holding = exp.rules.holding;
  const tk = exp.rules.takeover;
  const windowDays = tk.name === "two-day-challenge" ? tk.windowDays : 0;
  const b = exp.budget;
  const entries: Entry1003[] = [];
  const rejected: ServerRejectReason[] = [];
  let used = input.used;
  let unitsUsed = 0;
  for (const e of input.events) {
    const before = states.get(e.unitId)!;
    const trial = applyServerLedger({
      states: new Map([[e.unitId, before]]), events: [e], holding, budget: null,
      unitsRemaining: input.unitsRemaining === null ? undefined : new Map([[e.walkerId, Math.max(0, input.unitsRemaining - unitsUsed)]]),
      secondPush: input.gap && tk.name === "two-day-challenge" && tk.policyVersion === 2
        ? { minElapsedMs: tk.secondPush.minElapsedMs, windowDays: tk.windowDays, eventReceivedMs: new Map([[e.eventId, input.receivedMs]]), challengeOpenedMs: onlyKey(opened, challengeKey(e.unitId, e.walkerId)) }
        : undefined,
    });
    const r = trial.results[0]!;
    if (r.status === "rejected") {
      rejected.push(r.reason);
      continue;
    }
    if (r.status === "skipped") continue;
    unitsUsed += 1;
    const entry = trial.entries[0]!;
    const after = trial.states.get(e.unitId)!;
    if (entry.outcome === "refused_daily_limit" || entry.outcome === "refused_masked" || entry.outcome === "refused_deeded") {
      states.set(e.unitId, after);
      entries.push({ unitId: e.unitId, walkerId: e.walkerId, cls: null, deliberate: false, outcome: entry.outcome, previousHolderId: entry.previousHolderId, blocked: null, counted: false });
      continue;
    }
    const decayed = decayTo(before, e.day, holding);
    const deliberate = decayed.holderId !== null && decayed.holderId !== e.walkerId
      && (decayed.challenges ?? []).some((c) => c.walkerId === e.walkerId && c.day < e.day && e.day - c.day <= windowDays);
    const cls: EventClass1003 = entry.outcome === "claimed" ? "claim" : entry.outcome === "reinforced" ? "defense"
      : entry.outcome === "flipped" ? "flip" : deliberate ? "contested" : "pass_through";
    const counted = counts1003(b, cls, deliberate);
    const over = counted && b.perWalkerPerDay !== null && used >= b.perWalkerPerDay;
    const base = { unitId: e.unitId, walkerId: e.walkerId, deliberate, previousHolderId: entry.previousHolderId };
    if (over && b.mode === "hard") {
      // Refused: nothing changes, the open challenge stays open.
      entries.push({ ...base, cls, outcome: "refused_take_budget", blocked: "hard", counted: false });
      continue;
    }
    if (over) {
      // Soft budget: the push applies at reduced strength and never flips.
      const s = weakened(decayed, e.walkerId, e.day, b.softStrength ?? 25, windowDays, after.pushedBy);
      states.set(e.unitId, s);
      // A soft push is deliberate, so the walker's challenge is already open inside the window and keeps its first day: it is never restarted here.
      const key = challengeKey(e.unitId, e.walkerId);
      if (!opened.has(key)) opened.set(key, input.receivedMs);
      entries.push({ ...base, cls: deliberate ? "contested" : "pass_through", outcome: "eroded", blocked: "soft", counted: false });
      continue;
    }
    let next = after;
    if (cls === "pass_through" && b.incidentalStrength !== null) {
      const cut = Math.floor(b.incidentalStrength * (1 - erosionResist(decayed.level, decayed.fortified)));
      next = { ...after, strength: Math.min(decayed.strength, Math.max(after.strength, decayed.strength - cut)) };
    }
    states.set(e.unitId, next);
    // The step keeps the stored time for a challenge with the same first day and sets a new one for a challenge it opened or restarted.
    for (const [k, v] of trial.challengeOpenedMs) opened.set(k, v);
    if (counted) used += 1;
    entries.push({ ...base, cls, outcome: entry.outcome, blocked: null, counted });
  }
  return { entries, rejected, used, unitsUsed };
}

/** The unit after a push that may not flip: `strength` off (less resistance), at least 1, the walker's challenge kept or opened. */
function weakened(decayed: UnitState, walkerId: string, day: number, strength: number, windowDays: number, pushedBy: UnitState["pushedBy"]): UnitState {
  const cut = Math.floor(strength * (1 - erosionResist(decayed.level, decayed.fortified)));
  const open = (decayed.challenges ?? []).filter((c) => day - c.day <= windowDays);
  const mine = open.find((c) => c.walkerId === walkerId);
  const challenges = [...open.filter((c) => c.walkerId !== walkerId), { walkerId, day: mine ? mine.day : day }]
    .sort((a, b) => (a.walkerId < b.walkerId ? -1 : a.walkerId > b.walkerId ? 1 : 0));
  return { ...decayed, strength: Math.max(1, decayed.strength - cut), asOfDay: day, pushedBy, challenges };
}

/** The one entry of `opened` an event can read (the step copies the whole map it is given). */
function onlyKey(opened: ReadonlyMap<string, number>, key: string): Map<string, number> {
  const v = opened.get(key);
  return v === undefined ? new Map() : new Map([[key, v]]);
}
