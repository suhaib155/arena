/**
 * A coordinate-free probe for the Home/Territory location path.
 *
 * The physical failure that motivated this — `Locate me` producing no visible
 * change on a phone that had already granted permission — was invisible to the
 * test suite because every step of the path passed in isolation. What was
 * missing was the *sequence*: which of button, permission, native request, fix
 * validation and React state actually happened, and in what order.
 *
 * So the path records its own event names and timings. What it records is
 * deliberately not diagnosable-by-coordinate: there is no latitude, no
 * longitude, no accuracy and no cell id anywhere in this module, and a test
 * asserts there is not. A probe that captured a position to explain a position
 * bug would be a location log with a diagnostic label on it.
 *
 * Bounded: one attempt's worth of events, replaced on the next attempt, never
 * appended to and never written anywhere. Inert outside development.
 */

/** The steps of one area-location attempt, in the order they must occur. */
export type MapAreaEvent =
  /** An attempt began. `auto` when the screen started it, `tap` for the button. */
  | "auto"
  | "tap"
  /** Foreground permission was read or requested, and the answer. */
  | "permission_granted"
  | "permission_denied"
  /** A cached OS fix was accepted and shown while the current one was fetched. */
  | "seed_shown"
  /** The native current-position request was issued. */
  | "fix_requested"
  /** The native request returned something that validated as honest geography. */
  | "fix_validated"
  /** …or returned something that did not. */
  | "fix_rejected"
  /** The attempt ended without a usable fix (timeout, native error, denial). */
  | "failed";

export interface MapAreaTrace {
  /** Event names in the order they occurred. Never coordinates. */
  events: MapAreaEvent[];
  /** Milliseconds from the start of the attempt to each recorded event. */
  offsetsMs: number[];
}

/** The empty trace. A shape, so callers never branch on null. */
export const EMPTY_TRACE: MapAreaTrace = { events: [], offsetsMs: [] };

/**
 * How many events one attempt may record.
 *
 * There are eight distinct events and an attempt records at most six of them,
 * so this is a ceiling rather than a budget — it exists so a pathological loop
 * cannot turn a diagnostic into unbounded memory.
 */
export const MAX_EVENTS = 16;

export function createMapAreaTimings(enabled: boolean, now = Date.now) {
  let startedAt = 0;
  let events: MapAreaEvent[] = [];
  let offsets: number[] = [];
  const record = (event: MapAreaEvent) => {
    if (!enabled || events.length >= MAX_EVENTS) return;
    events.push(event);
    offsets.push(now() - startedAt);
  };
  return {
    /** A new attempt. Replaces the previous trace rather than extending it. */
    begin(prompted: boolean) {
      if (!enabled) return;
      startedAt = now();
      events = [];
      offsets = [];
      record(prompted ? "tap" : "auto");
    },
    permission(granted: boolean) { record(granted ? "permission_granted" : "permission_denied"); },
    seed() { record("seed_shown"); },
    requested() { record("fix_requested"); },
    fix(validated: boolean) { record(validated ? "fix_validated" : "fix_rejected"); },
    failed() { record("failed"); },
    /** A copy, so a reader cannot mutate the probe's own arrays. */
    snapshot(): MapAreaTrace {
      return { events: [...events], offsetsMs: [...offsets] };
    },
  };
}

export const mapAreaTimings = createMapAreaTimings(typeof __DEV__ !== "undefined" && __DEV__);
