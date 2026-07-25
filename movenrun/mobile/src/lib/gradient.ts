/**
 * Dependency-free gradient maths — pure, platform-free, testable.
 *
 * React Native has no built-in gradient and `expo-linear-gradient` is not a
 * dependency of this app, so premium gradient surfaces are composed from a
 * stack of solid colour bands (see components/Gradient.tsx). These helpers
 * compute the band colours; they touch no platform API and render nothing.
 */

/** Clamp to 0..1. */
function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Parse `#RGB` / `#RRGGBB` into channels. Throws on anything else so a typo in
 * a token fails loudly in tests rather than rendering an invisible surface.
 */
export function hexToRgb(hex: string): Rgb {
  const h = hex.trim().replace(/^#/, "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`invalid hex colour: ${hex}`);
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** Channels back to an uppercase `#RRGGBB` string. */
export function rgbToHex({ r, g, b }: Rgb): string {
  const part = (v: number) =>
    Math.round(clamp01(v / 255) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

/**
 * Blend two hex colours. `t = 0` returns `from`, `t = 1` returns `to`.
 * Interpolates in gamma-corrected space so mid-stops keep their vibrancy
 * instead of sagging through a muddy midpoint (plain sRGB lerp greys out).
 */
export function mixHex(from: string, to: string, t: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const k = clamp01(t);
  const blend = (x: number, y: number) => Math.sqrt((1 - k) * x * x + k * y * y);
  return rgbToHex({ r: blend(a.r, b.r), g: blend(a.g, b.g), b: blend(a.b, b.b) });
}

/**
 * Evenly spaced colour bands from `from` to `to`, inclusive of both ends.
 * `steps` is clamped to 2..64: one band cannot express a gradient, and past a
 * couple of dozen the extra views cost more than the smoothness is worth.
 */
export function gradientStops(from: string, to: string, steps: number): string[] {
  const n = Math.max(2, Math.min(64, Math.round(steps)));
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) out.push(mixHex(from, to, i / (n - 1)));
  return out;
}

/** Append an 8-bit alpha to a `#RRGGBB` token, e.g. `alpha("#3355FF", 0.12)`. */
export function alpha(hex: string, a: number): string {
  const v = Math.round(clamp01(a) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${rgbToHex(hexToRgb(hex))}${v.toUpperCase()}`;
}
