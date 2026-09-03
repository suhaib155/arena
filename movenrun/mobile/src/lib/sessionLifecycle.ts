/**
 * The capture lifecycle: what the phone is doing during a movement session.
 *
 * A pure state machine, deliberately outside React. Every rule this module
 * enforces — one session id, one start, one finish, no overlapping pauses —
 * used to live as refs and booleans inside the movement screen, where the only
 * proof they held was reading the component and believing it. Here they are
 * properties of a function, provable on plain Node.
 *
 * ## Why this is not in `@movenrun/shared`
 *
 * `starting`, `active` and `paused` are questions about a phone.
 * The server never sees them: it receives finished evidence and answers about
 * it. What *is* shared is the evidence — mode, rules version, start, finish,
 * pauses — and that lives in `@movenrun/shared/session`, which this module
 * stamps and hands on.
 *
 * ## The transitions
 *
 * ```txt
 *   idle ──requestStart──▶ starting ──trackerStarted──▶ active ⇄ paused
 *     ▲                        │                           │       │
 *     └──────trackerFailed─────┘                           └─finish┴──▶ finished
 * ```
 *
 * `starting` exists because starting a tracker is asynchronous and can fail.
 * Without it, a session id and a start timestamp would exist before there was
 * anything capturing — a session that looks live, shows a running clock, and
 * records nothing. Nothing is stamped until {@link trackerStarted}.
 *
 * There is deliberately no matching `finishing`. Finish is synchronous: it
 * closes any open pause, stamps `finishedAt` and produces the evidence in one
 * step, with nothing to await and nothing that can fail halfway. A state
 * nothing can enter would still have to be handled everywhere it appeared, and
 * a reader would reasonably assume it was reachable. It arrives if and when
 * finishing acquires an asynchronous step.
 *
 * ## Every transition is total
 *
 * No function throws. Each returns the next lifecycle plus an `outcome` saying
 * what happened, so an impossible transition is a value the caller can ignore
 * rather than a crash on a double tap. `ignored` means the request was
 * redundant (a second Pause while paused); `invalid` means it made no sense
 * from here (Resume while active). Both leave the lifecycle untouched — which
 * is what makes rapid taps safe without a disabled button.
 */
import {
  DEFAULT_MOVEMENT_MODE,
  SESSION_RULES_VERSION,
  type MovementMode,
  type PauseInterval,
  type SessionMetadata,
} from "@movenrun/shared/session";

export type CaptureState =
  | "idle"
  | "starting"
  | "active"
  | "paused"
  | "finished";

/** What a transition request did. */
export type TransitionOutcome = "ok" | "ignored" | "invalid";

export interface SessionLifecycle {
  state: CaptureState;
  /**
   * The session's stable identity, or null before capture actually begins.
   *
   * Null in `idle` and `starting` on purpose: an id minted for a session that
   * never started would be a used idempotency key with no session behind it.
   * It is set exactly once, by {@link trackerStarted}, and never reassigned —
   * not on pause, resume, finish, save, navigation or retry.
   */
  clientSessionId: string | null;
  mode: MovementMode | null;
  rulesVersion: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  /** Closed pauses, in order. */
  pauses: PauseInterval[];
  /** When the current pause began, while paused. */
  openPauseAt: number | null;
}

export interface Transition {
  lifecycle: SessionLifecycle;
  outcome: TransitionOutcome;
}

export function idleLifecycle(): SessionLifecycle {
  return {
    state: "idle",
    clientSessionId: null,
    mode: null,
    rulesVersion: null,
    startedAt: null,
    finishedAt: null,
    pauses: [],
    openPauseAt: null,
  };
}

const unchanged = (lifecycle: SessionLifecycle, outcome: TransitionOutcome): Transition => ({
  lifecycle,
  outcome,
});

/* ── start ────────────────────────────────────────────────────────────────── */

/**
 * The user asked to start. Nothing is stamped yet.
 *
 * This is the single-flight gate: a second request while `starting`, `active`
 * or `paused` is ignored, so two taps cannot produce two trackers, two ids or
 * two start times. The guard is here rather than on a button because a
 * disabled button does not survive a replayed effect or a remount.
 */
export function requestStart(lifecycle: SessionLifecycle): Transition {
  if (lifecycle.state !== "idle") return unchanged(lifecycle, "ignored");
  return { lifecycle: { ...lifecycle, state: "starting" }, outcome: "ok" };
}

/**
 * The tracker is running. This is the moment a session exists.
 *
 * Identity, mode, rules version and start time are stamped together, in one
 * transition, because a session with three of the four is not a session. The
 * caller supplies the id (minted once, by the caller's id source) and the
 * clock; mode and rules version default to the only values the product
 * currently has.
 */
export function trackerStarted(
  lifecycle: SessionLifecycle,
  params: {
    clientSessionId: string;
    at: number;
    mode?: MovementMode;
    rulesVersion?: number;
  },
): Transition {
  if (lifecycle.state !== "starting") return unchanged(lifecycle, "invalid");
  return {
    lifecycle: {
      ...lifecycle,
      state: "active",
      clientSessionId: params.clientSessionId,
      mode: params.mode ?? DEFAULT_MOVEMENT_MODE,
      rulesVersion: params.rulesVersion ?? SESSION_RULES_VERSION,
      startedAt: params.at,
    },
    outcome: "ok",
  };
}

/**
 * The tracker failed to start. There was never a session.
 *
 * Returns to `idle` with nothing stamped: no id is burned, no start time
 * exists, no half-live session remains on screen, and Start is actionable
 * again. This is the case the old screen got wrong — a failed
 * `tracker.start()` left the session running, the clock ticking and the route
 * empty.
 */
export function trackerFailed(lifecycle: SessionLifecycle): Transition {
  if (lifecycle.state !== "starting") return unchanged(lifecycle, "invalid");
  return { lifecycle: idleLifecycle(), outcome: "ok" };
}

/* ── pause and resume ─────────────────────────────────────────────────────── */

/**
 * Pause. Only from `active`; a second Pause is ignored rather than opening a
 * second interval.
 *
 * A pause is an intentional event and is recorded as one. It is never a
 * tracking gap: the app records those separately, from AppState, and the two
 * must not be merged — see `PauseInterval` in the shared session domain.
 */
export function pause(lifecycle: SessionLifecycle, at: number): Transition {
  if (lifecycle.state === "paused") return unchanged(lifecycle, "ignored");
  if (lifecycle.state !== "active") return unchanged(lifecycle, "invalid");
  return {
    lifecycle: { ...lifecycle, state: "paused", openPauseAt: at },
    outcome: "ok",
  };
}

/**
 * Resume, closing the open pause interval.
 *
 * A resume timestamped before its own pause would produce a negative interval,
 * so it is clamped to the pause's start — the clock went backwards, which the
 * session model cannot fix and must not propagate as impossible evidence.
 */
export function resume(lifecycle: SessionLifecycle, at: number): Transition {
  if (lifecycle.state === "active") return unchanged(lifecycle, "ignored");
  if (lifecycle.state !== "paused" || lifecycle.openPauseAt === null) {
    return unchanged(lifecycle, "invalid");
  }
  const startedAt = lifecycle.openPauseAt;
  return {
    lifecycle: {
      ...lifecycle,
      state: "active",
      openPauseAt: null,
      pauses: [...lifecycle.pauses, { startedAt, endedAt: Math.max(at, startedAt) }],
    },
    outcome: "ok",
  };
}

/* ── finish ───────────────────────────────────────────────────────────────── */

/**
 * The user confirmed Finish. Capture stops here.
 *
 * Allowed from `active` and from `paused` — finishing a paused session is a
 * real thing people do, and an open pause is closed at `finishedAt` rather
 * than left dangling. A second Finish is ignored, so a double tap cannot
 * produce two finished sessions, two summaries or two submissions.
 *
 * `finishedAt` is clamped to be at or after `startedAt`. A finish earlier than
 * its own start is not a session that can be reasoned about, and the server
 * rejects one; clamping keeps the evidence coherent while the impossible clock
 * reading itself is a device problem this model cannot repair.
 */
export function finish(lifecycle: SessionLifecycle, at: number): Transition {
  if (lifecycle.state === "finished") return unchanged(lifecycle, "ignored");
  if (lifecycle.state !== "active" && lifecycle.state !== "paused") {
    return unchanged(lifecycle, "invalid");
  }
  const startedAt = lifecycle.startedAt ?? at;
  const finishedAt = Math.max(at, startedAt);
  const pauses =
    lifecycle.openPauseAt === null
      ? lifecycle.pauses
      : [
          ...lifecycle.pauses,
          {
            startedAt: lifecycle.openPauseAt,
            endedAt: Math.max(finishedAt, lifecycle.openPauseAt),
          },
        ];
  return {
    lifecycle: { ...lifecycle, state: "finished", finishedAt, openPauseAt: null, pauses },
    outcome: "ok",
  };
}

/* ── evidence ─────────────────────────────────────────────────────────────── */

/**
 * The immutable provenance of a finished session, or null if it has not
 * finished.
 *
 * Null rather than a partial object: metadata for a session still running
 * would have to invent a finish time, and the one thing this model must never
 * do is manufacture a lifecycle fact.
 *
 * The pause list is copied out, so a later transition on the lifecycle cannot
 * reach into evidence that has already been handed to the summary screen.
 */
export function sessionMetadata(lifecycle: SessionLifecycle): SessionMetadata | null {
  if (lifecycle.state !== "finished") return null;
  if (
    lifecycle.mode === null ||
    lifecycle.rulesVersion === null ||
    lifecycle.startedAt === null ||
    lifecycle.finishedAt === null
  ) {
    return null;
  }
  return {
    mode: lifecycle.mode,
    rulesVersion: lifecycle.rulesVersion,
    startedAt: lifecycle.startedAt,
    finishedAt: lifecycle.finishedAt,
    pauses: lifecycle.pauses.map((p) => ({ startedAt: p.startedAt, endedAt: p.endedAt })),
  };
}

/** Whether capture is running — the tracker should be collecting fixes. */
export function isCapturing(lifecycle: SessionLifecycle): boolean {
  return lifecycle.state === "active";
}

/** Whether a session exists at all, live or finished. */
export function hasSession(lifecycle: SessionLifecycle): boolean {
  return lifecycle.clientSessionId !== null;
}

/**
 * Time spent paused so far, including a pause still open at `now`.
 *
 * Used by the live clock, which must keep subtracting an open pause while the
 * user is standing still — otherwise the displayed time would jump forward the
 * moment they resumed.
 */
export function pausedMsSoFar(lifecycle: SessionLifecycle, now: number): number {
  let total = 0;
  for (const p of lifecycle.pauses) total += Math.max(0, p.endedAt - p.startedAt);
  if (lifecycle.openPauseAt !== null) total += Math.max(0, now - lifecycle.openPauseAt);
  return total;
}

/**
 * The active capture time to show on screen: elapsed minus paused.
 *
 * The same quantity `activeMs` computes for finished metadata, so the number
 * the user watched during the session is the number the finished session
 * carries. A test asserts the two agree rather than trusting that they do.
 */
export function activeMsSoFar(lifecycle: SessionLifecycle, now: number): number {
  if (lifecycle.startedAt === null) return 0;
  const end = lifecycle.finishedAt ?? now;
  return Math.max(0, end - lifecycle.startedAt - pausedMsSoFar(lifecycle, end));
}
