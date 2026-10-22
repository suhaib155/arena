/**
 * Probes for the G4 reference model (shared/src/domain/clubsDistricts.ts).
 * Everything here is synthetic: a district is an id prefix, never a real place.
 * The G4 functions are imported and called as they are; nothing is patched.
 */
import { readFileSync } from "node:fs";
import { newUnit, type UnitState, type HoldingRules } from "../../../shared/src/domain/holding.ts";
import { holdingsAtDayClose, type HoldingsAtClose } from "../../../shared/src/domain/holdingSettlement.ts";
import {
  clubSnapshot,
  districtControl,
  type DistrictControlRule,
  type DistrictControlResult,
  type Membership,
  type Fraction,
} from "../../../shared/src/domain/clubsDistricts.ts";
import { mulberry32, summarise, type Summary } from "./stats.ts";

export const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8")) as {
  seeds: number[];
  world: { districts: number; unitsPerDistrict: number; clubSizes: number[]; unclubbedWalkers: number; unitsPerWalker: number };
  sweeps: { concentration: number[]; shadeWeights: [number, number][]; minShares: [number, number][]; shadeShareOfClubGround: number[] };
};

export const DAY = 10;
// D4 is open: test values only (same shape the G4 tests use).
export const holdingRules: HoldingRules = { rulesVersion: 7, solidDecayPerDay: 10, shadeDecayMultiplier: 3, stageFloors: { held: 60, atRisk: 30, contested: 10 } };
export const zoneOf = (unitId: string) => unitId.split("/").slice(0, 2).join("/");
export const districtOfPrefix = (unitId: string) => unitId.split("/")[0]!;
export const frac = ([numerator, denominator]: [number, number]): Fraction => ({ numerator, denominator });
export const rule = (shade: [number, number], min: [number, number]): DistrictControlRule => ({ shadeWeight: frac(shade), minShare: frac(min) });

export const unitId = (d: number, u: number) => `d${String(d).padStart(2, "0")}/z${Math.floor(u / 10)}/u${String(u).padStart(3, "0")}`;

export function held(id: string, holderId: string, ground: "solid" | "shade" = "solid"): UnitState {
  return { ...newUnit(id, DAY), holderId, strength: ground === "shade" ? 25 : 100, ground };
}
export function closeOf(units: UnitState[]): HoldingsAtClose {
  return holdingsAtDayClose({ day: DAY, states: new Map(units.map((s) => [s.unitId, s])), entries: [], holdingRules, zoneOf, shadeCountsAsHeld: true });
}
export const member = (walkerId: string, clubId: string, fromDay = 0, toDay: number | null = null): Membership => ({ walkerId, clubId, fromDay, toDay });

export function control(units: UnitState[], memberships: Membership[], r: DistrictControlRule, districtOf = districtOfPrefix, day = DAY): DistrictControlResult {
  return districtControl({ holdings: { ...closeOf(units), day }, snapshot: clubSnapshot(memberships, day), districtOf, rule: r });
}

/* ── capture advantage of dense clubs ─────────────────────────────────────── */

export interface WorldResult {
  clubs: { clubId: string; members: number; groundShare: number; districtShare: number; districtsControlled: number }[];
  belowShare: number;
  tied: number;
  noClub: number;
}

/**
 * Synthetic world: districts x units, clubs of the manifest's sizes plus unclubbed walkers. Each walker holds
 * `unitsPerWalker` units. With probability `concentration` a club member's unit lies in one of the club's
 * home districts (one home district per 10 members, at least one); otherwise anywhere. Unclubbed walkers
 * hold anywhere. Units are claimed in a fixed order so a unit is held once.
 */
export function runWorld(seed: number, concentration: number, r: DistrictControlRule, shadeShare = 0): WorldResult {
  const w = manifest.world;
  const rand = mulberry32(seed);
  const taken = new Set<string>();
  const units: UnitState[] = [];
  const memberships: Membership[] = [];
  const pickIn = (d: number): string | null => {
    for (let tries = 0; tries < 60; tries++) {
      const id = unitId(d, Math.floor(rand() * w.unitsPerDistrict));
      if (!taken.has(id)) return id;
    }
    return null;
  };
  const walkers: { id: string; club: string | null; homes: number[] }[] = [];
  let nextHome = Math.floor(rand() * w.districts);
  w.clubSizes.forEach((size, ci) => {
    const nh = Math.max(1, Math.ceil(size / 10));
    const homes = Array.from({ length: nh }, (_, k) => (nextHome + k) % w.districts);
    nextHome = (nextHome + nh) % w.districts;
    for (let m = 0; m < size; m++) walkers.push({ id: `c${ci}m${m}`, club: `club${ci}`, homes });
  });
  for (let i = 0; i < w.unclubbedWalkers; i++) walkers.push({ id: `solo${i}`, club: null, homes: [] });
  for (const k of walkers) {
    if (k.club) memberships.push(member(k.id, k.club));
    for (let j = 0; j < w.unitsPerWalker; j++) {
      const home = k.club !== null && rand() < concentration;
      const d = home ? k.homes[Math.floor(rand() * k.homes.length)]! : Math.floor(rand() * w.districts);
      const id = pickIn(d);
      if (!id) continue;
      taken.add(id);
      units.push(held(id, k.id, rand() < shadeShare ? "shade" : "solid"));
    }
  }
  const res = control(units, memberships, r);
  if (res.problems.length) throw new Error(res.problems.join("; "));
  const totalGround = units.length;
  const clubOf = new Map(memberships.map((m) => [m.walkerId, m.clubId]));
  const groundBy = new Map<string, number>();
  for (const u of units) {
    const c = clubOf.get(u.holderId!);
    if (c) groundBy.set(c, (groundBy.get(c) ?? 0) + 1);
  }
  const wonBy = new Map<string, number>();
  let below = 0, tied = 0, noClub = 0;
  for (const d of res.districts) {
    if (d.controllerClubId) wonBy.set(d.controllerClubId, (wonBy.get(d.controllerClubId) ?? 0) + 1);
    if (d.status === "below_share") below++;
    if (d.status === "tied") tied++;
    if (d.status === "no_club") noClub++;
  }
  const clubs = w.clubSizes.map((size, ci) => ({
    clubId: `club${ci}`,
    members: size,
    groundShare: (groundBy.get(`club${ci}`) ?? 0) / totalGround,
    districtShare: (wonBy.get(`club${ci}`) ?? 0) / w.districts,
    districtsControlled: wonBy.get(`club${ci}`) ?? 0,
  }));
  return { clubs, belowShare: below / w.districts, tied: tied / w.districts, noClub: noClub / w.districts };
}

export interface SweepRow { concentration: number; shade: string; minShare: string; club: string; members: number; groundShare: Summary; districtShare: Summary; belowShare: Summary }
export function sweep(concentrations = manifest.sweeps.concentration, shadeWeights = [manifest.sweeps.shadeWeights[0]!], minShares = manifest.sweeps.minShares): SweepRow[] {
  const rows: SweepRow[] = [];
  for (const c of concentrations) for (const sw of shadeWeights) for (const ms of minShares) {
    const runs = manifest.seeds.map((s) => runWorld(s, c, rule(sw, ms), 0.25));
    manifest.world.clubSizes.forEach((size, ci) => {
      rows.push({
        concentration: c,
        shade: `${sw[0]}/${sw[1]}`,
        minShare: `${ms[0]}/${ms[1]}`,
        club: `club${ci}`,
        members: size,
        groundShare: summarise(runs.map((r) => r.clubs[ci]!.groundShare)),
        districtShare: summarise(runs.map((r) => r.clubs[ci]!.districtShare)),
        belowShare: summarise(runs.map((r) => r.belowShare)),
      });
    });
  }
  return rows;
}

/* ── D18 switching policies (the caller's job: the model takes spans) ───────── */

export type SwitchPolicy = { name: string; delayDays: number; cooldownDays: number };
export const POLICIES: SwitchPolicy[] = [
  { name: "immediate", delayDays: 0, cooldownDays: 0 },
  { name: "next-day", delayDays: 1, cooldownDays: 0 },
  { name: "next-day+7d-cooldown", delayDays: 1, cooldownDays: 7 },
];

/** A walker who wants to alternate clubs A/B every day for `days` days. Returns the spans the policy allows. */
export function hopperSpans(walkerId: string, days: number, p: SwitchPolicy): Membership[] {
  const spans: Membership[] = [];
  let current: { club: string; from: number } | null = null;
  let lastSwitch = -Infinity;
  for (let d = 0; d < days; d++) {
    const want = d % 2 === 0 ? "A" : "B";
    if (current === null) { current = { club: want, from: 0 }; lastSwitch = 0; continue; }
    if (current.club === want) continue;
    if (d - lastSwitch < p.cooldownDays) continue;
    const eff = d + p.delayDays;
    if (eff <= current.from) continue;
    spans.push({ walkerId, clubId: current.club, fromDay: current.from, toDay: eff });
    current = { club: want, from: eff };
    lastSwitch = d;
  }
  if (current) spans.push({ walkerId, clubId: current.club, fromDay: current.from, toDay: null });
  return spans;
}

/** Days (out of `days`) on which a one-district fight between A and B is controlled by a different club than the day before. */
export function hopControlFlips(days: number, p: SwitchPolicy): { flips: number; controllers: (string | null)[] } {
  // District "dX": A holds 4 solid units (walkers a1..a4), B holds 4 (b1..b4), the hopper holds 2. Control is decided at day close.
  const base: UnitState[] = [];
  for (let i = 0; i < 4; i++) { base.push(held(unitId(0, i), `a${i}`)); base.push(held(unitId(0, 10 + i), `b${i}`)); }
  base.push(held(unitId(0, 30), "hop"), held(unitId(0, 31), "hop"));
  const fixed: Membership[] = [0, 1, 2, 3].flatMap((i) => [member(`a${i}`, "A"), member(`b${i}`, "B")]);
  const spans = [...fixed, ...hopperSpans("hop", days, p)];
  const controllers: (string | null)[] = [];
  for (let d = 0; d < days; d++) {
    const r = control(base, spans, rule([1, 4], [1, 3]), districtOfPrefix, d);
    if (r.problems.length) throw new Error(r.problems.join("; "));
    controllers.push(r.districts[0]!.controllerClubId);
  }
  let flips = 0;
  for (let i = 1; i < controllers.length; i++) if (controllers[i] !== controllers[i - 1]) flips++;
  return { flips, controllers };
}

/* ── publication thresholds (proposal, not in the source model) ───────────── */

export interface BoardRow { id: string; score: number; contributors: number }
export interface PublishedBoard { shown: BoardRow[]; suppressed: number; other: { count: number; contributors: number; score: number } | null }
/**
 * Proposal: show a row only if at least k distinct active contributors fed it. Suppressed rows are merged
 * into one "other" line, and if exactly one row is suppressed the smallest shown row joins it
 * (complementary suppression), so a total minus the shown rows never isolates one small group.
 */
export function publishBoard(rows: readonly BoardRow[], k: number): PublishedBoard {
  const shown = rows.filter((r) => r.contributors >= k).sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  let hidden = rows.filter((r) => r.contributors < k);
  if (hidden.length === 1 && shown.length > 0) hidden = [...hidden, shown.pop()!];
  if (hidden.length === 0) return { shown, suppressed: 0, other: null };
  return {
    shown,
    suppressed: hidden.length,
    other: { count: hidden.length, contributors: hidden.reduce((a, r) => a + r.contributors, 0), score: hidden.reduce((a, r) => a + r.score, 0) },
  };
}

/** Ties kept whole when cutting a board to its top n (the model lists ties by id, so a plain slice splits them). */
export function topWithTies<T extends { rank: number }>(rows: readonly T[], n: number): T[] {
  if (rows.length <= n) return [...rows];
  const cut = rows[n - 1]!.rank;
  return rows.filter((r) => r.rank <= cut);
}

/* ── appeal window and seasonal reset (proposal) ──────────────────────────── */
export type BoardPhase = "provisional" | "appeal_open" | "final";
export const SEASON_DAYS = 90;
export const seasonOfDay = (day: number, firstSeasonStart = 0) => Math.floor((day - firstSeasonStart) / SEASON_DAYS) + 1;
/** A board for a season is provisional until the season ends, open to appeals for `windowDays` after, then final. */
export function boardPhase(today: number, season: number, windowDays: number, firstSeasonStart = 0): BoardPhase {
  const endExclusive = firstSeasonStart + season * SEASON_DAYS;
  if (today < endExclusive) return "provisional";
  return today < endExclusive + windowDays ? "appeal_open" : "final";
}
