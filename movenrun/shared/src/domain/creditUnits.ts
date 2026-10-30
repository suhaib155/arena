/**
 * Exact conversions between the off-chain credit unit and an 18-decimal
 * fixed-point unit.
 *
 * Credits are off-chain game points in integer micro-units (1e-6 of a whole
 * unit, `MICRO_PER_MOVE` in economyV3.ts). Nothing in the gameplay settlement
 * converts them to a token, and nothing here authorises that: a token needs
 * an audited chain authorisation first. This module only fixes the arithmetic
 * any such conversion, or any 18-decimal amount computed from a decimal
 * factor, must use.
 *
 * Policy:
 * - Never through a float. `micro × 1e12` in floating point is wrong for a
 *   large share of amounts below the 1bn cap; the exact product is bigint.
 * - Inputs held as JS numbers must be non-negative SAFE integers
 *   (`Number.isSafeInteger`), not merely finite: above 2^53 − 1 a number no
 *   longer names one integer.
 * - No rounding on the way back: an 18-decimal amount that is not a whole
 *   number of micro is refused, never truncated (dust is an error).
 * - Overflow: anything above uint256 is refused.
 * - A decimal factor (a multiplier written as a JS number) is read by its
 *   shortest round-trip decimal spelling, the digits the author wrote, and
 *   refused if it needs more than 18 fractional digits. The float's binary
 *   expansion is never used.
 */

export const WEI_PER_MICRO = 10n ** 12n;
export const FIXED18_ONE = 10n ** 18n;
export const UINT256_MAX = (1n << 256n) - 1n;

export class CreditConversionRefused extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = "CreditConversionRefused";
  }
}

/** True for a non-negative safe integer: the only valid micro amount held as a number. */
export function isMicroAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** A micro amount held as a JS number, checked, as bigint. */
export function microFromNumber(micro: number): bigint {
  if (!isMicroAmount(micro)) throw new CreditConversionRefused(`not a non-negative safe integer micro amount: ${micro}`);
  return BigInt(micro);
}

/** micro → 18-decimal units, exactly (× 10^12 in bigint). */
export function microToFixed18(micro: number | bigint): bigint {
  const m = typeof micro === "bigint" ? micro : microFromNumber(micro);
  if (m < 0n) throw new CreditConversionRefused("negative micro amount");
  const wei = m * WEI_PER_MICRO;
  if (wei > UINT256_MAX) throw new CreditConversionRefused("above uint256");
  return wei;
}

/** 18-decimal units → micro, refusing sub-micro dust and anything that is not a safe integer of micro. */
export function fixed18ToMicroExact(wei: bigint): bigint {
  if (wei < 0n) throw new CreditConversionRefused("negative 18-decimal amount");
  if (wei % WEI_PER_MICRO !== 0n) throw new CreditConversionRefused(`18-decimal amount ${wei} carries ${wei % WEI_PER_MICRO} of sub-micro dust`);
  const micro = wei / WEI_PER_MICRO;
  if (micro > BigInt(Number.MAX_SAFE_INTEGER)) throw new CreditConversionRefused(`micro amount ${micro} is not a safe integer`);
  return micro;
}

/**
 * A non-negative decimal factor as 18-decimal fixed point, exactly as written
 * (1.1 → 1.1 × 10^18, not the float's 1100000000000000088.8…). Refuses
 * negative, non-finite, more than 18 fractional digits, or above uint256.
 */
export function decimalToFixed18(value: number): bigint {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new CreditConversionRefused(`not a finite non-negative factor: ${value}`);
  const m = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(value));
  if (!m) throw new CreditConversionRefused(`cannot read ${value} as a decimal`);
  const digits = m[1]! + (m[2] ?? "");
  // Decimal exponent of the last digit.
  const scale = -(m[2]?.length ?? 0) + Number(m[3] ?? 0);
  const shift = 18 + scale;
  let fixed: bigint;
  if (shift >= 0) {
    fixed = BigInt(digits) * 10n ** BigInt(shift);
  } else {
    const p = 10n ** BigInt(-shift);
    const d = BigInt(digits);
    if (d % p !== 0n) throw new CreditConversionRefused(`${value} needs more than 18 fractional digits`);
    fixed = d / p;
  }
  if (fixed > UINT256_MAX) throw new CreditConversionRefused(`${value} is above uint256 in 18-decimal units`);
  return fixed;
}
