/**
 * Movement verification — identity, observations, and lifecycle state.
 *
 * Pure: no React, no store, no network, no storage. Everything here is plain
 * data in, plain data out, so the rules can be tested without a device.
 *
 * ## Verification is not completion
 *
 * A movement session being *completed* and a movement session being *server
 * verified* are two different facts, and this module exists so they cannot be
 * confused. Completion is already recorded by the game store (XP, history,
 * local zones). Verification is a separate axis that starts at `local` and
 * never writes to any of that. A workout stays completed whatever the server
 * says, or fails to say.
 *
 * ## Verification is not territory
 *
 * `traversedHexIds` on a verified result records where the route went. It is
 * not capture, not ownership, not defence, and not a deed — the backend has no
 * territory model to base such a claim on. Nothing in this module maps it onto
 * zone state, and a test enforces that.
 */
import type { SessionMetadata } from "@movenrun/shared/session";

import type { TrackPoint } from "./geo";
import { MAX_ACCURACY_M } from "./geo";

/* ── stable session identity ──────────────────────────────────────────────── */

/**
 * The character set and length the backend accepts for a client session id
 * (`CLIENT_SESSION_ID_RE` in the movement router). Mirrored here so a bad id
 * is caught on this side rather than as a 400.
 */
export const CLIENT_SESSION_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Mint one id for one movement session.
 *
 * Called exactly once, when a session begins — never in the API client, never
 * during serialisation, never in a retry handler, and never because an HTTP
 * attempt failed. The backend's idempotency is keyed on
 * (authenticated user, clientSessionId), so a fresh id per attempt would turn
 * every retry into a second verification and defeat the guarantee entirely.
 *
 * Not derived from coordinates (that would leak location into an identifier
 * that travels with the request) and not derived from the user id (that is the
 * server's business, and would make ids collide across sessions).
 *
 * This is an idempotency key, not a secret: it is scoped per user server-side,
 * so guessing one gains nothing. Uniqueness only has to hold within one user's
 * sessions, which a timestamp plus randomness comfortably provides.
 */
export function newClientSessionId(now: number = Date.now(), random: () => number = Math.random): string {
  const stamp = now.toString(36);
  const noise = () => Math.floor(random() * 0x10000).toString(36).padStart(4, "0");
  return `mv-${stamp}-${noise()}${noise()}`;
}

/* ── observations ─────────────────────────────────────────────────────────── */

/** One point exactly as the backend accepts it. */
export interface ObservationPoint {
  breakBefore?: boolean;
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
}

export interface SessionObservations {
  startTime: number;
  endTime: number;
  points: ObservationPoint[];
}

/**
 * One completed session, exactly as it goes on the wire and into the retry
 * queue: observations plus the immutable provenance stamped at Start.
 *
 * `session` is optional, and its absence is meaningful rather than a default.
 * A queued retry created before the session model existed has no metadata, and
 * there is no truthful way to invent one — the mode was never chosen and the
 * rules version did not exist. Such an item resubmits in the legacy shape and
 * the server records it as legacy. See `docs/SESSION_MODEL.md`.
 */
export interface SessionSubmission {
  observations: SessionObservations;
  session?: SessionMetadata;
}

/**
 * The accuracy reported for a fix whose real accuracy the platform did not
 * give us (`Location.coords.accuracy` can be null).
 *
 * The backend requires a number, so something has to be sent. Sending `0`
 * would assert a perfect fix and would make the server's "too many poor
 * points" check see a cleaner route than we actually observed — claiming
 * precision we do not have, in the direction that flatters us.
 *
 * `MAX_ACCURACY_M` is the compatibility fallback for older recorded routes.
 * New capture rejects unknown accuracy because it cannot bound displacement
 * uncertainty; legacy retries retain their original evidence shape.
 */
export const UNKNOWN_ACCURACY_M = MAX_ACCURACY_M;

/**
 * Turn a completed session's route into the observations the server verifies.
 *
 * Observations only. Distance, duration, traversed hexes, capture, XP, Locked
 * MOVE, trust and ownership are all server-derived or local-display concerns,
 * and none of them appears here — the mobile app's own `distanceM` is a
 * display value and is deliberately not sent as a claim, because the server
 * computes distance itself and a second number would only invite the question
 * of which one is authoritative.
 */
export function toObservations(session: {
  points: readonly TrackPoint[];
  durationMs: number;
  finishedAt: number;
}): SessionObservations {
  const points = session.points.map((p) => ({
    lat: p.latitude,
    lng: p.longitude,
    accuracy: p.accuracy ?? UNKNOWN_ACCURACY_M,
    timestamp: p.timestamp,
    ...(p.breakBefore === true ? { breakBefore: true } : {}),
  }));

  /* The session window must contain every point, or the server rejects the
     payload as structurally inconsistent. The tracker's own timestamps are the
     only trustworthy bounds here: `finishedAt` is taken after the last fix, and
     a paused session's duration is shorter than its wall-clock span, so
     deriving start as `finishedAt - durationMs` can land AFTER the first
     point. Use the observed extremes instead, falling back to the session
     clock when there are no points at all. */
  const timestamps = points.map((p) => p.timestamp);
  const startTime = timestamps.length ? Math.min(...timestamps) : session.finishedAt - session.durationMs;
  const endTime = timestamps.length ? Math.max(...timestamps) : session.finishedAt;

  return { startTime, endTime, points };
}

/**
 * The complete submission for a finished session: its observations, and the
 * provenance stamped when it started.
 *
 * The observation window and the lifecycle window are computed separately and
 * deliberately stay separate. {@link toObservations} derives the window from
 * the observed timestamps because the server validates that every point falls
 * inside it; `session.startedAt`/`finishedAt` say when the *user* started and
 * finished, which is a different fact and can legitimately sit outside the
 * observed extremes — a fix can land before the UI finished transitioning, and
 * the last fix normally precedes the Finish tap.
 *
 * Collapsing the two would either break the server's structural check or
 * misreport when the session happened. They are two clocks, and this is where
 * that is written down.
 */
export function toSubmission(session: {
  points: readonly TrackPoint[];
  durationMs: number;
  finishedAt: number;
  session?: SessionMetadata;
}): SessionSubmission {
  const observations = toObservations(session);
  return session.session ? { observations, session: session.session } : { observations };
}

/* ── lifecycle state ──────────────────────────────────────────────────────── */

/**
 * Where one completed session stands with the server.
 *
 * Deliberately its own union rather than a flag on task completion, XP, or a
 * captured-zone boolean: overloading any of those would make "the workout
 * happened" and "the server agreed" the same bit, which is exactly the
 * conflation this task exists to prevent.
 *
 * There is no `pending` status on the wire — the endpoint answers
 * synchronously with `verified` or `rejected`. `pending` here is a *client*
 * state meaning "we could not get an answer", which is a different thing and
 * is never presented as a server verdict.
 */
export type VerificationState =
  /** Completed locally; no submission attempted. */
  | { kind: "local" }
  /** A request is in flight for this session. */
  | { kind: "submitting" }
  /** The server measured it. */
  | {
      kind: "verified";
      distanceMeters: number | null;
      durationSeconds: number | null;
      /** Where the route went. NOT capture, NOT ownership. */
      traversedHexIds: string[];
    }
  /** The server answered, and declined to verify. A domain result, not a fault. */
  | { kind: "rejected"; reasons: string[] }
  /**
   * No answer was obtained — offline, timed out, unauthenticated, the server
   * erred, or it replied with something this client refuses to trust. The
   * session stays completed and stays eligible for a later attempt.
   */
  | { kind: "pending"; reason: PendingReason };

/**
 * Why no verdict was obtained.
 *
 * These are kept distinct rather than collapsed into "it failed" because the
 * retry layer has to tell them apart: `offline`/`timeout`/`server_error` are
 * cases where the server never answered and asking again is exactly right,
 * whereas `invalid_request` and `not_found` are the server having answered —
 * it looked at the request and refused it, and identical bytes will be refused
 * identically for as long as anyone cares to send them.
 */
export type PendingReason =
  | "offline"
  | "timeout"
  | "unauthenticated"
  /** The server refused the payload (400/422). Sending it again cannot help. */
  | "invalid_request"
  /** The endpoint is not there (404). Also not a connectivity problem. */
  | "not_found"
  /** The server failed to answer (5xx). */
  | "server_error"
  | "malformed_response";

export const INITIAL_VERIFICATION: VerificationState = { kind: "local" };

/** Whether a state means "the server has spoken". */
export function isSettled(state: VerificationState): boolean {
  return state.kind === "verified" || state.kind === "rejected";
}

/**
 * Whether a fresh submission should be started for this state.
 *
 * `submitting` is excluded so a re-render, a double tap, or a replayed effect
 * cannot start a second request; `verified`/`rejected` are excluded because
 * the server has already answered and asking again would only re-fetch the
 * same idempotent result.
 */
export function shouldSubmit(state: VerificationState): boolean {
  return state.kind === "local" || state.kind === "pending";
}

/**
 * Whether a completed session is eligible for verification at all.
 *
 * Mirrors the product's existing save gate rather than inventing a second one:
 * a demo session is not real movement, and a session too short to save is not
 * worth a round trip or a GPS upload. An unfinished session has no business
 * here — it has no final window and its points are still mutating.
 */
export function isVerifiable(session: {
  mode: string;
  finished: boolean;
  saveable: boolean;
  points: readonly unknown[];
}): boolean {
  if (!session.finished) return false;
  if (session.mode !== "gps") return false;
  if (!session.saveable) return false;
  // The backend requires at least two points to measure anything.
  return session.points.length >= 2;
}
