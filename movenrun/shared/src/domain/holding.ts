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
  | "refused_masked";

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
  // Section 9: losing ground drops its level; the 14-day restore is G3 bookkeeping.
  return { ...state, holderId: null, strength: 0, ground: "solid", level: 1, fortified: false, asOfDay: day };
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
 *   only enclosed.
 * - The walker's own: a visit restores 100, free, and stepping on own shade
 *   makes it solid. Enclosing it again never lowers it.
 * - Someone else's: the push, less the unit's erosion resistance, is taken
 *   off. At 0 or below it flips to the walker with the overflow as strength.
 *   Shade is taken by anyone who walks it, at full strength (section 4).
 * - Deeded and masked ground refuse every push.
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
    const next = push.kind === "solid"
      ? { ...state, strength: MAX_STRENGTH, ground: "solid" as Ground }
      : { ...state, strength: Math.max(state.strength, clampStrength(raw)) };
    return { state: { ...next, asOfDay: day }, outcome: "reinforced", removed: 0 };
  }

  // Shade falls to anyone who steps on it, whole.
  if (state.ground === "shade" && push.kind === "solid") {
    return {
      state: { ...state, holderId: walkerId, strength: MAX_STRENGTH, ground: "solid", level: 1, fortified: false, asOfDay: day },
      outcome: "flipped",
      removed: state.strength,
    };
  }

  // Floor the push: a fractional point of erosion is not taken.
  const effective = Math.floor(raw * (1 - erosionResist(state.level, state.fortified)));
  if (effective < state.strength) {
    return { state: { ...state, strength: state.strength - effective, asOfDay: day }, outcome: "eroded", removed: effective };
  }
  // ASSUMPTION A9: the walker holds at the overflow, but at least 1, so a flip
  // never leaves held ground at 0 (the source does not say what an exact 0
  // leaves). With the source's numbers, one visit flips undefended fresh
  // ground: 100 push against 100 strength. Simulation (build step 0) checks it.
  const overflow = Math.max(1, clampStrength(effective - state.strength));
  return {
    state: { ...state, holderId: walkerId, strength: overflow, ground: push.kind, level: 1, fortified: false, asOfDay: day },
    outcome: "flipped",
    removed: state.strength,
  };
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
  if (state.masked && state.holderId !== null) problems.push("masked ground is held");
  if (state.deeded && state.ground !== "solid") problems.push("deeded ground is not solid");
  if (state.deeded && state.holderId === null) problems.push("deeded ground has no holder");
  if (state.ground === "shade" && state.strength > MAX_SHADE_STRENGTH && state.holderId !== null) problems.push("shade above 25");
  return problems;
}
