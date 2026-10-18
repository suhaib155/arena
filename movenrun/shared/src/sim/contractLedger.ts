/**
 * G5 contract issue ledger: a reference model of the issuance arithmetic in the
 * prototype `MovenRunSettlement` (branch feat/v3-onchain-core, commit c8262ec),
 * used to size finding H1 and to compare remediation options. RESEARCH ONLY.
 *
 * Mirrors, line for line:
 * - `_openSeason` (L334–357): season 1 budget 9M, then 90% of the previous
 *   schedule value with a 2M floor, clamped by the remaining 400M allocation.
 * - `_dailyPool` (L361–365): (season budget − issued) ÷ (90 − dayIndex + 1).
 * - `publishSettlement` (L209–211): `dayId` only has to exceed the last one.
 *
 * Nothing here talks to a chain. The executable EVM proofs of the same findings
 * live in `shared/contract-proofs/g5-ledger/` and run on an in-process
 * Hardhat network only.
 */

export const CONTRACT_SHA = "c8262ecda89d9a2a11f045074ddf2be5d652af56";

/** Whole MOVE units; the contract uses 18 decimals, which changes nothing here. */
export const PLAYER_MOVEMENT_ALLOCATION = 400_000_000;
export const SEASON_ONE_BUDGET = 9_000_000;
export const SEASON_BUDGET_FLOOR = 2_000_000;
export const SEASON_DECAY = 0.9;
export const SEASON_LENGTH_DAYS = 90;
export const TOLL_RATE = 0.02;

/** Schedule value of each season, clamped by what is left of the allocation. */
export function seasonBudgets(): number[] {
  const out: number[] = [];
  let issued = 0;
  let schedule = 0;
  for (let s = 1; issued < PLAYER_MOVEMENT_ALLOCATION; s++) {
    schedule = s === 1 ? SEASON_ONE_BUDGET : Math.max(SEASON_BUDGET_FLOOR, schedule * SEASON_DECAY);
    const budget = Math.min(schedule, PLAYER_MOVEMENT_ALLOCATION - issued);
    out.push(budget);
    issued += budget;
  }
  return out;
}

/** `_dailyPool` as written: unissued budget spread over the days left in the season. */
export function prototypeDailyPool(seasonBudget: number, seasonIssued: number, dayIndex: number): number {
  return (seasonBudget - seasonIssued) / (SEASON_LENGTH_DAYS - dayIndex + 1);
}

export interface MintPath {
  publications: number;
  minted: number;
  /** Wall-clock days the path needs. The prototype imposes no minimum. */
  wallClockDays: number;
}

/**
 * Fastest path for an authorized (or compromised) signer pair under the prototype:
 * publish day 90 of every season in turn. Each call's pool is the whole season.
 */
export function prototypeFastestExhaustion(): MintPath {
  const budgets = seasonBudgets();
  let minted = 0;
  for (const budget of budgets) {
    const pool = prototypeDailyPool(budget, 0, SEASON_LENGTH_DAYS);
    minted += pool;
  }
  return { publications: budgets.length, minted, wallClockDays: 0 };
}

export interface BoundedRules {
  /** Day ids may not run ahead of wall-clock days since genesis. */
  timeBoundDays: boolean;
  /** Per-publication ceiling as a multiple of season budget ÷ 90. */
  perPublicationMultiple: number;
}

/**
 * Upper bound on what can be minted within `wallClockDays` of genesis under a
 * remediation: with day ids bound to time, at most one publication per elapsed
 * day, each capped at `multiple × budget ÷ 90`. Without the time bound, the
 * multiple alone still lets every day id be used at once.
 */
export function boundedMaxMint(rules: BoundedRules, wallClockDays: number): number {
  const budgets = seasonBudgets();
  let minted = 0;
  let day = 0;
  for (const budget of budgets) {
    for (let d = 1; d <= SEASON_LENGTH_DAYS; d++) {
      day += 1;
      if (rules.timeBoundDays && day > wallClockDays) return minted;
      const perDayCap = (rules.perPublicationMultiple * budget) / SEASON_LENGTH_DAYS;
      // The season budget still binds the sum.
      const issuedThisSeason = Math.min(budget, perDayCap * (d - 1));
      minted += Math.min(perDayCap, budget - issuedThisSeason);
    }
  }
  return minted;
}

/** Liquid MOVE one settlement can create: the allowance plus at most 2% of the toll base. */
export function maxLiquidPerSettlement(liquidAllowance: number, tollBase: number): number {
  return liquidAllowance + TOLL_RATE * tollBase;
}
