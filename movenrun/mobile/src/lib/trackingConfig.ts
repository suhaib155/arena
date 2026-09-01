/**
 * GPS watch configuration — the single biggest lever on battery life.
 *
 * A movement session holds the GPS radio open for the whole workout, so this
 * file decides more about power draw than every render optimisation in the app
 * combined. Platform-free so the choice is unit-testable and can't drift.
 *
 * ## Why not BestForNavigation
 *
 * The first version used `Accuracy.BestForNavigation`. That is the highest
 * setting there is: Expo documents it as "the highest accuracy … ideal for
 * navigation" that "uses additional sensor data", and on iOS it maps to
 * `kCLLocationAccuracyBestForNavigation`, which Apple intends for turn-by-turn
 * guidance on a device that is plugged in. It keeps the GPS chip at full rate
 * and fuses extra sensors continuously.
 *
 * We are not navigating. We are drawing a walk or a run and measuring how far
 * it went, and our own filters already discard anything worse than
 * `MAX_ACCURACY_M` (40 m) and any step under `MIN_STEP_M` (2 m). Sub-metre
 * precision buys us nothing those filters keep, and costs battery for the
 * entire session.
 *
 * `Accuracy.High` (~10 m) sits comfortably inside our accept window while
 * letting the platform back the radio off between fixes.
 *
 * ## Why these intervals
 *
 * `distanceInterval` is the one that matters: it lets the OS stay quiet while
 * the user is standing still — at a red light, queueing, stretching — instead
 * of waking us on a fixed clock to deliver a fix we would filter out anyway.
 * `timeInterval` is the ceiling that guarantees the route still advances at a
 * slow walking pace.
 *
 * Numbers are expressed against the geo filters so the relationship is visible:
 * asking for updates finer than `MIN_STEP_M` would spend power producing points
 * `acceptPoint()` throws away.
 */
import { MIN_STEP_M } from "./geo";

/** Accuracy tiers we are willing to ship, in the shape expo-location expects.
 *  Mirrors `Location.Accuracy`; kept as a local enum so this module stays
 *  platform-free and testable off-device. */
export const ACCURACY = {
  /** ~1 km */ Lowest: 1,
  /** ~100 m */ Low: 2,
  /** ~100 m, balanced */ Balanced: 3,
  /** ~10 m */ High: 4,
  /** ~best available */ Highest: 5,
  /** Turn-by-turn grade — never for a fitness session. */
  BestForNavigation: 6,
} as const;

export type AccuracyLevel = (typeof ACCURACY)[keyof typeof ACCURACY];

export interface WatchConfig {
  accuracy: AccuracyLevel;
  /** Upper bound between fixes (ms), so a slow walk still draws a route. */
  timeInterval: number;
  /** Minimum movement before the OS wakes us (m). Standing still costs nothing. */
  distanceInterval: number;
}

/**
 * The configuration a real session uses.
 *
 * `distanceInterval` is deliberately a small multiple of `MIN_STEP_M` rather
 * than a bare number: it must be at least the step we would accept, or we pay
 * for fixes only to discard them.
 */
export const SESSION_WATCH: WatchConfig = {
  accuracy: ACCURACY.High,
  timeInterval: 4000,
  distanceInterval: MIN_STEP_M * 2.5, // 5 m
};

/** Accuracy levels that are too expensive for a session that runs for an hour. */
export const FORBIDDEN_ACCURACY: readonly AccuracyLevel[] = [
  ACCURACY.BestForNavigation,
  ACCURACY.Highest,
];

/** Whether a configuration is cheap enough to hold open for a whole workout. */
export function isBatterySafe(config: WatchConfig): boolean {
  if (FORBIDDEN_ACCURACY.includes(config.accuracy)) return false;
  // Waking more often than we would accept a point is pure waste.
  if (config.distanceInterval < MIN_STEP_M) return false;
  if (config.timeInterval < 1000) return false;
  return true;
}
