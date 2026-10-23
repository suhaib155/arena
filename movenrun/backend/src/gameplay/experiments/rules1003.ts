/**
 * SIMULATION ONLY. Experiment 1003: take-budget reform (packet section 10).
 *
 * HYPOTHESIS, credits-only. Not a rule set the server knows: nothing here is
 * registered in `RULESETS`, nothing reads it outside the simulation, and 1001
 * stays the default. Every variant is SIM_PILOT_2_PROPOSAL (1002) by spread,
 * with 1002's own take budget switched off and replaced by a 1003 budget that
 * counts a different class of event. Holding arithmetic, the two-day
 * challenge, the 20-hour second-push gap, resolution 10 units and the
 * session path are exactly 1002's.
 *
 * Event classes (decided per push, on the unit as it stands that day after decay):
 *
 * - `claim`: empty-ground claim, nobody holds the unit (outcome `claimed`).
 * - `defense`: the walker already holds it (outcome `reinforced`).
 * - `pass_through`: ordinary pass-through erosion. Someone else holds it, the
 *   walker has no open challenge on it from an earlier day, and it does not
 *   change hands (outcome `eroded`, first contact).
 * - `contested`: contested takeover attempt. Someone else holds it and the
 *   walker returns to a challenge they opened on an earlier day inside the
 *   window (a deliberate second push), but it does not flip (held back by the
 *   20-hour gap, or by a budget).
 * - `flip`: confirmed flip, the unit changes hands (outcome `flipped`).
 *   `deliberate` says whether it completed the walker's own challenge or fell
 *   at first contact (ground below the immediate-take line, or shade).
 * - `reward`: economic reward. A derived class, not a holding outcome: a
 *   claim or a confirmed flip, the events a credit rule could pay. Credits
 *   are not simulated; only the count is reported.
 *
 * The owner's fixed rule (one hostile push per walker per unit per day,
 * `refused_daily_limit`) is applied by the holding model before any budget
 * and never counts against one, under every variant.
 */
import { SIM_PILOT_2_PROPOSAL, type GameplayRules } from "../rules.js";

type Rules = Omit<GameplayRules, "seasonOneStartDay">;

export type EventClass1003 = "claim" | "defense" | "pass_through" | "contested" | "flip";

export interface TakeBudget1003 {
  /**
   * What counts against the daily budget:
   * - `confirmed-flips-v1` (A): only confirmed flips.
   * - `deliberate-contest-v1` (B): only deliberate return pushes on the
   *   walker's own open challenge, whether they flip or not. Flips at first
   *   contact (long-unvisited ground) and pass-through erosion are free.
   * - `contest-or-flip-v1` (C): deliberate return pushes and every confirmed flip.
   */
  counting: "confirmed-flips-v1" | "deliberate-contest-v1" | "contest-or-flip-v1";
  /** Counted events per walker per D1 day, or null for no budget. */
  perWalkerPerDay: number | null;
  /**
   * `hard`: a counted push past the budget is refused and changes nothing
   * (the walker's open challenge stays open for a later day in the window).
   * `soft`: it still applies, but at `softStrength` and can never flip.
   */
  mode: "hard" | "soft";
  /** Strength of a push past a soft budget (0-100). */
  softStrength?: number;
  /**
   * Reduced-strength incidental erosion: a pass-through push removes at most
   * this much strength (less erosion resistance) instead of 1002's drop to
   * the challenge floor. It still opens the walker's challenge. Null: 1002's
   * arithmetic.
   */
  incidentalStrength: number | null;
}

export interface Experiment1003 {
  label: string;
  /** 1002 by spread, with its own take budget off. */
  rules: Rules;
  budget: TakeBudget1003;
}

/** The experiment family's holding rules version. Never registered with the server. */
export const EXPERIMENT_1003_VERSION = 1003;

function variant(suffix: string, budget: TakeBudget1003): Experiment1003 {
  const rules: Rules = Object.freeze({
    ...SIM_PILOT_2_PROPOSAL,
    ruleset: `sim-take-budget-experiment-1003${suffix.toLowerCase()}`,
    holding: { ...SIM_PILOT_2_PROPOSAL.holding, rulesVersion: EXPERIMENT_1003_VERSION },
    takeBudget: null,
  });
  return Object.freeze({ label: `1003${suffix}`, rules, budget: Object.freeze(budget) });
}

/**
 * Budget sizes: 13 a day for every variant, the same number as 1002, so the
 * comparison isolates what is counted rather than how many. Soft and
 * incidental strengths are 25: a quarter of a solid push, the shade ceiling
 * of SOURCE section 4. All are simulation parameters, not proposals of value.
 */
export const RULES_1003A = variant("A", { counting: "confirmed-flips-v1", perWalkerPerDay: 13, mode: "hard", incidentalStrength: null });
export const RULES_1003B = variant("B", { counting: "deliberate-contest-v1", perWalkerPerDay: 13, mode: "hard", incidentalStrength: null });
export const RULES_1003C = variant("C", { counting: "contest-or-flip-v1", perWalkerPerDay: 13, mode: "soft", softStrength: 25, incidentalStrength: 25 });
/** C without the optional soft budget: reduced-strength incidental erosion alone. */
export const RULES_1003C0 = variant("C0", { counting: "contest-or-flip-v1", perWalkerPerDay: null, mode: "soft", softStrength: 25, incidentalStrength: 25 });

export const EXPERIMENTS_1003: readonly Experiment1003[] = [RULES_1003A, RULES_1003B, RULES_1003C, RULES_1003C0];

/** Whether an event of this class counts against the variant's budget. */
export function counts1003(budget: TakeBudget1003, cls: EventClass1003, deliberate: boolean): boolean {
  switch (budget.counting) {
    case "confirmed-flips-v1": return cls === "flip";
    case "deliberate-contest-v1": return (cls === "contested" || cls === "flip") && deliberate;
    case "contest-or-flip-v1": return cls === "flip" || (cls === "contested" && deliberate);
  }
}

/** Problems with a 1003 budget; empty when usable. */
export function budget1003Problems(b: TakeBudget1003): string[] {
  const p: string[] = [];
  if (!["confirmed-flips-v1", "deliberate-contest-v1", "contest-or-flip-v1"].includes(b.counting)) p.push("unknown counting");
  if (b.perWalkerPerDay !== null && !(Number.isInteger(b.perWalkerPerDay) && b.perWalkerPerDay >= 1)) p.push("budget must be a whole number, 1 or more");
  if (b.mode !== "hard" && b.mode !== "soft") p.push("unknown mode");
  if (b.mode === "soft" && !(Number.isInteger(b.softStrength) && b.softStrength! >= 1 && b.softStrength! <= 100)) p.push("soft strength must be 1-100");
  if (b.incidentalStrength !== null && !(Number.isInteger(b.incidentalStrength) && b.incidentalStrength >= 1 && b.incidentalStrength <= 100)) p.push("incidental strength must be 1-100");
  return p;
}
