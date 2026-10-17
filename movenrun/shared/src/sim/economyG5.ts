/**
 * G5–G7 economy research: an off-chain model of deed issuance and transfer,
 * credits-to-token conversion options, emission and sink projections, and
 * Sybil break-even arithmetic, run over the season simulator's per-day trace.
 *
 * SIMULATION_ONLY_NOT_PRODUCTION. Nothing here is a token, a balance, a deed
 * or a price. It mints nothing, signs nothing and talks to no chain. The V3
 * numbers are read from `economyRulesFor` and never changed; every value that
 * is not in the V3 source is a labelled research parameter. Prices are in
 * "cost units": the same unit as the attacker's cost per account-day, so no
 * currency or market value is implied.
 *
 * What the source fixes (SOURCE §n, from docs/GAME_ECONOMY_V3.md):
 *   §12 deed: 21 days tenure, 30 distinct verified people across 10 days
 *       (HYPOTHESIS), no related cluster above 20%, own and linked traffic never
 *       counts, solid only (FIXED), per-city cap "a published share" (value open)
 *   §17 pool: 9M in season 1, −10% a season, floor 2M, 400M player allocation
 *   §20 toll: 2% of a session's reward × share of deeded cells of others crossed
 *   §21 locked until first deed; tolls received are liquid; revenue valve;
 *       legal fallback: deed holders stay locked too
 *   §22 sinks: all burned; a burn never frees room to issue more
 */

import { dailyPoolMicro, economyRulesFor, seasonPoolMicro, type EconomyRules } from "../domain/economyV3";
import { SIM_ONLY } from "./pilotRuleset";
import { gini, topShare } from "./simulate";
import type { SeasonTrace } from "./trace";
import { COLLUDING_CLUB, PROFILES, type Profile } from "./world";

export const G5_STATUS = SIM_ONLY;

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/* ── related accounts ─────────────────────────────────────────────────────── */

/**
 * Who counts as "related" (§12 risk graph, D6 open). Research default: the
 * simulator's colluding club is one related cluster (its ground truth); every
 * other player is their own cluster. A real risk graph would be noisier.
 */
export function groundTruthClusters(trace: SeasonTrace): (playerId: string) => string {
  const m = new Map<string, string>();
  for (const p of trace.players) m.set(p.id, p.club === COLLUDING_CLUB ? `cluster:${COLLUDING_CLUB}` : `cluster:${p.id}`);
  return (id) => m.get(id) ?? `cluster:${id}`;
}

/* ── deeds: off-chain eligibility and issuance ────────────────────────────── */

export interface DeedRules {
  label: string;
  /** SOURCE §12 HYPOTHESIS: 21 consecutive days held. */
  tenureDays: number;
  /** SOURCE §12 HYPOTHESIS: 30 distinct verified people. */
  distinctCrossers: number;
  /** SOURCE §12 HYPOTHESIS: across 10 different days. */
  trafficDays: number;
  /** SOURCE §12: no related cluster above 20% of the counted traffic. */
  maxClusterShare: number;
  /** D6 (open): deeds as a share of the city's units, the source's "published share" read city-wide. Null: no cap. */
  cityCapShare: number | null;
  /** The prototype contract's reading (`feat/v3-onchain-core`): most deeds one holder may hold in a city. Null: no cap. */
  perHolderCap: number | null;
}

export const DEED_RULES_SOURCE: Readonly<DeedRules> = Object.freeze({
  label: "source §12",
  tenureDays: 21,
  distinctCrossers: 30,
  trafficDays: 10,
  maxClusterShare: 0.2,
  cityCapShare: null,
  perHolderCap: null,
});

export interface Deed {
  unitId: string;
  holderId: string;
  /** Day the deed would be claimed (the first day every condition held and a cap allowed it). */
  day: number;
}

export interface DeedReport {
  status: typeof SIM_ONLY;
  rules: string;
  deeds: Deed[];
  /** Longest unbroken solid tenure by one holder seen anywhere in the season. */
  maxTenureDays: number;
  /** Units that reached the tenure requirement at least once. */
  unitsReachingTenure: number;
  /** The most counted crossers (and traffic days) any unit had on a day it met the tenure requirement. */
  maxCrossersAtTenure: number;
  maxTrafficDaysAtTenure: number;
  /** Unit-days that met tenure but failed a traffic condition, by reason. */
  failedTraffic: { crossers: number; days: number; cluster: number };
  refusedCityCap: number;
  refusedHolderCap: number;
  deedsByProfile: Record<Profile, number>;
  /** Over every player, including those with no deed. */
  deedGini: number;
  deedTop10Share: number;
  /** First deed day per holder (the §21 liquidity switch). */
  firstDeedDay: Map<string, number>;
}

/**
 * Counterfactual deed issuance over a trace: which units would have become
 * deed-eligible under `rules`, for whom, and when. Deeds are kept once issued
 * (§5: deeded ground never wears down). The trace itself was run without
 * deeds, so later days do not reflect deeded ground being harder to take:
 * this measures who reaches the gate, not what happens after it.
 */
export function deedEligibility(trace: SeasonTrace, rules: DeedRules, clusterOf: (playerId: string) => string = groundTruthClusters(trace)): DeedReport {
  type Tenure = { holder: string; since: number; crossers: Map<string, string>; days: Set<number> };
  const tenure = new Map<string, Tenure>();
  const deeded = new Map<string, Deed>();
  const holderCount = new Map<string, number>();
  const cityCap = rules.cityCapShare === null ? Infinity : Math.floor(rules.cityCapShare * trace.units);
  let maxTenure = 0;
  const reached = new Set<string>();
  const failed = { crossers: 0, days: 0, cluster: 0 };
  let refusedCity = 0;
  let refusedHolder = 0;
  let maxCrossers = 0;
  let maxDays = 0;

  for (const d of trace.days) {
    const stepped = new Map(d.stepped);
    const solidNow = new Map<string, string>();
    for (const [u, h, g] of d.held) if (g === "solid") solidNow.set(u, h);
    for (const u of [...tenure.keys()]) if (solidNow.get(u) !== tenure.get(u)!.holder) tenure.delete(u);
    for (const [u, h] of solidNow) {
      if (deeded.has(u)) continue;
      let t = tenure.get(u);
      if (!t) tenure.set(u, (t = { holder: h, since: d.day, crossers: new Map(), days: new Set() }));
      const own = clusterOf(h);
      let counted = false;
      for (const w of stepped.get(u) ?? []) {
        if (w === h || clusterOf(w) === own) continue; // own and linked traffic never counts (§12)
        t.crossers.set(w, clusterOf(w));
        counted = true;
      }
      if (counted) t.days.add(d.day);
      const held = d.day - t.since + 1;
      if (held > maxTenure) maxTenure = held;
      if (held < rules.tenureDays) continue;
      reached.add(u);
      const n = t.crossers.size;
      if (n > maxCrossers) maxCrossers = n;
      if (t.days.size > maxDays) maxDays = t.days.size;
      if (n < rules.distinctCrossers) {
        failed.crossers += 1;
        continue;
      }
      if (t.days.size < rules.trafficDays) {
        failed.days += 1;
        continue;
      }
      const perCluster = new Map<string, number>();
      for (const c of t.crossers.values()) perCluster.set(c, (perCluster.get(c) ?? 0) + 1);
      if (Math.max(...perCluster.values()) > rules.maxClusterShare * n) {
        failed.cluster += 1;
        continue;
      }
      if (deeded.size >= cityCap) {
        refusedCity += 1;
        continue;
      }
      if (rules.perHolderCap !== null && (holderCount.get(h) ?? 0) >= rules.perHolderCap) {
        refusedHolder += 1;
        continue;
      }
      deeded.set(u, { unitId: u, holderId: h, day: d.day });
      holderCount.set(h, (holderCount.get(h) ?? 0) + 1);
      tenure.delete(u);
    }
  }

  const deeds = [...deeded.values()].sort((a, b) => a.day - b.day || byString(a.unitId, b.unitId));
  const profileOf = new Map(trace.players.map((p) => [p.id, p.profile]));
  const deedsByProfile = Object.fromEntries(PROFILES.map((p) => [p, 0])) as Record<Profile, number>;
  const firstDeedDay = new Map<string, number>();
  for (const x of deeds) {
    deedsByProfile[profileOf.get(x.holderId)!] += 1;
    if (!firstDeedDay.has(x.holderId)) firstDeedDay.set(x.holderId, x.day);
  }
  const counts = trace.players.map((p) => holderCount.get(p.id) ?? 0);
  return {
    status: SIM_ONLY,
    rules: rules.label,
    deeds,
    maxTenureDays: maxTenure,
    unitsReachingTenure: reached.size,
    maxCrossersAtTenure: maxCrossers,
    maxTrafficDaysAtTenure: maxDays,
    failedTraffic: failed,
    refusedCityCap: refusedCity,
    refusedHolderCap: refusedHolder,
    deedsByProfile,
    deedGini: gini(counts),
    deedTop10Share: topShare(counts, 0.1),
    firstDeedDay,
  };
}

/* ── deeds: toll income (§20) ─────────────────────────────────────────────── */

export interface TollPayment {
  payer: string;
  owner: string;
  micro: number;
}

export interface TollEstimate {
  /** Each payer-to-owner toll, by day. Every payment is a matched debit and credit (§20). */
  byDay: Map<number, TollPayment[]>;
  totalMicro: number;
  /** Per deed per day held, the mean and the largest single-deed season total. */
  meanPerDeedDayMicro: number;
  maxDeedSeasonMicro: number;
}

/**
 * The §20 toll the deeds in `report` would have collected from the trace's
 * walkers: each crossing walker pays 2% of the day's reward times
 * (this owner's deeded units ÷ distinct units the walker stepped on that day).
 * The trace is per day, so this uses the day as the basis, which is the §18
 * worked example's reading of D10 rather than §20's per-session one. Own and
 * linked owners' land is free. Behaviour is assumed unchanged by the toll.
 */
export function tollIncome(trace: SeasonTrace, report: DeedReport, clusterOf: (playerId: string) => string = groundTruthClusters(trace), tollBasisPoints = economyRulesFor(1)!.tollBasisPoints): TollEstimate {
  const byDay = new Map<number, TollPayment[]>();
  const perDeed = new Map<string, number>();
  let total = 0;
  let deedDays = 0;
  for (const d of trace.days) {
    const active = report.deeds.filter((x) => x.day <= d.day);
    if (active.length === 0) continue;
    deedDays += active.length;
    const earned = new Map(d.lines.map((l) => [l.playerId, l.earnedMicro]));
    const unitsStepped = new Map<string, number>();
    for (const [, ws] of d.stepped) for (const w of ws) unitsStepped.set(w, (unitsStepped.get(w) ?? 0) + 1);
    const stepped = new Map(d.stepped);
    const today = new Map<string, TollPayment>();
    for (const x of active) {
      for (const w of stepped.get(x.unitId) ?? []) {
        if (w === x.holderId || clusterOf(w) === clusterOf(x.holderId)) continue;
        const e = earned.get(w) ?? 0;
        const toll = Math.floor((e * tollBasisPoints) / 10_000 / unitsStepped.get(w)!);
        if (toll <= 0) continue;
        const key = `${w}\u0000${x.holderId}`;
        const prev = today.get(key);
        today.set(key, { payer: w, owner: x.holderId, micro: (prev?.micro ?? 0) + toll });
        perDeed.set(x.unitId, (perDeed.get(x.unitId) ?? 0) + toll);
        total += toll;
      }
    }
    byDay.set(d.day, [...today.values()].sort((a, b) => byString(a.payer, b.payer) || byString(a.owner, b.owner)));
  }
  return { byDay, totalMicro: total, meanPerDeedDayMicro: deedDays ? total / deedDays : 0, maxDeedSeasonMicro: Math.max(0, ...perDeed.values()) };
}

/* ── deeds: transfer and wash-trade screening ─────────────────────────────── */

export interface DeedTransfer {
  unitId: string;
  from: string;
  to: string;
  day: number;
  /** Price in research units; 0 for a gift. */
  price: number;
}

export type WashFlag = "related_parties" | "round_trip" | "cycle" | "price_outlier";

/**
 * Screens deed transfers for wash-trading patterns (an off-chain risk signal,
 * never an automatic penalty, §28: no permanent action on one weak signal):
 * related parties; A→B→A within `windowDays`; a cycle of up to `maxCycle`
 * hops back to the first seller within the window; a price more than
 * `outlierFactor` times the median price of the batch.
 */
export function washTradeFlags(
  transfers: readonly DeedTransfer[],
  clusterOf: (playerId: string) => string,
  opts: { windowDays?: number; maxCycle?: number; outlierFactor?: number } = {},
): { transfer: DeedTransfer; flags: WashFlag[] }[] {
  const windowDays = opts.windowDays ?? 30;
  const maxCycle = opts.maxCycle ?? 3;
  const outlier = opts.outlierFactor ?? 5;
  const sorted = [...transfers].sort((a, b) => a.day - b.day || byString(a.unitId, b.unitId));
  const priced = sorted.map((t) => t.price).filter((p) => p > 0).sort((a, b) => a - b);
  const median = priced.length ? priced[Math.floor((priced.length - 1) / 2)]! : 0;
  return sorted.map((t, i) => {
    const flags: WashFlag[] = [];
    if (clusterOf(t.from) === clusterOf(t.to)) flags.push("related_parties");
    const later = sorted.slice(i + 1).filter((u) => u.unitId === t.unitId && u.day - t.day <= windowDays);
    if (later[0] && later[0].from === t.to && later[0].to === t.from) flags.push("round_trip");
    else {
      let holder = t.to;
      for (let k = 0; k < Math.min(maxCycle - 1, later.length); k++) {
        if (later[k]!.from !== holder) break;
        holder = later[k]!.to;
        if (holder === t.from && k >= 1) {
          flags.push("cycle");
          break;
        }
      }
    }
    if (median > 0 && t.price > outlier * median) flags.push("price_outlier");
    return { transfer: t, flags };
  });
}

/** What it costs to print `trades` wash trades at `price` when each transfer burns `feeBasisPoints` of the price. */
export function washTradeCost(trades: number, price: number, feeBasisPoints: number, gasPerTrade = 0): number {
  return trades * ((price * feeBasisPoints) / 10_000 + gasPerTrade);
}

/* ── conversion options and Sybil arithmetic ──────────────────────────────── */

/**
 * The credits-to-token design space. Only `v3_source` and `locked_only` are
 * readings of the source (§21 and its legal fallback). `none` is Play V1 as
 * approved. `capped_conversion` and `liquid_all` are research comparators,
 * not proposals; `liquid_all` breaks rule 11 and is there to show why.
 */
export type ConversionPolicy =
  | { kind: "none" }
  | { kind: "v3_source"; /** Revenue valve stand-in: liquid issued per season ≤ this share of the season's mint. Null: no valve. */ valveShareOfMint: number | null }
  | { kind: "locked_only" }
  | { kind: "capped_conversion"; /** Tokens per credit converted; the rest of each converted credit is burned. */ ratio: number; capPerAccountPerSeasonMicro: number }
  | { kind: "liquid_all" };

export interface SybilParams {
  /** What one fake account costs to run for one day (device, spoofing effort, upkeep), in cost units. */
  costPerAccountDay: number;
  /** Chance the risk graph links a fake account to its operator (then it earns nothing or counts nothing). */
  detectionRate: number;
  /** §17 trust weight a fresh account is given (0–1). */
  trustWeight: number;
  /** Reward per active day a fake account earns, in micro (measured from the trace). */
  rewardPerDayMicro: number;
}

const MICRO = 1_000_000;

/**
 * Break-even price (cost units per token) above which farming rewards
 * directly with fake accounts pays. Infinity when nothing farmed is ever
 * sellable.
 */
export function directFarmBreakEven(policy: ConversionPolicy, p: SybilParams, seasonDays = 90): number {
  const daily = (p.rewardPerDayMicro / MICRO) * p.trustWeight * (1 - p.detectionRate);
  if (daily <= 0) return Infinity;
  switch (policy.kind) {
    case "none":
    case "locked_only":
    case "v3_source": // a free account's rewards are locked (§21); the deed route is priced separately
      return Infinity;
    case "liquid_all":
      return p.costPerAccountDay / daily;
    case "capped_conversion": {
      const capDaily = policy.capPerAccountPerSeasonMicro / MICRO / seasonDays;
      const sellable = Math.min(daily, capDaily) * policy.ratio;
      return sellable > 0 ? p.costPerAccountDay / sellable : Infinity;
    }
  }
}

/** P(X ≥ k) for X ~ Binomial(n, p), by direct summation (n stays small here). */
export function binomialAtLeast(n: number, p: number, k: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  if (p >= 1) return 1;
  if (p <= 0) return 0;
  let pmf = (1 - p) ** n;
  let below = 0;
  for (let i = 0; i < k; i++) {
    below += pmf;
    pmf = (pmf * (n - i) * p) / ((i + 1) * (1 - p));
  }
  return Math.max(0, Math.min(1, 1 - below));
}

export interface MutualRingResult {
  /** Ring members needed so each member's deed passes with probability ≥ `confidence`. */
  ringSize: number | null;
  passProbability: number;
  /** Cost units per member: tenure days plus the horizon of farming afterwards. */
  costPerMember: number;
  /** Price above which the ring pays over `horizonDays` of liquid rewards after the deed. Infinity when it never can. */
  breakEvenPrice: number;
}

/**
 * The cheapest route to sellable rewards under §21: a ring of fake accounts
 * that walk each other's ground so every member reaches a first deed, after
 * which each member's later rewards are liquid. Each member needs
 * `distinctCrossers` crossers from the others that the risk graph does not
 * link (linked ones never count). Under the §21 legal fallback, or with no
 * conversion, the ring never pays.
 */
export function mutualDeedRing(policy: ConversionPolicy, rules: DeedRules, p: SybilParams, opts: { horizonDays?: number; confidence?: number; maxRing?: number } = {}): MutualRingResult {
  const horizon = opts.horizonDays ?? 90;
  const confidence = opts.confidence ?? 0.95;
  const maxRing = opts.maxRing ?? 2000;
  let ringSize: number | null = null;
  let pass = 0;
  for (let m = rules.distinctCrossers + 1; m <= maxRing; m++) {
    pass = binomialAtLeast(m - 1, 1 - p.detectionRate, rules.distinctCrossers);
    if (pass >= confidence) {
      ringSize = m;
      break;
    }
  }
  const costPerMember = p.costPerAccountDay * (rules.tenureDays + horizon);
  const liquidAfter = policy.kind === "v3_source" || policy.kind === "liquid_all";
  const daily = (p.rewardPerDayMicro / MICRO) * p.trustWeight;
  const value = liquidAfter && ringSize !== null ? daily * horizon * pass : 0;
  return { ringSize, passProbability: pass, costPerMember, breakEvenPrice: value > 0 ? costPerMember / value : Infinity };
}

/**
 * The toll channel: an undetected locked fake account crossing its
 * operator's deeds pays 2% of its reward to the deed holder, and §21 makes
 * tolls received liquid. Break-even price for one such account, when a share
 * `tolledShare` of the cells it crosses are the operator's deeds.
 */
export function tollChannelBreakEven(policy: ConversionPolicy, p: SybilParams, tolledShare = 1, tollBasisPoints = economyRulesFor(1)!.tollBasisPoints): number {
  if (policy.kind !== "v3_source" && policy.kind !== "liquid_all") return Infinity;
  const daily = (p.rewardPerDayMicro / MICRO) * p.trustWeight * (1 - p.detectionRate) * (tollBasisPoints / 10_000) * tolledShare;
  return daily > 0 ? p.costPerAccountDay / daily : Infinity;
}

/* ── emission and sink projection ─────────────────────────────────────────── */

export interface SinkConfig {
  label: string;
  /** Recharge and upkeep from the trace (§7, §8): always on; they are the source's automatic sinks. */
  /** Level purchases the simulator made (§9). */
  levelSpend: boolean;
  /** §12 deed claim fee in day-shares, burned when the deed is claimed (curve is D6, open). */
  deedClaimFeeDayShares: number;
  /** Discretionary spend (§22 gear, cosmetics, beacons, fortify) as a share of each balance, burned each season end. */
  discretionaryShareOfBalance: number;
  /** §22 "season-end burn" (size unspecified) as a share of each locked balance. */
  seasonEndBurnShareOfLocked: number;
}

export const SINKS_TRACE_ONLY: Readonly<SinkConfig> = Object.freeze({ label: "trace sinks", levelSpend: true, deedClaimFeeDayShares: 0, discretionaryShareOfBalance: 0, seasonEndBurnShareOfLocked: 0 });

export interface EmissionConfig {
  label: string;
  status: typeof SIM_ONLY;
  /** Economy rules version; read, never changed. */
  economyRulesVersion: number;
  /** "v3": §17 schedule. "flat_s1": season one's pool every season (a comparator, not the source). */
  schedule: "v3" | "flat_s1";
  /** Copies of the trace population playing each season (integers). The trace is replayed each season. */
  populationBySeason: number[];
  policy: ConversionPolicy;
  sinks: SinkConfig;
  deedRules: DeedRules;
}

export interface SeasonMetrics {
  season: number;
  poolMicro: number;
  /** All copies of the population. */
  mintedMicro: number;
  burnedMicro: number;
  supplyStartMicro: number;
  supplyEndMicro: number;
  /** (end − start) ÷ start; null in the first season. */
  inflation: number | null;
  burnToMint: number;
  liquidEndMicro: number;
  lockedEndMicro: number;
  /** Days on which the pool, not the ceilings, set rewards. */
  poolBindingDays: number;
  /** Season mint ÷ season pool. */
  poolUtilisation: number;
  cumulativeMintedMicro: number;
  /** Share of the 400M player allocation minted so far. */
  allocationUsed: number;
  /** Concentration of holdings (locked + liquid) over the trace's players. */
  gini: number;
  top10Share: number;
  giniLiquid: number;
  /** Liquid issuance the valve moved to locked this season. */
  valveLockedMicro: number;
  deedHolders: number;
}

export interface ProjectionResult {
  status: typeof SIM_ONLY;
  label: string;
  seasons: SeasonMetrics[];
  /** Mean holdings at the last season end, by profile, per player (micro). */
  holdingsByProfile: Record<Profile, number>;
  liquidByProfile: Record<Profile, number>;
  /** Every season's books closed: minted − burned = supply change, exactly. */
  booksBalanced: boolean;
  /** No day minted more than its pool. */
  poolRespected: boolean;
}

/**
 * Replays the trace for `populationBySeason.length` seasons. Each day the
 * trace population (times the season's copies) asks for its ceiling-limited
 * rewards; when that exceeds the day's pool every reward is scaled down
 * (§17: rate = pool ÷ points). Recharge, upkeep and level spend scale with
 * the reward (they are priced in day-shares). Each copy of a player behaves
 * identically, so concentration is measured over the trace's players.
 */
export function projectEconomy(trace: SeasonTrace, cfg: EmissionConfig, deedReport: DeedReport = deedEligibility(trace, cfg.deedRules), tolls: TollEstimate = tollIncome(trace, deedReport)): ProjectionResult {
  if (cfg.status !== SIM_ONLY) throw new RangeError("an emission config must be marked SIMULATION_ONLY_NOT_PRODUCTION");
  const rules = economyRulesFor(cfg.economyRulesVersion);
  if (!rules) throw new RangeError(`unknown economy rules version ${cfg.economyRulesVersion}`);
  for (const k of cfg.populationBySeason) if (!Number.isInteger(k) || k < 1) throw new RangeError("population copies must be integers ≥ 1");

  const ids = trace.players.map((p) => p.id).sort(byString);
  const locked = new Map<string, number>(ids.map((id) => [id, 0]));
  const liquid = new Map<string, number>(ids.map((id) => [id, 0]));
  const levelSpend = trace.days.map((d) => new Map(d.levelSpendMicro));
  const seasons: SeasonMetrics[] = [];
  let cumulative = 0;
  let booksBalanced = true;
  let poolRespected = true;

  const takeLockedFirst = (id: string, amount: number): number => {
    const l = locked.get(id)!;
    const fromLocked = Math.min(l, amount);
    locked.set(id, l - fromLocked);
    const q = liquid.get(id)!;
    const fromLiquid = Math.min(q, amount - fromLocked);
    liquid.set(id, q - fromLiquid);
    return fromLocked + fromLiquid;
  };
  const supply = () => ids.reduce((a, id) => a + locked.get(id)! + liquid.get(id)!, 0);

  cfg.populationBySeason.forEach((copies, idx) => {
    const season = idx + 1;
    const dayPool = cfg.schedule === "v3" ? dailyPoolMicro(rules, season) : rules.seasonOneDailyPoolMicro;
    const seasonPool = cfg.schedule === "v3" ? seasonPoolMicro(rules, season) : rules.seasonOnePoolMicro;
    const startPerCopy = supply();
    let mintedPerCopy = 0;
    let burnedPerCopy = 0;
    let bindingDays = 0;
    const seasonLiquid = new Map<string, number>();
    const seasonNet = new Map<string, number>();

    for (let di = 0; di < trace.days.length; di++) {
      const d = trace.days[di]!;
      const demand = d.lines.reduce((a, l) => a + l.earnedMicro, 0) * copies;
      const remaining = rules.playerAllocationMicro - cumulative - mintedPerCopy * copies;
      const cap = Math.min(dayPool, Math.max(0, remaining));
      // Rate scaling, rounded down so the day never exceeds its pool.
      const num = demand > cap ? cap : 1;
      const den = demand > cap ? demand : 1;
      if (demand > cap) bindingDays += 1;
      const bn = BigInt(num);
      const bd = BigInt(den);
      const scale = (x: number) => (den === 1 ? x : Number((BigInt(x) * bn) / bd));
      const tollsToday = tolls.byDay.get(d.day) ?? [];
      const tollPaid = new Map<string, number>();
      for (const t of tollsToday) tollPaid.set(t.payer, (tollPaid.get(t.payer) ?? 0) + scale(t.micro));
      const isLiquid = (id: string) => {
        if (cfg.policy.kind === "liquid_all") return true;
        if (cfg.policy.kind !== "v3_source") return false;
        const first = deedReport.firstDeedDay.get(id);
        return first !== undefined && (season > 1 || d.day > first);
      };
      const credit = (id: string, amount: number, liquidTo: boolean) => {
        if (liquidTo) {
          liquid.set(id, liquid.get(id)! + amount);
          seasonLiquid.set(id, (seasonLiquid.get(id) ?? 0) + amount);
        } else locked.set(id, locked.get(id)! + amount);
      };
      let dayMint = 0;
      for (const l of d.lines) {
        const earned = scale(l.earnedMicro);
        const burned = Math.min(earned, scale(l.rechargeMicro + l.upkeepTakenMicro));
        const toll = Math.min(earned - burned, tollPaid.get(l.playerId) ?? 0);
        tollPaid.set(l.playerId, toll);
        dayMint += earned;
        burnedPerCopy += burned;
        const net = earned - burned - toll;
        seasonNet.set(l.playerId, (seasonNet.get(l.playerId) ?? 0) + net);
        credit(l.playerId, net, isLiquid(l.playerId));
      }
      // Tolls received: the payers' share moved to the owner inside the day's mint (§20); liquid for the owner under §21.
      const tollLiquid = cfg.policy.kind === "v3_source" || cfg.policy.kind === "liquid_all";
      const owed = new Map<string, number>();
      for (const t of tollsToday) {
        const share = scale(t.micro);
        const left = tollPaid.get(t.payer) ?? 0;
        const amt = Math.min(share, left);
        tollPaid.set(t.payer, left - amt);
        owed.set(t.owner, (owed.get(t.owner) ?? 0) + amt);
      }
      for (const [owner, amt] of [...owed].sort(([a], [b]) => byString(a, b))) credit(owner, amt, tollLiquid);
      for (const [payer, left] of tollPaid) if (left > 0) credit(payer, left, isLiquid(payer)); // rounding remainders go to the runner (§20)
      if (cfg.sinks.levelSpend) {
        for (const [pid, m] of levelSpend[di]!) burnedPerCopy += takeLockedFirst(pid, scale(m));
      }
      if (cfg.sinks.deedClaimFeeDayShares > 0 && season === 1) {
        for (const x of deedReport.deeds) if (x.day === d.day) burnedPerCopy += takeLockedFirst(x.holderId, Math.floor(cfg.sinks.deedClaimFeeDayShares * scale(d.dayShareMicro)));
      }
      if (dayMint * copies > dayPool) poolRespected = false;
      mintedPerCopy += dayMint;
    }

    // Season-end conversion and burns.
    let valveLocked = 0;
    if (cfg.policy.kind === "v3_source" && cfg.policy.valveShareOfMint !== null) {
      const allowed = Math.floor(cfg.policy.valveShareOfMint * mintedPerCopy);
      const issued = [...seasonLiquid.values()].reduce((a, b) => a + Math.max(0, b), 0);
      if (issued > allowed) {
        for (const [id, v] of [...seasonLiquid].sort(([a], [b]) => byString(a, b))) {
          if (v <= 0) continue;
          const move = Math.min(liquid.get(id)!, v - Math.floor((v * allowed) / issued));
          liquid.set(id, liquid.get(id)! - move);
          locked.set(id, locked.get(id)! + move);
          valveLocked += move;
        }
      }
    }
    if (cfg.policy.kind === "capped_conversion") {
      for (const id of ids) {
        const convert = Math.min(locked.get(id)!, Math.max(0, seasonNet.get(id) ?? 0), cfg.policy.capPerAccountPerSeasonMicro);
        const tokens = Math.floor(convert * cfg.policy.ratio);
        locked.set(id, locked.get(id)! - convert);
        liquid.set(id, liquid.get(id)! + tokens);
        burnedPerCopy += convert - tokens;
      }
    }
    for (const id of ids) {
      if (cfg.sinks.seasonEndBurnShareOfLocked > 0) burnedPerCopy += takeLockedFirst(id, Math.floor(locked.get(id)! * cfg.sinks.seasonEndBurnShareOfLocked));
      if (cfg.sinks.discretionaryShareOfBalance > 0) burnedPerCopy += takeLockedFirst(id, Math.floor((locked.get(id)! + liquid.get(id)!) * cfg.sinks.discretionaryShareOfBalance));
    }

    const endPerCopy = supply();
    if (startPerCopy + mintedPerCopy - burnedPerCopy !== endPerCopy) booksBalanced = false;
    cumulative += mintedPerCopy * copies;
    const holdings = ids.map((id) => locked.get(id)! + liquid.get(id)!);
    const liquidVals = ids.map((id) => liquid.get(id)!);
    seasons.push({
      season,
      poolMicro: seasonPool,
      mintedMicro: mintedPerCopy * copies,
      burnedMicro: burnedPerCopy * copies,
      supplyStartMicro: startPerCopy * copies,
      supplyEndMicro: endPerCopy * copies,
      inflation: startPerCopy > 0 ? (endPerCopy - startPerCopy) / startPerCopy : null,
      burnToMint: mintedPerCopy > 0 ? burnedPerCopy / mintedPerCopy : 0,
      liquidEndMicro: liquidVals.reduce((a, b) => a + b, 0) * copies,
      lockedEndMicro: ids.reduce((a, id) => a + locked.get(id)!, 0) * copies,
      poolBindingDays: bindingDays,
      poolUtilisation: seasonPool > 0 ? (mintedPerCopy * copies) / seasonPool : 0,
      cumulativeMintedMicro: cumulative,
      allocationUsed: cumulative / rules.playerAllocationMicro,
      gini: gini(holdings),
      top10Share: topShare(holdings, 0.1),
      giniLiquid: gini(liquidVals),
      valveLockedMicro: valveLocked * copies,
      deedHolders: deedReport.firstDeedDay.size,
    });
  });

  const profileOf = new Map(trace.players.map((p) => [p.id, p.profile]));
  const n = Object.fromEntries(PROFILES.map((p) => [p, 0])) as Record<Profile, number>;
  const holdingsByProfile = Object.fromEntries(PROFILES.map((p) => [p, 0])) as Record<Profile, number>;
  const liquidByProfile = Object.fromEntries(PROFILES.map((p) => [p, 0])) as Record<Profile, number>;
  for (const id of ids) {
    const p = profileOf.get(id)!;
    n[p] += 1;
    holdingsByProfile[p] += locked.get(id)! + liquid.get(id)!;
    liquidByProfile[p] += liquid.get(id)!;
  }
  for (const p of PROFILES) {
    holdingsByProfile[p] = n[p] ? holdingsByProfile[p] / n[p] : 0;
    liquidByProfile[p] = n[p] ? liquidByProfile[p] / n[p] : 0;
  }
  return { status: SIM_ONLY, label: cfg.label, seasons, holdingsByProfile, liquidByProfile, booksBalanced, poolRespected };
}

/** Reward per active day by profile, in micro, from the trace (what a fake account copying that profile would earn). */
export function rewardPerActiveDay(trace: SeasonTrace): Record<Profile, number> {
  const sum = Object.fromEntries(PROFILES.map((p) => [p, 0])) as Record<Profile, number>;
  const days = Object.fromEntries(PROFILES.map((p) => [p, 0])) as Record<Profile, number>;
  const profileOf = new Map(trace.players.map((p) => [p.id, p.profile]));
  for (const d of trace.days) {
    for (const l of d.lines) {
      if (l.earnedMicro <= 0) continue;
      const p = profileOf.get(l.playerId)!;
      sum[p] += l.earnedMicro;
      days[p] += 1;
    }
  }
  for (const p of PROFILES) sum[p] = days[p] ? sum[p] / days[p] : 0;
  return sum;
}

/** The V3 economy rules the research reads. Exposed so tests can prove they are unchanged. */
export function v3Rules(): EconomyRules {
  return economyRulesFor(1)!;
}
