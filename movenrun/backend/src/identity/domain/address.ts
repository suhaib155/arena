/**
 * EVM address canonicalization.
 *
 * The database stores addresses in ONE canonical form: lowercase, 0x-prefixed,
 * 40 hex chars. Uniqueness constraints and duplicate-ownership checks all
 * operate on this canonical form so `0xAbC…` and `0xabc…` can never be treated
 * as two different wallets (see wallets uniqueness constraints). A separate
 * checksum ("presentation") form is derived on the way out for display only.
 *
 * `ethers.getAddress` is used purely as an offline, deterministic checksum/
 * validation function — it makes NO network call and touches no key material.
 */
import { getAddress, isAddress } from "ethers";

export interface CanonicalAddress {
  /** Lowercase, 0x-prefixed — the storage/uniqueness key. */
  canonical: string;
  /** EIP-55 checksummed — for display only. */
  checksum: string;
}

/**
 * Validate and canonicalize. Returns null for anything that is not a
 * well-formed EVM address, so callers fail closed rather than persisting
 * garbage. Never throws.
 */
export function canonicalizeAddress(input: string): CanonicalAddress | null {
  const trimmed = input?.trim();
  if (!trimmed || !isAddress(trimmed)) return null;
  // getAddress also rejects a wrong-checksum mixed-case string, which isAddress
  // already covered; we re-derive both forms from the validated input.
  const checksum = getAddress(trimmed);
  return { canonical: checksum.toLowerCase(), checksum };
}
