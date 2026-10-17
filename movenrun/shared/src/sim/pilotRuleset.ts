/**
 * SIMULATION PILOT RULESET. Not a production economy.
 *
 * `sim-pilot-1` is one coherent, reversible set of values for every open
 * parameter the reference models take (holding, ledger, settlement, clubs and
 * districts), so a simulation can run the whole loop and the owner can review
 * one configuration instead of separate questions. Every value that the source
 * (MovenRun Game Economy V3, rev. 2) does not state is a PILOT PROPOSAL, named
 * after its DECISION NEEDED id in `docs/GAME_ECONOMY_V3.md`, and is explained
 * with its simulation numbers in `docs/SIM_PILOT_RULESET.md`.
 *
 * Nothing here is imported by the app, the backend or the settlement path, and
 * nothing here is final. Changing a value means publishing a new ruleset name
 * and version; a run always records which one it used.
 */

import type { DistrictControlRule, LeaderboardMetric } from "../domain/clubsDistricts";
import type { HoldingRules } from "../domain/holding";

export const SIM_ONLY = "SIMULATION_ONLY_NOT_PRODUCTION" as const;

/** How unpaid upkeep ("paid in condition", section 7 and 8) acts on ground. D14. */
export type UpkeepConditionMode =
  /** The reference model today: reported, no effect on ground. */
  | "none"
  /** One extra day of decay on a share of the charged unvisited zones equal to the unpaid share of upkeep, rounded up; weakest zones first. */
  | "proportional_weakest_first"
  /** As above, strongest zones first, so fragile ground is spared. */
  | "proportional_strongest_first"
  /** One extra day of decay on every charged unvisited zone whenever any upkeep is unpaid. */
  | "all_unvisited";

export interface ShadeRule {
  /** Section 4: shade claims at most 25 × shape × sprawl. SOURCE (FIXED ceiling). */
  maxStrength: number;
  /**
   * Section 4: "up to 12 enclosed cells per stepped cell at full strength;
   * beyond that, shade thins in proportion". SOURCE number; null turns the
   * thinning off (a comparison variant only).
   */
  fullStrengthEnclosedPerStepped: number | null;
  /** D2 PILOT PROPOSAL: a loop whose shape score is below this is degenerate and claims no shade. 0 rejects nothing. */
  minShape: number;
}

export interface ContributionRule {
  /** D19 PILOT PROPOSAL: worth of one counted ledger entry, by outcome. */
  weights: { claimed: number; flipped: number; eroded: number; reinforced: number };
  /** Count each (walker, unit, day) once, whatever number of sessions crossed it. */
  oncePerUnitPerDay: boolean;
  /** A reinforcement of the same unit by the same walker counts again only after this many days. Repeated-route farming control. */
  reinforceCooldownDays: number;
  /** Enclosed-only (shade) entries count for nothing. Shade-farming control. */
  shadeCounts: boolean;
  /** Pushes on a club-mate's ground count for nothing (they are counted apart by the G4 model). */
  clubMatePushesCount: boolean;
}

export interface SimRuleset {
  /** Human name; "sim-" prefix marks it as a simulation ruleset. */
  name: string;
  rulesetVersion: number;
  status: typeof SIM_ONLY;
  /** Economy rules (section 17–22) are the reference model's version 1, unchanged. */
  economyRulesVersion: number;
  season: number;
  /** D4: decay per day and stage floors (PILOT PROPOSAL); shade decay multiplier 3 is SOURCE §4 (HYPOTHESIS). */
  holding: HoldingRules;
  /** Owner decision 17 Oct: one push per walker per unit per day on someone else's ground. Enforced by the holding model; recorded here. */
  pushesPerWalkerPerUnitPerDay: 1;
  /** D2. */
  shade: ShadeRule;
  /**
   * D5: the logical unit's edge in metres. A unit is also the zone for upkeep
   * and levels. The grid stays internal; the simulator uses a synthetic hex
   * grid at this scale (531 m is H3 resolution 8, 201 m resolution 9, 76 m
   * resolution 10).
   */
  unitEdgeMeters: number;
  /** D14. */
  upkeepCondition: UpkeepConditionMode;
  /** D15: whether a unit held only as shade is a held zone for upkeep. */
  shadeCountsAsHeld: boolean;
  /** D16 (section 9: "losing a zone drops two levels; reclaiming within 14 days restores it"). */
  levelOnLoss: {
    /** Level the new holder gets: the model's reset to 1, or the old level less two. */
    newHolder: "reset_to_1" | "drop_two";
    /** Days within which the former holder's level snapshot is restored on reclaim; 0 = never. 14 is SOURCE §9. */
    reclaimRestoreDays: number;
  };
  /** D17: section 7's fourteen free away days per season (SOURCE, FIXED) and how they are spent. */
  awayDays: { perSeason: number; mode: "none" | "auto" | "player_selected" };
  /** D18. */
  clubs: { maxActive: 1; changeEffective: "next_day" | "same_day" };
  /** D19. */
  contributions: ContributionRule;
  /** D20: synthetic district polygons, versioned; never derived from the grid's parent cells. */
  districts: { version: string; count: number };
  /** D21. */
  control: DistrictControlRule;
  /** D22: what the season board ranks; ties share a rank and are listed by id (G4 model). */
  leaderboard: LeaderboardMetric;
  /** D23: whether a push on a club-mate's ground erodes it. */
  clubMateErosion: "erodes" | "immune";
  /**
   * Section 9 levels 2 and 3 (SOURCE costs and requirements). The reference
   * models have no level purchase, so the simulator applies them on top and
   * keeps the spend outside the models' books.
   */
  levels: {
    enabled: boolean;
    camp: { visits: number; windowDays: number; costDayShares: number };
    holding: { heldDays: number; costDayShares: number };
  };
}

/** The pilot. Every non-SOURCE value is a PILOT PROPOSAL, not a decision. */
export const SIM_PILOT_1: Readonly<SimRuleset> = Object.freeze({
  name: "sim-pilot-1",
  rulesetVersion: 1,
  status: SIM_ONLY,
  economyRulesVersion: 1,
  season: 1,
  holding: {
    // Distinct from any test or production holding rules version.
    rulesVersion: 9001,
    solidDecayPerDay: 3,
    shadeDecayMultiplier: 3,
    stageFloors: { held: 60, atRisk: 30, contested: 10 },
  },
  pushesPerWalkerPerUnitPerDay: 1,
  shade: { maxStrength: 25, fullStrengthEnclosedPerStepped: 12, minShape: 0.35 },
  unitEdgeMeters: 201,
  upkeepCondition: "proportional_strongest_first",
  shadeCountsAsHeld: false,
  levelOnLoss: { newHolder: "reset_to_1", reclaimRestoreDays: 14 },
  awayDays: { perSeason: 14, mode: "auto" },
  clubs: { maxActive: 1, changeEffective: "next_day" },
  contributions: {
    weights: { claimed: 1, flipped: 1, eroded: 0.5, reinforced: 0.25 },
    oncePerUnitPerDay: true,
    reinforceCooldownDays: 7,
    shadeCounts: false,
    clubMatePushesCount: false,
  },
  districts: { version: "sim-districts-v1", count: 12 },
  control: { shadeWeight: { numerator: 1, denominator: 4 }, minShare: { numerator: 1, denominator: 3 } },
  leaderboard: "club_district_days",
  clubMateErosion: "erodes",
  levels: {
    enabled: true,
    camp: { visits: 3, windowDays: 14, costDayShares: 2 },
    holding: { heldDays: 14, costDayShares: 6 },
  },
} satisfies SimRuleset);

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function merge<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (patch === undefined) return base;
  if (typeof base !== "object" || base === null || Array.isArray(base)) return patch as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined) continue;
    const b = (base as Record<string, unknown>)[k];
    out[k] = typeof v === "object" && v !== null && !Array.isArray(v) && typeof b === "object" && b !== null ? merge(b, v as never) : v;
  }
  return out as T;
}

/** A comparison variant of a ruleset. Its name says what changed, so no variant is mistaken for the pilot. */
export function variantOf(base: Readonly<SimRuleset>, label: string, patch: DeepPartial<SimRuleset>): SimRuleset {
  const merged = merge<SimRuleset>(structuredClone(base) as SimRuleset, patch);
  return { ...merged, name: `${base.name}~${label}`, status: SIM_ONLY };
}

/** Problems with a ruleset; empty when every parameter is usable. */
export function rulesetProblems(r: SimRuleset): string[] {
  const p: string[] = [];
  if (r.status !== SIM_ONLY) p.push("status must mark the ruleset as simulation only");
  if (!r.name.startsWith("sim-")) p.push("name must start with sim-");
  if (r.pushesPerWalkerPerUnitPerDay !== 1) p.push("owner rule: one push per walker per unit per day");
  if (!(r.holding.solidDecayPerDay > 0)) p.push("D4: solid decay must be above 0");
  const f = r.holding.stageFloors;
  if (!(f.held > f.atRisk && f.atRisk > f.contested && f.contested > 0 && f.held <= 100)) p.push("D4: stage floors must fall from held to contested");
  if (r.shade.maxStrength !== 25) p.push("D2: the shade ceiling is 25 (SOURCE §4)");
  if (!(r.shade.minShape >= 0 && r.shade.minShape < 1)) p.push("D2: minShape must be from 0 to below 1");
  if (!(r.unitEdgeMeters > 0)) p.push("D5: unit edge must be above 0");
  if (r.control.shadeWeight.numerator <= 0) p.push("D21: shade must count for more than 0 (SOURCE §4)");
  if (r.levelOnLoss.reclaimRestoreDays < 0) p.push("D16: restore days must be 0 or more");
  if (r.awayDays.perSeason !== 14) p.push("D17: fourteen away days per season (SOURCE §7)");
  return p;
}

/**
 * D2 as the simulator applies it: 25 × shape × sprawl, where sprawl is 1 up to
 * the SOURCE ratio of enclosed to stepped units and thins in proportion beyond
 * it. Null when the loop is degenerate (shape below the pilot minimum) and
 * claims no shade. The shape score itself is an input: the simulator does not
 * compute loop geometry.
 */
export function shadeStrength(rule: ShadeRule, loop: { shape: number; stepped: number; enclosed: number }): number | null {
  if (loop.enclosed <= 0) return null;
  if (loop.shape < rule.minShape) return null;
  const ratio = rule.fullStrengthEnclosedPerStepped;
  const sprawl = ratio === null || loop.enclosed <= ratio * loop.stepped ? 1 : (ratio * loop.stepped) / loop.enclosed;
  return Math.min(rule.maxStrength, rule.maxStrength * Math.min(1, loop.shape) * sprawl);
}
