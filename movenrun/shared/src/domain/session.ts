/**
 * What a MovenRun movement session *is*.
 *
 * One session has one identity, one movement mode, one rules version, an
 * explicit start and finish, and a validated list of pauses. This module is the
 * only definition of those facts, so the phone and the server agree on them by
 * construction rather than by two implementations happening to match.
 *
 * ## Four layers, deliberately not one enum
 *
 * There are four different questions about a session, and collapsing them is
 * how a model stops being able to describe reality:
 *
 *  1. **Capture lifecycle** — what the phone is doing right now (idle,
 *     starting, active, paused). Runtime, mobile-only; it lives in
 *     `mobile/src/lib/sessionLifecycle.ts` and is deliberately absent here,
 *     because a server has no use for React lifecycle states.
 *  2. **Finished evidence** — the immutable package produced at Finish. That is
 *     {@link SessionMetadata} plus the observations, and it is what may be
 *     submitted.
 *  3. **Verification** — what the server said. Its own state, its own record.
 *  4. **Gameplay interpretation** — eligibility, sealing, solid/shade, points.
 *     None of it exists yet, and none of it is a field the phone declares.
 *
 * This module owns layer 2 only.
 *
 * ## What is not here
 *
 * No distance, no duration-as-truth, no traversed cells, no capture, no
 * ownership, no seal, no XP, no points, no trust score. The phone reports what
 * it observed and the identity of the session it observed it in; the server
 * measures. Adding any of those here would make the client an authority on its
 * own reward, which is the one thing this architecture refuses.
 */

/* ── movement mode ────────────────────────────────────────────────────────── */

/**
 * How the player was moving.
 *
 * **There is exactly one mode, and that is the honest state of the product.**
 *
 * The app cannot distinguish walking from running: there is no classifier, no
 * cadence sensor, no user selector, and inferring it from pace on the client
 * would be a guess presented as provenance. `onFoot` covers both, and says only
 * what is actually known.
 *
 * Cycling is deliberately **absent rather than present-but-disabled**. Game
 * Economy V3 gives cycling its own territory treatment — a different map, not
 * merely a different label — and none of that exists. A `cycling` value in this
 * enum today would be a value the server must reject, the UI must hide, and
 * some future reader would reasonably assume was supported. Absence cannot be
 * misread. It arrives with the rules version that defines what it means.
 *
 * The mode is stamped at Start and is immutable thereafter — through pause,
 * resume, finish, save, submission and every retry.
 */
export const MOVEMENT_MODES = ["onFoot"] as const;

export type MovementMode = (typeof MOVEMENT_MODES)[number];

/** The mode every session currently gets. Not a user choice: there is one. */
export const DEFAULT_MOVEMENT_MODE: MovementMode = "onFoot";

export function isMovementMode(value: unknown): value is MovementMode {
  return typeof value === "string" && (MOVEMENT_MODES as readonly string[]).includes(value);
}

/* ── rules version ────────────────────────────────────────────────────────── */

/**
 * Which gameplay interpretation applies to a session.
 *
 * This is **not** the app version, the API version, the storage schema version,
 * the migration number, the H3 resolution or the build number. It answers one
 * question: when someone reads this session back in a year, under which rules
 * was it captured?
 *
 * A small integer, because it has to survive JSON, a database column, a test
 * fixture and a future `switch`. Stamped at Start from this constant and never
 * recomputed — an app update between a failed submission and its retry must not
 * silently reinterpret a session that already happened.
 *
 * Not configurable. No environment variable, no remote config, no UI selector,
 * no fallback to the package version. A client that could choose its own rules
 * version would be choosing how its own movement is scored.
 */
export const SESSION_RULES_VERSION = 1;

/**
 * Versions this build understands.
 *
 * New sessions may only be stamped with {@link SESSION_RULES_VERSION}; this
 * list exists so a future build can still *read* sessions captured under
 * version 1 after version 2 ships. An unknown version fails closed rather than
 * being treated as current — silently scoring a v3 session under v1 rules is
 * exactly the bug the stamp exists to prevent.
 */
export const SUPPORTED_RULES_VERSIONS: readonly number[] = [SESSION_RULES_VERSION];

export function isSupportedRulesVersion(value: unknown): value is number {
  return typeof value === "number" && SUPPORTED_RULES_VERSIONS.includes(value);
}

/**
 * A session captured before session metadata existed.
 *
 * Represented by the **absence** of a rules version, not by a number. There is
 * no truthful value to write: those sessions were captured under semantics that
 * had no version, and stamping them `1` would assert they followed rules that
 * did not exist when they were recorded. Legacy database rows carry NULL, and
 * legacy queued retries carry no metadata at all.
 */
export const LEGACY_RULES_VERSION = null;

/* ── pauses ───────────────────────────────────────────────────────────────── */

/**
 * One interval during which the user had deliberately paused.
 *
 * **A pause is not a tracking gap, and the two must never be merged.** A pause
 * is an intentional app-state event: the user pressed Pause, and the absence of
 * movement is the expected result. A tracking gap is missing observation
 * continuity — the app was backgrounded, the fixes stopped, and the distance is
 * therefore a floor rather than a measurement.
 *
 * They mean opposite things to a reader. Relabelling a gap as a pause would
 * turn "we lost your data" into "you chose to stop", which is a lie in the
 * direction that flatters the app; relabelling a pause as a gap would warn the
 * user their route is incomplete when nothing was missed. They stay separate,
 * and a test asserts it.
 */
export interface PauseInterval {
  /** When Pause was pressed. */
  startedAt: number;
  /**
   * When Resume was pressed, or when the session finished while still paused.
   *
   * Always closed: an open-ended pause is a runtime state, not evidence, and
   * finished evidence has no room for "still happening".
   */
  endedAt: number;
}

/* ── the metadata ─────────────────────────────────────────────────────────── */

/**
 * The immutable provenance of one finished session.
 *
 * Everything here is decided at Start (mode, rules version, start time) or at
 * Finish (finish time, the closed pause list) and never afterwards. Retry
 * resubmits this object; it does not rebuild one from current defaults.
 */
export interface SessionMetadata {
  mode: MovementMode;
  rulesVersion: number;
  /**
   * When capture actually began — after the tracker started, not when the
   * screen mounted and not the first GPS timestamp.
   *
   * Lifecycle time and observation time are different clocks. A fix can arrive
   * before the UI has finished transitioning, and the last fix can precede the
   * moment the user pressed Finish. Conflating them is how "when the session
   * started" silently becomes "when the GPS chip first answered".
   */
  startedAt: number;
  /** When the user intentionally ended capture. Never inferred from the last
   *  observation. */
  finishedAt: number;
  /** Closed, ordered, non-overlapping, and inside the lifecycle window. */
  pauses: PauseInterval[];
}

/* ── validation ───────────────────────────────────────────────────────────── */

/**
 * Everything structurally wrong with session metadata, as categorical reasons.
 *
 * Reasons, not exceptions, so one response can name everything wrong at once —
 * matching how `structuralRejections` already reports observation problems.
 * The strings are categories: they never quote a timestamp, a coordinate or any
 * part of the payload, because these end up in an API response and in logs.
 */
export function sessionMetadataProblems(metadata: SessionMetadata): string[] {
  const reasons: string[] = [];
  const { mode, rulesVersion, startedAt, finishedAt, pauses } = metadata;

  if (!isMovementMode(mode)) reasons.push("Unsupported movement mode");
  if (!isSupportedRulesVersion(rulesVersion)) reasons.push("Unsupported session rules version");

  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt)) {
    reasons.push("Session lifecycle is not a finite time range");
    return reasons;
  }
  if (finishedAt < startedAt) reasons.push("Session finished before it started");

  if (!Array.isArray(pauses)) {
    reasons.push("Session pauses are not a list");
    return reasons;
  }

  let previousEnd: number | null = null;
  let malformed = 0;
  let reversed = 0;
  let outside = 0;
  let overlapping = 0;
  for (const pause of pauses) {
    if (
      typeof pause !== "object" ||
      pause === null ||
      !Number.isFinite(pause.startedAt) ||
      !Number.isFinite(pause.endedAt)
    ) {
      malformed += 1;
      continue;
    }
    if (pause.endedAt < pause.startedAt) reversed += 1;
    if (pause.startedAt < startedAt || pause.endedAt > finishedAt) outside += 1;
    /* Ordered AND non-overlapping in one check: a pause that begins before the
       previous one ended is either out of order or overlapping, and both are
       the same impossibility — the user cannot pause twice at once. */
    if (previousEnd !== null && pause.startedAt < previousEnd) overlapping += 1;
    previousEnd = pause.endedAt;
  }

  if (malformed > 0) reasons.push(`${malformed} pause interval(s) are malformed`);
  if (reversed > 0) reasons.push(`${reversed} pause interval(s) end before they begin`);
  if (outside > 0) reasons.push(`${outside} pause interval(s) fall outside the session`);
  if (overlapping > 0) reasons.push(`${overlapping} pause interval(s) overlap or are out of order`);

  return reasons;
}

/** True when the metadata is structurally sound. */
export function isValidSessionMetadata(metadata: SessionMetadata): boolean {
  return sessionMetadataProblems(metadata).length === 0;
}

/* ── durations, named rather than blurred ─────────────────────────────────── */

/**
 * Wall-clock span of the session: finish minus start, pauses included.
 *
 * This is how long the session *lasted*, not how long the user was moving.
 */
export function elapsedMs(metadata: SessionMetadata): number {
  return Math.max(0, metadata.finishedAt - metadata.startedAt);
}

/** Total time spent paused. */
export function pausedMs(metadata: SessionMetadata): number {
  let total = 0;
  for (const pause of metadata.pauses) {
    total += Math.max(0, pause.endedAt - pause.startedAt);
  }
  return total;
}

/**
 * Time the session was actively capturing: elapsed minus paused.
 *
 * This is the number the movement screen's clock shows and the one the finished
 * session carries — and it is **not** the duration the server reports. The
 * server measures from accepted observations under its own verification rules,
 * and the two legitimately differ: it drops points the tracker kept, and it
 * knows nothing about a pause. Neither is wrong; they answer different
 * questions, so they have different names.
 */
export function activeMs(metadata: SessionMetadata): number {
  return Math.max(0, elapsedMs(metadata) - pausedMs(metadata));
}

/* ── identity ─────────────────────────────────────────────────────────────── */

/**
 * Whether two metadata records describe the same session.
 *
 * Used at the idempotency boundary: a retry carries the metadata stamped at the
 * original Start, so a second submission under the same session id that
 * disagrees is not a retry — it is a different session wearing a used id, and
 * the server refuses it rather than overwriting what it already stored.
 *
 * Pauses are compared too. A retry replays the original evidence; a payload
 * whose pauses have changed did not come from the same finished session.
 */
export function sameSessionMetadata(a: SessionMetadata, b: SessionMetadata): boolean {
  if (a.mode !== b.mode) return false;
  if (a.rulesVersion !== b.rulesVersion) return false;
  if (a.startedAt !== b.startedAt) return false;
  if (a.finishedAt !== b.finishedAt) return false;
  if (a.pauses.length !== b.pauses.length) return false;
  return a.pauses.every(
    (pause, i) =>
      pause.startedAt === b.pauses[i].startedAt && pause.endedAt === b.pauses[i].endedAt,
  );
}
