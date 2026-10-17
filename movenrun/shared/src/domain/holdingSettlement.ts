/**
 * Game Economy V3: the day's credits, settled from the holding ledger, as a
 * pure reference model (G3).
 *
 * `holding.ts` already holds strength, erosion, decay, defence (level and
 * fortification resistance) and the stages; `holdingLedger.ts` applies a
 * day's pushes to many units. `economyV3.ts` already settles a day's reward,
 * the toll and the day-close charges, but takes "zones held" and "unvisited
 * zones" as bare inputs. This module joins the two: it reads the ledger's
 * states and entries at day close, works out per holder which zones they
 * hold, at what level, and which they visited, and feeds that to
 * `settleDay`. It then sums settled days into a season.
 *
 * ## Credits, not tokens
 *
 * The result is off-chain game credits for the credits-only pilot (section
 * 32, phase 1): the same integer micro-unit arithmetic as `economyV3.ts`,
 * nothing transferable, nothing minted, no wallet, no chain. It stores
 * nothing and is not wired into the API, the app or the database.
 *
 * ## Open decisions are parameters
 *
 * - D4 (decay numbers): `holdingRules`, required. Ground is decayed to day
 *   close before it is counted, so ground that ran out is not charged.
 * - D5 (what a zone is): `zoneOf`, required. A unit is whatever D5 makes it;
 *   upkeep is per zone (section 7), so the caller says which zone each unit
 *   belongs to. Units passed as deeded are the toll's cells (section 20).
 * - D14 (what "paid in condition" does to ground): not applied. The amount is
 *   reported with the unvisited zones; no strength is changed here.
 * - D15 (does shade count as a held zone for upkeep): `shadeCountsAsHeld`,
 *   required.
 * - D16 (levels on loss: "drops two levels; reclaiming within 14 days
 *   restores it"): not modelled; levels are read as the ledger left them.
 * - D17 (when the 14 free away days are spent): `awayProtected` per player,
 *   from the caller, as in `economyV3.ts`.
 *
 * Anything this module cannot decide without inventing a rule (two levels in
 * one holder's zone, a ledger entry under another rules version, a unit with
 * no zone) is a problem, and a day with any problem is refused whole
 * (section 26: a violation halts settlement).
 */

import {
  dailyPoolMicro,
  dayBooksProblems,
  economyRulesFor,
  seasonPoolMicro,
  settleDay,
  type DaySettlement,
  type PlayerDayInput,
} from "./economyV3";
import { decayTo, unitProblems, type HoldingRules, type LandLevel, type UnitState } from "./holding";
import type { LedgerEntry } from "./holdingLedger";

/* ── holdings at day close ────────────────────────────────────────────────── */

export interface HoldingsInput {
  /** Day index being closed, the same scale as `UnitState.asOfDay`. */
  day: number;
  /** Unit states after the day's ledger batches (`applyLedger().states`). */
  states: ReadonlyMap<string, UnitState> | Readonly<Record<string, UnitState>>;
  /** Ledger entries; only those dated `day` are read. */
  entries: readonly LedgerEntry[];
  /** DECISION NEEDED D4: decay numbers. No default. */
  holdingRules: HoldingRules;
  /** DECISION NEEDED D5: the zone each unit belongs to. No default. */
  zoneOf: (unitId: string) => string;
  /** DECISION NEEDED D15: whether a zone held only as shade is a held zone for upkeep. No default. */
  shadeCountsAsHeld: boolean;
}

export interface HeldZone {
  zoneId: string;
  level: LandLevel;
  /** The holder stepped on a unit of this zone on the day (a solid push in the ledger). */
  visited: boolean;
  unitIds: string[];
}

export interface PlayerHoldings {
  playerId: string;
  /** Sorted by zoneId. */
  zones: HeldZone[];
}

export interface HoldingsAtClose {
  day: number;
  holdingRulesVersion: number;
  /** Every unit decayed to `day`. */
  states: Map<string, UnitState>;
  /** Sorted by playerId; only players who hold a counted zone. */
  holders: PlayerHoldings[];
  /** Deeded units and their holders: the toll's cells (section 20). */
  deedOwnerByCell: Map<string, string>;
  /** Empty when the holdings can be settled. */
  problems: string[];
}

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function toEntries(states: HoldingsInput["states"]): [string, UnitState][] {
  const list: [string, UnitState][] = states instanceof Map ? [...states.entries()] : Object.entries(states);
  return list.sort(([a], [b]) => byString(a, b));
}

function zoneFor(zoneOf: HoldingsInput["zoneOf"], unitId: string, problems: string[]): string | null {
  let zone: unknown;
  try {
    zone = zoneOf(unitId);
  } catch (err) {
    problems.push(`unit ${unitId}: no zone (${err instanceof Error ? err.message : String(err)})`);
    return null;
  }
  if (typeof zone !== "string" || zone === "") {
    problems.push(`unit ${unitId}: no zone`);
    return null;
  }
  return zone;
}

/**
 * Who holds which zone at the close of `day`, at what level, and whether they
 * visited it. Pure. Never throws on bad data; it reports problems instead.
 */
export function holdingsAtDayClose(input: HoldingsInput): HoldingsAtClose {
  const { day, holdingRules, zoneOf } = input;
  const problems: string[] = [];
  const states = new Map<string, UnitState>();
  const deedOwnerByCell = new Map<string, string>();
  if (!Number.isInteger(day) || day < 0) problems.push("day must be a whole number, 0 or more");
  if (typeof input.shadeCountsAsHeld !== "boolean") problems.push("shadeCountsAsHeld (D15) must be decided");

  // Visits: a stepped-on push by a walker on any unit of a zone, on the day.
  const visited = new Set<string>();
  for (const e of input.entries) {
    if (e.day !== day) continue;
    if (e.rulesVersion !== holdingRules.rulesVersion) {
      problems.push(`entry ${e.eventId}: holding rules version ${e.rulesVersion}, settling under ${holdingRules.rulesVersion}`);
      continue;
    }
    if (e.pushKind !== "solid") continue;
    const zone = zoneFor(zoneOf, e.unitId, problems);
    if (zone !== null) visited.add(`${e.walkerId}\u0000${zone}`);
  }

  // zone → holder → units, with the levels seen.
  const held = new Map<string, Map<string, { levels: Set<LandLevel>; unitIds: string[] }>>();
  for (const [key, raw] of toEntries(input.states)) {
    if (raw.unitId !== key) {
      problems.push(`unit ${key} is stored under the wrong id (${raw.unitId})`);
      continue;
    }
    const bad = unitProblems(raw);
    if (bad.length > 0) {
      problems.push(`unit ${key} is inconsistent: ${bad.join(", ")}`);
      continue;
    }
    if (raw.asOfDay > day) {
      problems.push(`unit ${key} is as of day ${raw.asOfDay}, after day ${day}`);
      continue;
    }
    let state: UnitState;
    try {
      state = decayTo(raw, day, holdingRules);
    } catch (err) {
      problems.push(`unit ${key}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    states.set(key, state);
    if (state.holderId === null) continue;
    if (state.deeded) deedOwnerByCell.set(key, state.holderId);
    if (state.ground === "shade" && input.shadeCountsAsHeld !== true) continue;
    const zone = zoneFor(zoneOf, key, problems);
    if (zone === null) continue;
    const byHolder = held.get(zone) ?? new Map();
    held.set(zone, byHolder);
    const slot = byHolder.get(state.holderId) ?? { levels: new Set<LandLevel>(), unitIds: [] };
    byHolder.set(state.holderId, slot);
    slot.levels.add(state.level);
    slot.unitIds.push(key);
  }

  const zonesByPlayer = new Map<string, HeldZone[]>();
  for (const zoneId of [...held.keys()].sort(byString)) {
    for (const [playerId, slot] of [...held.get(zoneId)!].sort(([a], [b]) => byString(a, b))) {
      if (slot.levels.size !== 1) {
        // D5: a zone's level is not defined when one holder's units in it differ.
        problems.push(`zone ${zoneId}: ${playerId} holds units at levels ${[...slot.levels].sort().join(", ")} (D5)`);
        continue;
      }
      const list = zonesByPlayer.get(playerId) ?? [];
      zonesByPlayer.set(playerId, list);
      list.push({ zoneId, level: [...slot.levels][0]!, visited: visited.has(`${playerId}\u0000${zoneId}`), unitIds: slot.unitIds });
    }
  }
  const holders = [...zonesByPlayer]
    .sort(([a], [b]) => byString(a, b))
    .map(([playerId, zones]) => ({ playerId, zones }));

  return { day, holdingRulesVersion: holdingRules.rulesVersion, states, holders, deedOwnerByCell, problems };
}

/* ── one day's credits ────────────────────────────────────────────────────── */

/** A player's day, without the zone fields: those come from the holdings. */
export type CreditsPlayerInput = Omit<PlayerDayInput, "zonesHeld" | "unvisitedZoneLevels">;

export interface CreditsDayInput {
  /** Economy rules version (section 30). An unknown one is refused, never the newest. */
  rulesVersion: number;
  /** 1-based season; the day's pool is that season's daily pool (section 17). */
  season: number;
  day: number;
  /** Players who moved. A holder with no row here is settled with no sessions (they can only owe upkeep). */
  players: readonly CreditsPlayerInput[];
  holdings: HoldingsAtClose;
}

export interface CreditLine {
  playerId: string;
  /** The day's reward after both ceilings and trust weight. */
  earnedMicro: number;
  tollPaidMicro: number;
  tollReceivedMicro: number;
  rechargeMicro: number;
  upkeepTakenMicro: number;
  /** Owed but not taken (section 7 and 8). What it does to the ground is D14; nothing is changed here. */
  upkeepPaidInConditionMicro: number;
  zonesHeld: number;
  /** The zones charged upkeep today, sorted; the ones D14 would act on. */
  unvisitedZoneIds: string[];
  /** Credits kept: earned − toll paid − recharge − upkeep taken + toll received. Never negative. */
  netMicro: number;
}

export type CreditsDayResult =
  | { status: "settled"; rulesVersion: number; season: number; day: number; poolMicro: number; settlement: DaySettlement; lines: CreditLine[] }
  | { status: "refused"; rulesVersion: number; season: number; day: number; problems: string[] };

/**
 * One day's off-chain credits, settled from the holdings at close. Pure and
 * deterministic. Refuses the whole day on any problem with the rules version,
 * the holdings or the books; it never settles part of a day.
 */
export function settleCreditsDay(input: CreditsDayInput): CreditsDayResult {
  const { rulesVersion, season, day, holdings } = input;
  const refuse = (problems: string[]): CreditsDayResult => ({ status: "refused", rulesVersion, season, day, problems });
  const rules = economyRulesFor(rulesVersion);
  if (!rules) return refuse([`unknown economy rules version ${rulesVersion}`]);
  if (holdings.day !== day) return refuse([`holdings are for day ${holdings.day}, not ${day}`]);
  if (holdings.problems.length > 0) return refuse(holdings.problems);

  let poolMicro: number;
  try {
    poolMicro = dailyPoolMicro(rules, season);
  } catch (err) {
    return refuse([err instanceof Error ? err.message : String(err)]);
  }

  const zonesOf = new Map(holdings.holders.map((h) => [h.playerId, h.zones]));
  const rows = [...input.players];
  const listed = new Set(rows.map((p) => p.playerId));
  for (const h of holdings.holders) {
    // An absent holder: no sessions, so no reward and no recharge; trust and
    // kit are unused at zero reward.
    if (!listed.has(h.playerId)) rows.push({ playerId: h.playerId, sessions: [], activeDaysThisWeek: 1, trustWeight: 0, kitLevel: 1 });
  }

  const players: PlayerDayInput[] = rows.map((p) => {
    const zones = zonesOf.get(p.playerId) ?? [];
    return { ...p, zonesHeld: zones.length, unvisitedZoneLevels: zones.filter((z) => !z.visited).map((z) => z.level) };
  });

  let settlement: DaySettlement;
  try {
    settlement = settleDay(rules, { poolMicro, players, deedOwnerByCell: holdings.deedOwnerByCell });
  } catch (err) {
    return refuse([err instanceof Error ? err.message : String(err)]);
  }
  const books = dayBooksProblems(rules, settlement);
  if (books.length > 0) return refuse(books);

  const lines = settlement.players
    .map((r): CreditLine => {
      const zones = zonesOf.get(r.playerId) ?? [];
      return {
        playerId: r.playerId,
        earnedMicro: r.dayRewardMicro,
        tollPaidMicro: r.tollPaidMicro,
        tollReceivedMicro: r.tollReceivedMicro,
        rechargeMicro: r.charges.rechargeMicro,
        upkeepTakenMicro: r.charges.upkeepTakenMicro,
        upkeepPaidInConditionMicro: r.charges.upkeepPaidInConditionMicro,
        zonesHeld: zones.length,
        unvisitedZoneIds: zones.filter((z) => !z.visited).map((z) => z.zoneId),
        netMicro: r.creditedMicro + r.tollReceivedMicro,
      };
    })
    .sort((a, b) => byString(a.playerId, b.playerId));
  return { status: "settled", rulesVersion, season, day, poolMicro, settlement, lines };
}

/* ── a season ─────────────────────────────────────────────────────────────── */

export interface SeasonCredits {
  rulesVersion: number;
  season: number;
  daysSettled: number;
  seasonPoolMicro: number;
  /** Sum of the settled days' pools. */
  poolMicro: number;
  /** Credits the settled days created (the books' "minted"): off-chain points, never tokens. */
  issuedMicro: number;
  burnedMicro: number;
  /** Trimmed, withheld and rounding; it stays in this season (section 17: never crosses a season). */
  returnedMicro: number;
  /** Net credits per player, sorted by playerId. */
  byPlayer: { playerId: string; netMicro: number }[];
}

export type SeasonCreditsResult = ({ status: "settled" } & SeasonCredits) | { status: "refused"; season: number; problems: string[] };

/**
 * Sums a season's settled days. Refuses if any day was refused, belongs to
 * another season or rules version, is repeated, or if the days together pass
 * the season's length or pool.
 */
export function settleCreditsSeason(rulesVersion: number, season: number, days: readonly CreditsDayResult[]): SeasonCreditsResult {
  const refuse = (problems: string[]): SeasonCreditsResult => ({ status: "refused", season, problems });
  const rules = economyRulesFor(rulesVersion);
  if (!rules) return refuse([`unknown economy rules version ${rulesVersion}`]);
  let seasonPool: number;
  try {
    seasonPool = seasonPoolMicro(rules, season);
  } catch (err) {
    return refuse([err instanceof Error ? err.message : String(err)]);
  }

  const problems: string[] = [];
  const seen = new Set<number>();
  const byPlayer = new Map<string, number>();
  let pool = 0;
  let issued = 0;
  let burned = 0;
  let returned = 0;
  for (const d of days) {
    if (d.status !== "settled") {
      problems.push(`day ${d.day} was refused`);
      continue;
    }
    if (d.season !== season) problems.push(`day ${d.day} is in season ${d.season}`);
    if (d.rulesVersion !== rulesVersion) problems.push(`day ${d.day} is under rules version ${d.rulesVersion}`);
    if (seen.has(d.day)) problems.push(`day ${d.day} settled twice`);
    seen.add(d.day);
    const b = d.settlement.books;
    pool += b.poolMicro;
    issued += b.mintedMicro;
    burned += b.burnedMicro;
    returned += b.returnedToSeasonPoolMicro;
    for (const line of d.lines) byPlayer.set(line.playerId, (byPlayer.get(line.playerId) ?? 0) + line.netMicro);
  }
  if (seen.size > rules.seasonDays) problems.push(`${seen.size} days settled in a ${rules.seasonDays}-day season`);
  if (issued > seasonPool) problems.push("issued more than the season pool");
  if (pool > seasonPool) problems.push("day pools exceed the season pool");
  if (problems.length > 0) return refuse(problems);

  return {
    status: "settled",
    rulesVersion,
    season,
    daysSettled: seen.size,
    seasonPoolMicro: seasonPool,
    poolMicro: pool,
    issuedMicro: issued,
    burnedMicro: burned,
    returnedMicro: returned,
    byPlayer: [...byPlayer].sort(([a], [b]) => byString(a, b)).map(([playerId, netMicro]) => ({ playerId, netMicro })),
  };
}
