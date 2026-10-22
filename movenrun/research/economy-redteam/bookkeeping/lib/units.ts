/**
 * Reference conversion between the off-chain credit unit (integer micro, 1e-6
 * of a whole unit, as in economyV3.ts) and a notional 18-decimal token unit
 * ("wei", 1e-18). RESEARCH ONLY: no contract in the repository performs this
 * conversion today; this module states the rules a conversion would have to
 * obey so the property tests can check the books survive it exactly.
 *
 * Rules:
 * - micro → wei is exact: wei = micro × 10^12, in bigint.
 * - wei → micro refuses any amount that is not a whole number of micro
 *   (no truncation, no rounding): dust is an error, never silently dropped.
 * - A micro amount given as a JS number must be a safe integer and ≥ 0;
 *   anything else (fraction, NaN, Infinity, negative, above 2^53 − 1) is refused.
 */

export const WEI_PER_MICRO = 10n ** 12n;
export const WEI_PER_UNIT = 10n ** 18n;
/** SOURCE §17 / rule 2: one billion whole units, in micro and in wei. */
export const HARD_CAP_UNITS = 1_000_000_000n;
export const HARD_CAP_MICRO = HARD_CAP_UNITS * 1_000_000n;
export const HARD_CAP_WEI = HARD_CAP_UNITS * WEI_PER_UNIT;
export const UINT256_MAX = (1n << 256n) - 1n;

export class ConversionRefused extends Error {}

/** A micro amount held as a JS number, checked; returned as bigint. */
export function microFromNumber(micro: number): bigint {
  if (typeof micro !== "number" || !Number.isSafeInteger(micro)) throw new ConversionRefused(`not a safe integer micro amount: ${micro}`);
  if (micro < 0) throw new ConversionRefused(`negative micro amount: ${micro}`);
  return BigInt(micro);
}

export function microToWei(micro: bigint): bigint {
  if (micro < 0n) throw new ConversionRefused("negative micro amount");
  const wei = micro * WEI_PER_MICRO;
  if (wei > UINT256_MAX) throw new ConversionRefused("above uint256");
  return wei;
}

export function weiToMicroExact(wei: bigint): bigint {
  if (wei < 0n) throw new ConversionRefused("negative wei amount");
  if (wei % WEI_PER_MICRO !== 0n) throw new ConversionRefused(`wei amount ${wei} carries ${wei % WEI_PER_MICRO} wei of sub-micro dust`);
  return wei / WEI_PER_MICRO;
}

/** A micro bigint back to a JS number, refusing anything above 2^53 − 1. */
export function microToNumber(micro: bigint): number {
  if (micro < 0n || micro > BigInt(Number.MAX_SAFE_INTEGER)) throw new ConversionRefused(`micro amount ${micro} is not a safe integer`);
  return Number(micro);
}

/** The unsafe path, kept only so a test can show why it must not be used: float multiply by 1e12. */
export function microToWeiViaFloat(micro: number): bigint {
  return BigInt(Math.round(micro * 1e12));
}
