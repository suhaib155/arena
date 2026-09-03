/**
 * In-memory hand-off for a finished movement session, so the summary screen
 * can read the full route without serializing it through router params.
 * Intentionally not persisted: raw GPS points live only as long as the user
 * is looking at the summary. Saving a session stores derived stats only
 * (distance/time → XP record) via the existing game store.
 */
import type { SessionMetadata } from "@movenrun/shared/session";

import type { TrackPoint } from "@/lib/geo";
import type { TrackingGap } from "@/lib/trackPoints";
import type { TrackerMode } from "./moveTracker";
import { INITIAL_VERIFICATION, type VerificationState } from "@/lib/movementVerification";

export interface FinishedSession {
  /**
   * This session's stable identity, minted once when the session begins and
   * never regenerated — not on re-render, not when the summary is reopened,
   * and above all not when a network attempt fails. The backend's idempotency
   * is keyed on (authenticated user, clientSessionId), so a fresh id per
   * attempt would turn every retry into a second verification.
   */
  clientSessionId: string;
  /**
   * Where the observations came from: real foreground GPS, or the synthesized
   * demo route.
   *
   * NOT the movement mode. This says whether the evidence is real; `session.mode`
   * says how the player was moving. They are different axes and were nearly
   * given the same name — a demo session and an on-foot session are not
   * alternatives to each other.
   */
  mode: TrackerMode;
  /**
   * The immutable provenance stamped at Start and closed at Finish: movement
   * mode, rules version, lifecycle start/finish and the pause intervals.
   *
   * Optional only for the sake of older call sites and fixtures that predate
   * the session model; every session the app produces now carries one, and the
   * request builder sends the legacy shape when it is absent rather than
   * inventing values.
   */
  session?: SessionMetadata;
  points: TrackPoint[];
  distanceM: number;
  /**
   * Active capture time in milliseconds: elapsed wall clock minus time paused.
   *
   * This is what the screen's clock showed. It is deliberately NOT the
   * duration the server reports — that is measured from accepted observations
   * under the verification rules and legitimately differs. When `session` is
   * present this equals `activeMs(session)`, and a test asserts it rather than
   * assuming.
   */
  durationMs: number;
  /** When the user ended capture. Mirrors `session.finishedAt` when present. */
  finishedAt: number;
  /** Spans where the app was backgrounded and no fixes arrived, so the summary
   *  can say the distance is incomplete instead of presenting it as the truth.
   *  Optional: older callers and demo sessions simply have none. */
  gaps?: TrackingGap[];
}

let last: FinishedSession | null = null;

/**
 * Verification state for the session in `last`, held beside it rather than in
 * the game store.
 *
 * The game store is where *completion* lives — XP, history, local zones — and
 * putting verification there would invite the two to be read as one fact. This
 * is also why it is not persisted: Task 3 makes one attempt for a session the
 * user is looking at. Durable retry across restarts is a later, separate
 * design (it needs account scoping and a retention bound), and pretending to
 * have it here would leave GPS observations sitting in storage with no policy.
 */
let lastVerification: VerificationState = INITIAL_VERIFICATION;

export function setLastSession(session: FinishedSession): void {
  last = session;
  lastVerification = INITIAL_VERIFICATION;
}

export function getLastSession(): FinishedSession | null {
  return last;
}

/** Verification state for the session currently held, or `local` when none. */
export function getVerificationState(): VerificationState {
  return last ? lastVerification : INITIAL_VERIFICATION;
}

/**
 * Record a transition. Ignored when it names a session that is no longer the
 * one held, so a response arriving after the user has started a new session
 * can never label the new one with the old one's verdict.
 */
export function setVerificationState(clientSessionId: string, state: VerificationState): void {
  if (!last || last.clientSessionId !== clientSessionId) return;
  lastVerification = state;
}

export function clearLastSession(): void {
  last = null;
  lastVerification = INITIAL_VERIFICATION;
}

/**
 * XP preview for a session: 60 XP per km + 3 XP per minute, floored at 25 and
 * capped at 300 so long sessions can't be farmed for unbounded XP. Display
 * math only — awarding still goes through the store's once-per-day gate.
 */
export function sessionXp(distanceM: number, durationMs: number): number {
  const km = distanceM / 1000;
  const minutes = durationMs / 60_000;
  const xp = Math.round(km * 60 + minutes * 3);
  return Math.max(25, Math.min(300, xp));
}

/** Minimum to count as a real session (avoids junk saves). */
export function isSaveable(distanceM: number, durationMs: number): boolean {
  return distanceM >= 200 || durationMs >= 5 * 60_000;
}
