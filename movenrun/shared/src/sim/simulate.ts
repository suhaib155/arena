/**
 * A deterministic, seeded agent-based simulation of one season, run through
 * the reference models in order:
 *
 *   sessions → holdingLedger.applyLedger → holdingSettlement.holdingsAtDayClose
 *   → holdingSettlement.settleCreditsDay → clubsDistricts (snapshot,
 *   contributions, district control) → settleCreditsSeason / seasonLeaderboard
 *
 * The models are used as they are. Where a ruleset decision has no home in a
 * model yet (D14 condition decay, D16 level restore, D17 away-day spending,
 * D18 switching, D19 weighting, D23 immunity, level purchases), the simulator
 * applies it between model calls and says so in a comment. SIMULATION ONLY:
 * every number this produces describes synthetic players on a synthetic grid.
 */

import {
  clubContributions,
  clubSnapshot,
  districtControl,
  rankRows,
  seasonLeaderboard,
  type ClubSnapshot,
  type DistrictControlResult,
  type DistrictControlRule,
  type LeaderboardMetric,
  type Membership,
  type SeasonDay,
} from "../domain/clubsDistricts";
import { economyRulesFor, type SessionInput } from "../domain/economyV3";
import { decayResist, newUnit, stageOf, unitProblems, withoutTakeoverMarks, type HoldingRules, type LandLevel, type Push, type UnitState } from "../domain/holding";
import { applyLedger, type LedgerEntry, type PushEvent } from "../domain/holdingLedger";
import {
  holdingsAtDayClose,
  settleCreditsDay,
  settleCreditsSeason,
  type CreditsDayResult,
  type CreditsPlayerInput,
  type HoldingsAtClose,
} from "../domain/holdingSettlement";
import { rulesetProblems, shadeStrength, type SimRuleset } from "./pilotRuleset";
import {
  axialFromMeters,
  buildPopulation,
  buildWorld,
  COLLUDING_CLUB,
  DEFAULT_POPULATION,
  DIRS,
  disk,
  hash32,
  hexDistance,
  inCity,
  keyed,
  PROFILES,
  ring,
  SHADE_CLUB,
  unitId,
  type Player,
  type PopulationSpec,
  type Profile,
  type World,
} from "./world";

/* ── behaviour ────────────────────────────────────────────────────────────── */

interface Behaviour {
  /** Chance of moving on a day outside a planned week away. */
  pActive: number;
  sessions: (g: () => number) => number;
  minutes: [number, number];
  /** Metres per minute. */
  pace: number;
  loopP: number;
  start: "home" | "near" | "attack" | "fixed";
  /** Player-selected away days (D17): chance of remembering to use one on an unplanned absent day. */
  rememberAway: number;
}

/** Synthetic behaviour assumptions. Not measurements of real players. */
export const BEHAVIOUR: Readonly<Record<Profile, Behaviour>> = {
  casual: { pActive: 0.3, sessions: () => 1, minutes: [15, 30], pace: 85, loopP: 0.4, start: "home", rememberAway: 0.4 },
  regular: { pActive: 0.6, sessions: (g) => (g() < 0.3 ? 2 : 1), minutes: [25, 45], pace: 100, loopP: 0.6, start: "near", rememberAway: 0.7 },
  heavy: { pActive: 0.9, sessions: () => 2, minutes: [40, 70], pace: 130, loopP: 0.5, start: "attack", rememberAway: 0.9 },
  colluder: { pActive: 0.7, sessions: () => 1, minutes: [25, 45], pace: 100, loopP: 0.5, start: "near", rememberAway: 0.9 },
  switcher: { pActive: 0.85, sessions: () => 2, minutes: [35, 60], pace: 120, loopP: 0.5, start: "attack", rememberAway: 0.9 },
  route_farmer: { pActive: 1, sessions: () => 3, minutes: [11, 11], pace: 80, loopP: 0, start: "fixed", rememberAway: 0.9 },
  shade_farmer: { pActive: 0.85, sessions: () => 1, minutes: [50, 70], pace: 140, loopP: 1, start: "home", rememberAway: 0.9 },
  // Churn study only (none in the default population): straight walks onto other people's ground, never loops.
  griefer: { pActive: 0.9, sessions: () => 2, minutes: [30, 50], pace: 120, loopP: 0, start: "attack", rememberAway: 0 },
};

/**
 * Churn study behaviour assumption, off by default: a player who has held
 * ground, holds none at day close and lost ground to another walker within
 * `lookbackDays` stops playing for the rest of the season with this chance
 * per day. Not a measurement; it makes "retention" mean still playing.
 */
export interface Attrition {
  quitChance: Partial<Record<Profile, number>>;
  lookbackDays: number;
}

export const STUDY_ATTRITION: Readonly<Attrition> = Object.freeze({ quitChance: { casual: 0.05, regular: 0.03, heavy: 0.01 }, lookbackDays: 7 });

/** Assumed shape scores (D2 inputs; the simulator does not compute geometry). */
export const SHAPE = { ring: 0.9, sliver: 0.15 } as const;

/* ── options and results ──────────────────────────────────────────────────── */

export interface SimOptions {
  seed: number;
  ruleset: SimRuleset;
  population?: PopulationSpec;
  /** Default 6,000 m. */
  cityRadiusMeters?: number;
  /** Default: the season's length (90). */
  days?: number;
  /** District control rules to evaluate side by side each day (D21); the ruleset's own is always evaluated. */
  controlVariants?: { label: string; rule: DistrictControlRule }[];
  /** Share of the previous day's events resent as retries (idempotency check). Default 0.02. */
  retryShare?: number;
  /** Churn study: players stop playing after losing all their ground. Default: nobody stops. */
  attrition?: Attrition;
}

export interface ControlVariantResult {
  label: string;
  /** Share of (district, day) pairs some club controlled. */
  controlledShare: number;
  /** Times a district's controller changed day to day. */
  controlChanges: number;
  /** District-days by the shade-farming club. */
  shadeClubDistrictDays: number;
  /** District-days by the colluding club. */
  colludeClubDistrictDays: number;
  /** District-days by the top club. */
  topClubDistrictDays: number;
}

export interface ContributionBoard {
  /** Mean score per active day by profile (every player, clubbed or not). */
  perActiveDayByProfile: Record<Profile, number>;
  /** Route farmer per active day ÷ regular per active day. */
  routeFarmerRatio: number;
  shadeFarmerRatio: number;
  colluderRatio: number;
}

export interface SimResult {
  ruleset: string;
  seed: number;
  days: number;
  units: number;
  players: number;
  /** Share of each profile's players holding at least one unit at the close of day 30, 60, 90. */
  retention: Record<Profile, [number, number, number]>;
  /** Mean units held per player, by profile, at season end. */
  unitsHeldAtEnd: Record<Profile, number>;
  /** Stage mix of casual-held units at season end under the ruleset's floors and under an alternative (75/50/25). */
  casualStages: { pilot: Record<string, number>; alt: Record<string, number> };
  takeover: {
    /** Flips of another holder's unit, per day. */
    flipsPerDay: number;
    /** The same, per 100 held units. */
    flipsPer100HeldPerDay: number;
    /** Units casual players lost to a flip, and to decay (including D14 condition), per casual player per season. */
    casualLostToFlipPerPlayer: number;
    casualLostToDecayPerPlayer: number;
    /** Club-mate flips and erosions per day (G4 `onClubMateGround`). */
    clubMatePushesPerDay: number;
    /** Flips of another holder's unit, per day, by the walker's profile. */
    flipsPerDayByWalkerProfile: Record<Profile, number>;
  };
  credits: {
    gini: number;
    top10Share: number;
    meanNetByProfile: Record<Profile, number>;
  };
  books: {
    daysSettled: number;
    daysRefused: number;
    /** Day-level identities that failed; must be 0. */
    identityFailures: number;
    seasonStatus: "settled" | "refused";
    poolMicro: number;
    issuedMicro: number;
    returnedMicro: number;
    burnedMicro: number;
    upkeepTakenMicro: number;
    upkeepInConditionMicro: number;
    rejectedEvents: number;
    retriesSent: number;
    retriesSkipped: number;
    /** Level spend applied by the simulator, outside the models' books. */
    simLevelSpendMicro: number;
    /** Owner rule check: (walker, unit, day) with more than one applied push on someone else's ground. Must be 0. */
    dailyLimitViolations: number;
    /** Pushes the owner rule refused (refused_daily_limit). */
    dailyLimitRefusals: number;
  };
  d14: { conditionDecays: number; conditionLosses: number };
  d16: { levelUps: number; restores: number; shareL2PlusAtEnd: number; levelLaunders: number };
  d17: { awayDaysUsed: number; awayDaysUsedCasual: number; casualProtectedDaysPerPlayer: number };
  d18: { switches: number; kingmakerDistrictDays: number };
  d19: { naive: ContributionBoard; changed: ContributionBoard; pilot: ContributionBoard };
  d21: ControlVariantResult[];
  d22: Record<LeaderboardMetric | "club_contributions", { status: string; top: { id: string; rank: number; score: number }[]; ties: number; colludeRank: number | null; shadeRank: number | null }>;
  d23: { immuneDropped: number; shieldUnitsLostPerShielder: number; shieldSwitches: number; colluderFlipsPerDay: number };
  shade: { shadePushes: number; shadeRejectedLoops: number; shadeUnitsHeldAtEnd: number; shadeFarmerShadeUnitsAtEnd: number; shadeFarmerUpkeepPaidMicro: number };
  /** Churn study measures (`docs/SIM_CHURN_STUDY.md`). */
  churn: ChurnMetrics;
  /** Hash of the final unit states and season credits: equal for equal inputs. */
  fingerprint: string;
}

export interface ChurnMetrics {
  /** Share of held units that end a day with a different holder, or none, than they started it with, per 100. */
  dailyTurnoverPer100Held: number;
  /** Share of each profile's players still playing at the close of day 30, 60, 90 (1 without attrition). */
  playing: Record<Profile, [number, number, number]>;
  /** Units griefers flipped per griefer per active day (0 with no griefers). */
  grieferFlipsPerActiveDay: number;
  /** Casual and regular units griefers flipped, per casual or regular player per season. */
  honestUnitsLostToGriefersPerPlayer: number;
  /** The same two measures in km², so unit sizes compare (a hex unit is 3√3/2 × edge²). */
  grieferKm2PerActiveDay: number;
  honestKm2LostToGriefersPerPlayer: number;
  /** Share of held units at season end held by heavy players and griefers. */
  heavyShareOfHeldAtEnd: number;
  /** Colluders' mean units held at season end ÷ regular players'. */
  colluderHoldRatio: number;
  /** Route farmers' share of all net season credits, and their share of players. */
  routeFarmerCreditShare: number;
  routeFarmerPlayerShare: number;
  /** Season credits issued ÷ season pool. */
  issuedShareOfPool: number;
  /** Pushes refused by the walker take cap before the ledger. */
  walkerCapRefusals: number;
  fortifyPurchases: number;
  /** Fortify spend applied by the simulator, outside the models' books. */
  fortifySpendMicro: number;
  /** Share of route farmers' sessions, and of casual, regular and heavy players' sessions, settled as unscored by the repeat-route lever. */
  routeFarmerSessionsUnscored: number;
  honestSessionsUnscored: number;
  /** Units (and zones) in the grid. */
  zones: number;
}

/* ── helpers ──────────────────────────────────────────────────────────────── */

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const pad = (n: number, w: number) => String(n).padStart(w, "0");

export function gini(values: readonly number[]): number {
  const xs = values.map((v) => Math.max(0, v)).sort((a, b) => a - b);
  const n = xs.length;
  const total = xs.reduce((a, b) => a + b, 0);
  if (n === 0 || total === 0) return 0;
  let weighted = 0;
  xs.forEach((x, i) => (weighted += (i + 1) * x));
  return (2 * weighted) / (n * total) - (n + 1) / n;
}

export function topShare(values: readonly number[], share: number): number {
  const xs = values.map((v) => Math.max(0, v)).sort((a, b) => b - a);
  const total = xs.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  const k = Math.max(1, Math.ceil(xs.length * share));
  return xs.slice(0, k).reduce((a, b) => a + b, 0) / total;
}

const emptyByProfile = <T>(f: () => T): Record<Profile, T> => Object.fromEntries(PROFILES.map((p) => [p, f()])) as Record<Profile, T>;

interface PlannedSession {
  minutes: number;
  meters: number;
  stepped: string[];
  enclosed: string[];
  shade: number | null;
  loopRejected: boolean;
}

function randomWalk(w: World, startQ: number, startR: number, steps: number, g: () => number, prefer?: (id: string) => boolean): string[] {
  const path: string[] = [unitId(startQ, startR)];
  const seen = new Set(path);
  let q = startQ;
  let r = startR;
  for (let s = 0; s < steps; s++) {
    const options = DIRS.map(([dq, dr]) => [q + dq, r + dr] as [number, number]).filter(([a, b]) => inCity(w, a, b));
    if (options.length === 0) break;
    const preferred = prefer ? options.filter(([a, b]) => prefer(unitId(a, b)) && !seen.has(unitId(a, b))) : [];
    const pool = preferred.length > 0 ? preferred : options;
    const [nq, nr] = pool[Math.floor(g() * pool.length)]!;
    q = nq;
    r = nr;
    const id = unitId(q, r);
    if (!seen.has(id)) {
      seen.add(id);
      path.push(id);
    }
  }
  return path;
}

/* ── the run ──────────────────────────────────────────────────────────────── */

export function simulate(opts: SimOptions): SimResult {
  const R = opts.ruleset;
  const problems = rulesetProblems(R);
  if (problems.length > 0) throw new RangeError(`ruleset ${R.name}: ${problems.join("; ")}`);
  const econ = economyRulesFor(R.economyRulesVersion);
  if (!econ) throw new RangeError(`unknown economy rules version ${R.economyRulesVersion}`);
  const seed = opts.seed;
  const days = opts.days ?? econ.seasonDays;
  const retryShare = opts.retryShare ?? 0.02;
  const H: HoldingRules = R.holding;
  const world = buildWorld({ edgeMeters: R.unitEdgeMeters, cityRadiusMeters: opts.cityRadiusMeters ?? 6000, districtsVersion: R.districts.version, districtCount: R.districts.count });
  const players = buildPopulation(world, opts.population ?? DEFAULT_POPULATION, seed, econ.seasonDays);
  const playerById = new Map(players.map((p) => [p.id, p]));
  const districtOf = (id: string) => {
    const u = world.byId.get(id);
    if (!u) throw new RangeError(`no unit ${id}`);
    return u.districtId;
  };
  const controlVariants = [{ label: "ruleset", rule: R.control }, ...(opts.controlVariants ?? [])];

  // Churn study levers. With no `churn` section every branch below is skipped.
  const C = R.churn;
  const zoned = C !== undefined && C.zoneEdgeMeters !== null;
  const zoneMap = new Map<string, string>();
  if (zoned) {
    // D5 zones: each unit belongs to the coarse hex its centre falls in (about 7 units per zone at 76 m in 201 m).
    const coarseSpacing = Math.sqrt(3) * C.zoneEdgeMeters!;
    for (const u of world.units) {
      const [zq, zr] = axialFromMeters(u.x, u.y, coarseSpacing);
      zoneMap.set(u.id, `z${zq}_${zr}`);
    }
  }
  const zoneOf = zoned ? (id: string) => zoneMap.get(id)! : (id: string) => id; // D5 pilot: a unit is a zone.
  const zoneCount = zoned ? new Set(zoneMap.values()).size : world.units.length;
  const hk = (holder: string, zone: string) => `${holder}\u0000${zone}`;
  const zoneMeta = new Map<string, { since: number; visits: number[]; level: LandLevel }>();
  const zoneSnapshot = new Map<string, { level: LandLevel; day: number }>();
  const lastZoneVisit = new Map<string, number>();
  const zoneVisitDays = new Map<string, number[]>();
  const fortifiedUntil = new Map<string, number>();
  const steppedHistory = new Map<string, Set<string>[]>();
  const attrition = opts.attrition;
  const quit = new Set<string>();
  const everHeld = new Set<string>();
  const lastLostToOther = new Map<string, number>();
  let walkerCapRefusals = 0;
  let fortifyPurchases = 0;
  let fortifySpend = 0;
  let turnover = 0;
  let grieferLostHonest = 0;
  const sessionsTotal = { farmer: 0, honest: 0 };
  const sessionsUnscored = { farmer: 0, honest: 0 };
  const playing = emptyByProfile<[number, number, number]>(() => [0, 0, 0]);

  // Store: the ledger's states, never the decayed copies (decay stays lazy).
  let store = new Map<string, UnitState>(world.units.map((u) => [u.id, newUnit(u.id, 0)]));
  const memberships: Membership[] = players.filter((p) => p.initialClub !== null).map((p) => ({ walkerId: p.id, clubId: p.initialClub!, fromDay: 0, toDay: null }));

  // Per-player and per-unit bookkeeping the simulator keeps between model calls.
  const activeHistory = new Map<string, boolean[]>(players.map((p) => [p.id, []]));
  const awayLeft = new Map<string, number>(players.map((p) => [p.id, R.awayDays.perSeason]));
  const wallet = new Map<string, number>(players.map((p) => [p.id, 0]));
  type Meta = { holder: string | null; heldSince: number; visits: number[]; lastLevel: LandLevel; snapshot: { former: string; level: LandLevel; day: number } | null };
  const meta = new Map<string, Meta>(world.units.map((u) => [u.id, { holder: null, heldSince: 0, visits: [], lastLevel: 1, snapshot: null }]));
  const lastReinforceCounted = new Map<string, number>();

  // Metrics.
  const retention = emptyByProfile<[number, number, number]>(() => [0, 0, 0]);
  const profileCount = emptyByProfile(() => 0);
  for (const p of players) profileCount[p.profile] += 1;
  let flips = 0;
  const flipsByProfile = emptyByProfile(() => 0);
  let heldUnitDays = 0;
  let casualLostFlip = 0;
  let casualLostDecay = 0;
  let clubMatePushes = 0;
  let rejectedEvents = 0;
  let dailyLimitViolations = 0;
  let dailyLimitRefusals = 0;
  let retriesSent = 0;
  let retriesSkipped = 0;
  let daysRefused = 0;
  let identityFailures = 0;
  let upkeepTaken = 0;
  let upkeepInCondition = 0;
  let simLevelSpend = 0;
  let conditionDecays = 0;
  let conditionLosses = 0;
  let levelUps = 0;
  let restores = 0;
  let levelLaunders = 0;
  let awayUsed = 0;
  let awayUsedCasual = 0;
  let switches = 0;
  let shieldSwitches = 0;
  let kingmakerDays = 0;
  let immuneDropped = 0;
  let shieldLost = 0;
  let colluderFlips = 0;
  let shadePushes = 0;
  let shadeRejected = 0;
  let shadeFarmerUpkeep = 0;
  const activeDays = new Map<string, number>(players.map((p) => [p.id, 0]));
  const score = { naive: new Map<string, number>(), changed: new Map<string, number>(), pilot: new Map<string, number>() };
  const clubPilotScore = new Map<string, number>();
  const controlStats = controlVariants.map(() => ({ controlled: 0, changes: 0, byClub: new Map<string, number>(), last: new Map<string, string | null>() }));
  const seasonDays: SeasonDay[] = [];
  const creditDays: CreditsDayResult[] = [];
  const recentAttacks = new Map<string, { day: number; clubId: string }[]>();

  let prevClose: HoldingsAtClose | null = null;
  let prevDayShare = 0;
  let prevEvents: PushEvent[] = [];
  let prevApplied: string[] = [];

  for (let day = 0; day < days; day++) {
    let snapshot = clubSnapshot(memberships, day);
    const startStates = prevClose ? prevClose.states : store;
    const holderAtStart = (id: string) => startStates.get(id)?.holderId ?? null;
    const heldByOthers = (pid: string) => (id: string) => {
      const h = holderAtStart(id);
      return h !== null && h !== pid;
    };

    /* sessions */
    const sessionsByPlayer = new Map<string, SessionInput[]>();
    const planned: { pid: string; sIdx: number; s: PlannedSession }[] = [];
    for (const p of players) {
      const b = BEHAVIOUR[p.profile];
      const g = keyed(seed, "day", day, p.id);
      const onVacation = p.vacationStart !== null && day >= p.vacationStart && day < p.vacationStart + 7;
      const active = !quit.has(p.id) && !onVacation && g() < b.pActive;
      activeHistory.get(p.id)!.push(active);
      if (!active) continue;
      activeDays.set(p.id, activeDays.get(p.id)! + 1);
      const list: PlannedSession[] = [];
      const n = b.sessions(g);
      for (let s = 0; s < n; s++) list.push(planSession(world, R, p, b, g, day, heldByOthers(p.id)));
      if (p.profile === "colluder") {
        // Flip-trading: step on up to three units club-mates hold, nearest home first.
        const mates = new Set(snapshot.clubs.find((c) => c.clubId === snapshot.clubOf.get(p.id))?.walkerIds ?? []);
        mates.delete(p.id);
        const targets = world.units
          .filter((u) => {
            const h = holderAtStart(u.id);
            return h !== null && mates.has(h);
          })
          .sort((a, c) => hexDistance(a.q, a.r, p.homeQ, p.homeR) - hexDistance(c.q, c.r, p.homeQ, p.homeR) || byString(a.id, c.id))
          .slice(0, 3)
          .map((u) => u.id);
        if (targets.length > 0) list.push({ minutes: 12, meters: 960, stepped: targets, enclosed: [], shade: null, loopRejected: false });
      }
      list.forEach((s, sIdx) => planned.push({ pid: p.id, sIdx, s }));
      let unscored: boolean[] | null = null;
      if (C !== undefined && C.repeatRouteUnscoredDays !== null) {
        // Repeat-route lever: unscored when every stepped unit was stepped on by this walker on each of the previous N days.
        const n = C.repeatRouteUnscoredDays;
        const hist = steppedHistory.get(p.id) ?? [];
        const last = hist.slice(-n);
        unscored = list.map((s) => last.length === n && s.stepped.length > 0 && s.stepped.every((u) => last.every((d) => d.has(u))));
        const kind = p.profile === "route_farmer" ? "farmer" : p.profile === "casual" || p.profile === "regular" || p.profile === "heavy" ? "honest" : null;
        if (kind) {
          sessionsTotal[kind] += list.length;
          sessionsUnscored[kind] += unscored.filter(Boolean).length;
        }
      }
      sessionsByPlayer.set(
        p.id,
        list.map((s, i) => (unscored?.[i] ? { minutes: s.minutes, meters: s.meters, crossedCells: s.stepped, unscored: true } : { minutes: s.minutes, meters: s.meters, crossedCells: s.stepped })),
      );
    }

    if (C !== undefined && C.repeatRouteUnscoredDays !== null) {
      const today = new Map<string, Set<string>>();
      for (const x of planned) {
        const set = today.get(x.pid) ?? new Set<string>();
        for (const u of x.s.stepped) set.add(u);
        today.set(x.pid, set);
      }
      for (const p of players) {
        const hist = steppedHistory.get(p.id) ?? [];
        hist.push(today.get(p.id) ?? new Set());
        if (hist.length > C.repeatRouteUnscoredDays) hist.shift();
        steppedHistory.set(p.id, hist);
      }
    }

    /* events, in a seeded session order */
    const order = planned
      .map((x) => ({ ...x, key: hash32(`${seed}:order:${day}:${x.pid}:${x.sIdx}`) }))
      .sort((a, b) => a.key - b.key || byString(a.pid, b.pid) || a.sIdx - b.sIdx);
    const events: PushEvent[] = [];
    const takenToday = new Map<string, Set<string>>();
    order.forEach((x, rank) => {
      const base = `d${pad(day, 3)}:${pad(rank, 5)}:${x.pid}:${pad(x.sIdx, 2)}`;
      if (x.s.loopRejected) shadeRejected += 1;
      const push = (unit: string, k: number, p: Push) => {
        if (R.clubMateErosion === "immune") {
          // D23 immunity, applied before the ledger on the day's opening holder.
          const h = holderAtStart(unit);
          const mine = snapshot.clubOf.get(x.pid);
          if (h !== null && h !== x.pid && mine !== undefined && snapshot.clubOf.get(h) === mine) {
            immuneDropped += 1;
            return;
          }
        }
        if (C !== undefined && C.walkerTakeCap !== null) {
          // Walker take cap, applied before the ledger on the day's opening holder.
          const h = holderAtStart(unit);
          if (h !== null && h !== x.pid) {
            const set = takenToday.get(x.pid) ?? new Set<string>();
            takenToday.set(x.pid, set);
            if (!set.has(unit)) {
              if (set.size >= C.walkerTakeCap) {
                walkerCapRefusals += 1;
                return;
              }
              set.add(unit);
            }
          }
        }
        events.push({ eventId: `${base}:${pad(k, 3)}`, unitId: unit, walkerId: x.pid, push: p, day });
      };
      x.s.stepped.forEach((u, k) => push(u, k, { kind: "solid" }));
      if (x.s.shade !== null && Math.floor(x.s.shade) >= 1) {
        const stepped = new Set(x.s.stepped);
        x.s.enclosed.forEach((u, k) => {
          if (stepped.has(u)) return;
          shadePushes += 1;
          push(u, 500 + k, { kind: "shade", strength: x.s.shade! });
        });
      }
    });
    // Retries of yesterday's uploads: the ledger must skip every one.
    const rg = keyed(seed, "retry", day);
    const retries = prevEvents.filter(() => rg() < retryShare);
    retriesSent += retries.length;

    /* the ledger */
    const ledger = applyLedger({ states: store, events: [...events, ...retries], rules: H, appliedEventIds: prevApplied });
    for (const res of ledger.results) {
      if (res.status === "rejected") rejectedEvents += 1;
      if (res.status === "skipped") retriesSkipped += 1;
    }
    store = ledger.states;
    const entries = ledger.entries;
    prevEvents = events;
    prevApplied = entries.map((e) => e.eventId);

    const pushedToday = new Set<string>();
    for (const e of entries) {
      if (e.outcome === "refused_daily_limit") dailyLimitRefusals += 1;
      if ((e.outcome === "eroded" || e.outcome === "flipped") && e.previousHolderId !== e.walkerId) {
        const k = `${e.walkerId}\u0000${e.unitId}`;
        if (pushedToday.has(k)) dailyLimitViolations += 1;
        pushedToday.add(k);
      }
      if (e.outcome === "flipped" && e.previousHolderId !== null && e.previousHolderId !== e.walkerId) {
        flips += 1;
        flipsByProfile[playerById.get(e.walkerId)!.profile] += 1;
        if (playerById.get(e.previousHolderId)?.profile === "casual") casualLostFlip += 1;
        const prevP = playerById.get(e.previousHolderId);
        if (prevP?.profile === "switcher" && prevP.strategy === "shield") shieldLost += 1;
        if (playerById.get(e.walkerId)?.profile === "colluder") colluderFlips += 1;
        lastLostToOther.set(e.previousHolderId, day);
        if (playerById.get(e.walkerId)?.profile === "griefer" && (prevP?.profile === "casual" || prevP?.profile === "regular")) grieferLostHonest += 1;
      }
      if ((e.outcome === "flipped" || e.outcome === "eroded") && e.previousHolderId !== null && e.previousHolderId !== e.walkerId) {
        const club = snapshot.clubOf.get(e.walkerId);
        if (club !== undefined) {
          const list = recentAttacks.get(e.previousHolderId) ?? [];
          list.push({ day, clubId: club });
          recentAttacks.set(e.previousHolderId, list);
        }
      }
    }

    /* levels and D16, between the ledger and day close */
    const pre = holdingsAtDayClose({ day, states: store, entries, holdingRules: H, zoneOf, shadeCountsAsHeld: R.shadeCountsAsHeld });
    const visitedToday = new Set<string>();
    for (const e of entries) if (e.pushKind === "solid" && e.newHolderId === e.walkerId) visitedToday.add(`${e.walkerId}\u0000${e.unitId}`);
    for (const u of world.units) {
      const m = meta.get(u.id)!;
      const s = pre.states.get(u.id)!;
      const y = s.holderId;
      if (y !== m.holder) {
        if (m.holder !== null) turnover += 1;
        const old = m.snapshot;
        if (m.holder !== null) {
          if (y === null && playerById.get(m.holder)?.profile === "casual") casualLostDecay += 1;
          m.snapshot = { former: m.holder, level: m.lastLevel, day };
        }
        if (y !== null && !zoned) {
          let level: LandLevel = 1;
          if (R.levelOnLoss.reclaimRestoreDays > 0 && old && old.former === y && day - old.day <= R.levelOnLoss.reclaimRestoreDays) {
            level = old.level;
            if (level > 1) restores += 1;
          } else if (R.levelOnLoss.newHolder === "drop_two" && m.holder !== null) {
            level = Math.max(1, m.lastLevel - 2) as LandLevel;
            const a = playerById.get(y);
            const b2 = playerById.get(m.holder);
            if (level > 1 && a && b2 && snapshot.clubOf.get(a.id) !== undefined && snapshot.clubOf.get(a.id) === snapshot.clubOf.get(b2.id)) levelLaunders += 1;
          }
          const raw = store.get(u.id)!;
          if (raw.holderId === y && raw.level !== level) store.set(u.id, { ...raw, level });
        }
        m.holder = y;
        m.heldSince = day;
        m.visits = [];
      }
      if (y !== null && visitedToday.has(`${y}\u0000${u.id}`)) m.visits.push(day);
      if (!zoned && R.levels.enabled && y !== null && prevDayShare > 0) {
        const raw = store.get(u.id)!;
        if (raw.holderId === y) {
          const recent = m.visits.filter((d) => day - d < R.levels.camp.windowDays).length;
          const cash = wallet.get(y)!;
          if (raw.level === 1 && recent >= R.levels.camp.visits && cash >= R.levels.camp.costDayShares * prevDayShare) {
            const cost = Math.floor(R.levels.camp.costDayShares * prevDayShare);
            wallet.set(y, cash - cost);
            simLevelSpend += cost;
            levelUps += 1;
            store.set(u.id, { ...raw, level: 2 });
          } else if (raw.level === 2 && day - m.heldSince >= R.levels.holding.heldDays && cash >= R.levels.holding.costDayShares * prevDayShare) {
            const cost = Math.floor(R.levels.holding.costDayShares * prevDayShare);
            wallet.set(y, cash - cost);
            simLevelSpend += cost;
            levelUps += 1;
            store.set(u.id, { ...raw, level: 3 });
          }
        }
      }
      m.lastLevel = (store.get(u.id)!.holderId === y && y !== null ? store.get(u.id)!.level : 1) as LandLevel;
    }

    // Zone visits: a stepped-on push by a walker on any unit of a zone (as settlement counts them).
    const zoneVisitedToday = new Set<string>();
    if (C !== undefined) for (const e of entries) if (e.pushKind === "solid") zoneVisitedToday.add(hk(e.walkerId, zoneOf(e.unitId)));
    if (zoned) {
      // D5 zones: one level per holder and zone (section 9 prices are per zone), so a
      // holder's units in a zone never disagree, which the G3 model would refuse.
      const groups = new Map<string, string[]>();
      for (const [id, st] of pre.states) {
        if (st.holderId === null) continue;
        const key = hk(st.holderId, zoneOf(id));
        const list = groups.get(key) ?? [];
        list.push(id);
        groups.set(key, list);
      }
      for (const [key, zm] of zoneMeta) {
        if (groups.has(key)) continue;
        if (zm.level > 1) zoneSnapshot.set(key, { level: zm.level, day });
        zoneMeta.delete(key);
      }
      for (const key of [...groups.keys()].sort(byString)) {
        let zm = zoneMeta.get(key);
        if (!zm) {
          // D16 per zone: the former holder's level comes back on a reclaim within the restore window.
          const snap = zoneSnapshot.get(key);
          let level: LandLevel = 1;
          if (snap && R.levelOnLoss.reclaimRestoreDays > 0 && day - snap.day <= R.levelOnLoss.reclaimRestoreDays) {
            level = snap.level;
            restores += 1;
          }
          zoneSnapshot.delete(key);
          zm = { since: day, visits: [], level };
          zoneMeta.set(key, zm);
        }
        if (zoneVisitedToday.has(key)) zm.visits.push(day);
        zm.visits = zm.visits.filter((d) => day - d < R.levels.camp.windowDays);
        const holder = key.slice(0, key.indexOf("\u0000"));
        if (R.levels.enabled && prevDayShare > 0) {
          const cash = wallet.get(holder)!;
          if (zm.level === 1 && zm.visits.length >= R.levels.camp.visits && cash >= R.levels.camp.costDayShares * prevDayShare) {
            const cost = Math.floor(R.levels.camp.costDayShares * prevDayShare);
            wallet.set(holder, cash - cost);
            simLevelSpend += cost;
            levelUps += 1;
            zm.level = 2;
          } else if (zm.level === 2 && day - zm.since >= R.levels.holding.heldDays && cash >= R.levels.holding.costDayShares * prevDayShare) {
            const cost = Math.floor(R.levels.holding.costDayShares * prevDayShare);
            wallet.set(holder, cash - cost);
            simLevelSpend += cost;
            levelUps += 1;
            zm.level = 3;
          }
        }
        for (const id of groups.get(key)!) {
          const raw = store.get(id)!;
          if (raw.holderId === holder && raw.level !== zm.level) store.set(id, { ...raw, level: zm.level });
        }
      }
    }

    /* day close and credits */
    const close = holdingsAtDayClose({ day, states: store, entries, holdingRules: H, zoneOf, shadeCountsAsHeld: R.shadeCountsAsHeld });
    const rows: CreditsPlayerInput[] = [];
    for (const p of players) {
      const sessions = sessionsByPlayer.get(p.id);
      if (sessions) {
        const hist = activeHistory.get(p.id)!;
        const week = hist.slice(-7).filter(Boolean).length;
        rows.push({ playerId: p.id, sessions, activeDaysThisWeek: Math.max(1, Math.min(7, week)), trustWeight: 1, kitLevel: 1 });
      }
    }
    // D17: away days are only spent on an absent day by a player holding a counted zone.
    const listed = new Set(rows.map((r) => r.playerId));
    for (const h of close.holders) {
      if (listed.has(h.playerId) || R.awayDays.mode === "none") continue;
      const left = awayLeft.get(h.playerId)!;
      if (left <= 0) continue;
      const p = playerById.get(h.playerId)!;
      const onVacation = p.vacationStart !== null && day >= p.vacationStart && day < p.vacationStart + 7;
      const use = R.awayDays.mode === "auto" || onVacation || keyed(seed, "away", day, p.id)() < BEHAVIOUR[p.profile].rememberAway;
      if (!use) continue;
      awayLeft.set(h.playerId, left - 1);
      awayUsed += 1;
      if (p.profile === "casual") awayUsedCasual += 1;
      rows.push({ playerId: h.playerId, sessions: [], activeDaysThisWeek: 1, trustWeight: 0, kitLevel: 1, awayProtected: true });
    }
    const credits = settleCreditsDay({ rulesVersion: R.economyRulesVersion, season: R.season, day, players: rows, holdings: close });
    creditDays.push(credits);
    if (credits.status !== "settled") {
      daysRefused += 1;
    } else {
      const b = credits.settlement.books;
      if (b.mintedMicro + b.returnedToSeasonPoolMicro !== b.poolMicro) identityFailures += 1;
      if (b.creditedMicro + b.tollPaidMicro + b.burnedMicro !== b.mintedMicro) identityFailures += 1;
      if (b.tollPaidMicro !== b.tollReceivedMicro) identityFailures += 1;
      const net = credits.lines.reduce((a, l) => a + l.netMicro, 0);
      if (net !== b.creditedMicro + b.tollReceivedMicro) identityFailures += 1;
      prevDayShare = credits.settlement.dayShareMicro;
      for (const l of credits.lines) {
        wallet.set(l.playerId, (wallet.get(l.playerId) ?? 0) + l.netMicro);
        upkeepTaken += l.upkeepTakenMicro;
        upkeepInCondition += l.upkeepPaidInConditionMicro;
        if (playerById.get(l.playerId)?.profile === "shade_farmer") shadeFarmerUpkeep += l.upkeepTakenMicro;
      }
      /* D14: unpaid upkeep acts on the charged unvisited ground, after settlement, for tomorrow. */
      if (R.upkeepCondition !== "none") {
        // With D5 zones, a charged zone stands for the holder's units in it; its strength is its strongest unit's.
        const unitsOfZone = new Map<string, string[]>();
        if (zoned) for (const h of close.holders) for (const z of h.zones) unitsOfZone.set(hk(h.playerId, z.zoneId), z.unitIds);
        for (const l of credits.lines) {
          if (l.upkeepPaidInConditionMicro <= 0 || l.unvisitedZoneIds.length === 0) continue;
          const owed = l.upkeepTakenMicro + l.upkeepPaidInConditionMicro;
          const n = l.unvisitedZoneIds.length;
          const k = R.upkeepCondition === "all_unvisited" ? n : Math.min(n, Math.ceil((l.upkeepPaidInConditionMicro * n) / owed));
          const dir = R.upkeepCondition === "proportional_weakest_first" ? 1 : -1;
          const unitsOf = (zone: string) => (zoned ? unitsOfZone.get(hk(l.playerId, zone)) ?? [] : [zone]);
          const zoneStrength = (zone: string) => Math.max(0, ...unitsOf(zone).map((id) => close.states.get(id)!.strength));
          const chosen = [...l.unvisitedZoneIds]
            .sort((a, c) => dir * (zoneStrength(a) - zoneStrength(c)) || byString(a, c))
            .slice(0, k);
          for (const id of chosen.flatMap(unitsOf)) {
            const s = close.states.get(id)!;
            if (s.holderId !== l.playerId || s.deeded) continue;
            const perDay = H.solidDecayPerDay * (s.ground === "shade" ? H.shadeDecayMultiplier : 1) * (1 - decayResist(s.level, s.fortified));
            const extra = Math.floor(perDay);
            if (extra <= 0) continue;
            conditionDecays += 1;
            const strength = s.strength - extra;
            const next: UnitState =
              strength <= 0 ? { ...withoutTakeoverMarks(s), holderId: null, strength: 0, ground: "solid", level: 1, fortified: false } : { ...s, strength };
            if (strength <= 0) conditionLosses += 1;
            if (unitProblems(next).length === 0) store.set(id, next);
          }
        }
      }
    }

    /* churn study: fortify purchases (D9) and owner defence set tomorrow's fortified flags */
    if (C !== undefined && (C.fortify !== null || C.homeDefenceDays !== null)) {
      for (const key of zoneVisitedToday) {
        lastZoneVisit.set(key, day);
        if (C.fortify !== null) {
          const list = (zoneVisitDays.get(key) ?? []).filter((d) => day - d < C.fortify!.windowDays);
          list.push(day);
          zoneVisitDays.set(key, list);
        }
      }
      const heldKeys = new Set<string>();
      for (const [id, st] of close.states) if (st.holderId !== null) heldKeys.add(hk(st.holderId, zoneOf(id)));
      if (C.fortify !== null && prevDayShare > 0) {
        const f = C.fortify;
        for (const key of [...zoneVisitedToday].sort(byString)) {
          if (!heldKeys.has(key) || (fortifiedUntil.get(key) ?? -1) > day) continue;
          if ((zoneVisitDays.get(key)?.length ?? 0) < f.minVisits) continue;
          const holder = key.slice(0, key.indexOf("\u0000"));
          const cost = Math.floor(f.costDayShares * prevDayShare);
          const cash = wallet.get(holder) ?? 0;
          if (cash < cost) continue;
          wallet.set(holder, cash - cost);
          fortifySpend += cost;
          fortifyPurchases += 1;
          fortifiedUntil.set(key, day + f.durationDays);
        }
      }
      for (const [id, raw] of store) {
        if (raw.holderId === null) continue;
        const key = hk(raw.holderId, zoneOf(id));
        const bought = (fortifiedUntil.get(key) ?? -1) > day;
        const seen = lastZoneVisit.get(key);
        const home = C.homeDefenceDays !== null && seen !== undefined && day + 1 - seen <= C.homeDefenceDays;
        const want = bought || home;
        if (raw.fortified !== want) store.set(id, { ...raw, fortified: want });
      }
    }

    /* clubs: switching decisions, then contributions and control */
    const pilotRule = R.control;
    const before = districtControl({ holdings: close, snapshot, districtOf, rule: pilotRule });
    const changed = decideSwitches(players, snapshot, before, close, world, pilotRule, day, recentAttacks);
    for (const c of changed) {
      const eff = R.clubs.changeEffective === "same_day" ? day : day + 1;
      const span = memberships.find((m) => m.walkerId === c.pid && m.toDay === null);
      if (span && span.clubId === c.clubId) continue;
      if (span && span.fromDay === eff) span.clubId = c.clubId;
      else {
        if (span) span.toDay = eff;
        memberships.push({ walkerId: c.pid, clubId: c.clubId, fromDay: eff, toDay: null });
      }
      switches += 1;
      if (c.shield) shieldSwitches += 1;
    }
    if (changed.length > 0 && R.clubs.changeEffective === "same_day") snapshot = clubSnapshot(memberships, day);
    const controls: DistrictControlResult[] = controlVariants.map((v) => districtControl({ holdings: close, snapshot, districtOf, rule: v.rule }));
    controls.forEach((res, i) => {
      const st = controlStats[i]!;
      for (const d of res.districts) {
        if (d.controllerClubId !== null) {
          st.controlled += 1;
          st.byClub.set(d.controllerClubId, (st.byClub.get(d.controllerClubId) ?? 0) + 1);
        }
        const last = st.last.get(d.districtId);
        if (last !== undefined && last !== d.controllerClubId) st.changes += 1;
        st.last.set(d.districtId, d.controllerClubId);
      }
    });
    kingmakerDays += kingmakerCount(players, snapshot, controls[0]!, close, world, pilotRule);

    const contrib = clubContributions({ day, entries, snapshot, holdingRulesVersion: H.rulesVersion });
    for (const club of contrib.clubs) {
      clubMatePushes += club.totals.onClubMateGround;
      for (const m of club.members) {
        const all = Object.values(m.byOutcome).reduce((a, b) => a + b, 0);
        score.naive.set(m.walkerId, (score.naive.get(m.walkerId) ?? 0) + all);
        score.changed.set(m.walkerId, (score.changed.get(m.walkerId) ?? 0) + m.solid + m.shade);
      }
    }
    // Unclubbed walkers, for the profile comparison: the same counts straight from the entries.
    for (const e of entries) {
      if (snapshot.clubOf.has(e.walkerId)) continue;
      score.naive.set(e.walkerId, (score.naive.get(e.walkerId) ?? 0) + 1);
      if (["claimed", "reinforced", "eroded", "flipped"].includes(e.outcome)) score.changed.set(e.walkerId, (score.changed.get(e.walkerId) ?? 0) + 1);
    }
    for (const [walker, v] of pilotContributions(entries, snapshot, R, day, lastReinforceCounted)) {
      score.pilot.set(walker, (score.pilot.get(walker) ?? 0) + v);
      const club = snapshot.clubOf.get(walker);
      if (club !== undefined) clubPilotScore.set(club, (clubPilotScore.get(club) ?? 0) + v);
    }

    seasonDays.push({ credits, snapshot, districts: controls[0]! });

    /* retention and holding counts */
    let heldNow = 0;
    for (const s of close.states.values()) if (s.holderId !== null) heldNow += 1;
    heldUnitDays += heldNow;
    const checkpoint = [29, 59, 89].indexOf(day);
    if (checkpoint >= 0) {
      const holders = new Set<string>();
      for (const s of close.states.values()) if (s.holderId !== null) holders.add(s.holderId);
      for (const p of players) if (holders.has(p.id)) retention[p.profile][checkpoint] += 1;
    }
    if (attrition !== undefined) {
      const holders = new Set<string>();
      for (const s of close.states.values()) if (s.holderId !== null) holders.add(s.holderId);
      for (const p of players) {
        if (holders.has(p.id)) everHeld.add(p.id);
        else if (!quit.has(p.id) && everHeld.has(p.id)) {
          const lost = lastLostToOther.get(p.id);
          const chance = attrition.quitChance[p.profile] ?? 0;
          if (lost !== undefined && day - lost < attrition.lookbackDays && chance > 0 && keyed(seed, "quit", day, p.id)() < chance) quit.add(p.id);
        }
      }
    }
    if (checkpoint >= 0) for (const p of players) if (!quit.has(p.id)) playing[p.profile][checkpoint] += 1;
    prevClose = holdingsAtDayClose({ day, states: store, entries, holdingRules: H, zoneOf, shadeCountsAsHeld: R.shadeCountsAsHeld });
  }

  for (const p of PROFILES) retention[p] = retention[p].map((v) => (profileCount[p] ? v / profileCount[p] : 0)) as [number, number, number];
  for (const p of PROFILES) playing[p] = playing[p].map((v) => (profileCount[p] ? v / profileCount[p] : 0)) as [number, number, number];

  /* season */
  const season = settleCreditsSeason(R.economyRulesVersion, R.season, creditDays);
  const net = new Map<string, number>(players.map((p) => [p.id, 0]));
  if (season.status === "settled") for (const r of season.byPlayer) net.set(r.playerId, r.netMicro);
  const meanNetByProfile = emptyByProfile(() => 0);
  for (const p of players) meanNetByProfile[p.profile] += net.get(p.id)! / profileCount[p.profile];

  const finalStates = prevClose!.states;
  const unitsHeldAtEnd = emptyByProfile(() => 0);
  const casualStages = { pilot: {} as Record<string, number>, alt: {} as Record<string, number> };
  const altRules: HoldingRules = { ...H, stageFloors: { held: 75, atRisk: 50, contested: 25 } };
  let l2plus = 0;
  let heldEnd = 0;
  let shadeHeldEnd = 0;
  let shadeFarmerShade = 0;
  let casualUnits = 0;
  for (const s of finalStates.values()) {
    if (s.holderId === null) continue;
    heldEnd += 1;
    if (s.level >= 2) l2plus += 1;
    if (s.ground === "shade") shadeHeldEnd += 1;
    const p = playerById.get(s.holderId)!;
    unitsHeldAtEnd[p.profile] += 1;
    if (p.profile === "shade_farmer" && s.ground === "shade") shadeFarmerShade += 1;
    if (p.profile === "casual") {
      casualUnits += 1;
      const a = stageOf(s, H);
      const b = stageOf(s, altRules);
      casualStages.pilot[a] = (casualStages.pilot[a] ?? 0) + 1;
      casualStages.alt[b] = (casualStages.alt[b] ?? 0) + 1;
    }
  }
  for (const k of Object.keys(casualStages.pilot)) casualStages.pilot[k] = casualStages.pilot[k]! / casualUnits;
  for (const k of Object.keys(casualStages.alt)) casualStages.alt[k] = casualStages.alt[k]! / casualUnits;
  for (const p of PROFILES) unitsHeldAtEnd[p] = profileCount[p] ? unitsHeldAtEnd[p] / profileCount[p] : 0;

  const board = (m: Map<string, number>): ContributionBoard => {
    const per = emptyByProfile(() => 0);
    const cnt = emptyByProfile(() => 0);
    for (const p of players) {
      const a = activeDays.get(p.id)!;
      if (a === 0) continue;
      per[p.profile] += (m.get(p.id) ?? 0) / a;
      cnt[p.profile] += 1;
    }
    for (const p of PROFILES) per[p] = cnt[p] ? per[p] / cnt[p] : 0;
    const reg = per.regular || 1;
    return { perActiveDayByProfile: per, routeFarmerRatio: per.route_farmer / reg, shadeFarmerRatio: per.shade_farmer / reg, colluderRatio: per.colluder / reg };
  };

  const boards = {} as SimResult["d22"];
  for (const metric of ["player_credits", "club_credits", "club_district_days"] as LeaderboardMetric[]) {
    const lb = seasonLeaderboard({ rulesVersion: R.economyRulesVersion, season: R.season, days: seasonDays, metric });
    if (lb.status !== "settled") {
      boards[metric] = { status: "refused", top: [], ties: 0, colludeRank: null, shadeRank: null };
      continue;
    }
    boards[metric] = summariseBoard(lb.rows, "settled");
  }
  boards.club_contributions = summariseBoard(rankRows(new Map([...clubPilotScore].map(([k, v]) => [k, Math.round(v * 100)]))), "settled");

  const totalDistrictDays = world.districtIds.length * days;
  const d21 = controlVariants.map((v, i): ControlVariantResult => {
    const st = controlStats[i]!;
    const top = [...st.byClub.values()].sort((a, b) => b - a)[0] ?? 0;
    return {
      label: v.label,
      controlledShare: st.controlled / totalDistrictDays,
      controlChanges: st.changes,
      shadeClubDistrictDays: st.byClub.get(SHADE_CLUB) ?? 0,
      colludeClubDistrictDays: st.byClub.get(COLLUDING_CLUB) ?? 0,
      topClubDistrictDays: top,
    };
  });

  const casualN = profileCount.casual || 1;
  const totalNet = [...net.values()].reduce((a, b) => a + Math.max(0, b), 0);
  const farmerNet = players.filter((p) => p.profile === "route_farmer").reduce((a, p) => a + Math.max(0, net.get(p.id)!), 0);
  const grieferActive = players.filter((p) => p.profile === "griefer").reduce((a, p) => a + activeDays.get(p.id)!, 0);
  const unitKm2 = ((3 * Math.sqrt(3)) / 2) * (R.unitEdgeMeters / 1000) ** 2;
  const heldAtEnd = PROFILES.reduce((a, p) => a + unitsHeldAtEnd[p] * profileCount[p], 0);
  const churn: ChurnMetrics = {
    dailyTurnoverPer100Held: heldUnitDays > 0 ? (turnover * 100) / heldUnitDays : 0,
    playing,
    grieferFlipsPerActiveDay: grieferActive > 0 ? flipsByProfile.griefer / grieferActive : 0,
    honestUnitsLostToGriefersPerPlayer: grieferLostHonest / ((profileCount.casual + profileCount.regular) || 1),
    grieferKm2PerActiveDay: (grieferActive > 0 ? flipsByProfile.griefer / grieferActive : 0) * unitKm2,
    honestKm2LostToGriefersPerPlayer: (grieferLostHonest / ((profileCount.casual + profileCount.regular) || 1)) * unitKm2,
    heavyShareOfHeldAtEnd: heldAtEnd > 0 ? (unitsHeldAtEnd.heavy * profileCount.heavy + unitsHeldAtEnd.griefer * profileCount.griefer) / heldAtEnd : 0,
    colluderHoldRatio: unitsHeldAtEnd.regular > 0 ? unitsHeldAtEnd.colluder / unitsHeldAtEnd.regular : 0,
    routeFarmerCreditShare: totalNet > 0 ? farmerNet / totalNet : 0,
    routeFarmerPlayerShare: profileCount.route_farmer / players.length,
    issuedShareOfPool: season.status === "settled" && season.poolMicro > 0 ? season.issuedMicro / season.poolMicro : 0,
    walkerCapRefusals,
    fortifyPurchases,
    fortifySpendMicro: fortifySpend,
    routeFarmerSessionsUnscored: sessionsTotal.farmer > 0 ? sessionsUnscored.farmer / sessionsTotal.farmer : 0,
    honestSessionsUnscored: sessionsTotal.honest > 0 ? sessionsUnscored.honest / sessionsTotal.honest : 0,
    zones: zoneCount,
  };
  const shielders = players.filter((p) => p.strategy === "shield").length || 1;
  const fp = hash32(
    JSON.stringify([
      [...store.entries()].sort(([a], [b]) => byString(a, b)),
      season.status === "settled" ? season.byPlayer : season.problems,
    ]),
  ).toString(16);

  return {
    ruleset: R.name,
    seed,
    days,
    units: world.units.length,
    players: players.length,
    retention,
    unitsHeldAtEnd,
    casualStages,
    takeover: {
      flipsPerDay: flips / days,
      flipsPer100HeldPerDay: heldUnitDays > 0 ? (flips * 100) / heldUnitDays : 0,
      casualLostToFlipPerPlayer: casualLostFlip / casualN,
      casualLostToDecayPerPlayer: casualLostDecay / casualN,
      clubMatePushesPerDay: clubMatePushes / days,
      flipsPerDayByWalkerProfile: Object.fromEntries(PROFILES.map((p) => [p, flipsByProfile[p] / days])) as Record<Profile, number>,
    },
    credits: { gini: gini([...net.values()]), top10Share: topShare([...net.values()], 0.1), meanNetByProfile },
    books: {
      daysSettled: creditDays.filter((d) => d.status === "settled").length,
      daysRefused,
      identityFailures,
      seasonStatus: season.status,
      poolMicro: season.status === "settled" ? season.poolMicro : 0,
      issuedMicro: season.status === "settled" ? season.issuedMicro : 0,
      returnedMicro: season.status === "settled" ? season.returnedMicro : 0,
      burnedMicro: season.status === "settled" ? season.burnedMicro : 0,
      upkeepTakenMicro: upkeepTaken,
      upkeepInConditionMicro: upkeepInCondition,
      rejectedEvents,
      retriesSent,
      retriesSkipped,
      simLevelSpendMicro: simLevelSpend,
      dailyLimitViolations,
      dailyLimitRefusals,
    },
    d14: { conditionDecays, conditionLosses },
    d16: { levelUps, restores, shareL2PlusAtEnd: heldEnd ? l2plus / heldEnd : 0, levelLaunders },
    d17: { awayDaysUsed: awayUsed, awayDaysUsedCasual: awayUsedCasual, casualProtectedDaysPerPlayer: awayUsedCasual / casualN },
    d18: { switches, kingmakerDistrictDays: kingmakerDays },
    d19: { naive: board(score.naive), changed: board(score.changed), pilot: board(score.pilot) },
    d21,
    d22: boards,
    d23: { immuneDropped, shieldUnitsLostPerShielder: shieldLost / shielders, shieldSwitches, colluderFlipsPerDay: colluderFlips / days },
    shade: { shadePushes, shadeRejectedLoops: shadeRejected, shadeUnitsHeldAtEnd: shadeHeldEnd, shadeFarmerShadeUnitsAtEnd: shadeFarmerShade, shadeFarmerUpkeepPaidMicro: shadeFarmerUpkeep },
    churn,
    fingerprint: fp,
  };
}

function summariseBoard(rows: { rank: number; id: string; score: number }[], status: string) {
  const ranks = new Map<number, number>();
  for (const r of rows) ranks.set(r.rank, (ranks.get(r.rank) ?? 0) + 1);
  const ties = [...ranks.values()].filter((n) => n > 1).reduce((a, b) => a + b, 0);
  return {
    status,
    top: rows.slice(0, 3),
    ties,
    colludeRank: rows.find((r) => r.id === COLLUDING_CLUB)?.rank ?? null,
    shadeRank: rows.find((r) => r.id === SHADE_CLUB)?.rank ?? null,
  };
}

/* ── one session's route ──────────────────────────────────────────────────── */

function planSession(w: World, R: SimRuleset, p: Player, b: Behaviour, g: () => number, day: number, heldByOthers: (id: string) => boolean): PlannedSession {
  const minutes = b.minutes[0] + (b.minutes[1] - b.minutes[0]) * g();
  const meters = minutes * b.pace;
  if (b.start === "fixed" && p.fixedRoute) return { minutes, meters, stepped: [...p.fixedRoute], enclosed: [], shade: null, loopRejected: false };
  const L = Math.max(1, Math.round(meters / w.spacingMeters));
  let sq = p.homeQ;
  let sr = p.homeR;
  if (b.start === "near") {
    const d = DIRS[Math.floor(g() * 6)]!;
    const k = Math.floor(g() * 3);
    if (inCity(w, sq + d[0] * k, sr + d[1] * k)) {
      sq += d[0] * k;
      sr += d[1] * k;
    }
  } else if (b.start === "attack") {
    const near = w.units.filter((u) => heldByOthers(u.id) && hexDistance(u.q, u.r, p.homeQ, p.homeR) <= Math.max(3, Math.round(4000 / w.spacingMeters)));
    if (near.length > 0) {
      const t = near[Math.floor(g() * near.length)]!;
      sq = t.q;
      sr = t.r;
    }
  }
  const loop = g() < b.loopP && L >= 6;
  if (!loop) {
    const prefer = b.start === "attack" ? heldByOthers : undefined;
    return { minutes, meters, stepped: randomWalk(w, sq, sr, Math.ceil(L / 2), g, prefer), enclosed: [], shade: null, loopRejected: false };
  }
  // A sealed loop. Shade farmers alternate a sparse-fix ring (A1: a unit with
  // no verified fix is not stepped on) with a thin sliver.
  const farmer = p.profile === "shade_farmer";
  const dirIdx = Math.floor(g() * 6);
  let stepped: string[];
  let enclosed: string[];
  let shape: number;
  if (farmer && day % 2 === 1) {
    const m = Math.max(2, Math.min(12, Math.floor(L / 2) - 1));
    const d = DIRS[dirIdx]!;
    const e = DIRS[(dirIdx + 2) % 6]!;
    const at = (k: number, off: number) => [sq + d[0] * k + e[0] * off, sr + d[1] * k + e[1] * off] as [number, number];
    const lineA = Array.from({ length: m + 1 }, (_, k) => at(k, 0));
    const lineB = Array.from({ length: m + 1 }, (_, k) => at(k, 2));
    const caps = [at(0, 1), at(m, 1)];
    stepped = [...lineA, ...caps, ...lineB].filter(([a, c]) => inCity(w, a, c)).map(([a, c]) => unitId(a, c));
    enclosed = Array.from({ length: m - 1 }, (_, k) => at(k + 1, 1)).filter(([a, c]) => inCity(w, a, c)).map(([a, c]) => unitId(a, c));
    shape = SHAPE.sliver;
  } else {
    const k = Math.min(Math.floor(L / 6), 10);
    const d = DIRS[dirIdx]!;
    const cq = sq - d[0] * k;
    const cr = sr - d[1] * k;
    const ringUnits = ring(cq, cr, k).filter(([a, c]) => inCity(w, a, c)).map(([a, c]) => unitId(a, c));
    stepped = farmer ? ringUnits.filter((_, i) => i % 3 === 0) : ringUnits;
    const ringSet = new Set(ringUnits);
    enclosed = disk(cq, cr, k - 1).filter(([a, c]) => inCity(w, a, c)).map(([a, c]) => unitId(a, c)).filter((id) => !ringSet.has(id));
    shape = SHAPE.ring;
  }
  stepped = [...new Set(stepped)];
  const strength = shadeStrength(R.shade, { shape, stepped: stepped.length, enclosed: enclosed.length });
  return { minutes, meters, stepped, enclosed, shade: strength, loopRejected: enclosed.length > 0 && strength === null };
}

/* ── D19: the pilot contribution score ────────────────────────────────────── */

function pilotContributions(entries: readonly LedgerEntry[], snap: ClubSnapshot, R: SimRuleset, day: number, lastReinforce: Map<string, number>): Map<string, number> {
  const c = R.contributions;
  const best = new Map<string, { walker: string; unit: string; weight: number; reinforce: boolean }>();
  const out = new Map<string, number>();
  for (const e of entries) {
    if (e.day !== day) continue;
    if (!c.shadeCounts && e.pushKind === "shade") continue;
    const prev = e.previousHolderId;
    const club = snap.clubOf.get(e.walkerId);
    const onMate = prev !== null && prev !== e.walkerId && club !== undefined && snap.clubOf.get(prev) === club;
    if (!c.clubMatePushesCount && onMate) continue;
    let weight = 0;
    let reinforce = false;
    if (e.outcome === "claimed") weight = c.weights.claimed;
    else if (e.outcome === "flipped") weight = c.weights.flipped;
    else if (e.outcome === "eroded") weight = c.weights.eroded;
    else if (e.outcome === "reinforced") {
      weight = c.weights.reinforced;
      reinforce = true;
    }
    if (weight <= 0) continue;
    const key = c.oncePerUnitPerDay ? `${e.walkerId}\u0000${e.unitId}` : e.eventId;
    const cur = best.get(key);
    if (!cur || weight > cur.weight) best.set(key, { walker: e.walkerId, unit: e.unitId, weight, reinforce });
  }
  for (const v of [...best.values()].sort((a, b) => byString(a.walker, b.walker) || byString(a.unit, b.unit))) {
    if (v.reinforce) {
      const k = `${v.walker}\u0000${v.unit}`;
      const last = lastReinforce.get(k);
      if (last !== undefined && day - last < c.reinforceCooldownDays) continue;
      lastReinforce.set(k, day);
    }
    out.set(v.walker, (out.get(v.walker) ?? 0) + v.weight);
  }
  return out;
}

/* ── D18 and D23: club switchers ──────────────────────────────────────────── */

function weightsByDistrict(pid: string, close: HoldingsAtClose, w: World, rule: DistrictControlRule): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, s] of close.states) {
    if (s.holderId !== pid) continue;
    const d = w.byId.get(id)!.districtId;
    out.set(d, (out.get(d) ?? 0) + (s.ground === "shade" ? rule.shadeWeight.numerator : rule.shadeWeight.denominator));
  }
  return out;
}

function controls(clubW: number, otherBest: number, heldW: number, rule: DistrictControlRule): boolean {
  return clubW > otherBest && clubW * rule.minShare.denominator >= rule.minShare.numerator * heldW;
}

function decideSwitches(
  players: readonly Player[],
  snap: ClubSnapshot,
  standing: DistrictControlResult,
  close: HoldingsAtClose,
  w: World,
  rule: DistrictControlRule,
  day: number,
  attacks: Map<string, { day: number; clubId: string }[]>,
): { pid: string; clubId: string; shield: boolean }[] {
  const out: { pid: string; clubId: string; shield: boolean }[] = [];
  if (standing.problems.length > 0) return out;
  const clubs = snap.clubs.map((c) => c.clubId).filter((c) => c !== COLLUDING_CLUB && c !== SHADE_CLUB);
  for (const p of players) {
    if (p.profile !== "switcher") continue;
    const current = snap.clubOf.get(p.id);
    if (p.strategy === "shield") {
      const recent = (attacks.get(p.id) ?? []).filter((a) => day - a.day < 3 && a.clubId !== current);
      if (recent.length === 0) continue;
      const counts = new Map<string, number>();
      for (const a of recent) counts.set(a.clubId, (counts.get(a.clubId) ?? 0) + 1);
      const target = [...counts].sort(([a, x], [b, y]) => y - x || byString(a, b))[0]![0];
      out.push({ pid: p.id, clubId: target, shield: true });
      continue;
    }
    if (day % 7 !== 6) continue;
    const mine = weightsByDistrict(p.id, close, w, rule);
    let best: { club: string; gain: number } | null = null;
    for (const k of clubs) {
      let gain = 0;
      for (const d of standing.districts) {
        const sw = mine.get(d.districtId) ?? 0;
        if (sw === 0 || d.controllerClubId === k) continue;
        const kw = (d.clubs.find((c) => c.clubId === k)?.weight ?? 0) + (current === k ? 0 : sw);
        const other = Math.max(0, ...d.clubs.filter((c) => c.clubId !== k).map((c) => c.weight - (c.clubId === current ? sw : 0)));
        if (controls(kw, other, d.held.weight, rule)) gain += 1;
      }
      if (gain > 0 && (!best || gain > best.gain || (gain === best.gain && byString(k, best.club) < 0))) best = { club: k, gain };
    }
    if (best && best.club !== current) out.push({ pid: p.id, clubId: best.club, shield: false });
  }
  return out;
}

/** District-days a club controls only because of the kingmaker switchers in it that day. */
function kingmakerCount(players: readonly Player[], snap: ClubSnapshot, res: DistrictControlResult, close: HoldingsAtClose, w: World, rule: DistrictControlRule): number {
  if (res.problems.length > 0) return 0;
  const kings = players.filter((p) => p.strategy === "kingmaker" && snap.clubOf.has(p.id));
  if (kings.length === 0) return 0;
  const weights = new Map(kings.map((p) => [p.id, weightsByDistrict(p.id, close, w, rule)]));
  let n = 0;
  for (const d of res.districts) {
    if (d.controllerClubId === null) continue;
    const sw = kings.filter((p) => snap.clubOf.get(p.id) === d.controllerClubId).reduce((a, p) => a + (weights.get(p.id)!.get(d.districtId) ?? 0), 0);
    if (sw === 0) continue;
    const first = d.clubs.find((c) => c.clubId === d.controllerClubId)!.weight - sw;
    const other = Math.max(0, ...d.clubs.filter((c) => c.clubId !== d.controllerClubId).map((c) => c.weight));
    if (!controls(first, other, d.held.weight, rule)) n += 1;
  }
  return n;
}
