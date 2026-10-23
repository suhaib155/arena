/**
 * The session's clock: the wall clock read once, then advanced by a monotonic
 * source.
 *
 * ## Why the capture path does not read `Date.now()` directly
 *
 * The phone's wall clock is a setting. The player, the network or the OS can
 * move it at any moment, and every duration the session measured from it moved
 * with it: a one-hour forward step mid-walk turned an 82 m, two-minute walk
 * into a saveable one-hour session worth 191 local XP (Track A fixture C02),
 * and a one-hour backward step made every later fix look future-dated, so the
 * route silently stopped growing (C01).
 *
 * So the wall clock is used for exactly one thing: the absolute anchor at the
 * moment the session clock is created. Every later reading is
 * `anchor + (monotonic now - monotonic at anchor)`. A wall-clock change after
 * the anchor changes nothing the session measures: not the active duration,
 * not a fix's age, not the lifecycle timestamps the server receives.
 *
 * The anchor itself is still the wall clock, and is bounded elsewhere rather
 * than trusted: the server rejects a session that starts or ends more than
 * `MAX_FUTURE_SKEW_MS` ahead of its own receipt time and recomputes duration
 * from observation coverage, never from these timestamps.
 *
 * ## What this does not solve
 *
 * `performance.now()` is monotonic within a JavaScript runtime. Whether it keeps
 * counting while the device sleeps, the process is suspended or the app is
 * backgrounded is a property of the platform (and of the engine's binding to
 * it), not of this file. If it stops during suspend the session under-counts
 * that span, which under-credits time and never inflates it; if it counts
 * through, the session matches real time. Which one a given Android build does
 * has to be measured on hardware (H-sheet), and no claim here should be read
 * as having settled it.
 *
 * Without a monotonic source the clock falls back to the wall clock, clamped
 * so it never runs backwards. That keeps a backward step from shrinking time
 * but cannot detect a forward step; it is the old behaviour, kept only so the
 * session still runs on a runtime that has no `performance`.
 *
 * Pure apart from the default sources, and both are injectable for tests.
 */

export type TimeSource = () => number;

/** The runtime's monotonic source, or null when there is none. */
export function defaultMonotonicSource(): TimeSource | null {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  if (perf && typeof perf.now === "function") {
    const now = perf.now.bind(perf);
    return () => now();
  }
  return null;
}

export interface SessionClock {
  /** Epoch milliseconds: the wall anchor advanced by monotonic elapsed time. */
  now(): number;
  /** The wall-clock reading taken when the clock was created. */
  readonly anchoredAt: number;
  /** Whether a monotonic source drives the clock (false = clamped wall clock). */
  readonly monotonic: boolean;
}

export function createSessionClock(
  wall: TimeSource = Date.now,
  monotonic: TimeSource | null = defaultMonotonicSource(),
): SessionClock {
  const anchoredAt = wall();
  let last = anchoredAt;
  if (monotonic) {
    const origin = monotonic();
    return {
      anchoredAt,
      monotonic: true,
      now() {
        /* A monotonic source should never step back; clamp anyway so a broken
           binding cannot produce a negative elapsed time. */
        last = Math.max(last, anchoredAt + (monotonic() - origin));
        return last;
      },
    };
  }
  return {
    anchoredAt,
    monotonic: false,
    now() {
      last = Math.max(last, wall());
      return last;
    },
  };
}
