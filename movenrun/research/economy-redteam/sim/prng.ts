/**
 * Seeded randomness for the scenario lab. Every draw in the lab comes from a
 * stream made here; a stream is named, so adding a draw to one stream never
 * shifts the draws of another.
 */

export type Rnd = () => number;

/** mulberry32: a small, fast 32-bit generator. */
export function mulberry32(seed: number): Rnd {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 32-bit hash of a string. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A named sub-stream of a seed. */
export function stream(seed: number, name: string): Rnd {
  return mulberry32(fnv1a(`${seed}:${name}`));
}

export const between = (r: Rnd, lo: number, hi: number) => lo + (hi - lo) * r();
export const intBetween = (r: Rnd, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
export const pick = <T>(r: Rnd, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;

/** Standard normal (Box-Muller). */
export function gauss(r: Rnd): number {
  const u = Math.max(1e-12, r());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}
