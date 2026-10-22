// Pure TypeScript model of the contract-level invariants discussed in the on-chain risk register.
// SYNTHETIC: it mirrors the arithmetic of the pinned prototype (c8262ec, vendored under
// vendored-c8262ec/) so that properties can be checked offline. It is not the contract.
import { createHash } from "node:crypto";

export const ONE = 10n ** 18n;
export const PLAYER_ALLOCATION = 400_000_000n * ONE;
export const LIFETIME_CAP = 1_000_000_000n * ONE;
export const SEASON_ONE = 9_000_000n * ONE;
export const SEASON_FLOOR = 2_000_000n * ONE;
export const DECAY_BPS = 9000n;
export const SEASON_DAYS = 90n;
export const TOLL_BPS = 200n;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Season budget schedule exactly as _openSeason: 9M, x0.9 per season, floor 2M, clipped to what is left. */
export function seasonSchedule(): bigint[] {
  const out: bigint[] = [];
  let sched = SEASON_ONE;
  let issued = 0n;
  while (issued < PLAYER_ALLOCATION) {
    const left = PLAYER_ALLOCATION - issued;
    const b = sched > left ? left : sched;
    out.push(b);
    issued += b;
    sched = (sched * DECAY_BPS) / 10000n;
    if (sched < SEASON_FLOOR) sched = SEASON_FLOOR;
  }
  return out;
}

export interface Settlement {
  lastSettledDay: number;
  lifetimeIssued: bigint;
  seasonBudget: Map<number, bigint>;
  seasonIssued: Map<number, bigint>;
  highestSeason: number;
  liquidFromTolls: bigint;
  schedule: bigint[];
}

export function newSettlement(): Settlement {
  return { lastSettledDay: 0, lifetimeIssued: 0n, seasonBudget: new Map(), seasonIssued: new Map(), highestSeason: 0, liquidFromTolls: 0n, schedule: seasonSchedule() };
}

export const seasonOf = (day: number) => Math.floor((day - 1) / 90) + 1;
export const dayIndex = (day: number) => ((day - 1) % 90) + 1;

export interface Options {
  /** patched: day d may be published only when nowDay >= d */
  bindToClock: boolean;
  /** patched: gross <= multiple * budget / 90; 0 = no ceiling */
  ceilingMultiple: number;
}

/** One publication. Returns issued amount, or a string reason when refused. */
export function publish(s: Settlement, day: number, nowDay: number, wanted: bigint, opt: Options): bigint | string {
  if (day <= s.lastSettledDay) return "DayNotAdvancing";
  if (opt.bindToClock && nowDay < day) return "DayNotYetClosed";
  const season = seasonOf(day);
  if (season > s.highestSeason) {
    if (season !== s.highestSeason + 1) return "SeasonSequenceViolation";
    const sched = s.schedule[season - 1] ?? SEASON_FLOOR;
    const left = PLAYER_ALLOCATION - s.lifetimeIssued;
    s.seasonBudget.set(season, sched > left ? left : sched);
    s.highestSeason = season;
  }
  const budget = s.seasonBudget.get(season)!;
  const issued = s.seasonIssued.get(season) ?? 0n;
  const pool = (budget - issued) / (SEASON_DAYS - BigInt(dayIndex(day)) + 1n);
  if (wanted > pool) return "DailyPoolExceeded";
  if (opt.ceilingMultiple > 0) {
    const ceiling = (budget * BigInt(opt.ceilingMultiple)) / SEASON_DAYS;
    if (wanted > ceiling) return "PublicationAboveDailyCeiling";
  }
  if (wanted > PLAYER_ALLOCATION - s.lifetimeIssued) return "PlayerAllocationExceeded";
  s.lifetimeIssued += wanted;
  s.seasonIssued.set(season, issued + wanted);
  s.lastSettledDay = day;
  // Toll credits are liquid and are not counted against the liquid allowance (ledger M4).
  s.liquidFromTolls += (wanted * TOLL_BPS) / 10000n;
  return wanted;
}

/** Attacker holding both settlement keys: always publishes the last day of the next season at the full pool. */
export function jumpAttack(opt: Options, nowDayOf: (step: number) => number): { publications: number; lifetime: bigint; lastNowDay: number } {
  const s = newSettlement();
  let step = 0;
  let season = 1;
  while (s.lifetimeIssued < PLAYER_ALLOCATION && step < 1000) {
    const day = (season - 1) * 90 + 90;
    const nowDay = nowDayOf(step);
    const budget = s.schedule[season - 1] ?? SEASON_FLOOR;
    const r = publish(s, day, nowDay, budget, opt);
    step++;
    if (typeof r === "string") return { publications: step, lifetime: s.lifetimeIssued, lastNowDay: nowDay };
    season++;
  }
  return { publications: step, lifetime: s.lifetimeIssued, lastNowDay: nowDayOf(step) };
}

/** Seeded random attacker over `days` real days, each day trying a few publications. Returns max of lifetime/(nominal*closedDays). */
export function randomAttack(seed: number, days: number, opt: Options): { worstRatio: number; lifetime: bigint } {
  const rnd = mulberry32(seed);
  const s = newSettlement();
  const nominalPerDay = SEASON_ONE / SEASON_DAYS;
  let worst = 0;
  for (let nowDay = 1; nowDay <= days; nowDay++) {
    for (let k = 0; k < 4; k++) {
      const target = nowDay + (rnd() < 0.3 ? Math.floor(rnd() * 200) : 0);
      const day = Math.max(s.lastSettledDay + 1, Math.min(target, nowDay + 200));
      const season = seasonOf(day);
      const budget = s.schedule[season - 1] ?? SEASON_FLOOR;
      const wanted = (budget * BigInt(1 + Math.floor(rnd() * 1000))) / 1000n;
      publish(s, day, nowDay, wanted, opt);
    }
    const ratio = Number((s.lifetimeIssued * 1000000n) / (nominalPerDay * BigInt(nowDay))) / 1e6;
    if (ratio > worst) worst = ratio;
  }
  return { worstRatio: worst, lifetime: s.lifetimeIssued };
}

// ---- token cap model: V3 (cumulative) versus V1 (totalSupply) ----
export interface Supply { totalSupply: bigint; cumulativeMinted: bigint; everMinted: bigint }
export const newSupply = (): Supply => ({ totalSupply: 0n, cumulativeMinted: 0n, everMinted: 0n });

export function mintV3(s: Supply, amount: bigint): boolean {
  if (amount > LIFETIME_CAP - s.cumulativeMinted) return false;
  s.cumulativeMinted += amount; s.totalSupply += amount; s.everMinted += amount; return true;
}
export function mintV1(s: Supply, amount: bigint): boolean {
  if (s.totalSupply + amount > LIFETIME_CAP) return false; // MoveToken.mintMOVE checks totalSupply()
  s.totalSupply += amount; s.everMinted += amount; return true;
}
export function burn(s: Supply, amount: bigint): void { s.totalSupply -= amount; }
/** A transfer to a treasury is not a burn. */
export function treasuryTransfer(_s: Supply, _amount: bigint): void { /* totalSupply unchanged */ }

// ---- domain separation model ----
export function digest(parts: Array<string | number | bigint>): string {
  return createHash("sha256").update(parts.map(String).join("|")).digest("hex");
}
export const eip712Like = (name: string, version: string, chainId: number, verifying: string, structHash: string) =>
  digest([name, version, chainId, verifying, structHash]);
/** V1 SeasonController.greatBurn payload: no nonce, no used-signature record. */
export const v1GreatBurnPayload = (chainId: number, season: number, hexIds: number[], yields: bigint[]) =>
  digest([chainId, season, hexIds.join(","), yields.join(",")]);

// ---- quorum model for single-signer / two-signer concentration ----
export function quorumFailures(compromised: Set<string>, required: string[], threshold: number): boolean {
  return required.filter((k) => compromised.has(k)).length >= threshold;
}
