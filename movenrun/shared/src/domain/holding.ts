/**
 * Game Economy V3: holding a unit of ground, as a pure reference model (G2
 * preparation).
 *
 * One unit has one holder and a strength of 0 to 100 (section 5). Walking it
 * pushes that strength down; at 0 it changes hands. Time drains it from the
 * last visit. Deeded ground never wears down. Masked ground is never held.
 * Every number the source fixes is used as given and cited; every number it
 * leaves open is a parameter, named after its DECISION NEEDED in
 * `docs/GAME_ECONOMY_V3.md`.
 *
 * ## What it is not
 *
 * It stores nothing and decides no geometry. A "unit" is whatever D5 makes it
 * (a cell or a zone): this model only needs a stable id. Which units a session
 * stepped on and which it enclosed come from the sealing engine; how strong
 * an enclosed (shade) claim is comes from D2, so the caller passes it in.
 * Cells inferred between GPS samples are not stepped on (assumption A1) and
 * must not be passed in as solid pushes.
 *
 * ## Units
 *
 * Strength is a whole number from 0 to 100. Every reduction floors toward the
 * defender (a fractional point of push is lost, a fractional point of decay
 * is not taken), so rounding never hands ground over.
 */

/* ── rules ────────────────────────────────────────────────────────────────── */

export const MAX_STRENGTH = 100;
/** Section 4: a stepped-on unit pushes at full strength. FIXED. */
export const SOLID_PUSH = 100;
/** Section 4: shade claims at most 25 × shape × sprawl. FIXED ceiling; the factors are D2. */
export const MAX_SHADE_STRENGTH = 25;
/** Section 9: level and fortification together resist erosion by at most 40%. FIXED. */
export const MAX_EROSION_RESIST = 0.4;
/** Section 9: level and fortification together resist decay by at most 50%. FIXED. */
export const MAX_DECAY_RESIST = 0.5;
/** Section 11: an active fortification takes 30% off incoming erosion and decay. SOURCE. */
export const FORTIFY_EROSION_RESIST = 0.3;
export const FORTIFY_DECAY_RESIST = 0.3;

export type LandLevel = 1 | 2 | 3 | 4 | 5;

/** Section 9 table: erosion and decay resistance by land level. SOURCE. */
const LEVEL_EROSION_RESIST: Record<LandLevel, number> = { 1: 0, 2: 0.05, 3: 0.12, 4: 0.2, 5: 0.28 };
const LEVEL_DECAY_RESIST: Record<LandLevel, number> = { 1: 0, 2: 0.08, 3: 0.16, 4: 0.24, 5: 0.3 };

export interface HoldingRules {
  rulesVersion: number;
  /** DECISION NEEDED D4: strength a solid unit loses per day without a visit. */
  solidDecayPerDay: number;
  /** Section 4: shade decays 3× faster. HYPOTHESIS. */
  shadeDecayMultiplier: number;
  /** DECISION NEEDED D4: lowest strength of each stage, highest first. 0 is always "back on the map". */
  stageFloors: { held: number; atRisk: number; contested: number };
  /**
   * SIMULATION OPTION, not a decision: alternatives to ASSUMPTION A9 for the
   * churn study (`docs/SIM_CHURN_STUDY.md`). Absent means A9 exactly as
   * today: a push that reaches 0 flips the unit at once. Production rules
   * never set it until the owner decides.
   */
  takeover?: TakeoverRule;
}

/**
 * How someone else's ground changes hands, when not by A9's immediate flip.
 * The owner rule (one push per walker per unit per day) applies unchanged
 * under every setting; this only decides what a push that would flip does.
 */
export interface TakeoverRule {
  /**
   * Two-day challenge: a walker flips a unit only if they already pushed it
   * on an earlier day within `windowDays`, and the holder has not stepped on
   * it since. Any other would-be flip leaves the unit at `floor` (or where it
   * was, if lower) and records the push as that walker's challenge. Ground
   * below `immediateBelowStrength` (long unvisited) still falls at once.
   * Null: no challenge. Shade stepped on is still taken at once (section 4).
   */
  challenge: { windowDays: number; floor: number; immediateBelowStrength: number } | null;
  /**
   * A unit changes hands at most this many times a day; a later push that
   * would flip it erodes it to no lower than 1. Null: no cap. Shade stepped
   * on is still taken at once (section 4) but counts toward the cap.
   */
  maxFlipsPerUnitPerDay: number | null;
}

/* ── state ────────────────────────────────────────────────────────────────── */

export type Ground = "solid" | "shade";
export type Stage = "held" | "at_risk" | "contested" | "dormant" | "unheld";

export interface UnitState {
  unitId: string;
  /** Null when nobody holds it ("back on the map"). */
  holderId: string | null;
  /** Strength on `asOfDay`, 0–100. */
  strength: number;
  ground: Ground;
  /** Section 12: deeded ground is solid, never wears down and is taken only by contest. */
  deeded: boolean;
  /** Section 4: military sites, schools, hospitals and the like (D3). Never held. */
  masked: boolean;
  level: LandLevel;
  /** Whether a fortification is active on the unit today (its price and duration are D9). */
  fortified: boolean;
  /** Day index of the last visit or change; decay counts from here. */
  asOfDay: number;
  /**
   * Walkers who pushed this unit while someone else held it, on `day`. Owner
   * decision 17 Oct (G2 pace): one such push per walker per unit per day.
   * Absent, or from an earlier day, means nobody has pushed it today.
   */
  pushedBy?: { day: number; walkerIds: string[] };
  /** Only under a `TakeoverRule` challenge: each walker's first push of the open challenge, by day. */
  challenges?: { walkerId: string; day: number }[];
  /** Only under a `TakeoverRule` flip cap: times the unit changed hands on `day`. */
  flips?: { day: number; count: number };
}

export type Push =
  /** The walker stepped on the unit: a verified fix inside it. */
  | { kind: "solid" }
  /** The walker's sealed loop enclosed the unit without entering it; strength from D2, 0–25. */
  | { kind: "shade"; strength: number };

export type PushOutcome =
  | "claimed"      // nobody held it; the walker now does
  | "reinforced"   // the walker already held it; strength restored
  | "eroded"       // another holder keeps it, weaker
  | "flipped"      // it changed hands, carrying the overflow
  | "refused_deeded"
  | "refused_masked"
  | "refused_daily_limit"; // the walker already pushed this unit today

export interface PushResult {
  state: UnitState;
  outcome: PushOutcome;
  /** Strength actually removed from the previous holder (0 for claims and reinforcement). */
  removed: number;
}

/* ── arithmetic ───────────────────────────────────────────────────────────── */

function clampStrength(n: number): number {
  return Math.max(0, Math.min(MAX_STRENGTH, Math.floor(n)));
}

export function erosionResist(level: LandLevel, fortified: boolean): number {
  return Math.min(MAX_EROSION_RESIST, LEVEL_EROSION_RESIST[level] + (fortified ? FORTIFY_EROSION_RESIST : 0));
}

export function decayResist(level: LandLevel, fortified: boolean): number {
  return Math.min(MAX_DECAY_RESIST, LEVEL_DECAY_RESIST[level] + (fortified ? FORTIFY_DECAY_RESIST : 0));
}

function pushStrength(push: Push): number {
  if (push.kind === "solid") return SOLID_PUSH;
  if (!Number.isFinite(push.strength) || push.strength < 0 || push.strength > MAX_SHADE_STRENGTH) {
    throw new RangeError("shade strength must be between 0 and 25");
  }
  return Math.floor(push.strength);
}

/** The unit as it stands on `day`, after decay since its last visit. Deeded ground does not decay. */
export function decayTo(state: UnitState, day: number, rules: HoldingRules): UnitState {
  if (day < state.asOfDay) throw new RangeError("cannot decay backwards in time");
  if (state.deeded || state.holderId === null || day === state.asOfDay) return { ...state, asOfDay: day };
  const perDay = rules.solidDecayPerDay * (state.ground === "shade" ? rules.shadeDecayMultiplier : 1);
  // Floor the loss: a fractional point of decay is not taken.
  const lost = Math.floor(perDay * (1 - decayResist(state.level, state.fortified)) * (day - state.asOfDay));
  const strength = clampStrength(state.strength - lost);
  if (strength === 0) return unheld(state, day);
  return { ...state, strength, asOfDay: day };
}

function unheld(state: UnitState, day: number): UnitState {
  // Section 9: losing ground drops its level; how far, and the 14-day restore, are D16.
  return { ...withoutTakeoverMarks(state), holderId: null, strength: 0, ground: "solid", level: 1, fortified: false, asOfDay: day };
}

/**
 * The state without challenge and flip-count marks. Returns the same object
 * when it has none, so states under the default rules (A9, which never sets
 * them) are built exactly as before.
 */
export function withoutTakeoverMarks(state: UnitState): UnitState {
  if (state.challenges === undefined && state.flips === undefined) return state;
  const { challenges: _c, flips: _f, ...rest } = state;
  return rest;
}

function countFlip(state: UnitState, rule: TakeoverRule | undefined, day: number): Pick<UnitState, "flips"> {
  if (!rule || rule.maxFlipsPerUnitPerDay === null) return {};
  return { flips: { day, count: (state.flips?.day === day ? state.flips.count : 0) + 1 } };
}

export function stageOf(state: UnitState, rules: HoldingRules): Stage {
  if (state.holderId === null || state.strength === 0) return "unheld";
  if (state.deeded || state.strength >= rules.stageFloors.held) return "held";
  if (state.strength >= rules.stageFloors.atRisk) return "at_risk";
  if (state.strength >= rules.stageFloors.contested) return "contested";
  return "dormant";
}

/**
 * One walker's push on one unit on `day` (section 5).
 *
 * - Unheld: the walker claims it, at 100 if stepped on, at the shade value if
 *   only enclosed. A shade value under 1 would hold it at 0, which
 *   `unitProblems()` refuses, so a store (and the ledger) rejects that write.
 * - The walker's own: a visit restores 100, free, and stepping on own shade
 *   makes it solid. Enclosing it again never lowers it.
 * - Someone else's: the push, less the unit's erosion resistance, is taken
 *   off. At 0 or below it flips to the walker with the overflow as strength.
 *   Shade is taken by anyone who walks it, at full strength (section 4).
 * - Deeded and masked ground refuse every push.
 * - Owner decision 17 Oct: each walker pushes someone else's unit at most once
 *   a day, so ground with any resistance takes two or more days to take.
 *   Claiming and reinforcing are not limited.
 */
export function applyPush(input: { state: UnitState; walkerId: string; push: Push; day: number; rules: HoldingRules }): PushResult {
  const { walkerId, push, day, rules } = input;
  const raw = pushStrength(push);
  if (input.state.masked) return { state: { ...input.state, asOfDay: day }, outcome: "refused_masked", removed: 0 };
  if (input.state.deeded) return { state: decayTo(input.state, day, rules), outcome: "refused_deeded", removed: 0 };
  const state = decayTo(input.state, day, rules);

  if (state.holderId === null) {
    const ground: Ground = push.kind;
    return { state: { ...state, holderId: walkerId, strength: clampStrength(raw), ground, asOfDay: day }, outcome: "claimed", removed: 0 };
  }

  if (state.holderId === walkerId) {
    // Under a challenge rule, stepping on your own ground answers every open challenge.
    const visited = push.kind === "solid" && state.challenges !== undefined ? (({ challenges: _c, ...rest }) => rest)(state) : state;
    const next = push.kind === "solid"
      ? { ...visited, strength: MAX_STRENGTH, ground: "solid" as Ground }
      : { ...state, strength: Math.max(state.strength, clampStrength(raw)) };
    return { state: { ...next, asOfDay: day }, outcome: "reinforced", removed: 0 };
  }

  const today = state.pushedBy?.day === day ? state.pushedBy.walkerIds : [];
  if (today.includes(walkerId)) return { state, outcome: "refused_daily_limit", removed: 0 };
  const pushedBy = { day, walkerIds: [...today, walkerId] };

  // Shade falls to anyone who steps on it, whole.
  if (state.ground === "shade" && push.kind === "solid") {
    return {
      state: { ...withoutTakeoverMarks(state), holderId: walkerId, strength: MAX_STRENGTH, ground: "solid", level: 1, fortified: false, asOfDay: day, pushedBy, ...countFlip(state, rules.takeover, day) },
      outcome: "flipped",
      removed: state.strength,
    };
  }

  if (rules.takeover !== undefined) return pushUnderTakeoverRule(state, walkerId, push, raw, day, rules.takeover, pushedBy);

  // Floor the push: a fractional point of erosion is not taken.
  const effective = Math.floor(raw * (1 - erosionResist(state.level, state.fortified)));
  if (effective < state.strength) {
    return { state: { ...state, strength: state.strength - effective, asOfDay: day, pushedBy }, outcome: "eroded", removed: effective };
  }
  // ASSUMPTION A9: the walker holds at the overflow, but at least 1, so a flip
  // never leaves held ground at 0 (the source does not say what an exact 0
  // leaves). With the source's numbers, one visit flips undefended fresh
  // ground: 100 push against 100 strength. Any resistance at all makes it
  // erode instead, and the daily limit then holds the rest to the next day.
  const overflow = Math.max(1, clampStrength(effective - state.strength));
  return {
    state: { ...state, holderId: walkerId, strength: overflow, ground: push.kind, level: 1, fortified: false, asOfDay: day, pushedBy },
    outcome: "flipped",
    removed: state.strength,
  };
}

/**
 * A push on someone else's solid-or-shade ground under a `TakeoverRule`
 * (simulation option). The arithmetic is the same as A9; only whether a push
 * that reaches 0 may flip the unit today changes.
 */
function pushUnderTakeoverRule(
  state: UnitState,
  walkerId: string,
  push: Push,
  raw: number,
  day: number,
  rule: TakeoverRule,
  pushedBy: { day: number; walkerIds: string[] },
): PushResult {
  const effective = Math.floor(raw * (1 - erosionResist(state.level, state.fortified)));
  const ch = rule.challenge;
  const open = ch ? (state.challenges ?? []).filter((c) => day - c.day <= ch.windowDays) : [];
  const mine = open.find((c) => c.walkerId === walkerId);
  const challengeMet = ch === null || state.strength < ch.immediateBelowStrength || (mine !== undefined && mine.day < day);
  const capped = rule.maxFlipsPerUnitPerDay !== null && state.flips?.day === day && state.flips.count >= rule.maxFlipsPerUnitPerDay;

  if (effective >= state.strength && challengeMet && !capped) {
    // A9 as written: the walker holds at the overflow, at least 1.
    const overflow = Math.max(1, clampStrength(effective - state.strength));
    return {
      state: { ...withoutTakeoverMarks(state), holderId: walkerId, strength: overflow, ground: push.kind, level: 1, fortified: false, asOfDay: day, pushedBy, ...countFlip(state, rule, day) },
      outcome: "flipped",
      removed: state.strength,
    };
  }
  // No flip today: erode, but never below the floor a blocked flip leaves.
  const floor = effective >= state.strength && !challengeMet && ch ? ch.floor : 1;
  const strength = Math.min(state.strength, Math.max(floor, state.strength - effective));
  const next: UnitState = { ...state, strength, asOfDay: day, pushedBy };
  if (ch) {
    const kept = open.filter((c) => c.walkerId !== walkerId);
    next.challenges = [...kept, { walkerId, day: mine ? mine.day : day }].sort((a, b) => (a.walkerId < b.walkerId ? -1 : a.walkerId > b.walkerId ? 1 : 0));
  }
  return { state: next, outcome: "eroded", removed: state.strength - strength };
}

/** A unit nobody holds yet. */
export function newUnit(unitId: string, day: number, masked = false): UnitState {
  return { unitId, holderId: null, strength: 0, ground: "solid", deeded: false, masked, level: 1, fortified: false, asOfDay: day };
}

/**
 * Problems with a unit's state; empty when it is consistent. A store or a
 * reconciler runs this on every write and refuses one that is not.
 */
export function unitProblems(state: UnitState): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(state.strength) || state.strength < 0 || state.strength > MAX_STRENGTH) problems.push("strength out of range");
  if (state.holderId === null && state.strength !== 0) problems.push("unheld ground has strength");
  // Strength 0 means "back on the map" everywhere else (stageOf, decay); a holder at 0 would be
  // charged upkeep and counted for control while reading as unheld. Only a shade claim under 1 makes one.
  if (state.holderId !== null && state.strength === 0) problems.push("held ground has no strength");
  if (state.masked && state.holderId !== null) problems.push("masked ground is held");
  if (state.deeded && state.ground !== "solid") problems.push("deeded ground is not solid");
  if (state.deeded && state.holderId === null) problems.push("deeded ground has no holder");
  if (state.ground === "shade" && state.strength > MAX_SHADE_STRENGTH && state.holderId !== null) problems.push("shade above 25");
  if (state.pushedBy && state.pushedBy.day > state.asOfDay) problems.push("push record is from a later day");
  if (state.pushedBy && new Set(state.pushedBy.walkerIds).size !== state.pushedBy.walkerIds.length) problems.push("walker pushed twice in one day");
  if (state.challenges !== undefined) {
    if (state.holderId === null) problems.push("unheld ground has challenges");
    if (state.challenges.some((c) => c.day > state.asOfDay)) problems.push("challenge is from a later day");
    if (state.challenges.some((c) => c.walkerId === state.holderId)) problems.push("holder challenges own ground");
    if (new Set(state.challenges.map((c) => c.walkerId)).size !== state.challenges.length) problems.push("walker challenges twice");
  }
  if (state.flips !== undefined && (state.flips.day > state.asOfDay || !Number.isInteger(state.flips.count) || state.flips.count < 1)) problems.push("flip count is malformed");
  return problems;
}
