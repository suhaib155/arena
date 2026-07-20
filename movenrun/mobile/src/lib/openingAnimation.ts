/**
 * Opening-screen animation math — platform-free so the exact production
 * values are testable under node.
 *
 * Background: the opening board's "route scan" band used to animate the
 * `left` style ("-40%" → "140%") on a native-driven Animated value. The
 * native animated module only supports non-layout styles (opacity/transform),
 * so starting that animation crashed Android with
 * "Style property 'left' is not supported by native animated module".
 * The fix keeps `useNativeDriver: true` and moves the band with
 * `transform: [{ translateX }]` over the same travel, computed in pixels from
 * the measured board width.
 */

/** Width of the glowing scan band (px) — unchanged from the original. */
export const SCAN_BAND_WIDTH = 70;

/** The band starts fully off-canvas left and exits fully off-canvas right —
 *  the same -40% → 140% travel the `left` animation expressed, now in px. */
export const SCAN_START_FRACTION = -0.4;
export const SCAN_END_FRACTION = 1.4;

export interface ScanTranslateRange {
  inputRange: [number, number];
  outputRange: [number, number];
}

/**
 * Pixel translateX range for the scan band, from the measured board width.
 * Returns null until the board has a real measured width — the scan loop
 * must not start on a zero-width guess (it would animate 0 → 0).
 */
export function scanTranslateRange(boardWidth: number): ScanTranslateRange | null {
  if (!Number.isFinite(boardWidth) || boardWidth <= 0) return null;
  return {
    inputRange: [0, 1],
    outputRange: [SCAN_START_FRACTION * boardWidth, SCAN_END_FRACTION * boardWidth],
  };
}

/**
 * Cooldown guard for replay/finish taps: the first acquire within a window
 * wins, rapid repeats are ignored until the window elapses. Pure and
 * clock-injected for tests.
 */
export function createTapGuard(cooldownMs: number, now: () => number = Date.now) {
  let lastAcquired = -Infinity;
  return {
    tryAcquire(): boolean {
      const t = now();
      if (t - lastAcquired < cooldownMs) return false;
      lastAcquired = t;
      return true;
    },
  };
}
