/** Seeded PRNG and small statistics helpers (research only). */
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

// Two-sided 95% Student t critical values by degrees of freedom.
const T95: Record<number, number> = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.16, 14: 2.145, 15: 2.131, 16: 2.12, 17: 2.11, 18: 2.101, 19: 2.093, 20: 2.086, 24: 2.064, 29: 2.045 };
export function tCrit(df: number): number {
  if (df <= 0) return NaN;
  const keys = Object.keys(T95).map(Number).sort((a, b) => a - b);
  for (const k of keys) if (df <= k) return T95[k]!;
  return 1.96;
}

export interface Summary { mean: number; lo: number; hi: number; n: number }
/** Mean with a 95% t interval across seeds (seed is the unit of replication). */
export function summarise(xs: readonly number[]): Summary {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { mean, lo: mean, hi: mean, n };
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const h = (tCrit(n - 1) * sd) / Math.sqrt(n);
  return { mean, lo: mean - h, hi: mean + h, n };
}
export const fmt = (s: Summary, d = 3) => `${s.mean.toFixed(d)} [${s.lo.toFixed(d)}, ${s.hi.toFixed(d)}]`;
