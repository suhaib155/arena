/**
 * Cooldown guard for one-shot taps (finish / replay / exit).
 *
 * The first acquire within a window wins and rapid repeats are ignored, so a
 * double tap on a terminal button produces exactly ONE state change and one
 * navigation instead of stacking `replace()` calls. Pure and clock-injected so
 * the behaviour is testable off-device.
 *
 * This is deliberately a *state-layer* guard: press animations must never be
 * what protects against double submission.
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
