/**
 * Server gameplay rules (G3/G4 server preparation).
 *
 * The holding, ledger, settlement and club models in `@movenrun/shared` take
 * every open number as a parameter. This file is the one place the server
 * fills them in. Every value the V3 source does not fix is a PILOT PROPOSAL,
 * named after its decision in docs/GAME_ECONOMY_V3.md, and matches the
 * simulation ruleset `sim-pilot-1` (docs/SIM_PILOT_RULESET.md) where that
 * ruleset has one. None of it is approved: the routes stay unmounted until
 * MOVENRUN_GAMEPLAY_ENABLED is set, and that needs the owner (see
 * docs/G34_SERVER_ARCHITECTURE.md).
 *
 * Nothing here is imported from `shared/src/sim/`: the simulator stays
 * simulation-only, and the server keeps its own, separately versioned copy.
 */
import type { HoldingRules } from "@movenrun/shared/holding";
import type { DistrictControlRule, LeaderboardMetric } from "@movenrun/shared/clubsDistricts";

export const DAY_MS = 86_400_000;

export interface GameplayRules {
  /** Name stamped on every settled day. */
  ruleset: string;
  /** Economy rules (section 17 to 22): the reference model's version 1, unchanged. */
  economyRulesVersion: number;
  /** D4 PILOT PROPOSAL; shade ×3 is SOURCE §4 (HYPOTHESIS). Version distinct from tests and the simulator. */
  holding: HoldingRules;
  /**
   * D1 PILOT PROPOSAL: a session belongs to the day of its last verified fix,
   * in UTC shifted by this many minutes (0 = UTC). Day close is midnight of
   * that clock plus `dayCloseGraceMs`, the window for late uploads.
   */
  dayOffsetMinutes: number;
  dayCloseGraceMs: number;
  /**
   * D1: the day index (days since 1970-01-01 on the clock above) on which
   * season 1 starts. No default: required when gameplay is enabled.
   */
  seasonOneStartDay: number;
  /** D15 PILOT PROPOSAL: ground held only as shade does not pay upkeep. */
  shadeCountsAsHeld: boolean;
  /** D21 PILOT PROPOSAL: shade weighs 1/4 of solid; a club needs 1/3 of the held ground and strictly more than any other club. */
  districtControl: DistrictControlRule;
  /** D22 PILOT PROPOSAL: the board the app would show. Every metric stays readable. */
  defaultLeaderboard: LeaderboardMetric;
  /** D18 PILOT PROPOSAL: joining or leaving a club takes effect the next day (one club at a time is held by the database). */
  clubChangeDelayDays: 0 | 1;
  /** Section 17 trust weight 0 to 1 (HYPOTHESIS). PILOT PROPOSAL: 1 for everyone; no trust service exists. */
  trustWeight: number;
  /** Section 10 kit level. PILOT PROPOSAL: Starter for everyone; kit purchases are not built. */
  kitLevel: 1;
  /** Most units one session may push; bounds work per request. */
  maxUnitsPerSession: number;
  /** Most closed days one maintenance run settles; the rest wait for the next run. */
  maxDaysPerRun: number;
}

/** The pilot proposal, without the season start, which must be configured. */
export const PILOT_PROPOSAL: Readonly<Omit<GameplayRules, "seasonOneStartDay">> = Object.freeze({
  ruleset: "server-pilot-proposal-1",
  economyRulesVersion: 1,
  holding: {
    rulesVersion: 1001,
    solidDecayPerDay: 3,
    shadeDecayMultiplier: 3,
    stageFloors: { held: 60, atRisk: 30, contested: 10 },
  },
  dayOffsetMinutes: 0,
  dayCloseGraceMs: 2 * 60 * 60 * 1000,
  shadeCountsAsHeld: false,
  districtControl: { shadeWeight: { numerator: 1, denominator: 4 }, minShare: { numerator: 1, denominator: 3 } },
  defaultLeaderboard: "club_district_days",
  clubChangeDelayDays: 1,
  trustWeight: 1,
  kitLevel: 1,
  maxUnitsPerSession: 500,
  maxDaysPerRun: 31,
});

/** Day index of an instant on the rules' clock. */
export function dayOf(rules: Pick<GameplayRules, "dayOffsetMinutes">, epochMs: number): number {
  return Math.floor((epochMs + rules.dayOffsetMinutes * 60_000) / DAY_MS);
}

/** First instant (epoch ms) of a day index on the rules' clock. */
export function dayStartMs(rules: Pick<GameplayRules, "dayOffsetMinutes">, day: number): number {
  return day * DAY_MS - rules.dayOffsetMinutes * 60_000;
}

/** 1-based season of a day, or null before season 1. Seasons are 90 days (SOURCE §17). */
export function seasonOf(rules: Pick<GameplayRules, "seasonOneStartDay">, day: number, seasonDays = 90): number | null {
  if (day < rules.seasonOneStartDay) return null;
  return 1 + Math.floor((day - rules.seasonOneStartDay) / seasonDays);
}

/** The last day whose close (midnight plus grace) has passed at `nowMs`. */
export function lastClosedDay(rules: Pick<GameplayRules, "dayOffsetMinutes" | "dayCloseGraceMs">, nowMs: number): number {
  return dayOf(rules, nowMs - rules.dayCloseGraceMs) - 1;
}

/**
 * Gameplay configuration from the environment, or null when gameplay is off.
 * Off unless MOVENRUN_GAMEPLAY_ENABLED is exactly "true". When on, the season
 * start must be given (D1); a missing or malformed one stops the API from
 * starting rather than guessing.
 */
export function gameplayRulesFromEnv(env: NodeJS.ProcessEnv = process.env): GameplayRules | null {
  if (env.MOVENRUN_GAMEPLAY_ENABLED !== "true") return null;
  const raw = env.MOVENRUN_GAMEPLAY_SEASON_START_DAY ?? "";
  if (!/^\d{1,6}$/.test(raw)) throw new Error("MOVENRUN_GAMEPLAY_SEASON_START_DAY must be a day index when gameplay is enabled");
  return { ...PILOT_PROPOSAL, holding: { ...PILOT_PROPOSAL.holding }, seasonOneStartDay: Number(raw) };
}
