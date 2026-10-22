/**
 * How gameplay stores a unit: the H3 cell's 64-bit index as a PostgreSQL
 * bigint, instead of its 15-character hex spelling (8 bytes against 16, and
 * a smaller, faster index). Proposed migration 0011 (revision 2).
 *
 * Only the canonical spelling is stored: a valid H3 cell in lowercase, as
 * `latLngToCell` emits it and as the movement pipeline writes
 * `traversed_hex_ids` (shared/src/domain/h3.ts explains why the uppercase
 * spelling of the same cell is refused). The conversion is exact both ways;
 * values cross the driver as decimal strings, never as JavaScript numbers,
 * which cannot hold 64 bits.
 */
import { isValidCell } from "h3-js";

/** A cell gameplay can store: a valid H3 cell index in canonical lowercase. */
export function isStorableCell(value: unknown): value is string {
  return typeof value === "string" && value.length === 15 && value === value.toLowerCase() && isValidCell(value);
}

/** The cell as a decimal int8 string, for a bigint parameter. Throws for anything not storable. */
export function cellToInt8(cell: string): string {
  if (!isStorableCell(cell)) throw new Error("not a storable H3 cell");
  return BigInt(`0x${cell}`).toString();
}

/** The cell an int8 from the database stands for (the driver returns int8 as a string). */
export function int8ToCell(value: string | number | bigint): string {
  const n = typeof value === "bigint" ? value : BigInt(value);
  if (n <= 0n) throw new Error("not a cell index");
  return n.toString(16).padStart(15, "0");
}
