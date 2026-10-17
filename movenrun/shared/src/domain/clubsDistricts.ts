/**
 * Game Economy V3: clubs, club contributions, district control and season
 * leaderboards, as a pure reference model (G4).
 *
 * `holding.ts` decides what a push does to a unit, `holdingLedger.ts` applies
 * a day's pushes and records an entry for each, and `holdingSettlement.ts`
 * reads the ledger at day close and settles the day's credits. This module
 * reads the same settled data and adds the club layer on top:
 *
 * - `clubSnapshot`: who is in which club on a day, from membership spans.
 * - `clubContributions`: per club and member, the day's ledger entries
 *   counted by outcome and by kind (stepped on or enclosed). Counts only;
 *   what a contribution is worth is D19.
 * - `districtControl`: per district, the ground each club holds at day close,
 *   solid and shade both counted (section 4), and which club, if any,
 *   controls it under a rule the caller passes in (D21).
 * - `seasonLeaderboard`: a ranking over a season's settled days only.
 *
 * ## What the source says, and what it leaves open
 *
 * SOURCE: seasons are 90 days (section 17, `EconomyRules.seasonDays`); solid
 * and shade both count for leaderboards and district control (section 4);
 * clubs, district and city wars and layered leaderboards (block, suburb,
 * city, country, world) exist and create no tokens (section 15).
 *
 * The source does not say how many clubs a walker may be in or when joining
 * takes effect (D18), what a contribution is worth (D19), what a district is
 * (D20), how control is decided (D21), what a leaderboard ranks or how ties
 * are broken (D22), or whether pushing a club-mate's ground erodes it (D23).
 * Each is a required parameter with no default, or the model reports a
 * problem instead of choosing. A day with any problem is refused whole, as in
 * `holdingSettlement.ts`.
 *
 * ## What it is not
 *
 * Off-chain game data only: no token, balance, wallet or chain. It stores
 * nothing, is not wired into the API, the app or the database, and draws
 * nothing. A district is whatever D20 makes it: the caller maps a unit id to
 * a district id, so the grid stays a backend index. A leaderboard is built
 * only from days that settled; with no settled day it is empty, never seeded,
 * and it always says how many days it covers and through which day.
 */

import { economyRulesFor } from "./economyV3";
import type { PushOutcome } from "./holding";
import type { LedgerEntry } from "./holdingLedger";
import { settleCreditsSeason, type CreditsDayResult, type HoldingsAtClose } from "./holdingSettlement";

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const isId = (v: unknown): v is string => typeof v === "string" && v !== "";
const isDay = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/* ── membership ───────────────────────────────────────────────────────────── */

/**
 * One walker's membership of one club, from `fromDay` up to but not including
 * `toDay` (null: still a member). Which day a join or leave falls on is the
 * caller's, under D1 and D18.
 */
export interface Membership {
  walkerId: string;
  clubId: string;
  fromDay: number;
  toDay: number | null;
}

export interface ClubSnapshot {
  day: number;
  /** Walker → club on `day`. */
  clubOf: Map<string, string>;
  /** Sorted by clubId; walkerIds sorted. */
  clubs: { clubId: string; walkerIds: string[] }[];
  /** Empty when the snapshot can be used. */
  problems: string[];
}

/**
 * Who is in which club on `day`. A walker in two clubs on one day is a
 * problem (D18 does not say whether that is allowed, and the model cannot
 * split their ground without a rule); so is a walker listed twice.
 */
export function clubSnapshot(memberships: readonly Membership[], day: number): ClubSnapshot {
  const problems: string[] = [];
  if (!isDay(day)) problems.push("day must be a whole number, 0 or more");
  const active = new Map<string, string[]>();
  memberships.forEach((m, i) => {
    if (!isId(m.walkerId) || !isId(m.clubId)) return void problems.push(`membership ${i}: missing walkerId or clubId`);
    if (!isDay(m.fromDay)) return void problems.push(`membership ${i}: fromDay must be a whole number, 0 or more`);
    if (m.toDay !== null && (!isDay(m.toDay) || m.toDay <= m.fromDay)) {
      return void problems.push(`membership ${i}: toDay must be null or after fromDay`);
    }
    if (day < m.fromDay || (m.toDay !== null && day >= m.toDay)) return;
    const list = active.get(m.walkerId) ?? [];
    active.set(m.walkerId, list);
    list.push(m.clubId);
  });

  const clubOf = new Map<string, string>();
  for (const walkerId of [...active.keys()].sort(byString)) {
    const clubs = active.get(walkerId)!;
    if (clubs.length > 1) {
      const distinct = [...new Set(clubs)].sort(byString);
      problems.push(
        distinct.length > 1
          ? `walker ${walkerId} is in clubs ${distinct.join(", ")} on day ${day} (D18)`
          : `walker ${walkerId} is listed twice in club ${distinct[0]} on day ${day}`,
      );
      continue;
    }
    clubOf.set(walkerId, clubs[0]!);
  }
  const members = new Map<string, string[]>();
  for (const [walkerId, clubId] of clubOf) {
    const list = members.get(clubId) ?? [];
    members.set(clubId, list);
    list.push(walkerId);
  }
  const clubs = [...members.keys()].sort(byString).map((clubId) => ({ clubId, walkerIds: members.get(clubId)!.sort(byString) }));
  return { day, clubOf, clubs, problems };
}

/* ── contributions ────────────────────────────────────────────────────────── */

const OUTCOMES: readonly PushOutcome[] = [
  "claimed",
  "reinforced",
  "eroded",
  "flipped",
  "refused_deeded",
  "refused_masked",
  "refused_daily_limit",
];

export type OutcomeCounts = Record<PushOutcome, number>;

export interface ContributionCounts {
  /** Ledger entries by outcome, refusals included so nothing is hidden. */
  byOutcome: OutcomeCounts;
  /** Entries that changed ground (claimed, reinforced, eroded or flipped), by how: stepped on or only enclosed. */
  solid: number;
  shade: number;
  /**
   * Entries that eroded or flipped a club-mate's ground. The holding model has
   * no clubs, so today such a push erodes like any other; whether it should
   * is D23. Counted apart so it is never mistaken for a contribution.
   */
  onClubMateGround: number;
}

export interface MemberContribution extends ContributionCounts {
  walkerId: string;
}

export interface ClubContribution {
  clubId: string;
  /** Every member on the day, sorted by walkerId, zero rows included. */
  members: MemberContribution[];
  totals: ContributionCounts;
}

export interface ClubContributionsInput {
  day: number;
  /** Ledger entries; only those dated `day` are read. */
  entries: readonly LedgerEntry[];
  snapshot: ClubSnapshot;
  /** The holding rules version the day was settled under; an entry under another is a problem. */
  holdingRulesVersion: number;
}

export interface ClubContributionsResult {
  day: number;
  /** Sorted by clubId. */
  clubs: ClubContribution[];
  problems: string[];
}

const CHANGED: ReadonlySet<PushOutcome> = new Set(["claimed", "reinforced", "eroded", "flipped"]);

function emptyCounts(): ContributionCounts {
  const byOutcome = Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as OutcomeCounts;
  return { byOutcome, solid: 0, shade: 0, onClubMateGround: 0 };
}

function addCounts(into: ContributionCounts, from: ContributionCounts): void {
  for (const o of OUTCOMES) into.byOutcome[o] += from.byOutcome[o];
  into.solid += from.solid;
  into.shade += from.shade;
  into.onClubMateGround += from.onClubMateGround;
}

/**
 * The day's ledger entries per club and member. Counts only: D19 decides what
 * they are worth. Entries by walkers in no club are not counted. An entry id
 * seen twice would count twice, so it is a problem (the ledger applies each
 * id once).
 */
export function clubContributions(input: ClubContributionsInput): ClubContributionsResult {
  const { day, snapshot } = input;
  const problems = [...snapshot.problems];
  if (snapshot.day !== day) problems.push(`club snapshot is for day ${snapshot.day}, not ${day}`);

  const counts = new Map<string, ContributionCounts>();
  for (const club of snapshot.clubs) for (const w of club.walkerIds) counts.set(w, emptyCounts());

  const seen = new Set<string>();
  for (const e of input.entries) {
    if (e.day !== day) continue;
    if (seen.has(e.eventId)) {
      problems.push(`entry ${e.eventId} appears twice`);
      continue;
    }
    seen.add(e.eventId);
    if (e.rulesVersion !== input.holdingRulesVersion) {
      problems.push(`entry ${e.eventId}: holding rules version ${e.rulesVersion}, settling under ${input.holdingRulesVersion}`);
      continue;
    }
    if (!OUTCOMES.includes(e.outcome)) {
      problems.push(`entry ${e.eventId}: unknown outcome ${String(e.outcome)}`);
      continue;
    }
    const clubId = snapshot.clubOf.get(e.walkerId);
    if (clubId === undefined) continue;
    const c = counts.get(e.walkerId)!;
    c.byOutcome[e.outcome] += 1;
    if (CHANGED.has(e.outcome)) {
      if (e.pushKind === "solid") c.solid += 1;
      else c.shade += 1;
    }
    const prev = e.previousHolderId;
    if ((e.outcome === "eroded" || e.outcome === "flipped") && prev !== null && prev !== e.walkerId && snapshot.clubOf.get(prev) === clubId) {
      c.onClubMateGround += 1;
    }
  }

  const clubs = snapshot.clubs.map(({ clubId, walkerIds }): ClubContribution => {
    const totals = emptyCounts();
    const members = walkerIds.map((walkerId) => {
      const c = counts.get(walkerId)!;
      addCounts(totals, c);
      return { walkerId, ...c };
    });
    return { clubId, members, totals };
  });
  return { day, clubs, problems };
}

/* ── districts ────────────────────────────────────────────────────────────── */

/** A positive fraction of whole numbers, so shares compare exactly. */
export interface Fraction {
  numerator: number;
  denominator: number;
}

/** DECISION NEEDED D21: how a district's control is decided. No defaults. */
export interface DistrictControlRule {
  /**
   * What one shade unit counts for against one solid unit. Section 4 says
   * shade counts for district control, so it must be more than 0; how much
   * is D21. Integer weights: a solid unit weighs `denominator`, a shade unit
   * `numerator`.
   */
  shadeWeight: Fraction;
  /**
   * The share of the district's held ground (every holder's, clubbed or not)
   * a club must reach to control it, more than 0 and at most 1. A club also
   * needs strictly more than every other club; an exact tie controls nothing
   * and is reported as tied.
   */
  minShare: Fraction;
}

export interface DistrictControlInput {
  /** Holdings at day close (`holdingsAtDayClose`); states are already decayed to the day. */
  holdings: HoldingsAtClose;
  snapshot: ClubSnapshot;
  /** DECISION NEEDED D20: the district each unit belongs to. No default. */
  districtOf: (unitId: string) => string;
  rule: DistrictControlRule;
}

export interface GroundTally {
  solidUnits: number;
  shadeUnits: number;
  /** solidUnits × shadeWeight.denominator + shadeUnits × shadeWeight.numerator. */
  weight: number;
}

export type ControlStatus =
  | "controlled"   // one club leads strictly and reaches the minimum share
  | "tied"         // two or more clubs share the lead
  | "below_share"  // one club leads but under the minimum share
  | "no_club";     // no club holds ground here

export interface DistrictStanding {
  districtId: string;
  /** Every holder's ground in the district, clubbed or not. */
  held: GroundTally;
  /** Sorted by weight, highest first, then clubId. */
  clubs: ({ clubId: string } & GroundTally)[];
  /** Ground held by walkers in no club. */
  unclubbed: GroundTally;
  status: ControlStatus;
  controllerClubId: string | null;
}

export interface DistrictControlResult {
  day: number;
  /** Sorted by districtId; only districts with held ground. */
  districts: DistrictStanding[];
  problems: string[];
}

function fractionProblem(f: Fraction | undefined, name: string, max?: number): string | null {
  if (!f || !Number.isSafeInteger(f.numerator) || !Number.isSafeInteger(f.denominator) || f.numerator <= 0 || f.denominator <= 0) {
    return `${name} (D21) must be a fraction of positive whole numbers`;
  }
  if (max !== undefined && f.numerator > max * f.denominator) return `${name} (D21) must be at most ${max}`;
  return null;
}

const tally = (): GroundTally => ({ solidUnits: 0, shadeUnits: 0, weight: 0 });

/**
 * Which club controls each district at the close of the holdings' day.
 * Solid and shade both count (section 4), shade at the D21 weight. Masked
 * and unheld ground counts for nobody. Pure; reports problems, never guesses.
 */
export function districtControl(input: DistrictControlInput): DistrictControlResult {
  const { holdings, snapshot, rule } = input;
  const day = holdings.day;
  const problems = [...holdings.problems, ...snapshot.problems];
  if (snapshot.day !== day) problems.push(`club snapshot is for day ${snapshot.day}, not ${day}`);
  for (const p of [fractionProblem(rule?.shadeWeight, "shadeWeight"), fractionProblem(rule?.minShare, "minShare", 1)]) {
    if (p) problems.push(p);
  }
  if (problems.length > 0) return { day, districts: [], problems };
  const solidW = rule.shadeWeight.denominator;
  const shadeW = rule.shadeWeight.numerator;

  const byDistrict = new Map<string, { held: GroundTally; clubs: Map<string, GroundTally>; unclubbed: GroundTally }>();
  for (const unitId of [...holdings.states.keys()].sort(byString)) {
    const s = holdings.states.get(unitId)!;
    if (s.holderId === null || s.masked) continue;
    let districtId: unknown;
    try {
      districtId = input.districtOf(unitId);
    } catch (err) {
      problems.push(`unit ${unitId}: no district (${message(err)})`);
      continue;
    }
    if (!isId(districtId)) {
      problems.push(`unit ${unitId}: no district`);
      continue;
    }
    const d = byDistrict.get(districtId) ?? { held: tally(), clubs: new Map(), unclubbed: tally() };
    byDistrict.set(districtId, d);
    const clubId = snapshot.clubOf.get(s.holderId);
    const t = clubId === undefined ? d.unclubbed : d.clubs.get(clubId) ?? tally();
    if (clubId !== undefined) d.clubs.set(clubId, t);
    for (const into of [d.held, t]) {
      if (s.ground === "shade") {
        into.shadeUnits += 1;
        into.weight += shadeW;
      } else {
        into.solidUnits += 1;
        into.weight += solidW;
      }
    }
  }
  if (problems.length > 0) return { day, districts: [], problems };

  const districts = [...byDistrict.keys()].sort(byString).map((districtId): DistrictStanding => {
    const d = byDistrict.get(districtId)!;
    const clubs = [...d.clubs]
      .map(([clubId, t]) => ({ clubId, ...t }))
      .sort((a, b) => b.weight - a.weight || byString(a.clubId, b.clubId));
    const base = { districtId, held: d.held, clubs, unclubbed: d.unclubbed };
    const [first, second] = clubs;
    if (!first) return { ...base, status: "no_club", controllerClubId: null };
    if (second && second.weight === first.weight) return { ...base, status: "tied", controllerClubId: null };
    // Exact: first.weight / held.weight ≥ minShare.
    const reaches = first.weight * rule.minShare.denominator >= rule.minShare.numerator * d.held.weight;
    return reaches ? { ...base, status: "controlled", controllerClubId: first.clubId } : { ...base, status: "below_share", controllerClubId: null };
  });
  return { day, districts, problems };
}

/* ── season leaderboards ──────────────────────────────────────────────────── */

/** One settled day of a season, as the leaderboard reads it. */
export interface SeasonDay {
  /** `settleCreditsDay`; a refused day refuses the board. */
  credits: CreditsDayResult;
  /** The club snapshot for the same day; needed for club metrics. */
  snapshot?: ClubSnapshot;
  /** District control for the same day; needed for `club_district_days`. */
  districts?: DistrictControlResult;
}

/**
 * DECISION NEEDED D22: what a season leaderboard ranks. No default; each is
 * computed from settled days only.
 *
 * - `player_credits`: each player's net credits over the settled days.
 * - `club_credits`: members' net credits, each day counted for the club the
 *   member was in that day.
 * - `club_district_days`: how many (district, day) pairs each club controlled.
 */
export type LeaderboardMetric = "player_credits" | "club_credits" | "club_district_days";

export interface LeaderboardRow {
  /** Competition rank: equal scores share a rank and the next rank skips (1, 2, 2, 4). */
  rank: number;
  /** playerId or clubId. */
  id: string;
  score: number;
}

export type SeasonLeaderboardResult =
  | {
      status: "settled";
      /** Always "settled_days": a board is never live and never seeded. */
      basis: "settled_days";
      metric: LeaderboardMetric;
      rulesVersion: number;
      season: number;
      daysSettled: number;
      /** The last settled day the board includes; null when none. */
      throughDay: number | null;
      /** All the season's days have settled. */
      seasonComplete: boolean;
      /** Score highest first, ties by id. Empty when nothing has settled. */
      rows: LeaderboardRow[];
    }
  | { status: "refused"; season: number; problems: string[] };

/**
 * Ranks scores: highest first, equal scores share a rank and are listed by id
 * (D22: this favours nobody; the owner may choose another tie-break).
 */
export function rankRows(scores: ReadonlyMap<string, number>): LeaderboardRow[] {
  const sorted = [...scores].sort(([ia, a], [ib, b]) => b - a || byString(ia, ib));
  const rows: LeaderboardRow[] = [];
  sorted.forEach(([id, score], i) => {
    const prev = rows[i - 1];
    rows.push({ rank: prev && prev.score === score ? prev.rank : i + 1, id, score });
  });
  return rows;
}

export interface SeasonLeaderboardInput {
  rulesVersion: number;
  season: number;
  days: readonly SeasonDay[];
  metric: LeaderboardMetric;
}

/**
 * A season leaderboard from settled days only. The days are checked by
 * `settleCreditsSeason` (no refused, repeated, extra or foreign day, and the
 * season pool holds), and each day's snapshot and districts must be for that
 * day and free of problems. Any problem refuses the whole board.
 */
export function seasonLeaderboard(input: SeasonLeaderboardInput): SeasonLeaderboardResult {
  const { rulesVersion, season, days, metric } = input;
  const refuse = (problems: string[]): SeasonLeaderboardResult => ({ status: "refused", season, problems });
  if (metric !== "player_credits" && metric !== "club_credits" && metric !== "club_district_days") {
    return refuse([`metric (D22) must be decided`]);
  }
  const rules = economyRulesFor(rulesVersion);
  if (!rules) return refuse([`unknown economy rules version ${rulesVersion}`]);
  const credits = settleCreditsSeason(rulesVersion, season, days.map((d) => d.credits));
  if (credits.status !== "settled") return refuse(credits.problems);

  const problems: string[] = [];
  const scores = new Map<string, number>();
  const add = (id: string, n: number) => scores.set(id, (scores.get(id) ?? 0) + n);
  let throughDay: number | null = null;

  for (const d of days) {
    if (d.credits.status !== "settled") continue; // already refused above
    const day = d.credits.day;
    throughDay = throughDay === null ? day : Math.max(throughDay, day);
    if (metric === "player_credits") {
      for (const line of d.credits.lines) add(line.playerId, line.netMicro);
      continue;
    }
    const snap = d.snapshot;
    if (!snap) {
      problems.push(`day ${day}: no club snapshot`);
      continue;
    }
    if (snap.day !== day) problems.push(`day ${day}: club snapshot is for day ${snap.day}`);
    problems.push(...snap.problems.map((p) => `day ${day}: ${p}`));
    // Every club that existed counts, at zero if it scored nothing.
    for (const c of snap.clubs) add(c.clubId, 0);
    if (metric === "club_credits") {
      for (const line of d.credits.lines) {
        const clubId = snap.clubOf.get(line.playerId);
        if (clubId !== undefined) add(clubId, line.netMicro);
      }
      continue;
    }
    const dist = d.districts;
    if (!dist) {
      problems.push(`day ${day}: no district control`);
      continue;
    }
    if (dist.day !== day) problems.push(`day ${day}: district control is for day ${dist.day}`);
    problems.push(...dist.problems.map((p) => `day ${day}: ${p}`));
    for (const s of dist.districts) if (s.controllerClubId !== null) add(s.controllerClubId, 1);
  }
  if (problems.length > 0) return refuse(problems);

  return {
    status: "settled",
    basis: "settled_days",
    metric,
    rulesVersion,
    season,
    daysSettled: credits.daysSettled,
    throughDay,
    seasonComplete: credits.daysSettled === rules.seasonDays,
    rows: rankRows(scores),
  };
}
