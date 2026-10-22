/**
 * Seeded generator for the bookkeeping property harness. mulberry32: small,
 * fast and fully deterministic, so the same seed always draws the same cases.
 * No property-testing dependency is used.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Integer in [lo, hi], both ends included. */
  int(lo: number, hi: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
  /** A fresh, independent stream derived from this one. */
  fork(): Rng;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (p) => next() < p,
    pick: (items) => {
      if (items.length === 0) throw new RangeError("pick from an empty list");
      return items[Math.floor(next() * items.length)]!;
    },
    shuffle: (items) => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
    fork: () => mulberry32(Math.floor(next() * 4294967296)),
  };
  return rng;
}
