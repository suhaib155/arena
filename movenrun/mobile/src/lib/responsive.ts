/**
 * Responsive sizing maths — pure, platform-free, testable.
 *
 * The app ships to everything from short budget Androids to tall notched
 * iPhones, and users can scale system text well past the default. Fixed pixel
 * heights and fixed hero type sizes are what push a pinned control bar off the
 * bottom of a short screen, so layout dimensions are derived from the live
 * viewport instead of being hard-coded.
 *
 * These helpers take the viewport height as an argument rather than reading it
 * from a platform hook, so they can be unit-tested against every device class.
 */

/** Viewport height (dp) below which a phone is treated as short. */
export const COMPACT_HEIGHT = 760;
/** Viewport height (dp) below which a phone is treated as very short. */
export const TINY_HEIGHT = 660;

export function isCompact(height: number): boolean {
  return height < COMPACT_HEIGHT;
}

export function isTiny(height: number): boolean {
  return height < TINY_HEIGHT;
}

/**
 * A dimension expressed as a share of the viewport height, clamped to a sane
 * range. Use for decorative panels (route canvas, art boards) so they shrink on
 * short screens instead of shoving interactive content off the bottom.
 */
export function vh(height: number, fraction: number, min: number, max: number): number {
  if (max < min) throw new Error("vh: max must be >= min");
  const raw = height * fraction;
  return Math.round(Math.max(min, Math.min(max, raw)));
}

/**
 * Scale a type size for the viewport. Sizes are only ever reduced, never
 * inflated — a hero numeral that grows on a tall screen would re-introduce the
 * overflow this module exists to prevent. `floor` is the smallest legible size.
 */
export function fs(size: number, height: number, floor = 12): number {
  if (floor > size) return size;
  const factor = isTiny(height) ? 0.76 : isCompact(height) ? 0.88 : 1;
  return Math.round(Math.max(floor, size * factor) * 10) / 10;
}
