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
 *
 * Rule sets are versioned and immutable. `RULESETS` lists every holding
 * rules version this build knows; the server runs exactly one of them
 * (MOVENRUN_GAMEPLAY_RULES_VERSION, default 1001), pins it on every day it
 * touches and refuses (fails closed) any day, unit or event recorded under a
 * version it does not know or that differs from the one pinned. Changing a
 * value means a new version, never an edit of an existing one.
 *
 * - 1001 `server-pilot-proposal-1`: A9 immediate flip, no take budget, a
 *   unit is the stored cell and its own zone. The default.
 * - 1002 `server-sim-pilot-2-proposal`: the three churn levers of
 *   `sim-pilot-2` (docs/SIM_CHURN_STUDY.md, simulator version 9002):
 *   two-day challenge, 13 takes per walker per day, resolution 10 units in
 *   resolution 9 zones. SIMULATION-PILOT PROPOSAL, owner-approved only for
 *   pilot development and comparison, not V3 source rules.
 */
import { createHash } from "node:crypto";
import { cellToParent, getResolution, isValidCell } from "h3-js";
import { sessionPathRuleProblems, VERIFIED_STEPS_V1, type SessionPathRule } from "./path.js";
import type { HoldingRules, TakeoverRule } from "@movenrun/shared/holding";
import type { DistrictControlRule, LeaderboardMetric } from "@movenrun/shared/clubsDistricts";

export const DAY_MS = 86_400_000;

export interface GameplayRules {
  /** Name stamped on every settled day. */
  ruleset: string;
  /** Economy rules (section 17 to 22): the reference model's version 1, unchanged. */
  economyRulesVersion: number;
  /**
   * D4 PILOT PROPOSAL; shade ×3 is SOURCE §4 (HYPOTHESIS). Version distinct from tests and the simulator.
   * `holding.takeover` must be what `takeover` below says (checked by `rulesetProblems`).
   */
  holding: HoldingRules;
  /** How someone else's ground changes hands. See `TakeoverPolicy`. */
  takeover: TakeoverPolicy;
  /** Per-walker daily budget of takes, or null for none. See `TakeBudget`. */
  takeBudget: TakeBudget | null;
  /** D5: what a unit is and which zone it pays upkeep in. See `UnitZoneRule`. */
  units: UnitZoneRule;
  /**
   * D1 PILOT PROPOSAL: a session belongs to the day of its last verified fix,
   * in UTC shifted by this many minutes (0 = UTC). Day close is midnight of
   * that clock plus `dayCloseGraceMs`, the window for late uploads.
   */
  dayOffsetMinutes: number;
  dayCloseGraceMs: number;
  /**
   * D1 named explicitly (1002). Absent means the same D1 rule, unnamed, which
   * keeps 1001's recorded identity (its config digest) exactly as it was.
   */
  dayAttribution?: DayAttribution;
  /**
   * Which sessions a closed day's settlement counts, by the server's receipt
   * time (see `ReceiptCutoff`). Absent means `RECEIPT_CUTOFF_V1`, unnamed,
   * which keeps the recorded identity (config digest) of 1001 and 1002
   * exactly as it was; the cutoff in force is bound into every settled day's
   * input digest either way.
   */
  receiptCutoff?: ReceiptCutoff;
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

/**
 * How a push on ground someone else holds may take it.
 *
 * - `immediate` (ASSUMPTION A9, the reading of SOURCE §5 "at 0 the cell flips
 *   to the walker"): a push that reaches 0 flips the unit at once, at the
 *   overflow, at least 1. The default.
 * - `two-day-challenge` (SIMULATION-PILOT PROPOSAL, sim-pilot-2): with `W =
 *   windowDays`, a push that reaches 0 flips the unit only when the same
 *   walker already pushed it on an earlier day `d1` with `1 <= d - d1 <= W`
 *   and the holder has not stepped on it since. Otherwise the unit is left
 *   at `floor` (or where it was, if lower) and the push is recorded as that
 *   walker's challenge, dated the day it opened. Each walker has their own
 *   challenge; a holder's stepped-on push answers all of them; a flip clears
 *   all of them. Ground below `immediateBelowStrength` (long unvisited) and
 *   stepped-on shade still fall at once. The arithmetic (push 100, strength
 *   100, overflow) is A9's. Implemented by `applyPush` in
 *   `@movenrun/shared/holding` (`TakeoverRule.challenge`); the server only
 *   selects it.
 *
 * `policyVersion` is part of the rule set's identity: a change is a new
 * holding rules version.
 */
export type TakeoverPolicy =
  | { name: "immediate"; policyVersion: 1 }
  | { name: "two-day-challenge"; policyVersion: 1; windowDays: number; floor: number; immediateBelowStrength: number }
  | {
    name: "two-day-challenge"; policyVersion: 2; windowDays: number; floor: number; immediateBelowStrength: number;
    /** The second push must also come this long after the first, by the server's clock (see `SecondPushGap`). */
    secondPush: SecondPushGap;
  };

/**
 * The day-boundary guard of the two-day challenge (SIMULATION-PILOT
 * PROPOSAL). Calendar days alone let a challenge complete in half an hour
 * across midnight. With `min-elapsed-server-receipt`, the push that would
 * complete a challenge flips only if the server received its session at
 * least `minElapsedMs` after it received the session that opened the
 * challenge. Received means `movement_verifications.created_at`, the
 * server's own clock when it verified the upload; device timestamps are
 * never used, so a device clock that is wrong, changed time zone, or was set
 * to fake a gap changes nothing. A push that is too early erodes (no lower
 * than the floor) and keeps the original challenge and its first day; it
 * does not restart it. Both pushes must still be on distinct D1 days within
 * the window.
 */
export interface SecondPushGap {
  rule: "min-elapsed-server-receipt";
  version: 1;
  minElapsedMs: number;
}

/** D1, named. The only rule built: the UTC day (shifted by `dayOffsetMinutes`) of the session's last verified fix. */
export interface DayAttribution {
  rule: "d1-last-verified-fix";
  version: 1;
}

/**
 * Late uploads (Track B finding 1; CONSERVATIVE DRAFT, D1 stays an owner
 * decision). `server-receipt-before-day-close` v1: a verified session counts
 * toward its D1 day's credits, and toward any day's active-day count, only
 * if the server received it (`movement_verifications.created_at`, set by the
 * database at insert and never by the phone) strictly before that day's
 * close: midnight on the rules' clock after the day, plus `dayCloseGraceMs`.
 * A session received at or after the close earns nothing for any day, so
 * when settlement runs (on time, late, or again) never changes what it
 * counts. Route history and verification are untouched.
 */
export interface ReceiptCutoff {
  rule: "server-receipt-before-day-close";
  version: 1;
}

export const RECEIPT_CUTOFF_V1: Readonly<ReceiptCutoff> = Object.freeze({ rule: "server-receipt-before-day-close", version: 1 });

/**
 * Per-walker daily budget of takes (SIMULATION-PILOT PROPOSAL, sim-pilot-2:
 * 13 a day at the resolution 10 scale).
 *
 * What counts (`counting: "takes-v1"`): one for each push the server applies
 * whose outcome, in ledger order, is `eroded` or `flipped`, that is a push on
 * a unit that at that moment (after decay to the day) another walker holds.
 * Challenge pushes record `eroded` and count. Under the one-push rule there
 * is at most one such push per walker, unit and day, so the budget is also a
 * count of distinct units. Nothing else counts: claiming empty ground
 * (including ground decayed to 0), reinforcing or refreshing one's own ground
 * (stepped on or shade), refused pushes (masked, deeded, the one-push rule,
 * the budget itself), skipped duplicates and rejected events. A push past the
 * budget is recorded as `refused_take_budget` and changes nothing. The day is
 * the server's D1 day of the session; counts come from the ledger, never the
 * client.
 */
export interface TakeBudget {
  perWalkerPerDay: number;
  counting: "takes-v1";
  /**
   * The order a session's pushes meet the budget. Absent: event id order,
   * which is unit id order. `walk-order-v1`: the order the walk first
   * reached each unit (the session path's first-touch order, ties impossible
   * within one path), then event id for pushes that carry no walk position.
   */
  order?: "walk-order-v1";
}

/**
 * D5: units and the zones they pay upkeep in.
 *
 * - `unit`: `stored` takes the cells the movement pipeline stores as they are
 *   (resolution 8 today) and checks nothing; `h3` requires every unit to be
 *   an H3 cell at exactly `resolution`, and refuses a session otherwise.
 * - `zone`: `unit` makes every unit its own zone; `h3-parent` maps a unit to
 *   its H3 parent at `resolution` (`cellToParent`, deterministic). H3 is an
 *   internal index: nothing player-facing draws or names a cell.
 * - `mixedHolderZone` (open decision D5, named and switchable): what a zone
 *   whose units have more than one holder means for upkeep and levels.
 *   `each-holder-holds-zone` is the candidate: every walker holding at least
 *   one unit of the zone holds the zone, pays its upkeep once at their level,
 *   and visits it by stepping on any unit of it. Nobody is treated as the
 *   zone's single holder, majority or not. `unit-is-zone` falls back to
 *   per-unit upkeep, as if `zone` were `unit`. Alternatives that are not
 *   built are listed in docs/G34_SERVER_ARCHITECTURE.md (D5).
 */
export interface UnitZoneRule {
  unit: { kind: "stored" } | { kind: "h3"; resolution: number };
  zone: { kind: "unit" } | { kind: "h3-parent"; resolution: number };
  mixedHolderZone: MixedHolderZoneRule;
  /**
   * Where a session's units come from. Absent: the movement pipeline's
   * stored cells (`traversed_hex_ids`, resolution 8 today). `session-path`:
   * the canonical path derived from the verified fixes at verification time
   * (`path.ts`), stored in `gameplay_session_paths`; a session without one is
   * refused (`session_path_unavailable`).
   */
  source?: { kind: "session-path"; rule: SessionPathRule };
  /**
   * How a zone shared by several holders is split for upkeep, levels, away
   * days and upgrades. Absent: the shared model's behaviour (one holder's
   * units at two levels refuse the day). `per-holder-min-level-v1`: see
   * `zones.ts`.
   */
  partition?: "per-holder-min-level-v1";
}

export type MixedHolderZoneRule = "each-holder-holds-zone" | "unit-is-zone";

/** The holding model's takeover option for a policy; undefined is A9 exactly. */
export function takeoverRuleOf(policy: TakeoverPolicy): TakeoverRule | undefined {
  if (policy.name === "immediate") return undefined;
  return { challenge: { windowDays: policy.windowDays, floor: policy.floor, immediateBelowStrength: policy.immediateBelowStrength }, maxFlipsPerUnitPerDay: null };
}

/** The pilot proposal, without the season start, which must be configured. */
export const PILOT_PROPOSAL: Readonly<Omit<GameplayRules, "seasonOneStartDay">> = Object.freeze<Omit<GameplayRules, "seasonOneStartDay">>({
  ruleset: "server-pilot-proposal-1",
  economyRulesVersion: 1,
  holding: {
    rulesVersion: 1001,
    solidDecayPerDay: 3,
    shadeDecayMultiplier: 3,
    stageFloors: { held: 60, atRisk: 30, contested: 10 },
  },
  takeover: { name: "immediate", policyVersion: 1 },
  takeBudget: null,
  units: { unit: { kind: "stored" }, zone: { kind: "unit" }, mixedHolderZone: "unit-is-zone" },
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

/**
 * SIMULATION-PILOT PROPOSAL `sim-pilot-2` as a server rule set (holding rules
 * version 1002; the simulator's own is 9002, so entries never mix). The same
 * as 1001 except for the three churn levers. Owner-approved only for pilot
 * development and comparison; not V3 source rules, not enabled anywhere.
 */
export const SIM_PILOT_2_PROPOSAL: Readonly<Omit<GameplayRules, "seasonOneStartDay">> = Object.freeze<Omit<GameplayRules, "seasonOneStartDay">>({
  ...PILOT_PROPOSAL,
  ruleset: "server-sim-pilot-2-proposal",
  holding: {
    rulesVersion: 1002,
    solidDecayPerDay: 3,
    shadeDecayMultiplier: 3,
    stageFloors: { held: 60, atRisk: 30, contested: 10 },
    takeover: { challenge: { windowDays: 3, floor: 50, immediateBelowStrength: 30 }, maxFlipsPerUnitPerDay: null },
  },
  takeover: {
    name: "two-day-challenge", policyVersion: 2, windowDays: 3, floor: 50, immediateBelowStrength: 30,
    secondPush: { rule: "min-elapsed-server-receipt", version: 1, minElapsedMs: 20 * 60 * 60 * 1000 },
  },
  takeBudget: { perWalkerPerDay: 13, counting: "takes-v1", order: "walk-order-v1" },
  units: {
    unit: { kind: "h3", resolution: 10 }, zone: { kind: "h3-parent", resolution: 9 }, mixedHolderZone: "each-holder-holds-zone",
    source: { kind: "session-path", rule: VERIFIED_STEPS_V1 },
    partition: "per-holder-min-level-v1",
  },
  dayAttribution: { rule: "d1-last-verified-fix", version: 1 },
});

/** The holding rules version run when MOVENRUN_GAMEPLAY_RULES_VERSION is unset. */
export const DEFAULT_RULES_VERSION = 1001;

/** Every rule set this build knows, by holding rules version. Never edited in place. */
export const RULESETS: ReadonlyMap<number, Readonly<Omit<GameplayRules, "seasonOneStartDay">>> = new Map([
  [PILOT_PROPOSAL.holding.rulesVersion, PILOT_PROPOSAL],
  [SIM_PILOT_2_PROPOSAL.holding.rulesVersion, SIM_PILOT_2_PROPOSAL],
]);

export class UnknownRulesVersionError extends Error {
  constructor(readonly rulesVersion: unknown) {
    super(`unknown holding rules version ${String(rulesVersion)}`);
  }
}

/** The rule set for a recorded version. Throws for any version this build does not know: never a fallback. */
export function rulesetFor(rulesVersion: unknown): Readonly<Omit<GameplayRules, "seasonOneStartDay">> {
  const r = typeof rulesVersion === "number" ? RULESETS.get(rulesVersion) : undefined;
  if (!r) throw new UnknownRulesVersionError(rulesVersion);
  return r;
}

/** The parts of a rule set that decide holdings, budgets, zones and credits, as stored with each day. */
export function rulesetConfig(rules: Omit<GameplayRules, "seasonOneStartDay">) {
  return {
    ruleset: rules.ruleset, economyRulesVersion: rules.economyRulesVersion, holding: rules.holding, takeover: rules.takeover,
    takeBudget: rules.takeBudget, units: rules.units, shadeCountsAsHeld: rules.shadeCountsAsHeld,
    districtControl: rules.districtControl, trustWeight: rules.trustWeight, kitLevel: rules.kitLevel,
    // Absent in 1001, so its canonical form (and digest) is unchanged.
    dayAttribution: rules.dayAttribution,
    // Absent in 1001 and 1002 (the v1 cutoff, unnamed), so their digests are unchanged.
    receiptCutoff: rules.receiptCutoff,
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as object).sort().filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => [k, canonical((value as Record<string, unknown>)[k])]));
  }
  return value;
}

/** sha256 of the canonical rule set config. A version whose config changed under it fails closed. */
export function rulesetDigest(rules: Omit<GameplayRules, "seasonOneStartDay">): string {
  return createHash("sha256").update(JSON.stringify(canonical(rulesetConfig(rules)))).digest("hex");
}

/** Problems with a rule set; empty when it is usable. */
export function rulesetProblems(r: Omit<GameplayRules, "seasonOneStartDay">): string[] {
  const p: string[] = [];
  const h = r.holding;
  if (!Number.isInteger(h.rulesVersion) || h.rulesVersion <= 0) p.push("holding rules version must be a positive whole number");
  if (h.rulesVersion >= 9000 && h.rulesVersion < 10000) p.push("9000-9999 are the simulator's versions");
  if (JSON.stringify(canonical(h.takeover)) !== JSON.stringify(canonical(takeoverRuleOf(r.takeover)))) p.push("holding.takeover does not match the takeover policy");
  if (r.takeover.name === "two-day-challenge") {
    const c = r.takeover;
    if (!(Number.isInteger(c.windowDays) && c.windowDays >= 1)) p.push("challenge window must be 1 day or more");
    if (!(Number.isInteger(c.floor) && c.floor >= 1 && c.floor <= 100)) p.push("challenge floor must be 1-100");
    if (!(c.immediateBelowStrength >= 0 && c.immediateBelowStrength <= 100)) p.push("immediate-take line must be 0-100");
    // As the simulator checks: inside the window a challenged unit must not decay below
    // the immediate-take line, or a passer-by could finish someone else's challenge.
    if (c.floor - c.windowDays * h.solidDecayPerDay < Math.max(1, c.immediateBelowStrength)) p.push("challenge floor must outlast the window's decay above the immediate-take line");
    if (c.policyVersion === 2) {
      const g = c.secondPush;
      if (g.rule !== "min-elapsed-server-receipt" || g.version !== 1) p.push("unknown second-push rule");
      // At least one hour, and short enough that a walker coming back on the last day of the window can still finish.
      else if (!(Number.isInteger(g.minElapsedMs) && g.minElapsedMs >= 3_600_000 && g.minElapsedMs <= c.windowDays * DAY_MS)) p.push("second-push gap must be 1 hour to the window");
    } else if (c.policyVersion !== 1) p.push("unknown takeover policy version");
  }
  if (r.takeBudget !== null) {
    if (!(Number.isInteger(r.takeBudget.perWalkerPerDay) && r.takeBudget.perWalkerPerDay >= 1)) p.push("take budget must be a whole number, 1 or more");
    if (r.takeBudget.counting !== "takes-v1") p.push("unknown take counting rule");
    if (r.takeBudget.order !== undefined && r.takeBudget.order !== "walk-order-v1") p.push("unknown take order");
  }
  if (r.receiptCutoff !== undefined && (r.receiptCutoff.rule !== "server-receipt-before-day-close" || r.receiptCutoff.version !== 1)) p.push("unknown receipt cutoff rule");
  if (!(Number.isInteger(r.dayCloseGraceMs) && r.dayCloseGraceMs >= 0 && r.dayCloseGraceMs < DAY_MS)) p.push("day close grace must be 0 to under a day");
  if (r.dayAttribution !== undefined && (r.dayAttribution.rule !== "d1-last-verified-fix" || r.dayAttribution.version !== 1)) p.push("unknown day attribution rule");
  const u = r.units;
  if (u.unit.kind === "h3" && !(Number.isInteger(u.unit.resolution) && u.unit.resolution >= 0 && u.unit.resolution <= 15)) p.push("unit resolution must be 0-15");
  if (u.zone.kind === "h3-parent") {
    if (u.unit.kind !== "h3") p.push("h3-parent zones need h3 units");
    else if (!(Number.isInteger(u.zone.resolution) && u.zone.resolution >= 0 && u.zone.resolution < u.unit.resolution)) p.push("zone resolution must be coarser than the unit's");
    if (u.mixedHolderZone !== "each-holder-holds-zone" && u.mixedHolderZone !== "unit-is-zone") p.push("mixed-holder zone rule must be named");
  }
  if (u.source !== undefined) {
    if (u.source.kind !== "session-path") p.push("unknown unit source");
    else {
      p.push(...sessionPathRuleProblems(u.source.rule));
      if (u.unit.kind !== "h3" || u.unit.resolution !== u.source.rule.resolution) p.push("session path resolution must be the unit resolution");
      if (u.source.rule.maxUnits > r.maxUnitsPerSession) p.push("session path may not hold more units than a session may push");
    }
  }
  if (u.partition !== undefined && (u.partition !== "per-holder-min-level-v1" || u.zone.kind !== "h3-parent" || u.mixedHolderZone !== "each-holder-holds-zone")) {
    p.push("zone partition needs h3-parent zones held by each holder");
  }
  return p;
}

/** Whether a unit id is a unit under the rule set (`stored` accepts any non-empty id up to 64 characters). */
export function isUnitUnder(units: UnitZoneRule, unitId: string): boolean {
  if (typeof unitId !== "string" || unitId.length === 0 || unitId.length > 64) return false;
  if (units.unit.kind === "stored") return true;
  return isValidCell(unitId) && getResolution(unitId) === units.unit.resolution;
}

/**
 * The zone a unit pays upkeep in. Deterministic; throws for a unit that is
 * not a unit under the rule set, which day close reports as a problem.
 */
export function zoneOfUnder(units: UnitZoneRule): (unitId: string) => string {
  if (units.zone.kind === "unit" || units.mixedHolderZone === "unit-is-zone") return (unitId) => unitId;
  const res = units.zone.resolution;
  return (unitId) => {
    if (!isUnitUnder(units, unitId)) throw new Error(`not a resolution ${units.unit.kind === "h3" ? units.unit.resolution : "?"} unit`);
    return cellToParent(unitId, res);
  };
}

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

/** The instant (epoch ms) a day closes: midnight after it on the rules' clock, plus the grace window. */
export function dayCloseMs(rules: Pick<GameplayRules, "dayOffsetMinutes" | "dayCloseGraceMs">, day: number): number {
  return dayStartMs(rules, day + 1) + rules.dayCloseGraceMs;
}

/**
 * The receipt cutoff a day settles under, as bound into its input digest:
 * the rule, the clock and grace it reads, and the day's close instant.
 */
export function receiptCutoffOf(rules: Pick<GameplayRules, "receiptCutoff" | "dayOffsetMinutes" | "dayCloseGraceMs">, day: number) {
  const c = rules.receiptCutoff ?? RECEIPT_CUTOFF_V1;
  return { rule: c.rule, version: c.version, dayOffsetMinutes: rules.dayOffsetMinutes, dayCloseGraceMs: rules.dayCloseGraceMs, closeMs: dayCloseMs(rules, day) };
}

/** Whether a session received at `receivedMs` counts for its D1 day `day` (strictly before the close). */
export function receivedInTime(rules: Pick<GameplayRules, "dayOffsetMinutes" | "dayCloseGraceMs">, day: number, receivedMs: number): boolean {
  return Number.isFinite(receivedMs) && receivedMs < dayCloseMs(rules, day);
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
  // The rule set: 1001 unless named. An unknown or malformed version stops the API (fail closed).
  const rawVersion = env.MOVENRUN_GAMEPLAY_RULES_VERSION;
  if (rawVersion !== undefined && !/^\d{1,6}$/.test(rawVersion)) throw new Error("MOVENRUN_GAMEPLAY_RULES_VERSION must be a known holding rules version");
  const version = rawVersion === undefined ? DEFAULT_RULES_VERSION : Number(rawVersion);
  if (!RULESETS.has(version)) throw new Error("MOVENRUN_GAMEPLAY_RULES_VERSION must be a known holding rules version");
  const base = rulesetFor(version);
  return { ...base, holding: { ...base.holding }, seasonOneStartDay: Number(raw) };
}
