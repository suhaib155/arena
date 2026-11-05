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
 * it), not of this file. A source built on a monotonic clock that stops in deep
 * sleep would leave the session behind real time after the screen was locked,
 * and then every later fix (stamped with GNSS time) would look future-dated
 * and the route would stop growing for the rest of the walk.
 *
 * So the screen marks background and foreground (`suspend` / `resume`). On
 * resume the clock gets a catch-up budget: how much more the wall clock than
 * the monotonic source advanced while away. It spends that budget only when a
 * delivered fix proves the session is behind (`catchUp(fix.timestamp)`), and
 * never past that fix's time. A wall clock moved forward while the app was
 * away (the player opening Settings) therefore moves the session only as far
 * as satellite time confirms, which for a GNSS-stamped fix is real time. If
 * the platform stamps fixes from the system clock instead, the budget is the
 * bound, the wall-clock jump can reach the duration as before this change,
 * and the server's receipt check and observation-coverage duration still
 * apply. Which behaviour a given Android build has (does the source stop in
 * sleep; are fix times satellite or system time) has to be measured on
 * hardware (H-sheet), and no claim here should be read as having settled it.
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
  /** The app is going to the background (the phone may sleep from here). */
  suspend(): void;
  /** Back in the foreground: allow catching up what sleep may have cost. */
  resume(): void;
  /**
   * A delivered fix's timestamp. When the clock is behind it and a catch-up
   * budget remains from `resume`, advance to it (never beyond, never more than
   * the budget). Does nothing otherwise.
   */
  catchUp(fixTimestamp: number): void;
}

export function createSessionClock(
  wall: TimeSource = Date.now,
  monotonic: TimeSource | null = defaultMonotonicSource(),
): SessionClock {
  const anchoredAt = wall();
  let last = anchoredAt;
  if (monotonic) {
    const origin = monotonic();
    let offset = 0;
    let budget = 0;
    let away: { wall: number; mono: number } | null = null;
    const now = () => {
      /* A monotonic source should never step back; clamp anyway so a broken
         binding cannot produce a negative elapsed time. */
      last = Math.max(last, anchoredAt + (monotonic() - origin) + offset);
      return last;
    };
    return {
      anchoredAt,
      monotonic: true,
      now,
      suspend() {
        away ??= { wall: wall(), mono: monotonic() };
      },
      resume() {
        if (!away) return;
        const lag = (wall() - away.wall) - (monotonic() - away.mono);
        away = null;
        if (lag > 0) budget += lag;
      },
      catchUp(fixTimestamp) {
        if (!(budget > 0) || !Number.isFinite(fixTimestamp)) return;
        const behind = fixTimestamp - now();
        if (!(behind > 0)) return;
        const step = Math.min(budget, behind);
        offset += step;
        budget -= step;
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
    /* The wall clock already counts through sleep; nothing to catch up. */
    suspend() {},
    resume() {},
    catchUp() {},
  };
}
